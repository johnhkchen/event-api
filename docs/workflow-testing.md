# Agent Workflow Testing and Procedures Guide

This document provides comprehensive procedures for testing, validating, and troubleshooting the Event API agent workflow system. It covers complete workflow procedures, testing protocols, and troubleshooting guidance for the multi-agent development environment.

## Table of Contents

- [Overview](#overview)
- [Testing Infrastructure](#testing-infrastructure)
- [Complete Workflow Procedures](#complete-workflow-procedures)
- [Testing Protocols](#testing-protocols)
- [Troubleshooting Guide](#troubleshooting-guide)
- [Validation Procedures](#validation-procedures)
- [Performance Guidelines](#performance-guidelines)
- [Security and Isolation](#security-and-isolation)

## Overview

The Event API uses a sophisticated multi-agent concurrent development system with:

- **3 Concurrent Agents**: agent-001, agent-002, agent-003
- **Git Worktree Isolation**: Each agent has isolated workspace
- **Kanban Integration**: Task assignment and status tracking
- **Guardian Commands**: Command location validation and redirection
- **Automated Cleanup**: Safe workspace and branch management

### Key Components

- `scripts/agent-manager.ts` - Central orchestration system
- `scripts/agent-work.ts` - Workspace session management
- `scripts/test-agent-workflow.sh` - Comprehensive testing suite
- `kanban.yaml` - Task and agent state tracking
- `justfile` - Command delegation and workspace protection

## Testing Infrastructure

### Automated Test Suite

The primary testing tool is `scripts/test-agent-workflow.sh` which provides:

```bash
# Run complete test suite
./scripts/test-agent-workflow.sh

# Dry run to see test list
./scripts/test-agent-workflow.sh --dry-run

# Clean up test environment
./scripts/test-agent-workflow.sh --clean

# Get help
./scripts/test-agent-workflow.sh --help
```

### Test Categories

The test suite covers 8 comprehensive categories:

1. **Single Agent Complete Lifecycle** - Full agent workflow validation
2. **Concurrent Agent Operations** - Multi-agent coordination testing
3. **Assignment Logic and Task Distribution** - Conflict-free task assignment
4. **Workspace Isolation and Cleanup** - Boundary enforcement validation
5. **Error Recovery Scenarios** - Corruption and failure recovery
6. **Command Location Validation** - Guardian command redirection
7. **Performance and Load Testing** - Rapid cycling and performance
8. **System Integration Testing** - End-to-end workflow validation

### Test Results

Test results are logged to `tests/test-results/workflow-test-TIMESTAMP.log` with:
- Color-coded pass/fail indicators
- Detailed debugging information
- Performance timing data
- Error analysis and recovery validation

## Complete Workflow Procedures

### Standard Agent Lifecycle

#### 1. Agent Assignment and Workspace Creation

```bash
# From project root
just agent1    # Creates agent-001 workspace
# OR
just agent2    # Creates agent-002 workspace  
# OR
just agent3    # Creates agent-003 workspace
```

**What happens:**
- Creates git worktree in `./agents/agent-XXX`
- Assigns highest priority task from backlog
- Updates kanban.yaml with agent status
- Generates workspace-specific justfile
- Creates task documentation (TASK.md)

#### 2. Development Work Session

```bash
# Navigate to agent workspace
cd agents/agent-001  # (or your assigned agent)

# Start work session
just work
```

**What happens:**
- Validates workspace context and integrity
- Displays current task details and requirements
- Sets up development environment
- Provides dynamic scope based on task requirements
- Enables IDE integration and development tools

#### 3. Task Completion

```bash
# From agent workspace
just complete
# OR
just done      # Alias for complete
```

**What happens:**
- Auto-commits any uncommitted changes with preservation message
- Marks task as completed in kanban.yaml
- Updates agent status to available
- Preserves all work and maintains git history
- Triggers completion validation

#### 4. Workspace Cleanup

```bash
# From project root
just cleanup agent-001
# OR from agent workspace
just cleanup
```

**What happens:**
- Validates all work is committed and preserved
- Removes git worktree safely
- Cleans up branch references
- Updates kanban.yaml agent status
- Performs integrity checks

### Concurrent Multi-Agent Operations

#### Starting All Agents

```bash
# Start all three agents simultaneously
just start-all

# Check status of all agents
just status
```

#### Managing Concurrent Work

```bash
# Each agent works independently
cd agents/agent-001 && just work &
cd agents/agent-002 && just work &
cd agents/agent-003 && just work &

# Monitor progress
just status
```

#### Coordinated Completion

Agents can complete at different times without conflict:
- Each agent manages its own workspace
- Kanban updates are atomic and conflict-free
- Branch operations are isolated per agent
- No cross-agent interference

### Task Management Procedures

#### Adding New Tasks

```bash
# Add task with defaults (normal priority, 8 hours)
just add-task "Implement user authentication"

# Add with specific priority and time estimate  
just add-task "Fix critical bug" critical 4

# Add with all parameters
just add-task "Add new feature" high 12
```

#### Task Reassignment

```bash
# Move task back to backlog
just backlog TASK-ID

# Unassign task from agent
just unassign TASK-ID

# Force reassignment (cleanup + new assignment)
just cleanup agent-001
just agent1
```

### Emergency Procedures

#### System Reset

```bash
# Complete reset - cleans all agents and starts fresh
just reset

# Selective reset - specific agent only
just cleanup agent-001
just agent1
```

#### Force Cleanup

```bash
# For corrupted workspaces
just force-clean agent-001

# Manual worktree cleanup
git worktree prune
```

## Testing Protocols

### Pre-Development Testing

Before starting development work, run validation tests:

```bash
# Quick validation
./scripts/test-agent-workflow.sh --dry-run

# Full validation (recommended weekly)
./scripts/test-agent-workflow.sh
```

### Integration Testing Scenarios

#### Scenario 1: Single Agent Development Flow

```bash
# Test complete single-agent workflow
just agent1
cd agents/agent-001
just work
# ... do development work ...
just complete
cd ../..
just cleanup agent-001
```

#### Scenario 2: Concurrent Development

```bash
# Test three agents working simultaneously  
just start-all
# Verify each agent has different tasks
just status
# Complete at different times
cd agents/agent-001 && just complete
cd agents/agent-002 && just complete  
cd agents/agent-003 && just complete
```

#### Scenario 3: Error Recovery

```bash
# Simulate workspace corruption
just agent1
rm agents/agent-001/.agent-id
cd agents/agent-001
just work  # Should detect and recover

# Test interrupted cleanup
just cleanup agent-001  # Interrupt with Ctrl+C
just cleanup agent-001  # Should complete safely
```

### Performance Testing

#### Load Testing

```bash
# Rapid cycling test
for i in {1..5}; do
  just agent1
  cd agents/agent-001 && just work
  just complete && cd ../..
  just cleanup agent-001
done
```

#### Concurrent Load

```bash
# Start all agents with timeout
timeout 60 just start-all
# Monitor system resources
top -p $(pgrep -f agent-manager)
```

### Validation Checkpoints

#### Daily Validation

- [ ] `just status` shows expected agent states
- [ ] All agent workspaces are clean (no uncommitted changes)
- [ ] Kanban.yaml is consistent with git worktree list
- [ ] No orphaned branches exist

#### Weekly Validation

- [ ] Run full test suite: `./scripts/test-agent-workflow.sh`
- [ ] Verify all completed tasks have proper validation_notes
- [ ] Check git log for proper commit preservation
- [ ] Validate workspace isolation boundaries

#### Monthly Validation

- [ ] Performance baseline testing
- [ ] Cross-platform compatibility testing
- [ ] Complete disaster recovery simulation
- [ ] Security audit of workspace isolation

## Troubleshooting Guide

### Common Issues and Solutions

#### Issue: "Agent workspace not found"

**Symptoms:**
- Commands fail with workspace validation errors
- Agent directories missing after system restart

**Solutions:**
1. Check worktree list: `git worktree list`
2. Verify kanban.yaml agent status
3. Force cleanup and recreate: `just force-clean agent-001 && just agent1`

#### Issue: "Task assignment conflicts"

**Symptoms:**
- Multiple agents assigned to same task
- Kanban.yaml shows inconsistent state

**Solutions:**
1. Check current assignments: `just status`
2. Reset all agents: `just reset`
3. Manually edit kanban.yaml if needed
4. Restart with clean state

#### Issue: "Uncommitted changes during cleanup"

**Symptoms:**
- Cleanup fails with git errors
- Warning about uncommitted work

**Solutions:**
1. Navigate to agent workspace: `cd agents/agent-XXX`
2. Commit manually: `git add . && git commit -m "Manual commit"`
3. Return to root and retry cleanup: `cd ../.. && just cleanup agent-XXX`

#### Issue: "Guardian command redirections not working"

**Symptoms:**
- `just work` or `just complete` run from wrong directory
- No redirection messages displayed

**Solutions:**
1. Verify justfile exists in project root: `ls -la justfile`
2. Check justfile syntax: `just --evaluate`
3. Update justfile if needed: `git pull origin main`

#### Issue: "Permission errors in workspace"

**Symptoms:**
- Files cannot be created/modified in agent workspace
- Git operations fail with permission errors

**Solutions:**
1. Check file permissions: `ls -la agents/agent-XXX`
2. Fix ownership: `chmod -R u+rw agents/agent-XXX`
3. Verify disk space: `df -h`

#### Issue: "Performance degradation"

**Symptoms:**
- Agent operations take longer than expected
- System becomes unresponsive during testing

**Solutions:**
1. Monitor system resources: `htop`
2. Clean up old test results: `rm -rf tests/test-results/workflow-test-*`
3. Restart with minimal processes
4. Check for background processes: `ps aux | grep agent`

### Advanced Troubleshooting

#### Git Worktree Issues

```bash
# List all worktrees
git worktree list

# Remove stale worktree references
git worktree prune

# Force remove corrupted worktree
git worktree remove --force agents/agent-001
```

#### Kanban State Recovery

```bash
# Backup current kanban
cp kanban.yaml kanban.yaml.backup

# Reset agent states (edit manually if needed)
# Restore from backup if needed
cp kanban.yaml.backup kanban.yaml
```

#### Process Management

```bash
# Find stuck agent processes
ps aux | grep agent-manager
ps aux | grep agent-work

# Kill stuck processes (use carefully)
pkill -f agent-manager
pkill -f agent-work
```

## Validation Procedures

### Workspace Integrity Validation

#### Automated Validation

```bash
# Run integrity checks
npm run agent:dev validate

# Check all workspaces
for agent in agent-001 agent-002 agent-003; do
  if [ -d "agents/$agent" ]; then
    echo "Validating $agent..."
    npm run agent:dev validate "$agent"
  fi
done
```

#### Manual Validation Checklist

- [ ] Agent ID files exist: `agents/agent-XXX/.agent-id`
- [ ] Task documentation current: `agents/agent-XXX/TASK.md`
- [ ] Git worktree listed: `git worktree list | grep agent-XXX`
- [ ] Kanban status matches: agent status corresponds to actual workspace
- [ ] No cross-workspace file references
- [ ] Proper branch naming: `task/TASK-ID-*`

### Assignment Logic Validation

#### Test Assignment Uniqueness

```bash
# Start multiple agents and verify different tasks
just agent1 && echo "Agent 1 task:" && grep "current_task:" kanban.yaml | head -1
just agent2 && echo "Agent 2 task:" && grep "current_task:" kanban.yaml | head -2 | tail -1
just agent3 && echo "Agent 3 task:" && grep "current_task:" kanban.yaml | head -3 | tail -1

# Verify all tasks are different
just status | grep "working"
```

#### Priority-Based Assignment Testing

```bash
# Add tasks with different priorities
just add-task "Critical test task" critical 2
just add-task "Normal test task" normal 4
just add-task "Low test task" low 1

# Assign agent - should get critical task first
just agent1
grep "Critical test task" agents/agent-001/TASK.md
```

### Performance Benchmarking

#### Baseline Performance Metrics

Standard operations should complete within these timeframes:

- Agent workspace creation: < 10 seconds
- Task assignment: < 5 seconds
- Work session start: < 3 seconds
- Task completion: < 5 seconds
- Workspace cleanup: < 15 seconds

#### Performance Testing Commands

```bash
# Time agent lifecycle
time just agent1
time (cd agents/agent-001 && just work)
time (cd agents/agent-001 && just complete)
time just cleanup agent-001

# Concurrent performance test
time just start-all
```

## Performance Guidelines

### System Requirements

#### Minimum Requirements
- 4GB RAM
- 2GB free disk space
- Git 2.24+ (worktree support)
- Node.js 18+
- 2 CPU cores

#### Recommended Requirements
- 8GB RAM
- 5GB free disk space
- Git 2.32+
- Node.js 20+
- 4 CPU cores
- SSD storage

### Optimization Guidelines

#### Resource Management
- Limit concurrent agents based on system capacity
- Clean up test results regularly: `rm -rf tests/test-results/workflow-test-*`
- Monitor disk usage in worktree directories
- Use `npm run agent:dev cleanup` instead of manual deletion

#### Performance Monitoring

```bash
# Monitor system resources during agent operations
htop &
just start-all
# Watch CPU and memory usage

# Monitor disk usage
du -sh agents/
df -h
```

#### Scaling Recommendations

For teams or CI environments:
- Increase `max_agents` in kanban.yaml carefully (tested up to 3)
- Use dedicated build servers for heavy concurrent testing  
- Implement cleanup automation for CI environments
- Consider resource limits in containerized environments

## Security and Isolation

### Workspace Isolation

#### Security Model
- Each agent operates in isolated git worktree
- File system isolation through directory boundaries
- Process isolation through separate Node.js instances
- Git branch isolation prevents merge conflicts

#### Validation of Isolation

```bash
# Test workspace boundaries
cd agents/agent-001
# Try to access other agent files - should be prevented by logical isolation
ls ../agent-002/  # Visible but logically separated

# Test command isolation
just complete  # Should work only in agent workspace
cd ../..
just complete  # Should redirect with error message
```

### Security Best Practices

#### Access Control
- Never run agent commands as root
- Verify file permissions on agent workspaces
- Use workspace validation before operations
- Implement timeout controls for long-running operations

#### Data Protection
- Commit preservation prevents work loss
- Automatic backups through git history
- Safe cleanup procedures with validation
- Branch safety mechanisms prevent accidental deletion

#### Audit and Monitoring

```bash
# Enable audit logging (add to ~/.bash_profile)
export AGENT_AUDIT_LOG="$HOME/.agent-audit.log"

# Monitor agent operations
tail -f tests/test-results/workflow-test-*.log

# Review git history for proper commits
git log --oneline --grep="Generated with Claude Code"
```

### Error Boundaries

#### Graceful Degradation
- Operations fail safely without corrupting state
- Partial failures allow recovery without full reset
- Error messages provide clear guidance
- Automatic cleanup on critical failures

#### Recovery Procedures
- Workspace corruption detection and repair
- State recovery from kanban.yaml backups  
- Branch recovery from git reflog
- Process recovery from stuck operations

## Conclusion

This workflow testing and procedures guide provides comprehensive coverage of:

✅ **Complete Testing Infrastructure** - Automated test suite with 8 comprehensive test categories  
✅ **Detailed Procedures** - Step-by-step workflows for all agent operations  
✅ **Comprehensive Troubleshooting** - Common issues and advanced recovery procedures  
✅ **Validation Protocols** - Daily, weekly, and monthly validation checkpoints  
✅ **Performance Guidelines** - Benchmarking and optimization recommendations  
✅ **Security Framework** - Isolation validation and security best practices  

### Quick Reference Commands

```bash
# Essential testing commands
./scripts/test-agent-workflow.sh              # Full test suite
./scripts/test-agent-workflow.sh --dry-run    # Preview tests
just status                                   # System status
just reset                                    # Emergency reset

# Daily operations  
just agent1                                   # Start agent
cd agents/agent-001 && just work             # Begin work
just complete && cd ../..                     # Finish work
just cleanup agent-001                        # Clean up

# Troubleshooting
just force-clean agent-001                    # Force cleanup
git worktree prune                           # Clean references
npm run agent:dev validate                   # Integrity check
```

For additional support or to report issues with the workflow system, refer to the project's issue tracker or documentation.