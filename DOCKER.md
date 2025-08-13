# Docker Integration with Flox

This document describes how Docker containers are generated and used in the Event API project.

## Container Strategy

The project uses **Flox containerization** to create production-ready Docker containers that include the complete development environment and all services.

### Key Benefits

- **Development-Production Parity**: Containers contain the exact same environment as development
- **Reproducible Builds**: Nix-based packages ensure identical software versions
- **Single Container**: All services (Hono API, Elixir Processing, BAML) run in one container
- **Zero Configuration Drift**: What works in development works in production

## Quick Start

### Development Environment

```bash
# Start development database
docker compose up -d database

# Or use the setup script
./scripts/docker/dev-setup.sh
```

### Production Container

```bash
# Build production container
./scripts/docker/build-production.sh

# The script will:
# 1. Create Docker image: event-api:<commit-hash>
# 2. Create backup tar file: event-api-<commit-hash>.tar
```

## Container Contents

The Flox-generated container includes:

- **Node.js v22.17.0** - For Hono API service
- **PostgreSQL client tools** - For database operations  
- **Docker & curl** - For containerization and health checks
- **Git** - For version control operations
- **Complete Flox environment** - All development tools and dependencies

## Container Usage

```bash
# Run with command
docker run --rm event-api:<tag> -c "node --version"

# Run services (ports 3000, 4000, 8080)  
docker run -d --name event-api \
  -p 3000:3000 -p 4000:4000 -p 8080:8080 \
  -e DATABASE_URL="postgresql://..." \
  event-api:<tag>

# Health check
docker run --rm event-api:<tag> -c "curl -f http://localhost:3000/health"
```

## Production Deployment

The containers are designed for deployment via **Coolify** using the `docker-compose.production.yml` configuration.

### Environment Variables (Production)

```bash
DATABASE_URL=postgresql://user:pass@host:5432/event_api_production
OPENAI_API_KEY=sk-your-key-here
NODE_ENV=production
MIX_ENV=prod
```

## Development vs Production

### Development
- Uses `docker-compose.yml` 
- External database service
- Individual service development
- Hot reloading and debugging tools

### Production  
- Uses `docker-compose.production.yml`
- Flox-generated unified container
- All services in single container
- Optimized for deployment and scaling

## File Structure

```
├── docker-compose.yml              # Development environment
├── docker-compose.production.yml   # Production deployment  
├── Dockerfile                      # Reference (use Flox instead)
├── .dockerignore                   # Container build exclusions
├── scripts/docker/
│   ├── build-production.sh         # Build production container
│   ├── dev-setup.sh                # Setup development environment
│   ├── init-db.sql                 # Database initialization
│   └── dev-nginx.conf              # Development proxy config
└── services/                       # Individual service code
```

## Troubleshooting

### Container Size (3.8GB)
This is normal for Flox containers as they include the complete Nix environment. The benefits of reproducibility outweigh the size cost.

### MCP Warnings in Container
The container activation shows MCP setup warnings - this is expected as the container doesn't have access to the Claude CLI. Services will work normally.

### Missing Tools
If you need additional tools in the container, add them to `.flox/env/manifest.toml` in the `[install]` section.

## GitHub Worktree Integration

Containers can be built from any Git worktree, allowing parallel development and deployment:

```bash
# Create deployment worktree
git worktree add ../production main
cd ../production

# Build container from worktree
./scripts/docker/build-production.sh

# Deploy via Coolify
# (container includes exact state of worktree)
```

This ensures perfect isolation between development branches and production deployments.