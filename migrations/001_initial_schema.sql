-- Migration: 001_initial_schema.sql
-- Description: Create initial database schema for Event API
-- Created: 2025-08-13
-- Author: agent-001

-- Ensure required extensions are enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Create core events table
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    date DATE,
    location TEXT,
    luma_url TEXT UNIQUE,
    raw_html TEXT,
    extracted_data JSONB,
    embedding vector(1536),
    data_quality_score INTEGER DEFAULT 0,
    scraped_at TIMESTAMPTZ DEFAULT now(),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    
    -- Constraints
    CONSTRAINT valid_data_quality_score CHECK (data_quality_score >= 0 AND data_quality_score <= 100),
    CONSTRAINT valid_date CHECK (date >= '1900-01-01'::DATE),
    CONSTRAINT valid_luma_url CHECK (luma_url IS NULL OR luma_url ~* '^https?://.*lu\.ma/.*')
);

-- Create speakers table with deduplication support
CREATE TABLE speakers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    normalized_name TEXT,
    company TEXT,
    bio TEXT,
    confidence_score REAL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    
    -- Constraints
    CONSTRAINT valid_confidence_score CHECK (confidence_score >= 0 AND confidence_score <= 1),
    CONSTRAINT non_empty_name CHECK (trim(name) != '')
);

-- Create companies table
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    normalized_name TEXT UNIQUE,
    domain TEXT,
    industry TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    
    -- Constraints
    CONSTRAINT non_empty_company_name CHECK (trim(name) != ''),
    CONSTRAINT valid_domain CHECK (domain IS NULL OR domain ~* '^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$')
);

-- Create topics table
CREATE TABLE topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category TEXT, -- 'technology', 'industry', 'format'
    created_at TIMESTAMPTZ DEFAULT now(),
    
    -- Constraints
    CONSTRAINT non_empty_topic_name CHECK (trim(name) != ''),
    CONSTRAINT valid_category CHECK (category IS NULL OR category IN ('technology', 'industry', 'format')),
    CONSTRAINT unique_topic_name UNIQUE (name)
);

-- Create event-speaker relationship table
CREATE TABLE event_speakers (
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    speaker_id UUID REFERENCES speakers(id) ON DELETE CASCADE,
    role TEXT, -- 'speaker', 'judge', 'host', 'panelist'
    extraction_confidence REAL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    
    -- Constraints
    PRIMARY KEY (event_id, speaker_id, role),
    CONSTRAINT valid_speaker_role CHECK (role IN ('speaker', 'judge', 'host', 'panelist')),
    CONSTRAINT valid_extraction_confidence CHECK (extraction_confidence >= 0 AND extraction_confidence <= 1)
);

-- Create event-company relationship table
CREATE TABLE event_companies (
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    relationship_type TEXT, -- 'host', 'sponsor', 'venue', 'partner'
    created_at TIMESTAMPTZ DEFAULT now(),
    
    -- Constraints
    PRIMARY KEY (event_id, company_id, relationship_type),
    CONSTRAINT valid_relationship_type CHECK (relationship_type IN ('host', 'sponsor', 'venue', 'partner'))
);

-- Create event-topic relationship table
CREATE TABLE event_topics (
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,
    relevance_score REAL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    
    -- Constraints
    PRIMARY KEY (event_id, topic_id),
    CONSTRAINT valid_relevance_score CHECK (relevance_score >= 0 AND relevance_score <= 1)
);

-- Create indexes for performance optimization

-- Primary query patterns for events
CREATE INDEX idx_events_date ON events(date);
CREATE INDEX idx_events_location ON events(location);
CREATE INDEX idx_events_scraped_at ON events(scraped_at);
CREATE INDEX idx_events_processed_at ON events(processed_at);
CREATE INDEX idx_events_data_quality ON events(data_quality_score);

-- Vector similarity search (using HNSW for better performance)
CREATE INDEX idx_events_embedding ON events USING hnsw (embedding vector_cosine_ops);

-- Full-text search on events
CREATE INDEX idx_events_fts ON events USING gin(to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(location, '')));

-- Speaker indexes
CREATE INDEX idx_speakers_normalized_name ON speakers(normalized_name);
CREATE INDEX idx_speakers_company ON speakers(company);
CREATE INDEX idx_speakers_confidence ON speakers(confidence_score);

-- Company indexes
CREATE INDEX idx_companies_normalized_name ON companies(normalized_name);
CREATE INDEX idx_companies_domain ON companies(domain);
CREATE INDEX idx_companies_industry ON companies(industry);

-- Topic indexes
CREATE INDEX idx_topics_category ON topics(category);
CREATE INDEX idx_topics_name ON topics(name);

-- Relationship indexes
CREATE INDEX idx_event_speakers_event ON event_speakers(event_id);
CREATE INDEX idx_event_speakers_speaker ON event_speakers(speaker_id);
CREATE INDEX idx_event_speakers_role ON event_speakers(role);

CREATE INDEX idx_event_companies_event ON event_companies(event_id);
CREATE INDEX idx_event_companies_company ON event_companies(company_id);
CREATE INDEX idx_event_companies_type ON event_companies(relationship_type);

CREATE INDEX idx_event_topics_event ON event_topics(event_id);
CREATE INDEX idx_event_topics_topic ON event_topics(topic_id);
CREATE INDEX idx_event_topics_relevance ON event_topics(relevance_score);

-- Composite indexes for common query patterns
CREATE INDEX idx_events_date_location ON events(date, location);
CREATE INDEX idx_events_date_quality ON events(date, data_quality_score);
CREATE INDEX idx_speakers_name_company ON speakers(normalized_name, company);

-- Comments for documentation
COMMENT ON TABLE events IS 'Core events table storing scraped and processed event data';
COMMENT ON TABLE speakers IS 'Deduplicated speakers with confidence scoring';
COMMENT ON TABLE companies IS 'Normalized company information';
COMMENT ON TABLE topics IS 'Event categorization and tagging system';
COMMENT ON TABLE event_speakers IS 'Many-to-many relationship between events and speakers';
COMMENT ON TABLE event_companies IS 'Many-to-many relationship between events and companies';
COMMENT ON TABLE event_topics IS 'Many-to-many relationship between events and topics with relevance scoring';

COMMENT ON COLUMN events.embedding IS 'Vector embedding for semantic search (1536 dimensions for OpenAI)';
COMMENT ON COLUMN events.data_quality_score IS 'Quality score from 0-100 based on data completeness and accuracy';
COMMENT ON COLUMN speakers.normalized_name IS 'Lowercase, cleaned name for deduplication';
COMMENT ON COLUMN speakers.confidence_score IS 'Confidence in speaker identification (0.0-1.0)';
COMMENT ON COLUMN companies.normalized_name IS 'Normalized company name for deduplication';