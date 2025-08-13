import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { checkDatabaseConnection, closeDatabaseConnection } from './db/connection.ts';
import eventsRoutes from './routes/events.ts';
import internalRoutes from './api/internal/index.js';
import scrapeRoutes from './api/scrape/index.js';
import { elixirClient } from './lib/elixir-client/client.js';
import { 
  productionSecurity, 
  developmentSecurity, 
  inputSanitization, 
  contentTypeValidation,
  requestSizeLimit,
  secureCors 
} from './middleware/security.js';
import { standardRateLimit } from './middleware/rate-limit.js';
import { logApiUsage, requireApiKey } from './middleware/auth.js';

// Create Hono app
const app = new Hono();

// Security middleware
app.use('*', process.env.NODE_ENV === 'production' ? productionSecurity : developmentSecurity);
app.use('*', secureCors(['https://yourdomain.com'])); // Add your production domains
app.use('*', requestSizeLimit(10 * 1024 * 1024)); // 10MB limit
app.use('*', contentTypeValidation);
app.use('*', inputSanitization);

// Logging and monitoring
app.use('*', logger());
app.use('*', logApiUsage);

// Rate limiting for all routes
app.use('*', standardRateLimit);

// Health check endpoint
app.get('/health', async (c) => {
  const dbHealthy = await checkDatabaseConnection();
  
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: dbHealthy ? 'connected' : 'disconnected',
    service: 'hono-api'
  }, dbHealthy ? 200 : 503);
});

// API routes (public endpoints)
app.route('/api/events', eventsRoutes);

// Protected API routes (require authentication)
app.use('/api/scrape/*', requireApiKey);
app.route('/api/scrape', scrapeRoutes);

app.use('/internal/*', requireApiKey);
app.route('/internal', internalRoutes);

// 404 handler
app.notFound((c) => {
  return c.json({
    success: false,
    error: 'Endpoint not found',
    path: c.req.path,
    method: c.req.method
  }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error(`Error occurred: ${err.message}`);
  console.error(err.stack);
  
  return c.json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  }, 500);
});

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('Shutting down gracefully...');
  elixirClient.destroy();
  await closeDatabaseConnection();
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
const port = parseInt(process.env.PORT || '3000');

console.log(`Starting Hono API server on port ${port}...`);

serve({
  fetch: app.fetch,
  port
}, (info) => {
  console.log(`Hono API server is running on http://localhost:${info.port}`);
});