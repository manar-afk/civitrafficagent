import { MapManager } from '../build/server/mapManager.js';
import { ConciergeEngine } from '../build/server/concierge.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runVerification() {
  console.log('=== STARTING CIVIC PATH VERIFICATION ===\n');

  // 1. Initialize MapManager
  console.log('1. Initializing MapManager...');
  const manager = new MapManager();
  await manager.init();
  console.log('   Town name:', manager.getMap().town_metadata.name);
  console.log('   Initial bus count:', manager.getBusStand().current_bus_count);
  console.log('   Initial bus stand status:', manager.getBusStand().status);
  console.log('   Initial Market Road status:', manager.getMap().nodes.thoroughfares.market_road.status);

  // Reset to clean state for testing
  await manager.updateBusCount(0);
  await manager.updateParkingOccupancy('mini_secretariat', 0);
  await manager.updateParkingOccupancy('court_building_1', 0);

  // 2. Test Parking Occupancy and Concierge Recommendations
  console.log('\n2. Testing Parking occupancy logic...');
  // Fill up Court Building 1
  console.log('   Filling Court Building 1...');
  await manager.updateParkingOccupancy('court_building_1', 20);
  
  // Get parking advice
  const parkingAdvice = await ConciergeEngine.getParkingAdvice(manager.getMap());
  console.log('\n--- Generated Parking Advice ---');
  console.log(parkingAdvice);
  console.log('--------------------------------');

  // 3. Test Bus Count distress protocol trigger
  console.log('\n3. Testing Distress Protocol (Updating bus count to 3)...');
  let result = await manager.updateBusCount(3);
  console.log(`   Distress triggered? ${result.distressTriggered}`);
  console.log(`   Bus stand status: ${manager.getBusStand().status}`);
  console.log(`   Market Road status: ${manager.getMap().nodes.thoroughfares.market_road.status}`);

  console.log('\n   Updating bus count to 6 (Threshold is 5)...');
  result = await manager.updateBusCount(6);
  console.log(`   Distress triggered? ${result.distressTriggered}`);
  console.log(`   Bus stand status: ${manager.getBusStand().status}`);
  console.log(`   Market Road status: ${manager.getMap().nodes.thoroughfares.market_road.status}`);

  // 4. Check priority incident logs
  console.log('\n4. Reading recent priority incident logs...');
  const logs = await manager.getRecentIncidents(5);
  console.log('--- Last Log Lines ---');
  logs.forEach(line => console.log(' >', line));
  console.log('----------------------');

  // 5. Test Navigation advice under distressed conditions
  console.log('\n5. Generating navigation advice during Distress Protocol...');
  const navAdvice = await ConciergeEngine.getNavigationAdvice(
    manager.getMap(),
    'Bus Stand',
    'Court Building'
  );
  console.log('--- Navigation Advice ---');
  console.log(navAdvice);
  console.log('-------------------------');

  // 6. Test system prompt template output
  console.log('\n6. Checking formatted System Prompt for LLM client...');
  const sysPrompt = ConciergeEngine.getSystemPrompt(manager.getMap());
  console.log('--- System Prompt Snippet (First 15 lines) ---');
  console.log(sysPrompt.split('\n').slice(0, 15).join('\n'));
  console.log('...');
  console.log('---------------------------------------------');

  // 7. Cleanup and Reset state
  console.log('\n7. Cleaning up test state...');
  await manager.updateBusCount(0);
  await manager.updateParkingOccupancy('court_building_1', 0);
  console.log('   All states reset successfully.');
  
  console.log('\n=== VERIFICATION COMPLETED SUCCESSFULLY ===');
}

runVerification().catch(err => {
  console.error('Verification failed with error:', err);
  process.exit(1);
});
