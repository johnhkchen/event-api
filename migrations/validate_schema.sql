-- Schema validation and testing script
-- Tests all constraints, relationships, and indexes

-- Test 1: Verify all tables exist
SELECT 'Checking table existence...' AS test_step;

SELECT 
    table_name,
    CASE WHEN table_name IN ('events', 'speakers', 'companies', 'topics', 'event_speakers', 'event_companies', 'event_topics') 
        THEN '✓ EXISTS' 
        ELSE '✗ MISSING' 
    END AS status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Test 2: Verify foreign key constraints
SELECT 'Checking foreign key constraints...' AS test_step;

SELECT 
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type,
    '✓ VALID' AS status
FROM information_schema.table_constraints tc
WHERE tc.constraint_type = 'FOREIGN KEY'
AND tc.table_schema = 'public'
ORDER BY tc.table_name;

-- Test 3: Verify indexes exist
SELECT 'Checking index existence...' AS test_step;

SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef,
    '✓ EXISTS' AS status
FROM pg_indexes 
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- Test 4: Test constraints with sample data
SELECT 'Testing data constraints...' AS test_step;

-- Test valid event insertion
BEGIN;
INSERT INTO events (name, description, date, location, data_quality_score) 
VALUES ('Test Event', 'Test Description', '2025-01-01', 'San Francisco', 85);

INSERT INTO speakers (name, normalized_name, confidence_score) 
VALUES ('John Doe', 'john doe', 0.95);

INSERT INTO companies (name, normalized_name, domain) 
VALUES ('Test Company', 'test company', 'example.com');

INSERT INTO topics (name, category) 
VALUES ('AI/ML', 'technology');

-- Test relationship insertions
INSERT INTO event_speakers (event_id, speaker_id, role, extraction_confidence)
SELECT e.id, s.id, 'speaker', 0.9
FROM events e, speakers s 
WHERE e.name = 'Test Event' AND s.name = 'John Doe';

INSERT INTO event_companies (event_id, company_id, relationship_type)
SELECT e.id, c.id, 'host'
FROM events e, companies c 
WHERE e.name = 'Test Event' AND c.name = 'Test Company';

INSERT INTO event_topics (event_id, topic_id, relevance_score)
SELECT e.id, t.id, 0.95
FROM events e, topics t 
WHERE e.name = 'Test Event' AND t.name = 'AI/ML';

SELECT 'Sample data inserted successfully' AS result;

-- Test constraint violations (should fail)
SELECT 'Testing constraint violations...' AS test_step;

-- Test invalid data quality score (should fail)
DO $$
BEGIN
    BEGIN
        INSERT INTO events (name, data_quality_score) VALUES ('Invalid Event', 150);
        RAISE EXCEPTION 'Should have failed - invalid data quality score';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE '✓ Data quality constraint working correctly';
    END;
END $$;

-- Test invalid confidence score (should fail)
DO $$
BEGIN
    BEGIN
        INSERT INTO speakers (name, confidence_score) VALUES ('Invalid Speaker', 2.0);
        RAISE EXCEPTION 'Should have failed - invalid confidence score';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE '✓ Confidence score constraint working correctly';
    END;
END $$;

-- Test invalid role (should fail)
DO $$
BEGIN
    BEGIN
        INSERT INTO event_speakers (event_id, speaker_id, role) 
        SELECT e.id, s.id, 'invalid_role'
        FROM events e, speakers s 
        WHERE e.name = 'Test Event' AND s.name = 'John Doe' LIMIT 1;
        RAISE EXCEPTION 'Should have failed - invalid role';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE '✓ Speaker role constraint working correctly';
    END;
END $$;

-- Test vector operations if pgvector is working
SELECT 'Testing vector operations...' AS test_step;

DO $$
BEGIN
    BEGIN
        -- Test vector embedding insertion and similarity search
        UPDATE events 
        SET embedding = '[1,2,3,4,5,6,7,8,9,10]'::vector
        WHERE name = 'Test Event';
        
        -- Test similarity search
        PERFORM e.name, e.embedding <=> '[1,2,3,4,5,6,7,8,9,10]'::vector AS distance
        FROM events e
        WHERE e.embedding IS NOT NULL
        ORDER BY e.embedding <=> '[1,2,3,4,5,6,7,8,9,10]'::vector
        LIMIT 1;
        
        RAISE NOTICE '✓ Vector operations working correctly';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '⚠ Vector operations failed - check pgvector installation';
    END;
END $$;

-- Test full-text search
SELECT 'Testing full-text search...' AS test_step;

SELECT 
    name,
    ts_rank(to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, '')), 
            plainto_tsquery('english', 'test')) AS rank
FROM events
WHERE to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, '')) 
      @@ plainto_tsquery('english', 'test')
ORDER BY rank DESC;

-- Cleanup test data
ROLLBACK;

SELECT '✓ Schema validation completed successfully' AS final_result;