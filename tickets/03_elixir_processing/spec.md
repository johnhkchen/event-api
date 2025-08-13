# Elixir Processing Service & Intelligence Engine - Stream 3

**Epic ID**: ELIXIR-EPIC-001  
**Priority**: P1 - High (Core data processing and intelligence)  
**Estimated Effort**: 4-5 sprints  
**Owner**: Backend/Data Processing Team  

## Business Value & Objectives

Build the intelligent data processing engine using Elixir/Phoenix, providing complex event data processing, relationship extraction, deduplication, graph queries, and recommendation capabilities.

## Epic Acceptance Criteria

- [ ] Phoenix service operational with OTP supervision
- [ ] Event processing pipeline with GenServer workers
- [ ] BAML integration for data extraction from HTML
- [ ] Deduplication engine for speakers, companies, and events
- [ ] Graph relationship building and querying (AGE integration)
- [ ] Recommendation engine for events and speakers
- [ ] Data quality scoring and assessment
- [ ] Internal API for Hono service integration

## Service Dependencies

**Depends On**: Database foundation (DB-EPIC-001)  
**Integrates With**: Hono API service, BAML service  
**Provides**: Internal processing API for Hono consumption  

---

## Tickets Breakdown

### ELIXIR-FEAT-001: Phoenix Project Setup & Architecture
**Priority**: P0 | **Effort**: 3-4 days | **Type**: Foundation

#### Description
Initialize Phoenix project with proper OTP supervision tree, application structure, and development environment.

#### Acceptance Criteria
- [ ] Phoenix 1.7+ project with LiveView
- [ ] OTP supervision tree configured
- [ ] Ecto database integration
- [ ] Development environment with hot reloading
- [ ] Docker containerization
- [ ] Basic health check endpoints

#### Implementation Details
```elixir
# Project structure
elixir-service/
├── lib/event_api/
│   ├── application.ex
│   ├── repo.ex
│   ├── processing/
│   │   ├── event_processor.ex
│   │   ├── dedup_engine.ex
│   │   └── quality_scorer.ex
│   ├── relationships/
│   │   ├── graph_builder.ex
│   │   └── recommender.ex
│   ├── queries/
│   └── schemas/
├── lib/event_api_web/
│   ├── controllers/
│   │   └── internal/
│   └── router.ex
├── test/
├── Dockerfile
└── mix.exs
```

#### Supervision Tree
```elixir
defmodule EventAPI.Application do
  use Application

  def start(_type, _args) do
    children = [
      EventAPI.Repo,
      {Phoenix.PubSub, name: EventAPI.PubSub},
      EventAPIWeb.Endpoint,
      {EventAPI.Processing.EventProcessor, []},
      {EventAPI.Processing.DeduplicationEngine, []},
      {EventAPI.Relationships.GraphBuilder, []}
    ]

    opts = [strategy: :one_for_one, name: EventAPI.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
```

---

### ELIXIR-FEAT-002: Ecto Schema & Database Integration
**Priority**: P0 | **Effort**: 3-4 days | **Type**: Data Layer

#### Description
Set up Ecto schemas, database integration, and migration framework aligned with the database foundation.

#### Acceptance Criteria
- [ ] Ecto schemas for all database tables
- [ ] Associations and relationships configured
- [ ] Custom types for vector and JSONB data
- [ ] Migration generation and management
- [ ] Database connection pooling optimized

#### Implementation Details
```elixir
defmodule EventAPI.Events.Event do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "events" do
    field :name, :string
    field :description, :string
    field :date, :date
    field :location, :string
    field :luma_url, :string
    field :raw_html, :string
    field :extracted_data, :map
    field :embedding, EventAPI.Types.Vector
    field :data_quality_score, :integer, default: 0
    field :scraped_at, :utc_datetime
    field :processed_at, :utc_datetime

    many_to_many :speakers, EventAPI.Events.Speaker, join_through: "event_speakers"
    many_to_many :companies, EventAPI.Events.Company, join_through: "event_companies"
    many_to_many :topics, EventAPI.Events.Topic, join_through: "event_topics"

    timestamps()
  end

  def changeset(event, attrs) do
    event
    |> cast(attrs, [:name, :description, :date, :location, :luma_url, 
                    :raw_html, :extracted_data, :data_quality_score])
    |> validate_required([:name])
    |> unique_constraint(:luma_url)
  end
end
```

