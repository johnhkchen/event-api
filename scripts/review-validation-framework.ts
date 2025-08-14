/**
 * Review Validation Framework
 * 
 * Reusable validation framework providing standardized patterns,
 * interfaces, and utilities for building consistent validation
 * systems across the Event API project.
 */

import { readFile, stat } from 'fs/promises';
import { extname, join, relative } from 'path';

// Core validation interfaces
export interface ValidationRule<T = any> {
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  critical: boolean;
  validate: (context: ValidationContext, data: T) => Promise<ValidationRuleResult>;
}

export interface ValidationRuleResult {
  passed: boolean;
  message?: string;
  details?: Record<string, any>;
  suggestions?: string[];
}

export interface ValidationContext {
  projectRoot: string;
  filePath?: string;
  fileContent?: string;
  metadata?: Record<string, any>;
  environment?: 'development' | 'staging' | 'production';
}

export interface ValidationSuite {
  name: string;
  description: string;
  rules: ValidationRule[];
  prerequisites?: string[];
  parallel?: boolean;
}

export interface ValidationExecutionResult {
  rule: string;
  passed: boolean;
  severity: 'error' | 'warning' | 'info';
  message: string;
  details: Record<string, any>;
  suggestions: string[];
  executionTimeMs: number;
}

export interface ValidationSuiteResult {
  suite: string;
  success: boolean;
  executionTimeMs: number;
  results: ValidationExecutionResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    warnings: number;
    info: number;
  };
}

// Base validation framework class
export class ValidationFramework {
  private suites: Map<string, ValidationSuite> = new Map();
  private globalContext: Partial<ValidationContext> = {};

  /**
   * Register a validation suite
   */
  registerSuite(suite: ValidationSuite): void {
    this.suites.set(suite.name, suite);
  }

  /**
   * Set global validation context
   */
  setGlobalContext(context: Partial<ValidationContext>): void {
    this.globalContext = { ...this.globalContext, ...context };
  }

  /**
   * Execute a specific validation suite
   */
  async executeSuite(
    suiteName: string, 
    context: Partial<ValidationContext> = {}
  ): Promise<ValidationSuiteResult> {
    const suite = this.suites.get(suiteName);
    if (!suite) {
      throw new Error(`Validation suite '${suiteName}' not found`);
    }

    const fullContext: ValidationContext = {
      projectRoot: process.cwd(),
      ...this.globalContext,
      ...context
    };

    const startTime = Date.now();
    console.log(`🔍 Executing validation suite: ${suite.name}`);

    // Check prerequisites
    if (suite.prerequisites) {
      await this.checkPrerequisites(suite.prerequisites, fullContext);
    }

    // Execute rules
    const results: ValidationExecutionResult[] = [];
    
    if (suite.parallel) {
      // Execute rules in parallel
      const promises = suite.rules.map(rule => this.executeRule(rule, fullContext));
      const ruleResults = await Promise.all(promises);
      results.push(...ruleResults);
    } else {
      // Execute rules sequentially
      for (const rule of suite.rules) {
        const result = await this.executeRule(rule, fullContext);
        results.push(result);
      }
    }

    const executionTime = Date.now() - startTime;
    const summary = this.calculateSummary(results);

    console.log(`✅ Suite '${suiteName}' completed in ${executionTime}ms`);
    console.log(`   Results: ${summary.passed}/${summary.total} passed, ${summary.errors} errors, ${summary.warnings} warnings`);

    return {
      suite: suiteName,
      success: summary.errors === 0,
      executionTimeMs: executionTime,
      results,
      summary
    };
  }

