import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Vault, ArrowDownLeft, ArrowUpRight, ArrowsLeftRight, Key, ArrowSquareOut, Warning, ArrowClockwise, Trash, Truck,
} from "@phosphor-icons/react";
import KeygenAnimation from "@/components/KeygenAnimation";
import api from "@/lib/api";
import { sendSingle } from "@/lib/solanaClient";
import { runBundle, runDelivery } from "@/lib/transfers";
import { ago, errMsg, short } from "@/lib/format";
import TxProgress from "./TxProgress";
import { ConfigContext } from "@/App";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------- create vault ----------------------------- */
export function CreateVault({ me, onDone }) {
  const [deposit, setDeposit] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const cfg = ConfigContext.current;

  const create = async () => {
    setBusy(true);
    try {
      setStage("Generating one-time Winternitz key…");
      const { data } = await api.post("/vault/create", { deposit_sol: parseFloat(deposit) || 0 });
      setStage("Approve vault creation in Phantom…");
      const sig = await sendSingle(data.ixs, me);
      setStage("Verifying vault on-chain…");
      for (let i = 0; i < 6; i++) {
        try { await api.post("/vault/confirm-open", { signature: sig }); break; }
        catch (e) { if (e?.response?.status !== 409 || i === 5) throw e; await sleep(2500); }
      }
      toast.success("Quantum vault opened on mainnet");
      onDone?.();
    } catch (e) {
      toast.error(errMsg(e, "Could not open vault"));
    } finally { setBusy(false); setStage(""); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} data-testid="create-vault-card"
      className="grid grid-cols-1 gap-px border border-white/10 bg-white/10 md:grid-cols-2">
      <div className="bg-quantum-ink p-6 sm:p-8">
        <p className="font-plex-mono text-[11px] uppercase tracking-[0.2em] text-quantum-green">// step 01</p>
        <h2 className="mt-3 font-mono text-3xl font-bold tracking-tighter">Open your quantum vault</h2>
        <p className="mt-3 text-sm leading-relaxed text-white/55">
          We generate a Winternitz key, hash it, and derive your permanent vault address from that hash. One Phantom approval creates the vault
          and its wrapped-SOL account on mainnet. You can also make a first deposit in the same step.
        </p>
        <ul className="mt-5 space-y-1.5 font-plex-mono text-[11px] text-white/50">
          <li>· One-time rent ≈ <span className="text-white" data-testid="create-cost">{((cfg?.vault_rent_lamports || 1188720) / 1e9 + (cfg?.token_rent_lamports || 1488440) / 1e9).toFixed(5)} SOL</span> (vault {((cfg?.vault_rent_lamports || 1188720) / 1e9).toFixed(5)} + wSOL account {((cfg?.token_rent_lamports || 1488440) / 1e9).toFixed(5)})</li>
          <li>· Spends need a one-time Winternitz signature; Ed25519 alone can’t move these funds</li>
          <li>· Your vault address never changes, but the key behind it rotates on every transfer</li>
        </ul>
        <div className="mt-6">
          <label className="font-plex-mono text-[10px] uppercase tracking-widest text-white/40">Initial deposit (optional, SOL)</label>
          <Input data-testid="create-deposit-input" type="number" step="0.01" min="0" value={deposit} onChange={(e) => setDeposit(e.target.value)}
            placeholder="0.1" className="mt-1.5 rounded-none border-white/15 bg-black font-mono" />
        </div>
        <Button data-testid="create-vault-btn" onClick={create} disabled={busy}
          className="btn-sheen mt-4 h-12 w-full rounded-none bg-quantum-green font-mono font-bold text-black hover:bg-quantum-greenDark">
          <Vault weight="fill" className="mr-2 h-5 w-5" /> {busy ? stage || "Working…" : "Generate key & open vault"}
        </Button>
      </div>
      <div className="flex items-center justify-center bg-black p-6"><KeygenAnimation /></div>
    </motion.div>
  );
}

