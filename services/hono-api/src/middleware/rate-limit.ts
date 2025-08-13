import { Context, Next } from 'hono';
import { createMiddleware } from 'hono/factory';

// In-memory store for rate limiting (in production, use Redis)
const requestStore = new Map<string, number[]>();

// Rate limit configuration
interface RateLimitConfig {
  windowMs: number;    // Time window in milliseconds
  maxRequests: number; // Maximum requests allowed in the window
  message?: string;    // Custom error message
  skipSuccessfulRequests?: boolean; // Don't count successful requests
  skipFailedRequests?: boolean;     // Don't count failed requests
  keyGenerator?: (c: Context) => string; // Custom key generation
}

// Default configurations for different endpoints
export const rateLimitConfigs = {
  // Standard API rate limiting
  standard: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100,         // 100 requests per 15 minutes
    message: 'Too many requests, please try again later'
  },
  
  // Scraping endpoints (more restrictive)
  scraping: {
    windowMs: 60 * 1000,      // 1 minute
    maxRequests: 10,          // 10 requests per minute
    message: 'Scraping rate limit exceeded, please wait before making more requests'
  },
  
  // Batch operations (very restrictive)
  batch: {
    windowMs: 5 * 60 * 1000,  // 5 minutes
    maxRequests: 3,           // 3 requests per 5 minutes
    message: 'Batch operation rate limit exceeded, please wait before making more requests'
  },
  
  // Authentication attempts
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,           // 5 failed attempts per 15 minutes
    message: 'Too many authentication attempts, please try again later'
  }
} as const;

// Create rate limiting middleware with sliding window algorithm
export function createRateLimit(config: RateLimitConfig) {
  return createMiddleware(async (c: Context, next: Next) => {
    const now = Date.now();
    const windowStart = now - config.windowMs;
    
    // Generate key for rate limiting (by default use IP + API key)
    const key = config.keyGenerator ? config.keyGenerator(c) : generateDefaultKey(c);
    
    // Get existing requests for this key
    let requests = requestStore.get(key) || [];
    
    // Remove old requests outside the window (sliding window)
    requests = requests.filter(timestamp => timestamp > windowStart);
    
    // Check if we've exceeded the limit
    if (requests.length >= config.maxRequests) {
      const resetTime = new Date(requests[0] + config.windowMs);
      
      return c.json({
        success: false,
        error: 'Rate limit exceeded',
        message: config.message || 'Too many requests',
        retryAfter: Math.ceil((resetTime.getTime() - now) / 1000),
        limit: config.maxRequests,
        window: Math.ceil(config.windowMs / 1000),
        remaining: 0
      }, 429);
    }
    
    // Add current request timestamp
    requests.push(now);
    requestStore.set(key, requests);
    
    // Add rate limit headers
    c.res.headers.set('X-RateLimit-Limit', config.maxRequests.toString());
    c.res.headers.set('X-RateLimit-Remaining', (config.maxRequests - requests.length).toString());
    c.res.headers.set('X-RateLimit-Reset', new Date(now + config.windowMs).toISOString());
    c.res.headers.set('X-RateLimit-Window', Math.ceil(config.windowMs / 1000).toString());
    
    await next();
    
    // Optionally remove the request if it was successful/failed based on config
    if (config.skipSuccessfulRequests && c.res.status < 400) {
      requests.pop();
      requestStore.set(key, requests);
    } else if (config.skipFailedRequests && c.res.status >= 400) {
      requests.pop();
      requestStore.set(key, requests);
    }
  });
}

// Generate default key for rate limiting
function generateDefaultKey(c: Context): string {
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
  const apiKey = c.req.header('x-api-key') || 'anonymous';
  const userAgent = c.req.header('user-agent') || 'unknown';
  
  // Create a composite key that includes IP and API key
  return `${ip}:${apiKey.substring(0, 8)}:${userAgent.substring(0, 20)}`;
}

// Authenticated user rate limiting (higher limits)
function generateAuthenticatedKey(c: Context): string {
  const apiKey = c.req.header('x-api-key') || c.req.header('authorization')?.replace('Bearer ', '');
  if (apiKey) {
    return `auth:${apiKey}`;
  }
  return generateDefaultKey(c);
}

// IP-based rate limiting
function generateIpKey(c: Context): string {
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
  return `ip:${ip}`;
}

// Pre-configured middleware instances
export const standardRateLimit = createRateLimit(rateLimitConfigs.standard);

export const scrapingRateLimit = createRateLimit({
  ...rateLimitConfigs.scraping,
  keyGenerator: generateAuthenticatedKey // Higher limits for authenticated users
});

export const batchRateLimit = createRateLimit({
  ...rateLimitConfigs.batch,
  keyGenerator: generateAuthenticatedKey
});

export const authRateLimit = createRateLimit({
  ...rateLimitConfigs.auth,
  keyGenerator: generateIpKey, // IP-based for auth attempts
  skipSuccessfulRequests: true // Only count failed auth attempts
});

// Cleanup old entries periodically (prevent memory leaks)
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [key, requests] of requestStore.entries()) {
    const validRequests = requests.filter(timestamp => (now - timestamp) < maxAge);
    
    if (validRequests.length === 0) {
      requestStore.delete(key);
    } else if (validRequests.length < requests.length) {
      requestStore.set(key, validRequests);
    }
  }
}, 60 * 60 * 1000); // Run cleanup every hour

// Helper function to check current rate limit status
export function getRateLimitStatus(c: Context, config: RateLimitConfig): {
  remaining: number;
  resetTime: Date;
  isLimited: boolean;
} {
  const now = Date.now();
  const windowStart = now - config.windowMs;
  const key = config.keyGenerator ? config.keyGenerator(c) : generateDefaultKey(c);
  
  let requests = requestStore.get(key) || [];
  requests = requests.filter(timestamp => timestamp > windowStart);
  
  return {
    remaining: Math.max(0, config.maxRequests - requests.length),
    resetTime: new Date(now + config.windowMs),
    isLimited: requests.length >= config.maxRequests
  };
}

export default {
  createRateLimit,
  standardRateLimit,
  scrapingRateLimit,
  batchRateLimit,
  authRateLimit,
  getRateLimitStatus,
  rateLimitConfigs
};