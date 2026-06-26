# Test Case Examples

This document describes the bundled examples and how to add merchant-specific cases without changing evaluator code.

## How To Run

Run all bundled fixture tests:

```bash
npm test
```

Run one case manually:

```bash
node bin/evaluate.mjs \
  --skill examples/fixtures/generic-pass \
  --profile examples/generic-uat.profile.json \
  --out reports/generic-pass.report.json
```

## Case 1: Certified Generic Merchant

Fixture: `examples/fixtures/generic-pass`

Purpose:

- Proves the happy path for a merchant skill that declares all required Agent Payment capabilities.
- Demonstrates the minimum files a merchant package should include for L0 certification.

Expected result:

- recommendation: `certified`
- score: `100%`
- non-pass findings: none

What the evaluator checks:

- `SKILL.md` exists.
- No obvious committed secrets are present.
- `get_payment_config.sh` declares the expected merchant id, amount, and currency.
- The package references `agentic-payment-skills`, `clink-payment-skill`, or `clink-cli`.
- Wallet readiness uses `wallet status` and `card binding-link`.
- The human must explicitly authorize the exact charge.
- `agent-payment-handoff.contract.json` has `server`, `confirm_tool`, `confirm_args.order_id`, and `payment_handoff.order_id`.
- Merchant confirmation runs after payment success and before task resume.
- Failure semantics cover 3DS, card decline, risk block, timeout, and failed payment statuses.
- Merchant API URLs match `expected.merchantApiBaseUrl` in the profile.

## Case 2: Environment Mismatch

Fixture: `examples/fixtures/env-mismatch`

Purpose:

- Reproduces the class of issue found during the PollyReach UAT test.
- Shows how the evaluator detects a merchant skill that uses a production merchant API URL while the Clink merchant verifier is configured for test/UAT.

Expected result:

- recommendation: `not_certified`
- required non-pass finding: `environment.consistency`

Why this matters:

- Clink can send the correct `customerEmail` and still receive `verified=false` if the merchant verifier and merchant skill target different customer databases.
- This failure is usually owned by merchant configuration or environment mapping, not by Clink payment execution.

Typical remediation:

- Make the merchant API base URL runtime-configurable.
- Set the UAT/test package default to the same base URL as the Clink verifier.
- Keep production rollout behind a separate validation gate.

## Case 3: Missing Structured Handoff

Fixture: `examples/fixtures/missing-handoff`

Purpose:

- Shows why payment execution alone is not enough.
- A merchant skill must preserve a structured payment handoff so the merchant confirmation path can run exactly once and resume the original task safely.

Expected result:

- recommendation: `not_certified`
- required non-pass finding: `handoff.contract`

Typical remediation:

- Add `agent-payment-handoff.contract.json`.
- Include `server`, `confirm_tool`, `confirm_args.order_id`, and `payment_handoff.order_id`.
- Preserve optional `session_id` when available for support and recovery.

## Adding A Merchant Case

Create a profile:

```json
{
  "evaluationId": "merchant-uat-agent-payment",
  "environment": "uat",
  "expected": {
    "merchantId": "mcht_xxx",
    "amount": 1,
    "currency": "USD",
    "merchantApiBaseUrl": "https://api-test.merchant.example",
    "clinkApiBaseUrl": "https://uat-api.clinkbill.com"
  }
}
```

Run:

```bash
node bin/evaluate.mjs \
  --skill path/to/uploaded-skill.zip \
  --profile path/to/profile.json \
  --out reports/merchant.report.json
```

Do not add custom evaluator code for a normal merchant. If the merchant needs special data, add it to the standard profile or extend the schema in a generic way.

## Live Charge Case

Live charge testing is intentionally separate from static fixture tests.

Prerequisites:

- UAT merchant id is registered and points to the intended merchant verifier.
- The evaluation customer email exists in the merchant test environment.
- The Clink customer wallet is initialized.
- A UAT payment method is bound.
- The profile has `live.email`, `live.merchantIntegration`, and optional `merchantConfirmation`.

Command:

```bash
node bin/evaluate.mjs \
  --mode clink-live \
  --allow-charge \
  --skill path/to/uploaded-skill.zip \
  --profile path/to/profile.json \
  --out reports/live.report.json
```

Never run live mode in upload-time validation unless the user or CI job explicitly authorizes a charge.
