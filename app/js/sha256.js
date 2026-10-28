// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// SHA-256 for request signatures (PROTOCOL §6) and key fingerprints (§3.1).
// Uses the browser's WebCrypto when the page has it, and this small implementation otherwise
// (WebCrypto is only offered to secure contexts, and older webOS builds may not count the app's
// own page as one). Both paths are checked against the same vectors in tests/.
// Plain ES2017 for webOS 5 (Chromium 68): no build step.
(function (root) {
  "use strict";
  var RC = root.RC = root.RC || {};

  var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function rotr(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  // Synchronous SHA-256 of a Uint8Array; returns a 32-byte Uint8Array.
  function sha256Sync(bytes) {
    var len = bytes.length;
    var bitLenHi = Math.floor(len / 0x20000000);   // len * 8 / 2^32
    var bitLenLo = (len * 8) >>> 0;
    var padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[len] = 0x80;
    var pl = padded.length;
    padded[pl - 8] = (bitLenHi >>> 24) & 0xff;
    padded[pl - 7] = (bitLenHi >>> 16) & 0xff;
    padded[pl - 6] = (bitLenHi >>> 8) & 0xff;
    padded[pl - 5] = bitLenHi & 0xff;
    padded[pl - 4] = (bitLenLo >>> 24) & 0xff;
    padded[pl - 3] = (bitLenLo >>> 16) & 0xff;
    padded[pl - 2] = (bitLenLo >>> 8) & 0xff;
    padded[pl - 1] = bitLenLo & 0xff;

    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    var w = new Uint32Array(64);
    for (var off = 0; off < pl; off += 64) {
      var i;
      for (i = 0; i < 16; i++) {
        var j = off + i * 4;
        w[i] = ((padded[j] << 24) | (padded[j + 1] << 16) | (padded[j + 2] << 8) | padded[j + 3]) >>> 0;
      }
      for (i = 16; i < 64; i++) {
        var a15 = w[i - 15], a2 = w[i - 2];
        var s0 = rotr(a15, 7) ^ rotr(a15, 18) ^ (a15 >>> 3);
        var s1 = rotr(a2, 17) ^ rotr(a2, 19) ^ (a2 >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }
    var out = new Uint8Array(32);
    var hs = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (var k = 0; k < 8; k++) {
      out[k * 4] = hs[k] >>> 24;
      out[k * 4 + 1] = (hs[k] >>> 16) & 0xff;
      out[k * 4 + 2] = (hs[k] >>> 8) & 0xff;
      out[k * 4 + 3] = hs[k] & 0xff;
    }
    return out;
  }

  function subtle() {
    var c = root.crypto;
    return c && c.subtle && typeof c.subtle.digest === "function" ? c.subtle : null;
  }

  // Asynchronous SHA-256: WebCrypto when available, else the implementation above.
  async function sha256(bytes) {
    var s = subtle();
    if (s) {
      try {
        return new Uint8Array(await s.digest("SHA-256", bytes));
      } catch (e) {
        // fall through: some engines expose subtle but refuse to use it
      }
    }
    return sha256Sync(bytes);
  }

  RC.sha256 = sha256;
  RC.sha256Sync = sha256Sync;
})(typeof window !== "undefined" ? window : this);
