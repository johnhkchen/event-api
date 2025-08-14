#!/usr/bin/env tsx

import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import type { KanbanBoard, Task } from './types.js';
import { WorkspaceValidator } from './workspace-validator.js';

interface AgentWorkContext {
  agentId: string;
  workspaceDir: string;
  currentTask: Task | null;
  kanban: KanbanBoard;
}

class AgentWorkHandler {
  private context: AgentWorkContext;

  constructor(workspaceDir: string) {
    this.context = this.loadContext(workspaceDir);
  }

  private loadContext(workspaceDir: string): AgentWorkContext {
    // Determine agent ID from workspace directory
    const agentMatch = workspaceDir.match(/agents\/(agent-\d{3})/);
    if (!agentMatch) {
      throw new Error(`Invalid agent workspace directory: ${workspaceDir}`);
    }
    const agentId = agentMatch[1];

    // Load kanban board
    const kanbanPath = join(workspaceDir, '../../kanban.yaml');
    const kanbanContent = readFileSync(kanbanPath, 'utf8');
    const kanban = yaml.load(kanbanContent) as KanbanBoard;

    // Find current task for this agent
    let currentTask: Task | null = null;
    const agentStatus = kanban.agents[agentId];
    if (agentStatus?.current_task) {
      // Look for task in in_progress first, then other states
      currentTask = kanban.tasks.in_progress.find(t => t.id === agentStatus.current_task) ||
                   kanban.tasks.todo.find(t => t.id === agentStatus.current_task) ||
                   kanban.tasks.review.find(t => t.id === agentStatus.current_task) ||
                   null;
    }

    return {
      agentId,
      workspaceDir,
      currentTask,
      kanban
    };
  }

  private getTaskScope(task: Task): { files: string[], restrictions: string[], commitPrefix: string } {
    // Dynamic scope based on task labels and requirements
    const scope = {
      files: [...task.files],
      restrictions: [] as string[],
      commitPrefix: this.getCommitPrefix(task)
    };

    // Add scope based on task type/labels
    if (task.labels.includes('database')) {
      scope.files.push('migrations/', 'schema/', 'database/');
      scope.restrictions.push('Do not modify API endpoints or web scraping code');
    }
    
    if (task.labels.includes('hono') || task.labels.includes('api')) {
      scope.files.push('services/hono-api/', 'src/api/', 'package.json');
      scope.restrictions.push('Do not modify database schema or scraping engines');
    }
    
    if (task.labels.includes('scraping') || task.labels.includes('playwright')) {
      scope.files.push('src/scraping/', 'src/api/scrape/', 'playwright/');
      scope.restrictions.push('Do not modify core API framework or database schema');
    }

    if (task.labels.includes('elixir') || task.labels.includes('phoenix')) {
      scope.files.push('services/elixir-service/', 'lib/', 'mix.exs');
      scope.restrictions.push('Do not modify Hono service or TypeScript code');
    }

    return scope;
  }

  private getCommitPrefix(task: Task): string {
    if (task.labels.includes('database')) return 'DB:';
    if (task.labels.includes('hono')) return 'HONO:';
    if (task.labels.includes('scraping')) return 'SCRAPING:';
    if (task.labels.includes('elixir')) return 'ELIXIR:';
    return 'FEAT:';
  }

  private findOtherActiveAgents(): string[] {
    const otherAgents = [];
    for (const [agentId, status] of Object.entries(this.context.kanban.agents)) {
      if (agentId !== this.context.agentId && status.status === 'working') {
        otherAgents.push(`${agentId} (${status.current_task})`);
      }
    }
    return otherAgents;
  }

  private generateDynamicGuidance(): string {
    const { agentId, currentTask } = this.context;
    
    if (!currentTask) {
      return `
🚨 NO ACTIVE TASK ASSIGNED

Agent ${agentId} does not have an active task assignment.
Check kanban.yaml or run setup to get assigned a task.

Commands:
- just status     # Check kanban board status
- just assign     # Get assigned to next available task
`;
    }

    const scope = this.getTaskScope(currentTask);
    const otherAgents = this.findOtherActiveAgents();
    
    return `
🎯 DYNAMIC TASK ASSIGNMENT

Agent: ${chalk.green(agentId)}
Task: ${chalk.yellow(currentTask.id)} - ${currentTask.title}
Priority: ${currentTask.priority === 'critical' ? chalk.red(currentTask.priority) : 
           currentTask.priority === 'high' ? chalk.yellow(currentTask.priority) :
           currentTask.priority === 'normal' ? chalk.blue(currentTask.priority) : 
           chalk.gray(currentTask.priority)}
Branch: task/${currentTask.id}

📁 YOUR CURRENT SCOPE:
${scope.files.map(f => `  ✅ ${f}`).join('\n')}

🚫 CURRENT RESTRICTIONS:
${scope.restrictions.map(r => `  ❌ ${r}`).join('\n')}

📋 TASK REQUIREMENTS:
${currentTask.requirements.map((req, i) => `  ${i + 1}. ${req}`).join('\n')}

🤖 OTHER ACTIVE AGENTS:
${otherAgents.length > 0 ? otherAgents.map(a => `  🔄 ${a}`).join('\n') : '  None'}

💡 COMMIT GUIDELINES:
- Prefix commits with: ${scope.commitPrefix}
- Example: "${scope.commitPrefix} Implement user authentication endpoint"

⚡ DYNAMIC COMMANDS:
- just status      # Check kanban board
- just reassign    # Request different task
- just complete    # Mark current task as done
- just help        # Show this guidance again
`;
  }

  async run(): Promise<void> {
    console.log(chalk.bold.cyan('🚀 AGENT WORK SESSION STARTING'));
    console.log('');
    
    // Show dynamic context
    console.log(chalk.bold('🔧 WORKSPACE CONTEXT'));
    console.log(`Directory: ${this.context.workspaceDir}`);
    console.log(`Agent ID: ${chalk.green(this.context.agentId)}`);
    console.log('');

    // Show dynamic guidance
    console.log(this.generateDynamicGuidance());
    
    console.log('');
    console.log(chalk.bold.green('🎉 Ready to work! Your scope is dynamically determined by your current task.'));
    console.log('================================================================');
  }
}

// Main execution
async function main() {
  try {
    // CRITICAL: Validate execution context before any processing
    WorkspaceValidator.validateCommand('agent', 'work');
    
    const workspaceDir = process.env.WORKSPACE_DIR || process.cwd();
    
    // Additional workspace integrity check
    const workspaceValidation = WorkspaceValidator.validateAgentWorkspace(workspaceDir);
    if (!workspaceValidation.valid) {
      console.error(chalk.red('❌ WORKSPACE VALIDATION FAILED'));
      console.error('');
      console.error(chalk.red(`Error: ${workspaceValidation.error}`));
      console.error('');
      console.error(chalk.yellow('💡 How to fix:'));
      console.error(workspaceValidation.guidance);
      process.exit(1);
    }
    
    const handler = new AgentWorkHandler(workspaceDir);
    await handler.run();
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch(console.error);