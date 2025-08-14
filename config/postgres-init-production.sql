-- Event API - Production PostgreSQL Initialization
-- Enhanced version of database initialization for Coolify production deployment
-- Includes performance optimizations and monitoring setup

-- Enable required extensions with error handling
DO $$
BEGIN
    -- Core extensions
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    RAISE NOTICE 'uuid-ossp extension enabled';
    
    CREATE EXTENSION IF NOT EXISTS "vector";
    RAISE NOTICE 'pgvector extension enabled for AI/ML features';
    
    -- Statistics extension for query performance monitoring
    CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
    RAISE NOTICE 'pg_stat_statements extension enabled for performance monitoring';
    
    -- Additional useful extensions
    CREATE EXTENSION IF NOT EXISTS "btree_gin";
    CREATE EXTENSION IF NOT EXISTS "btree_gist";
    CREATE EXTENSION IF NOT EXISTS "pg_trgm";
    RAISE NOTICE 'Additional indexing extensions enabled';
    
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Some extensions failed to install: %', SQLERRM;
END $$;

-- AGE (Apache Graph Extension) setup with enhanced error handling
DO $$
BEGIN
    -- Try to create AGE extension
    CREATE EXTENSION IF NOT EXISTS "age";
    RAISE NOTICE 'AGE extension enabled successfully';
    
    -- Load AGE and setup graph
    LOAD 'age';
    SET search_path = ag_catalog, "$user", public;
    
    -- Create the event network graph
    SELECT create_graph('event_network');
    RAISE NOTICE 'AGE graph database initialized with event_network graph';
    
    -- Create additional graphs for different data types
    SELECT create_graph('speaker_network');
    SELECT create_graph('company_network');
    RAISE NOTICE 'Additional graph networks created for speakers and companies';
    
EXCEPTION WHEN undefined_file THEN
    RAISE WARNING 'AGE extension not available in this PostgreSQL image.';
    RAISE WARNING 'Graph queries will not be available.';
    RAISE WARNING 'To enable AGE, use a PostgreSQL image with AGE pre-installed.';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'AGE setup failed: %', SQLERRM;
    RAISE WARNING 'Graph features will be disabled.';
END $$;

-- Create application roles and users with proper permissions
DO $$
BEGIN
    -- Main application user
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'event_api_prod') THEN
        CREATE ROLE event_api_prod WITH 
            LOGIN 
            PASSWORD COALESCE(NULLIF('${POSTGRES_PASSWORD}', ''), 'change_me_in_production')
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOINHERIT
            NOREPLICATION;
        
        RAISE NOTICE 'Created event_api_prod user';
    END IF;
    
    -- Read-only user for reporting/analytics
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'event_api_readonly') THEN
        CREATE ROLE event_api_readonly WITH 
            LOGIN 
            PASSWORD COALESCE(NULLIF('${POSTGRES_READONLY_PASSWORD}', ''), 'readonly_change_me')
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOINHERIT
            NOREPLICATION;
        
        RAISE NOTICE 'Created event_api_readonly user';
    END IF;
    
    -- Backup user (for automated backups)
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'event_api_backup') THEN
        CREATE ROLE event_api_backup WITH 
            LOGIN 
            PASSWORD COALESCE(NULLIF('${POSTGRES_BACKUP_PASSWORD}', ''), 'backup_change_me')
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOINHERIT
            NOREPLICATION;
        
        RAISE NOTICE 'Created event_api_backup user';
    END IF;
    
END $$;

