import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Vault, LinkSimple, Warning } from "@phosphor-icons/react";
import { short } from "@/lib/format";

function CopyRow({ label, value, testid, display }) {
  return (
    <div>
      <p className="font-plex-mono text-[10px] uppercase tracking-widest text-white/40">{label}</p>
      <button data-testid={testid} onClick={() => { navigator.clipboard.writeText(value); toast.success("Copied"); }}
        className="mt-1 flex w-full items-center justify-between gap-2 border border-white/15 bg-black px-3 py-2 text-left font-plex-mono text-xs text-white/80 hover:border-quantum-green/50">
        <span className="truncate">{display || value}</span> <Copy className="h-3.5 w-3.5 shrink-0 text-white/40" />
      </button>
    </div>
  );
}

export default function ReceiveDialog({ open, onOpenChange, me, vault }) {
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  useEffect(() => { if (open) { setAmount(""); setMemo(""); } }, [open]);
  const params = new URLSearchParams();
  if (parseFloat(amount) > 0) params.set("amount", amount);
  if (memo) params.set("memo", memo);
  const link = `${window.location.origin}/pay/${me}${params.toString() ? `?${params}` : ""}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto rounded-none border-white/10 bg-quantum-ink" data-testid="receive-dialog">
        <DialogHeader>
          <DialogTitle className="font-mono tracking-tight">Receive SOL</DialogTitle>
          <DialogDescription className="font-plex-mono text-xs text-white/50">
            In the app, people pay your <b className="text-white">Phantom address</b>. Outside it, share your pay link. Either way the SOL lands in your vault.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="mx-auto w-fit border border-quantum-green/40 bg-white p-3" data-testid="receive-qr">
            <QRCodeSVG value={link} size={180} fgColor="#0a0a0a" level="M" />
          </div>
          <p className="-mt-2 text-center font-plex-mono text-[10px] uppercase tracking-widest text-white/40">Scan to open your pay link</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="font-plex-mono text-[10px] uppercase tracking-widest text-white/40">Request amount</Label>
              <Input data-testid="receive-amount-input" type="number" step="0.001" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="optional" className="mt-1 rounded-none border-white/15 bg-black font-mono" />
            </div>
            <div>
              <Label className="font-plex-mono text-[10px] uppercase tracking-widest text-white/40">Note</Label>
              <Input data-testid="receive-memo-input" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={80}
                placeholder="optional" className="mt-1 rounded-none border-white/15 bg-black font-plex-mono text-xs" />
            </div>
          </div>
          <CopyRow label="Pay link" value={link} testid="copy-pay-link" display={<span className="flex items-center gap-1.5"><LinkSimple className="h-3.5 w-3.5 text-quantum-green" />{link.replace(/^https?:\/\//, "").slice(0, 44)}…</span>} />
          <CopyRow label="Your address (for in-app senders)" value={me} testid="copy-my-address" />
          <div className="border border-white/10 bg-black/40 p-3 font-plex-mono text-[11px] leading-relaxed text-white/50">
            <p className="flex items-center gap-1.5 text-quantum-green"><Vault weight="fill" className="h-3.5 w-3.5" /> Vault {short(vault?.address, 6)} · permanent address</p>
            <p className="mt-1.5 flex items-start gap-1.5 text-quantum-warning"><Warning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Don’t send SOL straight to the vault PDA from another wallet: the program can’t move SOL held directly on the PDA. The pay link handles it
              by depositing into the vault’s wrapped-SOL account ({short(vault?.token_account, 5)}).</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
