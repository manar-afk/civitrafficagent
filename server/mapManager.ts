import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { TownMap, BusStandNode, ParkingZone, Thoroughfare } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Relative paths resolved from the build/server directory (which is compiled from server/)
const MAP_FILE_PATH = path.resolve(__dirname, '../../data/town_map.json');
const LOG_FILE_PATH = path.resolve(__dirname, '../../logs/priority_incidents.log');

export class MapManager {
  private mapData!: TownMap;

  constructor() {}

  /**
   * Initializes the manager by reading the map file and creating logs directory if missing.
   */
  async init(): Promise<void> {
    try {
      // Ensure data and logs directories exist
      await fs.mkdir(path.dirname(MAP_FILE_PATH), { recursive: true });
      await fs.mkdir(path.dirname(LOG_FILE_PATH), { recursive: true });

      const content = await fs.readFile(MAP_FILE_PATH, 'utf-8');
      this.mapData = JSON.parse(content) as TownMap;
    } catch (error) {
      console.error(`Error initializing MapManager: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Returns the entire town map.
   */
  getMap(): TownMap {
    return this.mapData;
  }

  /**
   * Saves the current memory map state to the JSON file.
   */
  private async save(): Promise<void> {
    try {
      await fs.writeFile(MAP_FILE_PATH, JSON.stringify(this.mapData, null, 2), 'utf-8');
    } catch (error) {
      console.error(`Error saving town map: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Gets the bus stand node.
   */
  getBusStand(): BusStandNode {
    return this.mapData.nodes.bus_stand;
  }

  /**
   * Updates the bus count at the bus stand.
   * If the count is >= 5, triggers the Distress Protocol:
   *   - Set bus stand status to "jammed"
   *   - Set Market Road status to "jammed"
   *   - Log priority incident for municipal visibility
   */
  async updateBusCount(count: number): Promise<{ previousCount: number; newCount: number; distressTriggered: boolean }> {
    const busStand = this.mapData.nodes.bus_stand;
    const prevCount = busStand.current_bus_count;
    busStand.current_bus_count = count;

    let distressTriggered = false;

    if (count >= busStand.jam_threshold_buses) {
      busStand.status = 'jammed';
      // Automatically set Market Road to jammed, since bus stand blocks it
      if (this.mapData.nodes.thoroughfares.market_road) {
        this.mapData.nodes.thoroughfares.market_road.status = 'jammed';
      }
      distressTriggered = true;
      await this.logPriorityIncident(count);
    } else {
      // If we go below threshold, clear status if it was jammed
      if (busStand.status === 'jammed') {
        busStand.status = 'clear';
      }
      // Also clear Market Road if there are no other reports
      if (this.mapData.nodes.thoroughfares.market_road && this.mapData.nodes.thoroughfares.market_road.status === 'jammed') {
        this.mapData.nodes.thoroughfares.market_road.status = 'clear';
      }
    }

    await this.save();
    return { previousCount: prevCount, newCount: count, distressTriggered };
  }

  /**
   * Gets all parking zones.
   */
  getParkingZones(): Record<string, ParkingZone> {
    return this.mapData.nodes.parking_zones;
  }

  /**
   * Updates occupancy of a specific parking zone.
   * Updates status to "full" if occupancy >= capacity, or "available" otherwise.
   */
  async updateParkingOccupancy(zoneId: string, occupancy: number): Promise<ParkingZone> {
    const zone = this.mapData.nodes.parking_zones[zoneId];
    if (!zone) {
      throw new Error(`Parking zone '${zoneId}' not found.`);
    }

    if (occupancy < 0 || occupancy > zone.capacity) {
      throw new Error(`Occupancy must be between 0 and capacity (${zone.capacity})`);
    }

    zone.current_occupancy = occupancy;
    zone.status = occupancy >= zone.capacity ? 'full' : 'available';

    await this.save();
    return zone;
  }

  /**
   * Gets all thoroughfares.
   */
  getThoroughfares(): Record<string, Thoroughfare> {
    return this.mapData.nodes.thoroughfares;
  }

  /**
   * Updates status of a specific thoroughfare.
   */
  async updateThoroughfareStatus(roadId: string, status: string): Promise<Thoroughfare> {
    const road = this.mapData.nodes.thoroughfares[roadId];
    if (!road) {
      throw new Error(`Thoroughfare '${roadId}' not found.`);
    }

    road.status = status;
    await this.save();
    return road;
  }

  /**
   * Logs a high-priority traffic bottleneck to the municipal log file.
   */
  private async logPriorityIncident(busCount: number): Promise<void> {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] PRIORITY ALERT: Critical bus bottleneck detected at Bus Stand. Bus count: ${busCount}. Emergency Protocol active. Authorities notified. Market Road set to JAMMED.\n`;
    try {
      await fs.appendFile(LOG_FILE_PATH, logMessage, 'utf-8');
    } catch (error) {
      console.error(`Failed to write to priority incident log: ${(error as Error).message}`);
    }
  }

  /**
   * Reads recent incident logs.
   */
  async getRecentIncidents(linesCount: number = 10): Promise<string[]> {
    try {
      const content = await fs.readFile(LOG_FILE_PATH, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim().length > 0);
      return lines.slice(-linesCount);
    } catch (error) {
      // If log file doesn't exist yet, return empty list
      return [];
    }
  }
}
