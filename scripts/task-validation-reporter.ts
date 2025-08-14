/**
 * Task Validation Reporter
 * 
 * Advanced reporting system that generates comprehensive, actionable
 * documentation of validation findings. Provides multiple output formats,
 * trending analysis, and integration with the meta-validation system.
 */

import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { MetaValidationReport, MetaValidationResult, ValidationConflict } from './meta-validation-engine.js';
import { ValidationSuiteResult, ValidationExecutionResult } from './review-validation-framework.js';
import { Task, KanbanBoard } from './types.js';

export interface ReportConfig {
  outputDir: string;
  formats: ('html' | 'markdown' | 'json' | 'csv' | 'junit')[];
  includeCharts: boolean;
  includeTimeline: boolean;
  includeRecommendations: boolean;
  verboseMode: boolean;
  theme: 'light' | 'dark' | 'auto';
}

export interface ReportMetrics {
  timestamp: string;
  totalValidationTime: number;
  validationCount: number;
  successRate: number;
  criticalIssuesCount: number;
  warningCount: number;
  tasksAnalyzed: number;
  filesValidated: number;
  coveragePercentage: number;
  qualityScore: number;
  trendsAvailable: boolean;
}

export interface TaskValidationSummary {
  taskId: string;
  title: string;
  status: string;
  validationStatus: 'passed' | 'failed' | 'warning';
  confidence: number;
  issues: Array<{
    type: 'error' | 'warning' | 'info';
    message: string;
    file?: string;
    suggestion?: string;
  }>;
  recommendations: string[];
  filesAnalyzed: number;
  lastValidated: string;
}

export interface ValidationTrend {
  date: string;
  qualityScore: number;
  successRate: number;
  issuesCount: number;
  tasksAnalyzed: number;
}

export interface ReportData {
  metadata: ReportMetrics;
  summary: {
    overallStatus: 'success' | 'warning' | 'failure';
    keyFindings: string[];
    criticalActions: string[];
    improvements: string[];
  };
  taskSummaries: TaskValidationSummary[];
  validatorResults: MetaValidationResult[];
  conflicts: ValidationConflict[];
  trends?: ValidationTrend[];
  recommendations: {
    immediate: string[];
    shortTerm: string[];
    longTerm: string[];
  };
  appendix: {
    rawData: any;
    diagnostics: Record<string, any>;
  };
}

export class TaskValidationReporter {
  private config: ReportConfig;
  private historicalData: ValidationTrend[] = [];

  constructor(config?: Partial<ReportConfig>) {
    this.config = {
      outputDir: join(process.cwd(), 'validation-reports'),
      formats: ['html', 'markdown', 'json'],
      includeCharts: true,
      includeTimeline: true,
      includeRecommendations: true,
      verboseMode: false,
      theme: 'auto',
      ...config
    };
  }

  /**
   * Generate comprehensive validation report from meta-validation results
   */
  async generateReport(
    metaReport: MetaValidationReport,
    kanbanData?: KanbanBoard,
    additionalData?: any
  ): Promise<ReportData> {
    console.log('📊 Generating comprehensive validation report...');

    // Load historical data for trending
    await this.loadHistoricalData();

    // Build report data structure
    const reportData: ReportData = {
      metadata: this.buildReportMetrics(metaReport),
      summary: this.buildSummary(metaReport),
      taskSummaries: this.buildTaskSummaries(metaReport, kanbanData),
      validatorResults: metaReport.validator_results,
      conflicts: metaReport.conflicts,
      trends: this.buildTrendData(),
      recommendations: this.buildRecommendations(metaReport),
      appendix: {
        rawData: metaReport,
        diagnostics: this.buildDiagnostics(metaReport)
      }
    };

    // Generate output files in requested formats
    await this.ensureOutputDir();
    const outputFiles = await this.generateOutputFiles(reportData);

    // Update historical data
    await this.updateHistoricalData(reportData.metadata);

    console.log(`✅ Validation report generated successfully`);
    console.log(`📁 Output files: ${outputFiles.join(', ')}`);

    return reportData;
  }

