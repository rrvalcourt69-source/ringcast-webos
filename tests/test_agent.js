// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// The app's behaviour against a fake server on a virtual clock: pairing (§3), token renewal and
// revocation (§4), check-in, backoff and commands (§5.1, §5.2), player sessions (§5.3) and the
// server address check. Signatures are verified by the fake server with Node's own Ed25519.
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const { load, test, run, CORE } = require("./harness");
const { FakeServer, sshKeyRaw } = require("./fake_server");

const FILES = CORE.concat(["js/strings.js", "js/store.js", "js/http.js", "js/agent.js"]);
const ORIGIN = "https://signage.example.com";
const PATH = "/api/device/v1/";
const plain = (o) => JSON.parse(JSON.stringify(o));
const tick = () => new Promise((r) => setImmediate(r));

function makeEnv(opts) {
  opts = opts || {};
  const clock = { t: 1790000000000 };
  const serverSkew = opts.serverSkew || 0;
  const RC = load(FILES).RC;
  const server = new FakeServer(Object.assign({ now: () => clock.t + serverSkew, origin: ORIGIN }, opts.server || {}));
  const mem = Object.assign({}, opts.mem || {});
  const ls = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
  };
  if (opts.server_address !== false && !mem["rc.server"]) mem["rc.server"] = ORIGIN;
  const calls = [];
  const rec = (what, v) => calls.push({ t: clock.t, what, v });
  const ui = {
    autoLoad: opts.autoLoad !== false,
    frame: { state: "none", since: 0, error: "" },
    setDiag() {},
    showAddress(o) { rec("address", o); },
    showConnecting() { rec("connecting"); },
    showCode(o) { rec("code", o); },
    setPairProblem(on) { rec("pair_problem", on); },
    showClaimed(o) { rec("claimed", o); },
    showMessage(o) { rec("message", o); },
    showPlayer(o) { rec("player", o); },
    play(url) { rec("play", url); this.frame = { state: this.autoLoad ? "loaded" : "loading", since: clock.t, error: "" }; },
    stopPlayer() { rec("stop"); this.frame = { state: "none", since: 0, error: "" }; },
    frameState() { return this.frame; },
    showFrameError(o) { rec("frame_error", o); },
    hideFrameError() { rec("frame_ok"); },
    setOffline(on) { this.offline = on; rec("offline", on); },
    setServerOld(on) { this.old = on; },
    size: { width: 1920, height: 1080 },
    displaySize() { return this.size; },
  };
  const logs = [];
  const info = Object.assign({ mac: "", ip: "192.0.2.10", model: "LG 43UN7000PUB", tier: "webos5" }, opts.info || {});
  function newAgent() {
    return new RC.Agent({
      store: new RC.Store(ls), ui, fetch: server.fetch, now: () => clock.t,
      sleep: (ms) => { clock.t += ms; return tick(); },
      platform: { info: async () => info, currentIp: async () => info.ip },
      config: { platform: opts.platform || "lg-tv", version: "0.1.0" },
      reloadApp: () => { server.ev("reload"); },
      log: (m) => logs.push(m),
      claimedSeconds: opts.claimedSeconds,
      readLocal: opts.readLocal,
    });
  }
  const env = { RC, clock, server, mem, ui, calls, logs, info, newAgent };
  env.agent = newAgent();
  env.until = async (cond, what) => {
    for (let i = 0; i < 300000; i++) {
      if (cond()) return;
      await tick();
    }
    throw new Error("timed out waiting for " + (what || "condition"));
  };
  env.uiCalls = (what) => calls.filter((c) => c.what === what);
  env.stop = () => { env.agent.gen++; };
  // Pair through the real flow (claim right away) and wait for the first check-in and player.
  env.pairAndRun = async () => {
    env.agent.start();
    await env.until(() => env.uiCalls("code").length > 0, "code");
    server.claim();
    await env.until(() => server.count("checkin") > 0 && env.uiCalls("play").length > 0, "first check-in and player");
  };
  return env;
}

