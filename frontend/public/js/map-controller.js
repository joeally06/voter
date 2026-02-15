/**
 * Map Controller
 * Google Maps integration for voter visualization
 */
class MapController {
  constructor(mapElement, stateManager, options = {}) {
    this.mapElement = mapElement;
    this.stateManager = stateManager;
    this.map = null;
    this.markers = [];
    this.markerClusterer = null;
    this.infoWindow = null;
    this.routePlannerController = null;  // Will be set later
    this.selectionMode = false;  // Map selection mode toggle
    // Use configuration for map center and zoom with fallback to defaults
    this.defaultCenter = options.center || window.APP_CONFIG?.mapCenter || { lat: 36.2639, lng: -89.1929 };
    this.defaultZoom = options.zoom || window.APP_CONFIG?.mapZoom || 11;
    this.isInitialized = false;
  }

  /**
   * Initialize Google Maps
   */
  async init() {
    if (!window.google || !window.google.maps) {
      Logger.error('Google Maps API not loaded');
      Utils.showToast('Map service unavailable', 'error');
      return;
    }

    try {
      this.map = new google.maps.Map(this.mapElement, {
        center: this.defaultCenter,
        zoom: this.defaultZoom,
        mapTypeControl: true,
        mapTypeControlOptions: {
          style: google.maps.MapTypeControlStyle.DROPDOWN_MENU,
          position: google.maps.ControlPosition.TOP_RIGHT
        },
        streetViewControl: false,
        zoomControl: true,
        zoomControlOptions: {
          position: google.maps.ControlPosition.RIGHT_CENTER
        },
        fullscreenControl: true,
        styles: [
          {
            featureType: 'poi',
            elementType: 'labels',
            stylers: [{ visibility: 'off' }]
          }
        ]
      });

      this.infoWindow = new google.maps.InfoWindow();
      this.isInitialized = true;

      // RECOMMENDED FIX #6: Setup keyboard navigation for map
      this.setupKeyboardNavigation();

      // Subscribe to state changes
      this.stateManager.subscribe((state, prevState) => {
        if (state.filteredVoters !== prevState.filteredVoters) {
          this.updateMarkers(state.filteredVoters);
        }
      });

      Logger.info('✅ Map initialized successfully');
    } catch (error) {
      Logger.error('Map initialization error:', error);
      Utils.showToast('Failed to initialize map', 'error');
    }
  }

  /**
   * Setup keyboard navigation for map accessibility
   * RECOMMENDED FIX #6: Enhanced keyboard navigation
   */
  setupKeyboardNavigation() {
    this.focusedMarkerIndex = -1;
    
    this.mapElement.addEventListener('keydown', (e) => {
      if (!this.markers || this.markers.length === 0) return;
      
      switch(e.key) {
        case 'Enter':
        case ' ':
          // Activate focused marker
          if (this.focusedMarkerIndex >= 0 && this.focusedMarkerIndex < this.markers.length) {
            const marker = this.markers[this.focusedMarkerIndex];
            google.maps.event.trigger(marker, 'click');
          }
          e.preventDefault();
          break;
          
        case 'ArrowRight':
        case 'ArrowDown':
          this.focusNextMarker();
          e.preventDefault();
          break;
          
        case 'ArrowLeft':
        case 'ArrowUp':
          this.focusPreviousMarker();
          e.preventDefault();
          break;
          
        case 'Escape':
          this.infoWindow.close();
          this.focusedMarkerIndex = -1;
          e.preventDefault();
          break;
          
        case 'Home':
          this.focusMarkerByIndex(0);
          e.preventDefault();
          break;
          
        case 'End':
          this.focusMarkerByIndex(this.markers.length - 1);
          e.preventDefault();
          break;
      }
    });
  }

  /**
   * Focus next marker in keyboard navigation
   */
  focusNextMarker() {
    if (!this.markers || this.markers.length === 0) return;
    
    this.focusedMarkerIndex = (this.focusedMarkerIndex + 1) % this.markers.length;
    this.focusMarkerByIndex(this.focusedMarkerIndex);
  }

