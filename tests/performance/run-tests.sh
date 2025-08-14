#!/bin/bash

# Performance Test Runner Script
# Executes comprehensive performance testing suite for Event API

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_DIR="$PROJECT_ROOT/test-results/performance/$TIMESTAMP"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting Performance Test Suite - $TIMESTAMP${NC}"

# Create results directory
mkdir -p "$RESULTS_DIR"

# Configuration
K6_CONFIG="$SCRIPT_DIR/k6-config.json"
SERVICES_READY=false
MAX_WAIT_TIME=300 # 5 minutes

# Function to check if all services are ready
check_services() {
    local services=(
        "http://localhost:3000/health"  # Hono API
        "http://localhost:4000/health"  # Elixir Service  
        "http://localhost:8080/health"  # BAML Service
        "http://localhost:5432"         # Database (basic connectivity)
    )
    
    echo -e "${YELLOW}Checking service availability...${NC}"
    
    for service in "${services[@]}"; do
        if [[ $service == *"5432" ]]; then
            # Special handling for database
            if ! nc -z localhost 5432; then
                echo -e "${RED}Database not available on localhost:5432${NC}"
                return 1
            fi
        else
            if ! curl -s --fail "$service" > /dev/null; then
                echo -e "${RED}Service not ready: $service${NC}"
                return 1
            fi
        fi
    done
    
    echo -e "${GREEN}All services are ready${NC}"
    return 0
}

# Function to wait for services
wait_for_services() {
    local waited=0
    while [ $waited -lt $MAX_WAIT_TIME ]; do
        if check_services; then
            SERVICES_READY=true
            break
        fi
        echo "Waiting for services... (${waited}s/${MAX_WAIT_TIME}s)"
        sleep 10
        waited=$((waited + 10))
    done
    
    if [ "$SERVICES_READY" != true ]; then
        echo -e "${RED}Services failed to become ready within ${MAX_WAIT_TIME}s${NC}"
        exit 1
    fi
}

# Function to run k6 test with proper configuration
run_k6_test() {
    local test_file=$1
    local test_name=$2
    local duration=${3:-"5m"}
    
    echo -e "${BLUE}Running $test_name...${NC}"
    
    local output_file="$RESULTS_DIR/${test_name}-results.json"
    local log_file="$RESULTS_DIR/${test_name}-log.txt"
    
    # Run k6 with JSON output and console logging
    k6 run \
        --config "$K6_CONFIG" \
        --duration "$duration" \
        --out "json=$output_file" \
        --console-output "$log_file" \
        --summary-trend-stats="min,avg,med,max,p(90),p(95),p(99)" \
        "$test_file" 2>&1 | tee -a "$log_file"
    
    local exit_code=${PIPESTATUS[0]}
    
    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}$test_name completed successfully${NC}"
    else
        echo -e "${RED}$test_name failed with exit code $exit_code${NC}"
    fi
    
    return $exit_code
}

# Function to run database benchmarks
run_database_benchmarks() {
    echo -e "${BLUE}Running database benchmarks...${NC}"
    
    local bench_results="$RESULTS_DIR/database-benchmark-results.txt"
    
    # pgbench baseline test
    echo "=== pgbench Baseline Test ===" >> "$bench_results"
    pgbench -h localhost -p 5432 -U event_api -d event_api_dev \
        -c 25 -j 4 -T 180 -P 30 \
        --report-latencies >> "$bench_results" 2>&1
    
    # Custom vector search benchmark
    echo "=== Vector Search Benchmark ===" >> "$bench_results"
    psql -h localhost -p 5432 -U event_api -d event_api_dev \
        -c "\\timing on" \
        -c "SELECT COUNT(*) FROM events WHERE embedding <-> '[0.1,0.2,0.3]'::vector < 0.8;" \
        >> "$bench_results" 2>&1
}

# Function to collect system metrics during tests
collect_system_metrics() {
    local metrics_file="$RESULTS_DIR/system-metrics.log"
    
    # Collect system resources every 10 seconds during tests
    while true; do
        {
            echo "=== $(date) ==="
            echo "Memory Usage:"
            free -h
            echo "CPU Usage:"
            top -bn1 | grep "Cpu(s)"
            echo "Docker Stats:"
            docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | head -10
            echo ""
        } >> "$metrics_file"
        sleep 10
    done &
    
    METRICS_PID=$!
}

