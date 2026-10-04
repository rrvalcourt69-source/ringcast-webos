// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// Pure helpers: pairing code format, pairing response clamps, server address parsing, the player
// URL check, untrusted text, Retry-After, backoff, command de-duplication, strings.
"use strict";
const assert = require("assert");
const { load, test, run, CORE } = require("./harness");

// Objects made inside the app's VM context have that context's prototypes: compare plain copies.
const eq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);

const RC = load(CORE.concat(["js/strings.js", "js/store.js", "js/platform.js"])).RC;
const C = RC.core;

test("pairing codes: 4 letters (self-hosted) or 6 (cloud), dash, 4 upper-case hex", () => {
  for (const ok of ["HXRT-2B99", "ABCD-0000", "HXRTAB-12EF", "ZZZZ-FFFF"]) assert.ok(C.validCode(ok), ok);
  for (const bad of ["hxrt-2b99", "HXRT-2b99", "HXRT2B99", "HXR-2B99", "HXRT-2B9", "HXRT-2B99 ", "<b>-1234",
    "HXRT-GGGG", "", null, 1234]) {
    assert.ok(!C.validCode(bad), String(bad));
  }
});

test("pairing response: ids checked, numbers clamped, strings clipped", () => {
  const base = { pairing_id: "q3V0abcdefghijklmnopqr", code: "HXRT-2B99", expires_in_s: 900, poll_interval_s: 4,
    server_name: "NetRing Signage Manager", add_screen_hint: "Screens → Add Screen" };
  const p = C.parsePairResponse(base);
  eq(p, { pairingId: base.pairing_id, code: "HXRT-2B99", pollIntervalS: 4, expiresInS: 900,
    serverName: "NetRing Signage Manager", hint: "Screens → Add Screen" });
  assert.strictEqual(C.parsePairResponse(Object.assign({}, base, { poll_interval_s: 0.5 })).pollIntervalS, 3);
  assert.strictEqual(C.parsePairResponse(Object.assign({}, base, { poll_interval_s: 999 })).pollIntervalS, 30);
  assert.strictEqual(C.parsePairResponse(Object.assign({}, base, { poll_interval_s: "4" })).pollIntervalS, 4);
  assert.strictEqual(C.parsePairResponse(Object.assign({}, base, { expires_in_s: 5 })).expiresInS, 60);
  assert.strictEqual(C.parsePairResponse(Object.assign({}, base, { expires_in_s: 1e9 })).expiresInS, 3600);
  assert.strictEqual(C.parsePairResponse(Object.assign({}, base, { server_name: "x".repeat(500) })).serverName.length, 60);
  assert.strictEqual(C.parsePairResponse(Object.assign({}, base, { server_name: "A‮B\nC" })).serverName, "ABC");
  assert.strictEqual(C.parsePairResponse(Object.assign({}, base, { code: "hxrt-2b99" })), null);
  assert.strictEqual(C.parsePairResponse(Object.assign({}, base, { pairing_id: "../x" })), null);
  assert.strictEqual(C.parsePairResponse([]), null);
});

test("server address: https only, address only, normalised origin", () => {
  const ok = (s, origin) => {
    const p = C.parseServerAddress(s);
    assert.ok(p.ok, s + " → " + p.error);
    assert.strictEqual(p.origin, origin);
  };
  ok("https://signage.example.com", "https://signage.example.com");
  ok("  HTTPS://Signage.Example.COM/  ", "https://signage.example.com");
  ok("https://signage.example.com:8443", "https://signage.example.com:8443");
  ok("https://signage.example.com:443/", "https://signage.example.com");
  const bad = (s, err) => assert.strictEqual(C.parseServerAddress(s).error, err, s);
  bad("", "empty");
  bad("https://", "empty");
  bad("http://signage.example.com", "https_only");
  bad("signage.example.com", "https_only");
  bad("https://user:pw@signage.example.com", "invalid");
  bad("https://signage..example.com", "invalid");
  bad("https://[::1]", "invalid");
  bad("https://signage.example.com/lg/", "address_only");
  bad("https://signage.example.com/?a=1", "address_only");
  bad("https://signage.example.com/#x", "address_only");
});

test("addresses that can't have a public certificate", () => {
  for (const h of ["192.0.2.10", "192.0.2.10:8443", "signage", "signage.local", "nsm.lan", "x.home.arpa", "a.corp"]) {
    assert.ok(C.looksPrivate(h), h);
  }
  for (const h of ["signage.example.com", "signage.example.com:8443"]) assert.ok(!C.looksPrivate(h), h);
});