---

### ELIXIR-FEAT-003: Event Processing Pipeline
**Priority**: P1 | **Effort**: 5-7 days | **Type**: Core Processing

#### Description
Implement the main event processing pipeline that takes raw HTML from Hono service and extracts structured data using BAML.

#### Acceptance Criteria
- [ ] GenServer-based processing workers
- [ ] BAML integration for HTML data extraction
- [ ] Error handling and retry logic
- [ ] Processing status tracking
- [ ] Phoenix PubSub for real-time updates
- [ ] Processing queue management

#### Implementation Details
```elixir
defmodule EventAPI.Processing.EventProcessor do
  use GenServer
  require Logger

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  def process_event(event_id, html, url) do
    GenServer.cast(__MODULE__, {:process_event, event_id, html, url})
  end

  def handle_cast({:process_event, event_id, html, url}, state) do
    Task.start(fn ->
      try do
        result = html
        |> clean_html()
        |> extract_structured_data()
        |> enrich_with_relationships()
        |> calculate_quality_score()
        
        EventAPI.Events.update_processed_event(event_id, result)
        
        Phoenix.PubSub.broadcast(
          EventAPI.PubSub,
          "event_processing",
          {:event_processed, event_id, result}
        )
        
        Logger.info("Successfully processed event #{event_id}")
      rescue
        error -> 
          Logger.error("Failed to process event #{event_id}: #{inspect(error)}")
          EventAPI.Events.mark_processing_failed(event_id, error)
      end
    end)
    
    {:noreply, state}
  end

  defp extract_structured_data(html) do
    case HTTPoison.post(
      "http://baml-service:8080/extract",
      Jason.encode!(%{html: html}),
      [{"Content-Type", "application/json"}]
    ) do
      {:ok, %HTTPoison.Response{status_code: 200, body: body}} ->
        Jason.decode!(body)
      {:error, error} ->
        raise "BAML extraction failed: #{inspect(error)}"
    end
  end
end
```

---

### ELIXIR-FEAT-004: BAML Integration Service
**Priority**: P1 | **Effort**: 3-4 days | **Type**: AI Integration

#### Description
Build HTTP client integration with BAML service for intelligent data extraction from scraped HTML content.

#### Acceptance Criteria
- [ ] HTTP client for BAML service communication
- [ ] Request/response validation and error handling
- [ ] Retry logic for failed extractions
- [ ] Response caching for identical HTML content
- [ ] Performance monitoring and logging

#### Implementation Details
```elixir
defmodule EventAPI.Services.BAMLClient do
  @moduledoc """
  Client for communicating with BAML data extraction service
  """
  
  use HTTPoison.Base
  require Logger

  @base_url "http://baml-service:8080"
  @timeout 30_000

  def extract_event_data(html) when is_binary(html) do
    case post("/extract", %{html: html}) do
      {:ok, %{"event" => event_data}} ->
        {:ok, parse_event_data(event_data)}
      {:ok, response} ->
        {:error, "Invalid BAML response: #{inspect(response)}"}
      {:error, reason} ->
        {:error, "BAML extraction failed: #{inspect(reason)}"}
    end
  end

  defp post(path, data) do
    case HTTPoison.post(
      @base_url <> path,
      Jason.encode!(data),
      [{"Content-Type", "application/json"}],
      timeout: @timeout,
      recv_timeout: @timeout
    ) do
      {:ok, %HTTPoison.Response{status_code: 200, body: body}} ->
        Jason.decode(body)
      {:ok, %HTTPoison.Response{status_code: status, body: body}} ->
        {:error, "HTTP #{status}: #{body}"}
      {:error, error} ->
        {:error, error}
    end
  end

  defp parse_event_data(data) do
    %{
      name: data["name"],
      description: data["description"],
      date: parse_date(data["date"]),
      location: data["location"],
      speakers: parse_speakers(data["speakers"] || []),
      companies: parse_companies(data["companies"] || []),
      topics: parse_topics(data["topics"] || [])
    }
  end
end
```

---

### ELIXIR-FEAT-005: Deduplication Engine
**Priority**: P1 | **Effort**: 6-8 days | **Type**: Data Quality

#### Description
Implement intelligent deduplication system for speakers, companies, and events using fuzzy matching and confidence scoring.

