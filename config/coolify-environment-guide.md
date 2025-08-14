# Coolify Environment Variables Configuration Guide

This guide explains how to securely configure environment variables for the Event API in Coolify's UI.

## Overview

The Event API requires multiple environment variables for secure production deployment. These should be configured through Coolify's environment variable manager, not stored in the codebase.

## Required Environment Variables by Category

### 🔐 Critical Security Variables (Set First)

These variables contain sensitive information and must be set before deployment:

```bash
# Database Authentication
POSTGRES_PASSWORD=<generate-strong-password>
DATABASE_URL=postgresql://event_api_prod:<password>@postgres:5432/event_api_production

# API Keys
OPENAI_API_KEY=sk-<your-production-openai-key>

# Security Keys
SESSION_SECRET=<generate-random-32-char-string>
JWT_SECRET=<generate-random-32-char-string>
ENCRYPTION_KEY=<generate-random-32-char-string>
```

### 🌐 Domain Configuration

Configure your domain and SSL settings:

```bash
# Primary domain
DOMAIN=api.yourdomain.com

# SSL/TLS
SSL_EMAIL=admin@yourdomain.com

# Optional subdomains
ADMIN_DOMAIN=admin.yourdomain.com
HEALTH_DOMAIN=health.yourdomain.com
```

### 📊 Monitoring & Alerting

Set up monitoring and alert destinations:

```bash
# Basic alerting
ALERT_EMAIL=alerts@yourdomain.com

# Advanced monitoring (optional)
SENTRY_DSN=https://your-sentry-dsn-here
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
```

### 🔧 Application Configuration

Standard application settings:

```bash
# Environment
NODE_ENV=production
MIX_ENV=prod
LOG_LEVEL=info

# Database
POSTGRES_DB=event_api_production
POSTGRES_USER=event_api_prod

# Performance
POSTGRES_MAX_CONNECTIONS=200
POSTGRES_SHARED_BUFFERS=256MB
```

## Setting Variables in Coolify

### Step 1: Access Environment Variables

1. Open your Coolify dashboard
2. Navigate to your Event API project
3. Click on "Environment Variables" or "Configuration"
4. Choose "Environment Variables" tab

### Step 2: Add Variables by Priority

**Priority 1: Security Variables**
```
POSTGRES_PASSWORD → <click "Generate" for secure password>
SESSION_SECRET    → <click "Generate" for random string>
JWT_SECRET        → <click "Generate" for random string>
ENCRYPTION_KEY    → <click "Generate" for random string>
OPENAI_API_KEY    → sk-your-production-key-here
```

**Priority 2: Database Configuration**
```
DATABASE_URL      → postgresql://event_api_prod:${POSTGRES_PASSWORD}@postgres:5432/event_api_production
POSTGRES_DB       → event_api_production
POSTGRES_USER     → event_api_prod
```

**Priority 3: Domain Settings**
```
DOMAIN           → api.yourdomain.com
SSL_EMAIL        → admin@yourdomain.com
```

**Priority 4: Application Settings**
```
NODE_ENV         → production
MIX_ENV          → prod
LOG_LEVEL        → info
```

### Step 3: Verify Configuration

After setting variables, verify they're correctly configured:

1. Check "Preview" mode to see resolved variables
2. Ensure no variables show as "undefined" or "null"
3. Verify DATABASE_URL is correctly formatted
4. Confirm all secrets are marked as "Hidden" in the UI

## Environment Variable Security Best Practices

### ✅ Do's

- **Use Coolify's built-in secret generation** for passwords and keys
- **Mark sensitive variables as "secret"** in the UI
- **Use variable interpolation** for complex values (e.g., DATABASE_URL)
- **Test variables in staging** before production deployment
- **Document custom variables** in your team's knowledge base

### ❌ Don'ts

- **Never commit real secrets** to version control
- **Don't use default passwords** in production
- **Don't share production variables** via insecure channels
- **Don't use development keys** in production
- **Don't store API keys** in configuration files

## Variable Validation Checklist

Before deploying, ensure:

