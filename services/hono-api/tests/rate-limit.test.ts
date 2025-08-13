import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createRateLimit, rateLimitConfigs } from '../src/middleware/rate-limit.js';

describe('Rate Limiting Middleware', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    // Clear any existing rate limit data
    vi.clearAllMocks();
  });

  describe('createRateLimit', () => {
    it('should allow requests within limit', async () => {
      const rateLimit = createRateLimit({
        windowMs: 60000, // 1 minute
        maxRequests: 5
      });

      app.use('*', rateLimit);
      app.get('/test', (c) => c.json({ success: true }));

      // Make 3 requests (should all succeed)
      for (let i = 0; i < 3; i++) {
        const res = await app.request('/test');
        expect(res.status).toBe(200);
        
        // Check rate limit headers
        expect(res.headers.get('X-RateLimit-Limit')).toBe('5');
        expect(res.headers.get('X-RateLimit-Remaining')).toBe((5 - (i + 1)).toString());
      }
    });

    it('should block requests exceeding limit', async () => {
      const rateLimit = createRateLimit({
        windowMs: 60000, // 1 minute
        maxRequests: 2,
        message: 'Custom rate limit message'
      });

      app.use('*', rateLimit);
      app.get('/test', (c) => c.json({ success: true }));

      // Make requests up to limit
      for (let i = 0; i < 2; i++) {
        const res = await app.request('/test');
        expect(res.status).toBe(200);
      }

      // Next request should be rate limited
      const res = await app.request('/test');
      expect(res.status).toBe(429);
      
      const body = await res.json();
      expect(body.error).toBe('Rate limit exceeded');
      expect(body.message).toBe('Custom rate limit message');
      expect(body.limit).toBe(2);
      expect(body.remaining).toBe(0);
    });

    it('should use custom key generator', async () => {
      const rateLimit = createRateLimit({
        windowMs: 60000,
        maxRequests: 1,
        keyGenerator: (c) => {
          const userId = c.req.header('x-user-id') || 'anonymous';
          return `user:${userId}`;
        }
      });

      app.use('*', rateLimit);
      app.get('/test', (c) => c.json({ success: true }));

      // First user makes a request
      const res1 = await app.request('/test', {
        headers: { 'x-user-id': 'user1' }
      });
      expect(res1.status).toBe(200);

      // Same user makes another request (should be blocked)
      const res2 = await app.request('/test', {
        headers: { 'x-user-id': 'user1' }
      });
      expect(res2.status).toBe(429);

      // Different user makes a request (should succeed)
      const res3 = await app.request('/test', {
        headers: { 'x-user-id': 'user2' }
      });
      expect(res3.status).toBe(200);
    });
  });

  describe('rate limit configurations', () => {
    it('should have correct standard rate limit config', () => {
      expect(rateLimitConfigs.standard.windowMs).toBe(15 * 60 * 1000); // 15 minutes
      expect(rateLimitConfigs.standard.maxRequests).toBe(100);
    });

    it('should have correct scraping rate limit config', () => {
      expect(rateLimitConfigs.scraping.windowMs).toBe(60 * 1000); // 1 minute
      expect(rateLimitConfigs.scraping.maxRequests).toBe(10);
    });

    it('should have correct batch rate limit config', () => {
      expect(rateLimitConfigs.batch.windowMs).toBe(5 * 60 * 1000); // 5 minutes
      expect(rateLimitConfigs.batch.maxRequests).toBe(3);
    });

    it('should have correct auth rate limit config', () => {
      expect(rateLimitConfigs.auth.windowMs).toBe(15 * 60 * 1000); // 15 minutes
      expect(rateLimitConfigs.auth.maxRequests).toBe(5);
    });
  });

  describe('sliding window behavior', () => {
    it('should implement sliding window correctly', async () => {
      // Mock Date.now to control time
      const mockNow = vi.spyOn(Date, 'now');
      let currentTime = 1000000; // Start time
      mockNow.mockImplementation(() => currentTime);

      const rateLimit = createRateLimit({
        windowMs: 10000, // 10 seconds
        maxRequests: 2
      });

      app.use('*', rateLimit);
      app.get('/test', (c) => c.json({ success: true }));

      // Make 2 requests at time 0 (should succeed)
      for (let i = 0; i < 2; i++) {
        const res = await app.request('/test');
        expect(res.status).toBe(200);
      }

      // Third request should be blocked
      const res1 = await app.request('/test');
      expect(res1.status).toBe(429);

      // Move time forward by 11 seconds (outside window)
      currentTime += 11000;

      // Request should now succeed (sliding window)
      const res2 = await app.request('/test');
      expect(res2.status).toBe(200);

      mockNow.mockRestore();
    });
  });
});