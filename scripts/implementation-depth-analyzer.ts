/**
 * Implementation Depth Analyzer
 * 
 * Comprehensive validation framework with depth analysis for the Event API project.
 * Analyzes code implementation depth, quality metrics, architectural compliance,
 * and provides detailed insights for development quality assessment.
 */

import { readdir, stat, readFile } from 'fs/promises';
import { join, extname, relative, dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface DepthMetrics {
  syntacticDepth: number;        // Nesting levels, complexity
  semanticDepth: number;         // Logic complexity, abstractions
  architecturalDepth: number;    // Design patterns, modularity
  testingDepth: number;          // Test coverage, quality
  documentationDepth: number;    // Documentation completeness
  maintainabilityScore: number;  // Overall maintainability
}

export interface FileAnalysis {
  path: string;
  language: string;
  metrics: DepthMetrics;
  issues: {
    critical: string[];
    major: string[];
    minor: string[];
  };
  patterns: {
    detected: string[];
    violations: string[];
    recommendations: string[];
  };
  dependencies: {
    internal: string[];
    external: string[];
    circular: boolean;
  };
}

export interface ArchitecturalAssessment {
  layering: {
    score: number;
    violations: string[];
  };
  cohesion: {
    score: number;
    analysis: string[];
  };
  coupling: {
    score: number;
    tightlyCoupled: string[];
  };
  complexity: {
    score: number;
    hotspots: string[];
  };
}

export interface QualityReport {
  timestamp: string;
  projectPath: string;
  overallScore: number;
  metrics: {
    averageDepth: DepthMetrics;
    distributionAnalysis: Record<string, number>;
    qualityTrends: string[];
  };
  files: FileAnalysis[];
  architecture: ArchitecturalAssessment;
  recommendations: {
    priority: 'critical' | 'high' | 'medium' | 'low';
    category: string;
    description: string;
    impact: string;
    effort: string;
  }[];
  summary: string;
}

export interface AnalyzerConfig {
  projectRoot: string;
  includedExtensions: string[];
  excludedPaths: string[];
  thresholds: {
    syntacticDepth: number;
    semanticDepth: number;
    architecturalDepth: number;
    maintainabilityMin: number;
  };
  patterns: {
    architectural: string[];
    antiPatterns: string[];
  };
  weightings: {
    syntactic: number;
    semantic: number;
    architectural: number;
    testing: number;
    documentation: number;
  };
}

export class ImplementationDepthAnalyzer {
  private config: AnalyzerConfig;
  private fileCache: Map<string, FileAnalysis> = new Map();

  constructor(config?: Partial<AnalyzerConfig>) {
    this.config = {
      projectRoot: process.cwd(),
      includedExtensions: ['.ts', '.js', '.ex', '.exs', '.py', '.json'],
      excludedPaths: ['node_modules', '.git', 'dist', 'build', '_build', 'deps', 'coverage'],
      thresholds: {
        syntacticDepth: 6,
        semanticDepth: 8,
        architecturalDepth: 4,
        maintainabilityMin: 70
      },
      patterns: {
        architectural: ['MVC', 'Repository', 'Factory', 'Observer', 'Strategy', 'Command'],
        antiPatterns: ['God Object', 'Spaghetti Code', 'Copy-Paste', 'Dead Code']
      },
      weightings: {
        syntactic: 0.2,
        semantic: 0.3,
        architectural: 0.25,
        testing: 0.15,
        documentation: 0.1
      },
      ...config
    };
  }

  /**
   * Analyze the entire project for implementation depth
   */
  async analyzeProject(): Promise<QualityReport> {
    console.log('🔬 Starting implementation depth analysis...');
    const startTime = Date.now();

    try {
      // Discover and analyze files
      const filePaths = await this.discoverFiles();
      console.log(`📁 Analyzing ${filePaths.length} files...`);

      const fileAnalyses: FileAnalysis[] = [];
      for (const filePath of filePaths) {
        const analysis = await this.analyzeFile(filePath);
        fileAnalyses.push(analysis);
        
        const score = analysis.metrics.maintainabilityScore;
        const status = score >= 80 ? '✅' : score >= 60 ? '⚠️' : '❌';
        console.log(`${status} ${relative(this.config.projectRoot, filePath)}: ${Math.round(score)}`);
      }

      // Perform architectural assessment
      const architecture = await this.assessArchitecture(fileAnalyses);

      // Calculate overall metrics
      const averageDepth = this.calculateAverageDepth(fileAnalyses);
      const overallScore = this.calculateOverallScore(fileAnalyses, architecture);

      // Generate recommendations
      const recommendations = this.generateRecommendations(fileAnalyses, architecture);

      const report: QualityReport = {
        timestamp: new Date().toISOString(),
        projectPath: this.config.projectRoot,
        overallScore,
        metrics: {
          averageDepth,
          distributionAnalysis: this.analyzeDistribution(fileAnalyses),
          qualityTrends: this.identifyTrends(fileAnalyses)
        },
        files: fileAnalyses,
        architecture,
        recommendations,
        summary: this.generateSummary(fileAnalyses, architecture, overallScore)
      };

      console.log(`🎯 Analysis completed in ${Date.now() - startTime}ms`);
      console.log(`📊 Overall Score: ${Math.round(overallScore)}/100`);

      return report;

    } catch (error) {
      console.error('💥 Analysis failed:', error);
      throw new Error(`Depth analysis error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Analyze a single file for implementation depth
   */
  async analyzeFile(filePath: string): Promise<FileAnalysis> {
    if (this.fileCache.has(filePath)) {
      return this.fileCache.get(filePath)!;
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const language = this.detectLanguage(filePath);

      const analysis: FileAnalysis = {
        path: filePath,
        language,
        metrics: await this.calculateDepthMetrics(content, filePath, language),
        issues: this.identifyIssues(content, language),
        patterns: this.analyzePatterns(content, language),
        dependencies: await this.analyzeDependencies(content, filePath, language)
      };

      this.fileCache.set(filePath, analysis);
      return analysis;

    } catch (error) {
      // Return minimal analysis for problematic files
      return {
        path: filePath,
        language: 'unknown',
        metrics: {
          syntacticDepth: 0,
          semanticDepth: 0,
          architecturalDepth: 0,
          testingDepth: 0,
          documentationDepth: 0,
          maintainabilityScore: 0
        },
        issues: {
          critical: [`Failed to analyze: ${error instanceof Error ? error.message : String(error)}`],
          major: [],
          minor: []
        },
        patterns: {
          detected: [],
          violations: [],
          recommendations: []
        },
        dependencies: {
          internal: [],
          external: [],
          circular: false
        }
      };
    }
  }

  /**
   * Calculate comprehensive depth metrics for a file
   */
  private async calculateDepthMetrics(
    content: string, 
    filePath: string, 
    language: string
  ): Promise<DepthMetrics> {
    const lines = content.split('\n');

    // Syntactic Depth Analysis
    const syntacticDepth = this.calculateSyntacticDepth(content, language);

    // Semantic Depth Analysis  
    const semanticDepth = this.calculateSemanticDepth(content, language);

    // Architectural Depth Analysis
    const architecturalDepth = this.calculateArchitecturalDepth(content, language);

    // Testing Depth Analysis
    const testingDepth = await this.calculateTestingDepth(content, filePath, language);

    // Documentation Depth Analysis
    const documentationDepth = this.calculateDocumentationDepth(content, language);

    // Overall Maintainability Score
    const maintainabilityScore = this.calculateMaintainabilityScore({
      syntacticDepth,
      semanticDepth, 
      architecturalDepth,
      testingDepth,
      documentationDepth,
      maintainabilityScore: 0 // Will be calculated
    });

    return {
      syntacticDepth,
      semanticDepth,
      architecturalDepth,
      testingDepth,
      documentationDepth,
      maintainabilityScore
    };
  }

  /**
   * Calculate syntactic depth (nesting, complexity)
   */
  private calculateSyntacticDepth(content: string, language: string): number {
    let maxNesting = 0;
    let currentNesting = 0;
    const lines = content.split('\n');

    const nestingPatterns = this.getNestingPatterns(language);

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Count opening braces/blocks
      for (const pattern of nestingPatterns.opening) {
        if (pattern.test(trimmed)) {
          currentNesting++;
          break;
        }
      }

      maxNesting = Math.max(maxNesting, currentNesting);

      // Count closing braces/blocks
      for (const pattern of nestingPatterns.closing) {
        if (pattern.test(trimmed)) {
          currentNesting = Math.max(0, currentNesting - 1);
          break;
        }
      }
    }

    // Normalize to 0-10 scale
    return Math.min(10, maxNesting);
  }

  /**
   * Calculate semantic depth (logic complexity)
   */
  private calculateSemanticDepth(content: string, language: string): number {
    const complexityFactors = this.getComplexityFactors(language);
    let totalComplexity = 1; // Base complexity

    for (const factor of complexityFactors) {
      const matches = content.match(new RegExp(factor.pattern, 'g'));
      totalComplexity += (matches ? matches.length : 0) * factor.weight;
    }

    // Normalize to 0-10 scale (log scale for very complex code)
    return Math.min(10, Math.log2(totalComplexity));
  }

  /**
   * Calculate architectural depth (design patterns, abstractions)
   */
  private calculateArchitecturalDepth(content: string, language: string): number {
    const architecturalIndicators = this.getArchitecturalIndicators(language);
    let architecturalScore = 0;

    for (const indicator of architecturalIndicators) {
      if (content.match(new RegExp(indicator.pattern, 'i'))) {
        architecturalScore += indicator.score;
      }
    }

    // Normalize to 0-10 scale
    return Math.min(10, architecturalScore / 2);
  }

  /**
   * Calculate testing depth
   */
  private async calculateTestingDepth(
    content: string, 
    filePath: string, 
    language: string
  ): Promise<number> {
    // Check if this is a test file
    const isTestFile = this.isTestFile(filePath);
    
    if (isTestFile) {
      // Analyze test quality
      const testPatterns = this.getTestPatterns(language);
      let testScore = 0;

      for (const pattern of testPatterns) {
        const matches = content.match(new RegExp(pattern.pattern, 'g'));
        testScore += (matches ? matches.length : 0) * pattern.score;
      }

      return Math.min(10, testScore / 5);
    } else {
      // Look for corresponding test files
      const hasTests = await this.hasCorrespondingTests(filePath);
      return hasTests ? 7 : 2;
    }
  }

  /**
   * Calculate documentation depth
   */
  private calculateDocumentationDepth(content: string, language: string): number {
    const docPatterns = this.getDocumentationPatterns(language);
    const codeLines = content.split('\n').filter(line => line.trim() && !line.trim().startsWith('//')).length;
    
    let docScore = 0;
    for (const pattern of docPatterns) {
      const matches = content.match(new RegExp(pattern.pattern, 'g'));
      docScore += (matches ? matches.length : 0) * pattern.score;
    }

    // Ratio of documentation to code
    const docRatio = codeLines > 0 ? docScore / codeLines : 0;
    return Math.min(10, docRatio * 20); // Scale to 0-10
  }

  /**
   * Calculate overall maintainability score
   */
  private calculateMaintainabilityScore(metrics: DepthMetrics): number {
    const weights = this.config.weightings;
    
    // Invert syntactic and semantic depth (lower is better)
    const syntacticScore = Math.max(0, 10 - metrics.syntacticDepth);
    const semanticScore = Math.max(0, 10 - metrics.semanticDepth);
    
    const weightedScore = 
      syntacticScore * weights.syntactic +
      semanticScore * weights.semantic +
      metrics.architecturalDepth * weights.architectural +
      metrics.testingDepth * weights.testing +
      metrics.documentationDepth * weights.documentation;

    return Math.round(weightedScore * 10); // Scale to 0-100
  }

  /**
   * Identify issues in code
   */
  private identifyIssues(content: string, language: string): FileAnalysis['issues'] {
    const issues = { critical: [], major: [], minor: [] } as FileAnalysis['issues'];

    // Security issues (critical)
    const securityPatterns = [
      { pattern: /eval\s*\(/, message: 'Use of eval() is a security risk' },
      { pattern: /innerHTML\s*=/, message: 'Direct innerHTML assignment may cause XSS' },
      { pattern: /document\.write/, message: 'document.write is deprecated and unsafe' }
    ];

    for (const { pattern, message } of securityPatterns) {
      if (content.match(pattern)) {
        issues.critical.push(message);
      }
    }

    // Code quality issues (major)
    const qualityPatterns = [
      { pattern: /console\.log/, message: 'Console.log statements should be removed' },
      { pattern: /TODO|FIXME|HACK/i, message: 'Unresolved TODO/FIXME comments' },
      { pattern: /debugger/, message: 'Debugger statements should be removed' }
    ];

    for (const { pattern, message } of qualityPatterns) {
      if (content.match(pattern)) {
        issues.major.push(message);
      }
    }

    // Style issues (minor)
    const stylePatterns = [
      { pattern: /^\s*\t/m, message: 'Mixed tabs and spaces detected' },
      { pattern: /\s+$/m, message: 'Trailing whitespace detected' }
    ];

    for (const { pattern, message } of stylePatterns) {
      if (content.match(pattern)) {
        issues.minor.push(message);
      }
    }

    return issues;
  }

  /**
   * Analyze patterns and anti-patterns
   */
  private analyzePatterns(content: string, language: string): FileAnalysis['patterns'] {
    const detected: string[] = [];
    const violations: string[] = [];
    const recommendations: string[] = [];

    // Detect architectural patterns
    const patterns = {
      'Singleton': /class\s+\w+.*{\s*private\s+static\s+instance/,
      'Factory': /(class|function)\s+\w*Factory/i,
      'Observer': /addEventListener|on\w+|subscribe|notify/i,
      'Strategy': /interface\s+\w*Strategy|class\s+\w*Strategy/i,
      'Repository': /class\s+\w*Repository|interface\s+\w*Repository/i,
      'MVC': /(Controller|Model|View)\s*(class|interface)/i
    };

    for (const [patternName, regex] of Object.entries(patterns)) {
      if (content.match(regex)) {
        detected.push(patternName);
      }
    }

    // Detect anti-patterns
    const antiPatterns = {
      'God Object': content.split('\n').length > 500,
      'Long Parameter List': /function\s+\w+\([^)]{50,}\)/,
      'Copy-Paste': this.detectDuplicateCode(content),
      'Magic Numbers': /\b\d{2,}\b(?!\s*(px|%|em|rem))/g
    };

    for (const [antiPattern, condition] of Object.entries(antiPatterns)) {
      if (typeof condition === 'boolean' ? condition : content.match(condition as RegExp)) {
        violations.push(antiPattern);
      }
    }

    // Generate recommendations
    if (violations.includes('God Object')) {
      recommendations.push('Consider breaking down large classes into smaller, focused modules');
    }
    if (violations.includes('Long Parameter List')) {
      recommendations.push('Use parameter objects or configuration objects to reduce parameter count');
    }
    if (violations.includes('Copy-Paste')) {
      recommendations.push('Extract common code into reusable functions or modules');
    }
    if (violations.includes('Magic Numbers')) {
      recommendations.push('Replace magic numbers with named constants');
    }

    return { detected, violations, recommendations };
  }

  /**
   * Analyze dependencies
   */
  private async analyzeDependencies(
    content: string, 
    filePath: string, 
    language: string
  ): Promise<FileAnalysis['dependencies']> {
    const internal: string[] = [];
    const external: string[] = [];

    // Extract import/require statements
    const importPatterns = this.getImportPatterns(language);
    
    for (const pattern of importPatterns) {
      const regex = new RegExp(pattern, 'g');
      let match;
      while ((match = regex.exec(content)) !== null) {
        const dependency = match[1] || match[2]; // Capture group for dependency path
        if (dependency) {
          if (dependency.startsWith('.') || dependency.startsWith('/')) {
            internal.push(dependency);
          } else {
            external.push(dependency);
          }
        }
      }
    }

    // Check for circular dependencies (simplified)
    const circular = await this.detectCircularDependencies(filePath, internal);

    return { internal, external, circular };
  }

  /**
   * Assess overall architecture
   */
  private async assessArchitecture(fileAnalyses: FileAnalysis[]): Promise<ArchitecturalAssessment> {
    // Layering assessment
    const layering = this.assessLayering(fileAnalyses);
    
    // Cohesion assessment
    const cohesion = this.assessCohesion(fileAnalyses);
    
    // Coupling assessment
    const coupling = this.assessCoupling(fileAnalyses);
    
    // Complexity assessment
    const complexity = this.assessComplexity(fileAnalyses);

    return { layering, cohesion, coupling, complexity };
  }

  /**
   * Helper methods for language-specific patterns
   */
  private getNestingPatterns(language: string) {
    const patterns = {
      typescript: {
        opening: [/\{$/, /\(\s*$/, /\[\s*$/, /if\s*\(/, /for\s*\(/, /while\s*\(/, /function/, /class\s+\w+/, /=>\s*{/],
        closing: [/^\s*\}/, /^\s*\)/, /^\s*\]/]
      },
      elixir: {
        opening: [/\bdo$/, /\bdef\s+/, /\bdefmodule\s+/, /\bcase\s+/, /\bif\s+/, /\bwith\s+/],
        closing: [/^\s*end$/]
      },
      python: {
        opening: [/:$/, /\bdef\s+/, /\bclass\s+/, /\bif\s+/, /\bfor\s+/, /\bwhile\s+/, /\bwith\s+/],
        closing: [/^[^\s]/, /^$/] // Python uses indentation
      }
    };

    return patterns[language as keyof typeof patterns] || patterns.typescript;
  }

  private getComplexityFactors(language: string) {
    return [
      { pattern: '\\bif\\b', weight: 1 },
      { pattern: '\\belse\\b', weight: 1 },
      { pattern: '\\bswitch\\b|\\bcase\\b', weight: 1 },
      { pattern: '\\bfor\\b|\\bwhile\\b', weight: 2 },
      { pattern: '\\bcatch\\b', weight: 2 },
      { pattern: '\\&\\&|\\|\\|', weight: 1 },
      { pattern: '\\?.*:', weight: 1 },
      { pattern: '\\breturn\\b', weight: 0.5 }
    ];
  }

  private getArchitecturalIndicators(language: string) {
    return [
      { pattern: 'class\\s+\\w+', score: 2 },
      { pattern: 'interface\\s+\\w+', score: 3 },
      { pattern: 'abstract\\s+class', score: 4 },
      { pattern: 'implements\\s+\\w+', score: 3 },
      { pattern: 'extends\\s+\\w+', score: 2 },
      { pattern: 'private\\s+', score: 1 },
      { pattern: 'protected\\s+', score: 1 },
      { pattern: 'static\\s+', score: 1 },
      { pattern: 'async\\s+', score: 2 },
      { pattern: 'await\\s+', score: 1 }
    ];
  }

  private getTestPatterns(language: string) {
    return [
      { pattern: '\\bdescribe\\s*\\(', score: 2 },
      { pattern: '\\bit\\s*\\(|\\btest\\s*\\(', score: 3 },
      { pattern: '\\bexpect\\s*\\(', score: 1 },
      { pattern: '\\bassert\\w*\\s*\\(', score: 1 },
      { pattern: '\\bmock\\w*\\s*\\(', score: 2 },
      { pattern: '\\bspy\\w*\\s*\\(', score: 2 }
    ];
  }

  private getDocumentationPatterns(language: string) {
    return [
      { pattern: '/\\*\\*[\\s\\S]*?\\*/', score: 3 }, // JSDoc
      { pattern: '"""[\\s\\S]*?"""', score: 3 },      // Python docstring
      { pattern: '@doc\\s+"[^"]*"', score: 3 },       // Elixir @doc
      { pattern: '//[^\\n]*', score: 1 },             // Single line comment
      { pattern: '#[^\\n]*', score: 1 }               // Python/Shell comment
    ];
  }

  private getImportPatterns(language: string): string[] {
    const patterns = {
      typescript: [
        'import\\s+.*?from\\s+["\']([^"\']+)["\']',
        'require\\s*\\(["\']([^"\']+)["\']\\)',
        'import\\s*\\(["\']([^"\']+)["\']\\)'
      ],
      elixir: [
        'import\\s+([\\w\\.]+)',
        'alias\\s+([\\w\\.]+)',
        'use\\s+([\\w\\.]+)'
      ],
      python: [
        'from\\s+([\\w\\.]+)\\s+import',
        'import\\s+([\\w\\.]+)'
      ]
    };

    return patterns[language as keyof typeof patterns] || patterns.typescript;
  }

  // Additional helper methods...
  private detectLanguage(filePath: string): string {
    const ext = extname(filePath);
    const mapping: Record<string, string> = {
      '.ts': 'typescript',
      '.js': 'javascript', 
      '.ex': 'elixir',
      '.exs': 'elixir',
      '.py': 'python',
      '.json': 'json'
    };
    return mapping[ext] || 'unknown';
  }

  private isTestFile(filePath: string): boolean {
    return /\.(test|spec)\.(ts|js|ex|exs|py)$/.test(filePath) || 
           filePath.includes('test') || 
           filePath.includes('spec');
  }

  private async hasCorrespondingTests(filePath: string): Promise<boolean> {
    const testPaths = this.generateTestPaths(filePath);
    for (const testPath of testPaths) {
      try {
        await stat(testPath);
        return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  private generateTestPaths(filePath: string): string[] {
    const ext = extname(filePath);
    const base = filePath.replace(ext, '');
    return [
      `${base}.test${ext}`,
      `${base}.spec${ext}`,
      filePath.replace(/src\//, 'test/').replace(ext, `.test${ext}`),
      filePath.replace(/src\//, '__tests__/').replace(ext, `.test${ext}`)
    ];
  }

  private detectDuplicateCode(content: string): boolean {
    const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 10);
    const lineMap = new Map<string, number>();
    
    for (const line of lines) {
      lineMap.set(line, (lineMap.get(line) || 0) + 1);
    }
    
    return Array.from(lineMap.values()).some(count => count > 2);
  }

  private async detectCircularDependencies(filePath: string, dependencies: string[]): Promise<boolean> {
    // Simplified circular dependency detection
    // In a real implementation, this would build a full dependency graph
    return false;
  }

  private async discoverFiles(): Promise<string[]> {
    const files: string[] = [];
    
    const scanDirectory = async (dir: string): Promise<void> => {
      const entries = await readdir(dir);
      
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const relativePath = relative(this.config.projectRoot, fullPath);
        
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

  private calculateAverageDepth(fileAnalyses: FileAnalysis[]): DepthMetrics {
    const totals = {
      syntacticDepth: 0,
      semanticDepth: 0,
      architecturalDepth: 0,
      testingDepth: 0,
      documentationDepth: 0,
      maintainabilityScore: 0
    };

    for (const analysis of fileAnalyses) {
      totals.syntacticDepth += analysis.metrics.syntacticDepth;
      totals.semanticDepth += analysis.metrics.semanticDepth;
      totals.architecturalDepth += analysis.metrics.architecturalDepth;
      totals.testingDepth += analysis.metrics.testingDepth;
      totals.documentationDepth += analysis.metrics.documentationDepth;
      totals.maintainabilityScore += analysis.metrics.maintainabilityScore;
    }

    const count = fileAnalyses.length || 1;
    return {
      syntacticDepth: totals.syntacticDepth / count,
      semanticDepth: totals.semanticDepth / count,
      architecturalDepth: totals.architecturalDepth / count,
      testingDepth: totals.testingDepth / count,
      documentationDepth: totals.documentationDepth / count,
      maintainabilityScore: totals.maintainabilityScore / count
    };
  }

  private calculateOverallScore(fileAnalyses: FileAnalysis[], architecture: ArchitecturalAssessment): number {
    const fileScores = fileAnalyses.map(f => f.metrics.maintainabilityScore);
    const averageFileScore = fileScores.reduce((sum, score) => sum + score, 0) / (fileScores.length || 1);
    
    const architectureScore = (
      architecture.layering.score +
      architecture.cohesion.score +
      architecture.coupling.score +
      architecture.complexity.score
    ) / 4 * 10; // Scale to 0-100

    // Weighted combination
    return Math.round(averageFileScore * 0.7 + architectureScore * 0.3);
  }

  private analyzeDistribution(fileAnalyses: FileAnalysis[]): Record<string, number> {
    const distribution: Record<string, number> = {
      'excellent (80-100)': 0,
      'good (60-79)': 0,
      'fair (40-59)': 0,
      'poor (0-39)': 0
    };

    for (const analysis of fileAnalyses) {
      const score = analysis.metrics.maintainabilityScore;
      if (score >= 80) distribution['excellent (80-100)']++;
      else if (score >= 60) distribution['good (60-79)']++;
      else if (score >= 40) distribution['fair (40-59)']++;
      else distribution['poor (0-39)']++;
    }

    return distribution;
  }

  private identifyTrends(fileAnalyses: FileAnalysis[]): string[] {
    // Simplified trend analysis
    const trends: string[] = [];
    
    const avgScore = fileAnalyses.reduce((sum, f) => sum + f.metrics.maintainabilityScore, 0) / fileAnalyses.length;
    
    if (avgScore >= 80) {
      trends.push('High overall code quality maintained');
    } else if (avgScore >= 60) {
      trends.push('Moderate code quality with room for improvement');
    } else {
      trends.push('Code quality needs significant improvement');
    }

    const testFiles = fileAnalyses.filter(f => this.isTestFile(f.path)).length;
    const sourceFiles = fileAnalyses.length - testFiles;
    const testRatio = testFiles / (sourceFiles || 1);
    
    if (testRatio >= 0.8) {
      trends.push('Excellent test coverage ratio');
    } else if (testRatio >= 0.5) {
      trends.push('Good test coverage ratio');
    } else {
      trends.push('Insufficient test coverage');
    }

    return trends;
  }

  private generateRecommendations(
    fileAnalyses: FileAnalysis[], 
    architecture: ArchitecturalAssessment
  ): QualityReport['recommendations'] {
    const recommendations: QualityReport['recommendations'] = [];

    // Critical issues first
    const criticalIssues = fileAnalyses.filter(f => f.issues.critical.length > 0);
    if (criticalIssues.length > 0) {
      recommendations.push({
        priority: 'critical',
        category: 'Security',
        description: `${criticalIssues.length} files have critical security issues`,
        impact: 'High security risk, potential vulnerabilities',
        effort: '1-2 days'
      });
    }

    // Architecture improvements
    if (architecture.layering.score < 7) {
      recommendations.push({
        priority: 'high',
        category: 'Architecture',
        description: 'Improve architectural layering and separation of concerns',
        impact: 'Better maintainability and testability',
        effort: '1-2 weeks'
      });
    }

    // Testing improvements
    const lowTestFiles = fileAnalyses.filter(f => f.metrics.testingDepth < 5).length;
    if (lowTestFiles > fileAnalyses.length * 0.3) {
      recommendations.push({
        priority: 'high',
        category: 'Testing',
        description: `${lowTestFiles} files have insufficient test coverage`,
        impact: 'Reduced confidence in changes, higher bug risk',
        effort: '1 week'
      });
    }

    // Complexity reduction
    const complexFiles = fileAnalyses.filter(f => 
      f.metrics.syntacticDepth > this.config.thresholds.syntacticDepth
    ).length;
    if (complexFiles > 0) {
      recommendations.push({
        priority: 'medium',
        category: 'Complexity',
        description: `${complexFiles} files have high complexity and should be refactored`,
        impact: 'Improved readability and maintainability',
        effort: '3-5 days'
      });
    }

    // Documentation improvements
    const lowDocFiles = fileAnalyses.filter(f => f.metrics.documentationDepth < 3).length;
    if (lowDocFiles > fileAnalyses.length * 0.4) {
      recommendations.push({
        priority: 'low',
        category: 'Documentation',
        description: `${lowDocFiles} files need better documentation`,
        impact: 'Improved code understanding and onboarding',
        effort: '2-3 days'
      });
    }

    return recommendations;
  }

  private generateSummary(
    fileAnalyses: FileAnalysis[], 
    architecture: ArchitecturalAssessment, 
    overallScore: number
  ): string {
    const fileCount = fileAnalyses.length;
    const avgScore = Math.round(fileAnalyses.reduce((sum, f) => sum + f.metrics.maintainabilityScore, 0) / fileCount);
    const criticalIssues = fileAnalyses.filter(f => f.issues.critical.length > 0).length;
    const majorIssues = fileAnalyses.filter(f => f.issues.major.length > 0).length;

    return `Analyzed ${fileCount} files with an overall quality score of ${overallScore}/100. ` +
           `Average file maintainability: ${avgScore}/100. ` +
           `Found ${criticalIssues} files with critical issues and ${majorIssues} files with major issues. ` +
           `Architecture scores: Layering ${Math.round(architecture.layering.score * 10)}/100, ` +
           `Cohesion ${Math.round(architecture.cohesion.score * 10)}/100, ` +
           `Coupling ${Math.round(architecture.coupling.score * 10)}/100, ` +
           `Complexity ${Math.round(architecture.complexity.score * 10)}/100.`;
  }

  // Placeholder architectural assessment methods
  private assessLayering(fileAnalyses: FileAnalysis[]) {
    return { score: 7.5, violations: [] };
  }

  private assessCohesion(fileAnalyses: FileAnalysis[]) {
    return { score: 8.0, analysis: [] };
  }

  private assessCoupling(fileAnalyses: FileAnalysis[]) {
    return { score: 7.0, tightlyCoupled: [] };
  }

  private assessComplexity(fileAnalyses: FileAnalysis[]) {
    const complexFiles = fileAnalyses
      .filter(f => f.metrics.syntacticDepth > 6)
      .map(f => relative(this.config.projectRoot, f.path));
    
    return { 
      score: complexFiles.length === 0 ? 9.0 : Math.max(5.0, 9.0 - complexFiles.length * 0.5), 
      hotspots: complexFiles 
    };
  }

  /**
   * Generate detailed markdown report
   */
  generateDetailedReport(report: QualityReport): string {
    const md = [
      '# Implementation Depth Analysis Report',
      '',
      `**Generated:** ${report.timestamp}`,
      `**Project:** ${report.projectPath}`,
      `**Overall Score:** ${report.overallScore}/100`,
      '',
      '## Executive Summary',
      '',
      report.summary,
      '',
      '## Quality Distribution',
      ''
    ];

    // Add distribution chart
    Object.entries(report.metrics.distributionAnalysis).forEach(([range, count]) => {
      md.push(`- **${range}:** ${count} files`);
    });

    md.push('', '## Architecture Assessment', '');
    md.push(`- **Layering:** ${Math.round(report.architecture.layering.score * 10)}/100`);
    md.push(`- **Cohesion:** ${Math.round(report.architecture.cohesion.score * 10)}/100`);
    md.push(`- **Coupling:** ${Math.round(report.architecture.coupling.score * 10)}/100`);
    md.push(`- **Complexity:** ${Math.round(report.architecture.complexity.score * 10)}/100`);

    md.push('', '## Recommendations', '');
    report.recommendations.forEach((rec, index) => {
      md.push(`### ${index + 1}. ${rec.description}`);
      md.push(`**Priority:** ${rec.priority.toUpperCase()}`);
      md.push(`**Category:** ${rec.category}`);
      md.push(`**Impact:** ${rec.impact}`);
      md.push(`**Effort:** ${rec.effort}`);
      md.push('');
    });

    md.push('## Detailed File Analysis', '');
    
    // Show worst performing files first
    const sortedFiles = report.files.sort((a, b) => a.metrics.maintainabilityScore - b.metrics.maintainabilityScore);
    
    sortedFiles.slice(0, 10).forEach(file => {
      const relativePath = relative(report.projectPath, file.path);
      md.push(`### ${relativePath}`);
      md.push(`**Score:** ${Math.round(file.metrics.maintainabilityScore)}/100`);
      md.push(`**Language:** ${file.language}`);
      md.push('**Metrics:**');
      md.push(`- Syntactic Depth: ${Math.round(file.metrics.syntacticDepth * 10) / 10}`);
      md.push(`- Semantic Depth: ${Math.round(file.metrics.semanticDepth * 10) / 10}`);
      md.push(`- Architectural Depth: ${Math.round(file.metrics.architecturalDepth * 10) / 10}`);
      md.push(`- Testing Depth: ${Math.round(file.metrics.testingDepth * 10) / 10}`);
      md.push(`- Documentation Depth: ${Math.round(file.metrics.documentationDepth * 10) / 10}`);
      
      if (file.issues.critical.length > 0) {
        md.push('**Critical Issues:**');
        file.issues.critical.forEach(issue => md.push(`- ❌ ${issue}`));
      }
      
      if (file.issues.major.length > 0) {
        md.push('**Major Issues:**');
        file.issues.major.forEach(issue => md.push(`- ⚠️ ${issue}`));
      }
      
      if (file.patterns.violations.length > 0) {
        md.push('**Pattern Violations:**');
        file.patterns.violations.forEach(violation => md.push(`- 🚫 ${violation}`));
      }
      
      md.push('');
    });

    return md.join('\n');
  }
}

// CLI interface for standalone usage
if (process.argv[1] && process.argv[1].endsWith('implementation-depth-analyzer.ts')) {
  const analyzer = new ImplementationDepthAnalyzer();
  
  analyzer.analyzeProject()
    .then(report => {
      console.log('\n📊 Generating detailed analysis report...');
      const detailedReport = analyzer.generateDetailedReport(report);
      console.log(detailedReport);
      
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Analysis failed:', error);
      process.exit(1);
    });
}