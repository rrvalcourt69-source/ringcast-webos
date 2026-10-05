// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// A fake NetRing signage server for the Node tests: answers the device endpoints the app uses
// (PROTOCOL §3 to §6) through a fetch() function, checks every signature with Node's own
// Ed25519 (independently of the app's code) and records what the app did, in order.
"use strict";
const crypto = require("crypto");

const LETTERS = "ABCDEFGHJKMNPQRTUVWXYZ";

function sshKeyRaw(text) {
  const m = /^ssh-ed25519 ([A-Za-z0-9+/=]+) ringcast-device$/.exec(text || "");
  if (!m) return null;
  const blob = Buffer.from(m[1], "base64");
  const n1 = blob.readUInt32BE(0);
  if (blob.subarray(4, 4 + n1).toString() !== "ssh-ed25519") return null;
  const n2 = blob.readUInt32BE(4 + n1);
  const raw = blob.subarray(8 + n1, 8 + n1 + n2);
  return raw.length === 32 && 8 + n1 + n2 === blob.length ? raw : null;
}

function verify(raw, method, path, headers, body) {
  const msg = ["RINGCAST-SIG-V1", method, path, headers["X-RingCast-Key-Id"], headers["X-RingCast-Timestamp"],
    headers["X-RingCast-Nonce"], crypto.createHash("sha256").update(body, "utf8").digest("hex")].join("\n");
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]);
  const key = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
  try {
    return crypto.verify(null, Buffer.from(msg, "utf8"), key, Buffer.from(headers["X-RingCast-Signature"] || "", "base64"));
  } catch (e) {
    return false;
  }
}

class FakeServer {
  constructor(opts) {
    opts = opts || {};
    this.origin = opts.origin || "https://signage.example.com";
    this.now = opts.now;                     // () => server clock ms
    this.pollInterval = opts.pollInterval === undefined ? 4 : opts.pollInterval;
    this.expires = opts.expires === undefined ? 900 : opts.expires;
    this.checkinInterval = opts.checkinInterval === undefined ? 30 : opts.checkinInterval;
    this.sessionExpires = opts.sessionExpires === undefined ? 86400 : opts.sessionExpires;
    this.pairings = {};
    this.devices = {};                        // device_id → {raw, token, revoked, oldToken}
    this.nonces = new Set();
    this.events = [];                         // [{t, what, ...}]
    this.requests = [];
    this.queue = [];                          // commands for the next check-in
    this.results = [];
    this.down = false;                        // network failure
    this.override = {};                       // path → [responses] used before normal handling
    this.sessions = 0;
    this.fetch = this.fetch.bind(this);
  }

  ev(what, extra) {
    this.events.push(Object.assign({ t: this.now(), what }, extra || {}));
  }

  json(status, body, headers) {
    const h = Object.assign({}, headers || {});
    return {
      status,
      type: "cors",
      headers: { get: (k) => (Object.prototype.hasOwnProperty.call(h, k) ? h[k] : null) },
      text: async () => JSON.stringify(body),
    };
  }

  err(status, code, extra, headers) {
    return this.json(status, Object.assign({ error: code, message: code }, extra || {}), headers);
  }

  async fetch(url, init) {
    const u = new URL(url);
    const path = u.pathname;
    const headers = init.headers || {};
    const body = init.body === undefined ? "" : init.body;
    this.requests.push({ t: this.now(), method: init.method, path, headers, body, down: this.down });
    if (this.down || u.origin !== this.origin) throw new TypeError("Failed to fetch");
    const ov = this.override[path];
    if (ov && ov.length) {
      const r = ov.shift();
      if (r === "down") throw new TypeError("Failed to fetch");
      if (typeof r === "function") return r.call(this, path, headers, body, init);
      return this.err(r.status, r.error, r.extra, r.headers);
    }
    if (path === "/api/device/v1/time") return this.json(200, { t: this.now() });
    if (headers["X-RingCast-Protocol"] !== "1") return this.err(400, "bad_request");
    const m = /^\/api\/device\/v1\/commands\/([A-Za-z0-9_-]+)\/result$/.exec(path);
    if (m) return this.commandResult(m[1], headers, body);
    const handler = {
      "/api/device/v1/pair/request": this.pairRequest,
      "/api/device/v1/pair/status": this.pairStatus,
      "/api/device/v1/token/renew": this.tokenRenew,
      "/api/device/v1/checkin": this.checkin,
      "/api/device/v1/player-session": this.playerSession,
    }[path];
    if (!handler) return this.err(404, "not_found");
    return handler.call(this, path, headers, body);
  }

