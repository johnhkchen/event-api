import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { 
  securityHeaders, 
  inputSanitization, 
  contentTypeValidation,
  requestSizeLimit,
  isValidUrl 
} from '../src/middleware/security.js';

describe('Security Middleware', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
  });

  describe('securityHeaders', () => {
    it('should add security headers to responses', async () => {
      app.use('*', securityHeaders());
      app.get('/test', (c) => c.json({ success: true }));

      const res = await app.request('/test');
      
      expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('X-XSS-Protection')).toBe('1; mode=block');
      expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    });

    it('should set HSTS header with correct format', async () => {
      app.use('*', securityHeaders({
        hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
      }));
      app.get('/test', (c) => c.json({ success: true }));

      const res = await app.request('/test');
      
      const hsts = res.headers.get('Strict-Transport-Security');
      expect(hsts).toContain('max-age=31536000');
      expect(hsts).toContain('includeSubDomains');
      expect(hsts).toContain('preload');
    });
  });

  describe('contentTypeValidation', () => {
    beforeEach(() => {
      app.use('*', contentTypeValidation);
      app.post('/test', (c) => c.json({ success: true }));
    });

    it('should require Content-Type for POST requests', async () => {
      const res = await app.request('/test', {
        method: 'POST',
        body: JSON.stringify({ test: 'data' })
      });
      
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Missing Content-Type');
    });

    it('should accept valid Content-Type', async () => {
      const res = await app.request('/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: 'data' })
      });
      
      expect(res.status).toBe(200);
    });

    it('should reject invalid Content-Type', async () => {
      const res = await app.request('/test', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'test data'
      });
      
      expect(res.status).toBe(415);
      const body = await res.json();
      expect(body.error).toBe('Invalid Content-Type');
    });
  });

  describe('requestSizeLimit', () => {
    it('should reject requests exceeding size limit', async () => {
      app.use('*', requestSizeLimit(100)); // 100 byte limit
      app.post('/test', (c) => c.json({ success: true }));

      const res = await app.request('/test', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Content-Length': '200'
        },
        body: JSON.stringify({ data: 'x'.repeat(200) })
      });
      
      expect(res.status).toBe(413);
      const body = await res.json();
      expect(body.error).toBe('Request too large');
    });
  });

  describe('URL validation', () => {
    describe('isValidUrl', () => {
      it('should validate correct URLs', () => {
        expect(isValidUrl('https://example.com')).toBe(true);
        expect(isValidUrl('http://example.com')).toBe(true);
        expect(isValidUrl('https://lu.ma/event-123')).toBe(true);
      });

      it('should reject invalid protocols', () => {
        expect(isValidUrl('javascript:alert(1)')).toBe(false);
        expect(isValidUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
        expect(isValidUrl('file:///etc/passwd')).toBe(false);
      });

      it('should reject private IP ranges in production', () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        
        expect(isValidUrl('http://localhost:3000')).toBe(false);
        expect(isValidUrl('http://127.0.0.1:8080')).toBe(false);
        expect(isValidUrl('http://192.168.1.1')).toBe(false);
        expect(isValidUrl('http://10.0.0.1')).toBe(false);
        
        process.env.NODE_ENV = originalEnv;
      });

      it('should allow private IPs in development', () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        
        expect(isValidUrl('http://localhost:3000')).toBe(true);
        expect(isValidUrl('http://127.0.0.1:8080')).toBe(true);
        
        process.env.NODE_ENV = originalEnv;
      });
    });
  });
});