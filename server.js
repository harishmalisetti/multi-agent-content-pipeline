import http from 'http';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import { runBackendPipeline } from './pipeline.js';
import { agentsConfig } from './agents.js';

// Load environment variables natively (Node v20.12.0+)
try {
  process.loadEnvFile();
  console.log('Successfully loaded environment variables from .env file.');
} catch (err) {
  console.log('Note: No .env file loaded natively:', err.message);
}

// Memory database for agent system prompts overrides
const promptOverrides = {};

// Active pipeline run config store
const activeRuns = {};

const server = http.createServer(async (req, res) => {
  // CORS Headers for client integration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight options requests
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // 1. GET /api/health
  if (pathname === '/api/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const hasKey = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
    res.end(JSON.stringify({ status: 'ok', geminiActive: hasKey }));
    return;
  }

  // 2. GET /api/agents
  if (pathname === '/api/agents' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // Merge baseline personas with server overrides
    const config = {};
    Object.keys(agentsConfig).forEach(id => {
      config[id] = {
        ...agentsConfig[id],
        systemPrompt: promptOverrides[id] || agentsConfig[id].systemPrompt
      };
    });
    res.end(JSON.stringify(config));
    return;
  }

  // 3. POST /api/agents/:id
  if (pathname.startsWith('/api/agents/') && req.method === 'POST') {
    const agentId = pathname.substring('/api/agents/'.length);
    if (agentsConfig[agentId]) {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.systemPrompt) {
            promptOverrides[agentId] = data.systemPrompt;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        }
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Agent not found' }));
    }
    return;
  }

  // 4. POST /api/pipeline/run
  if (pathname === '/api/pipeline/run' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const options = JSON.parse(body);
        const runId = Math.random().toString(36).substring(2, 15);
        activeRuns[runId] = options;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ runId }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  // 5. GET /api/pipeline/stream?runId=...
  if (pathname === '/api/pipeline/stream' && req.method === 'GET') {
    const runId = parsedUrl.searchParams.get('runId');
    const runOptions = activeRuns[runId];

    if (!runOptions) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Run configuration not found' }));
      return;
    }

    // Set SSE Headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const onEvent = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      const mergedOptions = {
        ...runOptions,
        prompts: {
          ...promptOverrides,
          ...runOptions.prompts
        }
      };
      await runBackendPipeline(mergedOptions, onEvent);
      onEvent({ type: 'complete' });
      delete activeRuns[runId];
    } catch (err) {
      onEvent({ 
        type: 'log', 
        tag: 'system', 
        message: `Internal Server Error: ${err.message}`, 
        color: 'rgba(235, 87, 87, 0.2)', 
        textColor: '#eb5757' 
      });
    } finally {
      res.end();
    }
    return;
  }

  // Serve static assets for non-API requests (unifies frontend and backend)
  if (!pathname.startsWith('/api')) {
    // Prevent directory traversal
    const safePath = pathname.replace(/^(\.\.[\/\\])+/, '');
    let filePath = path.join(process.cwd(), safePath);
    
    try {
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
      if (error) {
        if (error.code == 'ENOENT') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
        } else {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(`500 Server Error: ${error.code}`);
        }
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
      }
    });
    return;
  }

  // Fallback 404 for API routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Route not found' }));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🚀 Multi-Agent Content Pipeline server is running`);
  console.log(`   Host: http://localhost:${PORT}`);
  console.log(`   Health Check: http://localhost:${PORT}/api/health`);
  console.log(`==================================================`);
});
