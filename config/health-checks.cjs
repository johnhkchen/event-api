/**
 * Event API - Comprehensive Health Check System
 * Integrates with Coolify monitoring and provides detailed service status
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// Health check configuration
const HEALTH_CONFIG = {
  timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT) || 10000,
  interval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000,
  retries: parseInt(process.env.HEALTH_CHECK_RETRIES) || 3,
  gracePeriod: parseInt(process.env.HEALTH_CHECK_GRACE_PERIOD) || 60000,
  
  services: {
    hono: {
      url: process.env.HONO_API_URL || 'http://localhost:3000',
      endpoint: '/health',
      critical: true
    },
    elixir: {
      url: process.env.ELIXIR_SERVICE_URL || 'http://localhost:4000',
      endpoint: '/health',
      critical: true
    },
    baml: {
      url: process.env.BAML_SERVICE_URL || 'http://localhost:8080',
      endpoint: '/health',
      critical: true
    },
    postgres: {
      url: process.env.DATABASE_URL,
      type: 'database',
      critical: true
    },
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379/0',
      type: 'redis',
      critical: false
    }
  }
};

class HealthChecker {
  constructor() {
    this.status = {
      overall: 'unknown',
      services: {},
      lastCheck: null,
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development'
    };
  }

  /**
   * Perform HTTP health check on a service
   */
  async checkHttpService(name, config) {
    const startTime = Date.now();
    const url = new URL(config.endpoint, config.url);
    
    return new Promise((resolve, reject) => {
      const client = url.protocol === 'https:' ? https : http;
      const timeout = setTimeout(() => {
        reject(new Error('Health check timeout'));
      }, HEALTH_CONFIG.timeout);

      const req = client.get(url.toString(), (res) => {
        clearTimeout(timeout);
        const responseTime = Date.now() - startTime;
        
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const healthy = res.statusCode >= 200 && res.statusCode < 300;
          
          resolve({
            name,
            healthy,
            status: healthy ? 'healthy' : 'unhealthy',
            statusCode: res.statusCode,
            responseTime,
            message: healthy ? 'Service responding normally' : `HTTP ${res.statusCode}`,
            data: this.parseHealthData(data),
            timestamp: new Date().toISOString()
          });
        });
      });

      req.on('error', (error) => {
        clearTimeout(timeout);
        resolve({
          name,
          healthy: false,
          status: 'unhealthy',
          responseTime: Date.now() - startTime,
          message: error.message,
          error: error.code || 'CONNECTION_ERROR',
          timestamp: new Date().toISOString()
        });
      });

      req.setTimeout(HEALTH_CONFIG.timeout, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  /**
   * Parse health check response data
   */
  parseHealthData(data) {
    try {
      const parsed = JSON.parse(data);
      return {
        status: parsed.status,
        version: parsed.version,
        uptime: parsed.uptime,
        dependencies: parsed.dependencies,
        metrics: parsed.metrics
      };
    } catch (e) {
      return { raw: data };
    }
  }

  /**
   * Check database connectivity
   */
  async checkDatabase(name, config) {
    const startTime = Date.now();
    
    try {
      // For PostgreSQL, we'll use a simple query
      const { Client } = require('pg');
      const client = new Client(config.url);
      
      await client.connect();
      const result = await client.query('SELECT version(), now() as current_time');
      await client.end();
      
      const responseTime = Date.now() - startTime;
      
      return {
        name,
        healthy: true,
        status: 'healthy',
        responseTime,
        message: 'Database connection successful',
        data: {
          version: result.rows[0].version.split(' ')[1],
          timestamp: result.rows[0].current_time
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        name,
        healthy: false,
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        message: error.message,
        error: error.code || 'DATABASE_ERROR',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Check Redis connectivity
   */
  async checkRedis(name, config) {
    const startTime = Date.now();
    
    try {
      const redis = require('redis');
      const client = redis.createClient({ url: config.url });
      
      await client.connect();
      await client.ping();
      const info = await client.info('server');
      await client.quit();
      
      const responseTime = Date.now() - startTime;
      
      return {
        name,
        healthy: true,
        status: 'healthy',
        responseTime,
        message: 'Redis connection successful',
        data: {
          version: this.extractRedisVersion(info),
          uptime: this.extractRedisUptime(info)
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        name,
        healthy: false,
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        message: error.message,
        error: error.code || 'REDIS_ERROR',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Extract Redis version from info string
   */
  extractRedisVersion(info) {
    const match = info.match(/redis_version:([^\r\n]+)/);
    return match ? match[1] : 'unknown';
  }

  /**
   * Extract Redis uptime from info string
   */
  extractRedisUptime(info) {
    const match = info.match(/uptime_in_seconds:(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  /**
   * Perform comprehensive health check on all services
   */
  async performHealthCheck() {
    const checks = [];
    const startTime = Date.now();

    // Check all configured services
    for (const [name, config] of Object.entries(HEALTH_CONFIG.services)) {
      let checkPromise;

      switch (config.type) {
        case 'database':
          checkPromise = this.checkDatabase(name, config);
          break;
        case 'redis':
          checkPromise = this.checkRedis(name, config);
          break;
        default:
          checkPromise = this.checkHttpService(name, config);
      }

      checks.push(checkPromise);
    }

    // Execute all health checks concurrently
    const results = await Promise.allSettled(checks);
    const serviceResults = {};
    let allHealthy = true;
    let criticalFailure = false;

    results.forEach((result, index) => {
      const serviceName = Object.keys(HEALTH_CONFIG.services)[index];
      const serviceConfig = HEALTH_CONFIG.services[serviceName];
      
      if (result.status === 'fulfilled') {
        serviceResults[serviceName] = result.value;
        
        if (!result.value.healthy) {
          allHealthy = false;
          if (serviceConfig.critical) {
            criticalFailure = true;
          }
        }
      } else {
        serviceResults[serviceName] = {
          name: serviceName,
          healthy: false,
          status: 'unhealthy',
          message: result.reason.message,
          error: 'HEALTH_CHECK_FAILED',
          timestamp: new Date().toISOString()
        };
        
        allHealthy = false;
        if (serviceConfig.critical) {
          criticalFailure = true;
        }
      }
    });

    // Determine overall status
    let overallStatus = 'healthy';
    if (criticalFailure) {
      overallStatus = 'unhealthy';
    } else if (!allHealthy) {
      overallStatus = 'degraded';
    }

    // Update status
    this.status = {
      overall: overallStatus,
      services: serviceResults,
      lastCheck: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      totalResponseTime: Date.now() - startTime,
      summary: {
        total: Object.keys(serviceResults).length,
        healthy: Object.values(serviceResults).filter(s => s.healthy).length,
        unhealthy: Object.values(serviceResults).filter(s => !s.healthy).length,
        critical: Object.values(serviceResults).filter((s, i) => 
          !s.healthy && HEALTH_CONFIG.services[Object.keys(HEALTH_CONFIG.services)[i]].critical
        ).length
      }
    };

    return this.status;
  }

  /**
   * Get current health status (cached)
   */
  getStatus() {
    return this.status;
  }

  /**
   * Get health status in Coolify-compatible format
   */
  getCoolifyStatus() {
    const isHealthy = this.status.overall === 'healthy';
    
    return {
      status: isHealthy ? 'ok' : 'error',
      message: isHealthy ? 'All services healthy' : `Health check failed: ${this.status.overall}`,
      timestamp: this.status.lastCheck,
      details: this.status.services
    };
  }

  /**
   * Get simple health status for container health checks
   */
  getSimpleStatus() {
    return this.status.overall === 'healthy';
  }

  /**
   * Start periodic health checks
   */
  startPeriodicChecks() {
    // Perform initial check
    this.performHealthCheck().catch(console.error);
    
    // Set up periodic checks
    setInterval(() => {
      this.performHealthCheck().catch(console.error);
    }, HEALTH_CONFIG.interval);
    
    console.log(`Health checker started with ${HEALTH_CONFIG.interval}ms interval`);
  }
}

// Create global health checker instance
const healthChecker = new HealthChecker();

// Health check HTTP server for container health checks
function createHealthServer(port = 3001) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      switch (url.pathname) {
        case '/health':
        case '/health/':
          // Detailed health check
          await healthChecker.performHealthCheck();
          const status = healthChecker.getStatus();
          const statusCode = status.overall === 'healthy' ? 200 : 503;
          
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(status, null, 2));
          break;

        case '/health/simple':
          // Simple health check for load balancers
          const simple = healthChecker.getSimpleStatus();
          const simpleCode = simple ? 200 : 503;
          
          res.writeHead(simpleCode, { 'Content-Type': 'text/plain' });
          res.end(simple ? 'OK' : 'UNHEALTHY');
          break;

        case '/health/coolify':
          // Coolify-compatible format
          const coolify = healthChecker.getCoolifyStatus();
          const coolifyCode = coolify.status === 'ok' ? 200 : 503;
          
          res.writeHead(coolifyCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(coolify, null, 2));
          break;

        case '/health/live':
          // Kubernetes-style liveness probe
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('LIVE');
          break;

        case '/health/ready':
          // Kubernetes-style readiness probe
          const ready = healthChecker.getSimpleStatus();
          const readyCode = ready ? 200 : 503;
          
          res.writeHead(readyCode, { 'Content-Type': 'text/plain' });
          res.end(ready ? 'READY' : 'NOT_READY');
          break;

        default:
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'Not Found',
            available_endpoints: ['/health', '/health/simple', '/health/coolify', '/health/live', '/health/ready']
          }));
      }
    } catch (error) {
      console.error('Health check error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error', message: error.message }));
    }
  });

  server.listen(port, () => {
    console.log(`Health check server running on port ${port}`);
  });

  return server;
}

// Export for use in other modules
module.exports = {
  HealthChecker,
  healthChecker,
  createHealthServer,
  HEALTH_CONFIG
};

// If running directly, start the health server
if (require.main === module) {
  const port = process.env.HEALTH_CHECK_PORT || 3001;
  
  // Start periodic health checks
  healthChecker.startPeriodicChecks();
  
  // Start health check HTTP server
  createHealthServer(port);
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('Health checker shutting down gracefully...');
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    console.log('Health checker interrupted, shutting down...');
    process.exit(0);
  });
}