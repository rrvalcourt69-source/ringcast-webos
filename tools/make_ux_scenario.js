// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// Builds the LG Content Store UX scenario (LG Seller Lounge template, file version 4.4: same
// sections, page layout and Description tables) from real screenshots of the app.
//
//   node tools/make_ux_scenario.js <shots-dir> <out.pptx>
//
// <shots-dir> holds tests/store_shots.py's output (address.png ... boxes.json) plus
// splash-1920x1080.png and the dashboard pictures 01-sign-in-dialog.png,
// 07-add-screen-code-dialog.png and 08-add-screen-confirm-dialog.png (RingCast Manager's
// tools/capture_screens.py). Development only, not shipped.
"use strict";
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");

const SHOTS = path.resolve(process.argv[2] || "store-shots");
const OUT = path.resolve(process.argv[3] || "RingCast-Player-UX-Scenario.pptx");
const BOXES = JSON.parse(fs.readFileSync(path.join(SHOTS, "boxes.json"), "utf8"));
const img = (n) => path.join(SHOTS, n);

const APP = "RingCast Player";
const VERSION = "1.0.0";
const DATE = "2026 / 10 / 29";
const TEST_URL = "https://signage.netringtech.com";
const TEST_ID = "LGtest";
const CONTACT = "support@netringtech.com";

// LG's template: 9907588 x 6858000 EMU
const W = 9907588 / 914400, H = 7.5;
const INK = "1A1A1A", MUTED = "595959", HEAD = "404040", RULE = "BFBFBF", BOX = "E7E6E6", MARK = "A50034";
const FONT = "Arial";

const pres = new pptxgen();
pres.defineLayout({ name: "LG_UX", width: W, height: H });
pres.layout = "LG_UX";
pres.author = "NetRing Tech Services";
pres.company = "NetRing Tech Services, LLC";
pres.title = `${APP} UX Scenario`;
pres.theme = { headFontFace: FONT, bodyFontFace: FONT };

let page = 0;
function frame(title, opts) {
  const s = pres.addSlide();
  page += 1;
  s.background = { color: "FFFFFF" };
  s.addText(title, { x: 0.12, y: 0.12, w: 7.4, h: 0.5, fontFace: FONT, fontSize: 18, bold: true, color: INK,
                     margin: 0, valign: "middle", isTextBox: true });
  s.addText(`UX Scenario Document · File Version 4.4\n${APP} ${VERSION}`, {
    x: 7.6, y: 0.12, w: W - 7.75, h: 0.5, fontFace: FONT, fontSize: 9, color: MUTED, align: "right",
    margin: 0, valign: "middle", isTextBox: true });
  s.addShape(pres.shapes.LINE, { x: 0, y: 0.7, w: W, h: 0, line: { color: RULE, width: 1 } });
  if (!(opts && opts.noNumber)) {
    s.addText(String(page), { x: W / 2 - 0.4, y: H - 0.35, w: 0.8, h: 0.25, fontFace: FONT, fontSize: 9,
                              color: MUTED, align: "center", margin: 0, isTextBox: true });
  }
  return s;
}

function subtitle(s, text) {
  s.addText(text, { x: 0.15, y: 0.78, w: 6.85, h: 0.3, fontFace: FONT, fontSize: 12, bold: true, color: INK,
                    margin: 0, valign: "middle", isTextBox: true });
}

// Description table at the right, as in the template: header, then numbered rows
function describe(s, rows, y) {
  const top = y || 0.78;
  const body = [[{ text: "Description", options: { colspan: 2, bold: true, color: "FFFFFF", fill: { color: HEAD },
                                                    fontSize: 11 } }]];
  for (const r of rows) {
    if (r.section) {
      body.push([{ text: r.section, options: { colspan: 2, bold: true, fill: { color: "F2F2F2" }, fontSize: 9,
                                               align: "center" } }]);
    } else {
      body.push([{ text: String(r[0]), options: { align: "center", bold: true, fontSize: 9 } },
                 { text: r[1], options: { fontSize: 8.5 } }]);
    }
  }
  s.addTable(body, { x: 7.1, y: top, w: W - 7.25, colW: [0.55, W - 7.25 - 0.55], fontFace: FONT, color: INK,
                     border: { type: "solid", pt: 0.75, color: "7F7F7F" }, valign: "middle", margin: 0.04,
                     rowH: 0.26 });
}

// the gray "Detailed Information" box under the picture
function details(s, lines, note) {
  const y = 4.98, h = H - 0.45 - y;
  s.addShape(pres.shapes.RECTANGLE, { x: 0.1, y, w: W - 0.2, h, fill: { color: BOX }, line: { color: "A6A6A6", width: 0.75 } });
  const runs = [{ text: "Detailed Information", options: { bold: true, fontSize: 10.5, breakLine: true } }];
  lines.forEach((l, i) => runs.push({ text: l, options: { bullet: { indent: 12 }, fontSize: 9.5,
                                                          breakLine: i < lines.length - 1 || !!note } }));
  if (note) runs.push({ text: note, options: { italic: true, fontSize: 9, color: MUTED } });
  s.addText(runs, { x: 0.2, y: y + 0.06, w: W - 0.4, h: h - 0.12, fontFace: FONT, color: INK, valign: "top",
                    margin: 0.02, paraSpaceAfter: 2, isTextBox: true });
}

