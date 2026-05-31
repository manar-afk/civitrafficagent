export interface TownMetadata {
  name: string;
  description: string;
}

export interface BusStandNode {
  type: string;
  jam_threshold_buses: number;
  current_bus_count: number;
  status: string;
}

export interface ParkingZone {
  capacity: number;
  current_occupancy: number;
  status: string;
}

export interface Thoroughfare {
  status: string;
  priority: string;
}

export interface Nodes {
  bus_stand: BusStandNode;
  parking_zones: Record<string, ParkingZone>;
  landmarks: Record<string, string>;
  thoroughfares: Record<string, Thoroughfare>;
}

export interface EmergencyProtocol {
  distress_trigger: string;
  reroute_advice: string;
}

export interface TownMap {
  town_metadata: TownMetadata;
  nodes: Nodes;
  emergency_protocol: EmergencyProtocol;
}