  /**
   * Build comprehensive report metrics
   */
  private buildReportMetrics(metaReport: MetaValidationReport): ReportMetrics {
    const totalValidationTime = metaReport.validator_results.reduce(
      (sum, result) => sum + (result.metrics.execution_time_ms || 0),
      0
    );

    return {
      timestamp: metaReport.timestamp,
      totalValidationTime,
      validationCount: metaReport.validator_results.length,
      successRate: metaReport.summary.passed_validators / metaReport.summary.total_validators,
      criticalIssuesCount: metaReport.validator_results.reduce(
        (sum, result) => sum + result.errors.length,
        0
      ),
      warningCount: metaReport.validator_results.reduce(
        (sum, result) => sum + result.warnings.length,
        0
      ),
      tasksAnalyzed: this.extractTaskCount(metaReport),
      filesValidated: this.extractFileCount(metaReport),
      coveragePercentage: metaReport.summary.coverage_percentage,
      qualityScore: metaReport.quality_score,
      trendsAvailable: this.historicalData.length > 0
    };
  }

  /**
   * Build executive summary
   */
  private buildSummary(metaReport: MetaValidationReport) {
    const overallStatus = metaReport.success ? 
      (metaReport.conflicts.length > 0 ? 'warning' : 'success') : 
      'failure';

    const keyFindings: string[] = [];
    const criticalActions: string[] = [];
    const improvements: string[] = [];

    // Analyze key findings
    if (metaReport.quality_score >= 90) {
      keyFindings.push('Exceptional validation quality - system is highly stable');
    } else if (metaReport.quality_score >= 75) {
      keyFindings.push('Good validation quality with minor areas for improvement');
    } else if (metaReport.quality_score >= 60) {
      keyFindings.push('Moderate validation quality - requires attention');
    } else {
      keyFindings.push('Poor validation quality - immediate action required');
    }

    // Critical actions
    const criticalFailures = metaReport.validator_results.filter(r => r.metrics.critical && !r.success);
    if (criticalFailures.length > 0) {
      criticalActions.push(`Fix ${criticalFailures.length} critical validation failures immediately`);
    }

    const criticalConflicts = metaReport.conflicts.filter(c => c.severity === 'critical');
    if (criticalConflicts.length > 0) {
      criticalActions.push(`Resolve ${criticalConflicts.length} critical validation conflicts`);
    }

    // Improvements
    if (metaReport.aggregated_confidence < 0.8) {
      improvements.push('Improve validation confidence by addressing low-confidence validators');
    }

    if (metaReport.summary.coverage_percentage < 80) {
      improvements.push('Expand validation coverage to achieve 80%+ coverage');
    }

    const performanceIssues = metaReport.validator_results.filter(r => 
      r.metrics.execution_time_ms > 10000
    );
    if (performanceIssues.length > 0) {
      improvements.push(`Optimize ${performanceIssues.length} slow-performing validators`);
    }

    return {
      overallStatus: overallStatus as 'success' | 'warning' | 'failure',
      keyFindings,
      criticalActions,
      improvements
    };
  }

  /**
   * Build task-specific validation summaries
   */
  private buildTaskSummaries(metaReport: MetaValidationReport, kanbanData?: KanbanBoard): TaskValidationSummary[] {
    const summaries: TaskValidationSummary[] = [];

    // Extract task information from kanban data if available
    if (kanbanData) {
      const allTasks = [
        ...kanbanData.tasks.backlog,
        ...kanbanData.tasks.todo,
        ...kanbanData.tasks.in_progress,
        ...kanbanData.tasks.review,
        ...kanbanData.tasks.done
      ];

      for (const task of allTasks) {
        const taskValidation = this.analyzeTaskValidation(task, metaReport);
        summaries.push(taskValidation);
      }
    }

    return summaries;
  }