// a 1920x1080 screenshot at the template's picture area, with numbered callouts on its elements
const PIC = { x: 0.15, y: 1.12, w: 6.6 };
PIC.h = PIC.w * 1080 / 1920;
const SCALE = PIC.w / 1920;
function screen(s, name, marks, pic) {
  const p = pic || PIC;
  const sc = p.w / 1920;
  s.addImage({ path: img(name + ".png"), x: p.x, y: p.y, w: p.w, h: p.w * 1080 / 1920,
               altText: `${APP}: ${name} screen` });
  s.addShape(pres.shapes.RECTANGLE, { x: p.x, y: p.y, w: p.w, h: p.w * 1080 / 1920, fill: { type: "none" },
                                      line: { color: "7F7F7F", width: 0.75 } });
  (marks || []).forEach((m, i) => {
    let r = m.box;
    if (typeof r === "string") {
      r = BOXES[name] && BOXES[name][r];
      if (!r) throw new Error(`no box ${m.box} on ${name}`);
    }
    const side = m.side || "left";
    const d = 0.27;
    let cx, cy;
    if (side === "left") { cx = p.x + r.x * sc - d * 0.75; cy = p.y + (r.y + r.h / 2) * sc; }
    else if (side === "right") { cx = p.x + (r.x + r.w) * sc + d * 0.75; cy = p.y + (r.y + r.h / 2) * sc; }
    else if (side === "top") { cx = p.x + (r.x + r.w / 2) * sc; cy = p.y + r.y * sc - d * 0.7; }
    else { cx = p.x + (r.x + r.w / 2) * sc; cy = p.y + (r.y + r.h) * sc + d * 0.7; }
    cx = Math.min(Math.max(cx, p.x + d / 2 + 0.02), p.x + p.w - d / 2 - 0.02);
    cy = Math.min(Math.max(cy, p.y + d / 2 + 0.02), p.y + p.w * 1080 / 1920 - d / 2 - 0.02);
    // a box around the element, then the number
    if (!m.nobox) {
      s.addShape(pres.shapes.RECTANGLE, { x: p.x + r.x * sc - 0.02, y: p.y + r.y * sc - 0.02, w: r.w * sc + 0.04,
                                          h: r.h * sc + 0.04, fill: { type: "none" },
                                          line: { color: MARK, width: 1.25, dashType: "dash" } });
    }
    s.addShape(pres.shapes.OVAL, { x: cx - d / 2, y: cy - d / 2, w: d, h: d, fill: { color: MARK },
                                   line: { color: "FFFFFF", width: 1 } });
    s.addText(String(m.n || i + 1), { x: cx - d / 2, y: cy - d / 2, w: d, h: d, fontFace: FONT, fontSize: 10,
                                      bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0,
                                      isTextBox: true });
  });
}

// ── 1. cover ────────────────────────────────────────────────────────────
{
  const s = frame("UX Scenario Document", { noNumber: true });
  s.addImage({ path: img("splash-1920x1080.png"), x: 0.9, y: 1.15, w: 4.6, h: 4.6 * 1080 / 1920, altText: `${APP} splash` });
  s.addText(APP, { x: 0.9, y: 3.95, w: 9, h: 0.6, fontFace: FONT, fontSize: 28, bold: true, color: INK, margin: 0, isTextBox: true });
  s.addText("Digital signage player app for LG webOS TVs (com.netringtech.ringcast)", {
    x: 0.9, y: 4.55, w: 9, h: 0.35, fontFace: FONT, fontSize: 13, color: MUTED, margin: 0, isTextBox: true });
  s.addTable([
    [{ text: "Submission Date", options: { bold: true, fill: { color: "D9D9D9" } } }, { text: DATE }],
    [{ text: "App Ver.", options: { bold: true, fill: { color: "D9D9D9" } } }, { text: VERSION }],
    [{ text: "App Developer", options: { bold: true, fill: { color: "D9D9D9" } } },
     { text: `Name: NetRing Tech Services, LLC\nE-mail address: ${CONTACT}` }],
  ], { x: 5.6, y: 5.25, w: 4.9, colW: [1.6, 3.3], fontFace: FONT, fontSize: 10, color: INK,
       border: { type: "solid", pt: 0.75, color: "A6A6A6" }, valign: "middle", rowH: [0.32, 0.32, 0.55] });
}

// ── 2. contents ─────────────────────────────────────────────────────────
{
  const s = frame("Table of Contents");
  const items = [
    ["1. Basic Information", "3"], ["2. Document History", "4"], ["3. Page Description (Guideline)", "5"],
    ["4. Detailed Login Information", "6"], ["5. Main Page Description", "7-12"],
    ["6. Sub Page Description", "13-19"], ["7. Paid Content", "20"], ["8. In-App Ad", "21"], ["[Appendix] Test procedure and remote keys", "22-23"],
  ];
  s.addTable(items.map(([a, b]) => [{ text: a }, { text: b, options: { align: "center", color: MUTED } }]),
             { x: 2.4, y: 1.3, w: 6, colW: [4.9, 1.1], fontFace: FONT, fontSize: 13, color: INK, rowH: 0.48,
               border: [{ type: "none" }, { type: "none" }, { type: "solid", pt: 0.5, color: RULE }, { type: "none" }] });
  s.addText("Page", { x: 7.3, y: 0.95, w: 1.1, h: 0.3, fontFace: FONT, fontSize: 10, color: MUTED, align: "center", margin: 0, isTextBox: true });
}

