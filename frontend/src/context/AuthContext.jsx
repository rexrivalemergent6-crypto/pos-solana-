import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { connectPhantom, disconnectPhantom, signMessagePhantom, getPhantom } from "@/lib/phantom";

const AuthContext = createContext(null);

function describeWalletError(e, step) {
  const code = e?.code;
  if (code === 4001) return `${step} was rejected in Phantom`;
  if (code === 4100) return `${step} not authorized — unlock Phantom and approve this site`;
  if (code === -32000) return `${step} blocked by Phantom (sign-in domain mismatch). Reload the page and try again`;
  if (code === -32603) return `${step} failed inside Phantom — unlock the wallet and retry`;
  return `${step} failed: ${e?.message || "unknown wallet error"}`;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const loadMe = useCallback(async () => {
    const token = localStorage.getItem("qpos_token");
    if (!token) { setLoading(false); return; }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch (e) {
      localStorage.removeItem("qpos_token");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);

  const login = useCallback(async () => {
    setConnecting(true);
    try {
      let address, ch, signature, data;
      try { address = await connectPhantom(); } catch (e) { throw new Error(describeWalletError(e, "Wallet connection")); }
      try {
        ({ data: ch } = await api.post("/auth/challenge", { address }));
      } catch (e) {
        throw new Error(`Could not start sign-in: ${e?.response?.data?.detail || e?.message}`);
      }
      try { signature = await signMessagePhantom(ch.message); } catch (e) { throw new Error(describeWalletError(e, "Message signing")); }
      try {
        ({ data } = await api.post("/auth/verify", { address, message: ch.message, signature }));
      } catch (e) {
        throw new Error(`Signature verification failed: ${e?.response?.data?.detail || e?.message}`);
      }
      localStorage.setItem("qpos_token", data.token);
      setUser(data.user);
      return data.user;
    } finally {
      setConnecting(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await disconnectPhantom();
    localStorage.removeItem("qpos_token");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, connecting, login, logout, hasPhantom: !!getPhantom() }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
