# Services Directory

This directory contains the individual service implementations for the Event API platform.

## Service Architecture

- **hono-api/**: TypeScript service using Hono framework for web scraping and public API
- **elixir-service/**: Elixir/Phoenix service for complex data processing and graph queries  
- **baml-service/**: BAML service for AI-powered data extraction from HTML

## Development Workflow

Each service is developed independently but shares the unified Flox environment:

```bash
# Work on individual services
cd services/hono-api
# Service-specific development

# Or use the unified Flox environment
flox activate  # Works from repo root for all services
```

## Containerization Strategy

Services are containerized together via `flox containerize` which creates a unified production container with all services included, rather than separate containers per service.

See the main project documentation for deployment details.