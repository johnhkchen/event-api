import { eq, and, gte, lte, ilike, sql, desc } from 'drizzle-orm';
import { db } from '../db/connection.ts';
import { events, eventSpeakers, speakers, eventTopics, topics } from '../../drizzle/schema.ts';
import type { 
  NewEvent, 
  UpdateEvent, 
  EventFilters, 
  PaginationParams, 
  EventWithRelations,
  EventSearchParams 
} from '../types/events.ts';

export class EventService {
  // Create a new event
  static async createEvent(eventData: NewEvent) {
    const [event] = await db.insert(events).values(eventData).returning();
    return event;
  }

  // Get event by ID with relations
  static async getEventById(id: string): Promise<EventWithRelations | null> {
    const result = await db.query.events.findFirst({
      where: eq(events.id, id),
      with: {
        speakers: {
          with: {
            speaker: true
          }
        },
        topics: {
          with: {
            topic: true
          }
        }
      }
    });

    return result || null;
  }

  // Get events with filters and pagination
  static async getEvents(filters: EventFilters = {}, pagination: PaginationParams = {}) {
    const { page = 1, limit = 20 } = pagination;
    const offset = (page - 1) * limit;

    const whereConditions = [];

    if (filters.location) {
      whereConditions.push(ilike(events.location, `%${filters.location}%`));
    }

    if (filters.dateAfter) {
      whereConditions.push(gte(events.date, filters.dateAfter));
    }

    if (filters.dateBefore) {
      whereConditions.push(lte(events.date, filters.dateBefore));
    }

    if (filters.dataQualityScore) {
      whereConditions.push(gte(events.dataQualityScore, filters.dataQualityScore));
    }

    const baseQuery = db.select().from(events);

    if (whereConditions.length > 0) {
      baseQuery.where(and(...whereConditions));
    }

    const eventsResult = await baseQuery
      .orderBy(desc(events.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const countQuery = db.select({ count: sql<number>`count(*)` }).from(events);
    
    if (whereConditions.length > 0) {
      countQuery.where(and(...whereConditions));
    }

    const [{ count }] = await countQuery;

    return {
      events: eventsResult,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    };
  }

  // Update event
  static async updateEvent(id: string, updateData: UpdateEvent) {
    const [updatedEvent] = await db
      .update(events)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(events.id, id))
      .returning();

    return updatedEvent;
  }

  // Delete event
  static async deleteEvent(id: string) {
    const [deletedEvent] = await db
      .delete(events)
      .where(eq(events.id, id))
      .returning();

    return deletedEvent;
  }

  // Search events by text
  static async searchEvents(params: EventSearchParams) {
    const { q, embedding, limit = 10 } = params;

    if (embedding && embedding.length > 0) {
      // Vector similarity search
      const results = await db.execute(sql`
        SELECT *, (embedding <=> ${JSON.stringify(embedding)}::vector) as distance
        FROM events
        WHERE embedding IS NOT NULL
        ORDER BY distance
        LIMIT ${limit}
      `);
      return results;
    }

    if (q) {
      // Text search using PostgreSQL full-text search
      const results = await db
        .select()
        .from(events)
        .where(
          sql`to_tsvector('english', ${events.name} || ' ' || COALESCE(${events.description}, '')) @@ plainto_tsquery('english', ${q})`
        )
        .limit(limit);
      
      return results;
    }

    return [];
  }

  // Get events count
  static async getEventsCount(filters: EventFilters = {}): Promise<number> {
    const whereConditions = [];

    if (filters.location) {
      whereConditions.push(ilike(events.location, `%${filters.location}%`));
    }

    if (filters.dateAfter) {
      whereConditions.push(gte(events.date, filters.dateAfter));
    }

    if (filters.dateBefore) {
      whereConditions.push(lte(events.date, filters.dateBefore));
    }

    if (filters.dataQualityScore) {
      whereConditions.push(gte(events.dataQualityScore, filters.dataQualityScore));
    }

    const query = db.select({ count: sql<number>`count(*)` }).from(events);
    
    if (whereConditions.length > 0) {
      query.where(and(...whereConditions));
    }

    const [{ count }] = await query;
    return count;
  }

  // Batch create events
  static async createEventsBatch(eventsData: NewEvent[]) {
    if (eventsData.length === 0) return [];
    
    const createdEvents = await db.insert(events).values(eventsData).returning();
    return createdEvents;
  }

  // Get events by Lu.ma URL (for deduplication)
  static async getEventByLumaUrl(lumaUrl: string) {
    const event = await db.query.events.findFirst({
      where: eq(events.lumaUrl, lumaUrl)
    });
    return event || null;
  }
}