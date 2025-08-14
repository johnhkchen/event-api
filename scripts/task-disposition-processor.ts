/**
 * Task Disposition Processor
 * 
 * Automated task categorization and disposition system for the Event API project.
 * Analyzes tasks, assigns priorities, routes to appropriate agents, and manages
 * workflow automation with intelligent categorization logic.
 */

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { Task, TaskPipeline, AgentStatus, KanbanBoard, AssignmentRules } from './types.js';

export interface TaskCategory {
  id: string;
  name: string;
  keywords: string[];
  priority: 'critical' | 'high' | 'normal' | 'low';
  estimatedHours: number;
  requiredSkills: string[];
  autoAssignable: boolean;
}

export interface DispositionRule {
  id: string;
  name: string;
  conditions: {
    keywords?: string[];
    priority?: ('critical' | 'high' | 'normal' | 'low')[];
    labels?: string[];
    estimatedHours?: { min?: number; max?: number };
    dependencies?: boolean;
  };
  actions: {
    assignToAgent?: string;
    moveToState?: keyof TaskPipeline;
    addLabels?: string[];
    setPriority?: 'critical' | 'high' | 'normal' | 'low';
    scheduleDelay?: number; // hours
    requireReview?: boolean;
  };
}

export interface DispositionResult {
  taskId: string;
  originalState: keyof TaskPipeline;
  newState: keyof TaskPipeline;
  assignedAgent?: string;
  appliedRules: string[];
  reasoning: string[];
  confidence: number;
}

export interface ProcessorConfig {
  kanbanPath: string;
  categories: TaskCategory[];
  rules: DispositionRule[];
  agentSpecialties: Record<string, string[]>;
  workloadBalancing: boolean;
  autoProcessing: boolean;
}

export class TaskDispositionProcessor {
  private config: ProcessorConfig;
  private taskCategories: Map<string, TaskCategory>;
  private dispositionRules: DispositionRule[];

  constructor(config?: Partial<ProcessorConfig>) {
    this.config = {
      kanbanPath: join(process.cwd(), 'kanban.yaml'),
      categories: this.getDefaultCategories(),
      rules: this.getDefaultRules(),
      agentSpecialties: {
        'agent-001': ['api', 'typescript', 'hono', 'database'],
        'agent-002': ['elixir', 'phoenix', 'processing', 'ai'],
        'agent-003': ['validation', 'testing', 'analysis', 'automation']
      },
      workloadBalancing: true,
      autoProcessing: false,
      ...config
    };

    this.taskCategories = new Map(this.config.categories.map(cat => [cat.id, cat]));
    this.dispositionRules = this.config.rules;
  }

