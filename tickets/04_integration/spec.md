# Integration & System Testing - Stream 4

**Epic ID**: INTEGRATION-EPIC-001  
**Priority**: P1 - High (System validation and deployment readiness)  
**Estimated Effort**: 2-3 sprints  
**Owner**: DevOps/Integration Team  

## Business Value & Objectives

Ensure seamless integration between all services (Hono API, Elixir Processing, Database, BAML), validate system-wide functionality, and prepare for production deployment with comprehensive testing and monitoring.

## Epic Acceptance Criteria

- [ ] All services communicate correctly via HTTP APIs
- [ ] End-to-end workflows functional (scraping → processing → storage → retrieval)
- [ ] Performance benchmarks met under realistic load
- [ ] Deployment pipeline operational with Coolify
- [ ] Monitoring and observability systems functional
- [ ] Comprehensive integration test suite
- [ ] Production readiness checklist complete

## Service Dependencies

**Depends On**: All foundation epics (DB-EPIC-001, HONO-EPIC-001, ELIXIR-EPIC-001)  
**Prerequisites**: Individual service functionality verified  
**Enables**: Production deployment and user onboarding  

---

## Tickets Breakdown

### INTEGRATION-FEAT-001: Service Communication Testing
**Priority**: P0 | **Effort**: 3-4 days | **Type**: Integration Testing

#### Description
Validate HTTP communication between Hono API service and Elixir processing service with comprehensive error handling and retry logic.

#### Acceptance Criteria
- [ ] Hono → Elixir processing requests functional
- [ ] Elixir → BAML service communication working
- [ ] Error handling and timeout scenarios tested
- [ ] Retry logic validation under failure conditions
- [ ] Service health check integration
- [ ] Request/response logging and monitoring

#### Test Scenarios
```typescript
// Integration test examples
describe('Hono → Elixir Integration', () => {
  test('event processing pipeline', async () => {
    // 1. Scrape event via Hono API
    const scrapeResponse = await fetch('/api/scrape/luma', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://lu.ma/test-event' })
    })
    
    const { eventId } = await scrapeResponse.json()
    
    // 2. Verify processing queued in Elixir
    await waitForProcessingComplete(eventId)
    
    // 3. Validate processed data in database
    const event = await db.query('SELECT * FROM events WHERE id = ?', [eventId])
    expect(event.processed_at).toBeTruthy()
    expect(event.extracted_data).toBeTruthy()
  })

  test('service failure recovery', async () => {
    // Simulate Elixir service down
    await stopElixirService()
    
    // Attempt scraping - should handle gracefully
    const response = await fetch('/api/scrape/luma', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://lu.ma/test-event' })
    })
    
    expect(response.status).toBe(503)
    
    // Restart service and verify processing resumes
    await startElixirService()
    await verifyProcessingResumes()
  })
})
```

---

### INTEGRATION-FEAT-002: End-to-End Workflow Testing
**Priority**: P0 | **Effort**: 4-5 days | **Type**: E2E Testing

#### Description
Implement comprehensive end-to-end tests covering complete user workflows from scraping to data retrieval and analysis.

#### Acceptance Criteria
- [ ] Complete scraping → processing → storage → retrieval workflow
- [ ] Search and discovery functionality across services
- [ ] Batch operations end-to-end testing
- [ ] Graph queries and recommendations testing
- [ ] Data quality assessment workflow
- [ ] Performance under realistic data volumes

#### E2E Test Framework
```bash
# Test framework structure
tests/e2e/
├── fixtures/
│   ├── sample_luma_events.json
│   ├── expected_extracted_data.json
│   └── test_user_scenarios.json
├── workflows/
│   ├── event_discovery.spec.js
│   ├── batch_processing.spec.js
│   ├── recommendation_flow.spec.js
│   └── data_quality.spec.js
├── utils/
│   ├── test_data_generator.js
│   ├── service_helpers.js
│   └── assertion_helpers.js
└── setup/
    ├── test_environment.js
    └── cleanup.js
```

#### Key Workflow Tests
```javascript
// Event Discovery Workflow
describe('Event Discovery E2E', () => {
  test('user searches and finds relevant events', async () => {
    // 1. Seed database with test events
    await seedTestEvents()
    
    // 2. Search for events
    const searchResponse = await api.get('/api/events/search?q=AI hackathon')
    expect(searchResponse.data.results).toHaveLength(3)
    
    // 3. Get event details
    const eventId = searchResponse.data.results[0].id
    const eventDetails = await api.get(`/api/events/${eventId}`)
    
    // 4. Verify relationships populated
    expect(eventDetails.data.speakers).toBeDefined()
    expect(eventDetails.data.companies).toBeDefined()
    
    // 5. Get recommendations
    const recommendations = await api.get(`/api/events/${eventId}/similar`)
    expect(recommendations.data.events).toHaveLength(5)
  })
})
```

