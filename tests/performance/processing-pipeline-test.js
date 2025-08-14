import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

// Custom metrics for processing pipeline performance
export let processingErrors = new Rate('processing_errors');
export let processingThroughput = new Rate('processing_throughput');
export let queueDepth = new Gauge('queue_depth');
export let processingLatency = new Trend('processing_latency');
export let aiExtractionTime = new Trend('ai_extraction_time');
export let deduplicationTime = new Trend('deduplication_time');
export let jobsCompleted = new Counter('jobs_completed');

export let options = {
  scenarios: {
    // Pipeline throughput test - sustained load
    pipeline_throughput: {
      executor: 'constant-arrival-rate',
      rate: 5, // 5 processing jobs per second
      timeUnit: '1s',
      duration: '10m',
      preAllocatedVUs: 25,
      maxVUs: 40,
    },
    // Burst processing test - handle spikes
    burst_processing: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      stages: [
        { duration: '1m', target: 3 },
        { duration: '30s', target: 15 }, // Sudden burst
        { duration: '2m', target: 15 },  // Sustain burst
        { duration: '1m', target: 5 },   // Back to normal
      ],
      preAllocatedVUs: 50,
      maxVUs: 60,
      startTime: '3m',
    },
    // Queue monitoring - track system state
    queue_monitor: {
      executor: 'constant-vus',
      vus: 2,
      duration: '15m',
      exec: 'monitorQueues',
    }
  },
  thresholds: {
    // Pipeline performance requirements
    processing_latency: ['p(95)<5000'],      // 95% complete within 5s
    ai_extraction_time: ['p(95)<3000'],      // AI extraction under 3s
    deduplication_time: ['p(95)<1000'],      // Dedup under 1s
    queue_depth: ['value<100'],              // Queue doesn't grow unbounded
    processing_throughput: ['rate>0.8'],     // 80%+ success rate
    processing_errors: ['rate<0.05'],        // <5% error rate
  },
};

const BASE_URL = 'http://localhost:3000';
const ELIXIR_URL = 'http://localhost:4000';
const BAML_URL = 'http://localhost:8080';

// Sample HTML content for processing tests
const SAMPLE_HTML_CONTENT = [
  `<div class="event-details"><h1>AI Conference 2024</h1><p>Join us for cutting-edge AI discussions</p><div class="speakers"><span>Dr. Jane Smith, Tech Corp</span></div></div>`,
  `<article><header><h2>Startup Networking Event</h2></header><section><p>Connect with fellow entrepreneurs</p><div class="speaker-list"><p>John Doe - StartupXYZ</p><p>Sarah Johnson - VentureABC</p></div></section></article>`,
  `<main><div class="event-info"><title>Developer Meetup</title><description>Monthly developer community gathering</description><speakers><person>Mike Wilson, DevCompany</person></speakers></div></main>`,
];

