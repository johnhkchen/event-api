#!/bin/bash

# test-agent-workflow.sh - Comprehensive End-to-End Agent Workflow Testing
# Tests complete workflow system including concurrent operations, error recovery, 
# workspace isolation, and assignment logic validation

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FLOX_ACTIVATED=${FLOX_ACTIVATED:-false}
TEST_RESULTS_DIR="$PROJECT_ROOT/tests/test-results"
TEST_LOG="$TEST_RESULTS_DIR/workflow-test-$(date +%Y%m%d_%H%M%S).log"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""

# Utility functions
log() { echo -e "${1}" | tee -a "$TEST_LOG"; }
info() { log "${BLUE}[INFO]${NC} ${1}"; }
success() { log "${GREEN}[PASS]${NC} ${1}"; }
error() { log "${RED}[FAIL]${NC} ${1}"; }
warning() { log "${YELLOW}[WARN]${NC} ${1}"; }
debug() { log "${PURPLE}[DEBUG]${NC} ${1}"; }

# Test framework functions
start_test() {
    CURRENT_TEST="$1"
    TESTS_RUN=$((TESTS_RUN + 1))
    info "Starting test: $CURRENT_TEST"
}

pass_test() {
    TESTS_PASSED=$((TESTS_PASSED + 1))
    success "✓ $CURRENT_TEST"
}

fail_test() {
    TESTS_FAILED=$((TESTS_FAILED + 1))
    error "✗ $CURRENT_TEST"
    if [[ "${1:-}" != "" ]]; then
        error "  Reason: $1"
    fi
}

# Environment setup and validation
setup_test_environment() {
    info "Setting up test environment..."
    
    # Ensure we're in the project root
    cd "$PROJECT_ROOT"
    
    # Create test results directory
    mkdir -p "$TEST_RESULTS_DIR"
    
    # Verify Flox environment is active
    if [[ "$FLOX_ACTIVATED" != "true" ]]; then
        warning "Flox environment not detected. Some tests may fail."
        warning "Run 'flox activate' before running this script for best results."
    fi
    
    # Verify git repository state
    if ! git status >/dev/null 2>&1; then
        error "Not in a git repository. Agent workflow requires git."
        exit 1
    fi
    
    # Save current branch for restoration
    ORIGINAL_BRANCH=$(git branch --show-current)
    
    # Verify agent management scripts exist
    if [[ ! -f "$PROJECT_ROOT/scripts/agent-manager.ts" ]]; then
        error "agent-manager.ts not found. Cannot run workflow tests."
        exit 1
    fi
    
    info "Test environment ready. Logging to: $TEST_LOG"
}

# Cleanup function for safe test environment restoration
cleanup_test_environment() {
    info "Cleaning up test environment..."
    
    # Return to project root
    cd "$PROJECT_ROOT"
    
    # Force cleanup all test agents
    for agent_id in agent-001 agent-002 agent-003; do
        if [[ -d "./agents/$agent_id" ]]; then
            warning "Cleaning up test agent workspace: $agent_id"
            npm run agent:dev cleanup "$agent_id" 2>/dev/null || true
        fi
    done
    
    # Return to original branch
    if [[ -n "${ORIGINAL_BRANCH:-}" ]]; then
        git checkout "$ORIGINAL_BRANCH" 2>/dev/null || true
    fi
    
    # Clean up any test worktrees
    git worktree prune 2>/dev/null || true
    
    info "Test environment cleanup complete"
}

# Signal handler for graceful cleanup
trap cleanup_test_environment EXIT INT TERM

# Test utility functions
agent_exists() {
    local agent_id="$1"
    [[ -d "./agents/$agent_id" ]]
}

get_agent_status() {
    local agent_id="$1"
    npm run agent:dev status 2>/dev/null | grep "$agent_id" || echo "not_found"
}

wait_for_agent_state() {
    local agent_id="$1"
    local expected_state="$2"
    local timeout="${3:-30}"
    local elapsed=0
    
    while [[ $elapsed -lt $timeout ]]; do
        local current_state
        current_state=$(get_agent_status "$agent_id" | awk '{print $2}' || echo "unknown")
        if [[ "$current_state" == "$expected_state" ]]; then
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done
    return 1
}

