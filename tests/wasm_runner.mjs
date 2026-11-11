#!/usr/bin/env node
// Exercise the REAL compiled .wasm (not the Rust function) through WebAssembly.
// This is the artifact-level check: instantiate with an EMPTY import object so
// any import would throw, then drive imw_alloc / imw_free /
// imw_score_deterministic exactly the way the node does, and compare against an
// independent restatement of the published rule.
//
// Usage: node tests/wasm_runner.mjs target/wasm32-unknown-unknown/release/telegraph_comparator.wasm

import fs from "node:fs";

const path = process.argv[2] || "target/wasm32-unknown-unknown/release/telegraph_comparator.wasm";
const bytes = fs.readFileSync(path);

let pass = 0;
const failures = [];

// Independent restatement of the rule (written from the docs).
function expected(truth, miner, code, tol) {
  const big = (x) => BigInt(x);
  if (code !== 1 && code !== 2) return miner === truth ? 10000 : 0;
  if (tol <= 0n) return miner === truth ? 10000 : 0;
  const d = (big(miner) - big(truth)) < 0n ? big(truth) - big(miner) : big(miner) - big(truth);
  let err;
  if (code === 1) err = d;
  else {
    const at = big(truth) < 0n ? -big(truth) : big(truth);
    const denom = at > 1n ? at : 1n;
    err = (d * 10000n) / denom;
  }
  const win = 2n * tol;
  if (err >= win) return 0;
  return Number((10000n * (win - err)) / win);
}

function check(call, truth, miner, code, tol, note) {
  const want = expected(truth, miner, Number(code), BigInt(tol));
  const got = call(truth, miner, code, tol);
  const label = `${note || ""} truth=${truth} miner=${miner} code=${code} tol=${tol}`;
  if (got === want) pass++;
  else failures.push(`${label}: got ${got}, want ${want}`);
  if (got < 0 || got > 10000) failures.push(`${label}: score out of range (${got})`);
}

const mod = new WebAssembly.Module(bytes);
const imports = WebAssembly.Module.imports(mod);
const exports = WebAssembly.Module.exports(mod);

console.log("imports:", imports.length, JSON.stringify(imports));
console.log("exports:", JSON.stringify(exports.map((e) => `${e.name}:${e.kind}`)));

if (imports.length !== 0) {
  console.error("FAIL: module has imports; it must be import-free");
  process.exit(1);
}
for (const need of ["imw_score_deterministic", "imw_alloc", "imw_free"]) {
  if (!exports.some((e) => e.name === need && e.kind === "function")) {
    console.error(`FAIL: missing export ${need}`);
    process.exit(1);
  }
}

// Instantiate with NO imports supplied. If the module needed one, this throws.
const inst = new WebAssembly.Instance(mod, {});
const { imw_alloc, imw_free, imw_score_deterministic, memory } = inst.exports;

// Mirrors how the node uses the module: allocate, write [code, tol] as two LE i64.
function callWithSpec(truth, miner, code, tol) {
  const ptr = imw_alloc(16);
  if (ptr === 0) throw new Error("imw_alloc returned 0");
  const view = new DataView(memory.buffer);
  view.setBigInt64(ptr, BigInt(code), true);
  view.setBigInt64(ptr + 8, BigInt(tol), true);
  // i64 parameters cross the JS/WASM boundary as BigInt.
  const score = imw_score_deterministic(BigInt(truth), BigInt(miner), ptr);
  imw_free(ptr, 16);
  return Number(score);
}

// --- Exact / PassFail / unknown
for (const code of [0, 3, 4, 99, -1, 2147483647]) {
  check(callWithSpec, 100, 100, code, 0, "exact");
  check(callWithSpec, 100, 101, code, 1000, "exact-miss");
}

// --- AbsTol
check(callWithSpec, 1000, 1001, 1, 10, "off-by-1");
check(callWithSpec, 1000, 999, 1, 10, "off-by-1-neg");
check(callWithSpec, 0, 5, 1, 5, "half-score");
check(callWithSpec, 0, 9, 1, 5, "near-edge");
check(callWithSpec, 0, 10, 1, 5, "edge=window");
check(callWithSpec, 0, 11, 1, 5, "past-edge");
check(callWithSpec, -1000, -1005, 1, 10, "negative-truth");

// --- tolerance 0 / negative
for (const tol of [0, -1, -100]) {
  check(callWithSpec, 50, 50, 1, tol, "tol-exact");
  check(callWithSpec, 50, 51, 1, tol, "tol-miss");
  check(callWithSpec, 50, 50, 2, tol, "tol-exact-rel");
  check(callWithSpec, 50, 51, 2, tol, "tol-miss-rel");
}

// --- RelTol at 1e18 scale
const T = 1000000000000000000n;
check(callWithSpec, T, T + 1000n, 2, 10, "rel-miniscule");
check(callWithSpec, T, T + T / 100n, 2, 200, "rel-1pct");
check(callWithSpec, T, T - T / 100n, 2, 200, "rel-1pct-neg");
check(callWithSpec, T, T + T / 25n, 2, 200, "rel-4pct=edge");

// --- determinism at the artifact level: same inputs twice, identical bits
const detInputs = [
  [1000, 1001, 1, 10],
  [T, T + T / 100n, 2, 200],
  [100, 100, 0, 0],
];
const first = detInputs.map(([t, m, c, tol]) => callWithSpec(t, m, c, tol));
for (let i = 0; i < 5; i++) {
  detInputs.forEach(([t, m, c, tol], idx) => {
    const again = callWithSpec(t, m, c, tol);
    if (again !== first[idx]) failures.push(`non-deterministic: case ${idx} ${first[idx]} -> ${again}`);
  });
}

// --- allocator sanity: two live blocks do not overlap, and free/reuse works
const a = imw_alloc(16);
const b = imw_alloc(16);
if (a === 0 || b === 0) failures.push("alloc returned 0 for a small block");
if (a === b) failures.push("allocator handed out the same pointer twice");
imw_free(b, 16);
imw_free(a, 16);
const c2 = imw_alloc(16);
if (c2 === 0) failures.push("alloc after free returned 0");

console.log(`\nchecks passed: ${pass}`);
if (failures.length) {
  console.error(`FAILURES (${failures.length}):`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("ALL WASM CHECKS PASSED");
