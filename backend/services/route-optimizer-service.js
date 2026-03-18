/**
 * Route Optimizer Service
 * Solves Traveling Salesman Problem (TSP) variants for optimal canvassing routes
 * 
 * Algorithms:
 * - Nearest Neighbor: O(n²) greedy algorithm for initial route
 * - 2-Opt Improvement: O(n²) per iteration, iterative refinement
 * - Hybrid: Combine both for best results
 * 
 * Features:
 * - Handles voter lists (10-100 locations)
 * - Multiple travel modes (walking, driving, bicycling)
 * - Route quality metrics and efficiency scoring
 * - Integration with Distance Matrix service
 */

const DistanceMatrixService = require('./distance-matrix-service');
const { SparseDistanceMatrix } = require('./distance-matrix-service');
const log = require('../utils/logger');

class RouteOptimizerService {
  constructor() {
    this.distanceMatrixService = new DistanceMatrixService();
  }

  /**
   * Main route optimization entry point
   * 
   * @param {Array} locations - Array of location objects with {lat, lng, voterId, address}
   * @param {Object} startLocation - Starting location {lat, lng}
   * @param {string} mode - Travel mode (walking, driving, bicycling)
   * @param {string} algorithm - Algorithm to use (nearest_neighbor, 2opt, hybrid)
   * @returns {Promise<Object>} Optimized route with metrics
   */
  async optimizeRoute(locations, startLocation, mode = 'walking', algorithm = 'hybrid') {
    if (!locations || locations.length === 0) {
      throw new Error('No locations provided');
    }

    // Add start location to the beginning
    const allLocations = [
      { lat: startLocation.lat, lng: startLocation.lng, isStart: true },
      ...locations
    ];

    log.info(`Optimizing route for ${locations.length} voters using ${algorithm} algorithm`);
    const optimizationStart = Date.now();

    // Step 1: Build distance matrix (progressive or full based on env var)
    const distanceMatrix = await this.distanceMatrixService.buildDistanceMatrix(
      allLocations,
      mode
    );

    // Check if we're using progressive mode
    const isProgressive = distanceMatrix instanceof SparseDistanceMatrix;

    // Step 2: Generate initial route with nearest neighbor
    let route = await this.nearestNeighborRoute(distanceMatrix, 0);

    // Step 3: Improve with 2-opt if requested
    if (algorithm === 'hybrid' || algorithm === '2opt') {
      route = await this.twoOptImprovement(route, distanceMatrix);
    }

    // Step 4: Calculate route metrics
    const metrics = await this.calculateRouteMetrics(route, distanceMatrix, mode);

    // Add optimization metrics
    const optimizationTime = Date.now() - optimizationStart;
    metrics.optimizationTimeMs = optimizationTime;

    // Add progressive routing stats if available
    if (isProgressive && distanceMatrix.getStats) {
      const stats = distanceMatrix.getStats();
      metrics.distanceMatrixStats = stats;
      
      // Calculate API call reduction
      const maxPossible = allLocations.length * allLocations.length;
      const reduction = ((1 - (stats.apiCalls / maxPossible)) * 100).toFixed(1);
      
      log.info(`Progressive routing: ${stats.apiCalls} API calls (${reduction}% reduction from ${maxPossible})`);
      log.info(`Cache hits: ${stats.cacheHits}, Lazy loads: ${stats.lazyLoads}, Prefetch batches: ${stats.prefetchBatches}`);
      
      metrics.apiCallReduction = `${reduction}%`;
    }

    // Step 5: Build ordered location list
    const orderedLocations = route.map(idx => {
      const loc = allLocations[idx];
      // Skip start location in the ordered list (it's implicit)
      return idx === 0 ? null : locations[idx - 1];
    }).filter(loc => loc !== null);

    log.info(`Route optimization complete in ${optimizationTime}ms`);

    return {
      locations: orderedLocations,
      totalDistance: metrics.totalDistance,
      totalDuration: metrics.totalDuration,
      metrics,
      algorithm: algorithm
    };
  }