/* ----------------------------- pending / undelivered ----------------------------- */
export function PendingBanner({ me, pending, undelivered, onChange }) {
  const [bundle, setBundle] = useState(null);
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setBundle(null); setProgress(null); }, [pending?.id, undelivered?.id]);
  if (!pending && !undelivered) return null;

  const resume = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/transfers/${pending.id}/retry`);
      setBundle(data);
      await runBundle(data, me, setProgress);
      setProgress({ phase: "done" });
      toast.success("Transfer completed — key rotated");
    } catch (e) {
      setProgress((p) => ({ ...(p || {}), failed: e.step || "sign" }));
      toast.error(errMsg(e, "Resume failed"));
    } finally { setBusy(false); onChange?.(); }
  };
  const discard = async () => {
    if (!window.confirm("Discard this signed transfer? Its signature may already be public, so your next transfer will need a second signature on the same key, which weakens it. Only do this if the transfer can't go through.")) return;
    try { await api.post(`/transfers/${pending.id}/discard`); toast.message("Transfer discarded"); }
    catch (e) { toast.error(errMsg(e)); }
    onChange?.();
  };
  const deliver = async () => {
    setBusy(true);
    try { await runDelivery(undelivered.id, me, setProgress); toast.success("Delivered as native SOL"); }
    catch (e) { toast.error(errMsg(e, "Delivery failed")); }
    finally { setBusy(false); onChange?.(); }
  };

  const t = pending || undelivered;
  return (
    <div data-testid="pending-banner" className="border border-quantum-warning/40 bg-quantum-warning/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-start gap-2 font-plex-mono text-xs text-quantum-warning">
          <Warning weight="fill" className="mt-0.5 h-4 w-4 shrink-0" />
          {pending ? (
            <span>Signed transfer waiting: <b className="text-white">{t.amount_sol} SOL</b> → {short(t.to_address)} (key #{t.nonce}). Resuming reuses the exact same signature.</span>
          ) : (
            <span>Your {t.amount_sol} SOL left the vault but hasn’t been delivered to {short(t.to_address)} yet. It’s sitting safely as wSOL in your own Phantom.</span>
          )}
        </p>
        <div className="flex gap-2">
          {pending ? (
            <>
              <Button data-testid="resume-transfer-btn" onClick={resume} disabled={busy}
                className="h-8 rounded-none bg-quantum-warning font-mono text-xs text-black hover:bg-quantum-warning/80"><ArrowClockwise className="mr-1.5 h-3.5 w-3.5" /> Resume</Button>
              <Button data-testid="discard-transfer-btn" onClick={discard} disabled={busy} variant="ghost"
                className="h-8 rounded-none font-mono text-xs text-white/60 hover:bg-red-500/10 hover:text-red-400"><Trash className="mr-1.5 h-3.5 w-3.5" /> Discard</Button>
            </>
          ) : (
            <Button data-testid="finish-delivery-btn" onClick={deliver} disabled={busy}
              className="h-8 rounded-none bg-quantum-warning font-mono text-xs text-black hover:bg-quantum-warning/80"><Truck className="mr-1.5 h-3.5 w-3.5" /> Finish delivery</Button>
          )}
        </div>
      </div>
      {bundle && <div className="mt-3"><TxProgress steps={bundle.steps} progress={progress} /></div>}
    </div>
  );
}

/* ----------------------------- activity ----------------------------- */
const KIND = {
  out: { icon: ArrowUpRight, c: "text-quantum-purple", sign: "−" },
  in: { icon: ArrowDownLeft, c: "text-quantum-green", sign: "+" },
  self: { icon: ArrowsLeftRight, c: "text-quantum-cyan", sign: "−" },
};
function label(t) {
  if (t.kind === "deposit") return t.sender && t.sender !== t.recipient_owner ? `Received from ${short(t.sender)}` : t.sender ? "Deposit from Phantom" : "Deposit (external)";
  if (t.kind === "withdraw_all") return "Withdrew everything to Phantom";
  if (t.kind === "withdraw") return "Withdrew to Phantom";
  if (t.direction === "in") return `Received from ${short(t.sender)}`;
  return `Sent to ${short(t.to_address)}${t.route === "vault" ? " · vault" : ""}`;
}

export function ActivityList({ items }) {
  return (
    <div className="border border-white/10 bg-quantum-ink" data-testid="activity-list">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <p className="font-plex-mono text-[11px] uppercase tracking-[0.2em] text-white/50">Activity</p>
        <span className="font-plex-mono text-[10px] text-white/30">{items.length} events</span>
      </div>
      {items.length === 0 ? (
        <p className="p-8 text-center font-plex-mono text-xs text-white/35">No transfers yet. Deposit or share your pay link to get started.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {items.map((t) => {
            const k = KIND[t.direction] || KIND.in;
            return (
              <li key={t.id} data-testid={`activity-item-${t.id}`} className="flex items-center gap-3 px-4 py-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center border border-white/10 ${k.c}`}><k.icon className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs">{label(t)}</p>
                  <p className="truncate font-plex-mono text-[10px] text-white/35">
                    {ago(t.completed_at || t.created_at)}{t.nonce != null && t.kind !== "deposit" ? ` · key #${t.nonce}` : ""}{t.memo ? ` · ${t.memo}` : ""}
                    {t.status !== "completed" && <span className="text-quantum-warning"> · {t.status}</span>}
                    {t.route === "wallet" && t.status === "completed" && !t.delivered && <span className="text-quantum-warning"> · awaiting delivery</span>}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`font-mono text-sm font-bold ${k.c}`}>{k.sign}{Number(t.amount_sol).toFixed(4)}</p>
                  {t.explorer && (
                    <a href={t.explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-plex-mono text-[10px] text-white/35 hover:text-quantum-cyan">
                      tx <ArrowSquareOut className="h-2.5 w-2.5" />
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ----------------------------- key chain ----------------------------- */
export function KeyChain({ keys }) {
  return (
    <div className="border border-white/10 bg-quantum-ink" data-testid="key-chain">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <p className="flex items-center gap-1.5 font-plex-mono text-[11px] uppercase tracking-[0.2em] text-white/50"><Key className="h-3.5 w-3.5" /> One-time key chain</p>
        <span className="font-plex-mono text-[10px] text-white/30">{Math.max(0, keys.length - 1)} retired</span>
      </div>
      <ol className="max-h-80 overflow-y-auto p-3">
        {keys.map((k, i) => (
          <li key={`${k.nonce}-${k.status}`} className="relative flex gap-3 pb-3 pl-1">
            {i < keys.length - 1 && <span className="absolute left-[11px] top-6 h-[calc(100%-12px)] w-px bg-white/10" />}
            <span className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center border text-[9px] ${k.status === "live" ? "border-quantum-green bg-quantum-green/20 text-quantum-green" : "border-white/15 text-white/30"}`}>{k.nonce}</span>
            <div className="min-w-0">
              <p className={`font-plex-mono text-[11px] ${k.status === "live" ? "text-quantum-green" : "text-white/40 line-through decoration-white/20"}`}>
                pk {k.pk_hash.slice(0, 10)}…{k.pk_hash.slice(-6)}
              </p>
              <p className="font-plex-mono text-[10px] text-white/30">
                {k.status === "live" ? "live · authorises the next spend" : <>retired {ago(k.retired_at)}{k.explorer && <> · <a href={k.explorer} target="_blank" rel="noreferrer" className="hover:text-quantum-cyan">tx</a></>}</>}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