---

### INTEGRATION-FEAT-003: Performance & Load Testing
**Priority**: P1 | **Effort**: 4-5 days | **Type**: Performance

#### Description
Conduct comprehensive performance testing under realistic load conditions to validate system scalability and identify bottlenecks.

#### Acceptance Criteria
- [ ] Concurrent scraping operations (10+ simultaneous)
- [ ] Database query performance under load
- [ ] API response time benchmarks met (<200ms p95)
- [ ] Processing pipeline throughput measured
- [ ] Memory and CPU usage profiling
- [ ] Load balancing and auto-scaling validation

#### Load Testing Strategy
```yaml
# Artillery.js load testing configuration
config:
  target: 'http://localhost:3000'
  phases:
    - duration: 60
      arrivalRate: 5
      name: "Warm up"
    - duration: 120
      arrivalRate: 20
      name: "Normal load"
    - duration: 60
      arrivalRate: 50
      name: "Peak load"

scenarios:
  - name: "Event API Load Test"
    flow:
      - get:
          url: "/api/events"
          capture:
            - json: "$.events[0].id"
              as: "eventId"
      - get:
          url: "/api/events/{{ eventId }}"
      - get:
          url: "/api/events/search?q=AI"
      - post:
          url: "/api/scrape/luma"
          json:
            url: "https://lu.ma/test-{{ $randomString() }}"
```

#### Performance Benchmarks
- **API Response Times**: 
  - GET /api/events: <100ms p95
  - GET /api/events/:id: <150ms p95
  - POST /api/scrape/luma: <5s p95 (including processing queue)
- **Throughput**: 100+ concurrent API requests
- **Processing**: 10+ events processed per minute
- **Database**: <50ms for simple queries, <500ms for complex graph queries

---

### INTEGRATION-FEAT-004: Docker Compose & Deployment Testing
**Priority**: P1 | **Effort**: 3-4 days | **Type**: DevOps

#### Description
Validate complete Docker Compose setup, deployment procedures, and infrastructure configuration for both development and production environments.

#### Acceptance Criteria
- [ ] Docker Compose brings up all services correctly
- [ ] Service discovery and networking functional
- [ ] Volume persistence working across restarts
- [ ] Environment variable configuration tested
- [ ] Health checks and service dependencies working
- [ ] Coolify deployment pipeline functional

#### Deployment Validation
```bash
#!/bin/bash
# deployment_validation.sh

echo "Starting deployment validation..."

# 1. Build and start all services
docker-compose build
docker-compose up -d

# 2. Wait for services to be healthy
echo "Waiting for services to be ready..."
timeout 300 bash -c '
  while ! curl -f http://localhost:3000/health > /dev/null 2>&1; do
    echo "Waiting for Hono service..."
    sleep 5
  done
'

timeout 300 bash -c '
  while ! curl -f http://localhost:4000/health > /dev/null 2>&1; do
    echo "Waiting for Elixir service..."
    sleep 5
  done
'

# 3. Test database connectivity
docker-compose exec db psql -U user -d events -c "SELECT version();"

# 4. Run integration tests
npm run test:integration

# 5. Test sample workflow
curl -X POST http://localhost:3000/api/scrape/luma \
  -H "Content-Type: application/json" \
  -d '{"url": "https://lu.ma/sample-event"}'

echo "Deployment validation complete!"
```

---

### INTEGRATION-FEAT-005: Monitoring & Observability Setup
**Priority**: P1 | **Effort**: 3-4 days | **Type**: Observability

#### Description
Implement comprehensive monitoring, logging, and observability stack for production deployment and ongoing system health monitoring.

#### Acceptance Criteria
- [ ] Application metrics collection (Prometheus/Grafana)
- [ ] Centralized logging aggregation
- [ ] Error tracking and alerting
- [ ] Performance monitoring dashboards
- [ ] Database monitoring and slow query tracking
- [ ] Custom business metrics tracking