// ── 3. basic information ────────────────────────────────────────────────
{
  const s = frame("1. Basic Information");
  const H1 = { bold: true, color: "FFFFFF", fill: { color: HEAD }, align: "center" };
  const cat = (t, n) => ({ text: t, options: { rowspan: n, bold: true, fill: { color: "D9D9D9" }, align: "center" } });
  const it = (t) => ({ text: t, options: { bold: true, fill: { color: "F2F2F2" } } });
  const rows = [
    [{ text: "Category", options: H1 }, { text: "Items", options: H1 }, { text: "Input (By Developer)", options: H1 }],
    [cat("App Information", 11), it("App Title"), { text: `${APP} (App ID com.netringtech.ringcast)` }],
    [it("Category"), { text: "Life (business signage)" }],
    [it("File Type"), { text: "Web (webOS web app, packaged as .ipk)" }],
    [it("Optimized Resolution"), { text: "1920*1080" }],
    [it("Service Area Information"), { text: "U.S.A" }],
    [it("App Service Language"), { text: "English, Spanish (the app follows the TV's language setting)" }],
    [it("Geo-IP Block"), { text: "No" }],
    [it("SDK Version"), { text: "webOS (webOS TV 5.0 and later)" }],
    [it("In-App Ad"), { text: "Not Applicable" }],
    [it("Paid Content"), { text: "Not Applicable" }],
    [it("Sound (For Game Type)"), { text: "Not a game. The app has no sounds of its own; videos from the signage server play muted by default." }],
    [cat("Test Information", 3), it("Service URL (For Web Type)"), { text: "Not applicable: the app is packaged (.ipk). It shows content from the signage server the user enters on the TV." }],
    [it("Test URL"), { text: `${TEST_URL}\nOur test RingCast Manager server for QA (online 24 hours a day during the review). Test account: section 4.` }],
    [it("Service Platform"), { text: "webOS" }],
  ];
  s.addTable(rows, { x: 0.15, y: 0.85, w: W - 0.3, colW: [1.55, 2.35, W - 0.3 - 3.9], fontFace: FONT, fontSize: 9,
                     color: INK, border: { type: "solid", pt: 0.5, color: "7F7F7F" }, valign: "middle", margin: 0.05,
                     rowH: 0.27 });
  s.addText([
    { text: "Notes", options: { bold: true, breakLine: true } },
    { text: "The app needs a RingCast Manager signage server, which a business runs for itself. For QA, use our test server above: no setup on your side.", options: { bullet: true, breakLine: true } },
    { text: "No account, sign-in, payment or advertising inside the app. The only sign-in is to the server's dashboard, in a web browser, to add the TV (section 4).", options: { bullet: true } },
  ], { x: 0.15, y: 5.0, w: W - 0.3, h: 0.75, fontFace: FONT, fontSize: 9.5, color: INK, valign: "top", margin: 0.06,
       fill: { color: BOX }, isTextBox: true });
}

// ── 4. document history ─────────────────────────────────────────────────
{
  const s = frame("2. Document History");
  const H1 = { bold: true, color: "FFFFFF", fill: { color: HEAD }, align: "center" };
  const rows = [
    [{ text: "No.", options: H1 }, { text: "Sent", options: H1 }, { text: "Version", options: H1 },
     { text: "File Name", options: H1 }, { text: "Contents", options: H1 }],
    ["1", "05.10.2026", "1.0.0", "RingCast-Player-UX-Scenario-1.0.0.pdf", "Initial document (text only)"],
    ["2", "29.10.2026", "1.0.0", "RingCast-Player-UX-Scenario-1.0.0-r2.pdf",
     "Rewritten on the UX Scenario template 4.4: basic information, a real image of every screen with numbered UI elements, flow chart, remote keys and the full test procedure (QA issue QA2026100824184)"],
  ].map((r, i) => i === 0 ? r : r.map((c, j) => ({ text: c, options: { align: j === 4 ? "left" : "center" } })));
  for (let i = 0; i < 6; i++) rows.push(["", "", "", "", ""]);
  s.addTable(rows, { x: 0.15, y: 0.9, w: W - 0.3, colW: [0.55, 1.15, 0.9, 3.2, W - 0.3 - 5.8], fontFace: FONT,
                     fontSize: 9.5, color: INK, border: { type: "solid", pt: 0.5, color: "7F7F7F" }, valign: "middle",
                     margin: 0.05, rowH: 0.36 });
  s.addImage({ path: img("splash-1920x1080.png"), x: W - 2.6, y: 5.6, w: 2.4, h: 2.4 * 1080 / 1920, altText: "app splash" });
}

// ── 5. page description guideline: the app at a glance ─────────────────
{
  const s = frame("3. Page Description (Guideline)");
  subtitle(s, "1. How this document describes each page");
  s.addImage({ path: img("splash-1920x1080.png"), x: PIC.x, y: PIC.y, w: PIC.w, h: PIC.h, altText: `${APP} splash` });
  describe(s, [
    [1, "Each page shows a real screenshot of the app (1920x1080)"],
    [2, "Red numbers mark each UI element or button; the table at the right describes it"],
    [3, "Rows marked “Keys” list what the remote keys do on that page"],
    { section: "Pages of the app" },
    ["5-1", "Server address (first start)"], ["5-2", "Wrong address"], ["5-3", "Pairing code"],
    ["5-4", "Add the TV in the dashboard (PC browser)"], ["5-5", "Screen added"], ["5-6", "Main page: playing"],
    ["6", "Sub pages 6-2 to 6-7: change server, connecting, messages, offline, Spanish"],
  ]);
  details(s, [
    "The picture above is the app's splash screen (webOS shows it at launch). Then the app shows one of its pages; there are no menus, lists or settings screens.",
    "Set-up is done once: enter the server address (5-1), the TV shows a pairing code (5-3), an administrator adds the TV in the server's dashboard in a web browser (5-4). From then on the app only plays the server's content full screen (5-6), also after the TV is turned off and on.",
    "Remote: arrows, OK, BACK, BLUE, EXIT, HOME and the Magic Remote pointer. Colour keys other than BLUE and the number keys do nothing in the app. The full key table is in the Appendix.",
  ], "*Note: the test procedure step by step is on the Appendix pages.");
}

