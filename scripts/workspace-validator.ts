#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import chalk from 'chalk';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  guidance?: string;
}

export interface ExecutionContext {
  type: 'project' | 'agent' | 'unknown';
  agentId?: string;
  workspaceDir?: string;
  projectRoot: string;
  isAgentWorkspace: boolean;
  hasRequiredFiles: boolean;
}

export class WorkspaceValidator {
  private static readonly PROJECT_ROOT = resolve(process.cwd(), process.env.INIT_CWD ? resolve(process.env.INIT_CWD) : process.cwd());
  private static readonly REQUIRED_AGENT_FILES = ['.agent-id', 'TASK.md', 'justfile'];
  
  /**
   * Detect current execution context with comprehensive validation
   */
  static detectExecutionContext(): ExecutionContext {
    const currentDir = process.env.WORKSPACE_DIR || process.env.INIT_CWD || process.env.PWD || process.cwd();
    const resolvedCurrentDir = resolve(currentDir);
    const projectRoot = this.findProjectRoot(resolvedCurrentDir);
    
    // Check if we're in an agent workspace
    const agentMatch = resolvedCurrentDir.match(/agents\/(agent-\d{3})/);
    const isAgentWorkspace = !!agentMatch;
    
    let context: ExecutionContext = {
      type: 'unknown',
      projectRoot,
      isAgentWorkspace: false,
      hasRequiredFiles: false
    };
    
    if (isAgentWorkspace && agentMatch) {
      const agentId = agentMatch[1];
      const hasRequiredFiles = this.REQUIRED_AGENT_FILES.every(file => 
        existsSync(join(resolvedCurrentDir, file))
      );
      
      context = {
        type: 'agent',
        agentId,
        workspaceDir: resolvedCurrentDir,
        projectRoot,
        isAgentWorkspace: true,
        hasRequiredFiles
      };
    } else if (resolvedCurrentDir === projectRoot || resolvedCurrentDir.endsWith('event-api')) {
      context = {
        type: 'project',
        projectRoot,
        isAgentWorkspace: false,
        hasRequiredFiles: true
      };
    }
    
    return context;
  }
  
  /**
   * Validate command execution context
   */
  static validateExecutionContext(requiredContext: 'project' | 'agent', commandName: string): ValidationResult {
    const context = this.detectExecutionContext();
    
    // Check for basic context mismatch
    if (context.type !== requiredContext) {
      return {
        valid: false,
        error: this.generateContextError(context, requiredContext, commandName),
        guidance: this.generateGuidance(context, requiredContext, commandName)
      };
    }
    
    // Additional validation for agent workspaces
    if (requiredContext === 'agent' && context.type === 'agent') {
      if (!context.hasRequiredFiles) {
        return {
          valid: false,
          error: `Agent workspace is incomplete - missing required files`,
          guidance: this.generateWorkspaceRepairGuidance(context)
        };
      }
      
      // Validate agent ID consistency
      const agentIdValidation = this.validateAgentIdConsistency(context);
      if (!agentIdValidation.valid) {
        return agentIdValidation;
      }
    }
    
    return { valid: true };
  }
  
  /**
   * Validate agent workspace integrity
   */
  static validateAgentWorkspace(workspaceDir: string): ValidationResult {
    // Check required files exist
    const missingFiles = this.REQUIRED_AGENT_FILES.filter(file => 
      !existsSync(join(workspaceDir, file))
    );
    
    if (missingFiles.length > 0) {
      return {
        valid: false,
        error: `Missing required workspace files: ${missingFiles.join(', ')}`,
        guidance: `Run setup command to initialize workspace properly:
  cd ../..
  npm run agent:dev setup <agent-id>`
      };
    }
    
    // Validate agent ID consistency
    const agentIdFile = join(workspaceDir, '.agent-id');
    const agentId = readFileSync(agentIdFile, 'utf8').trim();
    const expectedPath = `agents/${agentId}`;
    
    if (!workspaceDir.endsWith(expectedPath)) {
      return {
        valid: false,
        error: `Agent ID ${agentId} doesn't match workspace path`,
        guidance: `Workspace may be corrupted. To fix:
  1. Navigate to project root: cd ../..
  2. Clean up: npm run agent:dev cleanup ${agentId}  
  3. Recreate: npm run agent:dev setup ${agentId}`
      };
    }
    
    return { valid: true };
  }
  
  /**
   * Pre-command validation with early exit
   */
  static validateCommand(requiredContext: 'project' | 'agent', commandName: string): void {
    const result = this.validateExecutionContext(requiredContext, commandName);
    
    if (!result.valid) {
      console.error(chalk.red('❌ COMMAND LOCATION ERROR'));
      console.error('');
      console.error(chalk.red(`Error: ${result.error}`));
      console.error('');
      console.error(chalk.yellow('💡 How to fix:'));
      console.error(result.guidance);
      console.error('');
      console.error(chalk.blue('🛡️  WORKSPACE ISOLATION: Commands must run in their designated context'));
      process.exit(1);
    }
  }
  