// ── pairing ─────────────────────────────────────────────────────────────
test("pairing: signed request with platform, capabilities, model; code from the key without a MAC", async () => {
  const e = makeEnv();
  e.agent.start();
  await e.until(() => e.uiCalls("code").length > 0, "code");
  const req = e.server.events.find((x) => x.what === "pair_request");
  const b = req.body;
  assert.deepStrictEqual(Object.keys(b).sort(), ["capabilities", "client_version", "model", "platform", "protocol",
    "pubkey", "tier"]);
  assert.strictEqual(b.protocol, 1);
  assert.strictEqual(b.platform, "lg-tv");
  assert.deepStrictEqual(b.capabilities, ["refresh", "restart_player", "set_orientation", "unpair"]);
  assert.strictEqual(b.model, "LG 43UN7000PUB");
  assert.strictEqual(b.tier, "webos5");
  assert.strictEqual(b.client_version, "0.1.0");
  const raw = sshKeyRaw(b.pubkey);
  assert.ok(raw, b.pubkey);
  const fp = crypto.createHash("sha256").update(raw).digest("hex");
  const shown = e.uiCalls("code")[0].v;
  assert.strictEqual(shown.code.split("-")[1], fp.slice(0, 4).toUpperCase());
  assert.strictEqual(shown.serverName, "RingCast Manager");
  assert.strictEqual(shown.hint, "Screens → Add Screen");
  const r = e.server.requests.find((x) => x.path === PATH + "pair/request");
  assert.strictEqual(r.headers["X-RingCast-Key-Id"], fp);
  assert.strictEqual(r.headers["X-RingCast-Protocol"], "1");
  assert.strictEqual(r.headers["Content-Type"], "application/json");
  e.stop();
});

test("pairing: the MAC address, when the display reveals it, is sent and gives the code suffix", async () => {
  const e = makeEnv({ info: { mac: "a4:36:c7:00:12:ef" }, platform: "lg-signage" });
  e.agent.start();
  await e.until(() => e.uiCalls("code").length > 0, "code");
  const b = e.server.events.find((x) => x.what === "pair_request").body;
  assert.strictEqual(b.mac_address, "a4:36:c7:00:12:ef");
  assert.strictEqual(b.platform, "lg-signage");
  assert.ok(e.uiCalls("code")[0].v.code.endsWith("-12EF"));
  e.stop();
});

test("pairing: polls every poll_interval_s, 60 s claimed notice, token saved only after it", async () => {
  const e = makeEnv();
  e.agent.start();
  await e.until(() => e.server.count("poll") >= 3, "three polls");
  const polls = e.server.times(PATH + "pair/status");
  for (let i = 1; i < polls.length; i++) assert.ok(polls[i] - polls[i - 1] >= 4000, "poll gap " + (polls[i] - polls[i - 1]));
  e.server.claim("Lobby Left", "Example Co");
  await e.until(() => e.uiCalls("claimed").length > 0, "claimed notice");
  const issued = e.server.events.find((x) => x.what === "token_issued").t;
  const first = e.uiCalls("claimed")[0];
  assert.strictEqual(first.v.name, "Lobby Left");
  assert.strictEqual(first.v.account, "Example Co");
  assert.strictEqual(first.v.seconds, 60);
  await e.until(() => e.uiCalls("claimed").length === 60, "60 s of notice");
  assert.strictEqual(e.mem["rc.token"], undefined, "token not saved during the notice");
  await e.until(() => e.mem["rc.token"] !== undefined, "token saved");
  assert.ok(e.clock.t - issued >= 60000, "saved after the notice");
  await e.until(() => e.server.count("checkin") > 0 && e.uiCalls("play").length > 0, "check-in and player");
  assert.ok(e.mem["rc.device_id"].startsWith("d_"));
  // the key and the token never reach the log
  const secrets = [e.mem["rc.token"], e.mem["rc.seed"]];
  for (const m of e.logs) for (const s of secrets) assert.ok(m.indexOf(s) < 0, "secret logged: " + m);
  e.stop();
});

test("pairing: poll_interval_s is clamped to at least 3 s", async () => {
  const e = makeEnv({ server: { pollInterval: 1 } });
  e.agent.start();
  await e.until(() => e.server.count("poll") >= 3, "polls");
  const polls = e.server.times(PATH + "pair/status");
  for (let i = 1; i < polls.length; i++) assert.ok(polls[i] - polls[i - 1] >= 3000);
  e.stop();
});

test("pairing: an expired code is replaced by a new one", async () => {
  const e = makeEnv({ server: { expires: 60 } });
  e.agent.start();
  await e.until(() => e.server.count("pair_request") >= 2, "second code");
  const codes = e.server.events.filter((x) => x.what === "pair_request");
  assert.ok(codes[1].t - codes[0].t >= 60000);
  assert.strictEqual(e.uiCalls("code").length, 2);
  e.stop();
});

