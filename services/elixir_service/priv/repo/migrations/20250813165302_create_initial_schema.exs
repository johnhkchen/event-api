defmodule EventAPI.Repo.Migrations.CreateInitialSchema do
  use Ecto.Migration

  def up do
    # Enable required PostgreSQL extensions
    execute "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\""
    execute "CREATE EXTENSION IF NOT EXISTS \"vector\""

    # Create events table
    create table(:events, primary_key: false) do
      add :id, :uuid, primary_key: true, default: fragment("gen_random_uuid()")
      add :name, :text, null: false
      add :description, :text
      add :date, :date
      add :location, :text
      add :luma_url, :text
      add :raw_html, :text
      add :extracted_data, :map
      add :embedding, :"vector(1536)"
      add :data_quality_score, :integer, default: 0
      add :scraped_at, :utc_datetime, default: fragment("now()")
      add :processed_at, :utc_datetime
      add :created_at, :utc_datetime, default: fragment("now()")
    end

    # Create unique index on luma_url
    create unique_index(:events, [:luma_url])
    
    # Add constraints for events
    create constraint(:events, :valid_data_quality_score, check: "data_quality_score >= 0 AND data_quality_score <= 100")
    create constraint(:events, :valid_date, check: "date >= '1900-01-01'::DATE")
    create constraint(:events, :valid_luma_url, check: "luma_url IS NULL OR luma_url ~* '^https?://.*lu\\.ma/.*'")

    # Create speakers table
    create table(:speakers, primary_key: false) do
      add :id, :uuid, primary_key: true, default: fragment("gen_random_uuid()")
      add :name, :text, null: false
      add :normalized_name, :text
      add :company, :text
      add :bio, :text
      add :confidence_score, :float, default: 0.0
      add :created_at, :utc_datetime, default: fragment("now()")
    end
    
    # Add constraints for speakers
    create constraint(:speakers, :valid_confidence_score, check: "confidence_score >= 0 AND confidence_score <= 1")
    create constraint(:speakers, :non_empty_name, check: "trim(name) != ''")

    # Create companies table
    create table(:companies, primary_key: false) do
      add :id, :uuid, primary_key: true, default: fragment("gen_random_uuid()")
      add :name, :text, null: false
      add :normalized_name, :text
      add :domain, :text
      add :industry, :text
      add :created_at, :utc_datetime, default: fragment("now()")
    end
    
    # Create unique index on normalized_name
    create unique_index(:companies, [:normalized_name])
    
    # Add constraints for companies
    create constraint(:companies, :non_empty_company_name, check: "trim(name) != ''")
    create constraint(:companies, :valid_domain, check: "domain IS NULL OR domain ~* '^[a-zA-Z0-9]([a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?(\\.[a-zA-Z0-9]([a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?)*$'")

    # Create topics table
    create table(:topics, primary_key: false) do
      add :id, :uuid, primary_key: true, default: fragment("gen_random_uuid()")
      add :name, :text, null: false
      add :category, :text
      add :created_at, :utc_datetime, default: fragment("now()")
    end
    
    # Create unique index on name
    create unique_index(:topics, [:name], name: :unique_topic_name)
    
    # Add constraints for topics
    create constraint(:topics, :non_empty_topic_name, check: "trim(name) != ''")
    create constraint(:topics, :valid_category, check: "category IS NULL OR category IN ('technology', 'industry', 'format')")

    # Create event_speakers junction table
    create table(:event_speakers, primary_key: false) do
      add :event_id, references(:events, type: :uuid, on_delete: :delete_all), null: false
      add :speaker_id, references(:speakers, type: :uuid, on_delete: :delete_all), null: false
      add :role, :text
      add :extraction_confidence, :float, default: 0.0
      add :created_at, :utc_datetime, default: fragment("now()")
    end
    
    # Create composite primary key
    create unique_index(:event_speakers, [:event_id, :speaker_id, :role], name: :event_speakers_pkey)
    
    # Add constraints for event_speakers
    create constraint(:event_speakers, :valid_speaker_role, check: "role IN ('speaker', 'judge', 'host', 'panelist')")
    create constraint(:event_speakers, :valid_extraction_confidence, check: "extraction_confidence >= 0 AND extraction_confidence <= 1")

    # Create event_companies junction table
    create table(:event_companies, primary_key: false) do
      add :event_id, references(:events, type: :uuid, on_delete: :delete_all), null: false
      add :company_id, references(:companies, type: :uuid, on_delete: :delete_all), null: false
      add :relationship_type, :text
      add :created_at, :utc_datetime, default: fragment("now()")
    end
    
    # Create composite primary key
    create unique_index(:event_companies, [:event_id, :company_id, :relationship_type], name: :event_companies_pkey)
    
    # Add constraints for event_companies
    create constraint(:event_companies, :valid_relationship_type, check: "relationship_type IN ('host', 'sponsor', 'venue', 'partner')")

    # Create event_topics junction table
    create table(:event_topics, primary_key: false) do
      add :event_id, references(:events, type: :uuid, on_delete: :delete_all), null: false
      add :topic_id, references(:topics, type: :uuid, on_delete: :delete_all), null: false
      add :relevance_score, :float, default: 0.0
      add :created_at, :utc_datetime, default: fragment("now()")
    end
    
    # Create composite primary key
    create unique_index(:event_topics, [:event_id, :topic_id], name: :event_topics_pkey)
    
    # Add constraints for event_topics
    create constraint(:event_topics, :valid_relevance_score, check: "relevance_score >= 0 AND relevance_score <= 1")

    # Create performance indexes
    
    # Primary query patterns for events
    create index(:events, [:date])
    create index(:events, [:location])
    create index(:events, [:scraped_at])
    create index(:events, [:processed_at])
    create index(:events, [:data_quality_score])

    # Vector similarity search (using HNSW for better performance)
    execute "CREATE INDEX idx_events_embedding ON events USING hnsw (embedding vector_cosine_ops)"

    # Full-text search on events
    execute "CREATE INDEX idx_events_fts ON events USING gin(to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(location, '')))"

    # Speaker indexes
    create index(:speakers, [:normalized_name])
    create index(:speakers, [:company])
    create index(:speakers, [:confidence_score])

    # Company indexes
    create index(:companies, [:domain])
    create index(:companies, [:industry])

    # Topic indexes
    create index(:topics, [:category])

    # Relationship indexes
    create index(:event_speakers, [:event_id])
    create index(:event_speakers, [:speaker_id])
    create index(:event_speakers, [:role])

    create index(:event_companies, [:event_id])
    create index(:event_companies, [:company_id])
    create index(:event_companies, [:relationship_type])

    create index(:event_topics, [:event_id])
    create index(:event_topics, [:topic_id])
    create index(:event_topics, [:relevance_score])

    # Composite indexes for common query patterns
    create index(:events, [:date, :location])
    create index(:events, [:date, :data_quality_score])
    create index(:speakers, [:normalized_name, :company])

    # Add table comments for documentation
    execute "COMMENT ON TABLE events IS 'Core events table storing scraped and processed event data'"
    execute "COMMENT ON TABLE speakers IS 'Deduplicated speakers with confidence scoring'"
    execute "COMMENT ON TABLE companies IS 'Normalized company information'"
    execute "COMMENT ON TABLE topics IS 'Event categorization and tagging system'"
    execute "COMMENT ON TABLE event_speakers IS 'Many-to-many relationship between events and speakers'"
    execute "COMMENT ON TABLE event_companies IS 'Many-to-many relationship between events and companies'"
    execute "COMMENT ON TABLE event_topics IS 'Many-to-many relationship between events and topics with relevance scoring'"

    # Add column comments
    execute "COMMENT ON COLUMN events.embedding IS 'Vector embedding for semantic search (1536 dimensions for OpenAI)'"
    execute "COMMENT ON COLUMN events.data_quality_score IS 'Quality score from 0-100 based on data completeness and accuracy'"
    execute "COMMENT ON COLUMN speakers.normalized_name IS 'Lowercase, cleaned name for deduplication'"
    execute "COMMENT ON COLUMN speakers.confidence_score IS 'Confidence in speaker identification (0.0-1.0)'"
    execute "COMMENT ON COLUMN companies.normalized_name IS 'Normalized company name for deduplication'"
  end

  def down do
    # Drop indexes first
    drop_if_exists index(:speakers, [:normalized_name, :company])
    drop_if_exists index(:events, [:date, :data_quality_score])
    drop_if_exists index(:events, [:date, :location])

    drop_if_exists index(:event_topics, [:relevance_score])
    drop_if_exists index(:event_topics, [:topic_id])
    drop_if_exists index(:event_topics, [:event_id])

    drop_if_exists index(:event_companies, [:relationship_type])
    drop_if_exists index(:event_companies, [:company_id])
    drop_if_exists index(:event_companies, [:event_id])

    drop_if_exists index(:event_speakers, [:role])
    drop_if_exists index(:event_speakers, [:speaker_id])
    drop_if_exists index(:event_speakers, [:event_id])

    drop_if_exists index(:topics, [:category])
    drop_if_exists index(:companies, [:industry])
    drop_if_exists index(:companies, [:domain])
    
    drop_if_exists index(:speakers, [:confidence_score])
    drop_if_exists index(:speakers, [:company])
    drop_if_exists index(:speakers, [:normalized_name])

    execute "DROP INDEX IF EXISTS idx_events_fts"
    execute "DROP INDEX IF EXISTS idx_events_embedding"
    
    drop_if_exists index(:events, [:data_quality_score])
    drop_if_exists index(:events, [:processed_at])
    drop_if_exists index(:events, [:scraped_at])
    drop_if_exists index(:events, [:location])
    drop_if_exists index(:events, [:date])

    # Drop tables in reverse order
    drop table(:event_topics)
    drop table(:event_companies) 
    drop table(:event_speakers)
    drop table(:topics)
    drop table(:companies)
    drop table(:speakers)
    drop table(:events)

    # Extensions are typically left in place for safety
  end
end
