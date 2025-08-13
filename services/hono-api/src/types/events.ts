import type { events, speakers, companies, topics, eventSpeakers, eventTopics, eventCompanies } from '../../drizzle/schema.ts';

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type UpdateEvent = Partial<NewEvent>;

export type Speaker = typeof speakers.$inferSelect;
export type NewSpeaker = typeof speakers.$inferInsert;

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;

export type Topic = typeof topics.$inferSelect;
export type NewTopic = typeof topics.$inferInsert;

export type EventSpeaker = typeof eventSpeakers.$inferSelect;
export type NewEventSpeaker = typeof eventSpeakers.$inferInsert;

export type EventTopic = typeof eventTopics.$inferSelect;
export type NewEventTopic = typeof eventTopics.$inferInsert;

export type EventCompany = typeof eventCompanies.$inferSelect;
export type NewEventCompany = typeof eventCompanies.$inferInsert;

export interface EventWithRelations extends Event {
  speakers: (EventSpeaker & { speaker: Speaker })[];
  topics: (EventTopic & { topic: Topic })[];
  companies: (EventCompany & { company: Company })[];
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