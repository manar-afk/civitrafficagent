import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MapManager } from './mapManager.js';
import { ConciergeEngine } from './concierge.js';

export class CivicTrafficServer {
  private server: McpServer;
  private mapManager: MapManager;

  constructor() {
    this.server = new McpServer({
      name: 'civic-traffic-concierge',
      version: '1.0.0',
    });

    this.mapManager = new MapManager();
  }

  /**
   * Initializes the map manager and configures all MCP tools, resources, and prompts.
   */
  async initialize(): Promise<void> {
    await this.mapManager.init();

    this.registerResources();
    this.registerTools();
    this.registerPrompts();
  }

  /**
   * Registers resources.
   */
  private registerResources(): void {
    // Resource: town://map - exposes the current raw town map JSON state
    this.server.resource(
      'town-map',
      'town://map',
      async (uri) => ({
        contents: [
          {
            uri: uri.toString(),
            text: JSON.stringify(this.mapManager.getMap(), null, 2),
            mimeType: 'application/json',
          },
        ],
      })
    );

    // Resource: town://incidents - exposes recent priority incidents logged under the Distress Protocol
    this.server.resource(
      'town-incidents',
      'town://incidents',
      async (uri) => {
        const incidents = await this.mapManager.getRecentIncidents(10);
        return {
          contents: [
            {
              uri: uri.toString(),
              text: incidents.length > 0 
                ? incidents.join('\n') 
                : 'No priority incidents logged. All clear!',
              mimeType: 'text/plain',
            },
          ],
        };
      }
    );
  }

  /**
   * Registers tools.
   */
  private registerTools(): void {
    // Tool: get_parking_availability
    this.server.tool(
      'get_parking_availability',
      'Retrieve real-time parking zone capacities, current occupancy, and available spots, complete with neighborly concierge recommendations.',
      {},
      async () => {
        const map = this.mapManager.getMap();
        const advice = await ConciergeEngine.getParkingAdvice(map);
        return {
          content: [{ type: 'text', text: advice }],
        };
      }
    );

    // Tool: get_traffic_status
    this.server.tool(
      'get_traffic_status',
      'Retrieve current road status and bus bottleneck counts, including active detour instructions if the town is congested.',
      {},
      async () => {
        const map = this.mapManager.getMap();
        const advice = await ConciergeEngine.getTrafficAdvice(map);
        return {
          content: [{ type: 'text', text: advice }],
        };
      }
    );

    // Tool: request_route_advice
    this.server.tool(
      'request_route_advice',
      'Request personalized travel advice between a start and destination location, taking local conditions and bottlenecks into account.',
      {
        from: z.string().describe('The starting landmark or road (e.g., "Bus Stand", "Temple", "Hospital")'),
        to: z.string().describe('The destination landmark or road (e.g., "Court Building", "Mini Secretariat")'),
      },
      async ({ from, to }) => {
        const map = this.mapManager.getMap();
        const advice = await ConciergeEngine.getNavigationAdvice(map, from, to);
        return {
          content: [{ type: 'text', text: advice }],
        };
      }
    );

    // Tool: update_bus_count
    this.server.tool(
      'update_bus_count',
      'Update the current count of buses parked at the Bus Stand bottleneck. Triggers the municipal Distress Protocol if count >= 5.',
      {
        busCount: z.number().int().nonnegative().describe('The current number of buses occupying the stand'),
      },
      async ({ busCount }) => {
        const { previousCount, newCount, distressTriggered } = await this.mapManager.updateBusCount(busCount);
        
        let msg = `Bus count updated from ${previousCount} to ${newCount}.`;
        if (distressTriggered) {
          msg += `\n🚨 DISTRESS PROTOCOL TRIGGERED: Critical jam detected! Market Road status has been locked to JAMMED and municipal dispatch has been notified.`;
        } else if (previousCount >= 5 && newCount < 5) {
          msg += `\n✅ Congestion cleared. Bus Stand and Market Road statuses have returned to clear.`;
        }

        return {
          content: [{ type: 'text', text: msg }],
        };
      }
    );

    // Tool: update_parking_occupancy
    this.server.tool(
      'update_parking_occupancy',
      'Update the occupancy status of a specific parking zone in the town.',
      {
        zoneId: z.enum([
          'mini_secretariat',
          'court_building_1',
          'court_building_2',
          'hospital_side',
          'state_highway_side',
        ]).describe('The unique ID of the parking zone to update'),
        occupancy: z.number().int().nonnegative().describe('The number of currently occupied spaces'),
      },
      async ({ zoneId, occupancy }) => {
        try {
          const zone = await this.mapManager.updateParkingOccupancy(zoneId, occupancy);
          const available = zone.capacity - zone.current_occupancy;
          return {
            content: [
              {
                type: 'text',
                text: `Successfully updated occupancy for ${zoneId} to ${occupancy}/${zone.capacity}. Zone status is now: ${zone.status.toUpperCase()} (${available} spaces free).`,
              },
            ],
          };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Failed to update occupancy: ${(error as Error).message}` }],
          };
        }
      }
    );

    // Tool: update_thoroughfare_status
    this.server.tool(
      'update_thoroughfare_status',
      'Manually set the traffic/congestion status of a specific thoroughfare.',
      {
        roadId: z.enum(['market_road', 'state_highway_link']).describe('The ID of the road to update'),
        status: z.string().describe('The new status (e.g., "clear", "heavy", "jammed")'),
      },
      async ({ roadId, status }) => {
        try {
          const road = await this.mapManager.updateThoroughfareStatus(roadId, status);
          return {
            content: [
              {
                type: 'text',
                text: `Successfully set status of ${roadId} to: ${status.toUpperCase()} (Priority: ${road.priority.toUpperCase()}).`,
              },
            ],
          };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Failed to update road status: ${(error as Error).message}` }],
          };
        }
      }
    );
  }

  /**
   * Registers prompts.
   */
  private registerPrompts(): void {
    // Prompt: chat_with_concierge - injects system prompt instructing LLM to adopt the persona
    this.server.prompt(
      'chat_with_concierge',
      'Start a conversational session with the Civic Concierge who will guide you through traffic and parking using local context.',
      {},
      async () => {
        const map = this.mapManager.getMap();
        const systemPrompt = ConciergeEngine.getSystemPrompt(map);
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: systemPrompt,
              },
            },
          ],
        };
      }
    );
  }

  /**
   * Connects the MCP server to a transport instance (stdio or SSE).
   */
  async connectTransport(transport: any): Promise<void> {
    await this.server.connect(transport);
  }
}
