import { SCRAPING_CONFIG } from './config.js';

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: any) => boolean;
}

export class RetryManager {
  private static defaultOptions: RetryOptions = {
    maxRetries: SCRAPING_CONFIG.MAX_RETRIES,
    initialDelay: SCRAPING_CONFIG.INITIAL_RETRY_DELAY,
    maxDelay: SCRAPING_CONFIG.MAX_RETRY_DELAY,
    backoffMultiplier: SCRAPING_CONFIG.BACKOFF_MULTIPLIER,
    shouldRetry: (error: any) => {
      // Don't retry on 404s or client errors
      if ((error as any).response?.status >= 400 && (error as any).response?.status < 500) {
        return false;
      }
      
      // Don't retry on authentication errors
      if ((error as any).response?.status === 401 || (error as any).response?.status === 403) {
        return false;
      }

      // Retry on network errors, timeouts, and server errors
      return true;
    }
  };

  static async withRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const opts = { ...this.defaultOptions, ...options };
    let lastError: any;
    let delay = opts.initialDelay!;

    for (let attempt = 0; attempt <= opts.maxRetries!; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        // Don't retry if we've exhausted attempts or if error shouldn't be retried
        if (attempt === opts.maxRetries || !opts.shouldRetry!(error)) {
          throw error;
        }

        console.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, (error as any).message);
        
        // Wait before retrying
        await this.sleep(delay);
        
        // Exponential backoff with jitter
        delay = Math.min(
          delay * opts.backoffMultiplier!,
          opts.maxDelay!
        );
        
        // Add jitter (±25% of delay)
        const jitter = delay * 0.25 * (Math.random() - 0.5);
        delay = Math.floor(delay + jitter);
      }
    }

    throw lastError;
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  timeout: number;
  resetTimeout: number;
}

export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(private options: CircuitBreakerOptions) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.options.resetTimeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.options.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  getState(): string {
    return this.state;
  }
}