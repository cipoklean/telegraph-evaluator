# Signing and uploading (run only on your instruction)

`cast` (Foundry) is not installed on this box. The repo's viem 2.57.13 does the
same EIP-191 personal_sign, with no new dependency.

## Step A: sign (does not touch the network)

Run from the repo that has viem installed:

    cd /path/to/telegraph-purse

    # key is read from .env by node, never echoed
    node --input-type=module -e '
      import fs from "node:fs";
      import { privateKeyToAccount } from "viem/accounts";
      const cfg = fs.readFileSync(".env","utf8");
      const m = cfg.match(/^TELEGRAPH_EVM_PRIVATE_KEY=(.+)$/m);
      if (!m) { console.error("key missing"); process.exit(1); }
      const acct = privateKeyToAccount(m[1].trim());
      const msg = fs.readFileSync("/path/to/telegraph-evaluator/truth-sources/build/message.txt","utf8");
      const sig = await acct.signMessage({ message: msg });
      console.log("address:", acct.address);
      console.log("signature:", sig);
    '

`acct.signMessage` is EIP-191 personal_sign over the message bytes, which is what
the node recovers. The message file has NO trailing newline, so the bytes signed
equal the bytes the node rebuilds.

## Step B: upload (changes the live pool)

    ADDR=<the address printed in step A>
    SIG=<the signature printed in step A>
    cd /path/to/telegraph-evaluator/truth-sources
    sed -e "s|^SIG=.*|SIG=\"$SIG\"|" build/upload.sh > build/upload.ready.sh
    sed -i "s|submitter=\$ADDR|submitter=$ADDR|" build/upload.ready.sh
    bash build/upload.ready.sh

## Step C: confirm the row landed

    curl -s "https://devnode.telegraphprotocol.com/api/evalpool/submissions/mine?submitter=$ADDR&intent_id=DNS_RECORD_LOOKUP_GENERAL"
    curl -s "https://devnode.telegraphprotocol.com/api/evalpool/status?intent_id=DNS_RECORD_LOOKUP_GENERAL"

A `superseded` / `duplicate_case` result means an equivalent source (the same
endpoints and parameters) is already in the pool. A `source_*` rejection names
the failed check.
