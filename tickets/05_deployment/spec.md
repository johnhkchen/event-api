# Flox to Production Pipeline - Stream 5

**Epic ID**: DEPLOY-EPIC-001  
**Priority**: P2 - Medium (Production deployment readiness)  
**Estimated Effort**: 1-2 sprints  
**Owner**: DevOps Team  

## Business Value & Objectives

Transform the Flox development environment into production-ready containers and establish automated deployment to homelab via Coolify, ensuring seamless transition from development to production with zero configuration drift.

## Epic Acceptance Criteria

- [ ] One-command production container generation from Flox environment
- [ ] Coolify deployment automation with zero-downtime updates
- [ ] Multi-environment strategy (staging/production) with branch triggers
- [ ] GitHub worktree workflow integration for parallel deployments
- [ ] SSL automation and domain management via Coolify
- [ ] Basic monitoring and backup automation

## Service Dependencies

**Depends On**: Integration testing complete (INTEGRATION-EPIC-001)  
**Prerequisites**: All services functional and tested  
**Enables**: Production user access and scaling  

---

## Tickets Breakdown

### DEPLOY-FEAT-001: Flox Production Container Strategy
**Priority**: P0 | **Effort**: 2-3 days | **Type**: Infrastructure

#### Description
Establish the pattern for converting the unified Flox development environment into production-ready containers, leveraging the complete stack defined in CLAUDE.md.

#### Acceptance Criteria
- [ ] Single `flox containerize` command creates deployable container
- [ ] Container includes all services (Hono, Elixir, BAML, Database)
- [ ] Production environment variables injection working
- [ ] Container optimized for startup time and resource usage
- [ ] Health checks integrated for all services

#### Implementation Details
```bash
# Simple production build from Flox environment
flox activate
flox containerize --tag event-api:$(git rev-parse --short HEAD) --file - | docker load

# Container contains entire stack ready for Coolify
docker run -d \
  --name event-api-production \
  -p 3000:3000 \
  -p 4000:4000 \
  -e DATABASE_URL="postgresql://..." \
  -e OPENAI_API_KEY="..." \
  event-api:$(git rev-parse --short HEAD)
```

#### Flox Environment Structure
```toml
# .flox/env/manifest.toml production overrides
[environment]
# Database configuration for production
DATABASE_URL = { value = "$DATABASE_URL" }
POSTGRES_DB = { value = "event_api_production" }

# Service URLs for internal communication
HONO_PORT = { value = "3000" }
ELIXIR_PORT = { value = "4000" }
BAML_PORT = { value = "8080" }

# Production optimizations
DOCKER_BUILDKIT = { value = "1" }
```

---

### DEPLOY-FEAT-002: Coolify Project Configuration
**Priority**: P0 | **Effort**: 1-2 days | **Type**: Platform Setup

#### Description
Configure Coolify to deploy the Flox-generated container with automated SSL, domain management, and basic monitoring.

#### Acceptance Criteria
- [ ] Coolify instance operational on homelab server
- [ ] Event API project imported with Docker deployment
- [ ] SSL certificates automated via Let's Encrypt
- [ ] Domain routing configured (api.yourdomain.com)
- [ ] Environment variables managed through Coolify UI

#### Implementation Details
```bash
# Coolify installation on homelab
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash

# Import project via Git repository
# Coolify will detect docker-compose.yml and manage deployment
```

#### Coolify Configuration
```yaml
# docker-compose.yml (for Coolify detection)
version: '3.8'

services:
  event-api:
    image: event-api:latest
    ports:
      - "3000:3000"
      - "4000:4000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  database:
    image: pgvector/pgvector:pg15
    environment:
      - POSTGRES_DB=${POSTGRES_DB}
      - POSTGRES_USER=${POSTGRES_USER} 
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  postgres_data:
```

---

### DEPLOY-FEAT-003: GitHub Worktree Deployment Workflow
**Priority**: P1 | **Effort**: 2-3 days | **Type**: Automation

#### Description
Implement GitHub Actions workflow that uses worktrees for isolated deployments, building Flox containers and deploying via Coolify webhooks.

#### Acceptance Criteria
- [ ] GitHub Actions workflow for main/staging branches
- [ ] Worktree isolation for concurrent deployments
- [ ] Flox container build automation
- [ ] Coolify webhook integration for deployments
- [ ] Rollback capability via previous containers