  /**
   * Nearest Neighbor algorithm with progressive fetching support
   * 
   * Greedy algorithm: always visit the closest unvisited location
   * Now supports both traditional array and SparseDistanceMatrix
   * 
   * @param {Array|SparseDistanceMatrix} distanceMatrix - Distance matrix
   * @param {number} startIdx - Starting location index (default: 0)
   * @returns {Promise<Array>} Route as array of location indices
   */
  async nearestNeighborRoute(distanceMatrix, startIdx = 0) {
    const n = distanceMatrix.length;
    const route = [startIdx];
    const unvisited = new Set([...Array(n).keys()].filter(i => i !== startIdx));

    // Check if using progressive mode
    const isProgressive = distanceMatrix instanceof SparseDistanceMatrix;

    while (unvisited.size > 0) {
      const current = route[route.length - 1];
      
      // Progressive optimization: prefetch all distances from current to unvisited
      if (isProgressive) {
        const unvisitedArray = Array.from(unvisited);
        await distanceMatrix.prefetchRow(current, unvisitedArray);
      }
      
      // Find nearest unvisited location
      let nearest = null;
      let minDistance = Infinity;

      for (const candidate of unvisited) {
        // Support both array access and async get()
        const element = isProgressive
          ? await distanceMatrix.get(current, candidate)
          : distanceMatrix[current][candidate];
        
        const dist = element?.distance || Infinity;

        if (dist < minDistance) {
          minDistance = dist;
          nearest = candidate;
        }
      }

      if (nearest !== null) {
        route.push(nearest);
        unvisited.delete(nearest);
      } else {
        // No valid path found, add any remaining location
        const remaining = Array.from(unvisited)[0];
        route.push(remaining);
        unvisited.delete(remaining);
      }
    }

    return route;
  }

  /**
   * 2-Opt Improvement algorithm with progressive fetching support
   * 
   * Iteratively swap edge pairs to reduce total distance
   * Now supports both traditional array and SparseDistanceMatrix
   * 
   * @param {Array} route - Initial route
   * @param {Array|SparseDistanceMatrix} distanceMatrix - Distance matrix
   * @param {number} maxIterations - Maximum number of improvement iterations
   * @returns {Promise<Array>} Improved route
   */
  async twoOptImprovement(route, distanceMatrix, maxIterations = 100) {
    let improved = true;
    let iteration = 0;
    let currentRoute = [...route];

    // Check if using progressive mode
    const isProgressive = distanceMatrix instanceof SparseDistanceMatrix;

    while (improved && iteration < maxIterations) {
      improved = false;
      iteration++;

      for (let i = 1; i < currentRoute.length - 2; i++) {
        for (let j = i + 1; j < currentRoute.length - 1; j++) {
          // Calculate delta for swapping edges (i, i+1) and (j, j+1)
          const delta = await this.calculateSwapDelta(currentRoute, distanceMatrix, i, j, isProgressive);

          if (delta < -1) { // Improvement threshold (negative = better)
            // Perform 2-opt swap: reverse segment [i+1, j]
            this.reverseSegment(currentRoute, i + 1, j);
            improved = true;
          }
        }
      }
    }

    return currentRoute;
  }

  /**
   * Calculate delta for swapping edges in 2-opt
   * 
   * @param {Array} route - Current route
   * @param {Array|SparseDistanceMatrix} distanceMatrix - Distance matrix
   * @param {number} i - First edge start index
   * @param {number} j - Second edge start index
   * @param {boolean} isProgressive - Whether using progressive mode
   * @returns {Promise<number>} Delta (negative = improvement)
   */
  async calculateSwapDelta(route, distanceMatrix, i, j, isProgressive = false) {
    const a = route[i];
    const b = route[i + 1];
    const c = route[j];
    const d = route[j + 1];

    if (isProgressive) {
      // Fetch all 4 distances in parallel for efficiency
      const [distAB, distCD, distAC, distBD] = await Promise.all([
        distanceMatrix.get(a, b),
        distanceMatrix.get(c, d),
        distanceMatrix.get(a, c),
        distanceMatrix.get(b, d)
      ]);

      // Current edges: a->b and c->d
      const currentDist = (distAB?.distance || 0) + (distCD?.distance || 0);

      // New edges after swap: a->c and b->d
      const newDist = (distAC?.distance || 0) + (distBD?.distance || 0);

      return newDist - currentDist;
    } else {
      // Traditional array access
      // Current edges: a->b and c->d
      const currentDist =
        (distanceMatrix[a][b]?.distance || 0) +
        (distanceMatrix[c][d]?.distance || 0);

      // New edges after swap: a->c and b->d
      const newDist =
        (distanceMatrix[a][c]?.distance || 0) +
        (distanceMatrix[b][d]?.distance || 0);

      return newDist - currentDist;
    }
  }

