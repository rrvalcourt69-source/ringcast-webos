#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 NetRing Tech Services, LLC
"""Browser check of the app's screens (development only, not shipped).

Loads app/index.html from file:// (as webOS does) in headless Chromium, against a small fake
signage server over HTTPS that speaks the device endpoints, verifies the app's signatures
(PROTOCOL §6) with Python's cryptography package, and serves a player page through the
one-time session URL and cookie of §5.3. Drives the screens with remote-control keys and
saves 1920x1080 screenshots:

    python3 tests/e2e_screens.py [output-dir]
    RINGCAST_APP_DIR=build/lg-tv/check/usr/palm/applications/com.netringtech.ringcast \
        python3 tests/e2e_screens.py           (the packaged files)

Needs: Playwright for Python with Chromium, cryptography, openssl.
"""
import base64
import hashlib
import json
import os
import secrets
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
# RINGCAST_APP_DIR: test an unpacked package instead of the source tree (tools/build.sh output)
APP_DIR = Path(os.environ.get("RINGCAST_APP_DIR") or ROOT / "app")
PORT = 8443
HOST = "signage.example.com"
ORIGIN = f"https://{HOST}:{PORT}"
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-RingCast-Protocol, X-RingCast-Key-Id, "
                                    "X-RingCast-Timestamp, X-RingCast-Nonce, X-RingCast-Signature",
    "Access-Control-Allow-Methods": "GET, POST, PUT",
    "Access-Control-Expose-Headers": "Retry-After, ETag",
}
# webOS's platformBack (BACK from the app's first screen), counted instead of leaving the app
PLATFORM_STUB = "window.PalmSystem = {platformBack: function () { window.__rcBack = (window.__rcBack || 0) + 1; }};"
PLAYER_HTML = """<!DOCTYPE html><html><head><meta charset="utf-8"><title>player</title><style>
html,body{margin:0;height:100%;overflow:hidden;font-family:Helvetica,Arial,sans-serif}
body{background:linear-gradient(135deg,#1d3a63 0%,#0d1b2e 55%,#25113a 100%);color:#fff}
.k{position:absolute;left:120px;top:150px;font-size:44px;letter-spacing:8px;color:#7fd8ff;text-transform:uppercase}
h1{position:absolute;left:120px;top:230px;margin:0;font-size:150px;line-height:1.05}
p{position:absolute;left:120px;top:590px;margin:0;font-size:56px;color:#d8e4f2;width:1300px}
.clock{position:absolute;right:120px;bottom:100px;font-size:120px;font-weight:700;color:#7fd8ff}
</style></head><body><div class="k">Sample content</div><h1>Welcome to<br>the lobby</h1>
<p>This is a stand-in for the server's player page, shown in the app's full-screen frame.</p>
<div class="clock" id="c"></div><script>
function t(){var d=new Date();document.getElementById("c").textContent=("0"+d.getHours()).slice(-2)+":"+("0"+d.getMinutes()).slice(-2);}
t();setInterval(t,1000);
try{parent.postMessage(STATUS,"*");}catch(e){}
</script></body></html>"""


class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.pairings = {}
        self.devices = {}
        self.sessions = {}            # one-time code → device id
        self.cookies = {}             # cookie value → device id
        self.queue = []
        self.results = []
        self.checkins = []
        self.log = []
        self.nonces = set()
        self.claim_next = None        # (name, account)
        self.session_error = None     # (status, code) to refuse player sessions
        self.player_error = None      # error code the player page reports to the app (§5.3)
        self.pages_served = 0
        self.pages_refused = 0


S = State()