test("pairing: 410 pairing_expired → new code at once", async () => {
  const e = makeEnv();
  e.server.override[PATH + "pair/status"] = [{ status: 410, error: "pairing_expired" }];
  e.agent.start();
  await e.until(() => e.server.count("pair_request") >= 2, "second code");
  e.stop();
});

test("pairing: three signature failures → new code; one bad_timestamp corrects the clock", async () => {
  const e = makeEnv();
  const bad = { status: 401, error: "bad_signature" };
  e.server.override[PATH + "pair/status"] = [bad, bad, bad];
  e.agent.start();
  await e.until(() => e.server.count("pair_request") >= 2, "second code");
  e.stop();

  const s = makeEnv({ serverSkew: 10 * 60 * 1000 });            // device clock 10 min behind
  s.agent.start();
  await s.until(() => s.uiCalls("code").length > 0, "code despite the clock");
  const reqs = s.server.requests.filter((x) => x.path === PATH + "pair/request");
  assert.strictEqual(reqs.length, 2, "one rejected, one accepted");
  const ts = Number(reqs[1].headers["X-RingCast-Timestamp"]);
  assert.ok(Math.abs(ts - (s.clock.t + 10 * 60 * 1000)) < 5000, "signed with the server's time");
  s.stop();
});

test("pairing: Retry-After on 429 is honoured; network trouble backs off 5, 10, 20 s", async () => {
  const e = makeEnv();
  e.server.override[PATH + "pair/request"] = [{ status: 429, error: "rate_limited", headers: { "Retry-After": "7" } }];
  e.agent.start();
  await e.until(() => e.uiCalls("code").length > 0, "code");
  const t = e.server.times(PATH + "pair/request");
  assert.ok(t[1] - t[0] >= 7000 && t[1] - t[0] < 8000, "waited " + (t[1] - t[0]));
  assert.strictEqual(e.uiCalls("message")[0].v.titleKey, "busy_title");
  e.stop();

  const n = makeEnv();
  n.server.down = true;
  n.agent.start();
  await n.until(() => n.server.times(PATH + "pair/request").length >= 4, "retries");
  n.server.down = false;
  await n.until(() => n.uiCalls("code").length > 0, "code after the network returns");
  const tt = n.server.times(PATH + "pair/request");
  assert.deepStrictEqual(tt.slice(1, 4).map((x, i) => x - tt[i]), [5000, 10000, 20000]);
  assert.strictEqual(n.uiCalls("message")[0].v.titleKey, "unreachable_title");
  n.stop();
});

test("pairing: lost polls keep the code on screen; 426 says the server needs updating", async () => {
  const e = makeEnv();
  e.server.override[PATH + "pair/status"] = ["down", "down"];
  e.agent.start();
  await e.until(() => e.server.count("poll") >= 1, "a poll after the outage");
  assert.strictEqual(e.uiCalls("code").length, 1, "same code");
  assert.ok(e.uiCalls("pair_problem").some((c) => c.v === true));
  assert.strictEqual(e.uiCalls("pair_problem").pop().v, false);
  e.stop();

  const o = makeEnv();
  o.server.override[PATH + "pair/request"] = [{ status: 426, error: "protocol_unsupported" }];
  o.agent.start();
  await o.until(() => o.uiCalls("code").length > 0, "code an hour later");
  const t = o.server.times(PATH + "pair/request");
  assert.ok(t[1] - t[0] >= 3600 * 1000);
  assert.strictEqual(o.uiCalls("message")[0].v.titleKey, "server_old_title");
  o.stop();
});

