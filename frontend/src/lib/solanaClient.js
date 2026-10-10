import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { getPhantom } from "./phantom";
import { API } from "./api";

// Browser -> our backend proxy -> Solana RPC. The public mainnet RPC rejects browser
// origins with 403 "Access forbidden", so all reads/writes go through /api/rpc.
const PROXY_RPC = `${API}/rpc`;
let _conn = null;

export function initConnection() {
  if (!_conn) {
    _conn = new Connection(PROXY_RPC, { commitment: "confirmed", disableRetryOnRateLimit: false });
  }
  return _conn;
}

export function getConnection() {
  return _conn || initConnection();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// HTTP polling confirmation (no websocket needed through the proxy).
async function confirmByPolling(conn, signature, lastValidBlockHeight, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { value } = await conn.getSignatureStatuses([signature]);
      const st = value?.[0];
      if (st?.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(st.err)}`);
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
      const h = await conn.getBlockHeight("confirmed");
      if (h > lastValidBlockHeight) throw new Error("Transaction expired before confirming — please retry");
    } catch (e) {
      if (/failed on-chain|expired/.test(e.message)) throw e;
    }
    await sleep(2000);
  }
  throw new Error("Timed out waiting for confirmation — check the explorer, then refresh");
}

export function ixFromDescriptor(desc) {
  return new TransactionInstruction({
    programId: new PublicKey(desc.programId),
    keys: desc.keys.map((k) => ({
      pubkey: new PublicKey(k.pubkey),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    data: Buffer.from(desc.data, "base64"),
  });
}

function buildTx(step, feePayer, blockhash) {
  const tx = new Transaction();
  if (step.cu_limit) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: step.cu_limit }));
  if (step.cu_price) tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: step.cu_price }));
  step.ixs.forEach((d) => tx.add(ixFromDescriptor(d)));
  tx.feePayer = new PublicKey(feePayer);
  tx.recentBlockhash = blockhash;
  return tx;
}

function walletError(e) {
  if (e?.code === 4001) return new Error("Request rejected in Phantom");
  return e;
}

async function latest(conn) {
  try {
    return await conn.getLatestBlockhash("confirmed");
  } catch (e) {
    throw new Error(`Could not reach Solana network: ${e?.message || e}`);
  }
}

/** One transaction, signed and sent by Phantom (vault open, deposits). */
export async function sendSingle(ixs, feePayer, cuLimit = null) {
  const conn = getConnection();
  const p = getPhantom();
  if (!p) throw new Error("Phantom not found");
  const { blockhash, lastValidBlockHeight } = await latest(conn);
  const tx = buildTx({ ixs, cu_limit: cuLimit }, feePayer, blockhash);
  let signature;
  try {
    ({ signature } = await p.signAndSendTransaction(tx));
  } catch (e) { throw walletError(e); }
  await confirmByPolling(conn, signature, lastValidBlockHeight);
  return signature;
}

/**
 * Ordered multi-step bundle from the backend (prepare -> sign -> deliver).
 * Phantom approves every step ONCE (signAllTransactions); steps are then broadcast strictly in
 * order, each confirmed before the next, so the WOTS spend only lands after its destination exists.
 */
export async function executeSteps(steps, feePayer, onProgress = () => {}) {
  const conn = getConnection();
  const p = getPhantom();
  if (!p) throw new Error("Phantom not found");
  const { blockhash, lastValidBlockHeight } = await latest(conn);
  const txs = steps.map((s) => buildTx(s, feePayer, blockhash));
  onProgress({ phase: "approve" });
  let signed;
  try {
    if (p.signAllTransactions) signed = await p.signAllTransactions(txs);
    else { signed = []; for (const t of txs) signed.push(await p.signTransaction(t)); }
  } catch (e) { throw walletError(e); }

  const sigs = {};
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    onProgress({ phase: "send", step: s.name, index: i });
    let sig;
    try {
      sig = await conn.sendRawTransaction(signed[i].serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
    } catch (e) {
      const err = new Error(`${s.label} failed: ${e?.message || e}`);
      err.step = s.name; err.sigs = sigs; throw err;
    }
    try {
      await confirmByPolling(conn, sig, lastValidBlockHeight);
    } catch (e) {
      e.step = s.name; e.sigs = { ...sigs, [s.name]: sig }; throw e;
    }
    sigs[s.name] = sig;
    onProgress({ phase: "confirmed", step: s.name, index: i, signature: sig });
  }
  return sigs;
}
