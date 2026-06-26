# Agent Payment Contract

Payment runtime dependency: `agentic-payment-skills` / `clink-payment-skill` through `clink-cli`.

Check readiness with `clink-cli wallet status --format json` and `clink-cli card binding-link --format json`.

Ask for explicit authorization for merchant `mcht_evaldemo123`, amount `1`, currency `USD`.

Handle 3DS, card declined, risk blocked, status `6`, and timeout or unknown payment state before retrying.

Confirm merchant fulfillment exactly once through https://api.example.com/platform/v1/payment/recharge/check.
