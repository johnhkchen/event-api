import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';

export interface SanitizationOptions {
  allowedTags?: string[];
  allowedAttributes?: Record<string, string[]>;
  stripTags?: boolean;
  preserveWhitespace?: boolean;
}

export class HTMLSanitizer {
  private static defaultOptions: SanitizationOptions = {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'div', 'span',
      'strong', 'b', 'em', 'i', 'u',
      'ul', 'ol', 'li',
      'a', 'img',
      'table', 'thead', 'tbody', 'tr', 'td', 'th',
      'blockquote', 'pre', 'code'
    ],
    allowedAttributes: {
      'a': ['href', 'title'],
      'img': ['src', 'alt', 'title', 'width', 'height'],
      '*': ['class', 'id']
    },
    stripTags: false,
    preserveWhitespace: false
  };

  static sanitizeHTML(html: string, options: SanitizationOptions = {}): string {
    try {
      const opts = { ...this.defaultOptions, ...options };
      
      // Create JSDOM window for DOMPurify
      const window = new JSDOM('').window;
      const purify = DOMPurify(window);

      // Configure DOMPurify
      const config: any = {
        ALLOWED_TAGS: opts.allowedTags,
        ALLOWED_ATTR: this.flattenAllowedAttributes(opts.allowedAttributes!),
        KEEP_CONTENT: !opts.stripTags,
        RETURN_DOM: false,
        RETURN_DOM_FRAGMENT: false,
        RETURN_DOM_IMPORT: false
      };

      // Sanitize the HTML
      let sanitized = purify.sanitize(html, config) as unknown as string;

      // Clean up whitespace if requested
      if (!opts.preserveWhitespace) {
        sanitized = this.cleanWhitespace(sanitized);
      }

      return sanitized;
    } catch (error) {
      console.error('Error sanitizing HTML:', error);
      return '';
    }
  }

  static extractText(html: string): string {
    try {
      const window = new JSDOM('').window;
      const purify = DOMPurify(window);
      
      // Strip all HTML tags and return plain text
      const sanitized = purify.sanitize(html, { 
        ALLOWED_TAGS: [],
        KEEP_CONTENT: true 
      });
      
      return this.cleanWhitespace(sanitized);
    } catch (error) {
      console.error('Error extracting text from HTML:', error);
      return '';
    }
  }

  static sanitizeForStorage(html: string): string {
    // Very restrictive sanitization for storage
    return this.sanitizeHTML(html, {
      allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'h1', 'h2', 'h3'],
      allowedAttributes: {},
      stripTags: false,
      preserveWhitespace: false
    });
  }

  static extractMetadata(html: string): Record<string, string> {
    try {
      const window = new JSDOM(html).window;
      const document = window.document;
      
      const metadata: Record<string, string> = {};

      // Extract meta tags
      const metaTags = document.querySelectorAll('meta');
      metaTags.forEach(meta => {
        const name = meta.getAttribute('name') || meta.getAttribute('property');
        const content = meta.getAttribute('content');
        
        if (name && content) {
          metadata[name] = content;
        }
      });

      // Extract title
      const title = document.querySelector('title');
      if (title) {
        metadata.title = title.textContent || '';
      }

      // Extract canonical URL
      const canonical = document.querySelector('link[rel="canonical"]');
      if (canonical) {
        metadata.canonical = canonical.getAttribute('href') || '';
      }

      return metadata;
    } catch (error) {
      console.error('Error extracting metadata:', error);
      return {};
    }
  }

  private static flattenAllowedAttributes(allowedAttrs: Record<string, string[]>): string[] {
    const flattened: string[] = [];
    
    for (const [tag, attrs] of Object.entries(allowedAttrs)) {
      if (tag === '*') {
        flattened.push(...attrs);
      } else {
        flattened.push(...attrs.map(attr => `${tag}-${attr}`));
      }
    }
    
    return flattened;
  }

  private static cleanWhitespace(text: string): string {
    return text
      .replace(/\s+/g, ' ')  // Multiple whitespace to single space
      .replace(/\n\s*\n/g, '\n')  // Multiple newlines to single newline
      .trim();
  }
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export class ContentValidator {
  static validateEventData(data: any): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    // Required fields
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
      result.errors.push('Event name is required');
      result.isValid = false;
    }

    if (!data.lumaUrl || typeof data.lumaUrl !== 'string') {
      result.errors.push('Luma URL is required');
      result.isValid = false;
    }

    // URL validation
    if (data.lumaUrl && !this.isValidUrl(data.lumaUrl)) {
      result.errors.push('Invalid Luma URL format');
      result.isValid = false;
    }

    // Date validation
    if (data.date && !this.isValidDate(data.date)) {
      result.warnings.push('Invalid or unparseable date format');
    }

    // Content length checks
    if (data.name && data.name.length > 500) {
      result.warnings.push('Event name is unusually long');
    }

    if (data.description && data.description.length > 10000) {
      result.warnings.push('Event description is very long');
    }

    // HTML content validation
    if (data.rawHtml && !this.containsValidHTML(data.rawHtml)) {
      result.warnings.push('Raw HTML appears to be malformed or empty');
    }

    return result;
  }

  private static isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private static isValidDate(date: string): boolean {
    return !isNaN(Date.parse(date));
  }

  private static containsValidHTML(html: string): boolean {
    if (!html || html.trim().length === 0) {
      return false;
    }

    // Basic check for HTML structure
    return html.includes('<') && html.includes('>') && html.length > 50;
  }
}