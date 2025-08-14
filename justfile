# Hybrid Agent Management for Event API
# Usage: just agent1, just agent2, just agent3 (project level)
# Usage: just work, just done (within agent workspaces)

# Start or resume Agent 1
agent1:
    @echo "🚀 Agent 1 Setup..."
    npm run agent:dev setup agent-001
    @echo ""
    @echo "================================================================"
    @echo "📋 CLAUDE CODE PROMPT:"
    @echo "================================================================"
    @echo "just work"
    @echo "================================================================"

# Start or resume Agent 2
agent2:
    @echo "🚀 Agent 2 Setup..."
    npm run agent:dev setup agent-002
    @echo ""
    @echo "================================================================"
    @echo "📋 CLAUDE CODE PROMPT:"
    @echo "================================================================"
    @echo "just work"
    @echo "================================================================"

# Start or resume Agent 3  
agent3:
    @echo "🚀 Agent 3 Setup..."
    npm run agent:dev setup agent-003
    @echo ""
    @echo "================================================================"
    @echo "📋 CLAUDE CODE PROMPT:"
    @echo "================================================================"
    @echo "just work"
    @echo "================================================================"

# Show status of all agents and kanban board
status:
    @echo "📊 Agent Status Overview"
    npm run agent:dev status

# Clean up a specific agent (usage: just cleanup agent-001)
cleanup AGENT_ID:
    @echo "🧹 Cleaning up {{AGENT_ID}}..."
    npm run agent:dev cleanup {{AGENT_ID}}

# Clean up all agents and reset kanban
reset:
    @echo "🔄 Resetting all agents and kanban..."
    -npm run agent:dev cleanup agent-001
    -npm run agent:dev cleanup agent-002  
    -npm run agent:dev cleanup agent-003
    npm run agent:dev reset-kanban
    @echo "✅ All agents reset and ready for fresh tasks"

# Start all 3 agents automatically
start-all:
    @echo "🚀 Starting all 3 agents with fresh tasks..."
    just agent1 && just agent2 && just agent3
    @echo ""
    @echo "✅ All agents started! They're ready to run 'just work'"

# Add new tasks to kanban backlog
add-task TITLE PRIORITY="normal" HOURS="8":
    npm run agent:dev add-task "{{TITLE}}" {{PRIORITY}} {{HOURS}}

# GUARDIAN COMMANDS - Prevent agent confusion about command locations
# These commands redirect agents to their proper workspace

# Guardian: Redirect 'just complete' to agent workspace with location validation
complete:
    #!/usr/bin/env bash
    set -euo pipefail
    
    CURRENT_DIR="{{invocation_directory()}}"
    
    echo "❌ ERROR: 'just complete' should be run from your agent workspace directory"
    echo ""
    echo "📍 Current location: $CURRENT_DIR"
    echo "✅ Required pattern: */agents/agent-XXX"
    echo ""
    echo "💡 CORRECT USAGE:"
    
    # Provide context-aware guidance
    if [[ "$CURRENT_DIR" =~ /agents$ ]]; then
        echo "   You're in the agents directory. Enter a workspace:"
        echo "   cd agent-001  # or agent-002, agent-003"
    elif [[ "$CURRENT_DIR" == *"/event-api" && ! "$CURRENT_DIR" =~ /agents ]]; then
        echo "   1. Navigate to your agent directory:"
        echo "      cd agents/agent-001  # (or your assigned agent number)"
        echo "   2. Then run the command:"
        echo "      just complete"
    else
        echo "   1. Navigate to project root: cd /path/to/event-api"
        echo "   2. Check your assignment: just status"
        echo "   3. Go to your workspace: cd agents/agent-XXX"
        echo "   4. Then run: just complete"
    fi
    
    echo ""
    echo "🔍 To find your agent workspace:"
    echo "   just status           # Shows all agent assignments"
    echo ""
    echo "⚠️  WORKSPACE ISOLATION: Each agent must work within their assigned directory"
    exit 1

# Guardian: Redirect 'just done' to agent workspace  
done:
    @just complete

