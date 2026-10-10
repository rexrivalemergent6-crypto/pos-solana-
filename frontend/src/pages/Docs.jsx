import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GithubLogo, ArrowSquareOut, BookOpenText, Warning, CheckCircle } from "@phosphor-icons/react";
import Header from "@/components/Header";
import { HowItWorksSteps, FlowDiagram } from "@/components/HowItWorks";

const PROGRAM = "13EtnfYGUH8NaGAnUpDTVgSsXoewNnULp7ESwHzQUANT";

const TOC = [
  ["overview", "Overview"],
  ["threat", "The quantum threat"],
  ["wots", "Winternitz signatures"],
  ["program", "The vault program"],
  ["layer", "How the layer uses it"],
  ["how", "How it works"],
  ["verification", "What we verified"],
  ["security", "Security model & limits"],
  ["references", "Research & references"],
];

const REFS = [
  ["rabb757/winternitz-vault", "Source of the mainnet program at 13Etnf…QUANT: Rust program, TypeScript signer, shared test vector.", "https://github.com/rabb757/winternitz-vault"],
  ["Program on Solana Explorer", "The live upgradeable BPF program this app calls.", `https://explorer.solana.com/address/${PROGRAM}`],
  ["deanmlittle/solana-winternitz-vault", "Dean Little's original Winternitz vault (Open / Split / Close, lamports-only). This is the prior art.", "https://github.com/deanmlittle/solana-winternitz-vault"],
  ["blueshift-gg/solana-winternitz-vault", "Blueshift's maintained version of the original vault.", "https://github.com/blueshift-gg/solana-winternitz-vault"],
  ["Blueshift: Quantum-proofing Solana", "Background research on opt-in hash-based vaults for Solana.", "https://blueshift.gg/research/quantum-proofing-solana"],
  ["winternitz.io", "Project site and audit receipts for the mainnet program.", "https://winternitz.io/"],
  ["R. Merkle, A Certified Digital Signature (1979)", "Origin of one-time hash signatures and the Winternitz improvement.", "https://link.springer.com/chapter/10.1007/0-387-34805-0_21"],
  ["RFC 8391: XMSS", "The standardised WOTS+ / XMSS construction and its security analysis.", "https://datatracker.ietf.org/doc/html/rfc8391"],
  ["NIST SP 800-208", "NIST recommendation for stateful hash-based signatures (LMS / XMSS).", "https://csrc.nist.gov/pubs/sp/800/208/final"],
  ["FIPS 205: SLH-DSA (SPHINCS+)", "NIST's stateless hash-based signature standard. It sets the 128-bit level-1 bar this program's 192-bit chains exceed.", "https://csrc.nist.gov/pubs/fips/205/final"],
  ["P. Shor (1994)", "Polynomial-time factoring and discrete logs, the attack on Ed25519.", "https://arxiv.org/abs/quant-ph/9508027"],
  ["L. Grover (1996)", "Quadratic speed-up for search, the only generic attack on hash preimages.", "https://arxiv.org/abs/quant-ph/9605043"],
  ["Solana: Program Derived Addresses", "How a vault address is derived from its first key hash.", "https://solana.com/docs/core/pda"],
  ["SPL Token: wrapped SOL", "Native mint, SyncNative and CloseAccount, used to hold SOL inside the vault.", "https://spl.solana.com/token#wrapping-sol"],
];

function Code({ children }) {
  return <pre className="overflow-x-auto border border-white/10 bg-black p-4 font-plex-mono text-[12px] leading-relaxed text-white/70">{children}</pre>;
}
function H2({ id, kicker, children }) {
  return (
    <div id={id} className="scroll-mt-24">
      <p className="font-plex-mono text-[11px] uppercase tracking-[0.2em] text-quantum-green">// {kicker}</p>
      <h2 className="mt-2 font-mono text-2xl font-bold tracking-tighter sm:text-3xl">{children}</h2>
    </div>
  );
}
const P = ({ children }) => <p className="text-sm leading-relaxed text-white/60">{children}</p>;
const B = ({ children }) => <b className="text-white">{children}</b>;
const C = ({ children }) => <code className="bg-white/5 px-1 font-plex-mono text-[12px] text-quantum-cyan">{children}</code>;

