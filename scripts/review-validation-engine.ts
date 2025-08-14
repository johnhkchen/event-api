/**
 * Review Validation Engine
 * 
 * Systematic review processing engine with file-level validation
 * for the Event API project. Validates code quality, dependencies,
 * test coverage, and architectural compliance.
 */

import { readdir, stat, readFile } from 'fs/promises';
import { join, extname, relative } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface FileValidationResult {
  path: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  metrics: {
    lines: number;
    complexity: number;
    testCoverage: number;
  };
}

export interface ValidationReport {
  success: boolean;
  timestamp: string;
  summary: {
    totalFiles: number;
    validFiles: number;
    invalidFiles: number;
    warnings: number;
    criticalErrors: number;
  };
  files: FileValidationResult[];
  recommendations: string[];
}

export interface ValidatorConfig {
  projectRoot: string;
  includedExtensions: string[];
  excludedPaths: string[];
  rules: {
    maxComplexity: number;
    minTestCoverage: number;
    maxFileLength: number;
    requireJsdoc: boolean;
    enforceTypeScript: boolean;
  };
}

export class ReviewValidationEngine {
  private config: ValidatorConfig;

  constructor(config?: Partial<ValidatorConfig>) {
    this.config = {
      projectRoot: process.cwd(),
      includedExtensions: ['.ts', '.js', '.ex', '.exs', '.py'],
      excludedPaths: ['node_modules', '.git', 'dist', 'build', '_build', 'deps'],
      rules: {
        maxComplexity: 10,
        minTestCoverage: 80,
        maxFileLength: 500,
        requireJsdoc: true,
        enforceTypeScript: true
      },
      ...config
    };
  }

