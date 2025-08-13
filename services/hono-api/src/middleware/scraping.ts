import { Context, Next } from 'hono';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { SCRAPING_CONFIG } from '../lib/scraping/config.js';

// Rate limiters for different endpoints
const scrapingRateLimiter = new RateLimiterMemory({
  points: SCRAPING_CONFIG.MAX_REQUESTS_PER_MINUTE,
  duration: 60, // 1 minute
});

const scrapingHourlyLimiter = new RateLimiterMemory({
  points: SCRAPING_CONFIG.MAX_REQUESTS_PER_HOUR,
  duration: 3600, // 1 hour
});

const batchScrapingLimiter = new RateLimiterMemory({
  points: 5, // Max 5 batch requests per hour
  duration: 3600,
});

export async function scrapingRateLimit(c: Context, next: Next) {
  const clientIp = c.req.header('x-forwarded-for') || 
                   c.req.header('x-real-ip') || 
                   'anonymous';

  try {
    // Check both minute and hourly limits
    await Promise.all([
      scrapingRateLimiter.consume(clientIp),
      scrapingHourlyLimiter.consume(clientIp)
    ]);

    await next();
  } catch (rateLimiterResult) {
    const remainingPoints = (rateLimiterResult as any).remainingPoints || 0;
    const msBeforeNext = (rateLimiterResult as any).msBeforeNext || 0;

    c.header('Retry-After', String(Math.round(msBeforeNext / 1000)));
    c.header('X-RateLimit-Limit', String(SCRAPING_CONFIG.MAX_REQUESTS_PER_MINUTE));
    c.header('X-RateLimit-Remaining', String(remainingPoints));
    c.header('X-RateLimit-Reset', String(new Date(Date.now() + msBeforeNext)));

    return c.json({
      success: false,
      error: 'Rate limit exceeded',
      message: 'Too many scraping requests. Please try again later.',
      retryAfter: Math.round(msBeforeNext / 1000)
    }, 429);
  }
}

export async function batchScrapingRateLimit(c: Context, next: Next) {
  const clientIp = c.req.header('x-forwarded-for') || 
                   c.req.header('x-real-ip') || 
                   'anonymous';

  try {
    // Check batch-specific limits in addition to regular limits
    await Promise.all([
      batchScrapingLimiter.consume(clientIp),
      scrapingRateLimiter.consume(clientIp),
      scrapingHourlyLimiter.consume(clientIp)
    ]);

    await next();
  } catch (rateLimiterResult) {
    const remainingPoints = (rateLimiterResult as any).remainingPoints || 0;
    const msBeforeNext = (rateLimiterResult as any).msBeforeNext || 0;

    c.header('Retry-After', String(Math.round(msBeforeNext / 1000)));
    c.header('X-RateLimit-Limit', '5');
    c.header('X-RateLimit-Remaining', String(remainingPoints));
    c.header('X-RateLimit-Reset', String(new Date(Date.now() + msBeforeNext)));

    return c.json({
      success: false,
      error: 'Batch rate limit exceeded',
      message: 'Too many batch scraping requests. Please try again later.',
      retryAfter: Math.round(msBeforeNext / 1000)
    }, 429);
  }
}

export function validateScrapeRequest(c: Context, next: Next) {
  const contentType = c.req.header('content-type');
  
  if (!contentType || !contentType.includes('application/json')) {
    return c.json({
      success: false,
      error: 'Invalid content type',
      message: 'Content-Type must be application/json'
    }, 400);
  }

  return next();
}

export async function logScrapeRequest(c: Context, next: Next) {
  const startTime = Date.now();
  const clientIp = c.req.header('x-forwarded-for') || 
                   c.req.header('x-real-ip') || 
                   'anonymous';
  
  console.log(`[SCRAPE] ${c.req.method} ${c.req.path} - IP: ${clientIp}`);

  await next();

  const duration = Date.now() - startTime;
  console.log(`[SCRAPE] Request completed in ${duration}ms`);
}

export interface EthicalScrapingOptions {
  respectRobotsTxt?: boolean;
  userAgent?: string;
  crawlDelay?: number;
}

export class EthicalScrapingValidator {
  private static robotsCache = new Map<string, { allowed: boolean; expiry: number }>();

  static async validateRequest(url: string, options: EthicalScrapingOptions = {}): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const parsedUrl = new URL(url);
      
      // Check if it's a Luma URL
      if (!this.isAllowedDomain(parsedUrl.hostname)) {
        return { 
          allowed: false, 
          reason: 'Domain not in allowed list for scraping' 
        };
      }

      // Check robots.txt if enabled
      if (options.respectRobotsTxt !== false) {
        const robotsAllowed = await this.checkRobotsTxt(parsedUrl.origin, parsedUrl.pathname);
        if (!robotsAllowed) {
          return { 
            allowed: false, 
            reason: 'Scraping disallowed by robots.txt' 
          };
        }
      }

      return { allowed: true };
    } catch (error) {
      console.error('Error validating scraping request:', error);
      return { 
        allowed: false, 
        reason: 'Error validating request' 
      };
    }
  }

  private static isAllowedDomain(hostname: string): boolean {
    const allowedDomains = [
      'lu.ma',
      'www.lu.ma'
    ];
    
    return allowedDomains.includes(hostname) || hostname.endsWith('.lu.ma');
  }

  private static async checkRobotsTxt(origin: string, path: string): Promise<boolean> {
    try {
      const cacheKey = `${origin}/robots.txt`;
      const cached = this.robotsCache.get(cacheKey);
      
      // Check cache (expire after 1 hour)
      if (cached && cached.expiry > Date.now()) {
        return cached.allowed;
      }

      // Fetch robots.txt
      const response = await fetch(`${origin}/robots.txt`);
      if (!response.ok) {
        // If robots.txt doesn't exist, assume allowed
        this.robotsCache.set(cacheKey, { allowed: true, expiry: Date.now() + 3600000 });
        return true;
      }

      const robotsText = await response.text();
      const allowed = this.parseRobotsTxt(robotsText, path);
      
      // Cache result
      this.robotsCache.set(cacheKey, { allowed, expiry: Date.now() + 3600000 });
      
      return allowed;
    } catch (error) {
      console.warn('Error checking robots.txt:', error);
      // On error, assume allowed to avoid blocking legitimate requests
      return true;
    }
  }

  private static parseRobotsTxt(robotsText: string, path: string): boolean {
    const lines = robotsText.split('\n');
    let currentUserAgent = '';
    let isRelevantSection = false;
    
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      
      if (trimmed.startsWith('user-agent:')) {
        const userAgent = trimmed.substring(11).trim();
        isRelevantSection = userAgent === '*' || userAgent.includes('bot') || userAgent.includes('crawler');
        currentUserAgent = userAgent;
      } else if (isRelevantSection && trimmed.startsWith('disallow:')) {
        const disallowedPath = trimmed.substring(9).trim();
        if (disallowedPath === '/' || path.startsWith(disallowedPath)) {
          return false;
        }
      }
    }
    
    return true;
  }
}