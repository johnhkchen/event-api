#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import { simpleGit } from 'simple-git';
import type { KanbanBoard, Task, AgentInfo, AgentSummary } from './types.js';
import { WorkspaceValidator } from './workspace-validator.js';
import { AgentStateManager } from './agent-state-manager.js';
import { AgentAssignmentValidator } from './agent-assignment-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const KANBAN_FILE = join(PROJECT_ROOT, 'kanban.yaml');
const AGENTS_DIR = join(PROJECT_ROOT, 'agents');

// Initialize git
const git = simpleGit(PROJECT_ROOT);

// Ensure agents directory exists
if (!existsSync(AGENTS_DIR)) {
  mkdirSync(AGENTS_DIR, { recursive: true });
}

class AgentManager {
  private kanban: KanbanBoard;
  public stateManager: AgentStateManager;
  public assignmentValidator: AgentAssignmentValidator;

  constructor() {
    this.kanban = {} as KanbanBoard;
    this.stateManager = new AgentStateManager({
      kanbanPath: KANBAN_FILE,
      agentsDir: AGENTS_DIR,
      enableBackgroundMonitoring: false // Disable for now to avoid conflicts
    });
    this.assignmentValidator = new AgentAssignmentValidator({
      kanbanPath: KANBAN_FILE,
      agentsDir: AGENTS_DIR
    });
    this.loadKanban();
  }

  private loadKanban(): void {
    try {
      const content = readFileSync(KANBAN_FILE, 'utf8');
      this.kanban = yaml.load(content) as KanbanBoard;
    } catch (error) {
      console.error(chalk.red('Failed to load kanban.yaml:'), error);
      process.exit(1);
    }
  }

  private saveKanban(): void {
    try {
      const content = yaml.dump(this.kanban, { 
        indent: 2,
        lineWidth: 120,
        noRefs: true 
      });
      writeFileSync(KANBAN_FILE, content, 'utf8');
      this.kanban.metadata.last_updated = new Date().toISOString().split('T')[0];
    } catch (error) {
      console.error(chalk.red('Failed to save kanban.yaml:'), error);
      process.exit(1);
    }
  }

  private log(message: string): void {
    console.log(chalk.blue('[AGENT-MANAGER]'), message);
  }

  private success(message: string): void {
    console.log(chalk.green('[SUCCESS]'), message);
  }

  private warn(message: string): void {
    console.log(chalk.yellow('[WARN]'), message);
  }

  private error(message: string): void {
    console.log(chalk.red('[ERROR]'), message);
  }

  async getNextAvailableAgent(): Promise<string | null> {
    this.log('Finding next available agent using state manager...');
    
    try {
      const agentId = await this.stateManager.getNextAvailableAgent();
      
      if (agentId) {
        this.log(`State manager found available agent: ${agentId}`);
        return agentId;
      } else {
        this.error('All agent slots are occupied. Use "status" command to see active agents.');
        return null;
      }
    } catch (error) {
      this.error(`State manager error: ${error}`);
      
      // Fallback to legacy logic if state manager fails
      this.warn('Falling back to legacy agent detection...');
      return await this.getNextAvailableAgentLegacy();
    }
  }

  // Fallback method (renamed from original)
  private async getNextAvailableAgentLegacy(): Promise<string | null> {
    // Step 1: Check for explicitly available agents in kanban
    for (const [agentId, status] of Object.entries(this.kanban.agents)) {
      if (status.status === 'available' && !status.current_task) {
        this.log(`Found available agent: ${agentId}`);
        return agentId;
      }
    }
    
    // Step 2: Check for agents that can be reassigned (cleanup inconsistencies)
    for (let i = 1; i <= this.kanban.metadata.max_agents; i++) {
      const agentId = `agent-${i.toString().padStart(3, '0')}`;
      
      if (await this.canReassignAgent(agentId)) {
        this.log(`Agent ${agentId} can be reassigned`);
        return agentId;
      }
    }
    
    // Step 3: Look for agents with no current task but marked as working (stale state)
    for (const [agentId, status] of Object.entries(this.kanban.agents)) {
      if (status.status === 'working' && !status.current_task) {
        this.warn(`Found agent ${agentId} in working state but no current task - reassigning`);
        return agentId;
      }
    }
    
    this.error('All agent slots are occupied with active work. Use "status" command to see active agents.');
    return null;
  }

  private async canReassignAgent(agentId: string): Promise<boolean> {
    const agentStatus = this.kanban.agents[agentId];
    
    // Agent doesn't exist in kanban - can use
    if (!agentStatus) {
      this.log(`Agent ${agentId} not in kanban - available`);
      return true;
    }
    
    // Agent is explicitly available - can use
    if (agentStatus.status === 'available') {
      this.log(`Agent ${agentId} marked as available`);
      return true;
    }
    
    // Agent has no current task - can reassign
    if (!agentStatus.current_task) {
      this.log(`Agent ${agentId} has no current task - can reassign`);
      return true;
    }
    
    // Check if worktree actually exists for working agents
    if (agentStatus.status === 'working') {
      const worktreePath = `./agents/${agentId}`;
      const absolutePath = resolve(PROJECT_ROOT, worktreePath);
      
      try {
        const worktrees = await git.raw(['worktree', 'list']);
        if (!worktrees.includes(absolutePath) && !worktrees.includes(worktreePath)) {
          this.warn(`Agent ${agentId} marked as working but no worktree exists - can reassign`);
          return true;
        }
      } catch (error) {
        this.warn(`Could not check worktrees for ${agentId}: ${error}`);
        return false;
      }
    }
    
    return false;
  }

  getNextTask(): Task | null {
    const backlogTasks = this.kanban.tasks.backlog;
    if (backlogTasks.length === 0) {
      return null;
    }

    // Sort by priority and return first task
    const priorityOrder = this.kanban.assignment_rules.priority_order;
    const sortedTasks = backlogTasks.sort((a, b) => {
      const aPriority = priorityOrder.indexOf(a.priority);
      const bPriority = priorityOrder.indexOf(b.priority);
      return aPriority - bPriority;
    });

    return sortedTasks[0];
  }

  async getCurrentAgentId(): Promise<string | null> {
    // Step 1: Try WORKSPACE_DIR first (most reliable for justfile context)
    const workspaceDir = process.env.WORKSPACE_DIR;
    if (workspaceDir) {
      const agentMatch = workspaceDir.match(/agents\/(agent-\d{3})$/);
      if (agentMatch) {
        const agentId = agentMatch[1];
        // Validate that this agent workspace is properly set up
        if (await this.validateAgentContext(agentId, workspaceDir)) {
          return agentId;
        }
      }
    }
    
    // Step 2: Validate current directory against active worktrees
    const currentDir = process.env.INIT_CWD || process.env.PWD || process.cwd();
    return await this.detectAgentFromWorktree(currentDir);
  }

  private async validateAgentContext(agentId: string, workspaceDir: string): Promise<boolean> {
    try {
      // Check if workspace has proper agent files
      const agentIdFile = join(workspaceDir, '.agent-id');
      if (!existsSync(agentIdFile)) {
        return false;
      }
      
      // Verify agent ID matches
      const fileAgentId = readFileSync(agentIdFile, 'utf8').trim();
      if (fileAgentId !== agentId) {
        return false;
      }
      
      // Check that worktree actually exists in git
      const worktrees = await git.raw(['worktree', 'list']);
      const absolutePath = resolve(workspaceDir);
      return worktrees.includes(absolutePath) || worktrees.includes(workspaceDir);
      
    } catch (error) {
      return false;
    }
  }

