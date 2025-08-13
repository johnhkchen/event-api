# Hono API Service & Web Scraping - Stream 2

**Epic ID**: HONO-EPIC-001  
**Priority**: P1 - High (Core user-facing functionality)  
**Estimated Effort**: 3-4 sprints  
**Owner**: Frontend/API Team  

## Business Value & Objectives

Build the user-facing API service using Hono framework, providing web scraping capabilities, event CRUD operations, and search functionality for the Event Data API platform.

## Epic Acceptance Criteria

- [ ] Hono TypeScript service operational with all core endpoints
- [ ] Web scraping system functional for Lu.ma events
- [ ] Public API endpoints for event discovery and search
- [ ] Batch operations for bulk event processing
- [ ] Authentication and rate limiting implemented
- [ ] Integration with Elixir processing service
- [ ] API documentation and testing complete

## Service Dependencies

**Depends On**: Database foundation (DB-EPIC-001)  
**Integrates With**: Elixir processing service  
**Blocks**: Frontend client development  

---

## Tickets Breakdown

### HONO-FEAT-001: Project Setup & Core Framework
**Priority**: P0 | **Effort**: 2-3 days | **Type**: Foundation

#### Description
Initialize Hono TypeScript project with proper structure, dependencies, and development environment.

#### Acceptance Criteria
- [ ] Hono project scaffolded with TypeScript
- [ ] Development server with hot reload
- [ ] ESLint + Prettier configuration
- [ ] Testing framework setup (Vitest)
- [ ] Docker containerization
- [ ] Basic health check endpoint

#### Implementation Details
```typescript
// Project structure
hono-service/
├── src/
│   ├── routes/
│   ├── lib/
│   ├── types/
│   ├── middleware/
│   └── index.ts
├── tests/
├── Dockerfile
└── package.json
```

#### Key Dependencies
```json
{
  "dependencies": {
    "hono": "^4.0.0",
    "drizzle-orm": "^0.29.0",
    "drizzle-kit": "^0.20.0",
    "@hono/node-server": "^1.8.0",
    "playwright": "^1.40.0"
  }
}
```

---

### HONO-FEAT-002: Database Integration with Drizzle
**Priority**: P0 | **Effort**: 3-4 days | **Type**: Data Layer

#### Description
Set up Drizzle ORM integration with PostgreSQL database for simple CRUD operations and queries.

#### Acceptance Criteria
- [ ] Drizzle schema definitions match database
- [ ] Connection pooling configured
- [ ] Basic CRUD operations functional
- [ ] Migration integration with database team
- [ ] Type-safe query patterns established

#### Implementation Details
```typescript
// drizzle/schema.ts
export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  date: date('date'),
  location: text('location'),
  lumaUrl: text('luma_url').unique(),
  rawHtml: text('raw_html'),
  extractedData: jsonb('extracted_data'),
  embedding: vector('embedding', { dimensions: 1536 }),
  dataQualityScore: integer('data_quality_score').default(0),
  scrapedAt: timestamp('scraped_at').defaultNow(),
  processedAt: timestamp('processed_at'),
  createdAt: timestamp('created_at').defaultNow()
});
```

---

### HONO-FEAT-003: Web Scraping Engine
**Priority**: P1 | **Effort**: 5-7 days | **Type**: Core Feature

#### Description
Implement robust web scraping system for Lu.ma events using Playwright with retry logic and anti-detection measures.

#### Acceptance Criteria
- [ ] Playwright browser automation setup
- [ ] Lu.ma event page parsing
- [ ] Retry logic for failed scrapes
- [ ] User agent rotation
- [ ] Rate limiting compliance
- [ ] HTML sanitization and storage

