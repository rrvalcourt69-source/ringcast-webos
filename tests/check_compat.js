// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// webOS 5 runs Chromium 68 and the app has no build step, so the files in app/ must use only
// what that engine understands. This check fails (exit 1) on:
//   - JavaScript syntax newer than ES2018 (optional chaining, ??, class fields, private fields,
//     numeric separators, ...): every .js file and inline <script> must parse as ES2018;
//   - newer built-ins: .at(), replaceAll, Object.fromEntries, flatMap, flat, matchAll,
//     findLast, Promise.allSettled/any, globalThis, structuredClone, queueMicrotask, ...;
//   - newer CSS: inset, aspect-ratio, gap / row-gap / column-gap, clamp()/min()/max(),
//     :is() / :where() / :has() / :focus-visible, @container, @layer.
// Run: node tests/check_compat.js           (checks app/)
//      node tests/check_compat.js --self-test
"use strict";
const fs = require("fs");
const path = require("path");
const acorn = require("acorn");

const APP = path.join(__dirname, "..", "app");

const BANNED_MEMBERS = {
  at: "Array/String .at() (Chromium 92)",
  replaceAll: "String.replaceAll (Chromium 85)",
  fromEntries: "Object.fromEntries (Chromium 73)",
  flatMap: "Array.flatMap (Chromium 69)",
  flat: "Array.flat (Chromium 69)",
  matchAll: "String.matchAll (Chromium 73)",
  findLast: "Array.findLast (Chromium 97)",
  findLastIndex: "Array.findLastIndex (Chromium 97)",
  allSettled: "Promise.allSettled (Chromium 76)",
  hasOwn: "Object.hasOwn (Chromium 93)",
  trimStart: "String.trimStart (Chromium 66, but keep to trim())",
  trimEnd: "String.trimEnd (Chromium 66, but keep to trim())",
};
const BANNED_PROMISE_ANY = true;
const BANNED_GLOBALS = {
  globalThis: "globalThis (Chromium 71)",
  structuredClone: "structuredClone (Chromium 98)",
  queueMicrotask: "queueMicrotask (Chromium 71)",
  BigInt: "BigInt (Chromium 67, avoid)",
  WeakRef: "WeakRef (Chromium 84)",
  AggregateError: "AggregateError (Chromium 85)",
};

const CSS_RULES = [
  [/(^|[;{\s])inset(-block|-inline)?(-start|-end)?\s*:/, "CSS inset (Chromium 87)"],
  [/(^|[;{\s])aspect-ratio\s*:/, "CSS aspect-ratio (Chromium 88)"],
  [/(^|[;{\s])(row-|column-)?gap\s*:/, "CSS gap (flex gap: Chromium 84)"],
  [/(^|[^-\w])(clamp|min|max)\(/, "CSS clamp()/min()/max() (Chromium 79)"],
  [/:(is|where|has)\(/, "CSS :is()/:where()/:has()"],
  [/:focus-visible/, "CSS :focus-visible (Chromium 86)"],
  [/@container|@layer/, "CSS @container/@layer"],
  [/(^|[;{\s])translate\s*:|(^|[;{\s])rotate\s*:|(^|[;{\s])scale\s*:/, "individual transform properties (Chromium 104)"],
];

function own(obj, k) {
  return Object.prototype.hasOwnProperty.call(obj, k);
}

function checkJs(code, file) {
  const problems = [];
  try {
    acorn.parse(code, { ecmaVersion: 2018, sourceType: "script", allowHashBang: false });
  } catch (e) {
    problems.push(`${file}:${e.loc ? e.loc.line : "?"}: not ES2018 (${e.message})`);
    return problems;
  }
  let prev = null, prev2 = null;
  for (const tok of acorn.tokenizer(code, { ecmaVersion: 2018, locations: true })) {
    if (tok.type.label === "name") {
      const name = tok.value;
      const afterDot = prev && prev.type.label === ".";
      if (afterDot && own(BANNED_MEMBERS, name)) {
        problems.push(`${file}:${tok.loc.start.line}: ${BANNED_MEMBERS[name]}`);
      }
      if (afterDot && BANNED_PROMISE_ANY && name === "any" && prev2 && prev2.value === "Promise") {
        problems.push(`${file}:${tok.loc.start.line}: Promise.any (Chromium 85)`);
      }
      if (!afterDot && own(BANNED_GLOBALS, name)) {
        problems.push(`${file}:${tok.loc.start.line}: ${BANNED_GLOBALS[name]}`);
      }
    }
    prev2 = prev;
    prev = tok;
  }
  return problems;
}

function checkCss(code, file) {
  const problems = [];
  const lines = code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).split("\n");
  lines.forEach((line, i) => {
    for (const [re, what] of CSS_RULES) {
      if (re.test(line)) problems.push(`${file}:${i + 1}: ${what}`);
    }
  });
  return problems;
}

function checkHtml(code, file) {
  const problems = [];
  code.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs, body) => {
    if (body.trim()) problems.push(...checkJs(body, file + " <script>"));
    return m;
  });
  code.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (m, body) => {
    problems.push(...checkCss(body, file + " <style>"));
    return m;
  });
  code.replace(/\sstyle="([^"]*)"/gi, (m, body) => {
    problems.push(...checkCss(body, file + " style attribute"));
    return m;
  });
  return problems;
}

function walk(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else out.push(p);
  }
  return out;
}

