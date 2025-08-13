# Event API - Dockerfile for reference
# NOTE: This file is for reference only. 
# Production containers are built using `flox containerize` which generates
# optimized containers with the complete Flox environment.

# This Dockerfile can be used for manual Docker builds if needed,
# but it's recommended to use the Flox containerization workflow.

FROM node:18-alpine AS base

# Install system dependencies
RUN apk add --no-cache \
    postgresql-client \
    curl \
    bash

# Set working directory
WORKDIR /app

# Copy package files for all services
COPY services/hono-api/package*.json ./hono-api/
COPY services/baml-service/package*.json ./baml-service/

# Install dependencies
RUN cd hono-api && npm ci --only=production
RUN cd baml-service && npm ci --only=production

# Copy service code
COPY services/ ./services/

# Expose service ports
EXPOSE 3000 4000 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Default command (this would need to be updated to start all services)
CMD ["echo", "Use flox containerize for production builds"]

# For manual builds, you would need to:
# 1. Install Elixir/Phoenix dependencies
# 2. Configure multi-service startup
# 3. Set up proper process management
# 
# The Flox containerization handles all of this automatically.