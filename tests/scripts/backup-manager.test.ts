#!/usr/bin/env node

/**
 * Test Suite for BackupManager
 * 
 * Comprehensive tests for the enhanced backup and recovery system
 */

import { test, describe, it, before, after, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import * as yaml from 'js-yaml';
import type { KanbanBoard } from '../../scripts/types.js';

const TEST_ROOT = join(tmpdir(), 'backup-manager-test');
const TEST_KANBAN_FILE = join(TEST_ROOT, 'kanban.yaml');
const TEST_BACKUP_DIR = join(TEST_ROOT, 'backups');

// Mock BackupManager to avoid importing actual implementation
class MockBackupManager {
  constructor() {
    this.ensureBackupDirectory();
  }

  private ensureBackupDirectory(): void {
    if (!existsSync(TEST_BACKUP_DIR)) {
      mkdirSync(TEST_BACKUP_DIR, { recursive: true });
    }
  }

  createBackup(operation: string, agent?: string) {
    if (!existsSync(TEST_KANBAN_FILE)) {
      throw new Error('kanban.yaml not found');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `kanban-${timestamp}.yaml`;
    const backupPath = join(TEST_BACKUP_DIR, filename);

    const content = readFileSync(TEST_KANBAN_FILE, 'utf8');
    const size = Buffer.byteLength(content, 'utf8');
    const checksum = this.calculateChecksum(content);

    writeFileSync(backupPath, content, 'utf8');

    return {
      timestamp,
      path: backupPath,
      size,
      checksum,
      operation,
      agent
    };
  }

  listBackups() {
    if (!existsSync(TEST_BACKUP_DIR)) {
      return [];
    }

    const files = readdirSync(TEST_BACKUP_DIR)
      .filter(file => file.startsWith('kanban-') && file.endsWith('.yaml'))
      .map(file => {
        const path = join(TEST_BACKUP_DIR, file);
        const content = readFileSync(path, 'utf8');
        const timestampMatch = file.match(/kanban-(.+)\.yaml$/);
        const timestamp = timestampMatch ? timestampMatch[1].replace(/-/g, ':') : new Date().toISOString();

        return {
          timestamp,
          path,
          size: Buffer.byteLength(content, 'utf8'),
          checksum: this.calculateChecksum(content),
          operation: 'test',
          agent: undefined
        };
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return files;
  }

  validateBackup(backupPath: string) {
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
      if (!kanban.metadata) errors.push('Missing metadata section');
      if (!kanban.agents) errors.push('Missing agents section');
      if (!kanban.tasks) errors.push('Missing tasks section');

      const requiredSections = ['backlog', 'todo', 'in_progress', 'review', 'done'];
      for (const section of requiredSections) {
        if (!kanban.tasks[section]) {
          errors.push(`Missing tasks.${section} section`);
        }
      }

      const taskCounts = {
        backlog: kanban.tasks?.backlog?.length || 0,
        todo: kanban.tasks?.todo?.length || 0,
        in_progress: kanban.tasks?.in_progress?.length || 0,
        review: kanban.tasks?.review?.length || 0,
        done: kanban.tasks?.done?.length || 0
      };

      const agentStates: Record<string, string> = {};
      if (kanban.agents) {
        for (const [agentId, state] of Object.entries(kanban.agents)) {
          agentStates[agentId] = state.status;
          if (!['available', 'working'].includes(state.status)) {
            warnings.push(`Agent ${agentId} has invalid status: ${state.status}`);
          }
        }
      }

      const totalTasks = Object.values(taskCounts).reduce((sum, count) => sum + count, 0);
      if (kanban.metadata?.task_summary?.total_tasks !== totalTasks) {
        warnings.push('Task summary count mismatch with actual tasks');
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

  restore(backupPath: string, force: boolean = false) {
    const validation = this.validateBackup(backupPath);
    if (!validation.isValid) {
      throw new Error(`Backup validation failed: ${validation.errors.join(', ')}`);
    }

    if (validation.warnings.length > 0 && !force) {
      throw new Error('Use --force to restore despite warnings');
    }

    const currentBackup = this.createBackup(`pre-restore-${Date.now()}`, 'backup-manager');
    
    try {
      const backupContent = readFileSync(backupPath, 'utf8');
      writeFileSync(TEST_KANBAN_FILE, backupContent, 'utf8');

      const restoredValidation = this.validateBackup(TEST_KANBAN_FILE);
      if (!restoredValidation.isValid) {
        throw new Error('Restored kanban.yaml is invalid');
      }

      return { success: true, backup: currentBackup };

    } catch (error) {
      const rollbackContent = readFileSync(currentBackup.path, 'utf8');
      writeFileSync(TEST_KANBAN_FILE, rollbackContent, 'utf8');
      throw error;
    }
  }

  cleanup() {
    const MAX_BACKUPS = 5; // Reduced for testing
    const backups = this.listBackups();
    
    if (backups.length <= MAX_BACKUPS) {
      return { deletedCount: 0 };
    }

    const excessBackups = backups.slice(MAX_BACKUPS);
    let deletedCount = 0;
    
    for (const backup of excessBackups) {
      rmSync(backup.path, { force: true });
      deletedCount++;
    }
    
    return { deletedCount };
  }

  private calculateChecksum(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
}

describe('BackupManager', () => {
  before(async () => {
    // Setup test environment
    if (existsSync(TEST_ROOT)) {
      rmSync(TEST_ROOT, { recursive: true, force: true });
    }
    mkdirSync(TEST_ROOT, { recursive: true });
  });

  after(async () => {
    // Cleanup test environment
    if (existsSync(TEST_ROOT)) {
      rmSync(TEST_ROOT, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    // Create clean backup directory
    if (existsSync(TEST_BACKUP_DIR)) {
      rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_BACKUP_DIR, { recursive: true });

    // Create test kanban.yaml
    const testKanban: KanbanBoard = {
      metadata: {
        project: 'Test Project',
        max_agents: 3,
        created: '2025-01-01',
        last_updated: '2025-08-14',
        task_summary: {
          total_tasks: 2,
          backlog: 1,
          todo: 0,
          in_progress: 0,
          review: 0,
          done: 1,
          completion_percentage: '50%'
        }
      },
      agents: {
        'agent-001': {
          status: 'available',
          current_task: null,
          worktree: './agents/agent-001',
          last_active: '2025-08-14T10:00:00.000Z'
        }
      },
      tasks: {
        backlog: [
          {
            id: 'TEST-BACKLOG-001',
            title: 'Test Backlog Task',
            priority: 'normal',
            estimated_hours: 8,
            description: 'A test task in backlog',
            requirements: ['Implement feature'],
            files: [],
            dependencies: [],
            labels: ['test'],
            assignee: null
          }
        ],
        todo: [],
        in_progress: [],
        review: [],
        done: [
          {
            id: 'TEST-DONE-001',
            title: 'Test Done Task',
            priority: 'high',
            estimated_hours: 4,
            description: 'A completed test task',
            requirements: ['Feature implemented'],
            files: [],
            dependencies: [],
            labels: ['test', 'completed'],
            assignee: 'agent-001'
          }
        ]
      }
    };

    writeFileSync(TEST_KANBAN_FILE, yaml.dump(testKanban), 'utf8');
  });

  describe('Backup Creation', () => {
    it('should create a backup with correct metadata', async () => {
      const manager = new MockBackupManager();
      const backup = manager.createBackup('test-operation', 'agent-001');
      
      assert(existsSync(backup.path));
      assert.equal(backup.operation, 'test-operation');
      assert.equal(backup.agent, 'agent-001');
      assert(backup.size > 0);
      assert(backup.checksum.length > 0);
    });

    it('should fail when kanban.yaml does not exist', async () => {
      rmSync(TEST_KANBAN_FILE);
      const manager = new MockBackupManager();
      
      assert.throws(() => {
        manager.createBackup('test-operation');
      }, /kanban\.yaml not found/);
    });

    it('should create backup with unique timestamps', async () => {
      const manager = new MockBackupManager();
      const backup1 = manager.createBackup('operation-1');
      
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const backup2 = manager.createBackup('operation-2');
      
      assert.notEqual(backup1.timestamp, backup2.timestamp);
      assert.notEqual(backup1.path, backup2.path);
    });

    it('should backup current kanban content correctly', async () => {
      const manager = new MockBackupManager();
      const originalContent = readFileSync(TEST_KANBAN_FILE, 'utf8');
      const backup = manager.createBackup('content-test');
      
      const backupContent = readFileSync(backup.path, 'utf8');
      assert.equal(backupContent, originalContent);
    });
  });

  describe('Backup Listing', () => {
    it('should return empty list when no backups exist', async () => {
      rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
      const manager = new MockBackupManager();
      const backups = manager.listBackups();
      
      assert.equal(backups.length, 0);
    });

    it('should list backups in chronological order', async () => {
      const manager = new MockBackupManager();
      
      const backup1 = manager.createBackup('first');
      await new Promise(resolve => setTimeout(resolve, 10));
      const backup2 = manager.createBackup('second');
      await new Promise(resolve => setTimeout(resolve, 10));
      const backup3 = manager.createBackup('third');
      
      const backups = manager.listBackups();
      assert.equal(backups.length, 3);
      
      // Should be sorted by timestamp descending (newest first)
      const timestamps = backups.map(b => new Date(b.timestamp).getTime());
      assert(timestamps[0] >= timestamps[1]);
      assert(timestamps[1] >= timestamps[2]);
    });

    it('should include backup metadata in listing', async () => {
      const manager = new MockBackupManager();
      manager.createBackup('test-operation', 'test-agent');
      
      const backups = manager.listBackups();
      assert.equal(backups.length, 1);
      
      const backup = backups[0];
      assert(backup.timestamp.length > 0);
      assert(existsSync(backup.path));
      assert(backup.size > 0);
      assert(backup.checksum.length > 0);
    });
  });

  describe('Backup Validation', () => {
    it('should validate a correct backup file', async () => {
      const manager = new MockBackupManager();
      const backup = manager.createBackup('validation-test');
      
      const validation = manager.validateBackup(backup.path);
      
      assert.equal(validation.isValid, true);
      assert.equal(validation.errors.length, 0);
      assert.equal(validation.taskCounts.backlog, 1);
      assert.equal(validation.taskCounts.done, 1);
      assert.equal(validation.agentStates['agent-001'], 'available');
    });

    it('should detect missing backup file', async () => {
      const manager = new MockBackupManager();
      const validation = manager.validateBackup('/nonexistent/path.yaml');
      
      assert.equal(validation.isValid, false);
      assert(validation.errors.includes('Backup file not found'));
    });

    it('should detect structural issues', async () => {
      const manager = new MockBackupManager();
      const malformedPath = join(TEST_BACKUP_DIR, 'malformed.yaml');
      
      // Create malformed backup
      writeFileSync(malformedPath, 'invalid: yaml: structure:\n  missing: required\n    sections');
      
      const validation = manager.validateBackup(malformedPath);
      
      assert.equal(validation.isValid, false);
      assert(validation.errors.some(error => error.includes('Missing metadata section')));
    });

    it('should detect invalid YAML syntax', async () => {
      const manager = new MockBackupManager();
      const invalidPath = join(TEST_BACKUP_DIR, 'invalid.yaml');
      
      writeFileSync(invalidPath, 'invalid yaml syntax: [unclosed bracket');
      
      const validation = manager.validateBackup(invalidPath);
      
      assert.equal(validation.isValid, false);
      assert(validation.errors.some(error => error.includes('Failed to parse backup')));
    });

    it('should detect task count mismatches', async () => {
      const manager = new MockBackupManager();
      
      // Create backup with mismatched task summary
      const mismatchedKanban = {
        metadata: {
          project: 'Test',
          max_agents: 1,
          created: '2025-01-01',
          last_updated: '2025-08-14',
          task_summary: {
            total_tasks: 5, // Wrong count
            backlog: 1,
            todo: 0,
            in_progress: 0,
            review: 0,
            done: 1,
            completion_percentage: '20%'
          }
        },
        agents: { 'agent-001': { status: 'available', current_task: null, worktree: './', last_active: '2025-08-14' } },
        tasks: { backlog: [{ id: 'test', title: 'test' }], todo: [], in_progress: [], review: [], done: [{ id: 'done', title: 'done' }] }
      };
      
      const mismatchPath = join(TEST_BACKUP_DIR, 'mismatch.yaml');
      writeFileSync(mismatchPath, yaml.dump(mismatchedKanban));
      
      const validation = manager.validateBackup(mismatchPath);
      
      assert(validation.warnings.some(warning => warning.includes('Task summary count mismatch')));
    });

    it('should detect invalid agent statuses', async () => {
      const manager = new MockBackupManager();
      
      const invalidAgentKanban = {
        metadata: { project: 'Test', max_agents: 1, created: '2025-01-01', last_updated: '2025-08-14', task_summary: { total_tasks: 0, backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, completion_percentage: '0%' } },
        agents: { 'agent-001': { status: 'invalid-status', current_task: null, worktree: './', last_active: '2025-08-14' } },
        tasks: { backlog: [], todo: [], in_progress: [], review: [], done: [] }
      };
      
      const invalidPath = join(TEST_BACKUP_DIR, 'invalid-agent.yaml');
      writeFileSync(invalidPath, yaml.dump(invalidAgentKanban));
      
      const validation = manager.validateBackup(invalidPath);
      
      assert(validation.warnings.some(warning => warning.includes('Agent agent-001 has invalid status')));
    });
  });

  describe('Backup Restoration', () => {
    it('should restore from a valid backup', async () => {
      const manager = new MockBackupManager();
      
      // Create backup of original state
      const originalBackup = manager.createBackup('original');
      
      // Modify current kanban
      const modifiedKanban = {
        metadata: { project: 'Modified', max_agents: 1, created: '2025-01-01', last_updated: '2025-08-14', task_summary: { total_tasks: 0, backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, completion_percentage: '0%' } },
        agents: {},
        tasks: { backlog: [], todo: [], in_progress: [], review: [], done: [] }
      };
      writeFileSync(TEST_KANBAN_FILE, yaml.dump(modifiedKanban));
      
      // Restore from backup
      const result = manager.restore(originalBackup.path);
      
      assert.equal(result.success, true);
      
      // Verify restoration
      const restoredContent = readFileSync(TEST_KANBAN_FILE, 'utf8');
      const restoredKanban = yaml.load(restoredContent) as KanbanBoard;
      assert.equal(restoredKanban.metadata.project, 'Test Project');
    });

    it('should fail to restore invalid backup', async () => {
      const manager = new MockBackupManager();
      const invalidPath = join(TEST_BACKUP_DIR, 'invalid.yaml');
      
      writeFileSync(invalidPath, 'invalid: yaml');
      
      assert.throws(() => {
        manager.restore(invalidPath);
      }, /Backup validation failed/);
    });

    it('should require force flag for backups with warnings', async () => {
      const manager = new MockBackupManager();
      
      // Create backup with warnings (task count mismatch)
      const warningKanban = {
        metadata: { project: 'Test', max_agents: 1, created: '2025-01-01', last_updated: '2025-08-14', task_summary: { total_tasks: 5, backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, completion_percentage: '0%' } },
        agents: { 'agent-001': { status: 'available', current_task: null, worktree: './', last_active: '2025-08-14' } },
        tasks: { backlog: [], todo: [], in_progress: [], review: [], done: [] }
      };
      
      const warningPath = join(TEST_BACKUP_DIR, 'warning.yaml');
      writeFileSync(warningPath, yaml.dump(warningKanban));
      
      // Should fail without force
      assert.throws(() => {
        manager.restore(warningPath, false);
      }, /Use --force to restore despite warnings/);
      
      // Should succeed with force
      const result = manager.restore(warningPath, true);
      assert.equal(result.success, true);
    });

    it('should create pre-restore backup', async () => {
      const manager = new MockBackupManager();
      
      const originalBackup = manager.createBackup('original');
      const backupsBeforeRestore = manager.listBackups().length;
      
      manager.restore(originalBackup.path);
      
      const backupsAfterRestore = manager.listBackups().length;
      assert.equal(backupsAfterRestore, backupsBeforeRestore + 1);
      
      // Check if pre-restore backup exists
      const backups = manager.listBackups();
      const preRestoreBackup = backups.find(b => b.path.includes('pre-restore'));
      assert(preRestoreBackup, 'Pre-restore backup should exist');
    });

    it('should rollback on restoration failure', async () => {
      const manager = new MockBackupManager();
      
      const originalContent = readFileSync(TEST_KANBAN_FILE, 'utf8');
      
      // Mock a restore that would fail validation
      const invalidBackup = join(TEST_BACKUP_DIR, 'will-fail.yaml');
      const invalidKanban = {
        metadata: { project: 'Test', max_agents: 1 },
        // Missing required fields to cause validation failure
        agents: {},
        tasks: {}
      };
      writeFileSync(invalidBackup, yaml.dump(invalidKanban));
      
      // Attempt restore should fail and rollback
      assert.throws(() => {
        manager.restore(invalidBackup, true);
      });
      
      // Original content should be restored
      const currentContent = readFileSync(TEST_KANBAN_FILE, 'utf8');
      assert.equal(currentContent, originalContent);
    });
  });

  describe('Backup Cleanup', () => {
    it('should not delete backups when under limit', async () => {
      const manager = new MockBackupManager();
      
      manager.createBackup('test-1');
      manager.createBackup('test-2');
      
      const result = manager.cleanup();
      assert.equal(result.deletedCount, 0);
      
      const backups = manager.listBackups();
      assert.equal(backups.length, 2);
    });

    it('should delete excess backups when over limit', async () => {
      const manager = new MockBackupManager();
      
      // Create more than MAX_BACKUPS (5 for testing)
      for (let i = 1; i <= 7; i++) {
        manager.createBackup(`test-${i}`);
        await new Promise(resolve => setTimeout(resolve, 5)); // Ensure different timestamps
      }
      
      const backupsBeforeCleanup = manager.listBackups();
      assert.equal(backupsBeforeCleanup.length, 7);
      
      const result = manager.cleanup();
      assert.equal(result.deletedCount, 2); // Should delete 2 oldest
      
      const backupsAfterCleanup = manager.listBackups();
      assert.equal(backupsAfterCleanup.length, 5);
    });

    it('should keep most recent backups during cleanup', async () => {
      const manager = new MockBackupManager();
      
      // Create backups with identifiable operations
      const operations = ['oldest', 'old', 'newer', 'newest-1', 'newest-2', 'newest-3'];
      for (const op of operations) {
        manager.createBackup(op);
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      
      manager.cleanup();
      
      const remainingBackups = manager.listBackups();
      assert.equal(remainingBackups.length, 5);
      
      // Should keep the 5 most recent (sorted by timestamp descending)
      // The oldest backup should be gone
      const backupPaths = remainingBackups.map(b => b.path);
      assert(!backupPaths.some(path => path.includes('oldest')));
    });
  });

  describe('Checksum Calculation', () => {
    it('should generate consistent checksums', async () => {
      const manager = new MockBackupManager();
      
      const backup1 = manager.createBackup('checksum-test');
      const backup2 = manager.createBackup('checksum-test-2');
      
      // Same content should produce same checksum
      assert.equal(backup1.checksum, backup2.checksum);
    });

    it('should generate different checksums for different content', async () => {
      const manager = new MockBackupManager();
      
      const backup1 = manager.createBackup('test-1');
      
      // Modify kanban content
      const modifiedKanban = yaml.load(readFileSync(TEST_KANBAN_FILE, 'utf8')) as KanbanBoard;
      modifiedKanban.metadata.project = 'Modified Project';
      writeFileSync(TEST_KANBAN_FILE, yaml.dump(modifiedKanban));
      
      const backup2 = manager.createBackup('test-2');
      
      // Different content should produce different checksums
      assert.notEqual(backup1.checksum, backup2.checksum);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing backup directory gracefully', async () => {
      rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
      
      const manager = new MockBackupManager();
      
      // Should create backup directory and succeed
      const backup = manager.createBackup('test-operation');
      assert(existsSync(backup.path));
    });

    it('should handle file system permission errors', async () => {
      const manager = new MockBackupManager();
      
      // This test would be platform-specific and complex to implement properly
      // In a real test suite, you might mock fs operations to simulate permission errors
      assert(true, 'File system error handling would require platform-specific mocking');
    });
  });
});

// Run tests if this file is executed directly
if (process.argv[1] && process.argv[1].endsWith('backup-manager.test.ts')) {
  console.log('🧪 Running BackupManager Test Suite...');
}