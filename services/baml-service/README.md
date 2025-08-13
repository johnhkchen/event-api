# BAML Content Extraction Service

AI-powered HTML content extraction service for event data processing using OpenAI's GPT models.

## Features

- **HTML Content Extraction**: Extract structured data from raw HTML content
- **OpenAI Integration**: Uses GPT-4 for intelligent content analysis
- **Caching**: Response caching for identical HTML content (Memory/Redis)
- **Rate Limiting**: Built-in rate limiting for OpenAI API calls
- **Confidence Scoring**: Quality scoring for all extracted entities
- **Batch Processing**: Process multiple extractions in parallel
- **Health Monitoring**: Comprehensive health checks for all dependencies
- **Docker Support**: Production-ready containerization

## API Endpoints

### Content Extraction

```bash
POST /api/v1/extract
```

Extract structured data from HTML content:

```json
{
  "html_content": "<html>...",
  "url": "https://example.com/event",
  "extraction_type": "full",
  "confidence_threshold": 0.7,
  "use_cache": true
}
```

### Batch Extraction

```bash
POST /api/v1/extract/batch
```

Process multiple extractions in parallel (max 10 per batch).

### Embeddings

```bash
POST /api/v1/embeddings
```

Generate text embeddings for semantic search:

```json
{
  "text": "Text to generate embeddings for",
  "model": "text-embedding-3-small"
}
```

### Health Checks

- `GET /api/v1/health` - Basic health status
- `GET /api/v1/health/detailed` - Detailed health with dependency checks
- `GET /api/v1/health/ready` - Kubernetes readiness probe
- `GET /api/v1/health/live` - Kubernetes liveness probe

## Configuration

Copy `.env.example` to `.env` and configure:

```env
OPENAI_API_KEY=sk-your-api-key-here
CACHE_BACKEND=memory
LOG_LEVEL=INFO
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key (required) | - |
| `OPENAI_MODEL` | GPT model for extraction | `gpt-4` |
| `CACHE_BACKEND` | Cache backend (`memory` or `redis`) | `memory` |
| `REDIS_URL` | Redis connection URL | - |
| `CONFIDENCE_THRESHOLD` | Minimum confidence for entities | `0.7` |
| `MAX_HTML_SIZE` | Maximum HTML content size (bytes) | `1000000` |
| `RATE_LIMIT_REQUESTS` | Requests per minute limit | `30` |

## Development

### Local Setup

1. Install dependencies:
```bash
pip install -r requirements-dev.txt
```

2. Create `.env` file with your OpenAI API key

3. Run the service:
```bash
python -m src.main
```

The service will be available at `http://localhost:8080`

### Docker Development

```bash
# Build development image
docker build -f Dockerfile.dev -t baml-service:dev .

# Run with environment variables
docker run -p 8080:8080 --env-file .env baml-service:dev
```

### Testing

```bash
# Install test dependencies
pip install -r requirements-dev.txt

# Run tests
pytest src/tests/

# Run with coverage
pytest --cov=src src/tests/
```

## Production Deployment

### Docker

```bash
# Build production image
docker build -t baml-service:latest .

# Run container
docker run -d \
  --name baml-service \
  -p 8080:8080 \
  --env-file .env \
  baml-service:latest
```

### Health Checks

The container includes health checks that verify:
- Service responsiveness
- OpenAI API connectivity
- Cache service availability
- System resource usage

### Monitoring

The service provides structured JSON logs and metrics:

- Request/response logging
- Performance metrics
- Error tracking
- OpenAI API usage stats

## Integration

### With Hono API Service

The Hono service calls BAML during scraping:

```typescript
const response = await fetch('http://baml-service:8080/api/v1/extract', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    html_content: scrapedHtml,
    url: sourceUrl
  })
});
```

### With Elixir Service

The Elixir service uses BAML for content processing:

```elixir
defmodule EventAPI.Services.BAMLClient do
  @base_url "http://baml-service:8080"
  
  def extract_content(html_content, source_url) do
    # HTTP POST to /api/v1/extract
  end
end
```

## Architecture

The service follows a layered architecture:

```
FastAPI Application
├── API Endpoints (/api/v1/extract, /health)
├── Service Layer (ExtractionService, OpenAIService)
├── Utils Layer (HTMLProcessor, ConfidenceScorer)
└── Core Layer (Config, Logging, Exceptions)
```

### Key Components

- **ExtractionService**: Main business logic for content extraction
- **OpenAIService**: OpenAI API integration with retry logic
- **CacheService**: Configurable caching (Memory/Redis)
- **HTMLProcessor**: HTML cleaning and structured data extraction
- **ConfidenceScorer**: Quality scoring for extracted entities

## Performance

- Typical extraction time: 2-5 seconds
- Cached responses: < 100ms
- Concurrent request support
- Configurable timeouts and retries
- Memory usage optimization

## Error Handling

The service provides detailed error responses:

```json
{
  "success": false,
  "error": "Content extraction failed",
  "error_code": "OPENAI_ERROR",
  "correlation_id": "abc-123-def"
}
```

## Security

- Input validation and sanitization
- Rate limiting protection
- CORS configuration
- Optional API key authentication
- Non-root container execution