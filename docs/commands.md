# Agent Orientation Commands for Concurrent Development

## Agent Startup Protocol

When starting as a fresh coding agent in this repository, **always execute these commands first** to understand your context and assigned task.

## Required Startup Sequence

### 1. Environment Orientation
```bash
# Check which worktree you're in
pwd
git worktree list

# Understand your branch and commit
git branch
git log --oneline -5

# Check if Flox environment is active
echo $FLOX_ENV_DESCRIPTION
```

### 2. Task Discovery
```bash
# Look for task assignment files (in order of priority)
ls -la TASK.md TICKET-*.md README-*.md .task

# Check for task-specific documentation
find . -maxdepth 2 -name "*task*" -o -name "*ticket*" -o -name "*todo*" 2>/dev/null

# Look for branch-specific information
git log --grep="ticket\|task\|feat\|fix" --oneline -10
```

### 3. Project Context Loading
```bash
# Read project documentation
cat CLAUDE.md
cat docs/git-worktrees-guide.md

# Check project structure
ls -la
find . -maxdepth 2 -type d | head -10
```

## Task Assignment Patterns

### Pattern 1: TASK.md File (Preferred)
Create a `TASK.md` file in the worktree root containing:

```markdown
# Task: [Brief Description]
**Ticket:** #123  
**Priority:** High/Medium/Low  
**Assignee:** Agent-N  
**Created:** 2025-01-XX

## Objective
[Clear description of what needs to be accomplished]

## Requirements
- [ ] Requirement 1
- [ ] Requirement 2
- [ ] Requirement 3

## Context
[Any background information needed]

## Acceptance Criteria
- [ ] Criteria 1
- [ ] Criteria 2

## Notes
[Additional notes, dependencies, constraints]
```

### Pattern 2: Ticket-Based Files
```bash
# Create ticket-specific instruction files
touch TICKET-123.md
touch TICKET-456.md
```

### Pattern 3: Branch Name Convention
```bash
# Branch names that self-describe the task
git checkout -b ticket/123-user-authentication
git checkout -b task/api-redesign
git checkout -b fix/security-vulnerability
```

### Pattern 4: Hidden Task File
```bash
# Use hidden .task file for simple assignments
echo "Implement user authentication system - Ticket #123" > .task
```

## Agent Orientation Commands

### Command: `agent-status`
Add this function to your shell profile:

```bash
agent-status() {
    echo "=== AGENT ORIENTATION ==="
    echo "Working Directory: $(pwd)"
    echo "Git Branch: $(git branch --show-current)"
    echo "Git Worktree: $(git worktree list | grep $(pwd) || echo 'Main repository')"
    echo "Last Commit: $(git log --oneline -1)"
    echo ""
    
    echo "=== TASK ASSIGNMENT ==="
    if [ -f "TASK.md" ]; then
        echo "📋 Primary Task File Found:"
        head -10 TASK.md
    elif [ -f ".task" ]; then
        echo "📝 Simple Task File:"
        cat .task
    else
        echo "❓ No explicit task file found"
        echo "Checking branch name and recent commits..."
        git log --grep="ticket\|task\|feat\|fix" --oneline -3
    fi
    echo ""
    
    echo "=== ENVIRONMENT ==="
    echo "Flox Status: ${FLOX_ENV_DESCRIPTION:-Not active}"
    echo "Available Services:"
    lsof -i :3000,4000,8080 2>/dev/null | grep LISTEN || echo "No services detected"
}
```

### Command: `agent-init`
```bash
agent-init() {
    echo "Initializing agent in worktree..."
    
    # Activate Flox environment if not active
    if [ -z "$FLOX_ENV_DESCRIPTION" ]; then
        echo "Activating Flox environment..."
        flox activate
    fi
    
    # Run orientation
    agent-status
    
    # Check for dependencies
    echo ""
    echo "=== DEPENDENCY CHECK ==="
    if command -v node &> /dev/null; then
        echo "✅ Node.js: $(node --version)"
    else
        echo "❌ Node.js not found"
    fi
    
    if command -v elixir &> /dev/null; then
        echo "✅ Elixir: $(elixir --version | head -1)"
    else
        echo "❌ Elixir not found"
    fi
    
    echo ""
    echo "Agent initialization complete!"
}
```

## Task Handoff Protocol

### Creating Tasks for New Agents

#### 1. Ticket-Based Assignment
```bash
# Create a new worktree for ticket #123
git worktree add ../event-api-ticket-123 -b ticket/123-user-auth

# Navigate to the new worktree
cd ../event-api-ticket-123

# Create task specification
cat > TASK.md << 'EOF'
# Task: Implement User Authentication System
**Ticket:** #123  
**Priority:** High  
**Assignee:** Agent-Auth  
**Created:** 2025-01-12

## Objective
Implement a complete user authentication system with JWT tokens, password hashing, and session management.

## Requirements
- [ ] User registration endpoint
- [ ] User login endpoint  
- [ ] Password hashing with bcrypt
- [ ] JWT token generation and validation
- [ ] Session middleware
- [ ] Password reset functionality

## Context
This is part of the security enhancement initiative. The current system has no authentication.

## Acceptance Criteria
- [ ] All endpoints return proper HTTP status codes
- [ ] Passwords are never stored in plain text
- [ ] JWT tokens expire after 24 hours
- [ ] Tests coverage > 80%

## Files to Focus On
- `src/auth/`
- `src/middleware/`
- `tests/auth/`

## Dependencies
- bcrypt library
- jsonwebtoken library
- User model in database

## Notes
Coordinate with Agent-DB who is working on user schema in ticket #122.
EOF

# Initialize the agent environment
agent-init
```