# Guardian: Redirect 'just work' to agent workspace with enhanced location validation
work:
    #!/usr/bin/env bash
    set -euo pipefail
    
    CURRENT_DIR="{{invocation_directory()}}"
    
    echo "❌ ERROR: 'just work' should be run from your agent workspace directory"
    echo ""
    echo "📍 Current location: $CURRENT_DIR"
    echo "✅ Required pattern: */agents/agent-XXX"
    echo ""
    echo "💡 CORRECT USAGE:"
    
    # Enhanced context-aware guidance
    if [[ "$CURRENT_DIR" =~ /agents/agent-[0-9]{3}$ ]]; then
        echo "   ✅ You appear to be in the right location already!"
        echo "   Try running the command again, or check if justfile exists:"
        echo "   ls -la justfile"
    elif [[ "$CURRENT_DIR" =~ /agents$ ]]; then
        echo "   You're in the agents directory. Enter a workspace:"
        echo "   cd agent-001  # or agent-002, agent-003"
        echo "   just work"
    elif [[ "$CURRENT_DIR" == *"/event-api" && ! "$CURRENT_DIR" =~ /agents ]]; then
        echo "   1. First, get assigned to an agent workspace:"
        echo "      just agent1  # or agent2, agent3"
        echo "   2. Navigate to your agent directory:"
        echo "      cd agents/agent-XXX"
        echo "   3. Then start work:"
        echo "      just work"
    else
        echo "   1. Navigate to project root: cd /path/to/event-api"
        echo "   2. Get agent assignment: just agent1"
        echo "   3. Navigate to workspace: cd agents/agent-XXX"
        echo "   4. Then start work: just work"
    fi
    
    echo ""
    echo "🎯 AGENT ASSIGNMENT: Run 'just agent1/2/3' to get your workspace"
    echo "🔍 CHECK STATUS: Run 'just status' to see current assignments"
    exit 1

# Guardian: Redirect 'just assign' for task assignment with enhanced delegation
assign:
    #!/usr/bin/env bash
    set -euo pipefail
    
    echo "🔄 Starting agent assignment process..."
    echo "💡 This will assign you to the next available task and create a workspace"
    echo ""
    
    # Enhanced delegation with error handling
    if INIT_CWD="$PWD" npm run agent:dev start; then
        echo "✅ Agent assignment completed successfully"
        echo "💡 Navigate to your workspace directory and run 'just work'"
    else
        echo "❌ Assignment failed - check error messages above"
        echo ""
        echo "🔧 TROUBLESHOOTING:"
        echo "  just status           # Check current agent states"
        echo "  just reset            # Clean slate restart if needed"
        echo "  just help             # Show all available commands"
        exit 1
    fi

# Safe assignment with confirmation (prevents accidental reassignments)
assign-safe:
    @echo "🔄 SAFE AGENT ASSIGNMENT"
    @echo "⚠️  WARNING: This will create/reassign an agent workspace"
    @echo ""
    @read -p "Are you sure you want to proceed? (yes/no): " confirm; \
    if [ "$$confirm" = "yes" ]; then \
        echo "Proceeding with assignment..."; \
        npm run agent:dev start; \
    else \
        echo "❌ Assignment cancelled"; \
    fi

# Preview next assignment without making changes  
assign-preview:
    @echo "🔍 ASSIGNMENT PREVIEW (no changes made)"
    @echo "Next task that would be assigned:"
    @echo ""
    npm run agent:dev preview 2>/dev/null || echo "Preview not available - would need to implement in agent-manager.ts"

# TICKET MANAGEMENT COMMANDS - Move tickets between states

# Move a ticket back to backlog (usage: just backlog TASK-ID)
backlog TASK_ID:
    @echo "📋 Moving {{TASK_ID}} back to backlog..."
    npm run agent:dev move-to-backlog {{TASK_ID}}

# Unassign a ticket and move to backlog (usage: just unassign TASK-ID)  
unassign TASK_ID:
    @echo "🔄 Unassigning {{TASK_ID}} and moving to backlog..."
    npm run agent:dev unassign {{TASK_ID}}

