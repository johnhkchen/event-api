#!/usr/bin/env tsx

/**
 * Agent State Manager
 * 
 * Centralized, atomic agent state management system for the Event API project.
 * Provides race condition prevention, state consistency monitoring, and 
 * comprehensive error recovery for agent assignment operations.
 * 
 * This component ensures that agent state transitions are atomic and consistent,
 * preventing duplicate agent creation and maintaining system integrity.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import { simpleGit } from 'simple-git';
import type { KanbanBoard, AgentStatus, Task } from './types.js';

// State transition lock mechanism
const STATE_LOCKS = new Map<string, Promise<void>>();
const GLOBAL_LOCK_KEY = '__GLOBAL_AGENT_STATE_LOCK__';

export interface StateTransition {
  agentId: string;
  fromStatus: AgentStatus['status'];
  toStatus: AgentStatus['status'];
  taskId: string | null;
  timestamp: string;
  reason: string;
}

export interface StateValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  currentState: AgentStatus | null;
}

export interface StateConsistencyReport {
  timestamp: string;
  totalAgents: number;
  consistentAgents: number;
  inconsistentAgents: number;
  issues: StateInconsistency[];
  recommendations: string[];
}

export interface StateInconsistency {
  agentId: string;
  issueType: 'missing_worktree' | 'orphaned_worktree' | 'invalid_task' | 'status_mismatch' | 'stale_state';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  resolution: string;
}

export interface StateManagerConfig {
  kanbanPath: string;
  agentsDir: string;
  lockTimeoutMs: number;
  consistencyCheckIntervalMs: number;
  maxRetries: number;
  enableBackgroundMonitoring: boolean;
}

export class AgentStateManager {
  private config: StateManagerConfig;
  private git: ReturnType<typeof simpleGit>;
  private transitionHistory: StateTransition[] = [];
  private backgroundMonitoringInterval?: NodeJS.Timeout;

  constructor(config?: Partial<StateManagerConfig>) {
    this.config = {
      kanbanPath: join(process.cwd(), 'kanban.yaml'),
      agentsDir: join(process.cwd(), 'agents'),
      lockTimeoutMs: 30000, // 30 seconds
      consistencyCheckIntervalMs: 60000, // 1 minute
      maxRetries: 3,
      enableBackgroundMonitoring: false,
      ...config
    };

    this.git = simpleGit(process.cwd());

    // Ensure agents directory exists
    if (!existsSync(this.config.agentsDir)) {
      mkdirSync(this.config.agentsDir, { recursive: true });
    }

    // Start background monitoring if enabled
    if (this.config.enableBackgroundMonitoring) {
      this.startBackgroundMonitoring();
    }
  }

  /**
   * Acquire an exclusive lock for state operations
   */
  private async acquireLock(lockKey: string = GLOBAL_LOCK_KEY): Promise<() => void> {
    // Create a promise that resolves when the lock is available
    let lockResolver: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      lockResolver = resolve;
    });

    // Wait for any existing lock to be released
    const existingLock = STATE_LOCKS.get(lockKey);
    if (existingLock) {
      await Promise.race([
        existingLock,
        new Promise<void>((_, reject) => 
          setTimeout(() => reject(new Error('Lock timeout')), this.config.lockTimeoutMs)
        )
      ]);
    }

    // Set the new lock
    STATE_LOCKS.set(lockKey, lockPromise);

    // Return a release function
    return () => {
      STATE_LOCKS.delete(lockKey);
      lockResolver!();
    };
  }

  /**
   * Atomically load the kanban board with locking
   */
  private async loadKanbanAtomic(): Promise<KanbanBoard> {
    const release = await this.acquireLock('kanban_read');
    try {
      if (!existsSync(this.config.kanbanPath)) {
        throw new Error(`Kanban file not found: ${this.config.kanbanPath}`);
      }

      const content = readFileSync(this.config.kanbanPath, 'utf8');
      const kanban = yaml.load(content) as KanbanBoard;

      // Validate kanban structure
      if (!kanban.agents || !kanban.tasks || !kanban.metadata) {
        throw new Error('Invalid kanban structure - missing required sections');
      }

      return kanban;
    } finally {
      release();
    }
  }

  /**
   * Atomically save the kanban board with locking
   */
  private async saveKanbanAtomic(kanban: KanbanBoard): Promise<void> {
    const release = await this.acquireLock('kanban_write');
    try {
      // Update metadata
      kanban.metadata.last_updated = new Date().toISOString().split('T')[0];
      
      // Create backup before saving
      await this.createStateBackup(kanban);

      const content = yaml.dump(kanban, { 
        indent: 2,
        lineWidth: 120,
        noRefs: true 
      });

      writeFileSync(this.config.kanbanPath, content, 'utf8');
    } finally {
      release();
    }
  }

  /**
   * Create a timestamped backup of the current state
   */
  private async createStateBackup(kanban: KanbanBoard): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = join(process.cwd(), 'backups');
    
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true });
    }

    const backupPath = join(backupDir, `kanban-${timestamp}.yaml`);
    const content = yaml.dump(kanban, { indent: 2, lineWidth: 120, noRefs: true });
    
    writeFileSync(backupPath, content, 'utf8');
    return backupPath;
  }

  /**
   * Get the next available agent with atomic state management
   */
  async getNextAvailableAgent(): Promise<string | null> {
    const release = await this.acquireLock(GLOBAL_LOCK_KEY);
    
    try {
      const kanban = await this.loadKanbanAtomic();
      
      // Step 1: Check for explicitly available agents
      for (const [agentId, status] of Object.entries(kanban.agents)) {
        if (status.status === 'available' && !status.current_task) {
          console.log(chalk.blue(`[STATE-MGR] Found available agent: ${agentId}`));
          return agentId;
        }
      }

      // Step 2: Check for agents that can be safely reassigned
      for (let i = 1; i <= kanban.metadata.max_agents; i++) {
        const agentId = `agent-${i.toString().padStart(3, '0')}`;
        
        if (await this.canReassignAgentSafely(agentId, kanban)) {
          console.log(chalk.yellow(`[STATE-MGR] Agent ${agentId} can be reassigned`));
          return agentId;
        }
      }

      // Step 3: Look for stale working agents
      for (const [agentId, status] of Object.entries(kanban.agents)) {
        if (status.status === 'working' && !status.current_task) {
          console.log(chalk.yellow(`[STATE-MGR] Found stale working agent: ${agentId}`));
          return agentId;
        }
      }

      console.log(chalk.red('[STATE-MGR] All agent slots occupied'));
      return null;

    } finally {
      release();
    }
  }

  /**
   * Safely check if an agent can be reassigned
   */
  private async canReassignAgentSafely(agentId: string, kanban: KanbanBoard): Promise<boolean> {
    const agentStatus = kanban.agents[agentId];
    
    // Agent doesn't exist in kanban - can use
    if (!agentStatus) {
      return true;
    }

    // Agent is available - can use
    if (agentStatus.status === 'available') {
      return true;
    }

    // Agent has no current task - can reassign
    if (!agentStatus.current_task) {
      return true;
    }

    // For working agents, verify worktree exists
    if (agentStatus.status === 'working' && agentStatus.worktree) {
      try {
        const worktrees = await this.git.raw(['worktree', 'list']);
        const worktreePath = resolve(process.cwd(), agentStatus.worktree);
        
        if (!worktrees.includes(worktreePath) && !worktrees.includes(agentStatus.worktree)) {
          console.log(chalk.yellow(`[STATE-MGR] Agent ${agentId} has no worktree - can reassign`));
          return true;
        }
      } catch (error) {
        console.log(chalk.yellow(`[STATE-MGR] Could not verify worktree for ${agentId}: ${error}`));
        return false;
      }
    }

    return false;
  }

  /**
   * Atomically transition agent state
   */
  async transitionAgentState(
    agentId: string,
    toStatus: AgentStatus['status'],
    taskId: string | null = null,
    reason: string = 'Manual transition'
  ): Promise<StateValidationResult> {
    const release = await this.acquireLock(`agent_${agentId}`);
    
    try {
      const kanban = await this.loadKanbanAtomic();
      
      // Validate the transition
      const validation = await this.validateStateTransition(agentId, toStatus, taskId, kanban);
      if (!validation.valid) {
        return validation;
      }

      const currentStatus = kanban.agents[agentId]?.status || 'available';
      
      // Create transition record
      const transition: StateTransition = {
        agentId,
        fromStatus: currentStatus,
        toStatus,
        taskId,
        timestamp: new Date().toISOString(),
        reason
      };

      // Apply the state transition
      if (!kanban.agents[agentId]) {
        kanban.agents[agentId] = {
          status: 'available',
          current_task: null,
          worktree: null,
          last_active: null
        };
      }

      kanban.agents[agentId].status = toStatus;
      kanban.agents[agentId].current_task = taskId;
      kanban.agents[agentId].last_active = new Date().toISOString();

      // Set worktree for working agents
      if (toStatus === 'working') {
        kanban.agents[agentId].worktree = `./agents/${agentId}`;
      } else if (toStatus === 'available') {
        kanban.agents[agentId].worktree = null;
      }

      // Save the updated state
      await this.saveKanbanAtomic(kanban);

      // Record the transition
      this.transitionHistory.push(transition);

      console.log(chalk.green(`[STATE-MGR] ✅ ${agentId}: ${currentStatus} → ${toStatus}`));

      return {
        valid: true,
        errors: [],
        warnings: [],
        currentState: kanban.agents[agentId]
      };

    } finally {
      release();
    }
  }

  /**
   * Validate a proposed state transition
   */
  private async validateStateTransition(
    agentId: string,
    toStatus: AgentStatus['status'],
    taskId: string | null,
    kanban: KanbanBoard
  ): Promise<StateValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    const currentState = kanban.agents[agentId] || null;

    // Validate agent ID format
    if (!/^agent-\d{3}$/.test(agentId)) {
      errors.push(`Invalid agent ID format: ${agentId}`);
    }

    // Validate state transitions
    const validTransitions = {
      'available': ['working', 'offline', 'blocked'],
      'working': ['available', 'blocked', 'offline'],
      'blocked': ['available', 'working', 'offline'],
      'offline': ['available']
    };

    if (currentState) {
      const allowedTransitions = validTransitions[currentState.status] || [];
      if (!allowedTransitions.includes(toStatus)) {
        errors.push(`Invalid transition: ${currentState.status} → ${toStatus}`);
      }
    }

    // Validate task assignment
    if (toStatus === 'working') {
      if (!taskId) {
        errors.push('Working agents must have a task assigned');
      } else {
        // Check if task exists and is assignable
        const task = this.findTaskById(taskId, kanban);
        if (!task) {
          errors.push(`Task ${taskId} not found`);
        } else if (task.assignee && task.assignee !== agentId) {
          warnings.push(`Task ${taskId} is already assigned to ${task.assignee}`);
        }
      }
    }

    // Check for conflicts with other agents
    if (taskId) {
      for (const [otherAgentId, status] of Object.entries(kanban.agents)) {
        if (otherAgentId !== agentId && status.current_task === taskId) {
          errors.push(`Task ${taskId} is already assigned to ${otherAgentId}`);
        }
      }
    }

    // Validate worktree consistency
    if (toStatus === 'working') {
      try {
        const worktreePath = `./agents/${agentId}`;
        const worktrees = await this.git.raw(['worktree', 'list']);
        
        // Check if worktree exists for another agent
        const conflictingWorktree = worktrees.split('\n').find(line => 
          line.includes('/agents/') && line.includes(agentId) && 
          !line.includes(resolve(process.cwd(), worktreePath))
        );
        
        if (conflictingWorktree) {
          warnings.push(`Potential worktree conflict detected: ${conflictingWorktree}`);
        }
      } catch (error) {
        warnings.push(`Could not validate worktree consistency: ${error}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      currentState
    };
  }

  /**
   * Find task by ID across all states
   */
  private findTaskById(taskId: string, kanban: KanbanBoard): Task | null {
    for (const tasks of Object.values(kanban.tasks)) {
      const task = (tasks as Task[]).find(t => t.id === taskId);
      if (task) return task;
    }
    return null;
  }

  /**
   * Recover from a failed state transition
   */
  async recoverFromFailedTransition(
    agentId: string,
    errorContext: string
  ): Promise<StateValidationResult> {
    console.log(chalk.red(`[STATE-MGR] 🚨 Recovering from failed transition: ${agentId}`));
    console.log(chalk.yellow(`[STATE-MGR] Error context: ${errorContext}`));

    const release = await this.acquireLock(`recovery_${agentId}`);
    
    try {
      const kanban = await this.loadKanbanAtomic();
      const agentStatus = kanban.agents[agentId];
      
      if (!agentStatus) {
        // Create clean agent state
        return await this.transitionAgentState(agentId, 'available', null, 'Recovery: Missing agent');
      }

      // Check for inconsistencies and resolve them
      const issues: string[] = [];

      // Check worktree consistency
      if (agentStatus.status === 'working' && agentStatus.worktree) {
        try {
          const worktrees = await this.git.raw(['worktree', 'list']);
          const worktreePath = resolve(process.cwd(), agentStatus.worktree);
          
          if (!worktrees.includes(worktreePath) && !worktrees.includes(agentStatus.worktree)) {
            issues.push('Worktree missing for working agent');
            // Transition to available since worktree is gone
            return await this.transitionAgentState(agentId, 'available', null, 'Recovery: Missing worktree');
          }
        } catch (error) {
          issues.push(`Could not verify worktree: ${error}`);
        }
      }

      // Check task consistency
      if (agentStatus.current_task) {
        const task = this.findTaskById(agentStatus.current_task, kanban);
        if (!task) {
          issues.push('Task not found');
          return await this.transitionAgentState(agentId, 'available', null, 'Recovery: Task not found');
        }

        if (task.assignee && task.assignee !== agentId) {
          issues.push('Task assigned to different agent');
          return await this.transitionAgentState(agentId, 'available', null, 'Recovery: Task reassigned');
        }
      }

      // Check for working status without task
      if (agentStatus.status === 'working' && !agentStatus.current_task) {
        issues.push('Working status without task');
        return await this.transitionAgentState(agentId, 'available', null, 'Recovery: Working without task');
      }

      if (issues.length === 0) {
        console.log(chalk.green(`[STATE-MGR] ✅ Agent ${agentId} state is consistent`));
        return {
          valid: true,
          errors: [],
          warnings: [],
          currentState: agentStatus
        };
      } else {
        console.log(chalk.yellow(`[STATE-MGR] ⚠️  Resolved ${issues.length} issues for ${agentId}`));
        return {
          valid: true,
          errors: [],
          warnings: issues,
          currentState: kanban.agents[agentId]
        };
      }

    } catch (error) {
      console.error(chalk.red(`[STATE-MGR] 💥 Recovery failed for ${agentId}: ${error}`));
      
      // Last resort: reset to available
      try {
        return await this.transitionAgentState(agentId, 'available', null, 'Recovery: Last resort reset');
      } catch (resetError) {
        return {
          valid: false,
          errors: [`Recovery failed: ${error}`, `Reset failed: ${resetError}`],
          warnings: [],
          currentState: null
        };
      }
    } finally {
      release();
    }
  }

  /**
   * Perform comprehensive state consistency check
   */
  async performConsistencyCheck(): Promise<StateConsistencyReport> {
    console.log(chalk.blue('[STATE-MGR] 🔍 Performing state consistency check...'));
    
    const release = await this.acquireLock('consistency_check');
    
    try {
      const kanban = await this.loadKanbanAtomic();
      const issues: StateInconsistency[] = [];
      const recommendations: string[] = [];

      // Check each agent's consistency
      for (const [agentId, status] of Object.entries(kanban.agents)) {
        const agentIssues = await this.checkAgentConsistency(agentId, status, kanban);
        issues.push(...agentIssues);
      }

      // Check for orphaned worktrees
      try {
        const worktrees = await this.git.raw(['worktree', 'list']);
        const worktreeLines = worktrees.split('\n').filter(line => line.includes('/agents/'));
        
        for (const line of worktreeLines) {
          const agentMatch = line.match(/agents\/(agent-\d{3})/);
          if (agentMatch) {
            const agentId = agentMatch[1];
            const agentStatus = kanban.agents[agentId];
            
            if (!agentStatus || agentStatus.status !== 'working') {
              issues.push({
                agentId,
                issueType: 'orphaned_worktree',
                description: `Worktree exists but agent is not working: ${line.trim()}`,
                severity: 'medium',
                resolution: `Clean up worktree or update agent status`
              });
            }
          }
        }
      } catch (error) {
        issues.push({
          agentId: 'system',
          issueType: 'status_mismatch',
          description: `Could not check worktrees: ${error}`,
          severity: 'high',
          resolution: 'Investigate git worktree access issues'
        });
      }

      // Generate recommendations
      if (issues.length === 0) {
        recommendations.push('✅ All agents are in consistent states');
      } else {
        const criticalIssues = issues.filter(i => i.severity === 'critical').length;
        const highIssues = issues.filter(i => i.severity === 'high').length;
        
        if (criticalIssues > 0) {
          recommendations.push(`🚨 Address ${criticalIssues} critical issues immediately`);
        }
        if (highIssues > 0) {
          recommendations.push(`⚠️  Address ${highIssues} high priority issues`);
        }

        recommendations.push('Run agent cleanup operations to resolve inconsistencies');
        recommendations.push('Consider restarting agents with persistent issues');
      }

      const totalAgents = Object.keys(kanban.agents).length;
      const consistentAgents = totalAgents - new Set(issues.map(i => i.agentId)).size;

      const report: StateConsistencyReport = {
        timestamp: new Date().toISOString(),
        totalAgents,
        consistentAgents,
        inconsistentAgents: totalAgents - consistentAgents,
        issues,
        recommendations
      };

      console.log(chalk.cyan(`[STATE-MGR] 📊 Consistency check complete: ${consistentAgents}/${totalAgents} agents consistent`));

      return report;

    } finally {
      release();
    }
  }

  /**
   * Check consistency for a specific agent
   */
  private async checkAgentConsistency(
    agentId: string,
    status: AgentStatus,
    kanban: KanbanBoard
  ): Promise<StateInconsistency[]> {
    const issues: StateInconsistency[] = [];

    // Check worktree consistency
    if (status.status === 'working') {
      if (!status.worktree) {
        issues.push({
          agentId,
          issueType: 'missing_worktree',
          description: 'Agent is working but has no worktree path',
          severity: 'high',
          resolution: 'Update agent with correct worktree path or transition to available'
        });
      } else {
        try {
          const worktrees = await this.git.raw(['worktree', 'list']);
          const worktreePath = resolve(process.cwd(), status.worktree);
          
          if (!worktrees.includes(worktreePath) && !worktrees.includes(status.worktree)) {
            issues.push({
              agentId,
              issueType: 'missing_worktree',
              description: 'Worktree path specified but worktree does not exist',
              severity: 'high',
              resolution: 'Create worktree or transition agent to available'
            });
          }
        } catch (error) {
          issues.push({
            agentId,
            issueType: 'status_mismatch',
            description: `Could not verify worktree: ${error}`,
            severity: 'medium',
            resolution: 'Check git configuration and permissions'
          });
        }
      }

      // Check task consistency
      if (!status.current_task) {
        issues.push({
          agentId,
          issueType: 'invalid_task',
          description: 'Agent is working but has no assigned task',
          severity: 'high',
          resolution: 'Assign a task or transition to available'
        });
      } else {
        const task = this.findTaskById(status.current_task, kanban);
        if (!task) {
          issues.push({
            agentId,
            issueType: 'invalid_task',
            description: `Assigned task ${status.current_task} does not exist`,
            severity: 'critical',
            resolution: 'Remove invalid task assignment and transition to available'
          });
        } else if (task.assignee && task.assignee !== agentId) {
          issues.push({
            agentId,
            issueType: 'invalid_task',
            description: `Task ${status.current_task} is assigned to different agent: ${task.assignee}`,
            severity: 'critical',
            resolution: 'Resolve task assignment conflict'
          });
        }
      }
    } else if (status.status === 'available') {
      // Available agents should have no task or worktree
      if (status.current_task) {
        issues.push({
          agentId,
          issueType: 'stale_state',
          description: 'Available agent still has task assignment',
          severity: 'medium',
          resolution: 'Clear task assignment'
        });
      }
      if (status.worktree) {
        issues.push({
          agentId,
          issueType: 'stale_state',
          description: 'Available agent still has worktree assignment',
          severity: 'medium',
          resolution: 'Clear worktree assignment'
        });
      }
    }

    // Check for stale states (last active > 24 hours ago)
    if (status.last_active) {
      const lastActive = new Date(status.last_active);
      const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours
      
      if (Date.now() - lastActive.getTime() > staleThreshold) {
        issues.push({
          agentId,
          issueType: 'stale_state',
          description: `Agent has been inactive for ${Math.round((Date.now() - lastActive.getTime()) / (60 * 60 * 1000))} hours`,
          severity: status.status === 'working' ? 'medium' : 'low',
          resolution: 'Check agent activity and consider cleanup'
        });
      }
    }

    return issues;
  }

  /**
   * Start background monitoring of agent states
   */
  private startBackgroundMonitoring(): void {
    if (this.backgroundMonitoringInterval) {
      clearInterval(this.backgroundMonitoringInterval);
    }

    this.backgroundMonitoringInterval = setInterval(async () => {
      try {
        const report = await this.performConsistencyCheck();
        
        // Log critical issues
        const criticalIssues = report.issues.filter(i => i.severity === 'critical');
        if (criticalIssues.length > 0) {
          console.log(chalk.red(`[STATE-MGR] 🚨 ${criticalIssues.length} critical state issues detected`));
          criticalIssues.forEach(issue => {
            console.log(chalk.red(`[STATE-MGR]   ${issue.agentId}: ${issue.description}`));
          });
        }
        
      } catch (error) {
        console.error(chalk.red(`[STATE-MGR] 💥 Background monitoring error: ${error}`));
      }
    }, this.config.consistencyCheckIntervalMs);

    console.log(chalk.green('[STATE-MGR] 👁️  Background monitoring started'));
  }

  /**
   * Stop background monitoring
   */
  stopBackgroundMonitoring(): void {
    if (this.backgroundMonitoringInterval) {
      clearInterval(this.backgroundMonitoringInterval);
      this.backgroundMonitoringInterval = undefined;
      console.log(chalk.yellow('[STATE-MGR] 👁️  Background monitoring stopped'));
    }
  }

  /**
   * Get agent state transition history
   */
  getTransitionHistory(agentId?: string): StateTransition[] {
    if (agentId) {
      return this.transitionHistory.filter(t => t.agentId === agentId);
    }
    return [...this.transitionHistory];
  }

  /**
   * Clear transition history
   */
  clearTransitionHistory(): void {
    this.transitionHistory = [];
    console.log(chalk.blue('[STATE-MGR] 🗑️  Transition history cleared'));
  }

  /**
   * Get current agent state
   */
  async getAgentState(agentId: string): Promise<AgentStatus | null> {
    const kanban = await this.loadKanbanAtomic();
    return kanban.agents[agentId] || null;
  }

  /**
   * Get all agent states
   */
  async getAllAgentStates(): Promise<Record<string, AgentStatus>> {
    const kanban = await this.loadKanbanAtomic();
    return { ...kanban.agents };
  }

  /**
   * Cleanup on destruction
   */
  destroy(): void {
    this.stopBackgroundMonitoring();
    
    // Release any remaining locks
    STATE_LOCKS.clear();
    
    console.log(chalk.blue('[STATE-MGR] 🧹 Cleanup completed'));
  }
}

// Export singleton instance
export const agentStateManager = new AgentStateManager();

// CLI interface for standalone usage - Check if this file is being run directly
const isMainModule = process.argv[1] && process.argv[1].endsWith('agent-state-manager.ts');

if (isMainModule) {
  const [,, command, ...args] = process.argv;

  const stateManager = new AgentStateManager({ enableBackgroundMonitoring: true });

  const handleCommand = async () => {
    try {
      switch (command) {
        case 'check':
          console.log('🔍 Running state consistency check...');
          const report = await stateManager.performConsistencyCheck();
          console.log('\n📊 State Consistency Report');
          console.log('============================');
          console.log(`Total Agents: ${report.totalAgents}`);
          console.log(`Consistent: ${report.consistentAgents}`);
          console.log(`Inconsistent: ${report.inconsistentAgents}`);
          console.log('\n🚨 Issues:');
          report.issues.forEach(issue => {
            const severityColor = issue.severity === 'critical' ? chalk.red :
                                 issue.severity === 'high' ? chalk.yellow :
                                 issue.severity === 'medium' ? chalk.blue : chalk.gray;
            console.log(`  ${severityColor(issue.severity.toUpperCase())} ${issue.agentId}: ${issue.description}`);
            console.log(`    Resolution: ${issue.resolution}`);
          });
          console.log('\n💡 Recommendations:');
          report.recommendations.forEach(rec => console.log(`  - ${rec}`));
          break;

        case 'state':
          const agentId = args[0];
          if (!agentId) {
            console.error('Usage: node agent-state-manager.ts state <agent-id>');
            process.exit(1);
          }
          const state = await stateManager.getAgentState(agentId);
          console.log(`Agent ${agentId} state:`, JSON.stringify(state, null, 2));
          break;

        case 'transition':
          const [agentIdTransition, toStatus, taskId] = args;
          if (!agentIdTransition || !toStatus) {
            console.error('Usage: node agent-state-manager.ts transition <agent-id> <status> [task-id]');
            process.exit(1);
          }
          const result = await stateManager.transitionAgentState(
            agentIdTransition, 
            toStatus as AgentStatus['status'], 
            taskId || null,
            'CLI transition'
          );
          console.log('Transition result:', JSON.stringify(result, null, 2));
          break;

        case 'recover':
          const agentIdRecover = args[0];
          if (!agentIdRecover) {
            console.error('Usage: node agent-state-manager.ts recover <agent-id>');
            process.exit(1);
          }
          const recovery = await stateManager.recoverFromFailedTransition(
            agentIdRecover,
            'CLI recovery request'
          );
          console.log('Recovery result:', JSON.stringify(recovery, null, 2));
          break;

        case 'history':
          const agentIdHistory = args[0];
          const history = stateManager.getTransitionHistory(agentIdHistory);
          console.log('State transition history:');
          history.forEach(t => {
            console.log(`  ${t.timestamp}: ${t.agentId} ${t.fromStatus} → ${t.toStatus} (${t.reason})`);
          });
          break;

        default:
          console.log('Available commands:');
          console.log('  check                           - Run consistency check');
          console.log('  state <agent-id>               - Get agent state');
          console.log('  transition <agent-id> <status> - Transition agent state');
          console.log('  recover <agent-id>             - Recover from failed state');
          console.log('  history [agent-id]             - Show transition history');
          break;
      }
    } catch (error) {
      console.error('Command failed:', error);
      process.exit(1);
    } finally {
      stateManager.destroy();
    }
  };

  handleCommand();
}