  private async detectAgentFromWorktree(currentDir: string): Promise<string | null> {
    try {
      // Method 1: Extract from directory path
      const pathMatch = currentDir.match(/agents\/(agent-\d{3})/);
      if (pathMatch) {
        const agentId = pathMatch[1];
        
        // Validate with .agent-id file if it exists
        const agentIdFile = join(currentDir, '.agent-id');
        if (existsSync(agentIdFile)) {
          const fileAgentId = readFileSync(agentIdFile, 'utf8').trim();
          if (fileAgentId === agentId) {
            return agentId;
          }
        }
        
        // Validate against git worktrees
        const worktrees = await git.raw(['worktree', 'list']);
        const absolutePath = resolve(currentDir);
        if (worktrees.includes(absolutePath) || worktrees.includes(currentDir)) {
          return agentId;
        }
      }
      
      // Method 2: Check git worktree list for exact match
      const worktrees = await git.raw(['worktree', 'list']);
      const lines = worktrees.split('\n');
      for (const line of lines) {
        const absolutePath = resolve(currentDir);
        if (line.includes(absolutePath) || line.includes(currentDir)) {
          const worktreeMatch = line.match(/agents\/(agent-\d{3})/);
          if (worktreeMatch) {
            return worktreeMatch[1];
          }
        }
      }
      
      // Method 3: Check .agent/status file as fallback
      const statusFile = join(currentDir, '.agent', 'status');
      if (existsSync(statusFile)) {
        const content = readFileSync(statusFile, 'utf8');
        const match = content.match(/AGENT_ID=(.+)/);
        if (match) {
          return match[1].trim();
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  private async isBranchInUseByOtherAgent(branchName: string, currentAgentId: string): Promise<boolean> {
    try {
      const worktrees = await git.raw(['worktree', 'list']);
      const worktreeLines = worktrees.split('\n');
      
      for (const line of worktreeLines) {
        if (line.includes(branchName)) {
          // Extract agent ID from worktree path
          const agentMatch = line.match(/agents\/(agent-\d{3})/);
          if (agentMatch && agentMatch[1] !== currentAgentId) {
            this.warn(`Branch ${branchName} is in use by ${agentMatch[1]}`);
            return true;
          }
        }
      }
      return false;
    } catch (error) {
      // If we can't check, assume it's in use to be safe
      return true;
    }
  }

  private async commitUncommittedChanges(workspacePath: string, agentId: string): Promise<void> {
    try {
      const agentGit = simpleGit(workspacePath);
      const status = await agentGit.status();
      
      if (status.files.length > 0) {
        this.log(`Committing ${status.files.length} uncommitted changes for ${agentId}`);
        
        // Add all changes
        await agentGit.add('.');
        
        // Create commit with task context
        const taskInfo = await this.getTaskInfoFromWorkspace(workspacePath);
        const commitMessage = taskInfo 
          ? `Auto-commit before cleanup - ${taskInfo.id}: ${taskInfo.title}

🤖 Generated with Claude Code
Co-Authored-By: Claude <noreply@anthropic.com>`
          : `Auto-commit before cleanup - ${agentId}

🤖 Generated with Claude Code
Co-Authored-By: Claude <noreply@anthropic.com>`;
        
        await agentGit.commit(commitMessage);
        this.success(`Auto-committed ${status.files.length} changes for ${agentId}`);
      } else {
        this.log(`No uncommitted changes found for ${agentId}`);
      }
    } catch (error) {
      this.warn(`Failed to commit changes for ${agentId}: ${error}`);
      throw new Error(`Cannot cleanup agent ${agentId} - failed to preserve uncommitted changes`);
    }
  }

  private async getBranchInfo(workspacePath: string, agentId: string): Promise<{branchName: string, taskId: string | null}> {
    try {
      const agentGit = simpleGit(workspacePath);
      const branchName = (await agentGit.raw(['branch', '--show-current'])).trim();
      
      // Get task ID from workspace or kanban
      const taskInfo = await this.getTaskInfoFromWorkspace(workspacePath);
      const taskId = taskInfo?.id || this.kanban.agents[agentId]?.current_task || null;
      
      return { branchName, taskId };
    } catch (error) {
      this.warn(`Could not get branch info for ${agentId}: ${error}`);
      return { branchName: 'unknown', taskId: null };
    }
  }

  private async removeWorktreeSafely(worktreePath: string, absoluteWorktreePath: string, agentId: string): Promise<void> {
    try {
      // Try graceful removal first
      await git.raw(['worktree', 'remove', absoluteWorktreePath]);
      this.success(`Removed worktree ${absoluteWorktreePath}`);
    } catch (error) {
      this.warn(`Graceful worktree removal failed: ${error}`);
      this.log(`Attempting force removal for ${agentId}`);
      
      try {
        await git.raw(['worktree', 'remove', absoluteWorktreePath, '--force']);
        this.success(`Force removed worktree ${absoluteWorktreePath}`);
      } catch (forceError) {
        throw new Error(`Failed to remove worktree ${absoluteWorktreePath}: ${forceError}`);
      }
    }
  }

  private async cleanupBranchSafely(branchInfo: {branchName: string, taskId: string | null}, agentId: string): Promise<void> {
    const { branchName, taskId } = branchInfo;
    
    if (!branchName || branchName === 'unknown' || branchName === 'main') {
      this.log(`Skipping branch cleanup for ${agentId} - no branch or on main`);
      return;
    }
    
    try {
      // Check if branch is in use by other agents
      const inUseByOther = await this.isBranchInUseByOtherAgent(branchName, agentId);
      if (inUseByOther) {
        this.warn(`Branch ${branchName} is in use by other agents, keeping it`);
        return;
      }
      
      // Check if branch is merged with main
      const isMerged = await this.isBranchMerged(branchName);
      if (!isMerged) {
        this.warn(`Branch ${branchName} is not merged with main - keeping for safety`);
        this.log(`To delete manually after merging: git branch -D ${branchName}`);
        return;
      }
      
      // Safe to delete - branch is merged and not in use
      await git.raw(['branch', '-d', branchName]);
      this.success(`Deleted merged branch ${branchName} (was owned by ${agentId})`);
      
    } catch (error) {
      this.warn(`Could not cleanup branch ${branchName}: ${error}`);
    }
  }

  private async isBranchMerged(branchName: string): Promise<boolean> {
    try {
      // Check if branch is merged into main
      const mergedBranches = await git.raw(['branch', '--merged', 'main']);
      return mergedBranches.includes(branchName) || mergedBranches.includes(`  ${branchName}`);
    } catch (error) {
      // If we can't check, assume not merged for safety
      this.warn(`Could not check if branch ${branchName} is merged: ${error}`);
      return false;
    }
  }

  private async getTaskInfoFromWorkspace(workspacePath: string): Promise<{id: string, title: string} | null> {
    try {
      const taskFile = join(workspacePath, 'TASK.md');
      if (!existsSync(taskFile)) {
        return null;
      }
      
      const taskContent = readFileSync(taskFile, 'utf8');
      const titleMatch = taskContent.match(/# Task: (.+)/);
      const taskIdMatch = taskContent.match(/\*\*Task ID:\*\* (.+)/);
      
      if (taskIdMatch) {
        return {
          id: taskIdMatch[1].trim(),
          title: titleMatch?.[1]?.trim() || 'Unknown Task'
        };
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  private async updateAgentStatus(agentId: string, taskId: string, status: 'working' | 'available' = 'working'): Promise<void> {
    try {
      // Use state manager for atomic state transitions
      const reason = status === 'working' ? `Task assignment: ${taskId}` : 'Task completion';
      const result = await this.stateManager.transitionAgentState(agentId, status, taskId, reason);
      
      if (!result.valid) {
        this.warn(`State transition validation failed for ${agentId}:`);
        result.errors.forEach(error => this.warn(`  - ${error}`));
        
        // Fall back to legacy update but with warnings
        this.warn('Falling back to legacy status update');
        await this.updateAgentStatusLegacy(agentId, taskId, status);
      } else {
        // Reload kanban to reflect state manager changes
        this.loadKanban();
        this.success(`Agent ${agentId} state transition successful: ${status}${taskId ? ` (task: ${taskId})` : ''}`);
      }
    } catch (error) {
      this.error(`State manager transition failed: ${error}`);
      this.warn('Falling back to legacy status update');
      await this.updateAgentStatusLegacy(agentId, taskId, status);
    }
  }

  // Legacy method for fallback
  private async updateAgentStatusLegacy(agentId: string, taskId: string, status: 'working' | 'available' = 'working'): Promise<void> {
    if (!this.kanban.agents[agentId]) {
      this.kanban.agents[agentId] = {
        status: 'available',
        current_task: null,
        worktree: null,
        last_active: null
      };
    }

    const updatedStatus = {
      status,
      current_task: status === 'working' ? taskId : null,
      worktree: status === 'working' ? `./agents/${agentId}` : null,
      last_active: new Date().toISOString()
    };
    
    this.kanban.agents[agentId] = updatedStatus;
    this.saveKanban();
    
    // Log the status change for debugging
    this.log(`Agent ${agentId} status updated: ${status}${taskId ? ` (task: ${taskId})` : ''}`);
  }

  private moveTaskToInProgress(task: Task, agentId: string): void {
    // Remove from backlog
    const backlogIndex = this.kanban.tasks.backlog.findIndex(t => t.id === task.id);
    if (backlogIndex !== -1) {
      this.kanban.tasks.backlog.splice(backlogIndex, 1);
    }

    // Add to in_progress with agent assignment
    const updatedTask = {
      ...task,
      assignee: agentId,
      started: new Date().toISOString()
    };
    this.kanban.tasks.in_progress.push(updatedTask);

    this.saveKanban();
  }

  private async createAgentWorkspace(agentId: string, task: Task): Promise<void> {
    const worktreePath = `./agents/${agentId}`;
    const branchName = `task/${task.id}`;
    
    this.log(`Creating workspace for ${agentId} on task ${task.id}`);
    
    try {
      // Step 1: Handle existing worktree
      const worktrees = await git.raw(['worktree', 'list']);
      const absoluteWorktreePath = resolve(PROJECT_ROOT, worktreePath);
      
      if (worktrees.includes(absoluteWorktreePath) || worktrees.includes(worktreePath)) {
        this.log(`Worktree ${worktreePath} already exists, removing...`);
        try {
          await git.raw(['worktree', 'remove', worktreePath, '--force']);
          this.success(`Removed existing worktree ${worktreePath}`);
        } catch (error) {
          this.warn(`Could not remove existing worktree: ${error}`);
          // Try with absolute path
          try {
            await git.raw(['worktree', 'remove', absoluteWorktreePath, '--force']);
            this.success(`Removed existing worktree ${absoluteWorktreePath}`);
          } catch (error2) {
            this.warn(`Could not remove worktree with absolute path either: ${error2}`);
          }
        }
      }
      
      // Step 2: Handle existing branch intelligently
      let finalBranchName = branchName;
      let shouldCreateNewBranch = true;
      
      try {
        const branches = await git.raw(['branch', '-a']);
        if (branches.includes(branchName) || branches.includes(`  ${branchName}`)) {
          this.log(`Branch ${branchName} already exists`);
          
          // Check if branch is in use by another agent
          const inUseByOther = await this.isBranchInUseByOtherAgent(branchName, agentId);
          
          if (!inUseByOther) {
            this.log(`Branch ${branchName} is not in use, reusing it`);
            shouldCreateNewBranch = false;
          } else {
            // Generate alternative branch name
            let counter = 1;
            let altBranchName = `${branchName}-${counter}`;
            while (branches.includes(altBranchName) || branches.includes(`  ${altBranchName}`)) {
              counter++;
              altBranchName = `${branchName}-${counter}`;
            }
            finalBranchName = altBranchName;
            this.log(`Branch ${branchName} in use, using ${finalBranchName} instead`);
          }
        }
      } catch (error) {
        this.warn(`Could not check existing branches: ${error}`);
      }
      
      // Step 3: Create worktree with appropriate branch strategy
      try {
        if (shouldCreateNewBranch) {
          // Create worktree with new branch
          await git.raw(['worktree', 'add', worktreePath, '-b', finalBranchName]);
          this.success(`Created worktree at ${worktreePath} with new branch ${finalBranchName}`);
        } else {
          // Create worktree using existing branch
          await git.raw(['worktree', 'add', worktreePath, finalBranchName]);
          this.success(`Created worktree at ${worktreePath} using existing branch ${finalBranchName}`);
        }
      } catch (error) {
        // Final fallback: force cleanup and retry
        this.warn(`Worktree creation failed: ${error}`);
        this.log(`Attempting force cleanup and retry...`);
        
        try {
          // Force cleanup any remnants
          await git.raw(['worktree', 'remove', worktreePath, '--force']).catch(() => {});
          await git.raw(['branch', '-D', finalBranchName]).catch(() => {});
          
          // Retry with fresh branch
          const timestamp = Date.now().toString().slice(-6);
          const fallbackBranch = `task/${task.id}-${timestamp}`;
          await git.raw(['worktree', 'add', worktreePath, '-b', fallbackBranch]);
          finalBranchName = fallbackBranch;
          this.success(`Created worktree at ${worktreePath} with fallback branch ${finalBranchName}`);
        } catch (finalError) {
          throw new Error(`All worktree creation attempts failed: ${finalError}`);
        }
      }
      
      // Step 4: Setup agent workspace files
      const agentDir = resolve(PROJECT_ROOT, worktreePath);
      
      // Create agent ID file
      writeFileSync(join(agentDir, '.agent-id'), agentId);
      
      // Create agent directory
      const agentConfigDir = join(agentDir, '.agent');
      if (!existsSync(agentConfigDir)) {
        mkdirSync(agentConfigDir, { recursive: true });
      }
      
      // Create TASK.md
      this.createTaskFile(agentDir, task, agentId);
      
      // Create dynamic justfile
      this.createDynamicJustfile(agentDir, agentId);
      
      // Create agent status file
      const statusContent = [
        `AGENT_ID=${agentId}`,
        `TASK_ID=${task.id}`,
        `STATUS=active`,
        `STARTED=${new Date().toISOString()}`,
        `WORKTREE_PATH=${worktreePath}`,
        `BRANCH=${finalBranchName}`
      ].join('\n');
      
      writeFileSync(join(agentConfigDir, 'status'), statusContent);
      
      // Update kanban board
      this.updateAgentStatus(agentId, task.id);
      this.moveTaskToInProgress(task, agentId);
      
      this.success(`Agent workspace ready at ${worktreePath}`);
      this.log(`Agent ID: ${agentId}`);
      this.log(`Task: ${task.id}`);
      this.log(`Branch: ${finalBranchName}`);
      
    } catch (error) {
      this.error(`Failed to create workspace: ${error}`);
      throw error;
    }
  }

  private createDynamicJustfile(agentDir: string, agentId: string): void {
    const justfileContent = `# Dynamic Agent Workspace Commands
# ⚠️  WORKSPACE ISOLATION: Only run agent-specific commands from this directory

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

# Mark current task as complete and move to review
complete:
    @echo "🎉 Marking task as complete..."
    WORKSPACE_DIR="{{justfile_directory()}}" npm --prefix ../.. run agent:dev complete-task

# Alias for complete
done:
    @just complete

# Clean up this agent workspace (self-cleanup)
cleanup:
    @echo "🧹 Cleaning up ${agentId} workspace..."
    @echo "⚠️  This will remove your workspace and commit any unsaved changes"
    @echo "Current directory: {{justfile_directory()}}"
    npm --prefix ../.. run agent:dev cleanup

# Request reassignment to different task
reassign:
    @echo "🔄 Requesting task reassignment..."
    @echo "TODO: Implement task reassignment workflow"

# GUARDIAN COMMANDS - Prevent dangerous project-level commands in agent workspace
# These commands could corrupt your workspace if run from here

# Guardian: Block agent assignment from agent workspace
agent1:
    @echo "❌ DANGEROUS: 'just agent1' should NOT be run from agent workspace!"
    @echo ""
    @echo "🚨 WORKSPACE ISOLATION VIOLATION:"
    @echo "   Running agent assignment from within an agent workspace can corrupt your environment"
    @echo ""
    @echo "💡 CORRECT USAGE:"
    @echo "   1. Navigate to project root:"
    @echo "      cd ../.."
    @echo "   2. Then run agent commands:"
    @echo "      just agent1"
    @echo ""
    @echo "🛡️  PROTECTION: This command is blocked to prevent workspace corruption"
    @exit 1

agent2:
    @echo "❌ DANGEROUS: 'just agent2' should NOT be run from agent workspace!"
    @echo ""
    @echo "🚨 WORKSPACE ISOLATION VIOLATION:"
    @echo "   Running agent assignment from within an agent workspace can corrupt your environment"
    @echo ""
    @echo "💡 CORRECT USAGE:"
    @echo "   1. Navigate to project root:"
    @echo "      cd ../.."
    @echo "   2. Then run agent commands:"
    @echo "      just agent2"
    @echo ""
    @echo "🛡️  PROTECTION: This command is blocked to prevent workspace corruption"
    @exit 1

agent3:
    @echo "❌ DANGEROUS: 'just agent3' should NOT be run from agent workspace!"
    @echo ""
    @echo "🚨 WORKSPACE ISOLATION VIOLATION:"
    @echo "   Running agent assignment from within an agent workspace can corrupt your environment"
    @echo ""
    @echo "💡 CORRECT USAGE:"
    @echo "   1. Navigate to project root:"
    @echo "      cd ../.."
    @echo "   2. Then run agent commands:"
    @echo "      just agent3"
    @echo ""
    @echo "🛡️  PROTECTION: This command is blocked to prevent workspace corruption"
    @exit 1

# Guardian: Block reset from agent workspace
reset:
    @echo "❌ CRITICAL: 'just reset' should NOT be run from agent workspace!"
    @echo ""
    @echo "🚨 CRITICAL SAFETY VIOLATION:"
    @echo "   This command resets ALL agents and would destroy your current workspace"
    @echo ""
    @echo "💡 CORRECT USAGE:"
    @echo "   1. Navigate to project root:"
    @echo "      cd ../.."
    @echo "   2. Complete your work first:"
    @echo "      just complete  (from your agent workspace)"
    @echo "   3. Then run reset from project root:"
    @echo "      just reset"
    @echo ""
    @echo "🛡️  PROTECTION: This command is blocked to prevent accidental workspace destruction"
    @exit 1

# Guardian: Block start-all from agent workspace
start-all:
    @echo "❌ DANGEROUS: 'just start-all' should NOT be run from agent workspace!"
    @echo ""
    @echo "🚨 WORKSPACE ISOLATION VIOLATION:"
    @echo "   This command manages all agents and should only run from project root"
    @echo ""
    @echo "💡 CORRECT USAGE:"
    @echo "   1. Navigate to project root:"
    @echo "      cd ../.."
    @echo "   2. Then run:"
    @echo "      just start-all"
    @echo ""
    @echo "🛡️  PROTECTION: This command is blocked to prevent workspace conflicts"
    @exit 1

# Guardian: Block assign from agent workspace (use project-level assignment)
assign:
    @echo "❌ WARNING: 'just assign' should be used carefully from agent workspace"
    @echo ""
    @echo "⚠️  POTENTIAL ISSUE:"
    @echo "   You're already in an agent workspace (${agentId})"
    @echo "   Assignment might conflict with your current work"
    @echo ""
    @echo "💡 RECOMMENDED ACTIONS:"
    @echo "   1. Complete your current task first:"
    @echo "      just complete"
    @echo "   2. Navigate to project root for new assignment:"
    @echo "      cd ../.."
    @echo "      just agent1  # or agent2, agent3"
    @echo ""
    @echo "🔄 Or continue with current task:"
    @echo "   just work"
    @echo ""
    @read -p "Are you sure you want to proceed with assignment? (yes/no): " confirm; \\
    if [ "$$confirm" = "yes" ]; then \\
        echo "Proceeding with caution..."; \\
        npm --prefix ../.. run agent:dev start; \\
    else \\
        echo "❌ Assignment cancelled - wise choice!"; \\
    fi

# Show this help and current dynamic assignment
help:
    @echo "🤖 Agent Workspace Commands (${agentId}):"
    @echo ""
    @echo "Work Commands:"
    @echo "  just work      🚀 Start work session (shows current assignment)"
    @echo "  just complete  ✅ Mark current task complete"
    @echo "  just done      ✅ Mark current task complete (alias)"
    @echo "  just cleanup   🧹 Clean up this agent workspace"
    @echo ""
    @echo "Info Commands:"
    @echo "  just my-id     🆔 Show agent identity"
    @echo "  just status    📊 Show kanban board status"
    @echo "  just reassign  🔄 Request different task"
    @echo ""
    @echo "🛡️  Guardian Commands (BLOCKED for safety):"
    @echo "  just agent1/2/3  ❌ Blocked - run from project root"
    @echo "  just reset       ❌ Blocked - run from project root"
    @echo "  just start-all   ❌ Blocked - run from project root"
    @echo ""
    @echo "🎯 Your role and scope are determined dynamically by kanban.yaml!"
    @echo "⚠️  WORKSPACE ISOLATION: Stay within your agent boundary for safety"

# Default shows current assignment
default:
    @just work
`;
    
    writeFileSync(join(agentDir, 'justfile'), justfileContent);
  }

  private createTaskFile(agentDir: string, task: Task, agentId: string): void {
    const taskContent = `# Task: ${task.title || 'Unnamed Task'}
**Task ID:** ${task.id}  
**Priority:** ${task.priority || 'normal'}  
**Assignee:** ${agentId}  
**Created:** ${new Date().toISOString()}

## Objective
${task.description || 'No description provided'}

## Requirements
${task.requirements && task.requirements.length > 0 ? task.requirements.map(req => `- [ ] ${req}`).join('\n') : '- [ ] Define requirements'}

## Files to Focus On
${task.files && task.files.length > 0 ? task.files.map(file => `- ${file}`).join('\n') : '- No specific files identified'}

## Dependencies
${task.dependencies && task.dependencies.length > 0 ? task.dependencies.map(dep => `- ${dep}`).join('\n') : 'None'}

## Labels
${task.labels && task.labels.length > 0 ? task.labels.join(', ') : 'No labels'}

## Status
- [x] Task assigned and workspace created
- [ ] Development started
- [ ] Implementation complete
- [ ] Tests written
- [ ] Code reviewed
- [ ] Task complete

## Notes
Auto-generated from kanban.yaml on ${new Date().toISOString()}
`;
    
    writeFileSync(join(agentDir, 'TASK.md'), taskContent);
  }

  async startAgent(): Promise<void> {
    // CRITICAL: Validate this command runs from project root only
    WorkspaceValidator.validateCommand('project', 'start');
    
    this.log('Starting new agent...');
    
    // Get next available agent
    const agentId = await this.getNextAvailableAgent();
    if (!agentId) {
      return;
    }
    
    // Get next task
    const task = this.getNextTask();
    if (!task) {
      this.error('No tasks available in backlog');
      return;
    }
    
    // Validate assignment before proceeding
    this.log(`Validating assignment: ${agentId} → ${task.id}`);
    try {
      const validation = await this.assignmentValidator.validateAssignment(agentId, task.id);
      
      if (!validation.valid) {
        this.error(`Assignment validation failed (score: ${validation.assignmentScore})`);
        validation.errors.forEach(error => {
          this.error(`  ${error.code}: ${error.message}`);
        });
        
        if (validation.warnings.length > 0) {
          this.warn('Warnings:');
          validation.warnings.forEach(warning => {
            this.warn(`  ${warning.code}: ${warning.message}`);
          });
        }
        
        this.error('Cannot proceed with assignment due to validation errors');
        return;
      }
      
      if (validation.warnings.length > 0) {
        this.warn(`Assignment has ${validation.warnings.length} warnings:`);
        validation.warnings.forEach(warning => {
          this.warn(`  ${warning.code}: ${warning.message}`);
        });
      }
      
      this.success(`Assignment validation passed (score: ${validation.assignmentScore}, confidence: ${Math.round(validation.confidence * 100)}%)`);
      
      if (validation.recommendations.length > 0) {
        this.log('Recommendations:');
        validation.recommendations.forEach(rec => {
          this.log(`  ${rec}`);
        });
      }
    } catch (error) {
      this.error(`Assignment validation error: ${error}`);
      this.warn('Proceeding with assignment despite validation failure');
    }
    
    // Create workspace
    await this.createAgentWorkspace(agentId, task);
    
    // Print startup instructions
    console.log('');
    console.log('================================================================');
    console.log(chalk.bold.cyan('🤖 AGENT STARTUP COMPLETE'));
    console.log('================================================================');
    console.log(`Agent ID: ${chalk.yellow(agentId)}`);
    console.log(`Task: ${chalk.yellow(task.id)}`);
    console.log(`Workspace: ${resolve(PROJECT_ROOT, `./agents/${agentId}`)}`);
    console.log('');
    console.log(chalk.bold('COPY THIS MESSAGE TO CLAUDE CODE:'));
    console.log('----------------------------------------------------------------');
    console.log(chalk.green(`I am ${agentId} starting work on ${task.id}.`));
    console.log('');
    console.log(chalk.green('First, let me run the startup protocol:'));
    console.log(chalk.green('npm run agent startup'));
    console.log('----------------------------------------------------------------');
    console.log('');
    console.log(chalk.bold('The agent can now begin work!'));
  }

  async showStatus(): Promise<void> {
    this.log('Agent Status Overview');
    console.log('');
    
    // Show git worktrees
    console.log('📂 Active Worktrees:');
    try {
      const worktrees = await git.raw(['worktree', 'list']);
      const agentWorktrees = worktrees.split('\n').filter(line => line.includes('/agents/agent-'));
      if (agentWorktrees.length > 0) {
        agentWorktrees.forEach(line => console.log(`  ${line}`));
      } else {
        console.log('  No agent worktrees found');
      }
    } catch (error) {
      console.log('  Error checking worktrees');
    }
    console.log('');
    
    // Show kanban status
    console.log('📋 Kanban Board Status:');
    console.log(`  Backlog: ${chalk.yellow(this.kanban.tasks.backlog.length)} tasks`);
    console.log(`  Todo: ${chalk.blue(this.kanban.tasks.todo.length)} tasks`);
    console.log(`  In Progress: ${chalk.green(this.kanban.tasks.in_progress.length)} tasks`);
    console.log(`  Review: ${chalk.magenta(this.kanban.tasks.review.length)} tasks`);
    console.log(`  Done: ${chalk.gray(this.kanban.tasks.done.length)} tasks`);
    console.log('');
    
    // Show agent status
    console.log('🤖 Agent Status:');
    Object.entries(this.kanban.agents).forEach(([agentId, status]) => {
      const statusColor = status.status === 'working' ? chalk.green : 
                         status.status === 'available' ? chalk.blue : chalk.gray;
      console.log(`  ${agentId}: ${statusColor(status.status)} ${status.current_task ? `(${status.current_task})` : ''}`);
    });
  }

  async cleanupAgent(agentId?: string): Promise<void> {
    // CRITICAL: Validate cleanup location and detect dangerous cross-workspace scenarios
    const context = WorkspaceValidator.detectExecutionContext();
    
    if (!agentId) {
      // If no agent ID specified, validate we're in an agent workspace for self-cleanup
      WorkspaceValidator.validateCommand('agent', 'cleanup');
      const currentAgentId = await this.getCurrentAgentId();
      if (!currentAgentId) {
        this.error('Could not determine agent ID. Please specify agent ID.');
        return;
      }
      agentId = currentAgentId;
    } else {
      // If agent ID specified, this should run from project root
      if (context.type === 'agent' && context.agentId !== agentId) {
        this.error(`DANGER: Attempting to cleanup ${agentId} from ${context.agentId} workspace!`);
        this.error('This could corrupt your workspace. Navigate to project root first:');
        this.error('  cd ../..');
        this.error(`  npm run agent:dev cleanup ${agentId}`);
        return;
      }
    }
    
    const worktreePath = `./agents/${agentId}`;
    const absoluteWorktreePath = resolve(PROJECT_ROOT, worktreePath);
    
    this.log(`Cleaning up ${agentId}`);
    
    try {
      // Step 1: Validate workspace exists
      const worktrees = await git.raw(['worktree', 'list']);
      if (!worktrees.includes(absoluteWorktreePath) && !worktrees.includes(worktreePath)) {
        this.warn(`No worktree found for ${agentId}, updating status only`);
        this.updateAgentStatus(agentId, '', 'available');
        return;
      }
      
      // Step 2: Commit any uncommitted changes
      await this.commitUncommittedChanges(absoluteWorktreePath, agentId);
      
      // Step 3: Get branch info before cleanup
      const branchInfo = await this.getBranchInfo(absoluteWorktreePath, agentId);
      
      // Step 4: Remove worktree safely
      await this.removeWorktreeSafely(worktreePath, absoluteWorktreePath, agentId);
      
      // Step 5: Handle branch cleanup with safety checks
      await this.cleanupBranchSafely(branchInfo, agentId);
      
      // Step 6: Update kanban state only after successful cleanup
      this.updateAgentStatus(agentId, '', 'available');
      
      this.success(`Agent ${agentId} cleaned up safely`);
    } catch (error) {
      this.error(`Failed to cleanup agent ${agentId}: ${error}`);
      this.warn(`Agent ${agentId} may be in inconsistent state - manual review required`);
    }
  }

  async runStartupProtocol(): Promise<void> {
    const agentId = await this.getCurrentAgentId();
    const currentDir = process.env.WORKSPACE_DIR || process.env.INIT_CWD || process.env.PWD || process.cwd();
    
    console.log('');
    console.log(chalk.bold.cyan('🤖 CLAUDE CODE AGENT STARTUP PROTOCOL'));
    console.log('');
    
    if (!agentId) {
      this.error('Could not determine agent ID! This might not be a properly set up agent workspace.');
      console.log('Current directory:', currentDir);
      console.log('');
      console.log(chalk.yellow('💡 If you are trying to resume work in an existing worktree:'));
      console.log(chalk.yellow('   Run: npm run agent resume'));
      return;
    }
    
    // Show environment info
    console.log(chalk.bold('🔧 ENVIRONMENT CHECK'));
    console.log(`Agent ID: ${chalk.green(agentId)}`);
    console.log(`Workspace: ${currentDir}`);
    console.log(`Node.js: ${chalk.green(process.version)}`);
    console.log(`Flox: ${process.env.FLOX_ENV_DESCRIPTION ? chalk.green(process.env.FLOX_ENV_DESCRIPTION) : chalk.yellow('Not active')}`);
    console.log('');
    
    // Show task assignment
    console.log(chalk.bold('📋 TASK ASSIGNMENT'));
    const taskFile = join(currentDir, 'TASK.md');
    if (existsSync(taskFile)) {
      console.log(chalk.green('✅ Task file found: TASK.md'));
      const taskContent = readFileSync(taskFile, 'utf8');
      const titleMatch = taskContent.match(/# Task: (.+)/);
      const taskIdMatch = taskContent.match(/\*\*Task ID:\*\* (.+)/);
      
      if (titleMatch) console.log(`Title: ${titleMatch[1]}`);
      if (taskIdMatch) console.log(`Task ID: ${taskIdMatch[1]}`);
    } else {
      this.warn('No TASK.md file found');
    }
    console.log('');
    
    // Check for other agents
    console.log(chalk.bold('🔄 AGENT COORDINATION'));
    try {
      const worktrees = await git.raw(['worktree', 'list']);
      const otherAgents = worktrees.split('\n').filter(line => 
        line.includes('./agents/agent-') && !line.includes(currentDir)
      );
      
      if (otherAgents.length > 0) {
        this.warn('Other active agents detected:');
        otherAgents.forEach(line => console.log(`  ${line}`));
        console.log('');
        console.log(chalk.yellow('⚠️  Coordinate with other agents to avoid conflicts!'));
      } else {
        this.success('No other agents currently active');
      }
    } catch (error) {
      this.warn('Could not check for other agents');
    }
    console.log('');
    
    // Save agent summary
    const agentDir = join(currentDir, '.agent');
    if (!existsSync(agentDir)) {
      mkdirSync(agentDir, { recursive: true });
    }
    
    const summary: AgentSummary = {
      agent_id: agentId,
      task_id: existsSync(taskFile) ? readFileSync(taskFile, 'utf8').match(/\*\*Task ID:\*\* (.+)/)?.[1] || 'unknown' : 'unknown',
      workspace: currentDir,
      status: 'ready',
      started: new Date().toISOString(),
      last_startup: new Date().toISOString()
    };
    
    writeFileSync(join(agentDir, 'summary.json'), JSON.stringify(summary, null, 2));
    
    console.log(chalk.bold.green('🎉 Agent startup complete!'));
    console.log('');
    console.log('================================================================');
    console.log(chalk.bold('DEVELOPMENT GUIDELINES:'));
    console.log('================================================================');
    console.log(`1. Focus only on your assigned task`);
    console.log(`2. Use filesystem for persistent memory (.agent/ directory)`);
    console.log(`3. Update TASK.md checkboxes as you complete work`);
    console.log(`4. Commit frequently with descriptive messages`);
    console.log(`5. Check for other agents before modifying shared files`);
    console.log('');
    console.log(chalk.bold('HELPFUL COMMANDS:'));
    console.log('- npm run agent my-id     # Show your agent ID');
    console.log('- npm run agent status    # See all agents');
    console.log('- cat .agent/summary.json # Your agent summary');
    console.log('- cat TASK.md             # Your task details');
    console.log('');
    console.log(chalk.bold.green('🚀 Ready to code! Start with your assigned task.'));
    console.log('================================================================');
  }

  async handleAgentInstruction(): Promise<void> {
    console.log('');
    console.log(chalk.bold.cyan('🤖 CLAUDE AGENT INSTRUCTION HANDLER'));
    console.log('');

    // Try to detect which agent this is and set up the workspace
    const currentDir = process.env.WORKSPACE_DIR || process.env.INIT_CWD || process.env.PWD || process.cwd();
    
    // First, check if we're already in an agent workspace
    const currentAgentId = await this.getCurrentAgentId();
    
    if (currentAgentId) {
      // We're in an existing workspace, run startup protocol
      this.success(`Found existing agent workspace: ${currentAgentId}`);
      await this.runStartupProtocol();
      return;
    }

    // Not in a workspace, provide guidance
    this.warn('You are not currently in an agent workspace.');
    console.log('');
    console.log(chalk.yellow('💡 To set up your workspace:'));
    console.log('');
    console.log('1. If you were assigned to agent1: cd to ./agents/agent-001');
    console.log('2. If you were assigned to agent2: cd to ./agents/agent-002');  
    console.log('3. If you were assigned to agent3: cd to ./agents/agent-003');
    console.log('');
    console.log('4. Then run: npm run agent startup');
    console.log('');
    console.log(chalk.blue('Or check the setup output above to see which workspace was created.'));
  }

  async setupAgent(targetAgentId?: string): Promise<void> {
    const currentDir = process.cwd();
    let agentId = targetAgentId;
    let worktreePath: string;

    if (agentId) {
      // Specific agent requested (e.g., from just agent1)
      worktreePath = `./agents/${agentId}`;
      
      console.log('');
      console.log(chalk.bold.cyan(`🤖 AGENT ${agentId.toUpperCase()} SETUP`));
      console.log('');

      // Check if worktree already exists
      try {
        const worktrees = await git.raw(['worktree', 'list']);
        const absoluteWorktreePath = resolve(process.cwd(), worktreePath);
        const existingWorktree = worktrees.split('\n').find(line => 
          line.includes(worktreePath) || line.includes(absoluteWorktreePath)
        );

        if (existingWorktree) {
          // Worktree exists - this is a resume scenario
          this.success(`Found existing worktree for ${agentId}`);
          console.log(`Path: ${resolve(process.cwd(), worktreePath)}`);
          
          // Get current task info
          const taskInfo = this.getAgentTask(agentId);
          if (taskInfo) {
            console.log(`Current task: ${chalk.yellow(taskInfo.id)} - ${taskInfo.title}`);
          }
          
          console.log('');
          console.log(chalk.bold('🔄 RESUMING EXISTING WORK'));
          console.log(`Agent ready to work in: ${chalk.green(resolve(process.cwd(), worktreePath))}`);
          
          // Set up the environment for immediate work - no need to cd, just output the workspace info
          console.log('');
          console.log(chalk.bold('✨ EXISTING AGENT WORKSPACE READY'));
          console.log(`Agent: ${chalk.green(agentId)}`);
          if (taskInfo) {
            console.log(`Task: ${chalk.yellow(taskInfo.id)} - ${taskInfo.title}`);
          }
          console.log(`Workspace: ${chalk.green(resolve(process.cwd(), worktreePath))}`);
          console.log('');
          console.log(chalk.bold.yellow('🎯 NEXT STEPS FOR CLAUDE CODE:'));
          console.log('----------------------------------------------------------------');
          console.log(chalk.cyan(`cd ${worktreePath}`));
          console.log(chalk.cyan('cat TASK.md'));
          console.log(chalk.cyan('just work'));
          console.log('----------------------------------------------------------------');
          return;
        }
      } catch (error) {
        // Git error, continue with creation
      }

      // No existing worktree - create new one
      this.log(`Creating new workspace for ${agentId}`);
      
      // Get next task
      const task = this.getNextTask();
      if (!task) {
        this.error('No tasks available in backlog');
        return;
      }

      // Create the workspace
      await this.createAgentWorkspace(agentId, task);
      
      console.log('');
      console.log(chalk.bold('✨ NEW AGENT WORKSPACE CREATED'));
      console.log(`Agent: ${chalk.green(agentId)}`);
      console.log(`Task: ${chalk.yellow(task.id)} - ${task.title}`);
      console.log(`Workspace: ${chalk.green(resolve(process.cwd(), worktreePath))}`);
      console.log('');
      console.log(chalk.bold.yellow('🎯 NEXT STEPS FOR CLAUDE CODE:'));
      console.log('----------------------------------------------------------------');
      console.log(chalk.cyan(`cd ${worktreePath}`));
      console.log(chalk.cyan('cat TASK.md'));
      console.log(chalk.cyan('just work'));
      console.log('----------------------------------------------------------------');
      
    } else {
      this.error('No agent ID specified for setup');
    }
  }

  private getAgentTask(agentId: string): Task | null {
    // Check if agent has a current task in kanban
    const agentStatus = this.kanban.agents[agentId];
    if (agentStatus?.current_task) {
      // Find the task in in_progress
      const task = this.kanban.tasks.in_progress.find(t => t.id === agentStatus.current_task);
      if (task) return task;
    }
    return null;
  }

  async resumeAgent(): Promise<void> {
    console.log('');
    console.log(chalk.bold.cyan('🔄 AGENT RESUME PROTOCOL'));
    console.log('');

    const currentDir = process.cwd();
    console.log(`Current directory: ${currentDir}`);

    // Try to detect if we're in a worktree by looking for agent files
    const agentIdFile = join(currentDir, '.agent-id');
    const taskFile = join(currentDir, 'TASK.md');
    const statusFile = join(currentDir, '.agent', 'status');

    let agentId: string | null = null;
    let isAgentWorkspace = false;

    // Check for .agent-id file first
    if (existsSync(agentIdFile)) {
      agentId = readFileSync(agentIdFile, 'utf8').trim();
      isAgentWorkspace = true;
      this.success(`Found agent ID file: ${agentId}`);
    }

    // Check if this looks like an agent workspace
    if (existsSync(taskFile)) {
      isAgentWorkspace = true;
      this.success('Found TASK.md file');
    }

    // Check for status file
    if (existsSync(statusFile)) {
      isAgentWorkspace = true;
      this.success('Found agent status file');
      
      if (!agentId) {
        const content = readFileSync(statusFile, 'utf8');
        const match = content.match(/AGENT_ID=(.+)/);
        if (match) {
          agentId = match[1].trim();
          this.success(`Extracted agent ID from status: ${agentId}`);
        }
      }
    }

    // Check git worktree to confirm
    try {
      const worktrees = await git.raw(['worktree', 'list']);
      const currentWorktree = worktrees.split('\n').find(line => line.includes(currentDir));
      
      if (currentWorktree) {
        const worktreeMatch = currentWorktree.match(/agents\/(agent-\d{3})/);
        if (worktreeMatch) {
          const detectedAgentId = worktreeMatch[1];
          if (!agentId) {
            agentId = detectedAgentId;
          } else if (agentId !== detectedAgentId) {
            this.warn(`Agent ID mismatch: file says ${agentId}, worktree says ${detectedAgentId}`);
          }
          isAgentWorkspace = true;
          this.success(`Confirmed in git worktree: ${detectedAgentId}`);
        }
      }
    } catch (error) {
      this.warn('Could not check git worktree status');
    }

    if (!isAgentWorkspace) {
      this.error('This does not appear to be an agent workspace!');
      console.log('');
      console.log(chalk.yellow('💡 To start a new agent, run one of:'));
      console.log(chalk.yellow('   just agent1'));
      console.log(chalk.yellow('   just agent2'));  
      console.log(chalk.yellow('   just agent3'));
      return;
    }

    if (!agentId) {
      // Try to auto-detect and repair
      console.log('');
      this.warn('Could not determine agent ID, attempting to repair...');
      
      const pathMatch = currentDir.match(/agents\/(agent-\d{3})/);
      if (pathMatch) {
        agentId = pathMatch[1];
        this.log(`Auto-detected agent ID from path: ${agentId}`);
        
        // Create missing .agent-id file
        writeFileSync(agentIdFile, agentId);
        this.success('Created missing .agent-id file');
      } else {
        this.error('Cannot auto-detect agent ID from directory path');
        console.log('Expected path pattern: .../agents/agent-XXX');
        console.log(`Actual path: ${currentDir}`);
        return;
      }
    }

    // Now that we have agent ID, restore missing files if needed
    console.log('');
    console.log(chalk.bold('🛠️  WORKSPACE REPAIR'));

    // Ensure .agent-id file exists
    if (!existsSync(agentIdFile)) {
      writeFileSync(agentIdFile, agentId);
      this.success('Created .agent-id file');
    }

    // Ensure .agent directory exists
    const agentDir = join(currentDir, '.agent');
    if (!existsSync(agentDir)) {
      mkdirSync(agentDir, { recursive: true });
      this.success('Created .agent directory');
    }

    // Check/repair status file
    if (!existsSync(statusFile)) {
      // Try to get task info from TASK.md
      let taskId = 'unknown';
      if (existsSync(taskFile)) {
        const taskContent = readFileSync(taskFile, 'utf8');
        const taskIdMatch = taskContent.match(/\*\*Task ID:\*\* (.+)/);
        if (taskIdMatch) {
          taskId = taskIdMatch[1].trim();
        }
      }

      // Get branch name for more info
      let branchName = 'unknown';
      try {
        branchName = await git.raw(['branch', '--show-current']);
        branchName = branchName.trim();
      } catch (error) {
        // Ignore
      }

      const statusContent = [
        `AGENT_ID=${agentId}`,
        `TASK_ID=${taskId}`,
        `STATUS=resumed`,
        `STARTED=unknown`,
        `RESUMED=${new Date().toISOString()}`,
        `WORKTREE_PATH=${currentDir}`,
        `BRANCH=${branchName}`
      ].join('\n');
      
      writeFileSync(statusFile, statusContent);
      this.success('Created agent status file');
    }

    // Update summary
    const summaryFile = join(agentDir, 'summary.json');
    const summary = {
      agent_id: agentId,
      task_id: existsSync(taskFile) ? readFileSync(taskFile, 'utf8').match(/\*\*Task ID:\*\* (.+)/)?.[1]?.trim() || 'unknown' : 'unknown',
      workspace: currentDir,
      status: 'resumed',
      started: 'unknown',
      last_startup: new Date().toISOString(),
      resumed: new Date().toISOString()
    };
    
    writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
    this.success('Updated agent summary');

    // Show current status
    console.log('');
    console.log(chalk.bold('📋 RESUME SUMMARY'));
    console.log(`Agent ID: ${chalk.green(agentId)}`);
    console.log(`Workspace: ${currentDir}`);
    
    if (existsSync(taskFile)) {
      const taskContent = readFileSync(taskFile, 'utf8');
      const titleMatch = taskContent.match(/# Task: (.+)/);
      const taskIdMatch = taskContent.match(/\*\*Task ID:\*\* (.+)/);
      
      if (titleMatch) console.log(`Task: ${titleMatch[1]}`);
      if (taskIdMatch) console.log(`Task ID: ${taskIdMatch[1].trim()}`);
      
      console.log('');
      console.log(chalk.yellow('📄 Current Task Details:'));
      console.log('----------------------------------------');
      console.log(taskContent);
      console.log('----------------------------------------');
    }

    // Check for work in progress
    try {
      const gitStatus = await git.status();
      if (gitStatus.files.length > 0) {
        console.log('');
        console.log(chalk.yellow('🔄 Work in Progress Detected:'));
        gitStatus.files.forEach(file => {
          const status = file.index === '?' ? 'untracked' : 
                        file.index === 'M' ? 'modified' : 
                        file.index === 'A' ? 'added' : file.index;
          console.log(`  ${status}: ${file.path}`);
        });
      } else {
        console.log('');
        console.log(chalk.green('✅ Workspace is clean'));
      }
    } catch (error) {
      this.warn('Could not check git status');
    }

    console.log('');
    console.log(chalk.bold.green('🎉 Agent resume complete!'));
    console.log('');
    console.log('================================================================');
    console.log(chalk.bold('You can now continue your work where you left off.'));
    console.log('');
    console.log('HELPFUL COMMANDS:');
    console.log('- cat TASK.md                 # Review your task');
    console.log('- cat .agent/summary.json     # Agent info');
    console.log('- just status                 # See all agents');
    console.log('- git status                  # Check your changes');
    console.log('================================================================');
  }

  async resetKanban(): Promise<void> {
    this.log('Resetting kanban board...');
    
    // Move all in_progress tasks back to backlog
    const inProgressTasks = this.kanban.tasks.in_progress;
    this.kanban.tasks.backlog.unshift(...inProgressTasks.map(task => ({
      ...task,
      assignee: null as string | null,
      started: null as string | null
    })));
    
    // Clear in_progress
    this.kanban.tasks.in_progress = [];
    
    // Reset all agents to available
    Object.keys(this.kanban.agents).forEach(agentId => {
      this.kanban.agents[agentId] = {
        status: 'available',
        current_task: null,
        worktree: null,
        last_active: new Date().toISOString()
      };
    });
    
    this.saveKanban();
    this.success('Kanban board reset - all tasks moved to backlog and agents set to available');
  }

  async addTask(title: string, priority: 'critical' | 'high' | 'normal' | 'low' = 'normal', estimatedHours: number = 8): Promise<void> {
    const taskId = `TASK-${Date.now().toString().slice(-6)}`;
    
    const newTask: Task = {
      id: taskId,
      title,
      priority: priority as 'critical' | 'high' | 'normal' | 'low',
      estimated_hours: estimatedHours,
      description: `Add task description here`,
      requirements: ['Define specific requirements'],
      files: ['Specify relevant files'],
      dependencies: [],
      labels: ['auto-generated'],
      assignee: null as string | null
    };
    
    this.kanban.tasks.backlog.push(newTask);
    this.saveKanban();
    
    this.success(`Added task: ${taskId} - ${title}`);
    console.log(`Priority: ${priority}, Estimated hours: ${estimatedHours}`);
  }

  async completeCurrentTask(): Promise<void> {
    // CRITICAL: Validate this is being run from agent workspace
    WorkspaceValidator.validateCommand('agent', 'complete-task');
    
    const agentId = await this.getCurrentAgentId();
    if (!agentId) {
      this.error('Could not determine agent ID');
      return;
    }
    
    const agentStatus = this.kanban.agents[agentId];
    if (!agentStatus?.current_task) {
      this.error(`Agent ${agentId} has no current task to complete`);
      return;
    }
    
    const taskId = agentStatus.current_task;
    
    // Find task in in_progress
    const taskIndex = this.kanban.tasks.in_progress.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
      this.error(`Task ${taskId} not found in in_progress`);
      return;
    }
    
    const task = this.kanban.tasks.in_progress[taskIndex];
    
    // Move to review
    this.kanban.tasks.in_progress.splice(taskIndex, 1);
    this.kanban.tasks.review.push({
      ...task,
      completed: new Date().toISOString()
    });
    
    // Update agent status
    this.updateAgentStatus(agentId, '', 'available');
    
    this.saveKanban();
    this.success(`Task ${taskId} marked as complete and moved to review`);
    this.log(`Agent ${agentId} is now available for new tasks`);
    
    console.log('');
    console.log(chalk.bold.yellow('🧹 CLEANUP INSTRUCTIONS FOR CLAUDE CODE:'));
    console.log('----------------------------------------------------------------');
    console.log(chalk.cyan('cd ../..  # Return to project root'));
    console.log(chalk.cyan(`just cleanup ${agentId}  # Clean up your workspace`));
    console.log('----------------------------------------------------------------');
    console.log('');
    console.log(chalk.green(`✅ Task ${taskId} complete! Ready for cleanup and next assignment.`));
  }

  async setTaskPriority(taskId: string, newPriority: 'critical' | 'high' | 'normal' | 'low'): Promise<void> {

    // Find task in any status
    const allStatuses = ['backlog', 'todo', 'in_progress', 'review'] as const;
    let taskFound = false;

    for (const status of allStatuses) {
      const taskIndex = this.kanban.tasks[status].findIndex(t => t.id === taskId);
      if (taskIndex !== -1) {
        this.kanban.tasks[status][taskIndex].priority = newPriority;
        taskFound = true;
        this.success(`Updated task ${taskId} priority to ${newPriority} in ${status}`);
        break;
      }
    }

    if (!taskFound) {
      this.error(`Task ${taskId} not found in any status`);
      return;
    }

    this.saveKanban();
  }

  async moveTaskToBacklog(taskId: string): Promise<void> {
    console.log(chalk.blue(`📋 Moving task ${taskId} to backlog...`));

    // Find task in any status except backlog and done
    const searchStatuses = ['todo', 'in_progress', 'review'] as const;
    let taskFound: Task | null = null;
    let sourceStatus: string | null = null;

    for (const status of searchStatuses) {
      const taskIndex = this.kanban.tasks[status].findIndex(t => t.id === taskId);
      if (taskIndex !== -1) {
        taskFound = this.kanban.tasks[status][taskIndex];
        sourceStatus = status;
        // Remove from current status
        this.kanban.tasks[status].splice(taskIndex, 1);
        break;
      }
    }

    if (!taskFound) {
      // Check if already in backlog
      const backlogTask = this.kanban.tasks.backlog.find(t => t.id === taskId);
      if (backlogTask) {
        this.warn(`Task ${taskId} is already in backlog`);
        return;
      }
      this.error(`Task ${taskId} not found in any moveable status (todo, in_progress, review)`);
      return;
    }

    // Reset task state for backlog
    const resetTask: Task = {
      ...taskFound,
      assignee: null as string | null,
      started: null as string | null
    };

    // Add to backlog
    this.kanban.tasks.backlog.push(resetTask);
    this.success(`Moved task ${taskId} from ${sourceStatus} to backlog`);
    this.saveKanban();
  }

  /**
   * Process review section with automated validation
   */
  async processReviewSection(dryRun: boolean = false): Promise<void> {
    this.log('Starting automated review section processing');
    
    if (this.kanban.tasks.review.length === 0) {
      this.warn('No tasks in review section');
      return;
    }

    if (dryRun) {
      this.log(`DRY RUN: Would process ${this.kanban.tasks.review.length} tasks`);
      
      for (const task of this.kanban.tasks.review) {
        console.log(`${chalk.yellow('WOULD PROCESS:')} ${task.id} - ${task.title}`);
        console.log(`  Files: ${task.files?.length || 0}`);
        console.log(`  Priority: ${task.priority}`);
        console.log('');
      }
      return;
    }

    try {
      // Import ReviewProcessor dynamically to avoid circular dependencies
      const { ReviewProcessor } = await import('./review-processor.js');
      const processor = new ReviewProcessor();
      
      const results = await processor.processAllReviewTasks();
      
      // Update our internal kanban state (reload from file as processor modified it)
      this.loadKanban();
      
      // Generate summary
      const summary = {
        completed: results.filter(r => r.disposition === 'completed').length,
        partial: results.filter(r => r.disposition === 'partial').length,
        stub: results.filter(r => r.disposition === 'stub').length,
        failed: results.filter(r => r.disposition === 'failed').length,
        split: results.filter(r => r.splitTasks && r.splitTasks.length > 0).length
      };

      console.log(chalk.cyan('\n🎯 REVIEW PROCESSING SUMMARY'));
      console.log(chalk.cyan('============================='));
      console.log(chalk.green(`✅ Completed: ${summary.completed}`));
      console.log(chalk.yellow(`⚠️  Partial: ${summary.partial}`));
      console.log(chalk.yellow(`📝 Stub: ${summary.stub}`));
      console.log(chalk.red(`❌ Failed: ${summary.failed}`));
      console.log(chalk.blue(`🔄 Split: ${summary.split}`));

      this.success(`Processed ${results.length} review tasks successfully`);
      
    } catch (error) {
      this.error(`Review processing failed: ${error}`);
      throw error;
    }
  }

  async unassignTask(taskId: string): Promise<void> {
    console.log(chalk.blue(`🔄 Unassigning task ${taskId}...`));

    // Find task in any status
    const allStatuses = ['backlog', 'todo', 'in_progress', 'review'] as const;
    let taskFound = false;

    for (const status of allStatuses) {
      const taskIndex = this.kanban.tasks[status].findIndex(t => t.id === taskId);
      if (taskIndex !== -1) {
        const task = this.kanban.tasks[status][taskIndex];
        const oldAssignee = task.assignee;
        
        // Unassign the task
        task.assignee = null as string | null;
        task.started = null as string | null;

        // If task is not in backlog, move it there
        if (status !== 'backlog') {
          // Remove from current status
          this.kanban.tasks[status].splice(taskIndex, 1);
          // Add to backlog
          this.kanban.tasks.backlog.push(task);
          this.success(`Unassigned task ${taskId} from ${oldAssignee} and moved from ${status} to backlog`);
        } else {
          this.success(`Unassigned task ${taskId} from ${oldAssignee} (remained in backlog)`);
        }

        taskFound = true;
        break;
      }
    }

    if (!taskFound) {
      this.error(`Task ${taskId} not found in any status`);
      return;
    }

    this.saveKanban();
  }
}

// CLI setup
const program = new Command();
const manager = new AgentManager();

program
  .name('agent-manager')
  .description('Concurrent Claude Code Agent Management System')
  .version('1.0.0');

program
  .command('start')
  .description('Start a new agent with next available task')
  .action(async () => {
    await manager.startAgent();
  });

program
  .command('status')
  .description('Show overview of all agents and tasks')
  .action(async () => {
    await manager.showStatus();
  });

program
  .command('cleanup')
  .description('Clean up finished agent workspace')
  .argument('[agent-id]', 'Agent ID to cleanup')
  .action(async (agentId) => {
    await manager.cleanupAgent(agentId);
  });

program
  .command('my-id')
  .description('Show current agent ID (from within worktree)')
  .action(async () => {
    const agentId = await manager.getCurrentAgentId();
    if (agentId) {
      console.log(agentId);
    } else {
      console.error(chalk.red('Not in an agent workspace'));
      process.exit(1);
    }
  });

program
  .command('startup')
  .description('Run agent startup protocol (for agents)')
  .action(async () => {
    await manager.runStartupProtocol();
  });

program
  .command('resume')
  .description('Resume work in an existing agent worktree (after /clear)')
  .action(async () => {
    await manager.resumeAgent();
  });

program
  .command('setup')
  .description('Setup agent workspace (create new or resume existing)')
  .argument('<agent-id>', 'Agent ID (e.g., agent-001)')
  .action(async (agentId) => {
    await manager.setupAgent(agentId);
  });

program
  .command('agent-instruction')
  .alias('ai')
  .description('Handle Claude agent instruction (resume work on ticket)')
  .action(async () => {
    await manager.handleAgentInstruction();
  });

program
  .command('reset-kanban')
  .description('Reset kanban board - move in_progress tasks back to backlog')
  .action(async () => {
    await manager.resetKanban();
  });

program
  .command('add-task')
  .description('Add new task to kanban backlog')
  .argument('<title>', 'Task title')
  .argument('[priority]', 'Task priority (critical/high/normal/low)', 'normal')
  .argument('[hours]', 'Estimated hours', '8')
  .action(async (title, priority, hours) => {
    await manager.addTask(title, priority, parseInt(hours));
  });

program
  .command('complete-task')
  .description('Mark current agent task as complete')
  .action(async () => {
    await manager.completeCurrentTask();
  });

program
  .command('process-review')
  .description('Process all tasks in review section with automated validation')
  .option('--dry-run', 'Show what would be processed without making changes')
  .action(async (options) => {
    await manager.processReviewSection(options.dryRun || false);
  });

program
  .command('set-priority')
  .description('Set task priority')
  .argument('<task-id>', 'Task ID to update')
  .argument('<priority>', 'New priority (critical/high/normal/low)')
  .action(async (taskId, priority) => {
    await manager.setTaskPriority(taskId, priority);
  });

program
  .command('move-to-backlog')
  .description('Move a task back to backlog')
  .argument('<task-id>', 'Task ID to move to backlog')
  .action(async (taskId) => {
    await manager.moveTaskToBacklog(taskId);
  });

program
  .command('unassign')
  .description('Unassign a task and move it to backlog')
  .argument('<task-id>', 'Task ID to unassign')
  .action(async (taskId) => {
    await manager.unassignTask(taskId);
  });

program
  .command('validate-assignment')
  .description('Validate an agent assignment before execution')
  .argument('<agent-id>', 'Agent ID (e.g., agent-001)')
  .argument('<task-id>', 'Task ID to assign')
  .option('--bypass-warnings', 'Bypass warning-level validation failures')
  .action(async (agentId, taskId, options) => {
    try {
      const validation = await manager.assignmentValidator.validateAssignment(
        agentId, 
        taskId, 
        options.bypassWarnings || false
      );
      
      console.log(chalk.cyan('\n🔍 ASSIGNMENT VALIDATION REPORT'));
      console.log(chalk.cyan('================================'));
      console.log(`Agent: ${chalk.yellow(agentId)}`);
      console.log(`Task: ${chalk.yellow(taskId)}`);
      console.log(`Result: ${validation.valid ? chalk.green('✅ VALID') : chalk.red('❌ INVALID')}`);
      console.log(`Score: ${chalk.blue(validation.assignmentScore)}/100`);
      console.log(`Confidence: ${chalk.blue(Math.round(validation.confidence * 100))}%`);
      
      if (validation.errors.length > 0) {
        console.log('\n❌ Errors:');
        validation.errors.forEach(error => {
          console.log(`  ${chalk.red(error.code)}: ${error.message}`);
          console.log(`    Resolution: ${chalk.gray(error.resolution)}`);
        });
      }
      
      if (validation.warnings.length > 0) {
        console.log('\n⚠️  Warnings:');
        validation.warnings.forEach(warning => {
          console.log(`  ${chalk.yellow(warning.code)}: ${warning.message}`);
          console.log(`    Impact: ${chalk.gray(warning.impact)}`);
        });
      }
      
      if (validation.recommendations.length > 0) {
        console.log('\n💡 Recommendations:');
        validation.recommendations.forEach(rec => {
          console.log(`  ${rec}`);
        });
      }
      
      process.exit(validation.valid ? 0 : 1);
    } catch (error) {
      console.error(chalk.red('Validation failed:'), error);
      process.exit(1);
    }
  });

program
  .command('check-state')
  .description('Check agent state consistency')
  .option('--agent-id <id>', 'Check specific agent')
  .action(async (options) => {
    try {
      if (options.agentId) {
        const state = await manager.stateManager.getAgentState(options.agentId);
        console.log(`Agent ${options.agentId} state:`, JSON.stringify(state, null, 2));
      } else {
        const report = await manager.stateManager.performConsistencyCheck();
        
        console.log(chalk.cyan('\n🔍 STATE CONSISTENCY REPORT'));
        console.log(chalk.cyan('==========================='));
        console.log(`Total Agents: ${report.totalAgents}`);
        console.log(`Consistent: ${chalk.green(report.consistentAgents)}`);
        console.log(`Inconsistent: ${chalk.red(report.inconsistentAgents)}`);
        
        if (report.issues.length > 0) {
          console.log('\n🚨 Issues:');
          report.issues.forEach(issue => {
            const severityColor = issue.severity === 'critical' ? chalk.red :
                               issue.severity === 'high' ? chalk.yellow :
                               issue.severity === 'medium' ? chalk.blue : chalk.gray;
            console.log(`  ${severityColor(issue.severity.toUpperCase())} ${issue.agentId}: ${issue.description}`);
            console.log(`    Resolution: ${chalk.gray(issue.resolution)}`);
          });
        }
        
        if (report.recommendations.length > 0) {
          console.log('\n💡 Recommendations:');
          report.recommendations.forEach(rec => console.log(`  - ${rec}`));
        }
      }
    } catch (error) {
      console.error(chalk.red('State check failed:'), error);
      process.exit(1);
    }
  });

program
  .command('recover-agent')
  .description('Recover from failed agent state transition')
  .argument('<agent-id>', 'Agent ID to recover')
  .action(async (agentId) => {
    try {
      console.log(chalk.blue(`🔧 Recovering agent ${agentId}...`));
      
      const result = await manager.stateManager.recoverFromFailedTransition(
        agentId, 
        'Manual recovery requested via CLI'
      );
      
      if (result.valid) {
        console.log(chalk.green(`✅ Recovery successful for ${agentId}`));
        if (result.warnings.length > 0) {
          console.log('⚠️  Warnings during recovery:');
          result.warnings.forEach(warning => console.log(`  - ${warning}`));
        }
      } else {
        console.log(chalk.red(`❌ Recovery failed for ${agentId}`));
        result.errors.forEach(error => console.log(`  - ${error}`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('Recovery failed:'), error);
      process.exit(1);
    }
  });

program
  .command('state-history')
  .description('Show agent state transition history')
  .option('--agent-id <id>', 'Show history for specific agent')
  .action(async (options) => {
    try {
      const history = manager.stateManager.getTransitionHistory(options.agentId);
      
      console.log(chalk.cyan('\n📋 STATE TRANSITION HISTORY'));
      console.log(chalk.cyan('============================'));
      
      if (history.length === 0) {
        console.log('No state transitions recorded');
        return;
      }
      
      history.forEach(transition => {
        const timeColor = chalk.gray(transition.timestamp);
        const agentColor = chalk.yellow(transition.agentId);
        const stateColor = chalk.blue(`${transition.fromStatus} → ${transition.toStatus}`);
        const reasonColor = chalk.green(transition.reason);
        
        console.log(`${timeColor} ${agentColor}: ${stateColor} ${reasonColor}`);
        if (transition.taskId) {
          console.log(`  Task: ${chalk.cyan(transition.taskId)}`);
        }
      });
    } catch (error) {
      console.error(chalk.red('History retrieval failed:'), error);
      process.exit(1);
    }
  });

program.parse();