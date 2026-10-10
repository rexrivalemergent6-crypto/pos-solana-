import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  PaperPlaneTilt, QrCode, ArrowDownLeft, ArrowLineUp, Copy, ArrowSquareOut, Vault, Wallet as WalletIcon, ArrowClockwise, ShieldCheck,
} from "@phosphor-icons/react";
import Header from "@/components/Header";
import QuantumBanner from "@/components/QuantumBanner";
import SendDialog from "@/components/wallet/SendDialog";
import ReceiveDialog from "@/components/wallet/ReceiveDialog";
import DepositDialog from "@/components/wallet/DepositDialog";
import { CreateVault, PendingBanner, ActivityList, KeyChain } from "@/components/wallet/WalletPanels";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { short, usd } from "@/lib/format";
import { isMobile, phantomBrowseUrl } from "@/lib/phantom";

function Action({ icon: Icon, label, onClick, testid, primary }) {
  return (
    <button data-testid={testid} onClick={onClick}
      className={`group flex flex-col items-center gap-2 border px-3 py-4 font-mono text-xs font-bold transition-all hover:-translate-y-0.5 ${
        primary ? "border-quantum-green bg-quantum-green text-black hover:bg-quantum-greenDark" : "border-white/15 bg-black/40 text-white hover:border-quantum-green/60"}`}>
      <Icon weight="bold" className="h-5 w-5" /> {label}
    </button>
  );
}

