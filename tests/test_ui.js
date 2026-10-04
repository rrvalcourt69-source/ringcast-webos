// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// The player status message (PROTOCOL §5.3): {type: "ringcast-player", state: "playing"} or
// {type: "ringcast-player", state: "error", error: "<code>"}, accepted only from the player frame.
"use strict";
const assert = require("assert");
const { load, test, run, CORE } = require("./harness");

const RC = load(CORE.concat(["js/strings.js", "js/ui.js"])).RC;
const ORIGIN = "https://signage.example.com";

function makeUi() {
  const els = {};
  const el = (id) => els[id] || (els[id] = { id, hidden: false, textContent: "", className: "" });
  const ui = new RC.UI({ getElementById: el }, {});
  ui.agent = { origin: ORIGIN };
  ui.frame = { contentWindow: { name: "player" } };
  ui.frameInfo = { state: "loading", since: 1, error: "" };
  return { ui, el };
}

const msg = (ui, data, over) => ui.onFrameMessage(Object.assign({ source: ui.frame.contentWindow, origin: ORIGIN, data }, over || {}));

test("playing: the frame counts as loaded and the wait text goes", () => {
  const { ui, el } = makeUi();
  msg(ui, { type: "ringcast-player", state: "playing" });
  assert.strictEqual(ui.frameState().state, "loaded");
  assert.strictEqual(el("player-wait").hidden, true);
});

test("error: the code is kept (clipped, printable) for the error panel", () => {
  const { ui } = makeUi();
  msg(ui, { type: "ringcast-player", state: "error", error: "no_session" });
  assert.strictEqual(ui.frameState().state, "error");
  assert.strictEqual(ui.frameState().error, "no_session");
  const b = makeUi();
  msg(b.ui, { type: "ringcast-player", state: "error", error: "x\n".repeat(100) });
  assert.strictEqual(b.ui.frameState().error, "x".repeat(60));
  const c = makeUi();
  msg(c.ui, { type: "ringcast-player", state: "error" });
  assert.strictEqual(c.ui.frameState().error, "error");
  // a later "playing" doesn't hide an error until a new session starts
  msg(c.ui, { type: "ringcast-player", state: "playing" });
  assert.strictEqual(c.ui.frameState().state, "error");
});

test("ignored: other sources, other origins, other shapes", () => {
  const cases = [
    [{ type: "ringcast-player", state: "error", error: "x" }, { source: {} }],
    [{ type: "ringcast-player", state: "error", error: "x" }, { source: null }],
    [{ type: "ringcast-player", state: "error", error: "x" }, { origin: "https://evil.example.net" }],
    [{ type: "ringcast-player", state: "error", error: "x" }, { origin: "null" }],
    [{ type: "other", state: "error", error: "x" }],
    [{ state: "error", error: "x" }],
    ["{\"type\":\"ringcast-player\",\"state\":\"error\"}"],
    [{ type: "ringcast-player", state: "stopped" }],
    [null],
  ];
  for (const [data, over] of cases) {
    const { ui } = makeUi();
    msg(ui, data, over);
    assert.strictEqual(ui.frameState().state, "loading", JSON.stringify([data, over]));
  }
  const { ui } = makeUi();
  ui.frame = null;
  ui.onFrameMessage({ source: null, origin: ORIGIN, data: { type: "ringcast-player", state: "error" } });
  assert.strictEqual(ui.frameState().state, "loading", "no frame open");
});

test("no_session has its own explanation in both languages", () => {
  for (const lang of ["en", "es"]) {
    assert.ok(RC.strings[lang].frame_no_session_hint.length > 40, lang);
  }
});

