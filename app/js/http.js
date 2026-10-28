// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// HTTP for the app: fetch with a timeout, JSON in and out, and the server-address check.
// A response always resolves to {status, body, retryAfter}; a request that never got an answer
// (network down, DNS, certificate not trusted, CORS refused, timeout) rejects with a NetError.
// Browsers report all of those the same way, so the address check tells them apart where it can.
(function (root) {
  "use strict";
  var RC = root.RC = root.RC || {};

  function NetError(message) {
    var e = new Error(message || "network error");
    e.name = "NetError";
    e.network = true;
    return e;
  }

  function isNetError(e) {
    return !!(e && e.network === true);
  }

  // fetchFn(url, init) → Promise<Response>. Resolves {status, body (object, {} if not JSON),
  // retryAfter (header text or null)}.
  async function request(fetchFn, url, opts) {
    opts = opts || {};
    var timeoutMs = opts.timeoutMs || 20000;
    var ctl = typeof root.AbortController === "function" ? new root.AbortController() : null;
    var timer = null;
    var init = {
      method: opts.method || "GET",
      headers: opts.headers || {},
      cache: "no-store",
      credentials: "omit",
      redirect: opts.redirect || "error",
      mode: opts.mode || "cors"
    };
    if (opts.body !== undefined && opts.body !== null) init.body = opts.body;
    if (ctl) init.signal = ctl.signal;
    var timeout = new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        if (ctl) ctl.abort();
        reject(NetError("timeout"));
      }, timeoutMs);
    });
    try {
      var resp = await Promise.race([fetchFn(url, init), timeout]);
      if (init.mode === "no-cors") return { status: resp.status, body: {}, retryAfter: null, opaque: resp.type === "opaque" };
      var txt = await Promise.race([resp.text(), timeout]);
      var body = {};
      if (txt) {
        try {
          body = JSON.parse(txt);
        } catch (e) {
          body = {};
        }
      }
      if (!RC.core.isObject(body)) body = {};
      var ra = null;
      try {
        ra = resp.headers && resp.headers.get ? resp.headers.get("Retry-After") : null;
      } catch (e) {
        ra = null;
      }
      return { status: resp.status, body: body, retryAfter: ra };
    } catch (e) {
      if (isNetError(e)) throw e;
      throw NetError(e && e.name === "AbortError" ? "timeout" : "network error");
    } finally {
      clearTimeout(timer);
    }
  }

  // The server's error code (§1: clients act on "error", never on "message"), clipped.
  function errorCode(r) {
    return RC.core.text(r && r.body ? r.body.error : "", 40, "");
  }

  // Is origin a NetRing signage server we can talk to? GET /api/device/v1/time must answer
  // JSON with a numeric "t" (PROTOCOL §5.3), readable by this app (CORS, §1).
  //   {ok: true, t} | {ok: false, error: "unreachable" | "cert_private" | "not_signage" | "no_cors"}
  async function checkServer(fetchFn, origin, host) {
    var url = origin + "/api/device/v1/time";
    try {
      var r = await request(fetchFn, url, { timeoutMs: 15000 });
      if (r.status === 200 && typeof r.body.t === "number" && isFinite(r.body.t) && r.body.t > 0) {
        return { ok: true, t: r.body.t };
      }
      return { ok: false, error: "not_signage" };
    } catch (e) {
      if (!isNetError(e)) throw e;
    }
    // No readable answer. A no-cors request succeeds when the network and the certificate are
    // fine and only CORS was missing (not a signage server, or one older than draft 3).
    try {
      await request(fetchFn, url, { mode: "no-cors", timeoutMs: 15000, redirect: "follow" });
      return { ok: false, error: "no_cors" };
    } catch (e) {
      if (!isNetError(e)) throw e;
    }
    return { ok: false, error: RC.core.looksPrivate(host) ? "cert_private" : "unreachable" };
  }

  RC.http = {
    NetError: NetError,
    isNetError: isNetError,
    request: request,
    errorCode: errorCode,
    checkServer: checkServer
  };
})(typeof window !== "undefined" ? window : this);
