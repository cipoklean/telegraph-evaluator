DNS Truth Source -- Telegraph Hackathon Season II, Track 03 Evaluators
Intent:       DNS_RECORD_LOOKUP_GENERAL (deterministic)
Contribution: truth source (evaluation material)
Source:       doh.pub (DNSPod public DNS-over-HTTPS), no-key, public HTTPS
Status:       admitted (joins the pool at the next freeze)
Case ID:      bf603817faadce0a85cabaf73aa0238b2b89e55bfc6711b3243ed07e99de90cc
Row hash:     a48d180e32eb160fc0d35d0dd9c87566ff66319238c16991232253499c5b372c
Wallet:       0x51b0228bd9B8BF78CEDB11Cb485BA9F80cCf4655
Date:         2026-11-11

A minimal miner YAML describing a free, keyless DNS resolver. has_record is
true when the Answer array is present and non-empty. No comparator module is
registered for this intent (wasm_count 0, no champion on the family), so miner
answers here are checked against the reference value the pool derives from
truth sources. Truth sources and comparators are separate contributions.
