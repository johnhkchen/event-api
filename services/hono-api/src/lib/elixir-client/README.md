# Elixir Service Integration

This module provides HTTP client integration with the Elixir processing service, enabling the Hono API to communicate with Phoenix-based processing pipelines.

## Features

- ✅ HTTP client with automatic retry logic and exponential backoff
- ✅ Event processing queue with priority support and concurrency control
- ✅ Graph query proxy endpoints for relationship analysis
- ✅ Deduplication service integration
- ✅ Recommendation engine integration
- ✅ Health checking and service monitoring
- ✅ Graceful error handling and timeout management

## Components

### ElixirClient

The main HTTP client for communicating with the Elixir service.

```typescript
import { elixirClient } from './lib/elixir-client';

// Process event with AI extraction
const result = await elixirClient.processEvent({
  eventId: 'event_123',
  htmlContent: '<html>...</html>',
  url: 'https://example.com/event'
});

// Query graph relationships
const graph = await elixirClient.queryGraph({
  query: 'speaker_connections',
  parameters: { speaker_id: 'speaker_456' }
});

// Get recommendations
const recommendations = await elixirClient.getRecommendations({
  userId: 'user_789',
  type: 'events',
  limit: 10
});
```

### EventProcessingQueue

Asynchronous queue for processing events with the Elixir service.

```typescript
import { processingQueue } from './lib/elixir-client';

// Enqueue processing job
const jobId = await processingQueue.enqueue({
  eventId: 'event_123',
  htmlContent: '<html>...</html>',
  url: 'https://example.com/event'
}, 5); // priority 0-10

// Check job status
const job = processingQueue.getJob(jobId);
console.log(`Job ${jobId} status: ${job.status}`);

// Wait for completion
const completedJob = await processingQueue.waitForJob(jobId, 30000);
```

## API Endpoints

### Internal Processing Endpoints

#### `POST /internal/processing/process`
Queue event for asynchronous processing.

**Request:**
```json
{
  "eventId": "event_123",
  "htmlContent": "<html>...</html>",
  "url": "https://example.com/event",
  "priority": 5
}
```

**Response:**
```json
{
  "success": true,
  "jobId": "job_1234567890_abc123",
  "message": "Event processing job queued"
}
```

#### `POST /internal/processing/process/sync`
Process event synchronously (for urgent processing).

#### `GET /internal/processing/job/:jobId`
Get processing job status.

#### `GET /internal/processing/queue/status`
Get overall queue status and statistics.

### Graph Query Endpoints

#### `POST /internal/graph/query`
Execute custom graph queries.

**Request:**
```json
{
  "query": "speaker_connections",
  "parameters": {
    "speaker_id": "speaker_456",
    "depth": 2
  }
}
```

#### `GET /internal/graph/speakers/:speakerId/connections`
Get speaker network connections.

#### `GET /internal/graph/companies/:companyId/events`
Get company event relationships.

#### `GET /internal/graph/events/:eventId/network`
Get event network analysis.

### Recommendation Endpoints

#### `GET /internal/recommendations/events`
Get event recommendations.

#### `GET /internal/recommendations/speakers`
Get speaker recommendations.

#### `GET /internal/recommendations/topics`
Get topic recommendations.

#### `GET /internal/recommendations/users/:userId/personalized`
Get personalized recommendations for a user.

### Health Check Endpoints

#### `GET /internal/health`
Basic health check for Elixir service integration.

#### `GET /internal/health/detailed`
Detailed health check with service statistics.

## Configuration

Configure the Elixir client using environment variables:

```bash
# Elixir service URL (default: http://localhost:4000)
ELIXIR_SERVICE_URL=http://elixir-service:4000

# Request timeout in milliseconds (default: 30000)
ELIXIR_TIMEOUT=30000

# Number of retry attempts (default: 3)
ELIXIR_RETRIES=3

# Retry delay in milliseconds (default: 1000)
ELIXIR_RETRY_DELAY=1000

# Health check interval in milliseconds (default: 60000)
ELIXIR_HEALTH_CHECK_INTERVAL=60000
```

Or configure programmatically:

```typescript
import { ElixirClient } from './lib/elixir-client';

const client = new ElixirClient({
  baseURL: 'http://localhost:4000',
  timeout: 30000,
  retries: 3,
  retryDelay: 1000,
  healthCheckInterval: 60000
});
```

## Error Handling

The client includes comprehensive error handling:

- **Automatic Retries**: Failed requests are automatically retried with exponential backoff
- **Timeout Management**: Configurable timeouts prevent hanging requests
- **Health Monitoring**: Continuous health checks monitor service availability
- **Circuit Breaking**: Unhealthy service status prevents unnecessary requests
- **Graceful Degradation**: Queue system ensures processing continues even during temporary failures

## Testing

Run the integration tests:

```bash
npm test tests/elixir-integration.test.ts
```

## Expected Elixir Service Endpoints

The Elixir service should implement these endpoints:

- `GET /internal/health` - Health check
- `POST /internal/process` - Process event with AI extraction
- `POST /internal/graph/query` - Execute graph queries
- `POST /internal/deduplicate` - Deduplication operations
- `GET /internal/recommend/{type}` - Get recommendations

## Integration with Main Application

The internal API routes are automatically mounted at `/internal` in the main Hono application:

```typescript
// In src/index.ts
import internalRoutes from './api/internal/index.js';
app.route('/internal', internalRoutes);
```

This provides a clean separation between external API endpoints (`/api/*`) and internal service communication (`/internal/*`).