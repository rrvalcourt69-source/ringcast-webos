// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// Loads the app's browser scripts into a fresh VM context that looks like the display's page
// (window, self, crypto, TextEncoder, atob/btoa), so tests run the exact files that ship.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const nodeCrypto = require("crypto");

const APP = path.join(__dirname, "..", "app");
const CORE = ["js/vendor/nacl-fast.min.js", "js/sha256.js", "js/core.js"];

function load(files, opts) {
  opts = opts || {};
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise,
    TextEncoder, URL, atob, btoa, Uint8Array, Uint32Array, Float64Array, Array, Math, JSON,
    crypto: opts.noSubtle ? { getRandomValues: (b) => nodeCrypto.webcrypto.getRandomValues(b) }
      : nodeCrypto.webcrypto,
  };
  Object.assign(ctx, opts.globals || {});
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of files || CORE) {
    const file = path.join(APP, f);
    vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  }
  return ctx;
}

// Minimal test runner: test(name, fn) collects; run() executes in order and reports.
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}
async function run(label) {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`ok   ${label}: ${t.name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${label}: ${t.name}\n     ${e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n     ") : e}`);
    }
  }
  tests.length = 0;
  return failed;
}

module.exports = { load, test, run, CORE, APP };
