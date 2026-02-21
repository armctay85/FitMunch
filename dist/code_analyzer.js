
// Advanced Code Analyzer for Developer Dashboard
class CodeAnalyzer {
  constructor() {
    this.metrics = {
      complexity: 0,
      maintainability: 0,
      performance: 0,
      security: 0
    };
    this.suggestions = [];
    this.vulnerabilities = [];
    this.timestamp = null;
  }

  // Analyze a code snippet or file
  analyzeCode(code, language) {
    this.timestamp = new Date();
    
    if (!code || code.trim() === '') {
      return {
        error: 'No code provided for analysis'
      };
    }

    // Reset metrics and suggestions
    this.suggestions = [];
    this.vulnerabilities = [];
    
    // Basic code complexity analysis
    this.metrics.complexity = this.calculateComplexity(code, language);
    
    // Check for common code issues
    this.findCodeIssues(code, language);
    
    // Calculate maintainability based on various factors
    this.metrics.maintainability = this.calculateMaintainability(code, language);
    
    // Check for security issues
    this.findSecurityIssues(code, language);
    
    // Performance analysis
    this.metrics.performance = this.calculatePerformanceScore(code, language);
    
    return this.generateReport();
  }

  // Generate a comprehensive analysis report
  generateReport() {
    const overallScore = Math.round(
      (this.metrics.complexity + this.metrics.maintainability + 
       this.metrics.performance + this.metrics.security) / 4
    );
    
    return {
      timestamp: this.timestamp,
      overallScore: overallScore,
      metrics: this.metrics,
      suggestions: this.suggestions,
      vulnerabilities: this.vulnerabilities,
      summary: this.generateSummary(overallScore)
    };
  }

  // Generate a summary based on the overall score
  generateSummary(score) {
    if (score >= 80) {
      return "Excellent code quality. Minimal issues detected.";
    } else if (score >= 60) {
      return "Good code quality with some improvement opportunities.";
    } else if (score >= 40) {
      return "Average code quality. Consider addressing the identified issues.";
    } else {
      return "Code quality needs significant improvement. Address the critical issues.";
    }
  }

  // Calculate code complexity based on various metrics
  calculateComplexity(code, language) {
    // Count lines of code
    const lines = code.split('\n').filter(line => line.trim() !== '').length;
    
    // Count conditionals
    const conditionals = (code.match(/if|else|switch|case|for|while|do/g) || []).length;
    
    // Calculate nesting depth
    let maxDepth = 0;
    let currentDepth = 0;
    for (const char of code) {
      if (char === '{') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (char === '}') {
        currentDepth = Math.max(0, currentDepth - 1);
      }
    }
    
    // Function count
    const functionCount = (code.match(/function|=>|\bdef\b|\bclass\b/g) || []).length;
    
    // Calculate complexity score (lower is better)
    const rawComplexity = (conditionals / lines) * 10 + (maxDepth / 5) * 30 + (functionCount / lines) * 20;
    const normalizedScore = Math.max(0, 100 - rawComplexity);
    
    // Add suggestions based on complexity
    if (maxDepth > 3) {
      this.suggestions.push({
        type: 'complexity',
        severity: 'medium',
        message: 'High nesting depth detected. Consider refactoring to reduce nesting.'
      });
    }
    
    if (conditionals / lines > 0.2) {
      this.suggestions.push({
        type: 'complexity',
        severity: 'medium',
        message: 'High conditional density. Consider breaking down complex logic into separate functions.'
      });
    }
    
    return Math.round(normalizedScore);
  }

  // Find common code issues
  findCodeIssues(code, language) {
    // Check for long functions
    const functionRegex = /function\s+\w+\s*\([^)]*\)\s*{([^{}]*({[^{}]*})*[^{}]*)*}/g;
    let match;
    while ((match = functionRegex.exec(code)) !== null) {
      const functionBody = match[0];
      const lines = functionBody.split('\n').length;
      
      if (lines > 30) {
        this.suggestions.push({
          type: 'maintainability',
          severity: 'medium',
          message: 'Long function detected. Consider breaking it down into smaller, more manageable functions.'
        });
      }
    }
    
    // Check for duplicate code patterns (very basic check)
    const lines = code.split('\n');
    const normalizedLines = lines.map(line => line.trim());
    const lineFrequency = {};
    
    normalizedLines.forEach(line => {
      if (line.length > 10) {
        lineFrequency[line] = (lineFrequency[line] || 0) + 1;
      }
    });
    
    let hasDuplication = false;
    for (const [line, count] of Object.entries(lineFrequency)) {
      if (count > 2 && line.length > 20) {
        hasDuplication = true;
        break;
      }
    }
    
    if (hasDuplication) {
      this.suggestions.push({
        type: 'maintainability',
        severity: 'medium',
        message: 'Potential code duplication detected. Consider refactoring repeated logic into reusable functions.'
      });
    }
    
