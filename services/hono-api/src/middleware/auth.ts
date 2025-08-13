import { Context, Next } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';

// API Key configuration
const API_KEYS = new Set([
  process.env.API_KEY_PRIMARY,
  process.env.API_KEY_SECONDARY,
  process.env.API_KEY_DEVELOPMENT
].filter(Boolean));

// Add default development key if in development mode
if (process.env.NODE_ENV === 'development') {
  API_KEYS.add('dev-key-12345');
}

// Validation schemas for authenticated requests
export const apiKeyHeader = z.string().min(1, 'API key is required');

// API Key validation middleware
export const requireApiKey = createMiddleware(async (c: Context, next: Next) => {
  const apiKey = c.req.header('x-api-key') || c.req.header('authorization')?.replace('Bearer ', '');
  
  if (!apiKey) {
    return c.json({
      success: false,
      error: 'Authentication required',
      message: 'API key must be provided in x-api-key header or Authorization header'
    }, 401);
  }

  if (!API_KEYS.has(apiKey)) {
    return c.json({
      success: false,
      error: 'Invalid API key',
      message: 'The provided API key is not valid'
    }, 403);
  }

  // Add API key info to context for logging/tracking
  c.set('apiKey', apiKey);
  c.set('authenticated', true);

  await next();
});

// Optional API key middleware (allows unauthenticated access but tracks if authenticated)
export const optionalApiKey = createMiddleware(async (c: Context, next: Next) => {
  const apiKey = c.req.header('x-api-key') || c.req.header('authorization')?.replace('Bearer ', '');
  
  if (apiKey && API_KEYS.has(apiKey)) {
    c.set('apiKey', apiKey);
    c.set('authenticated', true);
  } else {
    c.set('authenticated', false);
  }

  await next();
});

// API key validation for specific operations (e.g., write operations)
export const requireWriteAccess = createMiddleware(async (c: Context, next: Next) => {
  const apiKey = c.req.header('x-api-key') || c.req.header('authorization')?.replace('Bearer ', '');
  
  if (!apiKey) {
    return c.json({
      success: false,
      error: 'Authentication required',
      message: 'Write operations require a valid API key'
    }, 401);
  }

  // In a production system, you might have different access levels
  // For now, any valid API key grants write access
  if (!API_KEYS.has(apiKey)) {
    return c.json({
      success: false,
      error: 'Invalid API key',
      message: 'The provided API key does not have write access'
    }, 403);
  }

  c.set('apiKey', apiKey);
  c.set('authenticated', true);
  c.set('writeAccess', true);

  await next();
});

// Middleware to log API usage for monitoring
export const logApiUsage = createMiddleware(async (c: Context, next: Next) => {
  const startTime = Date.now();
  const apiKey = c.get('apiKey');
  const authenticated = c.get('authenticated');
  
  await next();
  
  const duration = Date.now() - startTime;
  const logData = {
    method: c.req.method,
    path: c.req.path,
    authenticated,
    apiKey: apiKey ? `${apiKey.substring(0, 8)}...` : null, // Only log partial key for security
    duration,
    status: c.res.status,
    timestamp: new Date().toISOString(),
    userAgent: c.req.header('user-agent'),
    ip: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown'
  };

  // In production, you might want to send this to a logging service
  console.log('API Request:', JSON.stringify(logData));
});

// Helper function to check if request is authenticated
export function isAuthenticated(c: Context): boolean {
  return c.get('authenticated') === true;
}

// Helper function to get API key from context
export function getApiKey(c: Context): string | undefined {
  return c.get('apiKey');
}

// Helper function to validate API key format
export function validateApiKeyFormat(apiKey: string): boolean {
  // API keys should be at least 10 characters and contain only alphanumeric characters and hyphens
  return /^[a-zA-Z0-9-]{10,}$/.test(apiKey);
}

// Middleware for admin-only operations (if needed)
export const requireAdminAccess = createMiddleware(async (c: Context, next: Next) => {
  const apiKey = c.req.header('x-api-key') || c.req.header('authorization')?.replace('Bearer ', '');
  
  // In this implementation, the primary API key has admin access
  if (apiKey !== process.env.API_KEY_PRIMARY) {
    return c.json({
      success: false,
      error: 'Admin access required',
      message: 'This operation requires administrator privileges'
    }, 403);
  }

  c.set('apiKey', apiKey);
  c.set('authenticated', true);
  c.set('adminAccess', true);

  await next();
});

export default {
  requireApiKey,
  optionalApiKey,
  requireWriteAccess,
  requireAdminAccess,
  logApiUsage,
  isAuthenticated,
  getApiKey,
  validateApiKeyFormat
};