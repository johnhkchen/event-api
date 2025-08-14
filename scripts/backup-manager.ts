#!/usr/bin/env node

/**
 * Backup and Recovery Manager
 * 
 * Enhanced backup system with rollback capabilities and recovery validation
 * for bulletproof kanban.yaml modifications.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, resolve, basename } from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import { simpleGit } from 'simple-git';
import type { KanbanBoard } from './types.js';

const PROJECT_ROOT = resolve(process.cwd());
const KANBAN_FILE = join(PROJECT_ROOT, 'kanban.yaml');
const BACKUP_DIR = join(PROJECT_ROOT, 'backups');
const MAX_BACKUPS = 50;
const BACKUP_RETENTION_DAYS = 30;

export interface BackupMetadata {
  timestamp: string;
  path: string;
  size: number;
  checksum: string;
  operation: string;
  agent?: string;
}

export interface RecoveryValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  taskCounts: {
    backlog: number;
    todo: number;
    in_progress: number;
    review: number;
    done: number;
  };
  agentStates: Record<string, string>;
}

export class BackupManager {
  private git = simpleGit(PROJECT_ROOT);

  constructor() {
    this.ensureBackupDirectory();
  }

  private ensureBackupDirectory(): void {
    if (!existsSync(BACKUP_DIR)) {
      mkdirSync(BACKUP_DIR, { recursive: true });
    }
  }

  private log(message: string): void {
    console.log(chalk.blue('[BACKUP-MANAGER]'), message);
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
   * Create a backup of the current kanban.yaml
   */
  createBackup(operation: string, agent?: string): BackupMetadata {
    if (!existsSync(KANBAN_FILE)) {
      throw new Error('kanban.yaml not found');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `kanban-${timestamp}.yaml`;
    const backupPath = join(BACKUP_DIR, filename);

    const content = readFileSync(KANBAN_FILE, 'utf8');
    const size = Buffer.byteLength(content, 'utf8');
    const checksum = this.calculateChecksum(content);

    writeFileSync(backupPath, content, 'utf8');

    const metadata: BackupMetadata = {
      timestamp,
      path: backupPath,
      size,
      checksum,
      operation,
      agent
    };

    this.success(`Backup created: ${filename} (${size} bytes)`);
    return metadata;
  }

  /**
   * List all available backups
   */
  listBackups(): BackupMetadata[] {
    if (!existsSync(BACKUP_DIR)) {
      return [];
    }

    const files = readdirSync(BACKUP_DIR)
      .filter(file => file.startsWith('kanban-') && file.endsWith('.yaml'))
      .map(file => {
        const path = join(BACKUP_DIR, file);
        const stats = statSync(path);
        const content = readFileSync(path, 'utf8');
        
        // Extract timestamp from filename
        const timestampMatch = file.match(/kanban-(.+)\.yaml$/);
        const timestamp = timestampMatch ? timestampMatch[1].replace(/-/g, ':') : stats.mtime.toISOString();

        return {
          timestamp,
          path,
          size: stats.size,
          checksum: this.calculateChecksum(content),
          operation: 'unknown', // Historical backups don't have operation info
          agent: undefined
        };
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return files;
  }

  /**
   * Validate a backup file
   */
  validateBackup(backupPath: string): RecoveryValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!existsSync(backupPath)) {
      return {
        isValid: false,
        errors: ['Backup file not found'],
        warnings: [],
        taskCounts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0 },
        agentStates: {}
      };
    }

    try {
      const content = readFileSync(backupPath, 'utf8');
      const kanban = yaml.load(content) as KanbanBoard;

      // Validate structure
      if (!kanban.metadata) {
        errors.push('Missing metadata section');
      }
      if (!kanban.agents) {
        errors.push('Missing agents section');
      }
      if (!kanban.tasks) {
        errors.push('Missing tasks section');
      }

      // Validate tasks structure
      const requiredSections = ['backlog', 'todo', 'in_progress', 'review', 'done'];
      for (const section of requiredSections) {
        if (!kanban.tasks[section]) {
          errors.push(`Missing tasks.${section} section`);
        } else if (!Array.isArray(kanban.tasks[section])) {
          errors.push(`tasks.${section} must be an array`);
        }
      }

      // Calculate task counts
      const taskCounts = {
        backlog: kanban.tasks?.backlog?.length || 0,
        todo: kanban.tasks?.todo?.length || 0,
        in_progress: kanban.tasks?.in_progress?.length || 0,
        review: kanban.tasks?.review?.length || 0,
        done: kanban.tasks?.done?.length || 0
      };

      // Validate agent states
      const agentStates: Record<string, string> = {};
      if (kanban.agents) {
        for (const [agentId, state] of Object.entries(kanban.agents)) {
          agentStates[agentId] = state.status;
          
          if (!['available', 'working'].includes(state.status)) {
            warnings.push(`Agent ${agentId} has invalid status: ${state.status}`);
          }
        }
      }

      // Validate task consistency
      const totalTasks = Object.values(taskCounts).reduce((sum, count) => sum + count, 0);
      if (kanban.metadata?.task_summary?.total_tasks !== totalTasks) {
        warnings.push('Task summary count mismatch with actual tasks');
      }

      // Check for duplicate task IDs
      const allTasks = [
        ...(kanban.tasks.backlog || []),
        ...(kanban.tasks.todo || []),
        ...(kanban.tasks.in_progress || []),
        ...(kanban.tasks.review || []),
        ...(kanban.tasks.done || [])
      ];

      const taskIds = allTasks.map(task => task.id);
      const duplicateIds = taskIds.filter((id, index) => taskIds.indexOf(id) !== index);
      if (duplicateIds.length > 0) {
        errors.push(`Duplicate task IDs found: ${duplicateIds.join(', ')}`);
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        taskCounts,
        agentStates
      };

    } catch (error) {
      return {
        isValid: false,
        errors: [`Failed to parse backup: ${error}`],
        warnings: [],
        taskCounts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0 },
        agentStates: {}
      };
    }
  }

  /**
   * Restore from a backup
   */
  async restore(backupPath: string, force: boolean = false): Promise<void> {
    this.log(`Attempting to restore from: ${basename(backupPath)}`);

    // Validate backup before restoring
    const validation = this.validateBackup(backupPath);
    if (!validation.isValid) {
      throw new Error(`Backup validation failed: ${validation.errors.join(', ')}`);
    }

    if (validation.warnings.length > 0 && !force) {
      this.warn('Backup has warnings:');
      validation.warnings.forEach(warning => console.log(chalk.yellow(`  • ${warning}`)));
      throw new Error('Use --force to restore despite warnings');
    }

    // Create backup of current state before restoring
    const currentBackup = this.createBackup(`pre-restore-${Date.now()}`, 'backup-manager');
    
    try {
      // Copy backup to current kanban.yaml
      const backupContent = readFileSync(backupPath, 'utf8');
      writeFileSync(KANBAN_FILE, backupContent, 'utf8');

      // Validate restored state
      const restoredValidation = this.validateBackup(KANBAN_FILE);
      if (!restoredValidation.isValid) {
        throw new Error('Restored kanban.yaml is invalid');
      }

      this.success(`Kanban restored from ${basename(backupPath)}`);
      this.log(`Task counts: ${JSON.stringify(restoredValidation.taskCounts)}`);

    } catch (error) {
      // Rollback on failure
      this.error(`Restore failed: ${error}`);
      this.log('Rolling back to previous state...');
      
      const rollbackContent = readFileSync(currentBackup.path, 'utf8');
      writeFileSync(KANBAN_FILE, rollbackContent, 'utf8');
      
      throw new Error(`Restore failed and rolled back: ${error}`);
    }
  }

  /**
   * Compare two backups or backup with current state
   */
  compare(pathA: string, pathB?: string): void {
    const contentA = readFileSync(pathA, 'utf8');
    const kanbanA = yaml.load(contentA) as KanbanBoard;
    
    const contentB = pathB ? readFileSync(pathB, 'utf8') : readFileSync(KANBAN_FILE, 'utf8');
    const kanbanB = yaml.load(contentB) as KanbanBoard;

    console.log(chalk.cyan('\n📊 BACKUP COMPARISON'));
    console.log(chalk.cyan('===================='));
    
    const nameA = basename(pathA);
    const nameB = pathB ? basename(pathB) : 'current kanban.yaml';
    
    console.log(`${chalk.blue('A:')} ${nameA}`);
    console.log(`${chalk.blue('B:')} ${nameB}`);
    
    // Compare task counts
    const countsA = {
      backlog: kanbanA.tasks?.backlog?.length || 0,
      todo: kanbanA.tasks?.todo?.length || 0,
      in_progress: kanbanA.tasks?.in_progress?.length || 0,
      review: kanbanA.tasks?.review?.length || 0,
      done: kanbanA.tasks?.done?.length || 0
    };
    
    const countsB = {
      backlog: kanbanB.tasks?.backlog?.length || 0,
      todo: kanbanB.tasks?.todo?.length || 0,
      in_progress: kanbanB.tasks?.in_progress?.length || 0,
      review: kanbanB.tasks?.review?.length || 0,
      done: kanbanB.tasks?.done?.length || 0
    };

    console.log(chalk.cyan('\n📋 Task Count Comparison:'));
    for (const [section, countA] of Object.entries(countsA)) {
      const countB = countsB[section as keyof typeof countsB];
      const diff = countB - countA;
      const diffStr = diff > 0 ? chalk.green(`+${diff}`) : diff < 0 ? chalk.red(`${diff}`) : chalk.gray('±0');
      console.log(`  ${section}: ${countA} → ${countB} (${diffStr})`);
    }

    // Compare agent states
    console.log(chalk.cyan('\n👥 Agent State Comparison:'));
    const allAgents = new Set([
      ...Object.keys(kanbanA.agents || {}),
      ...Object.keys(kanbanB.agents || {})
    ]);

    for (const agentId of allAgents) {
      const statusA = kanbanA.agents?.[agentId]?.status || 'missing';
      const statusB = kanbanB.agents?.[agentId]?.status || 'missing';
      
      if (statusA !== statusB) {
        const taskA = kanbanA.agents?.[agentId]?.current_task || 'none';
        const taskB = kanbanB.agents?.[agentId]?.current_task || 'none';
        console.log(`  ${agentId}: ${statusA}(${taskA}) → ${statusB}(${taskB})`);
      }
    }
  }

  /**
   * Cleanup old backups based on retention policy
   */
  cleanup(): void {
    const backups = this.listBackups();
    const now = Date.now();
    const retentionMs = BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    
    let deletedCount = 0;
    
    // Remove backups older than retention period
    for (const backup of backups) {
      const backupTime = new Date(backup.timestamp).getTime();
      if (now - backupTime > retentionMs) {
        unlinkSync(backup.path);
        deletedCount++;
        this.log(`Deleted old backup: ${basename(backup.path)}`);
      }
    }
    
    // Keep only MAX_BACKUPS most recent
    const recentBackups = this.listBackups();
    if (recentBackups.length > MAX_BACKUPS) {
      const excessBackups = recentBackups.slice(MAX_BACKUPS);
      for (const backup of excessBackups) {
        unlinkSync(backup.path);
        deletedCount++;
        this.log(`Deleted excess backup: ${basename(backup.path)}`);
      }
    }
    
    if (deletedCount > 0) {
      this.success(`Cleaned up ${deletedCount} old backups`);
    } else {
      this.log('No backups to clean up');
    }
  }

  private calculateChecksum(content: string): string {
    // Simple checksum using hash
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }
}