export default function Wallet() {
  const { user, login, connecting, hasPhantom } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [activity, setActivity] = useState([]);
  const [keys, setKeys] = useState([]);
  const [dlg, setDlg] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (!user) return;
    if (manual) setRefreshing(true);
    try {
      const [v, a, k] = await Promise.all([api.get("/vault"), api.get("/activity"), api.get("/vault/keys")]);
      setData(v.data); setActivity(a.data); setKeys(k.data);
    } catch (e) {
      if (manual) toast.error("Could not refresh");
    } finally { setRefreshing(false); }
  }, [user]);

  useEffect(() => {
    load();
    const t = setInterval(() => load(), 20000);
    return () => clearInterval(t);
  }, [load]);

  if (!user) {
    return (
      <div className="min-h-screen">
        <Header />
        <div className="mx-auto flex max-w-md flex-col items-center px-5 py-24 text-center">
          <div className="flex h-14 w-14 items-center justify-center bg-quantum-green"><Vault weight="fill" className="h-8 w-8 text-black" /></div>
          <h1 className="mt-6 font-mono text-3xl font-bold tracking-tighter">Connect to your vault</h1>
          <p className="mt-3 text-sm text-white/50">Sign in with Phantom. Your Phantom address is your identity, and people send to it.</p>
          <Button data-testid="wallet-connect-btn" disabled={connecting} onClick={() => login().catch((e) => toast.error(e.message))}
            className="btn-sheen mt-6 h-12 w-full rounded-none bg-quantum-green font-mono font-bold text-black hover:bg-quantum-greenDark">
            <WalletIcon weight="fill" className="mr-2 h-5 w-5" /> {connecting ? "Awaiting signature…" : "Connect Phantom"}
          </Button>
          {!hasPhantom && isMobile() && <a href={phantomBrowseUrl()} className="mt-3 font-plex-mono text-xs text-quantum-green underline">Open in Phantom app →</a>}
          <button onClick={() => navigate("/docs")} className="mt-4 font-plex-mono text-xs text-white/40 hover:text-white">How does it work? →</button>
        </div>
      </div>
    );
  }

  const v = data?.vault;
  const open = v?.status === "open";
  const rate = data?.usd_rate;

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-6xl space-y-5 px-3 py-6 sm:px-5">
        {!data ? (
          <p className="py-24 text-center font-plex-mono text-sm text-quantum-green">reading vault from mainnet<span className="cursor-blink">▊</span></p>
        ) : !open ? (
          <CreateVault me={user.address} onDone={() => load()} />
        ) : (
          <>
            <PendingBanner me={user.address} pending={data.pending_transfer} undelivered={data.undelivered_transfer} onChange={() => load()} />

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} data-testid="balance-card"
                className="relative overflow-hidden border border-quantum-green/30 bg-gradient-to-br from-quantum-green/10 via-black to-black p-6 lg:col-span-2">
                <div className="pointer-events-none absolute inset-0 grid-tech opacity-25" />
                <div className="relative">
                  <div className="flex items-start justify-between gap-3">
                    <p className="flex items-center gap-1.5 font-plex-mono text-[11px] uppercase tracking-[0.2em] text-quantum-green">
                      <ShieldCheck weight="fill" className="h-4 w-4" /> Quantum vault balance
                    </p>
                    <button data-testid="refresh-btn" onClick={() => load(true)} className="text-white/40 hover:text-white" aria-label="Refresh">
                      <ArrowClockwise className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span data-testid="vault-balance" className="font-mono text-5xl font-black tracking-tighter sm:text-6xl">{v.spendable_sol.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                    <span className="font-mono text-xl text-white/40">SOL</span>
                  </div>
                  <p className="mt-1 font-plex-mono text-xs text-white/40">{usd(v.spendable_sol, rate)}</p>

                  <div className="mt-6 grid grid-cols-4 gap-2">
                    <Action icon={PaperPlaneTilt} label="Send" testid="action-send" primary onClick={() => setDlg("send")} />
                    <Action icon={QrCode} label="Receive" testid="action-receive" onClick={() => setDlg("receive")} />
                    <Action icon={ArrowDownLeft} label="Deposit" testid="action-deposit" onClick={() => setDlg("deposit")} />
                    <Action icon={ArrowLineUp} label="Withdraw" testid="action-withdraw" onClick={() => setDlg("withdraw")} />
                  </div>
                </div>
              </motion.section>

              <section className="space-y-3 border border-white/10 bg-quantum-ink p-5" data-testid="vault-details">
                <p className="font-plex-mono text-[11px] uppercase tracking-[0.2em] text-white/50">Vault</p>
                {[
                  ["Vault PDA", v.address, v.explorer, "vault-address"],
                  ["wSOL account", v.token_account, v.explorer_token, "vault-token-account"],
                  ["Your identity", user.address, null, "my-address"],
                ].map(([l, a, ex, tid]) => (
                  <div key={l}>
                    <p className="font-plex-mono text-[10px] text-white/35">{l}</p>
                    <div className="flex items-center gap-2">
                      <button data-testid={`copy-${tid}`} onClick={() => { navigator.clipboard.writeText(a); toast.success("Copied"); }}
                        className="flex items-center gap-1.5 font-plex-mono text-xs text-white/80 hover:text-quantum-green">{short(a, 6)} <Copy className="h-3 w-3" /></button>
                      {ex && <a href={ex} target="_blank" rel="noreferrer" className="text-white/30 hover:text-quantum-cyan"><ArrowSquareOut className="h-3 w-3" /></a>}
                    </div>
                  </div>
                ))}
                <div className="grid grid-cols-3 gap-px border border-white/10 bg-white/10 text-center">
                  {[["Live key", `#${v.nonce}`], ["Sent", data.stats.sent_sol.toFixed(3)], ["Received", data.stats.received_sol.toFixed(3)]].map(([l, val]) => (
                    <div key={l} className="bg-black/60 px-2 py-2">
                      <p className="font-mono text-sm font-bold text-quantum-cyan">{val}</p>
                      <p className="font-plex-mono text-[9px] uppercase tracking-widest text-white/35">{l}</p>
                    </div>
                  ))}
                </div>
                {v.key_exposed && (
                  <p className="font-plex-mono text-[10px] text-quantum-warning" data-testid="key-exposed-flag">⚠ The current key signed a discarded transfer. Move your funds soon.</p>
                )}
              </section>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              <div className="lg:col-span-2"><ActivityList items={activity} /></div>
              <KeyChain keys={keys} />
            </div>
            <QuantumBanner />

            <SendDialog open={dlg === "send"} onOpenChange={(o) => setDlg(o ? "send" : null)} me={user.address} vault={v} usdRate={rate} onDone={() => load()} />
            <SendDialog open={dlg === "withdraw"} onOpenChange={(o) => setDlg(o ? "withdraw" : null)} me={user.address} vault={v} usdRate={rate} mode="withdraw" onDone={() => load()} />
            <ReceiveDialog open={dlg === "receive"} onOpenChange={(o) => setDlg(o ? "receive" : null)} me={user.address} vault={v} />
            <DepositDialog open={dlg === "deposit"} onOpenChange={(o) => setDlg(o ? "deposit" : null)} me={user.address} usdRate={rate} onDone={() => load()} />
          </>
        )}
      </main>
    </div>
  );
}
