# Environment Separation Guide

## Overview

This guide outlines the environment separation strategy for the Event API project to ensure proper isolation between development, staging, and production environments.

## Environment Configuration

### Development Environment
- **Purpose**: Local development and testing
- **Database**: Local PostgreSQL container
- **Services**: Run locally via npm/mix commands
- **Configuration**: `docker-compose.yml` + `.env`
- **Ports**: 3000 (Hono), 4000 (Elixir), 8080 (BAML), 5432 (DB)

### Staging Environment  
- **Purpose**: Integration testing and pre-production validation
- **Database**: Dedicated staging database
- **Services**: Containerized via `docker-compose.staging.yml`
- **Configuration**: Environment variables via CI/CD
- **Ports**: 3001 (Hono), 4001 (Elixir), 8081 (BAML), 5433 (DB)

### Production Environment
- **Purpose**: Live application serving real users
- **Database**: Managed PostgreSQL service
- **Services**: Containerized via `docker-compose.production.yml`
- **Configuration**: Secure environment variables
- **Ports**: 3000 (Hono), 4000 (Elixir), 8080 (BAML), external DB

## Environment Variables Strategy

### Development (`.env`)
```bash
# Development Database
POSTGRES_DB=event_api_dev
POSTGRES_USER=event_api
POSTGRES_PASSWORD=development_password
DB_PORT=5432

# Service Configuration
NODE_ENV=development
MIX_ENV=dev
LOG_LEVEL=debug

# Development API Keys (limited/test keys)
OPENAI_API_KEY=sk-development-key

# Debug Features
ENABLE_DEBUG_ENDPOINTS=true
DISABLE_RATE_LIMITING=true
MOCK_EXTERNAL_SERVICES=true
```

### Staging (CI/CD Environment Variables)
```bash
# Staging Database
STAGING_DATABASE_URL=postgresql://staging_user:staging_pass@staging-db:5432/event_api_staging
POSTGRES_DB=event_api_staging
POSTGRES_USER=event_api_staging
POSTGRES_PASSWORD=${STAGING_DB_PASSWORD}

# Service Configuration
NODE_ENV=staging
MIX_ENV=dev
LOG_LEVEL=debug
IMAGE_TAG=staging-${GITHUB_SHA}

# Staging API Keys
STAGING_OPENAI_API_KEY=${STAGING_OPENAI_KEY}

# Staging Features
ENABLE_DEBUG_ENDPOINTS=true
DISABLE_RATE_LIMITING=true
MOCK_EXTERNAL_SERVICES=false
```

### Production (Secure Environment Variables)
```bash
# Production Database (Managed Service)
DATABASE_URL=${PRODUCTION_DATABASE_URL}
POSTGRES_DB=event_api_production
POSTGRES_USER=${PRODUCTION_DB_USER}
POSTGRES_PASSWORD=${PRODUCTION_DB_PASSWORD}

# Service Configuration
NODE_ENV=production
MIX_ENV=prod
LOG_LEVEL=info

# Production API Keys
OPENAI_API_KEY=${PRODUCTION_OPENAI_KEY}

# Production Security
ENABLE_DEBUG_ENDPOINTS=false
DISABLE_RATE_LIMITING=false
MOCK_EXTERNAL_SERVICES=false
```

## Database Separation

### Development Database
- **Type**: Docker container (pgvector/pgvector:pg15)
- **Persistence**: Local Docker volume
- **Data**: Sample development data
- **Extensions**: pgvector, uuid-ossp, AGE (if available)

### Staging Database
- **Type**: Dedicated staging server or cloud database
- **Persistence**: Persistent storage with backups
- **Data**: Production-like test data (anonymized)
- **Extensions**: Same as production
- **Access**: Limited to staging environment

### Production Database
- **Type**: Managed PostgreSQL service (AWS RDS, etc.)
- **Persistence**: High-availability with automated backups
- **Data**: Live production data
- **Extensions**: pgvector, uuid-ossp, AGE
- **Access**: Highly restricted, encrypted connections

## Network Isolation

### Development
- **Network**: Local Docker bridge network
- **Exposure**: All ports exposed to localhost
- **Security**: Basic, suitable for local development