#### Acceptance Criteria
- [ ] Speaker name normalization and matching
- [ ] Company name deduplication with domain matching
- [ ] Event deduplication based on multiple criteria
- [ ] Confidence scoring for matches
- [ ] Manual review workflow for uncertain matches
- [ ] Batch deduplication operations

#### Implementation Details
```elixir
defmodule EventAPI.Processing.DeduplicationEngine do
  use GenServer
  alias EventAPI.Events.{Speaker, Company, Event}
  
  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  def find_or_create_speaker(name, company \\ nil) do
    GenServer.call(__MODULE__, {:find_or_create_speaker, name, company})
  end

  def handle_call({:find_or_create_speaker, name, company}, _from, state) do
    normalized_name = normalize_name(name)
    
    result = case find_similar_speakers(normalized_name) do
      [] -> 
        create_speaker_with_confidence(name, normalized_name, company)
      similar_speakers ->
        find_best_match(similar_speakers, name, company)
    end
    
    {:reply, result, state}
  end

  defp normalize_name(name) do
    name
    |> String.downcase()
    |> String.replace(~r/[^\w\s]/, "")
    |> String.trim()
    |> String.replace(~r/\s+/, " ")
  end

  defp find_similar_speakers(normalized_name) do
    # Use PostgreSQL similarity functions
    query = from s in Speaker,
      where: fragment("similarity(?, ?) > 0.6", s.normalized_name, ^normalized_name),
      order_by: fragment("similarity(?, ?) DESC", s.normalized_name, ^normalized_name)
    
    EventAPI.Repo.all(query)
  end

  defp calculate_match_confidence(existing_speaker, new_name, new_company) do
    name_similarity = String.jaro_distance(existing_speaker.normalized_name, normalize_name(new_name))
    
    company_bonus = case {existing_speaker.company, new_company} do
      {nil, nil} -> 0.0
      {nil, _} -> -0.1
      {_, nil} -> -0.1
      {existing, new} when existing == new -> 0.2
      {_, _} -> -0.2
    end
    
    name_similarity + company_bonus
  end

  defp create_speaker_with_confidence(name, normalized_name, company) do
    confidence = calculate_extraction_confidence(name, company)
    
    %Speaker{}
    |> Speaker.changeset(%{
      name: name,
      normalized_name: normalized_name,
      company: company,
      confidence_score: confidence
    })
    |> EventAPI.Repo.insert()
  end
end
```

---

### ELIXIR-FEAT-006: Graph Relationship Builder
**Priority**: P2 | **Effort**: 5-6 days | **Type**: Graph Processing

#### Description
Implement graph relationship building using PostgreSQL AGE extension for complex network queries and analysis.

#### Acceptance Criteria
- [ ] Graph node creation for events, speakers, companies
- [ ] Relationship edge creation with weights and types
- [ ] Graph traversal queries for network analysis
- [ ] Speaker network analysis
- [ ] Company event relationships
- [ ] Topic clustering and analysis

#### Implementation Details
```elixir
defmodule EventAPI.Relationships.GraphBuilder do
  use GenServer
  alias EventAPI.Repo

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  def build_event_relationships(event_id) do
    GenServer.cast(__MODULE__, {:build_relationships, event_id})
  end

  def handle_cast({:build_relationships, event_id}, state) do
    Task.start(fn ->
      event = EventAPI.Events.get_event_with_associations(event_id)
      
      # Create nodes and relationships in AGE graph
      create_event_node(event)
      create_speaker_nodes(event.speakers)
      create_company_nodes(event.companies)
      create_relationships(event)
      
      Logger.info("Built graph relationships for event #{event_id}")
    end)
    
    {:noreply, state}
  end

  defp create_event_node(event) do
    Repo.query!("""
      SELECT * FROM cypher('event_network', $$
        MERGE (e:Event {id: $event_id, name: $name, date: $date, location: $location})
        RETURN e
      $$) AS (event agtype);
    """, [event.id, event.name, event.date, event.location])
  end

  defp create_speaker_nodes(speakers) do
    Enum.each(speakers, fn speaker ->
      Repo.query!("""
        SELECT * FROM cypher('event_network', $$
          MERGE (s:Speaker {id: $speaker_id, name: $name, company: $company})
          RETURN s
        $$) AS (speaker agtype);
      """, [speaker.id, speaker.name, speaker.company])
    end)
  end

  defp create_relationships(event) do
    # Create SPOKE_AT relationships
    Enum.each(event.speakers, fn speaker ->
      Repo.query!("""
        SELECT * FROM cypher('event_network', $$
          MATCH (e:Event {id: $event_id})
          MATCH (s:Speaker {id: $speaker_id})
          MERGE (s)-[:SPOKE_AT {role: $role}]->(e)
        $$) AS (relationship agtype);
      """, [event.id, speaker.id, speaker.pivot.role])
    end)
  end

  def query_speaker_network(speaker_id, depth \\ 2) do
    {:ok, result} = Repo.query("""
      SELECT * FROM cypher('event_network', $$
        MATCH (s:Speaker {id: $speaker_id})-[:SPOKE_AT*1..$depth]-(connected)
        RETURN DISTINCT connected
      $$) AS (connected agtype);
    """, [speaker_id, depth])
    
    parse_graph_result(result)
  end
end
```

