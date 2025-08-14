/**
 * Meta-Validation Engine
 * 
 * Comprehensive meta-validation system that orchestrates and validates
 * all validation engines, ensuring system-wide consistency and quality.
 * Builds on top of the existing ReviewValidationEngine with advanced
 * meta-analysis capabilities.
 */

import { readFile, writeFile } from 'fs/promises';
import { join, relative } from 'path';
import { ReviewValidationEngine, ValidationReport, ValidatorConfig } from './review-validation-engine.js';
import { KanbanValidator } from './kanban-validator.js';
import { WorkspaceValidator } from './workspace-validator.js';
import { ImplementationDepthAnalyzer } from './implementation-depth-analyzer.js';
import { FunctionalIntegrationTester } from './functional-integration-tester.js';
import { Task, KanbanBoard } from './types.js';

export interface ValidatorInstance {
  name: string;
  validator: any;
  weight: number; // Confidence weighting for aggregation
  critical: boolean; // Whether failures block progress
}

export interface MetaValidationResult {
  validator: string;
  success: boolean;
  confidence: number;
  timestamp: string;
  report: any;
  errors: string[];
  warnings: string[];
  metrics: Record<string, any>;
}

export interface ValidationConflict {
  validators: string[];
  issue: string;
  severity: 'critical' | 'warning' | 'info';
  recommendations: string[];
}

export interface MetaValidationReport {
  success: boolean;
  timestamp: string;
  aggregated_confidence: number;
  summary: {
    total_validators: number;
    passed_validators: number;
    failed_validators: number;
    conflicts_detected: number;
    coverage_percentage: number;
  };
  validator_results: MetaValidationResult[];
  conflicts: ValidationConflict[];
  recommendations: string[];
  quality_score: number;
  historical_comparison?: {
    previous_score: number;
    trend: 'improving' | 'declining' | 'stable';
    change_percentage: number;
  };
}

export interface MetaValidationConfig {
  project_root: string;
  kanban_path: string;
  validators: ValidatorInstance[];
  thresholds: {
    min_confidence: number;
    min_quality_score: number;
    max_conflicts: number;
  };
  historical: {
    enabled: boolean;
    max_reports: number;
    trend_analysis: boolean;
  };
  reporting: {
    detailed_mode: boolean;
    include_recommendations: boolean;
    generate_markdown: boolean;
  };
}

export class MetaValidationEngine {
  private config: MetaValidationConfig;
  private validationHistory: MetaValidationReport[] = [];

  constructor(config?: Partial<MetaValidationConfig>) {
    this.config = {
      project_root: process.cwd(),
      kanban_path: join(process.cwd(), 'kanban.yaml'),
      validators: [
        {
          name: 'ReviewValidationEngine',
          validator: new ReviewValidationEngine(),
          weight: 0.25,
          critical: false
        },
        {
          name: 'KanbanValidator',
          validator: new KanbanValidator(),
          weight: 0.25,
          critical: true
        },
        {
          name: 'WorkspaceValidator',
          validator: new WorkspaceValidator(),
          weight: 0.2,
          critical: true
        },
        {
          name: 'ImplementationDepthAnalyzer',
          validator: new ImplementationDepthAnalyzer(),
          weight: 0.2,
          critical: false
        },
        {
          name: 'FunctionalIntegrationTester',
          validator: new FunctionalIntegrationTester(),
          weight: 0.1,
          critical: false
        }
      ],
      thresholds: {
        min_confidence: 0.8,
        min_quality_score: 75,
        max_conflicts: 3
      },
      historical: {
        enabled: true,
        max_reports: 50,
        trend_analysis: true
      },
      reporting: {
        detailed_mode: true,
        include_recommendations: true,
        generate_markdown: true
      },
      ...config
    };

    this.loadValidationHistory();
  }