// ── running ─────────────────────────────────────────────────────────────
test("check-in: status report, interval from the server clamped to 10..600 s", async () => {
  const e = makeEnv({ claimedSeconds: 1, server: { checkinInterval: 1 } });
  await e.pairAndRun();
  const b = e.server.events.find((x) => x.what === "checkin").body;
  assert.deepStrictEqual(Object.keys(b).sort(), ["capabilities", "client_version", "display", "ip", "uptime_s"]);
  assert.deepStrictEqual(b.capabilities, ["refresh", "restart_player", "set_orientation", "unpair"]);
  assert.deepStrictEqual(b.display, { orientation: "landscape", width: 1920, height: 1080 });
  assert.strictEqual(b.ip, "192.0.2.10");
  assert.ok(Number.isInteger(b.uptime_s) && b.uptime_s >= 0);
  await e.until(() => e.server.count("checkin") >= 3, "more check-ins");
  const t = e.server.times(PATH + "checkin");
  assert.ok(t[2] - t[1] >= 10000 && t[2] - t[1] < 12000, "gap " + (t[2] - t[1]));
  e.stop();

  const f = makeEnv({ claimedSeconds: 1, server: { checkinInterval: 100000 } });
  await f.pairAndRun();
  await f.until(() => f.server.count("checkin") >= 3, "check-ins");
  const ft = f.server.times(PATH + "checkin");
  assert.ok(ft[2] - ft[1] >= 600000 && ft[2] - ft[1] < 602000, "gap " + (ft[2] - ft[1]));
  f.stop();
});

test("token: 401 unauthorized → signed renewal once → request retried with the new token", async () => {
  const e = makeEnv({ claimedSeconds: 1 });
  await e.pairAndRun();
  const id = e.mem["rc.device_id"];
  e.server.devices[id].token = "server-forgot-it";
  const before = e.server.count("checkin");
  await e.until(() => e.server.count("checkin") > before, "check-in after renewal");
  assert.strictEqual(e.server.count("renewed"), 1);
  assert.strictEqual(e.mem["rc.token"], e.server.devices[id].token, "new token saved");
  const r = e.server.requests.find((x) => x.path === PATH + "token/renew");
  assert.strictEqual(r.headers["X-RingCast-Key-Id"], id);
  assert.strictEqual(r.body, "{}");
  e.stop();
});

test("token: device_revoked → token forgotten, key kept, back to pairing", async () => {
  const e = makeEnv({ claimedSeconds: 1 });
  await e.pairAndRun();
  const seed = e.mem["rc.seed"];
  e.server.devices[e.mem["rc.device_id"]].revoked = true;
  await e.until(() => e.server.count("pair_request") >= 2, "pairing again");
  assert.strictEqual(e.mem["rc.token"], undefined);
  assert.strictEqual(e.mem["rc.device_id"], undefined);
  assert.strictEqual(e.mem["rc.seed"], seed);
  assert.ok(e.uiCalls("stop").length > 0, "player stopped");
  e.stop();
});

test("offline: network errors keep the token, back off 5 s doubling to 5 min, marker shown", async () => {
  const e = makeEnv({ claimedSeconds: 1 });
  await e.pairAndRun();
  const token = e.mem["rc.token"];
  e.server.down = true;
  const from = e.server.requests.length;
  await e.until(() => e.server.requests.slice(from).filter((x) => x.path === PATH + "checkin").length >= 10, "retries");
  const t = e.server.requests.slice(from).filter((x) => x.path === PATH + "checkin").map((x) => x.t);
  const gaps = t.slice(1).map((x, i) => Math.round((x - t[i]) / 1000));
  assert.deepStrictEqual(gaps.slice(0, 8), [5, 10, 20, 40, 80, 160, 300, 300]);
  assert.strictEqual(e.mem["rc.token"], token, "token kept");
  assert.strictEqual(e.ui.offline, true);
  assert.strictEqual(e.uiCalls("frame_error").length, 0, "content keeps playing");
  e.server.down = false;
  const n = e.server.count("checkin");
  await e.until(() => e.server.count("checkin") > n, "back online");
  assert.strictEqual(e.ui.offline, false);
  e.server.down = true;
  const from2 = e.server.requests.length;
  await e.until(() => e.server.requests.slice(from2).filter((x) => x.path === PATH + "checkin").length >= 2, "retry");
  const t2 = e.server.requests.slice(from2).filter((x) => x.path === PATH + "checkin").map((x) => x.t);
  assert.strictEqual(Math.round((t2[1] - t2[0]) / 1000), 5, "backoff reset after success");
  e.stop();
});

