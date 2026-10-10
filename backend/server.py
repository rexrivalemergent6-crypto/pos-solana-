"""
QuantumPOS — quantum-safe transaction layer on Solana (vault program: github.com/rabb757/winternitz-vault).

Each user owns ONE permanent Winternitz vault PDA (["vault", first_pk_hash]). SOL is held as wrapped
SOL in the vault's associated token account. Every spend is authorised by a one-time WOTS signature
over (nonce, source, destination, amount, next_pk_hash) and rotates the key in place — the vault
address never changes. Recipients are plain Solana addresses; registered users receive vault-to-vault.
"""
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, logging, uuid, secrets, asyncio, time
from pathlib import Path
from urllib.parse import urlparse
from datetime import datetime, timezone, timedelta
from typing import Optional

import jwt
import base58
import httpx
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError
from cryptography.fernet import Fernet
from pydantic import BaseModel, Field
from solders.pubkey import Pubkey

import wntr
import solana_vault as sv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGO = "HS256"
SESSION_TTL_DAYS = 7
CHALLENGE_TTL_MIN = 5
AUTH_DOMAIN = os.environ.get("AUTH_DOMAIN", "localhost")
RPC_URL = os.environ["SOLANA_RPC_URL"]
CLUSTER = os.environ.get("SOLANA_CLUSTER", "mainnet-beta")
PROGRAM_ID = os.environ["VAULT_PROGRAM_ID"]
fernet = Fernet(os.environ["WOTS_ENC_KEY"].encode())

LPS = sv.LAMPORTS_PER_SOL
# Rent-exempt minimums — refreshed from the cluster at startup (mainnet rent has changed over time).
RENT = {"token": sv.TOKEN_ACCOUNT_RENT_LAMPORTS, "vault": sv.VAULT_RENT_LAMPORTS, "wallet": sv.WALLET_RENT_LAMPORTS}
CU_LIMIT = 1_400_000          # WOTS verify = ~4.3k keccak avg, 8.7k worst case
CU_PRICE_MICROLAMPORTS = 2_000
SYSTEM_OWNER = "11111111111111111111111111111111"

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("quantumpos")

app = FastAPI(title="QuantumPOS Transaction Layer")
api = APIRouter(prefix="/api")


# ----------------------------- helpers -----------------------------
def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def parse_iso(s: Optional[str]) -> Optional[datetime]:
    return datetime.fromisoformat(s) if s else None


def explorer_tx(sig: Optional[str]) -> Optional[str]:
    if not sig:
        return None
    suffix = "" if CLUSTER == "mainnet-beta" else f"?cluster={CLUSTER}"
    return f"https://explorer.solana.com/tx/{sig}{suffix}"


def explorer_address(addr: Optional[str]) -> Optional[str]:
    if not addr:
        return None
    suffix = "" if CLUSTER == "mainnet-beta" else f"?cluster={CLUSTER}"
    return f"https://explorer.solana.com/address/{addr}{suffix}"


def valid_solana_address(address: str) -> bool:
    try:
        return len(base58.b58decode(address)) == 32
    except Exception:
        return False


RPC_FALLBACKS = [u.strip() for u in os.environ.get("SOLANA_RPC_FALLBACKS", "https://solana-rpc.publicnode.com").split(",") if u.strip()]
RPC_ENDPOINTS = [RPC_URL] + [u for u in RPC_FALLBACKS if u != RPC_URL]


async def rpc_raw(payload) -> dict:
    """POST a JSON-RPC payload server-side (public RPCs 403 browser origins), with fallbacks."""
    last_err = None
    async with httpx.AsyncClient(timeout=20) as hc:
        for url in RPC_ENDPOINTS:
            try:
                r = await hc.post(url, json=payload)
                if r.status_code in (403, 429) or r.status_code >= 500:
                    last_err = f"{url} -> HTTP {r.status_code}"
                    continue
                data = r.json()
                err = data.get("error") if isinstance(data, dict) else None
                if err and err.get("code") in (403, 429, -32005):
                    last_err = f"{url} -> {err}"
                    continue
                return data
            except (httpx.HTTPError, ValueError) as e:
                last_err = f"{url} -> {e}"
    raise HTTPException(status_code=502, detail=f"All Solana RPC endpoints failed: {last_err}")


