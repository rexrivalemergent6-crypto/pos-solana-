import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Vault, Wallet, Warning, CheckCircle, ArrowSquareOut } from "@phosphor-icons/react";
import api from "@/lib/api";
import { runBundle } from "@/lib/transfers";
import { errMsg, isAddress, short, usd } from "@/lib/format";
import TxProgress from "./TxProgress";

/**
 * Send (to any address) or partial Withdraw (to = own Phantom). mode: "send" | "withdraw"
 */
export default function SendDialog({ open, onOpenChange, me, vault, usdRate, mode = "send", onDone }) {
  const isWithdraw = mode === "withdraw";
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [all, setAll] = useState(false);
  const [resolved, setResolved] = useState(null);
  const [bundle, setBundle] = useState(null);
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  const [needAck, setNeedAck] = useState("");
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (open) {
      setTo(isWithdraw ? me : ""); setAmount(""); setMemo(""); setAll(false); setResolved(null);
      setBundle(null); setProgress(null); setBusy(false); setNeedAck(""); setDone(null);
    }
  }, [open, isWithdraw, me]);

  useEffect(() => {
    if (isWithdraw || !isAddress(to)) { setResolved(null); return; }
    const t = setTimeout(() => {
      api.get(`/resolve/${to.trim()}`).then(({ data }) => setResolved(data)).catch(() => setResolved({ error: true }));
    }, 300);
    return () => clearTimeout(t);
  }, [to, isWithdraw]);

  const spendable = vault?.spendable_sol || 0;
  const amt = parseFloat(amount);
  const valid = (isWithdraw && all) || (isAddress(to) && amt > 0 && amt <= spendable + 1e-12);
  const self = to.trim() === me;

  const route = useMemo(() => {
    if (isWithdraw) return all ? "close" : "wallet";
    if (self) return "wallet";
    return resolved?.kind || null;
  }, [isWithdraw, all, self, resolved]);

  const submit = async (ack = false) => {
    setBusy(true); setNeedAck("");
    try {
      const body = isWithdraw && all ? { mode: "withdraw_all", acknowledge_key_reuse: ack }
        : { mode: "send", to: to.trim(), amount_sol: amt, memo, acknowledge_key_reuse: ack };
      const { data } = await api.post("/transfers/prepare", body);
      setBundle(data);
      setProgress({ phase: "approve" });
      const res = await runBundle(data, me, (p) => setProgress(p));
      setProgress({ phase: "done" });
      setDone(res);
      toast.success(isWithdraw ? "Withdrawn to Phantom" : "Sent — key rotated");
      onDone?.();
    } catch (e) {
      if (e?.response?.status === 428) { setNeedAck(errMsg(e)); setBundle(null); setProgress(null); }
      else {
        setProgress((p) => ({ ...(p || {}), failed: e.step || "sign" }));
        toast.error(errMsg(e, "Transfer failed"));
        onDone?.();
      }
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto rounded-none border-white/10 bg-quantum-ink" data-testid={`${mode}-dialog`}>
        <DialogHeader>
          <DialogTitle className="font-mono tracking-tight">{isWithdraw ? "Withdraw to Phantom" : "Send SOL"}</DialogTitle>
          <DialogDescription className="font-plex-mono text-xs text-white/50">
            Authorised by a one-time Winternitz signature. Your vault key rotates when it lands.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center gap-3 border border-quantum-green/40 bg-quantum-green/10 p-6 text-center" data-testid="transfer-success">
            <CheckCircle weight="fill" className="h-12 w-12 text-quantum-green" />
            <p className="font-mono text-lg font-bold text-quantum-green">{done.transfer?.amount_sol ? `${done.transfer.amount_sol} SOL` : "Done"}</p>
            <p className="font-plex-mono text-xs text-white/50">
              {route === "vault" ? "Delivered vault-to-vault and still quantum-protected." : "Delivered as native SOL."} Key #{(bundle?.nonce ?? 0) + 1} is now live.
            </p>
            {done.sigs?.sign && (
              <a href={`https://explorer.solana.com/tx/${done.sigs.sign}`} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 font-plex-mono text-xs text-quantum-cyan hover:underline">view spend <ArrowSquareOut className="h-3 w-3" /></a>
            )}
            <Button onClick={() => onOpenChange(false)} className="mt-2 rounded-none bg-quantum-green font-mono text-black hover:bg-quantum-greenDark" data-testid="transfer-close-btn">Close</Button>
          </div>
        ) : bundle ? (
          <div className="space-y-3">
            <TxProgress steps={bundle.steps} progress={progress} />
            {progress?.failed && (
              <div className="border border-red-400/30 bg-red-400/5 p-3 font-plex-mono text-[11px] text-red-300" data-testid="transfer-failed">
                Nothing was lost. The signed transfer is saved and you can resume it from your wallet with the
                same signature, so no extra key exposure. You can also discard it.
                <Button onClick={() => onOpenChange(false)} className="mt-2 h-8 w-full rounded-none bg-white/10 font-mono text-xs text-white hover:bg-white/20">Close</Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {!isWithdraw && (
              <div>
                <Label className="font-plex-mono text-xs uppercase tracking-wider text-white/60">Recipient Solana address</Label>
                <Input data-testid="send-to-input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Phantom / Solana address"
                  className="mt-1.5 rounded-none border-white/15 bg-black font-plex-mono text-xs" />
                {isAddress(to) && (
                  <div data-testid="send-route-badge" className="mt-2 font-plex-mono text-[11px]">
                    {self ? (
                      <span className="flex items-center gap-1.5 text-quantum-purple"><Wallet className="h-3.5 w-3.5" /> Your own Phantom. This counts as a withdrawal.</span>
                    ) : resolved?.kind === "vault" ? (
                      <span className="flex items-center gap-1.5 text-quantum-green"><Vault weight="fill" className="h-3.5 w-3.5" /> Has a quantum vault, so it arrives vault-to-vault and stays protected</span>
                    ) : resolved?.kind === "wallet" ? (
                      <span className="flex items-center gap-1.5 text-quantum-warning"><Warning className="h-3.5 w-3.5" /> Plain wallet: delivered as native SOL and leaves the quantum layer</span>
                    ) : <span className="text-white/40">checking…</span>}
                  </div>
                )}
              </div>
            )}

            {isWithdraw && (
              <div className="grid grid-cols-2 gap-px border border-white/10 bg-white/10">
                {[[false, "Amount"], [true, "Everything"]].map(([v, l]) => (
                  <button key={l} data-testid={`withdraw-${v ? "all" : "partial"}-tab`} onClick={() => setAll(v)}
                    className={`bg-quantum-ink py-2 font-plex-mono text-xs ${all === v ? "text-quantum-green" : "text-white/40 hover:text-white"}`}>{l}</button>
                ))}
              </div>
            )}

            {!(isWithdraw && all) && (
              <div>
                <div className="flex items-end justify-between">
                  <Label className="font-plex-mono text-xs uppercase tracking-wider text-white/60">Amount (SOL)</Label>
                  <button data-testid="send-max-btn" onClick={() => setAmount(String(spendable))}
                    className="font-plex-mono text-[11px] text-quantum-cyan hover:underline">max {spendable.toFixed(6)}</button>
                </div>
                <Input data-testid="send-amount-input" type="number" step="0.0001" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.10" className="mt-1.5 rounded-none border-white/15 bg-black font-mono text-lg" />
                {amt > 0 && <p className="mt-1 font-plex-mono text-[11px] text-white/40">{usd(amt, usdRate)}</p>}
                {amt > spendable + 1e-12 && <p className="mt-1 font-plex-mono text-[11px] text-red-400">Exceeds your spendable balance</p>}
              </div>
            )}
            {isWithdraw && all && (
              <p className="border border-white/10 bg-black/40 p-3 font-plex-mono text-[11px] leading-relaxed text-white/60">
                Unwraps the whole vault token account straight to your Phantom ({short(me)}), including the account’s rent, in one signed
                instruction. The vault stays open and you can deposit again any time.
              </p>
            )}
            {!isWithdraw && (
              <div>
                <Label className="font-plex-mono text-xs uppercase tracking-wider text-white/60">Note (optional)</Label>
                <Input data-testid="send-memo-input" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={120}
                  placeholder="Rent, dinner, invoice #12…" className="mt-1.5 rounded-none border-white/15 bg-black font-plex-mono text-xs" />
              </div>
            )}

            <div className="border border-white/10 bg-black/40 p-3 font-plex-mono text-[11px] leading-relaxed text-white/50">
              {route === "close" ? "1 transaction" : route === "vault" ? "2 transactions: ensure the recipient account, then the signed spend"
                : "3 transactions: ensure your wSOL account, the signed spend, then unwrap and deliver"}
              {" "}· approve once. Phantom pays the network fees (≈ 0.00001 SOL), so keep a little SOL there.
            </div>

            {needAck && (
              <div className="border border-quantum-warning/40 bg-quantum-warning/5 p-3 font-plex-mono text-[11px] text-quantum-warning" data-testid="key-reuse-warning">
                <p className="flex items-start gap-1.5"><Warning weight="fill" className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {needAck}</p>
                <Button data-testid="ack-key-reuse-btn" onClick={() => submit(true)} disabled={busy}
                  className="mt-2 h-8 rounded-none bg-quantum-warning font-mono text-xs text-black hover:bg-quantum-warning/80">I understand, sign anyway</Button>
              </div>
            )}

            <Button data-testid="send-submit-btn" onClick={() => submit(false)} disabled={!valid || busy || (!isWithdraw && !self && !resolved?.kind)}
              className="btn-sheen h-12 w-full rounded-none bg-quantum-green font-mono font-bold text-black hover:bg-quantum-greenDark disabled:opacity-40">
              {busy ? "Preparing…" : isWithdraw ? (all ? "Withdraw everything" : `Withdraw ${amount || ""} SOL`) : `Sign & send ${amount || ""} SOL`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