def raw_from_ssh(text):
    parts = (text or "").split()
    if len(parts) != 3 or parts[0] != "ssh-ed25519" or parts[2] != "ringcast-device":
        return None
    blob = base64.b64decode(parts[1])
    n1 = int.from_bytes(blob[0:4], "big")
    n2 = int.from_bytes(blob[4 + n1:8 + n1], "big")
    raw = blob[8 + n1:8 + n1 + n2]
    return raw if blob[4:4 + n1] == b"ssh-ed25519" and len(raw) == 32 else None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        S.log.append(fmt % args)

    def send(self, status, body=None, headers=None, ctype="application/json"):
        data = b"" if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        self.send_response(status)
        path = urlsplit(self.path).path
        if path.startswith("/api/device/v1/") and not path.startswith("/api/device/v1/play/"):
            for k, v in CORS.items():
                self.send_header(k, v)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        if data:
            self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def err(self, status, code, **extra):
        self.send(status, dict({"error": code, "message": code}, **extra))

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def check_sig(self, raw, key_id, body):
        h = self.headers
        if h.get("X-RingCast-Key-Id") != key_id:
            return "bad_signature"
        ts, nonce = h.get("X-RingCast-Timestamp", ""), h.get("X-RingCast-Nonce", "")
        if abs(int(ts) - int(time.time() * 1000)) > 300000:
            return "bad_timestamp"
        msg = "\n".join(["RINGCAST-SIG-V1", self.command, urlsplit(self.path).path, key_id, ts, nonce,
                         hashlib.sha256(body).hexdigest()]).encode()
        try:
            Ed25519PublicKey.from_public_bytes(raw).verify(base64.b64decode(h.get("X-RingCast-Signature", "")), msg)
        except Exception:
            return "bad_signature"
        if nonce in S.nonces:
            return "bad_signature"
        S.nonces.add(nonce)
        return None

    def bearer(self):
        a = self.headers.get("Authorization", "")
        for did, d in S.devices.items():
            if a == "Bearer " + d["token"]:
                return did
        return None

    def do_OPTIONS(self):
        self.send(204, headers={"Access-Control-Max-Age": "600"})

    def do_GET(self):
        u = urlsplit(self.path)
        if u.path == "/api/device/v1/time":
            return self.send(200, {"t": int(time.time() * 1000)})
        if u.path == "/api/device/v1/play/start":
            code = parse_qs(u.query).get("s", [""])[0]
            with S.lock:
                did = S.sessions.pop(code, None)
            if did is None:
                return self.err(403, "forbidden")
            cookie = secrets.token_urlsafe(32)
            S.cookies[cookie] = did
            return self.send(302, headers={
                "Location": "/api/device/v1/play/",
                "Set-Cookie": f"rc_play={cookie}; Max-Age=86400; Path=/api/device/v1/play/; Secure; HttpOnly; SameSite=None"})
        if u.path == "/api/device/v1/play/":
            jar = dict(p.strip().split("=", 1) for p in (self.headers.get("Cookie") or "").split(";") if "=" in p)
            if jar.get("rc_play") not in S.cookies:
                S.pages_refused += 1
                return self.err(403, "forbidden")
            S.pages_served += 1
            status = ({"type": "ringcast-player", "state": "error", "error": S.player_error} if S.player_error
                      else {"type": "ringcast-player", "state": "playing"})
            return self.send(200, PLAYER_HTML.replace("STATUS", json.dumps(status)).encode(),
                             ctype="text/html; charset=utf-8")
        return self.err(404, "not_found")

    def do_POST(self):
        path = urlsplit(self.path).path
        body = self.body()
        if self.headers.get("X-RingCast-Protocol") != "1":
            return self.err(400, "bad_request")
        b = json.loads(body or b"{}")
        if path == "/api/device/v1/pair/request":
            raw = raw_from_ssh(b.get("pubkey"))
            if raw is None:
                return self.err(400, "bad_request")
            fp = hashlib.sha256(raw).hexdigest()
            bad = self.check_sig(raw, fp, body)
            if bad:
                return self.err(401, bad, server_time_ms=int(time.time() * 1000))
            pid = secrets.token_urlsafe(16)
            code = "HXRT-" + fp[:4].upper()
            S.pairings[pid] = {"raw": raw, "code": code, "status": "waiting", "request": b}
            return self.send(201, {"pairing_id": pid, "code": code, "expires_in_s": 900, "poll_interval_s": 3,
                                   "server_name": "NetRing Signage Manager", "add_screen_hint": "Screens → Add Screen",
                                   "protocol": {"min": 1, "max": 1}})
        if path == "/api/device/v1/pair/status":
            p = S.pairings.get(b.get("pairing_id"))
            if p is None:
                return self.err(410, "pairing_expired")
            bad = self.check_sig(p["raw"], b["pairing_id"], body)
            if bad:
                return self.err(401, bad)
            if S.claim_next is None:
                return self.send(200, {"status": "waiting"})
            name, account = S.claim_next
            did = "d_" + secrets.token_hex(8)
            token = secrets.token_urlsafe(32)
            S.devices[did] = {"raw": p["raw"], "token": token}
            return self.send(200, {"status": "claimed", "device_id": did, "device_token": token, "name": name,
                                   "account_name": account})
        did = self.bearer()
        if did is None:
            return self.err(401, "unauthorized")
        if path == "/api/device/v1/checkin":
            S.checkins.append(b)
            with S.lock:
                cmds, S.queue = S.queue, []
            return self.send(200, {"name": "Lobby Left", "server_time_ms": int(time.time() * 1000),
                                   "manifest_version": "v1", "checkin_interval_s": 10, "commands": cmds})
        if path == "/api/device/v1/player-session":
            if S.session_error:
                return self.err(*S.session_error)
            code = secrets.token_urlsafe(24)
            S.sessions[code] = did
            return self.send(200, {"url": f"{ORIGIN}/api/device/v1/play/start?s={code}", "expires_in_s": 86400})
        if path.startswith("/api/device/v1/commands/") and path.endswith("/result"):
            S.results.append(dict(b, id=path.split("/")[5]))
            return self.send(200, {"status": "ok"})
        return self.err(404, "not_found")


