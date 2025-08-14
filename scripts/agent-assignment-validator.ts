#!/usr/bin/env tsx

/**
 * Agent Assignment Validator
 * 
 * Comprehensive validation system for agent assignment operations in the Event API project.
 * Provides pre-assignment validation, conflict detection, capacity validation, and 
 * assignment integrity checking to ensure safe and consistent agent operations.
 * 
 * This component works in conjunction with AgentStateManager to maintain system integrity
 * during agent assignment and task allocation operations.
 */

import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import { simpleGit } from 'simple-git';
import type { KanbanBoard, AgentStatus, Task, AssignmentRules } from './types.js';

export interface AssignmentValidationResult {
  valid: boolean;
  confidence: number; // 0-1 scale
  errors: ValidationError[];
  warnings: ValidationWarning[];
  recommendations: string[];
  assignmentScore: number; // 0-100 scale
}

export interface ValidationError {
  code: string;
  message: string;
  severity: 'blocking' | 'critical' | 'high' | 'medium' | 'low';
  resolution: string;
  affectedAgent?: string;
  affectedTask?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  impact: string;
  suggestion: string;
}

export interface AgentCapacity {
  agentId: string;
  status: AgentStatus['status'];
  currentWorkload: number; // 0-100 scale
  skillMatch: number; // 0-100 scale
  availability: number; // 0-100 scale
  lastActive: Date | null;
  estimatedCompletionTime?: string;
}

export interface ConflictAnalysis {
  hasConflicts: boolean;
  conflicts: AssignmentConflict[];
  resolutionStrategies: string[];
}

export interface AssignmentConflict {
  type: 'task_already_assigned' | 'agent_overloaded' | 'skill_mismatch' | 'dependency_violation' | 'resource_conflict';
  description: string;
  severity: 'blocking' | 'warning' | 'info';
  involvedAgents: string[];
  involvedTasks: string[];
  suggestedResolution: string;
}

export interface ValidatorConfig {
  kanbanPath: string;
  agentsDir: string;
  maxWorkloadPerAgent: number;
  skillMatchThreshold: number;
  overloadWarningThreshold: number;
  staleTaskThresholdHours: number;
  enableAdvancedValidation: boolean;
}

export class AgentAssignmentValidator {
  private config: ValidatorConfig;
  private git: ReturnType<typeof simpleGit>;

  constructor(config?: Partial<ValidatorConfig>) {
    this.config = {
      kanbanPath: join(process.cwd(), 'kanban.yaml'),
      agentsDir: join(process.cwd(), 'agents'),
      maxWorkloadPerAgent: 2, // Max concurrent tasks
      skillMatchThreshold: 30, // Minimum skill match percentage
      overloadWarningThreshold: 80, // Warn when agent is 80% loaded
      staleTaskThresholdHours: 48, // Task is stale after 48 hours
      enableAdvancedValidation: true,
      ...config
    };

    this.git = simpleGit(process.cwd());
  }

