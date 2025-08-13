# Quick Start Guide: Concurrent Agent Development

## 🚀 Super Simple Setup (3 Commands)

### For the Developer/Manager:

1. **Queue up work in the kanban board** (edit `kanban.yaml` if needed)
2. **Start agents in separate terminal panes:**
   ```bash
   just agent1    # In pane 1
   just agent2    # In pane 2  
   just agent3    # In pane 3
   ```
3. **Give each Claude Code agent the simple prompt:** `just work`

That's it! Each agent automatically gets:
- ✅ Unique ID (agent-001, agent-002, agent-003)
- ✅ Isolated worktree
- ✅ Assigned task from queue
- ✅ Complete context and instructions

## 📋 Example Workflow

### Starting Concurrent Agents
Open 3 terminal panes and run:

**Pane 1:**
```bash
just agent1
```

**Pane 2:**
```bash
just agent2
```

**Pane 3:**
```bash
just agent3
```

**Example Output:**
```
🚀 Agent 1 Setup...

🤖 AGENT AGENT-001 SETUP

✨ NEW AGENT WORKSPACE CREATED
Agent: agent-001
Task: TASK-003 - Database Schema Optimization
Workspace: /home/jchen/repos/event-api-agent-001

================================================================
📋 CLAUDE CODE PROMPT:
================================================================
just work
================================================================
```

## 🤖 Standard Agent Instructions

### Copy-Paste Template for Claude Code:

```
just work
```

**That's the only instruction each agent needs!** The system handles everything else automatically.

### What Happens Automatically:

1. **Agent identifies itself** using multiple methods (survives /clear)
2. **Loads task details** from filesystem 
3. **Shows project context** from CLAUDE.md
4. **Checks for other agents** to avoid conflicts
5. **Sets up development environment**
6. **Provides persistent memory** via `.agent/` directory

## 🔄 Handling Claude Code /clear

**Problem**: When you use `/clear` in Claude Code, the agent loses its context but stays in the worktree directory.

**Solution**: Use the resume command to rejoin the workspace:

### Agent Resumption Workflow:

1. **Agent does `/clear`** → Loses context but still in worktree
2. **You run**: `just resume` (or `npm run agent:resume`)
3. **System automatically**:
   - ✅ Detects you're in an agent worktree
   - ✅ Recovers agent ID from multiple sources  
   - ✅ Repairs any missing files (.agent-id, status, etc.)
   - ✅ Shows current task and any work in progress
   - ✅ Provides full context to continue

### Resume Instructions for Claude:

```
just work
```

The same simple command works for both starting and resuming work!

## 🔧 Management Commands

### Check Status of All Agents:
```bash
just status
```

### Clean Up All Agents:
```bash
just cleanup-all
```

### Clean Up Specific Agent:
```bash
just cleanup agent-001
```

### For Agent Recovery (any scenario):
```bash
# Works for all cases: new start, resume after /clear, recovery
just work
```

### Get Help:
```bash
just help
```

## 📁 How It Works

### Agent Identification (Survives /clear)
The system uses multiple fallback methods to identify agents:

1. **`.agent-id` file** - Primary method
2. **Directory path** - `event-api-agent-001` pattern  
3. **Git worktree list** - Cross-reference current directory
4. **`.agent/status` file** - Backup status file
5. **Branch name** - `task/TASK-001` pattern

### Filesystem as Memory
Each agent workspace contains:
```
/home/jchen/repos/event-api-agent-001/
├── .agent-id                    # Agent identity
├── .agent/
│   ├── status                   # Current status
│   ├── summary                  # Startup summary
│   └── log                      # Activity log
├── TASK.md                      # Task description
├── .messages/                   # Inter-agent communication
└── [project files]             # Isolated workspace
```

### Task Queue (kanban.yaml)
```yaml
tasks:
  backlog:           # Available tasks
    - TASK-001       # Auto-assigned to agent-001
    - TASK-002       # Auto-assigned to agent-002
    - TASK-003       # Auto-assigned to agent-003
  
  in_progress: []    # Currently being worked on
  review: []         # Completed, pending review
  done: []           # Finished tasks
```

## 🎯 Benefits

### For Developers:
- **Zero setup complexity** - Just run one command
- **Automatic task assignment** from queue
- **No context management** - Everything persistent
- **No coordination overhead** - Agents are isolated

### For Agents:
- **Persistent identity** - Survives /clear
- **Complete context** - Task, project, environment
- **Isolated workspace** - No conflicts with other agents
- **Self-documenting** - All info available in filesystem

### For Teams:
- **Parallel development** - Up to 3 concurrent agents
- **Clear task tracking** - Kanban board management
- **Easy debugging** - All state visible in filesystem
- **Simple scaling** - Add more agents by editing config

## 🛠️ Customization

### Adding More Tasks:
Edit `kanban.yaml` and add to the `backlog` section:

```yaml
tasks:
  backlog:
    - id: "TASK-006"
      title: "Your New Task"
      priority: "high"
      description: "What needs to be done"
      requirements:
        - "Requirement 1"
        - "Requirement 2"
      files:
        - "src/your-module/"
```

### Changing Agent Limits:
Edit the `max_agents` setting in `kanban.yaml`:

```yaml
metadata:
  max_agents: 5  # Allow up to 5 concurrent agents
```

### Agent Specialization:
Configure agent preferences in `kanban.yaml`:

```yaml
assignment_rules:
  agent_specialties:
    agent-001: ["backend", "security"]
    agent-002: ["frontend", "ui"]  
    agent-003: ["database", "performance"]
```

## 🚨 Troubleshooting

### "All 3 agent slots are occupied"
```bash
just status  # See active agents
just cleanup agent-001  # Clean up finished work
```

### "Could not determine agent ID"
```bash
just work  # Re-run startup protocol
```

### Agent Lost Context After /clear
The resume command will restore everything:
```bash
just work
```

### No Tasks in Backlog
Add tasks to `kanban.yaml` in the `backlog` section.

---

This system transforms concurrent AI development from complex coordination into simple command execution. Each agent gets everything it needs automatically, and the filesystem preserves all context permanently.