#!/bin/bash
TOKEN="$1"
ORDER_ID="$2"
DEFAULT_MERCHANT_API_BASE_URL="https://api-test.example.com"
API_BASE_URL="${MERCHANT_API_BASE_URL:-$DEFAULT_MERCHANT_API_BASE_URL}"

if [ -z "$TOKEN" ] || [ -z "$ORDER_ID" ]; then
  echo '{"credited":false,"status":"failed","message":"missing token or order id"}'
  exit 1
fi

curl -s "$API_BASE_URL/platform/v1/payment/recharge/check?order_id=$ORDER_ID" \
  -H "Authorization: Bearer $TOKEN"
