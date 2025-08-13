import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { EventService } from '../lib/events.ts';
import type { EventFilters, PaginationParams, EventSearchParams } from '../types/events.ts';

const events = new Hono();

// Validation schemas
const eventSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  date: z.string().optional(),
  location: z.string().optional(),
  lumaUrl: z.string().url().optional(),
  rawHtml: z.string().optional(),
  extractedData: z.record(z.any()).optional(),
  dataQualityScore: z.number().int().min(0).max(100).optional()
});

const filtersSchema = z.object({
  location: z.string().optional(),
  topics: z.array(z.string()).optional(),
  dateAfter: z.string().optional(),
  dateBefore: z.string().optional(),
  dataQualityScore: z.number().int().min(0).max(100).optional(),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20)
});

const searchSchema = z.object({
  q: z.string().optional(),
  embedding: z.array(z.number()).optional(),
  limit: z.number().int().min(1).max(50).optional().default(10)
});

// GET /api/events - List events with filters and pagination
events.get('/', zValidator('query', filtersSchema), async (c) => {
  try {
    const { page, limit, ...filters } = c.req.valid('query');
    
    const result = await EventService.getEvents(filters as EventFilters, { page, limit });
    
    return c.json({
      success: true,
      data: result.events,
      pagination: result.pagination
    });
  } catch (error) {
    console.error('Error fetching events:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to fetch events' 
    }, 500);
  }
});

// GET /api/events/:id - Get event by ID with relations
events.get('/:id', async (c) => {
  try {
    const eventId = c.req.param('id');
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(eventId)) {
      return c.json({ 
        success: false, 
        error: 'Invalid event ID format' 
      }, 400);
    }
    
    const event = await EventService.getEventById(eventId);
    
    if (!event) {
      return c.json({ 
        success: false, 
        error: 'Event not found' 
      }, 404);
    }
    
    return c.json({
      success: true,
      data: event
    });
  } catch (error) {
    console.error('Error fetching event:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to fetch event' 
    }, 500);
  }
});

// POST /api/events - Create new event
events.post('/', zValidator('json', eventSchema), async (c) => {
  try {
    const eventData = c.req.valid('json');
    
    // Check for duplicate Lu.ma URL if provided
    if (eventData.lumaUrl) {
      const existingEvent = await EventService.getEventByLumaUrl(eventData.lumaUrl);
      if (existingEvent) {
        return c.json({
          success: false,
          error: 'Event with this Lu.ma URL already exists',
          data: { existingEventId: existingEvent.id }
        }, 409);
      }
    }
    
    const newEvent = await EventService.createEvent(eventData);
    
    return c.json({
      success: true,
      data: newEvent
    }, 201);
  } catch (error) {
    console.error('Error creating event:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to create event' 
    }, 500);
  }
});

// PUT /api/events/:id - Update event
events.put('/:id', zValidator('json', eventSchema.partial()), async (c) => {
  try {
    const eventId = c.req.param('id');
    const updateData = c.req.valid('json');
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(eventId)) {
      return c.json({ 
        success: false, 
        error: 'Invalid event ID format' 
      }, 400);
    }
    
    // Check if event exists
    const existingEvent = await EventService.getEventById(eventId);
    if (!existingEvent) {
      return c.json({ 
        success: false, 
        error: 'Event not found' 
      }, 404);
    }
    
    const updatedEvent = await EventService.updateEvent(eventId, updateData);
    
    return c.json({
      success: true,
      data: updatedEvent
    });
  } catch (error) {
    console.error('Error updating event:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to update event' 
    }, 500);
  }
});

// DELETE /api/events/:id - Delete event
events.delete('/:id', async (c) => {
  try {
    const eventId = c.req.param('id');
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(eventId)) {
      return c.json({ 
        success: false, 
        error: 'Invalid event ID format' 
      }, 400);
    }
    
    const deletedEvent = await EventService.deleteEvent(eventId);
    
    if (!deletedEvent) {
      return c.json({ 
        success: false, 
        error: 'Event not found' 
      }, 404);
    }
    
    return c.json({
      success: true,
      message: 'Event deleted successfully',
      data: { deletedEventId: deletedEvent.id }
    });
  } catch (error) {
    console.error('Error deleting event:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to delete event' 
    }, 500);
  }
});

// GET /api/events/search - Search events
events.get('/search', zValidator('query', searchSchema), async (c) => {
  try {
    const searchParams = c.req.valid('query') as EventSearchParams;
    
    const results = await EventService.searchEvents(searchParams);
    
    return c.json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Error searching events:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to search events' 
    }, 500);
  }
});

// POST /api/events/batch - Batch create events
const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(50)
});

events.post('/batch', zValidator('json', batchSchema), async (c) => {
  try {
    const { events: eventsData } = c.req.valid('json');
    
    const results = [];
    const errors = [];
    
    for (const [index, eventData] of eventsData.entries()) {
      try {
        // Check for duplicate Lu.ma URL if provided
        if (eventData.lumaUrl) {
          const existingEvent = await EventService.getEventByLumaUrl(eventData.lumaUrl);
          if (existingEvent) {
            errors.push({
              index,
              error: 'Event with this Lu.ma URL already exists',
              data: eventData
            });
            continue;
          }
        }
        
        const newEvent = await EventService.createEvent(eventData);
        results.push({ index, event: newEvent });
      } catch (error) {
        errors.push({
          index,
          error: error instanceof Error ? error.message : 'Unknown error',
          data: eventData
        });
      }
    }
    
    return c.json({
      success: true,
      data: {
        created: results,
        errors,
        summary: {
          total: eventsData.length,
          successful: results.length,
          failed: errors.length
        }
      }
    });
  } catch (error) {
    console.error('Error in batch create:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to process batch request' 
    }, 500);
  }
});

export default events;