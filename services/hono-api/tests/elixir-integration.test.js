import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ElixirClient } from '../src/lib/elixir-client/client.js';
import { EventProcessingQueue } from '../src/lib/elixir-client/queue.js';
// Mock axios for testing
vi.mock('axios', () => ({
    default: {
        create: vi.fn(() => ({
            get: vi.fn(),
            post: vi.fn(),
            interceptors: {
                request: { use: vi.fn() },
                response: { use: vi.fn() }
            }
        }))
    }
}));
describe('Elixir Service Integration', () => {
    let client;
    let queue;
    beforeAll(() => {
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
            }
            else {
                delete process.env.ELIXIR_SERVICE_URL;
            }
        });
    });
});
//# sourceMappingURL=elixir-integration.test.js.map