import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Wallet, Vault, ArrowRight, GithubLogo, ShieldWarning, TreeStructure, Key, Atom, XLogo,
  ArrowsClockwise, PaperPlaneTilt, BookOpenText, Fingerprint,
} from "@phosphor-icons/react";
import QuantumBackground from "@/components/QuantumBackground";
import QuantumBanner from "@/components/QuantumBanner";
import { HowItWorksSteps, FlowDiagram } from "@/components/HowItWorks";
import { useAuth } from "@/context/AuthContext";
import { isMobile, phantomBrowseUrl } from "@/lib/phantom";
import { ConfigContext } from "@/App";

const FEATURES = [
  { icon: Vault, title: "One permanent vault", body: "Your vault address is derived from your first key's hash and never changes. Share it once and receive into it forever." },
  { icon: ArrowsClockwise, title: "Keys rotate on every spend", body: "Each transfer is authorised by a one-time Winternitz signature that also commits to the next key. Old signatures stop working instantly." },
  { icon: PaperPlaneTilt, title: "Send to any Solana address", body: "Recipients with a vault receive vault-to-vault, so the SOL stays quantum-protected. Any other address receives native SOL." },
];

const TECH = [
  { icon: ShieldWarning, title: "The quantum threat", body: "Shor's algorithm recovers an Ed25519 private key from its public key, and every Solana wallet reveals its public key the first time it signs. So data harvested today can be cracked later." },
  { icon: Atom, title: "Hash-based, not curve-based", body: "Winternitz signatures rely only on Keccak-256 preimage resistance. The 24-byte chains give about 192-bit classical and 96-bit quantum security, and Grover's algorithm only halves the exponent." },
  { icon: Fingerprint, title: "Checksum-hardened WOTS", body: "There are 32 message chains plus 2 checksum chains. Raising any message byte lowers the checksum, so a forger would have to walk a hash chain backwards, which can't be done." },
  { icon: TreeStructure, title: "The address is a commitment", body: "The vault PDA is [\"vault\", first_pk_hash]. The address you share is a cryptographic commitment to the key that opened it." },
  { icon: Key, title: "Everything is in the digest", body: "Nonce, source, destination, amount and next key are all hashed before signing. A signature authorises exactly one transfer of exactly one shape." },
  { icon: Vault, title: "Honest scope", body: "The vault program is open source and live on mainnet, and it is upgradeable. Your one-time keys are held encrypted on our server. The fee payer, Phantom, still uses Ed25519. This is research-grade software." },
];

