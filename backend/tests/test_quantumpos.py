"""QuantumPOS backend tests: auth, invoices, open/settle instruction bytes, checkout, stats, csv, config."""
import base64
import os
import time
import pytest
import requests
import base58
from nacl.signing import SigningKey

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://canvas-los.preview.emergentagent.com").rstrip("/") + "/api"


# ---------- helpers ----------
def new_wallet():
    sk = SigningKey.generate()
    addr = base58.b58encode(bytes(sk.verify_key)).decode()
    return sk, addr


def login(sk, addr):
    r = requests.post(f"{BASE_URL}/auth/challenge", json={"address": addr}, timeout=20)
    assert r.status_code == 200, r.text
    msg = r.json()["message"]
    sig = base58.b58encode(sk.sign(msg.encode()).signature).decode()
    r = requests.post(f"{BASE_URL}/auth/verify",
                      json={"address": addr, "message": msg, "signature": sig}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"], msg, sig


@pytest.fixture(scope="module")
def auth():
    sk, addr = new_wallet()
    token, msg, sig = login(sk, addr)
    return {"sk": sk, "addr": addr, "token": token, "headers": {"Authorization": f"Bearer {token}"}}


# ---------- auth ----------
class TestAuth:
    def test_challenge_invalid_address(self):
        r = requests.post(f"{BASE_URL}/auth/challenge", json={"address": "not-base58-!!"}, timeout=20)
        assert r.status_code == 400

    def test_challenge_ok(self):
        _, addr = new_wallet()
        r = requests.post(f"{BASE_URL}/auth/challenge", json={"address": addr}, timeout=20)
        assert r.status_code == 200
        assert "Nonce:" in r.json()["message"]
        assert addr in r.json()["message"]

    def test_verify_wrong_signature(self):
        sk, addr = new_wallet()
        msg = requests.post(f"{BASE_URL}/auth/challenge", json={"address": addr}, timeout=20).json()["message"]
        # sign a different message
        sig = base58.b58encode(sk.sign(b"not the real message").signature).decode()
        r = requests.post(f"{BASE_URL}/auth/verify",
                          json={"address": addr, "message": msg, "signature": sig}, timeout=20)
        assert r.status_code == 401

    def test_verify_tampered_message(self):
        sk, addr = new_wallet()
        msg = requests.post(f"{BASE_URL}/auth/challenge", json={"address": addr}, timeout=20).json()["message"]
        sig = base58.b58encode(sk.sign(msg.encode()).signature).decode()
        tampered = msg.replace("QuantumPOS", "EvilPOS")
        r = requests.post(f"{BASE_URL}/auth/verify",
                          json={"address": addr, "message": tampered, "signature": sig}, timeout=20)
        assert r.status_code == 401

    def test_verify_replay(self):
        sk, addr = new_wallet()
        msg = requests.post(f"{BASE_URL}/auth/challenge", json={"address": addr}, timeout=20).json()["message"]
        sig = base58.b58encode(sk.sign(msg.encode()).signature).decode()
        r1 = requests.post(f"{BASE_URL}/auth/verify",
                           json={"address": addr, "message": msg, "signature": sig}, timeout=20)
        assert r1.status_code == 200
        r2 = requests.post(f"{BASE_URL}/auth/verify",
                           json={"address": addr, "message": msg, "signature": sig}, timeout=20)
        assert r2.status_code == 401

    def test_verify_unknown_challenge(self):
        sk, addr = new_wallet()
        # Build a plausible message without ever registering a challenge
        fake = f"domain wants you to sign in with your Solana account:\n{addr}\n\nNonce: zzzz\n"
        sig = base58.b58encode(sk.sign(fake.encode()).signature).decode()
        r = requests.post(f"{BASE_URL}/auth/verify",
                          json={"address": addr, "message": fake, "signature": sig}, timeout=20)
        assert r.status_code == 401

    def test_verify_invalid_address(self):
        r = requests.post(f"{BASE_URL}/auth/verify",
                          json={"address": "bad!!", "message": "x", "signature": "y"}, timeout=20)
        # Spec says invalid address returns 400 on /challenge; /verify uses 401
        assert r.status_code in (400, 401)

    def test_me_without_token(self):
        r = requests.get(f"{BASE_URL}/auth/me", timeout=20)
        assert r.status_code == 401

    def test_me_with_bad_token(self):
        r = requests.get(f"{BASE_URL}/auth/me", headers={"Authorization": "Bearer not.a.jwt"}, timeout=20)
        assert r.status_code == 401

    def test_me_ok(self, auth):
        r = requests.get(f"{BASE_URL}/auth/me", headers=auth["headers"], timeout=20)
        assert r.status_code == 200
        assert r.json()["address"] == auth["addr"]


# ---------- profile ----------
class TestProfile:
    def test_update_profile_ok(self, auth):
        _, new_payout = new_wallet()
        r = requests.put(f"{BASE_URL}/merchant/profile",
                         headers=auth["headers"],
                         json={"business_name": "TEST_Shop", "payout_address": new_payout}, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data["business_name"] == "TEST_Shop"
        assert data["payout_address"] == new_payout
        # reset payout to login address for later settle tests
        r = requests.put(f"{BASE_URL}/merchant/profile",
                         headers=auth["headers"],
                         json={"payout_address": auth["addr"]}, timeout=20)
        assert r.status_code == 200

    def test_update_profile_invalid_payout(self, auth):
        r = requests.put(f"{BASE_URL}/merchant/profile",
                         headers=auth["headers"],
                         json={"payout_address": "not-valid"}, timeout=20)
        assert r.status_code == 400


# ---------- invoices + instruction bytes ----------
class TestInvoices:
    def test_create_invoice_validation(self, auth):
        r = requests.post(f"{BASE_URL}/invoices", headers=auth["headers"],
                          json={"amount_sol": 0}, timeout=20)
        assert r.status_code == 422
        r = requests.post(f"{BASE_URL}/invoices", headers=auth["headers"],
                          json={"amount_sol": 1.0, "expiry_minutes": 1}, timeout=20)
        assert r.status_code == 422
        r = requests.post(f"{BASE_URL}/invoices", headers=auth["headers"],
                          json={"amount_sol": 1.0, "expiry_minutes": 9999}, timeout=20)
        assert r.status_code == 422

    def test_full_invoice_lifecycle(self, auth):
        # create
        r = requests.post(f"{BASE_URL}/invoices", headers=auth["headers"],
                          json={"amount_sol": 0.123456789, "memo": "TEST_inv", "expiry_minutes": 10},
                          timeout=20)
        assert r.status_code == 200, r.text
        inv = r.json()
        assert inv["status"] == "created"
        assert inv["amount_lamports"] == round(0.123456789 * 1e9)
        assert len(inv["merkle_root"]) == 64
        int(inv["merkle_root"], 16)  # must be hex
        assert isinstance(inv["bump"], int)
        assert inv["vault_address"]
        assert inv["solana_pay_url"].startswith("solana:")
        inv_id = inv["id"]

        # GET by id
        r = requests.get(f"{BASE_URL}/invoices/{inv_id}", headers=auth["headers"], timeout=20)
        assert r.status_code == 200
        assert r.json()["id"] == inv_id

        # list
        r = requests.get(f"{BASE_URL}/invoices", headers=auth["headers"], timeout=20)
        assert r.status_code == 200
        ids = [d["id"] for d in r.json()]
        assert inv_id in ids
        # newest first
        if len(ids) > 1:
            created_dates = [d["created_at"] for d in r.json()]
            assert created_dates == sorted(created_dates, reverse=True)

        # open-tx: 34 bytes = 0 + 32 root + 1 bump
        r = requests.get(f"{BASE_URL}/invoices/{inv_id}/open-tx", headers=auth["headers"], timeout=20)
        assert r.status_code == 200, r.text
        ix = r.json()["instruction"]
        data = base64.b64decode(ix["data"])
        assert len(data) == 34
        assert data[0] == 0
        assert data[1:33].hex() == inv["merkle_root"]
        assert data[33] == inv["bump"]
        assert len(ix["keys"]) == 3
        assert ix["keys"][0]["isSigner"] and ix["keys"][0]["isWritable"]
        assert (not ix["keys"][1]["isSigner"]) and ix["keys"][1]["isWritable"]
        assert (not ix["keys"][2]["isSigner"]) and (not ix["keys"][2]["isWritable"])

        # confirm-open
        r = requests.post(f"{BASE_URL}/invoices/{inv_id}/confirm-open",
                          headers=auth["headers"], json={"signature": "FAKE_OPEN_SIG"}, timeout=20)
        assert r.status_code == 200
        assert r.json()["status"] == "active"

        # open-tx again should fail now
        r = requests.get(f"{BASE_URL}/invoices/{inv_id}/open-tx", headers=auth["headers"], timeout=20)
        assert r.status_code == 400

        # settle-tx: 898 bytes = 2 + 896 sig + 1 bump; 2 keys
        r = requests.get(f"{BASE_URL}/invoices/{inv_id}/settle-tx", headers=auth["headers"], timeout=20)
        assert r.status_code == 200, r.text
        ix = r.json()["instruction"]
        data = base64.b64decode(ix["data"])
        assert len(data) == 898
        assert data[0] == 2
        assert data[-1] == inv["bump"]
        assert len(ix["keys"]) == 2
        assert (not ix["keys"][0]["isSigner"]) and ix["keys"][0]["isWritable"]
        assert ix["keys"][1]["isSigner"] and ix["keys"][1]["isWritable"]

        # confirm-settle
        r = requests.post(f"{BASE_URL}/invoices/{inv_id}/confirm-settle",
                          headers=auth["headers"], json={"signature": "FAKE_CLOSE_SIG"}, timeout=20)
        assert r.status_code == 200
        assert r.json()["status"] == "settled"
        assert r.json()["key_used"] is True

        # settle-tx now blocked (one-time key guard)
        r = requests.get(f"{BASE_URL}/invoices/{inv_id}/settle-tx", headers=auth["headers"], timeout=20)
        assert r.status_code == 400

    def test_get_other_invoice_404(self, auth):
        # create as this merchant
        r = requests.post(f"{BASE_URL}/invoices", headers=auth["headers"],
                          json={"amount_sol": 0.01}, timeout=20)
        inv_id = r.json()["id"]
        # new merchant tries to access
        sk2, addr2 = new_wallet()
        token2, _, _ = login(sk2, addr2)
        r = requests.get(f"{BASE_URL}/invoices/{inv_id}",
                         headers={"Authorization": f"Bearer {token2}"}, timeout=20)
        assert r.status_code == 404
        r = requests.get(f"{BASE_URL}/invoices/does-not-exist",
                         headers=auth["headers"], timeout=20)
        assert r.status_code == 404

    def test_check_payment_no_crash(self, auth):
        r = requests.post(f"{BASE_URL}/invoices", headers=auth["headers"],
                          json={"amount_sol": 0.01, "expiry_minutes": 5}, timeout=20)
        inv_id = r.json()["id"]
        # move to active
        requests.post(f"{BASE_URL}/invoices/{inv_id}/confirm-open",
                      headers=auth["headers"], json={"signature": "x"}, timeout=20)
        r = requests.post(f"{BASE_URL}/invoices/{inv_id}/check-payment",
                          headers=auth["headers"], timeout=40)
        assert r.status_code == 200, r.text
        assert r.json()["status"] in ("active", "created", "underpaid", "expired", "paid", "overpaid")


# ---------- checkout / stats / csv / config ----------
class TestPublicAndMisc:
    def test_checkout_public(self, auth):
        r = requests.post(f"{BASE_URL}/invoices", headers=auth["headers"],
                          json={"amount_sol": 0.02, "memo": "TEST_pub"}, timeout=20)
        inv_id = r.json()["id"]
        r = requests.get(f"{BASE_URL}/checkout/{inv_id}", timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "merchant_name" in body
        assert body["solana_pay_url"].startswith("solana:")
        r = requests.post(f"{BASE_URL}/checkout/{inv_id}/check", timeout=40)
        assert r.status_code == 200
        r = requests.get(f"{BASE_URL}/checkout/unknown-id", timeout=20)
        assert r.status_code == 404

    def test_stats(self, auth):
        r = requests.get(f"{BASE_URL}/stats", headers=auth["headers"], timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert "total_invoices" in d
        assert "by_status" in d and isinstance(d["by_status"], dict)
        assert "settled_sol" in d and "pending_sol" in d

    def test_csv_export(self, auth):
        r = requests.get(f"{BASE_URL}/invoices/export/csv", headers=auth["headers"], timeout=20)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        lines = r.text.strip().splitlines()
        assert lines[0].startswith("Invoice ID,")
        assert len(lines) >= 2  # header + at least 1 invoice

    def test_config(self):
        r = requests.get(f"{BASE_URL}/config", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["cluster"] == "mainnet-beta"
        assert d["program_id"] == "13EtnfYGUH8NaGAnUpDTVgSsXoewNnULp7ESwHzQUANT"
        assert "rpc_url" in d
        assert d["rent_lamports"] == 890880