# Function to generate performance report
generate_report() {
    local report_file="$RESULTS_DIR/performance-report.md"
    
    cat > "$report_file" << EOF
# Performance Test Report - $TIMESTAMP

## Test Configuration
- Test Date: $(date)
- k6 Version: $(k6 version)
- Services Tested: Hono API, Elixir Service, BAML Service
- Database: PostgreSQL with pgvector + AGE extensions

## Test Results Summary

### API Response Time Benchmarks
EOF

    # Process k6 JSON results to extract key metrics
    if [ -f "$RESULTS_DIR/api-response-benchmark-results.json" ]; then
        echo "- API Response Test: $(grep -o '"http_req_duration":{"avg":[0-9.]*' "$RESULTS_DIR/api-response-benchmark-results.json" | tail -1)" >> "$report_file"
    fi
    
    # Add database benchmark results
    if [ -f "$RESULTS_DIR/database-benchmark-results.txt" ]; then
        echo "" >> "$report_file"
        echo "### Database Performance" >> "$report_file"
        echo "\`\`\`" >> "$report_file"
        tail -20 "$RESULTS_DIR/database-benchmark-results.txt" >> "$report_file"
        echo "\`\`\`" >> "$report_file"
    fi
    
    echo -e "${GREEN}Performance report generated: $report_file${NC}"
}

# Main execution flow
main() {
    echo -e "${BLUE}Performance Testing Pipeline Started${NC}"
    
    # Pre-flight checks
    command -v k6 >/dev/null 2>&1 || { echo -e "${RED}k6 is required but not installed${NC}"; exit 1; }
    command -v docker >/dev/null 2>&1 || { echo -e "${RED}docker is required but not installed${NC}"; exit 1; }
    command -v psql >/dev/null 2>&1 || { echo -e "${RED}psql is required but not installed${NC}"; exit 1; }
    
    # Wait for services to be ready
    wait_for_services
    
    # Start system metrics collection
    collect_system_metrics
    
    # Test execution plan
    local all_tests_passed=true
    
    # 1. API Response Time Benchmarks (Priority 1)
    if ! run_k6_test "$SCRIPT_DIR/api-response-benchmark.js" "api-response-benchmark" "8m"; then
        all_tests_passed=false
    fi
    
    # 2. Database Performance Tests (Priority 1) 
    if ! run_k6_test "$SCRIPT_DIR/database-benchmark.js" "database-benchmark" "10m"; then
        all_tests_passed=false
    fi
    
    # 3. Concurrent Scraping Tests (Priority 2)
    if ! run_k6_test "$SCRIPT_DIR/scraping-load-test.js" "scraping-load-test" "8m"; then
        all_tests_passed=false
    fi
    
    # 4. Processing Pipeline Tests (Priority 2)
    if ! run_k6_test "$SCRIPT_DIR/processing-pipeline-test.js" "processing-pipeline-test" "12m"; then
        all_tests_passed=false
    fi
    
    # 5. Resource Profiling (Priority 3)
    if ! run_k6_test "$SCRIPT_DIR/profiling-config.js" "resource-profiling" "10m"; then
        all_tests_passed=false
    fi
    
    # 6. Database-specific benchmarks
    run_database_benchmarks
    
    # Stop metrics collection
    if [ ! -z "$METRICS_PID" ]; then
        kill $METRICS_PID 2>/dev/null || true
    fi
    
    # Generate comprehensive report
    generate_report
    
    # Final status
    if [ "$all_tests_passed" = true ]; then
        echo -e "${GREEN}All performance tests completed successfully!${NC}"
        echo -e "${GREEN}Results saved to: $RESULTS_DIR${NC}"
        exit 0
    else
        echo -e "${YELLOW}Some performance tests failed. Check logs in: $RESULTS_DIR${NC}"
        exit 1
    fi
}

# Handle script arguments
case "${1:-all}" in
    "api")
        wait_for_services
        run_k6_test "$SCRIPT_DIR/api-response-benchmark.js" "api-response-benchmark" "8m"
        ;;
    "database") 
        wait_for_services
        run_k6_test "$SCRIPT_DIR/database-benchmark.js" "database-benchmark" "10m"
        run_database_benchmarks
        ;;
    "scraping")
        wait_for_services
        run_k6_test "$SCRIPT_DIR/scraping-load-test.js" "scraping-load-test" "8m"
        ;;
    "pipeline")
        wait_for_services
        run_k6_test "$SCRIPT_DIR/processing-pipeline-test.js" "processing-pipeline-test" "12m"
        ;;
    "profiling")
        wait_for_services
        run_k6_test "$SCRIPT_DIR/profiling-config.js" "resource-profiling" "10m"
        ;;
    "all"|*)
        main
        ;;
esac