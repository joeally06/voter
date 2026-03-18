/**
 * mapUtils.js - Google Maps utility functions
 * 
 * Provides helper functions for:
 * - Loading Google Maps script
 * - Creating and styling markers
 * - Icon generation for different voter types
 * - Map bounds calculations
 * - Dark mode styles
 */

/**
 * Load Google Maps JavaScript API
 * @param {string} apiKey - Google Maps API key
 * @returns {Promise<void>}
 */
export function loadGoogleMapsScript(apiKey) {
  return new Promise((resolve, reject) => {
    if (typeof google !== 'undefined' && google.maps) {
      resolve();
      return;
    }
    
    // Check if script is already being loaded
    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript) {
      existingScript.addEventListener('load', resolve);
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Google Maps')));
      return;
    }
    
    const script = document.createElement('script');
    // Add loading=async parameter for optimal performance
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=marker,geometry&loading=async`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });
}

/**
 * Create a PinElement for voter markers
 * @param {boolean} isSuperVoter - Whether voter is a super voter
 * @param {boolean} isSelected - Whether voter is selected for route
 * @returns {google.maps.marker.PinElement}
 */
function createVoterPin(isSuperVoter, isSelected) {
  if (isSelected) {
    return new google.maps.marker.PinElement({
      background: '#f59e0b',
      borderColor: '#d97706',
      scale: 1.0,
      glyphColor: 'transparent',
      glyph: '',
    });
  }
  
  return new google.maps.marker.PinElement({
    background: isSuperVoter ? '#16a34a' : '#6366f1',
    borderColor: '#fff',
    scale: 0.7,
    glyphColor: 'transparent',
    glyph: '',
  });
}

/**
 * Create a marker for a voter
 * @param {Object} voter - Voter data
 * @param {Object} state - MapState instance
 * @param {Function} onClick - Click handler
 * @returns {google.maps.marker.AdvancedMarkerElement}
 */
export function createVoterMarker(voter, state, onClick) {
  const isSelected = state.routing.selectedVoterIds.has(voter.id);
  const pin = createVoterPin(voter.superVoter, isSelected);
  
  const marker = new google.maps.marker.AdvancedMarkerElement({
    position: { lat: parseFloat(voter.latitude), lng: parseFloat(voter.longitude) },
    content: pin,  // Use PinElement directly (not pin.element - deprecated)
    title: `${voter.firstName} ${voter.lastName}`,
    zIndex: isSelected ? 1000 : 1,
  });
  
  marker._voterId = voter.id;
  marker._voterData = voter;
  marker._pinElement = pin;
  marker._isSelected = isSelected;
  marker.addListener('gmp-click', () => onClick(voter));  // Use gmp-click for AdvancedMarkerElement
  
  return marker;
}

// Export helper for use in other modules
export { createVoterPin };

/**
 * Create a PinElement for route stop markers
 * @param {number} index - Stop number (0-based)
 * @returns {google.maps.marker.PinElement}
 */
function createRouteStopPin(index) {
  return new google.maps.marker.PinElement({
    background: '#3b82f6',
    borderColor: '#1d4ed8',
    scale: 1.0,
    glyphColor: 'white',
    glyphText: String(index + 1),
  });
}

/**
 * Create a route stop marker
 * @param {Object} location - Stop location data
 * @param {number} index - Stop number (0-based)
 * @param {google.maps.Map} map - Map instance
 * @returns {google.maps.marker.AdvancedMarkerElement}
 */
export function createRouteMarker(location, index, map) {
  const pos = { lat: parseFloat(location.lat), lng: parseFloat(location.lng) };
  const pin = createRouteStopPin(index);
  
  const marker = new google.maps.marker.AdvancedMarkerElement({
    position: pos,
    map,
    content: pin,  // Use PinElement directly (not pin.element - deprecated)
    zIndex: 1000 + index,
    title: `Stop ${index + 1}: ${location.firstName || ''} ${location.lastName || ''}`,
  });
  
  return marker;
}

/**
 * Create a PinElement for start location marker
 * @returns {google.maps.marker.PinElement}
 */
function createStartLocationPin() {
  return new google.maps.marker.PinElement({
    background: '#22c55e',
    borderColor: '#fff',
    scale: 1.0,
    glyphColor: 'white',
    glyph: '▶',
  });
}

/**
 * Create a start location marker
 * @param {Object} location - Start location {lat, lng}
 * @param {google.maps.Map} map - Map instance
 * @returns {google.maps.marker.AdvancedMarkerElement}
 */
export function createStartMarker(location, map) {
  const pin = createStartLocationPin();
  
  return new google.maps.marker.AdvancedMarkerElement({
    position: location,
    map,
    content: pin,  // Use PinElement directly (not pin.element - deprecated)
    title: 'Start Location',
    zIndex: 2000,
  });
}

/**
 * Create a PinElement for cluster markers
 * @param {number} count - Number of markers in cluster
 * @returns {google.maps.marker.PinElement}
 */
export function createClusterPin(count) {
  // Color based on voter count in cluster
  const color = count > 100 ? '#ef4444' :   // red (100+)
                count > 50 ? '#f59e0b' :    // amber (50-100)
                count > 10 ? '#3b82f6' :    // blue (10-50)
                '#10b981';                  // green (1-10)
  
  // Scale based on count (adjusted for PinElement sizing)
  const scale = Math.min(count / 20 + 0.5, 2.0);
  
  return new google.maps.marker.PinElement({
    background: color,
    borderColor: '#ffffff',
    scale: scale,
    glyphColor: 'white',
    glyphText: String(count),
  });
}

// Legacy exports removed - use PinElement-based functions instead
// voterMarkerIcon() - replaced by createVoterPin()
// selectedMarkerIcon() - integrated into createVoterPin()
// clusterIcon() - replaced by createClusterPin()

/**
 * Clear all markers from map
 * @param {google.maps.marker.AdvancedMarkerElement[]} markers - Array of markers to clear
 */
export function clearMarkers(markers) {
  if (!Array.isArray(markers)) return;
  markers.forEach(m => m.map = null);
}

/**
 * Fit map bounds to show all markers
 * @param {google.maps.Map} map - Map instance
 * @param {google.maps.marker.AdvancedMarkerElement[]} markers - Array of markers
 */
export function fitBoundsToMarkers(map, markers) {
  if (!map || !markers || markers.length === 0) return;
  
  const bounds = new google.maps.LatLngBounds();
  markers.forEach(m => {
    const pos = m.position;
    if (pos) bounds.extend(pos);
  });
  
  map.fitBounds(bounds);
}

/**
 * Dark mode map styling
 * NOTE: These styles are kept for reference but should be configured
 * in Google Cloud Console when using a mapId. Inline styles are ignored
 * when mapId is present.
 * 
 * To configure:
 * 1. Go to Google Cloud Console > Maps > Map Styles
 * 2. Select your mapId (DEMO_MAP_ID)
 * 3. Apply dark theme or create custom style
 * 
 * @deprecated Use Cloud Console styling when mapId is present
 */
export const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#212121' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#212121' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#373737' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#000000' }] },
];