---

### ELIXIR-FEAT-007: Recommendation Engine
**Priority**: P2 | **Effort**: 4-5 days | **Type**: ML/Analytics

#### Description
Build recommendation system for events and speakers using collaborative filtering, content similarity, and graph relationships.

#### Acceptance Criteria
- [ ] Event recommendation based on user interests
- [ ] Speaker recommendation for events
- [ ] Similar events based on content and relationships
- [ ] Topic-based recommendations
- [ ] Performance optimization for real-time queries

#### Implementation Details
```elixir
defmodule EventAPI.Relationships.Recommender do
  alias EventAPI.Events.{Event, Speaker}
  alias EventAPI.Repo

  def recommend_events(user_interests, location \\ nil, limit \\ 10) do
    # Combine multiple recommendation strategies
    content_recs = content_based_recommendations(user_interests, limit)
    graph_recs = graph_based_recommendations(user_interests, limit)
    location_recs = location_based_recommendations(location, limit)
    
    merge_and_rank_recommendations([content_recs, graph_recs, location_recs], limit)
  end

  def recommend_speakers_for_event(event_id, limit \\ 5) do
    event = EventAPI.Events.get_event!(event_id)
    
    # Find speakers who spoke at similar events
    similar_events = find_similar_events(event)
    
    speaker_scores = similar_events
    |> Enum.flat_map(& &1.speakers)
    |> Enum.frequencies_by(& &1.id)
    |> Enum.map(fn {speaker_id, frequency} ->
      speaker = EventAPI.Events.get_speaker!(speaker_id)
      score = calculate_speaker_relevance_score(speaker, event, frequency)
      {speaker, score}
    end)
    |> Enum.sort_by(fn {_, score} -> score end, :desc)
    |> Enum.take(limit)
    |> Enum.map(fn {speaker, score} -> %{speaker: speaker, relevance_score: score} end)
  end

  defp content_based_recommendations(interests, limit) do
    interest_vector = create_interest_vector(interests)
    
    from(e in Event,
      where: not is_nil(e.embedding),
      select: %{
        event: e,
        similarity: fragment("(? <=> ?)", e.embedding, ^interest_vector)
      },
      order_by: fragment("(? <=> ?)", e.embedding, ^interest_vector),
      limit: ^limit
    )
    |> Repo.all()
  end

  defp graph_based_recommendations(interests, limit) do
    # Use graph traversal to find events connected to interest topics
    {:ok, result} = Repo.query("""
      SELECT * FROM cypher('event_network', $$
        MATCH (t:Topic)-[:RELATED_TO]-(e:Event)
        WHERE t.name IN $interests
        RETURN e, COUNT(*) as relevance_count
        ORDER BY relevance_count DESC
        LIMIT $limit
      $$) AS (event agtype, count agtype);
    """, [interests, limit])
    
    parse_graph_recommendations(result)
  end

  defp calculate_speaker_relevance_score(speaker, event, frequency) do
    # Base score from frequency of speaking at similar events
    base_score = :math.log(frequency + 1)
    
    # Bonus for topic overlap
    topic_bonus = calculate_topic_overlap(speaker, event) * 0.3
    
    # Bonus for location proximity
    location_bonus = calculate_location_bonus(speaker, event) * 0.2
    
    # Company relevance bonus
    company_bonus = calculate_company_relevance(speaker, event) * 0.1
    
    base_score + topic_bonus + location_bonus + company_bonus
  end
end
```

