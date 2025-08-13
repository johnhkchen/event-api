export { ElixirClient, elixirClient } from './client.js';
export { EventProcessingQueue, processingQueue } from './queue.js';
export { ElixirServiceConfig, defaultElixirConfig } from './config.js';

export type {
  ProcessingRequest,
  ProcessingResponse,
  GraphQueryRequest,
  GraphQueryResponse,
  DeduplicationRequest,
  DeduplicationResponse,
  RecommendationRequest,
  RecommendationResponse
} from './client.js';

export type {
  QueuedProcessingRequest,
  ProcessingJob
} from './queue.js';