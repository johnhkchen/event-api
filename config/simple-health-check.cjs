#!/usr/bin/env node

/**
 * Simple Health Check for Event API Validation
 */

const http = require('http');

async function checkService(name, port, path = '/health') {
    return new Promise((resolve) => {
        const req = http.request({
            hostname: 'localhost',
            port: port,
            path: path,
            timeout: 5000,
            method: 'GET'
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    service: name,
                    status: res.statusCode === 200 ? 'healthy' : 'unhealthy',
                    statusCode: res.statusCode
                });
            });
        });

        req.on('error', (error) => {
            resolve({
                service: name,
                status: 'unhealthy',
                error: error.message
            });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({
                service: name,
                status: 'unhealthy',
                error: 'Timeout'
            });
        });

        req.end();
    });
}

async function healthCheck() {
    const services = [
        { name: 'hono', port: 3000 },
        { name: 'elixir', port: 4000 },
        { name: 'baml', port: 8080 }
    ];

    const results = await Promise.all(
        services.map(s => checkService(s.name, s.port))
    );

    const healthy = results.filter(r => r.status === 'healthy').length;
    const total = results.length;

    return {
        status: healthy === total ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        services: results.reduce((acc, r) => {
            acc[r.service] = r.status;
            return acc;
        }, {}),
        summary: { healthy, total }
    };
}

// CLI usage
if (require.main === module) {
    healthCheck().then(result => {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.status === 'healthy' ? 0 : 1);
    }).catch(error => {
        console.error('Health check failed:', error);
        process.exit(1);
    });
}

module.exports = { checkService, healthCheck };