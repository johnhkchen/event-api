import { Hono } from 'hono';
import graphRoutes from './graph.js';
import processingRoutes from './processing.js';
import recommendationRoutes from './recommendations.js';
import healthRoutes from './health.js';

const app = new Hono();

// Mount internal API routes
app.route('/graph', graphRoutes);
app.route('/processing', processingRoutes);
app.route('/recommendations', recommendationRoutes);
app.route('/health', healthRoutes);

export default app;