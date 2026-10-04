// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// The screens and the TV remote. Every server value is inserted with textContent (never as
// HTML). Remote keys: arrows, OK (Enter), BACK (461), BLUE (406). OK or BLUE on the pairing
// and message screens changes the server address. Nothing secret is ever shown.
(function (root) {
  "use strict";
  var RC = root.RC = root.RC || {};

  var KEY = { ENTER: 13, ESC: 27, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, BACK: 461, BLUE: 406 };
  var SCREENS = ["s-address", "s-connecting", "s-code", "s-claimed", "s-message", "s-player"];
  var FRAME_ALLOW = "autoplay; fullscreen; encrypted-media";
  // The player page runs scripts and keeps its own cookie; it may not navigate the app away.
  var FRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-presentation";

  function UI(doc, win) {
    this.doc = doc;
    this.win = win;
    this.agent = null;
    this.current = "";
    this.canGoBack = false;
    this.vkbVisible = false;
    this.countdown = null;
    this.frame = null;
    this.frameInfo = { state: "none", since: 0, error: "" };
    this.lastDiag = null;
    this.markers = { offline: false, old: false };
  }

  UI.prototype.$ = function (id) {
    return this.doc.getElementById(id);
  };

  UI.prototype.setText = function (id, s) {
    var el = this.$(id);
    if (el) el.textContent = s === undefined || s === null ? "" : String(s);
  };

  UI.prototype.init = function (agent) {
    var self = this;
    this.agent = agent;
    this.doc.documentElement.lang = RC.language();
    var nodes = this.doc.querySelectorAll("[data-t]");
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = RC.t(nodes[i].getAttribute("data-t"));
    this.doc.addEventListener("keydown", function (e) { self.onKey(e); }, true);
    // webOS reports its on-screen keyboard; other engines never fire this.
    this.doc.addEventListener("keyboardStateChange", function (e) {
      self.vkbVisible = !!(e && e.detail && e.detail.visibility);
    });
    this.$("addr-go").addEventListener("click", function () { self.submitAddress(); });
    this.$("footer-key").addEventListener("click", function () { self.agent.changeServer(); });
    this.$("addr").addEventListener("focus", function () { self.mark("addr"); });
    this.$("addr-go").addEventListener("focus", function () { self.mark("addr-go"); });
    this.win.addEventListener("message", function (e) { self.onFrameMessage(e); });
    this.win.addEventListener("resize", function () { self.fit(); });
    this.fit();
  };

  // The screens are laid out at 1920x1080; scale them to whatever the window really is.
  UI.prototype.fit = function () {
    var w = this.win.innerWidth || 1920, h = this.win.innerHeight || 1080;
    var k = Math.min(w / 1920, h / 1080);
    var st = this.$("stage").style;
    st.transform = Math.abs(k - 1) < 0.001 ? "" : "scale(" + k + ")";
    st.left = Math.round((w - 1920 * k) / 2) + "px";
    st.top = Math.round((h - 1080 * k) / 2) + "px";
  };

  UI.prototype.displaySize = function () {
    return { width: this.win.innerWidth || 1920, height: this.win.innerHeight || 1080 };
  };

  UI.prototype.show = function (id) {
    this.current = id;
    this.stopCountdown();
    for (var i = 0; i < SCREENS.length; i++) this.$(SCREENS[i]).hidden = SCREENS[i] !== id;
    // The key hint and diagnostics belong to the setup screens, not to the content.
    var footer = id === "s-code" || id === "s-message" || id === "s-connecting";
    this.$("footer").hidden = !(footer || id === "s-address");
    this.$("footer-key").hidden = !footer;
    if (id !== "s-player") this.stopPlayer();
  };

  UI.prototype.startCountdown = function (id, key, seconds) {
    var self = this, left = Math.max(0, Math.round(seconds || 0));
    this.stopCountdown();
    if (!left) {
      this.setText(id, RC.t("msg_retrying"));
      return;
    }
    this.setText(id, RC.t(key, { s: left }));
    this.countdown = setInterval(function () {
      left--;
      if (left <= 0) {
        self.stopCountdown();
        self.setText(id, RC.t("msg_retrying"));
      } else {
        self.setText(id, RC.t(key, { s: left }));
      }
    }, 1000);
  };

  UI.prototype.stopCountdown = function () {
    if (this.countdown) clearInterval(this.countdown);
    this.countdown = null;
  };

  UI.prototype.setDiag = function (d) {
    this.lastDiag = d;
    var model = d.model || RC.t("model_unknown");
    var vars = { version: d.version, platform: d.platform, model: model, ip: d.ip };
    this.setText("diag", RC.t(d.ip ? "diag_ip" : "diag", vars));
  };

  UI.prototype.diagText = function () {
    return this.$("diag").textContent;
  };

  // ── 1. server address ─────────────────────────────────────────────────
  UI.prototype.showAddress = function (o) {
    this.show("s-address");
    this.canGoBack = !!o.canGoBack;
    this.$("addr").value = o.value || "https://";
    this.setText("addr-keys", RC.t(this.canGoBack ? "addr_keys_back" : "addr_keys"));
    this.status("", false);
    this.busy = false;
    this.focus("addr");
  };

  UI.prototype.status = function (s, isError) {
    var el = this.$("addr-status");
    el.textContent = s;
    el.className = isError ? "status error" : "status";
  };

  UI.prototype.focus = function (id) {
    var el = this.$(id);
    try {
      el.focus();
    } catch (e) {
      // ignore
    }
    if (id === "addr") {
      // caret at the end, after the pre-filled https://
      try {
        var n = el.value.length;
        el.setSelectionRange(n, n);
      } catch (e) {
        // type=url may not allow selection ranges on every engine
      }
    }
    this.mark(id);
  };

  UI.prototype.mark = function (id) {
    this.$("addr").className = id === "addr" ? "focusable focused" : "focusable";
    this.$("addr-go").className = id === "addr-go" ? "focusable focused" : "focusable";
    this.focused = id;
  };

  UI.prototype.submitAddress = async function () {
    if (this.busy || this.current !== "s-address") return;
    var value = this.$("addr").value;
    var p = RC.core.parseServerAddress(value);
    if (!p.ok) {
      this.status(RC.t("err_" + p.error), true);
      this.focus("addr");
      return;
    }
    this.busy = true;
    this.status(RC.t("addr_checking", { host: p.host }), false);
    var res;
    try {
      res = await this.agent.submitAddress(value);
    } catch (e) {
      res = { ok: false, error: "unreachable", host: p.host };
    }
    this.busy = false;
    if (res.ok || res.error === "busy" || this.current !== "s-address") return;
    this.status(RC.t("err_" + res.error, { host: res.host || p.host }), true);
    this.focus("addr-go");
  };

  // ── 2. pairing ────────────────────────────────────────────────────────
  UI.prototype.showConnecting = function (host) {
    this.show("s-connecting");
    this.setText("connecting-text", RC.t("connecting", { host: host }));
  };

  UI.prototype.showCode = function (o) {
    this.show("s-code");
    var code = this.$("code");
    code.textContent = o.code;
    code.className = o.code.length > 9 ? "code long" : "code";
    this.setText("code-enter", RC.t("pair_enter", { server: o.serverName || "NetRing Signage Manager" }));
    this.setText("code-hint", o.hint);
    this.$("code-hint").hidden = !o.hint;
    this.setText("code-server", RC.t("pair_server", { host: o.host }));
    this.$("code-problem").hidden = true;
  };

  UI.prototype.setPairProblem = function (on) {
    this.$("code-problem").hidden = !on;
  };

  UI.prototype.showClaimed = function (o) {
    if (this.current !== "s-claimed") this.show("s-claimed");
    this.setText("claimed-name", o.name);
    this.setText("claimed-by", RC.t("claimed_by", { account: o.account }));
    this.setText("claimed-server", RC.t("pair_server", { host: o.host }));
    this.setText("claimed-wait", RC.t("claimed_wait", { s: o.seconds }));
  };

  UI.prototype.showMessage = function (o) {
    this.show("s-message");
    this.setText("msg-title", RC.t(o.titleKey, o.vars));
    this.setText("msg-detail", RC.t(o.detailKey, o.vars));
    this.setText("msg-server", RC.t("pair_server", { host: o.host }));
    this.startCountdown("msg-retry", "msg_retry_in", o.retryS);
  };

  // ── 3. playing ────────────────────────────────────────────────────────
  UI.prototype.showPlayer = function (orientation) {
    this.show("s-player");
    this.setOrientation(orientation);
    this.$("player-wait").hidden = false;
    this.$("frame-error").hidden = true;
    this.renderMarker();
  };

  UI.prototype.play = function (url) {
    var self = this;
    this.stopPlayer();
    var f = this.doc.createElement("iframe");
    f.setAttribute("allow", FRAME_ALLOW);
    f.setAttribute("allowfullscreen", "");
    f.setAttribute("sandbox", FRAME_SANDBOX);
    f.setAttribute("scrolling", "no");
    f.setAttribute("frameborder", "0");
    f.setAttribute("referrerpolicy", "no-referrer");
    f.setAttribute("title", "player");
    this.frameInfo = { state: "loading", since: Date.now(), error: "" };
    f.addEventListener("load", function () {
      if (self.frame !== f) return;
      if (self.frameInfo.state === "loading") self.frameInfo = { state: "loaded", since: Date.now(), error: "" };
      self.$("player-wait").hidden = true;
    });
    this.frame = f;
    this.$("frame-box").appendChild(f);
    f.src = url;
  };

  UI.prototype.stopPlayer = function () {
    if (this.frame) {
      try {
        this.frame.src = "about:blank";
      } catch (e) {
        // ignore
      }
      if (this.frame.parentNode) this.frame.parentNode.removeChild(this.frame);
    }
    this.frame = null;
    this.frameInfo = { state: "none", since: 0, error: "" };
    var wait = this.$("player-wait");
    if (wait) wait.hidden = false;
  };

  UI.prototype.frameState = function () {
    return this.frameInfo;
  };

  // Optional status from the player page: {type: "ringcast-player", state: "playing" | "error",
  // error: "<code>"}. Accepted only from the frame we opened, on our server's origin.
  UI.prototype.onFrameMessage = function (e) {
    if (!this.frame || e.source !== this.frame.contentWindow || !this.agent || e.origin !== this.agent.origin) return;
    var d = e.data;
    if (!RC.core.isObject(d) || d.type !== "ringcast-player") return;
    if (d.state === "error") {
      this.frameInfo = { state: "error", since: Date.now(), error: RC.core.text(d.error, 60, "error") };
    } else if (d.state === "playing" && this.frameInfo.state !== "error") {
      this.frameInfo = { state: "loaded", since: Date.now(), error: "" };
      this.$("player-wait").hidden = true;
    }
  };

  UI.prototype.showFrameError = function (o) {
    this.setText("frame-reason", RC.t(o.reasonKey, o.vars));
    this.$("frame-hint").hidden = !o.cookieHint;
    var diag = this.diagText();
    this.setText("frame-footer", RC.t("frame_footer", { host: o.host, diag: diag }));
    this.$("frame-error").hidden = false;
    this.$("player-wait").hidden = true;
    this.startCountdown("frame-retry", "msg_retry_in", o.retryS);
  };

  UI.prototype.hideFrameError = function () {
    this.stopCountdown();
    this.$("frame-error").hidden = true;
  };

  UI.prototype.setOffline = function (on) {
    this.markers.offline = !!on;
    this.renderMarker();
  };

  UI.prototype.setServerOld = function (on) {
    this.markers.old = !!on;
    this.renderMarker();
  };

  UI.prototype.renderMarker = function () {
    var m = this.$("marker");
    if (this.markers.old) m.textContent = RC.t("server_old_marker");
    else if (this.markers.offline) m.textContent = RC.t("offline");
    m.hidden = !(this.markers.old || this.markers.offline);
  };

  UI.prototype.setOrientation = function (o) {
    this.$("frame-box").className = o === "portrait_cw" || o === "portrait_ccw" ? o : "";
  };

  // ── remote keys ───────────────────────────────────────────────────────
  UI.prototype.onKey = function (e) {
    var k = e.keyCode;
    // BLUE, or OK on the setup screens (not every remote has colour buttons): change the server.
    if (k === KEY.BLUE || (k === KEY.ENTER && (this.current === "s-code" || this.current === "s-message"))) {
      if (this.agent && this.agent.changeServer()) e.preventDefault();
      return;
    }
    if (this.current !== "s-address") {
      if (k === KEY.BACK) e.preventDefault();       // a signage screen stays where it is
      return;
    }
    var inField = this.focused === "addr";
    if (k === KEY.BACK || (k === KEY.ESC && !this.vkbVisible)) {
      if (this.canGoBack && this.agent.cancelAddress()) e.preventDefault();
      else if (k === KEY.BACK) e.preventDefault();
      return;
    }
    if (k === KEY.DOWN || (k === KEY.RIGHT && !inField)) {
      if (inField && !this.vkbVisible) {
        e.preventDefault();
        this.focus("addr-go");
      }
      return;
    }
    if (k === KEY.UP || (k === KEY.LEFT && !inField)) {
      if (!inField) {
        e.preventDefault();
        this.focus("addr");
      }
      return;
    }
    if (k === KEY.ENTER) {
      if (!inField) {
        e.preventDefault();
        this.submitAddress();
        return;
      }
      if (this.vkbVisible) {
        // "Done" on the on-screen keyboard: close it and go to Connect.
        e.preventDefault();
        this.$("addr").blur();
        this.focus("addr-go");
        return;
      }
      // Keyboard closed: OK opens it (the default action) unless an address is already typed.
      if (RC.core.parseServerAddress(this.$("addr").value).ok) {
        e.preventDefault();
        this.submitAddress();
      }
    }
  };

  RC.UI = UI;
  RC.UI.KEY = KEY;
})(typeof window !== "undefined" ? window : this);