def serve(certdir):
    cert, key = certdir / "cert.pem", certdir / "key.pem"
    subprocess.run(["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
                    "-nodes", "-keyout", str(key), "-out", str(cert), "-days", "2", "-subj", f"/CN={HOST}",
                    "-addext", f"subjectAltName=DNS:{HOST}"], check=True, capture_output=True)
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(str(cert), str(key))
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def key(page, code):
    page.evaluate(f"document.dispatchEvent(new KeyboardEvent('keydown', {{keyCode: {code}, bubbles: true}}))")


def back_key(page):
    key(page, 461)


def center(page, sel):
    b = page.locator(sel).bounding_box()
    return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2


def hover(page, sel):
    x, y = center(page, sel)
    page.mouse.move(x - 5, y - 5)
    page.mouse.move(x, y, steps=3)


def focus_ring(page, sel):
    """The focused control looks different from the unfocused one: cyan border and glow."""
    st = page.evaluate("""(s) => { var e = document.querySelector(s), c = getComputedStyle(e);
        return [c.borderTopColor, c.boxShadow, e.className]; }""", sel)
    return st[0] == "rgb(0, 198, 255)" and "rgba(0, 198, 255" in st[1] and "focused" in st[2]


def in_safe_area(page, sels):
    """Every visible element is at least 5% from each screen edge (overscan)."""
    for sel in sels:
        b = page.locator(sel).bounding_box()
        if b is None:
            continue
        if b["x"] < 96 or b["y"] < 54 or b["x"] + b["width"] > 1920 - 96 or b["y"] + b["height"] > 1080 - 54:
            print("     outside the safe area:", sel, b)
            return False
    return True


