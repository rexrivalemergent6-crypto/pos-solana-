"""
Byte-exact Python port of the Winternitz scheme used by the mainnet vault program
13EtnfYGUH8NaGAnUpDTVgSsXoewNnULp7ESwHzQUANT (source: github.com/rabb757/winternitz-vault,
program/src/lib.rs + program/src/wots.rs).

  N          = 24 bytes kept per chain hash (192-bit classical / 96-bit quantum preimage)
  MSG_CHUNKS = 32 (one per digest byte), SUM_CHUNKS = 2 (checksum)  -> 34 chains
  SIG_LEN    = 34 * 24 = 816 bytes
  secret(seed, i) = keccak256("WNTR:SK" || seed || i)[:24]
  step(i, v)      = keccak256(i || v)[:24]            (chain index is domain-separated)
  pk_hash         = keccak256( || walk(i, secret_i, 255) for i in 0..34 )
  chunks(d)       = d[0..32] || be16( sum(255 - d[j]) )
  sign            = walk(i, secret_i, chunks[i])
  verify          = keccak256( || walk(i, sig_i, 255 - chunks[i]) ) == pk_hash

Validated against the published test vector (client/src/check-vector.ts).
"""
from __future__ import annotations
import os
from Crypto.Hash import keccak as _k

N = 24
MSG_CHUNKS = 32
SUM_CHUNKS = 2
CHUNKS = MSG_CHUNKS + SUM_CHUNKS
SIG_LEN = CHUNKS * N  # 816
CHAIN_MAX = 255


def keccak256(*parts: bytes) -> bytes:
    h = _k.new(digest_bits=256)
    for p in parts:
        h.update(p)
    return h.digest()


def _walk(index: int, start: bytes, times: int) -> bytes:
    cur = start
    ib = bytes([index])
    for _ in range(times):
        cur = keccak256(ib, cur)[:N]
    return cur


def chunks_of(digest: bytes) -> list[int]:
    assert len(digest) == 32
    s = sum(CHAIN_MAX - b for b in digest)
    return list(digest) + [(s >> 8) & 0xFF, s & 0xFF]


def new_seed() -> bytes:
    return os.urandom(32)


def secret(seed: bytes, i: int) -> bytes:
    return keccak256(b"WNTR:SK", seed, bytes([i]))[:N]


def public_key_hash(seed: bytes) -> bytes:
    ends = b"".join(_walk(i, secret(seed, i), CHAIN_MAX) for i in range(CHUNKS))
    return keccak256(ends)


def sign(seed: bytes, digest: bytes) -> bytes:
    counts = chunks_of(digest)
    return b"".join(_walk(i, secret(seed, i), counts[i]) for i in range(CHUNKS))


def verify(pk_hash: bytes, digest: bytes, sig: bytes) -> bool:
    if len(sig) != SIG_LEN:
        return False
    counts = chunks_of(digest)
    ends = b"".join(_walk(i, sig[i * N:(i + 1) * N], CHAIN_MAX - counts[i]) for i in range(CHUNKS))
    return keccak256(ends) == pk_hash


# ------------------------- program digests -------------------------
def xfer_digest(vault_id: bytes, nonce: int, source: bytes, destination: bytes, amount: int,
                next_pk_hash: bytes) -> bytes:
    """Digest for spend(Action::Transfer) — instruction tag 2."""
    return keccak256(b"WNTR:XFER", vault_id, nonce.to_bytes(8, "little"), source, destination,
                     amount.to_bytes(8, "little"), next_pk_hash)


def exec_digest(vault_id: bytes, nonce: int, target_program: bytes, metas: list[tuple[bytes, int]],
                cpi_data: bytes, next_pk_hash: bytes) -> bytes:
    """Digest for execute — instruction tag 3. metas = [(pubkey_bytes, flags)], flags bit0 signer bit1 writable."""
    parts = [b"WNTR:EXEC", vault_id, nonce.to_bytes(8, "little"), target_program, bytes([len(metas)])]
    for key, flags in metas:
        parts += [key, bytes([flags])]
    parts += [cpi_data, next_pk_hash]
    return keccak256(*parts)
