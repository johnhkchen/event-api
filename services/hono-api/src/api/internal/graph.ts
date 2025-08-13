import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { elixirClient } from '../../lib/elixir-client/client.js';

const graphSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  parameters: z.record(z.any()).optional()
});

const app = new Hono();

// Graph query endpoint
app.post('/query', zValidator('json', graphSchema), async (c) => {
  try {
    const { query, parameters } = c.req.valid('json');
    
    const response = await elixirClient.queryGraph({
      query,
      parameters: parameters || {}
    });

    return c.json({
      success: true,
      data: response
    });
  } catch (error: any) {
    console.error('[GraphAPI] Query failed:', error);
    
    return c.json({
      success: false,
      error: error.message || 'Graph query failed'
    }, 500);
  }
});

// Get speaker connections
app.get('/speakers/:speakerId/connections', async (c) => {
  try {
    const speakerId = c.req.param('speakerId');
    const depth = parseInt(c.req.query('depth') || '2');
    
    const response = await elixirClient.queryGraph({
      query: 'speaker_connections',
      parameters: {
        speaker_id: speakerId,
        depth
      }
    });

    return c.json({
      success: true,
      data: response
    });
  } catch (error: any) {
    console.error('[GraphAPI] Speaker connections query failed:', error);
    
    return c.json({
      success: false,
      error: error.message || 'Failed to fetch speaker connections'
    }, 500);
  }
});

// Get company event relationships
app.get('/companies/:companyId/events', async (c) => {
  try {
    const companyId = c.req.param('companyId');
    const limit = parseInt(c.req.query('limit') || '50');
    
    const response = await elixirClient.queryGraph({
      query: 'company_events',
      parameters: {
        company_id: companyId,
        limit
      }
    });

    return c.json({
      success: true,
      data: response
    });
  } catch (error: any) {
    console.error('[GraphAPI] Company events query failed:', error);
    
    return c.json({
      success: false,
      error: error.message || 'Failed to fetch company events'
    }, 500);
  }
});

// Get event network analysis
app.get('/events/:eventId/network', async (c) => {
  try {
    const eventId = c.req.param('eventId');
    
    const response = await elixirClient.queryGraph({
      query: 'event_network',
      parameters: {
        event_id: eventId
      }
    });

    return c.json({
      success: true,
      data: response
    });
  } catch (error: any) {
    console.error('[GraphAPI] Event network query failed:', error);
    
    return c.json({
      success: false,
      error: error.message || 'Failed to fetch event network'
    }, 500);
  }
});

// Get topic relationships
app.get('/topics/:topicId/related', async (c) => {
  try {
    const topicId = c.req.param('topicId');
    const limit = parseInt(c.req.query('limit') || '20');
    
    const response = await elixirClient.queryGraph({
      query: 'topic_relationships',
      parameters: {
        topic_id: topicId,
        limit
      }
    });

    return c.json({
      success: true,
      data: response
    });
  } catch (error: any) {
    console.error('[GraphAPI] Topic relationships query failed:', error);
    
    return c.json({
      success: false,
      error: error.message || 'Failed to fetch topic relationships'
    }, 500);
  }
});

export default app;