import { pgTable, uuid, text, date, timestamp, integer, jsonb, real, primaryKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  date: date('date'),
  location: text('location'),
  lumaUrl: text('luma_url').unique(),
  rawHtml: text('raw_html'),
  extractedData: jsonb('extracted_data'),
  embedding: text('embedding'), // Store as text for now, will be cast to vector in queries
  dataQualityScore: integer('data_quality_score').default(0),
  scrapedAt: timestamp('scraped_at').defaultNow(),
  processedAt: timestamp('processed_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

export const speakers = pgTable('speakers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name'),
  title: text('title'),
  company: text('company'),
  bio: text('bio'),
  confidenceScore: real('confidence_score').default(0),
  linkedinUrl: text('linkedin_url'),
  twitterUrl: text('twitter_url'),
  websiteUrl: text('website_url'),
  avatarUrl: text('avatar_url'),
  embedding: text('embedding'), // Store as text for now, will be cast to vector in queries
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').unique(),
  domain: text('domain'),
  description: text('description'),
  industry: text('industry'),
  websiteUrl: text('website_url'),
  logoUrl: text('logo_url'),
  size: text('size'),
  location: text('location'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

export const topics = pgTable('topics', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description'),
  category: text('category'),
  embedding: text('embedding'), // Store as text for now, will be cast to vector in queries
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

export const eventSpeakers = pgTable('event_speakers', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  speakerId: uuid('speaker_id').notNull().references(() => speakers.id, { onDelete: 'cascade' }),
  role: text('role').default('speaker'),
  extractionConfidence: real('extraction_confidence').default(0),
  createdAt: timestamp('created_at').defaultNow()
});

export const eventTopics = pgTable('event_topics', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  topicId: uuid('topic_id').notNull().references(() => topics.id, { onDelete: 'cascade' }),
  relevanceScore: integer('relevance_score').default(0),
  createdAt: timestamp('created_at').defaultNow()
});

export const eventCompanies = pgTable('event_companies', {
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  relationshipType: text('relationship_type'), // 'host', 'sponsor', 'venue', 'partner'
  createdAt: timestamp('created_at').defaultNow()
});

// Relations
export const eventsRelations = relations(events, ({ many }) => ({
  speakers: many(eventSpeakers),
  topics: many(eventTopics),
  companies: many(eventCompanies)
}));

export const speakersRelations = relations(speakers, ({ many }) => ({
  events: many(eventSpeakers)
}));

export const companiesRelations = relations(companies, ({ many }) => ({
  events: many(eventCompanies)
}));

export const topicsRelations = relations(topics, ({ many }) => ({
  events: many(eventTopics)
}));

export const eventSpeakersRelations = relations(eventSpeakers, ({ one }) => ({
  event: one(events, {
    fields: [eventSpeakers.eventId],
    references: [events.id]
  }),
  speaker: one(speakers, {
    fields: [eventSpeakers.speakerId],
    references: [speakers.id]
  })
}));

export const eventTopicsRelations = relations(eventTopics, ({ one }) => ({
  event: one(events, {
    fields: [eventTopics.eventId],
    references: [events.id]
  }),
  topic: one(topics, {
    fields: [eventTopics.topicId],
    references: [topics.id]
  })
}));

export const eventCompaniesRelations = relations(eventCompanies, ({ one }) => ({
  event: one(events, {
    fields: [eventCompanies.eventId],
    references: [events.id]
  }),
  company: one(companies, {
    fields: [eventCompanies.companyId],
    references: [companies.id]
  })
}));