# Task: Fix Critical Schema Synchronization
**Task ID:** BACKFILL-002  
**Priority:** high  
**Assignee:** agent-001  
**Created:** 2025-08-13T04:13:26.484Z

## Objective
Align Drizzle ORM schema with SQL migration to fix critical data model inconsistencies preventing any database operations

## Requirements
- [x] Add missing columns to Drizzle schema (normalized_name, confidence_score for speakers)
- [x] Create event_companies table in Drizzle schema (completely missing)
- [x] Add extraction_confidence field to event_speakers table
- [x] Update TypeScript types for all schema changes
- [x] Test schema compatibility between SQL and Drizzle
- [x] Generate new Drizzle migration to sync with existing SQL
- [x] Verify all relationship mappings work correctly

## Files to Focus On
- services/hono-api/drizzle/schema.ts
- services/hono-api/src/types/events.ts
- services/hono-api/src/types/speakers.ts
- services/hono-api/src/types/companies.ts
- services/hono-api/drizzle/migrations/

## Dependencies
None

## Labels
critical, database, schema-mismatch, P0

## Status
- [x] Task assigned and workspace created
- [x] Development started
- [x] Implementation complete
- [ ] Tests written
- [ ] Code reviewed
- [x] Task complete

## Notes
Auto-generated from kanban.yaml on 2025-08-13T04:13:26.485Z