### Staging
- **Network**: Isolated staging network
- **Exposure**: Limited port exposure, VPN access
- **Security**: SSL/TLS termination, basic authentication

### Production
- **Network**: Private VPC with security groups
- **Exposure**: Only necessary ports via load balancer
- **Security**: Full SSL/TLS, WAF, DDoS protection

## Service Configuration Differences

### Development
```yaml
services:
  event-api-dev:
    environment:
      - NODE_ENV=development
      - LOG_LEVEL=debug
      - ENABLE_DEBUG_ENDPOINTS=true
      - HOT_RELOAD=true
    volumes:
      - ./services:/app/services  # Hot reload
```

### Staging
```yaml
services:
  event-api-staging:
    environment:
      - NODE_ENV=staging
      - LOG_LEVEL=debug
      - ENABLE_DEBUG_ENDPOINTS=true
      - PERFORMANCE_MONITORING=true
    # No volume mounts for staging
```

### Production
```yaml
services:
  event-api:
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info
      - ENABLE_DEBUG_ENDPOINTS=false
      - PERFORMANCE_MONITORING=true
      - SECURITY_HARDENING=true
```

## Deployment Workflows

### Development
1. `flox activate` - Activate development environment
2. `just dev-setup` - Start development database
3. Start services locally for development

### Staging
1. Merge to `main` branch triggers staging deployment
2. CI builds and pushes staging image
3. Deploy to staging environment
4. Run automated smoke tests
5. Notify team of staging deployment

### Production
1. Create release tag (e.g., `v1.2.3`)
2. CI builds and pushes production image
3. Manual approval for production deployment
4. Blue-green deployment to production
5. Health checks and rollback on failure
6. Notify team of production deployment

## Security Considerations

### Secret Management
- **Development**: Local `.env` files (not committed)
- **Staging**: GitHub Secrets or secure CI/CD variables
- **Production**: Cloud secret management (AWS Secrets Manager, etc.)

### Access Control
- **Development**: Local access only
- **Staging**: VPN or IP-restricted access
- **Production**: Role-based access control (RBAC)

### Data Protection
- **Development**: Sample/mock data only
- **Staging**: Anonymized production data
- **Production**: Full data encryption at rest and in transit

## Monitoring and Logging

### Development
- **Logging**: Console output with debug level
- **Monitoring**: Basic health checks
- **Metrics**: Development-focused metrics

### Staging
- **Logging**: Structured JSON logs
- **Monitoring**: Application performance monitoring
- **Metrics**: Production-like metrics for testing

### Production
- **Logging**: Centralized log aggregation
- **Monitoring**: Full observability stack
- **Metrics**: Business and technical metrics
- **Alerting**: 24/7 monitoring with alerting

## Implementation Checklist

### Phase 1: Basic Environment Separation
- [ ] Create staging Docker compose configuration
- [ ] Set up environment-specific variable files
- [ ] Configure CI/CD with environment variables
- [ ] Test staging deployment pipeline

### Phase 2: Enhanced Separation  
- [ ] Implement database migration strategy
- [ ] Set up monitoring for each environment
- [ ] Configure secret management
- [ ] Add environment-specific health checks

### Phase 3: Production Hardening
- [ ] Implement blue-green deployments
- [ ] Set up production monitoring and alerting
- [ ] Configure backup and disaster recovery
- [ ] Complete security audit and hardening

## Benefits of This Approach

1. **Risk Mitigation**: Changes are tested in staging before production
2. **Debugging**: Staging environment mirrors production for issue investigation
3. **Performance Testing**: Load testing in staging without affecting production
4. **Security**: Proper isolation prevents cross-environment data leaks
5. **Compliance**: Meets requirements for data protection and audit trails
6. **Team Confidence**: Developers can deploy with confidence knowing staging validation occurred

## Next Steps

1. **Implement staging environment** using provided docker-compose.staging.yml
2. **Configure CI/CD environment variables** for staging deployment
3. **Test staging deployment workflow** with a test application change
4. **Set up monitoring** for staging environment health
5. **Plan production environment** migration strategy