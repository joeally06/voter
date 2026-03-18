/**
 * MapState.js - Centralized state management for MapView
 * 
 * Manages all application state for the voter map interface including:
 * - Map instance and markers
 * - UI state (active tab, loading, errors)
 * - Routing state (selections, routes, saved routes)
 * - Geocoding state (jobs, stats)
 * 
 * Implements observer pattern for reactive updates and persistence
 * to localStorage/sessionStorage.
 */

export default class MapState {
  constructor() {
    // Initialize state structure
    this._state = {
      // Map instance and related objects
      map: {
        instance: null,
        markers: [],
        routeMarkers: [],
        routePath: null,
        infoWindow: null,
        startMarker: null,
        mapClickListener: null
      },
      
      // UI state
      ui: {
        activeTab: 'map',
        loading: false,
        error: null,
        darkMode: document.documentElement.classList.contains('dark')
      },
      
      // Routing state
      routing: {
        startLocation: null,
        selectedVoterIds: new Set(),
        currentRoute: null,
        voterDataCache: [],
        savedRoutes: []
      },
      
      // Geocoding state
      geocoding: {
        jobId: null,
        pollTimer: null,
        stats: null
      },
      
      // Config (loaded on init)
      config: {
        googleMapsApiKey: null,
        mapCenter: { lat: 36.2639, lng: -89.1929 },
        mapZoom: 11
      }
    };
    
    // Observer subscriptions
    this._subscribers = {
      mapInitialized: [],
      markersChanged: [],
      routeChanged: [],
      selectionChanged: [],
      startLocationChanged: [],
      tabChanged: [],
      jobStatusChanged: []
    };
    
    // Restore persisted state
    this.restore();
  }

  /* ── Map State ────────────────────────────────────────────── */

  get map() {
    return this._state.map;
  }

  setMap(instance) {
    if (!instance) {
      throw new Error('Map instance cannot be null');
    }
    this._state.map.instance = instance;
    this._notify('mapInitialized', instance);
  }

  /**
   * Set markers array and notify subscribers
   * @param {Array} markers - Array of Google Maps AdvancedMarkerElement objects
   * @throws {Error} If markers is not an array or contains invalid markers
   */
  setMarkers(markers) {
    if (!Array.isArray(markers)) {
      throw new Error('Markers must be an array');
    }
    // Validate marker structure - AdvancedMarkerElement uses .position property
    if (markers.length > 0 && markers.some(m => !m || !m.position)) {
      console.warn('MapState: Some markers may be invalid (missing position property)');
    }
    this._state.map.markers = markers;
    this._notify('markersChanged', markers);
  }

  setInfoWindow(window) {
    this._state.map.infoWindow = window;
  }

  setStartMarker(marker) {
    if (this._state.map.startMarker) {
      this._state.map.startMarker.map = null;
    }
    this._state.map.startMarker = marker;
  }

  setMapClickListener(listener) {
    if (this._state.map.mapClickListener) {
      google.maps.event.removeListener(this._state.map.mapClickListener);
    }
    this._state.map.mapClickListener = listener;
  }

  /* ── UI State ─────────────────────────────────────────────── */

  get ui() {
    return { ...this._state.ui };
  }

  setActiveTab(tab) {
    const validTabs = ['map', 'route', 'geocoding'];
    if (!validTabs.includes(tab)) {
      throw new Error(`Invalid tab: ${tab}`);
    }
    this._state.ui.activeTab = tab;
    this._notify('tabChanged', tab);
  }

  setLoading(isLoading) {
    this._state.ui.loading = Boolean(isLoading);
  }

  setError(error) {
    this._state.ui.error = error;
    if (error) console.error('MapState error:', error);
  }

  /* ── Routing State ────────────────────────────────────────── */

  get routing() {
    return {
      ...this._state.routing,
      selectedVoterIds: new Set(this._state.routing.selectedVoterIds)
    };
  }

