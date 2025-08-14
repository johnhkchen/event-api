import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics for scraping performance
export let scrapingErrors = new Rate('scraping_errors');
export let scrapingDuration = new Trend('scraping_duration');
export let processingQueueDepth = new Trend('processing_queue_depth');

// Test configuration for concurrent scraping
export let options = {
  scenarios: {
    // Concurrent scraping burst test
    concurrent_scraping: {
      executor: 'constant-arrival-rate',
      rate: 2,  // 2 scraping operations per second
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 10,
      maxVUs: 15,
    },
    // Peak load simulation
    peak_scraping: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      stages: [
        { duration: '2m', target: 5 },   // Ramp up to 5/sec
        { duration: '3m', target: 10 },  // Peak at 10/sec
        { duration: '2m', target: 2 },   // Ramp down
      ],
      preAllocatedVUs: 20,
      maxVUs: 25,
    }
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],  // 95% under 2s
    http_req_failed: ['rate<0.05'],     // <5% failure rate
    scraping_errors: ['rate<0.05'],     // <5% scraping errors
    processing_queue_depth: ['p(95)<50'], // Queue depth manageable
  },
};

const BASE_URL = 'http://localhost:3000';

// Sample Lu.ma URLs for testing
const LUMA_URLS = [
  'https://lu.ma/event/evt-abc123',
  'https://lu.ma/event/evt-def456', 
  'https://lu.ma/event/evt-ghi789',
  'https://lu.ma/series/series-xyz',
];

export default function() {
  // Select random Lu.ma URL
  const lumaUrl = LUMA_URLS[Math.floor(Math.random() * LUMA_URLS.length)];
  
  // Initiate scraping operation
  const scrapeStart = Date.now();
  const scrapeResponse = http.post(`${BASE_URL}/api/scrape/luma`, {
    url: lumaUrl,
    extract_speakers: true,
    extract_companies: true,
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-token',
    },
    timeout: '30s',
  });

  const scrapeDuration = Date.now() - scrapeStart;
  scrapingDuration.add(scrapeDuration);

  // Validate scraping response
  const scrapeSuccess = check(scrapeResponse, {
    'scraping request accepted': (r) => r.status === 202,
    'job_id provided': (r) => r.json('job_id') !== undefined,
    'response time acceptable': (r) => r.timings.duration < 2000,
  });

  if (!scrapeSuccess) {
    scrapingErrors.add(1);
  }

  // Check processing queue status if scraping succeeded
  if (scrapeResponse.status === 202) {
    const jobId = scrapeResponse.json('job_id');
    
    sleep(1); // Brief pause before status check
    
    const statusResponse = http.get(`${BASE_URL}/api/jobs/${jobId}/status`);
    check(statusResponse, {
      'status check successful': (r) => r.status === 200,
      'job status available': (r) => r.json('status') !== undefined,
    });

    // Track queue depth
    const queueDepth = statusResponse.json('queue_position') || 0;
    processingQueueDepth.add(queueDepth);
  }

  // Realistic pause between scraping operations
  sleep(Math.random() * 3 + 1); // 1-4 second pause
}

// Setup function for test data
export function setup() {
  console.log('Setting up scraping load test...');
  
  // Warm up the scraping service
  const warmupResponse = http.get(`${BASE_URL}/health`);
  check(warmupResponse, {
    'service available for testing': (r) => r.status === 200,
  });

  return { timestamp: Date.now() };
}

// Cleanup function
export function teardown(data) {
  console.log(`Scraping load test completed. Duration: ${Date.now() - data.timestamp}ms`);
}