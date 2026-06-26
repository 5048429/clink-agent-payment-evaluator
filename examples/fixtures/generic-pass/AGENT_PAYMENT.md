# Agent Payment Contract

Payment runtime dependency: `agentic-payment-skills` / `clink-payment-skill` through `clink-cli`.

Before charging:

```bash
CLINK_BASE_URL=https://uat-api.clinkbill.com clink-cli wallet status --format json
CLINK_BASE_URL=https://uat-api.clinkbill.com clink-cli card binding-link --format json
```

Ask the user for explicit authorization for merchant `mcht_evaldemo123`, amount `1`, currency `USD`, and the top-up reason.

Execute only after authorization:

```bash
CLINK_BASE_URL=https://uat-api.clinkbill.com clink-cli pay --merchant-id mcht_evaldemo123 --amount 1 --currency USD --format json
```

Handle failures safely:

- exit code `6` or timeout means unknown payment state; do not blindly retry.
- exit code `7` means 3DS is required; send the redirect URL and wait for the order event.
- status `3` means card declined.
- status `4` means risk blocked.
- status `6` means failed.

After payment success, call merchant confirmation exactly once and resume only after confirmation succeeds:

```bash
./check_recharge_status.sh <token> <order_id> [session_id]
```

Merchant confirmation uses `https://api-test.example.com/platform/v1/payment/recharge/check`.