async def rpc_call(method: str, params: list):
    data = await rpc_raw({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    if "error" in data:
        raise HTTPException(status_code=502, detail=f"RPC error: {data['error']}")
    return data["result"]


async def get_balance(address: str) -> int:
    res = await rpc_call("getBalance", [address, {"commitment": "confirmed"}])
    return res["value"]


async def get_account(address: str) -> Optional[dict]:
    res = await rpc_call("getAccountInfo", [address, {"commitment": "confirmed", "encoding": "base64"}])
    return res["value"]


async def is_program_vault(address: str) -> bool:
    acc = await get_account(address)
    return bool(acc and acc.get("owner") == PROGRAM_ID)


_price_cache = {"v": None, "t": 0.0}


async def fetch_sol_usd() -> Optional[float]:
    if _price_cache["v"] and time.time() - _price_cache["t"] < 60:
        return _price_cache["v"]
    try:
        async with httpx.AsyncClient(timeout=10) as hc:
            r = await hc.get("https://api.coingecko.com/api/v3/simple/price",
                             params={"ids": "solana", "vs_currencies": "usd"})
            if r.status_code == 200:
                v = r.json().get("solana", {}).get("usd")
                if v:
                    _price_cache.update(v=v, t=time.time())
                return v
    except Exception as e:
        logger.warning(f"price fetch failed: {e}")
    return _price_cache["v"]


# ----------------------------- auth (SIWS) -----------------------------
SIWS_CHAIN = {"mainnet-beta": "mainnet", "devnet": "devnet", "testnet": "testnet"}.get(CLUSTER, CLUSTER)


def resolve_auth_origin(origin_header: Optional[str]) -> tuple:
    """Phantom blocks SIWS messages whose domain/URI don't match the requesting page."""
    if origin_header:
        parsed = urlparse(origin_header)
        if parsed.scheme in ("http", "https") and parsed.netloc:
            return parsed.netloc, f"{parsed.scheme}://{parsed.netloc}"
    return AUTH_DOMAIN, f"https://{AUTH_DOMAIN}"


def build_challenge_message(address: str, nonce: str, issued: datetime, expires: datetime,
                            domain: str = None, uri: str = None) -> str:
    domain = domain or AUTH_DOMAIN
    uri = uri or f"https://{domain}"
    return (
        f"{domain} wants you to sign in with your Solana account:\n{address}\n\n"
        f"Sign in to the QuantumPOS quantum-safe transaction layer.\n\n"
        f"URI: {uri}\nVersion: 1\nChain ID: solana:{SIWS_CHAIN}\n"
        f"Nonce: {nonce}\nIssued At: {iso(issued)}\nExpiration Time: {iso(expires)}"
    )


class ChallengeIn(BaseModel):
    address: str


class VerifyIn(BaseModel):
    address: str
    message: str
    signature: str  # base58


@api.post("/auth/challenge")
async def auth_challenge(body: ChallengeIn, origin: Optional[str] = Header(default=None)):
    if not valid_solana_address(body.address):
        raise HTTPException(400, "Invalid Solana address")
    issued, expires = now(), now() + timedelta(minutes=CHALLENGE_TTL_MIN)
    nonce = secrets.token_urlsafe(24)
    domain, uri = resolve_auth_origin(origin)
    message = build_challenge_message(body.address, nonce, issued, expires, domain, uri)
    await db.challenges.insert_one({
        "nonce": nonce, "address": body.address, "message": message,
        "expires_at": expires, "created_at": issued,
    })
    return {"message": message}


@api.post("/auth/verify")
async def auth_verify(body: VerifyIn):
    if not valid_solana_address(body.address):
        raise HTTPException(400, "Invalid address")
    nonce_line = next((l for l in body.message.splitlines() if l.startswith("Nonce: ")), "")
    nonce = nonce_line.removeprefix("Nonce: ").strip()
    if not nonce:
        raise HTTPException(401, "Malformed challenge")
    challenge = await db.challenges.find_one_and_delete({
        "nonce": nonce, "address": body.address, "message": body.message,
        "expires_at": {"$gt": now()},
    })
    if not challenge:
        raise HTTPException(401, "Expired, unknown, or already-used challenge")
    try:
        public_key = base58.b58decode(body.address)
        signature = base58.b58decode(body.signature)
        if len(public_key) != 32 or len(signature) != 64:
            raise HTTPException(401, "Bad key/signature length")
        VerifyKey(public_key).verify(body.message.encode("utf-8"), signature)
    except (ValueError, BadSignatureError):
        raise HTTPException(401, "Invalid signature")

    user = await db.users.find_one({"address": body.address}, {"_id": 0})
    if not user:
        user = {"id": str(uuid.uuid4()), "address": body.address, "created_at": iso(now())}
        await db.users.insert_one(dict(user))
    expires = now() + timedelta(days=SESSION_TTL_DAYS)
    token = jwt.encode({"sub": body.address, "exp": expires, "iat": now()}, JWT_SECRET, algorithm=JWT_ALGO)
    return {"token": token, "user": user}


async def current_user(authorization: Optional[str] = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    token = authorization.split(" ", 1)[1]
    try:
        claims = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired session")
    user = await db.users.find_one({"address": claims.get("sub")}, {"_id": 0})
    if not user:
        raise HTTPException(401, "User not found")
    return user


@api.get("/auth/me")
async def auth_me(user: dict = Depends(current_user)):
    return user


# ----------------------------- vault model -----------------------------
def enc(b: bytes) -> str:
    return fernet.encrypt(b).decode()


def dec(s: str) -> bytes:
    return fernet.decrypt(s.encode())


async def read_vault_state(address: str) -> Optional[dict]:
    """Parse the on-chain vault account (nonce + current pk_hash). None if not initialized."""
    acc = await get_account(address)
    if not acc or acc.get("owner") != PROGRAM_ID:
        return None
    import base64 as _b64
    try:
        return sv.parse_vault(_b64.b64decode(acc["data"][0]))
    except ValueError:
        return None


async def ata_info(ata: str) -> tuple:
    """(lamports, rent_exempt_reserve) of a wSOL token account; (0, 0) if it doesn't exist.
    The reserve is read from the account itself (is_native COption<u64> at offset 109)."""
    acc = await get_account(ata)
    if not acc:
        return 0, 0
    import base64 as _b64
    reserve = RENT["token"]
    try:
        d = _b64.b64decode(acc["data"][0])
        if len(d) >= 121 and int.from_bytes(d[109:113], "little") == 1:
            reserve = int.from_bytes(d[113:121], "little")
    except Exception:
        pass
    return acc.get("lamports", 0), reserve


async def ata_lamports(ata: str) -> int:
    return (await ata_info(ata))[0]


def spendable_of(lamports: int, reserve: Optional[int] = None) -> int:
    if not lamports:
        return 0
    return max(0, lamports - (reserve if reserve is not None else RENT["token"]))


def public_vault(v: Optional[dict]) -> Optional[dict]:
    if not v:
        return None
    lam = v.get("lamports") or 0
    sp = spendable_of(lam, v.get("reserve")) if v["status"] == "open" else 0
    return {
        "id": v["id"],
        "owner": v["owner"],
        "address": v["address"],
        "token_account": v["ata"],
        "status": v["status"],                 # created | open
        "nonce": v.get("nonce", 0),
        "pk_hash": v["pk_hex"],
        "vault_id": v["vault_id_hex"],
        "lamports": lam,
        "spendable_lamports": sp,
        "spendable_sol": sp / LPS,
        "key_exposed": v.get("exposed_nonce") is not None and v.get("exposed_nonce") == v.get("nonce"),
        "open_tx_sig": v.get("open_tx_sig"),
        "explorer": explorer_address(v["address"]),
        "explorer_token": explorer_address(v["ata"]),
        "explorer_open": explorer_tx(v.get("open_tx_sig")),
        "created_at": v["created_at"],
        "opened_at": v.get("opened_at"),
    }


async def get_vault(owner: str) -> Optional[dict]:
    return await db.vaults.find_one({"owner": owner}, {"_id": 0})


async def refresh_balance(v: dict) -> dict:
    try:
        lam, reserve = await ata_info(v["ata"])
    except Exception as e:
        logger.warning(f"balance refresh failed {v['ata']}: {e}")
        return v
    if lam != v.get("lamports") or (lam and reserve != v.get("reserve")):
        upd = {"lamports": lam, **({"reserve": reserve} if lam else {})}
        await db.vaults.update_one({"id": v["id"]}, {"$set": upd})
        v = {**v, **upd}
    return v


# ----------------------------- vault lifecycle -----------------------------
@api.get("/vault")
async def my_vault(user: dict = Depends(current_user)):
    me = user["address"]
    v = await get_vault(me)
    if v and v["status"] == "open":
        v = await refresh_balance(v)
    pending = await db.transfers.find_one({"sender": me, "status": "pending"}, {"_id": 0})
    undelivered = await db.transfers.find_one({"sender": me, "status": "completed", "route": "wallet",
                                               "delivered": False}, {"_id": 0})
    agg = await db.transfers.find({"$or": [{"sender": me}, {"recipient_owner": me}], "status": "completed"},
                                  {"_id": 0, "kind": 1, "sender": 1, "recipient_owner": 1,
                                   "amount_lamports": 1}).to_list(5000)
    sent = sum(t["amount_lamports"] for t in agg if t.get("sender") == me and t["kind"] == "send")
    received = sum(t["amount_lamports"] for t in agg if t.get("recipient_owner") == me and t.get("sender") != me
                   and t["kind"] in ("send", "deposit"))
    return {
        "vault": public_vault(v),
        "pending_transfer": public_transfer(pending, me) if pending else None,
        "undelivered_transfer": public_transfer(undelivered, me) if undelivered else None,
        "usd_rate": await fetch_sol_usd(),
        "stats": {"sent_sol": sent / LPS, "received_sol": received / LPS, "rotations": (v or {}).get("nonce", 0)},
        "token_rent_lamports": RENT["token"],
        "vault_rent_lamports": RENT["vault"],
    }


@api.get("/vault/keys")
async def key_chain(user: dict = Depends(current_user)):
    """The one-time key chain: every retired key + the live one."""
    v = await get_vault(user["address"])
    if not v:
        return []
    docs = await db.vault_keys.find({"vault_id": v["id"]}, {"_id": 0}).sort("nonce", -1).to_list(500)
    live = {"nonce": v.get("nonce", 0), "pk_hash": v["pk_hex"], "status": "live", "tx_sig": None,
            "explorer": None, "retired_at": None}
    return [live] + [{**d, "status": "retired", "explorer": explorer_tx(d.get("tx_sig"))} for d in docs]


class CreateIn(BaseModel):
    deposit_sol: Optional[float] = Field(default=None, ge=0)


@api.post("/vault/create")
async def create_vault(body: CreateIn, user: dict = Depends(current_user)):
    me = user["address"]
    v = await get_vault(me)
    if v and v["status"] == "open":
        raise HTTPException(400, "You already have an open quantum vault")
    if not v:
        seed = wntr.new_seed()
        pkh = wntr.public_key_hash(seed)
        address, bump = sv.derive_vault(pkh)
        v = {"id": str(uuid.uuid4()), "owner": me, "address": address, "bump": bump,
             "vault_id_hex": pkh.hex(), "pk_hex": pkh.hex(), "seed_enc": enc(seed), "nonce": 0,
             "ata": sv.derive_ata(address), "status": "created", "lamports": 0,
             "exposed_nonce": None, "created_at": iso(now())}
        await db.vaults.insert_one(dict(v))
    ixs = [sv.initialize_ix(me, v["address"], bytes.fromhex(v["vault_id_hex"])),
           sv.create_ata_idempotent_ix(me, v["address"])]
    dep = int(round((body.deposit_sol or 0) * LPS))
    if dep > 0:
        ixs += [sv.system_transfer_ix(me, v["ata"], dep), sv.sync_native_ix(v["ata"])]
    return {"vault": public_vault(v), "ixs": ixs, "fee_payer": me,
            "cost_lamports": RENT["vault"] + RENT["token"], "deposit_lamports": dep}


class SigIn(BaseModel):
    signature: str


@api.post("/vault/confirm-open")
async def confirm_open(body: SigIn, user: dict = Depends(current_user)):
    v = await get_vault(user["address"])
    if not v:
        raise HTTPException(404, "No vault to confirm")
    if v["status"] == "open":
        return public_vault(v)
    st = await read_vault_state(v["address"])
    if not st:
        raise HTTPException(409, "Vault not yet visible on-chain — retry in a few seconds")
    if st["vault_id"].hex() != v["vault_id_hex"] or st["pk_hash"].hex() != v["pk_hex"]:
        raise HTTPException(409, "On-chain vault does not match this key — contact support")
    lam, reserve = await ata_info(v["ata"])
    await db.vaults.update_one({"id": v["id"]}, {"$set": {
        "status": "open", "open_tx_sig": body.signature, "opened_at": iso(now()),
        "lamports": lam, "reserve": reserve, "nonce": st["nonce"]}})
    if spendable_of(lam, reserve) > 0:
        await db.transfers.insert_one({
            "id": str(uuid.uuid4()), "kind": "deposit", "sender": user["address"],
            "recipient_owner": user["address"], "to_vault_id": v["id"], "dest_token": v["ata"],
            "amount_lamports": spendable_of(lam, reserve), "tx_sig": body.signature, "status": "completed",
            "created_at": iso(now()), "completed_at": iso(now()),
        })
    return public_vault(await get_vault(user["address"]))


# ----------------------------- recipients -----------------------------
async def resolve_recipient(address: str) -> dict:
    if not valid_solana_address(address):
        raise HTTPException(400, "Invalid Solana address")
    owner = await db.users.find_one({"address": address}, {"_id": 0})
    v = await get_vault(address) if owner else None
    if v and v["status"] == "open":
        return {"kind": "vault", "registered": True, "owner": address, "vault_address": v["address"],
                "token_account": v["ata"], "vault_db_id": v["id"]}
    return {"kind": "wallet", "registered": bool(owner), "owner": None, "vault_address": None,
            "token_account": None, "vault_db_id": None}


@api.get("/resolve/{address}")
async def resolve_endpoint(address: str):
    r = await resolve_recipient(address)
    return {k: r[k] for k in ("kind", "registered", "vault_address")}


# ----------------------------- transfers -----------------------------
def public_transfer(t: dict, viewer: Optional[str] = None) -> dict:
    direction = None
    if viewer:
        if t["kind"] == "deposit":
            direction = "in"
        elif t.get("sender") == viewer and (t.get("recipient_owner") == viewer or t["kind"] in ("withdraw", "withdraw_all")):
            direction = "self"
        elif t.get("sender") == viewer:
            direction = "out"
        else:
            direction = "in"
    return {
        "id": t["id"],
        "kind": t["kind"],                         # send | withdraw | withdraw_all | deposit
        "route": t.get("route"),                   # vault | wallet | close
        "direction": direction,
        "status": t["status"],                     # pending | completed | discarded
        "delivered": t.get("delivered", True),
        "sender": t.get("sender"),
        "to_address": t.get("to_address"),
        "recipient_owner": t.get("recipient_owner"),
        "amount_lamports": t.get("amount_lamports", 0),
        "amount_sol": t.get("amount_lamports", 0) / LPS,
        "nonce": t.get("nonce"),
        "next_pk_hash": t.get("next_pk_hex"),
        "tx_sig": t.get("tx_sig"),
        "deliver_sig": t.get("deliver_sig"),
        "explorer": explorer_tx(t.get("tx_sig")),
        "explorer_deliver": explorer_tx(t.get("deliver_sig")),
        "memo": t.get("memo", ""),
        "created_at": t["created_at"],
        "completed_at": t.get("completed_at"),
    }


def deliver_ixs(t: dict) -> list:
    """Ed25519 step for wallet-route transfers: unwrap the sender's wSOL ATA, forward native SOL."""
    me = t["sender"]
    ixs = [sv.token_close_ix(sv.derive_ata(me), me, me)]
    if t["to_address"] != me:
        ixs.append(sv.system_transfer_ix(me, t["to_address"], t["amount_lamports"]))
    return ixs


async def build_bundle(t: dict) -> dict:
    """Ordered transaction steps for the client. The WOTS signature is fixed for this nonce — retries
    reuse it byte-for-byte, so resubmitting never reveals more of the key."""
    v = await db.vaults.find_one({"id": t["from_vault_id"]}, {"_id": 0})
    me = t["sender"]
    sig = bytes.fromhex(t["sig_hex"])
    npk = bytes.fromhex(t["next_pk_hex"])
    steps = []
    if t["route"] == "close":
        main = sv.vault_execute_close_ix(v["address"], v["ata"], me, npk, sig)
    else:
        dest_owner = t["dest_owner"]
        steps.append({"name": "prepare", "label": "Ensure destination token account",
                      "ixs": [sv.create_ata_idempotent_ix(me, dest_owner)], "cu_limit": None})
        main = sv.vault_transfer_ix(v["address"], v["ata"], t["dest_token"], t["amount_lamports"], npk, sig)
    steps.append({"name": "sign", "label": "Winternitz-signed spend + key rotation",
                  "ixs": [sv.sync_native_ix(v["ata"]), main], "cu_limit": CU_LIMIT,
                  "cu_price": CU_PRICE_MICROLAMPORTS})
    if t["route"] == "wallet":
        steps.append({"name": "deliver", "label": "Unwrap and deliver native SOL",
                      "ixs": deliver_ixs(t), "cu_limit": None})
    return {"transfer": public_transfer(t, me), "fee_payer": me, "program_id": PROGRAM_ID,
            "vault_address": v["address"], "nonce": t["nonce"], "steps": steps}


class PrepareIn(BaseModel):
    to: Optional[str] = None
    amount_sol: Optional[float] = Field(default=None, gt=0)
    mode: str = "send"                      # send | withdraw_all
    memo: Optional[str] = ""
    acknowledge_key_reuse: bool = False


async def _sync_vault_with_chain(v: dict) -> tuple:
    """Return (vault_doc, on-chain state); reconciles a landed pending transfer if needed."""
    st = await read_vault_state(v["address"])
    if not st:
        raise HTTPException(502, "Could not read the vault account on-chain")
    if st["nonce"] != v.get("nonce", 0) or st["pk_hash"].hex() != v["pk_hex"]:
        for t in await db.transfers.find({"from_vault_id": v["id"], "status": "pending"}, {"_id": 0}).to_list(5):
            await finalize_if_landed(t)
        v = await db.vaults.find_one({"id": v["id"]}, {"_id": 0})
        if st["nonce"] != v.get("nonce", 0) or st["pk_hash"].hex() != v["pk_hex"]:
            raise HTTPException(500, "Vault key state is out of sync with the chain")
    return v, st


@api.post("/transfers/prepare")
async def prepare_transfer(body: PrepareIn, user: dict = Depends(current_user)):
    me = user["address"]
    v = await get_vault(me)
    if not v or v["status"] != "open":
        raise HTTPException(400, "Open your quantum vault first")
    if await db.transfers.find_one({"from_vault_id": v["id"], "status": "pending"}):
        raise HTTPException(409, "You have a signed transfer waiting — finish or discard it first")
    v, st = await _sync_vault_with_chain(v)
    if v.get("exposed_nonce") == v["nonce"] and not body.acknowledge_key_reuse:
        raise HTTPException(428, "Your current one-time key already signed a transfer you discarded. "
                                 "Signing a different message with it weakens its quantum security. "
                                 "Confirm to proceed — we recommend moving funds immediately.")
    v = await refresh_balance(v)
    lam = v["lamports"]
    spendable = spendable_of(lam, v.get("reserve"))
    nonce = st["nonce"]
    vault_id = bytes.fromhex(v["vault_id_hex"])
    seed = dec(v["seed_enc"])
    nseed = wntr.new_seed()
    npk = wntr.public_key_hash(nseed)

    t = {"id": str(uuid.uuid4()), "sender": me, "from_vault_id": v["id"], "nonce": nonce,
         "next_seed_enc": enc(nseed), "next_pk_hex": npk.hex(), "memo": (body.memo or "").strip()[:120],
         "status": "pending", "created_at": iso(now())}

    if body.mode == "withdraw_all":
        if spendable <= 0 and lam <= 0:
            raise HTTPException(400, "Nothing to withdraw")
        metas = sv.close_inner_metas(v["address"], v["ata"], me)
        digest = wntr.exec_digest(vault_id, nonce, bytes(sv.TOKEN_PROGRAM_ID), metas, bytes([9]), npk)
        t.update(kind="withdraw_all", route="close", to_address=me, recipient_owner=me, dest_token=None,
                 dest_owner=me, amount_lamports=lam, delivered=True)
    elif body.mode == "send":
        if not body.to or not body.amount_sol:
            raise HTTPException(400, "Recipient address and amount are required")
        to = body.to.strip()
        if not valid_solana_address(to):
            raise HTTPException(400, "Invalid Solana address")
        if to in (v["address"], v["ata"]):
            raise HTTPException(400, "That is your own vault")
        amount = int(round(body.amount_sol * LPS))
        if amount > spendable:
            raise HTTPException(400, f"Insufficient vault balance — spendable {spendable / LPS:.6f} SOL")
        r = {"kind": "wallet"} if to == me else await resolve_recipient(to)
        if r["kind"] == "vault":
            t.update(kind="send", route="vault", to_address=to, recipient_owner=to,
                     to_vault_id=r["vault_db_id"], dest_owner=r["vault_address"], dest_token=r["token_account"],
                     amount_lamports=amount, delivered=True)
        else:
            if to != me:
                acc = await get_account(to)
                if acc and acc.get("owner") != SYSTEM_OWNER:
                    raise HTTPException(400, "Recipient is not a regular wallet address")
                if (not acc or not acc.get("lamports")) and amount < RENT["wallet"]:
                    raise HTTPException(400, f"First transfer to an empty wallet must be at least "
                                             f"{RENT['wallet'] / LPS:.6f} SOL (Solana rent minimum)")
            # wSOL leaves the vault into the sender's own wSOL account, then is unwrapped + forwarded.
            t.update(kind="withdraw" if to == me else "send", route="wallet", to_address=to,
                     recipient_owner=me if to == me else None, dest_owner=me, dest_token=sv.derive_ata(me),
                     amount_lamports=amount, delivered=False)
        digest = wntr.xfer_digest(vault_id, nonce, bytes(Pubkey.from_string(v["ata"])),
                                  bytes(Pubkey.from_string(t["dest_token"])), amount, npk)
    else:
        raise HTTPException(400, "mode must be 'send' or 'withdraw_all'")

    sig = wntr.sign(seed, digest)
    if not wntr.verify(st["pk_hash"], digest, sig):
        raise HTTPException(500, "WOTS signature self-verification failed")
    t["sig_hex"] = sig.hex()
    t["digest_hex"] = digest.hex()
    await db.transfers.insert_one(dict(t))
    return await build_bundle(t)


async def _owned_transfer(tid: str, me: str) -> dict:
    t = await db.transfers.find_one({"id": tid, "sender": me}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Transfer not found")
    return t


@api.get("/transfers/pending")
async def pending_transfer(user: dict = Depends(current_user)):
    t = await db.transfers.find_one({"sender": user["address"], "status": "pending"}, {"_id": 0})
    return {"pending": await build_bundle(t) if t else None}


async def finalize_if_landed(t: dict, tx_sig: Optional[str] = None) -> Optional[dict]:
    """Deterministic: the spend landed iff the on-chain vault nonce advanced to t.nonce+1 with
    pk_hash == t.next_pk. Then the server's live key becomes the next seed."""
    v = await db.vaults.find_one({"id": t["from_vault_id"]}, {"_id": 0})
    st = await read_vault_state(v["address"])
    if not st or st["nonce"] <= t["nonce"]:
        return None
    if st["nonce"] != t["nonce"] + 1 or st["pk_hash"].hex() != t["next_pk_hex"]:
        logger.error(f"vault {v['address']} advanced unexpectedly (nonce {st['nonce']}) for transfer {t['id']}")
        return None
    if v.get("nonce") == t["nonce"]:
        res = await db.vaults.update_one({"id": v["id"], "nonce": t["nonce"]}, {"$set": {
            "seed_enc": t["next_seed_enc"], "pk_hex": t["next_pk_hex"], "nonce": t["nonce"] + 1}})
        if res.modified_count:
            await db.vault_keys.insert_one({"vault_id": v["id"], "nonce": t["nonce"], "pk_hash": v["pk_hex"],
                                            "tx_sig": tx_sig, "transfer_id": t["id"], "retired_at": iso(now())})
    await refresh_balance(await db.vaults.find_one({"id": v["id"]}, {"_id": 0}))
    if t.get("to_vault_id"):
        rv = await db.vaults.find_one({"id": t["to_vault_id"]}, {"_id": 0})
        if rv:
            await refresh_balance(rv)
    upd = {"status": "completed", "completed_at": iso(now())}
    if tx_sig:
        upd["tx_sig"] = tx_sig
    await db.transfers.update_one({"id": t["id"], "status": "pending"}, {"$set": upd})
    return await db.transfers.find_one({"id": t["id"]}, {"_id": 0})


@api.post("/transfers/{tid}/confirm")
async def confirm_transfer(tid: str, body: SigIn, user: dict = Depends(current_user)):
    t = await _owned_transfer(tid, user["address"])
    if t["status"] == "completed":
        if body.signature and not t.get("tx_sig"):
            await db.transfers.update_one({"id": tid}, {"$set": {"tx_sig": body.signature}})
        return public_transfer(await _owned_transfer(tid, user["address"]), user["address"])
    if t["status"] == "discarded":
        raise HTTPException(400, "Transfer was discarded")
    st = await rpc_call("getSignatureStatuses", [[body.signature], {"searchTransactionHistory": True}])
    s = (st.get("value") or [None])[0]
    if s and s.get("err"):
        raise HTTPException(400, f"Transaction failed on-chain: {s['err']}")
    done = await finalize_if_landed(t, body.signature)
    if not done:
        raise HTTPException(409, "Not yet visible on-chain — retrying shortly")
    return public_transfer(done, user["address"])


@api.post("/transfers/{tid}/delivered")
async def confirm_delivered(tid: str, body: SigIn, user: dict = Depends(current_user)):
    t = await _owned_transfer(tid, user["address"])
    if t.get("route") != "wallet" or t["status"] != "completed":
        raise HTTPException(400, "Nothing to deliver for this transfer")
    st = await rpc_call("getSignatureStatuses", [[body.signature], {"searchTransactionHistory": True}])
    s = (st.get("value") or [None])[0]
    if not s or s.get("err") or s.get("confirmationStatus") not in ("confirmed", "finalized"):
        raise HTTPException(409, "Delivery transaction not confirmed yet")
    await db.transfers.update_one({"id": tid}, {"$set": {"delivered": True, "deliver_sig": body.signature}})
    return public_transfer(await _owned_transfer(tid, user["address"]), user["address"])


@api.get("/transfers/{tid}/deliver-ixs")
async def deliver_instructions(tid: str, user: dict = Depends(current_user)):
    t = await _owned_transfer(tid, user["address"])
    if t.get("route") != "wallet" or t["status"] != "completed" or t.get("delivered"):
        raise HTTPException(400, "Nothing to deliver for this transfer")
    return {"transfer": public_transfer(t, user["address"]), "fee_payer": user["address"],
            "steps": [{"name": "deliver", "label": "Unwrap and deliver native SOL", "ixs": deliver_ixs(t),
                       "cu_limit": None}]}


@api.post("/transfers/{tid}/retry")
async def retry_transfer(tid: str, user: dict = Depends(current_user)):
    t = await _owned_transfer(tid, user["address"])
    if t["status"] != "pending":
        raise HTTPException(400, f"Transfer is {t['status']}")
    if await finalize_if_landed(t):
        raise HTTPException(409, "This transfer already landed on-chain — it is now marked completed")
    return await build_bundle(t)


@api.post("/transfers/{tid}/discard")
async def discard_transfer(tid: str, user: dict = Depends(current_user)):
    t = await _owned_transfer(tid, user["address"])
    if t["status"] != "pending":
        raise HTTPException(400, f"Transfer is {t['status']}")
    if await finalize_if_landed(t):
        raise HTTPException(409, "This transfer already landed on-chain — it can't be discarded")
    await db.transfers.update_one({"id": tid}, {"$set": {"status": "discarded", "discarded_at": iso(now())}})
    # The signature may have been broadcast in a failed tx -> treat this nonce's key as exposed.
    await db.vaults.update_one({"id": t["from_vault_id"]}, {"$set": {"exposed_nonce": t["nonce"]}})
    return {"ok": True}


@api.get("/activity")
async def activity(user: dict = Depends(current_user)):
    me = user["address"]
    docs = await db.transfers.find({"$or": [{"sender": me}, {"recipient_owner": me}],
                                    "status": {"$in": ["completed", "pending"]}},
                                   {"_id": 0}).sort("created_at", -1).to_list(300)
    return [public_transfer(d, me) for d in docs if d.get("sender") == me or d["status"] == "completed"]


# ----------------------------- public pay / deposits -----------------------------
@api.get("/pay/{address}")
async def pay_info(address: str):
    if not valid_solana_address(address):
        raise HTTPException(400, "Invalid Solana address")
    owner = await db.users.find_one({"address": address}, {"_id": 0})
    v = await get_vault(address) if owner else None
    has_vault = bool(v and v["status"] == "open")
    return {"address": address, "registered": bool(owner), "has_vault": has_vault,
            "vault_address": v["address"] if has_vault else None,
            "token_account": v["ata"] if has_vault else None,
            "nonce": v.get("nonce") if has_vault else None,
            "usd_rate": await fetch_sol_usd()}


class DepositIxIn(BaseModel):
    payer: str
    amount_sol: float = Field(gt=0)


@api.post("/pay/{address}/deposit-ixs")
async def deposit_ixs(address: str, body: DepositIxIn):
    """Instructions for any Phantom user to deposit into `address`'s vault: create the vault's wSOL
    account if needed, transfer SOL into it, sync. Plain SOL never touches the vault PDA itself."""
    if not valid_solana_address(address) or not valid_solana_address(body.payer):
        raise HTTPException(400, "Invalid Solana address")
    v = await get_vault(address)
    if not v or v["status"] != "open":
        raise HTTPException(404, "This address has no open quantum vault")
    lam = int(round(body.amount_sol * LPS))
    return {"fee_payer": body.payer, "vault_address": v["address"], "token_account": v["ata"],
            "amount_lamports": lam,
            "ixs": [sv.create_ata_idempotent_ix(body.payer, v["address"]),
                    sv.system_transfer_ix(body.payer, v["ata"], lam), sv.sync_native_ix(v["ata"])]}


class DepositIn(BaseModel):
    signature: str
    memo: Optional[str] = ""


@api.post("/deposits/record")
async def record_deposit(body: DepositIn):
    """Attribute a deposit by reading the confirmed transaction's balance changes on vault token accounts."""
    if await db.transfers.find_one({"kind": "deposit", "tx_sig": body.signature}):
        return {"ok": True, "duplicate": True}
    tx = None
    for _ in range(4):
        tx = await rpc_call("getTransaction", [body.signature, {"encoding": "json", "commitment": "confirmed",
                                                                "maxSupportedTransactionVersion": 0}])
        if tx:
            break
        await asyncio.sleep(2)
    if not tx:
        raise HTTPException(404, "Transaction not found yet")
    if (tx.get("meta") or {}).get("err"):
        raise HTTPException(400, "Transaction failed on-chain")
    keys = tx["transaction"]["message"]["accountKeys"]
    keys = [k if isinstance(k, str) else k.get("pubkey") for k in keys]
    pre, post = tx["meta"]["preBalances"], tx["meta"]["postBalances"]
    recorded = []
    for i, k in enumerate(keys):
        v = await db.vaults.find_one({"ata": k, "status": "open"}, {"_id": 0})
        if not v:
            continue
        delta = post[i] - pre[i]
        if pre[i] == 0:
            delta -= (await ata_info(k))[1] or RENT["token"]  # account created in this tx; rent isn't a deposit
        if delta <= 0:
            continue
        anon = await db.transfers.find_one({"kind": "deposit", "to_vault_id": v["id"], "tx_sig": None,
                                            "amount_lamports": delta}, {"_id": 0})
        if anon:
            await db.transfers.update_one({"id": anon["id"]}, {"$set": {
                "tx_sig": body.signature, "sender": keys[0], "memo": (body.memo or "")[:120]}})
        else:
            await db.transfers.insert_one({
                "id": str(uuid.uuid4()), "kind": "deposit", "sender": keys[0], "recipient_owner": v["owner"],
                "to_vault_id": v["id"], "dest_token": v["ata"], "amount_lamports": delta,
                "tx_sig": body.signature, "memo": (body.memo or "")[:120], "status": "completed",
                "created_at": iso(now()), "completed_at": iso(now()),
            })
            await refresh_balance(v)
        recorded.append({"vault": v["address"], "amount_sol": delta / LPS})
    return {"ok": True, "recorded": recorded}


# ----------------------------- misc -----------------------------
@api.get("/price")
async def price():
    return {"sol_usd": await fetch_sol_usd()}


RPC_PROXY_METHODS = {
    "getLatestBlockhash", "getSignatureStatuses", "getBalance", "getAccountInfo",
    "getMinimumBalanceForRentExemption", "getFeeForMessage", "getBlockHeight", "getSlot",
    "getEpochInfo", "getVersion", "getGenesisHash", "simulateTransaction", "isBlockhashValid",
    "getRecentPrioritizationFees", "getMultipleAccounts", "getTransaction", "sendTransaction",
}


@api.post("/rpc")
async def rpc_proxy(payload: dict):
    """Browser-safe Solana JSON-RPC proxy (mainnet public RPC returns 403 to browser origins)."""
    method = payload.get("method") if isinstance(payload, dict) else None
    if method not in RPC_PROXY_METHODS:
        raise HTTPException(400, f"RPC method not allowed: {method}")
    return await rpc_raw({"jsonrpc": "2.0", "id": payload.get("id", 1), "method": method,
                          "params": payload.get("params", [])})


@api.get("/config")
async def config():
    return {
        "cluster": CLUSTER,
        "rpc_url": RPC_URL,
        "program_id": PROGRAM_ID,
        "explorer_program": explorer_address(PROGRAM_ID),
        "program_source": "https://github.com/rabb757/winternitz-vault",
        "vault_rent_lamports": RENT["vault"],
        "token_rent_lamports": RENT["token"],
        "wallet_rent_lamports": RENT["wallet"],
        "cu_limit": CU_LIMIT,
        "cu_price_microlamports": CU_PRICE_MICROLAMPORTS,
        "wots": {"n": wntr.N, "chains": wntr.CHUNKS, "sig_len": wntr.SIG_LEN, "checksum_chunks": wntr.SUM_CHUNKS},
    }


@api.get("/")
async def root():
    return {"service": "QuantumPOS transaction layer", "status": "ok", "cluster": CLUSTER}


# ----------------------------- background watcher -----------------------------
async def watcher_tick():
    # 1) reconcile signed transfers that landed (deterministic nonce check)
    for t in await db.transfers.find({"status": "pending"}, {"_id": 0}).to_list(200):
        try:
            await finalize_if_landed(t)
        except Exception as e:
            logger.warning(f"watcher transfer {t['id']}: {e}")
        await asyncio.sleep(0.5)
    # 2) detect outside deposits into vault token accounts
    for v in await db.vaults.find({"status": "open"}, {"_id": 0}).to_list(500):
        try:
            busy = await db.transfers.find_one({"status": "pending", "$or": [
                {"from_vault_id": v["id"]}, {"dest_token": v["ata"]}]})
            if busy:
                continue  # in-app transfer in flight; finalize_if_landed reconciles the balance
            bal, reserve = await ata_info(v["ata"])
            prev = v.get("lamports") or 0
            delta = bal - prev
            if prev == 0 and bal > 0:
                delta = bal - reserve  # account (re)created; its rent isn't a deposit
            if delta > 0:
                await db.transfers.insert_one({
                    "id": str(uuid.uuid4()), "kind": "deposit", "sender": None, "recipient_owner": v["owner"],
                    "to_vault_id": v["id"], "dest_token": v["ata"], "amount_lamports": delta, "tx_sig": None,
                    "status": "completed", "created_at": iso(now()), "completed_at": iso(now()),
                })
            if bal != prev:
                await db.vaults.update_one({"id": v["id"]}, {"$set": {"lamports": bal, **({"reserve": reserve} if bal else {})}})
        except Exception as e:
            logger.warning(f"watcher vault {v['address']}: {e}")
        await asyncio.sleep(1.0)


async def watcher_loop():
    await asyncio.sleep(10)
    while True:
        try:
            await watcher_tick()
        except Exception as e:
            logger.warning(f"watcher error: {e}")
        await asyncio.sleep(30)


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup():
    await db.challenges.create_index("expires_at", expireAfterSeconds=0)
    await db.vaults.create_index("owner", unique=True)
    await db.vaults.create_index("ata")
    await db.transfers.create_index("sender")
    await db.transfers.create_index("recipient_owner")
    for key, size in (("wallet", 0), ("vault", sv.VAULT_LEN), ("token", 165)):
        try:
            RENT[key] = await rpc_call("getMinimumBalanceForRentExemption", [size])
        except Exception as e:
            logger.warning(f"rent fetch failed ({key}): {e}")
    logger.info(f"rent-exempt minimums: {RENT}")
    asyncio.create_task(watcher_loop())
    logger.info(f"QuantumPOS transaction layer started on cluster={CLUSTER}")


@app.on_event("shutdown")
async def _shutdown():
    client.close()