test("offline: 5xx keeps the token and backs off; check-in errors are reported later", async () => {
  const e = makeEnv({ claimedSeconds: 1 });
  await e.pairAndRun();
  const token = e.mem["rc.token"];
  const f = { status: 502, error: "bad_gateway" };
  e.server.override[PATH + "checkin"] = [f, f, f];
  const n = e.server.count("checkin");
  await e.until(() => e.server.count("checkin") > n, "recovered");
  assert.strictEqual(e.mem["rc.token"], token);
  const last = e.server.events.filter((x) => x.what === "checkin").pop().body;
  assert.ok(last.errors && last.errors.some((m) => /HTTP 502/.test(m)), JSON.stringify(last.errors));
  const next = e.server.count("checkin");
  await e.until(() => e.server.count("checkin") > next, "next check-in");
  assert.strictEqual(e.server.events.filter((x) => x.what === "checkin").pop().body.errors, undefined, "sent once");
  e.stop();
});

// ── commands ────────────────────────────────────────────────────────────
async function command(e, c) {
  const before = e.server.count("checkin");
  e.server.queue.push(c);
  await e.until(() => e.server.count("checkin") > before + 1, "command handled");
}

test("commands: set_orientation is acknowledged and reloads the player; repeats and invalid ones", async () => {
  const e = makeEnv({ claimedSeconds: 1 });
  await e.pairAndRun();
  const sessions = e.server.sessions, plays = e.uiCalls("play").length;
  await command(e, { id: "c_1", type: "set_orientation", args: { orientation: "portrait_cw" } });
  await command(e, { id: "c_1", type: "set_orientation", args: { orientation: "portrait_cw" } });
  assert.deepStrictEqual(plain(e.server.results), [{ id: "c_1", ok: true, message: "reloading the player" }]);
  assert.strictEqual(e.server.sessions, sessions + 1, "one new player session");
  assert.strictEqual(e.uiCalls("play").length, plays + 1, "frame reloaded once");
  const ev = e.server.events.map((x) => x.what);
  assert.ok(ev.lastIndexOf("result") < ev.lastIndexOf("session"), "result first, then the reload");
  assert.strictEqual(e.mem["rc.orientation"], undefined, "nothing stored");
  const b = e.server.events.filter((x) => x.what === "checkin").pop().body;
  assert.deepStrictEqual(b.display, { width: 1920, height: 1080, orientation: "landscape" }, "the real screen");
  await command(e, { id: "c_2", type: "set_orientation", args: { orientation: "sideways" } });
  await command(e, { id: "c_3", type: "reboot", args: {} });
  await command(e, { id: "c_4", type: "dance" });
  await command(e, { id: "c_5", type: "refresh", args: "x" });
  await command(e, { id: "c_6", type: "refresh", args: { pad: "x".repeat(5000) } });
  await command(e, { id: "../c", type: "refresh" });
  const r = plain(e.server.results).slice(1);
  assert.deepStrictEqual(r.map((x) => [x.id, x.ok]), [["c_2", false], ["c_3", false], ["c_4", false], ["c_5", false],
    ["c_6", false]]);
  assert.strictEqual(r[0].message, "invalid orientation");
  assert.strictEqual(r[1].message, "reboot is not supported on this screen");
  assert.strictEqual(r[2].message, "unknown command 'dance'");
  assert.strictEqual(r[3].message, "invalid command arguments");
  assert.strictEqual(e.server.sessions, sessions + 1, "invalid set_orientation doesn't reload");
  // handled ids survive an app restart
  e.stop();
  e.agent = e.newAgent();
  e.agent.start();
  await e.until(() => e.server.count("checkin") > 0 && e.uiCalls("play").length > plays + 1, "restarted");
  const s2 = e.server.sessions;
  await command(e, { id: "c_1", type: "set_orientation", args: { orientation: "landscape" } });
  assert.strictEqual(e.server.results.length, 6, "repeat after restart ignored");
  assert.strictEqual(e.server.sessions, s2);
  assert.ok(JSON.parse(e.mem["rc.commands"]).length <= 50);
  e.stop();
});

test("check-in: display orientation follows the real screen size", async () => {
  const e = makeEnv({ claimedSeconds: 1 });
  e.ui.size = { width: 1080, height: 1920 };
  await e.pairAndRun();
  const b = e.server.events.find((x) => x.what === "checkin").body;
  assert.deepStrictEqual(b.display, { width: 1080, height: 1920, orientation: "portrait_cw" });
  e.stop();
});

test("commands: refresh starts a new player session and reports it", async () => {
  const e = makeEnv({ claimedSeconds: 1 });
  await e.pairAndRun();
  const s = e.server.sessions;
  await command(e, { id: "c_r", type: "refresh", args: {} });
  assert.strictEqual(e.server.sessions, s + 1);
  assert.strictEqual(e.uiCalls("play").length, 2);
  assert.deepStrictEqual(plain(e.server.results), [{ id: "c_r", ok: true, message: "reloaded" }]);
  e.stop();
});

