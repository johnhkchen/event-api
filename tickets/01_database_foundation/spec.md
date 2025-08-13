# Database Foundation & Infrastructure - Stream 1

**Epic ID**: DB-EPIC-001  
**Priority**: P0 - Critical (Foundation for all other streams)  
**Estimated Effort**: 2-3 sprints  
**Owner**: Database/DevOps Team  

## Business Value & Objectives

Establish the foundational database schema and infrastructure required for the Event Data API, enabling concurrent development of Hono and Elixir services.

## Epic Acceptance Criteria

- [ ] PostgreSQL database with pgvector and AGE extensions operational
- [ ] Complete schema with all tables, relationships, and indexes
- [ ] Docker Compose environment for local development
- [ ] Database migrations framework established
- [ ] Basic monitoring and logging configured
- [ ] Seed data and testing utilities available
- [ ] Performance benchmarks established

## Service Dependencies

**Blocks**: All Hono and Elixir development tickets  
**Prerequisites**: None (foundation layer)  
**Integration Points**: Database connection from both Hono and Elixir services  

---

## Tickets Breakdown

### DB-FEAT-001: PostgreSQL Setup with Extensions
**Priority**: P0 | **Effort**: 3-5 days | **Type**: Infrastructure

#### Description
Set up PostgreSQL database with required extensions (pgvector for embeddings, AGE for graph queries) and configure for local development and production deployment.

#### Acceptance Criteria
- [ ] PostgreSQL 15+ running with pgvector extension
- [ ] AGE extension installed and configured
- [ ] Database accessible from Docker containers
- [ ] Connection pooling configured
- [ ] Basic backup strategy implemented

#### Implementation Details
```sql
-- Required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgvector";
CREATE EXTENSION IF NOT EXISTS "age";
LOAD 'age';
SET search_path = ag_catalog, "$user", public;
SELECT create_graph('event_network');
```

#### Testing Strategy
- Connection tests from multiple containers
- Extension functionality verification
- Performance baseline measurements

---

### DB-FEAT-002: Core Schema Implementation
**Priority**: P0 | **Effort**: 5-7 days | **Type**: Schema

#### Description
Implement the complete database schema for events, speakers, companies, topics, and their relationships as specified in the main spec.

#### Acceptance Criteria
- [ ] All tables created with proper constraints
- [ ] Foreign key relationships established
- [ ] Indexes optimized for query patterns
- [ ] Vector column configured for embeddings
- [ ] Data validation rules implemented

#### Implementation Details
```sql
-- Core tables from spec.md
-- events, speakers, companies, topics
-- event_speakers, event_companies, event_topics
-- Proper indexing strategy for performance
```

#### Schema Validation
- [ ] All foreign keys functional
- [ ] Unique constraints prevent duplicates
- [ ] Vector operations performant
- [ ] Graph queries functional via AGE

---

### DB-FEAT-003: Migration Framework
**Priority**: P1 | **Effort**: 2-3 days | **Type**: Tooling

#### Description
Establish database migration framework supporting both Hono (Drizzle) and Elixir (Ecto) migration patterns.

#### Acceptance Criteria
- [ ] Migration numbering scheme established
- [ ] Rollback capabilities tested
- [ ] Cross-service migration coordination
- [ ] Development seed data migrations
- [ ] Production migration strategy documented

---

### DB-FEAT-004: Docker Compose Environment
**Priority**: P0 | **Effort**: 3-4 days | **Type**: Infrastructure

#### Description
Complete Docker Compose configuration for local development with all services, networking, and volume management.

#### Acceptance Criteria
- [ ] All services defined and networked
- [ ] Persistent data volumes configured
- [ ] Environment variable management
- [ ] Health checks for all containers
- [ ] Development vs production configurations

#### Docker Compose Structure
```yaml
services:
  db:
    image: pgvector/pgvector:pg15
    # Configuration for pgvector + AGE
  
  hono-api:
    build: ./hono-service
    depends_on: [db]
  
  elixir-service:
    build: ./elixir-service
    depends_on: [db]
  
  baml-service:
    build: ./baml-service
```

---

### DB-FEAT-005: Performance Optimization
**Priority**: P1 | **Effort**: 3-4 days | **Type**: Performance

#### Description
Implement indexing strategy and query optimization for expected access patterns from both Hono and Elixir services.

#### Acceptance Criteria
- [ ] Indexes on all foreign keys
- [ ] Vector similarity search optimized
- [ ] Text search indexes (GIN)
- [ ] Composite indexes for common queries
- [ ] Query performance benchmarks established

#### Index Strategy
```sql
-- Vector similarity
CREATE INDEX idx_events_embedding ON events USING ivfflat (embedding vector_cosine_ops);

-- Text search
CREATE INDEX idx_events_fts ON events USING gin(to_tsvector('english', name || ' ' || description));

-- Relationship queries
CREATE INDEX idx_event_speakers_event ON event_speakers(event_id);
CREATE INDEX idx_event_speakers_speaker ON event_speakers(speaker_id);
```

---

### DB-FEAT-006: Monitoring & Observability
**Priority**: P2 | **Effort**: 2-3 days | **Type**: Observability

#### Description
Set up database monitoring, slow query logging, and observability for production deployment.

#### Acceptance Criteria
- [ ] Slow query logging configured
- [ ] Connection monitoring
- [ ] Disk usage alerts
- [ ] Performance metrics collection
- [ ] Log aggregation setup

---

## Cross-Service Integration Points

### For Hono Service
```typescript
// Database connection configuration
DATABASE_URL=postgresql://user:pass@db:5432/events

// Drizzle schema alignment
// Query patterns for API endpoints
```

### For Elixir Service
```elixir
# Ecto configuration
config :event_api, EventAPI.Repo,
  url: System.get_env("DATABASE_URL")

# Schema definitions
# Complex query patterns
```

## Testing Strategy

### Unit Tests
- Migration scripts validation
- Schema constraint testing
- Index performance validation

### Integration Tests
- Multi-service database access
- Transaction isolation testing
- Connection pool behavior

### Performance Tests
- Vector similarity search benchmarks
- Complex query performance
- Concurrent access patterns

## Definition of Done

- [ ] All tables and relationships functional
- [ ] Both Hono and Elixir can connect and query
- [ ] Migrations work in both directions
- [ ] Performance meets baseline requirements
- [ ] Documentation complete and updated
- [ ] Local development environment fully functional