function Table({ head, rows }) {
  return (
    <div className="overflow-x-auto border border-white/10">
      <table className="w-full text-left font-plex-mono text-[11px]">
        <thead className="bg-white/5 text-white/50"><tr>{head.map((h) => <th key={h} className="px-3 py-2 font-normal uppercase tracking-wider">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-white/5 text-white/70">
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="px-3 py-2 align-top">{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

export default function Docs() {
  const [active, setActive] = useState("overview");
  useEffect(() => {
    const obs = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: "0px 0px -70% 0px" });
    TOC.forEach(([id]) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, []);

  return (
    <div className="min-h-screen">
      <Header />
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-10 sm:px-5 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 space-y-0.5" data-testid="docs-toc">
            <p className="mb-3 flex items-center gap-1.5 font-plex-mono text-[10px] uppercase tracking-[0.2em] text-white/40"><BookOpenText className="h-3.5 w-3.5" /> Docs</p>
            {TOC.map(([id, l]) => (
              <a key={id} href={`#${id}`} data-testid={`toc-${id}`}
                className={`block border-l px-3 py-1.5 font-plex-mono text-xs transition-colors ${active === id ? "border-quantum-green text-quantum-green" : "border-white/10 text-white/45 hover:text-white"}`}>{l}</a>
            ))}
          </nav>
        </aside>

        <article className="min-w-0 space-y-14" data-testid="docs-article">
          <section className="space-y-4">
            <H2 id="overview" kicker="overview">A quantum-safe transaction layer on Solana</H2>
            <P>
              QuantumPOS lets anyone with a Phantom wallet hold, send and receive SOL through a <B>Winternitz vault</B>: a program-owned account
              that only moves funds when it sees a valid <B>one-time hash-based signature</B>. Ed25519, the scheme behind every normal Solana
              account, can be broken by a large enough quantum computer. A Winternitz signature can’t, because breaking it would mean reversing Keccak-256.
            </P>
            <P>
              Each user gets one permanent vault. Each spend signs the exact transfer <i>and</i> the hash of the next key, and the program rotates to
              that key in the same instruction. Recipients are plain Solana addresses. If the recipient also has a vault, the SOL moves vault-to-vault
              and stays inside the quantum layer.
            </P>
            <div className="grid grid-cols-2 gap-px border border-white/10 bg-white/10 sm:grid-cols-4">
              {[["816 B", "signature"], ["34", "hash chains"], ["192-bit", "classical preimage"], ["96-bit", "quantum (Grover)"]].map(([v, l]) => (
                <div key={l} className="bg-quantum-ink p-4"><p className="font-mono text-2xl font-black text-quantum-green">{v}</p><p className="font-plex-mono text-[10px] uppercase tracking-widest text-white/40">{l}</p></div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <H2 id="threat" kicker="threat model">The quantum threat</H2>
            <P>
              <B>Shor’s algorithm</B> solves the discrete-log problem behind elliptic curves in polynomial time, so a quantum computer could compute an Ed25519
              private key from its public key. A Solana address <i>is</i> its public key, so every wallet that has ever held funds is exposed. That makes
              “harvest now, decrypt later” a real risk for SOL held for the long term.
            </P>
            <P>
              <B>Grover’s algorithm</B> is the best known generic quantum attack on a hash function, and it only square-roots the work. A preimage search over
              192 bits therefore costs about 2⁹⁶ quantum operations. Hash-based signatures sidestep Shor completely, which is why NIST standardised them
              (SP 800-208, FIPS 205).
            </P>
          </section>

          <section className="space-y-4">
            <H2 id="wots" kicker="cryptography">Winternitz one-time signatures (WOTS)</H2>
            <P>
              A Winternitz key is a set of hash chains. The secret is the start of each chain and the public key is the end, 255 steps later. To sign,
              you reveal each chain at the position given by one byte of the message digest. A verifier walks the rest of each chain and checks that the
              ends hash to the public key. Since nobody can walk a chain backwards, a signature reveals nothing that signs an <i>earlier</i> position.
            </P>
            <Code>{`N          = 24 bytes kept per hash          (192-bit classical, 96-bit quantum preimage)
MSG_CHUNKS = 32  (one per keccak256 digest byte)
SUM_CHUNKS = 2   (checksum)                   → CHUNKS = 34, SIG_LEN = 34 × 24 = 816 bytes

secret(seed, i) = keccak256("WNTR:SK" ‖ seed ‖ i)[:24]       // a key is one 32-byte seed
step(i, v)      = keccak256(i ‖ v)[:24]                      // chain index is domain-separated
pk_hash         = keccak256( ‖ᵢ walk(i, secretᵢ, 255) )
chunks(d)       = d[0..32] ‖ be16( Σ (255 − d[j]) )          // checksum
sign(d)ᵢ        = walk(i, secretᵢ, chunks(d)ᵢ)
verify          = keccak256( ‖ᵢ walk(i, sigᵢ, 255 − chunks(d)ᵢ) ) == pk_hash`}</Code>
            <P>
              <B>Why the checksum matters.</B> Without it, a forger could take a signature, raise one digest byte and walk that chain forward for free.
              Raising any message byte <i>lowers</i> the checksum, so a forgery would always need some chain walked backwards. The earlier lamports-only
              vault design (Dean Little) had no checksum. This program does.
            </P>
            <P>
              <B>One time only.</B> A second signature with the same key reveals two points on each chain, and an attacker can then sign anything in
              between. That is why the key rotates on every spend.
            </P>
            <Code>{`# shared test vector (program/src/wots.rs ⇄ client/src/check-vector.ts ⇄ our backend/wntr.py)
seed      = 0x01 × 32,  message = "winternitz test vector"
pk_hash   = fe5020b437c6b20c5e7375bcd9a3c6918b6d7654d8f488ffd8e3975f9fe5ab2a   ✓
digest    = ee3ac08879e1c9ad49981a20b07abf2bd0171540013cb1b4c77ac074089da713   ✓
sig[0:24] = 4e7850f3be9f49450cdc8a56add99f02c60efdcad1ebc9d4                   ✓
sig_hash  = 02207cde031055670bd22c656eb8f6b1679600450dd1ab7cb3f1888cb504c6c3   ✓`}</Code>
          </section>

          <section className="space-y-4">
            <H2 id="program" kicker="on-chain">The vault program</H2>
            <P>
              Program <a href={`https://explorer.solana.com/address/${PROGRAM}`} target="_blank" rel="noreferrer" className="font-plex-mono text-xs text-quantum-cyan hover:underline">{PROGRAM}</a>{" "}
              is built from <a href="https://github.com/rabb757/winternitz-vault" target="_blank" rel="noreferrer" className="text-quantum-cyan hover:underline">rabb757/winternitz-vault</a>.
              It was written from the specification, not forked from the original vault, and its interface is different.
            </P>
            <Code>{`Vault account (106 bytes, owner = program)
  tag u8 = 1 | bump u8 | nonce u64 LE | vault_id [32] | pk_hash [32] | mint [32]
PDA = find_program_address(["vault", vault_id])      vault_id = first pk_hash, so the address is permanent`}</Code>
            <Table head={["tag", "instruction", "data", "accounts"]} rows={[
              ["0", "initialize", "pk_hash(32)", "payer(s,w) · vault(w) · mint · system"],
              ["1", "spend: mint", "amount u64 · next_pk(32) · sig(816)", "vault(w) · mint(w) · dest(w) · token program"],
              ["2", "spend: transfer", "amount u64 · next_pk(32) · sig(816)", "vault(w) · source(w) · dest(w) · token program"],
              ["3", "execute (any CPI)", "next_pk(32) · sig(816) · n · flags[n] · cpi_data", "vault(w) · target program · …n inner accounts"],
            ]} />
            <Code>{`transfer digest = keccak256("WNTR:XFER" ‖ vault_id ‖ nonce ‖ source ‖ destination ‖ amount ‖ next_pk_hash)
execute  digest = keccak256("WNTR:EXEC" ‖ vault_id ‖ nonce ‖ target ‖ n ‖ (key ‖ flags)* ‖ cpi_data ‖ next_pk_hash)
on success: pk_hash ← next_pk_hash, nonce ← nonce + 1      (written before the CPI)`}</Code>
            <P>
              The vault holds data, so the System program can’t debit it. SOL that lands directly on the PDA can never be moved. Funds therefore
              live as <B>wrapped SOL</B> in the vault’s associated token account, and the vault PDA is the token authority.
            </P>
          </section>

          <section className="space-y-4">
            <H2 id="layer" kicker="architecture">How the transaction layer uses it</H2>
            <Table head={["action", "route", "transactions (one Phantom approval)"]} rows={[
              ["Open vault", "—", "initialize + create wSOL ATA (+ optional transfer & SyncNative)"],
              ["Deposit / pay link", "—", "create ATA (idempotent) · system transfer → ATA · SyncNative"],
              ["Send to vault user", "vault", "① ensure recipient ATA  ② SyncNative + WOTS transfer(vault ATA → recipient vault ATA)"],
              ["Send to plain wallet", "wallet", "① ensure sender wSOL ATA  ② WOTS transfer → it  ③ CloseAccount (unwrap) + system transfer"],
              ["Withdraw everything", "close", "SyncNative + WOTS execute(CloseAccount(vault ATA → Phantom))"],
            ]} />
            <ul className="list-inside list-disc space-y-1.5 text-sm text-white/60">
              <li><B>Same signature on every retry.</B> The signed message has no blockhash, so resuming a stuck transfer resubmits the identical 816 bytes and reveals nothing new about the key.</li>
              <li><B>Exact confirmation.</B> The server reads the on-chain vault and finalises only when <C>nonce == n + 1</C> and <C>pk_hash == next_pk</C>. A lagging RPC node can’t trigger a false rotation.</li>
              <li><B>Strict ordering.</B> Steps are signed together but broadcast one at a time. Each is confirmed before the next, so a spend never runs ahead of its destination account.</li>
              <li><B>Measured cost.</B> The spend transaction is 1,204 bytes plus the priority-fee instruction (limit 1,232). Verifying uses about 590k–660k compute units, and we request 1.4M for the worst case (8,670 keccaks).</li>
              <li><B>Phantom pays the fees.</B> About 0.00001 SOL per transaction. At current mainnet rent, opening a vault costs about 0.0027 SOL (vault 0.00119 + token account 0.00149). Creating a missing destination token account costs about 0.0015 SOL, and that rent is returned when the account is closed. The app reads live rent from the cluster.</li>
            </ul>
          </section>

          <section className="space-y-6">
            <H2 id="how" kicker="how it works">From Phantom to a quantum vault and back</H2>
            <FlowDiagram />
            <HowItWorksSteps />
          </section>

          <section className="space-y-4">
            <H2 id="verification" kicker="verification">What we verified</H2>
            <ul className="space-y-2 text-sm text-white/60">
              {[
                "Our Python signer (backend/wntr.py) reproduces all four values of the program's published test vector, byte for byte.",
                "We pulled the live program bytecode from its programdata account (8fqkcU…MZWu, 117,616 bytes) and ran it locally in LiteSVM.",
                "28/28 end-to-end checks passed with the real API against that bytecode: open + deposit, vault-to-vault, native delivery to an empty wallet, partial withdraw, full withdraw, re-deposit after close, retry with the identical signature, the discard warning, and outside-deposit detection.",
                "Negative tests: a changed amount, a replayed signature and a stale pre-rotation signature were all rejected on-chain with \"winternitz signature rejected\".",
                "An earlier build targeted the original Open/Split/Close layout. Mainnet simulation showed this program rejects it (NotEnoughAccountKeys), which is why the layer was rebuilt on the real interface.",
              ].map((t) => <li key={t} className="flex gap-2"><CheckCircle weight="fill" className="mt-0.5 h-4 w-4 shrink-0 text-quantum-green" />{t}</li>)}
            </ul>
          </section>

          <section className="space-y-4">
            <H2 id="security" kicker="honest scope">Security model & limitations</H2>
            <div className="space-y-2">
              {[
                ["Server-held keys", "One-time seeds are generated and stored on our server, encrypted with Fernet (AES-128-CBC + HMAC). Phantom can't hold Winternitz keys. This trades self-custody for usability: whoever controls the server and its encryption key controls the vaults."],
                ["Upgradeable program", "The program's upgrade authority (EFQJ3s…aeU) is an ordinary Ed25519 key. Whoever holds it could change the program's rules."],
                ["Ed25519 fee payer", "Phantom signs and pays fees with Ed25519. A quantum attacker who broke your Phantom key could take the SOL in Phantom, but not the funds behind your vault's Winternitz key."],
                ["Native-SOL delivery", "Sending to a plain wallet routes the SOL briefly through your own wSOL account before it's unwrapped. At that point it has left the quantum layer, by design."],
                ["Discarded transfers", "If a signed transfer is discarded, its signature may already be public. Signing a different message with the same key weakens it, so the app asks for explicit confirmation and tells you to move funds."],
                ["Don't fund the PDA directly", "SOL sent straight to the vault PDA is stuck permanently. Always use the pay link, which deposits into the vault's token account."],
                ["Research-grade", "The program is new, and the vault account's rent (~0.0012 SOL) can't be reclaimed. Use amounts you can afford to lose."],
              ].map(([t, d]) => (
                <div key={t} className="flex gap-3 border border-white/10 bg-quantum-ink p-4">
                  <Warning weight="fill" className="mt-0.5 h-4 w-4 shrink-0 text-quantum-warning" />
                  <div><p className="font-mono text-sm font-bold">{t}</p><p className="mt-1 text-[13px] leading-relaxed text-white/55">{d}</p></div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <H2 id="references" kicker="research">Research & references</H2>
            <div className="grid grid-cols-1 gap-px border border-white/10 bg-white/10 md:grid-cols-2">
              {REFS.map(([t, d, u]) => (
                <a key={t} href={u} target="_blank" rel="noreferrer" data-testid="docs-ref-link" className="group bg-quantum-ink p-4 transition-colors hover:bg-white/[0.03]">
                  <p className="flex items-center gap-1.5 font-mono text-xs font-bold group-hover:text-quantum-green">
                    {u.includes("github") ? <GithubLogo className="h-3.5 w-3.5" /> : <ArrowSquareOut className="h-3.5 w-3.5" />} {t}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-white/45">{d}</p>
                </a>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 pt-4">
              <Link to="/app" data-testid="docs-open-wallet" className="btn-sheen inline-flex h-11 items-center bg-quantum-green px-6 font-mono text-sm font-bold text-black hover:bg-quantum-greenDark">Open your vault →</Link>
              <Link to="/" className="inline-flex h-11 items-center border border-white/15 px-6 font-mono text-sm text-white/70 hover:border-white/40">Home</Link>
            </div>
          </section>
        </article>
      </div>
    </div>
  );
}
