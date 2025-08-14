# Performance Testing Suite - Event API

## Overview

Comprehensive performance testing framework for the Event API hybrid microservices architecture, designed to validate system performance under realistic load conditions and ensure SLA compliance.

## Architecture Under Test

- **Hono Service** (TypeScript): Web scraping, CRUD operations, user-facing API
- **Elixir Service** (Phoenix): Complex data processing, graph relationships, AI workflows  
- **BAML Service** (Python): AI-powered content extraction and processing
- **Database**: PostgreSQL with pgvector + AGE extensions for vector search and graph queries

## Success Criteria & Benchmarks

### 1. API Response Time Requirements ✅
- **Target**: p95 response times < 200ms across all endpoints
- **Measurement**: k6 load testing with realistic user patterns
- **Thresholds**:
  - Health checks: p95 < 50ms
  - Event listing: p95 < 150ms
  - Search operations: p95 < 300ms
  - Scraping operations: p95 < 2000ms (acceptable due to complexity)

### 2. Database Performance Requirements ✅
- **Target**: Database queries maintain <200ms p95 under 100 concurrent connections
- **Measurement**: pgbench + custom vector search benchmarks
- **Thresholds**:
  - Vector similarity search: p95 < 300ms
  - Graph traversal queries: p95 < 500ms
  - Standard CRUD operations: p95 < 150ms
  - Concurrent connection handling: 100+ connections

### 3. Concurrent Scraping Requirements ✅
- **Target**: 10+ simultaneous scraping operations with <5% failure rate
- **Measurement**: k6 burst and sustained load testing
- **Thresholds**:
  - Concurrent scraping jobs: 10+ simultaneous
  - Success rate: >95%
  - Queue management: Depth <50 jobs under normal load

### 4. Processing Pipeline Requirements ✅
- **Target**: AI processing pipeline throughput >80% with bounded latency
- **Measurement**: End-to-end pipeline testing with realistic HTML content
- **Thresholds**:
  - Processing success rate: >80%
  - AI extraction time: p95 < 3000ms
  - Deduplication time: p95 < 1000ms
  - Total pipeline latency: p95 < 5000ms

### 5. Resource Usage Requirements ✅
- **Target**: Memory and CPU usage within operational limits
- **Measurement**: Continuous profiling during load testing
- **Thresholds**:
  - Hono service memory: <1GB
  - Elixir service memory: <2GB
  - BAML service memory: <1.5GB
  - CPU utilization: p95 < 80%
  - GC pressure: p95 < 100ms pause times

## Implementation Priority

### Phase 1: Critical Performance Validation (Priority 1)
**Status**: ✅ Implemented
- API response time benchmarks
- Database performance testing
- Basic infrastructure setup

**Files Created**:
- `api-response-benchmark.js` - Comprehensive API endpoint testing
- `database-benchmark.js` - Database performance with vector/graph queries
- `k6-config.json` - k6 configuration with proper thresholds
- `run-tests.sh` - Automated test execution script

### Phase 2: Advanced Load Testing (Priority 2)  
**Status**: ✅ Implemented
- Concurrent scraping operations testing
- Processing pipeline throughput validation
- CI/CD integration

**Files Created**:
- `scraping-load-test.js` - Concurrent scraping simulation
- `processing-pipeline-test.js` - End-to-end pipeline testing
- `.github/workflows/performance-testing.yml` - CI/CD integration

### Phase 3: Monitoring & Profiling (Priority 3)
**Status**: ✅ Implemented
- Resource profiling and monitoring
- Performance regression detection
- Advanced reporting

**Files Created**:
- `profiling-config.js` - Service-specific resource monitoring
- `monitoring-setup.yml` - Grafana/InfluxDB monitoring stack
- Database-specific benchmarking tools

## Quick Start

### Prerequisites
```bash
# Install k6
curl https://github.com/grafana/k6/releases/download/v0.47.0/k6-v0.47.0-linux-amd64.tar.gz -L | tar xvz --strip-components 1

# Ensure services are running
docker-compose up -d
```

### Run All Performance Tests
```bash
cd tests/performance
./run-tests.sh all
```