// CLI interface
const program = new Command();

program
  .name('backup-manager')
  .description('Enhanced Backup and Recovery Manager')
  .version('1.0.0');

program
  .command('create')
  .description('Create a backup of current kanban.yaml')
  .option('--operation <op>', 'Operation description', 'manual')
  .option('--agent <agent>', 'Agent performing the operation')
  .action(async (options) => {
    try {
      const manager = new BackupManager();
      const backup = manager.createBackup(options.operation, options.agent);
      console.log(chalk.green(`✅ Backup created: ${basename(backup.path)}`));
    } catch (error) {
      console.error(chalk.red('Backup failed:'), error);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List all available backups')
  .action(() => {
    const manager = new BackupManager();
    const backups = manager.listBackups();
    
    if (backups.length === 0) {
      console.log(chalk.yellow('No backups found'));
      return;
    }

    console.log(chalk.cyan('\n📦 AVAILABLE BACKUPS'));
    console.log(chalk.cyan('===================='));
    
    backups.forEach(backup => {
      const age = Date.now() - new Date(backup.timestamp).getTime();
      const ageStr = age < 86400000 ? `${Math.round(age / 3600000)}h ago` : `${Math.round(age / 86400000)}d ago`;
      console.log(`${backup.timestamp} | ${(backup.size / 1024).toFixed(1)}KB | ${ageStr} | ${backup.operation}`);
    });
  });

program
  .command('restore')
  .description('Restore from a backup')
  .argument('<backup-path>', 'Path to backup file')
  .option('--force', 'Force restore despite warnings')
  .action(async (backupPath: string, options) => {
    try {
      const manager = new BackupManager();
      await manager.restore(backupPath, options.force);
    } catch (error) {
      console.error(chalk.red('Restore failed:'), error);
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate a backup file')
  .argument('<backup-path>', 'Path to backup file')
  .action((backupPath: string) => {
    const manager = new BackupManager();
    const validation = manager.validateBackup(backupPath);
    
    console.log(chalk.cyan(`\n🔍 BACKUP VALIDATION: ${basename(backupPath)}`));
    console.log(chalk.cyan('================================'));
    
    if (validation.isValid) {
      console.log(chalk.green('✅ Backup is valid'));
    } else {
      console.log(chalk.red('❌ Backup has errors'));
    }
    
    if (validation.errors.length > 0) {
      console.log(chalk.red('\nErrors:'));
      validation.errors.forEach(error => console.log(chalk.red(`  • ${error}`)));
    }
    
    if (validation.warnings.length > 0) {
      console.log(chalk.yellow('\nWarnings:'));
      validation.warnings.forEach(warning => console.log(chalk.yellow(`  • ${warning}`)));
    }
    
    console.log(chalk.cyan('\nTask Counts:'));
    Object.entries(validation.taskCounts).forEach(([section, count]) => {
      console.log(`  ${section}: ${count}`);
    });
    
    console.log(chalk.cyan('\nAgent States:'));
    Object.entries(validation.agentStates).forEach(([agent, status]) => {
      console.log(`  ${agent}: ${status}`);
    });
  });

program
  .command('compare')
  .description('Compare two backups or backup with current state')
  .argument('<backup-a>', 'First backup path')
  .argument('[backup-b]', 'Second backup path (defaults to current kanban.yaml)')
  .action((backupA: string, backupB?: string) => {
    try {
      const manager = new BackupManager();
      manager.compare(backupA, backupB);
    } catch (error) {
      console.error(chalk.red('Comparison failed:'), error);
      process.exit(1);
    }
  });

program
  .command('cleanup')
  .description('Clean up old backups based on retention policy')
  .action(() => {
    try {
      const manager = new BackupManager();
      manager.cleanup();
    } catch (error) {
      console.error(chalk.red('Cleanup failed:'), error);
      process.exit(1);
    }
  });

program.parse();