// ── 6. login information ────────────────────────────────────────────────
{
  const s = frame("4. Detailed Login Information");
  subtitle(s, "1. Sign-in to the signage server's dashboard (in a web browser, not on the TV)");
  const p = { x: 2.0, y: 1.12, w: 2.6 };
  s.addShape(pres.shapes.RECTANGLE, { x: 0.15, y: 1.12, w: 6.85, h: 3.75, fill: { color: "F5F7FA" }, line: { color: "7F7F7F", width: 0.75 } });
  const ih = 3.6, iw = ih * 646 / 931;
  s.addImage({ path: img("01-sign-in-dialog.png"), x: 0.15 + (6.85 - iw) / 2, y: 1.19, w: iw, h: ih, altText: "dashboard sign-in" });
  const ox = 0.15 + (6.85 - iw) / 2, sc = iw / 646;
  // sign-in dialog element positions (pixels in the 646x931 picture)
  [[1, 98, 283, 450, 50], [2, 98, 389, 450, 50], [3, 98, 464, 450, 55]].forEach(([n, x, y, w, h]) => {
    s.addShape(pres.shapes.RECTANGLE, { x: ox + x * sc, y: 1.19 + y * sc, w: w * sc, h: h * sc, fill: { type: "none" },
                                        line: { color: MARK, width: 1.25, dashType: "dash" } });
    s.addShape(pres.shapes.OVAL, { x: ox - 0.4, y: 1.19 + (y + h / 2) * sc - 0.135, w: 0.27, h: 0.27, fill: { color: MARK }, line: { color: "FFFFFF", width: 1 } });
    s.addText(String(n), { x: ox - 0.4, y: 1.19 + (y + h / 2) * sc - 0.135, w: 0.27, h: 0.27, fontFace: FONT, fontSize: 10, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0, isTextBox: true });
  });
  describe(s, [
    [1, "Input field for the user name (ID)"],
    [2, "Input field for the password"],
    [3, "“Sign In” button"],
    { section: "Test Accounts (ID / PW)" },
    [1, `ID (${TEST_ID}) / PW (as entered in Seller Lounge > Test Info, test account)`],
    { section: "Activation Codes" },
    ["–", "None. The TV shows its own pairing code (page 5-3), entered in the dashboard (page 5-4)"],
  ]);
  details(s, [
    "There is no login on the TV: the app itself has no account, ID or password.",
    `To add the TV, sign in to the test server's dashboard at ${TEST_URL} in any web browser on a PC or phone, with the test account above.`,
    "One test account is enough: it can add any number of TVs, from any number of devices at the same time. The dashboard shows the TVs that were added; to test again from the start, remove the TV there (Appendix, step 8).",
  ], "*Note: the dashboard picture comes from a demo server; the test server's dashboard looks the same, with its own name and logo.");
}

// ── 5. main pages ───────────────────────────────────────────────────────
function mainPage(title, sub, name, marks, rows, lines, note) {
  const s = frame(title);
  subtitle(s, sub);
  screen(s, name, marks);
  describe(s, rows);
  details(s, lines, note);
  return s;
}

mainPage("5. Main Page Description", "1. Start Page: server address (first start)", "address", [
  { box: "h1-0" }, { box: "addr" }, { box: "addr-go", side: "right" }, { box: "p-3" }, { box: "addr-keys" }, { box: "diag", side: "top" },
], [
  [1, "Page title: “Connect to your signage server”"],
  [2, "Server address field, pre-filled with “https://”. Has the focus at start; OK opens the TV's on-screen keyboard"],
  [3, "“Connect” button: checks the address and goes on to the pairing code (5-3)"],
  [4, "Example of an address"],
  [5, "Key hint for this page"],
  [6, "App version, platform and TV model (information only)"],
  { section: "Keys" },
  ["OK", "On ②: keyboard. On ③: connect"],
  ["Arrows", "DOWN/RIGHT: ② → ③. UP/LEFT: ③ → ②"],
  ["BACK", "Leaves the app (this is its first page)"],
], [
  `Type the test server's address: the field must read ${TEST_URL} (type “signage.netringtech.com” after the “https://” already there). Select “Done” on the on-screen keyboard: the keyboard closes and ③ Connect gets the focus. Press OK.`,
  "With the Magic Remote, the control under the pointer gets the focus (cyan ring) and OK clicks it. OK over an empty area does nothing.",
  "While the address is checked the app shows “Connecting…” (6-3). A wrong address is explained under the field (5-2).",
]);

mainPage("5. Main Page Description", "2. Wrong address: the reason is shown under the field", "address-error", [
  { box: "addr" }, { box: "addr-status", side: "left" }, { box: "addr-go", side: "right" },
], [
  [1, "The address as entered (here: http://192.0.2.10)"],
  [2, "Why it can't be used, in plain words"],
  [3, "“Connect”: try again after correcting the address"],
  { section: "Keys" },
  ["OK / Arrows", "Same as 5-1"],
  ["BACK", "Leaves the app"],
], [
  "Messages the app can show here: the address must start with https:// · an IP address or local name can't be used (LG TVs need a server with a public certificate) · the server can't be reached or its certificate isn't trusted · the address isn't a signage server.",
  "The focus stays on the page: correct the address in ① and press Connect again. Nothing is saved until a server answers.",
  `To test it: enter http://example.com or 192.1.0.00, then the right address ${TEST_URL}.`,
]);

