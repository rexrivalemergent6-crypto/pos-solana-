import { motion } from "framer-motion";
import { Wallet, Vault, Key, ArrowsClockwise, PaperPlaneTilt, HandCoins } from "@phosphor-icons/react";

export const STEPS = [
  { n: "01", icon: Vault, t: "Open your vault", d: "We generate a Winternitz key and derive a permanent vault address from its hash. Phantom pays a one-time rent of under 0.003 SOL to create it on mainnet." },
  { n: "02", icon: HandCoins, t: "Receive into it", d: "Anyone can pay you through your link or QR code. The SOL is wrapped into the vault's token account, and only a Winternitz signature can ever move it." },
  { n: "03", icon: Key, t: "Sign once", d: "To send, a one-time signature covers the nonce, source, destination, amount and the hash of the next key. Change any byte and the program rejects it." },
  { n: "04", icon: ArrowsClockwise, t: "Key rotates in place", d: "The vault swaps to the next key in the same instruction. Your address never changes, and every old signature stops working for good." },
  { n: "05", icon: PaperPlaneTilt, t: "Deliver", d: "Send to another vault and the SOL stays quantum-protected. Send to a plain wallet and it is unwrapped and delivered as native SOL." },
];

export function HowItWorksSteps() {
  return (
    <div className="grid grid-cols-1 gap-px border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-5">
      {STEPS.map((s, i) => (
        <motion.div key={s.n} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.07 * i }} className="bg-quantum-ink p-5" data-testid={`how-step-${s.n}`}>
          <div className="flex items-center justify-between">
            <span className="font-mono text-3xl font-black tracking-tighter text-white/15">{s.n}</span>
            <s.icon weight="duotone" className="h-6 w-6 text-quantum-green" />
          </div>
          <h3 className="mt-3 font-mono text-sm font-bold tracking-tight text-quantum-green">{s.t}</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-white/50">{s.d}</p>
        </motion.div>
      ))}
    </div>
  );
}

/** Animated transaction-flow diagram: Phantom -> vault -> WOTS sign+rotate -> recipient. */
export function FlowDiagram() {
  const nodes = [
    { icon: Wallet, label: "Phantom", sub: "Pays fees", c: "text-quantum-purple border-quantum-purple/40" },
    { icon: Vault, label: "Your vault", sub: "Wrapped SOL, PDA", c: "text-quantum-green border-quantum-green/40" },
    { icon: Key, label: "WOTS spend", sub: "816-byte signature", c: "text-quantum-cyan border-quantum-cyan/40" },
    { icon: Vault, label: "Recipient vault", sub: "or native wallet", c: "text-quantum-green border-quantum-green/40" },
  ];
  return (
    <div data-testid="flow-diagram" className="relative overflow-hidden border border-white/10 bg-black p-5 sm:p-8">
      <div className="pointer-events-none absolute inset-0 grid-tech opacity-30" />
      <div className="relative grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-0">
        {nodes.map((n, i) => (
          <div key={n.label} className="relative flex flex-col items-center text-center">
            <motion.div initial={{ scale: 0.8, opacity: 0 }} whileInView={{ scale: 1, opacity: 1 }} viewport={{ once: true }}
              transition={{ delay: i * 0.15 }}
              className={`flex h-14 w-14 items-center justify-center border bg-quantum-ink ${n.c}`}>
              <n.icon weight="duotone" className="h-7 w-7" />
            </motion.div>
            <p className="mt-3 font-mono text-xs font-bold">{n.label}</p>
            <p className="font-plex-mono text-[10px] text-white/40">{n.sub}</p>
            {i < nodes.length - 1 && (
              <div className="absolute left-[calc(50%+36px)] top-7 hidden h-px w-[calc(100%-72px)] overflow-hidden bg-white/10 sm:block">
                <motion.div className="h-px w-10 bg-gradient-to-r from-transparent via-quantum-green to-transparent"
                  animate={{ x: ["-40px", "240px"] }} transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.4, ease: "linear" }} />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="relative mt-6 grid grid-cols-1 gap-2 font-plex-mono text-[11px] text-white/50 sm:grid-cols-3">
        <p><span className="text-quantum-green">nonce n</span> → sign(keccak(“WNTR:XFER” | vault | n | src | dst | amt | pkₙ₊₁))</p>
        <p className="sm:text-center"><span className="text-quantum-cyan">verify</span>: 34 chains walked, hash == pkₙ</p>
        <p className="sm:text-right"><span className="text-quantum-warning">rotate</span>: pk ← pkₙ₊₁, nonce ← n+1</p>
      </div>
    </div>
  );
}