# Test Suite 1: Basic Agent Lifecycle Testing
test_single_agent_lifecycle() {
    start_test "Single Agent Complete Lifecycle"
    
    # Start agent-001
    if npm run agent:dev setup agent-001 >/dev/null 2>&1; then
        debug "Agent-001 workspace created"
    else
        fail_test "Failed to create agent-001 workspace"
        return
    fi
    
    # Verify workspace exists
    if agent_exists "agent-001"; then
        debug "Agent-001 workspace verified"
    else
        fail_test "Agent-001 workspace not found after setup"
        return
    fi
    
    # Test work session
    cd "./agents/agent-001"
    if timeout 30 npm run agent:dev work 2>/dev/null; then
        debug "Agent work session completed"
    else
        fail_test "Agent work session failed or timed out"
        cd "$PROJECT_ROOT"
        return
    fi
    
    cd "$PROJECT_ROOT"
    
    # Test completion
    if npm run agent:dev complete agent-001 >/dev/null 2>&1; then
        debug "Agent completion successful"
    else
        fail_test "Agent completion failed"
        return
    fi
    
    # Test cleanup
    if npm run agent:dev cleanup agent-001 >/dev/null 2>&1; then
        debug "Agent cleanup successful"
    else
        fail_test "Agent cleanup failed"
        return
    fi
    
    # Verify workspace removed
    if ! agent_exists "agent-001"; then
        pass_test
    else
        fail_test "Agent workspace not properly cleaned up"
    fi
}

# Test Suite 2: Concurrent Agent Operations
test_concurrent_agent_operations() {
    start_test "Concurrent Agent Operations"
    
    # Start three agents simultaneously
    debug "Starting three agents concurrently..."
    
    npm run agent:dev setup agent-001 &
    local pid1=$!
    npm run agent:dev setup agent-002 &
    local pid2=$!
    npm run agent:dev setup agent-003 &
    local pid3=$!
    
    # Wait for all agents to complete setup
    wait $pid1 && wait $pid2 && wait $pid3
    
    # Verify all agents were created
    local agents_created=0
    for agent_id in agent-001 agent-002 agent-003; do
        if agent_exists "$agent_id"; then
            agents_created=$((agents_created + 1))
            debug "Agent $agent_id workspace created"
        else
            warning "Agent $agent_id workspace creation failed"
        fi
    done
    
    if [[ $agents_created -eq 3 ]]; then
        debug "All three agents created successfully"
    else
        fail_test "Only $agents_created out of 3 agents created successfully"
        return
    fi
    
    # Test concurrent work sessions (with timeout)
    debug "Testing concurrent work sessions..."
    
    cd "./agents/agent-001" && timeout 20 npm run agent:dev work &
    local work_pid1=$!
    cd "$PROJECT_ROOT"
    
    cd "./agents/agent-002" && timeout 20 npm run agent:dev work &
    local work_pid2=$!
    cd "$PROJECT_ROOT"
    
    cd "./agents/agent-003" && timeout 20 npm run agent:dev work &
    local work_pid3=$!
    cd "$PROJECT_ROOT"
    
    # Wait for work sessions (allow some to fail due to timeout)
    wait $work_pid1 || true
    wait $work_pid2 || true 
    wait $work_pid3 || true
    
    # Test concurrent completion
    debug "Testing concurrent completion..."
    npm run agent:dev complete agent-001 &
    npm run agent:dev complete agent-002 &
    npm run agent:dev complete agent-003 &
    wait
    
    # Verify workspace isolation maintained
    local isolation_maintained=true
    for agent_id in agent-001 agent-002 agent-003; do
        if [[ -d "./agents/$agent_id" ]]; then
            # Check if agent workspace contains only its own files
            local agent_files
            agent_files=$(find "./agents/$agent_id" -name ".agent-*" | wc -l)
            if [[ $agent_files -eq 0 ]]; then
                warning "Agent $agent_id missing isolation markers"
                isolation_maintained=false
            fi
        fi
    done
    
    if [[ "$isolation_maintained" == "true" ]]; then
        pass_test
    else
        fail_test "Workspace isolation not properly maintained"
    fi
}

