**Event Data API: Elixir + Hono Hybrid Architecture Specification**

## System Overview

**Product**: Multi-user event data API providing structured access to scraped and processed event information through vector search, graph relationships, and traditional queries.

**Architecture**: Microservices with clear separation of concerns
- **Hono Service**: Web scraping, basic CRUD, user-facing API
- **Elixir Service**: Complex data processing, relationships, graph queries
- **Postgres**: Unified data store with pgvector + AGE extensions

## Service Boundaries

### Hono Service (TypeScript)
**Responsibilities**: External interfaces, scraping, simple operations
```typescript
// Core API endpoints
POST /api/scrape/luma          // Scrape Lu.ma event
GET  /api/events               // List events with filters
GET  /api/events/:id           // Get single event
POST /api/events/batch         // Batch operations
GET  /api/events/search        // Text search
```

**Technology Stack**:
- Hono framework
- Drizzle ORM for simple queries
- Playwright/Puppeteer for scraping
- Deployed via Coolify on NUC

### Elixir Service (Phoenix)
**Responsibilities**: Data processing, relationships, complex queries
```elixir
# Internal processing endpoints
POST /internal/process         # Process scraped HTML
GET  /internal/graph/:query    # Graph relationship queries
POST /internal/deduplicate     # Deduplication workflows
GET  /internal/recommend       # Recommendation engine
```

**Technology Stack**:
- Phoenix framework
- Ecto for complex queries
- GenServer for processing pipelines
- OTP supervision for fault tolerance

## Data Architecture

### Database Schema (Postgres + pgvector + AGE)
```sql
-- Core event storage
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
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Speaker management with deduplication
CREATE TABLE speakers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  normalized_name TEXT,
  company TEXT,
  bio TEXT,
  confidence_score REAL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Event-Speaker relationships
CREATE TABLE event_speakers (
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  speaker_id UUID REFERENCES speakers(id) ON DELETE CASCADE,
  role TEXT, -- 'speaker', 'judge', 'host', 'panelist'
  extraction_confidence REAL DEFAULT 0,
  PRIMARY KEY (event_id, speaker_id, role)
);

-- Company tracking
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  normalized_name TEXT UNIQUE,
  domain TEXT,
  industry TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Event-Company relationships
CREATE TABLE event_companies (
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  relationship_type TEXT, -- 'host', 'sponsor', 'venue', 'partner'
  PRIMARY KEY (event_id, company_id, relationship_type)
);

-- Topic/tag system
CREATE TABLE topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT, -- 'technology', 'industry', 'format'
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE event_topics (
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,
  relevance_score REAL DEFAULT 0,
  PRIMARY KEY (event_id, topic_id)
);

-- AGE graph setup
CREATE EXTENSION IF NOT EXISTS age;
LOAD 'age';
SET search_path = ag_catalog, "$user", public;
SELECT create_graph('event_network');
```

## Processing Pipeline

### 1. Scraping Flow (Hono → Elixir)
```typescript
// Hono: Scrape and queue
app.post('/api/scrape/luma', async (c) => {
  const { url } = await c.req.json()
  
  // 1. Scrape with residential IP
  const html = await scrapeWithRetries(url)
  
  // 2. Store raw event
  const event = await db.insert(events).values({
    luma_url: url,
    raw_html: html,
    scraped_at: new Date()
  }).returning()
  
  // 3. Queue for processing
  await fetch('http://elixir-service:4000/internal/process', {
    method: 'POST',
    body: JSON.stringify({
      event_id: event[0].id,
      html,
      url
    })
  })
  
  return c.json({ 
    event_id: event[0].id, 
    status: 'queued_for_processing' 
  })
})
```

