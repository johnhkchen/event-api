import { Hono } from 'hono';
import { elixirClient } from '../../lib/elixir-client/client.js';
import { processingQueue } from '../../lib/elixir-client/queue.js';

const app = new Hono();

// Health check endpoint
app.get('/', async (c) => {
  try {
    const elixirHealthy = elixirClient.healthy;
    const queueStatus = processingQueue.getQueueStatus();
    
    const status = {
      healthy: elixirHealthy,
      timestamp: new Date().toISOString(),
      services: {
        elixir: {
          healthy: elixirHealthy,
          status: elixirHealthy ? 'UP' : 'DOWN'
        },
        queue: {
          healthy: true,
          status: 'UP',
          stats: queueStatus
        }
      }
    };

    const httpStatus = elixirHealthy ? 200 : 503;
    
    return c.json(status, httpStatus);
  } catch (error: any) {
    console.error('[HealthAPI] Health check failed:', error);
    
    return c.json({
      healthy: false,
      timestamp: new Date().toISOString(),
      error: error.message || 'Health check failed'
    }, 500);
  }
});

// Detailed health check
app.get('/detailed', async (c) => {
  try {
    const elixirHealthy = elixirClient.healthy;
    const queueStatus = processingQueue.getQueueStatus();
    
    const status = {
      healthy: elixirHealthy,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      services: {
        elixir: {
          healthy: elixirHealthy,
          status: elixirHealthy ? 'UP' : 'DOWN',
          lastCheck: new Date().toISOString()
        },
        queue: {
          healthy: true,
          status: 'UP',
          stats: queueStatus,
          activeJobs: queueStatus.processing,
          pendingJobs: queueStatus.pending
        }
      },
      version: process.env.npm_package_version || '1.0.0',
      nodeVersion: process.version
    };

    const httpStatus = elixirHealthy ? 200 : 503;
    
    return c.json(status, httpStatus);
  } catch (error: any) {
    console.error('[HealthAPI] Detailed health check failed:', error);
    
    return c.json({
      healthy: false,
      timestamp: new Date().toISOString(),
      error: error.message || 'Detailed health check failed'
    }, 500);
  }
});

export default app;