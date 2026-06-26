# Clink Agent Payment Evaluator

Generic evaluator for uploaded merchant skills that claim Clink Agent Payment support.

The evaluator checks the shared Clink Agent Payment capability contract. Merchant-specific data lives in a standard profile file; the evaluator code does not need to be customized per merchant.

## Quick Usage

Run all bundled fixture tests:

```bash
npm test
```

Evaluate a merchant skill package or directory:

```bash
node bin/evaluate.mjs \
  --skill path/to/merchant-skill.zip \
  --profile examples/generic-uat.profile.json \
  --out reports/merchant.report.json
```

The command writes both JSON and Markdown reports when `--out` ends in `.json`.

Live UAT charge is guarded and should only run with explicit approval:

```bash
node bin/evaluate.mjs \
  --mode clink-live \
  --allow-charge \
  --skill path/to/merchant-skill.zip \
  --profile examples/pollyreach-uat.profile.json \
  --out reports/merchant-live.report.json
```

## Evaluation Levels

- L0 static package checks: no charge. Implemented in `bin/evaluate.mjs`.
- L1 runtime dry-run contract: planned extension with mocked Clink payment execution.
- L2 webhook replay: planned extension for async, duplicate, and out-of-order event behavior.
- L3 Clink UAT live charge: optional and guarded by `--allow-charge`.

## Profile Contract

The profile is the only merchant-specific input. It declares expected payment target and optional live-test details.

Required for static certification:

- `expected.merchantId`
- `expected.amount`
- `expected.currency`

Recommended:

- `expected.merchantApiBaseUrl` to detect merchant environment mismatches.
- `expected.clinkApiBaseUrl` to document the Clink environment under test.
- `live.email` and `live.merchantIntegration` for guarded live checks.
- `merchantConfirmation` for post-payment merchant confirmation probes.

See `schema/evaluation-profile.schema.json` and `examples/generic-uat.profile.json`.

## Built-In Test Cases

The repository includes runnable fixture skills under `examples/fixtures`:

- `generic-pass`: expected to be `certified`.
- `env-mismatch`: expected to be `not_certified` because the merchant API URL targets the wrong environment.
- `missing-handoff`: expected to be `not_certified` because no structured merchant handoff contract exists.

Run them with:

```bash
npm test
```

For detailed case design and expected findings, see `docs/test-cases.md`.

## Report Semantics

- `PASS`: capability is present.
- `WARN`: capability is partially present or cannot be proven automatically.
- `FAIL`: capability is missing or contradicts the expected Clink contract.
- `BLOCKED`: evaluation cannot proceed because required setup is missing.

Certification suggestion:

- `certified`: score >= 90 and no fail/blocker findings.
- `conditional`: score >= 70 and no blocker findings.
- `not_certified`: otherwise.
