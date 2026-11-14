#!/usr/bin/env bash
# Fill SIG (65-byte hex EIP-191 signature of message.txt), then: bash build-google/upload.sh
set -euo pipefail
SIG="<65-byte-hex-EIP-191-signature>"
NONCE="d410dd76c0bd4d0697daaf66c50664ef"
ADDR="${ADDR:?set ADDR to the submitting wallet address}"
curl -s -X POST "https://devnode.telegraphprotocol.com/api/evalpool/submissions?intent_id=DNS_RECORD_LOOKUP_GENERAL&submitter=$ADDR" \
  -H "Content-Type: application/x-ndjson" \
  -H "X-Evalpool-Signature: $SIG" \
  -H "X-Evalpool-Nonce: $NONCE" \
  --data-binary @"/home/ubuntu/audit/telegraph-evaluator/truth-sources/build-google/items.jsonl"