test("player URL must be our server's play/start with a one-time code", () => {
  const o = "https://signage.example.com";
  const code = "s=" + "A".repeat(32);
  assert.strictEqual(C.checkSessionUrl(o + "/api/device/v1/play/start?" + code, o), o + "/api/device/v1/play/start?" + code);
  assert.ok(C.checkSessionUrl("https://signage.example.com:443/api/device/v1/play/start?" + code, o));
  for (const bad of [
    "http://signage.example.com/api/device/v1/play/start?" + code,
    "https://evil.example.net/api/device/v1/play/start?" + code,
    "https://signage.example.com:8443/api/device/v1/play/start?" + code,
    "https://signage.example.com/api/device/v1/play/?" + code,
    "https://signage.example.com/api/device/v1/play/start?s=short",
    "https://signage.example.com/api/device/v1/play/start?" + code + "&x=1",
    "https://signage.example.com/api/device/v1/play/start?" + code + "#f",
    "https://u:p@signage.example.com/api/device/v1/play/start?" + code,
    "javascript:alert(1)", "data:text/html,x", 42, null,
  ]) {
    assert.strictEqual(C.checkSessionUrl(bad, o), null, String(bad));
  }
});

test("tokens, ids and MAC addresses", () => {
  assert.ok(C.validToken("A".repeat(43)));
  assert.ok(!C.validToken("A".repeat(42)));
  assert.ok(!C.validToken("A".repeat(42) + "="));
  assert.ok(C.validId("d_0123456789abcdef") && C.validId("c_91ab"));
  assert.ok(!C.validId("c/../x") && !C.validId("") && !C.validId("x".repeat(65)));
  assert.ok(C.validMac("a4:36:c7:00:12:ef"));
  assert.ok(!C.validMac("A4:36:C7:00:12:EF") && !C.validMac("00:00:00:00:00:00") && !C.validMac("a4-36-c7-00-12-ef"));
});

test("untrusted text: printable, one line, clipped by characters", () => {
  assert.strictEqual(C.text("Lobby\nLeft\u0000​", 80), "LobbyLeft");
  assert.strictEqual(C.text("😀".repeat(5), 3), "😀😀😀");
  assert.strictEqual(C.text(5, 10, "dflt"), "dflt");
  assert.strictEqual(C.text("\u0007", 10, "dflt"), "dflt");
});

test("Retry-After: whole seconds, clamped 1..3600, default otherwise", () => {
  assert.strictEqual(C.retryAfter("7", 60), 7);
  assert.strictEqual(C.retryAfter("0", 60), 1);
  assert.strictEqual(C.retryAfter("99999", 60), 3600);
  assert.strictEqual(C.retryAfter("Wed, 21 Oct 2026 07:28:00 GMT", 60), 60);
  assert.strictEqual(C.retryAfter(null, 3), 3);
});

test("clamp: numbers only, truncated, defaults for junk", () => {
  assert.strictEqual(C.clamp(1, 10, 600, 30), 10);
  assert.strictEqual(C.clamp(100000, 10, 600, 30), 600);
  assert.strictEqual(C.clamp(45.9, 10, 600, 30), 45);
  assert.strictEqual(C.clamp("45", 10, 600, 30), 30);
  assert.strictEqual(C.clamp(NaN, 10, 600, 30), 30);
  assert.strictEqual(C.clamp(Infinity, 10, 600, 30), 30);
});

test("backoff: 5 s doubling to 5 min, reset", () => {
  const b = new C.Backoff(5, 300);
  const seq = [];
  for (let i = 0; i < 9; i++) seq.push(b.next());
  eq(seq, [5, 10, 20, 40, 80, 160, 300, 300, 300]);
  b.reset();
  assert.strictEqual(b.next(), 5);
});

test("command log: repeats ignored, last 50 kept, survives a restart, junk ignored", () => {
  let saved = null;
  const log = new C.CommandLog(() => saved, (ids) => { saved = ids; }, 50);
  for (let i = 0; i < 60; i++) log.add("c_" + i);
  assert.strictEqual(saved.length, 50);
  assert.ok(!log.has("c_9") && log.has("c_10") && log.has("c_59"));
  const again = new C.CommandLog(() => saved, () => {}, 50);
  assert.ok(again.has("c_59") && !again.has("c_0"));
  const junk = new C.CommandLog(() => ["ok_1", 5, "../x", null], () => {}, 50);
  eq(junk.ids, ["ok_1"]);
  const broken = new C.CommandLog(() => { throw new Error("bad json"); }, () => {}, 50);
  eq(broken.ids, []);
});