test("commands: restart_player and unpair post the result first, then act", async () => {
  const e = makeEnv({ claimedSeconds: 1 });
  await e.pairAndRun();
  e.server.queue.push({ id: "c_rs", type: "restart_player", args: {} });
  await e.until(() => e.server.count("reload") > 0, "reload");
  const ev = e.server.events.map((x) => x.what);
  assert.ok(ev.indexOf("result") >= 0 && ev.indexOf("result") < ev.indexOf("reload"), ev.join(","));
  assert.strictEqual(e.server.results[0].ok, true);
  const n = e.server.requests.length;
  for (let i = 0; i < 50; i++) await tick();
  assert.strictEqual(e.server.requests.length, n, "nothing more until the app reloads");

  const u = makeEnv({ claimedSeconds: 1 });
  await u.pairAndRun();
  u.server.queue.push({ id: "c_up", type: "unpair", args: {} });
  await u.until(() => u.server.count("pair_request") >= 2, "pairing again");
  const res = u.server.events.find((x) => x.what === "result");
  assert.ok(res.ok === true && res.id === "c_up");
  const pr = u.server.events.filter((x) => x.what === "pair_request")[1];
  assert.ok(res.t <= pr.t);
  assert.strictEqual(u.mem["rc.token"], undefined);
  u.stop();
});

// ── player sessions ─────────────────────────────────────────────────────
test("player: session renewed before it expires", async () => {
  const e = makeEnv({ claimedSeconds: 1, server: { sessionExpires: 100 } });
  await e.pairAndRun();
  const t0 = e.server.events.find((x) => x.what === "session").t;
  await e.until(() => e.server.sessions >= 2, "renewal");
  const t1 = e.server.events.filter((x) => x.what === "session")[1].t;
  assert.ok(t1 - t0 >= 80000 && t1 - t0 < 82000, "renewed after " + (t1 - t0));
  e.stop();
});

test("player: a URL off our server or not https is refused with a reason on screen", async () => {
  const e = makeEnv({ claimedSeconds: 1 });
  e.server.override[PATH + "player-session"] = [function () {
    return this.json(200, { url: "http://signage.example.com/api/device/v1/play/start?s=" + "A".repeat(32), expires_in_s: 86400 });
  }];
  e.agent.start();
  await e.until(() => e.uiCalls("code").length > 0, "code");
  e.server.claim();
  await e.until(() => e.uiCalls("frame_error").length > 0, "frame error");
  const fe = e.uiCalls("frame_error")[0].v;
  assert.strictEqual(fe.reasonKey, "frame_session_url");
  assert.strictEqual(fe.vars.where, "http://signage.example.com");
  assert.strictEqual(e.uiCalls("play").length, 0);
  await e.until(() => e.uiCalls("play").length > 0, "retried with a good URL");
  assert.ok(e.uiCalls("frame_ok").length > 0);
  e.stop();
});

test("player: a page that never loads, or reports an error, is shown and retried with a new session", async () => {
  const e = makeEnv({ claimedSeconds: 1, autoLoad: false });
  await e.pairAndRun();
  await e.until(() => e.uiCalls("frame_error").length > 0, "frame timeout");
  assert.strictEqual(e.uiCalls("frame_error")[0].v.reasonKey, "frame_timeout");
  assert.strictEqual(e.uiCalls("frame_error")[0].v.hintKey, "frame_cookie_hint");
  await e.until(() => e.uiCalls("play").length >= 2, "new session in the frame");
  const fe = e.uiCalls("frame_error")[0].t, p2 = e.uiCalls("play")[1].t;
  assert.ok(p2 - fe >= 10000 && p2 - fe < 12000, "new session 10 s after the error, not " + (p2 - fe));
  e.ui.frame = { state: "error", since: e.clock.t, error: "no_session" };
  await e.until(() => e.uiCalls("frame_error").length >= 2, "player error reported");
  const v = e.uiCalls("frame_error")[1].v;
  assert.strictEqual(v.reasonKey, "frame_player_error");
  assert.strictEqual(v.vars.error, "no_session");
  assert.strictEqual(v.hintKey, "frame_no_session_hint");
  // another error code: shown with its code, without the cookie explanation
  await e.until(() => e.uiCalls("play").length >= 3, "next session");
  e.ui.frame = { state: "error", since: e.clock.t, error: "manifest_failed" };
  await e.until(() => e.uiCalls("frame_error").length >= 3, "second player error");
  const w = e.uiCalls("frame_error")[2].v;
  assert.strictEqual(w.reasonKey, "frame_player_error");
  assert.strictEqual(w.vars.error, "manifest_failed");
  assert.strictEqual(w.hintKey, "");
  e.stop();
});

