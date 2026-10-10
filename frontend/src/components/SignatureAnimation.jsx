import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, Lightning } from "@phosphor-icons/react";

const HEX = "0123456789abcdef";
const randHex = (n) => Array.from({ length: n }, () => HEX[Math.floor(Math.random() * 16)]).join("");

// Visualises the 34 Winternitz (WOTS) hash chains being signed with one-time
// Keccak-256 reveals. phase: "signing" | "broadcasting" | "done".
export default function SignatureAnimation({ phase = "signing", caption }) {
  const [active, setActive] = useState(0);
  const [ticks, setTicks] = useState(0);
  const timer = useRef(null);

  useEffect(() => {
    if (phase === "signing") {
      timer.current = setInterval(() => {
        setActive((a) => (a < 34 ? a + 1 : a));
        setTicks((t) => t + 1);
      }, 60);
    } else {
      setActive(34);
    }
    return () => clearInterval(timer.current);
  }, [phase]);

  return (
    <div className="w-full" data-testid="signature-animation">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-quantum-cyan">
          <Lightning weight="fill" className="h-4 w-4" />
          Winternitz OTS · 32 + 2 checksum chains
        </div>
        <span className="font-plex-mono text-xs text-quantum-green">
          {Math.min(active, 34)}/34
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {Array.from({ length: 34 }).map((_, i) => {
          const done = i < active;
          const current = i === active - 1 && phase === "signing";
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0.25 }}
              animate={{ opacity: done ? 1 : 0.25 }}
              className="relative overflow-hidden border p-2"
              style={{
                borderColor: done ? "#14F19555" : "#222",
                background: done ? "rgba(20,241,149,0.06)" : "transparent",
              }}
            >
              <div className="mb-1 font-plex-mono text-[9px] text-quantum-green/70">
                #{i.toString().padStart(2, "0")}
              </div>
              <div className="font-plex-mono text-[9px] leading-tight text-white/60 break-all h-6">
                {done ? randHex(8) : "········"}
              </div>
              {current && (
                <motion.div
                  layoutId="sweep"
                  className="absolute inset-x-0 bottom-0 h-[2px] bg-quantum-green"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 0.4, repeat: Infinity }}
                />
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="mt-5 min-h-[20px] text-center font-plex-mono text-xs text-white/70">
        <AnimatePresence mode="wait">
          {phase === "signing" && (
            <motion.span key="s" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              Revealing one-time private scalars → recovering 896-byte public commitment
              <span className="cursor-blink text-quantum-green">▊</span>
            </motion.span>
          )}
          {phase === "broadcasting" && (
            <motion.span key="b" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="text-quantum-cyan">
              Broadcasting Close Vault to Solana mainnet… awaiting confirmation
              <span className="cursor-blink">▊</span>
            </motion.span>
          )}
          {phase === "done" && (
            <motion.span key="d" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-center gap-2 text-quantum-green">
              <CheckCircle weight="fill" className="h-4 w-4" />
              Vault closed · SOL swept to payout wallet · key retired
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {caption && <p className="mt-2 text-center text-[11px] text-white/35">{caption}</p>}
    </div>
  );
}