  /**
   * Run comprehensive validation on the project
   */
  async validateProject(): Promise<ValidationReport> {
    const startTime = Date.now();
    console.log('🔍 Starting comprehensive project validation...');

    try {
      // Discover all files to validate
      const files = await this.discoverFiles();
      console.log(`📁 Found ${files.length} files to validate`);

      // Validate each file
      const fileResults: FileValidationResult[] = [];
      for (const file of files) {
        const result = await this.validateFile(file);
        fileResults.push(result);
        
        if (!result.valid) {
          console.log(`❌ ${relative(this.config.projectRoot, file)}: ${result.errors.length} errors`);
        } else if (result.warnings.length > 0) {
          console.log(`⚠️  ${relative(this.config.projectRoot, file)}: ${result.warnings.length} warnings`);
        }
      }

      // Generate summary statistics
      const summary = this.generateSummary(fileResults);
      const recommendations = this.generateRecommendations(fileResults);

      const report: ValidationReport = {
        success: summary.criticalErrors === 0,
        timestamp: new Date().toISOString(),
        summary,
        files: fileResults,
        recommendations
      };

      console.log(`✅ Validation completed in ${Date.now() - startTime}ms`);
      console.log(`📊 Summary: ${summary.validFiles}/${summary.totalFiles} files valid, ${summary.warnings} warnings, ${summary.criticalErrors} critical errors`);

      return report;

    } catch (error) {
      console.error('💥 Validation failed:', error);
      throw new Error(`Validation engine error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validate a specific file
   */
  async validateFile(filePath: string): Promise<FileValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let metrics = {
      lines: 0,
      complexity: 0,
      testCoverage: 0
    };

    try {
      // Read file content
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      metrics.lines = lines.length;

      // File length validation
      if (metrics.lines > this.config.rules.maxFileLength) {
        warnings.push(`File is ${metrics.lines} lines, exceeds recommended ${this.config.rules.maxFileLength}`);
      }

      // TypeScript enforcement
      const ext = extname(filePath);
      if (this.config.rules.enforceTypeScript && ext === '.js' && !filePath.includes('test')) {
        warnings.push('JavaScript file should be migrated to TypeScript (.ts)');
      }

      // JSDoc validation
      if (this.config.rules.requireJsdoc && ext === '.ts') {
        await this.validateJsDoc(content, errors, warnings);
      }

      // Language-specific validations
      switch (ext) {
        case '.ts':
        case '.js':
          await this.validateTypeScript(content, filePath, errors, warnings, metrics);
          break;
        case '.ex':
        case '.exs':
          await this.validateElixir(content, errors, warnings, metrics);
          break;
        case '.py':
          await this.validatePython(content, errors, warnings, metrics);
          break;
      }

      // Test coverage validation
      if (filePath.includes('test') || filePath.includes('spec')) {
        await this.validateTestFile(content, errors, warnings);
      } else {
        metrics.testCoverage = await this.calculateTestCoverage(filePath);
        if (metrics.testCoverage < this.config.rules.minTestCoverage) {
          warnings.push(`Test coverage ${metrics.testCoverage}% below threshold ${this.config.rules.minTestCoverage}%`);
        }
      }

      // Complexity validation
      if (metrics.complexity > this.config.rules.maxComplexity) {
        warnings.push(`Cyclomatic complexity ${metrics.complexity} exceeds threshold ${this.config.rules.maxComplexity}`);
      }

    } catch (error) {
      errors.push(`File validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      path: filePath,
      valid: errors.length === 0,
      errors,
      warnings,
      metrics
    };
  }

  /**
   * Discover all files to validate
   */
  private async discoverFiles(): Promise<string[]> {
    const files: string[] = [];
    
    const scanDirectory = async (dir: string): Promise<void> => {
      const entries = await readdir(dir);
      
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const relativePath = relative(this.config.projectRoot, fullPath);
        
        // Skip excluded paths
        if (this.config.excludedPaths.some(excluded => relativePath.startsWith(excluded))) {
          continue;
        }

        const stats = await stat(fullPath);
        
        if (stats.isDirectory()) {
          await scanDirectory(fullPath);
        } else if (stats.isFile()) {
          const ext = extname(entry);
          if (this.config.includedExtensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    };

    await scanDirectory(this.config.projectRoot);
    return files;
  }

  /**
   * Validate TypeScript/JavaScript files
   */
  private async validateTypeScript(
    content: string, 
    filePath: string, 
    errors: string[], 
    warnings: string[],
    metrics: any
  ): Promise<void> {
    // Basic syntax checks
    if (content.includes('any') && !filePath.includes('test')) {
      warnings.push('Usage of "any" type should be avoided, consider more specific types');
    }

    if (content.includes('console.log') && !filePath.includes('test') && !filePath.includes('debug')) {
      warnings.push('Console.log statements should be removed from production code');
    }

    // Security checks
    if (content.includes('eval(') || content.includes('Function(')) {
      errors.push('Dynamic code evaluation (eval/Function) is a security risk');
    }

    // Import/export validation
    const hasDefaultExport = /export\s+default/.test(content);
    const hasNamedExports = /export\s+(?:const|let|var|function|class|interface|type)/.test(content);
    
    if (!hasDefaultExport && !hasNamedExports && !filePath.includes('test') && !filePath.includes('config')) {
      warnings.push('File should export at least one symbol');
    }

    // Calculate complexity (simplified)
    const complexityIndicators = [
      /if\s*\(/, /else/, /switch/, /case/, /for\s*\(/, /while\s*\(/, 
      /catch\s*\(/, /&&/, /\|\|/, /\?.*:/, /=>.*\?/
    ];
    
    metrics.complexity = complexityIndicators.reduce((count, pattern) => {
      const matches = content.match(new RegExp(pattern, 'g'));
      return count + (matches ? matches.length : 0);
    }, 1);

    // Try TypeScript compilation check
    if (extname(filePath) === '.ts') {
      try {
        await execAsync(`npx tsc --noEmit --skipLibCheck "${filePath}"`);
      } catch (error) {
        if (error instanceof Error && error.message.includes('error TS')) {
          errors.push('TypeScript compilation errors detected');
        }
      }
    }
  }

  /**
   * Validate Elixir files
   */
  private async validateElixir(
    content: string, 
    errors: string[], 
    warnings: string[],
    metrics: any
  ): Promise<void> {
    // Basic Elixir patterns
    if (!content.includes('defmodule') && content.length > 100) {
      warnings.push('Elixir file should define a module');
    }

    // Style checks
    if (content.includes('IO.puts') && !content.includes('test')) {
      warnings.push('IO.puts should be replaced with Logger for production code');
    }

    // Pattern matching checks
    const caseStatements = (content.match(/case\s+/g) || []).length;
    const defStatements = (content.match(/def\s+/g) || []).length;
    
    metrics.complexity = caseStatements + defStatements;

    // Docstring validation
    if (content.includes('defmodule') && !content.includes('@moduledoc')) {
      warnings.push('Module should include @moduledoc documentation');
    }
  }

  /**
   * Validate Python files
   */
  private async validatePython(
    content: string, 
    errors: string[], 
    warnings: string[],
    metrics: any
  ): Promise<void> {
    // Basic Python checks
    if (content.includes('print(') && !content.includes('test')) {
      warnings.push('Print statements should be replaced with logging');
    }

    // Import organization
    const lines = content.split('\n');
    let importsSectionEnded = false;
    let blankLineAfterImports = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.startsWith('import ') || line.startsWith('from ')) {
        if (importsSectionEnded) {
          warnings.push('Imports should be grouped at the top of the file');
          break;
        }
      } else if (line === '' && !blankLineAfterImports && i > 0 && 
                (lines[i-1].startsWith('import ') || lines[i-1].startsWith('from '))) {
        blankLineAfterImports = true;
      } else if (line !== '' && !line.startsWith('#')) {
        importsSectionEnded = true;
      }
    }

    // Calculate complexity
    const complexityIndicators = [
      /if\s+/, /elif\s+/, /else:/, /for\s+/, /while\s+/, 
      /except\s*:/, /except\s+\w+/, /and/, /or/, /lambda/
    ];
    
    metrics.complexity = complexityIndicators.reduce((count, pattern) => {
      const matches = content.match(new RegExp(pattern, 'g'));
      return count + (matches ? matches.length : 0);
    }, 1);
  }

  /**
   * Validate JSDoc comments
   */
  private async validateJsDoc(
    content: string, 
    errors: string[], 
    warnings: string[]
  ): Promise<void> {
    // Check for exported functions without JSDoc
    const functionPattern = /export\s+(?:async\s+)?function\s+(\w+)/g;
    const jsDocPattern = /\/\*\*[\s\S]*?\*\//g;
    
    const functions = Array.from(content.matchAll(functionPattern));
    const jsDocs = Array.from(content.matchAll(jsDocPattern));
    
    if (functions.length > jsDocs.length && functions.length > 0) {
      warnings.push(`${functions.length - jsDocs.length} exported functions missing JSDoc documentation`);
    }
  }

  /**
   * Validate test files
   */
  private async validateTestFile(
    content: string, 
    errors: string[], 
    warnings: string[]
  ): Promise<void> {
    // Test framework detection
    const hasVitest = content.includes('describe') || content.includes('it(') || content.includes('test(');
    const hasExUnit = content.includes('defmodule') && content.includes('ExUnit.Case');
    const hasPytest = content.includes('def test_') || content.includes('import pytest');
    
    if (!hasVitest && !hasExUnit && !hasPytest) {
      warnings.push('Test file should use a recognized testing framework');
    }

    // Test coverage
    const testCount = (content.match(/(?:it\(|test\(|def test_)/g) || []).length;
    if (testCount === 0) {
      warnings.push('Test file contains no actual test cases');
    } else if (testCount < 3) {
      warnings.push('Test file has minimal test coverage, consider adding more test cases');
    }

    // Assertion checks
    const hasAssertions = content.includes('expect') || content.includes('assert') || 
                         content.includes('Assert.') || content.includes('refute');
    
    if (!hasAssertions && testCount > 0) {
      errors.push('Test file has test cases but no assertions');
    }
  }

  /**
   * Calculate test coverage for a file (simplified estimation)
   */
  private async calculateTestCoverage(filePath: string): Promise<number> {
    try {
      // Look for corresponding test file
      const testPaths = this.getTestFilePaths(filePath);
      
      for (const testPath of testPaths) {
        try {
          await stat(testPath);
          return 85; // Assume good coverage if test file exists
        } catch {
          // Test file doesn't exist, continue
        }
      }
      
      return 0; // No test file found
    } catch {
      return 0;
    }
  }

  /**
   * Generate possible test file paths
   */
  private getTestFilePaths(filePath: string): string[] {
    const ext = extname(filePath);
    const base = filePath.replace(ext, '');
    const dir = join(filePath, '..');
    
    return [
      `${base}.test${ext}`,
      `${base}.spec${ext}`,
      join(dir, 'test', `${base.split('/').pop()}.test${ext}`),
      join(dir, '__tests__', `${base.split('/').pop()}.test${ext}`),
      join(this.config.projectRoot, 'test', relative(this.config.projectRoot, filePath).replace(ext, `.test${ext}`))
    ];
  }

  /**
   * Generate summary statistics
   */
  private generateSummary(fileResults: FileValidationResult[]) {
    return {
      totalFiles: fileResults.length,
      validFiles: fileResults.filter(f => f.valid).length,
      invalidFiles: fileResults.filter(f => !f.valid).length,
      warnings: fileResults.reduce((sum, f) => sum + f.warnings.length, 0),
      criticalErrors: fileResults.filter(f => f.errors.some(e => 
        e.includes('security') || e.includes('compilation') || e.includes('syntax')
      )).length
    };
  }

  /**
   * Generate recommendations based on validation results
   */
  private generateRecommendations(fileResults: FileValidationResult[]): string[] {
    const recommendations: string[] = [];
    
    const highComplexityFiles = fileResults.filter(f => f.metrics.complexity > this.config.rules.maxComplexity);
    if (highComplexityFiles.length > 0) {
      recommendations.push(`${highComplexityFiles.length} files have high complexity - consider refactoring`);
    }

    const lowCoverageFiles = fileResults.filter(f => f.metrics.testCoverage < this.config.rules.minTestCoverage);
    if (lowCoverageFiles.length > 0) {
      recommendations.push(`${lowCoverageFiles.length} files have insufficient test coverage - add more tests`);
    }

    const longFiles = fileResults.filter(f => f.metrics.lines > this.config.rules.maxFileLength);
    if (longFiles.length > 0) {
      recommendations.push(`${longFiles.length} files are too long - consider splitting into smaller modules`);
    }

    const securityIssues = fileResults.filter(f => f.errors.some(e => e.includes('security')));
    if (securityIssues.length > 0) {
      recommendations.push(`${securityIssues.length} files have security issues - address immediately`);
    }

    return recommendations;
  }

  /**
   * Generate a detailed validation report in markdown format
   */
  generateMarkdownReport(report: ValidationReport): string {
    const md = [
      '# Validation Report',
      '',
      `**Generated:** ${report.timestamp}`,
      `**Status:** ${report.success ? '✅ PASSED' : '❌ FAILED'}`,
      '',
      '## Summary',
      '',
      `- **Total Files:** ${report.summary.totalFiles}`,
      `- **Valid Files:** ${report.summary.validFiles}`,
      `- **Invalid Files:** ${report.summary.invalidFiles}`,
      `- **Warnings:** ${report.summary.warnings}`,
      `- **Critical Errors:** ${report.summary.criticalErrors}`,
      '',
      '## Recommendations',
      '',
      ...report.recommendations.map(r => `- ${r}`),
      '',
      '## File Details',
      ''
    ];

    // Add invalid files first
    const invalidFiles = report.files.filter(f => !f.valid);
    if (invalidFiles.length > 0) {
      md.push('### ❌ Files with Errors', '');
      invalidFiles.forEach(file => {
        md.push(`#### ${relative(this.config.projectRoot, file.path)}`);
        md.push('**Errors:**');
        file.errors.forEach(error => md.push(`- ❌ ${error}`));
        if (file.warnings.length > 0) {
          md.push('**Warnings:**');
          file.warnings.forEach(warning => md.push(`- ⚠️ ${warning}`));
        }
        md.push('');
      });
    }

    // Add files with warnings
    const warningFiles = report.files.filter(f => f.valid && f.warnings.length > 0);
    if (warningFiles.length > 0) {
      md.push('### ⚠️ Files with Warnings', '');
      warningFiles.forEach(file => {
        md.push(`#### ${relative(this.config.projectRoot, file.path)}`);
        md.push('**Warnings:**');
        file.warnings.forEach(warning => md.push(`- ⚠️ ${warning}`));
        md.push('');
      });
    }

    return md.join('\n');
  }
}

// CLI interface for standalone usage
if (process.argv[1] && process.argv[1].endsWith('review-validation-engine.ts')) {
  const engine = new ReviewValidationEngine();
  
  engine.validateProject()
    .then(report => {
      console.log('\n📄 Generating detailed report...');
      const markdownReport = engine.generateMarkdownReport(report);
      console.log(markdownReport);
      
      process.exit(report.success ? 0 : 1);
    })
    .catch(error => {
      console.error('💥 Validation failed:', error);
      process.exit(1);
    });
}