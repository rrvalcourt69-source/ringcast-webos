// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 NetRing Tech Services, LLC
//
// SHA-256, the device public key text, the key fingerprint and the PROTOCOL §6 test vector.
"use strict";
const assert = require("assert");
const nodeCrypto = require("crypto");
const { load, test, run } = require("./harness");

// PROTOCOL §6 test vector (also tests/test_pairing.py::test_signature_vector in the server).
const VECTOR_SIG = "IE37jjegcrxHoAoErhB2aN9J+yTz9IX9M9AkjG7nNGWhtX77KVARHHky28m7Kny3FSPfAp8ia0EuYAisnGrUDg==";
// Seed 32 × 0x01, computed independently with Python's cryptography package (as the server and
// the Raspberry Pi client format them).
const SEED1_PUB = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIqI4910CfGV/VLbLTy6XXLKZwm/HZQSG/N0iAG0D29c ringcast-device";
const SEED1_FP = "34750f98bd59fcfc946da45aaabe933be154a4b5094e1c4abf42866505f3c97e";

const VECTORS = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  ["abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"],
  ["abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
    "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1"],
  ["a".repeat(1000000), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"],
];

for (const variant of ["WebCrypto", "fallback"]) {
  const RC = load(undefined, { noSubtle: variant === "fallback" }).RC;

  test(`${variant}: SHA-256 known vectors`, async () => {
    for (const [msg, want] of VECTORS) {
      assert.strictEqual(RC.core.hex(await RC.sha256(RC.core.utf8(msg))), want, `sha256(${msg.slice(0, 20)}…)`);
    }
  });

  test(`${variant}: §6 test vector signature from seed 32 × 0x01`, async () => {
    const key = RC.core.keyFromSeed(new Uint8Array(32).fill(1));
    const msg = await RC.core.signedMessage("POST", "/api/device/v1/pair/status", "abc", "1790000000000",
      "AAAAAAAAAAAAAAAAAAAAAA", '{"pairing_id": "abc"}');
    assert.deepStrictEqual(msg.split("\n").slice(0, 6), ["RINGCAST-SIG-V1", "POST", "/api/device/v1/pair/status",
      "abc", "1790000000000", "AAAAAAAAAAAAAAAAAAAAAA"]);
    assert.strictEqual(msg.split("\n")[6], "a458ca762d343c59045a2df20d9ddee7ac7483ddd60d7479e33ab3b2e5e43187");
    assert.ok(!msg.endsWith("\n"), "no trailing newline");
    const sig = await RC.core.sign(key, "POST", "/api/device/v1/pair/status", "abc", "1790000000000",
      "AAAAAAAAAAAAAAAAAAAAAA", '{"pairing_id": "abc"}');
    assert.strictEqual(sig, VECTOR_SIG);
  });
}

const RC = load().RC;

test("SHA-256 fallback matches Node for 0..300-byte inputs", () => {
  for (let n = 0; n <= 300; n++) {
    const b = nodeCrypto.randomBytes(n);
    assert.strictEqual(RC.core.hex(RC.sha256Sync(new Uint8Array(b))),
      nodeCrypto.createHash("sha256").update(b).digest("hex"), `length ${n}`);
  }
});

test("public key text format matches the server and Pi client", () => {
  const key = RC.core.keyFromSeed(new Uint8Array(32).fill(1));
  assert.strictEqual(RC.core.sshPublicKey(key.publicKey), SEED1_PUB);
});

test("key fingerprint is lower-case hex SHA-256 of the raw public key", async () => {
  const key = RC.core.keyFromSeed(new Uint8Array(32).fill(1));
  assert.strictEqual(await RC.core.fingerprint(key.publicKey), SEED1_FP);
});

test("TweetNaCl signatures match Node's own Ed25519 for random seeds", async () => {
  for (let i = 0; i < 20; i++) {
    const seed = nodeCrypto.randomBytes(32);
    const key = RC.core.keyFromSeed(new Uint8Array(seed));
    const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
    const nodeKey = nodeCrypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    const body = JSON.stringify({ pairing_id: "p" + i, n: "ñ€😀" });
    const msg = await RC.core.signedMessage("post", "/api/device/v1/token/renew", "dev" + i, "1790000000000",
      "nonce_nonce_nonce_" + i, body);
    const want = nodeCrypto.sign(null, Buffer.from(msg, "utf8"), nodeKey).toString("base64");
    const got = await RC.core.sign(key, "post", "/api/device/v1/token/renew", "dev" + i, "1790000000000",
      "nonce_nonce_nonce_" + i, body);
    assert.strictEqual(got, want);
    const raw = nodeCrypto.createPublicKey(nodeKey).export({ format: "der", type: "spki" }).subarray(12);
    assert.strictEqual(RC.core.hex(key.publicKey), raw.toString("hex"));
  }
});

test("signature headers are well-formed and verify", async () => {
  const key = RC.core.keyFromSeed(RC.core.newSeed());
  const body = '{"pairing_id":"xyz"}';
  const h = await RC.core.signatureHeaders(key, "POST", "/api/device/v1/pair/status", "xyz", body, 1790000000123.7);
  assert.strictEqual(h["X-RingCast-Timestamp"], "1790000000123");
  assert.ok(/^\d{13}$/.test(h["X-RingCast-Timestamp"]));
  assert.ok(RC.core.NONCE_RE.test(h["X-RingCast-Nonce"]), h["X-RingCast-Nonce"]);
  assert.strictEqual(h["X-RingCast-Key-Id"], "xyz");
  const msg = await RC.core.signedMessage("POST", "/api/device/v1/pair/status", "xyz", h["X-RingCast-Timestamp"],
    h["X-RingCast-Nonce"], body);
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(key.publicKey)]);
  const pub = nodeCrypto.createPublicKey({ key: spki, format: "der", type: "spki" });
  assert.ok(nodeCrypto.verify(null, Buffer.from(msg), pub, Buffer.from(h["X-RingCast-Signature"], "base64")));
});

test("nonces are unique and 22 characters", () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const n = RC.core.newNonce();
    assert.strictEqual(n.length, 22);
    assert.ok(!seen.has(n));
    seen.add(n);
  }
});

test("base64 round trip and rejection of junk", () => {
  const b = new Uint8Array(nodeCrypto.randomBytes(100000));
  assert.deepStrictEqual(RC.core.fromBase64(RC.core.toBase64(b)), b);
  assert.throws(() => RC.core.fromBase64("not base64!"));
  assert.throws(() => RC.core.fromBase64("abc"));
});

module.exports = () => run("crypto");
if (require.main === module) module.exports().then((f) => process.exit(f ? 1 : 0));
