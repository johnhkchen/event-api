# Event API Coolify Deployment Guide

Complete step-by-step guide for deploying the Event API to production using Coolify.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Pre-Deployment Setup](#pre-deployment-setup)
- [Coolify Project Configuration](#coolify-project-configuration)
- [Environment Variables Setup](#environment-variables-setup)
- [Domain and SSL Configuration](#domain-and-ssl-configuration)
- [Database Setup](#database-setup)
- [Application Deployment](#application-deployment)
- [Health Monitoring](#health-monitoring)
- [Backup Configuration](#backup-configuration)
- [Troubleshooting](#troubleshooting)
- [Post-Deployment Verification](#post-deployment-verification)

## Prerequisites

### Server Requirements

- **OS**: Ubuntu 20.04+ or Debian 11+
- **RAM**: Minimum 4GB, recommended 8GB+
- **CPU**: 2+ cores recommended
- **Disk**: 50GB+ available space
- **Network**: Public IP address with ports 80, 443 open

### Domain Requirements

- Domain name pointed to your server (e.g., `api.yourdomain.com`)
- DNS A records configured for:
  - `api.yourdomain.com` (main API)
  - `admin.yourdomain.com` (admin interface)
  - `ml.yourdomain.com` (ML service, optional)

### Software Prerequisites

- **Coolify**: Latest version installed and running
- **Docker**: Version 20.10+ (installed with Coolify)
- **Git**: For repository access

### Development Prerequisites

- **Flox environment**: With `flox containerize` functionality (DEPLOY-FEAT-001)
- **Container image**: Built using `flox containerize` command

## Pre-Deployment Setup

### 1. Verify Container Build

Ensure your Event API container is ready:

```bash
# In your development environment
flox activate
flox containerize

# Verify the container exists
docker images | grep event-api
```

### 2. Prepare Configuration Files

Copy the Coolify-specific configuration files:

```bash
# Copy the main deployment configuration
cp docker-compose.coolify.yml docker-compose.production.yml

# Copy environment template
cp .env.production.template .env.production.example
```

### 3. Push to Git Repository

Ensure your code is in a Git repository accessible by Coolify:

```bash
git add .
git commit -m "feat: Add Coolify production deployment configuration"
git push origin main
```

## Coolify Project Configuration

### 1. Create New Project

1. **Open Coolify Dashboard**
   - Navigate to your Coolify installation
   - Login with administrator credentials

2. **Create Project**
   - Click "New Project"
   - Project Name: `Event API`
   - Description: `AI-powered event aggregation and processing API`
   - Click "Create"

### 2. Connect Git Repository

1. **Add Git Source**
   - Go to "Sources" → "New"
   - Choose your Git provider (GitHub, GitLab, etc.)
   - Configure repository access
   - Test connection

2. **Configure Repository**
   - Repository URL: `https://github.com/your-username/event-api`
   - Branch: `main`
   - Build Pack: `Docker Compose`
   - Docker Compose File: `docker-compose.coolify.yml`

### 3. Configure Build Settings

1. **Build Configuration**
   - Build Command: `echo "Using pre-built Flox container"`
   - Install Command: `echo "No install needed"`
   - Start Command: `docker-compose up -d`

2. **Advanced Settings**
   - Enable "Watch Paths" for automatic deployments
   - Set "Health Check" URL to `/health`
   - Configure "Port" to `3000`

## Environment Variables Setup

### 1. Access Environment Configuration

1. Navigate to your Event API project in Coolify
2. Go to "Environment Variables" section
3. Choose "Production" environment

### 2. Configure Critical Variables

Add these variables in order of priority:

**🔐 Security Variables** (Set first):
```bash
POSTGRES_PASSWORD=<click-generate-secure-password>
SESSION_SECRET=<click-generate-32-char-string>
JWT_SECRET=<click-generate-32-char-string>
ENCRYPTION_KEY=<click-generate-32-char-string>
OPENAI_API_KEY=sk-your-production-openai-key-here
```

**🌐 Domain Configuration**:
```bash
DOMAIN=api.yourdomain.com
ADMIN_DOMAIN=admin.yourdomain.com
ML_DOMAIN=ml.yourdomain.com
SSL_EMAIL=admin@yourdomain.com
```

**💾 Database Configuration**:
```bash
DATABASE_URL=postgresql://event_api_prod:${POSTGRES_PASSWORD}@postgres:5432/event_api_production
POSTGRES_DB=event_api_production
POSTGRES_USER=event_api_prod
```

**⚙️ Application Settings**:
```bash
NODE_ENV=production
MIX_ENV=prod
LOG_LEVEL=info
HONO_PORT=3000
ELIXIR_PORT=4000
BAML_PORT=8080
```

### 3. Optional Configuration

**📊 Monitoring & Alerting**:
```bash
ALERT_EMAIL=alerts@yourdomain.com
SENTRY_DSN=https://your-sentry-dsn-here
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
```

**🔧 Performance Tuning**:
```bash
APP_MEMORY_LIMIT=2G
APP_CPU_LIMIT=2.0
DB_MEMORY_LIMIT=1G
DB_CPU_LIMIT=1.0
REDIS_MAX_MEMORY=256mb
```

### 4. Variable Validation

Use the validation checklist:

- [ ] All required variables are set
- [ ] No variables show "undefined" in preview
- [ ] DATABASE_URL is properly formatted
- [ ] Secrets are marked as "Hidden"
- [ ] Domain names are correct

## Domain and SSL Configuration

### 1. Configure Domains in Coolify

1. **Access Domain Settings**
   - Go to your project → "Domains"
   - Click "Add Domain"

2. **Add Primary Domain**
   - Domain: `api.yourdomain.com`
   - Port: `3000`
   - Enable "SSL/TLS"
   - Enable "Force HTTPS redirect"

3. **Add Additional Domains**
   - `admin.yourdomain.com` → Port `4000`
   - `ml.yourdomain.com` → Port `8080`
   - Configure SSL for each domain

### 2. SSL Certificate Configuration

1. **Let's Encrypt Setup**
   - Enable "Let's Encrypt" for all domains
   - Email: Use the same as `SSL_EMAIL` environment variable
   - Enable "Auto-renewal"

2. **SSL Security Settings**
   - Enable "HTTP to HTTPS redirect"
   - Enable "HSTS headers"
   - Set "SSL/TLS version" to "Modern"

### 3. Verify DNS Configuration

Before proceeding, verify DNS:

```bash
# Test DNS resolution
nslookup api.yourdomain.com
nslookup admin.yourdomain.com
nslookup ml.yourdomain.com

# Test HTTP connectivity (before SSL)
curl -I http://api.yourdomain.com/health
```

## Database Setup

### 1. PostgreSQL Container Configuration

The database is configured in `docker-compose.coolify.yml`:

- **Image**: `pgvector/pgvector:pg15-v0.7.4`
- **Extensions**: pgvector, AGE, uuid-ossp
- **Persistence**: Dedicated volume `postgres-data`
- **Backup**: Configured for daily backups

### 2. Database Initialization

The database will be automatically initialized with:

- Required extensions (pgvector, AGE, uuid-ossp)
- Database user and permissions
- Initial schema (via migrations)

### 3. Database Migration

After deployment, run migrations:

```bash
# Option 1: Via Coolify terminal
# Access container terminal in Coolify UI
cd /app/services/elixir-service
mix ecto.migrate

# Option 2: Via API endpoint (if configured)
curl -X POST https://admin.yourdomain.com/internal/migrate \
  -H "Authorization: Bearer <admin-token>"
```

## Application Deployment

### 1. Initial Deployment

1. **Start Deployment**
   - Go to your project in Coolify
   - Click "Deploy" button
   - Monitor deployment logs

2. **Deployment Process**
   - Coolify pulls the Git repository
   - Builds using `docker-compose.coolify.yml`
   - Sets up networking and volumes
   - Starts all services

3. **Monitor Progress**
   - Watch "Deployment Logs"
   - Check "Service Status"
   - Verify "Health Checks"

### 2. Service Startup Order

Services start in this order:
1. **PostgreSQL** - Database with health checks
2. **Redis** - Caching layer
3. **Event API** - Main application container
4. **Nginx** - Reverse proxy and SSL termination

### 3. Deployment Verification

Check deployment status:

```bash
# Test main API endpoint
curl https://api.yourdomain.com/health

# Test admin interface
curl https://admin.yourdomain.com/health

# Test ML service (if exposed)
curl https://ml.yourdomain.com/health
```

## Health Monitoring

### 1. Coolify Health Checks

Automatic monitoring configured:

- **Health Check URL**: `/health/coolify`
- **Check Interval**: 30 seconds
- **Timeout**: 15 seconds
- **Retries**: 3

### 2. Service-Level Monitoring

Individual service health endpoints:

- **Main API**: `GET /health` - Overall system status
- **Detailed**: `GET /health/coolify` - Coolify-specific format
- **Simple**: `GET /health/simple` - Load balancer format
- **Liveness**: `GET /health/live` - Container liveness
- **Readiness**: `GET /health/ready` - Traffic readiness

### 3. Alert Configuration

Configure alerts in Coolify:

1. **Email Alerts**
   - Recipients: From `ALERT_EMAIL` environment variable
   - Events: Service down, deployment failed, resource limits

2. **Webhook Alerts**
   - URL: From `ALERT_WEBHOOK_URL` environment variable
   - Format: JSON payload with event details

## Backup Configuration

### 1. Database Backups

Automated PostgreSQL backups:

- **Schedule**: Daily at 2 AM UTC
- **Retention**: 30 days
- **Location**: Coolify backup storage
- **Format**: SQL dump with compression

### 2. Application Data Backups

Important volumes backed up:

- `postgres-data`: Database files (high priority)
- `app-logs`: Application logs
- `letsencrypt-certs`: SSL certificates

### 3. Manual Backup Commands

```bash
# Create manual database backup
docker exec event-api-postgres pg_dump -U event_api_prod event_api_production > backup.sql

# Export container image
docker save event-api:latest > event-api-backup.tar

# Backup SSL certificates
tar -czf ssl-certs-backup.tar.gz /etc/letsencrypt/
```

## Troubleshooting

### Common Deployment Issues

**1. Container Won't Start**

```bash
# Check deployment logs in Coolify UI
# Or via command line:
docker logs event-api-app

# Check resource usage
docker stats

# Verify environment variables
docker exec event-api-app env | grep -E "(DATABASE|POSTGRES|OPENAI)"
```

**2. Database Connection Issues**

```bash
# Test database connectivity
docker exec event-api-postgres pg_isready -U event_api_prod

# Check database logs
docker logs event-api-postgres

# Test connection from app container
docker exec event-api-app psql $DATABASE_URL -c "SELECT version();"
```

**3. SSL Certificate Issues**

```bash
# Check certificate status
curl -vI https://api.yourdomain.com/

# Verify Let's Encrypt certificates
docker exec nginx cat /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem

# Test SSL configuration
openssl s_client -connect api.yourdomain.com:443 -servername api.yourdomain.com
```

**4. Health Check Failures**

```bash
# Test health endpoints directly
curl -f https://api.yourdomain.com/health
curl -f https://api.yourdomain.com/health/coolify

# Check individual services
docker exec event-api-app curl -f http://localhost:3000/health
docker exec event-api-app curl -f http://localhost:4000/health
docker exec event-api-app curl -f http://localhost:8080/health
```

### Service-Specific Issues

**Hono API Service**:
```bash
# Check Hono service logs
docker exec event-api-app tail -f /app/services/hono-api/logs/app.log

# Test API endpoints
curl -X POST https://api.yourdomain.com/api/scrape/luma -H "Content-Type: application/json" -d '{}'
```

**Elixir Service**:
```bash
# Check Elixir service status
docker exec event-api-app mix ecto.migrations

# View Phoenix logs
docker exec event-api-app tail -f /app/services/elixir-service/logs/phoenix.log
```

**BAML Service**:
```bash
# Check Python service logs
docker exec event-api-app tail -f /app/services/baml-service/logs/app.log

# Test AI processing
curl -X POST https://api.yourdomain.com/api/internal/process -H "Content-Type: application/json"
```

### Resource Issues

**High Memory Usage**:
```bash
# Monitor container resources
docker stats --no-stream

# Check PostgreSQL memory usage
docker exec event-api-postgres psql -U event_api_prod -c "SELECT * FROM pg_stat_activity;"

# Adjust memory limits in Coolify UI
```

**High CPU Usage**:
```bash
# Identify resource-intensive processes
docker exec event-api-app top

# Check database query performance
docker exec event-api-postgres psql -U event_api_prod -c "SELECT * FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10;"
```

## Post-Deployment Verification

### 1. Functional Testing

**API Endpoints**:
```bash
# Health check
curl https://api.yourdomain.com/health

# Event listing
curl https://api.yourdomain.com/api/events

# Search functionality
curl "https://api.yourdomain.com/api/events/search?q=conference"
```

**Admin Interface**:
```bash
# Admin health
curl https://admin.yourdomain.com/health

# Processing status
curl https://admin.yourdomain.com/internal/status
```

### 2. Performance Testing

**Load Testing**:
```bash
# Basic load test (install apache2-utils)
ab -n 100 -c 10 https://api.yourdomain.com/api/events

# More comprehensive testing with curl
for i in {1..50}; do
  curl -s https://api.yourdomain.com/health > /dev/null && echo "Request $i: OK"
done
```

**Database Performance**:
```bash
# Check query performance
docker exec event-api-postgres psql -U event_api_prod -c "
  SELECT query, mean_time, calls 
  FROM pg_stat_statements 
  ORDER BY mean_time DESC LIMIT 5;
"
```

### 3. Security Verification

**SSL Security**:
```bash
# Test SSL configuration
curl -vI https://api.yourdomain.com/ 2>&1 | grep -E "(SSL|TLS)"

# Check SSL grade (requires sslyze)
sslyze --regular api.yourdomain.com
```

**Header Security**:
```bash
# Check security headers
curl -I https://api.yourdomain.com/ | grep -E "(Strict-Transport-Security|X-Content-Type-Options|X-Frame-Options)"
```

### 4. Monitoring Setup Verification

**Health Monitoring**:
- Verify Coolify shows all services as healthy
- Check that health check alerts are configured
- Test alert notifications (if possible)

**Log Monitoring**:
- Verify logs are being collected in Coolify
- Check log rotation is working
- Ensure sensitive data is not logged

### 5. Backup Verification

**Database Backup**:
```bash
# Test backup creation
docker exec event-api-postgres pg_dump -U event_api_prod event_api_production > test-backup.sql

# Verify backup integrity
head -20 test-backup.sql
```

**Container Backup**:
```bash
# Test container export
docker save event-api:latest > test-container-backup.tar

# Verify backup size
ls -lh test-container-backup.tar
```

## Maintenance and Updates

### Regular Maintenance

**Weekly**:
- [ ] Review application logs for errors
- [ ] Check resource usage trends
- [ ] Verify SSL certificate status
- [ ] Test health endpoints

**Monthly**:
- [ ] Update container with latest dependencies
- [ ] Review and rotate API keys if needed
- [ ] Check backup integrity
- [ ] Review security configurations

**Quarterly**:
- [ ] Update Coolify to latest version
- [ ] Review and update SSL/TLS configuration
- [ ] Conduct security audit
- [ ] Performance optimization review

### Update Deployment

**Code Updates**:
```bash
# Push new code
git add .
git commit -m "feat: new feature implementation"
git push origin main

# Trigger deployment in Coolify
# Or use webhook for automatic deployment
```

**Configuration Updates**:
1. Update environment variables in Coolify UI
2. Restart affected services
3. Verify configuration changes
4. Monitor for issues

**Container Updates**:
```bash
# Build new container with flox
flox activate
flox containerize

# Tag and push new version
docker tag event-api:latest event-api:v1.1.0

# Update deployment in Coolify
```

## Getting Help

### Documentation Resources

- **Coolify Documentation**: [coolify.io/docs](https://coolify.io/docs)
- **Event API Documentation**: `docs/` directory
- **Service-Specific Docs**: `tickets/` directory

### Log Locations

- **Application Logs**: Available in Coolify UI
- **Deployment Logs**: Coolify deployment history
- **System Logs**: `/var/log/` on server
- **SSL Logs**: `/var/log/letsencrypt/`

### Support Channels

For deployment issues:

1. **Check Logs**: Start with Coolify deployment and service logs
2. **Health Endpoints**: Verify all services are responding
3. **Environment**: Confirm all variables are correctly set
4. **Documentation**: Review service-specific documentation
5. **Community**: Coolify Discord or GitHub issues

Include this information when requesting help:
- Coolify version
- Error messages from logs
- Environment configuration (no secrets)
- Steps to reproduce the issue
- Expected vs actual behavior