import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { ElixirClient } from '../src/lib/elixir-client/client.js';
import { EventProcessingQueue } from '../src/lib/elixir-client/queue.js';
import axios from 'axios';

// Mock axios for unit tests only - integration tests will use real HTTP
const mockAxios = vi.hoisted(() => ({
  create: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() }
    }
  }))
}));

// Helper to check if Elixir service is running
async function isElixirServiceAvailable(baseURL: string = 'http://localhost:4000'): Promise<boolean> {
  try {
    const response = await axios.get(`${baseURL}/api/internal/health`, { timeout: 2000 });
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

// Helper to wait for service to be available
async function waitForService(baseURL: string, maxAttempts: number = 10): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isElixirServiceAvailable(baseURL)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

// Unit tests with mocked axios
describe('Elixir Service Integration (Unit Tests)', () => {
  let client: ElixirClient;
  let queue: EventProcessingQueue;

  beforeAll(() => {
    // Mock axios for unit tests
    vi.mock('axios', () => ({
      default: mockAxios
    }));
    
    client = new ElixirClient({
      baseURL: 'http://localhost:4000',
      timeout: 5000,
      retries: 1,
      retryDelay: 100
    });
    
    queue = new EventProcessingQueue(2);
  });

  afterAll(() => {
    client.destroy();
  });

  describe('ElixirClient', () => {
    it('should initialize with correct configuration', () => {
      expect(client).toBeDefined();
      expect(client.healthy).toBe(false); // Initially false until health check passes
    });

    it('should have process event method', () => {
      expect(typeof client.processEvent).toBe('function');
    });

    it('should have graph query method', () => {
      expect(typeof client.queryGraph).toBe('function');
    });

    it('should have deduplication method', () => {
      expect(typeof client.deduplicate).toBe('function');
    });

    it('should have recommendations method', () => {
      expect(typeof client.getRecommendations).toBe('function');
    });
  });

  describe('EventProcessingQueue', () => {
    it('should initialize with correct max concurrent jobs', () => {
      expect(queue).toBeDefined();
    });

    it('should enqueue jobs and return job ID', async () => {
      const jobId = await queue.enqueue({
        eventId: 'test-event-1',
        htmlContent: '<html><body>Test Event</body></html>',
        url: 'https://example.com/event/1'
      });

      expect(typeof jobId).toBe('string');
      expect(jobId).toMatch(/^job_/);
    });

    it('should track job status', async () => {
      const jobId = await queue.enqueue({
        eventId: 'test-event-2',
        htmlContent: '<html><body>Test Event 2</body></html>',
        url: 'https://example.com/event/2'
      }, 5);

      const job = queue.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.id).toBe(jobId);
      expect(job?.status).toBe('pending');
    });

    it('should provide queue status', () => {
      const status = queue.getQueueStatus();
      expect(status).toHaveProperty('pending');
      expect(status).toHaveProperty('processing');
      expect(status).toHaveProperty('completed');
      expect(status).toHaveProperty('failed');
      expect(status).toHaveProperty('total');
      expect(typeof status.total).toBe('number');
    });
  });

  describe('Configuration', () => {
    it('should use environment variables when available', async () => {
      const originalEnv = process.env.ELIXIR_SERVICE_URL;
      process.env.ELIXIR_SERVICE_URL = 'http://test-elixir:4000';
      
      // Import fresh to get updated config
      const { defaultElixirConfig } = await import('../src/lib/elixir-client/config.js');
      expect(defaultElixirConfig.baseURL).toBe('http://test-elixir:4000');
      
      // Restore original
      if (originalEnv) {
        process.env.ELIXIR_SERVICE_URL = originalEnv;
      } else {
        delete process.env.ELIXIR_SERVICE_URL;
      }
    });
  });
});

// New integration tests that communicate with real Elixir service
describe('Elixir Service Real Integration', () => {
  let realClient: ElixirClient;
  const serviceURL = process.env.ELIXIR_SERVICE_URL || 'http://localhost:4000';

  beforeAll(async () => {
    // Only run if Elixir service is available
    const isAvailable = await isElixirServiceAvailable(serviceURL);
    if (!isAvailable) {
      console.log(`Skipping real integration tests - Elixir service not available at ${serviceURL}`);
    }

    // Create client without mocking for real integration tests
    vi.unmock('axios');
    realClient = new ElixirClient({
      baseURL: serviceURL,
      timeout: 10000,
      retries: 3,
      retryDelay: 1000
    });
  });

  afterAll(() => {
    if (realClient) {
      realClient.destroy();
    }
  });

  describe('Real Service Communication', () => {
    it('should connect to real Elixir health endpoint', async () => {
      const isAvailable = await isElixirServiceAvailable(serviceURL);
      if (!isAvailable) {
        console.log('Skipping - Elixir service not available');
        return;
      }
      const health = await realClient.healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.services).toBeDefined();
      expect(health.services.database).toBeDefined();
      expect(health.services.oban).toBeDefined();
    });

    it('should process events through real Elixir service', async () => {
      const isAvailable = await isElixirServiceAvailable(serviceURL);
      if (!isAvailable) {
        console.log('Skipping - Elixir service not available');
        return;
      }
      const eventData = {
        title: 'Real Integration Test Event',
        description: 'Testing real service communication',
        url: 'https://example.com/integration-test',
        html_content: `
          <html>
            <head><title>Integration Test Event</title></head>
            <body>
              <h1>Real Integration Test</h1>
              <p>Date: ${new Date().toISOString()}</p>
              <p>Location: Test City, TC</p>
              <p>Speaker: Test Speaker</p>
            </body>
          </html>
        `
      };

      const result = await realClient.processEvent(eventData);
      expect(result).toBeDefined();
      expect(result.job_id).toBeDefined();
      expect(typeof result.job_id).toBe('string');
    });

    it('should execute graph queries on real service', async () => {
      const isAvailable = await isElixirServiceAvailable(serviceURL);
      if (!isAvailable) {
        console.log('Skipping - Elixir service not available');
        return;
      }
      const query = {
        query: 'MATCH (e:Event) RETURN count(e) as event_count',
        parameters: {}
      };

      const result = await realClient.queryGraph(query);
      expect(result).toBeDefined();
      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
    });

    it('should handle deduplication requests', async () => {
      const isAvailable = await isElixirServiceAvailable(serviceURL);
      if (!isAvailable) {
        console.log('Skipping - Elixir service not available');
        return;
      }
      const entities = [
        {
          name: 'John Doe',
          email: 'john@example.com',
          company: 'TechCorp'
        },
        {
          name: 'John D.',
          email: 'john@example.com',
          company: 'TechCorp Inc'
        }
      ];

      const result = await realClient.deduplicate(entities, 'speaker');
      expect(result).toBeDefined();
      expect(result.deduplicated_entities).toBeDefined();
      expect(Array.isArray(result.deduplicated_entities)).toBe(true);
    });

    it('should fetch recommendations from real service', async () => {
      const isAvailable = await isElixirServiceAvailable(serviceURL);
      if (!isAvailable) {
        console.log('Skipping - Elixir service not available');
        return;
      }
      const result = await realClient.getRecommendations('events', { user_id: 'test-user', limit: 5 });
      expect(result).toBeDefined();
      expect(result.recommendations).toBeDefined();
      expect(Array.isArray(result.recommendations)).toBe(true);
    });
  });

  describe('Error Handling with Real Service', () => {
    it('should handle invalid requests gracefully', async () => {
      const isAvailable = await isElixirServiceAvailable(serviceURL);
      if (!isAvailable) {
        console.log('Skipping - Elixir service not available');
        return;
      }
      await expect(realClient.processEvent({} as any)).rejects.toThrow();
    });

    it('should handle malformed graph queries', async () => {
      const isAvailable = await isElixirServiceAvailable(serviceURL);
      if (!isAvailable) {
        console.log('Skipping - Elixir service not available');
        return;
      }
      const invalidQuery = {
        query: 'INVALID CYPHER SYNTAX',
        parameters: {}
      };

      await expect(realClient.queryGraph(invalidQuery)).rejects.toThrow();
    });

    it('should handle service unavailable scenarios', async () => {
      // Create client pointing to non-existent service
      const unavailableClient = new ElixirClient({
        baseURL: 'http://localhost:9999',
        timeout: 2000,
        retries: 1,
        retryDelay: 100
      });

      await expect(unavailableClient.healthCheck()).rejects.toThrow();
      unavailableClient.destroy();
    });
  });

  describe('Retry Logic and Circuit Breaker', () => {
    it('should respect retry configuration', async () => {
      const retryClient = new ElixirClient({
        baseURL: 'http://localhost:9999',
        timeout: 1000,
        retries: 2,
        retryDelay: 100
      });

      const startTime = Date.now();
      await expect(retryClient.healthCheck()).rejects.toThrow();
      const duration = Date.now() - startTime;
      
      // Should take at least retry delay time (2 retries * 100ms)
      expect(duration).toBeGreaterThan(200);
      retryClient.destroy();
    });

    it('should track service health status', async () => {
      const isAvailable = await isElixirServiceAvailable(serviceURL);
      if (!isAvailable) {
        console.log('Skipping - Elixir service not available');
        return;
      }
      // Healthy service should report as healthy
      expect(realClient.healthy).toBe(true);
      
      // Health status should be updated after health checks
      await realClient.healthCheck();
      expect(realClient.healthy).toBe(true);
    });
  });

  describe('Queue Integration with Real Service', () => {
    let realQueue: EventProcessingQueue;

    beforeEach(() => {
      realQueue = new EventProcessingQueue(2, realClient);
    });

    it('should process jobs through real service', async () => {
      const isAvailable = await isElixirServiceAvailable(serviceURL);
      if (!isAvailable) {
        console.log('Skipping - Elixir service not available');
        return;
      }
      const jobId = await realQueue.enqueue({
        eventId: `real-test-${Date.now()}`,
        htmlContent: '<html><body><h1>Real Queue Test</h1></body></html>',
        url: 'https://example.com/real-queue-test'
      });

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');

      // Job should be tracked
      const job = realQueue.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.status).toBeOneOf(['pending', 'processing', 'completed']);
    });

    it('should handle concurrent processing', async () => {
      const isAvailable = await isElixirServiceAvailable(serviceURL);
      if (!isAvailable) {
        console.log('Skipping - Elixir service not available');
        return;
      }
      const jobs = await Promise.all([
        realQueue.enqueue({
          eventId: `concurrent-1-${Date.now()}`,
          htmlContent: '<html><body><h1>Concurrent Test 1</h1></body></html>',
          url: 'https://example.com/concurrent-1'
        }),
        realQueue.enqueue({
          eventId: `concurrent-2-${Date.now()}`,
          htmlContent: '<html><body><h1>Concurrent Test 2</h1></body></html>',
          url: 'https://example.com/concurrent-2'
        }),
        realQueue.enqueue({
          eventId: `concurrent-3-${Date.now()}`,
          htmlContent: '<html><body><h1>Concurrent Test 3</h1></body></html>',
          url: 'https://example.com/concurrent-3'
        })
      ]);

      expect(jobs).toHaveLength(3);
      jobs.forEach(jobId => {
        expect(typeof jobId).toBe('string');
        const job = realQueue.getJob(jobId);
        expect(job).toBeDefined();
      });

      // Queue should manage concurrency correctly
      const status = realQueue.getQueueStatus();
      expect(status.total).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Performance and Load Testing', () => {
    it('should handle rapid sequential requests', async () => {
      const isAvailable = await isElixirServiceAvailable(serviceURL);
      if (!isAvailable) {
        console.log('Skipping - Elixir service not available');
        return;
      }
      const requests = Array.from({ length: 10 }, (_, i) => 
        realClient.processEvent({
          title: `Load Test Event ${i}`,
          description: `Performance test event ${i}`,
          url: `https://example.com/load-test-${i}`,
          html_content: `<html><body><h1>Load Test ${i}</h1></body></html>`
        })
      );

      const results = await Promise.allSettled(requests);
      
      // Most requests should succeed (allow for some failures under load)
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      expect(successCount).toBeGreaterThan(7); // At least 70% success rate
    });

    it('should maintain responsiveness under load', async () => {
      const isAvailable = await isElixirServiceAvailable(serviceURL);
      if (!isAvailable) {
        console.log('Skipping - Elixir service not available');
        return;
      }
      const startTime = Date.now();
      
      await realClient.healthCheck();
      
      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(5000); // Should respond within 5 seconds
    });
  });
});