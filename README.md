# Telegraph comparator module (CRYPTO_PRICE)

## Track 03 entry: DNS Truth Source
Two truth sources for DNS_RECORD_LOOKUP_GENERAL (doh.pub and Google Public DNS DoH, all ten record types). Both are `eligible` in the active pool snapshot `80fac4e8` (published 2026-11-14, in force since epoch 2091), which holds 300 eligible rows from 6 submitters. The intent is live and scored: 25 miners serve it and a paid request through it settled on 2026-11-16 (epoch 2105).
See track03-dns-truth-source.md for the case IDs, wallet, and status.

A minimal, import-free WebAssembly **comparator module** for a Telegraph
deterministic intent. It reproduces the published reference rule from
<https://anjoman.ai/docs/scoring/build-a-scoring-module>.

The comparator module is registered on-chain as registration #432 on the
`CRYPTO_PRICE` family prefix (2026-11-14; keccak256
`d5c56b601993a1d8496426ab9174d55294e417f3739019d67f09d00336bc2113` matches the
tracked `.wasm`; registration tx
`0xb580097e49a7e1641ddf58ee15e808bc960290ae7907bf1a152e4fd96023ef92`). It was
first registered as #340 on `DNS_RECORD_LOOKUP` (2026-11-12) and deregistered
on 2026-11-14 (`0x3341c51e00d6d45e77252e3476f91ff950f89ecb9f070135bb4274f20c9cdb7e`):
that family is judgment-class, so a comparator registered there waits at
pending forever and never scores. `CRYPTO_PRICE` is deterministic, so #432
passed the node's correctness gate on 2026-11-14 (eval_score 1.0: 1120 cases,
0 mismatches, deterministic) and took the canonical slot from incumbent #270
at ~16:47Z. Comparator slots go to the most recent passer: any later
registration that reproduces the rule exactly replaces the incumbent, so #432
was superseded by #434 at 19:45Z the same day, and #434 was itself superseded
by #463 on 2026-11-16 (the current champion). #432 remains registered as the
family's rank-3 fallback. The runnable
endpoint the node calls is `https://hermes-node.tail007e79.ts.net`, served by
`runnable/server.mjs`; see `runnable/DEPLOY.md` for the Oracle VM + Tailscale
Funnel setup. Node-side status:
`https://devnode.telegraphprotocol.com/api/wasm/432`.

## What it exports

| Export | Signature |
|---|---|
| `imw_score_deterministic` | `(truth: i64, miner: i64, spec_ptr: i32) -> i64` |
| `imw_alloc` | `(size: i32) -> i32` |
| `imw_free` | `(ptr: i32, size: i32)` |

`spec_ptr` points to 16 bytes the node wrote after calling `imw_alloc`: two
little-endian `i64`, the comparison code first, then the tolerance. The return
value is basis points `0..=10000`; a negative value means refuse, above `10000`
is an error.

## The rule implemented

| Code | Name | Score |
|---|---|---|
| `0` | Exact | `10000` if `miner == truth`, else `0`. Tolerance ignored. |
| `1` | AbsTol | error is `abs(miner - truth)`, same fixed-point scale. |
| `2` | RelTol | error is `abs(miner - truth) * 10000 / max(abs(truth), 1)` bp, truncated. |
| `3` | PassFail | Same as Exact. |

For AbsTol and RelTol the score falls linearly:
`10000 * (2*tolerance - error) / (2*tolerance)`, integer division, reaching `0`
once `error >= 2*tolerance`. A tolerance of `0` or less means only an exact
match scores.

Details that the docs call out and this module honours:

- `truth` comes first, `miner` second.
- The code is read as a 32-bit integer; an unknown code is treated as Exact.
- Multiplications saturate rather than wrap. All arithmetic here is computed in
  `i128`, which cannot overflow for `i64` inputs.
- The RelTol product is an exact 128-bit computation, so values at wei scale
  (`1e18`) are handled without overflow.

## Build

Requires Rust with the wasm target:

```bash
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown
```

Artifact:

```
target/wasm32-unknown-unknown/release/telegraph_comparator.wasm
```

It is a few KB, far under the 32 MB comparator limit.

## Verify

```bash
./build-and-verify.sh
```

or step by step:

```bash
# 1. Host tests: the rule against an independent restatement
cargo test --test rule

# 2. Artifact tests: instantiate the REAL .wasm with an empty import object
node tests/wasm_runner.mjs target/wasm32-unknown-unknown/release/telegraph_comparator.wasm

# 3. Import count, exactly as the docs suggest
wasm-tools print target/wasm32-unknown-unknown/release/telegraph_comparator.wasm | grep -c '(import'   # 0
```

`tests/wasm_runner.mjs` instantiates the module with `{}` as its import object
and asserts `WebAssembly.Module.imports()` is empty, so an accidental import
fails the run rather than passing silently.

## Notes

- Built for `wasm32-unknown-unknown`, not WASI. No `fd_write`, no `proc_exit`.
- `no_std` on wasm32, with a `panic_handler` that traps. A trivial bump
  allocator backs `imw_alloc`/`imw_free`; the module is single-threaded, so no
  locking is used.
- `imw_free` reclaims only the most recent block; anything else is left to the
  bump pointer, which is correct, just not maximally reclaiming.