export default function() {
  // Submit processing job with realistic HTML content
  const htmlContent = SAMPLE_HTML_CONTENT[Math.floor(Math.random() * SAMPLE_HTML_CONTENT.length)];
  
  const jobStart = Date.now();
  const jobResponse = http.post(`${ELIXIR_URL}/internal/process`, {
    html_content: htmlContent,
    source_url: `https://example.com/event-${Math.random().toString(36).substr(2, 9)}`,
    extract_speakers: true,
    extract_companies: true,
    enable_deduplication: true,
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer internal-test-token',
    },
    timeout: '10s',
  });

  // Track job submission
  const submissionSuccess = check(jobResponse, {
    'processing job submitted': (r) => r.status === 202,
    'job_id returned': (r) => r.json('job_id') !== undefined,
    'estimated_time provided': (r) => r.json('estimated_processing_time') !== undefined,
  });

  if (!submissionSuccess) {
    processingErrors.add(1);
    return;
  }

  const jobId = jobResponse.json('job_id');
  
  // Poll for completion with exponential backoff
  let pollAttempts = 0;
  let completed = false;
  let processingResult = null;

  while (!completed && pollAttempts < 20) { // Max 20 attempts (about 30 seconds)
    const pollDelay = Math.min(1000 * Math.pow(1.5, pollAttempts), 3000); // Cap at 3s
    sleep(pollDelay / 1000);
    
    pollAttempts++;
    
    const statusResponse = http.get(`${ELIXIR_URL}/internal/jobs/${jobId}/status`);
    
    if (statusResponse.status === 200) {
      const status = statusResponse.json('status');
      const queuePosition = statusResponse.json('queue_position') || 0;
      
      queueDepth.add(queuePosition);
      
      if (status === 'completed') {
        completed = true;
        processingResult = statusResponse.json('result');
        
        const totalLatency = Date.now() - jobStart;
        processingLatency.add(totalLatency);
        
        // Track individual processing stages
        const stages = statusResponse.json('processing_stages') || {};
        if (stages.ai_extraction_duration) {
          aiExtractionTime.add(stages.ai_extraction_duration);
        }
        if (stages.deduplication_duration) {
          deduplicationTime.add(stages.deduplication_duration);
        }
        
        jobsCompleted.add(1);
        processingThroughput.add(1); // Success
        
      } else if (status === 'failed' || status === 'error') {
        processingErrors.add(1);
        processingThroughput.add(0); // Failure
        completed = true;
      }
    } else {
      // Status check failed
      if (pollAttempts > 5) { // Allow some initial failures
        processingErrors.add(1);
        completed = true;
      }
    }
  }

  if (!completed) {
    // Job timed out
    processingErrors.add(1);
    processingThroughput.add(0);
  }

  // Validate processing results if completed successfully
  if (processingResult) {
    validateProcessingResult(processingResult);
  }

  // Brief pause before next job
  sleep(Math.random() * 0.5);
}

// Alternative execution function for queue monitoring
export function monitorQueues() {
  // Monitor processing queue depths across services
  const services = [
    { name: 'elixir_processing', url: `${ELIXIR_URL}/internal/queue/status` },
    { name: 'baml_extraction', url: `${BAML_URL}/queue/status` },
  ];

  for (const service of services) {
    const response = http.get(service.url);
    if (response.status === 200) {
      const queueInfo = response.json();
      queueDepth.add(queueInfo.pending_jobs || 0, { service: service.name });
    }
  }

  sleep(5); // Check every 5 seconds
}

function validateProcessingResult(result) {
  const validation = check(null, {
    'event data extracted': () => result.event !== undefined,
    'speakers identified': () => result.speakers && result.speakers.length > 0,
    'companies extracted': () => result.companies !== undefined,
    'topics categorized': () => result.topics && result.topics.length > 0,
    'embeddings generated': () => result.embeddings !== undefined,
  });

  if (!validation) {
    processingErrors.add(1);
  }
}

export function setup() {
  console.log('Setting up processing pipeline test...');
  
  // Verify all pipeline services are available
  const services = [
    { name: 'Hono API', url: `${BASE_URL}/health` },
    { name: 'Elixir Processing', url: `${ELIXIR_URL}/health` },
    { name: 'BAML Service', url: `${BAML_URL}/health` },
  ];

  for (const service of services) {
    const response = http.get(service.url);
    check(response, {
      [`${service.name} available`]: (r) => r.status === 200,
    });
  }

  // Warm up the processing pipeline
  const warmupResponse = http.post(`${ELIXIR_URL}/internal/process`, {
    html_content: '<div>Warmup test</div>',
    source_url: 'https://example.com/warmup',
    extract_speakers: false,
    extract_companies: false,
    enable_deduplication: false,
  }, {
    headers: { 'Content-Type': 'application/json' }
  });

  console.log('Pipeline warmup status:', warmupResponse.status);

  return { timestamp: Date.now() };
}

export function teardown(data) {
  console.log(`Processing pipeline test completed. Duration: ${Date.now() - data.timestamp}ms`);
  
  // Final queue status check
  const finalQueueCheck = http.get(`${ELIXIR_URL}/internal/queue/status`);
  if (finalQueueCheck.status === 200) {
    const queueInfo = finalQueueCheck.json();
    console.log(`Final queue depth: ${queueInfo.pending_jobs || 0} jobs`);
  }
}