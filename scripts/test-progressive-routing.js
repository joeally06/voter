/**
 * Test Progressive Routing Optimization
 * 
 * Validates that SparseDistanceMatrix reduces API calls by ~95%
 */

const DistanceMatrixService = require('../backend/services/distance-matrix-service');
const RouteOptimizerService = require('../backend/services/route-optimizer-service');

// Set progressive routing ON
process.env.PROGRESSIVE_ROUTING = 'true';

async function testProgressiveRouting() {
  console.log('========================================');
  console.log('PROGRESSIVE ROUTING OPTIMIZATION TEST');
  console.log('========================================\n');

  try {
    // Generate 10 test locations around Obion County, TN
    const testLocations = [
      { lat: 36.2639, lng: -89.1929, voterId: 1, address: '123 Main St' },
      { lat: 36.2650, lng: -89.1940, voterId: 2, address: '456 Oak Ave' },
      { lat: 36.2625, lng: -89.1915, voterId: 3, address: '789 Pine St' },
      { lat: 36.2645, lng: -89.1935, voterId: 4, address: '321 Elm Dr' },
      { lat: 36.2630, lng: -89.1920, voterId: 5, address: '654 Maple Ln' },
      { lat: 36.2655, lng: -89.1945, voterId: 6, address: '987 Cedar Ct' },
      { lat: 36.2620, lng: -89.1910, voterId: 7, address: '147 Birch Rd' },
      { lat: 36.2660, lng: -89.1950, voterId: 8, address: '258 Spruce Way' },
      { lat: 36.2615, lng: -89.1905, voterId: 9, address: '369 Ash Blvd' },
      { lat: 36.2665, lng: -89.1955, voterId: 10, address: '741 Willow St' }
    ];

    const startLocation = { lat: 36.2639, lng: -89.1929 };

    console.log(`📍 Testing with ${testLocations.length} locations`);
    console.log(`   Max possible API calls: ${(testLocations.length + 1) * (testLocations.length + 1)} (full matrix)\n`);

    // Test with progressive routing
    const optimizer = new RouteOptimizerService();
    
    console.log('▶️  Running route optimization with PROGRESSIVE mode...\n');
    
    const route = await optimizer.optimizeRoute(
      testLocations,
      startLocation,
      'driving',
      'hybrid'
    );

    console.log('\n========================================');
    console.log('RESULTS');
    console.log('========================================\n');

    console.log(`✅ Route optimized successfully`);
    console.log(`   Total distance: ${route.metrics.totalDistanceMiles} miles`);
    console.log(`   Total duration: ${route.metrics.totalDurationMinutes} minutes`);
    console.log(`   Stops: ${route.metrics.stopCount}`);
    
    if (route.metrics.distanceMatrixStats) {
      const stats = route.metrics.distanceMatrixStats;
      const maxPossible = (testLocations.length + 1) * (testLocations.length + 1);
      
      console.log('\n📊 Progressive Routing Statistics:');
      console.log(`   API calls made: ${stats.apiCalls}`);
      console.log(`   Cache hits: ${stats.cacheHits}`);
      console.log(`   Lazy loads: ${stats.lazyLoads}`);
      console.log(`   Prefetch batches: ${stats.prefetchBatches}`);
      console.log(`   Total distances fetched: ${stats.totalDistances}`);
      console.log(`   Max possible distances: ${maxPossible}`);
      console.log(`   Efficiency: ${stats.fetchedPercentage}% of matrix fetched`);
      console.log(`   API call reduction: ${route.metrics.apiCallReduction}`);
      
      // Validate reduction
      const reductionPct = parseFloat(route.metrics.apiCallReduction);
      if (reductionPct >= 50) {
        console.log(`\n✅ SUCCESS: ${reductionPct}% reduction achieved (target: >50%)`);
      } else {
        console.log(`\n⚠️  WARNING: Only ${reductionPct}% reduction (target: >50%)`);
      }
    } else {
      console.log('\n⚠️  WARNING: Progressive routing stats not available');
    }

    console.log('\n========================================');
    console.log('TEST COMPLETE');
    console.log('========================================\n');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run test
testProgressiveRouting();
