# Git Worktrees for Concurrent Claude Code Development

## Table of Contents
- [What are Git Worktrees?](#what-are-git-worktrees)
- [Why Use Worktrees with Claude Code?](#why-use-worktrees-with-claude-code)
- [Setting Up Git Worktrees](#setting-up-git-worktrees)
- [Basic Worktree Commands](#basic-worktree-commands)
- [Claude Code Concurrent Development Workflow](#claude-code-concurrent-development-workflow)
- [Best Practices](#best-practices)
- [Advanced Patterns](#advanced-patterns)
- [Troubleshooting](#troubleshooting)
- [Real-World Examples](#real-world-examples)

## What are Git Worktrees?

Git worktrees allow you to check out multiple branches of the same repository into separate directories simultaneously. Instead of switching between branches in a single working directory, you can have multiple working directories (worktrees) each with their own checked-out branch.

### Key Concepts

- **Main Repository**: Your primary working directory with the `.git` folder
- **Linked Worktrees**: Additional working directories that share the same Git history
- **Shared History**: All worktrees share the same commits, branches, and refs
- **Isolated Files**: Each worktree has its own working files and can be on different branches

### Traditional vs. Worktree Workflow

**Traditional Git Workflow:**
```bash
git checkout feature-1     # Switch to feature-1
# Work on feature-1
git stash                  # Stash changes
git checkout feature-2     # Switch to feature-2  
# Work on feature-2
git checkout feature-1     # Switch back
git stash pop              # Restore changes
```

**Worktree Workflow:**
```bash
git worktree add ../feature-1-work feature-1    # Create worktree for feature-1
git worktree add ../feature-2-work feature-2    # Create worktree for feature-2
# Work in both directories simultaneously
```

## Why Use Worktrees with Claude Code?

### The Parallel Development Revolution

Git worktrees enable a fundamental shift from **serial development** to **parallel development** when working with AI agents like Claude Code.

### Key Benefits

#### 1. **Multiple Claude Sessions Simultaneously**
- Run multiple Claude Code sessions, each in its own isolated worktree
- Each agent works on different features without interfering with others
- No context contamination between agents

#### 2. **Context Preservation**
- Each Claude session maintains its own focused context
- No confusion from unrelated changes in other features
- Clean, purpose-driven AI interactions

#### 3. **Eliminates Context Switching Overhead**
- No need to stash/unstash changes when switching tasks
- No branch switching interruptions
- Maintain momentum across multiple development streams

#### 4. **Risk Mitigation**
- Agents can't accidentally modify each other's work
- Failed experiments don't affect other development streams
- Easy to abandon problematic worktrees

#### 5. **Increased Productivity**
As one developer noted: *"We've gone from no Claude Code to simultaneously running four or five Claude agents, each working on different features in parallel."*

## Setting Up Git Worktrees

### Prerequisites

- Git 2.5+ (worktrees introduced in Git 2.5)
- A Git repository with at least one commit
- Claude Code installed and configured

### Basic Setup

1. **Check your Git version:**
```bash
git --version
```

2. **Ensure you're in a Git repository:**
```bash
git status
```

3. **List existing worktrees:**
```bash
git worktree list
```

## Basic Worktree Commands

### Creating Worktrees

#### Create worktree with new branch:
```bash
git worktree add <path> <new-branch-name>
```

Example:
```bash
git worktree add ../api-feature feature/api-enhancement
```

#### Create worktree from existing branch:
```bash
git worktree add <path> <existing-branch>
```

Example:
```bash
git worktree add ../hotfix-work hotfix/critical-bug
```

#### Create worktree with automatic branch naming:
```bash
git worktree add ../emergency-fix
# Creates branch "emergency-fix" automatically
```

### Managing Worktrees

#### List all worktrees:
```bash
git worktree list
```

Example output:
```
/home/user/project              ab12cd34 [main]
/home/user/project-feature-1    ef56gh78 [feature/authentication]  
/home/user/project-feature-2    ij90kl12 [feature/api-redesign]
```

#### List with verbose information:
```bash
git worktree list --verbose
```

#### Remove a worktree:
```bash
git worktree remove <path>
```

Example:
```bash
git worktree remove ../api-feature
```

#### Force remove (if worktree has uncommitted changes):
```bash
git worktree remove --force <path>
```

### Worktree Maintenance

#### Prune stale worktree references:
```bash
git worktree prune
```

#### Repair worktree references:
```bash
git worktree repair
```

## Claude Code Concurrent Development Workflow

### Basic Parallel Development Setup

1. **Create worktrees for each feature:**
```bash
# From your main repository
git worktree add ../auth-feature feature/user-authentication
git worktree add ../api-feature feature/api-redesign  
git worktree add ../ui-feature feature/dashboard-ui
```

2. **Open separate terminal sessions:**
```bash
# Terminal 1
cd ../auth-feature
claude code

# Terminal 2  
cd ../api-feature
claude code

# Terminal 3
cd ../ui-feature
claude code
```

3. **Work with isolated Claude sessions:**
Each Claude Code session now operates in complete isolation, with its own:
- Working directory
- File context
- Branch state
- Development focus

### Advanced Workflow with Custom Commands

Create custom commands to streamline worktree creation:

#### Bash Script Example (`pgw` - Parallel Git Worktree):
```bash
#!/bin/bash
# Save as ~/bin/pgw or add to your .bashrc

pgw() {
    local feature_name="$1"
    if [ -z "$feature_name" ]; then
        echo "Usage: pgw <feature-name>"
        return 1
    fi
    
    local worktree_path="../${feature_name}-worktree"
    local branch_name="feature/${feature_name}"
    
    # Create worktree
    git worktree add "$worktree_path" -b "$branch_name"
    
    # Navigate to worktree
    cd "$worktree_path"
    
    # Optional: Open VS Code with Claude Code
    code .
    
    echo "Created worktree at $worktree_path on branch $branch_name"
}
```

Usage:
```bash
pgw user-authentication
pgw api-redesign  
pgw dashboard-ui
```

### Integration Workflow

When features are complete:

1. **Return to main repository:**
```bash
cd /path/to/main/repo
```

2. **Merge completed features:**
```bash
git checkout main
git merge feature/user-authentication
git merge feature/api-redesign
```

3. **Clean up worktrees:**
```bash
git worktree remove ../auth-feature
git worktree remove ../api-feature
```

## Best Practices

### Directory Organization

#### Recommended Structure:
```
project/                          # Main repository
├── .git/
├── src/
└── README.md

project-worktrees/               # Worktree container directory
├── auth-feature/               # Worktree 1
├── api-redesign/              # Worktree 2
├── dashboard-ui/              # Worktree 3
└── hotfix-critical/           # Worktree 4
```

#### Create the structure:
```bash
mkdir ../project-worktrees
git worktree add ../project-worktrees/auth-feature feature/auth
git worktree add ../project-worktrees/api-redesign feature/api
```

### Naming Conventions

#### Branch Names:
- `feature/authentication`
- `feature/api-v2`
- `hotfix/security-patch`
- `experiment/new-architecture`

#### Worktree Paths:
- `../worktrees/auth-work`
- `../worktrees/api-work`
- `../worktrees/hotfix-work`

### Resource Management

#### Limit Active Worktrees:
- Keep 3-5 active worktrees maximum
- More worktrees = more disk space usage
- Monitor system resources

#### Regular Cleanup:
```bash
# Weekly cleanup routine
git worktree prune
git branch -d feature/completed-feature
git worktree remove ../completed-worktree
```

### Claude Code Specific Best Practices

#### 1. **Clear Task Separation**
- Assign one specific feature/task per worktree
- Avoid overlapping functionality between agents
- Use descriptive worktree names that match the task

#### 2. **Context Isolation**
- Start each Claude session with a clear task description
- Include relevant context files in each worktree
- Use worktree-specific documentation or notes

#### 3. **Coordination Strategy**
- Use shared documentation to track which agent is working on what
- Regular check-ins on progress across worktrees
- Plan integration points early

#### 4. **Error Recovery**
- Each worktree is isolated - failed experiments don't affect others
- Easy to restart problematic worktrees
- Maintain backup branches for critical work

## Advanced Patterns

### Temporary Development Environments

For quick fixes or experiments:

```bash
# Create temporary worktree
git worktree add -b emergency-fix ../temp main

# Work in temporary environment
pushd ../temp
# ... make changes with Claude Code ...
git commit -a -m 'emergency fix for production'
popd

# Clean up
git worktree remove ../temp
```

### Worktree-Specific Configuration

Enable worktree-specific Git configuration:

```bash
git config extensions.worktreeConfig true
```

Now each worktree can have its own `.git/config.worktree` file:

```bash
# In a specific worktree
git config --worktree user.email "feature-team@company.com"
git config --worktree core.editor "nano"
```

### Shared Development Setup

For team environments:

```bash
# Team member A
git worktree add ../feature-auth feature/authentication
git push -u origin feature/authentication

# Team member B  
git fetch origin
git worktree add ../feature-auth origin/feature/authentication
```

### Parallel Implementation Strategy

Use multiple agents to implement the same feature differently:

```bash
git worktree add ../implementation-a feature/payment-v1
git worktree add ../implementation-b feature/payment-v2  
git worktree add ../implementation-c feature/payment-v3

# Run Claude Code in each worktree with same requirements
# Compare implementations and choose the best approach
```

## Troubleshooting

### Common Issues

#### Issue: "fatal: '<path>' already exists"
**Solution:**
```bash
rm -rf <path>
git worktree add <path> <branch>
```

#### Issue: Cannot remove worktree (uncommitted changes)
**Solution:**
```bash
git worktree remove --force <path>
```

#### Issue: Branch already checked out in another worktree
**Solution:**
```bash
# Create a new branch from the existing one
git worktree add <path> -b <new-branch> <existing-branch>
```

#### Issue: Worktree references are broken
**Solution:**
```bash
git worktree repair
```

### Performance Considerations

#### Disk Space:
- Each worktree duplicates working files
- Large repositories = significant disk usage
- Monitor available space

#### IDE/Editor Performance:
- Multiple IDE instances may impact performance
- Consider lightweight editors for some worktrees
- Adjust IDE settings for better resource usage

### Recovery Scenarios

#### Lost Worktree Directory:
```bash
# Worktree directory was accidentally deleted
git worktree prune              # Clean up references
git worktree add <path> <branch>  # Recreate
```

#### Corrupted Worktree:
```bash
git worktree remove --force <path>
git worktree add <path> <branch>
```

## Real-World Examples

### Scenario 1: Feature Development Team

**Setup:**
```bash
# Main features
git worktree add ../worktrees/user-auth feature/user-authentication
git worktree add ../worktrees/payment feature/payment-integration
git worktree add ../worktrees/analytics feature/analytics-dashboard

# Bug fixes
git worktree add ../worktrees/hotfix hotfix/security-patches
```

**Workflow:**
- 3 Claude Code sessions for main features
- 1 Claude Code session for urgent bug fixes
- Daily integration meetings to coordinate
- Weekly cleanup and branch merging

### Scenario 2: Rapid Prototyping

**Setup:**
```bash
# Multiple architecture approaches
git worktree add ../prototypes/microservices experiment/microservices-arch
git worktree add ../prototypes/monolith experiment/monolith-arch  
git worktree add ../prototypes/serverless experiment/serverless-arch
```

**Workflow:**
- Each Claude agent implements the same requirements differently
- Compare performance, maintainability, and complexity
- Choose best approach for production

### Scenario 3: Code Review and Testing

**Setup:**
```bash
# Main development
git worktree add ../review/main-work main

# Feature under review
git worktree add ../review/feature-work feature/new-api

# Testing environment
git worktree add ../review/test-work test/integration-tests
```

**Workflow:**
- Review changes in isolation
- Test features without affecting main development
- Easy comparison between versions

## Conclusion

Git worktrees represent a fundamental shift in how we approach software development with AI agents. By enabling true parallel development, they unlock the full potential of tools like Claude Code.

### Key Takeaways:

1. **Parallel > Serial**: Multiple concurrent development streams increase productivity
2. **Isolation = Safety**: Separated contexts prevent agent interference  
3. **Flexibility**: Easy experimentation without risk to main development
4. **Scalability**: Architecture that grows with team and project needs

### Getting Started:

1. Experiment with basic worktree commands
2. Set up your first parallel Claude Code sessions
3. Develop custom scripts for your workflow
4. Gradually expand to more complex parallel development patterns

The future of software development is parallel, and git worktrees are the foundation that makes it possible.

---

*This guide represents current best practices as of 2025. Git worktrees and Claude Code are actively evolving, so check the latest documentation for updates.*