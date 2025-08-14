import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Gauge } from 'k6/metrics';
import exec from 'k6/execution';

// Custom metrics for resource usage tracking
export let memoryUsage = new Gauge('memory_usage_mb');
export let cpuUsage = new Gauge('cpu_usage_percent');
export let serviceHealth = new Rate('service_health');
export let gcPressure = new Trend('gc_pressure_ms');

export let options = {
  scenarios: {
    // Profile during normal load
    profiling_normal_load: {
      executor: 'constant-vus',
      vus: 10,
      duration: '5m',
      exec: 'profileNormalLoad',
    },
    // Profile during stress conditions
    profiling_stress_load: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '2m', target: 50 },
        { duration: '5m', target: 100 },
        { duration: '2m', target: 10 },
      ],
      startTime: '30s',
      exec: 'profileStressLoad',
    },
    // Continuous resource monitoring
    resource_monitor: {
      executor: 'constant-vus',
      vus: 1,
      duration: '12m',
      exec: 'monitorResources',
    }
  },
  thresholds: {
    // Resource usage thresholds
    'memory_usage_mb{service:hono}': ['value<1000'],      // Hono under 1GB
    'memory_usage_mb{service:elixir}': ['value<2000'],    // Elixir under 2GB
    'memory_usage_mb{service:baml}': ['value<1500'],      // BAML under 1.5GB
    'cpu_usage_percent': ['p(95)<80'],                    // CPU under 80%
    'gc_pressure_ms': ['p(95)<100'],                      // GC pauses under 100ms
    service_health: ['rate>0.98'],                        // 98%+ health checks pass
  },
};

const SERVICES = [
  {
    name: 'hono',
    healthUrl: 'http://localhost:3000/health',
    metricsUrl: 'http://localhost:3000/metrics',
    profilingCommands: {
      memory: 'docker stats event-api-hono --no-stream --format "table {{.MemUsage}}"',
      cpu: 'docker stats event-api-hono --no-stream --format "table {{.CPUPerc}}"',
      profile: 'curl -s http://localhost:3000/profile/heap > /tmp/hono-heap-profile.json'
    }
  },
  {
    name: 'elixir',
    healthUrl: 'http://localhost:4000/health',
    metricsUrl: 'http://localhost:4000/metrics',
    profilingCommands: {
      memory: 'docker stats event-api-elixir --no-stream --format "table {{.MemUsage}}"',
      cpu: 'docker stats event-api-elixir --no-stream --format "table {{.CPUPerc}}"',
      profile: 'curl -s http://localhost:4000/observer/memory > /tmp/elixir-memory-profile.json'
    }
  },
  {
    name: 'baml',
    healthUrl: 'http://localhost:8080/health',
    metricsUrl: 'http://localhost:8080/metrics',
    profilingCommands: {
      memory: 'docker stats event-api-baml --no-stream --format "table {{.MemUsage}}"',
      cpu: 'docker stats event-api-baml --no-stream --format "table {{.CPUPerc}}"',
      profile: 'curl -s http://localhost:8080/profile/memory > /tmp/baml-memory-profile.json'
    }
  }
];

export function profileNormalLoad() {
  // Generate normal API load while profiling
  const service = SERVICES[Math.floor(Math.random() * SERVICES.length)];
  
  const response = http.get(service.healthUrl);
  const healthCheck = check(response, {
    [`${service.name} health check`]: (r) => r.status === 200,
  });

  serviceHealth.add(healthCheck ? 1 : 0, { service: service.name });

  // Collect resource metrics if available
  collectResourceMetrics(service);

  sleep(2);
}

export function profileStressLoad() {
  // Generate high load across all services
  const requests = [
    http.get('http://localhost:3000/api/events?limit=100'),
    http.get('http://localhost:3000/api/events/search?q=test&limit=50'),
    http.get('http://localhost:4000/internal/graph/speaker_networks'),
  ];

  // Process requests in parallel to increase load
  const responses = http.batch(requests);
  
  responses.forEach((response, index) => {
    const serviceName = ['hono', 'hono', 'elixir'][index];
    const healthCheck = check(response, {
      [`${serviceName} stress response`]: (r) => r.status === 200 || r.status === 202,
    });
    
    serviceHealth.add(healthCheck ? 1 : 0, { service: serviceName });
  });

  sleep(0.5); // Higher frequency during stress test
}

export function monitorResources() {
  // Continuous monitoring of all services
  for (const service of SERVICES) {
    collectDetailedMetrics(service);
  }
  
  sleep(10); // Monitor every 10 seconds
}