  /**
   * Focus previous marker in keyboard navigation
   */
  focusPreviousMarker() {
    if (!this.markers || this.markers.length === 0) return;
    
    if (this.focusedMarkerIndex <= 0) {
      this.focusedMarkerIndex = this.markers.length - 1;
    } else {
      this.focusedMarkerIndex--;
    }
    this.focusMarkerByIndex(this.focusedMarkerIndex);
  }

  /**
   * Focus marker at specific index
   * @param {number} index - Marker index
   */
  focusMarkerByIndex(index) {
    if (!this.markers || index < 0 || index >= this.markers.length) return;
    
    const marker = this.markers[index];
    this.map.panTo(marker.getPosition());
    
    // Visual feedback with bounce animation
    marker.setAnimation(google.maps.Animation.BOUNCE);
    setTimeout(() => marker.setAnimation(null), 750);
    
    Logger.debug(`⌨️ Keyboard focus: Marker ${index + 1}/${this.markers.length}`);
  }

  /**
   * Set reference to route planner (called after initialization)
   */
  setRoutePlanner(routePlanner) {
    this.routePlannerController = routePlanner;
  }

  /**
   * Update cursor style based on selection mode
   */
  setSelectionCursor(enabled) {
    this.selectionMode = enabled;
    if (this.map) {
      this.map.setOptions({
        draggableCursor: enabled ? 'crosshair' : null
      });
    }
  }

  /**
   * Update marker icon to show selected/unselected state
   */
  updateMarkerIcon(voterId, selected) {
    const marker = this.markers.find(m => {
      const voter = m.voter;
      if (!voter) return false;
      return (voter.voterId || voter.voter_id) === voterId;
    });
    
    if (marker && marker.voter) {
      marker.setIcon(this.getMarkerIcon(marker.voter, selected));
    }
  }

  /**
   * Update all marker icons based on selected voter IDs
   * @param {Array<string>} selectedVoterIds - Array of selected voter IDs
   */
  updateAllMarkerIcons(selectedVoterIds) {
    const selectedSet = new Set(selectedVoterIds);
    
    this.markers.forEach(marker => {
      const voter = marker.voter;
      if (voter) {
        const voterId = voter.voterId || voter.voter_id;
        const isSelected = selectedSet.has(voterId);
        marker.setIcon(this.getMarkerIcon(voter, isSelected));
      }
    });
    
    Logger.debug(`Updated ${this.markers.length} marker icons`);
  }

  /**
   * Update map markers with voter data
   * @param {Array} voters - Array of voter objects
   */
  updateMarkers(voters) {
    if (!this.isInitialized) return;

    // Clear existing markers
    this.clearMarkers();

    // Filter voters with valid coordinates
    const validVoters = voters.filter(v => 
      Utils.isValidCoordinates(v.latitude, v.longitude)
    );

    if (validVoters.length === 0) {
      Logger.debug('No voters with valid coordinates to display');
      return;
    }

    // Create new markers
    this.markers = validVoters.map(voter => {
      const marker = new google.maps.Marker({
        position: { lat: parseFloat(voter.latitude), lng: parseFloat(voter.longitude) },
        map: this.map,
        title: `${voter.firstName || voter.first_name} ${voter.lastName || voter.last_name}`,
        icon: this.getMarkerIcon(voter, false),
        optimized: true
      });

      // Store voter reference on marker
      marker.voter = voter;

      // Enhanced click listener for selection mode
      marker.addListener('click', () => {
        if (this.selectionMode && this.routePlannerController) {
          // In selection mode, toggle voter selection
          this.routePlannerController.toggleVoterSelection(voter);
        } else {
          // Normal mode, show info window
          this.showVoterInfo(voter, marker);
        }
      });

      return marker;
    });

    // Apply clustering if many markers
    // Use configuration for clustering threshold with fallback to 100
    const clusterThreshold = window.APP_CONFIG?.markerClusterThreshold || 100;
    if (this.markers.length > clusterThreshold) {
      this.enableClustering();
    }

    // Fit bounds to show all markers
    if (this.markers.length > 0) {
      this.fitBounds();
    }

    Logger.info(`📍 ${this.markers.length} markers displayed on map`);
  }