  /**
   * Process all tasks in the kanban board
   */
  async processAllTasks(): Promise<DispositionResult[]> {
    console.log('🎯 Starting task disposition processing...');

    try {
      const kanban = await this.loadKanbanBoard();
      const results: DispositionResult[] = [];

      // Process tasks in each state
      for (const [state, tasks] of Object.entries(kanban.tasks)) {
        if (state === 'done') continue; // Skip completed tasks

        for (const task of tasks as Task[]) {
          const result = await this.processTask(task, state as keyof TaskPipeline, kanban);
          if (result) {
            results.push(result);
          }
        }
      }

      // Apply changes if auto-processing is enabled
      if (this.config.autoProcessing && results.length > 0) {
        await this.applyDispositionResults(results, kanban);
      }

      console.log(`✅ Processed ${results.length} task dispositions`);
      return results;

    } catch (error) {
      console.error('💥 Task processing failed:', error);
      throw new Error(`Task disposition error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Process a single task
   */
  async processTask(
    task: Task, 
    currentState: keyof TaskPipeline, 
    kanban: KanbanBoard
  ): Promise<DispositionResult | null> {
    try {
      // Categorize the task
      const category = this.categorizeTask(task);
      
      // Find applicable rules
      const applicableRules = this.findApplicableRules(task, category);
      
      // Calculate disposition
      const disposition = this.calculateDisposition(task, currentState, applicableRules, kanban);
      
      if (!disposition) return null;

      console.log(`📋 Task ${task.id}: ${disposition.originalState} → ${disposition.newState} (confidence: ${Math.round(disposition.confidence * 100)}%)`);
      
      return disposition;

    } catch (error) {
      console.error(`❌ Failed to process task ${task.id}:`, error);
      return null;
    }
  }

  /**
   * Categorize a task based on content analysis
   */
  private categorizeTask(task: Task): TaskCategory | null {
    const text = `${task.title} ${task.description} ${task.labels.join(' ')}`.toLowerCase();
    const words = text.split(/\s+/);

    let bestMatch: TaskCategory | null = null;
    let bestScore = 0;

    for (const category of this.config.categories) {
      let score = 0;
      
      // Keyword matching
      for (const keyword of category.keywords) {
        if (words.includes(keyword.toLowerCase())) {
          score += 2;
        } else if (text.includes(keyword.toLowerCase())) {
          score += 1;
        }
      }

      // Label matching
      for (const label of task.labels) {
        if (category.keywords.includes(label.toLowerCase())) {
          score += 3;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = category;
      }
    }

    return bestScore > 0 ? bestMatch : null;
  }

  /**
   * Find rules that apply to a task
   */
  private findApplicableRules(task: Task, category: TaskCategory | null): DispositionRule[] {
    return this.dispositionRules.filter(rule => {
      const conditions = rule.conditions;

      // Check keyword conditions
      if (conditions.keywords) {
        const text = `${task.title} ${task.description}`.toLowerCase();
        const hasKeyword = conditions.keywords.some(keyword => 
          text.includes(keyword.toLowerCase())
        );
        if (!hasKeyword) return false;
      }

      // Check priority conditions
      if (conditions.priority && !conditions.priority.includes(task.priority)) {
        return false;
      }

      // Check label conditions
      if (conditions.labels) {
        const hasLabel = conditions.labels.some(label => 
          task.labels.includes(label)
        );
        if (!hasLabel) return false;
      }

      // Check estimated hours conditions
      if (conditions.estimatedHours) {
        const { min, max } = conditions.estimatedHours;
        if (min !== undefined && task.estimated_hours < min) return false;
        if (max !== undefined && task.estimated_hours > max) return false;
      }

      // Check dependencies condition
      if (conditions.dependencies !== undefined) {
        const hasDependencies = task.dependencies.length > 0;
        if (conditions.dependencies !== hasDependencies) return false;
      }

      return true;
    });
  }

  /**
   * Calculate the best disposition for a task
   */
  private calculateDisposition(
    task: Task, 
    currentState: keyof TaskPipeline, 
    applicableRules: DispositionRule[],
    kanban: KanbanBoard
  ): DispositionResult | null {
    if (applicableRules.length === 0) return null;

    const reasoning: string[] = [];
    const appliedRuleIds: string[] = [];
    let newState = currentState;
    let assignedAgent: string | undefined;
    let confidence = 0;

    // Apply rules in priority order
    const sortedRules = applicableRules.sort((a, b) => {
      const priorityScore = { critical: 4, high: 3, normal: 2, low: 1 };
      const scoreA = task.labels.includes('critical') ? priorityScore.critical : priorityScore[task.priority];
      const scoreB = task.labels.includes('critical') ? priorityScore.critical : priorityScore[task.priority];
      return scoreB - scoreA;
    });

    for (const rule of sortedRules) {
      appliedRuleIds.push(rule.id);
      
      // Move to new state
      if (rule.actions.moveToState) {
        newState = rule.actions.moveToState;
        reasoning.push(`Rule "${rule.name}": Move to ${newState}`);
        confidence += 0.3;
      }

      // Assign to agent
      if (rule.actions.assignToAgent) {
        assignedAgent = rule.actions.assignToAgent;
        reasoning.push(`Rule "${rule.name}": Assign to ${assignedAgent}`);
        confidence += 0.4;
      } else if (this.config.workloadBalancing) {
        // Auto-assign based on workload and specialties
        assignedAgent = this.findBestAgent(task, kanban);
        if (assignedAgent) {
          reasoning.push(`Auto-assignment: ${assignedAgent} (workload balancing)`);
          confidence += 0.2;
        }
      }

      // Priority adjustment
      if (rule.actions.setPriority && rule.actions.setPriority !== task.priority) {
        reasoning.push(`Rule "${rule.name}": Priority ${task.priority} → ${rule.actions.setPriority}`);
        confidence += 0.1;
      }

      // Add labels
      if (rule.actions.addLabels && rule.actions.addLabels.length > 0) {
        reasoning.push(`Rule "${rule.name}": Add labels [${rule.actions.addLabels.join(', ')}]`);
      }

      // Review requirement
      if (rule.actions.requireReview) {
        reasoning.push(`Rule "${rule.name}": Requires review before completion`);
      }

      // Schedule delay
      if (rule.actions.scheduleDelay) {
        reasoning.push(`Rule "${rule.name}": Schedule delay ${rule.actions.scheduleDelay}h`);
      }
    }

    // Validate state transition
    if (!this.isValidStateTransition(currentState, newState, task)) {
      reasoning.push(`Invalid transition ${currentState} → ${newState}, staying in ${currentState}`);
      newState = currentState;
      confidence *= 0.5;
    }

    // Ensure minimum confidence threshold
    if (confidence < 0.3) return null;

    return {
      taskId: task.id,
      originalState: currentState,
      newState,
      assignedAgent,
      appliedRules: appliedRuleIds,
      reasoning,
      confidence: Math.min(confidence, 1.0)
    };
  }

  /**
   * Find the best agent for a task based on skills and workload
   */
  private findBestAgent(task: Task, kanban: KanbanBoard): string | undefined {
    const availableAgents = Object.entries(kanban.agents)
      .filter(([_, status]) => status.status === 'available' || status.status === 'working')
      .map(([agentId, status]) => ({ agentId, status }));

    if (availableAgents.length === 0) return undefined;

    // Calculate agent scores based on skills and workload
    const agentScores = availableAgents.map(({ agentId, status }) => {
      let score = 0;

      // Skill match scoring
      const agentSkills = this.config.agentSpecialties[agentId] || [];
      const taskKeywords = `${task.title} ${task.description} ${task.labels.join(' ')}`.toLowerCase().split(/\s+/);
      
      for (const skill of agentSkills) {
        if (taskKeywords.some(keyword => keyword.includes(skill.toLowerCase()))) {
          score += 10;
        }
      }

      // Workload penalty (prefer agents with lighter workloads)
      if (status.status === 'working') {
        score -= 5;
      }

      // Priority bonus
      if (task.priority === 'critical') score += 15;
      if (task.priority === 'high') score += 10;

      return { agentId, score };
    });

    // Sort by score and return the best agent
    agentScores.sort((a, b) => b.score - a.score);
    return agentScores[0]?.agentId;
  }

  /**
   * Validate if a state transition is allowed
   */
  private isValidStateTransition(
    fromState: keyof TaskPipeline, 
    toState: keyof TaskPipeline, 
    task: Task
  ): boolean {
    // Define valid transitions
    const validTransitions: Record<keyof TaskPipeline, (keyof TaskPipeline)[]> = {
      backlog: ['todo', 'in_progress'],
      todo: ['in_progress', 'backlog'],
      in_progress: ['review', 'todo', 'backlog'],
      review: ['done', 'in_progress', 'todo'],
      done: [] // Done tasks shouldn't move
    };

    const allowedTransitions = validTransitions[fromState] || [];
    return allowedTransitions.includes(toState);
  }

  /**
   * Apply disposition results to the kanban board
   */
  private async applyDispositionResults(results: DispositionResult[], kanban: KanbanBoard): Promise<void> {
    console.log('📝 Applying disposition changes...');

    for (const result of results) {
      // Find and move the task
      const task = this.findTaskById(result.taskId, kanban);
      if (!task) continue;

      // Remove from original state
      const originalTasks = kanban.tasks[result.originalState];
      const taskIndex = originalTasks.findIndex(t => t.id === result.taskId);
      if (taskIndex !== -1) {
        originalTasks.splice(taskIndex, 1);
      }

      // Assign agent if specified
      if (result.assignedAgent) {
        task.assignee = result.assignedAgent;
        
        // Update agent status
        if (kanban.agents[result.assignedAgent]) {
          kanban.agents[result.assignedAgent].status = 'working';
          kanban.agents[result.assignedAgent].current_task = result.taskId;
        }
      }

      // Add to new state
      kanban.tasks[result.newState].push(task);

      console.log(`✅ Moved task ${result.taskId}: ${result.originalState} → ${result.newState}`);
    }

    // Save updated kanban board
    await this.saveKanbanBoard(kanban);
    console.log('💾 Kanban board updated successfully');
  }

  /**
   * Find a task by ID across all states
   */
  private findTaskById(taskId: string, kanban: KanbanBoard): Task | undefined {
    for (const tasks of Object.values(kanban.tasks)) {
      const task = (tasks as Task[]).find(t => t.id === taskId);
      if (task) return task;
    }
    return undefined;
  }

  /**
   * Load kanban board from YAML file
   */
  private async loadKanbanBoard(): Promise<KanbanBoard> {
    try {
      const yamlContent = await readFile(this.config.kanbanPath, 'utf-8');
      // Simple YAML parsing - in production, use a proper YAML parser
      return JSON.parse(yamlContent) as KanbanBoard;
    } catch (error) {
      throw new Error(`Failed to load kanban board: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Save kanban board to YAML file
   */
  private async saveKanbanBoard(kanban: KanbanBoard): Promise<void> {
    try {
      // Update metadata
      kanban.metadata.last_updated = new Date().toISOString();
      
      // Simple YAML writing - in production, use a proper YAML writer
      const yamlContent = JSON.stringify(kanban, null, 2);
      await writeFile(this.config.kanbanPath, yamlContent, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save kanban board: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get default task categories
   */
  private getDefaultCategories(): TaskCategory[] {
    return [
      {
        id: 'api-development',
        name: 'API Development',
        keywords: ['api', 'endpoint', 'route', 'http', 'rest', 'hono'],
        priority: 'high',
        estimatedHours: 8,
        requiredSkills: ['typescript', 'hono', 'api'],
        autoAssignable: true
      },
      {
        id: 'database',
        name: 'Database Operations',
        keywords: ['database', 'sql', 'migration', 'schema', 'postgres', 'drizzle'],
        priority: 'high',
        estimatedHours: 6,
        requiredSkills: ['database', 'sql'],
        autoAssignable: true
      },
      {
        id: 'elixir-processing',
        name: 'Elixir Processing',
        keywords: ['elixir', 'phoenix', 'genserver', 'otp', 'processing'],
        priority: 'normal',
        estimatedHours: 10,
        requiredSkills: ['elixir', 'phoenix'],
        autoAssignable: true
      },
      {
        id: 'testing',
        name: 'Testing & QA',
        keywords: ['test', 'spec', 'coverage', 'quality', 'validation'],
        priority: 'normal',
        estimatedHours: 4,
        requiredSkills: ['testing', 'validation'],
        autoAssignable: true
      },
      {
        id: 'ai-integration',
        name: 'AI Integration',
        keywords: ['ai', 'ml', 'openai', 'baml', 'embedding', 'vector'],
        priority: 'high',
        estimatedHours: 12,
        requiredSkills: ['ai', 'python', 'integration'],
        autoAssignable: false
      },
      {
        id: 'critical-bug',
        name: 'Critical Bug Fix',
        keywords: ['bug', 'critical', 'urgent', 'production', 'error'],
        priority: 'critical',
        estimatedHours: 2,
        requiredSkills: [],
        autoAssignable: true
      },
      {
        id: 'infrastructure',
        name: 'Infrastructure',
        keywords: ['docker', 'deployment', 'ci', 'cd', 'infrastructure'],
        priority: 'normal',
        estimatedHours: 6,
        requiredSkills: ['devops', 'docker'],
        autoAssignable: false
      }
    ];
  }

  /**
   * Get default disposition rules
   */
  private getDefaultRules(): DispositionRule[] {
    return [
      {
        id: 'critical-priority',
        name: 'Critical Priority Processing',
        conditions: { priority: ['critical'] },
        actions: { 
          moveToState: 'in_progress',
          requireReview: false
        }
      },
      {
        id: 'ready-tasks',
        name: 'Ready Tasks to Todo',
        conditions: { 
          dependencies: false,
          estimatedHours: { max: 8 }
        },
        actions: { 
          moveToState: 'todo'
        }
      },
      {
        id: 'high-complexity',
        name: 'High Complexity Review',
        conditions: { 
          estimatedHours: { min: 12 }
        },
        actions: { 
          requireReview: true,
          addLabels: ['complex', 'review-required']
        }
      },
      {
        id: 'bug-fixes',
        name: 'Bug Fix Fast Track',
        conditions: { 
          keywords: ['bug', 'fix', 'error']
        },
        actions: { 
          moveToState: 'in_progress',
          setPriority: 'high'
        }
      },
      {
        id: 'testing-tasks',
        name: 'Testing Task Assignment',
        conditions: { 
          keywords: ['test', 'validation', 'quality']
        },
        actions: { 
          assignToAgent: 'agent-003'
        }
      },
      {
        id: 'api-development',
        name: 'API Development Assignment',
        conditions: { 
          keywords: ['api', 'endpoint', 'hono']
        },
        actions: { 
          assignToAgent: 'agent-001'
        }
      },
      {
        id: 'elixir-processing',
        name: 'Elixir Processing Assignment',
        conditions: { 
          keywords: ['elixir', 'phoenix', 'processing']
        },
        actions: { 
          assignToAgent: 'agent-002'
        }
      },
      {
        id: 'dependent-tasks',
        name: 'Dependent Tasks Hold',
        conditions: { 
          dependencies: true
        },
        actions: { 
          moveToState: 'backlog',
          scheduleDelay: 24
        }
      }
    ];
  }

  /**
   * Generate a disposition report
   */
  generateDispositionReport(results: DispositionResult[]): string {
    const report = [
      '# Task Disposition Report',
      '',
      `**Generated:** ${new Date().toISOString()}`,
      `**Tasks Processed:** ${results.length}`,
      '',
      '## Summary',
      ''
    ];

    // State transitions summary
    const stateTransitions = new Map<string, number>();
    const agentAssignments = new Map<string, number>();

    results.forEach(result => {
      const transition = `${result.originalState} → ${result.newState}`;
      stateTransitions.set(transition, (stateTransitions.get(transition) || 0) + 1);
      
      if (result.assignedAgent) {
        agentAssignments.set(result.assignedAgent, (agentAssignments.get(result.assignedAgent) || 0) + 1);
      }
    });

    report.push('### State Transitions', '');
    stateTransitions.forEach((count, transition) => {
      report.push(`- ${transition}: ${count} tasks`);
    });

    report.push('', '### Agent Assignments', '');
    agentAssignments.forEach((count, agent) => {
      report.push(`- ${agent}: ${count} tasks`);
    });

    report.push('', '## Task Details', '');

    results.forEach(result => {
      report.push(`### Task ${result.taskId}`);
      report.push(`**Transition:** ${result.originalState} → ${result.newState}`);
      if (result.assignedAgent) {
        report.push(`**Assigned to:** ${result.assignedAgent}`);
      }
      report.push(`**Confidence:** ${Math.round(result.confidence * 100)}%`);
      report.push(`**Applied Rules:** ${result.appliedRules.join(', ')}`);
      report.push('**Reasoning:**');
      result.reasoning.forEach(reason => {
        report.push(`- ${reason}`);
      });
      report.push('');
    });

    return report.join('\n');
  }
}

// CLI interface for standalone usage
if (process.argv[1] && process.argv[1].endsWith('task-disposition-processor.ts')) {
  const processor = new TaskDispositionProcessor({ 
    autoProcessing: process.argv.includes('--apply')
  });
  
  processor.processAllTasks()
    .then(results => {
      console.log('\n📊 Generating disposition report...');
      const report = processor.generateDispositionReport(results);
      console.log(report);
      
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Task disposition failed:', error);
      process.exit(1);
    });
}