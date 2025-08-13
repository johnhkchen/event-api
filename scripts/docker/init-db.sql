-- Event API Database Initialization
-- This script sets up the required PostgreSQL extensions for the Event API

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Check if AGE extension is available and install if possible
-- AGE may need to be installed separately depending on the PostgreSQL image
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "age";
    RAISE NOTICE 'AGE extension enabled successfully';
EXCEPTION WHEN undefined_file THEN
    RAISE WARNING 'AGE extension not available in this PostgreSQL image. Graph queries will not be available.';
    RAISE WARNING 'To enable AGE, use a PostgreSQL image with AGE pre-installed or install it manually.';
END $$;

-- Load AGE if available
DO $$
BEGIN
    LOAD 'age';
    SET search_path = ag_catalog, "$user", public;
    PERFORM create_graph('event_network');
    RAISE NOTICE 'AGE graph database initialized with event_network graph';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Could not initialize AGE graph database. Graph features will be disabled.';
END $$;

-- Create application user if not exists (for development)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'event_api_user') THEN
        CREATE ROLE event_api_user WITH LOGIN PASSWORD 'development_password';
        GRANT ALL PRIVILEGES ON DATABASE event_api_dev TO event_api_user;
        RAISE NOTICE 'Created event_api_user for development';
    END IF;
END $$;

-- Basic database setup complete
SELECT 'Event API database initialization complete' AS status;