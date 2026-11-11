#!/usr/bin/env node
// Minimal runnable endpoint for the Telegraph comparator WASM.
//
// Implements the batch request a validator's remote check sends:
//
//   POST /
//   {"batch": [{"ground_truth_value": <int64>, "miner_value": <int64>,
//               "spec": [<comparison code>, <tolerance>]}, ...],
//    "foundation_hash": "...", "adapter_hash": "...", "tokenizer_hash": "...",
//    "input_root": "..."}
//
// Reply:
//
//   {"results": [{"score": <bp 0..10000>}, {"error": "..."}],
//    "foundation_hash": "...", "adapter_hash": "...", "tokenizer_hash": "..."}
//
// Runs the REAL compiled module, the same bytes that would be registered, with
// an empty import object (the module has no imports).
//
// Integer safety: ground_truth_value and miner_value are int64 and the node's own
// cases include values above 2^53 (their rejection example is truth
// 1000000000000000000 against miner 999999999999999999, which differ by 1).
// JSON.parse would round both to the same double and score them a match, which is
// the documented cause of "remote score mismatch". So this uses a small JSON
// parser that keeps every integer as its exact decimal text and converts with
// BigInt, never through a double.
//
// Usage: node server.mjs [--port 8790] [--wasm <path>]

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const PORT = Number(flag("port", 8790));
const WASM_PATH = flag(
  "wasm",
  path.join(HERE, "..", "target", "wasm32-unknown-unknown", "release", "telegraph_comparator.wasm"),
);
const MAX_BODY = 4 * 1024 * 1024; // docs: accept bodies of at least 1 MiB
const MAX_REPLY = 64 * 1024; // docs: a reply over 64 KiB is a failed attempt

// ---------------------------------------------------------------------------
// Load the module once. An empty import object means any import would throw.
// ---------------------------------------------------------------------------
const wasmBytes = fs.readFileSync(WASM_PATH);
const wasmSha256 = await sha256Hex(wasmBytes);
const mod = new WebAssembly.Module(wasmBytes);
const imports = WebAssembly.Module.imports(mod);
if (imports.length !== 0) {
  console.error("REFUSING TO START: module has imports", JSON.stringify(imports));
  process.exit(1);
}
const inst = new WebAssembly.Instance(mod, {});
const { imw_alloc, imw_free, imw_score_deterministic, memory } = inst.exports;
for (const need of ["imw_alloc", "imw_free", "imw_score_deterministic"]) {
  if (typeof inst.exports[need] !== "function") {
    console.error(`REFUSING TO START: missing export ${need}`);
    process.exit(1);
  }
}

async function sha256Hex(bytes) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

// ---------------------------------------------------------------------------
// Lossless JSON parse. Integers come back as {__int: "<decimal text>"}.
// ---------------------------------------------------------------------------
function parseJSONLossless(s) {
  let i = 0;
  const ws = () => { while (i < s.length && (s[i] === " " || s[i] === "\t" || s[i] === "\n" || s[i] === "\r")) i++; };

  function str() {
    if (s[i] !== '"') throw new Error(`expected string at ${i}`);
    i++;
    let out = "";
    while (i < s.length) {
      const c = s[i];
      if (c === '"') { i++; return out; }
      if (c === "\\") {
        i++;
        const e = s[i++];
        if (e === "u") { out += String.fromCharCode(parseInt(s.slice(i, i + 4), 16)); i += 4; }
        else if (e === "n") out += "\n";
        else if (e === "t") out += "\t";
        else if (e === "r") out += "\r";
        else if (e === "b") out += "\b";
        else if (e === "f") out += "\f";
        else out += e;
      } else { out += c; i++; }
    }
    throw new Error("unterminated string");
  }

  function num() {
    const start = i;
    if (s[i] === "-" || s[i] === "+") i++;
    while (i < s.length && /[0-9.eE+\-]/.test(s[i])) i++;
    const raw = s.slice(start, i);
    if (!/^-?\d+$/.test(raw)) throw new Error(`non-integer number ${JSON.stringify(raw)}`);
    return { __int: raw };
  }

  function value() {
    ws();
    const c = s[i];
    if (c === "{") return obj();
    if (c === "[") return arr();
    if (c === '"') return str();
    if (s.startsWith("true", i)) { i += 4; return true; }
    if (s.startsWith("false", i)) { i += 5; return false; }
    if (s.startsWith("null", i)) { i += 4; return null; }
    return num();
  }

  function obj() {
    const o = {}; i++; ws();
    if (s[i] === "}") { i++; return o; }
    for (;;) {
      ws();
      const k = str(); ws();
      if (s[i] !== ":") throw new Error("expected :");
      i++;
      o[k] = value(); ws();
      if (s[i] === ",") { i++; continue; }
      if (s[i] === "}") { i++; return o; }
      throw new Error("expected , or }");
    }
  }

  function arr() {
    const a = []; i++; ws();
    if (s[i] === "]") { i++; return a; }
    for (;;) {
      a.push(value()); ws();
      if (s[i] === ",") { i++; continue; }
      if (s[i] === "]") { i++; return a; }
      throw new Error("expected , or ]");
    }
  }

  const v = value();
  ws();
  return v;
}

