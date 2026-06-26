# Check Catalog

This catalog turns the Agent Payment integration contract into machine-checkable checks.

Severity:

- P0: funds, authorization, secret, fulfillment, or webhook security risk
- P1: breaks recovery, idempotency, notification routing, or user guidance
- P2: documentation, observability, or optional polish gap

## Implemented In Prototype

| Check ID | Severity | Layer | Meaning |
|---|---:|---|---|
| `package.structure` | P0 | L0 | `SKILL.md` exists and package is inspectable. |
| `security.no_secrets` | P0 | L0 | No obvious customer API keys, merchant keys, signing keys, or bearer/JWT tokens. |
| `merchant.config` | P0 | L0 | Merchant id, amount, and currency are declared and match profile when provided. |
| `payment.runtime_dependency` | P0 | L0 | Skill delegates payment execution to Clink agent payment infrastructure. |
| `wallet.readiness` | P0 | L0 | Skill describes wallet/card readiness before payment. |
| `authorization.exact_charge` | P0 | L0 | Human authorization for exact charge is required. |
| `handoff.contract` | P0 | L0 | Structured merchant handoff contract exists. |
| `merchant.confirmation` | P0 | L0 | Merchant confirmation path exists before fulfillment/task resume. |
| `failure.semantics` | P1 | L0 | No-card, decline, risk, 3DS, timeout, and failed statuses are covered. |
| `environment.consistency` | P0 | L0 | Merchant API URLs align with expected Clink verifier environment. |

## Required Next Checks

| Check ID | Severity | Layer | Meaning |
|---|---:|---|---|
| `AP-WALLET-001` | P0 | L1 | Payment must not auto-initialize wallet during charge execution. |
| `AP-CARD-001` | P0 | L1 | No card means no charge; evaluator should observe setup-link path. |
| `AP-AMOUNT-001` | P0 | L1 | Amount source is current user override or merchant default only. |
| `AP-PAY-001` | P0 | L1 | Direct mode has `merchant_id`, `amount`, `currency`; session mode has only `sessionId`. |
| `AP-MI-001` | P0 | L1 | `merchant_integration.server` and `confirm_tool` are present. |
| `AP-HANDOFF-001` | P0 | L1/L2 | Merchant confirm receives structured `payment_handoff`. |
| `AP-HANDOFF-002` | P0 | L2 | Same order/session triggers merchant confirmation at most once. |
| `AP-RESUME-001` | P0 | L1/L2 | Merchant task resumes only after merchant confirmation succeeds. |
| `AP-3DS-001` | P0 | L2 | 3DS saves pending context and waits for async outcome. |
| `AP-STATUS-001` | P0 | L1/L2 | Sync `status=1` success path follows payment-tool ownership. |
| `AP-STATUS-002` | P0 | L1/L2 | Sync `status=3/4/6` is terminal failure and does not resume merchant task. |
| `AP-WEBHOOK-001` | P0 | L2 | Standard payment/refund/risk/card events are replay-safe. |
| `AP-CVERIFY-001` | P0 | L3 | Merchant `customer.verify` accepts the declared evaluation customer. |
| `AP-WEBHOOK-SEC-001` | P0 | L2/L3 | Webhook signature, timestamp, idempotency, retry, and out-of-order behavior are verified. |
| `AP-NOTIFY-001` | P0 | L1/L2 | Exactly one owner sends each semantic card. |
| `AP-DIRECTIVE-001` | P0 | L1/L2 | `DIRECT_SEND`, `EXEC_REQUIRED`, `WAIT_FOR_WEBHOOK`, and `DATA_ONLY` directives are obeyed. |

## Mapping To Merchant Feedback

Each failed check should produce:

- concise title
- exact evidence
- why it matters
- fix recommendation
- whether Clink or merchant owns the fix

Example:

```json
{
  "id": "environment.consistency",
  "status": "FAIL",
  "severity": "blocker",
  "owner": "merchant",
  "title": "Merchant API base URL appears to target the wrong environment",
  "evidence": ["https://api.pollyreach.ai/platform/v1/payment/recharge/check"],
  "recommendation": "Expected https://api-test.pollyreach.ai for this UAT merchant. Make the merchant API base URL runtime-configurable."
}
```
