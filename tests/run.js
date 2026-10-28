// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// Runs every Node test (tests/test_*.js) and the Chromium 68 compatibility check.
// Run: node tests/run.js      (exit 1 on any failure)
"use strict";
const fs = require("fs");
const path = require("path");
const compat = require("./check_compat");

(async () => {
  let failed = 0;
  failed += compat.main(["--self-test"]);
  failed += compat.main([]);
  for (const f of fs.readdirSync(__dirname).filter((n) => /^test_.*\.js$/.test(n)).sort()) {
    failed += await require(path.join(__dirname, f))();
  }
  console.log(failed ? `\n${failed} failure(s)` : "\nall tests passed");
  process.exit(failed ? 1 : 0);
})();
