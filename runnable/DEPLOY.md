# Deploying the runnable endpoint on an Oracle Cloud VM

The node checks this endpoint before downloading the WASM and again at epoch
rollovers during Stage 2. It must be public HTTPS, with no redirects, and it
must stay up until the registration leaves pending (3 failed attempts = rejection).

A comparator is pure WASM: Node 20+, no AI model, under 100 MB RAM.

## 1. Base setup (Oracle Ubuntu VM)

```bash
sudo apt-get update && sudo apt-get install -y nodejs npm
node --version   # need >= 20; if older: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
```

## 2. Get the code and the WASM

```bash
git clone https://github.com/cipoklean/telegraph-evaluator.git
cd telegraph-evaluator
# The WASM is committed at target/wasm32-unknown-unknown/release/telegraph_comparator.wasm
sha256sum target/wasm32-unknown-unknown/release/telegraph_comparator.wasm
# wasm_url is the raw file at the pinned tag (see step 5); the running server
# loads the same bytes from the same path, so the hashes always match.
```

## 3. Run it under systemd (as a non-root user is fine)

```ini
# /etc/systemd/system/comparator-runnable.service
[Unit]
Description=Telegraph comparator runnable endpoint
After=network.target

[Service]
WorkingDirectory=/home/ubuntu/telegraph-evaluator
ExecStart=/usr/bin/node runnable/server.mjs --host 0.0.0.0 --port 8790
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now comparator-runnable
curl -s localhost:8790/health || true   # if no health route, check: systemctl status comparator-runnable
```

## 4. Public HTTPS (pick ONE)

The node refuses plain HTTP, redirects, private/loopback addresses.

**A. Tailscale Funnel (no domain needed, fastest)**

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale funnel --bg --https=443 http://localhost:8790
# public URL: https://<machine>.<tailnet>.ts.net  (stable across restarts)
```

**B. Caddy with a domain you own**

```bash
sudo apt-get install -y caddy
# /etc/caddy/Caddyfile:
#   comparator.example.com {
#       reverse_proxy localhost:8790
#   }
sudo systemctl reload caddy   # Caddy gets the Let's Encrypt cert automatically
```

**C. Cloudflare Tunnel (named tunnel, needs a domain on Cloudflare)**

```bash
# cloudflared tunnel create comparator && cloudflared tunnel route dns comparator comparator.example.com
# config.yml: ingress -> http://localhost:8790 ; cloudflared tunnel run
```

Do NOT use `trycloudflare` quick tunnels for registration: the URL changes on
every restart and the node keeps the URL you registered.

## 5. Pin the WASM URL

Tag the exact commit and use the raw URL — immutable, survives force-pushes:

```bash
git tag comparator-v1 <commit-sha> && git push origin comparator-v1
# wasm_url:
# https://raw.githubusercontent.com/cipoklean/telegraph-evaluator/comparator-v1/target/wasm32-unknown-unknown/release/telegraph_comparator.wasm
# verify from anywhere:
curl -sL <wasm_url> | sha256sum   # must equal the local sha256sum above
```

## 6. Open the firewall (only for option B/C with direct ports)

Oracle Cloud also has a Security List / Network Security Group in the web
console — open the port there, not just iptables.

## 7. Smoke test from the public URL

```bash
curl -s -X POST https://<your-public-host>/ \
  -H 'Content-Type: application/json' \
  -d '{"batch":[{"ground_truth_value":100,"miner_value":100,"spec":[0,0]}],"foundation_hash":"x","adapter_hash":"x","tokenizer_hash":"x"}'
# expect {"results":[{"score":...}], ...}
```

Only then hand the URL to the registration step.