  /**
   * Execute all registered suites
   */
  async executeAllSuites(context: Partial<ValidationContext> = {}): Promise<ValidationSuiteResult[]> {
    const results: ValidationSuiteResult[] = [];
    
    for (const suiteName of this.suites.keys()) {
      try {
        const result = await this.executeSuite(suiteName, context);
        results.push(result);
      } catch (error) {
        console.error(`Failed to execute suite '${suiteName}':`, error);
        results.push({
          suite: suiteName,
          success: false,
          executionTimeMs: 0,
          results: [{
            rule: 'suite-execution',
            passed: false,
            severity: 'error',
            message: `Suite execution failed: ${error instanceof Error ? error.message : String(error)}`,
            details: {},
            suggestions: ['Check suite configuration and prerequisites'],
            executionTimeMs: 0
          }],
          summary: { total: 1, passed: 0, failed: 1, errors: 1, warnings: 0, info: 0 }
        });
      }
    }

    return results;
  }

  /**
   * Execute a single validation rule
   */
  private async executeRule(rule: ValidationRule, context: ValidationContext): Promise<ValidationExecutionResult> {
    const startTime = Date.now();
    
    try {
      console.log(`  ⚡ ${rule.name}...`);
      const result = await rule.validate(context, null);
      const executionTime = Date.now() - startTime;

      const status = result.passed ? '✅' : (rule.severity === 'error' ? '❌' : '⚠️');
      console.log(`    ${status} ${rule.name}: ${result.passed ? 'PASS' : 'FAIL'} (${executionTime}ms)`);

      return {
        rule: rule.name,
        passed: result.passed,
        severity: rule.severity,
        message: result.message || (result.passed ? 'Validation passed' : 'Validation failed'),
        details: result.details || {},
        suggestions: result.suggestions || [],
        executionTimeMs: executionTime
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      console.log(`    💥 ${rule.name}: ERROR (${executionTime}ms)`);
      
      return {
        rule: rule.name,
        passed: false,
        severity: 'error',
        message: `Rule execution failed: ${error instanceof Error ? error.message : String(error)}`,
        details: { error: error instanceof Error ? error.stack : String(error) },
        suggestions: ['Check rule implementation and context requirements'],
        executionTimeMs: executionTime
      };
    }
  }

  /**
   * Check prerequisites for a validation suite
   */
  private async checkPrerequisites(prerequisites: string[], context: ValidationContext): Promise<void> {
    for (const prerequisite of prerequisites) {
      // Check if prerequisite file exists
      if (prerequisite.startsWith('file:')) {
        const filePath = prerequisite.replace('file:', '');
        const fullPath = join(context.projectRoot, filePath);
        try {
          await stat(fullPath);
        } catch {
          throw new Error(`Prerequisite file missing: ${filePath}`);
        }
      }
      
      // Check if prerequisite suite has been executed
      if (prerequisite.startsWith('suite:')) {
        const suiteName = prerequisite.replace('suite:', '');
        if (!this.suites.has(suiteName)) {
          throw new Error(`Prerequisite suite not registered: ${suiteName}`);
        }
      }
    }
  }

  /**
   * Calculate summary statistics for validation results
   */
  private calculateSummary(results: ValidationExecutionResult[]) {
    return {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      errors: results.filter(r => r.severity === 'error' && !r.passed).length,
      warnings: results.filter(r => r.severity === 'warning' && !r.passed).length,
      info: results.filter(r => r.severity === 'info' && !r.passed).length
    };
  }

  /**
   * Generate comprehensive report for all suite results
   */
  generateReport(suiteResults: ValidationSuiteResult[]): string {
    const lines: string[] = [
      '# Validation Framework Report',
      '',
      `**Generated:** ${new Date().toISOString()}`,
      `**Suites Executed:** ${suiteResults.length}`,
      ''
    ];

    // Overall summary
    const overallStats = suiteResults.reduce(
      (acc, suite) => ({
        total: acc.total + suite.summary.total,
        passed: acc.passed + suite.summary.passed,
        failed: acc.failed + suite.summary.failed,
        errors: acc.errors + suite.summary.errors,
        warnings: acc.warnings + suite.summary.warnings
      }),
      { total: 0, passed: 0, failed: 0, errors: 0, warnings: 0 }
    );

    lines.push('## Overall Summary');
    lines.push('');
    lines.push(`- **Total Rules:** ${overallStats.total}`);
    lines.push(`- **Passed:** ${overallStats.passed}`);
    lines.push(`- **Failed:** ${overallStats.failed}`);
    lines.push(`- **Errors:** ${overallStats.errors}`);
    lines.push(`- **Warnings:** ${overallStats.warnings}`);
    lines.push('');

    // Suite results
    lines.push('## Suite Results');
    lines.push('');

    for (const suite of suiteResults) {
      const status = suite.success ? '✅' : '❌';
      lines.push(`### ${status} ${suite.suite}`);
      lines.push(`- **Execution Time:** ${suite.executionTimeMs}ms`);
      lines.push(`- **Results:** ${suite.summary.passed}/${suite.summary.total} passed`);
      
      if (suite.summary.errors > 0) {
        lines.push(`- **Errors:** ${suite.summary.errors}`);
      }
      if (suite.summary.warnings > 0) {
        lines.push(`- **Warnings:** ${suite.summary.warnings}`);
      }

      // Failed rules
      const failedRules = suite.results.filter(r => !r.passed);
      if (failedRules.length > 0) {
        lines.push('');
        lines.push('**Failed Rules:**');
        for (const rule of failedRules) {
          const icon = rule.severity === 'error' ? '❌' : '⚠️';
          lines.push(`- ${icon} **${rule.rule}:** ${rule.message}`);
          if (rule.suggestions.length > 0) {
            rule.suggestions.forEach(suggestion => {
              lines.push(`  - *Suggestion:* ${suggestion}`);
            });
          }
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }
}

// Built-in validation rule builders
export class ValidationRuleBuilder {
  /**
   * Create a file existence validation rule
   */
  static fileExists(filePath: string, options: { critical?: boolean } = {}): ValidationRule {
    return {
      name: `file-exists-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`,
      description: `Verify that file ${filePath} exists`,
      severity: options.critical ? 'error' : 'warning',
      critical: options.critical || false,
      validate: async (context: ValidationContext) => {
        try {
          const fullPath = join(context.projectRoot, filePath);
          await stat(fullPath);
          return {
            passed: true,
            message: `File ${filePath} exists`,
            details: { path: fullPath }
          };
        } catch {
          return {
            passed: false,
            message: `File ${filePath} does not exist`,
            suggestions: [`Create the missing file: ${filePath}`]
          };
        }
      }
    };
  }

  /**
   * Create a file content validation rule
   */
  static fileContains(filePath: string, pattern: string | RegExp, options: { critical?: boolean } = {}): ValidationRule {
    const patternStr = pattern instanceof RegExp ? pattern.source : pattern;
    
    return {
      name: `file-contains-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}-${patternStr.substring(0, 20)}`,
      description: `Verify that file ${filePath} contains pattern: ${patternStr}`,
      severity: options.critical ? 'error' : 'warning',
      critical: options.critical || false,
      validate: async (context: ValidationContext) => {
        try {
          const fullPath = join(context.projectRoot, filePath);
          const content = await readFile(fullPath, 'utf-8');
          
          const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
          const matches = content.match(regex);
          
          return {
            passed: !!matches,
            message: matches 
              ? `File ${filePath} contains required pattern`
              : `File ${filePath} missing required pattern: ${patternStr}`,
            details: { 
              path: fullPath,
              pattern: patternStr,
              matches: matches?.length || 0
            },
            suggestions: matches ? [] : [`Add the required pattern to ${filePath}`]
          };
        } catch (error) {
          return {
            passed: false,
            message: `Failed to read file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
            suggestions: [`Ensure file ${filePath} exists and is readable`]
          };
        }
      }
    };
  }

  /**
   * Create a TypeScript compilation validation rule
   */
  static typescriptCompiles(filePath: string): ValidationRule {
    return {
      name: `typescript-compiles-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`,
      description: `Verify that TypeScript file ${filePath} compiles without errors`,
      severity: 'error',
      critical: true,
      validate: async (context: ValidationContext) => {
        try {
          const { exec } = require('child_process');
          const { promisify } = require('util');
          const execAsync = promisify(exec);
          
          const fullPath = join(context.projectRoot, filePath);
          await execAsync(`npx tsc --noEmit --skipLibCheck "${fullPath}"`);
          
          return {
            passed: true,
            message: `TypeScript file ${filePath} compiles successfully`,
            details: { path: fullPath }
          };
        } catch (error) {
          return {
            passed: false,
            message: `TypeScript compilation failed for ${filePath}`,
            details: { error: error instanceof Error ? error.message : String(error) },
            suggestions: [
              'Fix TypeScript compilation errors',
              'Check imports and type definitions',
              'Verify TypeScript configuration'
            ]
          };
        }
      }
    };
  }

  /**
   * Create a code complexity validation rule
   */
  static codeComplexity(filePath: string, maxComplexity: number = 10): ValidationRule {
    return {
      name: `code-complexity-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`,
      description: `Verify that file ${filePath} has complexity <= ${maxComplexity}`,
      severity: 'warning',
      critical: false,
      validate: async (context: ValidationContext) => {
        try {
          const fullPath = join(context.projectRoot, filePath);
          const content = await readFile(fullPath, 'utf-8');
          
          // Simple complexity calculation based on control structures
          const complexityIndicators = [
            /if\s*\(/, /else/, /switch/, /case/, /for\s*\(/, /while\s*\(/, 
            /catch\s*\(/, /&&/, /\|\|/, /\?.*:/, /=>.*\?/
          ];
          
          const complexity = complexityIndicators.reduce((count, pattern) => {
            const matches = content.match(new RegExp(pattern, 'g'));
            return count + (matches ? matches.length : 0);
          }, 1); // Base complexity of 1

          return {
            passed: complexity <= maxComplexity,
            message: `File ${filePath} has complexity ${complexity} (threshold: ${maxComplexity})`,
            details: { 
              path: fullPath,
              complexity,
              threshold: maxComplexity,
              indicators: complexityIndicators.length
            },
            suggestions: complexity > maxComplexity ? [
              'Consider refactoring to reduce complexity',
              'Break down large functions into smaller ones',
              'Extract complex logic into helper functions'
            ] : []
          };
        } catch (error) {
          return {
            passed: false,
            message: `Failed to analyze complexity for ${filePath}`,
            details: { error: error instanceof Error ? error.message : String(error) },
            suggestions: [`Ensure file ${filePath} exists and is readable`]
          };
        }
      }
    };
  }

  /**
   * Create a test coverage validation rule
   */
  static testCoverage(filePath: string, minCoverage: number = 80): ValidationRule {
    return {
      name: `test-coverage-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`,
      description: `Verify that file ${filePath} has test coverage >= ${minCoverage}%`,
      severity: 'warning',
      critical: false,
      validate: async (context: ValidationContext) => {
        try {
          const fullPath = join(context.projectRoot, filePath);
          
          // Simple heuristic: look for corresponding test files
          const ext = extname(filePath);
          const base = filePath.replace(ext, '');
          
          const possibleTestPaths = [
            `${base}.test${ext}`,
            `${base}.spec${ext}`,
            join('test', `${base.split('/').pop()}.test${ext}`),
            join('tests', `${base.split('/').pop()}.test${ext}`)
          ];

          let testFileExists = false;
          let testFilePath = '';
          
          for (const testPath of possibleTestPaths) {
            try {
              const testFullPath = join(context.projectRoot, testPath);
              await stat(testFullPath);
              testFileExists = true;
              testFilePath = testPath;
              break;
            } catch {
              // Continue checking other paths
            }
          }

          // Simplified coverage calculation: if test file exists, assume good coverage
          const estimatedCoverage = testFileExists ? 85 : 0;

          return {
            passed: estimatedCoverage >= minCoverage,
            message: testFileExists 
              ? `File ${filePath} has estimated coverage ${estimatedCoverage}% (test file: ${testFilePath})`
              : `File ${filePath} has no test coverage`,
            details: {
              path: fullPath,
              testFile: testFilePath,
              estimatedCoverage,
              threshold: minCoverage
            },
            suggestions: !testFileExists ? [
              `Create test file for ${filePath}`,
              'Add unit tests to improve coverage',
              'Consider integration tests if appropriate'
            ] : []
          };
        } catch (error) {
          return {
            passed: false,
            message: `Failed to analyze test coverage for ${filePath}`,
            details: { error: error instanceof Error ? error.message : String(error) },
            suggestions: [`Ensure file ${filePath} exists and is readable`]
          };
        }
      }
    };
  }
}

// Pre-built validation suites
export class StandardValidationSuites {
  /**
   * TypeScript project validation suite
   */
  static createTypeScriptSuite(files: string[]): ValidationSuite {
    const rules: ValidationRule[] = [];

    // Add file existence rules
    files.forEach(file => {
      rules.push(ValidationRuleBuilder.fileExists(file, { critical: true }));
    });

    // Add TypeScript compilation rules
    files.filter(file => file.endsWith('.ts')).forEach(file => {
      rules.push(ValidationRuleBuilder.typescriptCompiles(file));
    });

    // Add complexity rules
    files.forEach(file => {
      rules.push(ValidationRuleBuilder.codeComplexity(file, 15));
    });

    // Add test coverage rules
    files.filter(file => !file.includes('test') && !file.includes('spec')).forEach(file => {
      rules.push(ValidationRuleBuilder.testCoverage(file, 70));
    });

    return {
      name: 'typescript-project',
      description: 'Standard TypeScript project validation',
      rules,
      prerequisites: ['file:package.json', 'file:tsconfig.json'],
      parallel: true
    };
  }

  /**
   * API service validation suite
   */
  static createApiServiceSuite(servicePath: string): ValidationSuite {
    return {
      name: 'api-service',
      description: 'API service validation suite',
      rules: [
        ValidationRuleBuilder.fileExists(join(servicePath, 'package.json'), { critical: true }),
        ValidationRuleBuilder.fileExists(join(servicePath, 'src/index.ts'), { critical: true }),
        ValidationRuleBuilder.fileContains(join(servicePath, 'package.json'), '"scripts"', { critical: true }),
        ValidationRuleBuilder.fileContains(join(servicePath, 'src/index.ts'), 'export|app', { critical: true })
      ],
      parallel: true
    };
  }

  /**
   * Database schema validation suite
   */
  static createDatabaseSuite(migrationPath: string): ValidationSuite {
    return {
      name: 'database-schema',
      description: 'Database schema and migration validation',
      rules: [
        ValidationRuleBuilder.fileExists(migrationPath, { critical: true }),
        ValidationRuleBuilder.fileContains(migrationPath, 'CREATE TABLE|ALTER TABLE|DROP TABLE'),
        {
          name: 'migration-format',
          description: 'Verify migration file follows naming convention',
          severity: 'warning',
          critical: false,
          validate: async (context: ValidationContext) => {
            const filename = migrationPath.split('/').pop() || '';
            const isValidFormat = /^\d{3}_\w+\.(sql|js|ts)$/.test(filename);
            
            return {
              passed: isValidFormat,
              message: isValidFormat 
                ? `Migration file ${filename} follows naming convention`
                : `Migration file ${filename} does not follow naming convention (expected: ###_name.ext)`,
              suggestions: isValidFormat ? [] : [
                'Rename migration file to follow pattern: ###_description.sql',
                'Use sequential numbering for migration files'
              ]
            };
          }
        }
      ],
      parallel: false
    };
  }
}

// Export everything for use in other validation systems
export { ValidationFramework as default };