  /**
   * Analyze validation results for a specific task
   */
  private analyzeTaskValidation(task: Task, metaReport: MetaValidationReport): TaskValidationSummary {
    const issues: Array<{ type: 'error' | 'warning' | 'info'; message: string; file?: string; suggestion?: string }> = [];
    const recommendations: string[] = [];
    let confidence = 100;

    // Check if task files have validation issues
    for (const filePath of task.files) {
      // Look through validator results for file-specific issues
      for (const validatorResult of metaReport.validator_results) {
        if (validatorResult.validator === 'ReviewValidationEngine' && validatorResult.report) {
          const fileResults = validatorResult.report.files || [];
          const fileResult = fileResults.find((f: any) => f.path.includes(filePath));
          
          if (fileResult) {
            fileResult.errors.forEach((error: string) => {
              issues.push({
                type: 'error',
                message: error,
                file: filePath,
                suggestion: this.generateFileSuggestion(error)
              });
            });

            fileResult.warnings.forEach((warning: string) => {
              issues.push({
                type: 'warning',
                message: warning,
                file: filePath,
                suggestion: this.generateFileSuggestion(warning)
              });
            });
          }
        }
      }
    }

    // Determine validation status
    const hasErrors = issues.some(i => i.type === 'error');
    const hasWarnings = issues.some(i => i.type === 'warning');
    const validationStatus = hasErrors ? 'failed' : hasWarnings ? 'warning' : 'passed';

    // Adjust confidence based on issues
    if (hasErrors) confidence -= issues.filter(i => i.type === 'error').length * 20;
    if (hasWarnings) confidence -= issues.filter(i => i.type === 'warning').length * 5;
    confidence = Math.max(0, confidence);

    // Generate task-specific recommendations
    if (task.validation_notes) {
      recommendations.push(...task.validation_notes);
    }

    if (issues.length === 0 && task.files.length > 0) {
      recommendations.push('Task validation passed - ready for next phase');
    }

    return {
      taskId: task.id,
      title: task.title,
      status: this.determineTaskStatus(task),
      validationStatus,
      confidence,
      issues,
      recommendations,
      filesAnalyzed: task.files.length,
      lastValidated: metaReport.timestamp
    };
  }

  /**
   * Build trend data for historical analysis
   */
  private buildTrendData(): ValidationTrend[] | undefined {
    if (!this.config.includeTimeline || this.historicalData.length === 0) {
      return undefined;
    }

    return this.historicalData.slice(-20); // Last 20 data points
  }

  /**
   * Build comprehensive recommendations
   */
  private buildRecommendations(metaReport: MetaValidationReport) {
    const immediate: string[] = [];
    const shortTerm: string[] = [];
    const longTerm: string[] = [];

    // Immediate actions (critical issues)
    const criticalValidators = metaReport.validator_results.filter(r => r.metrics.critical && !r.success);
    criticalValidators.forEach(validator => {
      immediate.push(`URGENT: Fix ${validator.validator} - ${validator.errors.join(', ')}`);
    });

    const criticalConflicts = metaReport.conflicts.filter(c => c.severity === 'critical');
    criticalConflicts.forEach(conflict => {
      immediate.push(`URGENT: ${conflict.issue}`);
    });

    // Short-term improvements (warnings and optimization)
    const warningValidators = metaReport.validator_results.filter(r => !r.success && !r.metrics.critical);
    if (warningValidators.length > 0) {
      shortTerm.push(`Address ${warningValidators.length} non-critical validation issues`);
    }

    if (metaReport.aggregated_confidence < 0.8) {
      shortTerm.push('Improve validation confidence by reviewing validation criteria');
    }

    const slowValidators = metaReport.validator_results.filter(r => r.metrics.execution_time_ms > 5000);
    if (slowValidators.length > 0) {
      shortTerm.push(`Optimize performance of ${slowValidators.length} slow validators`);
    }

    // Long-term improvements (architectural)
    if (metaReport.summary.coverage_percentage < 90) {
      longTerm.push('Expand validation coverage to achieve comprehensive system validation');
    }

    if (metaReport.conflicts.length > 3) {
      longTerm.push('Review and align validation strategies to reduce conflicts');
    }

    longTerm.push('Implement automated validation in CI/CD pipeline');
    longTerm.push('Establish validation quality metrics and monitoring');

    return { immediate, shortTerm, longTerm };
  }

