# Event API Deployment Instructions

This guide covers deploying the Event API from development to production using Flox containerization and Coolify.

## Prerequisites

- **Development Environment**: Flox activated with all dependencies
- **Production Server**: Homelab server with Coolify installed
- **Domain**: Domain name configured for your homelab
- **Database**: PostgreSQL with pgvector + AGE extensions

## Quick Deployment Path

### 1. Build Production Container

From your development environment:

```bash
# Ensure you're in the project root
cd /path/to/event-api

# Activate Flox environment
flox activate

# Build production container
./scripts/docker/build-production.sh
```

This creates:
- Docker image: `event-api:<commit-hash>`
- Backup file: `event-api-<commit-hash>.tar`

### 2. Deploy via Coolify

#### Option A: Git Repository Deployment

1. **Push to Git Repository**:
   ```bash
   git add .
   git commit -m "Ready for deployment"
   git push origin main
   ```

2. **Configure Coolify Project**:
   - Open Coolify dashboard
   - Create new project: "Event API"
   - Connect Git repository
   - Use `docker-compose.production.yml` for deployment

#### Option B: Direct Container Deployment

1. **Transfer Container** (if needed):
   ```bash
   # Copy tar file to production server
   scp event-api-<commit-hash>.tar user@homelab-server:/tmp/
   
   # Load on production server
   ssh user@homelab-server
   docker load < /tmp/event-api-<commit-hash>.tar
   ```

2. **Deploy in Coolify**:
   - Create new Docker service
   - Use image: `event-api:<commit-hash>`
   - Configure environment variables

## Environment Configuration

### Required Environment Variables

Set these in Coolify's environment variable manager:

```bash
# Database Configuration
DATABASE_URL=postgresql://user:password@db-host:5432/event_api_production
POSTGRES_DB=event_api_production
POSTGRES_USER=event_api_prod
POSTGRES_PASSWORD=<secure_production_password>

# AI/LLM Services
OPENAI_API_KEY=sk-your-production-key-here

# Application Environment
NODE_ENV=production
MIX_ENV=prod

# Service Ports (auto-configured in container)
HONO_PORT=3000
ELIXIR_PORT=4000
BAML_PORT=8080
```

### Domain Configuration

Configure domains in Coolify:

```bash
# Primary API endpoint
api.yourdomain.com → Port 3000 (Hono API)

# Internal admin interface (optional)
admin.yourdomain.com → Port 4000 (Elixir Service)

# Health monitoring (optional)
health.yourdomain.com → Port 3000/health
```

## Database Setup

### 1. PostgreSQL with Extensions

Ensure your production database has required extensions:

```sql
-- Connect to your production database
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgvector";
CREATE EXTENSION IF NOT EXISTS "age";

-- Initialize AGE graph database
LOAD 'age';
SET search_path = ag_catalog, "$user", public;
SELECT create_graph('event_network');
```

### 2. Database Migrations

Run database migrations (once services are deployed):

```bash
# Connect to running container
docker exec -it <container-name> -c "cd services/elixir-service && mix ecto.migrate"

# Or via API endpoint
curl -X POST https://admin.yourdomain.com/internal/migrate \
  -H "Authorization: Bearer <admin-token>"
```

## SSL and Security

### Automatic SSL via Coolify

Coolify automatically handles SSL certificates:

1. **Let's Encrypt Integration**: Automatic certificate generation
2. **Auto-Renewal**: Certificates renew automatically
3. **HTTPS Redirect**: HTTP traffic redirected to HTTPS

### Security Checklist

- [ ] Environment variables secured in Coolify
- [ ] Database password is strong and unique
- [ ] API keys are production-specific
- [ ] Domain DNS properly configured
- [ ] Firewall allows ports 80, 443, and database port

## Monitoring and Health Checks

### Built-in Health Checks

The container includes health checks for all services:

```bash
# Container health check (automatic)
curl -f http://localhost:3000/health && curl -f http://localhost:4000/health

# External health check
curl -f https://api.yourdomain.com/health
curl -f https://admin.yourdomain.com/health
```

### Basic Monitoring

Coolify provides built-in monitoring:

- **Service Status**: Real-time service health
- **Resource Usage**: CPU, memory, disk usage
- **Logs**: Centralized log viewing
- **Alerts**: Email/webhook notifications for failures

## Deployment Workflows

### Manual Deployment