  /**
   * Load kanban board with error handling
   */
  private async loadKanbanBoard(): Promise<KanbanBoard> {
    try {
      if (!existsSync(this.config.kanbanPath)) {
        throw new Error(`Kanban file not found: ${this.config.kanbanPath}`);
      }

      const content = readFileSync(this.config.kanbanPath, 'utf8');
      const kanban = yaml.load(content) as KanbanBoard;

      if (!kanban.agents || !kanban.tasks || !kanban.metadata) {
        throw new Error('Invalid kanban structure');
      }

      return kanban;
    } catch (error) {
      throw new Error(`Failed to load kanban board: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validate an agent assignment before execution
   */
  async validateAssignment(
    agentId: string, 
    taskId: string, 
    bypassWarnings: boolean = false
  ): Promise<AssignmentValidationResult> {
    console.log(chalk.blue(`[ASSIGN-VALIDATOR] 🔍 Validating assignment: ${agentId} → ${taskId}`));

    try {
      const kanban = await this.loadKanbanBoard();
      const errors: ValidationError[] = [];
      const warnings: ValidationWarning[] = [];
      const recommendations: string[] = [];

      // Load task and agent data
      const task = this.findTaskById(taskId, kanban);
      const agentStatus = kanban.agents[agentId];

      // Core validation checks
      await this.validateBasicRequirements(agentId, taskId, task, agentStatus, errors);
      await this.validateAgentCapacity(agentId, agentStatus, kanban, errors, warnings);
      await this.validateTaskEligibility(task, kanban, errors, warnings);
      await this.validateSkillMatch(agentId, task, kanban, warnings, recommendations);
      
      if (this.config.enableAdvancedValidation) {
        await this.validateDependencies(task, kanban, errors, warnings);
        await this.validateResourceConflicts(agentId, task, kanban, warnings);
        await this.validateWorkloadDistribution(agentId, kanban, warnings, recommendations);
      }

      // Calculate assignment score and confidence
      const assignmentScore = this.calculateAssignmentScore(agentId, task, kanban);
      const confidence = this.calculateConfidence(errors, warnings, assignmentScore);

      // Generate recommendations
      this.generateRecommendations(agentId, task, kanban, assignmentScore, recommendations);

      // Determine overall validity
      const blockingErrors = errors.filter(e => e.severity === 'blocking');
      const criticalErrors = errors.filter(e => e.severity === 'critical');
      const valid = blockingErrors.length === 0 && (bypassWarnings || criticalErrors.length === 0);

      if (!valid) {
        console.log(chalk.red(`[ASSIGN-VALIDATOR] ❌ Validation failed: ${blockingErrors.length} blocking, ${criticalErrors.length} critical errors`));
      } else if (warnings.length > 0) {
        console.log(chalk.yellow(`[ASSIGN-VALIDATOR] ⚠️  Validation passed with ${warnings.length} warnings`));
      } else {
        console.log(chalk.green(`[ASSIGN-VALIDATOR] ✅ Validation passed (score: ${assignmentScore})`));
      }

      return {
        valid,
        confidence,
        errors,
        warnings,
        recommendations,
        assignmentScore
      };

    } catch (error) {
      console.error(chalk.red(`[ASSIGN-VALIDATOR] 💥 Validation error: ${error}`));
      
      return {
        valid: false,
        confidence: 0,
        errors: [{
          code: 'VALIDATION_ERROR',
          message: `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
          severity: 'blocking',
          resolution: 'Fix validation system errors and retry'
        }],
        warnings: [],
        recommendations: [],
        assignmentScore: 0
      };
    }
  }

  /**
   * Validate basic assignment requirements
   */
  private async validateBasicRequirements(
    agentId: string,
    taskId: string,
    task: Task | null,
    agentStatus: AgentStatus | undefined,
    errors: ValidationError[]
  ): Promise<void> {
    // Validate agent ID format
    if (!/^agent-\d{3}$/.test(agentId)) {
      errors.push({
        code: 'INVALID_AGENT_ID',
        message: `Invalid agent ID format: ${agentId}`,
        severity: 'blocking',
        resolution: 'Use valid agent ID format (agent-001, agent-002, etc.)',
        affectedAgent: agentId
      });
    }

    // Validate task exists
    if (!task) {
      errors.push({
        code: 'TASK_NOT_FOUND',
        message: `Task ${taskId} not found`,
        severity: 'blocking',
        resolution: 'Verify task ID exists in kanban board',
        affectedTask: taskId
      });
      return; // Can't continue without valid task
    }

    // Validate task is not already assigned
    if (task.assignee && task.assignee !== agentId) {
      errors.push({
        code: 'TASK_ALREADY_ASSIGNED',
        message: `Task ${taskId} is already assigned to ${task.assignee}`,
        severity: 'blocking',
        resolution: `Unassign task from ${task.assignee} or choose different task`,
        affectedTask: taskId,
        affectedAgent: task.assignee
      });
    }

    // Validate agent exists (create if needed)
    if (!agentStatus) {
      // This is actually OK - agent will be created
      console.log(chalk.yellow(`[ASSIGN-VALIDATOR] ℹ️  Agent ${agentId} will be created`));
    } else {
      // Validate agent is available or can be reassigned
      if (agentStatus.status === 'offline') {
        errors.push({
          code: 'AGENT_OFFLINE',
          message: `Agent ${agentId} is offline`,
          severity: 'critical',
          resolution: 'Bring agent online or choose different agent',
          affectedAgent: agentId
        });
      } else if (agentStatus.status === 'blocked') {
        errors.push({
          code: 'AGENT_BLOCKED',
          message: `Agent ${agentId} is blocked`,
          severity: 'high',
          resolution: 'Resolve agent blocking issues or choose different agent',
          affectedAgent: agentId
        });
      }
    }
  }

  /**
   * Validate agent capacity and workload
   */
  private async validateAgentCapacity(
    agentId: string,
    agentStatus: AgentStatus | undefined,
    kanban: KanbanBoard,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): Promise<void> {
    if (!agentStatus) return; // Agent will be created

    const capacity = await this.calculateAgentCapacity(agentId, kanban);

    // Check workload
    if (capacity.currentWorkload >= 100) {
      errors.push({
        code: 'AGENT_OVERLOADED',
        message: `Agent ${agentId} is at maximum capacity (${capacity.currentWorkload}%)`,
        severity: 'blocking',
        resolution: 'Complete existing tasks or choose different agent',
        affectedAgent: agentId
      });
    } else if (capacity.currentWorkload >= this.config.overloadWarningThreshold) {
      warnings.push({
        code: 'AGENT_HIGH_WORKLOAD',
        message: `Agent ${agentId} has high workload (${capacity.currentWorkload}%)`,
        impact: 'May affect task completion time',
        suggestion: 'Consider load balancing or choosing less loaded agent'
      });
    }

    // Check availability
    if (capacity.availability < 50) {
      warnings.push({
        code: 'AGENT_LOW_AVAILABILITY',
        message: `Agent ${agentId} has low availability (${capacity.availability}%)`,
        impact: 'Task may be delayed',
        suggestion: 'Check agent status and recent activity'
      });
    }

    // Check for stale assignments
    if (agentStatus.status === 'working' && agentStatus.last_active) {
      const lastActive = new Date(agentStatus.last_active);
      const staleThreshold = this.config.staleTaskThresholdHours * 60 * 60 * 1000;
      
      if (Date.now() - lastActive.getTime() > staleThreshold) {
        warnings.push({
          code: 'AGENT_STALE_ASSIGNMENT',
          message: `Agent ${agentId} has been working on current task for ${Math.round((Date.now() - lastActive.getTime()) / (60 * 60 * 1000))} hours`,
          impact: 'May indicate blocked or abandoned work',
          suggestion: 'Check agent progress and consider reassignment'
        });
      }
    }
  }

  /**
   * Validate task eligibility for assignment
   */
  private async validateTaskEligibility(
    task: Task | null,
    kanban: KanbanBoard,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): Promise<void> {
    if (!task) return;

    // Check task is in assignable state
    const taskLocation = this.findTaskLocation(task.id, kanban);
    const assignableStates = ['backlog', 'todo'];
    
    if (!assignableStates.includes(taskLocation)) {
      if (taskLocation === 'done') {
        errors.push({
          code: 'TASK_ALREADY_COMPLETED',
          message: `Task ${task.id} is already completed`,
          severity: 'blocking',
          resolution: 'Choose a different task',
          affectedTask: task.id
        });
      } else if (taskLocation === 'in_progress') {
        errors.push({
          code: 'TASK_IN_PROGRESS',
          message: `Task ${task.id} is already in progress`,
          severity: 'critical',
          resolution: 'Verify task status or reassign from current agent',
          affectedTask: task.id
        });
      } else if (taskLocation === 'review') {
        warnings.push({
          code: 'TASK_IN_REVIEW',
          message: `Task ${task.id} is currently in review`,
          impact: 'May need review completion first',
          suggestion: 'Consider completing review process or moving back to backlog'
        });
      }
    }

    // Check for missing required fields
    if (!task.title || task.title.trim() === '') {
      errors.push({
        code: 'TASK_MISSING_TITLE',
        message: `Task ${task.id} has no title`,
        severity: 'high',
        resolution: 'Add task title before assignment',
        affectedTask: task.id
      });
    }

    if (!task.description || task.description.trim() === '') {
      warnings.push({
        code: 'TASK_MISSING_DESCRIPTION',
        message: `Task ${task.id} has no description`,
        impact: 'Agent may not understand requirements',
        suggestion: 'Add detailed task description'
      });
    }

    if (!task.requirements || task.requirements.length === 0) {
      warnings.push({
        code: 'TASK_MISSING_REQUIREMENTS',
        message: `Task ${task.id} has no requirements defined`,
        impact: 'Unclear success criteria',
        suggestion: 'Define specific task requirements'
      });
    }

    // Check estimated hours
    if (!task.estimated_hours || task.estimated_hours <= 0) {
      warnings.push({
        code: 'TASK_MISSING_ESTIMATION',
        message: `Task ${task.id} has no time estimation`,
        impact: 'Difficult to plan and prioritize',
        suggestion: 'Add realistic time estimation'
      });
    } else if (task.estimated_hours > 40) {
      warnings.push({
        code: 'TASK_LARGE_ESTIMATION',
        message: `Task ${task.id} has large time estimation (${task.estimated_hours}h)`,
        impact: 'May be too complex for single assignment',
        suggestion: 'Consider breaking into smaller tasks'
      });
    }
  }

  /**
   * Validate skill match between agent and task
   */
  private async validateSkillMatch(
    agentId: string,
    task: Task | null,
    kanban: KanbanBoard,
    warnings: ValidationWarning[],
    recommendations: string[]
  ): Promise<void> {
    if (!task) return;

    const skillMatch = this.calculateSkillMatch(agentId, task, kanban);
    
    if (skillMatch < this.config.skillMatchThreshold) {
      warnings.push({
        code: 'LOW_SKILL_MATCH',
        message: `Agent ${agentId} has low skill match for task ${task.id} (${skillMatch}%)`,
        impact: 'May require additional time or training',
        suggestion: 'Consider agent with better skill alignment'
      });
    } else if (skillMatch >= 80) {
      recommendations.push(`✅ Excellent skill match (${skillMatch}%) for ${agentId}`);
    } else if (skillMatch >= 60) {
      recommendations.push(`✅ Good skill match (${skillMatch}%) for ${agentId}`);
    }

    // Check for overspecialization
    const agentSpecialties = kanban.assignment_rules?.agent_specialties?.[agentId] || [];
    const taskLabels = task.labels || [];
    
    const specialtyOverlap = agentSpecialties.filter(specialty => 
      taskLabels.some(label => label.toLowerCase().includes(specialty.toLowerCase()))
    );

    if (specialtyOverlap.length === 0 && agentSpecialties.length > 0) {
      warnings.push({
        code: 'SPECIALTY_MISMATCH',
        message: `Agent ${agentId} specializes in [${agentSpecialties.join(', ')}] but task involves [${taskLabels.join(', ')}]`,
        impact: 'May not leverage agent expertise optimally',
        suggestion: 'Consider if this assignment provides learning opportunities or if better matched agent available'
      });
    }
  }

  /**
   * Validate task dependencies
   */
  private async validateDependencies(
    task: Task | null,
    kanban: KanbanBoard,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): Promise<void> {
    if (!task || !task.dependencies || task.dependencies.length === 0) return;

    for (const dependencyId of task.dependencies) {
      const dependency = this.findTaskById(dependencyId, kanban);
      
      if (!dependency) {
        errors.push({
          code: 'DEPENDENCY_NOT_FOUND',
          message: `Dependency task ${dependencyId} not found for task ${task.id}`,
          severity: 'high',
          resolution: 'Remove invalid dependency or create missing task',
          affectedTask: task.id
        });
        continue;
      }

      const dependencyLocation = this.findTaskLocation(dependencyId, kanban);
      
      if (dependencyLocation !== 'done') {
        if (dependencyLocation === 'backlog' || dependencyLocation === 'todo') {
          warnings.push({
            code: 'DEPENDENCY_NOT_STARTED',
            message: `Dependency ${dependencyId} is not started (in ${dependencyLocation})`,
            impact: 'Task may be blocked',
            suggestion: 'Consider starting dependency first or removing dependency'
          });
        } else {
          warnings.push({
            code: 'DEPENDENCY_IN_PROGRESS',
            message: `Dependency ${dependencyId} is ${dependencyLocation}`,
            impact: 'Task may need to wait',
            suggestion: 'Monitor dependency progress'
          });
        }
      }
    }
  }

  /**
   * Validate resource conflicts
   */
  private async validateResourceConflicts(
    agentId: string,
    task: Task | null,
    kanban: KanbanBoard,
    warnings: ValidationWarning[]
  ): Promise<void> {
    if (!task) return;

    // Check for file conflicts with other agents
    const activeAgents = Object.entries(kanban.agents)
      .filter(([id, status]) => id !== agentId && status.status === 'working')
      .map(([id, status]) => ({ id, taskId: status.current_task }));

    for (const activeAgent of activeAgents) {
      if (!activeAgent.taskId) continue;
      
      const otherTask = this.findTaskById(activeAgent.taskId, kanban);
      if (!otherTask) continue;

      // Check for overlapping files
      const taskFiles = task.files || [];
      const otherFiles = otherTask.files || [];
      
      const overlappingFiles = taskFiles.filter(file => 
        otherFiles.some(otherFile => 
          file.includes(otherFile) || otherFile.includes(file) || 
          this.arePathsOverlapping(file, otherFile)
        )
      );

      if (overlappingFiles.length > 0) {
        warnings.push({
          code: 'FILE_CONFLICT',
          message: `Potential file conflicts with ${activeAgent.id} on files: ${overlappingFiles.join(', ')}`,
          impact: 'May cause merge conflicts or coordination issues',
          suggestion: 'Coordinate with other agent or sequence work to avoid conflicts'
        });
      }
    }
  }

  /**
   * Validate workload distribution across agents
   */
  private async validateWorkloadDistribution(
    agentId: string,
    kanban: KanbanBoard,
    warnings: ValidationWarning[],
    recommendations: string[]
  ): Promise<void> {
    const capacities = await Promise.all(
      Object.keys(kanban.agents).map(id => this.calculateAgentCapacity(id, kanban))
    );

    const targetCapacity = await this.calculateAgentCapacity(agentId, kanban);
    const avgWorkload = capacities.reduce((sum, cap) => sum + cap.currentWorkload, 0) / capacities.length;

    // Check if this assignment would create imbalance
    const projectedWorkload = targetCapacity.currentWorkload + (100 / this.config.maxWorkloadPerAgent);
    
    if (projectedWorkload > avgWorkload * 1.5) {
      warnings.push({
        code: 'WORKLOAD_IMBALANCE',
        message: `Assignment would create workload imbalance (${Math.round(projectedWorkload)}% vs ${Math.round(avgWorkload)}% average)`,
        impact: 'Uneven resource utilization',
        suggestion: 'Consider distributing work more evenly across available agents'
      });
    }

    // Find better balanced alternatives
    const availableAgents = capacities.filter(cap => 
      cap.currentWorkload < this.config.overloadWarningThreshold &&
      cap.agentId !== agentId
    );

    if (availableAgents.length > 0 && targetCapacity.currentWorkload > avgWorkload) {
      const bestAlternative = availableAgents.reduce((best, current) => 
        current.currentWorkload < best.currentWorkload ? current : best
      );

      recommendations.push(`💡 Agent ${bestAlternative.agentId} has lower workload (${bestAlternative.currentWorkload}%) and might be a better choice`);
    }
  }

  /**
   * Calculate agent capacity metrics
   */
  private async calculateAgentCapacity(agentId: string, kanban: KanbanBoard): Promise<AgentCapacity> {
    const agentStatus = kanban.agents[agentId];
    
    if (!agentStatus) {
      return {
        agentId,
        status: 'available',
        currentWorkload: 0,
        skillMatch: 0,
        availability: 100,
        lastActive: null
      };
    }

    // Calculate current workload
    const activeTasks = Object.values(kanban.tasks.in_progress)
      .filter(task => task.assignee === agentId).length;
    const currentWorkload = Math.round((activeTasks / this.config.maxWorkloadPerAgent) * 100);

    // Calculate availability based on status and activity
    let availability = 100;
    if (agentStatus.status === 'offline') availability = 0;
    else if (agentStatus.status === 'blocked') availability = 25;
    else if (agentStatus.status === 'working') availability = Math.max(0, 100 - currentWorkload);

    // Factor in last activity
    let lastActive: Date | null = null;
    if (agentStatus.last_active) {
      lastActive = new Date(agentStatus.last_active);
      const hoursSinceActive = (Date.now() - lastActive.getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceActive > 24) {
        availability *= 0.7; // Reduce availability for inactive agents
      }
    }

    return {
      agentId,
      status: agentStatus.status,
      currentWorkload: Math.min(currentWorkload, 100),
      skillMatch: 0, // Will be calculated per task
      availability: Math.round(availability),
      lastActive
    };
  }

  /**
   * Calculate skill match between agent and task
   */
  private calculateSkillMatch(agentId: string, task: Task, kanban: KanbanBoard): number {
    const agentSpecialties = kanban.assignment_rules?.agent_specialties?.[agentId] || [];
    
    if (agentSpecialties.length === 0) return 50; // Neutral score if no specialties defined

    const taskKeywords = `${task.title} ${task.description} ${task.labels.join(' ')}`.toLowerCase();
    const taskWords = taskKeywords.split(/\s+/);

    let matchScore = 0;
    let maxPossibleScore = 0;

    for (const specialty of agentSpecialties) {
      maxPossibleScore += 10;
      
      // Direct specialty match in labels
      if (task.labels.some(label => label.toLowerCase().includes(specialty.toLowerCase()))) {
        matchScore += 10;
      }
      // Specialty keyword in title/description
      else if (taskWords.some(word => word.includes(specialty.toLowerCase()))) {
        matchScore += 7;
      }
      // Partial specialty match
      else if (taskKeywords.includes(specialty.toLowerCase())) {
        matchScore += 3;
      }
    }

    return maxPossibleScore > 0 ? Math.round((matchScore / maxPossibleScore) * 100) : 50;
  }

  /**
   * Calculate overall assignment score
   */
  private calculateAssignmentScore(agentId: string, task: Task | null, kanban: KanbanBoard): number {
    if (!task) return 0;

    const capacity = kanban.agents[agentId] ? 100 - (kanban.agents[agentId].status === 'working' ? 50 : 0) : 100;
    const skillMatch = this.calculateSkillMatch(agentId, task, kanban);
    const priority = task.priority === 'critical' ? 100 : task.priority === 'high' ? 80 : task.priority === 'normal' ? 60 : 40;
    
    // Weighted scoring
    return Math.round(
      (capacity * 0.3) + 
      (skillMatch * 0.4) + 
      (priority * 0.2) + 
      (task.estimated_hours <= 8 ? 10 : 0) // Bonus for reasonable scope
    );
  }

  /**
   * Calculate validation confidence
   */
  private calculateConfidence(errors: ValidationError[], warnings: ValidationWarning[], assignmentScore: number): number {
    const errorPenalty = errors.reduce((penalty, error) => {
      switch (error.severity) {
        case 'blocking': return penalty + 50;
        case 'critical': return penalty + 30;
        case 'high': return penalty + 20;
        case 'medium': return penalty + 10;
        case 'low': return penalty + 5;
        default: return penalty;
      }
    }, 0);

    const warningPenalty = warnings.length * 5;
    const scoreFactor = assignmentScore / 100;

    return Math.max(0, Math.min(1, (100 - errorPenalty - warningPenalty) / 100 * scoreFactor));
  }

  /**
   * Generate assignment recommendations
   */
  private generateRecommendations(
    agentId: string,
    task: Task | null,
    kanban: KanbanBoard,
    assignmentScore: number,
    recommendations: string[]
  ): void {
    if (!task) return;

    if (assignmentScore >= 80) {
      recommendations.push('🎯 Excellent assignment match - proceed with confidence');
    } else if (assignmentScore >= 60) {
      recommendations.push('✅ Good assignment match - acceptable choice');
    } else if (assignmentScore >= 40) {
      recommendations.push('⚠️  Marginal assignment match - consider alternatives');
    } else {
      recommendations.push('❌ Poor assignment match - strongly consider different agent or task');
    }

    // Suggest improvements
    if (task.estimated_hours > 16) {
      recommendations.push('💡 Consider breaking large task into smaller, more manageable pieces');
    }

    if (!task.requirements || task.requirements.length === 0) {
      recommendations.push('📋 Add specific requirements to improve task clarity');
    }

    if (task.dependencies && task.dependencies.length > 3) {
      recommendations.push('🔗 Review dependencies - too many may indicate overly complex task');
    }

    const agentStatus = kanban.agents[agentId];
    if (agentStatus?.status === 'working') {
      recommendations.push('⏱️  Agent is currently working - ensure capacity for additional work');
    }
  }

  /**
   * Analyze assignment conflicts
   */
  async analyzeConflicts(agentId: string, taskId: string): Promise<ConflictAnalysis> {
    console.log(chalk.blue(`[ASSIGN-VALIDATOR] 🔍 Analyzing conflicts for ${agentId} → ${taskId}`));

    const conflicts: AssignmentConflict[] = [];
    const resolutionStrategies: string[] = [];

    try {
      const kanban = await this.loadKanbanBoard();
      const task = this.findTaskById(taskId, kanban);
      const agentStatus = kanban.agents[agentId];

      // Check for task assignment conflicts
      if (task?.assignee && task.assignee !== agentId) {
        conflicts.push({
          type: 'task_already_assigned',
          description: `Task ${taskId} is currently assigned to ${task.assignee}`,
          severity: 'blocking',
          involvedAgents: [agentId, task.assignee],
          involvedTasks: [taskId],
          suggestedResolution: `Unassign task from ${task.assignee} or choose different task`
        });

        resolutionStrategies.push(`Resolve assignment conflict with ${task.assignee}`);
      }

      // Check for agent overload
      if (agentStatus?.status === 'working') {
        const capacity = await this.calculateAgentCapacity(agentId, kanban);
        if (capacity.currentWorkload >= this.config.overloadWarningThreshold) {
          conflicts.push({
            type: 'agent_overloaded',
            description: `Agent ${agentId} is approaching capacity (${capacity.currentWorkload}%)`,
            severity: 'warning',
            involvedAgents: [agentId],
            involvedTasks: [taskId],
            suggestedResolution: 'Complete existing tasks or redistribute workload'
          });

          resolutionStrategies.push('Balance workload across available agents');
        }
      }

      // Check for skill mismatches
      if (task) {
        const skillMatch = this.calculateSkillMatch(agentId, task, kanban);
        if (skillMatch < this.config.skillMatchThreshold) {
          conflicts.push({
            type: 'skill_mismatch',
            description: `Agent ${agentId} has low skill match (${skillMatch}%) for task ${taskId}`,
            severity: 'warning',
            involvedAgents: [agentId],
            involvedTasks: [taskId],
            suggestedResolution: 'Consider agent with better skill alignment or provide additional training'
          });

          resolutionStrategies.push('Improve skill alignment or provide training');
        }
      }

      // Check dependency violations
      if (task?.dependencies && task.dependencies.length > 0) {
        const incompleteDependencies = task.dependencies.filter(depId => {
          const dep = this.findTaskById(depId, kanban);
          return dep && this.findTaskLocation(depId, kanban) !== 'done';
        });

        if (incompleteDependencies.length > 0) {
          conflicts.push({
            type: 'dependency_violation',
            description: `Task ${taskId} has ${incompleteDependencies.length} incomplete dependencies`,
            severity: 'warning',
            involvedAgents: [agentId],
            involvedTasks: [taskId, ...incompleteDependencies],
            suggestedResolution: 'Complete dependencies first or remove dependency constraints'
          });

          resolutionStrategies.push('Sequence work to respect dependencies');
        }
      }

      return {
        hasConflicts: conflicts.length > 0,
        conflicts,
        resolutionStrategies: Array.from(new Set(resolutionStrategies)) // Remove duplicates
      };

    } catch (error) {
      console.error(chalk.red(`[ASSIGN-VALIDATOR] 💥 Conflict analysis failed: ${error}`));
      
      return {
        hasConflicts: true,
        conflicts: [{
          type: 'resource_conflict',
          description: `Analysis failed: ${error instanceof Error ? error.message : String(error)}`,
          severity: 'blocking',
          involvedAgents: [agentId],
          involvedTasks: [taskId],
          suggestedResolution: 'Fix validation system and retry'
        }],
        resolutionStrategies: ['Fix validation system errors']
      };
    }
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
   * Find which state/column a task is in
   */
  private findTaskLocation(taskId: string, kanban: KanbanBoard): string {
    for (const [state, tasks] of Object.entries(kanban.tasks)) {
      if ((tasks as Task[]).some(t => t.id === taskId)) {
        return state;
      }
    }
    return 'unknown';
  }

  /**
   * Check if two file paths might overlap
   */
  private arePathsOverlapping(path1: string, path2: string): boolean {
    const normalize = (path: string) => path.toLowerCase().replace(/\/$/, '');
    const p1 = normalize(path1);
    const p2 = normalize(path2);
    
    // Check if one path is a subset of another
    return p1.startsWith(p2) || p2.startsWith(p1);
  }

  /**
   * Get comprehensive validation report
   */
  async generateValidationReport(agentId: string, taskId: string): Promise<string> {
    const validation = await this.validateAssignment(agentId, taskId);
    const conflicts = await this.analyzeConflicts(agentId, taskId);

    const report = [
      '# Agent Assignment Validation Report',
      '',
      `**Agent:** ${agentId}`,
      `**Task:** ${taskId}`,
      `**Timestamp:** ${new Date().toISOString()}`,
      `**Overall Result:** ${validation.valid ? '✅ VALID' : '❌ INVALID'}`,
      `**Assignment Score:** ${validation.assignmentScore}/100`,
      `**Confidence:** ${Math.round(validation.confidence * 100)}%`,
      '',
      '## Validation Results',
      ''
    ];

    if (validation.errors.length > 0) {
      report.push('### ❌ Errors', '');
      validation.errors.forEach(error => {
        report.push(`**${error.code}** (${error.severity}): ${error.message}`);
        report.push(`*Resolution:* ${error.resolution}`);
        report.push('');
      });
    }

    if (validation.warnings.length > 0) {
      report.push('### ⚠️ Warnings', '');
      validation.warnings.forEach(warning => {
        report.push(`**${warning.code}**: ${warning.message}`);
        report.push(`*Impact:* ${warning.impact}`);
        report.push(`*Suggestion:* ${warning.suggestion}`);
        report.push('');
      });
    }

    if (conflicts.hasConflicts) {
      report.push('### 🔥 Conflicts', '');
      conflicts.conflicts.forEach(conflict => {
        report.push(`**${conflict.type}** (${conflict.severity}): ${conflict.description}`);
        report.push(`*Resolution:* ${conflict.suggestedResolution}`);
        report.push('');
      });
    }

    if (validation.recommendations.length > 0) {
      report.push('### 💡 Recommendations', '');
      validation.recommendations.forEach(rec => {
        report.push(`- ${rec}`);
      });
      report.push('');
    }

    return report.join('\n');
  }
}