  /**
   * Build diagnostic information
   */
  private buildDiagnostics(metaReport: MetaValidationReport): Record<string, any> {
    return {
      validationEngineVersion: '1.0.0',
      executionEnvironment: {
        nodeVersion: process.version,
        platform: process.platform,
        workingDirectory: process.cwd()
      },
      performanceMetrics: {
        totalExecutionTime: metaReport.validator_results.reduce(
          (sum, r) => sum + (r.metrics.execution_time_ms || 0), 0
        ),
        averageValidatorTime: metaReport.validator_results.reduce(
          (sum, r) => sum + (r.metrics.execution_time_ms || 0), 0
        ) / metaReport.validator_results.length,
        slowestValidator: metaReport.validator_results.reduce(
          (slowest, current) => 
            (current.metrics.execution_time_ms || 0) > (slowest.metrics.execution_time_ms || 0) ? 
              current : slowest
        ).validator
      },
      validatorStatistics: metaReport.validator_results.map(r => ({
        name: r.validator,
        success: r.success,
        confidence: r.confidence,
        executionTime: r.metrics.execution_time_ms,
        weight: r.metrics.weight,
        critical: r.metrics.critical
      }))
    };
  }

  /**
   * Generate output files in all requested formats
   */
  private async generateOutputFiles(reportData: ReportData): Promise<string[]> {
    const outputFiles: string[] = [];
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    for (const format of this.config.formats) {
      let filename: string;
      let content: string;

      switch (format) {
        case 'html':
          filename = `validation-report-${timestamp}.html`;
          content = this.generateHtmlReport(reportData);
          break;

        case 'markdown':
          filename = `validation-report-${timestamp}.md`;
          content = this.generateMarkdownReport(reportData);
          break;

        case 'json':
          filename = `validation-report-${timestamp}.json`;
          content = JSON.stringify(reportData, null, 2);
          break;

        case 'csv':
          filename = `validation-summary-${timestamp}.csv`;
          content = this.generateCsvReport(reportData);
          break;

        case 'junit':
          filename = `validation-junit-${timestamp}.xml`;
          content = this.generateJunitReport(reportData);
          break;

        default:
          continue;
      }

      const filePath = join(this.config.outputDir, filename);
      await writeFile(filePath, content, 'utf-8');
      outputFiles.push(filename);
    }

    return outputFiles;
  }

