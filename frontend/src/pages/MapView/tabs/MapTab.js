/**
 * MapTab.js - Map visualization component
 * 
 * Handles:
 * - Map canvas rendering
 * - Voter marker display with clustering
 * - Marker interactions (click, info windows)
 * - Filter controls (precinct, voter type)
 * - Route overlay display
 */

import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { GridAlgorithm } from '@googlemaps/markerclusterer';
import {
  createVoterMarker,
  createRouteMarker,
  createVoterPin,
  createClusterPin,
  fitBoundsToMarkers,
  darkMapStyle
} from '../utils/mapUtils.js';
import { fetchVoters, fetchPrecincts, trackMapLoad } from '../../../api/client.js';
import { sectionHeading, spinner, fmt, escapeHtml } from '../../../components/ui.js';
import { showToast } from '../../../main.js';

// Constants
const VOTER_LOAD_LIMIT = 500;

export default class MapTab {
  constructor(container, state) {
    this.container = container;
    this.state = state;
    this.panelId = 'tab-map';
    this.isInitialized = false;
    this.clusterer = null;
    this.clusterPinCache = new Map();  // Cache cluster pins for performance
    this.updateMarkersDebounced = this.debounce(this._updateMarkerStylesImmediate.bind(this), 100);
  }

  /**
   * Debounce utility to prevent rapid re-renders
   * @param {Function} func - Function to debounce
   * @param {number} wait - Milliseconds to wait
   * @returns {Function} Debounced function
   */
  debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  /**
   * Initialize the Map tab - sets up UI, loads data, initializes map
   * @returns {Promise<void>}
   * @throws {Error} If map initialization fails
   */
  async initialize() {
    // Render HTML structure
    this.render();
    
    // Load precincts for filter dropdown
    await this.loadPrecincts();
    
    // Wire event handlers
    this.wireEvents();
    
    // Initialize Google Map
    await this.initializeMap();
    
    // Load initial voter markers
    await this.loadVoters();
    
    this.isInitialized = true;
  }

  async onActivate() {
    // Called when tab becomes active
    // Refresh map size in case container changed
    if (this.state.map.instance) {
      google.maps.event.trigger(this.state.map.instance, 'resize');
    }
  }

  render() {
    const panel = this.container.querySelector(`#${this.panelId}`);
    if (!panel) return;

    panel.innerHTML = `
      <!-- Map Controls -->
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
        <div class="flex flex-wrap items-center gap-3">
          <select id="map-precinct" class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none">
            <option value="">All Precincts</option>
          </select>
          <select id="map-filter" class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none">
            <option value="">All Voters</option>
            <option value="super">Super Voters</option>
            <option value="regular">Regular Voters</option>
          </select>
          <button id="map-reload" class="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            Load Voters
          </button>
          <span id="map-count" class="text-sm text-gray-500 ml-auto"></span>
        </div>
      </div>

      <!-- Route Info Overlay (shown when a route is active) -->
      <div id="route-overlay" class="hidden bg-white dark:bg-gray-900 rounded-xl border border-primary-300 dark:border-primary-700 p-4 mb-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-6 text-sm">
            <span class="font-semibold text-primary-700 dark:text-primary-300">Active Route</span>
            <span>📏 <strong id="overlay-distance">--</strong></span>
            <span>⏱️ <strong id="overlay-duration">--</strong></span>
            <span>📍 <strong id="overlay-stops">--</strong> stops</span>
          </div>
          <button id="overlay-clear" class="text-sm text-red-500 hover:text-red-700 font-medium transition">Clear Route</button>
        </div>
      </div>

      <!-- Map Canvas -->
      <div id="map-canvas" class="w-full h-[500px] lg:h-[600px] rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
        ${spinner('Loading map...')}
      </div>
    `;
  }

  /**
   * Load precincts for filter dropdown
   * Fetches precinct data from API and populates the precinct select element
   * @returns {Promise<void>}
   */
  async loadPrecincts() {
    try {
      const precincts = await fetchPrecincts();
      const select = this.container.querySelector('#map-precinct');
      if (!select) return;

      const list = Array.isArray(precincts) ? precincts : precincts.data || [];
      list.forEach(p => {
        const val = p.precinct_number || p.number || '';
        const label = `Precinct ${val} (${fmt(p.voter_count || p.count || 0)})`;
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = label;
        select.appendChild(opt);
      });
    } catch (err) {
      console.warn('Failed to load precincts:', err);
    }
  }

