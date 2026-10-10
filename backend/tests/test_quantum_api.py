"""Backend contract tests for the quantum-safe transaction layer (QuantumPOS).

Covers:
  * /api/config shape (program_id, live rent values)
  * SIWS /api/auth/challenge + /api/auth/verify end-to-end using pynacl keypair
  * /api/auth/me (and 401 w/o token)
  * /api/vault (null before create), /api/vault/create (idempotent + ixs shape),
    /api/vault/confirm-open 409 when not on-chain
  * /api/resolve/{addr} (vault/wallet kinds)
  * /api/pay/{addr} + /api/pay/{addr}/deposit-ixs 404 w/o open vault
  * /api/transfers/prepare 400 "Open your quantum vault first"
  * /api/activity, /api/vault/keys
  * /api/rpc allow-list (getLatestBlockhash OK, requestAirdrop 400, missing method 400)
"""
import os
import time
import uuid
import pytest
import requests
import base58
from nacl.signing import SigningKey

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


# ---------- helpers / fixtures ----------
def _ed_pair():
    sk = SigningKey.generate()
    pk = bytes(sk.verify_key)
    addr = base58.b58encode(pk).decode()
    return sk, addr


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def user(session):
    """Create a fresh authenticated user via real SIWS Ed25519 signing."""
    sk, addr = _ed_pair()
    r = session.post(f"{API}/auth/challenge", json={"address": addr})
    assert r.status_code == 200, r.text
    msg = r.json()["message"]
    sig = sk.sign(msg.encode("utf-8")).signature
    r = session.post(f"{API}/auth/verify",
                     json={"address": addr, "message": msg,
                           "signature": base58.b58encode(sig).decode()})
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    return {"address": addr, "token": tok, "sk": sk,
            "auth": {"Authorization": f"Bearer {tok}"}}


# ---------- /api/config ----------
class TestConfig:
    def test_config_fields(self, session):
        r = session.get(f"{API}/config")
        assert r.status_code == 200
        d = r.json()
        assert d["program_id"] == "13EtnfYGUH8NaGAnUpDTVgSsXoewNnULp7ESwHzQUANT"
        # Live rent values should be plausible positive integers
        for k in ("vault_rent_lamports", "token_rent_lamports", "wallet_rent_lamports"):
            assert isinstance(d[k], int) and d[k] > 0, f"{k} invalid: {d.get(k)}"
        # vault rent is ~0.00119 SOL  → 1_000_000..2_000_000 range sanity-check
        assert 500_000 < d["vault_rent_lamports"] < 5_000_000
        assert 500_000 < d["token_rent_lamports"] < 5_000_000
        assert d["wots"]["sig_len"] == 816


# ---------- auth ----------
class TestAuth:
    def test_challenge_invalid_address(self, session):
        r = session.post(f"{API}/auth/challenge", json={"address": "nope"})
        assert r.status_code == 400

    def test_verify_wrong_signature(self, session):
        _, addr = _ed_pair()
        r = session.post(f"{API}/auth/challenge", json={"address": addr})
        assert r.status_code == 200
        msg = r.json()["message"]
        bogus = base58.b58encode(b"\x00" * 64).decode()
        r = session.post(f"{API}/auth/verify",
                         json={"address": addr, "message": msg, "signature": bogus})
        assert r.status_code == 401

    def test_challenge_consumed_once(self, session):
        sk, addr = _ed_pair()
        r = session.post(f"{API}/auth/challenge", json={"address": addr})
        msg = r.json()["message"]
        sig = base58.b58encode(sk.sign(msg.encode()).signature).decode()
        r1 = session.post(f"{API}/auth/verify",
                          json={"address": addr, "message": msg, "signature": sig})
        assert r1.status_code == 200
        r2 = session.post(f"{API}/auth/verify",
                          json={"address": addr, "message": msg, "signature": sig})
        assert r2.status_code == 401  # challenge was deleted on first use

    def test_me_requires_token(self, session):
        assert session.get(f"{API}/auth/me").status_code == 401

    def test_me_returns_user(self, session, user):
        r = session.get(f"{API}/auth/me", headers=user["auth"])
        assert r.status_code == 200
        assert r.json()["address"] == user["address"]