function checkTree(root) {
  let problems = [];
  let count = 0;
  for (const file of walk(root)) {
    const rel = path.relative(path.join(root, ".."), file);
    const code = /\.(js|css|html)$/.test(file) ? fs.readFileSync(file, "utf8") : null;
    if (code === null) continue;
    count++;
    if (file.endsWith(".js")) problems = problems.concat(checkJs(code, rel));
    else if (file.endsWith(".css")) problems = problems.concat(checkCss(code, rel));
    else problems = problems.concat(checkHtml(code, rel));
  }
  return { problems, count };
}

function selfTest() {
  const bad = {
    "a?.b": "js", "a ?? b": "js", "[1].at(-1)": "js", "'x'.replaceAll('a','b')": "js",
    "Object.fromEntries([])": "js", "[].flatMap(f)": "js", "class A { #x = 1 }": "js",
    "class A { x = 1 }": "js", "globalThis.x": "js", "Promise.any([])": "js", "1_000": "js",
    "a ||= b": "js",
    "div { inset: 0 }": "css", ".a{aspect-ratio:16/9}": "css", ".f { display:flex; gap: 8px }": "css",
    ".a { width: clamp(1px, 2vw, 3px) }": "css", "a:is(.x) {}": "css", "a:focus-visible{}": "css",
  };
  const good = {
    "var x = a && a.b; async function f() { await g(); }": "js",
    "var s = 'a?.b ?? c .at( replaceAll'; // a?.b": "js",
    "var o = Object.assign({}, {a: 1}); var r = [1, 2].map(function (x) { return x; });": "js",
    "var y = {...o}; x.attach = 1; x.flatten = 2; x.toString(); x.constructor;": "js",
    "div { top: 0; right: 0; min-width: 10px; max-height: 5vh; margin: 0 8px; }": "css",
    "/* gap: 1px; inset: 0 */ .a { color: red }": "css",
  };
  let failed = 0;
  for (const [src, kind] of Object.entries(bad)) {
    const p = kind === "js" ? checkJs(src, "bad") : checkCss(src, "bad");
    if (!p.length) { failed++; console.log(`FAIL self-test: not caught: ${src}`); }
  }
  for (const [src, kind] of Object.entries(good)) {
    const p = kind === "js" ? checkJs(src, "good") : checkCss(src, "good");
    if (p.length) { failed++; console.log(`FAIL self-test: false alarm: ${src}\n     ${p.join("\n     ")}`); }
  }
  console.log(failed ? `compat self-test: ${failed} failure(s)` : "ok   compat: self-test");
  return failed;
}

function main(argv) {
  if (argv.indexOf("--self-test") >= 0) return selfTest() ? 1 : 0;
  const root = argv[0] ? path.resolve(argv[0]) : APP;
  const { problems, count } = checkTree(root);
  if (problems.length) {
    console.log("FAIL compat: constructs Chromium 68 (webOS 5) doesn't support:\n  " + problems.join("\n  "));
    return 1;
  }
  console.log(`ok   compat: ${count} files in ${path.relative(process.cwd(), root) || "."} use only Chromium 68 features`);
  return 0;
}

module.exports = { checkJs, checkCss, checkHtml, checkTree, selfTest, main };
if (require.main === module) process.exit(main(process.argv.slice(2)));
