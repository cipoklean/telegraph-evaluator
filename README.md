# Telegraph comparator module (CRYPTO_PRICE)

## Track 03 entry: DNS Truth Source
Truth source for DNS_RECORD_LOOKUP_GENERAL (doh.pub). Admitted 2026-11-11; `eligible` in the pool snapshot published 2026-11-12. A second truth source (Google Public DNS DoH, all ten record types) was admitted 2026-11-14 with attested provenance and joins the pool at the next freeze; see track03-dns-truth-source.md.
See track03-dns-truth-source.md for the case ID, wallet, and status.

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
undergoes the node's Stage 1/Stage 2 evaluation like any challenger and
becomes canonical only if it reproduces the reference comparison exactly (an
incumbent, registration #270, currently holds that slot). The runnable
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
