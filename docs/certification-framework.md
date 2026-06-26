# Generic Clink Agent Payment Certification Framework

This framework evaluates uploaded merchant skills for Clink Agent Payment capability.

## Why A Standard Profile Is Needed

Agent payment can be generic at the Clink layer, but merchant identity verification is merchant-owned. A universal evaluator cannot invent a merchant customer account. Therefore each merchant must provide a standard evaluation profile:

- merchant id
- expected amount and currency
- sandbox or UAT customer email accepted by the merchant verifier
- optional confirmation probe

The profile is declarative data, not merchant-specific evaluator code.

## Capability Areas

1. Package integrity
   - `SKILL.md` exists.
   - No committed customer API keys, secret keys, webhook signing keys, or bearer tokens.

2. Payment target configuration
   - Exactly one expected `merchantId`, or a runtime config tool that returns it.
   - Amount and currency are explicit.
   - The skill does not invent payment parameters from memory.

3. Payment runtime dependency
   - Uses Clink agent payment skill or `clink-cli`.
   - Does not describe agent payment as hosted checkout only.

4. Wallet and card readiness
   - Runs wallet initialization outside payment execution.
   - Refreshes payment methods before charging.
   - Blocks charging when no payment method is bound.

5. User authorization
   - Requires exact amount, currency, merchant, and product/top-up reason before charge.

6. Payment execution
   - Supports direct mode with `merchant_id`, `amount`, `currency`, or session mode with `sessionId`.
   - Calls `clink_pay` with `merchant_integration`.

7. Merchant handoff
   - Preserves structured `payment_handoff`.
   - Includes `order_id`.
   - Defines `server`, `confirm_tool`, and optional `confirm_args`.

8. Merchant confirmation
   - Confirms merchant crediting/fulfillment exactly once after payment success.
   - Does not resume fulfillment from payment success alone.

9. Failure semantics
   - Handles email verification failure, no card, card decline, risk rule block, 3DS, timeout, unknown state, and merchant confirmation failure.

10. Environment consistency
   - Clink UAT merchant endpoints and merchant API base URLs point to the same environment.
   - Hardcoded merchant API domains are flagged unless explicitly allowed.

## Result Model

Each check emits:

- `id`
- `status`
- `severity`
- `capability`
- `evidence`
- `recommendation`

The report should be suitable for merchant feedback: it must say what is missing and what to change, not only pass/fail.
