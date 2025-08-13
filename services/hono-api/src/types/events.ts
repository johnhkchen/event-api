import type { events, speakers, topics, eventSpeakers, eventTopics } from '../../drizzle/schema.ts';

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type UpdateEvent = Partial<NewEvent>;

export type Speaker = typeof speakers.$inferSelect;
export type NewSpeaker = typeof speakers.$inferInsert;

export type Topic = typeof topics.$inferSelect;
export type NewTopic = typeof topics.$inferInsert;

export type EventSpeaker = typeof eventSpeakers.$inferSelect;
export type NewEventSpeaker = typeof eventSpeakers.$inferInsert;

export type EventTopic = typeof eventTopics.$inferSelect;
export type NewEventTopic = typeof eventTopics.$inferInsert;

export interface EventWithRelations extends Event {
  speakers: (EventSpeaker & { speaker: Speaker })[];
  topics: (EventTopic & { topic: Topic })[];
}

export interface EventFilters {
  location?: string;
  topics?: string[];
  dateAfter?: string;
  dateBefore?: string;
  dataQualityScore?: number;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface EventSearchParams {
  q?: string;
  embedding?: number[];
  limit?: number;
}