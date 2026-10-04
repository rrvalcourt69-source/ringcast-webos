// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// What the app keeps on the display (PROTOCOL §7): the app's own localStorage, which only this
// app can read. The key seed and the token are never logged or shown.
//
//   rc.seed         Ed25519 private key seed, 32 bytes, base64
//   rc.server       server origin, e.g. https://signage.example.com
//   rc.token        device token (§4)
//   rc.device_id    device id from the claim
//   rc.device_name  the name the server gave this screen
//   rc.commands     ids of the last 50 commands handled (JSON list)
//   rc.orientation  landscape | portrait_cw | portrait_ccw
(function (root) {
  "use strict";
  var RC = root.RC = root.RC || {};

  function Store(storage) {
    this.s = storage;
  }

  Store.prototype.get = function (k) {
    try {
      var v = this.s.getItem(k);
      return typeof v === "string" ? v : null;
    } catch (e) {
      return null;
    }
  };

  Store.prototype.set = function (k, v) {
    try {
      if (v === null || v === undefined) this.s.removeItem(k);
      else this.s.setItem(k, String(v));
      return true;
    } catch (e) {
      return false;
    }
  };

  // The device key, created once. A seed that can't be read is replaced (the screen isn't
  // paired with it in any useful way: the server retires the old record when it re-pairs).
  Store.prototype.key = function () {
    var core = RC.core;
    var seed = null;
    var raw = this.get("rc.seed");
    if (raw) {
      try {
        seed = core.fromBase64(raw);
        if (seed.length !== 32) seed = null;
      } catch (e) {
        seed = null;
      }
    }
    if (!seed) {
      seed = core.newSeed();
      if (!this.set("rc.seed", core.toBase64(seed))) throw new Error("can't save the device key");
    }
    return core.keyFromSeed(seed);
  };

  Store.prototype.server = function () {
    var v = this.get("rc.server");
    var p = v ? RC.core.parseServerAddress(v) : null;
    return p && p.ok ? p.origin : null;
  };

  Store.prototype.setServer = function (origin) {
    return this.set("rc.server", origin);
  };

  Store.prototype.token = function () {
    var v = this.get("rc.token");
    return RC.core.validToken(v) ? v : null;
  };

  Store.prototype.deviceId = function () {
    var v = this.get("rc.device_id");
    return RC.core.validId(v) ? v : null;
  };

  Store.prototype.deviceName = function () {
    return RC.core.text(this.get("rc.device_name"), 80, "");
  };

  Store.prototype.saveDevice = function (token, deviceId, name) {
    this.set("rc.device_id", deviceId);
    this.set("rc.device_name", name);
    return this.set("rc.token", token);
  };

  Store.prototype.saveToken = function (token) {
    return this.set("rc.token", token);
  };

  // Back to pairing: forget the token and device record; the key stays (it is the identity the
  // server recognises when the screen is paired again).
  Store.prototype.forgetDevice = function () {
    this.set("rc.token", null);
    this.set("rc.device_id", null);
    this.set("rc.device_name", null);
  };

  Store.prototype.orientation = function () {
    var v = this.get("rc.orientation");
    return RC.core.ORIENTATIONS.indexOf(v) >= 0 ? v : "landscape";
  };

  Store.prototype.setOrientation = function (o) {
    return this.set("rc.orientation", o);
  };

  Store.prototype.commandLog = function () {
    var self = this;
    return new RC.core.CommandLog(function () {
      return JSON.parse(self.get("rc.commands") || "[]");
    }, function (ids) {
      self.set("rc.commands", JSON.stringify(ids));
    }, 50);
  };

  RC.Store = Store;
})(typeof window !== "undefined" ? window : this);