def main(out):
    out.mkdir(parents=True, exist_ok=True)
    problems = []

    def check(cond, what):
        print(("ok   " if cond else "FAIL ") + "e2e: " + what)
        if not cond:
            problems.append(what)

    with tempfile.TemporaryDirectory() as td:
        httpd = serve(Path(td))
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=[f"--host-resolver-rules=MAP {HOST} 127.0.0.1", "--no-proxy-server"])
            for lang in ("en-US", "es-ES"):
                ctx = browser.new_context(viewport={"width": 1920, "height": 1080}, ignore_https_errors=True,
                                          locale=lang)
                ctx.add_init_script(PLATFORM_STUB)
                page = ctx.new_page()
                console = []
                page.on("console", lambda m: console.append(m.type + ": " + m.text))
                page.on("pageerror", lambda e: console.append("pageerror: " + str(e)))
                page.goto((APP_DIR / "index.html").as_uri())
                page.wait_for_selector("#s-address:not([hidden])")
                sfx = "" if lang == "en-US" else "-es"
                if lang == "es-ES":
                    check("Conectar" in page.inner_text("#addr-go"), "Spanish strings follow navigator.language")
                    page.screenshot(path=str(out / f"1-address{sfx}.png"))
                    ctx.close()
                    continue
                check(page.input_value("#addr") == "https://", "address field pre-filled with https://")
                check(page.evaluate("document.activeElement.id") == "addr", "address field has focus")
                page.screenshot(path=str(out / "1-address.png"))
                # BACK on the first screen leaves the app the platform's way
                back_key(page)
                check(page.evaluate("window.__rcBack") == 1 and page.is_visible("#s-address"),
                      "BACK on the first screen calls platformBack")
                # Magic Remote: hover focuses, the focus is visible, click selects
                hover(page, "#addr-go")
                check(page.evaluate("document.activeElement.id") == "addr-go", "pointer hover focuses Connect")
                check(focus_ring(page, "#addr-go"), "focus on Connect is visible")
                hover(page, "#addr")
                check(page.evaluate("document.activeElement.id") == "addr", "pointer hover focuses the address field")
                check(focus_ring(page, "#addr"), "focus on the address field is visible")
                hover(page, "#addr-go")
                page.keyboard.press("Enter")                # pointer shown: OK is the click, not a key
                page.mouse.click(*center(page, "#addr-go"))
                page.wait_for_selector("#addr-status.error")
                check("Enter" in page.inner_text("#addr-status"), "click on Connect submits (empty address explained)")
                check(in_safe_area(page, ["#addr", "#addr-go", "#addr-keys", "#diag"]), "address screen inside the overscan-safe area")
                # a wrong address: error message
                page.fill("#addr", "http://192.0.2.10")
                page.keyboard.press("ArrowDown")
                check(page.evaluate("document.activeElement.id") == "addr-go", "DOWN moves to Connect")
                page.keyboard.press("Enter")
                page.wait_for_selector("#addr-status.error")
                check("https://" in page.inner_text("#addr-status"), "http:// refused with a message")
                page.screenshot(path=str(out / "1b-address-error.png"))
                page.fill("#addr", "https://192.0.2.10")
                page.click("#addr-go")
                page.wait_for_function("document.getElementById('addr-status').textContent.indexOf('public') >= 0",
                                       timeout=40000)
                check(True, "private address explained (public certificate needed)")
                # the right address, typed with the keyboard and confirmed with OK
                page.fill("#addr", "")
                page.keyboard.press("ArrowUp")
                page.keyboard.type(ORIGIN)
                page.keyboard.press("Enter")
                try:
                    page.wait_for_selector("#s-code:not([hidden])", timeout=20000)
                except Exception:
                    page.screenshot(path=str(out / "fail.png"))
                    print("status:", page.inner_text("#addr-status"), "| server log:", S.log[-5:], console[-5:])
                    raise
                code = page.inner_text("#code")
                check(code.startswith("HXRT-"), f"pairing code shown ({code})")
                time.sleep(4)                                # at least one signed poll
                page.screenshot(path=str(out / "2-pairing.png"))
                req = next(iter(S.pairings.values()))["request"]
                check(req.get("platform") == "lg-tv" and req.get("capabilities") == ["refresh", "restart_player",
                      "set_orientation", "unpair"], "pair/request carries platform and capabilities")
                check("mac_address" not in req, "no MAC address without the webOS bus")
                # BLUE: change server, BACK: keep it
                check(page.evaluate("document.activeElement.id") == "change-server", "pairing: the change-server button has the focus")
                check(focus_ring(page, "#change-server"), "focus on the change-server button is visible")
                check(in_safe_area(page, ["#code", "#change-server", "#diag", "#code-server"]), "pairing screen inside the overscan-safe area")
                for k in (403, 404, 405, 49, 457):          # colour, number, info keys: nothing happens
                    key(page, k)
                page.mouse.move(960, 200)                   # pointer over an empty area: OK does nothing
                page.keyboard.press("Enter")
                time.sleep(0.5)
                check(page.is_visible("#s-code"), "colour/number keys and OK over an empty area change nothing")
                hover(page, "#change-server")
                page.mouse.click(*center(page, "#change-server"))
                page.wait_for_selector("#s-address:not([hidden])")
                check(page.input_value("#addr") == ORIGIN, "click on the change-server button opens the address screen")
                page.keyboard.press("Escape")
                page.wait_for_selector("#s-code:not([hidden])", timeout=20000)
                page.keyboard.press("ArrowDown")            # back to the remote's arrows (pointer hidden)
                page.keyboard.press("F1")                   # unrelated key: nothing happens
                page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {keyCode: 406, bubbles: true}))")
                page.wait_for_selector("#s-address:not([hidden])")
                check(page.input_value("#addr") == ORIGIN, "BLUE opens the address screen with the current server")
                page.screenshot(path=str(out / "1c-address-change.png"))
                page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {keyCode: 461, bubbles: true}))")
                page.wait_for_selector("#s-code:not([hidden])", timeout=20000)
                check(True, "BACK returns to pairing")
                page.keyboard.press("Enter")                # OK works too (remotes without colour keys)
                page.wait_for_selector("#s-address:not([hidden])")
                check(True, "OK on the pairing screen opens the address screen")
                page.keyboard.press("Escape")
                page.wait_for_selector("#s-code:not([hidden])", timeout=20000)
                # claim
                S.claim_next = ("Lobby Left", "Example Co")
                page.wait_for_selector("#s-claimed:not([hidden])", timeout=20000)
                check("Example Co" in page.inner_text("#claimed-by"), "claimed notice names the account")
                time.sleep(1)
                page.screenshot(path=str(out / "3-claimed.png"))
                check(page.evaluate("localStorage.getItem('rc.token')") is None, "token not saved during the notice")
                page.wait_for_selector("#s-player:not([hidden])", timeout=75000)
                page.wait_for_function("document.getElementById('player-wait').hidden", timeout=20000)
                time.sleep(2)
                check(S.pages_served >= 1, "player page loaded in the frame with its cookie")
                check(S.pages_refused == 0, "the frame's cookie was accepted")
                page.screenshot(path=str(out / "4-playing.png"))
                # BACK while playing (standard TV): the app leaves the platform's way, nothing else
                n_back = page.evaluate("window.__rcBack")
                hover(page, "#s-player")                    # the pointer over the content
                page.mouse.click(960, 540)
                check(page.evaluate("document.activeElement.tagName") != "IFRAME", "the player frame never takes the focus")
                back_key(page)
                time.sleep(1)
                check(page.evaluate("window.__rcBack") == n_back + 1, "BACK while playing calls platformBack")
                check(page.is_visible("#s-player") and page.evaluate("localStorage.getItem('rc.token')") is not None,
                      "BACK while playing keeps the pairing and the player")
                frame_attrs = page.evaluate("""(() => { var f = document.querySelector('#frame-box iframe');
                    return [f.getAttribute('allow'), f.getAttribute('sandbox'), getComputedStyle(f).borderTopWidth]; })()""")
                check("autoplay" in frame_attrs[0] and frame_attrs[2] == "0px", f"frame allows autoplay, no border {frame_attrs}")
                ck = S.checkins[-1]
                check(ck.get("display", {}).get("width") == 1920 and ck.get("capabilities"), "check-in reports display")
                # commands
                # set_orientation: acknowledged, the player reloads; the app itself turns nothing
                n = S.pages_served
                S.queue.append({"id": "c_rot", "type": "set_orientation", "args": {"orientation": "portrait_cw"}})
                deadline = time.time() + 30
                while S.pages_served <= n and time.time() < deadline:
                    time.sleep(0.5)
                check(S.pages_served > n, "set_orientation reloads the player")
                rot = page.evaluate("""(() => { var b = document.getElementById('frame-box');
                    return [b.className, getComputedStyle(b).transform, b.offsetWidth, b.offsetHeight]; })()""")
                check(rot == ["", "none", 1920, 1080], f"the app doesn't rotate the frame {rot}")
                check(S.checkins[-1]["display"]["orientation"] == "landscape", "check-in reports the real orientation")
                S.queue.append({"id": "c_rot2", "type": "set_orientation", "args": {"orientation": "landscape"}})
                deadline = time.time() + 30
                while len(S.results) < 2 and time.time() < deadline:
                    time.sleep(0.5)
                # a status message that doesn't come from the player frame is ignored
                page.evaluate("window.postMessage({type: 'ringcast-player', state: 'error', error: 'forged'}, '*')")
                time.sleep(3)
                check(page.is_hidden("#frame-error"), "status message from outside the frame ignored")
                n = S.pages_served
                S.queue.append({"id": "c_ref", "type": "refresh", "args": {}})
                deadline = time.time() + 30
                while S.pages_served <= n and time.time() < deadline:
                    time.sleep(0.5)
                check(S.pages_served > n, "refresh reloads the player in a new session")
                # a refused refresh keeps the current content playing
                S.session_error = (403, "forbidden")
                S.queue.append({"id": "c_ref2", "type": "refresh", "args": {}})
                deadline = time.time() + 30
                while not any(r["id"] == "c_ref2" for r in S.results) and time.time() < deadline:
                    time.sleep(0.5)
                check(page.is_hidden("#frame-error"), "failed refresh doesn't cover playing content")
                # restart_player reloads the whole app; a refused session is explained on screen
                S.queue.append({"id": "c_rs", "type": "restart_player", "args": {}})
                page.wait_for_selector("#frame-error:not([hidden])", timeout=40000)
                check("403" in page.inner_text("#frame-reason"), "refused session explained on screen")
                time.sleep(1)
                page.screenshot(path=str(out / "5-player-error.png"))
                S.session_error = None
                page.wait_for_selector("#frame-error", state="hidden", timeout=40000)
                page.wait_for_function("document.getElementById('player-wait').hidden", timeout=40000)
                check(True, "player recovers after the refusal")
                # the player page reports no_session (cookie refused in the frame)
                S.player_error = "no_session"
                S.queue.append({"id": "c_ref3", "type": "refresh", "args": {}})
                page.wait_for_selector("#frame-error:not([hidden])", timeout=40000)
                reason, hint = page.inner_text("#frame-reason"), page.inner_text("#frame-hint")
                check("no_session" in reason and "cookie" in hint and page.is_visible("#frame-hint"),
                      f"no_session shown with its explanation ({reason} / {hint})")
                time.sleep(1)
                page.screenshot(path=str(out / "5b-player-no-session.png"))
                S.player_error = None
                page.wait_for_selector("#frame-error", state="hidden", timeout=40000)
                check(True, "player recovers once the page reports playing")
                ids = [r["id"] for r in S.results]
                check(ids == ["c_rot", "c_rot2", "c_ref", "c_ref2", "c_rs", "c_ref3"], f"results posted once each {ids}")
                check([r["ok"] for r in S.results] == [True, True, True, False, True, True], "results report success/failure")
                # unpair → pairing screen again
                S.claim_next = None
                S.queue.append({"id": "c_up", "type": "unpair", "args": {}})
                page.wait_for_selector("#s-code:not([hidden])", timeout=40000)
                check(page.evaluate("localStorage.getItem('rc.token')") is None, "unpair forgets the token")
                check(page.evaluate("localStorage.getItem('rc.seed')") is not None, "unpair keeps the key")
                stored = page.evaluate("JSON.stringify(localStorage)")
                token_shown = any(d["token"] in page.content() for d in S.devices.values())
                check(not token_shown, "token never in the page")
                errors = [c for c in console if c.startswith("error") or c.startswith("pageerror")]
                # Expected noise: refused sessions (403) and current Chromium's notice about frame features
                # delegated from a file:// page (webOS 5's engine predates it; autoplay is checked on the TV).
                errors = [c for c in errors if "403" not in c and "Failed to load resource" not in c
                          and "Potential permissions policy violation" not in c]
                check(not errors, "no script errors " + repr(errors[:3]))
                logged = "\n".join(console)
                seed = json.loads(stored).get("rc.seed", "")
                check(seed and seed not in logged and not any(d["token"] in logged for d in S.devices.values()),
                      "key and token never logged")
                ctx.close()
            browser.close()
        httpd.shutdown()
    print(f"screenshots in {out}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "test-output")))