  setStartLocation(location) {
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      throw new Error('Invalid location: must have lat/lng');
    }
    this._state.routing.startLocation = location;
    this._notify('startLocationChanged', location);
    this.persist();
  }

  toggleVoterSelection(voterId) {
    const ids = this._state.routing.selectedVoterIds;
    if (ids.has(voterId)) {
      ids.delete(voterId);
    } else {
      ids.add(voterId);
    }
    this._notify('selectionChanged', Array.from(ids));
  }

  clearVoterSelection() {
    this._state.routing.selectedVoterIds.clear();
    this._notify('selectionChanged', []);
  }

  setCurrentRoute(route) {
    this._state.routing.currentRoute = route;
    this._notify('routeChanged', route);
    this.persist();
  }

  setVoterDataCache(voters) {
    if (!Array.isArray(voters)) {
      throw new Error('Voter cache must be an array');
    }
    this._state.routing.voterDataCache = voters;
  }

  addSavedRoute(route) {
    this._state.routing.savedRoutes.push(route);
    this.persist();
  }

  removeSavedRoute(routeId) {
    this._state.routing.savedRoutes = this._state.routing.savedRoutes
      .filter(r => r.id !== routeId);
    this.persist();
  }

  /* ── Geocoding State ──────────────────────────────────────── */

  get geocoding() {
    return { ...this._state.geocoding };
  }

  /**
   * Set geocoding job ID
   * @param {string|number} jobId - The geocoding job identifier
   */
  setGeocodingJob(jobId) {
    this._state.geocoding.jobId = jobId;
    this._notify('jobStatusChanged', { jobId, status: 'STARTED' });
  }

  /**
   * Set geocoding statistics
   * @param {Object} stats - Statistics object with geocoding metrics
   * @param {number} [stats.totalVoters] - Total voter count
   * @param {number} [stats.geocoded] - Number of geocoded voters
   * @param {number} [stats.pending] - Number of pending voters
   * @throws {Error} If stats is not an object
   */
  setGeocodingStats(stats) {
    if (!stats || typeof stats !== 'object') {
      throw new Error('Geocoding stats must be an object');
    }
    // Validate numeric fields if present
    const numericFields = ['totalVoters', 'geocoded', 'pending', 'failed'];
    numericFields.forEach(field => {
      if (stats[field] !== undefined && typeof stats[field] !== 'number') {
        console.warn(`MapState: ${field} should be a number, got ${typeof stats[field]}`);
      }
    });
    this._state.geocoding.stats = stats;
  }

  startGeocodingPoll(pollFn) {
    this.stopGeocodingPoll();
    this._state.geocoding.pollTimer = pollFn;
  }

  stopGeocodingPoll() {
    if (this._state.geocoding.pollTimer) {
      clearInterval(this._state.geocoding.pollTimer);
      this._state.geocoding.pollTimer = null;
    }
  }

  /* ── Config ────────────────────────────────────────────────── */

  get config() {
    return { ...this._state.config };
  }

  /**
   * Set configuration values (including API keys)
   * @param {Object} config - Configuration object
   * @param {string} [config.googleMapsApiKey] - Google Maps API key
   * @param {Object} [config.mapCenter] - Map center coordinates {lat, lng}
   * @param {number} [config.mapZoom] - Initial map zoom level
   * @throws {Error} If config is invalid or API key is empty
   */
  setConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('Config must be an object');
    }
    // Validate API key if provided
    if (config.googleMapsApiKey !== undefined) {
      if (typeof config.googleMapsApiKey !== 'string' || config.googleMapsApiKey.trim() === '') {
        throw new Error('Google Maps API key must be a non-empty string');
      }
    }
    // Validate map center if provided
    if (config.mapCenter !== undefined) {
      if (!config.mapCenter || typeof config.mapCenter.lat !== 'number' || typeof config.mapCenter.lng !== 'number') {
        throw new Error('Map center must have numeric lat/lng properties');
      }
    }
    // Validate zoom if provided
    if (config.mapZoom !== undefined && (typeof config.mapZoom !== 'number' || config.mapZoom < 0 || config.mapZoom > 22)) {
      console.warn('MapState: mapZoom should be a number between 0 and 22');
    }
    this._state.config = { ...this._state.config, ...config };
  }

  /* ── Observer Pattern ──────────────────────────────────────── */

  subscribe(event, listener) {
    if (!this._subscribers[event]) {
      this._subscribers[event] = [];
    }
    this._subscribers[event].push(listener);
    
    // Return unsubscribe function
    return () => this.unsubscribe(event, listener);
  }

  unsubscribe(event, listener) {
    if (!this._subscribers[event]) return;
    this._subscribers[event] = this._subscribers[event]
      .filter(fn => fn !== listener);
  }

  _notify(event, data) {
    if (!this._subscribers[event]) return;
    this._subscribers[event].forEach(fn => {
      try {
        fn(data, this._state);
      } catch (error) {
        console.error(`Error in subscriber for ${event}:`, error);
      }
    });
  }

  /* ── Persistence ───────────────────────────────────────────── */

  persist() {
    try {
      // Persist to localStorage (long-term)
      localStorage.setItem('voter_saved_routes', JSON.stringify(
        this._state.routing.savedRoutes
      ));
      
      // Persist to sessionStorage (session-only)
      sessionStorage.setItem('voter_current_route', JSON.stringify(
        this._state.routing.currentRoute
      ));
      sessionStorage.setItem('voter_start_location', JSON.stringify(
        this._state.routing.startLocation
      ));
    } catch (error) {
      console.warn('Failed to persist state:', error);
    }
  }

  restore() {
    try {
      // Restore from localStorage
      const savedRoutes = localStorage.getItem('voter_saved_routes');
      if (savedRoutes) {
        this._state.routing.savedRoutes = JSON.parse(savedRoutes);
      }
      
      // Restore from sessionStorage
      const currentRoute = sessionStorage.getItem('voter_current_route');
      if (currentRoute) {
        this._state.routing.currentRoute = JSON.parse(currentRoute);
      }
      
      const startLocation = sessionStorage.getItem('voter_start_location');
      if (startLocation) {
        this._state.routing.startLocation = JSON.parse(startLocation);
      }
    } catch (error) {
      console.warn('Failed to restore state:', error);
    }
  }

  reset() {
    // Clear map objects
    if (this._state.map.instance) {
      this._state.map.markers.forEach(m => m.map = null);
      this._state.map.routeMarkers.forEach(m => m.map = null);
      if (this._state.map.routePath) this._state.map.routePath.setMap(null);
      if (this._state.map.startMarker) this._state.map.startMarker.map = null;
      if (this._state.map.mapClickListener) {
        google.maps.event.removeListener(this._state.map.mapClickListener);
      }
    }
    
    // Stop geocoding poll
    this.stopGeocodingPoll();
    
    // Reset to initial state (keep config and saved routes)
    const config = this._state.config;
    const savedRoutes = this._state.routing.savedRoutes;
    
    this._state = {
      map: {
        instance: null,
        markers: [],
        routeMarkers: [],
        routePath: null,
        infoWindow: null,
        startMarker: null,
        mapClickListener: null
      },
      ui: {
        activeTab: 'map',
        loading: false,
        error: null,
        darkMode: document.documentElement.classList.contains('dark')
      },
      routing: {
        startLocation: null,
        selectedVoterIds: new Set(),
        currentRoute: null,
        voterDataCache: [],
        savedRoutes
      },
      geocoding: {
        jobId: null,
        pollTimer: null,
        stats: null
      },
      config
    };
  }

  /* ── Debugging ─────────────────────────────────────────────── */

  debug() {
    const stateCopy = {
      ...this._state,
      routing: {
        ...this._state.routing,
        selectedVoterIds: Array.from(this._state.routing.selectedVoterIds)
      }
    };
    
    console.group('MapState Debug');
    console.log('State:', stateCopy);
    console.log('Subscribers:', Object.keys(this._subscribers).map(k => ({
      event: k,
      count: this._subscribers[k].length
    })));
    console.groupEnd();
    
    return stateCopy;
  }
}