-- Grant appropriate permissions
DO $$
BEGIN
    -- Grant full access to main application user
    GRANT ALL PRIVILEGES ON DATABASE event_api_production TO event_api_prod;
    GRANT ALL ON SCHEMA public TO event_api_prod;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO event_api_prod;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO event_api_prod;
    GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO event_api_prod;
    
    -- Grant AGE schema access to application user
    GRANT USAGE ON SCHEMA ag_catalog TO event_api_prod;
    GRANT ALL ON ALL TABLES IN SCHEMA ag_catalog TO event_api_prod;
    
    -- Set default privileges for future objects
    ALTER DEFAULT PRIVILEGES IN SCHEMA public 
        GRANT ALL ON TABLES TO event_api_prod;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public 
        GRANT ALL ON SEQUENCES TO event_api_prod;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public 
        GRANT ALL ON FUNCTIONS TO event_api_prod;
    
    -- Read-only user permissions
    GRANT CONNECT ON DATABASE event_api_production TO event_api_readonly;
    GRANT USAGE ON SCHEMA public TO event_api_readonly;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO event_api_readonly;
    GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO event_api_readonly;
    
    ALTER DEFAULT PRIVILEGES IN SCHEMA public 
        GRANT SELECT ON TABLES TO event_api_readonly;
    
    -- Backup user permissions
    GRANT CONNECT ON DATABASE event_api_production TO event_api_backup;
    GRANT USAGE ON SCHEMA public TO event_api_backup;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO event_api_backup;
    GRANT USAGE ON SCHEMA ag_catalog TO event_api_backup;
    GRANT SELECT ON ALL TABLES IN SCHEMA ag_catalog TO event_api_backup;
    
    ALTER DEFAULT PRIVILEGES IN SCHEMA public 
        GRANT SELECT ON TABLES TO event_api_backup;
    
    RAISE NOTICE 'Database permissions configured successfully';
END $$;

-- Performance and monitoring configuration
DO $$
BEGIN
    -- Configure pg_stat_statements for query monitoring
    SELECT pg_stat_statements_reset();
    RAISE NOTICE 'Query statistics reset for clean monitoring start';
    
    -- Create monitoring views for easier access
    CREATE OR REPLACE VIEW performance_summary AS
    SELECT 
        query,
        calls,
        total_time,
        mean_time,
        stddev_time,
        rows,
        100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0) AS hit_percent
    FROM pg_stat_statements
    WHERE calls > 10
    ORDER BY total_time DESC;
    
    RAISE NOTICE 'Performance monitoring view created';
    
    -- Create slow query view
    CREATE OR REPLACE VIEW slow_queries AS
    SELECT 
        query,
        calls,
        total_time,
        mean_time,
        (total_time/calls) as avg_time_per_call
    FROM pg_stat_statements
    WHERE calls > 5 AND mean_time > 1000  -- Queries taking more than 1 second on average
    ORDER BY mean_time DESC;
    
    RAISE NOTICE 'Slow query monitoring view created';
    
END $$;

-- Database configuration optimizations for production
DO $$
DECLARE
    total_memory_mb integer;
BEGIN
    -- Get available memory (simplified approach)
    -- In production, these should be set via postgresql.conf or environment variables
    
    RAISE NOTICE 'Consider setting these PostgreSQL configuration parameters:';
    RAISE NOTICE '  shared_buffers = 256MB (or 25%% of RAM)';
    RAISE NOTICE '  effective_cache_size = 1GB (or 75%% of RAM)';
    RAISE NOTICE '  work_mem = 4MB';
    RAISE NOTICE '  maintenance_work_mem = 64MB';
    RAISE NOTICE '  max_connections = 200';
    RAISE NOTICE '  checkpoint_completion_target = 0.9';
    RAISE NOTICE '  wal_buffers = 16MB';
    RAISE NOTICE '  default_statistics_target = 100';
    RAISE NOTICE '  random_page_cost = 1.1 (for SSD storage)';
    
END $$;

-- Health check function for monitoring
CREATE OR REPLACE FUNCTION health_check()
RETURNS JSON AS $$
DECLARE
    result JSON;
    db_size text;
    connection_count integer;
    active_connections integer;
    slow_query_count integer;
