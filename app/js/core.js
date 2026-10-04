// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// Protocol building blocks (docs/PROTOCOL.txt): device key, public key text, key fingerprint,
// signed requests (§6), and the checks every server value goes through before it is used.
// No DOM access here, so the same file runs in the app and in the Node tests.
(function (root) {
  "use strict";
  var RC = root.RC = root.RC || {};

  var PROTOCOL = 1;
  var CAPABILITIES = ["refresh", "restart_player", "set_orientation", "unpair"];
  var ORIENTATIONS = ["landscape", "portrait_cw", "portrait_ccw"];
  var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var CODE_RE = /^[A-Z]{4,8}-[0-9A-F]{4}$/;
  var MAC_RE = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;
  var NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;
  var SESSION_PATH = "/api/device/v1/play/start";
  var HOST_RE = /^[a-z0-9.-]{1,253}$/;

  // ── bytes and text ────────────────────────────────────────────────────
  function utf8(str) {
    return new TextEncoder().encode(str);
  }

  function concat(parts) {
    var n = 0, i;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n), off = 0;
    for (i = 0; i < parts.length; i++) {
      out.set(parts[i], off);
      off += parts[i].length;
    }
    return out;
  }

  function hex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return s;
  }

  function toBase64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, Array.prototype.slice.call(bytes.subarray(i, i + 0x8000)));
    }
    return root.btoa(s);
  }

  function fromBase64(text) {
    if (typeof text !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) {
      throw new Error("not base64");
    }
    var s = root.atob(text);
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function base64url(bytes) {
    return toBase64(bytes).split("+").join("-").split("/").join("_").split("=").join("");
  }

  function randomBytes(n) {
    var b = new Uint8Array(n);
    root.crypto.getRandomValues(b);
    return b;
  }

  // ── device key (PROTOCOL §3.1, §7) ────────────────────────────────────
  function uint32(n) {
    return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
  }

  function keyFromSeed(seed) {
    if (!(seed instanceof Uint8Array) || seed.length !== 32) throw new Error("seed must be 32 bytes");
    var kp = root.nacl.sign.keyPair.fromSeed(seed);
    return { publicKey: kp.publicKey, secretKey: kp.secretKey };
  }

  function newSeed() {
    return randomBytes(32);
  }

  // "ssh-ed25519 <base64 of the OpenSSH wire format> ringcast-device", as the Pi client sends it.
  function sshPublicKey(publicKey) {
    var name = utf8("ssh-ed25519");
    var blob = concat([uint32(name.length), name, uint32(publicKey.length), publicKey]);
    return "ssh-ed25519 " + toBase64(blob) + " ringcast-device";
  }

  // Lower-case hex SHA-256 of the raw 32-byte public key.
  async function fingerprint(publicKey) {
    return hex(await RC.sha256(publicKey));
  }

  // ── request signatures (PROTOCOL §6) ──────────────────────────────────
  async function signedMessage(method, path, keyId, timestamp, nonce, body) {
    return [
      "RINGCAST-SIG-V1", method.toUpperCase(), path, keyId, String(timestamp), nonce,
      hex(await RC.sha256(utf8(body)))
    ].join("\n");
  }

  async function sign(key, method, path, keyId, timestamp, nonce, body) {
    var msg = await signedMessage(method, path, keyId, timestamp, nonce, body);
    return toBase64(root.nacl.sign.detached(utf8(msg), key.secretKey));
  }

  function newNonce() {
    return base64url(randomBytes(16));                 // 22 characters of A-Z a-z 0-9 _ -
  }

  // Headers for a signed POST. body is the exact string that will be sent.
  async function signatureHeaders(key, method, path, keyId, body, nowMs) {
    var ts = String(Math.floor(nowMs));
    var nonce = newNonce();
    return {
      "X-RingCast-Key-Id": keyId,
      "X-RingCast-Timestamp": ts,
      "X-RingCast-Nonce": nonce,
      "X-RingCast-Signature": await sign(key, method, path, keyId, ts, nonce, body)
    };
  }

  // ── untrusted values ──────────────────────────────────────────────────
  function clamp(v, lo, hi, dflt) {
    if (typeof v !== "number" || !isFinite(v)) return dflt;
    return Math.max(lo, Math.min(hi, Math.trunc(v)));
  }

  // Control and invisible formatting characters: C0/C1 controls, soft hyphen, bidi and zero-width
  // marks, line and paragraph separators, byte order mark, interlinear annotation marks.
  var UNPRINTABLE = (function () {
    var ranges = [[0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x61c, 0x61c], [0x180e, 0x180e],
      [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffb]];
    function esc(c) {
      return "\\" + "u" + ("000" + c.toString(16)).slice(-4);
    }
    return new RegExp("[" + ranges.map(function (r) { return esc(r[0]) + "-" + esc(r[1]); }).join("") + "]", "g");
  })();

  // Server strings are shown as text only: one line, printable, clipped to n characters.
  function text(v, n, dflt) {
    if (dflt === undefined) dflt = "";
    if (typeof v !== "string") return dflt;
    var clean = Array.from(v.replace(UNPRINTABLE, "")).slice(0, n || 80).join("");
    return clean || dflt;
  }

  function isObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  // Retry-After in seconds (1..3600), or the default when absent or unreadable.
  function retryAfter(headerValue, dflt) {
    if (headerValue === null || headerValue === undefined || !/^\s*\d+\s*$/.test(String(headerValue))) return dflt;
    return clamp(parseInt(headerValue, 10), 1, 3600, dflt);
  }

  function validCode(code) {
    return typeof code === "string" && CODE_RE.test(code);
  }

  function validToken(t) {
    return typeof t === "string" && TOKEN_RE.test(t);
  }

  function validId(id) {
    return typeof id === "string" && ID_RE.test(id);
  }

  function validMac(mac) {
    return typeof mac === "string" && MAC_RE.test(mac) && mac !== "00:00:00:00:00:00";
  }

  // §3.1 201 response → what the pairing screen needs, or null if it isn't usable.
  function parsePairResponse(body) {
    if (!isObject(body) || !validId(body.pairing_id) || !validCode(body.code)) return null;
    return {
      pairingId: body.pairing_id,
      code: body.code,
      pollIntervalS: clamp(body.poll_interval_s, 3, 30, 4),
      expiresInS: clamp(body.expires_in_s, 60, 3600, 900),
      serverName: text(body.server_name, 60, ""),
      hint: text(body.add_screen_hint, 60, "")
    };
  }

  // ── server address ────────────────────────────────────────────────────
  // What the admin typed → {ok: true, origin, host} or {ok: false, error}. Only https:// with a
  // host name (or IPv4 address) and optional port; no path, query, fragment or credentials.
  function parseServerAddress(input) {
    var s = typeof input === "string" ? input.trim() : "";
    if (!s || s.toLowerCase() === "https://") return { ok: false, error: "empty" };
    if (!/^https:\/\//i.test(s)) return { ok: false, error: "https_only" };
    var u;
    try {
      u = new URL(s);
    } catch (e) {
      return { ok: false, error: "invalid" };
    }
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname || !HOST_RE.test(u.hostname)
        || u.hostname.charAt(0) === "." || u.hostname.charAt(u.hostname.length - 1) === "."
        || u.hostname.indexOf("..") >= 0) {
      return { ok: false, error: "invalid" };
    }
    if ((u.pathname && u.pathname !== "/") || u.search || u.hash) return { ok: false, error: "address_only" };
    return { ok: true, origin: "https://" + u.host, host: u.host };
  }

  // Addresses that can't have a certificate from a public authority: IP addresses, single-label
  // names and private suffixes. Used only to choose the clearer error message.
  function looksPrivate(host) {
    var name = String(host || "").split(":")[0].toLowerCase();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name) || name.indexOf(".") < 0) return true;
    return /\.(local|lan|internal|intranet|home|corp|localdomain|home\.arpa)$/.test(name);
  }

  // The one-time player URL must point at our own server's play/start (PROTOCOL §5.3).
  function checkSessionUrl(url, origin) {
    if (typeof url !== "string" || url.length > 2048) return null;
    var u, o;
    try {
      u = new URL(url);
      o = new URL(origin);
    } catch (e) {
      return null;
    }
    if (u.protocol !== "https:" || u.username || u.password || u.hash || u.host !== o.host
        || u.pathname !== SESSION_PATH || !/^\?s=[A-Za-z0-9_-]{16,128}$/.test(u.search)) {
      return null;
    }
    return u.href;
  }

  // ── backoff and command de-duplication ────────────────────────────────
  // 5 s, doubling, to 5 min (PROTOCOL §4).
  function Backoff(first, max) {
    this.first = first || 5;
    this.max = max || 300;
    this.current = this.first;
  }
  Backoff.prototype.next = function () {
    var v = this.current;
    this.current = Math.min(this.current * 2, this.max);
    return v;
  };
  Backoff.prototype.reset = function () {
    this.current = this.first;
  };

  // Ids of the last `max` commands handled, kept in storage so repeats are ignored after a restart.
  function CommandLog(load, save, max) {
    this.max = max || 50;
    this.save = save;
    var ids = [];
    try {
      var v = load();
      if (Array.isArray(v)) ids = v.filter(validId);
    } catch (e) {
      ids = [];
    }
    this.ids = ids.slice(-this.max);
  }
  CommandLog.prototype.has = function (id) {
    return this.ids.indexOf(id) >= 0;
  };
  CommandLog.prototype.add = function (id) {
    this.ids.push(id);
    if (this.ids.length > this.max) this.ids = this.ids.slice(-this.max);
    this.save(this.ids.slice());
  };

  RC.core = {
    PROTOCOL: PROTOCOL,
    CAPABILITIES: CAPABILITIES,
    ORIENTATIONS: ORIENTATIONS,
    SESSION_PATH: SESSION_PATH,
    utf8: utf8,
    hex: hex,
    toBase64: toBase64,
    fromBase64: fromBase64,
    base64url: base64url,
    randomBytes: randomBytes,
    keyFromSeed: keyFromSeed,
    newSeed: newSeed,
    sshPublicKey: sshPublicKey,
    fingerprint: fingerprint,
    signedMessage: signedMessage,
    sign: sign,
    newNonce: newNonce,
    NONCE_RE: NONCE_RE,
    signatureHeaders: signatureHeaders,
    clamp: clamp,
    text: text,
    isObject: isObject,
    retryAfter: retryAfter,
    validCode: validCode,
    validToken: validToken,
    validId: validId,
    validMac: validMac,
    parsePairResponse: parsePairResponse,
    parseServerAddress: parseServerAddress,
    looksPrivate: looksPrivate,
    checkSessionUrl: checkSessionUrl,
    Backoff: Backoff,
    CommandLog: CommandLog
  };
})(typeof window !== "undefined" ? window : this);