test("player: a server refusing sessions shows HTTP status and error code", async () => {
  const e = makeEnv({ claimedSeconds: 1 });
  e.server.override[PATH + "player-session"] = [{ status: 403, error: "forbidden" }];
  e.agent.start();
  await e.until(() => e.uiCalls("code").length > 0, "code");
  e.server.claim();
  await e.until(() => e.uiCalls("frame_error").length > 0, "frame error");
  const v = e.uiCalls("frame_error")[0].v;
  assert.strictEqual(v.reasonKey, "frame_session_http");
  assert.deepStrictEqual(plain(v.vars), { status: 403, error: "forbidden" });
  e.stop();
});

// ── server address ──────────────────────────────────────────────────────
test("address: first start asks for it; a NetRing server is accepted and pairing starts", async () => {
  const e = makeEnv({ server_address: false });
  e.agent.start();
  assert.strictEqual(e.uiCalls("address")[0].v.value, "https://");
  assert.strictEqual(e.uiCalls("address")[0].v.canGoBack, false);
  assert.strictEqual(e.uiCalls("address")[0].v.error, "");
  assert.strictEqual(plain(await e.agent.submitAddress("https://other.example.com")).error, "unreachable");
  assert.strictEqual(plain(await e.agent.submitAddress("http://signage.example.com")).error, "https_only");
  const ok = await e.agent.submitAddress("https://Signage.Example.com/");
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(e.mem["rc.server"], ORIGIN);
  await e.until(() => e.uiCalls("code").length > 0, "code");
  // BLUE on the pairing screen: change the address; BACK keeps the current one
  assert.strictEqual(e.agent.changeServer(), true);
  assert.strictEqual(e.uiCalls("address")[1].v.value, ORIGIN);
  assert.strictEqual(e.uiCalls("address")[1].v.canGoBack, true);
  const n = e.server.count("pair_request");
  assert.strictEqual(e.agent.cancelAddress(), true);
  await e.until(() => e.server.count("pair_request") > n, "pairing again");
  e.stop();
});

test("address: not a signage server, no CORS, unreachable, private name", async () => {
  const e = makeEnv({ server_address: false });
  e.agent.start();
  const T = PATH + "time";
  e.server.override[T] = [function () { return this.json(200, { hello: "world" }); }];
  assert.strictEqual(plain(await e.agent.submitAddress(ORIGIN)).error, "not_signage");
  e.server.override[T] = [function () { return this.json(404, { error: "not_found" }); }];
  assert.strictEqual(plain(await e.agent.submitAddress(ORIGIN)).error, "not_signage");
  // reachable only without CORS: an opaque answer
  e.server.override[T] = ["down", function (p, h, b, init) {
    assert.strictEqual(init.mode, "no-cors");
    return { status: 0, type: "opaque", headers: { get: () => null }, text: async () => "" };
  }];
  assert.strictEqual(plain(await e.agent.submitAddress(ORIGIN)).error, "no_cors");
  e.server.override[T] = ["down", "down"];
  const r = plain(await e.agent.submitAddress(ORIGIN));
  assert.deepStrictEqual(r, { ok: false, error: "unreachable", host: "signage.example.com" });
  assert.strictEqual(plain(await e.agent.submitAddress("https://192.0.2.10")).error, "cert_private");
  assert.strictEqual(plain(await e.agent.submitAddress("https://signage.local")).error, "cert_private");
  assert.strictEqual(e.mem["rc.server"], undefined, "nothing saved");
  // a playing screen ignores BLUE
  e.stop();
});

test("address: the check corrects a wrong device clock before the first signature", async () => {
  const e = makeEnv({ server_address: false, serverSkew: -3 * 3600 * 1000 });
  e.agent.start();
  assert.strictEqual((await e.agent.submitAddress(ORIGIN)).ok, true);
  await e.until(() => e.uiCalls("code").length > 0, "code");
  assert.strictEqual(e.server.times(PATH + "pair/request").length, 1, "no bad_timestamp round trip");
  e.stop();
});