#### Implementation Details
```typescript
// POST /api/scrape/luma
app.post('/api/scrape/luma', async (c) => {
  const { url } = await c.req.json()
  
  try {
    // 1. Validate Lu.ma URL
    if (!isValidLumaUrl(url)) {
      return c.json({ error: 'Invalid Lu.ma URL' }, 400)
    }
    
    // 2. Scrape with retries
    const html = await scrapeWithRetries(url, {
      maxRetries: 3,
      userAgentRotation: true,
      stealth: true
    })
    
    // 3. Store raw event
    const [event] = await db.insert(events).values({
      lumaUrl: url,
      rawHtml: html,
      scrapedAt: new Date()
    }).returning()
    
    // 4. Queue for processing
    await queueForProcessing(event.id, html, url)
    
    return c.json({ 
      eventId: event.id, 
      status: 'queued_for_processing' 
    })
  } catch (error) {
    return c.json({ error: 'Scraping failed' }, 500)
  }
})
```

#### Scraping Strategy
- Residential proxy rotation
- Browser fingerprint randomization
- Request timing randomization
- Graceful failure handling

---

### HONO-FEAT-004: Event CRUD API Endpoints
**Priority**: P1 | **Effort**: 4-5 days | **Type**: API

#### Description
Implement core CRUD operations and event discovery endpoints with filtering, pagination, and search.

#### Acceptance Criteria
- [ ] GET /api/events with filtering and pagination
- [ ] GET /api/events/:id with related data
- [ ] POST /api/events for manual event creation
- [ ] PUT /api/events/:id for updates
- [ ] DELETE /api/events/:id with cascading
- [ ] Query parameter validation
- [ ] Response formatting standardized

#### API Endpoints Design
```typescript
// GET /api/events
app.get('/api/events', async (c) => {
  const {
    location,
    topics,
    dateAfter,
    dateBefore,
    page = 1,
    limit = 20
  } = c.req.query()
  
  const events = await db.select()
    .from(eventsTable)
    .where(
      and(
        location ? ilike(eventsTable.location, `%${location}%`) : undefined,
        dateAfter ? gte(eventsTable.date, dateAfter) : undefined,
        dateBefore ? lte(eventsTable.date, dateBefore) : undefined
      )
    )
    .limit(limit)
    .offset((page - 1) * limit)
  
  return c.json({
    events,
    pagination: {
      page,
      limit,
      total: await getEventsCount(filters)
    }
  })
})

// GET /api/events/:id
app.get('/api/events/:id', async (c) => {
  const eventId = c.req.param('id')
  
  const event = await db.select()
    .from(eventsTable)
    .leftJoin(eventSpeakers, eq(eventsTable.id, eventSpeakers.eventId))
    .leftJoin(speakers, eq(eventSpeakers.speakerId, speakers.id))
    .where(eq(eventsTable.id, eventId))
  
  if (!event.length) {
    return c.json({ error: 'Event not found' }, 404)
  }
  
  return c.json(formatEventWithRelations(event))
})
```

---

### HONO-FEAT-005: Search & Discovery API
**Priority**: P1 | **Effort**: 3-4 days | **Type**: Search

#### Description
Implement text search, vector similarity search, and event recommendation endpoints.

#### Acceptance Criteria
- [ ] Text search using PostgreSQL full-text search
- [ ] Vector similarity search for event recommendations
- [ ] Search result ranking and scoring
- [ ] Search query optimization
- [ ] Similar events endpoint

#### Implementation Details
```typescript
// GET /api/events/search
app.get('/api/events/search', async (c) => {
  const { q, embedding, limit = 10 } = c.req.query()
  
  let results
  
  if (embedding) {
    // Vector similarity search
    results = await db.execute(sql`
      SELECT *, (embedding <=> ${embedding}::vector) as distance
      FROM events
      WHERE embedding IS NOT NULL
      ORDER BY distance
      LIMIT ${limit}
    `)
  } else if (q) {
    // Text search
    results = await db.select()
      .from(eventsTable)
      .where(
        sql`to_tsvector('english', name || ' ' || description) @@ plainto_tsquery('english', ${q})`
      )
      .limit(limit)
  }
  
  return c.json({ results })
})
```

---

