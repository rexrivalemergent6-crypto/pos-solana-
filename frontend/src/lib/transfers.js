import api from "@/lib/api";
import { executeSteps } from "@/lib/solanaClient";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function confirmWithRetry(tid, signature, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const { data } = await api.post(`/transfers/${tid}/confirm`, { signature });
      return data;
    } catch (e) {
      if (e?.response?.status !== 409 || i === tries - 1) throw e;
      await sleep(2500);
    }
  }
  return null;
}

async function markDelivered(tid, signature) {
  for (let i = 0; i < 4; i++) {
    try { return (await api.post(`/transfers/${tid}/delivered`, { signature })).data; }
    catch (e) { if (i === 3) throw e; await sleep(2000); }
  }
  return null;
}

/** Run a prepared transfer bundle end-to-end and report each step back to the server. */
export async function runBundle(bundle, feePayer, onProgress) {
  const tid = bundle.transfer.id;
  let sigs;
  try {
    sigs = await executeSteps(bundle.steps, feePayer, onProgress);
  } catch (e) {
    const s = e.sigs || {};
    if (s.sign) { try { await confirmWithRetry(tid, s.sign, 3); } catch (_) { /* reconciled by watcher */ } }
    throw e;
  }
  let transfer = bundle.transfer;
  if (sigs.sign) transfer = (await confirmWithRetry(tid, sigs.sign)) || transfer;
  if (sigs.deliver) transfer = (await markDelivered(tid, sigs.deliver)) || transfer;
  return { sigs, transfer };
}

/** Finish the Ed25519 delivery step of a wallet-route transfer whose spend already landed. */
export async function runDelivery(tid, feePayer, onProgress) {
  const { data } = await api.get(`/transfers/${tid}/deliver-ixs`);
  const sigs = await executeSteps(data.steps, feePayer, onProgress);
  return markDelivered(tid, sigs.deliver);
}
