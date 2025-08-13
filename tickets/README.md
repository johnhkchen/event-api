# Event API Development Tickets

This directory contains detailed development specifications organized by concurrent development streams for the Event Data API project.

## Project Overview

Multi-service event data API providing structured access to scraped and processed event information through vector search, graph relationships, and traditional queries.

**Architecture**: Microservices with clear separation of concerns
- **Hono Service**: Web scraping, basic CRUD, user-facing API  
- **Elixir Service**: Complex data processing, relationships, graph queries  
- **Database**: PostgreSQL with pgvector + AGE extensions  

## Development Streams

### 🏗️ Stream 1: Database Foundation (`01_database_foundation/`)
**Priority**: P0 - Critical Foundation  
**Owner**: Database/DevOps Team  
**Timeline**: 2-3 sprints  

Foundation layer providing database schema, extensions, and infrastructure required for all other development streams.

**Key Components**:
- PostgreSQL with pgvector and AGE extensions
- Complete schema with relationships and indexes
- Docker Compose development environment
- Migration framework
- Performance optimization

**Blocks**: All other development streams  

---

### 🌐 Stream 2: Hono API Service (`02_hono_api_service/`)
**Priority**: P1 - High  
**Owner**: Frontend/API Team  
**Timeline**: 3-4 sprints  

User-facing API service providing web scraping, event CRUD operations, and search functionality.

**Key Components**:
- Hono TypeScript framework setup
- Web scraping system (Playwright)
- Public API endpoints
- Search and discovery
- Batch operations
- Integration with Elixir service

**Depends On**: Database foundation  
**Integrates With**: Elixir processing service  

---

### ⚡ Stream 3: Elixir Processing (`03_elixir_processing/`)
**Priority**: P1 - High  
**Owner**: Backend/Data Processing Team  
**Timeline**: 4-5 sprints  

Intelligent data processing engine providing complex event processing, relationships, and graph queries.

**Key Components**:
- Phoenix/Elixir service with OTP supervision
- Event processing pipeline
- BAML integration for data extraction
- Deduplication engine
- Graph relationship building
- Recommendation engine
- Data quality assessment

**Depends On**: Database foundation  
**Integrates With**: Hono API service, BAML service  

---

### 🔗 Stream 4: Integration & Testing (`04_integration/`)
**Priority**: P1 - High  
**Owner**: DevOps/Integration Team  
**Timeline**: 2-3 sprints  

System-wide integration, testing, and production readiness validation.

**Key Components**:
- Service communication testing
- End-to-end workflow validation
- Performance and load testing
- Deployment pipeline
- Monitoring and observability
- Production readiness

**Depends On**: All foundation streams  
**Enables**: Production deployment  

## Git Worktree Strategy

### Recommended Worktree Setup
```bash
# Create worktrees for parallel development
git worktree add ../event-api-database feature/database-infrastructure
git worktree add ../event-api-hono feature/hono-api-service  
git worktree add ../event-api-elixir feature/elixir-processing-service
git worktree add ../event-api-integration feature/integration-testing
```

### Development Sequence
1. **Database Foundation** (Start first) - Provides shared schema
2. **Hono + Elixir** (Parallel development) - Independent after database ready
3. **Integration** (Final validation) - System-wide testing and deployment

### Merge Strategy
1. Database foundation merges first to `main`
2. Hono and Elixir merge independently after database
3. Integration testing validates cross-service communication
4. Production deployment after integration validation

## Ticket Structure

Each stream contains:
- **Epic Overview**: Business value, objectives, dependencies
- **Detailed Tickets**: Individual features with acceptance criteria
- **Implementation Details**: Code examples and technical guidance
- **Testing Strategy**: Unit, integration, and performance tests
- **Definition of Done**: Clear completion criteria

### Ticket Naming Convention
- **Epic IDs**: `[SERVICE]-EPIC-[NUMBER]` (e.g., `DB-EPIC-001`)
- **Feature IDs**: `[SERVICE]-FEAT-[NUMBER]` (e.g., `HONO-FEAT-003`)
- **Task IDs**: `[SERVICE]-TASK-[NUMBER]` (e.g., `ELIXIR-TASK-012`)

## Development Tools & Integration

### Recommended Issue Tracking
- **GitHub Issues** with service-specific labels
- **GitHub Projects** for cross-service coordination
- **Linear Integration** for enhanced project management

### Service Labels
```
hono-service, elixir-service, database, infrastructure
feature, bugfix, enhancement, performance
P0-critical, P1-high, P2-medium, P3-low
cross-service, api-change, breaking-change
```

### CI/CD Integration
- Automated ticket updates on PR events
- Service-specific build pipelines
- Cross-service integration testing
- Deployment automation with Coolify

## Getting Started

1. **Review Project Spec**: Read `../spec.md` for system overview
2. **Choose Development Stream**: Select based on team expertise
3. **Set Up Worktree**: Create dedicated branch for your stream
4. **Follow Ticket Order**: Start with P0 foundation tickets
5. **Coordinate Integration**: Regular cross-team synchronization

## Documentation Standards

- **Implementation Notes**: Update tickets with implementation details
- **Architecture Decisions**: Document in `docs/architecture-decisions/`
- **API Documentation**: Maintain OpenAPI specs
- **Deployment Guides**: Keep infrastructure docs current

---

**Next Steps**: Review individual stream specifications and begin development according to priority and dependencies.