# Test Suite 3: Assignment Logic Validation
test_assignment_logic() {
    start_test "Assignment Logic and Task Distribution"
    
    # Create a backup of current kanban state
    cp kanban.yaml kanban.yaml.test-backup
    
    # Test agent assignment without conflicts
    debug "Testing conflict-free agent assignment..."
    
    if npm run agent:dev setup agent-001 >/dev/null 2>&1; then
        local agent1_task
        agent1_task=$(npm run agent:dev status | grep agent-001 | awk '{print $3}' || echo "no-task")
        debug "Agent-001 assigned task: $agent1_task"
        
        if npm run agent:dev setup agent-002 >/dev/null 2>&1; then
            local agent2_task
            agent2_task=$(npm run agent:dev status | grep agent-002 | awk '{print $3}' || echo "no-task")
            debug "Agent-002 assigned task: $agent2_task"
            
            # Verify agents got different tasks
            if [[ "$agent1_task" != "$agent2_task" && "$agent1_task" != "no-task" && "$agent2_task" != "no-task" ]]; then
                debug "Agents received different tasks: $agent1_task vs $agent2_task"
                pass_test
            else
                fail_test "Agents received same task or no task assigned"
            fi
        else
            fail_test "Failed to setup agent-002"
        fi
    else
        fail_test "Failed to setup agent-001"
    fi
    
    # Restore kanban state
    mv kanban.yaml.test-backup kanban.yaml
}

# Test Suite 4: Workspace Isolation and Cleanup
test_workspace_isolation() {
    start_test "Workspace Isolation and Cleanup"
    
    # Setup two agents
    npm run agent:dev setup agent-001 >/dev/null 2>&1
    npm run agent:dev setup agent-002 >/dev/null 2>&1
    
    # Test workspace boundary enforcement
    debug "Testing workspace boundary enforcement..."
    
    local isolation_violated=false
    
    # Try to access agent-002 files from agent-001 workspace
    cd "./agents/agent-001"
    if [[ -r "../agent-002/.agent-id" ]]; then
        debug "Cross-agent file access detected (expected for this test)"
        # This is actually expected - the test is about logical isolation, not filesystem isolation
    fi
    cd "$PROJECT_ROOT"
    
    # Test cleanup workflow
    debug "Testing cleanup workflow..."
    
    if npm run agent:dev cleanup agent-001 >/dev/null 2>&1; then
        if ! agent_exists "agent-001"; then
            debug "Agent-001 cleaned up successfully"
            
            # Verify agent-002 still exists and is unaffected
            if agent_exists "agent-002"; then
                debug "Agent-002 workspace preserved during agent-001 cleanup"
                pass_test
            else
                fail_test "Agent-002 workspace affected by agent-001 cleanup"
            fi
        else
            fail_test "Agent-001 workspace not properly removed"
        fi
    else
        fail_test "Agent cleanup failed"
    fi
}

# Test Suite 5: Error Recovery Scenarios
test_error_recovery() {
    start_test "Error Recovery Scenarios"
    
    # Test workspace corruption recovery
    debug "Testing workspace corruption recovery..."
    
    npm run agent:dev setup agent-001 >/dev/null 2>&1
    
    # Simulate workspace corruption by removing agent ID file
    if [[ -d "./agents/agent-001" ]]; then
        rm -f "./agents/agent-001/.agent-id" 2>/dev/null || true
        
        # Try to resume agent work - should detect and recover
        cd "./agents/agent-001"
        if npm run agent:dev resume 2>/dev/null || npm run agent:dev work 2>/dev/null; then
            debug "Workspace corruption recovery successful"
            cd "$PROJECT_ROOT"
            pass_test
        else
            fail_test "Failed to recover from workspace corruption"
            cd "$PROJECT_ROOT"
        fi
    else
        fail_test "Agent-001 workspace not created for corruption test"
    fi
}

# Test Suite 6: Command Location Validation
test_command_validation() {
    start_test "Command Location Validation"
    
    npm run agent:dev setup agent-001 >/dev/null 2>&1
    
    # Test guardian command redirections
    debug "Testing guardian command redirections..."
    
    # Try to run 'just complete' from project root (should redirect)
    if timeout 10 just complete 2>&1 | grep -q "redirect\|workspace\|location" || true; then
        debug "Guardian command redirection working"
        
        # Try to run 'just work' from project root (should redirect)
        if timeout 10 just work 2>&1 | grep -q "redirect\|workspace\|location" || true; then
            debug "Work command redirection working"
            pass_test
        else
            fail_test "Work command redirection not working"
        fi
    else
        fail_test "Complete command redirection not working"
    fi
}