# Force clean an agent workspace (usage: just force-clean agent-001)
force-clean AGENT_ID:
    @echo "🧹 Force cleaning {{AGENT_ID}} workspace..."
    @echo "⚠️  WARNING: This will remove the workspace and reset the agent"
    npm run agent:dev cleanup {{AGENT_ID}}

# Show help
help:
    @echo "🤖 Project-Level Agent Management"
    @echo ""
    @echo "Quick Start:"
    @echo "  just start-all        🚀 Start all 3 agents automatically"
    @echo "  just reset            🔄 Reset everything for fresh start"
    @echo ""
    @echo "Individual Agents:"
    @echo "  just agent1           Start/resume agent-001"
    @echo "  just agent2           Start/resume agent-002" 
    @echo "  just agent3           Start/resume agent-003"
    @echo ""
    @echo "Management:"
    @echo "  just status           📊 Show all agent status & kanban board"
    @echo "  just cleanup AGENT-ID 🧹 Clean up specific agent workspace"
    @echo "  just reset            🔄 Clean slate restart with fresh tasks"
    @echo ""
    @echo "Assignment Commands:"
    @echo "  just assign-preview   🔍 Preview next assignment (safe, no changes)"
    @echo "  just assign-safe      🛡️  Assignment with confirmation prompt"
    @echo "  just assign           ⚡ Direct assignment to next available task"
    @echo ""
    @echo "Ticket Management:"
    @echo "  just add-task TITLE [PRIORITY] [HOURS] ➕ Add new task to backlog"
    @echo "  just backlog TASK-ID  📋 Move ticket back to backlog"
    @echo "  just unassign TASK-ID 🔄 Unassign task and move to backlog"
    @echo "  just force-clean ID   🧹 Force clean agent workspace"
    @echo ""
    @echo "Validation Framework:"
    @echo "  just validate-review        🔍 Analyze review section (safe dry-run)"
    @echo "  just validate-review-apply  ⚡ Apply validation changes (modifies kanban)"
    @echo "  just validate-summary       📊 Quick validation overview"
    @echo "  just backup-kanban          📦 Create kanban backup"
    @echo "  just validate-kanban        ✅ Check kanban integrity"
    @echo "  just test-validation        🧪 Run validation framework tests"
    @echo ""
    @echo "YAML Health & Validation:"
    @echo "  just yaml-check       ⚡ Quick YAML health status"
    @echo "  just yaml-health      🔍 Comprehensive YAML health analysis"
    @echo "  just yaml-health-fix  🔧 Fix YAML health issues automatically"
    @echo "  just yaml-backups     📋 List available YAML backups"
    @echo "  just yaml-restore N   🔄 Restore from backup #N"
    @echo ""
    @echo "Development:"
    @echo "  just dev              🔧 Start development mode"
    @echo "  just build            🏗️  Build TypeScript"
    @echo "  just install          📦 Install dependencies"
    @echo ""
    @echo "🛡️  Guardian Commands (redirect to agent workspace):"
    @echo "  just work             ❌ Blocked - run from agent workspace"
    @echo "  just complete         ❌ Blocked - run from agent workspace"
    @echo "  just done             ❌ Blocked - run from agent workspace"
    @echo ""
    @echo "💡 Once in agent workspaces (./agents/agent-XXX):"
    @echo "   Agents have their own justfile with work/done/complete commands"
    @echo ""
    @echo "📖 All commands include enhanced error handling and location validation"

# Default recipe shows help
default:
    @just help

# YAML HEALTH CHECK COMMANDS
# Comprehensive YAML validation and health checking

# Check YAML health (safe, read-only analysis)
yaml-health:
    @echo "🔍 YAML HEALTH CHECK - Safe Analysis"
    @echo ""
    tsx scripts/yaml-health-checker.ts --verbose

