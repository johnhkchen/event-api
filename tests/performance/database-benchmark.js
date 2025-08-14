import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics for database performance
export let dbQueryErrors = new Rate('db_query_errors');
export let vectorSearchDuration = new Trend('vector_search_duration');
export let graphQueryDuration = new Trend('graph_query_duration');
export let crudOperationDuration = new Trend('crud_operation_duration');
export let concurrentConnections = new Counter('concurrent_db_connections');

export let options = {
  scenarios: {
    // Vector search performance test
    vector_search_load: {
      executor: 'constant-vus',
      vus: 20,
      duration: '5m',
      tags: { test_type: 'vector_search' },
    },
    // Graph query performance test  
    graph_query_load: {
      executor: 'constant-vus',
      vus: 15,
      duration: '5m',
      startTime: '30s',
      tags: { test_type: 'graph_queries' },
    },
    // CRUD operations baseline
    crud_baseline: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        { duration: '2m', target: 25 },
        { duration: '5m', target: 50 },
        { duration: '2m', target: 10 },
      ],
      startTime: '1m',
      tags: { test_type: 'crud_operations' },
    }
  },
  thresholds: {
    // Overall API response time requirements
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
    
    // Vector search specific thresholds
    'vector_search_duration': ['p(95)<300'],
    'graph_query_duration': ['p(95)<500'],
    'crud_operation_duration': ['p(95)<150'],
    
    // Error rate thresholds by test type
    'db_query_errors{test_type:vector_search}': ['rate<0.01'],
    'db_query_errors{test_type:graph_queries}': ['rate<0.02'],
    'db_query_errors{test_type:crud_operations}': ['rate<0.005'],
  },
};

const BASE_URL = 'http://localhost:3000';
const INTERNAL_URL = 'http://localhost:4000'; // Elixir service

// Sample search queries and embeddings for testing
const SEARCH_QUERIES = [
  'machine learning conference',
  'startup networking event', 
  'developer meetup',
  'AI workshop',
  'tech talk series'
];

const GRAPH_QUERIES = [
  'speaker_company_connections',
  'event_topic_clustering', 
  'speaker_coappearance_network',
  'company_event_participation'
];

export default function() {
  const testType = __ENV.K6_SCENARIO || 'crud_operations';
  concurrentConnections.add(1);

  switch(testType) {
    case 'vector_search':
      performVectorSearch();
      break;
    case 'graph_queries':
      performGraphQuery();
      break;
    default:
      performCrudOperations();
  }

  sleep(Math.random() * 0.5 + 0.2); // 200ms-700ms pause
}

function performVectorSearch() {
  const query = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
  
  const searchStart = Date.now();
  const response = http.get(`${BASE_URL}/api/events/search`, {
    params: {
      q: query,
      semantic: 'true',
      limit: '20',
      include_embeddings: 'false'
    }
  });
  
  const searchDuration = Date.now() - searchStart;
  vectorSearchDuration.add(searchDuration);

  const success = check(response, {
    'vector search successful': (r) => r.status === 200,
    'results returned': (r) => r.json('events') && r.json('events').length > 0,
    'response time acceptable': (r) => r.timings.duration < 300,
    'similarity scores present': (r) => r.json('events')[0]?.similarity_score !== undefined,
  });

  if (!success) {
    dbQueryErrors.add(1, { test_type: 'vector_search' });
  }
}

function performGraphQuery() {
  const queryType = GRAPH_QUERIES[Math.floor(Math.random() * GRAPH_QUERIES.length)];
  
  const graphStart = Date.now();
  const response = http.post(`${INTERNAL_URL}/internal/graph/${queryType}`, {
    depth: 2,
    limit: 50,
    filters: {
      date_range: '2024-01-01,2024-12-31'
    }
  }, {
    headers: { 'Content-Type': 'application/json' }
  });

  const graphDuration = Date.now() - graphStart;
  graphQueryDuration.add(graphDuration);

  const success = check(response, {
    'graph query successful': (r) => r.status === 200,
    'graph data returned': (r) => r.json('nodes') !== undefined,
    'relationships present': (r) => r.json('edges') !== undefined,
    'response time acceptable': (r) => r.timings.duration < 500,
  });

  if (!success) {
    dbQueryErrors.add(1, { test_type: 'graph_queries' });
  }
}

function performCrudOperations() {
  // Mix of read and write operations
  const operation = Math.random();
  
  if (operation < 0.7) {
    // 70% read operations
    performEventRead();
  } else if (operation < 0.9) {
    // 20% event updates
    performEventUpdate();
  } else {
    // 10% speaker/company operations
    performSpeakerOperation();
  }
}

function performEventRead() {
  const crudStart = Date.now();
  const response = http.get(`${BASE_URL}/api/events`, {
    params: {
      limit: '25',
      offset: Math.floor(Math.random() * 1000),
      status: 'published'
    }
  });

  const crudDuration = Date.now() - crudStart;
  crudOperationDuration.add(crudDuration);

  const success = check(response, {
    'event read successful': (r) => r.status === 200,
    'events returned': (r) => Array.isArray(r.json('events')),
    'response time acceptable': (r) => r.timings.duration < 150,
  });

  if (!success) {
    dbQueryErrors.add(1, { test_type: 'crud_operations' });
  }
}

function performEventUpdate() {
  // Simulate realistic event updates
  const eventId = `evt_${Math.floor(Math.random() * 10000)}`;
  
  const crudStart = Date.now();
  const response = http.patch(`${BASE_URL}/api/events/${eventId}`, {
    status: 'updated',
    last_modified: new Date().toISOString(),
    view_count: Math.floor(Math.random() * 100)
  }, {
    headers: { 'Content-Type': 'application/json' }
  });

  const crudDuration = Date.now() - crudStart;
  crudOperationDuration.add(crudDuration);

  // Accept 404s as normal for update tests
  const success = check(response, {
    'update response valid': (r) => r.status === 200 || r.status === 404,
    'response time acceptable': (r) => r.timings.duration < 150,
  });

  if (!success) {
    dbQueryErrors.add(1, { test_type: 'crud_operations' });
  }
}

function performSpeakerOperation() {
  const crudStart = Date.now();
  const response = http.get(`${BASE_URL}/api/speakers`, {
    params: {
      limit: '10',
      include_events: 'true'
    }
  });

  const crudDuration = Date.now() - crudStart;
  crudOperationDuration.add(crudDuration);

  const success = check(response, {
    'speaker read successful': (r) => r.status === 200,
    'response time acceptable': (r) => r.timings.duration < 150,
  });

  if (!success) {
    dbQueryErrors.add(1, { test_type: 'crud_operations' });
  }
}

export function setup() {
  console.log('Setting up database performance test...');
  
  // Verify all services are responding
  const services = [
    { name: 'Hono API', url: `${BASE_URL}/health` },
    { name: 'Elixir Service', url: `${INTERNAL_URL}/health` }
  ];

  for (const service of services) {
    const response = http.get(service.url);
    check(response, {
      [`${service.name} available`]: (r) => r.status === 200,
    });
  }

  return { timestamp: Date.now() };
}

export function teardown(data) {
  console.log(`Database performance test completed. Duration: ${Date.now() - data.timestamp}ms`);
}