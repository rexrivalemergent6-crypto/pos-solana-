import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Vault, Wallet, CheckCircle, ShieldCheck, ArrowSquareOut, Warning } from "@phosphor-icons/react";
import QuantumBackground from "@/components/QuantumBackground";
import QuantumBanner from "@/components/QuantumBanner";
import api from "@/lib/api";
import { connectPhantom, hasPhantom, isMobile, phantomBrowseUrl } from "@/lib/phantom";
import { depositInto } from "@/components/wallet/DepositDialog";
import { errMsg, short, usd } from "@/lib/format";

export default function Pay() {
  const { address } = useParams();
  const [sp] = useSearchParams();
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState("");
  const [amount, setAmount] = useState(sp.get("amount") || "");
  const memo = sp.get("memo") || "";
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(null);
  const locked = !!sp.get("amount");

  useEffect(() => {
    api.get(`/pay/${address}`).then(({ data }) => setInfo(data)).catch((e) => setErr(errMsg(e, "Invalid address")));
  }, [address]);

  const amt = parseFloat(amount);
  const pay = async () => {
    setPaying(true);
    try {
      const from = await connectPhantom();
      toast.message("Approve in Phantom", { description: `Sending ${amt} SOL into a quantum vault` });
      const sig = await depositInto(address, from, amt, memo);
      setPaid(sig);
      toast.success("Payment confirmed on-chain");
    } catch (e) {
      toast.error(errMsg(e, "Payment failed or cancelled"));
    } finally { setPaying(false); }
  };

  if (err) {
    return <div className="flex min-h-screen items-center justify-center"><p data-testid="pay-error" className="font-plex-mono text-sm text-red-400">{err}</p></div>;
  }
  if (!info) {
    return <div className="flex min-h-screen items-center justify-center"><p className="font-plex-mono text-sm text-quantum-green">resolving vault<span className="cursor-blink">▊</span></p></div>;
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-0 z-0"><QuantumBackground density={50} opacity={0.5} /></div>
      <div className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
        <Link to="/" className="mb-5 flex items-center gap-2 self-center">
          <div className="flex h-7 w-7 items-center justify-center bg-quantum-green"><Vault weight="fill" className="h-4 w-4 text-black" /></div>
          <span className="font-mono text-base font-bold tracking-tighter">QuantumPOS</span>
        </Link>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} data-testid="pay-card"
          className="border border-quantum-green/30 border-t-[3px] border-t-quantum-green bg-black/70 p-6 backdrop-blur-xl">
          <p className="text-center font-plex-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Pay into the quantum vault of</p>
          <p data-testid="pay-recipient" className="mt-1 text-center font-mono text-xl font-bold tracking-tight">{short(address, 6)}</p>
          {info.has_vault && (
            <p className="mt-1 text-center font-plex-mono text-[10px] text-quantum-green">vault {short(info.vault_address, 5)} · key #{info.nonce}</p>
          )}

          {!info.has_vault ? (
            <div className="mt-6 flex items-start gap-2 border border-quantum-warning/30 bg-quantum-warning/5 p-4 font-plex-mono text-xs text-quantum-warning" data-testid="pay-no-vault">
              <Warning weight="fill" className="mt-0.5 h-4 w-4 shrink-0" />
              This address hasn’t opened a quantum vault yet. Ask them to open one at {window.location.host}/app, or send to them directly from your wallet.
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {paid ? (
                <motion.div key="paid" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} data-testid="pay-success"
                  className="mt-6 flex flex-col items-center gap-3 border border-quantum-green/40 bg-quantum-green/10 p-6">
                  <CheckCircle weight="fill" className="h-14 w-14 text-quantum-green" />
                  <p className="font-mono text-lg font-bold text-quantum-green">{amt} SOL delivered</p>
                  <p className="text-center font-plex-mono text-xs text-white/50">Now held behind a one-time Winternitz key.</p>
                  <a href={`https://explorer.solana.com/tx/${paid}`} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 font-plex-mono text-xs text-quantum-cyan hover:underline">view transaction <ArrowSquareOut className="h-3 w-3" /></a>
                </motion.div>
              ) : (
                <motion.div key="form" className="mt-6">
                  <div className="text-center">
                    {locked ? (
                      <div className="font-mono text-5xl font-black tracking-tighter text-quantum-green" data-testid="pay-amount-fixed">{amount} <span className="text-xl text-white/40">SOL</span></div>
                    ) : (
                      <input data-testid="pay-amount-input" type="number" step="0.001" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
                        className="w-full bg-transparent text-center font-mono text-5xl font-black tracking-tighter text-quantum-green outline-none placeholder:text-white/15" />
                    )}
                    <p className="mt-1 font-plex-mono text-xs text-white/40">{amt > 0 ? usd(amt, info.usd_rate) : "SOL"}</p>
                    {memo && <p className="mt-3 font-plex-mono text-sm text-white/60" data-testid="pay-memo">“{memo}”</p>}
                  </div>
                  <Button data-testid="pay-phantom-btn" onClick={pay} disabled={paying || !(amt > 0) || !hasPhantom()}
                    className="btn-sheen mt-6 h-12 w-full rounded-none bg-quantum-purple font-mono font-bold text-white hover:bg-quantum-purple/80 disabled:opacity-40">
                    <Wallet weight="fill" className="mr-2 h-5 w-5" /> {paying ? "Confirm in Phantom…" : "Connect Phantom & pay"}
                  </Button>
                  {!hasPhantom() && isMobile() && (
                    <a href={phantomBrowseUrl()} data-testid="pay-open-in-phantom" className="mt-2 block text-center font-plex-mono text-[11px] text-quantum-green underline">Open this page in the Phantom app</a>
                  )}
                  {!hasPhantom() && !isMobile() && (
                    <a href="https://phantom.app/" target="_blank" rel="noreferrer" className="mt-2 block text-center font-plex-mono text-[11px] text-quantum-purple underline">Install Phantom to pay in-browser</a>
                  )}
                  <p className="mt-3 text-center font-plex-mono text-[10px] leading-relaxed text-white/35">
                    Your SOL is wrapped into the recipient’s vault token account. A small one-time rent (~0.0015 SOL) applies only if that account doesn’t exist yet.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          )}
          <div className="mt-5 flex items-center justify-center gap-1.5 font-plex-mono text-[10px] text-white/30">
            <ShieldCheck weight="fill" className="h-3.5 w-3.5 text-quantum-green" /> Secured by a post-quantum Winternitz vault · <Link to="/docs" className="hover:text-white">docs</Link>
          </div>
        </motion.div>
        <div className="mt-4"><QuantumBanner compact /></div>
      </div>
    </div>
  );
}