// {__int:"123"} -> BigInt; plain JS numbers and numeric strings also accepted.
function toBigInt(v) {
  if (typeof v === "object" && v !== null && typeof v.__int === "string") return BigInt(v.__int);
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  throw new Error(`not an integer: ${JSON.stringify(v)}`);
}

const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;

// ---------------------------------------------------------------------------
// Score one comparator question by calling the REAL module.
// ---------------------------------------------------------------------------
function scoreOne(truth, miner, code, tolerance) {
  if (truth < I64_MIN || truth > I64_MAX) throw new Error("ground_truth_value out of int64 range");
  if (miner < I64_MIN || miner > I64_MAX) throw new Error("miner_value out of int64 range");
  if (tolerance < I64_MIN || tolerance > I64_MAX) throw new Error("tolerance out of int64 range");
  if (code < -2147483648 || code > 2147483647) throw new Error("comparison code out of i32 range");

  const ptr = imw_alloc(16);
  if (ptr === 0) throw new Error("imw_alloc returned 0");
  // A fresh view every call: memory.buffer is replaced if the module grows memory.
  const view = new DataView(memory.buffer);
  view.setBigInt64(ptr, BigInt(code), true);
  view.setBigInt64(ptr + 8, tolerance, true);
  let score;
  try {
    score = imw_score_deterministic(truth, miner, ptr);
  } finally {
    imw_free(ptr, 16);
  }
  const n = Number(score);
  // A negative score means "refuse" per the module contract.
  if (n < 0) throw new Error(`module refused the input (score ${n})`);
  if (n > 10000) throw new Error(`score ${n} above 10000`);
  return n;
}

const IDENTITY_KEYS = ["foundation_hash", "adapter_hash", "tokenizer_hash", "input_root"];

function handleBatch(parsed) {
  const batch = parsed.batch;
  if (!Array.isArray(batch)) throw Object.assign(new Error('body has no "batch" array'), { http: 400 });

  const results = batch.map((q) => {
    try {
      if (typeof q !== "object" || q === null) throw new Error("question is not an object");
      const truth = toBigInt(q.ground_truth_value);
      const miner = toBigInt(q.miner_value);
      const spec = q.spec;
      if (!Array.isArray(spec) || spec.length < 2) throw new Error("spec must be [code, tolerance]");
      const code = Number(toBigInt(spec[0]));
      const tolerance = toBigInt(spec[1]);
      return { score: scoreOne(truth, miner, code, tolerance) };
    } catch (e) {
      return { error: String(e.message || e) };
    }
  });

  // Echo the score identity exactly as received. Echoing the node's own values
  // back cannot produce an "identity echo mismatch".
  const reply = { results };
  for (const k of IDENTITY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(parsed, k) && parsed[k] !== null && parsed[k] !== undefined) {
      reply[k] = parsed[k];
    }
  }
  return reply;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/healthz" || req.url === "/")) {
    const body = JSON.stringify({
      ok: true,
      wasm_sha256: wasmSha256,
      wasm_bytes: wasmBytes.length,
      imports: imports.length,
      exports: Object.keys(inst.exports),
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "POST only" }));
    return;
  }

  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "body too large" }));
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    const raw = Buffer.concat(chunks).toString("utf8");
    const started = Date.now();
    let out;
    try {
      const parsed = parseJSONLossless(raw);
      out = handleBatch(parsed);
    } catch (e) {
      const code = e.http || 400;
      out = { results: [], error: String(e.message || e) };
      const body = JSON.stringify(out);
      console.log(`${new Date().toISOString()} ${code} ${req.method} ${req.url} ${size}b -> ${body}`);
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }
    const body = JSON.stringify(out);
    if (body.length > MAX_REPLY) {
      const err = JSON.stringify({ results: [], error: `reply ${body.length} bytes exceeds 64 KiB` });
      console.log(`${new Date().toISOString()} 500 -> ${err}`);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(err);
      return;
    }
    const scores = out.results.map((r) => (r.score !== undefined ? r.score : `err:${r.error}`));
    console.log(
      `${new Date().toISOString()} 200 POST ${req.url} ${size}b items=${out.results.length} ` +
        `${Date.now() - started}ms scores=[${scores.slice(0, 8).join(",")}${scores.length > 8 ? ",..." : ""}]`,
    );
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`comparator runnable endpoint listening on http://127.0.0.1:${PORT}`);
  console.log(`wasm: ${WASM_PATH}`);
  console.log(`wasm sha256: ${wasmSha256} (${wasmBytes.length} bytes, ${imports.length} imports)`);
});
