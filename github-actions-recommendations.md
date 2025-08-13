# GitHub Actions CI/CD Setup Recommendations

## Overview

This document provides specific GitHub Actions workflow configurations for the Event API project's CI/CD pipeline implementation.

## Recommended Workflows

### 1. CI Pipeline (`.github/workflows/ci.yml`)

```yaml
name: CI Pipeline

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

env:
  NODE_VERSION: 18
  POSTGRES_DB: event_api_test
  POSTGRES_USER: event_api
  POSTGRES_PASSWORD: test_password

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: |
          npm ci
          cd services/hono-api && npm ci
          cd ../baml-service && npm ci
      
      - name: TypeScript compilation check
        run: |
          cd services/hono-api && npm run typecheck
          cd ../baml-service && npm run typecheck
      
      - name: Lint check
        run: |
          cd services/hono-api && npm run lint
          cd ../baml-service && npm run lint

  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run npm audit
        run: |
          npm audit --audit-level=moderate
          cd services/hono-api && npm audit --audit-level=moderate
          cd ../baml-service && npm audit --audit-level=moderate
      
      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: 'fs'
          scan-ref: '.'
          format: 'sarif'
          output: 'trivy-results.sarif'
      
      - name: Upload Trivy scan results
        uses: github/codeql-action/upload-sarif@v2
        if: always()
        with:
          sarif_file: 'trivy-results.sarif'

  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg15
        env:
          POSTGRES_DB: ${{ env.POSTGRES_DB }}
          POSTGRES_USER: ${{ env.POSTGRES_USER }}
          POSTGRES_PASSWORD: ${{ env.POSTGRES_PASSWORD }}
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: |
          npm ci
          cd services/hono-api && npm ci
          cd ../baml-service && npm ci
      
      - name: Setup test database
        run: |
          PGPASSWORD=${{ env.POSTGRES_PASSWORD }} psql -h localhost -U ${{ env.POSTGRES_USER }} -d ${{ env.POSTGRES_DB }} -f scripts/docker/init-db.sql
      
      - name: Run tests
        env:
          DATABASE_URL: postgresql://${{ env.POSTGRES_USER }}:${{ env.POSTGRES_PASSWORD }}@localhost:5432/${{ env.POSTGRES_DB }}
        run: |
          cd services/hono-api && npm test
          cd ../baml-service && npm test

  docker-build:
    runs-on: ubuntu-latest
    needs: [lint-and-typecheck, security-scan, test]
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      
      - name: Build test image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: false
          tags: event-api:test
          cache-from: type=gha
          cache-to: type=gha,mode=max
      
      - name: Test container health
        run: |
          docker run --rm --name test-container -d -p 3000:3000 event-api:test
          sleep 10
          curl -f http://localhost:3000/health || exit 1
          docker stop test-container
```

### 2. Release Pipeline (`.github/workflows/release.yml`)

```yaml
name: Release Pipeline

on:
  push:
    tags:
      - 'v*'

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Docker Buildx
        uses: docker/setup-buildx-action@v3
      
      - name: Login to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=tag
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
      
      - name: Build and push image
        uses: docker/build-push-action@v5
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      
      - name: Create Release
        uses: actions/create-release@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tag_name: ${{ github.ref_name }}
          release_name: Release ${{ github.ref_name }}
          draft: false
          prerelease: false
```

### 3. Deploy to Staging (`.github/workflows/deploy-staging.yml`)

```yaml
name: Deploy to Staging

on:
  push:
    branches: [ main ]
  workflow_dispatch:

jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    environment: staging
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to staging environment
        env:
          STAGING_HOST: ${{ secrets.STAGING_HOST }}
          STAGING_USER: ${{ secrets.STAGING_USER }}
          STAGING_KEY: ${{ secrets.STAGING_SSH_KEY }}
        run: |
          echo "Deploying to staging environment..."
          # Add staging deployment commands here
          # This would typically involve SSH to staging server
          # and running docker-compose up with staging config
      
      - name: Run smoke tests
        run: |
          echo "Running staging smoke tests..."
          # Add staging smoke test commands here
```

## Branch Protection Rules

Configure the following branch protection rules for `main`:

1. **Require pull request reviews**: 1 reviewer minimum
2. **Require status checks**: All CI jobs must pass
3. **Require branches to be up to date**: Enforce latest changes
4. **Restrict pushes**: Only allow through PRs
5. **Require linear history**: Enforce clean git history

## Required Secrets

Set up the following GitHub repository secrets:

### Staging Deployment
- `STAGING_HOST`: Staging server hostname
- `STAGING_USER`: SSH username for staging
- `STAGING_SSH_KEY`: Private SSH key for staging access

### Production Deployment  
- `PRODUCTION_HOST`: Production server hostname
- `PRODUCTION_USER`: SSH username for production
- `PRODUCTION_SSH_KEY`: Private SSH key for production access

### External Services
- `OPENAI_API_KEY`: OpenAI API key for AI services
- `DATABASE_URL_PRODUCTION`: Production database connection string

## Environment Variables

Configure environment-specific variables:

### Staging Environment
- `DATABASE_URL`: Staging database connection
- `NODE_ENV`: staging
- `LOG_LEVEL`: debug

### Production Environment
- `DATABASE_URL`: Production database connection
- `NODE_ENV`: production
- `LOG_LEVEL`: info

## Monitoring and Notifications

### Slack Notifications (Optional)

Add Slack webhook notifications for:
- Failed CI builds
- Successful deployments
- Security scan alerts

```yaml
- name: Slack Notification
  uses: 8398a7/action-slack@v3
  if: failure()
  with:
    status: ${{ job.status }}
    webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

## Next Steps

1. **Create `.github/workflows/` directory**
2. **Add the recommended workflow files**
3. **Configure branch protection rules**
4. **Set up required secrets and environment variables**
5. **Test CI pipeline with a test PR**
6. **Configure staging environment**
7. **Set up production deployment automation**

## Benefits of This Setup

- **Automated quality checks**: Every PR is validated
- **Security scanning**: Vulnerabilities detected early
- **Consistent deployments**: Reduces human error
- **Fast feedback**: Developers get quick CI results
- **Audit trail**: All changes are tracked and logged
- **Rollback capability**: Easy to revert problematic releases