mainPage("5. Main Page Description", "3. Pairing code", "pairing", [
  { box: "code" }, { box: "code-enter" }, { box: "code-server" }, { box: "p-1" }, { box: "change-server", side: "top" }, { box: "diag", side: "top" },
], [
  [1, "Pairing code of this TV (a new one each time, for example HXRT-B1B4)"],
  [2, "Where to enter it: RingCast Manager (the server's dashboard), Screens → Add Screen"],
  [3, "The server this TV is connected to"],
  [4, "A new code appears by itself when this one expires"],
  [5, "Button “change the server address” (has the focus): opens 6-2"],
  [6, "App version, platform and TV model"],
  { section: "Keys" },
  ["OK / BLUE", "Change the server address (6-2)"],
  ["BACK", "Leaves the app; the next start comes back here"],
], [
  "The app waits on this page until the TV is added in the dashboard (next page). No key is needed on the TV.",
  "Write down the code shown on the TV, then go to the browser (5-4).",
  "If the server can't be reached while waiting, the app shows the message page (6-4) and retries by itself.",
]);

{
  const s = frame("5. Main Page Description");
  subtitle(s, "4. Add the TV in the dashboard (web browser on a PC or phone)");
  s.addShape(pres.shapes.RECTANGLE, { x: 0.15, y: 1.12, w: 6.85, h: 3.75, fill: { color: "F5F7FA" }, line: { color: "7F7F7F", width: 0.75 } });
  const a = { w: 3.25 }; a.h = a.w * 521 / 792; a.x = 0.25; a.y = 1.25;
  const b = { h: 3.55 }; b.w = b.h * 792 / 1173; b.x = 7.0 - 0.12 - b.w; b.y = 1.2;
  s.addImage({ path: img("07-add-screen-code-dialog.png"), x: a.x, y: a.y, w: a.w, h: a.h, altText: "Add Screen: enter code" });
  s.addImage({ path: img("08-add-screen-confirm-dialog.png"), x: b.x, y: b.y, w: b.w, h: b.h, altText: "Add Screen: confirm" });
  const mk = (n, x, y, w, h) => {
    s.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { type: "none" }, line: { color: MARK, width: 1.25, dashType: "dash" } });
    s.addShape(pres.shapes.OVAL, { x: x - 0.33, y: y + h / 2 - 0.135, w: 0.27, h: 0.27, fill: { color: MARK }, line: { color: "FFFFFF", width: 1 } });
    s.addText(String(n), { x: x - 0.33, y: y + h / 2 - 0.135, w: 0.27, h: 0.27, fontFace: FONT, fontSize: 10, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0, isTextBox: true });
  };
  const sa = a.w / 792, sb = b.w / 792;
  mk(1, a.x + 57 * sa, a.y + 320 * sa, 678 * sa, 69 * sa);      // pairing code field
  mk(2, a.x + 610 * sa, a.y + 412 * sa, 125 * sa, 52 * sa);     // Look Up
  mk(3, b.x + 57 * sb, b.y + 206 * sb, 678 * sb, 119 * sb);     // network notice
  mk(4, b.x + 57 * sb, b.y + 356 * sb, 678 * sb, 363 * sb);     // the TV's details
  mk(5, b.x + 57 * sb, b.y + 776 * sb, 678 * sb, 52 * sb);      // screen name
  mk(6, b.x + 528 * sb, b.y + 1063 * sb, 207 * sb, 53 * sb);    // Confirm and Add
  s.addText("Step 1", { x: a.x, y: a.y + a.h + 0.08, w: a.w, h: 0.25, fontFace: FONT, fontSize: 9, color: MUTED, align: "center", margin: 0, isTextBox: true });
  s.addText("Step 2", { x: b.x - 1.2, y: b.y + b.h - 0.3, w: 1.1, h: 0.25, fontFace: FONT, fontSize: 9, color: MUTED, align: "right", margin: 0, isTextBox: true });
  describe(s, [
    [1, "After signing in (section 4): Screens → “+ Add Screen”. Type the code shown on the TV (5-3)"],
    [2, "“Look Up”: finds the TV"],
    [3, "Notice when the browser is on another network than the TV (expected during QA): confirm anyway"],
    [4, "The TV's details: platform LG webOS TV, its model and address"],
    [5, "Give the screen a name (for example “LG QA 1”)"],
    [6, "“Confirm and Add”: the TV switches to “Screen added” (5-5) within a few seconds"],
  ]);
  details(s, [
    `This step is done in the signage server's dashboard at ${TEST_URL}, not on the TV.`,
    "The pictures come from a demo server; the example in step 2 is a Raspberry Pi screen. For the LG TV under test, step 2 shows “LG webOS TV” and the TV's model.",
    "The test server gives a new screen sample content, so the TV starts playing as soon as it has been added.",
  ]);
}

mainPage("5. Main Page Description", "5. Screen added", "claimed", [
  { box: "h1-0" }, { box: "claimed-name" }, { box: "claimed-by" }, { box: "claimed-server" }, { box: "p-1" }, { box: "claimed-wait", side: "bottom" },
], [
  [1, "“Screen added”: the TV was added in the dashboard"],
  [2, "The name given in the dashboard"],
  [3, "The account that added it"],
  [4, "The server"],
  [5, "If this TV was added by mistake: turn it off now, it forgets the pairing and shows a new code"],
  [6, "Countdown (60 s), then the main page plays (5-6)"],
  { section: "Keys" },
  ["–", "No key needed. BACK leaves the app"],
], [
  "Shown for 60 seconds after the TV was added, so the person at the TV can check that it is the right screen.",
  "After the countdown the app plays the server's content (next page). From then on, every start of the app goes straight to that page.",
]);

