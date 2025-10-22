#!/bin/bash

# Script de prueba para el API Gateway - Excel Processing
# Uso: ./test-excel-api.sh

API_BASE_URL="http://localhost:3000"

echo "🧪 Testing API Gateway - Excel Processing"
echo "=========================================="

# Test 1: Health Check
echo ""
echo "1️⃣ Testing Health Check..."
response=$(curl -s -w "%{http_code}" -o /tmp/health_response.json "$API_BASE_URL/api/health")
if [ "$response" = "200" ]; then
    echo "✅ Health Check: OK"
    cat /tmp/health_response.json | jq .
else
    echo "❌ Health Check: FAILED (HTTP $response)"
fi

# Test 2: Test Broker Connection
echo ""
echo "2️⃣ Testing Broker Connection..."
response=$(curl -s -w "%{http_code}" -o /tmp/broker_response.json -X POST "$API_BASE_URL/api/test-broker-connection")
if [ "$response" = "202" ]; then
    echo "✅ Broker Connection: OK"
    cat /tmp/broker_response.json | jq .
else
    echo "❌ Broker Connection: FAILED (HTTP $response)"
    cat /tmp/broker_response.json | jq .
fi

# Test 3: Excel Processing - Missing base64Content
echo ""
echo "3️⃣ Testing Excel Processing - Missing base64Content..."
response=$(curl -s -w "%{http_code}" -o /tmp/excel_error_response.json -X POST \
  -H "Content-Type: application/json" \
  -d '{}' \
  "$API_BASE_URL/api/excel/process")
if [ "$response" = "400" ]; then
    echo "✅ Validation Error Handling: OK"
    cat /tmp/excel_error_response.json | jq .
else
    echo "❌ Validation Error Handling: FAILED (HTTP $response)"
    cat /tmp/excel_error_response.json | jq .
fi

# Test 4: Excel Processing - Empty base64Content
echo ""
echo "4️⃣ Testing Excel Processing - Empty base64Content..."
response=$(curl -s -w "%{http_code}" -o /tmp/excel_empty_response.json -X POST \
  -H "Content-Type: application/json" \
  -d '{"base64Content": ""}' \
  "$API_BASE_URL/api/excel/process")
if [ "$response" = "400" ]; then
    echo "✅ Empty Content Validation: OK"
    cat /tmp/excel_empty_response.json | jq .
else
    echo "❌ Empty Content Validation: FAILED (HTTP $response)"
    cat /tmp/excel_empty_response.json | jq .
fi

# Test 5: Excel Processing - Valid Request (with dummy base64)
echo ""
echo "5️⃣ Testing Excel Processing - Valid Request..."
# Crear un base64 dummy para la prueba
dummy_base64="UEsDBBQAAAAIAA=="
response=$(curl -s -w "%{http_code}" -o /tmp/excel_success_response.json -X POST \
  -H "Content-Type: application/json" \
  -d "{\"base64Content\": \"$dummy_base64\"}" \
  "$API_BASE_URL/api/excel/process")
if [ "$response" = "202" ]; then
    echo "✅ Excel Processing: OK"
    cat /tmp/excel_success_response.json | jq .
else
    echo "❌ Excel Processing: FAILED (HTTP $response)"
    cat /tmp/excel_success_response.json | jq .
fi

echo ""
echo "🏁 Test Summary Complete"
echo "========================"
echo "Check the responses above for detailed results."
echo ""
echo "📝 Notes:"
echo "- Test 5 may fail if ActiveMQ is not running"
echo "- Test 5 may fail if the excel-input-queue doesn't exist"
echo "- All validation tests should pass regardless of broker status"
echo ""
echo "🔧 To test with real Excel file:"
echo "curl -X POST http://localhost:3000/api/excel/process \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"base64Content\": \"YOUR_REAL_BASE64_HERE\"}'"

# Cleanup
rm -f /tmp/health_response.json /tmp/broker_response.json /tmp/excel_error_response.json /tmp/excel_empty_response.json /tmp/excel_success_response.json
