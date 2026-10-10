"""E2E: real API endpoints + real mainnet program bytecode (LiteSVM). Uses tests/fixtures/wntr_mainnet.so (dumped from mainnet programdata 8fqkcUx5MQYccfPXsiYRJKz8mKxbMRWdkD8TutMRMZWu).
Run: cd /app/backend && DB_NAME=qpos_e2e python tests/e2e_litesvm.py"""
import os, sys, base64, asyncio
os.environ["DB_NAME"] = "qpos_e2e"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import httpx
from solders.litesvm import LiteSVM
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.account import Account
from solders.instruction import Instruction, AccountMeta
from solders.message import Message
from solders.transaction import Transaction
from solders.compute_budget import set_compute_unit_limit, set_compute_unit_price
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
import server, solana_vault as sv

svm = LiteSVM(); svm.add_program(sv.PROGRAM_ID, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "wntr_mainnet.so"), "rb").read())
_m = httpx.post("https://solana-rpc.publicnode.com", json={"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":[str(sv.NATIVE_MINT),{"encoding":"base64"}]}).json()["result"]["value"]
svm.set_account(sv.NATIVE_MINT, Account(lamports=_m["lamports"], data=base64.b64decode(_m["data"][0]), owner=sv.TOKEN_PROGRAM_ID, executable=False, rent_epoch=0))

async def fake_rpc(method, params):
    if method == "getAccountInfo":
        a = svm.get_account(Pubkey.from_string(params[0]))
        if a is None or a.lamports == 0: return {"value": None}
        return {"value": {"owner": str(a.owner), "lamports": a.lamports, "data": [base64.b64encode(bytes(a.data)).decode(), "base64"]}}
    if method == "getBalance":
        return {"value": svm.get_balance(Pubkey.from_string(params[0])) or 0}
    if method == "getMinimumBalanceForRentExemption":
        return svm.minimum_balance_for_rent_exemption(params[0])
    if method == "getSignatureStatuses":
        return {"value": [{"confirmationStatus": "confirmed", "err": None}]}
    raise RuntimeError(method)
server.rpc_call = fake_rpc
async def _price(): return 150.0
server.fetch_sol_usd = _price

def ix(d): return Instruction(Pubkey.from_string(d["programId"]), base64.b64decode(d["data"]),
     [AccountMeta(Pubkey.from_string(k["pubkey"]), k["isSigner"], k["isWritable"]) for k in d["keys"]])
P, F = [0], [0]
def check(label, ok, extra=""):
    (P if ok else F)[0] += 1; print(("PASS " if ok else "FAIL ") + label, extra)
def run(kp, ixs, cu=None, price=None):
    ii = [ix(d) for d in ixs]
    if price: ii = [set_compute_unit_price(price)] + ii
    if cu: ii = [set_compute_unit_limit(cu)] + ii
    tx = Transaction([kp], Message(ii, kp.pubkey()), svm.latest_blockhash())
    r = svm.send_transaction(tx); svm.expire_blockhash()
    ok = not hasattr(r, "err")
    if not ok: print("   tx err", r.err(), r.meta().logs()[-3:])
    return ok, str(tx.signatures[0]), len(bytes(tx))
def run_bundle(kp, b, stop_before=None):
    sigs = {}
    for st in b["steps"]:
        if st["name"] == stop_before: break
        ok, sig, size = run(kp, st["ixs"], st.get("cu_limit"), st.get("cu_price"))
        sigs[st["name"]] = (ok, sig, size)
        if not ok: break
    return sigs

def user():
    kp = Keypair(); svm.airdrop(kp.pubkey(), 20 * 10**9); a = str(kp.pubkey())
    asyncio.get_event_loop()
    tok = server.jwt.encode({"sub": a, "exp": datetime.now(timezone.utc) + timedelta(hours=1)}, server.JWT_SECRET, algorithm="HS256")
    return kp, a, {"Authorization": f"Bearer {tok}"}
bal = lambda a: svm.get_balance(Pubkey.from_string(a)) or 0