```bash
# 1. Build container
./scripts/docker/build-production.sh

# 2. Push to registry (if using)
docker tag event-api:<commit> your-registry/event-api:<commit>
docker push your-registry/event-api:<commit>

# 3. Update Coolify service
# - Update image tag in Coolify UI
# - Restart service
```

### GitHub Actions Deployment

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Flox
        uses: flox/install-flox-action@v1
        
      - name: Build container
        run: |
          flox activate
          ./scripts/docker/build-production.sh
          
      - name: Deploy to Coolify
        run: |
          curl -X POST "${{ secrets.COOLIFY_WEBHOOK_URL }}" \
            -H "Content-Type: application/json" \
            -d '{"ref": "${{ github.ref }}", "commit": "${{ github.sha }}"}'
```

### Git Worktree Deployment

For parallel deployments:

```bash
# Create production worktree
git worktree add ../event-api-production main

# Build from production worktree
cd ../event-api-production
flox activate
./scripts/docker/build-production.sh

# Deploy without affecting development
# Container includes exact production state

# Cleanup
cd ../event-api
git worktree remove ../event-api-production
```

## Troubleshooting

### Common Issues

**Container Won't Start**:
```bash
# Check logs
docker logs <container-name>

# Check environment variables
docker exec <container-name> -c "env | grep -E '(DATABASE|NODE|MIX)'"

# Test database connection
docker exec <container-name> -c "pg_isready -h db-host -p 5432"
```

**SSL Certificate Issues**:
- Verify domain DNS points to your server
- Check Coolify SSL settings
- Ensure ports 80/443 are open

**Database Connection Errors**:
- Verify `DATABASE_URL` format
- Check database server accessibility
- Confirm extensions are installed

**Service Communication Issues**:
- Check internal service URLs in environment
- Verify all services are running in container
- Test health endpoints

### Log Analysis

```bash
# View service logs
docker logs -f <container-name>

# Filter specific service logs
docker exec <container-name> -c "tail -f /app/services/hono-api/logs/app.log"

# Database query logs
docker exec <container-name> -c "tail -f /var/log/postgresql/postgresql.log"
```

## Backup and Recovery

### Database Backups

```bash
# Automated backup script (run via cron)
#!/bin/bash
BACKUP_DIR="/var/backups/event-api"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup
docker exec db-container pg_dump -U $POSTGRES_USER $POSTGRES_DB > \
  $BACKUP_DIR/event-api-$DATE.sql

# Retention (keep 30 days)
find $BACKUP_DIR -name "*.sql" -mtime +30 -delete
```

### Container Backups

```bash
# Backup running container
docker commit <container-name> event-api:backup-$(date +%Y%m%d)

# Export container
docker save event-api:backup-$(date +%Y%m%d) | gzip > event-api-backup.tar.gz
```

### Recovery Procedure

```bash
# 1. Restore database
docker exec -i db-container psql -U $POSTGRES_USER $POSTGRES_DB < backup.sql

# 2. Deploy previous container version
docker run -d --name event-api-restored event-api:backup-20240812

# 3. Update Coolify to point to restored container
```

## Performance Optimization

### Container Optimization

- **Resource Limits**: Set appropriate CPU/memory limits in Coolify
- **Volume Mounts**: Use volumes for persistent data
- **Network**: Use Docker networks for service communication

### Database Performance

```sql
-- Optimize common queries
EXPLAIN ANALYZE SELECT * FROM events WHERE location ILIKE '%city%';

-- Monitor slow queries
SELECT query, mean_time, calls 
FROM pg_stat_statements 
ORDER BY mean_time DESC LIMIT 10;
```

### Monitoring Metrics

Track these key metrics:

- **Response Time**: API endpoint latency
- **Throughput**: Requests per second
- **Error Rate**: Failed requests percentage
- **Resource Usage**: CPU, memory, disk I/O
- **Database Performance**: Query times, connection count

## Support and Maintenance

### Regular Maintenance

- [ ] Weekly: Review logs for errors
- [ ] Monthly: Update container with latest dependencies
- [ ] Quarterly: Review and rotate API keys
- [ ] As needed: Scale resources based on usage

### Getting Help

1. **Check Logs**: Always start with container and service logs
2. **Health Endpoints**: Verify all services are responding
3. **Environment**: Confirm all required variables are set
4. **Documentation**: Review service-specific docs in `tickets/` directory

For issues specific to individual services, refer to:
- `tickets/02_hono_api_service/spec.md` - Hono API issues
- `tickets/03_elixir_processing/spec.md` - Elixir service issues
- `tickets/01_database_foundation/spec.md` - Database issues