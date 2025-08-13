import { elixirClient, ProcessingRequest, ProcessingResponse } from './client.js';

export interface QueuedProcessingRequest extends ProcessingRequest {
  id: string;
  priority: number;
  retries: number;
  createdAt: Date;
}

export interface ProcessingJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  request: ProcessingRequest;
  response?: ProcessingResponse;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  retries: number;
}

export class EventProcessingQueue {
  private queue: QueuedProcessingRequest[] = [];
  private jobs: Map<string, ProcessingJob> = new Map();
  private processing: boolean = false;
  private maxConcurrent: number = 3;
  private activeJobs: Set<string> = new Set();

  constructor(maxConcurrent: number = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  async enqueue(request: ProcessingRequest, priority: number = 0): Promise<string> {
    const id = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const queuedRequest: QueuedProcessingRequest = {
      ...request,
      id,
      priority,
      retries: 0,
      createdAt: new Date()
    };

    this.queue.push(queuedRequest);
    this.queue.sort((a, b) => b.priority - a.priority); // Higher priority first

    const job: ProcessingJob = {
      id,
      status: 'pending',
      request,
      retries: 0
    };

    this.jobs.set(id, job);

    console.log(`[ProcessingQueue] Enqueued job ${id} with priority ${priority}`);
    
    // Start processing if not already running
    if (!this.processing) {
      this.startProcessing();
    }

    return id;
  }

  private async startProcessing(): Promise<void> {
    if (this.processing) return;
    
    this.processing = true;
    console.log('[ProcessingQueue] Starting queue processing');

    while (this.queue.length > 0 || this.activeJobs.size > 0) {
      // Process jobs while we have capacity and items in queue
      while (this.activeJobs.size < this.maxConcurrent && this.queue.length > 0) {
        const queuedRequest = this.queue.shift()!;
        this.processJob(queuedRequest);
      }

      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.processing = false;
    console.log('[ProcessingQueue] Queue processing stopped');
  }

  private async processJob(queuedRequest: QueuedProcessingRequest): Promise<void> {
    const job = this.jobs.get(queuedRequest.id);
    if (!job) return;

    this.activeJobs.add(queuedRequest.id);
    job.status = 'processing';
    job.startedAt = new Date();

    console.log(`[ProcessingQueue] Processing job ${queuedRequest.id}`);

    try {
      const response = await elixirClient.processEvent({
        eventId: queuedRequest.eventId,
        htmlContent: queuedRequest.htmlContent,
        url: queuedRequest.url
      });

      job.response = response;
      job.status = 'completed';
      job.completedAt = new Date();

      console.log(`[ProcessingQueue] Job ${queuedRequest.id} completed successfully`);
    } catch (error: any) {
      job.error = error.message;
      job.retries++;

      const maxRetries = 3;
      if (job.retries < maxRetries) {
        // Re-queue with lower priority
        console.log(`[ProcessingQueue] Job ${queuedRequest.id} failed, retrying (${job.retries}/${maxRetries})`);
        
        queuedRequest.retries = job.retries;
        queuedRequest.priority = Math.max(0, queuedRequest.priority - 1);
        
        // Add back to queue with delay
        setTimeout(() => {
          this.queue.push(queuedRequest);
          this.queue.sort((a, b) => b.priority - a.priority);
        }, 1000 * job.retries); // Exponential backoff

        job.status = 'pending';
      } else {
        job.status = 'failed';
        job.completedAt = new Date();
        console.error(`[ProcessingQueue] Job ${queuedRequest.id} failed permanently:`, error.message);
      }
    } finally {
      this.activeJobs.delete(queuedRequest.id);
    }
  }

  getJob(id: string): ProcessingJob | undefined {
    return this.jobs.get(id);
  }

  getQueueStatus(): {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    total: number;
  } {
    const jobs = Array.from(this.jobs.values());
    
    return {
      pending: jobs.filter(j => j.status === 'pending').length,
      processing: jobs.filter(j => j.status === 'processing').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      total: jobs.length
    };
  }

  async waitForJob(id: string, timeout: number = 30000): Promise<ProcessingJob> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const job = this.jobs.get(id);
      if (!job) {
        throw new Error(`Job ${id} not found`);
      }

      if (job.status === 'completed' || job.status === 'failed') {
        return job;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`Job ${id} timed out after ${timeout}ms`);
  }
}

// Singleton instance
export const processingQueue = new EventProcessingQueue();