mainPage("5. Main Page Description", "6. Main Page: playing (full screen)", "playing", [
  { box: { x: 70, y: 70, w: 1780, h: 940 } },
], [
  [1, "Content from the signage server, full screen (here: sample content). It changes as the server's schedule says"],
  { section: "Keys" },
  ["BACK", "Leaves the app (webOS shows the previous app or Home). Starting the app again plays at once"],
  ["EXIT / HOME", "Handled by webOS"],
  ["Pointer, OK, arrows", "Nothing: the content is not interactive and there are no controls on this page"],
], [
  "This is the app's main page once set up. There are no menus or buttons on it: the TV is a signage screen.",
  "What plays is chosen in the dashboard (Screens → the TV → Assign Content); a change reaches the TV within about 30 seconds.",
  "Power off/on or unplugging the TV keeps the set-up: the next start of the app plays at once. If the network drops, the content keeps playing (6-5).",
]);

// ── 6. sub pages ────────────────────────────────────────────────────────
{
  const s = frame("6. Sub Page Description");
  subtitle(s, "1. Flow Chart");
  const box = (x, y, w, h, t, sub, fill) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.06, fill: { color: fill || "FFFFFF" }, line: { color: HEAD, width: 1 } });
    s.addText([{ text: t, options: { bold: true, fontSize: 9, breakLine: !!sub } }].concat(sub ? [{ text: sub, options: { fontSize: 7.5, color: MUTED } }] : []),
              { x, y, w, h, fontFace: FONT, color: INK, align: "center", valign: "middle", margin: 0.02, isTextBox: true });
  };
  // arrows: label beside a vertical arrow, above a horizontal one
  const arrow = (x1, y1, x2, y2, label, dash, labelLeft) => {
    s.addShape(pres.shapes.LINE, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
                                   flipH: x2 < x1, flipV: y2 < y1,
                                   line: { color: HEAD, width: 1.25, endArrowType: "triangle", dashType: dash ? "dash" : "solid" } });
    if (!label) return;
    if (x1 === x2) {
      s.addText(label, { x: labelLeft ? x1 - 1.25 : x1 + 0.06, y: (y1 + y2) / 2 - 0.11, w: 1.19, h: 0.22, fontFace: FONT, fontSize: 7.5,
                         color: MARK, align: labelLeft ? "right" : "left", margin: 0, isTextBox: true });
    } else {
      s.addText(label, { x: Math.min(x1, x2), y: y1 - 0.24, w: Math.abs(x2 - x1), h: 0.2, fontFace: FONT, fontSize: 7.5,
                         color: MARK, align: "center", margin: 0, isTextBox: true });
    }
  };
  s.addShape(pres.shapes.RECTANGLE, { x: 0.15, y: 1.12, w: W - 0.3, h: 3.75, fill: { color: "FAFAFA" }, line: { color: "7F7F7F", width: 0.75 } });
  const bw = 1.5, bh = 0.62, gap = 0.55, x0 = 0.4;
  const col = (i) => x0 + i * (bw + gap);
  const r1 = 1.55, r2 = 2.85, r3 = 4.05;
  const mid = (i) => col(i) + bw / 2;
  box(col(0), r1, bw, bh, "Launch", "splash");
  box(col(1), r1, bw, bh, "Server address", "5-1 / 5-2");
  box(col(2), r1, bw, bh, "Connecting…", "6-3");
  box(col(3), r1, bw, bh, "Pairing code", "5-3");
  box(col(4), r1, bw, bh, "Add the TV in the dashboard", "5-4 · PC browser", "FDECEF");
  box(col(0), r2, bw, bh, "Leave the app", "BACK / EXIT / HOME", "F2F2F2");
  box(col(2), r2, bw, bh, "Can't reach the server", "6-4 · retries by itself");
  box(col(3), r2, bw, bh, "Change server address", "6-2");
  box(col(4), r2, bw, bh, "Screen added", "5-5 · 60 s");
  box(col(2), r3, bw, bh, "Player error box", "6-6 · retries by itself");
  box(col(3), r3, bw, bh, "Offline marker", "6-5 · keeps playing");
  box(col(4), r3, bw, bh, "Playing (main page)", "5-6", "E2F0D9");
  arrow(col(0) + bw, r1 + bh / 2, col(1), r1 + bh / 2, "first start");
  arrow(col(1) + bw, r1 + bh / 2, col(2), r1 + bh / 2, "Connect");
  arrow(col(2) + bw, r1 + bh / 2, col(3), r1 + bh / 2, "accepted");
  arrow(col(3) + bw, r1 + bh / 2, col(4), r1 + bh / 2, "code");
  arrow(mid(4), r1 + bh, mid(4), r2, "TV added");
  arrow(mid(4), r2 + bh, mid(4), r3, "after 60 s");
  arrow(col(4), r3 + bh / 2, col(3) + bw, r3 + bh / 2, "network lost", true);
  arrow(col(3), r3 + bh / 2, col(2) + bw, r3 + bh / 2, "refused", true);
  arrow(mid(3) - 0.25, r1 + bh, mid(3) - 0.25, r2, "OK / BLUE", false, true);
  arrow(mid(3) + 0.25, r2, mid(3) + 0.25, r1 + bh, "BACK", true);
  arrow(mid(2), r1 + bh, mid(2), r2, "server down", true, true);
  arrow(mid(0), r1 + bh, mid(0), r2, "BACK", true);
  s.addText("Later starts (already set up): Launch → Playing at once", { x: 0.4, y: 1.2, w: 6, h: 0.24, fontFace: FONT, fontSize: 8.5,
                                                                        bold: true, color: "38761D", margin: 0, isTextBox: true });
  details(s, [
    "First start: Launch → Server address → Connecting → Pairing code. The TV is then added in the dashboard (browser), the TV shows “Screen added” for 60 s and starts playing.",
    "Later starts: straight to Playing (or to the pairing code if the TV hasn't been added yet).",
    "From the pairing code, OK or BLUE opens “Change server address” and BACK returns. When the server can't be reached the app shows a message and retries by itself; while playing it keeps playing with an “Offline” marker.",
  ], "*Note: the dashed arrows are automatic or optional paths.");
}