    // Check for language-specific issues
    if (language === 'javascript') {
      // Check for console.log statements
      const consoleCount = (code.match(/console\.log/g) || []).length;
      if (consoleCount > 3) {
        this.suggestions.push({
          type: 'maintainability',
          severity: 'low',
          message: 'Multiple console.log statements found. Consider using proper logging in production code.'
        });
      }
      
      // Check for var usage
      if (code.match(/\bvar\b/)) {
        this.suggestions.push({
          type: 'maintainability',
          severity: 'low',
          message: 'Usage of var detected. Consider using let or const for better variable scoping.'
        });
      }
    }
  }

  // Calculate maintainability score
  calculateMaintainability(code, language) {
    // Base maintainability score
    let score = 70;
    
    // Adjust based on comments ratio
    const lines = code.split('\n');
    const commentCount = lines.filter(line => 
      line.trim().startsWith('//') || 
      line.trim().startsWith('#') || 
      line.trim().startsWith('/*') || 
      line.trim().includes('*/')
    ).length;
    
    const commentRatio = commentCount / lines.length;
    
    if (commentRatio < 0.05) {
      score -= 15;
      this.suggestions.push({
        type: 'maintainability',
        severity: 'medium',
        message: 'Low comment density. Add meaningful comments to improve code readability.'
      });
    } else if (commentRatio > 0.3) {
      score += 10;
    }
    
    // Check naming conventions
    const camelCaseVariables = (code.match(/\blet\s+[a-z][a-zA-Z0-9]*\b|\bconst\s+[a-z][a-zA-Z0-9]*\b|\bvar\s+[a-z][a-zA-Z0-9]*\b/g) || []).length;
    const allVariables = (code.match(/\blet\s+\w+\b|\bconst\s+\w+\b|\bvar\s+\w+\b/g) || []).length;
    
    if (allVariables > 0 && camelCaseVariables / allVariables < 0.7) {
      score -= 10;
      this.suggestions.push({
        type: 'maintainability',
        severity: 'low',
        message: 'Inconsistent variable naming conventions. Consider using camelCase for variables.'
      });
    }
    
    // Limit to 0-100 range
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // Find security issues
  findSecurityIssues(code, language) {
    if (language === 'javascript') {
      // Check for eval usage
      if (code.match(/\beval\s*\(/)) {
        this.vulnerabilities.push({
          type: 'security',
          severity: 'high',
          message: 'Use of eval() detected. This can lead to code injection vulnerabilities.'
        });
        this.metrics.security = Math.max(0, this.metrics.security - 30);
      }
      
      // Check for innerHTML
      if (code.match(/\.innerHTML\s*=/)) {
        this.vulnerabilities.push({
          type: 'security',
          severity: 'medium',
          message: 'Direct manipulation of innerHTML detected. This can lead to XSS vulnerabilities if user input is used.'
        });
        this.metrics.security = Math.max(0, this.metrics.security - 20);
      }
      
      // Check for DOM-based XSS vulnerabilities
      if (code.match(/document\.write\s*\(/)) {
        this.vulnerabilities.push({
          type: 'security',
          severity: 'high',
          message: 'Use of document.write() detected. This can lead to XSS vulnerabilities.'
        });
        this.metrics.security = Math.max(0, this.metrics.security - 25);
      }
    }
    
    // Default security score if not affected by vulnerabilities
    if (this.metrics.security === 0) {
      this.metrics.security = 80;
    }
  }

  // Calculate performance score
  calculatePerformanceScore(code, language) {
    let score = 75;
    
    if (language === 'javascript') {
      // Check for efficient DOM operations
      const domQueries = (code.match(/getElementById|querySelector|querySelectorAll/g) || []).length;
      const codeSize = code.length;
      
      if (domQueries > 10 && codeSize / domQueries < 500) {
        score -= 15;
        this.suggestions.push({
          type: 'performance',
          severity: 'medium',
          message: 'High frequency of DOM queries. Consider storing DOM references in variables instead of repeatedly querying.'
        });
      }
      
      // Check for array/object iteration methods
      const forLoops = (code.match(/for\s*\(/g) || []).length;
      const iterationMethods = (code.match(/\.map\(|\.filter\(|\.reduce\(|\.forEach\(/g) || []).length;
      
      if (forLoops > 5 && iterationMethods === 0) {
        score -= 10;
        this.suggestions.push({
          type: 'performance',
          severity: 'low',
          message: 'Consider using array iteration methods (map, filter, reduce) instead of for loops for better readability.'
        });
      }
    }
    
    return Math.max(0, Math.min(100, Math.round(score)));
  }
}

// Export as singleton
const codeAnalyzer = new CodeAnalyzer();
export default codeAnalyzer;
