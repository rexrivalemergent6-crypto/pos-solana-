export const LPS = 1_000_000_000;
export const short = (a, n = 4) => (a ? `${a.slice(0, n)}…${a.slice(-n)}` : "");
export const sol = (lamports, d = 4) => (Number(lamports || 0) / LPS).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: Math.min(2, d) });
export const usd = (s, rate) => (rate ? `≈ $${(Number(s || 0) * rate).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : "");
export const ago = (iso) => {
  if (!iso) return "";
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};
export const errMsg = (e, fallback = "Something went wrong") => e?.response?.data?.detail || e?.message || fallback;
export const isAddress = (a) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test((a || "").trim());