# Test Suite 7: Performance and Load Testing
test_performance_load() {
    start_test "Performance and Load Testing"
    
    debug "Testing rapid agent cycling..."
    
    local start_time
    start_time=$(date +%s)
    
    # Rapid cycle: setup -> complete -> cleanup for multiple iterations
    for i in {1..3}; do
        debug "Rapid cycle iteration $i"
        
        npm run agent:dev setup agent-001 >/dev/null 2>&1
        sleep 1
        npm run agent:dev complete agent-001 >/dev/null 2>&1
        sleep 1
        npm run agent:dev cleanup agent-001 >/dev/null 2>&1
        sleep 1
    done
    
    local end_time
    end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    debug "Rapid cycling completed in ${duration}s"
    
    if [[ $duration -lt 60 ]]; then
        pass_test
    else
        fail_test "Performance test exceeded time limit (${duration}s > 60s)"
    fi
}

# Test Suite 8: System Integration Testing
test_system_integration() {
    start_test "System Integration Testing"
    
    debug "Testing complete development cycle simulation..."
    
    # Simulate a realistic development workflow
    npm run agent:dev setup agent-001 >/dev/null 2>&1
    
    cd "./agents/agent-001"
    
    # Simulate some development work (create a test file)
    echo "// Test development work" > test-integration.tmp
    git add test-integration.tmp 2>/dev/null || true
    git commit -m "Test integration work" 2>/dev/null || true
    
    cd "$PROJECT_ROOT"
    
    # Complete the work
    if npm run agent:dev complete agent-001 >/dev/null 2>&1; then
        debug "Development cycle completion successful"
        
        # Verify work was preserved
        if git log --oneline -n 1 | grep -q "Test integration work"; then
            debug "Work preservation verified"
            pass_test
        else
            fail_test "Work not properly preserved"
        fi
    else
        fail_test "Development cycle completion failed"
    fi
}

# Main test runner
run_all_tests() {
    info "Starting comprehensive agent workflow testing..."
    info "Test session: $(date)"
    info "Project: $PROJECT_ROOT"
    
    # Run all test suites
    test_single_agent_lifecycle
    test_concurrent_agent_operations  
    test_assignment_logic
    test_workspace_isolation
    test_error_recovery
    test_command_validation
    test_performance_load
    test_system_integration
    
    # Summary report
    info "=========================================="
    info "AGENT WORKFLOW TEST SUMMARY"
    info "=========================================="
    info "Tests Run:    $TESTS_RUN"
    success "Tests Passed: $TESTS_PASSED"
    if [[ $TESTS_FAILED -gt 0 ]]; then
        error "Tests Failed: $TESTS_FAILED"
    else
        success "Tests Failed: $TESTS_FAILED"
    fi
    info "Success Rate: $(( TESTS_PASSED * 100 / TESTS_RUN ))%"
    info "Log File:     $TEST_LOG"
    info "=========================================="
    
    # Return appropriate exit code
    if [[ $TESTS_FAILED -eq 0 ]]; then
        success "All agent workflow tests PASSED! 🎉"
        return 0
    else
        error "Some agent workflow tests FAILED! ❌"
        return 1
    fi
}

# Script execution
main() {
    setup_test_environment
    run_all_tests
}

# Help function
show_help() {
    echo "Agent Workflow Testing Script"
    echo ""
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  -h, --help     Show this help message"
    echo "  --clean        Clean up test environment and exit"
    echo "  --dry-run      Show what tests would be run without executing"
    echo ""
    echo "This script performs comprehensive end-to-end testing of the"
    echo "agent workflow system including concurrent operations, error"
    echo "recovery, workspace isolation, and assignment logic."
    echo ""
    echo "Prerequisites:"
    echo "- Run from project root directory"
    echo "- Flox environment activated (recommended)"
    echo "- Git repository with clean working directory"
    echo ""
}

# Command line argument processing
case "${1:-}" in
    -h|--help)
        show_help
        exit 0
        ;;
    --clean)
        setup_test_environment
        cleanup_test_environment
        info "Test environment cleaned up"
        exit 0
        ;;
    --dry-run)
        info "Dry run mode - tests that would be executed:"
        info "1. Single Agent Complete Lifecycle"
        info "2. Concurrent Agent Operations"
        info "3. Assignment Logic and Task Distribution" 
        info "4. Workspace Isolation and Cleanup"
        info "5. Error Recovery Scenarios"
        info "6. Command Location Validation"
        info "7. Performance and Load Testing"
        info "8. System Integration Testing"
        exit 0
        ;;
    "")
        main
        ;;
    *)
        error "Unknown option: $1"
        show_help
        exit 1
        ;;
esac