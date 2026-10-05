// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// Starts the app: storage, screens and the agent.
(function (root) {
  "use strict";
  var RC = root.RC;

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

  // A file shipped inside the app (server.json, see agent.js), as text; null when it isn't
  // there. XMLHttpRequest, because the app's page is a file:// page and fetch() can't read those.
  function readLocal(name) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) {
        if (done) return;
        done = true;
        resolve(v);
      }
      setTimeout(function () { finish(null); }, 4000);
      try {
        var x = new root.XMLHttpRequest();
        x.open("GET", name, true);
        x.timeout = 3000;
        x.onload = function () {
          finish((x.status === 200 || x.status === 0) && typeof x.responseText === "string" ? x.responseText : null);
        };
        x.onerror = x.ontimeout = x.onabort = function () { finish(null); };
        x.send();
      } catch (e) {
        finish(null);
      }
    });
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
      readLocal: readLocal,
      log: log
    });
    ui.init(agent);
    RC.app = { agent: agent, ui: ui };
    agent.start();
    log("RingCast Player " + RC.config.version + " (" + RC.config.platform + ") started");
  }

  if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start);
  else start();
})(window);
