# Task: CRITICAL - Merge BAML Service & Fix Docker Paths
**Task ID:** CRITICAL-MERGE-001  
**Priority:** critical  
**Assignee:** agent-001  
**Created:** 2025-08-13T18:12:47.267Z

## Objective
Execute immediate branch merge and fix critical path mismatches to unblock all development streams

## Requirements
- [x] Merge task/BACKFILL-004-VALIDATED branch containing complete BAML service
- [ ] Fix docker-compose.yml path references (services/hono/ → services/hono-api/, etc.)
- [ ] Create missing Dockerfile.dev files for development containers
- [ ] Validate all containers build successfully
- [ ] Test service accessibility on correct ports

## Files to Focus On
- docker-compose.yml (fix path references)
- services/hono-api/Dockerfile.dev (CREATE)
- services/elixir_service/Dockerfile.dev (CREATE)
- services/baml-service/Dockerfile.dev (MERGED)
- services/baml-service/ (MERGED)

## Dependencies
None

## Labels
critical, infrastructure, docker, merge, P0

## Status
- [x] Task assigned and workspace created
- [ ] Development started
- [ ] Implementation complete
- [ ] Tests written
- [ ] Code reviewed
- [ ] Task complete

## Notes
Auto-generated from kanban.yaml on 2025-08-13T18:12:47.268Z
