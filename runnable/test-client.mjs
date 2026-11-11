#!/usr/bin/env node
// Check the runnable endpoint the way a validator's remote check does, plus a
// few known-value cases. Exit 0 only when every case is correct.
//
// Usage: node runnable/test-client.mjs [--url http://127.0.0.1:8790] [--n 100]

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const URL_ = flag("url", "http://127.0.0.1:8790");
const N = Number(flag("n", 100));

let pass = 0;
const fails = [];
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}${extra ? "  " + extra : ""}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${extra ? "  " + extra : ""}`); }
};

// Independent restatement of the published rule, in BigInt so nothing rounds.
function expected(truth, miner, code, tol) {
  if (code !== 1 && code !== 2) return miner === truth ? 10000 : 0;
  if (tol <= 0n) return miner === truth ? 10000 : 0;
  const d = miner > truth ? miner - truth : truth - miner;
  let err;
  if (code === 1) err = d;
  else {
    const at = truth < 0n ? -truth : truth;
    const denom = at > 1n ? at : 1n;
    err = (d * 10000n) / denom;
  }
  const win = 2n * tol;
  if (err >= win) return 0;
  return Number((10000n * (win - err)) / win);
}

const IDENT = {
  foundation_hash: "1111111111111111111111111111111111111111111111111111111111111111",
  adapter_hash: "2222222222222222222222222222222222222222222222222222222222222222",
  tokenizer_hash: "3333333333333333333333333333333333333333333333333333333333333333",
  input_root: "4444444444444444444444444444444444444444444444444444444444444444",
};

// The exact shape the node sends. Values are strings so nothing rounds on the
// way out either; the server parses them losslessly.
function q(truth, miner, code, tol) {
  return { ground_truth_value: String(truth), miner_value: String(miner), spec: [code, String(tol)] };
}

async function post(body, url = URL_) {
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  const text = await res.text();
  return { status: res.status, text, ms: Date.now() - started };
}

// ---- named cases from the docs' own examples and our rule ----
const CASES = [
  // [label, truth, miner, code, tol]
  ["exact match (code 0)", 100n, 100n, 0, 0n],
  ["mismatch (code 0)", 100n, 101n, 0, 0n],
  ["exact, tolerance ignored (code 0, tol 1000)", 100n, 100n, 0, 1000n],
  ["mismatch, tolerance ignored (code 0, tol 1000)", 100n, 101n, 0, 1000n],
  ["PassFail same as Exact (code 3)", 7n, 7n, 3, 0n],
  ["unknown code falls back to Exact", 5n, 6n, 99, 5n],
  ["AbsTol off by 1 of window 20", 1000n, 1001n, 1, 10n],
  ["AbsTol half score", 0n, 5n, 1, 5n],
  ["AbsTol at window edge -> 0", 0n, 10n, 1, 5n],
  ["AbsTol past edge -> 0", 0n, 11n, 1, 5n],
  ["AbsTol negative truth", -1000n, -1005n, 1, 10n],
  ["AbsTol tolerance 0, exact", 50n, 50n, 1, 0n],
  ["AbsTol tolerance 0, miss", 50n, 51n, 1, 0n],
  ["RelTol 1 percent inside window 400", 1000000000000000000n, 1010000000000000000n, 2, 200n],
  ["RelTol at 4 percent edge -> 0", 1000000000000000000n, 1040000000000000000n, 2, 200n],
  ["RelTol tiny error", 1000000000000000000n, 1000000000000001000n, 2, 10n],
  // The node's documented rejection example, in the orientation that scores it.
  ["docs example: differ by 1 at 1e18 (RelTol tol 10)", 1000000000000000000n, 999999999999999999n, 2, 10n],
];

console.log(`# known-value cases against ${URL_}\n`);
const body = { batch: CASES.map(([, t, m, c, tol]) => q(t, m, c, tol)), ...IDENT };
let r = await post(body);
ok("status 200", r.status === 200, `got ${r.status} in ${r.ms}ms`);
let out = {};
try { out = JSON.parse(r.text); } catch { fails.push("reply is not JSON"); }
ok("reply has results array", Array.isArray(out.results));
ok("one result per question", Array.isArray(out.results) && out.results.length === CASES.length,
   `${out.results?.length} vs ${CASES.length}`);
if (Array.isArray(out.results) && out.results.length === CASES.length) {
  CASES.forEach(([label, t, m, c, tol], i) => {
    const got = out.results[i];
    const want = expected(t, m, c, tol);
    if (got && got.error) return fails.push(`${label}: refused (${got.error})`);
    ok(label, got.score === want, `got ${got.score}, want ${want}`);
  });
}
ok("foundation_hash echoed", out.foundation_hash === IDENT.foundation_hash);
ok("adapter_hash echoed", out.adapter_hash === IDENT.adapter_hash);
ok("tokenizer_hash echoed", out.tokenizer_hash === IDENT.tokenizer_hash);
ok("input_root echoed", out.input_root === IDENT.input_root);
ok("reply under 64 KiB", r.text.length < 64 * 1024, `${r.text.length} bytes`);

// ---- a full 100-question batch, the real comparator check size ----
console.log(`\n# full batch of ${N} questions\n`);
const big = [];
for (let i = 0; i < N; i++) {
  const truth = 1000000000000000000n + BigInt(i) * 1000000n;
  const miner = i % 3 === 0 ? truth : truth + BigInt(i) * 1000n;
  big.push(q(truth, miner, i % 2 === 0 ? 0 : 2, i % 2 === 0 ? 0n : 200n));
}
r = await post({ batch: big, ...IDENT });
ok(`status 200 for ${N} questions`, r.status === 200, `${r.ms}ms`);
out = JSON.parse(r.text);
ok("results length matches", out.results?.length === N, `${out.results?.length}`);
ok("all scores in 0..10000", out.results.every((x) => Number.isInteger(x.score) && x.score >= 0 && x.score <= 10000));
ok("two batch requests well inside the 2 minute limit", r.ms < 60000, `${r.ms}ms`);

// ---- determinism: same batch twice, identical scores ----
r = await post({ batch: big, ...IDENT });
const again = JSON.parse(r.text);
ok("deterministic across calls", JSON.stringify(again.results) === JSON.stringify(out.results));

// ---- over-size batch is clamped by the node; we accept up to 1 MiB bodies ----
console.log("\n# edge cases\n");
r = await post({ results: [] });
ok("body with no batch -> 400", r.status === 400, `got ${r.status}`);

r = await post({ batch: [q(100n, 100n, 0, 0n)] });
let edge = JSON.parse(r.text);
ok("request without identity still scores", r.status === 200 && edge.results?.[0]?.score === 10000);

r = await post({ batch: [{ ground_truth_value: "x", miner_value: "1", spec: [0, "0"] }] });
edge = JSON.parse(r.text);
ok("garbage value -> {error}, not a crash", r.status === 200 && typeof edge.results?.[0]?.error === "string");

r = await post({ batch: [q(2n ** 64n, 1n, 0, 0n)] });
edge = JSON.parse(r.text);
ok("out-of-int64 value -> {error}", r.status === 200 && typeof edge.results?.[0]?.error === "string");

console.log(`\nchecks passed: ${pass}`);
if (fails.length) {
  console.error(`FAILURES (${fails.length}):`);
  for (const f of fails) console.error("  " + f);
  process.exit(1);
}
console.log("ALL RUNNABLE ENDPOINT CHECKS PASSED");
