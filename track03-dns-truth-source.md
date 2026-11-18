DNS Truth Source -- Telegraph Hackathon Season II, Track 03 Evaluators
Intent:       DNS_RECORD_LOOKUP_GENERAL (deterministic)
Contribution: truth source (evaluation material)
Source:       doh.pub (DNSPod public DNS-over-HTTPS), no-key, public HTTPS
Status:       eligible (pool snapshot published 2026-11-12; admitted 2026-11-11)
Case ID:      bf603817faadce0a85cabaf73aa0238b2b89e55bfc6711b3243ed07e99de90cc
Row hash:     a48d180e32eb160fc0d35d0dd9c87566ff66319238c16991232253499c5b372c

Second truth source, same intent:
Source:       Google Public DNS DoH JSON API (dns.google/resolve), no-key
Status:       eligible, attested; in the active pool snapshot
Coverage:     all ten record types (A AAAA CNAME MX NS TXT SOA CAA SRV PTR)
Row hash:     31cb44ba477326d0f6be0b6504045c760344f746041f0e9aa867006ade93bb55
Case ID:      35e8225b4e8a28a58f74e24c2b49a0d24a4a7e185f0648a45ff783a069e2f1b8

The doh.pub row covers seven types; the Google row covers all ten, so the
pool now has credible new coverage for this intent from this wallet.
Wallet:       0x51b0228bd9B8BF78CEDB11Cb485BA9F80cCf4655
Date:         2026-11-11

Pool status as of 2026-11-16: snapshot 80fac4e8 (published 2026-11-14, in
force since epoch 2091) holds 300 eligible rows from 6 submitters; both rows
above are `eligible` in it. DNS_RECORD_LOOKUP_GENERAL is live — class
deterministic, canonical, 25 miners — and a paid request through it
({name: "example.com", record_type: "A"}) settled on 2026-11-16 at epoch 2105
(tx 0x4b9fe61f8ff5c33eb2a2f1292b35673862135cf8beaf005b129bd3968a23bac6).

Third truth source, same intent:
Source:       Cloudflare 1.1.1.1 DoH JSON API (cloudflare-dns.com/dns-query),
              no-key, Accept: application/dns-json
Status:       admitted 2026-11-18 (pending the next pool snapshot)
Coverage:     all ten record types
Note:         the first upload was rejected `source_unparseable` — an
              `accepted_fields` block under a param breaks the pool parser.
              Same source without it was admitted (truth-cloudflare-doh.v2.yaml).

A minimal miner YAML describing a free, keyless DNS resolver. has_record is
true when the Answer array is present and non-empty. Two comparator
registrations sit pending on the DNS_RECORD_LOOKUP family prefix (#106, #150;
#72 and #340 were deregistered). The family is judgment-class, so comparators
on it stay pending and the deterministic child intent is scored against the
reference value the pool derives from truth sources. Truth sources and
comparators are separate contributions. The module from this repo was
originally registered as #340 on that family and deregistered on 2026-11-14;
the same WASM was then registered as #432 on the deterministic CRYPTO_PRICE
prefix, where it passed the correctness gate, held the canonical slot briefly,
and now sits superseded as a fallback (see README.md for the transaction
hashes, the endpoint, and the replacement chain).