BEGIN
    -- Gather database health metrics
    SELECT pg_size_pretty(pg_database_size(current_database())) INTO db_size;
    SELECT count(*) FROM pg_stat_activity INTO connection_count;
    SELECT count(*) FROM pg_stat_activity WHERE state = 'active' INTO active_connections;
    SELECT count(*) FROM slow_queries INTO slow_query_count;
    
    -- Build health check response
    SELECT json_build_object(
        'status', 'healthy',
        'timestamp', now(),
        'database', current_database(),
        'version', version(),
        'metrics', json_build_object(
            'database_size', db_size,
            'total_connections', connection_count,
            'active_connections', active_connections,
            'slow_query_count', slow_query_count
        ),
        'extensions', json_build_object(
            'uuid_ossp', (SELECT count(*) FROM pg_extension WHERE extname = 'uuid-ossp') > 0,
            'vector', (SELECT count(*) FROM pg_extension WHERE extname = 'vector') > 0,
            'age', (SELECT count(*) FROM pg_extension WHERE extname = 'age') > 0,
            'pg_stat_statements', (SELECT count(*) FROM pg_extension WHERE extname = 'pg_stat_statements') > 0
        )
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Grant health check function access to all users
GRANT EXECUTE ON FUNCTION health_check() TO event_api_prod, event_api_readonly, event_api_backup;

-- Create backup metadata table for tracking backups
CREATE TABLE IF NOT EXISTS backup_metadata (
    id SERIAL PRIMARY KEY,
    backup_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    backup_filename TEXT NOT NULL,
    backup_size_bytes BIGINT,
    backup_type TEXT NOT NULL DEFAULT 'full', -- 'full', 'schema', 'data'
    database_name TEXT NOT NULL DEFAULT current_database(),
    created_by TEXT NOT NULL DEFAULT current_user,
    s3_uploaded BOOLEAN DEFAULT false,
    s3_key TEXT,
    verification_status TEXT DEFAULT 'pending', -- 'pending', 'verified', 'failed'
    notes TEXT,
    CONSTRAINT valid_backup_type CHECK (backup_type IN ('full', 'schema', 'data')),
    CONSTRAINT valid_verification_status CHECK (verification_status IN ('pending', 'verified', 'failed'))
);

-- Grant access to backup metadata table
GRANT ALL ON backup_metadata TO event_api_prod;
GRANT ALL ON backup_metadata_id_seq TO event_api_prod;
GRANT SELECT ON backup_metadata TO event_api_readonly;
GRANT INSERT, SELECT ON backup_metadata TO event_api_backup;
GRANT USAGE ON backup_metadata_id_seq TO event_api_backup;

-- Create index for faster backup lookups
CREATE INDEX IF NOT EXISTS idx_backup_metadata_timestamp ON backup_metadata(backup_timestamp);
CREATE INDEX IF NOT EXISTS idx_backup_metadata_type ON backup_metadata(backup_type);

-- Function to log backup completion
CREATE OR REPLACE FUNCTION log_backup_completion(
    p_filename TEXT,
    p_size_bytes BIGINT DEFAULT NULL,
    p_backup_type TEXT DEFAULT 'full',
    p_s3_uploaded BOOLEAN DEFAULT false,
    p_s3_key TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    backup_id INTEGER;
BEGIN
    INSERT INTO backup_metadata (
        backup_filename,
        backup_size_bytes,
        backup_type,
        s3_uploaded,
        s3_key,
        notes
    ) VALUES (
        p_filename,
        p_size_bytes,
        p_backup_type,
        p_s3_uploaded,
        p_s3_key,
        p_notes
    ) RETURNING id INTO backup_id;
    
    RAISE NOTICE 'Backup logged with ID: %', backup_id;
    RETURN backup_id;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission on backup logging function
GRANT EXECUTE ON FUNCTION log_backup_completion TO event_api_backup, event_api_prod;

-- Create a view for backup history
CREATE OR REPLACE VIEW backup_history AS
SELECT 
    id,
    backup_timestamp,
    backup_filename,
    pg_size_pretty(backup_size_bytes) as backup_size,
    backup_type,
    created_by,
    s3_uploaded,
    verification_status,
    EXTRACT(days FROM (now() - backup_timestamp)) as days_old
FROM backup_metadata
ORDER BY backup_timestamp DESC;

GRANT SELECT ON backup_history TO event_api_prod, event_api_readonly, event_api_backup;

-- Final status and recommendations
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== Event API Production Database Initialization Complete ===';
    RAISE NOTICE '';
    RAISE NOTICE 'Database: %', current_database();
    RAISE NOTICE 'Users created: event_api_prod, event_api_readonly, event_api_backup';
    RAISE NOTICE 'Extensions: uuid-ossp, vector, pg_stat_statements, AGE (if available)';
    RAISE NOTICE 'Monitoring: performance_summary, slow_queries views created';
    RAISE NOTICE 'Health check: health_check() function available';
    RAISE NOTICE 'Backup tracking: backup_metadata table and functions created';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '1. Update user passwords in production';
    RAISE NOTICE '2. Configure PostgreSQL parameters for optimal performance';
    RAISE NOTICE '3. Set up automated backup schedule';
    RAISE NOTICE '4. Configure monitoring alerts';
    RAISE NOTICE '5. Run application migrations';
    RAISE NOTICE '';
    
    -- Show current database status
    SELECT 'Database initialization completed at ' || now() AS status;
END $$;