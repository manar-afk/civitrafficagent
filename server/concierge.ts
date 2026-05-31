import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
import { TownMap } from './types.js';

const PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || process.env.PROJECT_ID;
const LOCATION = process.env.GCP_LOCATION || 'us-central1';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

let generativeModel: any = null;

function getModel() {
  if (generativeModel) return generativeModel;

  const vertexConfig: any = { location: LOCATION };
  if (PROJECT_ID) vertexConfig.project = PROJECT_ID;

  try {
    const vertexAI = new VertexAI(vertexConfig);
    generativeModel = vertexAI.getGenerativeModel({
      model: GEMINI_MODEL,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
        },
      ],
    });
    return generativeModel;
  } catch (error) {
    console.error('Failed to initialize Vertex AI client:', error);
    return null;
  }
}

export class ConciergeEngine {
  /**
   * Constructs the rich local-guide system prompt inject containing map state and personality instructions.
   */
  static getSystemPrompt(map: TownMap): string {
    const busStand = map.nodes.bus_stand;
    const isDistressed = busStand.current_bus_count >= busStand.jam_threshold_buses;

    return `You are the **Civic Concierge**, an AI-driven traffic and parking management guide for our town.
Your mission is to help residents navigate daily frustrations by shifting them from guessing where to park to being gently guided.

### YOUR PERSONALITY AND RULES:
1. **Empathy & Validation First**: Never be robotic. If the user mentions traffic, parking struggles, or a long day, validate them! Say things like: "Agh, I know how that feels," "No one likes sitting in gridlock," "Let's save you some time."
2. **Local Identity**: Talk like a helpful neighbor who knows the town inside out. Reference our local landmarks:
   - **Central Ground** (our main town anchor)
   - **Temple** (a key reference point on the highway side)
   - **W. Office** (a key reference point near the Mini Secretariat)
3. **Emergency Protocol (Distress Alert)**:
   - If the current bus count at the Bus Stand is **5 or more**, the Distress Protocol is active.
   - You must treat this with urgency. Inform the user that a priority alert has been logged for municipal action, and strictly recommend they avoid Market Road.
4. **Actionable Parking Guidance**:
   - Guide users to available parking zones. If their target zone is full, politely redirect them to an adjacent zone (e.g., from Court Building 1 to Court Building 2).

### CURRENT TOWN INFRASTRUCTURE STATE:
- **Bus Stand Bottleneck**:
  * Current Bus Count: ${busStand.current_bus_count} buses (Threshold: ${busStand.jam_threshold_buses})
  * Status: ${busStand.status.toUpperCase()}
  * Distress Protocol Active: ${isDistressed ? 'YES (Market Road blocked!)' : 'NO'}

- **Parking Zones Status**:
${Object.entries(map.nodes.parking_zones)
  .map(([id, zone]) => {
    const free = zone.capacity - zone.current_occupancy;
    return `  * ${id.replace(/_/g, ' ').toUpperCase()}: Capacity ${zone.capacity}, Occupancy ${zone.current_occupancy} (${free} spots left). Status: ${zone.status.toUpperCase()}`;
  })
  .join('\n')}

- **Thoroughfares**:
  * Market Road (Priority: High): Status ${map.nodes.thoroughfares.market_road.status.toUpperCase()}
  * State Highway Link (Priority: Medium): Status ${map.nodes.thoroughfares.state_highway_link.status.toUpperCase()}

### DETOUR PROTOCOL:
- Reroute advice: ${map.emergency_protocol.reroute_advice}

Always generate friendly, markdown-formatted responses using these facts. Keep answers concise.`;
  }

