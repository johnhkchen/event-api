import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { elixirClient } from '../../lib/elixir-client/client.js';

const recommendationQuerySchema = z.object({
  userId: z.string().optional(),
  eventId: z.string().optional(),
  limit: z.number().min(1).max(100).optional().default(10)
});

const app = new Hono();

// Get event recommendations
app.get('/events', zValidator('query', recommendationQuerySchema), async (c) => {
  try {
    const { userId, eventId, limit } = c.req.valid('query');
    
    const response = await elixirClient.getRecommendations({
      userId,
      eventId,
      type: 'events',
      limit
    });

    return c.json({
      success: true,
      data: response
    });
  } catch (error: any) {
    console.error('[RecommendationsAPI] Event recommendations failed:', error);
    
    return c.json({
      success: false,
      error: error.message || 'Failed to get event recommendations'
    }, 500);
  }
});

// Get speaker recommendations
app.get('/speakers', zValidator('query', recommendationQuerySchema), async (c) => {
  try {
    const { userId, eventId, limit } = c.req.valid('query');
    
    const response = await elixirClient.getRecommendations({
      userId,
      eventId,
      type: 'speakers',
      limit
    });

    return c.json({
      success: true,
      data: response
    });
  } catch (error: any) {
    console.error('[RecommendationsAPI] Speaker recommendations failed:', error);
    
    return c.json({
      success: false,
      error: error.message || 'Failed to get speaker recommendations'
    }, 500);
  }
});

// Get topic recommendations
app.get('/topics', zValidator('query', recommendationQuerySchema), async (c) => {
  try {
    const { userId, eventId, limit } = c.req.valid('query');
    
    const response = await elixirClient.getRecommendations({
      userId,
      eventId,
      type: 'topics',
      limit
    });

    return c.json({
      success: true,
      data: response
    });
  } catch (error: any) {
    console.error('[RecommendationsAPI] Topic recommendations failed:', error);
    
    return c.json({
      success: false,
      error: error.message || 'Failed to get topic recommendations'
    }, 500);
  }
});

// Get similar events
app.get('/events/:eventId/similar', async (c) => {
  try {
    const eventId = c.req.param('eventId');
    const limit = parseInt(c.req.query('limit') || '10');
    
    const response = await elixirClient.getRecommendations({
      eventId,
      type: 'events',
      limit
    });

    return c.json({
      success: true,
      data: response
    });
  } catch (error: any) {
    console.error('[RecommendationsAPI] Similar events failed:', error);
    
    return c.json({
      success: false,
      error: error.message || 'Failed to get similar events'
    }, 500);
  }
});

// Get personalized recommendations for user
app.get('/users/:userId/personalized', async (c) => {
  try {
    const userId = c.req.param('userId');
    const type = c.req.query('type') || 'events';
    const limit = parseInt(c.req.query('limit') || '20');
    
    if (!['events', 'speakers', 'topics'].includes(type)) {
      return c.json({
        success: false,
        error: 'Invalid recommendation type. Must be events, speakers, or topics'
      }, 400);
    }
    
    const response = await elixirClient.getRecommendations({
      userId,
      type: type as 'events' | 'speakers' | 'topics',
      limit
    });

    return c.json({
      success: true,
      data: response
    });
  } catch (error: any) {
    console.error('[RecommendationsAPI] Personalized recommendations failed:', error);
    
    return c.json({
      success: false,
      error: error.message || 'Failed to get personalized recommendations'
    }, 500);
  }
});

export default app;