### Run Specific Test Categories
```bash
# API response time testing
./run-tests.sh api

# Database performance testing
./run-tests.sh database

# Scraping load testing
./run-tests.sh scraping

# Processing pipeline testing
./run-tests.sh pipeline

# Resource profiling
./run-tests.sh profiling
```

## Test Files Reference

### Core k6 Test Scripts
| File | Purpose | Duration | Key Metrics |
|------|---------|----------|-------------|
| `api-response-benchmark.js` | API endpoint performance | 8m | Response times, error rates |
| `database-benchmark.js` | Database query performance | 10m | Query latency, throughput |
| `scraping-load-test.js` | Concurrent scraping simulation | 8m | Success rates, queue depth |
| `processing-pipeline-test.js` | End-to-end pipeline testing | 12m | Processing latency, throughput |
| `profiling-config.js` | Resource usage monitoring | 10m | Memory, CPU, GC metrics |

### Database Benchmarking
| File | Purpose | Tool |
|------|---------|------|
| `database-pgbench.sql` | Realistic database workload simulation | pgbench |
| `vector-search-benchmark.sql` | pgvector performance testing | psql |

### Configuration & Infrastructure
| File | Purpose |
|------|---------|
| `k6-config.json` | k6 test configuration and thresholds |
| `run-tests.sh` | Automated test execution and reporting |
| `package.json` | NPM scripts for test management |
| `monitoring-setup.yml` | Grafana/InfluxDB monitoring stack |

## CI/CD Integration

Performance tests are automatically executed on:
- Pull requests affecting service code
- Pushes to main branch
- Manual workflow triggers

**GitHub Actions Workflow**: `.github/workflows/performance-testing.yml`

### Manual CI Testing
```bash
# Trigger specific test type
gh workflow run performance-testing.yml -f test_type=api -f duration=5

# View results
gh run list --workflow=performance-testing.yml
```

## Monitoring & Reporting

### Real-time Monitoring
Start the monitoring stack:
```bash
docker-compose -f monitoring-setup.yml up -d
```

Access dashboards:
- Grafana: http://localhost:3001 (admin/performance2024)
- InfluxDB: http://localhost:8086
- Prometheus: http://localhost:9090

### Performance Reports
Test results are automatically saved to `test-results/performance/TIMESTAMP/`:
- JSON metrics files
- System resource logs  
- Generated performance reports
- Docker container statistics

## Troubleshooting

### Common Issues
1. **Services not ready**: Increase wait time in `run-tests.sh`
2. **Database connection failures**: Verify PostgreSQL container health
3. **k6 installation issues**: Use manual installation script
4. **Memory constraints**: Reduce VU counts in test configurations

### Performance Debugging
```bash
# Check service health
curl http://localhost:3000/health
curl http://localhost:4000/health  
curl http://localhost:8080/health

# Monitor resource usage
docker stats --no-stream

# Database performance
psql -h localhost -U event_api -d event_api_dev -c "\di+"  # Check indexes
```

## Advanced Usage

### Custom Test Scenarios
Create new k6 test files following the established patterns:
```javascript
import { check, sleep } from 'k6';
import http from 'k6/http';

export let options = {
  thresholds: {
    http_req_duration: ['p(95)<200'],
  }
};

export default function() {
  // Your test logic here
}
```

### Database Benchmarking
```bash
# Custom pgbench workload
pgbench -h localhost -U event_api -d event_api_dev -f custom-workload.sql -c 25 -T 300

# Vector search performance
psql -h localhost -U event_api -d event_api_dev -f vector-search-benchmark.sql
```

## Performance Baseline

### Expected Performance Characteristics
- **API Throughput**: 50+ RPS sustained, 100+ RPS burst
- **Database**: 100+ concurrent connections, <200ms query latency
- **Scraping**: 10 concurrent operations, 95%+ success rate
- **Processing**: 5+ jobs/second throughput, <5s end-to-end latency
- **Memory Usage**: <4GB total across all services
- **CPU Usage**: <80% utilization under normal load

### Regression Detection
The CI/CD pipeline automatically compares results against historical baselines and flags significant performance regressions (>20% degradation in key metrics).

---

**Last Updated**: 2024-08-14  
**Version**: 1.0.0  
**Test Coverage**: All INTEGRATION-FEAT-003 requirements implemented