# Hono API Service

A TypeScript-based API service using Hono framework with Drizzle ORM for PostgreSQL integration.

## Features

- ✅ **Hono Framework**: Fast, lightweight web framework for TypeScript
- ✅ **Drizzle ORM**: Type-safe database operations with PostgreSQL
- ✅ **Connection Pooling**: Optimized database connections with postgres.js
- ✅ **Type Safety**: Full TypeScript integration with Zod validation
- ✅ **CRUD Operations**: Complete event management API
- ✅ **Search & Filtering**: Text search and vector similarity support
- ✅ **Batch Operations**: Bulk event processing capabilities
- ✅ **Migration System**: Automated database schema management

## Database Schema

The service implements a comprehensive schema for event data management:

- **events**: Core event data with embeddings
- **speakers**: Speaker information with deduplication
- **topics**: Event categorization and tagging
- **companies**: Company information tracking
- **Junction tables**: event_speakers, event_topics for relationships

## API Endpoints

### Events API (`/api/events`)

```typescript
GET    /api/events           // List events with filters & pagination
GET    /api/events/:id       // Get event by ID with relations
POST   /api/events           // Create new event
PUT    /api/events/:id       // Update event
DELETE /api/events/:id       // Delete event
GET    /api/events/search    // Search events (text/vector)
POST   /api/events/batch     // Batch create events
```

### Health Check

```typescript
GET    /health               // Service health status
```

## Query Parameters

### List Events (`GET /api/events`)

```typescript
{
  location?: string           // Filter by location
  dateAfter?: string         // Events after date (YYYY-MM-DD)
  dateBefore?: string        // Events before date (YYYY-MM-DD)
  dataQualityScore?: number  // Minimum quality score
  page?: number              // Page number (default: 1)
  limit?: number             // Items per page (default: 20, max: 100)
}
```

### Search Events (`GET /api/events/search`)

```typescript
{
  q?: string                 // Text search query
  embedding?: number[]       // Vector similarity search
  limit?: number            // Result limit (default: 10, max: 50)
}
```

## Request/Response Examples

### Create Event

```bash
POST /api/events
Content-Type: application/json

{
  "name": "Tech Conference 2024",
  "description": "Annual technology conference",
  "date": "2024-09-15",
  "location": "San Francisco, CA",
  "lumaUrl": "https://lu.ma/event/evt-123",
  "dataQualityScore": 95
}
```

### Response Format

```json
{
  "success": true,
  "data": {
    "id": "uuid-here",
    "name": "Tech Conference 2024",
    "description": "Annual technology conference",
    "date": "2024-09-15",
    "location": "San Francisco, CA",
    "lumaUrl": "https://lu.ma/event/evt-123",
    "dataQualityScore": 95,
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-01-15T10:00:00Z"
  }
}
```

## Development Setup

### Prerequisites

- Node.js 18+
- PostgreSQL with pgvector extension
- TypeScript

### Installation

```bash
cd services/hono-api
npm install
```

### Database Setup

1. Ensure PostgreSQL is running with required extensions:
   ```sql
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   CREATE EXTENSION IF NOT EXISTS "pgvector";
   ```

2. Generate and run migrations:
   ```bash
   npm run db:generate  # Generate migration files
   npm run db:migrate   # Apply migrations
   ```

3. Optional: Use Drizzle Studio for database management:
   ```bash
   npm run db:studio
   ```

### Environment Variables

```bash
DATABASE_URL=postgresql://event_api_user:development_password@localhost:5432/event_api_dev
PORT=3000
NODE_ENV=development
```

### Running the Service

```bash
# Development mode with hot reload
npm run dev

# Production build
npm run build
npm start

# Run tests
npm test
```

## Type-Safe Patterns

### 1. Schema Definitions

```typescript
// Drizzle schema with full type inference
export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  embedding: text('embedding'), // Stored as text, cast to vector
  // ...
});

// Inferred types
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
```

### 2. Service Layer

```typescript
export class EventService {
  static async createEvent(eventData: NewEvent): Promise<Event> {
    const [event] = await db.insert(events).values(eventData).returning();
    return event; // Fully typed return
  }
  
  static async getEvents(filters: EventFilters, pagination: PaginationParams) {
    // Type-safe query building
    const whereConditions = [];
    if (filters.location) {
      whereConditions.push(ilike(events.location, `%${filters.location}%`));
    }
    // ...
  }
}
```

### 3. Route Validation

```typescript
// Zod schema validation
const eventSchema = z.object({
  name: z.string().min(1),
  dataQualityScore: z.number().int().min(0).max(100).optional()
});

// Route with validation
app.post('/', zValidator('json', eventSchema), async (c) => {
  const eventData = c.req.valid('json'); // Fully typed
  // ...
});
```

## Architecture Benefits

- **Type Safety**: End-to-end TypeScript with compile-time error checking
- **Performance**: Connection pooling and optimized queries
- **Maintainability**: Clear separation of concerns and modular design
- **Scalability**: Designed for horizontal scaling with stateless operations
- **Developer Experience**: Auto-completion, IntelliSense, and runtime validation

## Integration Points

This service is designed to integrate with:

- **Elixir Processing Service**: For AI-powered data processing
- **BAML Service**: For HTML content extraction
- **Frontend Applications**: Via REST API
- **Database**: Direct PostgreSQL with vector support

## Future Enhancements

- Authentication middleware with API keys
- Rate limiting and request throttling
- Caching layer for frequently accessed data
- Metrics and monitoring integration
- WebSocket support for real-time updates