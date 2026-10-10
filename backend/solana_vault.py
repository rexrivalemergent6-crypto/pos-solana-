"""
Instruction builders for the mainnet Winternitz Vault program
13EtnfYGUH8NaGAnUpDTVgSsXoewNnULp7ESwHzQUANT  (source: github.com/rabb757/winternitz-vault)

Vault account (106 bytes, program-owned): tag(1)=1 | bump(1) | nonce u64 LE (8) | vault_id(32) | pk_hash(32) | mint(32)
PDA: find_program_address([b"vault", vault_id], PROGRAM)   vault_id = the FIRST pk_hash (address is permanent)

  0 initialize  data = [0] + pk_hash(32)
                accts = [payer(s,w), vault(w), mint(r), system(r)]
  2 transfer    data = [2] + amount u64 LE + next_pk_hash(32) + sig(816)
                accts = [vault(w), source_token(w), destination_token(w), token_program(r)]
                digest = keccak("WNTR:XFER" | vault_id | nonce | source | destination | amount | next_pk_hash)
  3 execute     data = [3] + next_pk_hash(32) + sig(816) + count(1) + flags(count) + cpi_data
                accts = [vault(w), target_program(r), ...inner accounts]
                digest = keccak("WNTR:EXEC" | vault_id | nonce | target | count | (key|flag)* | cpi_data | next_pk_hash)

The vault holds data, so the System program cannot debit it: SOL is held as wrapped SOL in the
vault's associated token account (owner = vault PDA, mint = native). Withdrawals unwrap via
execute -> SPL Token CloseAccount.
"""
from __future__ import annotations
import base64
import os
from pathlib import Path
from dotenv import load_dotenv
from solders.pubkey import Pubkey

load_dotenv(Path(__file__).parent / ".env")

PROGRAM_ID = Pubkey.from_string(os.environ["VAULT_PROGRAM_ID"])
SYSTEM_PROGRAM_ID = Pubkey.from_string("11111111111111111111111111111111")
TOKEN_PROGRAM_ID = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
ATA_PROGRAM_ID = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
NATIVE_MINT = Pubkey.from_string("So11111111111111111111111111111111111111112")

LAMPORTS_PER_SOL = 1_000_000_000
VAULT_LEN = 106
VAULT_RENT_LAMPORTS = (128 + VAULT_LEN) * 6960      # 1_628_640
TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280            # 165-byte SPL token account
WALLET_RENT_LAMPORTS = 890_880                     # 0-byte system account


def pk(x) -> Pubkey:
    return x if isinstance(x, Pubkey) else Pubkey.from_string(x)


def _meta(key, signer: bool, writable: bool) -> dict:
    return {"pubkey": str(key), "isSigner": signer, "isWritable": writable}


def _ix(program, keys, data: bytes) -> dict:
    return {"programId": str(program), "keys": keys, "data": base64.b64encode(data).decode()}


def derive_vault(vault_id: bytes):
    assert len(vault_id) == 32
    addr, bump = Pubkey.find_program_address([b"vault", vault_id], PROGRAM_ID)
    return str(addr), bump


def derive_ata(owner, mint=NATIVE_MINT) -> str:
    addr, _ = Pubkey.find_program_address([bytes(pk(owner)), bytes(TOKEN_PROGRAM_ID), bytes(pk(mint))], ATA_PROGRAM_ID)
    return str(addr)


def parse_vault(data: bytes) -> dict:
    if len(data) < VAULT_LEN or data[0] != 1:
        raise ValueError("not a vault account")
    return {
        "bump": data[1],
        "nonce": int.from_bytes(data[2:10], "little"),
        "vault_id": data[10:42],
        "pk_hash": data[42:74],
        "mint": str(Pubkey.from_bytes(data[74:106])),
    }


# --------------------------- instructions ---------------------------
def initialize_ix(payer, vault, pk_hash: bytes, mint=NATIVE_MINT) -> dict:
    return _ix(PROGRAM_ID, [_meta(payer, True, True), _meta(vault, False, True),
                            _meta(mint, False, False), _meta(SYSTEM_PROGRAM_ID, False, False)],
               bytes([0]) + pk_hash)


def create_ata_idempotent_ix(payer, owner, mint=NATIVE_MINT) -> dict:
    ata = derive_ata(owner, mint)
    return _ix(ATA_PROGRAM_ID, [_meta(payer, True, True), _meta(ata, False, True), _meta(owner, False, False),
                                _meta(mint, False, False), _meta(SYSTEM_PROGRAM_ID, False, False),
                                _meta(TOKEN_PROGRAM_ID, False, False)], bytes([1]))


def sync_native_ix(token_account) -> dict:
    return _ix(TOKEN_PROGRAM_ID, [_meta(token_account, False, True)], bytes([17]))


def system_transfer_ix(src, dst, lamports: int) -> dict:
    return _ix(SYSTEM_PROGRAM_ID, [_meta(src, True, True), _meta(dst, False, True)],
               (2).to_bytes(4, "little") + int(lamports).to_bytes(8, "little"))


def token_close_ix(account, destination, authority) -> dict:
    """SPL Token CloseAccount (tag 9) signed by an Ed25519 authority (used for the user's own wSOL ATA)."""
    return _ix(TOKEN_PROGRAM_ID, [_meta(account, False, True), _meta(destination, False, True),
                                  _meta(authority, True, False)], bytes([9]))


def vault_transfer_ix(vault, source, destination, amount: int, next_pk_hash: bytes, sig: bytes) -> dict:
    assert len(sig) == 816 and len(next_pk_hash) == 32
    return _ix(PROGRAM_ID, [_meta(vault, False, True), _meta(source, False, True),
                            _meta(destination, False, True), _meta(TOKEN_PROGRAM_ID, False, False)],
               bytes([2]) + int(amount).to_bytes(8, "little") + next_pk_hash + sig)


def close_inner_metas(vault, ata, destination) -> list:
    """Inner CloseAccount(ata -> destination, authority = vault PDA). flags: bit0 signer, bit1 writable."""
    return [(bytes(pk(ata)), 2), (bytes(pk(destination)), 2), (bytes(pk(vault)), 1)]


def vault_execute_close_ix(vault, ata, destination, next_pk_hash: bytes, sig: bytes) -> dict:
    assert len(sig) == 816 and len(next_pk_hash) == 32
    metas = close_inner_metas(vault, ata, destination)
    cpi = bytes([9])
    data = bytes([3]) + next_pk_hash + sig + bytes([len(metas)]) + bytes(f for _, f in metas) + cpi
    keys = [_meta(vault, False, True), _meta(TOKEN_PROGRAM_ID, False, False)]
    keys += [_meta(Pubkey.from_bytes(k), False, bool(f & 2)) for k, f in metas]
    return _ix(PROGRAM_ID, keys, data)


def is_valid_solana_address(address: str) -> bool:
    try:
        Pubkey.from_string(address)
        return True
    except Exception:
        return False
