-- Vector search performance benchmarks for Event API
-- Tests pgvector performance under various query patterns

-- Generate test vectors for benchmarking
\set dimension 1536
\set search_vector ARRAY(SELECT random() FROM generate_series(1, :dimension))::vector

-- Benchmark 1: Similarity search with distance threshold
\set distance_threshold 0.8
SELECT 
    id,
    title,
    embedding <-> :'search_vector' AS distance
FROM events 
WHERE embedding <-> :'search_vector' < :distance_threshold
ORDER BY embedding <-> :'search_vector'
LIMIT 20;

-- Benchmark 2: Cosine similarity search (most common for semantic search)
SELECT 
    id,
    title,
    1 - (embedding <=> :'search_vector') AS cosine_similarity
FROM events 
ORDER BY embedding <=> :'search_vector'
LIMIT 20;

-- Benchmark 3: Inner product similarity (for normalized embeddings)
SELECT 
    id,
    title,
    embedding <#> :'search_vector' AS neg_inner_product
FROM events 
ORDER BY embedding <#> :'search_vector' DESC
LIMIT 20;

-- Benchmark 4: Combined vector search with metadata filtering
\set start_date '2024-01-01'
\set end_date '2024-12-31'
SELECT 
    e.id,
    e.title,
    e.start_date,
    embedding <-> :'search_vector' AS distance
FROM events e
WHERE embedding <-> :'search_vector' < 0.7
    AND e.start_date >= :'start_date'::date
    AND e.start_date <= :'end_date'::date
    AND e.status = 'published'
ORDER BY embedding <-> :'search_vector'
LIMIT 10;

-- Benchmark 5: Vector search with JOIN operations (realistic query pattern)
SELECT 
    e.id,
    e.title,
    s.name as speaker_name,
    c.name as company_name,
    embedding <-> :'search_vector' AS distance
FROM events e
JOIN event_speakers es ON e.id = es.event_id
JOIN speakers s ON es.speaker_id = s.id  
JOIN event_companies ec ON e.id = ec.event_id
JOIN companies c ON ec.company_id = c.id
WHERE embedding <-> :'search_vector' < 0.6
ORDER BY embedding <-> :'search_vector'
LIMIT 15;

-- Performance test for index effectiveness
-- This should use the vector index if properly configured
EXPLAIN (ANALYZE, BUFFERS) 
SELECT id, title, embedding <-> :'search_vector' AS distance
FROM events 
WHERE embedding <-> :'search_vector' < 0.5
ORDER BY embedding <-> :'search_vector'
LIMIT 10;