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

  constructor() {
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
    for (let i = 1; i <= this.kanban.metadata.max_agents; i++) {
      const agentId = `agent-${i.toString().padStart(3, '0')}`;
      const worktreePath = `./agents/${agentId}`;
      
      // Check if worktree exists and is active
      try {
        const worktrees = await git.raw(['worktree', 'list']);
        if (!worktrees.includes(worktreePath)) {
          return agentId;
        }
      } catch (error) {
        this.error(`Failed to check worktrees: ${error}`);
        return null;
      }
    }
    
    this.error('All agent slots are occupied. Use "status" command to see active agents.');
    return null;
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
    // Use WORKSPACE_DIR set by justfile, or fall back to other methods
    const currentDir = process.env.WORKSPACE_DIR || process.env.INIT_CWD || process.env.PWD || process.cwd();
    
    // Method 1: Check for .agent-id file
    const agentIdFile = join(currentDir, '.agent-id');
    if (existsSync(agentIdFile)) {
      return readFileSync(agentIdFile, 'utf8').trim();
    }
    
    // Method 2: Extract from directory path
    const pathMatch = currentDir.match(/agents\/(agent-\d{3})/);
    if (pathMatch) {
      return pathMatch[1];
    }
    
    // Method 3: Check git worktree list
    try {
      const worktrees = await git.raw(['worktree', 'list']);
      const lines = worktrees.split('\n');
      for (const line of lines) {
        if (line.includes(currentDir)) {
          const worktreeMatch = line.match(/agents\/(agent-\d{3})/);
          if (worktreeMatch) {
            return worktreeMatch[1];
          }
        }
      }
    } catch (error) {
      // Ignore git errors
    }
    
    // Method 4: Check .agent/status file
    const statusFile = join(currentDir, '.agent', 'status');
    if (existsSync(statusFile)) {
      const content = readFileSync(statusFile, 'utf8');
      const match = content.match(/AGENT_ID=(.+)/);
      if (match) {
        return match[1].trim();
      }
    }
    
    return null;
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

  private updateAgentStatus(agentId: string, taskId: string, status: 'working' | 'available' = 'working'): void {
    if (!this.kanban.agents[agentId]) {
      this.kanban.agents[agentId] = {
        status: 'available',
        current_task: null,
        worktree: null,
        last_active: null
      };
    }

    this.kanban.agents[agentId] = {
      status,
      current_task: status === 'working' ? taskId : null,
      worktree: status === 'working' ? `./agents/${agentId}` : null,
      last_active: new Date().toISOString()
    };

    this.saveKanban();
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
`;
    
    writeFileSync(join(agentDir, 'justfile'), justfileContent);
  }

  private createTaskFile(agentDir: string, task: Task, agentId: string): void {
    const taskContent = `# Task: ${task.title}
**Task ID:** ${task.id}  
**Priority:** ${task.priority}  
**Assignee:** ${agentId}  
**Created:** ${new Date().toISOString()}

## Objective
${task.description}

## Requirements
${task.requirements.map(req => `- [ ] ${req}`).join('\n')}

## Files to Focus On
${task.files.map(file => `- ${file}`).join('\n')}

## Dependencies
${task.dependencies.length > 0 ? task.dependencies.map(dep => `- ${dep}`).join('\n') : 'None'}

## Labels
${task.labels.join(', ')}

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
    if (!agentId) {
      agentId = await this.getCurrentAgentId();
      if (!agentId) {
        this.error('Could not determine agent ID. Please specify agent ID.');
        return;
      }
    }
    
    const worktreePath = `./agents/${agentId}`;
    const absoluteWorktreePath = resolve(PROJECT_ROOT, worktreePath);
    
    this.log(`Cleaning up ${agentId}`);
    
    try {
      // Get the branch this agent was using before cleanup
      let agentBranch = null;
      const agentStatus = this.kanban.agents[agentId];
      if (agentStatus?.current_task) {
        agentBranch = `task/${agentStatus.current_task}`;
      }
      
      // Update kanban board
      this.updateAgentStatus(agentId, '', 'available');
      
      // Remove worktree
      const worktrees = await git.raw(['worktree', 'list']);
      if (worktrees.includes(absoluteWorktreePath)) {
        await git.raw(['worktree', 'remove', absoluteWorktreePath, '--force']);
        this.success(`Removed worktree ${absoluteWorktreePath}`);
        
        // Only delete the branch if it's not in use by other agents
        if (agentBranch && !(await this.isBranchInUseByOtherAgent(agentBranch, agentId))) {
          try {
            await git.raw(['branch', '-D', agentBranch]);
            this.success(`Deleted branch ${agentBranch} (was owned by ${agentId})`);
          } catch (error) {
            this.warn(`Could not delete branch ${agentBranch}: ${error}`);
          }
        } else if (agentBranch) {
          this.warn(`Branch ${agentBranch} still in use by other agents, keeping it`);
        }
      }
      
      this.success(`Agent ${agentId} cleaned up`);
    } catch (error) {
      this.error(`Failed to cleanup agent: ${error}`);
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
      assignee: null,
      started: undefined
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

  async addTask(title: string, priority: string = 'normal', estimatedHours: number = 8): Promise<void> {
    const taskId = `TASK-${Date.now().toString().slice(-6)}`;
    
    const newTask: Task = {
      id: taskId,
      title,
      priority,
      estimated_hours: estimatedHours,
      description: `Add task description here`,
      requirements: ['Define specific requirements'],
      files: ['Specify relevant files'],
      dependencies: [],
      labels: ['auto-generated'],
      assignee: null
    };
    
    this.kanban.tasks.backlog.push(newTask);
    this.saveKanban();
    
    this.success(`Added task: ${taskId} - ${title}`);
    console.log(`Priority: ${priority}, Estimated hours: ${estimatedHours}`);
  }

  async completeCurrentTask(): Promise<void> {
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
  }

  async setTaskPriority(taskId: string, newPriority: string): Promise<void> {
    const validPriorities = ['critical', 'high', 'normal', 'low'];
    if (!validPriorities.includes(newPriority)) {
      this.error(`Invalid priority: ${newPriority}. Valid priorities: ${validPriorities.join(', ')}`);
      return;
    }

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
  .command('set-priority')
  .description('Set task priority')
  .argument('<task-id>', 'Task ID to update')
  .argument('<priority>', 'New priority (critical/high/normal/low)')
  .action(async (taskId, priority) => {
    await manager.setTaskPriority(taskId, priority);
  });

program.parse();