  checkSig(raw, path, headers, body, keyId) {
    if (headers["X-RingCast-Key-Id"] !== keyId) return this.err(401, "bad_signature");
    const ts = headers["X-RingCast-Timestamp"] || "", nonce = headers["X-RingCast-Nonce"] || "";
    if (!/^\d{13}$/.test(ts) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return this.err(401, "bad_signature");
    if (Math.abs(Number(ts) - this.now()) > 5 * 60 * 1000) {
      return this.err(401, "bad_timestamp", { server_time_ms: this.now() });
    }
    if (!verify(raw, "POST", path, headers, body)) return this.err(401, "bad_signature");
    if (this.nonces.has(nonce)) return this.err(401, "bad_signature");
    this.nonces.add(nonce);
    return null;
  }

  pairRequest(path, headers, body) {
    const b = JSON.parse(body);
    const raw = sshKeyRaw(b.pubkey);
    if (!raw) return this.err(400, "bad_request");
    const fp = crypto.createHash("sha256").update(raw).digest("hex");
    const bad = this.checkSig(raw, path, headers, body, fp);
    if (bad) return bad;
    let letters = "";
    for (let i = 0; i < 4; i++) letters += LETTERS[crypto.randomInt(LETTERS.length)];
    const suffix = b.mac_address ? b.mac_address.replace(/:/g, "").slice(-4).toUpperCase() : fp.slice(0, 4).toUpperCase();
    const pid = crypto.randomBytes(16).toString("base64url");
    for (const k of Object.keys(this.pairings)) if (this.pairings[k].fp === fp) delete this.pairings[k];
    this.pairings[pid] = { pid, raw, fp, code: letters + "-" + suffix, body: b, status: "waiting",
      expiresAt: this.now() + this.expires * 1000 };
    this.ev("pair_request", { code: letters + "-" + suffix, body: b });
    return this.json(201, { pairing_id: pid, code: letters + "-" + suffix, expires_in_s: this.expires,
      poll_interval_s: this.pollInterval, server_name: "RingCast Manager",
      add_screen_hint: "Screens → Add Screen", protocol: { min: 1, max: 1 } });
  }

  latestPairing() {
    const all = Object.values(this.pairings);
    return all[all.length - 1];
  }

  claim(name, account) {
    const p = this.latestPairing();
    p.status = "claimed";
    p.name = name || "Lobby Left";
    p.account = account || "Example Co";
    p.deviceId = "d_" + crypto.randomBytes(8).toString("hex");
    this.ev("claimed", { code: p.code });
    return p;
  }

  pairStatus(path, headers, body) {
    const b = JSON.parse(body);
    const p = this.pairings[b.pairing_id];
    if (!p || p.expiresAt < this.now()) return this.err(410, "pairing_expired");
    const bad = this.checkSig(p.raw, path, headers, body, p.pid);
    if (bad) return bad;
    this.ev("poll", { pid: p.pid });
    if (p.status !== "claimed") return this.json(200, { status: "waiting" });
    const token = crypto.randomBytes(32).toString("base64url");
    this.devices[p.deviceId] = { raw: p.raw, token, revoked: false };
    this.ev("token_issued", { deviceId: p.deviceId });
    return this.json(200, { status: "claimed", device_id: p.deviceId, device_token: token, name: p.name,
      account_name: p.account });
  }

  tokenRenew(path, headers, body) {
    const id = headers["X-RingCast-Key-Id"];
    const d = this.devices[id];
    if (!d) return this.err(401, "bad_signature");
    const bad = this.checkSig(d.raw, path, headers, body, id);
    if (bad) return bad;
    if (d.revoked) return this.err(401, "device_revoked");
    d.token = crypto.randomBytes(32).toString("base64url");
    this.ev("renewed", { deviceId: id });
    return this.json(200, { device_token: d.token });
  }

  bearer(headers) {
    const a = headers.Authorization || "";
    for (const id of Object.keys(this.devices)) {
      const d = this.devices[id];
      if (a === "Bearer " + d.token) return d.revoked ? "revoked" : Object.assign({ id }, d);
    }
    return null;
  }

  authFail(dev) {
    return dev === "revoked" ? this.err(401, "device_revoked") : this.err(401, "unauthorized");
  }

  checkin(path, headers, body) {
    const dev = this.bearer(headers);
    if (!dev || dev === "revoked") return this.authFail(dev);
    const b = JSON.parse(body);
    this.ev("checkin", { body: b });
    const cmds = this.queue.splice(0);
    return this.json(200, { name: "Lobby Left", server_time_ms: this.now(), manifest_version: "v1",
      checkin_interval_s: this.checkinInterval, commands: cmds });
  }

  playerSession(path, headers, body) {
    const dev = this.bearer(headers);
    if (!dev || dev === "revoked") return this.authFail(dev);
    this.sessions++;
    const code = crypto.randomBytes(24).toString("base64url");
    this.ev("session");
    return this.json(200, { url: this.origin + "/api/device/v1/play/start?s=" + code, expires_in_s: this.sessionExpires });
  }

  commandResult(cid, headers, body) {
    const dev = this.bearer(headers);
    if (!dev || dev === "revoked") return this.authFail(dev);
    const b = JSON.parse(body);
    this.results.push(Object.assign({ id: cid }, b));
    this.ev("result", { id: cid, ok: b.ok, message: b.message });
    return this.json(200, { status: "ok" });
  }

  times(path) {
    return this.requests.filter((r) => r.path === path).map((r) => r.t);
  }

  count(what) {
    return this.events.filter((e) => e.what === what).length;
  }
}

module.exports = { FakeServer, sshKeyRaw, verify };
