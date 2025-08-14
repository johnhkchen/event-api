-- Custom pgbench scenarios for Event API performance testing
-- These scripts simulate realistic database workloads for the event processing system

-- Scenario 1: Event insertion workload (simulates scraping results)
-- File: event-insert-workload.sql
\set event_id random(1, 100000)
\set company_id random(1, 1000)
\set speaker_id random(1, 5000)
\set topic_id random(1, 100)

BEGIN;

-- Insert event with realistic data
INSERT INTO events (
    id, 
    title, 
    description, 
    start_date, 
    end_date, 
    location,
    source_url,
    status,
    embedding,
    created_at,
    updated_at
) VALUES (
    'evt_' || :event_id,
    'Performance Test Event ' || :event_id,
    'This is a performance test event with ID ' || :event_id,
    NOW() + INTERVAL '1 day' * random() * 365,
    NOW() + INTERVAL '1 day' * (random() * 365 + 1),
    'Test Location ' || :event_id,
    'https://example.com/event/' || :event_id,
    'published',
    ARRAY(SELECT random() FROM generate_series(1, 1536))::vector,
    NOW(),
    NOW()
) ON CONFLICT (id) DO UPDATE SET
    updated_at = NOW(),
    description = EXCLUDED.description;

-- Associate with company
INSERT INTO event_companies (event_id, company_id, role, created_at)
VALUES ('evt_' || :event_id, 'company_' || :company_id, 'organizer', NOW())
ON CONFLICT (event_id, company_id) DO NOTHING;

-- Associate with speaker  
INSERT INTO event_speakers (event_id, speaker_id, role, created_at)
VALUES ('evt_' || :event_id, 'speaker_' || :speaker_id, 'presenter', NOW())
ON CONFLICT (event_id, speaker_id) DO NOTHING;

-- Associate with topic
INSERT INTO event_topics (event_id, topic_id, confidence, created_at)
VALUES ('evt_' || :event_id, 'topic_' || :topic_id, random(), NOW())
ON CONFLICT (event_id, topic_id) DO NOTHING;

COMMIT;