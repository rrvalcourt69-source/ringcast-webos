// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// What the display can tell about itself, best effort, through the webOS service bus
// (window.PalmServiceBridge), and leaving the app the platform's way. Everything here is
// optional: without the bus (or when a call is refused or slow) the app still works and simply
// sends less (PROTOCOL §3.1: no MAC address → the code suffix comes from the key).
//
// Only LG's documented services, each covered by a group in appinfo.json "requiredACG":
//   IP    luna://com.palm.connectionmanager/getStatus                         network.query
//   model luna://com.webos.service.tv.systemproperty/getSystemInfo            systemconfig.query
//         {keys: [modelName, sdkVersion]} (fallback: PalmSystem.deviceInfo, no service call)
// One best-effort extra, not covered by a documented group: where the display refuses it, the
// app simply sends no MAC address (the server then can't wake the TV with wake-on-LAN):
//   MAC   luna://com.webos.service.connectionmanager/getinfo
(function (root) {
  "use strict";
  var RC = root.RC = root.RC || {};
  var IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  var live = [];        // bridges kept referenced until they answer (else they may be collected)

  function hasBus() {
    return typeof root.PalmServiceBridge === "function";
  }

  // One call; resolves with the parsed answer, or null on any failure or after timeoutMs.
  function luna(uri, params, timeoutMs) {
    return new Promise(function (resolve) {
      if (!hasBus()) {
        resolve(null);
        return;
      }
      var done = false, bridge;
      function finish(v) {
        if (done) return;
        done = true;
        var i = live.indexOf(bridge);
        if (i >= 0) live.splice(i, 1);
        resolve(v);
      }
      var timer = setTimeout(function () { finish(null); }, timeoutMs || 3000);
      try {
        bridge = new root.PalmServiceBridge();
        live.push(bridge);
        bridge.onservicecallback = function (msg) {
          clearTimeout(timer);
          var v = null;
          try {
            v = JSON.parse(msg);
          } catch (e) {
            v = null;
          }
          finish(v && typeof v === "object" && v.returnValue !== false ? v : null);
        };
        bridge.call(uri, JSON.stringify(params || {}));
      } catch (e) {
        clearTimeout(timer);
        finish(null);
      }
    });
  }

  function str(v, n) {
    return typeof v === "string" ? RC.core.text(v.trim(), n || 64, "") : "";
  }

  function mac(v) {
    var m = str(v, 17).toLowerCase().split("-").join(":");
    return RC.core.validMac(m) ? m : "";
  }

  function ipv4(v) {
    var s = str(v, 15);
    return IPV4_RE.test(s) && s.indexOf("127.") !== 0 && s !== "0.0.0.0" ? s : "";
  }

  // Which interface is in use: {kind: "wired"|"wifi"|"", ip}.
  function parseStatus(st) {
    if (!st) return { kind: "", ip: "" };
    var order = ["wired", "wifi"];
    for (var i = 0; i < order.length; i++) {
      var n = st[order[i]];
      if (n && typeof n === "object" && n.state === "connected" && ipv4(n.ipAddress)) {
        return { kind: order[i], ip: ipv4(n.ipAddress) };
      }
    }
    return { kind: "", ip: "" };
  }

  function parseMac(info, kind) {
    if (!info) return "";
    var wired = info.wiredInfo && mac(info.wiredInfo.macAddress);
    var wifi = info.wifiInfo && mac(info.wifiInfo.macAddress);
    if (kind === "wifi") return wifi || wired || "";
    return wired || wifi || "";
  }

  function palmDeviceInfo() {
    try {
      var ps = root.PalmSystem;
      if (ps && typeof ps.deviceInfo === "string") {
        var d = JSON.parse(ps.deviceInfo);
        if (d && typeof d === "object") return d;
      }
    } catch (e) {
      // not available
    }
    return null;
  }

  function sdkMajor(v) {
    var m = /^(\d{1,2})(\.|$)/.exec(str(v, 16));
    return m ? m[1] : "";
  }

  // {mac, ip, model, tier} with "" for anything unknown. tier is "webos<major>" or "webos".
  async function info() {
    var calls = await Promise.all([
      luna("luna://com.webos.service.tv.systemproperty/getSystemInfo",
        { keys: ["modelName", "sdkVersion", "firmwareVersion"] }, 3000),
      luna("luna://com.palm.connectionmanager/getStatus", {}, 3000),
      luna("luna://com.webos.service.connectionmanager/getinfo", {}, 3000)
    ]);
    var sys = calls[0] || {};
    var net = parseStatus(calls[1]);
    var dev = palmDeviceInfo() || {};
    var modelName = str(sys.modelName, 60) || str(dev.modelName, 60);
    var major = sdkMajor(sys.sdkVersion) || sdkMajor(dev.platformVersionMajor) || sdkMajor(dev.platformVersion);
    return {
      mac: parseMac(calls[2], net.kind),
      ip: net.ip,
      model: modelName ? (/^LG\b/i.test(modelName) ? modelName : "LG " + modelName) : "",
      tier: ("webos" + major).slice(0, 10)
    };
  }

  // Just the current LAN address (for check-ins; the server uses it to reach the TV, §9).
  async function currentIp() {
    return parseStatus(await luna("luna://com.palm.connectionmanager/getStatus", {}, 3000)).ip;
  }

  // BACK from the app's first screen: back to where the user came from (webOS hides or closes
  // the app). The same call LG's webOSTV.js library makes; no service call, no ACG needed.
  // false where the platform doesn't offer it (a desktop browser).
  function platformBack() {
    var sys = root.webOSSystem || root.PalmSystem;
    try {
      if (sys && typeof sys.platformBack === "function") {
        sys.platformBack();
        return true;
      }
    } catch (e) {
      // not available
    }
    return false;
  }

  RC.platform = {
    hasBus: hasBus,
    luna: luna,
    info: info,
    currentIp: currentIp,
    platformBack: platformBack,
    parseStatus: parseStatus,
    parseMac: parseMac
  };
})(typeof window !== "undefined" ? window : this);
