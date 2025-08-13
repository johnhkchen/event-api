# Task: Implement Missing BAML Service
**Task ID:** BACKFILL-004-VALIDATED  
**Priority:** critical  
**Assignee:** agent-001  
**Created:** 2025-08-13T16:57:26.176Z

## Objective
Create BAML service for intelligent HTML data extraction that is completely missing

## Requirements
- [ ] BAML service HTTP API with /extract endpoint
- [ ] HTML parsing and structured data extraction
- [ ] Integration with OpenAI API for content analysis
- [ ] Response caching for identical HTML content
- [ ] Error handling and validation
- [ ] Rate limiting for OpenAI API calls
- [ ] Structured output schemas for events, speakers, companies
- [ ] Performance monitoring and logging
- [ ] Docker containerization

## Files to Focus On
- services/baml-service/main.py
- services/baml-service/schemas/
- services/baml-service/requirements.txt
- services/baml-service/Dockerfile
- services/baml-service/Dockerfile.dev
- services/baml-service/config/

## Dependencies
None

## Labels
critical, ai, extraction, missing-service, P0

## Status
- [x] Task assigned and workspace created
- [ ] Development started
- [ ] Implementation complete
- [ ] Tests written
- [ ] Code reviewed
- [ ] Task complete

## Notes
Auto-generated from kanban.yaml on 2025-08-13T16:57:26.176Z
