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

# Show help
help:
    @echo "🤖 Project-Level Agent Management"
    @echo ""
    @echo "Quick Start:"
    @echo "  just start-all    🚀 Start all 3 agents automatically"
    @echo "  just reset        🔄 Reset everything for fresh start"
    @echo ""
    @echo "Individual Agents:"
    @echo "  just agent1       Start agent-001"
    @echo "  just agent2       Start agent-002" 
    @echo "  just agent3       Start agent-003"
    @echo ""
    @echo "Management:"
    @echo "  just status       📊 Show all agent status"
    @echo "  just add-task     ➕ Add new task to backlog"
    @echo "  just cleanup      🧹 Clean up specific agent"
    @echo "  just reset        🔄 Clean slate restart"
    @echo ""
    @echo "Development:"
    @echo "  just dev          🔧 Development mode"
    @echo "  just build        🏗️  Build TypeScript"
    @echo "  just install      📦 Install dependencies"
    @echo ""
    @echo "💡 Once in agent workspaces (./agents/agent-XXX):"
    @echo "   Agents have their own justfile with work/done/assign commands"

# Default recipe shows help
default:
    @just help

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