// Export singleton instance
export const agentAssignmentValidator = new AgentAssignmentValidator();

// CLI interface for standalone usage - Check if this file is being run directly
const isMainModule = process.argv[1] && process.argv[1].endsWith('agent-assignment-validator.ts');

if (isMainModule) {
  const [,, command, ...args] = process.argv;

  const validator = new AgentAssignmentValidator();

  const handleCommand = async () => {
    try {
      switch (command) {
        case 'validate':
          const [agentId, taskId, bypassWarnings] = args;
          if (!agentId || !taskId) {
            console.error('Usage: node agent-assignment-validator.ts validate <agent-id> <task-id> [bypass-warnings]');
            process.exit(1);
          }
          const result = await validator.validateAssignment(agentId, taskId, bypassWarnings === 'true');
          console.log(JSON.stringify(result, null, 2));
          process.exit(result.valid ? 0 : 1);
          break;

        case 'conflicts':
          const [agentIdConflicts, taskIdConflicts] = args;
          if (!agentIdConflicts || !taskIdConflicts) {
            console.error('Usage: node agent-assignment-validator.ts conflicts <agent-id> <task-id>');
            process.exit(1);
          }
          const conflicts = await validator.analyzeConflicts(agentIdConflicts, taskIdConflicts);
          console.log(JSON.stringify(conflicts, null, 2));
          break;

        case 'report':
          const [agentIdReport, taskIdReport] = args;
          if (!agentIdReport || !taskIdReport) {
            console.error('Usage: node agent-assignment-validator.ts report <agent-id> <task-id>');
            process.exit(1);
          }
          const report = await validator.generateValidationReport(agentIdReport, taskIdReport);
          console.log(report);
          break;

        default:
          console.log('Available commands:');
          console.log('  validate <agent-id> <task-id> [bypass-warnings] - Validate assignment');
          console.log('  conflicts <agent-id> <task-id>                   - Analyze conflicts');
          console.log('  report <agent-id> <task-id>                     - Generate full report');
          break;
      }
    } catch (error) {
      console.error('Command failed:', error);
      process.exit(1);
    }
  };

  handleCommand();
}