import { eq, ilike, sql } from 'drizzle-orm';
import { db } from '../db/connection.ts';
import { topics, eventTopics } from '../../drizzle/schema.ts';
import type { NewTopic, Topic, NewEventTopic } from '../types/events.ts';

export class TopicService {
  // Create a new topic
  static async createTopic(topicData: NewTopic): Promise<Topic> {
    const [topic] = await db.insert(topics).values(topicData).returning();
    return topic;
  }

  // Get topic by ID
  static async getTopicById(id: string): Promise<Topic | null> {
    const topic = await db.query.topics.findFirst({
      where: eq(topics.id, id)
    });
    return topic || null;
  }

  // Find topic by name
  static async findTopicByName(name: string): Promise<Topic | null> {
    const topic = await db.query.topics.findFirst({
      where: ilike(topics.name, name)
    });
    return topic || null;
  }

  // Search topics
  static async searchTopics(query: string, limit: number = 10): Promise<Topic[]> {
    const results = await db
      .select()
      .from(topics)
      .where(
        sql`to_tsvector('english', ${topics.name} || ' ' || COALESCE(${topics.description}, '')) @@ plainto_tsquery('english', ${query})`
      )
      .limit(limit);
    
    return results;
  }

  // Link topic to event
  static async linkTopicToEvent(eventId: string, topicId: string, relevanceScore: number = 0): Promise<void> {
    await db.insert(eventTopics).values({
      eventId,
      topicId,
      relevanceScore
    });
  }

  // Get topics for an event
  static async getTopicsForEvent(eventId: string) {
    const result = await db.query.eventTopics.findMany({
      where: eq(eventTopics.eventId, eventId),
      with: {
        topic: true
      }
    });

    return result.map(item => ({
      ...item.topic,
      relevanceScore: item.relevanceScore
    }));
  }

  // Update topic
  static async updateTopic(id: string, updateData: Partial<NewTopic>): Promise<Topic> {
    const [updatedTopic] = await db
      .update(topics)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(topics.id, id))
      .returning();

    return updatedTopic;
  }

  // Get all topics with pagination
  static async getTopics(page: number = 1, limit: number = 20) {
    const offset = (page - 1) * limit;

    const topicsResult = await db
      .select()
      .from(topics)
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(topics);

    return {
      topics: topicsResult,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    };
  }
}