# Check and fix YAML health issues (applies fixes)
yaml-health-fix:
    @echo "🔧 YAML HEALTH CHECK - Auto-fix Mode"
    @echo "⚠️  WARNING: This will modify kanban.yaml after backup"
    @echo ""
    tsx scripts/yaml-health-checker.ts --fix --verbose

# Quick YAML health status
yaml-check:
    @echo "⚡ Quick YAML Health Check"
    tsx scripts/yaml-health-checker.ts

# List YAML backups
yaml-backups:
    tsx scripts/yaml-health-checker.ts --list-backups

# Restore from YAML backup (usage: just yaml-restore 1)
yaml-restore BACKUP_NUMBER:
    @echo "🔄 Restoring YAML from backup #{{BACKUP_NUMBER}}"
    @echo "⚠️  WARNING: This will overwrite current kanban.yaml"
    tsx scripts/yaml-health-checker.ts --restore {{BACKUP_NUMBER}}

# VALIDATION FRAMEWORK COMMANDS
# Systematic review section validation and processing

# Run full validation with backup (dry-run mode)
validate-review:
    @echo "🔍 VALIDATION FRAMEWORK - Review Section Analysis"
    @echo ""
    cd agents/agent-003 && tsx scripts/validation-engine.ts

# Run validation with changes applied (use with caution)
validate-review-apply:
    @echo "⚡ VALIDATION FRAMEWORK - Applying Changes to Kanban"
    @echo "⚠️  WARNING: This will modify kanban.yaml after backup"
    @echo ""
    cd agents/agent-003 && tsx scripts/validation-engine.ts --no-dry-run

# Run validation with verbose output
validate-review-verbose:
    @echo "🔍 VALIDATION FRAMEWORK - Detailed Analysis"
    @echo ""
    cd agents/agent-003 && tsx scripts/validation-engine.ts --verbose

# Test the validation framework
test-validation:
    @echo "🧪 Testing Validation Framework"
    @echo ""
    cd agents/agent-003 && npm test tests/validation-framework.test.ts

# Kanban backup management
backup-kanban:
    @echo "📦 Creating Kanban Backup"
    cd agents/agent-003 && tsx scripts/kanban-backup-manager.ts create --verbose

# List available kanban backups
list-backups:
    @echo "📋 Available Kanban Backups"
    cd agents/agent-003 && tsx scripts/kanban-backup-manager.ts list

# Restore from backup (usage: just restore-backup <backup-path>)
restore-backup BACKUP_PATH:
    @echo "🔄 Restoring Kanban from Backup"
    @echo "⚠️  WARNING: This will overwrite current kanban.yaml"
    cd agents/agent-003 && tsx scripts/kanban-backup-manager.ts restore {{BACKUP_PATH}}

# Validate kanban integrity
validate-kanban:
    @echo "🔍 Validating Kanban Integrity"
    cd agents/agent-003 && tsx scripts/kanban-backup-manager.ts validate

# Quick validation summary (safe, no changes)
validate-summary:
    #!/usr/bin/env bash
    set -euo pipefail
    
    echo "📊 QUICK VALIDATION SUMMARY"
    echo ""
    echo "📋 Current Review Section:"
    
    # Count tasks in review section using yq or basic grep
    if command -v yq >/dev/null 2>&1; then
        REVIEW_COUNT=$(yq '.tasks.review | length' kanban.yaml)
        echo "   Tasks in review: $REVIEW_COUNT"
    else
        echo "   Run 'just validate-review' for detailed analysis"
    fi
    
    echo ""
    echo "💡 Available Validation Commands:"
    echo "   just validate-review        🔍 Dry-run analysis (recommended first)"
    echo "   just validate-review-verbose 📝 Detailed output"
    echo "   just validate-kanban        ✅ Integrity check"
    echo "   just backup-kanban          📦 Create safety backup"

# Development commands
dev:
    @echo "🔧 Development mode"
    npm run dev

# Build the TypeScript
build:
    @echo "🏗️  Building TypeScript..."
    npm run build

# Install dependencies
install:
    @echo "📦 Installing dependencies..."
    npm install