// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// The screens, the TV remote and the Magic Remote pointer. Every server value is inserted with
// textContent (never as HTML). Nothing secret is ever shown.
//
// Remote keys: arrows move the focus, OK (Enter) selects, BLUE (406) changes the server on the
// pairing and message screens. BACK (461): on the address screen opened from pairing it keeps
// the current server; everywhere else it leaves the app the platform's way (webOS hides or
// closes it), except while a signage display (lg-signage) plays, where it is ignored. EXIT and
// HOME are handled by webOS itself; other keys (colour, numbers) do nothing.
// Magic Remote: the control under the pointer takes the focus; OK clicks it. While the pointer
// is shown, OK is left to that click, so a press over an empty area does nothing.
(function (root) {
  "use strict";
  var RC = root.RC = root.RC || {};

  var KEY = { ENTER: 13, ESC: 27, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, BACK: 461, BLUE: 406 };
  // Controls of each screen, in focus order (arrows move along this list).
  var CONTROLS = {
    "s-address": ["addr", "addr-go"],
    "s-connecting": ["change-server"],
    "s-code": ["change-server"],
    "s-message": ["change-server"]
  };
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
    this.pointer = false;               // Magic Remote pointer shown
    this.focused = "";
    this.leave = function () {
      return !!(RC.platform && RC.platform.platformBack && RC.platform.platformBack());
    };
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
    // webOS reports the Magic Remote pointer appearing and hiding; any mouse movement counts too.
    this.doc.addEventListener("cursorStateChange", function (e) {
      self.pointer = !!(e && e.detail && e.detail.visibility);
    });
    // Chromium also sends mouse events when the page changes under a still pointer: only a real
    // movement counts.
    var last = "";
    this.doc.addEventListener("mousemove", function (e) {
      var at = e.screenX + "," + e.screenY;
      if (last && at !== last) self.pointer = true;
      last = at;
      if (self.pointer) self.hoverFocus(e.target);
    }, true);
    this.$("addr-go").addEventListener("click", function () { self.submitAddress(); });
    this.$("change-server").addEventListener("click", function () {
      if (self.agent) self.agent.changeServer();
    });
    var ids = ["addr", "addr-go", "change-server"];
    ids.forEach(function (id) {
      var el = self.$(id);
      el.addEventListener("focus", function () { self.mark(id); });
      el.addEventListener("mouseover", function (e) {
        if (self.pointer) self.hoverFocus(e.target);
      });
    });
    // The player frame never takes the keyboard focus (BACK must reach the app): it ignores
    // the pointer (css), and focus is taken back should the page grab it.
    this.win.addEventListener("blur", function () {
      setTimeout(function () {
        if (self.frame && self.doc.activeElement === self.frame) {
          try {
            self.frame.blur();
            self.win.focus();
          } catch (e) {
            // ignore
          }
        }
      }, 0);
    });
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
    this.$("change-server").hidden = !footer;
    if (id !== "s-player") this.stopPlayer();
    var c = this.controls();
    if (c.length && c.indexOf(this.focused) < 0) this.focus(c[0]);
    else if (!c.length) this.blurAll();
  };

  // Hover focus: the control under the pointer is the focused one.
  UI.prototype.hoverFocus = function (node) {
    var c = this.controls();
    for (var n = node, depth = 0; n && depth < 4; n = n.parentNode, depth++) {
      if (n.id && c.indexOf(n.id) >= 0) {
        if (this.focused !== n.id) this.focus(n.id);
        return;
      }
    }
  };

  UI.prototype.controls = function () {
    return CONTROLS[this.current] || [];
  };

  UI.prototype.blurAll = function () {
    var a = this.doc.activeElement;
    try {
      if (a && a !== this.doc.body && a.blur) a.blur();
    } catch (e) {
      // ignore
    }
    this.mark("");
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
    this.status(o.error ? RC.t("err_" + o.error, { host: o.host || "" }) : "", !!o.error);
    this.busy = false;
    // A pre-filled address that failed its check: Connect has the focus, so OK tries again.
    this.focus(o.error ? "addr-go" : "addr");
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
    var ids = ["addr", "addr-go", "change-server"];
    for (var i = 0; i < ids.length; i++) {
      var el = this.$(ids[i]);
      var base = ids[i] === "change-server" ? "focusable key-hint" : "focusable";
      el.className = ids[i] === id ? base + " focused" : base;
    }
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
  UI.prototype.showPlayer = function () {
    this.show("s-player");
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

  // Player status (PROTOCOL §5.3): the player page posts {type: "ringcast-player", state:
  // "playing"} or {type: "ringcast-player", state: "error", error: "<code>"} to its parent.
  // Accepted only when it comes from the frame we opened (event.source), on our server's origin.
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
    this.setText("frame-hint", o.hintKey ? RC.t(o.hintKey) : "");
    this.$("frame-hint").hidden = !o.hintKey;
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

  // ── remote keys ───────────────────────────────────────────────────────
  // BACK from anywhere but the address screen opened from pairing: leave the app the platform's
  // way. A signage display (lg-signage) that is playing ignores it: it plays unattended.
  UI.prototype.back = function () {
    if (this.current === "s-address" && this.canGoBack && this.agent && this.agent.cancelAddress()) return;
    if (this.current === "s-player" && this.agent && this.agent.config && this.agent.config.platform === "lg-signage") return;
    this.leave();
  };

  UI.prototype.onKey = function (e) {
    var k = e.keyCode;
    if (k === KEY.BACK) {
      e.preventDefault();
      if (!this.vkbVisible) this.back();       // with the keyboard open, BACK just closes it
      return;
    }
    if (k === KEY.LEFT || k === KEY.RIGHT || k === KEY.UP || k === KEY.DOWN) this.pointer = false;
    if (k === KEY.ENTER && this.pointer && !this.vkbVisible) {
      // The pointer is shown: OK is the click on the control under it (a separate mouse event),
      // so the key itself must not also activate whatever control has the focus.
      e.preventDefault();
      return;
    }
    // BLUE, or OK on the setup screens (not every remote has colour buttons): change the server.
    if (k === KEY.BLUE || (k === KEY.ENTER && (this.current === "s-code"
        || this.current === "s-message" || this.current === "s-connecting"))) {
      if (this.agent && this.agent.changeServer()) e.preventDefault();
      return;
    }
    if (this.current !== "s-address") return;
    var inField = this.focused === "addr";
    if (k === KEY.ESC && !this.vkbVisible) {
      if (this.canGoBack && this.agent.cancelAddress()) e.preventDefault();
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
      if (this.vkbVisible) {
        // "Done" on the on-screen keyboard: close it and go to Connect.
        e.preventDefault();
        this.$("addr").blur();
        this.focus("addr-go");
        return;
      }
      if (!inField) {
        e.preventDefault();
        this.submitAddress();
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
