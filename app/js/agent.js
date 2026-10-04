// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// The screen's behaviour (docs/PROTOCOL.txt): server address check, pairing (§3), device token
// (§4), check-in and commands (§5.1, §5.2) and the player session shown in a frame (§5.3).
// It matches the RingCast client for Raspberry Pi: same signatures, error handling, backoff,
// the 60 s "Claimed by" notice before the token is saved, and "post the result, then act".
//
// No DOM access: the screens are drawn by the `ui` object it is given (ui.js), and time,
// sleeping, fetch and storage are passed in, so the Node tests run this exact file.
(function (root) {
  "use strict";
  var RC = root.RC = root.RC || {};

  var API = "/api/device/v1/";
  var CLAIMED_S = 60;
  var SESSION_RENEW_S = 20 * 3600;          // renew player sessions well before their 24 h expiry
  var FRAME_LOAD_S = 45;                    // the player page should have loaded by then
  var IP_REFRESH_S = 300;
  var MAX_ARGS = 4096;
  var KNOWN_COMMANDS = ["reboot", "restart_player", "refresh", "screenshot", "update_client",
    "set_orientation", "unpair", "set_server"];

  function Stop() {
    this.name = "Stop";               // the flow was replaced by another (screen change)
  }
  function Revoked(why) {
    this.name = "Revoked";
    this.why = why;
  }

  function Agent(deps) {
    this.store = deps.store;
    this.ui = deps.ui;
    this.fetch = deps.fetch;
    this.sleepFn = deps.sleep;
    this.now = deps.now || function () { return Date.now(); };
    this.platform = deps.platform;
    this.config = deps.config;
    this.reloadApp = deps.reloadApp || function () {};
    this.log = deps.log || function () {};
    this.claimedSeconds = deps.claimedSeconds === undefined ? CLAIMED_S : deps.claimedSeconds;
    this.startedAt = this.now();
    this.gen = 0;
    this.mode = "";
    this.origin = null;
    this.host = "";
    this.clockOffsetMs = 0;
    this.info = { mac: "", ip: "", model: "", tier: "webos" };
    this.infoLoaded = false;
  }

  // ── small helpers ─────────────────────────────────────────────────────
  Agent.prototype.newFlow = function (mode) {
    this.gen++;
    this.mode = mode;
    return this.gen;
  };

  Agent.prototype.check = function (gen) {
    if (gen !== this.gen) throw new Stop();
  };

  Agent.prototype.wait = async function (ms, gen) {
    this.check(gen);
    await this.sleepFn(Math.max(0, ms));
    this.check(gen);
  };

  Agent.prototype.serverNow = function () {
    return this.now() + this.clockOffsetMs;
  };

  Agent.prototype.fixClock = function (serverMs) {
    if (typeof serverMs !== "number" || !isFinite(serverMs) || serverMs <= 0) return;
    var off = Math.round(serverMs - this.now());
    if (Math.abs(off - this.clockOffsetMs) > 1000) this.log("clock offset " + off + " ms");
    this.clockOffsetMs = off;
  };

  Agent.prototype.setServer = function (origin) {
    this.origin = origin;
    this.host = origin ? origin.replace(/^https:\/\//, "") : "";
  };

  Agent.prototype.diag = function () {
    return {
      version: this.config.version,
      platform: this.config.platform,
      model: this.info.model,
      ip: this.info.ip
    };
  };

  Agent.prototype.loadInfo = async function () {
    if (this.infoLoaded) return;
    try {
      var i = await this.platform.info();
      if (i && typeof i === "object") {
        this.info = {
          mac: RC.core.validMac(i.mac) ? i.mac : "",
          ip: typeof i.ip === "string" ? i.ip : "",
          model: RC.core.text(i.model, 100, ""),
          tier: RC.core.text(i.tier, 10, "webos") || "webos"
        };
      }
    } catch (e) {
      // best effort: everything works without it
    }
    this.infoLoaded = true;
    this.infoAt = this.now();
    this.ui.setDiag(this.diag());
  };

  Agent.prototype.refreshIp = async function () {
    if (this.now() - (this.infoAt || 0) < IP_REFRESH_S * 1000) return;
    this.infoAt = this.now();
    try {
      var ip = await this.platform.currentIp();
      if (typeof ip === "string" && ip) this.info.ip = ip;
    } catch (e) {
      // keep the last known address
    }
  };

  // ── HTTP ──────────────────────────────────────────────────────────────
  Agent.prototype.req = function (method, path, headers, body) {
    var h = { "X-RingCast-Protocol": String(RC.core.PROTOCOL) };
    var k;
    for (k in headers) if (Object.prototype.hasOwnProperty.call(headers, k)) h[k] = headers[k];
    if (body !== undefined) h["Content-Type"] = "application/json";
    return RC.http.request(this.fetch, this.origin + path, { method: method, headers: h, body: body });
  };

  // PROTOCOL §6. body is the exact text sent and signed.
  Agent.prototype.signedPost = async function (path, bodyObj, keyId) {
    var body = JSON.stringify(bodyObj);
    var sig = await RC.core.signatureHeaders(this.key, "POST", path, keyId, body, this.serverNow());
    return this.req("POST", path, sig, body);
  };

  Agent.prototype.bearer = function (method, path, bodyObj) {
    return this.req(method, path, { "Authorization": "Bearer " + this.token },
      bodyObj === undefined ? undefined : JSON.stringify(bodyObj));
  };

  // ── start ─────────────────────────────────────────────────────────────
  Agent.prototype.start = function () {
    this.key = this.store.key();
    this.setServer(this.store.server());
    this.ui.setOrientation(this.store.orientation());
    this.ui.setDiag(this.diag());
    if (!this.origin) return this.enterAddress(false);
    if (this.store.token() && this.store.deviceId()) return this.run();
    return this.pair();
  };

  // ── server address ────────────────────────────────────────────────────
  Agent.prototype.enterAddress = function (canGoBack) {
    this.newFlow("address");
    this.ui.showAddress({ value: this.origin || "https://", canGoBack: !!canGoBack });
  };

  // From the pairing and message screens only (the BLUE remote key): a playing screen ignores it.
  Agent.prototype.changeServer = function () {
    if (this.mode !== "pairing") return false;
    this.enterAddress(true);
    return true;
  };

  Agent.prototype.cancelAddress = function () {
    if (this.mode !== "address" || !this.origin) return false;
    this.pair();
    return true;
  };

  // → {ok: true} (and pairing starts) or {ok: false, error, host}
  Agent.prototype.submitAddress = async function (value) {
    if (this.mode !== "address") return { ok: false, error: "busy" };
    var gen = this.gen;
    var p = RC.core.parseServerAddress(value);
    if (!p.ok) return { ok: false, error: p.error };
    var res = await RC.http.checkServer(this.fetch, p.origin, p.host);
    if (gen !== this.gen) return { ok: false, error: "busy" };
    if (!res.ok) return { ok: false, error: res.error, host: p.host };
    this.fixClock(res.t);
    this.store.setServer(p.origin);
    this.setServer(p.origin);
    this.pair();
    return { ok: true };
  };

  // ── pairing (§3) ──────────────────────────────────────────────────────
  Agent.prototype.pair = function () {
    var gen = this.newFlow("pairing");
    var self = this;
    return this.pairLoop(gen).catch(function (e) {
      if (e instanceof Stop) return;
      // Never strand the screen: log, wait, and start pairing again.
      self.log("pairing failed: " + (e && e.message));
      return self.sleepFn(10000).then(function () {
        if (gen === self.gen) self.pair();
      });
    });
  };

  Agent.prototype.message = function (titleKey, detailKey, vars, retryS) {
    this.ui.showMessage({ titleKey: titleKey, detailKey: detailKey, vars: vars || {}, host: this.host, retryS: retryS });
  };

  Agent.prototype.pairLoop = async function (gen) {
    this.ui.showConnecting(this.host);
    await this.loadInfo();
    this.check(gen);
    this.fp = await RC.core.fingerprint(this.key.publicKey);
    this.pub = RC.core.sshPublicKey(this.key.publicKey);
    var backoff = new RC.core.Backoff(5, 300);
    var clockFixes = 0;
    for (;;) {
      this.check(gen);
      var r;
      try {
        r = await this.requestPairing();
      } catch (e) {
        if (!RC.http.isNetError(e)) throw e;
        var w = backoff.next();
        this.message("unreachable_title", "unreachable_detail", {}, w);
        await this.wait(w * 1000, gen);
        continue;
      }
      this.check(gen);
      var err = RC.http.errorCode(r);
      if (r.status === 201 || r.status === 200) {
        var p = RC.core.parsePairResponse(r.body);
        if (!p) {
          var w2 = backoff.next();
          this.message("server_error_title", "bad_response_detail", {}, w2);
          await this.wait(w2 * 1000, gen);
          continue;
        }
        backoff.reset();
        clockFixes = 0;
        var outcome = await this.pollUntilClaimed(p, gen);
        if (outcome === "claimed") return;
        continue;                                   // expired or failing: new code
      }
      if (r.status === 426) {
        this.message("server_old_title", "server_old_detail", {}, 3600);
        await this.wait(3600 * 1000, gen);
      } else if (r.status === 429 || r.status === 503) {
        var ra = RC.core.retryAfter(r.retryAfter, 60);
        this.message("busy_title", "busy_detail", {}, ra);
        await this.wait(ra * 1000, gen);
      } else if (r.status === 401 && err === "bad_timestamp" && clockFixes < 3) {
        clockFixes++;
        this.fixClock(r.body.server_time_ms);
      } else if (r.status === 400 || r.status === 401) {
        var w3 = backoff.next();
        this.message("refused_title", "refused_detail", { reason: err || ("HTTP " + r.status) }, w3);
        await this.wait(w3 * 1000, gen);
      } else {
        var w4 = backoff.next();
        this.message("server_error_title", "server_error_detail", { status: r.status }, w4);
        await this.wait(w4 * 1000, gen);
      }
    }
  };

  Agent.prototype.requestPairing = function () {
    var body = {
      protocol: RC.core.PROTOCOL,
      pubkey: this.pub,
      model: this.info.model || "LG webOS display",
      tier: this.info.tier || "webos",
      client_version: String(this.config.version).slice(0, 32),
      platform: this.config.platform,
      capabilities: RC.core.CAPABILITIES.slice()
    };
    if (this.info.mac) body.mac_address = this.info.mac;
    return this.signedPost(API + "pair/request", body, this.fp);
  };

  // → "claimed" (token saved, player started) or "restart" (new code needed)
  Agent.prototype.pollUntilClaimed = async function (p, gen) {
    var deadline = this.now() + p.expiresInS * 1000;
    var sigFailures = 0;
    this.ui.showCode({ code: p.code, serverName: p.serverName, hint: p.hint, host: this.host });
    while (this.now() < deadline) {
      await this.wait(p.pollIntervalS * 1000, gen);
      var r;
      try {
        r = await this.signedPost(API + "pair/status", { pairing_id: p.pairingId }, p.pairingId);
      } catch (e) {
        if (!RC.http.isNetError(e)) throw e;
        this.ui.setPairProblem(true);              // keep showing the code; try again
        continue;
      }
      this.check(gen);
      var err = RC.http.errorCode(r);
      if (r.status === 200) {
        this.ui.setPairProblem(false);
        if (r.body.status !== "claimed") continue;
        var token = r.body.device_token, deviceId = r.body.device_id;
        if (!RC.core.validToken(token) || !RC.core.validId(deviceId)) {
          this.log("server sent an invalid token; polling again");
          continue;
        }
        await this.claimed(p, token, deviceId, RC.core.text(r.body.name, 80, ""),
          RC.core.text(r.body.account_name, 60, p.serverName), gen);
        return "claimed";
      }
      if (r.status === 429) {
        await this.wait(RC.core.retryAfter(r.retryAfter, 3) * 1000, gen);
      } else if (r.status === 401 && err === "bad_timestamp") {
        this.fixClock(r.body.server_time_ms);
      } else if (r.status === 401) {
        sigFailures++;
        if (sigFailures >= 3) return "restart";
      } else if (r.status === 410) {
        this.log("pairing expired; new code");
        return "restart";
      } else {
        this.ui.setPairProblem(r.status >= 500);
        this.log("unexpected poll response " + r.status + " " + err);
      }
    }
    return "restart";
  };

  // §3.3: show who claimed the screen for 60 s and only then save the token, so turning the
  // display off during the notice leaves it unpaired (a wrong claim is undone).
  Agent.prototype.claimed = async function (p, token, deviceId, name, account, gen) {
    this.mode = "claimed";
    for (var left = this.claimedSeconds; left > 0; left--) {
      this.ui.showClaimed({ name: name, account: account, host: this.host, seconds: left });
      await this.wait(1000, gen);
    }
    this.store.saveDevice(token, deviceId, name);
    this.log("paired");
    this.run();
  };

  // ── running (§4, §5) ──────────────────────────────────────────────────
  Agent.prototype.run = function () {
    var gen = this.newFlow("playing");
    var self = this;
    this.token = this.store.token();
    this.deviceId = this.store.deviceId();
    this.name = this.store.deviceName();
    this.commands = this.store.commandLog();
    this.errors = [];
    this.interval = 30;
    this.backoff = new RC.core.Backoff(5, 300);
    this.nextCheckin = 0;
    this.lastRenew = null;
    this.sessionDue = null;
    this.sessionStarted = null;
    this.sessionRetryAt = 0;
    this.sessionBackoff = new RC.core.Backoff(10, 300);
    this.frameErrorShown = false;
    this.ui.showPlayer(this.store.orientation());
    return this.runLoop(gen).catch(function (e) {
      if (e instanceof Revoked) {
        self.log("returning to pairing: " + e.why);
        self.token = null;
        self.store.forgetDevice();
        self.ui.stopPlayer();
        if (gen === self.gen) self.pair();
        return;
      }
      if (!(e instanceof Stop)) {
        // Never strand the screen: log, wait, and start the loop again.
        self.log("player loop failed: " + (e && e.message));
        if (gen === self.gen) {
          return self.sleepFn(10000).then(function () {
            if (gen === self.gen) self.run();
          });
        }
      }
    });
  };

  Agent.prototype.runLoop = async function (gen) {
    await this.loadInfo();
    for (;;) {
      this.check(gen);
      if (this.now() >= this.nextCheckin) await this.checkinOnce(gen);
      await this.superviseSession(gen);
      await this.wait(1000, gen);
    }
  };

  Agent.prototype.note = function (msg) {
    msg = RC.core.text(msg, 300, "");
    if (!msg) return;
    this.log(msg);
    if (this.errors.indexOf(msg) < 0) {
      this.errors.push(msg);
      if (this.errors.length > 20) this.errors.shift();
    }
  };

  // §4: key-signed renewal/recovery. true when a fresh token is held.
  Agent.prototype.renewToken = async function () {
    if (!this.deviceId) {
      this.note("can't renew the device token: device id missing");
      return false;
    }
    if (this.lastRenew !== null && this.now() - this.lastRenew < 30000) return false;
    this.lastRenew = this.now();
    var r;
    for (var i = 0; i < 2; i++) {
      r = await this.signedPost(API + "token/renew", {}, this.deviceId);
      var err = RC.http.errorCode(r);
      if (r.status === 200) {
        if (RC.core.validToken(r.body.device_token)) {
          this.token = r.body.device_token;
          this.store.saveToken(this.token);
          this.log("device token renewed");
          return true;
        }
        this.note("server sent an invalid device token");
        return false;
      }
      if (r.status === 401 && err === "device_revoked") throw new Revoked("screen removed on the server");
      if (r.status === 401 && err === "bad_timestamp") {
        this.fixClock(r.body.server_time_ms);
        continue;
      }
      break;
    }
    this.note("token renewal failed: HTTP " + r.status + " " + RC.http.errorCode(r));
    return false;
  };

  // A Bearer request; on 401 unauthorized renew once and retry; device_revoked → pairing.
  Agent.prototype.authed = async function (method, path, bodyObj) {
    if (!this.token && !(await this.renewToken())) throw RC.http.NetError("no device token");
    var r = await this.bearer(method, path, bodyObj);
    if (r.status === 401) {
      if (RC.http.errorCode(r) === "device_revoked") throw new Revoked("screen removed on the server");
      if (await this.renewToken()) {
        r = await this.bearer(method, path, bodyObj);
        if (r.status === 401 && RC.http.errorCode(r) === "device_revoked") {
          throw new Revoked("screen removed on the server");
        }
      }
    }
    return r;
  };

  Agent.prototype.statusReport = function () {
    var d = {
      client_version: String(this.config.version).slice(0, 32),
      uptime_s: Math.max(0, Math.floor((this.now() - this.startedAt) / 1000)),
      capabilities: RC.core.CAPABILITIES.slice()
    };
    if (this.info.ip) d.ip = this.info.ip.slice(0, 64);
    var size = this.ui.displaySize();
    var disp = { orientation: this.store.orientation() };
    if (size && size.width > 0 && size.width <= 16384 && size.height > 0 && size.height <= 16384) {
      disp.width = Math.round(size.width);
      disp.height = Math.round(size.height);
    }
    d.display = disp;
    if (this.errors.length) d.errors = this.errors.slice(0, 20);
    return d;
  };

  Agent.prototype.schedule = function (s) {
    this.nextCheckin = this.now() + s * 1000;
  };

  Agent.prototype.backOff = function () {
    this.schedule(this.backoff.next());
  };

  Agent.prototype.checkinOnce = async function (gen) {
    await this.refreshIp();
    var report = this.statusReport();
    var sent = report.errors ? report.errors.length : 0;
    var r;
    try {
      r = await this.authed("POST", API + "checkin", report);
    } catch (e) {
      if (!RC.http.isNetError(e)) throw e;
      this.check(gen);
      this.note("check-in failed: " + e.message);
      this.ui.setOffline(true);
      this.backOff();
      return;
    }
    this.check(gen);
    var err = RC.http.errorCode(r);
    if (r.status === 200) {
      this.backoff.reset();
      this.ui.setOffline(false);
      this.ui.setServerOld(false);
      this.errors.splice(0, Math.min(sent, this.errors.length));
      this.schedule(this.interval);
      await this.processCheckin(r.body, gen);
      this.schedule(this.interval);
    } else if (r.status === 426) {
      this.note("server needs updating (it doesn't speak this protocol version)");
      this.ui.setServerOld(true);
      this.schedule(3600);
    } else if (r.status === 429 || r.status === 503) {
      this.schedule(RC.core.retryAfter(r.retryAfter, 60));
    } else if (r.status >= 500 || r.status === 401) {
      this.note("check-in: HTTP " + r.status + " " + err);
      this.ui.setOffline(r.status >= 500);
      this.backOff();
    } else {
      this.note("check-in rejected: HTTP " + r.status + " " + err);
      this.schedule(this.interval);
    }
  };

  Agent.prototype.processCheckin = async function (body, gen) {
    this.name = RC.core.text(body.name, 80, this.name);
    this.interval = RC.core.clamp(body.checkin_interval_s, 10, 600, 30);
    this.fixClock(body.server_time_ms);
    var cmds = Array.isArray(body.commands) ? body.commands.slice(0, 20) : [];
    for (var i = 0; i < cmds.length; i++) {
      this.check(gen);
      await this.handleCommand(cmds[i], gen);
    }
  };

  // ── commands (§5.2) ───────────────────────────────────────────────────
  Agent.prototype.postResult = async function (cid, ok, message) {
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        var r = await this.authed("POST", API + "commands/" + cid + "/result",
          { ok: !!ok, message: RC.core.text(message || "", 300, "") });
        if (r.status !== 200) this.log("command " + cid + " result: HTTP " + r.status);
        return r.status === 200;
      } catch (e) {
        if (!RC.http.isNetError(e)) throw e;
        this.log("command " + cid + " result not delivered");
        if (attempt === 0) await this.sleepFn(2000);
      }
    }
    return false;
  };

  Agent.prototype.handleCommand = async function (c, gen) {
    if (!RC.core.isObject(c)) return;
    var cid = c.id, type = c.type;
    if (!RC.core.validId(cid) || this.commands.has(cid)) return;
    // Recorded before acting: a command runs at most once, even across an app restart.
    this.commands.add(cid);
    var args = c.args === undefined || c.args === null ? {} : c.args;
    if (!RC.core.isObject(args) || JSON.stringify(args).length > MAX_ARGS) {
      await this.postResult(cid, false, "invalid command arguments");
      return;
    }
    if (KNOWN_COMMANDS.indexOf(type) < 0) {
      await this.postResult(cid, false, "unknown command '" + RC.core.text(type, 40, "") + "'");
      return;
    }
    if (RC.core.CAPABILITIES.indexOf(type) < 0) {
      await this.postResult(cid, false, type + " is not supported on this screen");
      return;
    }
    this.log("command " + cid + ": " + type);
    try {
      if (type === "refresh") {
        var ok = await this.newSession("refresh", gen);
        await this.postResult(cid, ok, ok ? "reloaded" : "couldn't start a player session");
      } else if (type === "restart_player") {
        await this.postResult(cid, true, "restarting the app");
        this.check(gen);
        this.gen++;                                   // stop everything before the reload
        this.reloadApp();
      } else if (type === "set_orientation") {
        var o = args.orientation;
        if (RC.core.ORIENTATIONS.indexOf(o) < 0) {
          await this.postResult(cid, false, "invalid orientation");
        } else {
          this.store.setOrientation(o);
          this.ui.setOrientation(o);
          await this.postResult(cid, true, "");
        }
      } else if (type === "unpair") {
        await this.postResult(cid, true, "unpairing");
        throw new Revoked("unpair command");
      }
    } catch (e) {
      if (e instanceof Revoked || e instanceof Stop) throw e;
      this.log("command " + cid + " failed: " + (e && e.message));
      await this.postResult(cid, false, type + " failed");
    }
  };

  // ── player session (§5.3) ─────────────────────────────────────────────
  // Try again after a backoff. The reason is shown on screen unless the player is still
  // playing from an earlier session (a failed renewal mustn't cover working content).
  Agent.prototype.sessionRetry = function (reasonKey, vars) {
    var wait = this.sessionBackoff.next();
    this.sessionRetryAt = this.now() + wait * 1000;
    this.sessionDue = this.sessionRetryAt;
    var playing = this.sessionStarted !== null && this.ui.frameState().state === "loaded";
    if (playing && reasonKey !== "frame_player_error") return;
    this.ui.showFrameError({ reasonKey: reasonKey, vars: vars || {}, host: this.host, retryS: wait,
      cookieHint: reasonKey === "frame_timeout" || reasonKey === "frame_player_error" });
    this.frameErrorShown = true;
  };

  Agent.prototype.newSession = async function (reason, gen) {
    var r;
    try {
      r = await this.authed("POST", API + "player-session", {});
    } catch (e) {
      if (!RC.http.isNetError(e)) throw e;
      this.check(gen);
      this.note("player session failed: " + e.message);
      this.ui.setOffline(true);
      this.sessionRetry("frame_session_net");
      return false;
    }
    this.check(gen);
    var url = r.status === 200 ? RC.core.checkSessionUrl(r.body.url, this.origin) : null;
    if (!url) {
      if (r.status === 200) {
        var where = "?";
        try {
          var u = new URL(String(r.body.url));
          where = u.protocol + "//" + u.host;
        } catch (e) {
          where = "?";
        }
        this.note("server sent an invalid player URL");
        this.sessionRetry("frame_session_url", { where: RC.core.text(where, 80, "?") });
      } else if (r.status === 429 || r.status === 503) {
        this.sessionRetryAt = this.now() + RC.core.retryAfter(r.retryAfter, 30) * 1000;
        this.sessionDue = this.sessionRetryAt;
      } else {
        this.note("player session failed: HTTP " + r.status + " " + RC.http.errorCode(r));
        this.sessionRetry("frame_session_http", { status: r.status, error: RC.http.errorCode(r) });
      }
      return false;
    }
    var expires = RC.core.clamp(r.body.expires_in_s, 60, 7 * 86400, 86400);
    this.ui.hideFrameError();
    this.frameErrorShown = false;
    this.ui.play(url);
    this.log("player session started (" + reason + ")");
    this.sessionStarted = this.now();
    this.sessionDue = this.now() + Math.min(SESSION_RENEW_S, expires * 0.8) * 1000;
    return true;
  };

  Agent.prototype.superviseSession = async function (gen) {
    var now = this.now();
    if (now < this.sessionRetryAt) return;
    if (this.sessionDue === null || now >= this.sessionDue) {
      await this.newSession(this.sessionDue === null ? "start" : "renewal", gen);
      return;
    }
    var f = this.ui.frameState();
    if (f.state === "loaded" && !this.frameErrorShown && this.sessionStarted !== null
        && now - this.sessionStarted > 60000) {
      this.sessionBackoff.reset();
    }
    if (f.state === "loading" && now - f.since > FRAME_LOAD_S * 1000) {
      this.note("player page didn't load within " + FRAME_LOAD_S + " s");
      this.sessionRetry("frame_timeout", { s: FRAME_LOAD_S });
    } else if (f.state === "error" && !this.frameErrorShown) {
      this.note("player page reported: " + f.error);
      this.sessionRetry("frame_player_error", { error: f.error });
    }
  };

  RC.Agent = Agent;
  RC.Agent.Stop = Stop;
  RC.Agent.Revoked = Revoked;
  RC.Agent.CLAIMED_S = CLAIMED_S;
})(typeof window !== "undefined" ? window : this);
