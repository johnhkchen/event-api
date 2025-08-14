#!/usr/bin/env tsx
/**
 * YAML Health Checker for kanban.yaml
 * 
 * Comprehensive validation and health checking for the kanban board YAML file
 * with automatic backup and repair capabilities.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  metadata?: {
    totalTasks: number;
    taskCounts: Record<string, number>;
    completionPercentage: number;
  };
}

interface KanbanTask {
  id: string;
  title: string;
  priority: string;
  estimated_hours: number;
  assignee?: string | null;
  started?: string;
  completed?: string;
  validation_notes?: string;
}

interface KanbanBoard {
  metadata: {
    total_tasks: number;
    completion_percentage: string;
    task_summary: {
      total_tasks: number;
      backlog: number;
      todo: number;
      in_progress: number;
      review: number;
      done: number;
      completion_percentage: string;
    };
  };
  tasks: {
    backlog: KanbanTask[];
    todo: KanbanTask[];
    in_progress: KanbanTask[];
    review: KanbanTask[];
    done: KanbanTask[];
  };
}

class YAMLHealthChecker {
  private kanbanPath: string;
  private backupDir: string;

  constructor(kanbanPath = '/home/jchen/repos/event-api/kanban.yaml') {
    this.kanbanPath = kanbanPath;
    this.backupDir = path.join(path.dirname(kanbanPath), 'backups');
  }

  /**
   * Main health check function
   */
  async checkHealth(options: { 
    fix: boolean; 
    backup: boolean; 
    verbose: boolean 
  } = { fix: false, backup: true, verbose: false }): Promise<ValidationResult> {
    console.log('🔍 Starting YAML Health Check...');
    
    if (options.backup) {
      await this.createBackup();
    }

    // Step 1: Basic syntax validation
    const syntaxResult = this.validateSyntax();
    if (!syntaxResult.isValid) {
      console.error('❌ YAML Syntax Errors Found:');
      syntaxResult.errors.forEach(error => console.error(`  - ${error}`));
      
      if (options.fix) {
        console.log('🔧 Attempting to fix syntax errors...');
        await this.attemptSyntaxFix();
        return this.validateSyntax(); // Re-validate after fix
      }
      
      return syntaxResult;
    }

    console.log('✅ YAML syntax is valid');

    // Step 2: Structure validation
    const structureResult = this.validateStructure();
    if (!structureResult.isValid) {
      console.error('❌ YAML Structure Errors Found:');
      structureResult.errors.forEach(error => console.error(`  - ${error}`));
      
      if (options.fix) {
        console.log('🔧 Attempting to fix structure errors...');
        await this.attemptStructureFix();
      }
    }

    // Step 3: Data consistency validation
    const consistencyResult = this.validateDataConsistency();
    if (!consistencyResult.isValid) {
      console.warn('⚠️  Data Consistency Issues Found:');
      consistencyResult.errors.forEach(error => console.warn(`  - ${error}`));
      
      if (options.fix) {
        console.log('🔧 Fixing data consistency issues...');
        await this.fixDataConsistency();
      }
    }

    // Step 4: Generate comprehensive report
    const metadata = this.generateMetadata();
    
    if (options.verbose) {
      this.printDetailedReport(metadata);
    }

    const overallResult: ValidationResult = {
      isValid: syntaxResult.isValid && structureResult.isValid,
      errors: [...syntaxResult.errors, ...structureResult.errors],
      warnings: [...syntaxResult.warnings, ...structureResult.warnings, ...consistencyResult.errors],
      metadata
    };

    console.log(`\n📊 Health Check Complete: ${overallResult.isValid ? '✅ HEALTHY' : '❌ ISSUES FOUND'}`);
    
    return overallResult;
  }

  /**
   * Validate YAML syntax using yq
   */
  private validateSyntax(): ValidationResult {
    try {
      execSync(`yq '.' "${this.kanbanPath}" > /dev/null 2>&1`, { stdio: 'pipe' });
      return {
        isValid: true,
        errors: [],
        warnings: []
      };
    } catch (error: any) {
      const errorOutput = error.stderr?.toString() || error.message || 'Unknown syntax error';
      return {
        isValid: false,
        errors: [`YAML syntax error: ${errorOutput}`],
        warnings: []
      };
    }
  }

  /**
   * Validate kanban board structure
   */
  private validateStructure(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const yamlContent = readFileSync(this.kanbanPath, 'utf-8');
      const data = this.parseYAML(yamlContent);

      // Check required top-level sections
      const requiredSections = ['metadata', 'agents', 'tasks'];
      for (const section of requiredSections) {
        if (!data[section]) {
          errors.push(`Missing required section: ${section}`);
        }
      }

      // Check required task sections
      if (data.tasks) {
        const requiredTaskSections = ['backlog', 'todo', 'in_progress', 'review', 'done'];
        for (const section of requiredTaskSections) {
          if (!Array.isArray(data.tasks[section])) {
            errors.push(`Task section '${section}' must be an array`);
          }
        }
      }

      // Check metadata structure
      if (data.metadata) {
        if (!data.metadata.task_summary) {
          warnings.push('Missing task_summary in metadata');
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings
      };
    } catch (error: any) {
      return {
        isValid: false,
        errors: [`Structure validation failed: ${error.message}`],
        warnings: []
      };
    }
  }

  /**
   * Validate data consistency (task counts, percentages, etc.)
   */
  private validateDataConsistency(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const yamlContent = readFileSync(this.kanbanPath, 'utf-8');
      const data = this.parseYAML(yamlContent) as KanbanBoard;

      if (!data.tasks || !data.metadata) {
        return { isValid: true, errors, warnings };
      }

      // Count actual tasks
      const actualCounts = {
        backlog: data.tasks.backlog?.length || 0,
        todo: data.tasks.todo?.length || 0,
        in_progress: data.tasks.in_progress?.length || 0,
        review: data.tasks.review?.length || 0,
        done: data.tasks.done?.length || 0
      };

      const actualTotal = Object.values(actualCounts).reduce((sum, count) => sum + count, 0);
      const actualCompletion = actualTotal > 0 ? Math.round((actualCounts.done / actualTotal) * 100) : 0;

      // Check task count consistency
      const metadataCounts = data.metadata.task_summary;
      if (metadataCounts) {
        for (const [section, actualCount] of Object.entries(actualCounts)) {
          const metadataCount = (metadataCounts as any)[section];
          if (metadataCount !== actualCount) {
            errors.push(`Task count mismatch in ${section}: metadata shows ${metadataCount}, actual is ${actualCount}`);
          }
        }

        if (metadataCounts.total_tasks !== actualTotal) {
          errors.push(`Total task count mismatch: metadata shows ${metadataCounts.total_tasks}, actual is ${actualTotal}`);
        }

        const metadataCompletion = parseInt(metadataCounts.completion_percentage.replace('%', ''));
        if (Math.abs(metadataCompletion - actualCompletion) > 1) { // Allow 1% variance for rounding
          errors.push(`Completion percentage mismatch: metadata shows ${metadataCompletion}%, actual is ${actualCompletion}%`);
        }
      }

      // Validate task IDs are unique
      const allTasks: KanbanTask[] = [
        ...(data.tasks.backlog || []),
        ...(data.tasks.todo || []),
        ...(data.tasks.in_progress || []),
        ...(data.tasks.review || []),
        ...(data.tasks.done || [])
      ];

      const taskIds = allTasks.map(task => task.id);
      const duplicateIds = taskIds.filter((id, index) => taskIds.indexOf(id) !== index);
      if (duplicateIds.length > 0) {
        errors.push(`Duplicate task IDs found: ${duplicateIds.join(', ')}`);
      }

      // Validate task structure
      for (const task of allTasks) {
        if (!task.id) {
          errors.push(`Task missing ID: ${task.title || 'Unknown task'}`);
        }
        if (!task.title) {
          errors.push(`Task ${task.id} missing title`);
        }
        if (!task.priority) {
          warnings.push(`Task ${task.id} missing priority`);
        }
        if (!task.estimated_hours) {
          warnings.push(`Task ${task.id} missing estimated_hours`);
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings
      };
    } catch (error: any) {
      return {
        isValid: false,
        errors: [`Data consistency validation failed: ${error.message}`],
        warnings: []
      };
    }
  }

  /**
   * Generate metadata about the kanban board
   */
  private generateMetadata() {
    try {
      const yamlContent = readFileSync(this.kanbanPath, 'utf-8');
      const data = this.parseYAML(yamlContent) as KanbanBoard;

      const taskCounts = {
        backlog: data.tasks?.backlog?.length || 0,
        todo: data.tasks?.todo?.length || 0,
        in_progress: data.tasks?.in_progress?.length || 0,
        review: data.tasks?.review?.length || 0,
        done: data.tasks?.done?.length || 0
      };

      const totalTasks = Object.values(taskCounts).reduce((sum, count) => sum + count, 0);
      const completionPercentage = totalTasks > 0 ? Math.round((taskCounts.done / totalTasks) * 100) : 0;

      return {
        totalTasks,
        taskCounts,
        completionPercentage
      };
    } catch (error) {
      return {
        totalTasks: 0,
        taskCounts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0 },
        completionPercentage: 0
      };
    }
  }

  /**
   * Print detailed health report
   */
  private printDetailedReport(metadata: any) {
    console.log('\n📋 DETAILED HEALTH REPORT');
    console.log('=' .repeat(50));
    console.log(`📊 Total Tasks: ${metadata.totalTasks}`);
    console.log(`📈 Completion: ${metadata.completionPercentage}%`);
    console.log('\n📋 Task Distribution:');
    for (const [section, count] of Object.entries(metadata.taskCounts)) {
      console.log(`  ${section.padEnd(12)}: ${count}`);
    }
    console.log('=' .repeat(50));
  }

  /**
   * Create backup of kanban.yaml
   */
  private async createBackup(): Promise<string> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(this.backupDir, `kanban-${timestamp}.yaml`);
      
      // Ensure backup directory exists
      execSync(`mkdir -p "${this.backupDir}"`, { stdio: 'pipe' });
      
      // Copy current file to backup
      execSync(`cp "${this.kanbanPath}" "${backupPath}"`, { stdio: 'pipe' });
      
      console.log(`📦 Backup created: ${backupPath}`);
      return backupPath;
    } catch (error: any) {
      console.error(`⚠️  Failed to create backup: ${error.message}`);
      throw error;
    }
  }

  /**
   * Attempt to fix syntax errors
   */
  private async attemptSyntaxFix(): Promise<void> {
    try {
      const yamlContent = readFileSync(this.kanbanPath, 'utf-8');
      
      // Common syntax fixes
      let fixedContent = yamlContent
        // Fix missing newline at end
        .replace(/([^\n])$/, '$1\n')
        // Fix inconsistent indentation (basic)
        .split('\n')
        .map(line => {
          // Convert tabs to spaces
          return line.replace(/\t/g, '  ');
        })
        .join('\n');

      // Write fixed content
      writeFileSync(this.kanbanPath, fixedContent, 'utf-8');
      console.log('🔧 Applied basic syntax fixes');
    } catch (error: any) {
      console.error(`❌ Failed to fix syntax: ${error.message}`);
      throw error;
    }
  }

  /**
   * Attempt to fix structure issues
   */
  private async attemptStructureFix(): Promise<void> {
    try {
      const yamlContent = readFileSync(this.kanbanPath, 'utf-8');
      const data = this.parseYAML(yamlContent);

      // Ensure all required sections exist
      if (!data.metadata) data.metadata = {};
      if (!data.agents) data.agents = {};
      if (!data.tasks) data.tasks = {};

      // Ensure all task sections are arrays
      const taskSections = ['backlog', 'todo', 'in_progress', 'review', 'done'];
      for (const section of taskSections) {
        if (!Array.isArray(data.tasks[section])) {
          data.tasks[section] = [];
        }
      }

      // Write fixed structure
      const fixedYaml = this.stringifyYAML(data);
      writeFileSync(this.kanbanPath, fixedYaml, 'utf-8');
      console.log('🔧 Applied structure fixes');
    } catch (error: any) {
      console.error(`❌ Failed to fix structure: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fix data consistency issues
   */
  private async fixDataConsistency(): Promise<void> {
    try {
      const yamlContent = readFileSync(this.kanbanPath, 'utf-8');
      const data = this.parseYAML(yamlContent) as KanbanBoard;

      if (!data.tasks || !data.metadata) return;

      // Recalculate task counts
      const actualCounts = {
        backlog: data.tasks.backlog?.length || 0,
        todo: data.tasks.todo?.length || 0,
        in_progress: data.tasks.in_progress?.length || 0,
        review: data.tasks.review?.length || 0,
        done: data.tasks.done?.length || 0
      };

      const actualTotal = Object.values(actualCounts).reduce((sum, count) => sum + count, 0);
      const actualCompletion = actualTotal > 0 ? Math.round((actualCounts.done / actualTotal) * 100) : 0;

      // Update metadata
      if (!data.metadata.task_summary) {
        data.metadata.task_summary = {
          total_tasks: 0,
          backlog: 0,
          todo: 0,
          in_progress: 0,
          review: 0,
          done: 0,
          completion_percentage: '0%'
        };
      }

      data.metadata.task_summary.total_tasks = actualTotal;
      data.metadata.task_summary.backlog = actualCounts.backlog;
      data.metadata.task_summary.todo = actualCounts.todo;
      data.metadata.task_summary.in_progress = actualCounts.in_progress;
      data.metadata.task_summary.review = actualCounts.review;
      data.metadata.task_summary.done = actualCounts.done;
      data.metadata.task_summary.completion_percentage = `${actualCompletion}%`;

      // Write corrected data
      const fixedYaml = this.stringifyYAML(data);
      writeFileSync(this.kanbanPath, fixedYaml, 'utf-8');
      console.log('🔧 Fixed data consistency issues');
    } catch (error: any) {
      console.error(`❌ Failed to fix data consistency: ${error.message}`);
      throw error;
    }
  }

  /**
   * Parse YAML content safely
   */
  private parseYAML(content: string): any {
    try {
      // Write content to temporary file to avoid shell command length limits
      const tempFile = `/tmp/kanban-temp-${Date.now()}.yaml`;
      writeFileSync(tempFile, content, 'utf-8');
      
      try {
        // Use yq (python version) to convert YAML file to JSON for parsing
        const jsonOutput = execSync(`yq '.' "${tempFile}"`, { 
          encoding: 'utf-8',
          stdio: 'pipe'
        });
        return JSON.parse(jsonOutput);
      } finally {
        // Clean up temp file
        try {
          execSync(`rm -f "${tempFile}"`, { stdio: 'pipe' });
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    } catch (error: any) {
      throw new Error(`Failed to parse YAML: ${error.message}`);
    }
  }

  /**
   * Convert object back to YAML
   */
  private stringifyYAML(data: any): string {
    try {
      // Write JSON to temporary file to avoid shell command length limits
      const tempFile = `/tmp/kanban-json-temp-${Date.now()}.json`;
      const jsonString = JSON.stringify(data, null, 2);
      writeFileSync(tempFile, jsonString, 'utf-8');
      
      try {
        // Use yq (python version) with yaml-output for JSON to YAML conversion
        const yamlOutput = execSync(`yq --yaml-output '.' "${tempFile}"`, {
          encoding: 'utf-8',
          stdio: 'pipe'
        });
        return yamlOutput;
      } finally {
        // Clean up temp file
        try {
          execSync(`rm -f "${tempFile}"`, { stdio: 'pipe' });
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    } catch (error: any) {
      throw new Error(`Failed to stringify YAML: ${error.message}`);
    }
  }

  /**
   * List available backups
   */
  listBackups(): string[] {
    try {
      if (!existsSync(this.backupDir)) {
        return [];
      }
      
      const backups = execSync(`ls -1t "${this.backupDir}"/kanban-*.yaml 2>/dev/null || true`, {
        encoding: 'utf-8',
        stdio: 'pipe'
      }).trim().split('\n').filter(Boolean);
      
      return backups;
    } catch (error) {
      return [];
    }
  }

  /**
   * Restore from backup
   */
  restoreFromBackup(backupPath: string): void {
    if (!existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }
    
    // Create backup of current file before restore
    this.createBackup();
    
    // Restore from backup
    execSync(`cp "${backupPath}" "${this.kanbanPath}"`, { stdio: 'pipe' });
    console.log(`🔄 Restored from backup: ${backupPath}`);
  }
}

/**
 * CLI Interface
 */
async function main() {
  const args = process.argv.slice(2);
  const checker = new YAMLHealthChecker();

  const options = {
    fix: args.includes('--fix'),
    backup: !args.includes('--no-backup'),
    verbose: args.includes('--verbose')
  };

  if (args.includes('--list-backups')) {
    const backups = checker.listBackups();
    if (backups.length === 0) {
      console.log('📋 No backups found');
    } else {
      console.log('📋 Available backups:');
      backups.forEach((backup, index) => {
        console.log(`  ${index + 1}. ${backup}`);
      });
    }
    return;
  }

  if (args.includes('--restore')) {
    const backupIndex = parseInt(args[args.indexOf('--restore') + 1]);
    const backups = checker.listBackups();
    
    if (isNaN(backupIndex) || backupIndex < 1 || backupIndex > backups.length) {
      console.error('❌ Invalid backup index. Use --list-backups to see available backups.');
      process.exit(1);
    }
    
    checker.restoreFromBackup(backups[backupIndex - 1]);
    return;
  }

  try {
    const result = await checker.checkHealth(options);
    
    if (!result.isValid) {
      console.error('\n❌ Health check failed. Use --fix to attempt automatic repairs.');
      process.exit(1);
    }
    
    console.log('\n✅ Kanban YAML is healthy!');
  } catch (error: any) {
    console.error(`💥 Health check failed with error: ${error.message}`);
    process.exit(1);
  }
}

// Run CLI if called directly (ESM compatible)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { YAMLHealthChecker, ValidationResult };