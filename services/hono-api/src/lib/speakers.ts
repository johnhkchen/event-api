import { eq, ilike, sql } from 'drizzle-orm';
import { db } from '../db/connection.ts';
import { speakers, eventSpeakers } from '../../drizzle/schema.ts';
import type { NewSpeaker, Speaker, NewEventSpeaker } from '../types/events.ts';

export class SpeakerService {
  // Create a new speaker
  static async createSpeaker(speakerData: NewSpeaker): Promise<Speaker> {
    const [speaker] = await db.insert(speakers).values(speakerData).returning();
    return speaker;
  }

  // Get speaker by ID
  static async getSpeakerById(id: string): Promise<Speaker | null> {
    const speaker = await db.query.speakers.findFirst({
      where: eq(speakers.id, id)
    });
    return speaker || null;
  }

  // Find speaker by name (for deduplication)
  static async findSpeakerByName(name: string): Promise<Speaker | null> {
    const speaker = await db.query.speakers.findFirst({
      where: ilike(speakers.name, name)
    });
    return speaker || null;
  }

  // Search speakers
  static async searchSpeakers(query: string, limit: number = 10): Promise<Speaker[]> {
    const results = await db
      .select()
      .from(speakers)
      .where(
        sql`to_tsvector('english', ${speakers.name} || ' ' || COALESCE(${speakers.title}, '') || ' ' || COALESCE(${speakers.company}, '')) @@ plainto_tsquery('english', ${query})`
      )
      .limit(limit);
    
    return results;
  }

  // Link speaker to event
  static async linkSpeakerToEvent(eventId: string, speakerId: string, role: string = 'speaker'): Promise<void> {
    await db.insert(eventSpeakers).values({
      eventId,
      speakerId,
      role
    });
  }

  // Get speakers for an event
  static async getSpeakersForEvent(eventId: string) {
    const result = await db.query.eventSpeakers.findMany({
      where: eq(eventSpeakers.eventId, eventId),
      with: {
        speaker: true
      }
    });

    return result.map(item => ({
      ...item.speaker,
      role: item.role
    }));
  }

  // Update speaker
  static async updateSpeaker(id: string, updateData: Partial<NewSpeaker>): Promise<Speaker> {
    const [updatedSpeaker] = await db
      .update(speakers)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(speakers.id, id))
      .returning();

    return updatedSpeaker;
  }
}