export default function Landing() {
  const { login, connecting, hasPhantom, user } = useAuth();
  const navigate = useNavigate();
  const [err, setErr] = useState("");
  const cfg = ConfigContext.current;

  const handleConnect = async () => {
    setErr("");
    try {
      await login();
      toast.success("Wallet verified — welcome to the quantum layer");
      navigate("/app");
    } catch (e) {
      setErr(e?.message || "Connection failed");
      toast.error(e?.message || "Connection failed");
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-0 z-0 opacity-70"><QuantumBackground density={70} opacity={0.6} /></div>
      <div className="pointer-events-none absolute inset-0 z-0 grid-tech opacity-40" />

      <div className="relative z-10 mx-auto max-w-6xl px-5 py-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center bg-quantum-green">
              <Vault weight="fill" className="h-5 w-5 text-black" />
            </div>
            <span className="font-mono text-lg font-bold tracking-tighter">QuantumPOS</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/docs" data-testid="landing-docs-link"
              className="flex items-center gap-1.5 font-plex-mono text-xs text-white/60 transition-colors hover:text-quantum-green">
              <BookOpenText className="h-4 w-4" /> docs
            </Link>
            <a href="https://github.com/rabb757/winternitz-vault" target="_blank" rel="noreferrer"
              className="hidden items-center gap-1.5 font-plex-mono text-xs text-white/50 transition-colors hover:text-quantum-green sm:flex">
              <GithubLogo className="h-4 w-4" /> vault program
            </a>
            <a data-testid="landing-x-link" href="https://x.com/tryquantumpos" target="_blank" rel="noreferrer" aria-label="QuantumPOS on X"
              className="flex items-center gap-1.5 border border-white/15 px-3 py-1.5 font-plex-mono text-xs text-white/70 transition-colors hover:border-white/40 hover:text-white">
              <XLogo weight="bold" className="h-4 w-4" /> <span className="hidden sm:inline">@tryquantumpos</span>
            </a>
          </div>
        </header>

        <div className="flex flex-col justify-center py-16">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="max-w-3xl">
            <div className="mb-5 inline-flex items-center gap-2 border border-quantum-purple/40 bg-quantum-purple/5 px-3 py-1 font-plex-mono text-[11px] uppercase tracking-[0.2em] text-quantum-purple">
              <span className="h-1.5 w-1.5 rounded-full bg-quantum-purple" /> Solana {cfg?.cluster || "mainnet-beta"} · live
            </div>
            <h1 className="font-mono text-5xl font-black leading-[0.95] tracking-tighter sm:text-6xl">
              The quantum-safe<br />
              <span className="text-quantum-green">transaction layer</span><br />
              for Solana.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-white/60">
              Send and receive SOL through Winternitz vaults. Your funds sit behind a one-time,
              hash-based signature that a quantum computer can’t forge, and the key rotates on every
              transfer. Recipients are just Solana addresses.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {user ? (
                <Button data-testid="open-wallet-btn" onClick={() => navigate("/app")}
                  className="btn-sheen group h-12 rounded-none bg-quantum-green px-7 font-mono text-sm font-bold text-black transition-transform hover:-translate-y-0.5 hover:bg-quantum-greenDark">
                  Open my vault <ArrowRight weight="bold" className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Button>
              ) : (
                <Button data-testid="phantom-connect-btn" onClick={handleConnect} disabled={connecting}
                  className="btn-sheen group h-12 rounded-none bg-quantum-green px-7 font-mono text-sm font-bold text-black transition-transform hover:-translate-y-0.5 hover:bg-quantum-greenDark">
                  <Wallet weight="fill" className="mr-2 h-4 w-4" />
                  {connecting ? "Awaiting signature…" : "Connect Phantom"}
                </Button>
              )}
              <Button data-testid="how-it-works-btn" variant="outline"
                onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}
                className="h-12 rounded-none border-quantum-purple/50 bg-quantum-purple/5 px-6 font-mono text-sm font-bold text-quantum-purple transition-transform hover:-translate-y-0.5 hover:bg-quantum-purple/10">
                How it works
              </Button>
            </div>
            {!hasPhantom && isMobile() && (
              <a href={phantomBrowseUrl()} data-testid="open-in-phantom-link"
                className="mt-3 inline-block font-plex-mono text-xs text-quantum-green underline underline-offset-4">Open in Phantom app →</a>
            )}
            {!hasPhantom && !isMobile() && (
              <a href="https://phantom.app/" target="_blank" rel="noreferrer" data-testid="install-phantom-link"
                className="mt-3 inline-block font-plex-mono text-xs text-quantum-purple underline underline-offset-4">Phantom not detected — install it →</a>
            )}
            {err && <p data-testid="landing-error" className="mt-3 font-plex-mono text-xs text-red-400">{err}</p>}
          </motion.div>

          <div className="mt-16 grid grid-cols-1 gap-px border border-white/10 bg-white/10 sm:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.div key={f.title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.1 * i }} className="bg-quantum-ink p-6">
                <f.icon weight="duotone" className="h-7 w-7 text-quantum-green" />
                <h3 className="mt-4 font-mono text-sm font-bold tracking-tight">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/50">{f.body}</p>
              </motion.div>
            ))}
          </div>
          <div className="mt-8"><QuantumBanner /></div>
        </div>

        <section id="how-it-works" className="scroll-mt-6 border-t border-white/10 py-16" data-testid="how-it-works-section">
          <p className="font-plex-mono text-[11px] uppercase tracking-[0.2em] text-quantum-green">// how it works</p>
          <h2 className="mt-3 max-w-2xl font-mono text-3xl font-bold tracking-tighter sm:text-4xl">
            One vault. One-time keys. Every transfer rotates.
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/50">
            Each transfer runs in three steps, and you approve all of them once in Phantom. First we
            make sure the destination exists. Then the vault checks a Winternitz signature and moves
            the SOL. Finally the SOL is delivered as native SOL if the recipient is a plain wallet.
          </p>
          <div className="mt-8"><FlowDiagram /></div>
          <div className="mt-8"><HowItWorksSteps /></div>
        </section>

        <section className="border-t border-white/10 py-16">
          <div className="mb-10 max-w-2xl">
            <p className="font-plex-mono text-[11px] uppercase tracking-[0.2em] text-quantum-cyan">// why this matters</p>
            <h2 className="mt-3 font-mono text-3xl font-bold tracking-tighter sm:text-4xl">Post-quantum security, without waiting for the base layer.</h2>
          </div>
          <div className="grid grid-cols-1 gap-px border border-white/10 bg-white/10 md:grid-cols-2 lg:grid-cols-3">
            {TECH.map((t, i) => (
              <motion.div key={t.title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                transition={{ duration: 0.45, delay: 0.05 * i }} className="bg-quantum-ink p-6">
                <t.icon weight="duotone" className="h-6 w-6 text-quantum-cyan" />
                <h3 className="mt-4 font-mono text-sm font-bold tracking-tight">{t.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-white/50">{t.body}</p>
              </motion.div>
            ))}
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Button data-testid="read-docs-btn" onClick={() => navigate("/docs")}
              className="btn-sheen group h-12 rounded-none bg-quantum-green px-7 font-mono text-sm font-bold text-black hover:bg-quantum-greenDark">
              Read the research <BookOpenText weight="bold" className="ml-2 h-4 w-4" />
            </Button>
            <span className="font-plex-mono text-xs text-white/40">Program source, byte layouts, test vectors and threat model.</span>
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 py-8 font-plex-mono text-[11px] text-white/30">
          <span>QuantumPOS · Solana {cfg?.cluster || "mainnet-beta"} · vault program <span className="text-white/50">{(cfg?.program_id || "13Etnf").slice(0, 6)}…QUANT</span> · research-grade</span>
          <Link to="/docs" className="hover:text-quantum-green">/docs</Link>
        </footer>
      </div>
    </div>
  );
}