  /**
   * Generates dynamic responses using Google Vertex AI, falling back to a structured local formatter.
   */
  private static async generateWithVertexAI(systemPrompt: string, userMessage: string): Promise<string> {
    const model = getModel();
    if (!model) {
      throw new Error('Vertex AI Model is not initialized. Falling back to local formatter.');
    }

    const chat = model.startChat({
      systemInstruction: systemPrompt,
    });

    const result = await chat.sendMessage(userMessage);
    const response = await result.response;
    if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
      return response.candidates[0].content.parts[0].text;
    }
    throw new Error('Empty response candidate received.');
  }

  /**
   * Generates conversational response for client chats (supporting history).
   */
  static async chat(map: TownMap, message: string, history: any[] = []): Promise<string> {
    const model = getModel();
    const systemPrompt = this.getSystemPrompt(map);

    if (model) {
      try {
        const chat = model.startChat({
          history: history || [],
          systemInstruction: systemPrompt,
        });
        const result = await chat.sendMessage(message);
        const response = await result.response;
        return response.candidates[0].content.parts[0].text;
      } catch (error) {
        console.error('Error in Vertex AI Chat:', error);
      }
    }

    // Default local conversational fallback
    return `Hi there! I'm currently running on local backup mode. ${
      map.nodes.bus_stand.current_bus_count >= 5 
        ? 'Please be aware that Market Road is gridlocked due to a bus backup. Take the State Highway Link detour!' 
        : 'All clear on Market Road. Let me know if you need parking suggestions!'
    }`;
  }

  /**
   * Helper: Advice on parking availability.
   */
  static async getParkingAdvice(map: TownMap): Promise<string> {
    const systemPrompt = this.getSystemPrompt(map);
    try {
      return await this.generateWithVertexAI(
        systemPrompt,
        'Provide a friendly, landmark-aware status report on all parking zones and recommend where to park.'
      );
    } catch (error) {
      return this.fallbackParkingAdvice(map);
    }
  }

  /**
   * Helper: Advice on traffic bottlenecks.
   */
  static async getTrafficAdvice(map: TownMap): Promise<string> {
    const systemPrompt = this.getSystemPrompt(map);
    try {
      return await this.generateWithVertexAI(
        systemPrompt,
        'Provide a friendly status report on the thoroughfares and the Bus Stand bottleneck.'
      );
    } catch (error) {
      return this.fallbackTrafficAdvice(map);
    }
  }

  /**
   * Helper: Travel navigation between start/end points.
   */
  static async getNavigationAdvice(map: TownMap, from: string, to: string): Promise<string> {
    const systemPrompt = this.getSystemPrompt(map);
    try {
      return await this.generateWithVertexAI(
        systemPrompt,
        `Provide routes and navigation advice from "${from}" to "${to}".`
      );
    } catch (error) {
      return this.fallbackNavigationAdvice(map, from, to);
    }
  }

  // --- LOCAL FALLBACK FORMATTERS ---

  private static fallbackParkingAdvice(map: TownMap): string {
    const lines = ['### 🚗 Current Parking Status:\n', 'Here is where you can find parking right now:'];
    let bestZone = '';
    let maxSpots = -1;

    for (const [id, zone] of Object.entries(map.nodes.parking_zones)) {
      const free = zone.capacity - zone.current_occupancy;
      const landmark = map.nodes.landmarks[id] || 'nearby';
      lines.push(`- **${id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}** (${landmark}): ${free} spots left out of ${zone.capacity}`);
      if (free > maxSpots && zone.status === 'available') {
        maxSpots = free;
        bestZone = id;
      }
    }

    if (bestZone) {
      const bestName = bestZone.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const landmark = map.nodes.landmarks[bestZone] || 'nearby';
      lines.push(`\nJust a heads-up: if your usual spot is full, I highly recommend parking over at **${bestName}** (${landmark}). It has plenty of space left!`);
    }

    return lines.join('\n');
  }

  private static fallbackTrafficAdvice(map: TownMap): string {
    const busStand = map.nodes.bus_stand;
    const isJammed = busStand.current_bus_count >= busStand.jam_threshold_buses;

    const lines = [
      '### 🚦 Traffic Condition Report:\n',
      `- **Bus Stand**: Status is **${busStand.status.toUpperCase()}** (${busStand.current_bus_count} buses present).`,
      `- **Market Road**: Status is **${map.nodes.thoroughfares.market_road.status.toUpperCase()}**.`,
      `- **State Highway Link**: Status is **${map.nodes.thoroughfares.state_highway_link.status.toUpperCase()}**.`
    ];

    if (isJammed) {
      lines.push(`\n🚨 **Bottleneck Warning**: Market Road is heavily blocked due to bus counts exceeding the threshold. Please use the State Highway Link detour.`);
    } else {
      lines.push('\nTraffic is moving smoothly through the town center right now.');
    }

    return lines.join('\n');
  }

  private static fallbackNavigationAdvice(map: TownMap, from: string, to: string): string {
    const busStand = map.nodes.bus_stand;
    const isJammed = busStand.current_bus_count >= busStand.jam_threshold_buses;

    const lines = [
      `### 🗺️ Your Personalized Route from ${from} to ${to}:\n`,
      `*I know you're trying to get to ${to}, but with ${busStand.current_bus_count} buses at the Bus Stand, let's find you a stress-free route!*`
    ];

    if (isJammed) {
      lines.push(
        '1. **Bypass the Town Center**: Avoid Market Road completely.',
        `2. **Take the State Highway Link**: Head past the **Temple** and follow the link road.`,
        `3. **Park near Central Ground**: Park at an adjacent available zone to avoid driving directly into congestion.`
      );
    } else {
      lines.push(
        '1. **Take Market Road**: The lanes are currently clear.',
        '2. **Proceed to Destination**: Head straight through to your target landmark.'
      );
    }

    return lines.join('\n');
  }
}
