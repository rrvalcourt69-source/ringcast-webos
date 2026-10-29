#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 NetRing Tech Services, LLC
"""Screenshots of every screen for the LG Content Store UX scenario (development only, not
shipped), against the fake signage server of tests/e2e_screens.py, with boxes.json: where each
visible element of each screenshot is (for the numbered callouts in the document).

    RINGCAST_APP_DIR=build/lg-tv/check/usr/palm/applications/com.netringtech.ringcast \\
        python3 tests/store_shots.py <output-dir>

Screens: address (EN, ES), address error, connecting, pairing code, address opened from the
pairing screen, screen added, playing, playing with the "Offline" marker, the message screen
(server unreachable), the player page error.
"""
import json
import shutil
import socket
import sys
import tempfile
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_screens as e  # noqa: E402

SLOW = "signage.example.org"
SLOW_PORT = 443
BOXES = {}
# every visible element that has an id or is a heading/paragraph/button inside the current screen
MEASURE = """() => {
  var out = {}, n = 0;
  document.querySelectorAll('[id], h1, h2, h3, p, button, input').forEach(function (el) {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    var key = el.id || (el.tagName.toLowerCase() + '-' + (n++));
    out[key] = {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
                text: (el.innerText || el.value || '').slice(0, 80)};
  });
  return out;
}"""


def shot(page, out, name):
    page.screenshot(path=str(out / f"{name}.png"))
    BOXES[name] = page.evaluate(MEASURE)


def hanging_server():
    """Accepts connections and never answers: the app stays on "Connecting"."""
    s = socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("127.0.0.1", SLOW_PORT))
    s.listen(8)
    held = []

    def run():
        while True:
            try:
                held.append(s.accept()[0])
            except OSError:
                return
    threading.Thread(target=run, daemon=True).start()
    return s


def context(browser, lang="en-US"):
    ctx = browser.new_context(viewport={"width": 1920, "height": 1080}, ignore_https_errors=True, locale=lang)
    ctx.add_init_script(e.PLATFORM_STUB)
    return ctx


def connect(page):
    page.goto((e.APP_DIR / "index.html").as_uri())
    page.wait_for_selector("#s-address:not([hidden])")
    page.fill("#addr", e.ORIGIN)
    page.click("#addr-go")
    page.wait_for_selector("#s-code:not([hidden])", timeout=30000)


def main(out):
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        e.serve(td)
        slow = hanging_server()
        up = e.Handler.handle_one_request
        down = lambda self: setattr(self, "close_connection", True)  # noqa: E731  (server gone)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=[
                f"--host-resolver-rules=MAP {e.HOST} 127.0.0.1, MAP {SLOW} 127.0.0.1",
                "--no-proxy-server", "--allow-file-access-from-files"])
            # address screen, Spanish
            ctx = context(browser, "es-ES")
            page = ctx.new_page()
            page.goto((e.APP_DIR / "index.html").as_uri())
            page.wait_for_selector("#s-address:not([hidden])")
            shot(page, out, "address-es")
            ctx.close()
            # address screen, its error, pairing, change server, screen added, playing, offline
            ctx = context(browser)
            page = ctx.new_page()
            page.goto((e.APP_DIR / "index.html").as_uri())
            page.wait_for_selector("#s-address:not([hidden])")
            shot(page, out, "address")
            page.fill("#addr", "http://192.0.2.10")
            page.click("#addr-go")
            page.wait_for_selector("#addr-status.error")
            shot(page, out, "address-error")
            page.fill("#addr", e.ORIGIN)
            page.click("#addr-go")
            page.wait_for_selector("#s-code:not([hidden])", timeout=30000)
            time.sleep(2)
            shot(page, out, "pairing")
            page.keyboard.press("Enter")                    # OK on "change the server address"
            page.wait_for_selector("#s-address:not([hidden])")
            shot(page, out, "address-change")
            page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {keyCode: 461, bubbles: true}))")
            page.wait_for_selector("#s-code:not([hidden])", timeout=20000)
            e.S.claim_next = ("Lobby Left", "Example Co")
            page.wait_for_selector("#s-claimed:not([hidden])", timeout=20000)
            time.sleep(1)
            shot(page, out, "claimed")
            page.wait_for_selector("#s-player:not([hidden])", timeout=90000)
            page.wait_for_function("document.getElementById('player-wait').hidden", timeout=20000)
            time.sleep(2)
            shot(page, out, "playing")
            e.Handler.handle_one_request = down
            page.wait_for_function("!document.getElementById('marker').hidden", timeout=180000)
            time.sleep(1)
            shot(page, out, "playing-offline")
            ctx.close()
            e.Handler.handle_one_request = up
            # a screen that knows its server restarts while the server is down: the message screen
            ctx = context(browser)
            page = ctx.new_page()
            connect(page)
            e.Handler.handle_one_request = down
            page.reload()
            page.wait_for_selector("#s-message:not([hidden])", timeout=60000)
            time.sleep(1.5)
            shot(page, out, "message")
            ctx.close()
            e.Handler.handle_one_request = up
            # the server refuses the player page: the error box over the player
            ctx = context(browser)
            page = ctx.new_page()
            connect(page)
            e.S.claim_next = ("Lobby Left", "Example Co")
            page.wait_for_selector("#s-claimed:not([hidden])", timeout=20000)
            e.S.session_error = (403, "forbidden")
            page.wait_for_selector("#frame-error:not([hidden])", timeout=120000)
            time.sleep(1)
            shot(page, out, "player-error")
            e.S.session_error = None
            ctx.close()
            # connecting: an address that doesn't answer yet (server address supplied with the app)
            app = td / "app-slow"
            shutil.copytree(e.APP_DIR, app)
            (app / "server.json").write_text(json.dumps({"server": f"https://{SLOW}"}))
            ctx = context(browser)
            page = ctx.new_page()
            page.goto((app / "index.html").as_uri())
            page.wait_for_selector("#s-connecting:not([hidden])", timeout=20000)
            time.sleep(1.5)
            shot(page, out, "connecting")
            ctx.close()
            browser.close()
        slow.close()
    (out / "boxes.json").write_text(json.dumps(BOXES, indent=1))
    print("screenshots in", out)


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "store-shots"))
