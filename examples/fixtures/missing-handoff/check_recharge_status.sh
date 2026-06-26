#!/bin/bash
TOKEN="$1"
ORDER_ID="$2"
curl -s "https://api-test.example.com/platform/v1/payment/recharge/check?order_id=$ORDER_ID" \
  -H "Authorization: Bearer $TOKEN"