  /**
   * Reverse a segment of the route
   * 
   * @param {Array} route - Route to modify (in-place)
   * @param {number} start - Start index of segment
   * @param {number} end - End index of segment
   */
  reverseSegment(route, start, end) {
    while (start < end) {
      const temp = route[start];
      route[start] = route[end];
      route[end] = temp;
      start++;
      end--;
    }
  }

  /**
   * Calculate total route distance
   * 
   * @param {Array} route - Route as array of indices
   * @param {Array|SparseDistanceMatrix} distanceMatrix - Distance matrix
   * @returns {Promise<number>} Total distance in meters
   */
  async calculateRouteDistance(route, distanceMatrix) {
    let totalDistance = 0;
    const isProgressive = distanceMatrix instanceof SparseDistanceMatrix;

    for (let i = 0; i < route.length - 1; i++) {
      const from = route[i];
      const to = route[i + 1];
      
      const element = isProgressive
        ? await distanceMatrix.get(from, to)
        : distanceMatrix[from][to];
      
      totalDistance += element?.distance || 0;
    }

    return totalDistance;
  }

  /**
   * Calculate total route duration
   * 
   * @param {Array} route - Route as array of indices
   * @param {Array|SparseDistanceMatrix} distanceMatrix - Distance matrix
   * @returns {Promise<number>} Total duration in seconds
   */
  async calculateRouteDuration(route, distanceMatrix) {
    let totalDuration = 0;
    const isProgressive = distanceMatrix instanceof SparseDistanceMatrix;

    for (let i = 0; i < route.length - 1; i++) {
      const from = route[i];
      const to = route[i + 1];
      
      const element = isProgressive
        ? await distanceMatrix.get(from, to)
        : distanceMatrix[from][to];
      
      totalDuration += element?.duration || 0;
    }

    return totalDuration;
  }

  /**
   * Calculate route quality metrics
   * 
   * @param {Array} route - Route as array of indices
   * @param {Array|SparseDistanceMatrix} distanceMatrix - Distance matrix
   * @param {string} mode - Travel mode
   * @returns {Promise<Object>} Route metrics
   */
  async calculateRouteMetrics(route, distanceMatrix, mode) {
    const totalDistance = await this.calculateRouteDistance(route, distanceMatrix);
    const totalDuration = await this.calculateRouteDuration(route, distanceMatrix);
    const stopCount = route.length - 1; // Exclude start location

    // Average distance per stop
    const averageDistancePerStop = stopCount > 0
      ? totalDistance / stopCount
      : 0;

    // Estimate doors knocked (assuming 2 minutes per door + travel time)
    const doorTimeSeconds = 120; // 2 minutes per door
    const estimatedDoorsKnocked = Math.floor(
      (totalDuration - (stopCount * doorTimeSeconds)) / doorTimeSeconds
    );

    // Recommended mode based on distance
    let recommendedMode = mode;
    const avgDistanceMeters = averageDistancePerStop;
    if (avgDistanceMeters < 200) {
      recommendedMode = 'walking';
    } else if (avgDistanceMeters < 1000) {
      recommendedMode = 'bicycling';
    } else {
      recommendedMode = 'driving';
    }

    // Route efficiency (vs naive sequential order)
    // Calculate naive route distance for comparison
    const naiveRoute = [...Array(route.length).keys()];
    const naiveDistance = await this.calculateRouteDistance(naiveRoute, distanceMatrix);
    const routeEfficiency = naiveDistance > 0
      ? totalDistance / naiveDistance
      : 1.0;

    return {
      totalDistance,
      totalDuration,
      stopCount,
      averageDistancePerStop: Math.round(averageDistancePerStop),
      estimatedDoorsKnocked: Math.max(0, estimatedDoorsKnocked),
      recommendedMode,
      routeEfficiency: parseFloat(routeEfficiency.toFixed(2)),
      // Human-readable formats
      totalDistanceMiles: parseFloat((totalDistance / 1609.34).toFixed(2)),
      totalDurationMinutes: Math.round(totalDuration / 60),
      averageDistancePerStopFeet: Math.round(averageDistancePerStop * 3.28084)
    };
  }
}

module.exports = RouteOptimizerService;
