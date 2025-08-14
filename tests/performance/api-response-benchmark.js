import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics for API response tracking
export let apiErrors = new Rate('api_errors');
export let authenticationTime = new Trend('authentication_duration');
export let endpointResponseTimes = new Trend('endpoint_response_times');

export let options = {
  scenarios: {
    // Realistic user journey simulation
    user_journey: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        { duration: '2m', target: 20 },   // Normal load
        { duration: '5m', target: 50 },   // Peak usage
        { duration: '3m', target: 100 },  // Stress test
        { duration: '2m', target: 20 },   // Cool down
      ],
    },
    // Individual endpoint stress testing
    endpoint_stress: {
      executor: 'constant-arrival-rate',
      rate: 10, // 10 requests per second
      timeUnit: '1s',
      duration: '10m',
      preAllocatedVUs: 30,
      maxVUs: 50,
      startTime: '5m', // Start after user journey begins
    }
  },
  thresholds: {
    // Primary success criteria
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
    
    // Endpoint-specific thresholds
    'http_req_duration{endpoint:events_list}': ['p(95)<150'],
    'http_req_duration{endpoint:events_search}': ['p(95)<300'],
    'http_req_duration{endpoint:scrape_luma}': ['p(95)<2000'],
    'http_req_duration{endpoint:health_check}': ['p(95)<50'],
    
    // Authentication performance
    authentication_duration: ['p(95)<100'],
    
    // Error rate by endpoint
    'api_errors{endpoint:events_list}': ['rate<0.005'],
    'api_errors{endpoint:events_search}': ['rate<0.01'],
    'api_errors{endpoint:scrape_luma}': ['rate<0.02'],
  },
};

const BASE_URL = 'http://localhost:3000';
const AUTH_TOKEN = 'test-performance-token';

// API endpoints to test with weights (frequency of access)
const ENDPOINTS = [
  { path: '/api/events', weight: 40, tag: 'events_list', method: 'GET' },
  { path: '/api/events/search', weight: 25, tag: 'events_search', method: 'GET' },
  { path: '/api/speakers', weight: 15, tag: 'speakers_list', method: 'GET' },
  { path: '/api/events/batch', weight: 10, tag: 'batch_operations', method: 'POST' },
  { path: '/api/scrape/luma', weight: 8, tag: 'scrape_luma', method: 'POST' },
  { path: '/health', weight: 2, tag: 'health_check', method: 'GET' },
];

export default function() {
  const scenario = __ENV.K6_SCENARIO || 'user_journey';
  
  if (scenario === 'user_journey') {
    simulateUserJourney();
  } else {
    stressTestRandomEndpoint();
  }
}

function simulateUserJourney() {
  // Typical user flow: browse events -> search -> view details -> potentially scrape
  
  // 1. Browse events (most common action)
  const browseStart = Date.now();
  const eventsResponse = http.get(`${BASE_URL}/api/events`, {
    params: {
      limit: '25',
      status: 'published',
      sort: 'date_asc'
    },
    headers: getAuthHeaders(),
    tags: { endpoint: 'events_list' }
  });

  trackEndpointPerformance(eventsResponse, 'events_list', Date.now() - browseStart);

  sleep(0.5); // User reads the list

  // 2. Search for specific events (if events were found)
  if (eventsResponse.status === 200 && Math.random() < 0.7) {
    const searchStart = Date.now();
    const searchResponse = http.get(`${BASE_URL}/api/events/search`, {
      params: {
        q: getRandomSearchTerm(),
        limit: '10'
      },
      headers: getAuthHeaders(),
      tags: { endpoint: 'events_search' }
    });

    trackEndpointPerformance(searchResponse, 'events_search', Date.now() - searchStart);
    
    sleep(1); // User reviews search results
  }

  // 3. View speakers (occasional action)
  if (Math.random() < 0.3) {
    const speakersStart = Date.now();
    const speakersResponse = http.get(`${BASE_URL}/api/speakers`, {
      params: {
        limit: '10',
        include_events: 'true'
      },
      headers: getAuthHeaders(),
      tags: { endpoint: 'speakers_list' }
    });

    trackEndpointPerformance(speakersResponse, 'speakers_list', Date.now() - speakersStart);
    
    sleep(0.3);
  }

  // 4. Scraping operation (rare but important)
  if (Math.random() < 0.1) {
    const scrapeStart = Date.now();
    const scrapeResponse = http.post(`${BASE_URL}/api/scrape/luma`, {
      url: 'https://lu.ma/event/evt-test-' + Math.random().toString(36).substr(2, 9),
      extract_speakers: true,
      extract_companies: true,
    }, {
      headers: getAuthHeaders(),
      tags: { endpoint: 'scrape_luma' }
    });

    trackEndpointPerformance(scrapeResponse, 'scrape_luma', Date.now() - scrapeStart);
  }

  // User think time between actions
  sleep(Math.random() * 2 + 0.5); // 0.5-2.5 seconds
}