#### 2. Quick Task Assignment
```bash
# For simple tasks, use the .task file
echo "Fix TypeScript compilation errors in auth module - Ticket #456" > .task

# Add more context if needed
cat >> .task << 'EOF'

Priority: High
Files: src/auth/*.ts
Context: Recent type definition changes broke the build
Commands: npm run type-check, npm run build
EOF
```

### Agent Handoff Commands

#### Passing Work Between Agents
```bash
# Current agent saves state
git add .
git commit -m "WIP: Authentication endpoints implemented

- ✅ Registration endpoint
- ✅ Login endpoint  
- 🔄 Password reset (in progress)
- ❌ Session middleware (not started)

Next agent should:
1. Complete password reset functionality
2. Implement session middleware
3. Add comprehensive tests

Ticket: #123"

# Update task file with progress
sed -i 's/- \[ \] User registration endpoint/- [x] User registration endpoint/' TASK.md
sed -i 's/- \[ \] User login endpoint/- [x] User login endpoint/' TASK.md
```

#### Agent Status Communication
```bash
# Create status update
cat > STATUS.md << 'EOF'
# Agent Status Update
**Agent:** Agent-Auth  
**Date:** 2025-01-12 14:30  
**Ticket:** #123

## Completed
- User registration endpoint with validation
- User login with JWT generation
- Password hashing with bcrypt

## In Progress  
- Password reset email functionality (50% complete)

## Blocked
- Need database schema from Agent-DB (ticket #122)

## Next Steps
1. Complete password reset
2. Add session middleware
3. Write comprehensive tests

## Files Modified
- src/auth/register.ts
- src/auth/login.ts
- src/auth/hash.ts
- src/types/user.ts
EOF
```

## Filesystem-Based Memory Patterns

### Convention: Use the filesystem as persistent memory

#### 1. Progress Tracking
```bash
# Create progress markers
mkdir -p .agent/
echo "$(date): Started authentication implementation" >> .agent/log
echo "registration,login" > .agent/completed
echo "password-reset,session-middleware,tests" > .agent/remaining
```

#### 2. Context Preservation
```bash
# Save important context
echo "bcrypt salt rounds: 12" > .agent/config
echo "JWT secret: stored in env var JWT_SECRET" >> .agent/config
echo "Session expires: 24 hours" >> .agent/config
```

#### 3. Inter-Agent Communication
```bash
# Leave messages for other agents
mkdir -p .messages/
echo "Schema ready for auth tables - Agent-DB" > .messages/from-agent-db
echo "Need API rate limiting coordination - Agent-Auth" > .messages/to-agent-api
```

## Standard Agent Instructions Template

### For Fresh Agent Startup:

```
You are a coding agent working on ticket #[NUMBER]. 

FIRST: Run these commands to understand your context:
1. `pwd && git worktree list`
2. `git branch && git log --oneline -3`  
3. `cat TASK.md` (or `cat .task` if TASK.md doesn't exist)
4. `ls -la` to see project structure

Your task is defined in the filesystem. Read all task files carefully before starting work.

Use the filesystem as your persistent memory:
- Save progress in .agent/ directory
- Update TASK.md checkboxes as you complete items
- Leave status updates in STATUS.md when pausing work
- Use git commits with descriptive messages for major milestones

This is a concurrent development environment. Other agents may be working on related tickets. Check for .messages/ directory for coordination notes.

Environment: This project uses Flox. Run `flox activate` if FLOX_ENV_DESCRIPTION is not set.

Now proceed with your assigned task.
```

## Emergency Recovery Commands

### If Agent Loses Context
```bash
# Rebuild context from filesystem
agent-status
cat TASK.md 2>/dev/null || cat .task 2>/dev/null || echo "No task file found"
git log --oneline -10
find . -name "*.md" -o -name ".agent" -o -name ".messages" | head -20
```

### If Worktree is Corrupted
```bash
# Return to main repo and recreate
cd /home/jchen/repos/event-api
git worktree remove --force ../event-api-ticket-123
git worktree add ../event-api-ticket-123 ticket/123-user-auth
```

## Integration with Claude Code Best Practices

### Recommended Startup Message for Fresh Agents:
```
I'm starting work in a new worktree. Let me first orient myself:

[Run agent-status command]

Based on my task assignment, I need to [summarize task from TASK.md].

I'll proceed by [outline approach] and use the filesystem to track my progress.
```

This document provides the foundation for reliable, context-aware agent coordination in a concurrent development environment using git worktrees as isolation boundaries and the filesystem as persistent memory.