  /**
   * Get custom marker icon based on voter attributes and selection state
   * @param {Object} voter - Voter object
   * @param {boolean} selected - Whether voter is selected for route
   * @returns {Object} Marker icon configuration
   */
  getMarkerIcon(voter, selected = false) {
    // Use configuration for marker colors with fallback to defaults
    const colors = window.APP_CONFIG?.markerColors || {
      superVoter: '#198754',
      regular: '#6c757d',
      selected: '#0d6efd'
    };
    
    const isSuperVoter = voter.superVoter || voter.super_voter || voter.is_super_voter;
    
    if (selected) {
      // Selected markers: blue star with colored border
      return {
        path: 'M 0,-8 L 2,-2 L 8,-2 L 3,2 L 5,8 L 0,4 L -5,8 L -3,2 L -8,-2 L -2,-2 Z', // Star shape
        fillColor: colors.selected,
        fillOpacity: 1.0,
        strokeColor: isSuperVoter ? colors.superVoter : colors.regular,
        strokeWeight: 3,
        scale: 1,
        anchor: new google.maps.Point(0, 0)
      };
    } else {
      // Normal markers (circle)
      const color = isSuperVoter ? colors.superVoter : colors.regular;
      return {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: color,
        fillOpacity: 0.8,
        strokeColor: '#ffffff',
        strokeWeight: 2,
        scale: 8
      };
    }
  }

  /**
   * Show InfoWindow with voter details
   * CRITICAL FIX #2: Escape HTML to prevent XSS in InfoWindow popups
   * ENHANCEMENT: Display party affiliation and participation rate
   * @param {Object} voter - Voter object
   * @param {Object} marker - Google Maps marker
   */
  showVoterInfo(voter, marker) {
    // Escape all user-provided data to prevent XSS
    const firstName = Utils.escapeHtml(voter.firstName || voter.first_name || '');
    const lastName = Utils.escapeHtml(voter.lastName || voter.last_name || '');
    const address = Utils.escapeHtml(voter.address || 'N/A');
    const city = Utils.escapeHtml(voter.city || '');
    const zipCode = Utils.escapeHtml(voter.zipCode || voter.zip_code || '');
    const precinctNumber = Utils.escapeHtml(voter.precinctNumber || voter.precinct_number || 'N/A');
    
    // Get party information
    const partyCode = voter.mostRecentParty || null;
    const partyBadge = this.getPartyBadge(partyCode);
    
    // Get participation info
    const participationRate = voter.participationRate || 0;
    const electionsVoted = voter.electionsVoted || 0;
    const totalElections = voter.totalElections || 0;
    const participationBadge = participationRate >= 80
      ? `<span class="badge bg-success">${participationRate}% turnout</span>`
      : participationRate > 0
        ? `<span class="badge bg-warning text-dark">${participationRate}% turnout</span>`
        : '';
    
    const isSuperVoter = voter.superVoter || voter.super_voter || voter.is_super_voter;
    
    const content = `
      <div class="voter-info-window" style="max-width: 320px;">
        <h6 class="fw-bold mb-2">
          ${firstName} ${lastName}
        </h6>
        <div class="small">
          <p class="mb-1">
            <i class="bi bi-house-door"></i> 
            <strong>Address:</strong><br>
            ${address}<br>
            ${city}, TN ${zipCode}
          </p>
          <p class="mb-1">
            <i class="bi bi-map"></i> 
            <strong>Precinct:</strong> ${precinctNumber}
          </p>
          <div class="mb-2">
            ${partyBadge}
            ${participationBadge}
            ${isSuperVoter ? '<span class="badge bg-primary">Super Voter</span>' : ''}
          </div>
          ${totalElections > 0 ? `
          <p class="mb-0 text-muted" style="font-size: 0.85em;">
            <i class="bi bi-ballot-check"></i> 
            Voted in ${electionsVoted} of ${totalElections} elections
          </p>
          ` : ''}
        </div>
      </div>
    `;
    
    this.infoWindow.setContent(content);
    this.infoWindow.open(this.map, marker);
  }
  
