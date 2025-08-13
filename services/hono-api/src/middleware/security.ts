import { Context, Next } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

// Initialize DOMPurify with JSDOM for server-side use
const window = new JSDOM('').window;
const purify = DOMPurify(window);

// Security headers configuration
interface SecurityConfig {
  contentSecurityPolicy?: string;
  hsts?: {
    maxAge: number;
    includeSubDomains?: boolean;
    preload?: boolean;
  };
  noSniff?: boolean;
  frameOptions?: 'DENY' | 'SAMEORIGIN' | string;
  xssProtection?: boolean;
  referrerPolicy?: string;
  permissionsPolicy?: string;
}

// Default security configuration
const defaultSecurityConfig: Required<SecurityConfig> = {
  contentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; font-src 'self' data:;",
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  frameOptions: 'DENY',
  xssProtection: true,
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: 'camera=(), microphone=(), geolocation=(), payment=()'
};

// Security headers middleware
export function securityHeaders(config: SecurityConfig = {}) {
  const finalConfig = { ...defaultSecurityConfig, ...config };
  
  return createMiddleware(async (c: Context, next: Next) => {
    await next();
    
    // Content Security Policy
    if (finalConfig.contentSecurityPolicy) {
      c.res.headers.set('Content-Security-Policy', finalConfig.contentSecurityPolicy);
    }
    
    // HTTP Strict Transport Security
    if (finalConfig.hsts) {
      let hstsValue = `max-age=${finalConfig.hsts.maxAge}`;
      if (finalConfig.hsts.includeSubDomains) hstsValue += '; includeSubDomains';
      if (finalConfig.hsts.preload) hstsValue += '; preload';
      c.res.headers.set('Strict-Transport-Security', hstsValue);
    }
    
    // X-Content-Type-Options
    if (finalConfig.noSniff) {
      c.res.headers.set('X-Content-Type-Options', 'nosniff');
    }
    
    // X-Frame-Options
    if (finalConfig.frameOptions) {
      c.res.headers.set('X-Frame-Options', finalConfig.frameOptions);
    }
    
    // X-XSS-Protection
    if (finalConfig.xssProtection) {
      c.res.headers.set('X-XSS-Protection', '1; mode=block');
    }
    
    // Referrer Policy
    if (finalConfig.referrerPolicy) {
      c.res.headers.set('Referrer-Policy', finalConfig.referrerPolicy);
    }
    
    // Permissions Policy
    if (finalConfig.permissionsPolicy) {
      c.res.headers.set('Permissions-Policy', finalConfig.permissionsPolicy);
    }
    
    // Additional security headers
    c.res.headers.set('X-Powered-By', 'Event-API'); // Hide technology stack
    c.res.headers.set('Server', 'Event-API'); // Hide server information
  });
}

// Input validation and sanitization middleware
export const inputSanitization = createMiddleware(async (c: Context, next: Next) => {
  const contentType = c.req.header('content-type');
  
  if (contentType && contentType.includes('application/json')) {
    try {
      const body = await c.req.json();
      const sanitizedBody = sanitizeObject(body);
      
      // Replace the request body with sanitized version
      c.req = new Request(c.req.url, {
        method: c.req.method,
        headers: c.req.headers,
        body: JSON.stringify(sanitizedBody)
      });
    } catch (error) {
      return c.json({
        success: false,
        error: 'Invalid JSON',
        message: 'Request body must be valid JSON'
      }, 400);
    }
  }
  
  await next();
});

// Recursively sanitize object properties
function sanitizeObject(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  
  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[sanitizeString(key)] = sanitizeObject(value);
    }
    return sanitized;
  }
  
  return obj;
}

// Sanitize individual strings
function sanitizeString(str: string): string {
  // Remove potential XSS vectors
  const cleaned = purify.sanitize(str, { 
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true
  });
  
  // Additional cleaning for common injection patterns
  return cleaned
    .replace(/javascript:/gi, '')
    .replace(/vbscript:/gi, '')
    .replace(/data:/gi, '')
    .replace(/file:/gi, '')
    .trim();
}

// URL validation middleware
export const urlValidation = createMiddleware(async (c: Context, next: Next) => {
  const urlParams = ['url', 'callback', 'redirect', 'return'];
  
  for (const param of urlParams) {
    const value = c.req.query(param);
    if (value && !isValidUrl(value)) {
      return c.json({
        success: false,
        error: 'Invalid URL',
        message: `Parameter '${param}' contains an invalid URL`
      }, 400);
    }
  }
  
  await next();
});

// Validate URL safety
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    // Only allow HTTP and HTTPS protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }
    
    // Block localhost and private IP ranges in production
    if (process.env.NODE_ENV === 'production') {
      const hostname = parsed.hostname.toLowerCase();
      
      // Block localhost variants
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
        return false;
      }
      
      // Block private IP ranges
      if (hostname.match(/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/)) {
        return false;
      }
      
      // Block internal domains
      if (hostname.includes('.local') || hostname.includes('.internal')) {
        return false;
      }
    }
    
    return true;
  } catch {
    return false;
  }
}

// Request size limitation middleware
export function requestSizeLimit(maxSize: number = 10 * 1024 * 1024) { // Default 10MB
  return createMiddleware(async (c: Context, next: Next) => {
    const contentLength = c.req.header('content-length');
    
    if (contentLength && parseInt(contentLength) > maxSize) {
      return c.json({
        success: false,
        error: 'Request too large',
        message: `Request size exceeds maximum allowed size of ${Math.round(maxSize / 1024 / 1024)}MB`
      }, 413);
    }
    
    await next();
  });
}

// CORS security middleware (more restrictive than default)
export function secureCors(allowedOrigins: string[] = []) {
  return createMiddleware(async (c: Context, next: Next) => {
    const origin = c.req.header('origin');
    
    // In development, allow localhost
    if (process.env.NODE_ENV === 'development') {
      allowedOrigins.push('http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000');
    }
    
    if (origin && allowedOrigins.includes(origin)) {
      c.res.headers.set('Access-Control-Allow-Origin', origin);
    }
    
    c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
    c.res.headers.set('Access-Control-Allow-Credentials', 'true');
    c.res.headers.set('Access-Control-Max-Age', '86400'); // 24 hours
    
    if (c.req.method === 'OPTIONS') {
      return c.text('', 204);
    }
    
    await next();
  });
}

// Content type validation middleware
export const contentTypeValidation = createMiddleware(async (c: Context, next: Next) => {
  if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
    const contentType = c.req.header('content-type');
    
    if (!contentType) {
      return c.json({
        success: false,
        error: 'Missing Content-Type',
        message: 'Content-Type header is required for this request'
      }, 400);
    }
    
    // Only allow specific content types
    const allowedTypes = [
      'application/json',
      'application/x-www-form-urlencoded',
      'multipart/form-data'
    ];
    
    const isAllowed = allowedTypes.some(type => contentType.includes(type));
    if (!isAllowed) {
      return c.json({
        success: false,
        error: 'Invalid Content-Type',
        message: `Content-Type must be one of: ${allowedTypes.join(', ')}`
      }, 415);
    }
  }
  
  await next();
});

// Export configured middleware instances
export const productionSecurity = securityHeaders();
export const developmentSecurity = securityHeaders({
  contentSecurityPolicy: "default-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ws: wss: http: https:;"
});

export default {
  securityHeaders,
  inputSanitization,
  urlValidation,
  requestSizeLimit,
  secureCors,
  contentTypeValidation,
  productionSecurity,
  developmentSecurity,
  sanitizeString,
  isValidUrl
};