  wireEvents() {
    // Load voters button
    const reloadBtn = this.container.querySelector('#map-reload');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => this.loadVoters());
    }

    // Precinct and filter change
    const precinctSelect = this.container.querySelector('#map-precinct');
    const filterSelect = this.container.querySelector('#map-filter');
    if (precinctSelect) {
      precinctSelect.addEventListener('change', () => this.loadVoters());
    }
    if (filterSelect) {
      filterSelect.addEventListener('change', () => this.loadVoters());
    }

    // Route overlay clear button
    const clearBtn = this.container.querySelector('#overlay-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearRoute());
    }

    // Listen for "Add to Route" / "Remove from Route" from InfoWindow buttons
    document.addEventListener('toggle-route-voter', (e) => {
      const voterId = e.detail.id;
      this.state.toggleVoterSelection(voterId);
      this.updateMarkerStyles();
      if (this.state.map.infoWindow) {
        this.state.map.infoWindow.close();
      }
    });

    // Subscribe to state changes
    this.state.subscribe('routeChanged', (route) => {
      this.displayRoute(route);
    });

    this.state.subscribe('selectionChanged', () => {
      this.updateMarkerStyles();
    });
  }

  async initializeMap() {
    const config = this.state.config;
    const canvas = this.container.querySelector('#map-canvas');
    if (!canvas) return;

    try {
      const mapInstance = new google.maps.Map(canvas, {
        center: config.mapCenter,
        zoom: config.mapZoom,
        mapTypeControl: true,
        streetViewControl: false,
        // Styles removed - managed via Cloud Console when mapId is present
        // Inline styles property is ignored and triggers warning when mapId is set
        mapId: config.mapId || 'DEMO_MAP_ID',  // REQUIRED for AdvancedMarkerElement
      });

      this.state.setMap(mapInstance);

      // Initialize info window
      const infoWindow = new google.maps.InfoWindow();
      this.state.setInfoWindow(infoWindow);

      // Track map load for quota
      try {
        await trackMapLoad();
      } catch (e) {
        console.warn('Failed to track map load:', e.message);
      }
    } catch (err) {
      canvas.innerHTML = `
        <div class="text-center text-red-500 p-4">
          <p class="font-medium">Failed to load map</p>
          <p class="text-sm mt-1">${escapeHtml(err.message)}</p>
        </div>`;
    }
  }

  /**
   * Load voters with optional filters and display as map markers
   * @param {Object} [filters={}] - Filter options
   * @param {string} [filters.precinct] - Filter by precinct number
   * @param {string} [filters.type] - Filter by voter type (super/regular)
   * @returns {Promise<void>}
   */
  async loadVoters(filters = {}) {
    if (!this.state.map.instance) return;

    const countEl = this.container.querySelector('#map-count');
    if (countEl) countEl.textContent = 'Loading...';

    // Get filters from UI if not provided
    if (!filters.precinct) {
      const precinctSelect = this.container.querySelector('#map-precinct');
      filters.precinct = precinctSelect ? precinctSelect.value : '';
    }
    if (!filters.type) {
      const filterSelect = this.container.querySelector('#map-filter');
      filters.type = filterSelect ? filterSelect.value : '';
    }

    try {
      const params = { limit: VOTER_LOAD_LIMIT, geocoded: true };
      if (filters.precinct) params.precinct = filters.precinct;
      if (filters.type === 'super') params.super_voter = true;
      if (filters.type === 'regular') params.super_voter = false;

      const res = await fetchVoters(params);
      const voters = res.data || [];

      // Filter geocoded voters
      const geocoded = voters.filter(v => v.latitude && v.longitude);

      // Create markers
      const markers = geocoded.map(voter => 
        createVoterMarker(voter, this.state, (v) => this.onMarkerClick(v))
      );

      // Update clustering
      this.updateMarkers(markers);

      // Fit bounds
      if (markers.length > 0) {
        fitBoundsToMarkers(this.state.map.instance, markers);
      }

      // Update count
      if (countEl) countEl.textContent = `${fmt(geocoded.length)} voters plotted`;
    } catch (err) {
      // Enhanced error handling with detailed logging and user guidance
      console.error('Failed to load voters:', err);
      
      let userMessage = 'Unable to load voter data';
      if (err.status === 401 || err.status === 403) {
        userMessage = 'Access denied - please check permissions';
      } else if (err.status >= 500) {
        userMessage = 'Server error - please try again';
      } else if (!navigator.onLine) {
        userMessage = 'No internet connection';
      } else if (err.message) {
        userMessage = err.message;
      }
      
      if (countEl) {
        countEl.innerHTML = `
          <span class="text-red-500">${userMessage}</span>
          <button class="ml-2 px-2 py-1 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded" 
            onclick="document.querySelector('[data-tab=tab-map]').click()">Retry</button>
        `;
      }
      showToast(userMessage, 'error');
      this.state.setError({ operation: 'loadVoters', error: err });
    }
  }

  /**
   * Get or create cached cluster pin for performance
   * @param {number} count - Number of markers in cluster
   * @returns {google.maps.marker.PinElement}
   */
  getCachedClusterPin(count) {
    // Cache key based on count ranges (reduces cache size)
    const cacheKey = count > 100 ? '100+' :
                     count > 50 ? '50+' :
                     count > 10 ? '10+' : String(count);
    
    if (!this.clusterPinCache.has(cacheKey)) {
      this.clusterPinCache.set(cacheKey, createClusterPin(count));
    }
    
    return this.clusterPinCache.get(cacheKey);
  }

  updateMarkers(markers) {
    // Clear existing clusterer
    if (this.clusterer) {
      this.clusterer.clearMarkers();
      this.clusterer = null;
    }

    // Create new clusterer with AdvancedMarkerElement
    this.clusterer = new MarkerClusterer({
      map: this.state.map.instance,
      markers,
      algorithm: new GridAlgorithm({ 
        maxZoom: 15,
        gridSize: 60  // Slightly larger grid for fewer clusters (performance)
      }),
      renderer: {
        render: ({ count, position }, stats) => {
          // Use cached pin instead of creating new one (performance optimization)
          const pin = this.getCachedClusterPin(count);
          
          // Update glyph text for exact count when <= 10
          if (count <= 10) {
            pin.glyphText = String(count);
          }
          
          return new google.maps.marker.AdvancedMarkerElement({
            position,
            content: pin,  // Use PinElement directly (not pin.element - deprecated)
            zIndex: 100000 + count,  // Replaced MAX_ZINDEX constant
          });
        }
      }
    });

    this.state.setMarkers(markers);
  }

  /**
   * Update marker visual styles based on selection state (debounced)
   * Re-renders cluster to reflect changes
   */
  updateMarkerStyles() {
    this.updateMarkersDebounced();
  }

  /**
   * Immediate marker style update implementation
   * @private
   */
  _updateMarkerStylesImmediate() {
    const markers = this.state.map.markers;
    if (!markers) return;

    // Batch DOM updates
    const updates = [];
    
    markers.forEach(marker => {
      const v = marker._voterData;
      if (!v) return;

      const isSelected = this.state.routing.selectedVoterIds.has(v.id);
      const currentSelection = marker._isSelected;
      
      // Skip if selection state unchanged (performance optimization)
      if (currentSelection === isSelected) return;
      
      updates.push({ marker, voter: v, isSelected });
    });

    // Apply updates in batch using idle callback for non-critical updates
    if (updates.length > 0) {
      const applyUpdates = () => {
        updates.forEach(({ marker, voter, isSelected }) => {
          const newPin = createVoterPin(voter.superVoter, isSelected);
          marker.content = newPin;  // Use PinElement directly (not pin.element - deprecated)
          marker.zIndex = isSelected ? 1000 : 1;
          marker._pinElement = newPin;
          marker._isSelected = isSelected;  // Track selection state
        });
        
        // Re-cluster only if necessary (performance optimization)
        if (this.clusterer && updates.length > 10) {
          this.clusterer.render();
        }
      };

      // Use requestIdleCallback if available, otherwise setTimeout
      if (window.requestIdleCallback) {
        requestIdleCallback(applyUpdates, { timeout: 100 });
      } else {
        setTimeout(applyUpdates, 0);
      }
    }
  }

  onMarkerClick(voter) {
    const infoWindow = this.state.map.infoWindow;
    const marker = this.state.map.markers.find(m => m._voterId === voter.id);
    
    if (!marker) return;
    
    const isSelected = this.state.routing.selectedVoterIds.has(voter.id);
    
    infoWindow.setContent(`
      <div style="font-family: system-ui; font-size: 13px; max-width: 240px;">
        <strong>${escapeHtml(voter.firstName)} ${escapeHtml(voter.lastName)}</strong><br>
        ${escapeHtml(voter.address || '')}<br>
        ${escapeHtml(voter.city || '')} ${escapeHtml(voter.zipCode || '')}<br>
        <span style="color: ${voter.superVoter ? 'green' : 'gray'}">
          ${voter.superVoter ? '★ Super Voter' : 'Regular Voter'}
        </span><br>
        Precinct: ${escapeHtml(voter.precinctNumber || '')}<br>
        <button onclick="document.dispatchEvent(new CustomEvent('toggle-route-voter', {detail:{id:${voter.id}}}))"
          style="margin-top:6px;padding:3px 10px;font-size:12px;border-radius:4px;cursor:pointer;
          background:${isSelected ? '#ef4444' : '#3b82f6'};color:#fff;border:none;">
          ${isSelected ? 'Remove from Route' : 'Add to Route'}
        </button>
      </div>
    `);
    infoWindow.open(this.state.map.instance, marker);
  }

  /**
   * Display a route on the map with markers and polyline
   * @param {Object} route - Route object with locations and metrics
   * @param {Array} route.locations - Array of stop locations {lat, lng}
   * @param {Object} route.metrics - Route metrics (distance, duration, etc.)
   */
  displayRoute(route) {
    // Clear previous route visuals
    this.clearRoute();

    if (!route || !route.locations || route.locations.length === 0) return;

    const map = this.state.map.instance;
    const locs = route.locations;
    const pathCoords = [];
    const routeMarkers = [];

    // Include start location if available
    if (this.state.routing.startLocation) {
      pathCoords.push(this.state.routing.startLocation);
    }

    // Create stop markers and path coordinates
    locs.forEach((loc, i) => {
      const pos = { lat: parseFloat(loc.lat), lng: parseFloat(loc.lng) };
      pathCoords.push(pos);

      const stopMarker = createRouteMarker(loc, i, map);
      
      stopMarker.addListener('gmp-click', () => {  // Use gmp-click for AdvancedMarkerElement
        this.state.map.infoWindow.setContent(`
          <div style="font-family: system-ui; font-size: 13px; max-width: 220px;">
            <strong>Stop ${i + 1}</strong><br>
            <strong>${escapeHtml(loc.firstName || '')} ${escapeHtml(loc.lastName || '')}</strong><br>
            ${escapeHtml(loc.address || '')}
          </div>
        `);
        this.state.map.infoWindow.open(map, stopMarker);
      });

      routeMarkers.push(stopMarker);
    });

    // Create polyline
    const routePath = new google.maps.Polyline({
      path: pathCoords,
      geodesic: true,
      strokeColor: '#3b82f6',
      strokeOpacity: 0.8,
      strokeWeight: 4,
      map,
    });

    // Store in state
    this.state.map.routeMarkers = routeMarkers;
    this.state.map.routePath = routePath;

    // Fit bounds to route
    const bounds = new google.maps.LatLngBounds();
    pathCoords.forEach(p => bounds.extend(p));
    map.fitBounds(bounds);

    // Show route overlay
    this.showRouteOverlay(route);
  }

  showRouteOverlay(route) {
    const overlay = this.container.querySelector('#route-overlay');
    if (!overlay) return;

    const metrics = route.metrics || {};
    overlay.classList.remove('hidden');

    const distEl = overlay.querySelector('#overlay-distance');
    const durEl = overlay.querySelector('#overlay-duration');
    const stopsEl = overlay.querySelector('#overlay-stops');

    if (distEl) distEl.textContent = `${(metrics.totalDistanceMiles || 0).toFixed(1)} mi`;
    if (durEl) durEl.textContent = `${metrics.totalDurationMinutes || 0} min`;
    if (stopsEl) stopsEl.textContent = metrics.stopCount || 0;
  }

  clearRoute() {
    // Clear route markers
    if (this.state.map.routeMarkers) {
      this.state.map.routeMarkers.forEach(m => m.map = null);
      this.state.map.routeMarkers = [];
    }

    // Clear route path
    if (this.state.map.routePath) {
      this.state.map.routePath.setMap(null);
      this.state.map.routePath = null;
    }

    // Hide overlay
    const overlay = this.container.querySelector('#route-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
    }
  }

  /**
   * Cleanup method called when tab is deactivated or unmounted
   * Prevents memory leaks by clearing caches and event listeners
   */
  cleanup() {
    // Clear clusterer
    if (this.clusterer) {
      this.clusterer.clearMarkers();
      this.clusterer = null;
    }
    
    // Clear cluster pin cache
    if (this.clusterPinCache) {
      this.clusterPinCache.clear();
    }
    
    // Clear any pending debounced calls
    if (this.updateMarkersDebounced && this.updateMarkersDebounced.timeout) {
      clearTimeout(this.updateMarkersDebounced.timeout);
    }
    
    this.clearRoute();
  }
}