function subPage(sub, name, marks, rows, lines, note) {
  return mainPage("6. Sub Page Description", sub, name, marks, rows, lines, note);
}

subPage("2. Change the server address (from the pairing code page)", "address-change", [
  { box: "addr" }, { box: "addr-go", side: "right" }, { box: "addr-keys" },
], [
  [1, "The current server address, pre-filled"],
  [2, "“Connect”: use the new address (a new pairing code is shown)"],
  [3, "Key hint: BACK keeps the current server"],
  { section: "Keys" },
  ["OK / Arrows", "As on 5-1"],
  ["BACK", "Back to the pairing code page (5-3); the server is kept"],
], [
  "Opened from the pairing code page (5-3) or the message page (6-4) with OK or BLUE, or by pointing at the button and pressing OK.",
  "BACK returns to the page it came from without changing anything. Connect with a new address replaces the server and shows a new pairing code.",
]);

subPage("3. Connecting", "connecting", [
  { box: "connecting-text" }, { box: "change-server", side: "top" },
], [
  [1, "“Connecting to <server>…”: the address is being checked"],
  [2, "Button “change the server address” (OK or BLUE): opens 6-2"],
  { section: "Keys" },
  ["OK / BLUE", "Change the server address"],
  ["BACK", "Leaves the app"],
], [
  "Shown for a moment after Connect (5-1), and at start while the saved server is contacted.",
  "If the server doesn't answer within about 30 seconds the app explains why (5-2 or 6-4). The app never stays on this page.",
]);

subPage("4. Message: the server can't be reached", "message", [
  { box: "msg-title" }, { box: "msg-detail" }, { box: "msg-server" }, { box: "msg-retry" }, { box: "change-server", side: "top" },
], [
  [1, "What happened (here: “Can't reach the server”)"],
  [2, "What to check"],
  [3, "The server"],
  [4, "Retry countdown: the app retries by itself (5 s at first, up to 5 minutes)"],
  [5, "Button “change the server address” (OK or BLUE): opens 6-2"],
  { section: "Keys" },
  ["OK / BLUE", "Change the server address"],
  ["BACK", "Leaves the app"],
], [
  "Shown during set-up when the server can't be reached or refuses (other titles: server error, server busy, server needs updating, refused).",
  "To see it: unplug the network cable (or turn off Wi-Fi) before the TV has been added, then start the app. Reconnect the network: the app continues by itself.",
]);

subPage("5. Network lost while playing: “Offline” marker", "playing-offline", [
  { box: "marker", side: "left" },
], [
  [1, "“Offline” marker (bottom right, inside the safe area) while the server can't be reached"],
  { section: "Keys" },
  ["BACK", "Leaves the app (as on 5-6)"],
], [
  "The content keeps playing from the copy the app keeps; the marker shows that the server can't be reached right now.",
  "To test it: while playing, unplug the network cable or turn off Wi-Fi. Reconnect: the marker goes away within about 30 seconds, without any key.",
]);

subPage("6. Player error box", "player-error", [
  { box: "h1-0" }, { box: "frame-reason" }, { box: "frame-retry" }, { box: "frame-footer", side: "bottom" },
], [
  [1, "“The player page didn't load”"],
  [2, "The reason (here: the server refused the player session)"],
  [3, "Retry countdown: the app retries by itself"],
  [4, "Server, app version and platform (to report a problem)"],
  { section: "Keys" },
  ["BACK", "Leaves the app"],
], [
  "Shown over the main page when the server can't give the TV its content right now (for example the server refused or couldn't start the player). It goes away by itself as soon as the server answers.",
  "If the TV was removed in the dashboard, the app returns to a new pairing code (5-3).",
]);

subPage("7. Spanish (the app follows the TV's language)", "address-es", [
  { box: "h1-0" }, { box: "addr" }, { box: "addr-go", side: "right" },
], [
  [1, "Page title in Spanish: “Conectar con su servidor de señalización”"],
  [2, "Server address field (“Dirección del servidor”)"],
  [3, "“Conectar” (Connect)"],
  { section: "Keys" },
  ["All", "As in English (5-1)"],
], [
  "When the TV's language is Spanish (Settings → General → Language), every page of the app is in Spanish. Any other language shows English.",
  "The pages and keys are the same in both languages; only the text changes.",
]);

// ── 7. paid content, 8. ads ─────────────────────────────────────────────
for (const [title, line] of [["7. Paid Content", "Not Applicable: the app has no paid content, purchases, subscriptions or payment of any kind, inside or outside the app."],
                             ["8. In-App Ad", "Not Applicable: the app shows no advertising (no banner or video ads). It only shows the content the TV's own organisation puts on its signage server."]]) {
  const s = frame(title);
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 1.4, y: 2.2, w: W - 2.8, h: 1.8, rectRadius: 0.1, fill: { color: "F2F2F2" }, line: { color: "A6A6A6", width: 1 } });
  s.addText([{ text: "Not Applicable", options: { bold: true, fontSize: 22, breakLine: true } }, { text: (function (t) { return t.charAt(0).toUpperCase() + t.slice(1); })(line.replace(/^Not Applicable: /, "")), options: { fontSize: 12, color: MUTED } }],
            { x: 1.6, y: 2.3, w: W - 3.2, h: 1.6, fontFace: FONT, color: INK, align: "center", valign: "middle", margin: 0.05, isTextBox: true });
  s.addImage({ path: img("splash-1920x1080.png"), x: W / 2 - 1.2, y: 4.45, w: 2.4, h: 2.4 * 1080 / 1920, altText: "app splash" });
}

