import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { elixirClient } from '../../lib/elixir-client/client.js';
import { processingQueue } from '../../lib/elixir-client/queue.js';

const processEventSchema = z.object({
  eventId: z.string().min(1, 'Event ID is required'),
  htmlContent: z.string().min(1, 'HTML content is required'),
  url: z.string().url('Valid URL is required'),
  priority: z.number().min(0).max(10).optional().default(5)
});

const deduplicationSchema = z.object({
  type: z.enum(['speaker', 'company', 'event']),
  data: z.array(z.any()).min(1, 'Data array cannot be empty')
});

const app = new Hono();

// Process event (async with queue)
app.post('/process', zValidator('json', processEventSchema), async (c) => {
  try {
    const { eventId, htmlContent, url, priority } = c.req.valid('json');
    
    const jobId = await processingQueue.enqueue({
      eventId,
      htmlContent,
      url
    }, priority);

    return c.json({
      success: true,
      jobId,
      message: 'Event processing job queued'
    });
  } catch (error: any) {
    console.error('[ProcessingAPI] Process event failed:', error);
    
    return c.json({
      success: false,
      error: error.message || 'Failed to queue event processing'
    }, 500);
  }
});

// Process event synchronously (for urgent processing)
app.post('/process/sync', zValidator('json', processEventSchema), async (c) => {
  try {
    const { eventId, htmlContent, url } = c.req.valid('json');
    
    const response = await elixirClient.processEvent({
      eventId,
      htmlContent,
      url
    });

    return c.json({
      success: true,
      data: response
    });
  } catch (error: any) {
    console.error('[ProcessingAPI] Sync process event failed:', error);
    
    return c.json({
      success: false,
      error: error.message || 'Event processing failed'
    }, 500);
  }
});

// Get processing job status
app.get('/process/job/:jobId', async (c) => {
  try {
    const jobId = c.req.param('jobId');
    const job = processingQueue.getJob(jobId);
    
    if (!job) {
      return c.json({
        success: false,
        error: 'Job not found'
      }, 404);
    }

    return c.json({
      success: true,
      data: job
    });
  } catch (error: any) {
    console.error('[ProcessingAPI] Get job status failed:', error);
    
    return c.json({
      success: false,
      error: error.message || 'Failed to get job status'
    }, 500);
  }
});

// Wait for processing job completion
app.get('/process/job/:jobId/wait', async (c) => {
  try {
    const jobId = c.req.param('jobId');
    const timeout = parseInt(c.req.query('timeout') || '30000');
    
    const job = await processingQueue.waitForJob(jobId, timeout);
    
    return c.json({
      success: true,
      data: job
    });
  } catch (error: any) {
    console.error('[ProcessingAPI] Wait for job failed:', error);
    
    return c.json({
      success: false,
      error: error.message || 'Failed to wait for job completion'
    }, 500);
  }
});

// Get queue status
app.get('/queue/status', async (c) => {
  try {
    const status = processingQueue.getQueueStatus();
    
    return c.json({
      success: true,
      data: status
    });
  } catch (error: any) {
    console.error('[ProcessingAPI] Get queue status failed:', error);
    
    return c.json({
      success: false,
      error: error.message || 'Failed to get queue status'
    }, 500);
  }
});

// Deduplication endpoint
app.post('/deduplicate', zValidator('json', deduplicationSchema), async (c) => {
  try {
    const { type, data } = c.req.valid('json');
    
    const response = await elixirClient.deduplicate({
      type,
      data
    });

    return c.json({
      success: true,
      data: response
    });
  } catch (error: any) {
    console.error('[ProcessingAPI] Deduplication failed:', error);
    
    return c.json({
      success: false,
      error: error.message || 'Deduplication failed'
    }, 500);
  }
});

export default app;