### HONO-FEAT-006: Batch Operations API
**Priority**: P2 | **Effort**: 3-4 days | **Type**: Bulk Operations

#### Description
Implement batch endpoints for bulk scraping, processing, and data management operations.

#### Acceptance Criteria
- [ ] POST /api/events/batch/scrape for multiple URLs
- [ ] POST /api/events/batch/process for reprocessing
- [ ] Bulk validation and error handling
- [ ] Progress tracking for long operations
- [ ] Rate limiting for batch operations

#### Implementation Details
```typescript
// POST /api/events/batch/scrape
app.post('/api/events/batch/scrape', async (c) => {
  const { urls } = await c.req.json()
  
  if (!Array.isArray(urls) || urls.length > 50) {
    return c.json({ error: 'Invalid URLs array' }, 400)
  }
  
  const batchId = generateBatchId()
  const results = []
  
  for (const url of urls) {
    try {
      const result = await processSingleUrl(url)
      results.push({ url, status: 'success', eventId: result.id })
    } catch (error) {
      results.push({ url, status: 'failed', error: error.message })
    }
  }
  
  return c.json({
    batchId,
    results,
    summary: {
      total: urls.length,
      successful: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'failed').length
    }
  })
})
```

---

### HONO-FEAT-007: Elixir Service Integration
**Priority**: P1 | **Effort**: 2-3 days | **Type**: Integration

#### Description
Implement HTTP client for communicating with Elixir processing service for event processing and complex queries.

#### Acceptance Criteria
- [ ] HTTP client configuration for Elixir service
- [ ] Event processing queue integration
- [ ] Graph query proxy endpoints
- [ ] Error handling and retries
- [ ] Service health checking

#### Implementation Details
```typescript
class ElixirServiceClient {
  private baseUrl: string
  
  async queueEventForProcessing(eventId: string, html: string, url: string) {
    return await fetch(`${this.baseUrl}/internal/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: eventId, html, url })
    })
  }
  
  async getEventRecommendations(eventId: string, limit: number = 5) {
    return await fetch(`${this.baseUrl}/internal/recommend/events?event_id=${eventId}&limit=${limit}`)
  }
  
  async queryEventGraph(query: string) {
    return await fetch(`${this.baseUrl}/internal/graph/query`, {
      method: 'POST',
      body: JSON.stringify({ query })
    })
  }
}
```

---

### HONO-FEAT-008: Authentication & Rate Limiting
**Priority**: P2 | **Effort**: 3-4 days | **Type**: Security

#### Description
Implement API authentication, rate limiting, and basic security middleware for the public API.

#### Acceptance Criteria
- [ ] API key authentication system
- [ ] Rate limiting by IP and API key
- [ ] CORS configuration
- [ ] Request logging middleware
- [ ] Input validation and sanitization

#### Middleware Implementation
```typescript
// Rate limiting middleware
app.use('*', rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  keyGenerator: (c) => c.req.header('x-api-key') || c.env.ip
}))

// Authentication middleware
app.use('/api/*', async (c, next) => {
  const apiKey = c.req.header('x-api-key')
  
  if (!apiKey || !await validateApiKey(apiKey)) {
    return c.json({ error: 'Invalid API key' }, 401)
  }
  
  c.set('apiKey', apiKey)
  await next()
})
```

---

## Testing Strategy

### Unit Tests
- Route handlers with mocked dependencies
- Drizzle query builders
- Scraping utility functions
- Validation logic

### Integration Tests
- Database CRUD operations
- Elixir service communication
- End-to-end scraping workflows
- Authentication flows

### Performance Tests
- API endpoint response times
- Concurrent scraping operations
- Database query performance
- Rate limiting behavior

## Definition of Done

- [ ] All API endpoints functional and documented
- [ ] Web scraping system operational
- [ ] Database integration complete
- [ ] Elixir service integration working
- [ ] Security middleware implemented
- [ ] Comprehensive test coverage (>80%)
- [ ] Docker container deployable
- [ ] API documentation published