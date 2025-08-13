# Multi-stage Dockerfile for Hono API Service
# Optimized for production deployment with Playwright support

# Stage 1: Base Node.js image with dependencies
FROM node:20-alpine AS base

# Install system dependencies needed for Playwright
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

# Set Playwright to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Create app directory and set user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S hono -u 1001 && \
    mkdir -p /app && \
    chown -R hono:nodejs /app

WORKDIR /app
USER hono

# Stage 2: Dependencies installation
FROM base AS deps

# Copy package files
COPY --chown=hono:nodejs package*.json ./

# Install dependencies with clean cache
RUN npm ci --only=production --silent && \
    npm cache clean --force

# Stage 3: Build stage
FROM base AS build

# Copy package files and install all dependencies (including dev)
COPY --chown=hono:nodejs package*.json ./
RUN npm ci --silent

# Copy source code
COPY --chown=hono:nodejs src/ ./src/
COPY --chown=hono:nodejs drizzle/ ./drizzle/
COPY --chown=hono:nodejs tsconfig.json ./
COPY --chown=hono:nodejs drizzle.config.ts ./
COPY --chown=hono:nodejs vitest.config.ts ./

# Build the application
RUN npm run build:check && \
    npm run build

# Stage 4: Production runner
FROM base AS runner

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Copy production dependencies
COPY --from=deps --chown=hono:nodejs /app/node_modules ./node_modules

# Copy built application
COPY --from=build --chown=hono:nodejs /app/dist ./dist
COPY --from=build --chown=hono:nodejs /app/drizzle ./drizzle
COPY --chown=hono:nodejs package.json ./

# Create logs directory
RUN mkdir -p logs && chown -R hono:nodejs logs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "const http = require('http'); \
    const req = http.request({hostname: 'localhost', port: process.env.PORT || 3000, path: '/health', timeout: 5000}, (res) => { \
        if (res.statusCode === 200) process.exit(0); else process.exit(1); \
    }); \
    req.on('error', () => process.exit(1)); \
    req.end();"

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "dist/index.js"]

# Metadata
LABEL maintainer="Event API Team" \
      version="1.0.0" \
      description="Hono API service for event scraping and management" \
      org.opencontainers.image.source="https://github.com/yourusername/event-api" \
      org.opencontainers.image.description="Production-ready Hono API with Playwright scraping capabilities"