  /**
   * Check for dangerous cross-workspace commands
   */
  static validateCrossWorkspaceCommand(commandName: string): ValidationResult {
    const context = this.detectExecutionContext();
    
    if (context.type === 'agent') {
      const dangerousCommands = ['agent1', 'agent2', 'agent3', 'reset', 'start-all', 'cleanup'];
      
      if (dangerousCommands.some(cmd => commandName.includes(cmd))) {
        return {
          valid: false,
          error: `Command "${commandName}" should not be run from agent workspace`,
          guidance: `Dangerous commands should only run from project root:
  1. Navigate to project root: cd ../..
  2. Then run: just ${commandName}
  
  ⚠️  Running project commands from agent workspaces can corrupt your workspace!`
        };
      }
    }
    
    return { valid: true };
  }
  
  private static findProjectRoot(currentDir: string): string {
    let dir = currentDir;
    while (dir !== '/') {
      if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'kanban.yaml'))) {
        return dir;
      }
      dir = resolve(dir, '..');
    }
    return currentDir;
  }
  
  private static validateAgentIdConsistency(context: ExecutionContext): ValidationResult {
    if (!context.workspaceDir || !context.agentId) {
      return { valid: true };
    }
    
    try {
      const agentIdFile = join(context.workspaceDir, '.agent-id');
      if (existsSync(agentIdFile)) {
        const fileAgentId = readFileSync(agentIdFile, 'utf8').trim();
        if (fileAgentId !== context.agentId) {
          return {
            valid: false,
            error: `Agent ID mismatch: directory says ${context.agentId}, file says ${fileAgentId}`,
            guidance: `Workspace inconsistency detected. To repair:
  cd ../..
  npm run agent:dev cleanup ${context.agentId}
  npm run agent:dev setup ${context.agentId}`
          };
        }
      }
    } catch (error) {
      return {
        valid: false,
        error: 'Failed to validate agent ID consistency',
        guidance: 'Workspace may be corrupted, consider cleanup and recreation'
      };
    }
    
    return { valid: true };
  }
  
  private static generateContextError(context: ExecutionContext, requiredContext: 'project' | 'agent', commandName: string): string {
    if (context.type === 'unknown') {
      return `Cannot determine execution context for command "${commandName}"`;
    }
    
    if (requiredContext === 'agent' && context.type === 'project') {
      return `Command "${commandName}" must be run from an agent workspace, not project root`;
    }
    
    if (requiredContext === 'project' && context.type === 'agent') {
      return `Command "${commandName}" must be run from project root, not agent workspace ${context.agentId}`;
    }
    
    return `Command "${commandName}" cannot be run in ${context.type} context`;
  }
  
  private static generateGuidance(context: ExecutionContext, requiredContext: 'project' | 'agent', commandName: string): string {
    if (requiredContext === 'agent' && context.type === 'project') {
      return `To run "${commandName}" properly:
  1. Get assigned to an agent workspace:
     just agent1  # or agent2, agent3
  2. Navigate to your workspace:
     cd agents/agent-XXX
  3. Then run the command:
     just ${commandName}
     
  🎯 Agent workspaces provide isolated environments for focused work`;
    }
    
    if (requiredContext === 'project' && context.type === 'agent') {
      return `To run "${commandName}" properly:
  1. Navigate to project root:
     cd ../..
  2. Then run the command:
     just ${commandName}
     
  ⚠️  Project-level commands manage multiple agents and should not run in agent workspaces`;
    }
    
    if (context.type === 'unknown') {
      return `To fix the context issue:
  1. Navigate to the project root directory (containing package.json and kanban.yaml)
  2. Or navigate to a properly configured agent workspace in ./agents/agent-XXX/
  3. Then retry the command
  
  📍 Make sure you're in the correct directory for the command you want to run`;
    }
    
    return `Ensure you're in the correct directory context for command "${commandName}"`;
  }
  
  private static generateWorkspaceRepairGuidance(context: ExecutionContext): string {
    return `To repair your agent workspace:
  1. Navigate to project root: cd ../..
  2. Clean up the workspace: npm run agent:dev cleanup ${context.agentId}
  3. Recreate the workspace: npm run agent:dev setup ${context.agentId}
  4. Navigate back: cd agents/${context.agentId}
  
  Missing files: ${this.REQUIRED_AGENT_FILES.filter(file => 
    !existsSync(join(context.workspaceDir || '', file))
  ).join(', ')}`;
  }
}

// CLI interface for validation
if (import.meta.url === `file://${process.argv[1]}`) {
  const [,, context, command] = process.argv;
  
  if (!context || !command) {
    console.error('Usage: node workspace-validator.js <project|agent> <command-name>');
    process.exit(1);
  }
  
  if (context !== 'project' && context !== 'agent') {
    console.error('Context must be "project" or "agent"');
    process.exit(1);
  }
  
  WorkspaceValidator.validateCommand(context as 'project' | 'agent', command);
  console.log('✅ Validation passed');
}