# ---------- vault ----------
class TestVault:
    def test_vault_requires_auth(self, session):
        assert session.get(f"{API}/vault").status_code == 401

    def test_vault_null_before_create(self, session, user):
        r = session.get(f"{API}/vault", headers=user["auth"])
        assert r.status_code == 200
        d = r.json()
        assert d["vault"] is None
        assert d["token_rent_lamports"] > 0
        assert d["vault_rent_lamports"] > 0

    def test_create_vault_is_idempotent(self, session, user):
        r1 = session.post(f"{API}/vault/create", json={}, headers=user["auth"])
        assert r1.status_code == 200, r1.text
        v1 = r1.json()
        assert v1["vault"]["status"] == "created"
        assert v1["vault"]["owner"] == user["address"]
        assert v1["cost_lamports"] > 0
        assert isinstance(v1["ixs"], list) and len(v1["ixs"]) >= 2
        # repeat → same vault address (idempotent)
        r2 = session.post(f"{API}/vault/create", json={}, headers=user["auth"])
        assert r2.status_code == 200
        assert r2.json()["vault"]["address"] == v1["vault"]["address"]

    def test_confirm_open_409_when_not_on_chain(self, session, user):
        r = session.post(f"{API}/vault/confirm-open",
                         json={"signature": "SIM" + "1" * 60}, headers=user["auth"])
        # Vault is created in DB but not on mainnet → read_vault_state returns None → 409
        assert r.status_code == 409

    def test_vault_keys_empty_live_only(self, session, user):
        r = session.get(f"{API}/vault/keys", headers=user["auth"])
        assert r.status_code == 200
        keys = r.json()
        assert isinstance(keys, list) and len(keys) == 1
        assert keys[0]["status"] == "live" and keys[0]["nonce"] == 0

    def test_activity_empty(self, session, user):
        r = session.get(f"{API}/activity", headers=user["auth"])
        assert r.status_code == 200
        assert r.json() == []


# ---------- resolve + pay ----------
class TestResolve:
    def test_invalid_address_400(self, session):
        assert session.get(f"{API}/resolve/notanaddress").status_code == 400

    def test_resolve_wallet_kind(self, session):
        # System program address — valid b58 but has no vault
        r = session.get(f"{API}/resolve/11111111111111111111111111111111")
        assert r.status_code == 200
        d = r.json()
        assert d["kind"] == "wallet"
        assert d["vault_address"] is None


class TestPay:
    def test_pay_info_no_vault(self, session):
        r = session.get(f"{API}/pay/11111111111111111111111111111111")
        assert r.status_code == 200
        d = r.json()
        assert d["has_vault"] is False and d["vault_address"] is None

    def test_pay_invalid_address(self, session):
        assert session.get(f"{API}/pay/notavalidaddr").status_code == 400

    def test_deposit_ixs_404_without_open_vault(self, session, user):
        # User has a "created" vault, not "open" → 404 from this endpoint
        r = session.post(f"{API}/pay/{user['address']}/deposit-ixs",
                         json={"payer": user["address"], "amount_sol": 0.1})
        assert r.status_code == 404


# ---------- transfers ----------
class TestTransfers:
    def test_prepare_requires_open_vault(self, session, user):
        r = session.post(f"{API}/transfers/prepare",
                         json={"mode": "send", "to": "11111111111111111111111111111111",
                               "amount_sol": 0.01},
                         headers=user["auth"])
        assert r.status_code == 400
        assert "Open your quantum vault" in r.text

    def test_prepare_requires_auth(self, session):
        r = session.post(f"{API}/transfers/prepare",
                         json={"mode": "send", "to": "x", "amount_sol": 0.01})
        assert r.status_code == 401


# ---------- rpc proxy ----------
class TestRpcProxy:
    def test_missing_method_rejected(self, session):
        r = session.post(f"{API}/rpc", json={"params": []})
        assert r.status_code == 400

    def test_disallowed_method_rejected(self, session):
        r = session.post(f"{API}/rpc",
                         json={"method": "requestAirdrop", "params": []})
        assert r.status_code == 400

    def test_latest_blockhash_allowed(self, session):
        r = session.post(f"{API}/rpc",
                         json={"method": "getLatestBlockhash", "params": []})
        assert r.status_code == 200
        d = r.json()
        assert "result" in d
        bh = d["result"]["value"]["blockhash"]
        assert isinstance(bh, str) and len(bh) >= 32

    def test_get_block_height_allowed(self, session):
        r = session.post(f"{API}/rpc",
                         json={"method": "getBlockHeight", "params": []})
        assert r.status_code == 200
        assert isinstance(r.json()["result"], int)


# ---------- /api/price (sanity) ----------
class TestPrice:
    def test_price_endpoint(self, session):
        r = session.get(f"{API}/price")
        assert r.status_code == 200
        assert "sol_usd" in r.json()


# ---------- cleanup ----------
@pytest.fixture(scope="module", autouse=True)
def _cleanup(user):
    """Remove the test vault/user docs after the module runs."""
    yield
    try:
        from pymongo import MongoClient
        from pathlib import Path
        from dotenv import dotenv_values
        env = dotenv_values(Path("/app/backend/.env"))
        cli = MongoClient(env["MONGO_URL"])
        db = cli[env["DB_NAME"]]
        addr = user["address"]
        db.vaults.delete_many({"owner": addr})
        db.users.delete_many({"address": addr})
        db.challenges.delete_many({"address": addr})
        db.transfers.delete_many({"sender": addr})
        cli.close()
    except Exception as e:
        print(f"cleanup warn: {e}")
