import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import api from "@/lib/api";
import { sendSingle } from "@/lib/solanaClient";
import { errMsg, usd } from "@/lib/format";

export async function depositInto(recipient, payer, amountSol, memo = "") {
  const { data } = await api.post(`/pay/${recipient}/deposit-ixs`, { payer, amount_sol: amountSol });
  const signature = await sendSingle(data.ixs, payer);
  try { await api.post("/deposits/record", { signature, memo }); } catch (_) { /* watcher picks it up */ }
  return signature;
}

export default function DepositDialog({ open, onOpenChange, me, usdRate, onDone }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setAmount(""); setBusy(false); } }, [open]);
  const amt = parseFloat(amount);

  const go = async () => {
    setBusy(true);
    try {
      toast.message("Approve in Phantom", { description: `Wrapping ${amt} SOL into your quantum vault` });
      await depositInto(me, me, amt);
      toast.success(`Deposited ${amt} SOL`);
      onDone?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(errMsg(e, "Deposit failed"));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-sm rounded-none border-white/10 bg-quantum-ink" data-testid="deposit-dialog">
        <DialogHeader>
          <DialogTitle className="font-mono tracking-tight">Deposit from Phantom</DialogTitle>
          <DialogDescription className="font-plex-mono text-xs text-white/50">
            Moves SOL from your Ed25519 wallet into your Winternitz vault.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-4 gap-px border border-white/10 bg-white/10">
          {[0.05, 0.1, 0.5, 1].map((v) => (
            <button key={v} data-testid={`deposit-preset-${v}`} onClick={() => setAmount(String(v))}
              className={`bg-quantum-ink py-2 font-plex-mono text-xs ${amount === String(v) ? "text-quantum-green" : "text-white/50 hover:text-white"}`}>{v}</button>
          ))}
        </div>
        <Input data-testid="deposit-amount-input" type="number" step="0.001" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount in SOL" className="rounded-none border-white/15 bg-black font-mono text-lg" />
        {amt > 0 && <p className="-mt-2 font-plex-mono text-[11px] text-white/40">{usd(amt, usdRate)}</p>}
        <Button data-testid="deposit-submit-btn" onClick={go} disabled={!(amt > 0) || busy}
          className="btn-sheen h-11 rounded-none bg-quantum-green font-mono font-bold text-black hover:bg-quantum-greenDark disabled:opacity-40">
          {busy ? "Confirm in Phantom…" : `Deposit ${amount || ""} SOL`}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
