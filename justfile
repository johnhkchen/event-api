# Dynamic Agent Workspace Commands

# Resume work with dynamic task assignment
work:
    @echo "🚀 Starting dynamic agent workspace..."
    WORKSPACE_DIR="{{justfile_directory()}}" tsx ../../scripts/agent-work.ts

# Show current agent identity and assignment
my-id:
    WORKSPACE_DIR="{{justfile_directory()}}" npm --prefix ../.. run agent:dev my-id

# Show status of all agents and kanban board
status:
    npm --prefix ../.. run agent:dev status

# Get assigned to next available task (if current task is complete)
assign:
    npm --prefix ../.. run agent:dev start

# Mark current task as complete and move to review
complete:
    @echo "🎉 Marking task as complete..."
    WORKSPACE_DIR="{{justfile_directory()}}" npm --prefix ../.. run agent:dev complete-task

# Alias for complete
done:
    @just complete

# Request reassignment to different task
reassign:
    @echo "🔄 Requesting task reassignment..."
    @echo "TODO: Implement task reassignment workflow"

# Show this help and current dynamic assignment
help:
    @echo "Dynamic Agent Commands:"
    @echo "  just work      🚀 Start work session (shows current assignment)"
    @echo "  just my-id     🆔 Show agent identity"
    @echo "  just status    📊 Show kanban board status"
    @echo "  just assign    📝 Get assigned to next task"
    @echo "  just complete  ✅ Mark current task complete"
    @echo "  just done      ✅ Mark current task complete (alias)"
    @echo "  just reassign  🔄 Request different task"
    @echo ""
    @echo "Your role and scope are determined dynamically by kanban.yaml!"

# Default shows current assignment
default:
    @just work