function collectResourceMetrics(service) {
  // Get basic resource usage from service metrics endpoint
  const metricsResponse = http.get(service.metricsUrl);
  
  if (metricsResponse.status === 200) {
    const metricsText = metricsResponse.body;
    
    // Parse memory usage (simplified - in real implementation, parse Prometheus format)
    const memoryMatch = metricsText.match(/memory_usage_bytes\s+(\d+)/);
    if (memoryMatch) {
      const memoryMB = parseInt(memoryMatch[1]) / (1024 * 1024);
      memoryUsage.add(memoryMB, { service: service.name });
    }
    
    // Parse CPU usage
    const cpuMatch = metricsText.match(/cpu_usage_percent\s+(\d+\.?\d*)/);
    if (cpuMatch) {
      const cpuPercent = parseFloat(cpuMatch[1]);
      cpuUsage.add(cpuPercent, { service: service.name });
    }

    // Parse GC metrics (for services that expose them)
    const gcMatch = metricsText.match(/gc_duration_ms\s+(\d+\.?\d*)/);
    if (gcMatch) {
      const gcDuration = parseFloat(gcMatch[1]);
      gcPressure.add(gcDuration, { service: service.name });
    }
  }
}

function collectDetailedMetrics(service) {
  // Collect more detailed resource information
  collectResourceMetrics(service);
  
  // Additional service-specific profiling
  switch(service.name) {
    case 'hono':
      collectNodeJSMetrics(service);
      break;
    case 'elixir':
      collectElixirMetrics(service);
      break;
    case 'baml':
      collectPythonMetrics(service);
      break;
  }
}

function collectNodeJSMetrics(service) {
  // Node.js specific metrics collection
  const nodeMetricsResponse = http.get(`${service.metricsUrl}/nodejs`);
  
  if (nodeMetricsResponse.status === 200) {
    const nodeMetrics = nodeMetricsResponse.json();
    
    if (nodeMetrics.memory) {
      memoryUsage.add(nodeMetrics.memory.heapUsed / (1024 * 1024), { 
        service: service.name, 
        type: 'heap' 
      });
    }
    
    if (nodeMetrics.gc && nodeMetrics.gc.lastDuration) {
      gcPressure.add(nodeMetrics.gc.lastDuration, { service: service.name });
    }
  }
}

function collectElixirMetrics(service) {
  // Elixir/BEAM specific metrics
  const elixirMetricsResponse = http.get(`${service.metricsUrl}/beam`);
  
  if (elixirMetricsResponse.status === 200) {
    const elixirMetrics = elixirMetricsResponse.json();
    
    if (elixirMetrics.memory) {
      // Elixir memory is already in bytes
      memoryUsage.add(elixirMetrics.memory.total / (1024 * 1024), { 
        service: service.name,
        type: 'total'
      });
      
      memoryUsage.add(elixirMetrics.memory.processes / (1024 * 1024), { 
        service: service.name,
        type: 'processes'
      });
    }
    
    if (elixirMetrics.schedulers) {
      // Convert scheduler utilization to CPU percentage
      const avgUtilization = elixirMetrics.schedulers.reduce((sum, s) => sum + s.utilization, 0) / elixirMetrics.schedulers.length;
      cpuUsage.add(avgUtilization * 100, { service: service.name });
    }
  }
}

function collectPythonMetrics(service) {
  // Python specific metrics collection
  const pythonMetricsResponse = http.get(`${service.metricsUrl}/python`);
  
  if (pythonMetricsResponse.status === 200) {
    const pythonMetrics = pythonMetricsResponse.json();
    
    if (pythonMetrics.memory) {
      memoryUsage.add(pythonMetrics.memory.rss / (1024 * 1024), { 
        service: service.name,
        type: 'rss'
      });
    }
    
    if (pythonMetrics.gc) {
      // Python GC collections as proxy for memory pressure
      gcPressure.add(pythonMetrics.gc.collections * 10, { 
        service: service.name 
      }); // Rough conversion to ms
    }
  }
}

export function setup() {
  console.log('Setting up resource profiling...');
  
  // Verify all services expose metrics
  for (const service of SERVICES) {
    const healthResponse = http.get(service.healthUrl);
    const metricsResponse = http.get(service.metricsUrl);
    
    check(null, {
      [`${service.name} health endpoint available`]: () => healthResponse.status === 200,
      [`${service.name} metrics endpoint available`]: () => metricsResponse.status === 200,
    });
  }

  return { 
    timestamp: Date.now(),
    testId: `profiling-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  };
}

export function teardown(data) {
  console.log(`Resource profiling completed. Duration: ${Date.now() - data.timestamp}ms`);
  console.log(`Test ID: ${data.testId}`);
  
  // Collect final resource snapshots
  for (const service of SERVICES) {
    collectDetailedMetrics(service);
  }
}