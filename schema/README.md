# Event API Database Schema

## Overview

This document describes the complete database schema for the Event API platform, a hybrid Elixir + Hono microservices architecture for event data processing.

## Database Technology Stack

- **PostgreSQL 15+** - Primary database
- **pgvector** - Vector similarity search for embeddings
- **AGE** - Graph database extension for relationship queries
- **Extensions**: uuid-ossp, pgvector, age

## Core Tables

### events

Core event storage with vector embeddings for semantic search.

```sql
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    date DATE,
    location TEXT,
    luma_url TEXT UNIQUE,
    raw_html TEXT,
    extracted_data JSONB,
    embedding vector(1536),  -- OpenAI embedding dimensions
    data_quality_score INTEGER DEFAULT 0,  -- 0-100 quality score
    scraped_at TIMESTAMPTZ DEFAULT now(),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

**Key Features:**
- Vector embedding column for semantic search
- JSONB for flexible extracted data storage
- Quality scoring for data validation
- Luma.com URL uniqueness constraint

### speakers

Deduplicated speaker information with confidence scoring.

```sql
CREATE TABLE speakers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    normalized_name TEXT,  -- For deduplication
    company TEXT,
    bio TEXT,
    confidence_score REAL DEFAULT 0,  -- 0.0-1.0 confidence
    created_at TIMESTAMPTZ DEFAULT now()
);
```

**Key Features:**
- Normalized names for deduplication
- Confidence scoring for AI extraction quality
- Company affiliation tracking

### companies

Normalized company tracking across events.

```sql
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    normalized_name TEXT UNIQUE,
    domain TEXT,
    industry TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

**Key Features:**
- Unique normalized names prevent duplicates
- Domain validation for company websites
- Industry categorization

### topics

Event categorization and tagging system.

```sql
CREATE TABLE topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category TEXT,  -- 'technology', 'industry', 'format'
    created_at TIMESTAMPTZ DEFAULT now()
);
```

**Key Features:**
- Hierarchical categorization
- Unique topic names
- Predefined category types

## Relationship Tables

### event_speakers

Many-to-many relationship between events and speakers with role information.

```sql
CREATE TABLE event_speakers (
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    speaker_id UUID REFERENCES speakers(id) ON DELETE CASCADE,
    role TEXT,  -- 'speaker', 'judge', 'host', 'panelist'
    extraction_confidence REAL DEFAULT 0,
    PRIMARY KEY (event_id, speaker_id, role)
);
```

### event_companies

Many-to-many relationship between events and companies.

```sql
CREATE TABLE event_companies (
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    relationship_type TEXT,  -- 'host', 'sponsor', 'venue', 'partner'
    PRIMARY KEY (event_id, company_id, relationship_type)
);
```

### event_topics

Many-to-many relationship between events and topics with relevance scoring.

```sql
CREATE TABLE event_topics (
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,
    relevance_score REAL DEFAULT 0,  -- 0.0-1.0 relevance
    PRIMARY KEY (event_id, topic_id)
);
```

## Indexing Strategy

### Performance Indexes

```sql
-- Vector similarity search
CREATE INDEX idx_events_embedding ON events USING hnsw (embedding vector_cosine_ops);

-- Full-text search
CREATE INDEX idx_events_fts ON events USING gin(to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(location, '')));

-- Common query patterns
CREATE INDEX idx_events_date ON events(date);
CREATE INDEX idx_events_location ON events(location);
CREATE INDEX idx_events_date_location ON events(date, location);
```

### Relationship Indexes

```sql
-- Foreign key indexes for joins
CREATE INDEX idx_event_speakers_event ON event_speakers(event_id);
CREATE INDEX idx_event_speakers_speaker ON event_speakers(speaker_id);
CREATE INDEX idx_event_companies_event ON event_companies(event_id);
CREATE INDEX idx_event_topics_event ON event_topics(event_id);
```

## Data Validation

### Constraints

- **Data Quality**: Scores must be 0-100
- **Confidence Scores**: Must be 0.0-1.0
- **Dates**: Cannot be before 1900-01-01
- **URLs**: Must match Luma.com pattern if provided
- **Names**: Cannot be empty or whitespace-only
- **Domains**: Must match valid domain format

### Referential Integrity

- All relationship tables use CASCADE DELETE
- Foreign key constraints ensure data consistency
- Unique constraints prevent duplicates where needed

## Query Patterns

### Vector Similarity Search

```sql
-- Find similar events by embedding
SELECT e.*, e.embedding <=> $1 AS distance
FROM events e
ORDER BY e.embedding <=> $1
LIMIT 10;
```

### Full-Text Search

```sql
-- Text search across event fields
SELECT e.*
FROM events e
WHERE to_tsvector('english', coalesce(e.name, '') || ' ' || coalesce(e.description, '')) @@ plainto_tsquery('english', $1);
```

### Complex Relationship Queries

```sql
-- Events by speaker with high confidence
SELECT e.*, s.name as speaker_name, es.role
FROM events e
JOIN event_speakers es ON e.id = es.event_id
JOIN speakers s ON es.speaker_id = s.id
WHERE s.confidence_score > 0.8
AND es.extraction_confidence > 0.7;
```

## Migration Strategy

### File Naming Convention

- `001_initial_schema.sql` - Forward migration
- `001_initial_schema_rollback.sql` - Rollback migration
- `002_feature_name.sql` - Next migration
- `002_feature_name_rollback.sql` - Next rollback

### Cross-Service Compatibility

The schema is designed to work with both:

- **Hono Service**: Using Drizzle ORM for TypeScript
- **Elixir Service**: Using Ecto for complex queries

### Production Deployment

1. Test migrations in staging environment
2. Run schema validation scripts
3. Execute with transaction rollback capability
4. Verify foreign key constraints
5. Test performance with sample data

## AGE Graph Database Integration

The schema integrates with AGE for graph relationship queries:

```sql
-- Initialize AGE graph
CREATE EXTENSION IF NOT EXISTS age;
LOAD 'age';
SET search_path = ag_catalog, "$user", public;
SELECT create_graph('event_network');
```

This enables advanced relationship queries beyond standard SQL joins.

## Monitoring and Maintenance

### Performance Monitoring

- Track vector search query performance
- Monitor full-text search usage
- Watch for slow queries on relationship joins
- Analyze index usage patterns

### Data Quality Monitoring

- Monitor confidence score distributions
- Track data quality score trends
- Identify events with low extraction confidence
- Regular deduplication validation

## Future Considerations

### Potential Extensions

- User preferences and recommendations
- Event attendance tracking
- Speaker rating systems
- Advanced AI/ML feature columns

### Scaling Considerations

- Partition large tables by date
- Consider read replicas for analytics
- Monitor vector index performance with growth
- Implement archival strategy for old events