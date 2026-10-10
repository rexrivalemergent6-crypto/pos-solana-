# QuantumPOS — Quantum-safe transaction layer on Solana (PRD & engineering memory)

## Problem statement (latest)
Pivot from merchant POS to a **quantum-safe P2P transaction layer**: users send & receive SOL using Winternitz vaults.
Also: a "How it works" section and a `/docs` page presenting the research (GitHub sources etc).

## User choices (locked)
- Personal vault wallets (deposit / send / receive / withdraw to Phantom anytime)
- One-time keys held by the server, encrypted (Fernet)
- Recipients identified by Solana address only (Phantom address = identity)
- Merchant invoice/checkout features REMOVED
- Mainnet only, real SOL; public RPC via backend proxy (+ publicnode fallback)

## Key research finding
The mainnet program `13EtnfYGUH8NaGAnUpDTVgSsXoewNnULp7ESwHzQUANT` is **rabb757/winternitz-vault**, NOT
deanmlittle's Open/Split/Close vault (the old POS code targeted the wrong layout — mainnet sim returned
NotEnoughAccountKeys). Real interface: persistent PDA ["vault", first_pk_hash]; tags 0 initialize, 1 mint,
2 transfer (SPL), 3 execute (any CPI); WOTS N=24, 34 chains (32 + 2 checksum), 816-byte sig; key rotates
in place via next_pk_hash + nonce. Vault holds data → SOL lives as **wSOL in the vault's ATA**.
Program is upgradeable (authority EFQJ3s…aeU). Mainnet rent changed → fetched live at startup.

## Architecture
- `backend/wntr.py` — byte-exact WOTS port (matches published test vector) + XFER/EXEC digests
- `backend/solana_vault.py` — instruction builders (initialize, transfer-spend, execute CloseAccount, ATA, SyncNative…)
- `backend/server.py` — SIWS auth; vault create/confirm; transfers prepare/confirm/retry/discard/deliver;
  pay link deposit-ixs; deposit record; activity; key chain; watcher (finalise by on-chain nonce, outside deposits)
- Routes: vault (recipient has vault → vault ATA), wallet (via sender wSOL ATA → unwrap → native), close (withdraw all)
- Frontend: `/` landing (+How it works), `/app` wallet, `/pay/:address` public pay link, `/docs` research
- Collections: users, vaults (1 per user), transfers, vault_keys, challenges(TTL)

## Implemented (2026-10)
- Full pivot; 28/28 e2e checks vs REAL mainnet bytecode in LiteSVM (`backend/tests/e2e_litesvm.py`)
- Live-mainnet simulation of vault open succeeds

## Backlog / ideas
- P1: Address book / recent recipients; transfer notifications
- P2: Client-side key custody option (export/backup), SPL token support (program supports any mint)
- P2: Address lookup tables to fit spend + ATA-create in one tx
