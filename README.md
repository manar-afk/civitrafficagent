# Civic Path: Traffic & Parking Concierge

Civic Path is an AI-driven traffic and parking management solution designed to solve daily frustrations for the local community. It shifts town transport guidance from "guessing where to park/drive" to "being actively, empathetically guided." 

This repository implements the complete system as a **Model Context Protocol (MCP) Server** built with Node.js, TypeScript, and the official `@modelcontextprotocol/sdk`.

---

## Key Features

1. **Empathetic Civic Concierge Persona**: Exposes prompts and navigation generators that talk like a helpful neighbor, using familiar local landmarks (**Central Ground**, **Temple**, **W. Office**) and showing true understanding of traffic frustrations.
2. **Real-time State Tracking**: Keeps track of bus counts, road states, and parking occupancy within a lightweight JSON database (`town_map.json`).
3. **The Distress Protocol**: Automatically detects critical traffic bottlenecks (**5 or more buses** at the Bus Stand), logs high-priority incidents in `logs/priority_incidents.log` for municipal visibility, locks thoroughfares to a jammed state, and updates routing suggestions to direct drivers onto alternate bypass roads.

---

## Directory Structure

```
civitrafficagent/
├── package.json                 # Project manifest & MCP dependencies
├── tsconfig.json                # TypeScript compiler configuration
├── data/
│   └── town_map.json            # Active database for the town infrastructure
├── logs/
│   └── priority_incidents.log   # Active log file for Distress Protocol incidents
├── src/
│   ├── types.ts                 # TypeScript type definitions for the map
│   ├── mapManager.ts            # State controller: updates, persistence, and Distress Protocol triggers
│   ├── concierge.ts             # Dialogue planner: system prompts & route advice formatters
│   ├── mcpServer.ts             # MCP framework connection (Tools, Resources, Prompts)
│   └── index.ts                 # Entry point (stdio server transport initializer)
└── README.md                    # Setup and reference documentation
```

---

## Setup & Running

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [npm](https://www.npmjs.com/)

### 1. Installation
Install the required dependencies:
```bash
npm install
```

### 2. Build the Server
Compile the TypeScript code to Javascript:
```bash
npm run build
```

### 3. Run the Server (Local testing or debug)
```bash
npm start
```
*Note: Since MCP servers communicate via standard input/output (stdio), running this command directly in your shell will wait for JSON-RPC connection payloads from an MCP client.*

---

## MCP Server Interface

### Resources
- **`town://map`**: Exposes the live `town_map.json` raw database state so that an LLM client can inspect nodes, thresholds, capacity, and current traffic states.
- **`town://incidents`**: Exposes the last 10 log records written by the Distress Protocol.

### Tools
- **`get_parking_availability`**: Returns a list of parking zones with capacities, occupancy, and friendly landmark-based redirection suggestions.
- **`get_traffic_status`**: Returns road congestion states and bus bottleneck counts, indicating bypasses if critical.
- **`request_route_advice`**:
  - Arguments:
    - `from` (string): Starting landmark or road (e.g. `"Bus Stand"`).
    - `to` (string): Destination landmark or road (e.g. `"Court Building"`).
  - Returns: A step-by-step route suggestion using local landmarks.
- **`update_bus_count`**:
  - Arguments:
    - `busCount` (integer): The new bus count at the bus stand.
  - Returns: Confirmation of state change. *Triggers the Distress Protocol if count >= 5.*
- **`update_parking_occupancy`**:
  - Arguments:
    - `zoneId` (enum): `'mini_secretariat' | 'court_building_1' | 'court_building_2' | 'hospital_side' | 'state_highway_side'`
    - `occupancy` (integer): Current occupied stalls.
  - Returns: Confirmation of the parking status change.
- **`update_thoroughfare_status`**:
  - Arguments:
    - `roadId` (enum): `'market_road' | 'state_highway_link'`
    - `status` (string): Road condition (e.g. `"clear"`, `"jammed"`).

### Prompts
- **`chat_with_concierge`**: Automatically injects system guidelines and the live town state into the LLM system prompt, instructing it to adopt the empathetic Civic Concierge persona.

---

## Connecting to an MCP Client (e.g. Claude Desktop)

To use this concierge server in your desktop client, add the following configuration to your client's config file (e.g., `C:\Users\<username>\AppData\Roaming\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "civic-traffic-concierge": {
      "command": "node",
      "args": [
        "c:/Users/tarun/Desktop/civitrafficagent/build/index.js"
      ]
    }
  }
}
```

Replace the path above with your absolute path to the compiled `build/index.js` file.