  /**
   * Execute comprehensive meta-validation across all systems
   */
  async executeMetaValidation(): Promise<MetaValidationReport> {
    const startTime = Date.now();
    console.log('🔍 Starting Meta-Validation Engine...');
    
    try {
      // Execute all validators in parallel where possible
      const validatorResults = await this.executeValidators();
      
      // Analyze cross-validator conflicts and inconsistencies
      const conflicts = await this.detectValidationConflicts(validatorResults);
      
      // Calculate aggregated confidence and quality metrics
      const aggregatedConfidence = this.calculateAggregatedConfidence(validatorResults);
      const qualityScore = this.calculateQualityScore(validatorResults, conflicts);
      
      // Generate comprehensive recommendations
      const recommendations = this.generateMetaRecommendations(validatorResults, conflicts);
      
      // Build final report
      const report: MetaValidationReport = {
        success: this.determineOverallSuccess(validatorResults, conflicts, aggregatedConfidence, qualityScore),
        timestamp: new Date().toISOString(),
        aggregated_confidence: aggregatedConfidence,
        summary: {
          total_validators: this.config.validators.length,
          passed_validators: validatorResults.filter(r => r.success).length,
          failed_validators: validatorResults.filter(r => !r.success).length,
          conflicts_detected: conflicts.length,
          coverage_percentage: this.calculateCoveragePercentage(validatorResults)
        },
        validator_results: validatorResults,
        conflicts,
        recommendations,
        quality_score: qualityScore
      };

      // Add historical comparison if enabled
      if (this.config.historical.enabled && this.validationHistory.length > 0) {
        report.historical_comparison = this.generateHistoricalComparison(qualityScore);
      }

      // Store in validation history
      await this.storeValidationHistory(report);

      console.log(`✅ Meta-validation completed in ${Date.now() - startTime}ms`);
      console.log(`📊 Overall Quality Score: ${qualityScore}/100`);
      console.log(`🎯 Aggregated Confidence: ${(aggregatedConfidence * 100).toFixed(1)}%`);
      console.log(`⚖️  Conflicts Detected: ${conflicts.length}`);

      return report;

    } catch (error) {
      console.error('💥 Meta-validation failed:', error);
      throw new Error(`Meta-validation engine error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Execute all configured validators
   */
  private async executeValidators(): Promise<MetaValidationResult[]> {
    console.log(`🔧 Executing ${this.config.validators.length} validators...`);
    
    const results: MetaValidationResult[] = [];
    
    for (const validatorConfig of this.config.validators) {
      try {
        console.log(`  ⚡ Running ${validatorConfig.name}...`);
        const startTime = Date.now();
        
        let report: any;
        let success = true;
        let confidence = 1.0;
        const errors: string[] = [];
        const warnings: string[] = [];
        const metrics: Record<string, any> = {};

        // Execute validator based on its type
        switch (validatorConfig.name) {
          case 'ReviewValidationEngine':
            report = await validatorConfig.validator.validateProject();
            success = report.success;
            confidence = this.calculateReviewValidationConfidence(report);
            metrics.files_analyzed = report.summary.totalFiles;
            metrics.coverage_percentage = ((report.summary.validFiles / report.summary.totalFiles) * 100);
            break;

          case 'KanbanValidator':
            report = await validatorConfig.validator.validateKanban(this.config.kanban_path);
            success = report.valid;
            confidence = report.confidence || 1.0;
            if (report.errors) errors.push(...report.errors);
            if (report.warnings) warnings.push(...report.warnings);
            break;

          case 'WorkspaceValidator':
            report = await this.executeWorkspaceValidation(validatorConfig.validator);
            success = report.valid;
            confidence = report.confidence || 1.0;
            break;

          case 'ImplementationDepthAnalyzer':
            report = await this.executeDepthAnalysis(validatorConfig.validator);
            success = report.overall_score > 70;
            confidence = report.overall_score / 100;
            metrics.depth_score = report.overall_score;
            break;

          case 'FunctionalIntegrationTester':
            report = await this.executeFunctionalTesting(validatorConfig.validator);
            success = report.success_rate > 0.8;
            confidence = report.success_rate;
            metrics.tests_passed = report.passed;
            metrics.tests_total = report.total;
            break;

          default:
            throw new Error(`Unknown validator: ${validatorConfig.name}`);
        }

        const result: MetaValidationResult = {
          validator: validatorConfig.name,
          success,
          confidence,
          timestamp: new Date().toISOString(),
          report,
          errors,
          warnings,
          metrics: {
            ...metrics,
            execution_time_ms: Date.now() - startTime,
            weight: validatorConfig.weight,
            critical: validatorConfig.critical
          }
        };

        results.push(result);
        console.log(`    ✅ ${validatorConfig.name}: ${success ? 'PASS' : 'FAIL'} (${(confidence * 100).toFixed(1)}%)`);

      } catch (error) {
        console.error(`    ❌ ${validatorConfig.name}: ERROR`);
        results.push({
          validator: validatorConfig.name,
          success: false,
          confidence: 0,
          timestamp: new Date().toISOString(),
          report: null,
          errors: [error instanceof Error ? error.message : String(error)],
          warnings: [],
          metrics: {
            execution_time_ms: 0,
            weight: validatorConfig.weight,
            critical: validatorConfig.critical
          }
        });
      }
    }

    return results;
  }

  /**
   * Detect conflicts and inconsistencies between validators
   */
  private async detectValidationConflicts(results: MetaValidationResult[]): Promise<ValidationConflict[]> {
    const conflicts: ValidationConflict[] = [];

    // Check for success/failure conflicts on critical validators
    const criticalValidators = results.filter(r => r.metrics.critical);
    const criticalFailures = criticalValidators.filter(r => !r.success);
    const nonCriticalSuccesses = results.filter(r => !r.metrics.critical && r.success);

    if (criticalFailures.length > 0 && nonCriticalSuccesses.length > 0) {
      conflicts.push({
        validators: [...criticalFailures.map(r => r.validator), ...nonCriticalSuccesses.map(r => r.validator)],
        issue: 'Critical validators failing while non-critical validators pass',
        severity: 'critical',
        recommendations: [
          'Address critical validation failures before proceeding',
          'Review dependency relationships between validators',
          'Consider if critical validators need configuration updates'
        ]
      });
    }

    // Check for confidence discrepancies
    const highConfidenceResults = results.filter(r => r.confidence > 0.9);
    const lowConfidenceResults = results.filter(r => r.confidence < 0.5);

    if (highConfidenceResults.length > 0 && lowConfidenceResults.length > 0) {
      conflicts.push({
        validators: [...highConfidenceResults.map(r => r.validator), ...lowConfidenceResults.map(r => r.validator)],
        issue: 'Significant confidence variance between validators',
        severity: 'warning',
        recommendations: [
          'Investigate why some validators have low confidence',
          'Review validation criteria for consistency',
          'Consider rebalancing validator weights'
        ]
      });
    }

    // File-level validation conflicts
    const reviewResults = results.find(r => r.validator === 'ReviewValidationEngine');
    const depthResults = results.find(r => r.validator === 'ImplementationDepthAnalyzer');
    
    if (reviewResults && depthResults && reviewResults.success && !depthResults.success) {
      conflicts.push({
        validators: ['ReviewValidationEngine', 'ImplementationDepthAnalyzer'],
        issue: 'Code passes review validation but fails depth analysis',
        severity: 'warning',
        recommendations: [
          'Review implementation depth standards',
          'Consider if superficial implementations are acceptable',
          'Align validation criteria between systems'
        ]
      });
    }

    return conflicts;
  }

  /**
   * Calculate aggregated confidence across all validators
   */
  private calculateAggregatedConfidence(results: MetaValidationResult[]): number {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const result of results) {
      const weight = result.metrics.weight || 0.2;
      weightedSum += result.confidence * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Calculate overall quality score
   */
  private calculateQualityScore(results: MetaValidationResult[], conflicts: ValidationConflict[]): number {
    const baseScore = this.calculateAggregatedConfidence(results) * 100;
    
    // Deduct points for conflicts
    const conflictPenalty = conflicts.reduce((penalty, conflict) => {
      switch (conflict.severity) {
        case 'critical': return penalty + 15;
        case 'warning': return penalty + 5;
        case 'info': return penalty + 1;
        default: return penalty;
      }
    }, 0);

    // Deduct points for critical failures
    const criticalFailures = results.filter(r => r.metrics.critical && !r.success).length;
    const criticalPenalty = criticalFailures * 20;

    // Bonus for all validators passing
    const allPassed = results.every(r => r.success);
    const passBonus = allPassed ? 5 : 0;

    const finalScore = Math.max(0, Math.min(100, baseScore - conflictPenalty - criticalPenalty + passBonus));
    return Math.round(finalScore);
  }

  /**
   * Generate comprehensive meta-recommendations
   */
  private generateMetaRecommendations(results: MetaValidationResult[], conflicts: ValidationConflict[]): string[] {
    const recommendations: string[] = [];

    // Critical failure recommendations
    const criticalFailures = results.filter(r => r.metrics.critical && !r.success);
    if (criticalFailures.length > 0) {
      recommendations.push(`CRITICAL: ${criticalFailures.length} critical validators failing - system may be unstable`);
      criticalFailures.forEach(failure => {
        recommendations.push(`  - Fix ${failure.validator}: ${failure.errors.join(', ')}`);
      });
    }

    // Low confidence recommendations
    const lowConfidence = results.filter(r => r.confidence < 0.6);
    if (lowConfidence.length > 0) {
      recommendations.push(`${lowConfidence.length} validators have low confidence - review validation criteria`);
    }

    // Conflict-specific recommendations
    conflicts.forEach(conflict => {
      recommendations.push(`Resolve conflict: ${conflict.issue}`);
      conflict.recommendations.forEach(rec => recommendations.push(`  - ${rec}`));
    });

    // Performance recommendations
    const slowValidators = results.filter(r => r.metrics.execution_time_ms > 10000);
    if (slowValidators.length > 0) {
      recommendations.push(`${slowValidators.length} validators are slow (>10s) - consider optimization`);
    }

    // Coverage recommendations
    const coveragePercentage = this.calculateCoveragePercentage(results);
    if (coveragePercentage < 80) {
      recommendations.push(`Validation coverage is ${coveragePercentage.toFixed(1)}% - consider adding more validators or expanding scope`);
    }

    return recommendations;
  }

  /**
   * Determine overall meta-validation success
   */
  private determineOverallSuccess(
    results: MetaValidationResult[],
    conflicts: ValidationConflict[],
    confidence: number,
    qualityScore: number
  ): boolean {
    // Critical validators must pass
    const criticalFailures = results.filter(r => r.metrics.critical && !r.success);
    if (criticalFailures.length > 0) return false;

    // Must meet minimum confidence threshold
    if (confidence < this.config.thresholds.min_confidence) return false;

    // Must meet minimum quality score
    if (qualityScore < this.config.thresholds.min_quality_score) return false;

    // Must not exceed maximum conflicts
    const criticalConflicts = conflicts.filter(c => c.severity === 'critical');
    if (criticalConflicts.length > this.config.thresholds.max_conflicts) return false;

    return true;
  }

  /**
   * Helper method to calculate coverage percentage
   */
  private calculateCoveragePercentage(results: MetaValidationResult[]): number {
    // Simple coverage metric based on successful validations and their scope
    const totalScope = results.reduce((sum, r) => sum + (r.metrics.weight || 0.2), 0);
    const validatedScope = results
      .filter(r => r.success)
      .reduce((sum, r) => sum + (r.metrics.weight || 0.2), 0);

    return totalScope > 0 ? (validatedScope / totalScope) * 100 : 0;
  }

  /**
   * Calculate confidence for ReviewValidationEngine results
   */
  private calculateReviewValidationConfidence(report: ValidationReport): number {
    if (!report || report.summary.totalFiles === 0) return 0;
    
    const successRate = report.summary.validFiles / report.summary.totalFiles;
    const errorPenalty = report.summary.criticalErrors * 0.1;
    const warningPenalty = report.summary.warnings * 0.01;
    
    return Math.max(0, Math.min(1, successRate - errorPenalty - warningPenalty));
  }

  /**
   * Execute workspace validation
   */
  private async executeWorkspaceValidation(validator: any): Promise<any> {
    // WorkspaceValidator may not have a standard interface, adapt as needed
    try {
      const result = await validator.validateCurrentWorkspace();
      return { valid: true, confidence: 1.0, ...result };
    } catch (error) {
      return { 
        valid: false, 
        confidence: 0, 
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Execute depth analysis
   */
  private async executeDepthAnalysis(analyzer: any): Promise<any> {
    try {
      const result = await analyzer.analyzeProject();
      return result;
    } catch (error) {
      return { 
        overall_score: 0, 
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Execute functional testing
   */
  private async executeFunctionalTesting(tester: any): Promise<any> {
    try {
      const report = await tester.runAllTests(); // Use correct method name
      
      // Adapt the report format to match expected interface
      return {
        success_rate: report.summary.successRate / 100,
        passed: report.summary.passed,
        total: report.summary.total,
        failed: report.summary.failed,
        duration: report.summary.duration,
        performance: report.performance,
        reliability: report.reliability,
        recommendations: report.recommendations
      };
    } catch (error) {
      return { 
        success_rate: 0, 
        passed: 0, 
        total: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Generate historical comparison
   */
  private generateHistoricalComparison(currentScore: number) {
    const previousReport = this.validationHistory[this.validationHistory.length - 1];
    if (!previousReport) return undefined;

    const previousScore = previousReport.quality_score;
    const changePercentage = ((currentScore - previousScore) / previousScore) * 100;
    
    let trend: 'improving' | 'declining' | 'stable' = 'stable';
    if (Math.abs(changePercentage) > 5) {
      trend = changePercentage > 0 ? 'improving' : 'declining';
    }

    return {
      previous_score: previousScore,
      trend,
      change_percentage: Math.round(changePercentage * 100) / 100
    };
  }

  /**
   * Load validation history from storage
   */
  private async loadValidationHistory(): Promise<void> {
    if (!this.config.historical.enabled) return;

    try {
      const historyPath = join(this.config.project_root, '.meta-validation-history.json');
      const historyData = await readFile(historyPath, 'utf-8');
      this.validationHistory = JSON.parse(historyData);
    } catch {
      // History file doesn't exist or is corrupted, start fresh
      this.validationHistory = [];
    }
  }

  /**
   * Store validation history to storage
   */
  private async storeValidationHistory(report: MetaValidationReport): Promise<void> {
    if (!this.config.historical.enabled) return;

    try {
      // Add current report to history
      this.validationHistory.push(report);

      // Trim history to max size
      if (this.validationHistory.length > this.config.historical.max_reports) {
        this.validationHistory = this.validationHistory.slice(-this.config.historical.max_reports);
      }

      // Save to file
      const historyPath = join(this.config.project_root, '.meta-validation-history.json');
      await writeFile(historyPath, JSON.stringify(this.validationHistory, null, 2));
    } catch (error) {
      console.warn('Failed to store validation history:', error);
    }
  }

  /**
   * Generate markdown report
   */
  generateMarkdownReport(report: MetaValidationReport): string {
    if (!this.config.reporting.generate_markdown) return '';

    const md = [
      '# Meta-Validation Report',
      '',
      `**Generated:** ${report.timestamp}`,
      `**Status:** ${report.success ? '✅ PASSED' : '❌ FAILED'}`,
      `**Quality Score:** ${report.quality_score}/100`,
      `**Aggregated Confidence:** ${(report.aggregated_confidence * 100).toFixed(1)}%`,
      '',
      '## Summary',
      '',
      `- **Total Validators:** ${report.summary.total_validators}`,
      `- **Passed:** ${report.summary.passed_validators}`,
      `- **Failed:** ${report.summary.failed_validators}`,
      `- **Conflicts:** ${report.summary.conflicts_detected}`,
      `- **Coverage:** ${report.summary.coverage_percentage.toFixed(1)}%`,
      ''
    ];

    // Historical comparison
    if (report.historical_comparison) {
      md.push('## Historical Trend', '');
      md.push(`- **Previous Score:** ${report.historical_comparison.previous_score}/100`);
      md.push(`- **Trend:** ${report.historical_comparison.trend.toUpperCase()}`);
      md.push(`- **Change:** ${report.historical_comparison.change_percentage > 0 ? '+' : ''}${report.historical_comparison.change_percentage}%`);
      md.push('');
    }

    // Validator Results
    md.push('## Validator Results', '');
    report.validator_results.forEach(result => {
      const status = result.success ? '✅' : '❌';
      const confidence = (result.confidence * 100).toFixed(1);
      md.push(`### ${status} ${result.validator} (${confidence}%)`);
      
      if (result.errors.length > 0) {
        md.push('**Errors:**');
        result.errors.forEach(error => md.push(`- ❌ ${error}`));
      }
      
      if (result.warnings.length > 0) {
        md.push('**Warnings:**');
        result.warnings.forEach(warning => md.push(`- ⚠️ ${warning}`));
      }
      
      md.push('');
    });

    // Conflicts
    if (report.conflicts.length > 0) {
      md.push('## Validation Conflicts', '');
      report.conflicts.forEach(conflict => {
        const icon = conflict.severity === 'critical' ? '🚨' : conflict.severity === 'warning' ? '⚠️' : 'ℹ️';
        md.push(`### ${icon} ${conflict.issue}`);
        md.push(`**Affected Validators:** ${conflict.validators.join(', ')}`);
        md.push('**Recommendations:**');
        conflict.recommendations.forEach(rec => md.push(`- ${rec}`));
        md.push('');
      });
    }

    // Recommendations
    if (this.config.reporting.include_recommendations && report.recommendations.length > 0) {
      md.push('## Recommendations', '');
      report.recommendations.forEach(rec => md.push(`- ${rec}`));
      md.push('');
    }

    return md.join('\n');
  }
}

// CLI interface
if (process.argv[1] && process.argv[1].endsWith('meta-validation-engine.ts')) {
  const engine = new MetaValidationEngine();
  
  engine.executeMetaValidation()
    .then(report => {
      console.log('\n📄 Generating detailed meta-validation report...');
      const markdownReport = engine.generateMarkdownReport(report);
      console.log(markdownReport);
      
      process.exit(report.success ? 0 : 1);
    })
    .catch(error => {
      console.error('💥 Meta-validation failed:', error);
      process.exit(1);
    });
}