### 2. Processing Flow (Elixir Multi-Agent)
```elixir
defmodule EventProcessor do
  use GenServer
  
  def handle_cast({:process_event, event_id, html, url}, state) do
    try do
      # Multi-step extraction
      result = html
      |> clean_html()
      |> extract_structured_data()
      |> build_relationships()
      |> calculate_quality_score()
      
      # Store processed result
      Events.update_processed_event(event_id, result)
      
      # Broadcast completion
      Phoenix.PubSub.broadcast(
        EventAPI.PubSub, 
        "event_processing", 
        {:event_processed, event_id, result}
      )
      
    rescue
      error -> 
        Events.mark_processing_failed(event_id, error)
    end
    
    {:noreply, state}
  end
  
  defp extract_structured_data(html) do
    # BAML integration via HTTP
    response = HTTPoison.post!(
      "http://baml-service:8080/extract",
      Jason.encode!(%{html: html}),
      [{"Content-Type", "application/json"}]
    )
    
    Jason.decode!(response.body)
  end
  
  defp build_relationships(event_data) do
    # Complex relationship logic
    Task.async_stream([
      {:speakers, event_data.speakers},
      {:companies, event_data.companies}, 
      {:topics, event_data.topics}
    ], &process_entity_type/1, max_concurrency: 3)
    |> Enum.into(%{})
  end
end
```

### 3. Deduplication System
```elixir
defmodule DeduplicationEngine do
  def find_or_create_speaker(name, company \\ nil) do
    normalized = normalize_name(name)
    
    case Speakers.find_by_normalized_name(normalized) do
      nil -> 
        create_speaker_with_confidence(name, normalized, company)
      existing_speaker ->
        update_speaker_confidence(existing_speaker, company)
    end
  end
  
  defp normalize_name(name) do
    name
    |> String.downcase()
    |> String.replace(~r/[^\w\s]/, "")
    |> String.trim()
  end
  
  defp create_speaker_with_confidence(name, normalized, company) do
    confidence = calculate_extraction_confidence(name, company)
    
    Speakers.create(%{
      name: name,
      normalized_name: normalized,
      company: company,
      confidence_score: confidence
    })
  end
end
```

## API Design

### Public API (Hono)
```typescript
// Event discovery and search
GET /api/events?location=SF&topics=AI&date_after=2025-01-01
GET /api/events/:id
GET /api/events/:id/similar
GET /api/events/search?q=machine learning hackathon

// Batch operations
POST /api/events/batch/scrape
POST /api/events/batch/process

// Analytics endpoints
GET /api/stats/events/count
GET /api/stats/topics/trending
GET /api/stats/speakers/active
```

### Internal API (Elixir)
```elixir
# Graph relationship queries
GET /internal/graph/speakers/:id/network
GET /internal/graph/companies/:id/events
GET /internal/graph/events/:id/connections

# Recommendation engine
GET /internal/recommend/events?user_interests=AI,ML&location=SF
GET /internal/recommend/speakers?event_id=123

# Data quality operations
POST /internal/deduplicate/speakers
POST /internal/quality/recalculate
GET /internal/quality/report
```

## Deployment Configuration

### Coolify Docker Compose
```yaml
version: '3.8'
services:
  hono-api:
    build: ./hono-service
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/events
      - ELIXIR_SERVICE_URL=http://elixir-service:4000
      - BAML_SERVICE_URL=http://baml-service:8080
    depends_on:
      - db
      - elixir-service
    restart: unless-stopped
    
  elixir-service:
    build: ./elixir-service
    ports:
      - "4000:4000"
    environment:
      - DATABASE_URL=ecto://user:pass@db:5432/events
      - SECRET_KEY_BASE=your_secret_key
      - PHX_SERVER=true
    depends_on:
      - db
    restart: unless-stopped
    
  baml-service:
    build: ./baml-service
    ports:
      - "8080:8080"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    restart: unless-stopped
    
  db:
    image: pgvector/pgvector:pg15
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: events
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-scripts:/docker-entrypoint-initdb.d
    ports:
      - "5432:5432"
    restart: unless-stopped
    
volumes:
  postgres_data:
```

## Development Workflow

### Project Structure
```
event-data-api/
├── hono-service/
│   ├── src/
│   │   ├── routes/
│   │   ├── lib/
│   │   └── types/
│   ├── Dockerfile
│   └── package.json
├── elixir-service/
│   ├── lib/event_api/
│   │   ├── processing/
│   │   ├── queries/
│   │   └── relationships/
│   ├── Dockerfile
│   └── mix.exs
├── baml-service/
│   ├── schemas/
│   └── main.py
├── init-scripts/
│   └── setup-extensions.sql
└── docker-compose.yml
```

### Monitoring & Observability
- **Phoenix LiveDashboard** for Elixir service monitoring
- **Hono middleware** for API request logging
- **Phoenix telemetry** for processing pipeline metrics
- **Postgres slow query log** for database optimization
