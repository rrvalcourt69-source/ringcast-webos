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

module.exports = () => run("ui");
if (require.main === module) module.exports().then((f) => process.exit(f ? 1 : 0));