#### Monitoring Stack
```yaml
# monitoring/docker-compose.yml
version: '3.8'
services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      
  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana-storage:/var/lib/grafana
      
  loki:
    image: grafana/loki:latest
    ports:
      - "3100:3100"
    volumes:
      - ./loki-config.yml:/etc/loki/local-config.yaml
      
volumes:
  grafana-storage:
```

#### Metrics Collection
```typescript
// Hono service metrics
import { metrics } from './lib/metrics'

app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  const duration = Date.now() - start
  
  metrics.httpRequestDuration.observe(
    { method: c.req.method, route: c.req.path, status: c.res.status },
    duration
  )
})

// Custom business metrics
metrics.eventsScraped.inc({ source: 'luma' })
metrics.processingQueueLength.set(queue.length)
```

---

### INTEGRATION-FEAT-006: Data Migration & Seeding
**Priority**: P2 | **Effort**: 2-3 days | **Type**: Data Management

#### Description
Create data migration tools and seed data sets for testing, development, and production initialization.

#### Acceptance Criteria
- [ ] Test data generation scripts
- [ ] Production data migration tools
- [ ] Data validation and integrity checks
- [ ] Rollback procedures for failed migrations
- [ ] Performance impact assessment for large migrations

#### Data Management Tools
```elixir
defmodule EventAPI.DataMigration do
  @moduledoc """
  Tools for data migration and seeding
  """
  
  def seed_test_data do
    # Create sample events with full relationship graph
    events = create_sample_events(50)
    speakers = create_sample_speakers(200)
    companies = create_sample_companies(100)
    
    # Build relationships
    build_event_relationships(events, speakers, companies)
    
    # Generate embeddings for vector search
    generate_embeddings(events)
    
    Logger.info("Test data seeding complete")
  end
  
  def migrate_legacy_data(source_file) do
    source_file
    |> File.stream!()
    |> Stream.map(&Jason.decode!/1)
    |> Stream.chunk_every(100)
    |> Enum.each(&process_legacy_batch/1)
  end
end
```

---

### INTEGRATION-FEAT-007: Production Readiness Checklist
**Priority**: P1 | **Effort**: 2-3 days | **Type**: DevOps

#### Description
Complete production readiness assessment covering security, performance, monitoring, backup, and operational procedures.

#### Acceptance Criteria
- [ ] Security audit and vulnerability assessment
- [ ] SSL/TLS configuration and testing
- [ ] Backup and disaster recovery procedures
- [ ] Capacity planning and auto-scaling configuration
- [ ] Operational runbooks and documentation
- [ ] Incident response procedures

#### Production Checklist
```markdown
## Security
- [ ] API rate limiting configured
- [ ] Authentication and authorization working
- [ ] SSL certificates valid and automated renewal
- [ ] Database connections encrypted
- [ ] Secrets management via environment variables
- [ ] Network security groups configured

## Performance
- [ ] Database indexes optimized
- [ ] Connection pooling configured
- [ ] CDN setup for static assets
- [ ] Caching strategies implemented
- [ ] Auto-scaling policies defined

## Monitoring
- [ ] Application metrics collecting
- [ ] Error tracking configured
- [ ] Log aggregation functional
- [ ] Alerting rules defined
- [ ] Dashboard access configured

## Operations
- [ ] Deployment automation tested
- [ ] Rollback procedures documented
- [ ] Health check endpoints working
- [ ] Documentation up to date
- [ ] Team access and permissions configured
```

---

## Cross-Service Validation Matrix

| Feature | Hono API | Elixir Processing | Database | Status |
|---------|----------|------------------|----------|---------|
| Event Scraping | ✅ Scrape & Store | ✅ Process HTML | ✅ Store Raw/Processed | Ready |
| Search & Discovery | ✅ API Endpoints | ✅ Vector/Graph Queries | ✅ Indexes Optimized | Ready |
| Relationships | ✅ API Exposure | ✅ Graph Building | ✅ AGE Integration | Ready |
| Recommendations | ✅ API Endpoints | ✅ ML/Graph Analysis | ✅ Query Optimization | Ready |
| Data Quality | ✅ Quality Metrics | ✅ Scoring Engine | ✅ Quality Tracking | Ready |

## Definition of Done

- [ ] All services integrate seamlessly
- [ ] End-to-end workflows functional
- [ ] Performance benchmarks met
- [ ] Monitoring and alerting operational
- [ ] Production deployment successful
- [ ] Documentation complete
- [ ] Team trained on operations
- [ ] User acceptance testing passed