test("store: key created once, token and server validated, unpair keeps the key", () => {
  const mem = {};
  const ls = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; } };
  const s = new RC.Store(ls);
  const k1 = s.key();
  const k2 = s.key();
  eq(k1.publicKey, k2.publicKey);
  assert.strictEqual(C.fromBase64(mem["rc.seed"]).length, 32);
  mem["rc.seed"] = "garbage!";
  assert.notDeepStrictEqual(s.key().publicKey, k1.publicKey);     // unreadable seed → new key
  mem["rc.server"] = "http://signage.example.com";
  assert.strictEqual(s.server(), null);
  s.setServer("https://signage.example.com");
  assert.strictEqual(s.server(), "https://signage.example.com");
  s.saveDevice("A".repeat(43), "d_1", "Lobby");
  assert.strictEqual(s.token(), "A".repeat(43));
  mem["rc.token"] = "short";
  assert.strictEqual(s.token(), null);
  const seed = mem["rc.seed"];
  s.forgetDevice();
  assert.ok(!("rc.token" in mem) && !("rc.device_id" in mem) && mem["rc.seed"] === seed);
  assert.strictEqual(s.orientation(), "landscape");
  s.setOrientation("portrait_cw");
  assert.strictEqual(s.orientation(), "portrait_cw");
  mem["rc.orientation"] = "upside_down";
  assert.strictEqual(s.orientation(), "landscape");
});

test("strings: English and Spanish have the same keys and placeholders", () => {
  const en = RC.strings.en, es = RC.strings.es;
  eq(Object.keys(es).sort(), Object.keys(en).sort());
  for (const k of Object.keys(en)) {
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(",");
    assert.strictEqual(ph(es[k]), ph(en[k]), k);
  }
  assert.strictEqual(RC.setLanguage("es-MX"), "es");
  assert.strictEqual(RC.t("pair_enter", { server: "X" }), "Introduzca este código en X");
  assert.strictEqual(RC.setLanguage("en-US"), "en");
  assert.strictEqual(RC.setLanguage("fr-FR"), "en");
  assert.strictEqual(RC.t("claimed_by", { account: "<b>Acme</b>" }), "Claimed by <b>Acme</b>");
});

test("platform: interface in use, its MAC, IPv4 only", () => {
  const P = RC.platform;
  eq(P.parseStatus({ wired: { state: "connected", ipAddress: "192.0.2.10" },
    wifi: { state: "disconnected" } }), { kind: "wired", ip: "192.0.2.10" });
  eq(P.parseStatus({ wired: { state: "disconnected" },
    wifi: { state: "connected", ipAddress: "192.0.2.11" } }), { kind: "wifi", ip: "192.0.2.11" });
  eq(P.parseStatus({ wired: { state: "connected", ipAddress: "fe80::1" } }), { kind: "", ip: "" });
  eq(P.parseStatus(null), { kind: "", ip: "" });
  const info = { wiredInfo: { macAddress: "A4:36:C7:00:12:EF" }, wifiInfo: { macAddress: "a4:36:c7:00:12:f0" } };
  assert.strictEqual(P.parseMac(info, "wired"), "a4:36:c7:00:12:ef");
  assert.strictEqual(P.parseMac(info, "wifi"), "a4:36:c7:00:12:f0");
  assert.strictEqual(P.parseMac({ wiredInfo: { macAddress: "nope" } }, "wired"), "");
  assert.strictEqual(P.parseMac(null, ""), "");
});

test("platform: without the webOS bus everything is empty, nothing throws", async () => {
  const i = await RC.platform.info();
  eq(i, { mac: "", ip: "", model: "", tier: "webos" });
  assert.strictEqual(await RC.platform.currentIp(), "");
  assert.strictEqual(typeof RC.platform.keepScreenOn("x"), "function");
});

test("platform: answers from a fake webOS bus", async () => {
  const answers = {
    "luna://com.webos.service.tv.systemproperty/getSystemInfo": { returnValue: true, modelName: "43UN7000PUB", sdkVersion: "5.6.0" },
    "luna://com.webos.service.connectionmanager/getStatus": { returnValue: true,
      wired: { state: "connected", ipAddress: "192.0.2.10" }, wifi: { state: "disconnected" } },
    "luna://com.webos.service.connectionmanager/getinfo": { returnValue: true,
      wiredInfo: { macAddress: "a4:36:c7:00:12:ef" }, wifiInfo: { macAddress: "a4:36:c7:00:12:f0" } },
  };
  function PalmServiceBridge() {}
  PalmServiceBridge.prototype.call = function (uri) {
    const self = this;
    setTimeout(() => self.onservicecallback(JSON.stringify(answers[uri] || { returnValue: false })), 1);
  };
  PalmServiceBridge.prototype.cancel = function () {};
  const R = load(CORE.concat(["js/platform.js"]), { globals: { PalmServiceBridge } }).RC;
  eq(await R.platform.info(), { mac: "a4:36:c7:00:12:ef", ip: "192.0.2.10",
    model: "LG 43UN7000PUB", tier: "webos5" });
});

module.exports = () => run("logic");
if (require.main === module) module.exports().then((f) => process.exit(f ? 1 : 0));
