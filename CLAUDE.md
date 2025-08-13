# Event API - Claude Development Environment Guide

## Environment Setup

This project uses **Flox** for reproducible, cross-platform development environments. The setup includes automated MCP server configuration for AI/LLM workflows.

### Quick Start

```bash
# Activate the development environment
flox activate

# The environment will automatically:
# ✅ Verify all dependencies are available
# ✅ Check/setup MCP context7 server for documentation access
# ✅ Load environment variables from manifest.toml
# ✅ Confirm cross-platform compatibility
```

### Environment Features

**Automated MCP Setup**: The environment automatically verifies and configures the context7 MCP server, eliminating manual setup steps.

**Reproducible Dependencies**: All required packages are explicitly defined in `.flox/env/manifest.toml` rather than relying on system-level packages.

**Cross-Platform**: Works identically on macOS and Linux (ARM/x86-64) using Flox's built-in bash interpreter.

## Project Architecture

This is a **hybrid Elixir + Hono microservices architecture** for event data processing:

- **Hono Service** (TypeScript): Web scraping, CRUD operations, user-facing API
- **Elixir Service** (Phoenix): Complex data processing, graph relationships, AI workflows  
- **Database**: Postgres with pgvector + AGE extensions for vector search and graph queries

### Key API Endpoints

```typescript
// Hono Service - External API
POST /api/scrape/luma          // Scrape Lu.ma events
GET  /api/events               // List events with filters  
GET  /api/events/search        // Vector/text search
POST /api/events/batch         // Batch operations

// Elixir Service - Internal Processing
POST /internal/process         // Process scraped HTML with AI
GET  /internal/graph/:query    // Graph relationship queries
POST /internal/deduplicate     // AI-powered deduplication
GET  /internal/recommend       // Recommendation engine
```

## Development Workflow

### Environment Verification

The Flox environment automatically runs health checks on activation:
- Verifies MCP context7 server is configured
- Loads environment variables from manifest
- Confirms all declared tools are available
- Validates cross-platform consistency

### Database Schema

Key tables for AI/LLM workflows:
- `events`: Core event data with vector embeddings
- `speakers`: Deduplicated speaker information  
- `companies`: Normalized company tracking
- `topics`: AI-extracted categorization
- Graph relationships via AGE extension

### AI/LLM Integration Points

1. **Content Extraction**: BAML service processes scraped HTML
2. **Vector Search**: pgvector for semantic event discovery
3. **Deduplication**: Elixir GenServers for speaker/company matching
4. **Graph Analysis**: AGE for relationship discovery
5. **Recommendations**: Multi-agent processing pipelines

## Team Collaboration

### Environment Sharing

This environment is designed to be handed to another developer or AI agent and run identically:

```bash
# New team member setup
git clone <repo>
cd event-api
flox activate  # Everything configures automatically
```

### CI/CD Integration

The environment can be integrated into GitHub Actions using the "Install Flox" action to ensure CI matches local development exactly.

## Troubleshooting

### MCP Server Issues
If MCP setup fails, run manually:
```bash
claude mcp add context7 -- npx -y @upstash/context7-mcp
```

### Environment Reset
To reset the environment:
```bash
rm .mcp_setup_complete
flox activate  # Will re-run verification
```

### Service Dependencies
For the full stack, ensure these services are running:
- Postgres with pgvector + AGE extensions
- BAML service (port 8080) for AI extraction
- Phoenix service (port 4000) for processing
- Hono service (port 3000) for API

## Notes

- Environment variables are managed in `.flox/env/manifest.toml`
- No "works on my machine" issues due to Nix-based reproducibility
- Suitable for autonomous code modification and multi-agent workflows
- Designed for retrieval-augmented generation with vector search capabilities