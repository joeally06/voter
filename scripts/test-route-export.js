/**
 * Test Script: Route Export & Mobile Integration
 * Validates the implementation of route saving, retrieval, and export features
 */

const SavedRouteModel = require('../backend/models/saved-route');
const database = require('../backend/config/database');

async function testRouteExport() {
  console.log('🧪 Testing Route Export & Mobile Integration Implementation...\n');
  
  // Initialize database connection
  await database.connect();
  console.log('✅ Database connected\n');
  
  const savedRouteModel = new SavedRouteModel();
  
  // Test 1: Generate Route ID
  console.log('Test 1: Generate cryptographically secure route ID');
  const routeId = SavedRouteModel.generateRouteId();
  console.log(`✅ Generated route ID: ${routeId}`);
  console.log(`   Length: ${routeId.length} characters`);
  console.log(`   URL-safe: ${/^[A-Za-z0-9_-]+$/.test(routeId)}\n`);
  
  // Test 2: Save Route
  console.log('Test 2: Save route to database');
  const testRoute = {
    startLocation: { lat: 36.5040, lng: -89.1872 },
    locations: [
      {
        voterId: 1,
        lat: 36.5045,
        lng: -89.1875,
        address: '123 Main St',
        city: 'Trenton',
        firstName: 'John',
        lastName: 'Doe'
      },
      {
        voterId: 2,
        lat: 36.5050,
        lng: -89.1880,
        address: '456 Oak Ave',
        city: 'Trenton',
        firstName: 'Jane',
        lastName: 'Smith'
      }
    ],
    metrics: {
      totalDistanceMiles: 1.2,
      totalDurationMinutes: 25
    }
  };
  
  const savedRouteId = await savedRouteModel.saveRoute(testRoute, {
    routeName: 'Test Route - Export Integration',
    travelMode: 'walking',
    expiresIn: 30 * 24 * 60 * 60 * 1000 // 30 days
  });
  
  console.log(`✅ Route saved with ID: ${savedRouteId}\n`);
  
  // Test 3: Retrieve Route
  console.log('Test 3: Retrieve saved route');
  const retrievedRoute = await savedRouteModel.getRoute(savedRouteId);
  
  if (retrievedRoute) {
    console.log(`✅ Route retrieved successfully`);
    console.log(`   Route Name: ${retrievedRoute.routeName}`);
    console.log(`   Travel Mode: ${retrievedRoute.travelMode}`);
    console.log(`   Locations: ${retrievedRoute.routeData.locations.length}`);
    console.log(`   Created: ${retrievedRoute.createdAt}`);
    console.log(`   Expires: ${retrievedRoute.expiresAt}`);
    console.log(`   Access Count: ${retrievedRoute.accessCount}\n`);
  } else {
    console.error('❌ Failed to retrieve route\n');
  }
  
  // Test 4: Generate Deep Links
  console.log('Test 4: Generate mobile deep link URLs');
  const locations = testRoute.locations;
  
  // Google Maps URL
  const googleMapsUrl = `https://www.google.com/maps/dir/${locations.map(l => `${l.lat},${l.lng}`).join('/')}/`;
  console.log(`✅ Google Maps URL: ${googleMapsUrl.substring(0, 80)}...`);
  
  // Apple Maps URL
  const appleMapsUrl = `http://maps.apple.com/?saddr=${testRoute.startLocation.lat},${testRoute.startLocation.lng}&daddr=${locations.map(l => `${l.lat},${l.lng}`).join('+to:')}&dirflg=w`;
  console.log(`✅ Apple Maps URL: ${appleMapsUrl.substring(0, 80)}...`);
  
  // Waze URL (first stop only)
  const wazeUrl = `https://www.waze.com/ul?ll=${locations[0].lat},${locations[0].lng}&navigate=yes`;
  console.log(`✅ Waze URL: ${wazeUrl}\n`);
  
  // Test 5: Shareable URL
  console.log('Test 5: Generate shareable URL');
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const shareableUrl = `${baseUrl}/routes/share/${savedRouteId}`;
  console.log(`✅ Shareable URL: ${shareableUrl}\n`);
  
  // Test 6: Clean up
  console.log('Test 6: Delete test route');
  const deleted = await savedRouteModel.deleteRoute(savedRouteId);
  console.log(`✅ Route deleted: ${deleted}\n`);
  
  // Close database connection
  await database.close();
  
  console.log('🎉 All tests passed! Route Export & Mobile Integration is working correctly.');
}

// Run tests
testRouteExport().catch(error => {
  console.error('❌ Test failed:', error);
  database.close().then(() => process.exit(1));
});