// ── remote keys and the Magic Remote ─────────────────────────────────────
function keyUi(screen, opts) {
  opts = opts || {};
  const els = {};
  const el = (id) => els[id] || (els[id] = { id, hidden: false, textContent: "", className: "", value: opts.value || "https://",
    focus() { focusLog.push(id); }, blur() {}, setSelectionRange() {} });
  const focusLog = [];
  const agentLog = [];
  const ui = new RC.UI({ getElementById: el, activeElement: null, body: {} }, {});
  ui.agent = {
    config: { platform: opts.platform || "lg-tv" },
    changeServer() { agentLog.push("change"); return opts.mode === "pairing"; },
    cancelAddress() { agentLog.push("cancel"); return true; },
    submitAddress: async () => { agentLog.push("submit"); return { ok: true }; },
  };
  let left = 0;
  ui.leave = () => { left++; return true; };
  ui.current = screen;
  ui.canGoBack = !!opts.canGoBack;
  ui.focused = opts.focused || "";
  const key = (code) => {
    const e = { keyCode: code, prevented: false, preventDefault() { this.prevented = true; } };
    ui.onKey(e);
    return e;
  };
  return { ui, key, agentLog, focusLog, left: () => left };
}
const K = RC.UI.KEY;

test("BACK: leaves the app from the first screens (address, pairing, messages, claimed)", () => {
  for (const s of ["s-address", "s-connecting", "s-code", "s-message", "s-claimed"]) {
    const t = keyUi(s);
    assert.strictEqual(t.key(K.BACK).prevented, true, s);
    assert.strictEqual(t.left(), 1, s);
    assert.deepStrictEqual(t.agentLog, [], s + ": nothing else happens");
  }
});

test("BACK: from the address screen opened from pairing it goes back to pairing", () => {
  const t = keyUi("s-address", { canGoBack: true });
  t.key(K.BACK);
  assert.deepStrictEqual(t.agentLog, ["cancel"]);
  assert.strictEqual(t.left(), 0);
});

test("BACK: with the on-screen keyboard open it only closes the keyboard", () => {
  const t = keyUi("s-address");
  t.ui.vkbVisible = true;
  t.key(K.BACK);
  assert.strictEqual(t.left(), 0);
});

test("BACK while playing: a TV leaves the app; a signage display keeps playing", () => {
  const tv = keyUi("s-player");
  tv.key(K.BACK);
  assert.strictEqual(tv.left(), 1);
  assert.deepStrictEqual(tv.agentLog, [], "no unpair, no change of server");
  const sig = keyUi("s-player", { platform: "lg-signage" });
  assert.strictEqual(sig.key(K.BACK).prevented, true);
  assert.strictEqual(sig.left(), 0);
});

test("other keys: colours, numbers, EXIT-like codes do nothing on any screen", () => {
  for (const s of ["s-address", "s-code", "s-message", "s-claimed", "s-player"]) {
    const t = keyUi(s, { mode: "pairing" });
    for (const k of [403, 404, 405, 48, 49, 57, 412, 417, 1001, 457, 33, 34]) {
      assert.strictEqual(t.key(k).prevented, false, s + " " + k);
    }
    assert.deepStrictEqual(t.agentLog, [], s);
    assert.strictEqual(t.left(), 0, s);
  }
});

test("OK: changes the server on pairing with the remote; with the pointer shown it's left to the click", () => {
  const t = keyUi("s-code", { mode: "pairing" });
  assert.strictEqual(t.key(K.ENTER).prevented, true);
  assert.deepStrictEqual(t.agentLog, ["change"]);
  const p = keyUi("s-code", { mode: "pairing" });
  p.ui.pointer = true;
  assert.strictEqual(p.key(K.ENTER).prevented, true, "the key doesn't activate the focused control");
  assert.deepStrictEqual(p.agentLog, [], "pointer: the click decides");
  p.key(K.LEFT);                               // arrows hide the pointer (5-way mode again)
  p.key(K.ENTER);
  assert.deepStrictEqual(p.agentLog, ["change"]);
  const b = keyUi("s-message", { mode: "pairing" });
  b.ui.pointer = true;
  b.key(K.BLUE);
  assert.deepStrictEqual(b.agentLog, ["change"], "BLUE works with the pointer shown too");
});

test("OK on the address screen: Connect submits; with the pointer shown the click does", () => {
  const t = keyUi("s-address", { focused: "addr-go", value: ORIGIN });
  t.key(K.ENTER);
  assert.deepStrictEqual(t.agentLog, ["submit"]);
  const p = keyUi("s-address", { focused: "addr-go", value: ORIGIN });
  p.ui.pointer = true;
  p.key(K.ENTER);
  assert.deepStrictEqual(p.agentLog, []);
});

module.exports = () => run("ui");
if (require.main === module) module.exports().then((f) => process.exit(f ? 1 : 0));