---

### ELIXIR-FEAT-008: Data Quality Assessment
**Priority**: P2 | **Effort**: 3-4 days | **Type**: Quality Assurance

#### Description
Implement data quality scoring system that evaluates completeness, accuracy, and reliability of extracted event data.

#### Acceptance Criteria
- [ ] Quality scoring algorithm for events
- [ ] Completeness assessment (required fields)
- [ ] Confidence scoring for extracted data
- [ ] Quality trend tracking over time
- [ ] Quality improvement recommendations

#### Implementation Details
```elixir
defmodule EventAPI.Processing.QualityScorer do
  def calculate_event_quality_score(event) do
    scores = [
      completeness_score(event),
      extraction_confidence_score(event),
      relationship_quality_score(event),
      consistency_score(event)
    ]
    
    weighted_average(scores, [0.3, 0.3, 0.2, 0.2])
  end

  defp completeness_score(event) do
    required_fields = [:name, :description, :date, :location]
    optional_fields = [:speakers, :companies, :topics]
    
    required_score = required_fields
    |> Enum.count(&field_present?(event, &1))
    |> Kernel./(length(required_fields))
    
    optional_score = optional_fields
    |> Enum.count(&field_present?(event, &1))
    |> Kernel./(length(optional_fields))
    
    (required_score * 0.7) + (optional_score * 0.3)
  end

  defp extraction_confidence_score(event) do
    case event.extracted_data do
      nil -> 0.0
      data -> 
        confidence_values = extract_confidence_values(data)
        Enum.sum(confidence_values) / length(confidence_values)
    end
  end

  defp relationship_quality_score(event) do
    speaker_quality = calculate_speaker_quality(event.speakers)
    company_quality = calculate_company_quality(event.companies)
    topic_quality = calculate_topic_quality(event.topics)
    
    (speaker_quality + company_quality + topic_quality) / 3
  end
end
```

---

### ELIXIR-FEAT-009: Internal API Endpoints
**Priority**: P1 | **Effort**: 3-4 days | **Type**: API

#### Description
Create internal HTTP API endpoints for Hono service integration and external system communication.

#### Acceptance Criteria
- [ ] POST /internal/process for event processing
- [ ] GET /internal/graph/* for graph queries
- [ ] POST /internal/deduplicate for bulk deduplication
- [ ] GET /internal/recommend/* for recommendations
- [ ] GET /internal/quality/* for quality reports
- [ ] Proper error handling and response formatting

#### Implementation Details
```elixir
defmodule EventAPIWeb.InternalController do
  use EventAPIWeb, :controller
  
  def process_event(conn, %{"event_id" => event_id, "html" => html, "url" => url}) do
    case EventAPI.Processing.EventProcessor.process_event(event_id, html, url) do
      :ok ->
        json(conn, %{status: "queued", event_id: event_id})
      {:error, reason} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: reason})
    end
  end

  def graph_query(conn, %{"query" => query}) do
    case EventAPI.Relationships.GraphBuilder.execute_query(query) do
      {:ok, results} ->
        json(conn, %{results: results})
      {:error, reason} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: reason})
    end
  end

  def recommend_events(conn, params) do
    interests = Map.get(params, "user_interests", [])
    location = Map.get(params, "location")
    limit = Map.get(params, "limit", "10") |> String.to_integer()
    
    recommendations = EventAPI.Relationships.Recommender.recommend_events(interests, location, limit)
    
    json(conn, %{recommendations: recommendations})
  end
end
```

---

## Testing Strategy

### Unit Tests
- GenServer state management
- Data extraction and parsing
- Deduplication algorithms
- Quality scoring functions

### Integration Tests
- BAML service communication
- Database operations with Ecto
- Graph query execution
- End-to-end processing workflows

### Performance Tests
- Processing pipeline throughput
- Graph query performance
- Recommendation response times
- Concurrent processing capacity

## Definition of Done

- [ ] All processing pipelines operational
- [ ] BAML integration functional
- [ ] Deduplication engine working
- [ ] Graph relationships building correctly
- [ ] Recommendation system providing results
- [ ] Internal API endpoints responding
- [ ] Comprehensive test coverage (>85%)
- [ ] OTP supervision tree stable
- [ ] Performance benchmarks met