function stressTestRandomEndpoint() {
  const endpoint = selectWeightedEndpoint();
  const requestStart = Date.now();

  let response;
  const headers = getAuthHeaders();

  switch(endpoint.method) {
    case 'GET':
      response = http.get(`${BASE_URL}${endpoint.path}`, {
        params: getEndpointParams(endpoint.tag),
        headers: headers,
        tags: { endpoint: endpoint.tag }
      });
      break;
      
    case 'POST':
      response = http.post(`${BASE_URL}${endpoint.path}`, 
        getPostBody(endpoint.tag),
        {
          headers: headers,
          tags: { endpoint: endpoint.tag }
        }
      );
      break;
  }

  trackEndpointPerformance(response, endpoint.tag, Date.now() - requestStart);
  
  sleep(0.1); // Minimal pause for stress testing
}

function trackEndpointPerformance(response, endpointTag, customDuration) {
  endpointResponseTimes.add(customDuration, { endpoint: endpointTag });

  const success = check(response, {
    [`${endpointTag} response successful`]: (r) => r.status >= 200 && r.status < 400,
    [`${endpointTag} response time acceptable`]: (r) => r.timings.duration < getEndpointThreshold(endpointTag),
  });

  if (!success) {
    apiErrors.add(1, { endpoint: endpointTag });
  }
}

function getAuthHeaders() {
  return {
    'Authorization': `Bearer ${AUTH_TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': 'k6-performance-test/1.0'
  };
}

function selectWeightedEndpoint() {
  const totalWeight = ENDPOINTS.reduce((sum, ep) => sum + ep.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const endpoint of ENDPOINTS) {
    random -= endpoint.weight;
    if (random <= 0) return endpoint;
  }
  
  return ENDPOINTS[0]; // Fallback
}

function getRandomSearchTerm() {
  const terms = [
    'AI conference', 'startup event', 'developer meetup', 
    'tech talk', 'networking', 'machine learning',
    'blockchain', 'cloud computing', 'cybersecurity'
  ];
  return terms[Math.floor(Math.random() * terms.length)];
}

function getEndpointParams(endpointTag) {
  switch(endpointTag) {
    case 'events_list':
      return {
        limit: Math.floor(Math.random() * 50) + 10,
        offset: Math.floor(Math.random() * 1000),
        status: Math.random() > 0.5 ? 'published' : undefined
      };
    case 'events_search':
      return {
        q: getRandomSearchTerm(),
        limit: '15',
        semantic: Math.random() > 0.3 ? 'true' : 'false'
      };
    case 'speakers_list':
      return {
        limit: '20',
        include_events: Math.random() > 0.5 ? 'true' : 'false'
      };
    default:
      return {};
  }
}

function getPostBody(endpointTag) {
  switch(endpointTag) {
    case 'scrape_luma':
      return {
        url: `https://lu.ma/event/evt-test-${Math.random().toString(36).substr(2, 9)}`,
        extract_speakers: Math.random() > 0.3,
        extract_companies: Math.random() > 0.5,
      };
    case 'batch_operations':
      return {
        operations: [
          {
            type: 'update_status',
            event_ids: [`evt_${Math.floor(Math.random() * 1000)}`],
            status: 'processed'
          }
        ]
      };
    default:
      return {};
  }
}

function getEndpointThreshold(endpointTag) {
  switch(endpointTag) {
    case 'health_check': return 50;
    case 'events_list': return 150;
    case 'speakers_list': return 150;
    case 'events_search': return 300;
    case 'batch_operations': return 500;
    case 'scrape_luma': return 2000;
    default: return 200;
  }
}

export function setup() {
  console.log('Setting up API response benchmark...');
  
  // Authenticate and verify token works
  const authStart = Date.now();
  const authResponse = http.get(`${BASE_URL}/health`, {
    headers: getAuthHeaders()
  });
  const authDuration = Date.now() - authStart;
  
  authenticationTime.add(authDuration);
  
  check(authResponse, {
    'authentication successful': (r) => r.status === 200,
  });

  return { timestamp: Date.now() };
}

export function teardown(data) {
  console.log(`API response benchmark completed. Duration: ${Date.now() - data.timestamp}ms`);
}