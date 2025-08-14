#!/bin/bash

# integration-test.sh
# Comprehensive integration testing script for Event API services
# Tests communication between Hono, Elixir, and BAML services

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TIMEOUT=30
MAX_RETRIES=10
RETRY_DELAY=3

# Service URLs
HONO_URL="${HONO_SERVICE_URL:-http://localhost:3000}"
ELIXIR_URL="${ELIXIR_SERVICE_URL:-http://localhost:4000}"
BAML_URL="${BAML_SERVICE_URL:-http://localhost:8080}"

# Test results tracking
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
SKIPPED_TESTS=0

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_test_result() {
    local test_name="$1"
    local result="$2"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    case "$result" in
        "PASS")
            PASSED_TESTS=$((PASSED_TESTS + 1))
            log_success "✓ $test_name"
            ;;
        "FAIL")
            FAILED_TESTS=$((FAILED_TESTS + 1))
            log_error "✗ $test_name"
            ;;
        "SKIP")
            SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
            log_warning "○ $test_name (skipped)"
            ;;
    esac
}

# Service health check functions
check_service_health() {
    local service_name="$1"
    local url="$2"
    local endpoint="${3:-/health}"
    
    log_info "Checking $service_name health at $url$endpoint"
    
    if curl -sf --max-time 10 "$url$endpoint" > /dev/null 2>&1; then
        log_success "$service_name is healthy"
        return 0
    else
        log_warning "$service_name is not available at $url$endpoint"
        return 1
    fi
}

wait_for_service() {
    local service_name="$1"
    local url="$2"
    local endpoint="${3:-/health}"
    local max_attempts="${4:-$MAX_RETRIES}"
    
    log_info "Waiting for $service_name to become available..."
    
    for ((i=1; i<=max_attempts; i++)); do
        if check_service_health "$service_name" "$url" "$endpoint"; then
            return 0
        fi
        
        if [ $i -lt $max_attempts ]; then
            log_info "Attempt $i/$max_attempts failed, retrying in ${RETRY_DELAY}s..."
            sleep $RETRY_DELAY
        fi
    done
    
    log_error "$service_name did not become available after $max_attempts attempts"
    return 1
}

# Test execution functions
run_elixir_integration_tests() {
    log_info "Running Elixir service integration tests..."
    
    cd "$PROJECT_ROOT/services/elixir_service"
    
    if mix test test/integration/ --trace 2>/dev/null; then
        log_test_result "Elixir Integration Tests" "PASS"
    else
        log_test_result "Elixir Integration Tests" "FAIL"
        return 1
    fi
}

run_hono_integration_tests() {
    log_info "Running Hono service integration tests..."
    
    cd "$PROJECT_ROOT/services/hono-api"
    
    # Run only integration tests with proper environment
    if ELIXIR_SERVICE_URL="$ELIXIR_URL" npm test -- --reporter=verbose elixir-integration 2>/dev/null; then
        log_test_result "Hono Integration Tests" "PASS"
    else
        log_test_result "Hono Integration Tests" "FAIL"
        return 1
    fi
}

test_hono_to_elixir_communication() {
    log_info "Testing Hono → Elixir communication..."
    
    # Test event processing endpoint
    local test_payload='{"title":"Integration Test Event","description":"Testing service communication","url":"https://example.com/test","html_content":"<html><body><h1>Test Event</h1></body></html>"}'
    
    if response=$(curl -sf --max-time 15 \
        -H "Content-Type: application/json" \
        -X POST \
        -d "$test_payload" \
        "$ELIXIR_URL/api/internal/process" 2>/dev/null); then
        
        if echo "$response" | grep -q '"job_id"'; then
            log_test_result "Hono → Elixir Event Processing" "PASS"
        else
            log_test_result "Hono → Elixir Event Processing" "FAIL"
            log_error "Response: $response"
            return 1
        fi
    else
        log_test_result "Hono → Elixir Event Processing" "FAIL"
        return 1
    fi
}

test_elixir_to_baml_communication() {
    log_info "Testing Elixir → BAML communication..."
    
    # Test BAML extraction endpoint
    local test_html='<html><head><title>Test Event</title></head><body><h1>AI Tech Conference</h1><p>Date: January 15, 2025</p><p>Speaker: John Doe</p></body></html>'
    local test_payload="{\"html_content\":\"$(echo "$test_html" | sed 's/"/\\"/g')\"}"
    
    if response=$(curl -sf --max-time 20 \
        -H "Content-Type: application/json" \
        -X POST \
        -d "$test_payload" \
        "$BAML_URL/api/v1/extract" 2>/dev/null); then
        
        if echo "$response" | grep -q '"title"'; then
            log_test_result "Elixir → BAML Content Extraction" "PASS"
        else
            log_test_result "Elixir → BAML Content Extraction" "FAIL"
            log_error "Response: $response"
            return 1
        fi
    else
        log_test_result "Elixir → BAML Content Extraction" "FAIL"
        return 1
    fi
}