// ── appendix ────────────────────────────────────────────────────────────
{
  const s = frame("[Appendix] Test procedure");
  const steps = [
    ["On the TV", "1", "Start RingCast Player. After the splash, “Connect to your signage server” appears with the address field focused (5-1)."],
    ["", "2", `OK opens the keyboard. Make the field read ${TEST_URL}, select “Done”, then OK on Connect.`],
    ["", "3", "The TV shows a pairing code, for example HXRT-2B99 (5-3)."],
    ["In a browser (PC or phone)", "4", `Open ${TEST_URL} and sign in with the test account (section 4).`],
    ["", "5", "Screens → “+ Add Screen”, type the code from the TV, Look Up, give the screen a name, “Confirm and Add” (5-4)."],
    ["On the TV", "6", "“Screen added” appears (5-5); after the 60 s countdown the sample content plays full screen (5-6)."],
    ["Things to try", "7", "BACK while playing leaves the app; starting it again plays at once. Pairing code page: OK or BLUE → change server, BACK returns (6-2). Power off/on: still set up. Network unplugged while playing: content keeps playing with “Offline” (6-5). Wrong address: refused with the reason (5-2)."],
    ["Start over", "8", "Dashboard: Screens → the TV's “Commands” menu → “Remove screen”, type the word asked for. The TV shows a new pairing code by itself."],
  ];
  const H1 = { bold: true, color: "FFFFFF", fill: { color: HEAD }, align: "center" };
  const span = { "On the TV": [3, 1], "In a browser (PC or phone)": [2], "Things to try": [1], "Start over": [1] };
  const seen = {};
  const rows = [[{ text: "Where", options: H1 }, { text: "Step", options: H1 }, { text: "What to do", options: H1 }]];
  steps.forEach(([a, b, c], i) => {
    const row = [];
    if (a) {
      const n = (span[a] || [1])[seen[a] = (seen[a] === undefined ? 0 : seen[a] + 1)] || 1;
      row.push({ text: a, options: { bold: true, fill: { color: "F2F2F2" }, rowspan: n } });
    }
    row.push({ text: b, options: { align: "center", bold: true } }, { text: c });
    rows.push(row);
  });
  s.addTable(rows, { x: 0.15, y: 0.9, w: W - 0.3, colW: [1.7, 0.55, W - 0.3 - 2.25], fontFace: FONT, fontSize: 9.5, color: INK,
                     border: { type: "solid", pt: 0.5, color: "7F7F7F" }, valign: "middle", margin: 0.06 });
  s.addText([
    { text: "The test server stays online 24 hours a day during the review. Questions: ", options: {} },
    { text: CONTACT, options: { bold: true } },
  ], { x: 0.15, y: 5.15, w: W - 0.3, h: 0.45, fontFace: FONT, fontSize: 10, color: INK, fill: { color: BOX }, margin: 0.08, valign: "middle", isTextBox: true });
}

{
  const s = frame("[Appendix] Remote keys on every page");
  const H1 = { bold: true, color: "FFFFFF", fill: { color: HEAD }, align: "center" };
  const k = (t) => ({ text: t, options: { bold: true, fill: { color: "F2F2F2" } } });
  const rows = [
    [{ text: "Key", options: H1 }, { text: "Server address (5-1, 5-2, 6-2)", options: H1 }, { text: "Connecting, pairing code, message (6-3, 5-3, 6-4)", options: H1 },
     { text: "Screen added (5-5)", options: H1 }, { text: "Playing (5-6, 6-5, 6-6)", options: H1 }],
    [k("Magic Remote pointer"), "The control under the pointer gets the focus; OK clicks it", "Same", "–", "Nothing (no controls)"],
    [k("Arrows"), "Move between the field and Connect", "–", "–", "Nothing"],
    [k("OK"), "Field: on-screen keyboard. Connect: connect", "Change the server address (6-2)", "–", "Nothing"],
    [k("BACK"), "First start: leave the app. Opened from 5-3/6-4: back there, server kept", "Leave the app", "Leave the app", "Leave the app"],
    [k("BLUE"), "–", "Change the server address (6-2)", "–", "–"],
    [k("RED, GREEN, YELLOW, numbers, INFO"), "Nothing", "Nothing", "Nothing", "Nothing"],
    [k("EXIT / HOME"), "Handled by webOS", "Handled by webOS", "Handled by webOS", "Handled by webOS"],
    [k("Volume, mute, channel"), "Handled by the TV", "Handled by the TV", "Handled by the TV", "Handled by the TV"],
    [k("On-screen keyboard"), "“Done” closes it and focuses Connect; BACK only closes the keyboard", "–", "–", "–"],
  ];
  s.addTable(rows, { x: 0.15, y: 0.9, w: W - 0.3, colW: [1.8, 2.45, 2.3, 1.45, W - 0.3 - 8.0], fontFace: FONT, fontSize: 9, color: INK,
                     border: { type: "solid", pt: 0.5, color: "7F7F7F" }, valign: "middle", margin: 0.05 });
  s.addText([
    { text: "Leaving the app keeps its set-up. ", options: { bold: true } },
    { text: "On a TV used as a signage screen, the organisation's server can bring the app back to the front through LG Connect Apps when it is set up to (“TV control” in the dashboard); on the test TV nothing does that, so the app stays in the background until it is opened again. The app itself never starts on its own.", options: {} },
  ], { x: 0.15, y: 4.55, w: W - 0.3, h: 0.85, fontFace: FONT, fontSize: 9.5, color: INK, fill: { color: BOX }, margin: 0.08, valign: "middle", isTextBox: true });
}

pres.writeFile({ fileName: OUT }).then(() => console.log("wrote", OUT, page, "slides"));
