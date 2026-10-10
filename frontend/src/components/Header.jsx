import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Vault, SignOut, Copy, Check, XLogo, BookOpenText, Wallet } from "@phosphor-icons/react";
import { useAuth } from "@/context/AuthContext";
import { short } from "@/lib/format";
import { toast } from "sonner";

const navCls = ({ isActive }) =>
  `flex h-8 items-center gap-1.5 border px-2.5 font-plex-mono text-xs transition-colors ${
    isActive ? "border-quantum-green/50 text-quantum-green" : "border-white/10 text-white/60 hover:border-white/30 hover:text-white"
  }`;

export default function Header() {
  const { user, logout: _logout, login, connecting } = useAuth();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const logout = async () => { await _logout(); navigate("/"); };
  const copy = () => {
    navigator.clipboard.writeText(user.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-black/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/" data-testid="header-home-logo" className="mr-1 flex items-center gap-2.5" aria-label="Home">
            <div className="flex h-7 w-7 items-center justify-center bg-quantum-green">
              <Vault weight="fill" className="h-4 w-4 text-black" />
            </div>
            <span className="hidden font-mono text-base font-bold tracking-tighter md:inline">QuantumPOS</span>
          </Link>
          <NavLink to="/app" data-testid="nav-wallet" className={navCls}>
            <Wallet className="h-4 w-4" /> <span className="hidden sm:inline">Wallet</span>
          </NavLink>
          <NavLink to="/docs" data-testid="nav-docs" className={navCls}>
            <BookOpenText className="h-4 w-4" /> <span className="hidden sm:inline">Docs</span>
          </NavLink>
        </div>

        <div className="flex items-center gap-2">
          <a data-testid="header-x-link" href="https://x.com/tryquantumpos" target="_blank" rel="noreferrer" aria-label="QuantumPOS on X"
            className="hidden h-9 items-center gap-1.5 border border-white/10 px-3 font-plex-mono text-xs text-white/60 transition-colors hover:border-white/30 hover:text-white sm:flex">
            <XLogo weight="bold" className="h-4 w-4" />
            <span className="hidden lg:inline">@tryquantumpos</span>
          </a>
          {!user ? (
            <Button data-testid="header-connect-btn" disabled={connecting}
              onClick={() => login().then(() => navigate("/app")).catch((e) => toast.error(e.message))}
              className="btn-sheen h-9 rounded-none bg-quantum-green px-4 font-mono text-xs font-bold text-black hover:bg-quantum-greenDark">
              {connecting ? "Connecting…" : "Connect Phantom"}
            </Button>
          ) : (
            <>
              <button data-testid="wallet-chip" onClick={copy} title="Your Phantom address (copy)"
                className="flex items-center gap-2 border border-quantum-purple/40 bg-quantum-purple/5 px-3 py-1.5 font-plex-mono text-xs text-quantum-purple transition-colors hover:bg-quantum-purple/10">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {short(user.address)}
              </button>
              <Button data-testid="logout-btn" variant="ghost" size="icon" onClick={logout} aria-label="Log out"
                className="h-9 w-9 rounded-none text-white/60 hover:bg-red-500/10 hover:text-red-400">
                <SignOut className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
