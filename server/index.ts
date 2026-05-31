import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { MapManager } from './mapManager.js';
import { ConciergeEngine } from './concierge.js';
import { CivicTrafficServer } from './mcpServer.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  // Initialize state manager
  const mapManager = new MapManager();
  await mapManager.init();

  // Initialize MCP server instance
  const mcpServer = new CivicTrafficServer();
  await mcpServer.initialize();

  // Setup express
  const PORT = process.env.PORT || process.env.MCP_PORT || '8080';
  const app = createMcpExpressApp();

  // CORS middleware for local development
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
    } else {
      next();
    }
  });

  // --- HEALTH CHECK ENDPOINT ---
  app.get('/health', (req, res) => res.send('OK'));

  // --- REST API ENDPOINTS FOR FRONTEND ---

  // Get current map data
  app.get('/api/map', (req, res) => {
    res.json(mapManager.getMap());
  });

  // Get recent incident logs
  app.get('/api/incidents', async (req, res) => {
    try {
      const incidents = await mapManager.getRecentIncidents(10);
      res.json(incidents);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Update bus count at the bus stand
  app.post('/api/update-bus', async (req, res) => {
    try {
      const { busCount } = req.body;
      if (typeof busCount !== 'number' || busCount < 0) {
        res.status(400).json({ error: 'busCount must be a non-negative number' });
        return;
      }
      const result = await mapManager.updateBusCount(busCount);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Update parking occupancy
  app.post('/api/update-parking', async (req, res) => {
    try {
      const { zoneId, occupancy } = req.body;
      if (!zoneId || typeof occupancy !== 'number' || occupancy < 0) {
        res.status(400).json({ error: 'zoneId and non-negative occupancy are required' });
        return;
      }
      const zone = await mapManager.updateParkingOccupancy(zoneId, occupancy);
      res.json(zone);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Update thoroughfare status
  app.post('/api/update-road', async (req, res) => {
    try {
      const { roadId, status } = req.body;
      if (!roadId || !status) {
        res.status(400).json({ error: 'roadId and status are required' });
        return;
      }
      const road = await mapManager.updateThoroughfareStatus(roadId, status);
      res.json(road);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Vertex AI Concierge Chat Proxy
  app.post('/api/chat', async (req, res) => {
    try {
      const { message, history } = req.body;
      if (!message) {
        res.status(400).json({ error: 'message is required' });
        return;
      }

      // Query the ConciergeEngine (which utilizes Vertex AI and safety settings)
      const reply = await ConciergeEngine.chat(mapManager.getMap(), message, history || []);
      res.json({ reply });
    } catch (error) {
      console.error('Chat error:', error);
      res.status(500).json({ error: 'Failed to query Civic Concierge.' });
    }
  });

  // --- MCP SSE CONNECTION ENDPOINTS ---
  const transports: Record<string, SSEServerTransport> = {};

  app.get('/mcp', async (req, res) => {
    console.error('New MCP SSE connection requested');
    try {
      const transport = new SSEServerTransport('/messages', res);
      const sessionId = transport.sessionId;
      transports[sessionId] = transport;

      transport.onclose = () => {
        console.error(`MCP SSE transport closed for session ${sessionId}`);
        delete transports[sessionId];
      };

      await mcpServer.connectTransport(transport);
      console.error(`Established MCP SSE stream for session: ${sessionId}`);
    } catch (error) {
      console.error('Failed to establish MCP SSE stream:', error);
      if (!res.headersSent) {
        res.status(500).send('Failed to establish SSE stream');
      }
    }
  });

  app.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      res.status(400).send('Missing sessionId query parameter');
      return;
    }

    const transport = transports[sessionId];
    if (!transport) {
      res.status(404).send(`Session '${sessionId}' not found or expired`);
      return;
    }

    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      console.error(`Error handling MCP message for session ${sessionId}:`, error);
      if (!res.headersSent) {
        res.status(500).send('Error handling request');
      }
    }
  });

  // --- SERVE STATIC FRONTEND BUILD (PRODUCTION) ---
  const distPath = path.resolve(__dirname, '../../dist');
  app.use(express.static(distPath));

  // Catch-all route to serve index.html for SPA router support
  app.get('*', (req, res, next) => {
    // Skip if request is for API or MCP endpoints
    if (req.path.startsWith('/api') || req.path.startsWith('/mcp') || req.path.startsWith('/messages')) {
      next();
    } else {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });

  // Listen
  const portNum = parseInt(PORT, 10);
  app.listen(portNum, '0.0.0.0', () => {
    console.error(`Civic Path server listening on port ${portNum}`);
    console.error(`REST APIs, vertex AI chat, and MCP endpoints are ready.`);
  });

  // Clean shutdown
  process.on('SIGINT', async () => {
    console.error('Shutting down server...');
    for (const sessionId in transports) {
      try {
        await transports[sessionId].close();
      } catch (error) {
        console.error(`Error closing transport ${sessionId}:`, error);
      }
    }
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error during initialization:', error);
  process.exit(1);
});