// ── server.json shipped with a signage display's app ───────────────────────
function preset(text) {
  const reads = [];
  return { reads, fn: async (name) => { reads.push(name); if (text instanceof Error) throw text; return text; } };
}

test("preset: a server.json address is checked and the screen goes straight to its pairing code", async () => {
  const r = preset(JSON.stringify({ server: "https://Signage.Example.com/" }));
  const e = makeEnv({ server_address: false, readLocal: r.fn });
  e.agent.start();
  await e.until(() => e.uiCalls("code").length > 0, "code");
  assert.deepStrictEqual(r.reads, ["server.json"]);
  assert.strictEqual(e.uiCalls("address").length, 0, "no address screen");
  assert.strictEqual(e.mem["rc.server"], ORIGIN);
  assert.ok(e.server.requests.some((x) => x.path === PATH + "time"), "checked like a typed address");
  e.stop();
});

test("preset: a failing server.json address is shown on the address screen with the reason", async () => {
  const e = makeEnv({ server_address: false, readLocal: preset(JSON.stringify({ server: ORIGIN })).fn });
  e.server.override[PATH + "time"] = ["down", "down"];
  e.agent.start();
  await e.until(() => e.uiCalls("address").length > 0, "address");
  const a = e.uiCalls("address")[0].v;
  assert.deepStrictEqual(plain(a), { value: ORIGIN, canGoBack: false, error: "unreachable", host: "signage.example.com" });
  assert.strictEqual(e.mem["rc.server"], undefined, "nothing saved");
  assert.strictEqual(e.uiCalls("connecting").length, 1);
  // the address screen works as usual from there
  assert.strictEqual((await e.agent.submitAddress(ORIGIN)).ok, true);
  await e.until(() => e.uiCalls("code").length > 0, "code");
  e.stop();
});

test("preset: anything but a valid https address in server.json is ignored", async () => {
  const bad = [null, "", "not json", "[]", "\"https://signage.example.com\"", JSON.stringify({}),
    JSON.stringify({ server: "http://signage.example.com" }), JSON.stringify({ server: "https://signage.example.com/x" }),
    JSON.stringify({ server: 42 }), JSON.stringify({ server: "https://user:pw@signage.example.com" }),
    JSON.stringify({ server: ORIGIN, pad: "x".repeat(5000) }), new Error("read failed")];
  for (const text of bad) {
    const e = makeEnv({ server_address: false, readLocal: preset(text).fn });
    e.agent.start();
    await e.until(() => e.uiCalls("address").length > 0, "address");
    assert.deepStrictEqual(plain(e.uiCalls("address")[0].v), { value: "https://", canGoBack: false, error: "", host: "" },
      String(text).slice(0, 60));
    assert.strictEqual(e.server.requests.length, 0, "no request for " + String(text).slice(0, 60));
    e.stop();
  }
});

test("preset: only server is used; other fields in server.json change nothing", async () => {
  const text = JSON.stringify({ server: ORIGIN, token: "x".repeat(43), device_id: "d_1", platform: "pi", version: "9" });
  const e = makeEnv({ server_address: false, readLocal: preset(text).fn });
  e.agent.start();
  await e.until(() => e.uiCalls("code").length > 0, "code");
  assert.strictEqual(e.mem["rc.token"], undefined);
  assert.strictEqual(e.mem["rc.device_id"], undefined);
  const b = e.server.events.find((x) => x.what === "pair_request").body;
  assert.strictEqual(b.platform, "lg-tv");
  assert.strictEqual(b.client_version, "0.1.0");
  e.stop();
});

test("preset: a saved server wins; server.json isn't read", async () => {
  const r = preset(JSON.stringify({ server: "https://other.example.com" }));
  const e = makeEnv({ readLocal: r.fn });
  e.agent.start();
  await e.until(() => e.uiCalls("code").length > 0, "code");
  assert.deepStrictEqual(r.reads, []);
  e.stop();
});

test("a playing screen ignores the change-server key", async () => {
  const e = makeEnv({ claimedSeconds: 1 });
  await e.pairAndRun();
  assert.strictEqual(e.agent.changeServer(), false);
  e.stop();
});

module.exports = () => run("agent");
if (require.main === module) module.exports().then((f) => process.exit(f ? 1 : 0));
