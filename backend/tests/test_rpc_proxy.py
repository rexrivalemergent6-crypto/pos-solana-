"""QuantumPOS: /api/rpc proxy tests — verifies browser-safe JSON-RPC forwarding."""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
# Realistic browser Origin to prove our proxy doesn't 403 even when the request looks browser-ish.
BROWSER_HEADERS = {
    "Origin": "https://canvas-los.preview.emergentagent.com",
    "Referer": "https://canvas-los.preview.emergentagent.com/",
    "Content-Type": "application/json",
}


def rpc(method, params, _id=1):
    return requests.post(
        f"{BASE_URL}/rpc",
        json={"jsonrpc": "2.0", "id": _id, "method": method, "params": params},
        headers=BROWSER_HEADERS,
        timeout=30,
    )


class TestRpcProxy:
    def test_get_latest_blockhash(self):
        r = rpc("getLatestBlockhash", [{"commitment": "confirmed"}])
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("jsonrpc") == "2.0"
        assert "error" not in data, data
        bh = data["result"]["value"]["blockhash"]
        assert isinstance(bh, str) and len(bh) >= 32
        assert isinstance(data["result"]["value"]["lastValidBlockHeight"], int)

    def test_get_block_height(self):
        r = rpc("getBlockHeight", [{"commitment": "confirmed"}])
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data["result"], int)
        assert data["result"] > 0

    def test_get_balance(self):
        # system program is a valid pubkey with 1 lamport balance on mainnet.
        r = rpc("getBalance", ["11111111111111111111111111111111", {"commitment": "confirmed"}])
        assert r.status_code == 200, r.text
        data = r.json()
        assert "value" in data["result"]
        assert isinstance(data["result"]["value"], int)

    def test_get_signature_statuses_unknown(self):
        # Random, well-formed base58 signature that definitely doesn't exist on-chain.
        fake_sig = "4" * 88
        r = rpc("getSignatureStatuses", [[fake_sig], {"searchTransactionHistory": False}])
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["result"]["value"] == [None]

    def test_disallowed_method_rejected(self):
        r = rpc("requestAirdrop", ["11111111111111111111111111111111", 1])
        assert r.status_code == 400, r.text
        assert "not allowed" in r.text.lower()

    def test_missing_method_rejected(self):
        r = requests.post(f"{BASE_URL}/rpc", json={"jsonrpc": "2.0", "id": 1}, headers=BROWSER_HEADERS, timeout=15)
        assert r.status_code == 400
