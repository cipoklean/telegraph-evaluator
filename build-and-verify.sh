#!/usr/bin/env bash
# Build the comparator for wasm32-unknown-unknown and run every check.
#
#   ./build-and-verify.sh
#
# Produces target/wasm32-unknown-unknown/release/telegraph_comparator.wasm and
# fails loudly if the artifact imports anything or drifts from the rule.
set -euo pipefail

cd "$(dirname "$0")"

WASM=target/wasm32-unknown-unknown/release/telegraph_comparator.wasm

echo "== rustc / cargo =="
rustc --version
cargo --version

echo
echo "== host tests (rule vs an independent restatement) =="
cargo test --test rule

echo
echo "== build wasm32-unknown-unknown =="
cargo build --release --target wasm32-unknown-unknown
ls -l "$WASM"

echo
echo "== artifact-level checks (real .wasm, zero imports) =="
node tests/wasm_runner.mjs "$WASM"

echo
echo "== wasm-tools import count (docs' own check) =="
if command -v wasm-tools >/dev/null 2>&1; then
  imports=$(wasm-tools print "$WASM" | grep -c '(import' || true)
  echo "imports: $imports"
  [ "$imports" = "0" ] || { echo "FAIL: artifact has imports"; exit 1; }
  echo "exports:"
  wasm-tools print "$WASM" | grep -E '^\s*\(export' || true
else
  echo "wasm-tools not installed; skipping its check (node runner already asserted 0 imports)"
fi

echo
echo "OK: $WASM"
