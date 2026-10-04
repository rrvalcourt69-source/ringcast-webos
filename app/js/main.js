// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// Starts the app: storage, screens, the agent, and (on standard TVs) the screen-saver opt-out.
(function (root) {
  "use strict";
  var RC = root.RC;
  var APP_ID = "com.netringtech.ringcast";

  function log(msg) {
    try {
      root.console.log("[ringcast] " + msg);
    } catch (e) {
      // no console
    }
  }

  function storage() {
    try {
      return root.localStorage;
    } catch (e) {
      return null;
    }
  }

  function memoryStorage() {
    var m = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; }
    };
  }

  function start() {
    var ls = storage();
    if (!ls) log("localStorage unavailable: settings won't survive a restart");
    var ui = new RC.UI(root.document, root);
    var agent = new RC.Agent({
      store: new RC.Store(ls || memoryStorage()),
      ui: ui,
      fetch: function (url, init) { return root.fetch(url, init); },
      sleep: function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); },
      platform: RC.platform,
      config: RC.config,
      reloadApp: function () { root.location.reload(); },
      log: log
    });
    ui.init(agent);
    RC.app = { agent: agent, ui: ui };
    try {
      RC.platform.keepScreenOn(APP_ID);
    } catch (e) {
      log("screen saver opt-out not available");
    }
    agent.start();
    log("RingCast " + RC.config.version + " (" + RC.config.platform + ") started");
  }

  if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start);
  else start();
})(window);
