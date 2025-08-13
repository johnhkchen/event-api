import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requireApiKey, optionalApiKey, validateApiKeyFormat } from '../src/middleware/auth.js';

describe('Authentication Middleware', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    
    // Test endpoint with required API key
    app.get('/protected', requireApiKey, (c) => {
      return c.json({ success: true, message: 'Access granted' });
    });

    // Test endpoint with optional API key
    app.get('/optional', optionalApiKey, (c) => {
      const authenticated = c.get('authenticated');
      return c.json({ authenticated });
    });
  });

  describe('requireApiKey', () => {
    it('should reject requests without API key', async () => {
      const res = await app.request('/protected');
      expect(res.status).toBe(401);
      
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Authentication required');
    });

    it('should reject requests with invalid API key', async () => {
      const res = await app.request('/protected', {
        headers: { 'x-api-key': 'invalid-key' }
      });
      expect(res.status).toBe(403);
      
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Invalid API key');
    });

    it('should accept requests with valid development API key', async () => {
      process.env.NODE_ENV = 'development';
      
      const res = await app.request('/protected', {
        headers: { 'x-api-key': 'dev-key-12345' }
      });
      expect(res.status).toBe(200);
      
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('should accept API key in Authorization header', async () => {
      process.env.NODE_ENV = 'development';
      
      const res = await app.request('/protected', {
        headers: { 'authorization': 'Bearer dev-key-12345' }
      });
      expect(res.status).toBe(200);
      
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });

  describe('optionalApiKey', () => {
    it('should work without API key', async () => {
      const res = await app.request('/optional');
      expect(res.status).toBe(200);
      
      const body = await res.json();
      expect(body.authenticated).toBe(false);
    });

    it('should work with valid API key', async () => {
      process.env.NODE_ENV = 'development';
      
      const res = await app.request('/optional', {
        headers: { 'x-api-key': 'dev-key-12345' }
      });
      expect(res.status).toBe(200);
      
      const body = await res.json();
      expect(body.authenticated).toBe(true);
    });
  });

  describe('validateApiKeyFormat', () => {
    it('should validate correct API key format', () => {
      expect(validateApiKeyFormat('dev-key-12345')).toBe(true);
      expect(validateApiKeyFormat('ABC123DEF456')).toBe(true);
      expect(validateApiKeyFormat('valid-api-key-format')).toBe(true);
    });

    it('should reject invalid API key format', () => {
      expect(validateApiKeyFormat('short')).toBe(false);
      expect(validateApiKeyFormat('key with spaces')).toBe(false);
      expect(validateApiKeyFormat('key@with#symbols')).toBe(false);
      expect(validateApiKeyFormat('')).toBe(false);
    });
  });
});