test_graph_query_functionality() {
    log_info "Testing graph query functionality..."
    
    local test_query='{"query":"MATCH (e:Event) RETURN count(e) as event_count","parameters":{}}'
    
    if response=$(curl -sf --max-time 15 \
        -H "Content-Type: application/json" \
        -X POST \
        -d "$test_query" \
        "$ELIXIR_URL/api/internal/graph/query" 2>/dev/null); then
        
        if echo "$response" | grep -q '"results"'; then
            log_test_result "Graph Query Functionality" "PASS"
        else
            log_test_result "Graph Query Functionality" "FAIL"
            log_error "Response: $response"
            return 1
        fi
    else
        log_test_result "Graph Query Functionality" "FAIL"
        return 1
    fi
}

test_deduplication_service() {
    log_info "Testing deduplication service..."
    
    local test_payload='{"entities":[{"name":"John Doe","email":"john@example.com","company":"TechCorp"},{"name":"John D.","email":"john@example.com","company":"TechCorp Inc"}],"entity_type":"speaker"}'
    
    if response=$(curl -sf --max-time 15 \
        -H "Content-Type: application/json" \
        -X POST \
        -d "$test_payload" \
        "$ELIXIR_URL/api/internal/deduplicate" 2>/dev/null); then
        
        if echo "$response" | grep -q '"deduplicated_entities"'; then
            log_test_result "Deduplication Service" "PASS"
        else
            log_test_result "Deduplication Service" "FAIL"
            log_error "Response: $response"
            return 1
        fi
    else
        log_test_result "Deduplication Service" "FAIL"
        return 1
    fi
}

test_error_handling() {
    log_info "Testing error handling scenarios..."
    
    # Test with invalid JSON
    if curl -sf --max-time 10 \
        -H "Content-Type: application/json" \
        -X POST \
        -d '{invalid json}' \
        "$ELIXIR_URL/api/internal/process" 2>/dev/null | grep -q '"error"'; then
        log_test_result "Error Handling (Invalid JSON)" "PASS"
    else
        log_test_result "Error Handling (Invalid JSON)" "FAIL"
    fi
    
    # Test with missing required fields
    if curl -sf --max-time 10 \
        -H "Content-Type: application/json" \
        -X POST \
        -d '{"title":"Incomplete Event"}' \
        "$ELIXIR_URL/api/internal/process" 2>/dev/null | grep -q '"error"'; then
        log_test_result "Error Handling (Missing Fields)" "PASS"
    else
        log_test_result "Error Handling (Missing Fields)" "FAIL"
    fi
}

test_health_check_coordination() {
    log_info "Testing health check coordination..."
    
    # Test Elixir health endpoint
    if response=$(curl -sf --max-time 10 "$ELIXIR_URL/api/internal/health" 2>/dev/null); then
        if echo "$response" | grep -q '"status":"healthy"' && echo "$response" | grep -q '"services"'; then
            log_test_result "Elixir Health Check" "PASS"
        else
            log_test_result "Elixir Health Check" "FAIL"
            log_error "Health response: $response"
        fi
    else
        log_test_result "Elixir Health Check" "FAIL"
    fi
    
    # Test BAML health endpoint if available
    if check_service_health "BAML" "$BAML_URL" "/health" > /dev/null 2>&1; then
        log_test_result "BAML Health Check" "PASS"
    else
        log_test_result "BAML Health Check" "SKIP"
    fi
}

test_concurrent_requests() {
    log_info "Testing concurrent request handling..."
    
    local test_payload='{"title":"Concurrent Test Event","description":"Testing concurrent processing","url":"https://example.com/concurrent","html_content":"<html><body><h1>Concurrent Test</h1></body></html>"}'
    local pids=()
    local success_count=0
    local total_requests=5
    
    # Launch concurrent requests
    for i in $(seq 1 $total_requests); do
        (
            curl -sf --max-time 15 \
                -H "Content-Type: application/json" \
                -X POST \
                -d "$test_payload" \
                "$ELIXIR_URL/api/internal/process" > "/tmp/integration_test_$$_$i.out" 2>/dev/null
            echo $? > "/tmp/integration_test_$$_$i.exit"
        ) &
        pids+=($!)
    done
    
    # Wait for all requests to complete
    for pid in "${pids[@]}"; do
        wait "$pid"
    done
    
    # Check results
    for i in $(seq 1 $total_requests); do
        if [ -f "/tmp/integration_test_$$_$i.exit" ] && [ "$(cat "/tmp/integration_test_$$_$i.exit")" -eq 0 ]; then
            if [ -f "/tmp/integration_test_$$_$i.out" ] && grep -q '"job_id"' "/tmp/integration_test_$$_$i.out"; then
                success_count=$((success_count + 1))
            fi
        fi
        # Cleanup temp files
        rm -f "/tmp/integration_test_$$_$i.out" "/tmp/integration_test_$$_$i.exit"
    done
    
    if [ $success_count -ge $((total_requests * 80 / 100)) ]; then
        log_test_result "Concurrent Request Handling ($success_count/$total_requests)" "PASS"
    else
        log_test_result "Concurrent Request Handling ($success_count/$total_requests)" "FAIL"
    fi
}

