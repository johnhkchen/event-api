import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { ElixirServiceConfig, defaultElixirConfig } from './config.js';

export interface ProcessingRequest {
  eventId: string;
  htmlContent: string;
  url: string;
}

export interface ProcessingResponse {
  eventId: string;
  status: 'success' | 'error';
  data?: any;
  error?: string;
}

export interface GraphQueryRequest {
  query: string;
  parameters?: Record<string, any>;
}

export interface GraphQueryResponse {
  nodes: any[];
  edges: any[];
  metadata?: Record<string, any>;
}

export interface DeduplicationRequest {
  type: 'speaker' | 'company' | 'event';
  data: any[];
}

export interface DeduplicationResponse {
  duplicates: Array<{
    id: string;
    matchedWith: string;
    confidence: number;
  }>;
}

export interface RecommendationRequest {
  userId?: string;
  eventId?: string;
  type: 'events' | 'speakers' | 'topics';
  limit?: number;
}

export interface RecommendationResponse {
  recommendations: Array<{
    id: string;
    score: number;
    reason: string;
  }>;
}

export class ElixirClient {
  private client: AxiosInstance;
  private config: ElixirServiceConfig;
  private isHealthy: boolean = false;
  private healthCheckTimer?: NodeJS.Timeout;

  constructor(config: Partial<ElixirServiceConfig> = {}) {
    this.config = { ...defaultElixirConfig, ...config };
    
    this.client = axios.create({
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    this.setupInterceptors();
    this.startHealthCheck();
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        console.log(`[ElixirClient] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('[ElixirClient] Request error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        console.log(`[ElixirClient] Response ${response.status} from ${response.config.url}`);
        return response;
      },
      (error) => {
        console.error('[ElixirClient] Response error:', error.response?.status, error.message);
        return Promise.reject(error);
      }
    );
  }

  private async startHealthCheck(): Promise<void> {
    await this.checkHealth();
    
    this.healthCheckTimer = setInterval(async () => {
      await this.checkHealth();
    }, this.config.healthCheckInterval);
  }

  private async checkHealth(): Promise<void> {
    try {
      const response = await this.client.get('/internal/health', { timeout: 5000 });
      this.isHealthy = response.status === 200;
      console.log(`[ElixirClient] Health check: ${this.isHealthy ? 'HEALTHY' : 'UNHEALTHY'}`);
    } catch (error) {
      this.isHealthy = false;
      console.warn('[ElixirClient] Health check failed:', error);
    }
  }

  private async retryRequest<T>(
    requestFn: () => Promise<AxiosResponse<T>>,
    retries: number = this.config.retries
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await requestFn();
        return response.data;
      } catch (error: any) {
        lastError = error;
        
        if (attempt === retries) {
          break;
        }

        // Don't retry on client errors (4xx)
        if (error.response?.status >= 400 && error.response?.status < 500) {
          break;
        }

        const delay = this.config.retryDelay * Math.pow(2, attempt); // Exponential backoff
        console.warn(`[ElixirClient] Request failed, retrying in ${delay}ms (attempt ${attempt + 1}/${retries + 1})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }

  async processEvent(request: ProcessingRequest): Promise<ProcessingResponse> {
    return this.retryRequest(() => 
      this.client.post<ProcessingResponse>('/internal/process', request)
    );
  }

  async queryGraph(request: GraphQueryRequest): Promise<GraphQueryResponse> {
    return this.retryRequest(() => 
      this.client.post<GraphQueryResponse>('/internal/graph/query', request)
    );
  }

  async deduplicate(request: DeduplicationRequest): Promise<DeduplicationResponse> {
    return this.retryRequest(() => 
      this.client.post<DeduplicationResponse>('/internal/deduplicate', request)
    );
  }

  async getRecommendations(request: RecommendationRequest): Promise<RecommendationResponse> {
    const queryParams = new URLSearchParams();
    if (request.userId) queryParams.append('userId', request.userId);
    if (request.eventId) queryParams.append('eventId', request.eventId);
    if (request.limit) queryParams.append('limit', request.limit.toString());

    return this.retryRequest(() => 
      this.client.get<RecommendationResponse>(`/internal/recommend/${request.type}?${queryParams}`)
    );
  }

  get healthy(): boolean {
    return this.isHealthy;
  }

  destroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
  }
}

// Singleton instance
export const elixirClient = new ElixirClient();