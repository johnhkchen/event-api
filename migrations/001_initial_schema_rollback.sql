-- Rollback Migration: 001_initial_schema_rollback.sql
-- Description: Rollback initial database schema for Event API
-- Created: 2025-08-13
-- Author: agent-001

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS event_topics;
DROP TABLE IF EXISTS event_companies;
DROP TABLE IF EXISTS event_speakers;
DROP TABLE IF EXISTS topics;
DROP TABLE IF EXISTS companies;
DROP TABLE IF EXISTS speakers;
DROP TABLE IF EXISTS events;

-- Note: Extensions are left intact as they may be used by other schemas
-- If you need to remove extensions, run:
-- DROP EXTENSION IF EXISTS "pgvector";
-- DROP EXTENSION IF EXISTS "uuid-ossp";