  /**
   * Generate HTML report with charts and interactive elements
   */
  private generateHtmlReport(reportData: ReportData): string {
    const isDark = this.config.theme === 'dark';
    const theme = {
      bg: isDark ? '#1a1a1a' : '#ffffff',
      text: isDark ? '#ffffff' : '#333333',
      accent: isDark ? '#4CAF50' : '#2196F3',
      warning: '#FF9800',
      error: '#F44336'
    };

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Validation Report - ${reportData.metadata.timestamp}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; background: ${theme.bg}; color: ${theme.text}; }
        .header { background: linear-gradient(135deg, ${theme.accent}, ${theme.accent}aa); padding: 30px; border-radius: 12px; margin-bottom: 30px; color: white; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .metric-card { background: ${isDark ? '#2a2a2a' : '#f8f9fa'}; padding: 20px; border-radius: 8px; border-left: 4px solid ${theme.accent}; }
        .metric-value { font-size: 2em; font-weight: bold; color: ${theme.accent}; }
        .section { background: ${isDark ? '#2a2a2a' : '#ffffff'}; margin-bottom: 20px; border-radius: 8px; padding: 25px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .status-success { color: #4CAF50; }
        .status-warning { color: ${theme.warning}; }
        .status-error { color: ${theme.error}; }
        .chart-container { height: 300px; margin: 20px 0; }
        .task-grid { display: grid; gap: 15px; }
        .task-card { border: 1px solid #ddd; border-radius: 6px; padding: 15px; }
        .task-card.passed { border-left: 4px solid #4CAF50; }
        .task-card.warning { border-left: 4px solid ${theme.warning}; }
        .task-card.failed { border-left: 4px solid ${theme.error}; }
        ul { padding-left: 20px; }
        .confidence-bar { background: #eee; border-radius: 10px; height: 8px; overflow: hidden; margin-top: 5px; }
        .confidence-fill { height: 100%; background: linear-gradient(90deg, ${theme.error}, ${theme.warning}, #4CAF50); }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔍 Validation Report</h1>
        <p><strong>Generated:</strong> ${new Date(reportData.metadata.timestamp).toLocaleString()}</p>
        <p><strong>Status:</strong> <span class="status-${reportData.summary.overallStatus}">${reportData.summary.overallStatus.toUpperCase()}</span></p>
        <p><strong>Quality Score:</strong> ${reportData.metadata.qualityScore}/100</p>
    </div>

    <div class="metrics">
        <div class="metric-card">
            <div class="metric-value">${(reportData.metadata.successRate * 100).toFixed(1)}%</div>
            <div>Success Rate</div>
        </div>
        <div class="metric-card">
            <div class="metric-value">${reportData.metadata.tasksAnalyzed}</div>
            <div>Tasks Analyzed</div>
        </div>
        <div class="metric-card">
            <div class="metric-value">${reportData.metadata.criticalIssuesCount}</div>
            <div>Critical Issues</div>
        </div>
        <div class="metric-card">
            <div class="metric-value">${reportData.metadata.coveragePercentage.toFixed(1)}%</div>
            <div>Coverage</div>
        </div>
    </div>

    <div class="section">
        <h2>📋 Executive Summary</h2>
        <h3>Key Findings</h3>
        <ul>
            ${reportData.summary.keyFindings.map(finding => `<li>${finding}</li>`).join('')}
        </ul>
        
        ${reportData.summary.criticalActions.length > 0 ? `
        <h3>🚨 Critical Actions Required</h3>
        <ul>
            ${reportData.summary.criticalActions.map(action => `<li class="status-error">${action}</li>`).join('')}
        </ul>
        ` : ''}

        <h3>💡 Improvement Opportunities</h3>
        <ul>
            ${reportData.summary.improvements.map(improvement => `<li>${improvement}</li>`).join('')}
        </ul>
    </div>

    <div class="section">
        <h2>📊 Validator Results</h2>
        ${reportData.validatorResults.map(result => `
            <div class="task-card ${result.success ? 'passed' : 'failed'}">
                <h4>${result.success ? '✅' : '❌'} ${result.validator}</h4>
                <p><strong>Confidence:</strong> ${(result.confidence * 100).toFixed(1)}%</p>
                <div class="confidence-bar">
                    <div class="confidence-fill" style="width: ${result.confidence * 100}%"></div>
                </div>
                ${result.errors.length > 0 ? `
                    <p><strong>Errors:</strong></p>
                    <ul>${result.errors.map(error => `<li class="status-error">${error}</li>`).join('')}</ul>
                ` : ''}
                ${result.warnings.length > 0 ? `
                    <p><strong>Warnings:</strong></p>
                    <ul>${result.warnings.map(warning => `<li class="status-warning">${warning}</li>`).join('')}</ul>
                ` : ''}
            </div>
        `).join('')}
    </div>

    ${reportData.taskSummaries.length > 0 ? `
    <div class="section">
        <h2>📝 Task Validation Summary</h2>
        <div class="task-grid">
            ${reportData.taskSummaries.map(task => `
                <div class="task-card ${task.validationStatus}">
                    <h4>${task.taskId}: ${task.title}</h4>
                    <p><strong>Status:</strong> ${task.status} | <strong>Validation:</strong> ${task.validationStatus}</p>
                    <p><strong>Confidence:</strong> ${task.confidence}%</p>
                    <div class="confidence-bar">
                        <div class="confidence-fill" style="width: ${task.confidence}%"></div>
                    </div>
                    <p><strong>Files Analyzed:</strong> ${task.filesAnalyzed}</p>
                    ${task.issues.length > 0 ? `
                        <p><strong>Issues:</strong></p>
                        <ul>
                            ${task.issues.map(issue => `
                                <li class="status-${issue.type}">${issue.message}${issue.file ? ` (${issue.file})` : ''}</li>
                            `).join('')}
                        </ul>
                    ` : ''}
                </div>
            `).join('')}
        </div>
    </div>
    ` : ''}

    ${reportData.conflicts.length > 0 ? `
    <div class="section">
        <h2>⚠️ Validation Conflicts</h2>
        ${reportData.conflicts.map(conflict => `
            <div class="task-card ${conflict.severity === 'critical' ? 'failed' : 'warning'}">
                <h4>${conflict.severity === 'critical' ? '🚨' : '⚠️'} ${conflict.issue}</h4>
                <p><strong>Affected Validators:</strong> ${conflict.validators.join(', ')}</p>
                <p><strong>Recommendations:</strong></p>
                <ul>
                    ${conflict.recommendations.map(rec => `<li>${rec}</li>`).join('')}
                </ul>
            </div>
        `).join('')}
    </div>
    ` : ''}

    <div class="section">
        <h2>🎯 Recommendations</h2>
        ${reportData.recommendations.immediate.length > 0 ? `
            <h3>🚨 Immediate Actions</h3>
            <ul>
                ${reportData.recommendations.immediate.map(rec => `<li class="status-error">${rec}</li>`).join('')}
            </ul>
        ` : ''}
        
        ${reportData.recommendations.shortTerm.length > 0 ? `
            <h3>📅 Short-term Improvements</h3>
            <ul>
                ${reportData.recommendations.shortTerm.map(rec => `<li class="status-warning">${rec}</li>`).join('')}
            </ul>
        ` : ''}

        ${reportData.recommendations.longTerm.length > 0 ? `
            <h3>🔮 Long-term Strategies</h3>
            <ul>
                ${reportData.recommendations.longTerm.map(rec => `<li>${rec}</li>`).join('')}
            </ul>
        ` : ''}
    </div>

    <div class="section">
        <h2>🔧 Technical Details</h2>
        <p><strong>Total Execution Time:</strong> ${reportData.metadata.totalValidationTime}ms</p>
        <p><strong>Validators Run:</strong> ${reportData.metadata.validationCount}</p>
        <p><strong>Files Validated:</strong> ${reportData.metadata.filesValidated}</p>
        <p><strong>Engine Version:</strong> ${reportData.appendix.diagnostics.validationEngineVersion}</p>
    </div>
</body>
</html>`;
  }

  /**
   * Generate comprehensive Markdown report
   */
  private generateMarkdownReport(reportData: ReportData): string {
    const lines: string[] = [
      '# 🔍 Validation Report',
      '',
      `**Generated:** ${new Date(reportData.metadata.timestamp).toLocaleString()}`,
      `**Status:** ${reportData.summary.overallStatus === 'success' ? '✅ SUCCESS' : 
                    reportData.summary.overallStatus === 'warning' ? '⚠️ WARNING' : '❌ FAILURE'}`,
      `**Quality Score:** ${reportData.metadata.qualityScore}/100`,
      `**Success Rate:** ${(reportData.metadata.successRate * 100).toFixed(1)}%`,
      '',
      '## 📊 Key Metrics',
      '',
      `- **Tasks Analyzed:** ${reportData.metadata.tasksAnalyzed}`,
      `- **Files Validated:** ${reportData.metadata.filesValidated}`,
      `- **Critical Issues:** ${reportData.metadata.criticalIssuesCount}`,
      `- **Warnings:** ${reportData.metadata.warningCount}`,
      `- **Coverage:** ${reportData.metadata.coveragePercentage.toFixed(1)}%`,
      `- **Execution Time:** ${reportData.metadata.totalValidationTime}ms`,
      '',
      '## 📋 Executive Summary',
      '',
      '### Key Findings',
      '',
      ...reportData.summary.keyFindings.map(finding => `- ${finding}`),
      ''
    ];

    if (reportData.summary.criticalActions.length > 0) {
      lines.push('### 🚨 Critical Actions Required', '');
      lines.push(...reportData.summary.criticalActions.map(action => `- ❌ ${action}`));
      lines.push('');
    }

    lines.push('### 💡 Improvement Opportunities', '');
    lines.push(...reportData.summary.improvements.map(improvement => `- ${improvement}`));
    lines.push('');

    // Validator Results
    lines.push('## 🔧 Validator Results', '');
    reportData.validatorResults.forEach(result => {
      const status = result.success ? '✅' : '❌';
      const confidence = (result.confidence * 100).toFixed(1);
      lines.push(`### ${status} ${result.validator} (${confidence}%)`);
      
      if (result.errors.length > 0) {
        lines.push('**Errors:**');
        result.errors.forEach(error => lines.push(`- ❌ ${error}`));
      }
      
      if (result.warnings.length > 0) {
        lines.push('**Warnings:**');
        result.warnings.forEach(warning => lines.push(`- ⚠️ ${warning}`));
      }
      
      lines.push('');
    });

    // Task Summaries
    if (reportData.taskSummaries.length > 0) {
      lines.push('## 📝 Task Validation Summary', '');
      reportData.taskSummaries.forEach(task => {
        const statusIcon = task.validationStatus === 'passed' ? '✅' : 
                          task.validationStatus === 'warning' ? '⚠️' : '❌';
        lines.push(`### ${statusIcon} ${task.taskId}: ${task.title}`);
        lines.push(`- **Status:** ${task.status}`);
        lines.push(`- **Validation:** ${task.validationStatus}`);
        lines.push(`- **Confidence:** ${task.confidence}%`);
        lines.push(`- **Files Analyzed:** ${task.filesAnalyzed}`);
        
        if (task.issues.length > 0) {
          lines.push('**Issues:**');
          task.issues.forEach(issue => {
            const icon = issue.type === 'error' ? '❌' : issue.type === 'warning' ? '⚠️' : 'ℹ️';
            lines.push(`- ${icon} ${issue.message}${issue.file ? ` (${issue.file})` : ''}`);
          });
        }
        lines.push('');
      });
    }

    // Conflicts
    if (reportData.conflicts.length > 0) {
      lines.push('## ⚖️ Validation Conflicts', '');
      reportData.conflicts.forEach(conflict => {
        const icon = conflict.severity === 'critical' ? '🚨' : '⚠️';
        lines.push(`### ${icon} ${conflict.issue}`);
        lines.push(`**Affected Validators:** ${conflict.validators.join(', ')}`);
        lines.push('**Recommendations:**');
        conflict.recommendations.forEach(rec => lines.push(`- ${rec}`));
        lines.push('');
      });
    }

    // Recommendations
    lines.push('## 🎯 Recommendations', '');
    
    if (reportData.recommendations.immediate.length > 0) {
      lines.push('### 🚨 Immediate Actions', '');
      reportData.recommendations.immediate.forEach(rec => lines.push(`- ❌ ${rec}`));
      lines.push('');
    }
    
    if (reportData.recommendations.shortTerm.length > 0) {
      lines.push('### 📅 Short-term Improvements', '');
      reportData.recommendations.shortTerm.forEach(rec => lines.push(`- ⚠️ ${rec}`));
      lines.push('');
    }

    if (reportData.recommendations.longTerm.length > 0) {
      lines.push('### 🔮 Long-term Strategies', '');
      reportData.recommendations.longTerm.forEach(rec => lines.push(`- 💡 ${rec}`));
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Generate CSV summary report
   */
  private generateCsvReport(reportData: ReportData): string {
    const lines = [
      'Task ID,Title,Status,Validation Status,Confidence,Files Analyzed,Issues Count,Last Validated'
    ];

    reportData.taskSummaries.forEach(task => {
      lines.push([
        task.taskId,
        `"${task.title}"`,
        task.status,
        task.validationStatus,
        task.confidence,
        task.filesAnalyzed,
        task.issues.length,
        task.lastValidated
      ].join(','));
    });

    return lines.join('\n');
  }

  /**
   * Generate JUnit XML format for CI integration
   */
  private generateJunitReport(reportData: ReportData): string {
    const totalTests = reportData.validatorResults.length;
    const failures = reportData.validatorResults.filter(r => !r.success).length;
    const executionTime = (reportData.metadata.totalValidationTime / 1000).toFixed(3);

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="ValidationSuite" tests="${totalTests}" failures="${failures}" time="${executionTime}">
`;

    reportData.validatorResults.forEach(result => {
      const testTime = ((result.metrics.execution_time_ms || 0) / 1000).toFixed(3);
      xml += `  <testcase name="${result.validator}" time="${testTime}">\n`;
      
      if (!result.success) {
        xml += `    <failure message="Validation failed">\n`;
        result.errors.forEach(error => {
          xml += `      ERROR: ${this.escapeXml(error)}\n`;
        });
        result.warnings.forEach(warning => {
          xml += `      WARNING: ${this.escapeXml(warning)}\n`;
        });
        xml += `    </failure>\n`;
      }
      
      xml += `  </testcase>\n`;
    });

    xml += '</testsuite>';
    return xml;
  }

  /**
   * Helper methods
   */
  private async ensureOutputDir(): Promise<void> {
    try {
      await mkdir(this.config.outputDir, { recursive: true });
    } catch (error) {
      console.warn('Could not create output directory:', error);
    }
  }

  private extractTaskCount(metaReport: MetaValidationReport): number {
    // Extract from kanban validator results if available
    const kanbanResult = metaReport.validator_results.find(r => r.validator === 'KanbanValidator');
    return kanbanResult?.metrics?.tasks_analyzed || 0;
  }

  private extractFileCount(metaReport: MetaValidationReport): number {
    const reviewResult = metaReport.validator_results.find(r => r.validator === 'ReviewValidationEngine');
    return reviewResult?.metrics?.files_analyzed || 0;
  }

  private determineTaskStatus(task: Task): string {
    // Simple status determination based on task properties
    if (task.completed) return 'completed';
    if (task.started) return 'in_progress';
    return 'pending';
  }

  private generateFileSuggestion(issue: string): string {
    if (issue.includes('test coverage')) return 'Add unit tests for better coverage';
    if (issue.includes('complexity')) return 'Refactor to reduce complexity';
    if (issue.includes('TypeScript')) return 'Fix TypeScript compilation errors';
    if (issue.includes('JSDoc')) return 'Add JSDoc documentation';
    return 'Review and address this issue';
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private async loadHistoricalData(): Promise<void> {
    try {
      const historyPath = join(this.config.outputDir, '.validation-trends.json');
      const data = await readFile(historyPath, 'utf-8');
      this.historicalData = JSON.parse(data);
    } catch {
      // No historical data available
      this.historicalData = [];
    }
  }

  private async updateHistoricalData(metrics: ReportMetrics): Promise<void> {
    const trendData: ValidationTrend = {
      date: metrics.timestamp,
      qualityScore: metrics.qualityScore,
      successRate: metrics.successRate,
      issuesCount: metrics.criticalIssuesCount + metrics.warningCount,
      tasksAnalyzed: metrics.tasksAnalyzed
    };

    this.historicalData.push(trendData);

    // Keep only last 100 entries
    if (this.historicalData.length > 100) {
      this.historicalData = this.historicalData.slice(-100);
    }

    try {
      const historyPath = join(this.config.outputDir, '.validation-trends.json');
      await writeFile(historyPath, JSON.stringify(this.historicalData, null, 2));
    } catch (error) {
      console.warn('Could not save historical data:', error);
    }
  }
}

// CLI interface
if (process.argv[1] && process.argv[1].endsWith('task-validation-reporter.ts')) {
  console.log('📊 Task Validation Reporter - Use programmatically with MetaValidationEngine');
  console.log('Example: new TaskValidationReporter().generateReport(metaReport)');
}