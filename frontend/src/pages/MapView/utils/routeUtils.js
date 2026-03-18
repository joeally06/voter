/**
 * routeUtils.js - Route formatting and calculation utilities
 * 
 * Provides helper functions for:
 * - Route data formatting (distance, duration, efficiency)
 * - Stop list generation
 * - Route metrics calculation
 */

/**
 * Format distance in miles
 * @param {number} miles - Distance in miles
 * @returns {string} Formatted distance string
 */
export function formatDistance(miles) {
  if (typeof miles !== 'number' || isNaN(miles)) return '--';
  return `${miles.toFixed(1)} mi`;
}

/**
 * Format duration in minutes
 * @param {number} minutes - Duration in minutes
 * @returns {string} Formatted duration string
 */
export function formatDuration(minutes) {
  if (typeof minutes !== 'number' || isNaN(minutes)) return '--';
  
  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }
  
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}h ${mins}m`;
}

/**
 * Format efficiency as percentage
 * @param {number} ratio - Efficiency ratio (0-1)
 * @returns {string} Formatted percentage
 */
export function formatEfficiency(ratio) {
  if (typeof ratio !== 'number' || isNaN(ratio)) return '--';
  return `${Math.round(ratio * 100)}%`;
}

/**
 * Create HTML for stop list
 * @param {Array} locations - Array of route stop locations
 * @returns {string} HTML string for stop list
 */
export function createStopList(locations) {
  if (!Array.isArray(locations) || locations.length === 0) {
    return '<p class="text-xs text-gray-400 text-center py-2">No stops</p>';
  }
  
  return locations.map((loc, i) => {
    const firstName = escapeHtml(loc.firstName || '');
    const lastName = escapeHtml(loc.lastName || '');
    const address = escapeHtml(loc.address || '');
    
    return `
      <div class="flex items-center gap-3 py-2 px-1">
        <span class="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">${i + 1}</span>
        <div class="min-w-0">
          <p class="font-medium text-gray-900 dark:text-white truncate">${firstName} ${lastName}</p>
          <p class="text-xs text-gray-500 truncate">${address}</p>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Calculate route metrics from route data
 * @param {Object} route - Route object with locations and metrics
 * @returns {Object} Calculated metrics
 */
export function calculateRouteMetrics(route) {
  if (!route || !route.metrics) {
    return {
      totalDistanceMiles: 0,
      totalDurationMinutes: 0,
      stopCount: 0,
      routeEfficiency: 0
    };
  }
  
  const m = route.metrics;
  return {
    totalDistanceMiles: m.totalDistanceMiles || 0,
    totalDurationMinutes: m.totalDurationMinutes || 0,
    stopCount: m.stopCount || (route.locations ? route.locations.length : 0),
    routeEfficiency: m.routeEfficiency || 0
  };
}

/**
 * Build Google Maps Directions URL(s) for a calculated route.
 *
 * Splits the route into segments of up to 10 stops (origin + 9 intermediate
 * waypoints + destination) to stay within Google Maps waypoint limits.
 *
 * @param {Array}  locations     - Ordered array of {lat, lng} stop objects
 * @param {Object} startLocation - {lat, lng} user's starting point
 * @param {string} travelMode    - 'walking' | 'driving' | 'bicycling'
 * @returns {Array<{label: string, url: string, stopRange: string}>}
 */
export function buildGoogleMapsUrls(locations, startLocation, travelMode) {
  const MAX_WAYPOINTS = 9; // 9 intermediate = 11 total (origin + 9wp + dest)
  const MAX_STOPS_PER_SEGMENT = MAX_WAYPOINTS + 1; // 10 stops per segment

  const MODE_MAP = {
    walking: 'walking',
    driving: 'driving',
    bicycling: 'bicycling'
  };
  const mode = MODE_MAP[travelMode] || 'driving';

  if (!locations || locations.length === 0 || !startLocation) return [];

  // Split locations into segments of MAX_STOPS_PER_SEGMENT
  const segments = [];
  for (let i = 0; i < locations.length; i += MAX_STOPS_PER_SEGMENT) {
    segments.push(locations.slice(i, i + MAX_STOPS_PER_SEGMENT));
  }

  return segments.map((segment, segIdx) => {
    // Origin: first segment uses user's start; subsequent segments use last stop of previous
    const prevSegment = segments[segIdx - 1];
    const origin = segIdx === 0
      ? `${startLocation.lat},${startLocation.lng}`
      : `${prevSegment[prevSegment.length - 1].lat},${prevSegment[prevSegment.length - 1].lng}`;

    // Destination: last stop in this segment
    const destination = `${segment[segment.length - 1].lat},${segment[segment.length - 1].lng}`;

    // Intermediate waypoints: all stops except the last
    const waypoints = segment.slice(0, -1)
      .map(loc => `${loc.lat},${loc.lng}`)
      .join('|');

    const base = 'https://www.google.com/maps/dir/?api=1';
    const params = new URLSearchParams({
      origin,
      destination,
      travelmode: mode,
      dir_action: 'navigate'
    });
    if (waypoints) {
      params.set('waypoints', waypoints);
    }

    const url = `${base}&${params.toString()}`;

    const startStop = segIdx * MAX_STOPS_PER_SEGMENT + 1;
    const endStop = startStop + segment.length - 1;
    const label = segments.length > 1
      ? `Stops ${startStop}–${endStop}`
      : 'Open in Google Maps';
    const stopRange = `${startStop}–${endStop}`;

    return { label, url, stopRange };
  });
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
