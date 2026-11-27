#!/usr/bin/env bash
# Sends a webhook event to payment, signed the way Stripe signs it (lab 14, section 4):
# Stripe-Signature: t=<unix time>,v1=<hex HMAC-SHA256 of "<t>.<body>" with the webhook secret>.
#   scripts/send-webhook.sh event.json            # secret: STRIPE_WEBHOOK_SECRET from .env
#   scripts/send-webhook.sh event.json whsec_x    # another secret: payment must answer 400
set -euo pipefail
body=$(cat "$1")
secret=${2:-$(grep '^STRIPE_WEBHOOK_SECRET=' .env | cut -d= -f2-)}
t=$(date +%s)
sig=$(printf '%s.%s' "$t" "$body" | openssl dgst -sha256 -hmac "$secret" -hex | sed 's/^.* //')
curl -s -w ' %{http_code}\n' -X POST localhost:8085/webhooks/stripe \
  -H 'Content-Type: application/json' -H "Stripe-Signature: t=$t,v1=$sig" --data-binary "$body"
