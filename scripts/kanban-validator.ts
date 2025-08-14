#!/usr/bin/env node

/**
 * Kanban Validation Engine
 * 
 * Enhanced validation system extending the review-validation-engine.ts
 * with specific kanban.yaml state validation and task completion assessment.
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { join, resolve, extname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Command } from 'commander';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import { ReviewValidationEngine, type FileValidationResult, type ValidationReport } from './review-validation-engine.js';
import type { KanbanBoard, Task } from './types.js';

const execAsync = promisify(exec);
const PROJECT_ROOT = resolve(process.cwd());
const KANBAN_FILE = join(PROJECT_ROOT, 'kanban.yaml');

export interface TaskValidationResult {
  taskId: string;
  title: string;
  completionScore: number;
  implementationDepth: 'complete' | 'substantial' | 'partial' | 'stub' | 'empty';
  fileValidation: {
    specified: number;
    existing: number;
    functional: number;
    stubCount: number;
  };
  functionalTests: {
    attempted: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  criticalIssues: string[];
  recommendations: string[];
  confidence: number;
}

export interface KanbanValidationReport {
  timestamp: string;
  structuralIntegrity: boolean;
  agentStates: Record<string, 'valid' | 'invalid' | 'warning'>;
  taskValidations: TaskValidationResult[];
  systemHealth: {
    totalTasks: number;
    validTasks: number;
    tasksWithIssues: number;
    orphanedTasks: number;
    duplicateTasks: number;
  };
  recommendations: string[];
  criticalIssues: string[];
}

export class KanbanValidator extends ReviewValidationEngine {
  private kanban: KanbanBoard;

  constructor() {
    super({
      projectRoot: PROJECT_ROOT,
      includedExtensions: ['.ts', '.js', '.ex', '.exs', '.py', '.sql', '.json', '.yaml', '.md'],
      excludedPaths: ['node_modules', '.git', 'dist', 'build', '_build', 'deps', 'backups'],
      rules: {
        maxComplexity: 15,
        minTestCoverage: 60,
        maxFileLength: 1000,
        requireJsdoc: false,
        enforceTypeScript: true
      }
    });

    this.kanban = this.loadKanban();
  }

  private loadKanban(): KanbanBoard {
    try {
      const content = readFileSync(KANBAN_FILE, 'utf8');
      return yaml.load(content) as KanbanBoard;
    } catch (error) {
      throw new Error(`Failed to load kanban.yaml: ${error}`);
    }
  }

  private log(message: string): void {
    console.log(chalk.blue('[KANBAN-VALIDATOR]'), message);
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
   * Validate structural integrity of kanban.yaml
   */
  validateStructure(): boolean {
    const issues: string[] = [];

    // Check required sections
    if (!this.kanban.metadata) issues.push('Missing metadata section');
    if (!this.kanban.agents) issues.push('Missing agents section');
    if (!this.kanban.tasks) issues.push('Missing tasks section');

    // Check task sections
    const requiredTaskSections = ['backlog', 'todo', 'in_progress', 'review', 'done'];
    for (const section of requiredTaskSections) {
      if (!this.kanban.tasks[section]) {
        issues.push(`Missing tasks.${section} section`);
      } else if (!Array.isArray(this.kanban.tasks[section])) {
        issues.push(`tasks.${section} must be an array`);
      }
    }

    // Check metadata consistency
    if (this.kanban.metadata?.task_summary) {
      const summary = this.kanban.metadata.task_summary;
      const actualCounts = {
        backlog: this.kanban.tasks.backlog.length,
        todo: this.kanban.tasks.todo.length,
        in_progress: this.kanban.tasks.in_progress.length,
        review: this.kanban.tasks.review.length,
        done: this.kanban.tasks.done.length
      };

      if (summary.total_tasks !== Object.values(actualCounts).reduce((sum, count) => sum + count, 0)) {
        issues.push('Task summary total_tasks mismatch');
      }

      for (const [section, actualCount] of Object.entries(actualCounts)) {
        if (summary[section as keyof typeof summary] !== actualCount) {
          issues.push(`Task summary ${section} count mismatch: expected ${actualCount}, got ${summary[section as keyof typeof summary]}`);
        }
      }
    }

    if (issues.length > 0) {
      issues.forEach(issue => this.error(issue));
      return false;
    }

    return true;
  }

  /**
   * Enhanced task validation with implementation depth analysis
   */
  async validateTask(task: Task): Promise<TaskValidationResult> {
    this.log(`Validating task: ${task.id}`);

    const result: TaskValidationResult = {
      taskId: task.id,
      title: task.title,
      completionScore: 0,
      implementationDepth: 'empty',
      fileValidation: {
        specified: 0,
        existing: 0,
        functional: 0,
        stubCount: 0
      },
      functionalTests: {
        attempted: 0,
        passed: 0,
        failed: 0,
        skipped: 0
      },
      criticalIssues: [],
      recommendations: [],
      confidence: 0
    };

    // Validate files if specified
    if (task.files && task.files.length > 0) {
      result.fileValidation.specified = task.files.length;

      for (const filePath of task.files) {
        await this.validateTaskFile(filePath, result);
      }

      // Calculate file-based completion score
      const fileScore = result.fileValidation.existing / result.fileValidation.specified;
      const functionalScore = result.fileValidation.functional / Math.max(result.fileValidation.existing, 1);
      result.completionScore = (fileScore * 0.6) + (functionalScore * 0.4);

    } else {
      // Tasks without specified files - check for related files by task ID
      result.criticalIssues.push('No files specified for validation');
      await this.inferTaskFiles(task, result);
    }

    // Run functional tests if applicable
    await this.runFunctionalTests(task, result);

    // Determine implementation depth
    result.implementationDepth = this.assessImplementationDepth(result);

    // Calculate confidence score
    result.confidence = this.calculateConfidence(result);

    // Generate recommendations
    this.generateTaskRecommendations(task, result);

    return result;
  }

  /**
   * Validate individual file for a task
   */
  private async validateTaskFile(filePath: string, result: TaskValidationResult): Promise<void> {
    if (!existsSync(filePath)) {
      result.criticalIssues.push(`File not found: ${filePath}`);
      return;
    }

    result.fileValidation.existing++;

    try {
      const content = readFileSync(filePath, 'utf8');
      const stats = statSync(filePath);

      // Check for stub patterns
      const stubPatterns = [
        /TODO:/gi,
        /FIXME:/gi,
        /PLACEHOLDER/gi,
        /throw new Error\(.*not implemented.*\)/gi,
        /console\.log\(.*stub.*\)/gi,
        /\/\*\s*stub\s*\*\//gi,
        /function\s+\w+\s*\(\)\s*\{\s*\}/gi, // Empty functions
        /export\s+(function|const)\s+\w+\s*=\s*\(\)\s*=>\s*\{\s*\}/gi // Empty arrow functions
      ];

      let stubCount = 0;
      for (const pattern of stubPatterns) {
        const matches = content.match(pattern);
        if (matches) {
          stubCount += matches.length;
        }
      }

      result.fileValidation.stubCount += stubCount;

      // Assess functionality
      const minFunctionalSize = 100; // Minimum chars for functional code
      const hasImports = /^(import|const.*require|from ['"])/m.test(content);
      const hasExports = /^(export|module\.exports)/m.test(content);
      const hasImplementation = content.trim().length > minFunctionalSize;

      if (hasImplementation && (hasImports || hasExports) && stubCount === 0) {
        result.fileValidation.functional++;
      } else if (hasImplementation && stubCount < 3) {
        result.fileValidation.functional += 0.5; // Partial functionality
      }

      // File-specific validation
      const extension = extname(filePath);
      await this.validateByFileType(filePath, extension, content, result);

    } catch (error) {
      result.criticalIssues.push(`Failed to validate file ${filePath}: ${error}`);
    }
  }

  /**
   * Validate file based on its type
   */
  private async validateByFileType(filePath: string, extension: string, content: string, result: TaskValidationResult): Promise<void> {
    switch (extension) {
      case '.ts':
      case '.js':
        await this.validateTypeScriptFile(filePath, content, result);
        break;
      
      case '.ex':
      case '.exs':
        await this.validateElixirFile(filePath, content, result);
        break;
      
      case '.py':
        await this.validatePythonFile(filePath, content, result);
        break;
      
      case '.sql':
        await this.validateSQLFile(filePath, content, result);
        break;
      
      case '.yaml':
      case '.yml':
        await this.validateYAMLFile(filePath, content, result);
        break;
      
      default:
        // Generic file validation
        if (content.trim().length === 0) {
          result.criticalIssues.push(`Empty file: ${filePath}`);
        }
    }
  }

  /**
   * TypeScript/JavaScript specific validation
   */
  private async validateTypeScriptFile(filePath: string, content: string, result: TaskValidationResult): Promise<void> {
    try {
      // Check TypeScript compilation
      if (filePath.endsWith('.ts')) {
        const { stdout, stderr } = await execAsync(`npx tsc --noEmit ${filePath}`, { 
          cwd: PROJECT_ROOT,
          timeout: 10000
        });
        
        if (stderr && !stderr.includes('Cannot find module')) {
          result.criticalIssues.push(`TypeScript errors in ${filePath}: ${stderr.substring(0, 200)}`);
        }
      }

      // Check for basic functionality indicators
      const hasFunctions = /function\s+\w+|const\s+\w+\s*=\s*\(.*\)\s*=>|\w+\s*\(.*\)\s*\{/.test(content);
      const hasClasses = /class\s+\w+/.test(content);
      const hasTests = /describe\s*\(|it\s*\(|test\s*\(/.test(content);

      if (hasFunctions || hasClasses) {
        result.fileValidation.functional += 0.3;
      }

      if (hasTests) {
        result.functionalTests.attempted++;
        // TODO: Actually run tests and count results
      }

    } catch (error) {
      // TypeScript compilation failed - could be missing dependencies
      result.recommendations.push(`TypeScript validation failed for ${filePath}: ${error}`);
    }
  }

  /**
   * Elixir specific validation
   */
  private async validateElixirFile(filePath: string, content: string, result: TaskValidationResult): Promise<void> {
    // Check for Elixir syntax patterns
    const hasDefmodule = /defmodule\s+\w+/.test(content);
    const hasDef = /def\s+\w+/.test(content);
    const hasGenServer = /use\s+GenServer/.test(content);

    if (hasDefmodule && hasDef) {
      result.fileValidation.functional += 0.3;
    }

    if (hasGenServer) {
      result.fileValidation.functional += 0.2; // GenServer implementation is more complex
    }

    // Check for test files
    if (filePath.includes('_test.exs') || filePath.includes('test/')) {
      result.functionalTests.attempted++;
    }
  }

  /**
   * Python specific validation
   */
  private async validatePythonFile(filePath: string, content: string, result: TaskValidationResult): Promise<void> {
    const hasFunctions = /def\s+\w+\s*\(/.test(content);
    const hasClasses = /class\s+\w+/.test(content);
    const hasImports = /^(import|from)\s+/.test(content);

    if ((hasFunctions || hasClasses) && hasImports) {
      result.fileValidation.functional += 0.3;
    }

    // Check for test files
    if (filePath.includes('test_') || filePath.includes('/tests/')) {
      result.functionalTests.attempted++;
    }
  }

  /**
   * SQL specific validation
   */
  private async validateSQLFile(filePath: string, content: string, result: TaskValidationResult): Promise<void> {
    const hasDDL = /(CREATE|ALTER|DROP)\s+(TABLE|INDEX|VIEW)/i.test(content);
    const hasDML = /(INSERT|UPDATE|DELETE|SELECT)\s+/i.test(content);

    if (hasDDL || hasDML) {
      result.fileValidation.functional += 0.3;
    }
  }

  /**
   * YAML specific validation
   */
  private async validateYAMLFile(filePath: string, content: string, result: TaskValidationResult): Promise<void> {
    try {
      yaml.load(content);
      result.fileValidation.functional += 0.2; // Valid YAML
    } catch (error) {
      result.criticalIssues.push(`Invalid YAML in ${filePath}: ${error}`);
    }
  }

  /**
   * Attempt to infer files for tasks without specified files
   */
  private async inferTaskFiles(task: Task, result: TaskValidationResult): Promise<void> {
    const taskPrefix = task.id.toLowerCase().replace(/-/g, '_');
    const searchPaths = [
      join(PROJECT_ROOT, 'scripts'),
      join(PROJECT_ROOT, 'src'),
      join(PROJECT_ROOT, 'lib'),
      join(PROJECT_ROOT, 'agents')
    ];

    for (const searchPath of searchPaths) {
      if (!existsSync(searchPath)) continue;

      try {
        const { stdout } = await execAsync(`find ${searchPath} -name "*${taskPrefix}*" -type f`, {
          timeout: 5000
        });

        const files = stdout.trim().split('\n').filter(f => f.length > 0);
        if (files.length > 0) {
          result.recommendations.push(`Inferred files: ${files.join(', ')}`);
          // Validate inferred files
          for (const file of files.slice(0, 5)) { // Limit to 5 files
            await this.validateTaskFile(file, result);
            result.fileValidation.specified++;
          }
        }
      } catch (error) {
        // Ignore find errors
      }
    }
  }

  /**
   * Run functional tests for the task
   */
  private async runFunctionalTests(task: Task, result: TaskValidationResult): Promise<void> {
    // Skip tests for now - they would require full environment setup
    // TODO: Implement actual test execution
    result.functionalTests.skipped = result.functionalTests.attempted;
  }

  /**
   * Assess overall implementation depth
   */
  private assessImplementationDepth(result: TaskValidationResult): TaskValidationResult['implementationDepth'] {
    const { existing, functional, stubCount, specified } = result.fileValidation;

    if (existing === 0) {
      return 'empty';
    }

    const existenceRatio = existing / Math.max(specified, existing);
    const functionalRatio = functional / Math.max(existing, 1);
    const stubRatio = stubCount / Math.max(existing, 1);

    if (existenceRatio >= 0.9 && functionalRatio >= 0.8 && stubRatio <= 0.1) {
      return 'complete';
    } else if (existenceRatio >= 0.7 && functionalRatio >= 0.6) {
      return 'substantial';
    } else if (existenceRatio >= 0.5 || functionalRatio >= 0.4) {
      return 'partial';
    } else if (stubRatio > 0.5 || functionalRatio < 0.2) {
      return 'stub';
    } else {
      return 'empty';
    }
  }

  /**
   * Calculate confidence score for the validation
   */
  private calculateConfidence(result: TaskValidationResult): number {
    let confidence = 50; // Base confidence

    // Adjust based on file validation
    if (result.fileValidation.specified > 0) {
      const existenceScore = (result.fileValidation.existing / result.fileValidation.specified) * 30;
      const functionalScore = result.fileValidation.functional > 0 ? 
        (result.fileValidation.functional / result.fileValidation.existing) * 20 : 0;
      
      confidence += existenceScore + functionalScore;
    } else {
      confidence -= 20; // No files specified reduces confidence
    }

    // Adjust for critical issues
    confidence -= result.criticalIssues.length * 10;

    // Adjust for stub count
    if (result.fileValidation.stubCount > 0) {
      confidence -= Math.min(result.fileValidation.stubCount * 5, 25);
    }

    return Math.max(0, Math.min(100, confidence));
  }

  /**
   * Generate task-specific recommendations based on validation results
   */
  private generateTaskRecommendations(task: Task, result: TaskValidationResult): void {
    const { fileValidation, implementationDepth, criticalIssues } = result;

    if (implementationDepth === 'empty') {
      result.recommendations.push('Task appears to have no implementation - consider moving to backlog');
    } else if (implementationDepth === 'stub') {
      result.recommendations.push('Task has stub/placeholder code - needs actual implementation');
    } else if (implementationDepth === 'partial') {
      result.recommendations.push('Task is partially implemented - consider splitting into completed/remaining work');
    }

    if (fileValidation.specified === 0) {
      result.recommendations.push('Add specific file paths to task definition for better validation');
    }

    if (fileValidation.stubCount > 0) {
      result.recommendations.push(`Replace ${fileValidation.stubCount} stub/placeholder implementations with actual code`);
    }

    if (criticalIssues.length > 0) {
      result.recommendations.push('Address critical issues before marking as complete');
    }

    if (result.functionalTests.attempted === 0) {
      result.recommendations.push('Add functional tests to verify implementation');
    }
  }

  /**
   * Validate all tasks in a specific section
   */
  async validateSection(section: keyof KanbanBoard['tasks']): Promise<TaskValidationResult[]> {
    const tasks = this.kanban.tasks[section];
    if (!tasks || tasks.length === 0) {
      this.warn(`No tasks in ${section} section`);
      return [];
    }

    this.log(`Validating ${tasks.length} tasks in ${section} section`);
    
    const results: TaskValidationResult[] = [];
    for (const task of tasks) {
      try {
        const result = await this.validateTask(task);
        results.push(result);
      } catch (error) {
        this.error(`Failed to validate task ${task.id}: ${error}`);
        results.push({
          taskId: task.id,
          title: task.title,
          completionScore: 0,
          implementationDepth: 'empty',
          fileValidation: { specified: 0, existing: 0, functional: 0, stubCount: 0 },
          functionalTests: { attempted: 0, passed: 0, failed: 0, skipped: 0 },
          criticalIssues: [`Validation error: ${error}`],
          recommendations: ['Fix validation errors'],
          confidence: 0
        });
      }
    }

    return results;
  }

  /**
   * Generate comprehensive kanban validation report
   */
  async generateReport(): Promise<KanbanValidationReport> {
    this.log('Generating comprehensive kanban validation report');

    const report: KanbanValidationReport = {
      timestamp: new Date().toISOString(),
      structuralIntegrity: this.validateStructure(),
      agentStates: {},
      taskValidations: [],
      systemHealth: {
        totalTasks: 0,
        validTasks: 0,
        tasksWithIssues: 0,
        orphanedTasks: 0,
        duplicateTasks: 0
      },
      recommendations: [],
      criticalIssues: []
    };

    // Validate agent states
    for (const [agentId, state] of Object.entries(this.kanban.agents)) {
      if (['available', 'working'].includes(state.status)) {
        report.agentStates[agentId] = 'valid';
      } else {
        report.agentStates[agentId] = 'invalid';
        report.criticalIssues.push(`Agent ${agentId} has invalid status: ${state.status}`);
      }
    }

    // Validate all tasks
    const sections: (keyof KanbanBoard['tasks'])[] = ['backlog', 'todo', 'in_progress', 'review', 'done'];
    
    for (const section of sections) {
      const sectionResults = await this.validateSection(section);
      report.taskValidations.push(...sectionResults);
    }

    // Calculate system health
    report.systemHealth.totalTasks = report.taskValidations.length;
    report.systemHealth.validTasks = report.taskValidations.filter(r => 
      r.implementationDepth === 'complete' || r.implementationDepth === 'substantial'
    ).length;
    report.systemHealth.tasksWithIssues = report.taskValidations.filter(r => 
      r.criticalIssues.length > 0
    ).length;

    // Check for duplicates
    const taskIds = report.taskValidations.map(r => r.taskId);
    const duplicateIds = taskIds.filter((id, index) => taskIds.indexOf(id) !== index);
    report.systemHealth.duplicateTasks = duplicateIds.length;

    if (duplicateIds.length > 0) {
      report.criticalIssues.push(`Duplicate task IDs: ${duplicateIds.join(', ')}`);
    }

    // Generate system-level recommendations
    const lowConfidenceTasks = report.taskValidations.filter(r => r.confidence < 60).length;
    if (lowConfidenceTasks > 0) {
      report.recommendations.push(`${lowConfidenceTasks} tasks have low validation confidence - review manually`);
    }

    const stubTasks = report.taskValidations.filter(r => r.implementationDepth === 'stub').length;
    if (stubTasks > 0) {
      report.recommendations.push(`${stubTasks} tasks appear to be stubs - need actual implementation`);
    }

    return report;
  }
}

// CLI interface
const program = new Command();

program
  .name('kanban-validator')
  .description('Kanban Validation Engine')
  .version('1.0.0');

program
  .command('validate')
  .description('Generate comprehensive kanban validation report')
  .action(async () => {
    try {
      const validator = new KanbanValidator();
      const report = await validator.generateReport();
      
      console.log(chalk.cyan('\n📊 KANBAN VALIDATION REPORT'));
      console.log(chalk.cyan('============================'));
      
      // Structural integrity
      const structuralStatus = report.structuralIntegrity ? chalk.green('✅ Valid') : chalk.red('❌ Invalid');
      console.log(`Structural Integrity: ${structuralStatus}`);
      
      // System health
      const { systemHealth } = report;
      console.log(chalk.cyan('\n🏥 System Health:'));
      console.log(`  Total Tasks: ${systemHealth.totalTasks}`);
      console.log(`  Valid Tasks: ${chalk.green(systemHealth.validTasks)} (${Math.round((systemHealth.validTasks / systemHealth.totalTasks) * 100)}%)`);
      console.log(`  Tasks with Issues: ${chalk.yellow(systemHealth.tasksWithIssues)}`);
      console.log(`  Duplicate Tasks: ${systemHealth.duplicateTasks > 0 ? chalk.red(systemHealth.duplicateTasks) : chalk.green('0')}`);
      
      // Agent states
      console.log(chalk.cyan('\n👥 Agent States:'));
      for (const [agent, status] of Object.entries(report.agentStates)) {
        const statusColor = status === 'valid' ? chalk.green : chalk.red;
        console.log(`  ${agent}: ${statusColor(status)}`);
      }
      
      // Critical issues
      if (report.criticalIssues.length > 0) {
        console.log(chalk.red('\n⚠️  Critical Issues:'));
        report.criticalIssues.forEach(issue => console.log(chalk.red(`  • ${issue}`)));
      }
      
      // Recommendations
      if (report.recommendations.length > 0) {
        console.log(chalk.yellow('\n💡 Recommendations:'));
        report.recommendations.forEach(rec => console.log(chalk.yellow(`  • ${rec}`)));
      }
      
      // Task summary by implementation depth
      const depthCounts = report.taskValidations.reduce((acc, task) => {
        acc[task.implementationDepth] = (acc[task.implementationDepth] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      console.log(chalk.cyan('\n📋 Implementation Depth Distribution:'));
      Object.entries(depthCounts).forEach(([depth, count]) => {
        const color = depth === 'complete' ? chalk.green : depth === 'substantial' ? chalk.blue : 
                     depth === 'partial' ? chalk.yellow : chalk.red;
        console.log(`  ${color(depth)}: ${count}`);
      });

    } catch (error) {
      console.error(chalk.red('Validation failed:'), error);
      process.exit(1);
    }
  });

program
  .command('section')
  .description('Validate tasks in a specific section')
  .argument('<section>', 'Section to validate (backlog, todo, in_progress, review, done)')
  .action(async (section: string) => {
    try {
      const validator = new KanbanValidator();
      const results = await validator.validateSection(section as keyof KanbanBoard['tasks']);
      
      console.log(chalk.cyan(`\n📋 ${section.toUpperCase()} SECTION VALIDATION`));
      console.log(chalk.cyan('================================'));
      
      results.forEach(result => {
        const depthColor = {
          complete: chalk.green,
          substantial: chalk.blue,
          partial: chalk.yellow,
          stub: chalk.yellow,
          empty: chalk.red
        }[result.implementationDepth];
        
        console.log(`\n${depthColor(result.implementationDepth.toUpperCase())} ${result.taskId}`);
        console.log(`  Title: ${result.title}`);
        console.log(`  Completion Score: ${Math.round(result.completionScore * 100)}%`);
        console.log(`  Confidence: ${result.confidence}%`);
        console.log(`  Files: ${result.fileValidation.functional}/${result.fileValidation.existing}/${result.fileValidation.specified} (functional/existing/specified)`);
        
        if (result.criticalIssues.length > 0) {
          console.log(chalk.red(`  Issues: ${result.criticalIssues.length}`));
          result.criticalIssues.slice(0, 3).forEach(issue => 
            console.log(chalk.red(`    • ${issue.substring(0, 80)}...`))
          );
        }
      });

    } catch (error) {
      console.error(chalk.red('Section validation failed:'), error);
      process.exit(1);
    }
  });

program.parse();