#### Implementation Details
```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main, staging]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        
      - name: Install Flox
        uses: flox/install-flox-action@v1
        
      - name: Create deployment worktree
        run: |
          git worktree add ../deploy-${{ github.ref_name }} ${{ github.ref_name }}
          cd ../deploy-${{ github.ref_name }}
          
      - name: Build production container
        run: |
          cd ../deploy-${{ github.ref_name }}
          flox activate
          flox containerize \
            --tag event-api:${{ github.ref_name }}-${{ github.sha }} \
            --file container.tar
            
      - name: Deploy to Coolify
        run: |
          curl -X POST "${{ secrets.COOLIFY_WEBHOOK_URL }}" \
            -H "Content-Type: application/json" \
            -d '{
              "image": "event-api:${{ github.ref_name }}-${{ github.sha }}",
              "environment": "${{ github.ref_name }}"
            }'
            
      - name: Cleanup worktree
        run: |
          git worktree remove ../deploy-${{ github.ref_name }}
```

#### Worktree Deployment Strategy
```bash
# Manual deployment workflow
git worktree add ../production-deploy main
cd ../production-deploy

# Build in isolated environment
flox activate
flox containerize --tag event-api:prod-$(git rev-parse --short HEAD)

# Deploy via Coolify
curl -X POST "https://coolify.homelab.local/webhook/deploy" \
  -d "image=event-api:prod-$(git rev-parse --short HEAD)"

# Cleanup
cd ../event-api
git worktree remove ../production-deploy
```

---

### DEPLOY-FEAT-004: Production Environment Hardening
**Priority**: P2 | **Effort**: 1-2 days | **Type**: Security & Performance

#### Description
Apply production-ready configurations including SSL automation, basic monitoring, and backup strategies through Coolify's built-in features.

#### Acceptance Criteria
- [ ] SSL certificates auto-renewed via Let's Encrypt
- [ ] Basic health monitoring and alerting configured
- [ ] Automated database backups enabled
- [ ] Environment variables secured
- [ ] Basic logging and metrics collection

#### Production Configuration
```bash
# Coolify environment variables (via UI)
DATABASE_URL=postgresql://user:pass@db:5432/event_api_production
OPENAI_API_KEY=sk-...
POSTGRES_PASSWORD=secure_production_password

# SSL configuration (automatic via Coolify)
# Domain: api.yourdomain.com
# SSL: Let's Encrypt (auto-renewal enabled)

# Backup configuration (via Coolify)
# Database backup: Daily at 2 AM
# Retention: 30 days
# Storage: Local homelab storage
```

#### Health Monitoring
```dockerfile
# Flox container includes health checks
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/health && \
      curl -f http://localhost:4000/health || exit 1
```

---

## Integration with Project Architecture

### Deployment Flow
```mermaid
graph LR
    A[Developer Push] --> B[GitHub Actions]
    B --> C[Create Worktree]
    C --> D[Flox Activate]
    D --> E[Flox Containerize]
    E --> F[Coolify Deploy]
    F --> G[Production Live]
```

### Service Dependencies
- **Database**: PostgreSQL with pgvector + AGE (from DB-EPIC-001)
- **Hono API**: Public API service (from HONO-EPIC-001)  
- **Elixir Service**: Data processing engine (from ELIXIR-EPIC-001)
- **BAML Service**: AI extraction service (integrated in Flox environment)

### Worktree Workflow Benefits
- **Isolation**: Parallel development and deployment branches
- **Safety**: No interference between development and production builds
- **Reproducibility**: Exact environment state preservation
- **Simplicity**: Single `flox containerize` command from any worktree

## Testing Strategy

### Deployment Testing
- Container build success validation
- Health check endpoint verification  
- SSL certificate functionality
- Database connectivity testing

### Production Validation
- All API endpoints accessible via domain
- Event scraping → processing → storage workflow
- Database persistence across container restarts
- Backup and restore procedures

## Definition of Done

- [ ] Single command deployment from Flox environment to production
- [ ] GitHub Actions automate worktree → container → Coolify workflow
- [ ] SSL certificates automated and auto-renewing
- [ ] Basic monitoring and backup operational
- [ ] Documentation for manual deployment procedures
- [ ] Rollback capability via previous container versions