- [ ] All required variables are set
- [ ] Passwords are strong and unique
- [ ] API keys are production-specific
- [ ] Domain names point to your server
- [ ] DATABASE_URL is correctly formatted
- [ ] SSL email is valid and monitored
- [ ] Alert destinations are configured
- [ ] No development/test values in production

## Advanced Configuration

### Resource Limits

Optionally tune resource allocation:

```bash
# Application limits
APP_MEMORY_LIMIT=2G
APP_CPU_LIMIT=2.0
APP_MEMORY_RESERVE=512M
APP_CPU_RESERVE=0.5

# Database limits
DB_MEMORY_LIMIT=1G
DB_CPU_LIMIT=1.0
DB_MEMORY_RESERVE=256M
DB_CPU_RESERVE=0.25
```

### External Integrations

Configure optional external services:

```bash
# Email notifications
SMTP_HOST=smtp.yourdomain.com
SMTP_PORT=587
SMTP_USER=noreply@yourdomain.com
SMTP_PASSWORD=<email-service-password>

# Backup to S3
AWS_ACCESS_KEY_ID=<aws-access-key>
AWS_SECRET_ACCESS_KEY=<aws-secret-key>
AWS_S3_BUCKET=your-backup-bucket
AWS_S3_REGION=us-east-1
```

### Performance Tuning

For high-traffic deployments:

```bash
# API rate limiting
API_RATE_LIMIT=1000
API_RATE_WINDOW=900000

# Database performance
POSTGRES_SHARED_BUFFERS=512MB
POSTGRES_EFFECTIVE_CACHE_SIZE=2GB
POSTGRES_WORK_MEM=8MB

# Redis caching
REDIS_MAX_MEMORY=512mb
REDIS_MAX_MEMORY_POLICY=allkeys-lru
```

## Environment Variable Templates

### Minimal Production Setup

For basic production deployment:

```bash
# Required only
POSTGRES_PASSWORD=<generate>
OPENAI_API_KEY=sk-<your-key>
SESSION_SECRET=<generate>
JWT_SECRET=<generate>
ENCRYPTION_KEY=<generate>
DOMAIN=api.yourdomain.com
SSL_EMAIL=admin@yourdomain.com
```

### Complete Production Setup

For full-featured deployment:

```bash
# Copy from .env.production.template
# Configure all variables through Coolify UI
# See template file for complete list
```

## Troubleshooting Environment Variables

### Common Issues

**Application won't start:**
```bash
# Check required variables are set
docker exec <container> env | grep -E "(DATABASE|POSTGRES|OPENAI)"

# Verify database connection
docker exec <container> psql $DATABASE_URL -c "SELECT version();"
```

**SSL certificate issues:**
```bash
# Verify domain variables
echo $DOMAIN
echo $SSL_EMAIL

# Check DNS resolution
nslookup $DOMAIN
```

**Service communication failures:**
```bash
# Check internal URLs
echo $HONO_API_URL
echo $ELIXIR_SERVICE_URL
echo $BAML_SERVICE_URL

# Test service connectivity
docker exec <container> curl -f http://localhost:3000/health
```

### Variable Validation Commands

```bash
# List all environment variables
just env-check

# Validate critical variables
just validate-env

# Test database connection
just test-db-connection

# Check service health
just health-check
```

## Security Audit

### Monthly Security Review

1. **Rotate Secrets**: Change passwords and API keys
2. **Review Access**: Audit who has access to variables
3. **Check Logs**: Review for any credential leaks
4. **Update Keys**: Rotate encryption and session keys
5. **Verify SSL**: Ensure certificates are valid and renewed

### Emergency Procedures

**Suspected Key Compromise:**
1. Immediately change compromised secrets in Coolify
2. Restart affected services
3. Review access logs
4. Generate new keys/passwords
5. Update any dependent services

**Lost Access to Variables:**
1. Access Coolify with admin credentials
2. Export/backup current configuration
3. Reset individual variables as needed
4. Test services after changes
5. Update documentation

## Getting Help

For environment variable issues:

1. **Check Coolify logs** for deployment errors
2. **Review container logs** for runtime issues  
3. **Validate syntax** of complex variables like DATABASE_URL
4. **Test individual services** with curl commands
5. **Consult Coolify documentation** for platform-specific issues

Contact: Include environment variable names (not values) when requesting support.