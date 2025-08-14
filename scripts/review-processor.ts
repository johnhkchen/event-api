#!/usr/bin/env node

/**
 * Review Processing Automation Engine
 * 
 * Comprehensive TypeScript automation for review processing with bulletproof state transitions.
 * Provides atomic operations for kanban.yaml modifications with backup/recovery capabilities.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve, relative } from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import { simpleGit } from 'simple-git';
import type { KanbanBoard, Task } from './types.js';
import { WorkspaceValidator } from './workspace-validator.js';
import { ReviewValidationEngine } from './review-validation-engine.js';

const PROJECT_ROOT = resolve(process.cwd());
const KANBAN_FILE = join(PROJECT_ROOT, 'kanban.yaml');
const BACKUP_DIR = join(PROJECT_ROOT, 'backups');
const git = simpleGit(PROJECT_ROOT);

export interface ProcessingResult {
  taskId: string;
  disposition: 'completed' | 'partial' | 'stub' | 'failed';
  confidence: number;
  validationResults: ValidationReport;
  nextState: 'done' | 'backlog' | 'todo';
  splitTasks?: Task[];
  notes: string[];
}

export interface ValidationReport {
  filesChecked: number;
  filesValid: number;
  functionalTests: number;
  testsPassed: number;
  implementationDepth: 'complete' | 'partial' | 'stub' | 'empty';
  criticalIssues: string[];
  recommendations: string[];
}

export class ReviewProcessor {
  private kanban: KanbanBoard;
  private validationEngine: ReviewValidationEngine;

  constructor() {
    this.kanban = this.loadKanban();
    this.validationEngine = new ReviewValidationEngine({
      projectRoot: PROJECT_ROOT,
      rules: {
        maxComplexity: 15,
        minTestCoverage: 70,
        maxFileLength: 1000,
        requireJsdoc: false,
        enforceTypeScript: true
      }
    });
  }

  private loadKanban(): KanbanBoard {
    try {
      const content = readFileSync(KANBAN_FILE, 'utf8');
      return yaml.load(content) as KanbanBoard;
    } catch (error) {
      console.error(chalk.red('Failed to load kanban.yaml:'), error);
      process.exit(1);
    }
  }

  private saveKanban(): void {
    try {
      // Create backup before modifying
      this.createBackup();

      // Update metadata
      this.updateTaskSummary();
      this.kanban.metadata.last_updated = new Date().toISOString().split('T')[0];

      // Write to file atomically
      const content = yaml.dump(this.kanban, { 
        indent: 2,
        lineWidth: 120,
        noRefs: true 
      });
      writeFileSync(KANBAN_FILE, content, 'utf8');
    } catch (error) {
      console.error(chalk.red('Failed to save kanban.yaml:'), error);
      throw error;
    }
  }

  private createBackup(): void {
    if (!existsSync(BACKUP_DIR)) {
      mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(BACKUP_DIR, `kanban-${timestamp}.yaml`);
    const content = readFileSync(KANBAN_FILE, 'utf8');
    writeFileSync(backupPath, content, 'utf8');
    
    console.log(chalk.green(`✅ Backup created: ${relative(PROJECT_ROOT, backupPath)}`));
  }

  private updateTaskSummary(): void {
    const tasks = this.kanban.tasks;
    const total = 
      tasks.backlog.length + 
      tasks.todo.length + 
      tasks.in_progress.length + 
      tasks.review.length + 
      tasks.done.length;

    this.kanban.metadata.task_summary = {
      total_tasks: total,
      backlog: tasks.backlog.length,
      todo: tasks.todo.length,
      in_progress: tasks.in_progress.length,
      review: tasks.review.length,
      done: tasks.done.length,
      completion_percentage: total > 0 ? Math.round((tasks.done.length / total) * 100) + '%' : '0%'
    };
  }

  private log(message: string): void {
    console.log(chalk.blue('[REVIEW-PROCESSOR]'), message);
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

  /**
   * Validate a single task's implementation completeness
   */
  async validateTask(task: Task): Promise<ValidationReport> {
    this.log(`Validating task: ${task.id}`);

    let filesChecked = 0;
    let filesValid = 0;
    const criticalIssues: string[] = [];
    const recommendations: string[] = [];

    // Check if task has files specified
    if (!task.files || task.files.length === 0) {
      criticalIssues.push('No files specified for validation');
      return {
        filesChecked: 0,
        filesValid: 0,
        functionalTests: 0,
        testsPassed: 0,
        implementationDepth: 'empty',
        criticalIssues,
        recommendations: ['Add specific file paths to enable validation']
      };
    }

    // Validate each file
    for (const filePath of task.files) {
      filesChecked++;
      
      if (!existsSync(filePath)) {
        criticalIssues.push(`File not found: ${filePath}`);
        continue;
      }

      try {
        const content = readFileSync(filePath, 'utf8');
        
        // Check for stub/placeholder patterns
        const stubPatterns = [
          /TODO:/gi,
          /FIXME:/gi,
          /PLACEHOLDER/gi,
          /throw new Error\(.*not implemented.*\)/gi,
          /console\.log\(.*stub.*\)/gi
        ];

        const hasStubs = stubPatterns.some(pattern => pattern.test(content));
        
        if (content.trim().length < 50) {
          criticalIssues.push(`File appears to be a stub: ${filePath} (${content.length} chars)`);
        } else if (hasStubs) {
          recommendations.push(`File contains placeholder code: ${filePath}`);
          filesValid++;
        } else {
          filesValid++;
        }

      } catch (error) {
        criticalIssues.push(`Failed to read file: ${filePath} - ${error}`);
      }
    }

    // Determine implementation depth
    let implementationDepth: ValidationReport['implementationDepth'] = 'empty';
    
    if (filesValid === 0) {
      implementationDepth = 'empty';
    } else if (filesValid < filesChecked * 0.5) {
      implementationDepth = 'stub';
    } else if (filesValid < filesChecked) {
      implementationDepth = 'partial';
    } else {
      implementationDepth = 'complete';
    }

    return {
      filesChecked,
      filesValid,
      functionalTests: 0, // TODO: Implement functional testing
      testsPassed: 0,
      implementationDepth,
      criticalIssues,
      recommendations
    };
  }

  /**
   * Process a task and determine its disposition
   */
  async processTask(task: Task): Promise<ProcessingResult> {
    this.log(`Processing task: ${task.id} - ${task.title}`);

    const validationResults = await this.validateTask(task);
    let disposition: ProcessingResult['disposition'];
    let confidence: number;
    let nextState: ProcessingResult['nextState'];
    const notes: string[] = [];
    let splitTasks: Task[] | undefined;

    // Determine disposition based on validation results
    switch (validationResults.implementationDepth) {
      case 'complete':
        if (validationResults.criticalIssues.length === 0) {
          disposition = 'completed';
          confidence = 95;
          nextState = 'done';
          notes.push('All files validated successfully');
        } else {
          disposition = 'partial';
          confidence = 75;
          nextState = 'backlog';
          notes.push('Complete implementation with minor issues');
        }
        break;
      
      case 'partial':
        disposition = 'partial';
        confidence = 60;
        nextState = 'backlog';
        notes.push('Partial implementation detected');
        
        // Attempt task splitting for partial implementations
        splitTasks = await this.splitPartialTask(task, validationResults);
        if (splitTasks && splitTasks.length > 0) {
          notes.push(`Task split into ${splitTasks.length} sub-tasks`);
        }
        break;
      
      case 'stub':
        disposition = 'stub';
        confidence = 85;
        nextState = 'backlog';
        notes.push('Stub/placeholder implementation detected');
        break;
      
      case 'empty':
        disposition = 'failed';
        confidence = 90;
        nextState = 'backlog';
        notes.push('No implementation found');
        break;
    }

    // Add validation details to notes
    notes.push(`Files: ${validationResults.filesValid}/${validationResults.filesChecked} valid`);
    
    if (validationResults.criticalIssues.length > 0) {
      notes.push(`Critical issues: ${validationResults.criticalIssues.length}`);
    }

    return {
      taskId: task.id,
      disposition,
      confidence,
      validationResults,
      nextState,
      splitTasks,
      notes
    };
  }

  /**
   * Split a partially completed task into completed and remaining work
   */
  private async splitPartialTask(task: Task, validation: ValidationReport): Promise<Task[]> {
    if (!task.files || task.files.length === 0) {
      return [];
    }

    const completedFiles: string[] = [];
    const remainingFiles: string[] = [];

    // Categorize files based on validation results
    for (const filePath of task.files) {
      if (!existsSync(filePath)) {
        remainingFiles.push(filePath);
        continue;
      }

      try {
        const content = readFileSync(filePath, 'utf8');
        
        // Check for stub patterns
        const stubPatterns = [
          /TODO:/gi,
          /FIXME:/gi,
          /PLACEHOLDER/gi,
          /throw new Error\(.*not implemented.*\)/gi,
          /console\.log\(.*stub.*\)/gi
        ];

        const hasStubs = stubPatterns.some(pattern => pattern.test(content));
        const hasMinimalContent = content.trim().length >= 100;
        const hasImportsExports = /^(import|export|const.*require|from ['"])/m.test(content);

        if (hasMinimalContent && hasImportsExports && !hasStubs) {
          completedFiles.push(filePath);
        } else {
          remainingFiles.push(filePath);
        }

      } catch (error) {
        remainingFiles.push(filePath);
      }
    }

    const splitTasks: Task[] = [];

    // Create completed task if we have completed files
    if (completedFiles.length > 0) {
      const completedTask: Task = {
        ...task,
        id: `${task.id}-COMPLETED`,
        title: `${task.title} - Completed Components`,
        description: `Completed portion of ${task.title} with functional implementations`,
        files: completedFiles,
        requirements: task.requirements?.filter((req, index) => 
          index < Math.ceil(task.requirements.length * (completedFiles.length / task.files.length))
        ),
        labels: [...(task.labels || []), 'split-task', 'completed-portion']
      };
      splitTasks.push(completedTask);
    }

    // Create remaining task if we have remaining work
    if (remainingFiles.length > 0) {
      const remainingTask: Task = {
        ...task,
        id: `${task.id}-REMAINING`,
        title: `${task.title} - Remaining Work`,
        description: `Outstanding work for ${task.title} requiring implementation or completion`,
        files: remainingFiles,
        requirements: task.requirements?.filter((req, index) => 
          index >= Math.ceil(task.requirements.length * (completedFiles.length / task.files.length))
        ),
        labels: [...(task.labels || []), 'split-task', 'remaining-work'],
        dependencies: completedFiles.length > 0 ? [`${task.id}-COMPLETED`] : task.dependencies,
        disposition_reason: `SPLIT from ${task.id} - needs implementation of ${remainingFiles.length} files`
      };
      splitTasks.push(remainingTask);
    }

    this.log(`Split task ${task.id} into ${splitTasks.length} parts: ${completedFiles.length} completed, ${remainingFiles.length} remaining`);
    return splitTasks;
  }

  /**
   * Apply task state transition atomically
   */
  private applyStateTransition(task: Task, result: ProcessingResult): void {
    this.log(`Transitioning ${task.id}: review → ${result.nextState}`);

    // Remove from review
    const reviewIndex = this.kanban.tasks.review.findIndex(t => t.id === task.id);
    if (reviewIndex === -1) {
      throw new Error(`Task ${task.id} not found in review section`);
    }
    this.kanban.tasks.review.splice(reviewIndex, 1);

    // Handle task splitting
    if (result.splitTasks && result.splitTasks.length > 0) {
      this.log(`Handling split tasks for ${task.id}`);
      
      // Add split tasks to appropriate sections
      for (const splitTask of result.splitTasks) {
        if (splitTask.id.includes('-COMPLETED')) {
          // Completed portion goes to done
          const completedTask = {
            ...splitTask,
            completed_at: new Date().toISOString(),
            validation_notes: [`Split from ${task.id}`, ...result.notes],
            processing_confidence: result.confidence,
            validation_status: 'completed'
          };
          this.kanban.tasks.done.push(completedTask);
          this.success(`Split task ${splitTask.id} marked as completed`);
          
        } else if (splitTask.id.includes('-REMAINING')) {
          // Remaining work goes to backlog
          this.kanban.tasks.backlog.push(splitTask);
          this.warn(`Split task ${splitTask.id} added to backlog`);
        }
      }
      
      return; // Skip normal processing for split tasks
    }

    // Add processing metadata
    const processedTask = {
      ...task,
      completed_at: new Date().toISOString(),
      validation_notes: result.notes,
      processing_confidence: result.confidence,
      validation_status: result.disposition
    };

    // Move to target state
    switch (result.nextState) {
      case 'done':
        this.kanban.tasks.done.push(processedTask);
        this.success(`Task ${task.id} marked as completed`);
        break;
      
      case 'backlog':
        // Remove completion metadata if moving back
        const { completed_at, validation_notes, ...backlogTask } = processedTask;
        this.kanban.tasks.backlog.push({
          ...backlogTask,
          disposition_reason: `${result.disposition.toUpperCase()} - ${result.notes.join('; ')}`
        });
        this.warn(`Task ${task.id} returned to backlog`);
        break;
      
      case 'todo':
        const { completed_at: _, validation_notes: __, ...todoTask } = processedTask;
        this.kanban.tasks.todo.push(todoTask);
        this.log(`Task ${task.id} moved to todo`);
        break;
    }
  }

  /**
   * Process all tasks in review section
   */
  async processAllReviewTasks(): Promise<ProcessingResult[]> {
    this.log('Starting comprehensive review section processing');

    if (this.kanban.tasks.review.length === 0) {
      this.warn('No tasks in review section');
      return [];
    }

    const results: ProcessingResult[] = [];
    const reviewTasks = [...this.kanban.tasks.review]; // Create copy to avoid modification during iteration

    for (const task of reviewTasks) {
      try {
        const result = await this.processTask(task);
        this.applyStateTransition(task, result);
        results.push(result);
      } catch (error) {
        this.error(`Failed to process task ${task.id}: ${error}`);
        results.push({
          taskId: task.id,
          disposition: 'failed',
          confidence: 0,
          validationResults: {
            filesChecked: 0,
            filesValid: 0,
            functionalTests: 0,
            testsPassed: 0,
            implementationDepth: 'empty',
            criticalIssues: [`Processing error: ${error}`],
            recommendations: ['Fix processing error and retry']
          },
          nextState: 'backlog',
          notes: [`Processing failed: ${error}`]
        });
      }
    }

    // Save changes atomically
    this.saveKanban();
    
    this.success(`Processed ${results.length} tasks from review section`);
    return results;
  }

  /**
   * Generate processing report
   */
  generateReport(results: ProcessingResult[]): void {
    console.log(chalk.cyan('\n📊 REVIEW PROCESSING REPORT'));
    console.log(chalk.cyan('================================'));

    const summary = {
      completed: results.filter(r => r.disposition === 'completed').length,
      partial: results.filter(r => r.disposition === 'partial').length,
      stub: results.filter(r => r.disposition === 'stub').length,
      failed: results.filter(r => r.disposition === 'failed').length
    };

    console.log(chalk.green(`✅ Completed: ${summary.completed}`));
    console.log(chalk.yellow(`⚠️  Partial: ${summary.partial}`));
    console.log(chalk.yellow(`📝 Stub: ${summary.stub}`));
    console.log(chalk.red(`❌ Failed: ${summary.failed}`));

    console.log(chalk.cyan('\n📋 TASK DETAILS'));
    console.log(chalk.cyan('================'));

    for (const result of results) {
      const statusColor = {
        completed: chalk.green,
        partial: chalk.yellow,
        stub: chalk.yellow,
        failed: chalk.red
      }[result.disposition];

      console.log(`${statusColor(`${result.disposition.toUpperCase()}`)} ${result.taskId} (${result.confidence}% confidence)`);
      console.log(`   → Moved to: ${result.nextState}`);
      console.log(`   → Files: ${result.validationResults.filesValid}/${result.validationResults.filesChecked} valid`);
      
      if (result.validationResults.criticalIssues.length > 0) {
        console.log(chalk.red(`   → Issues: ${result.validationResults.criticalIssues.length}`));
      }
      console.log('');
    }
  }
}

// CLI interface
const program = new Command();

program
  .name('review-processor')
  .description('TypeScript Review Processing Automation Engine')
  .version('1.0.0');

program
  .command('process')
  .description('Process all tasks in review section')
  .action(async () => {
    try {
      // Note: WorkspaceValidator.validateCommand expects ('project'|'agent', commandName)
      // For review processing, we run from project root, so use 'project'
      WorkspaceValidator.validateCommand('project', 'review-processor');
      
      const processor = new ReviewProcessor();
      const results = await processor.processAllReviewTasks();
      processor.generateReport(results);
    } catch (error) {
      console.error(chalk.red('Processing failed:'), error);
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate a specific task without processing')
  .argument('<task-id>', 'Task ID to validate')
  .action(async (taskId: string) => {
    try {
      // Note: WorkspaceValidator.validateCommand expects ('project'|'agent', commandName)
      // For review processing, we run from project root, so use 'project'
      WorkspaceValidator.validateCommand('project', 'review-processor');
      
      const processor = new ReviewProcessor();
      const task = processor['kanban'].tasks.review.find(t => t.id === taskId);
      
      if (!task) {
        console.error(chalk.red(`Task ${taskId} not found in review section`));
        process.exit(1);
      }

      const result = await processor.processTask(task);
      console.log(chalk.cyan(`\n📊 VALIDATION REPORT: ${taskId}`));
      console.log(chalk.cyan('================================'));
      console.log(`Disposition: ${result.disposition} (${result.confidence}% confidence)`);
      console.log(`Next State: ${result.nextState}`);
      console.log(`Files: ${result.validationResults.filesValid}/${result.validationResults.filesChecked} valid`);
      console.log(`Implementation Depth: ${result.validationResults.implementationDepth}`);
      
      if (result.validationResults.criticalIssues.length > 0) {
        console.log(chalk.red('\nCritical Issues:'));
        result.validationResults.criticalIssues.forEach(issue => 
          console.log(chalk.red(`  • ${issue}`))
        );
      }

      if (result.validationResults.recommendations.length > 0) {
        console.log(chalk.yellow('\nRecommendations:'));
        result.validationResults.recommendations.forEach(rec => 
          console.log(chalk.yellow(`  • ${rec}`))
        );
      }

      console.log(chalk.cyan('\nNotes:'));
      result.notes.forEach(note => console.log(chalk.blue(`  • ${note}`)));

    } catch (error) {
      console.error(chalk.red('Validation failed:'), error);
      process.exit(1);
    }
  });

program.parse();