  /**
   * Get party affiliation badge HTML
   * @param {string} partyCode - Party code (D/R/I/null)
   * @returns {string} HTML for party badge
   */
  getPartyBadge(partyCode) {
    const partyInfo = {
      'D': { name: 'Democrat', color: 'primary', icon: 'bi-person-fill' },
      'R': { name: 'Republican', color: 'danger', icon: 'bi-person-fill' },
      'I': { name: 'Independent', color: 'secondary', icon: 'bi-person' }
    };
    
    if (!partyCode || !partyInfo[partyCode]) {
      return '<span class="badge bg-secondary">No Party Data</span>';
    }
    
    const party = partyInfo[partyCode];
    return `<span class="badge bg-${party.color}"><i class="${party.icon}"></i> ${party.name}</span>`;
  }

  /**
   * Enable marker clustering for performance
   */
  enableClustering() {
    if (this.markerClusterer) {
      this.markerClusterer.clearMarkers();
    }

    if (window.markerClusterer && window.markerClusterer.MarkerClusterer) {
      // Use configuration for cluster radius with fallback to 100
      const radius = window.APP_CONFIG?.clusterRadius || 100;
      this.markerClusterer = new markerClusterer.MarkerClusterer({
        map: this.map,
        markers: this.markers,
        algorithm: new markerClusterer.SuperClusterAlgorithm({ radius })
      });
      Logger.info('🎯 Marker clustering enabled');
    } else {
      Logger.warn('MarkerClusterer library not available');
    }
  }

  /**
   * Clear all markers from map
   */
  clearMarkers() {
    this.markers.forEach(marker => marker.setMap(null));
    this.markers = [];
    
    if (this.markerClusterer) {
      this.markerClusterer.clearMarkers();
      this.markerClusterer = null;
    }
  }

  /**
   * Fit map bounds to show all markers
   */
  fitBounds() {
    if (this.markers.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    this.markers.forEach(marker => {
      bounds.extend(marker.getPosition());
    });
    this.map.fitBounds(bounds);

    // Ensure zoom isn't too close
    // Use configuration for max auto zoom with fallback to 16
    const maxZoom = window.APP_CONFIG?.maxAutoZoom || 16;
    const listener = google.maps.event.addListener(this.map, 'idle', () => {
      if (this.map.getZoom() > maxZoom) {
        this.map.setZoom(maxZoom);
      }
      google.maps.event.removeListener(listener);
    });
  }

  /**
   * Pan map to specific coordinates
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @param {number} zoom - Optional zoom level
   */
  panTo(lat, lng, zoom = null) {
    if (!this.isInitialized) return;

    this.map.panTo({ lat, lng });
    if (zoom !== null) {
      this.map.setZoom(zoom);
    }
  }

  /**
   * Highlight specific marker
   * @param {Object} voter - Voter to highlight
   */
  highlightVoter(voter) {
    if (!Utils.isValidCoordinates(voter.latitude, voter.longitude)) return;

    this.panTo(parseFloat(voter.latitude), parseFloat(voter.longitude), 15);

    // Find and pulse the marker
    const marker = this.markers.find(m => {
      const pos = m.getPosition();
      return pos.lat() === parseFloat(voter.latitude) && 
             pos.lng() === parseFloat(voter.longitude);
    });

    if (marker) {
      this.showVoterInfo(voter, marker);
    }
  }

  /**
   * Reset map to default view
   */
  resetView() {
    if (!this.isInitialized) return;

    this.map.setCenter(this.defaultCenter);
    this.map.setZoom(this.defaultZoom);
    this.infoWindow.close();
  }
}

// Make available globally
window.MapController = MapController;