# Performance testing
test_response_times() {
    log_info "Testing service response times..."
    
    # Test Elixir health endpoint response time
    start_time=$(date +%s%3N)
    if curl -sf --max-time 5 "$ELIXIR_URL/api/internal/health" > /dev/null 2>&1; then
        end_time=$(date +%s%3N)
        response_time=$((end_time - start_time))
        
        if [ $response_time -lt 2000 ]; then
            log_test_result "Elixir Response Time (${response_time}ms)" "PASS"
        else
            log_test_result "Elixir Response Time (${response_time}ms)" "FAIL"
        fi
    else
        log_test_result "Elixir Response Time" "FAIL"
    fi
}

# Main execution
main() {
    log_info "Starting Event API Integration Tests"
    log_info "============================================"
    
    # Check if services are running
    local services_available=true
    
    if ! check_service_health "Elixir" "$ELIXIR_URL" "/api/internal/health"; then
        log_warning "Elixir service not available - some tests will be skipped"
        services_available=false
    fi
    
    check_service_health "BAML" "$BAML_URL" "/health" || log_warning "BAML service not available - some tests will be skipped"
    
    # Run tests based on available services
    if [ "$services_available" = true ]; then
        log_info "Running comprehensive integration tests..."
        
        # Core communication tests
        test_hono_to_elixir_communication || true
        test_graph_query_functionality || true
        test_deduplication_service || true
        
        # BAML integration (if available)
        if check_service_health "BAML" "$BAML_URL" "/health" > /dev/null 2>&1; then
            test_elixir_to_baml_communication || true
        else
            log_test_result "Elixir → BAML Communication" "SKIP"
        fi
        
        # Error handling and resilience
        test_error_handling || true
        test_health_check_coordination || true
        test_concurrent_requests || true
        test_response_times || true
        
        # Framework-specific test suites
        if command -v mix > /dev/null 2>&1; then
            run_elixir_integration_tests || true
        else
            log_test_result "Elixir Test Suite" "SKIP"
        fi
        
        if command -v npm > /dev/null 2>&1 && [ -f "$PROJECT_ROOT/services/hono-api/package.json" ]; then
            run_hono_integration_tests || true
        else
            log_test_result "Hono Test Suite" "SKIP"
        fi
        
    else
        log_error "Required services are not available. Please start services and try again."
        exit 1
    fi
    
    # Summary
    log_info "============================================"
    log_info "Integration Test Summary:"
    log_info "  Total Tests: $TOTAL_TESTS"
    log_success "  Passed: $PASSED_TESTS"
    log_error "  Failed: $FAILED_TESTS"
    log_warning "  Skipped: $SKIPPED_TESTS"
    
    if [ $FAILED_TESTS -eq 0 ]; then
        log_success "All integration tests passed!"
        exit 0
    else
        log_error "Some integration tests failed!"
        exit 1
    fi
}

# Script options
case "${1:-}" in
    "--help"|"-h")
        echo "Usage: $0 [options]"
        echo "Options:"
        echo "  --help, -h     Show this help message"
        echo "  --quick, -q    Run quick tests only"
        echo "  --services     Check service availability only"
        echo ""
        echo "Environment Variables:"
        echo "  HONO_SERVICE_URL    Hono service URL (default: http://localhost:3000)"
        echo "  ELIXIR_SERVICE_URL  Elixir service URL (default: http://localhost:4000)"
        echo "  BAML_SERVICE_URL    BAML service URL (default: http://localhost:8080)"
        exit 0
        ;;
    "--quick"|"-q")
        log_info "Running quick integration tests only..."
        test_hono_to_elixir_communication || true
        test_health_check_coordination || true
        ;;
    "--services")
        log_info "Checking service availability..."
        check_service_health "Elixir" "$ELIXIR_URL" "/api/internal/health"
        check_service_health "BAML" "$BAML_URL" "/health"
        exit 0
        ;;
    "")
        main
        ;;
    *)
        log_error "Unknown option: $1"
        echo "Use --help for usage information"
        exit 1
        ;;
esac