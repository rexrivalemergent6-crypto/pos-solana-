import { CheckCircle, CircleNotch, Circle, XCircle } from "@phosphor-icons/react";
import SignatureAnimation from "@/components/SignatureAnimation";

/** Step-by-step progress for a multi-transaction bundle. progress = { phase, step, index, failed } */
export default function TxProgress({ steps, progress }) {
  if (!steps?.length) return null;
  const idx = progress?.index ?? -1;
  const signing = progress?.phase === "send" && progress?.step === "sign";
  return (
    <div data-testid="tx-progress" className="space-y-3">
      {progress?.phase === "approve" && (
        <p className="border border-quantum-purple/40 bg-quantum-purple/5 p-3 text-center font-plex-mono text-xs text-quantum-purple">
          Approve {steps.length > 1 ? `all ${steps.length} transactions` : "the transaction"} in Phantom…
        </p>
      )}
      <ol className="space-y-1.5">
        {steps.map((s, i) => {
          let state = "wait";
          if (progress?.failed === s.name) state = "fail";
          else if (i < idx || (i === idx && progress?.phase === "confirmed") || progress?.phase === "done") state = "done";
          else if (i === idx) state = "run";
          return (
            <li key={s.name} data-testid={`tx-step-${s.name}`}
              className="flex items-center gap-2.5 border border-white/10 bg-black/40 px-3 py-2 font-plex-mono text-xs">
              {state === "done" && <CheckCircle weight="fill" className="h-4 w-4 text-quantum-green" />}
              {state === "run" && <CircleNotch className="h-4 w-4 animate-spin text-quantum-cyan" />}
              {state === "wait" && <Circle className="h-4 w-4 text-white/25" />}
              {state === "fail" && <XCircle weight="fill" className="h-4 w-4 text-red-400" />}
              <span className={state === "wait" ? "text-white/40" : "text-white/80"}>{i + 1}. {s.label}</span>
            </li>
          );
        })}
      </ol>
      {(signing || (progress?.phase === "confirmed" && progress?.step === "sign")) && (
        <div className="border border-quantum-cyan/30 bg-black p-3">
          <SignatureAnimation phase={signing ? "signing" : "done"} />
        </div>
      )}
    </div>
  );
}