with TestClient(server.app) as c:
    for col in ["users", "vaults", "transfers", "vault_keys"]:
        asyncio.run_coroutine_threadsafe(server.db[col].drop(), c.portal._loop if hasattr(c.portal, "_loop") else None) if False else None
    c.portal.call(server.db.client.drop_database, "qpos_e2e")
    A_kp, A, hA = user(); B_kp, B, hB = user(); C = str(Keypair().pubkey())
    for a in (A, B): c.portal.call(server.db.users.insert_one, {"id": a, "address": a, "created_at": "x"})

    # create + open vault A with 2 SOL deposit
    r = c.post("/api/vault/create", headers=hA, json={"deposit_sol": 2}).json()
    ok, sig, size = run(A_kp, r["ixs"]); check("A open vault + 2 SOL deposit tx", ok, f"size={size}")
    v = c.post("/api/vault/confirm-open", headers=hA, json={"signature": sig}).json()
    check("A vault open, spendable 2 SOL", v["status"] == "open" and abs(v["spendable_sol"] - 2) < 1e-9, v["spendable_sol"])
    r = c.post("/api/vault/create", headers=hB, json={}).json(); ok, sig, _ = run(B_kp, r["ixs"])
    c.post("/api/vault/confirm-open", headers=hB, json={"signature": sig})
    check("resolve B -> vault", c.get(f"/api/resolve/{B}").json()["kind"] == "vault")
    check("resolve C -> wallet", c.get(f"/api/resolve/{C}").json()["kind"] == "wallet")

    # A -> B vault-to-vault 0.5
    b = c.post("/api/transfers/prepare", headers=hA, json={"to": B, "amount_sol": 0.5}).json()
    check("prepare vault route has 2 steps", [s["name"] for s in b["steps"]] == ["prepare", "sign"])
    check("second prepare blocked while pending", c.post("/api/transfers/prepare", headers=hA, json={"to": B, "amount_sol": 0.1}).status_code == 409)
    s = run_bundle(A_kp, b)
    check("vault->vault txs landed", all(x[0] for x in s.values()), f"sign size={s['sign'][2]}")
    t = c.post(f"/api/transfers/{b['transfer']['id']}/confirm", headers=hA, json={"signature": s["sign"][1]}).json()
    check("confirm -> completed", t["status"] == "completed")
    va = c.get("/api/vault", headers=hA).json(); vb = c.get("/api/vault", headers=hB).json()
    check("A spendable 1.5, nonce 1", abs(va["vault"]["spendable_sol"] - 1.5) < 1e-9 and va["vault"]["nonce"] == 1, va["vault"]["spendable_sol"])
    check("B spendable 0.5", abs(vb["vault"]["spendable_sol"] - 0.5) < 1e-9)
    check("key chain: live + 1 retired", len(c.get("/api/vault/keys", headers=hA).json()) == 2)

    # A -> C plain wallet 0.3 (3 steps)
    b = c.post("/api/transfers/prepare", headers=hA, json={"to": C, "amount_sol": 0.3}).json()
    check("wallet route has 3 steps", [s["name"] for s in b["steps"]] == ["prepare", "sign", "deliver"])
    s = run_bundle(A_kp, b, stop_before="deliver")
    t = c.post(f"/api/transfers/{b['transfer']['id']}/confirm", headers=hA, json={"signature": s["sign"][1]}).json()
    check("wallet spend confirmed, not yet delivered", t["status"] == "completed" and t["delivered"] is False)
    check("undelivered surfaced in /vault", c.get("/api/vault", headers=hA).json()["undelivered_transfer"]["id"] == t["id"])
    d = c.get(f"/api/transfers/{t['id']}/deliver-ixs", headers=hA).json()
    ok, dsig, _ = run(A_kp, d["steps"][0]["ixs"])
    t = c.post(f"/api/transfers/{t['id']}/delivered", headers=hA, json={"signature": dsig}).json()
    check("C received 0.3 native SOL", bal(C) == 3 * 10**8 and t["delivered"], bal(C))

    # partial withdraw to self 0.2
    before = bal(A)
    b = c.post("/api/transfers/prepare", headers=hA, json={"to": A, "amount_sol": 0.2}).json()
    check("withdraw route = wallet, kind withdraw", b["transfer"]["kind"] == "withdraw" and len(b["steps"]) == 3)
    s = run_bundle(A_kp, b)
    c.post(f"/api/transfers/{b['transfer']['id']}/confirm", headers=hA, json={"signature": s["sign"][1]})
    c.post(f"/api/transfers/{b['transfer']['id']}/delivered", headers=hA, json={"signature": s["deliver"][1]})
    check("A wallet +~0.2 SOL", abs((bal(A) - before) - 2 * 10**8) < 100_000, (bal(A) - before) / 1e9)

    # discard flow + key exposure ack
    b = c.post("/api/transfers/prepare", headers=hA, json={"to": B, "amount_sol": 0.1}).json()
    check("retry returns identical signature", c.post(f"/api/transfers/{b['transfer']['id']}/retry", headers=hA).json()["steps"][1]["ixs"][1]["data"] == b["steps"][1]["ixs"][1]["data"])
    check("discard ok", c.post(f"/api/transfers/{b['transfer']['id']}/discard", headers=hA).json().get("ok"))
    check("re-sign after discard requires ack (428)", c.post("/api/transfers/prepare", headers=hA, json={"to": B, "amount_sol": 0.1}).status_code == 428)
    # replaying the discarded (never-sent) old bundle after a new spend must fail on-chain
    old = b
    b = c.post("/api/transfers/prepare", headers=hA, json={"to": B, "amount_sol": 0.1, "acknowledge_key_reuse": True}).json()
    s = run_bundle(A_kp, b); c.post(f"/api/transfers/{b['transfer']['id']}/confirm", headers=hA, json={"signature": s["sign"][1]})
    ok, _, _ = run(A_kp, old["steps"][1]["ixs"], 1_400_000)
    check("stale signature rejected on-chain after rotation", not ok)

    # outside deposit straight to A's token account -> watcher logs it
    ok, _, _ = run(B_kp, [sv.system_transfer_ix(B, c.get("/api/vault", headers=hA).json()["vault"]["token_account"], 10**8)])
    c.portal.call(server.watcher_tick)
    acts = c.get("/api/activity", headers=hA).json()
    check("watcher logged outside deposit 0.1", any(x["kind"] == "deposit" and abs(x["amount_sol"] - 0.1) < 1e-9 for x in acts))

    # public deposit by B into A via deposit-ixs
    di = c.post(f"/api/pay/{A}/deposit-ixs", json={"payer": B, "amount_sol": 0.05}).json()
    ok, _, _ = run(B_kp, di["ixs"]); check("public deposit ixs land", ok)

    # withdraw all
    before = bal(A); left = bal(c.get("/api/vault", headers=hA).json()["vault"]["token_account"])
    b = c.post("/api/transfers/prepare", headers=hA, json={"mode": "withdraw_all"}).json()
    check("withdraw_all is 1 step", [s["name"] for s in b["steps"]] == ["sign"])
    s = run_bundle(A_kp, b); c.post(f"/api/transfers/{b['transfer']['id']}/confirm", headers=hA, json={"signature": s["sign"][1]})
    va = c.get("/api/vault", headers=hA).json()["vault"]
    check("withdraw all -> wallet got everything, vault empty", abs((bal(A) - before) - left) < 100_000 and va["spendable_sol"] == 0, (bal(A) - before) / 1e9)
    # deposit again after close + send works (ATA recreated)
    di = c.post(f"/api/pay/{A}/deposit-ixs", json={"payer": B, "amount_sol": 0.4}).json(); run(B_kp, di["ixs"])
    c.portal.call(server.watcher_tick)
    b = c.post("/api/transfers/prepare", headers=hA, json={"to": B, "amount_sol": 0.25}).json()
    s = run_bundle(A_kp, b)
    t = c.post(f"/api/transfers/{b['transfer']['id']}/confirm", headers=hA, json={"signature": s["sign"][1]}).json()
    check("send after withdraw-all + re-deposit", t["status"] == "completed")
    check("insufficient balance rejected", c.post("/api/transfers/prepare", headers=hA, json={"to": B, "amount_sol": 5}).status_code == 400)
    check("tiny send to empty wallet rejected", c.post("/api/transfers/prepare", headers=hA, json={"to": str(Keypair().pubkey()), "amount_sol": 0.0001}).status_code == 400)
    print("final A nonce", c.get("/api/vault", headers=hA).json()["vault"]["nonce"], "| activity", len(c.get("/api/activity", headers=hA).json()))
print(f"\n{P[0]} passed, {F[0]} failed")
