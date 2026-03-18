/**
 * RoutePlannerTab.js - Route planning component
 * 
 * Handles:
 * - Voter selection interface
 * - Start location management (address, GPS, map click)
 * - Route calculation and optimization
 * - Route saving/loading/deleting
 * - Route visualization delegation to MapTab
 */

import {
  fetchVoters,
  calcRoute,
  saveRoute as saveRouteAPI,
  fetchRoute,
  deleteRoute
} from '../../../api/client.js';
import {
  formatDistance,
  formatDuration,
  formatEfficiency,
  createStopList,
  buildGoogleMapsUrls
} from '../utils/routeUtils.js';
import {
  createStartMarker
} from '../utils/mapUtils.js';
import {
  spinner,
  errorBox,
  emptyState,
  fmt,
  pct,
  escapeHtml
} from '../../../components/ui.js';
import { showToast } from '../../../main.js';

const VOTER_LOAD_LIMIT = 500;

export default class RoutePlannerTab {
  constructor(container, state) {
    this.container = container;
    this.state = state;
    this.panelId = 'tab-route';
    this.isInitialized = false;
  }

  async initialize() {
    this.render();
    await this.loadVoters();
    this.wireEvents();
    this.renderSavedRoutesList();
    this.isInitialized = true;
  }

  async onActivate() {
    // Refresh voter cache if needed
    if (this.state.routing.voterDataCache.length === 0) {
      await this.loadVoters();
    }
    this.updateSelectionCount();
  }

  render() {
    const panel = this.container.querySelector(`#${this.panelId}`);
    if (!panel) return;

    panel.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <!-- Left: Configuration -->
        <div class="lg:col-span-1 space-y-4">
          <!-- Start Location -->
          <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 class="font-semibold text-gray-900 dark:text-white text-sm mb-3">Start Location</h3>
            <input id="rp-start-address" type="text" placeholder="Enter start address..." maxlength="200"
              class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none mb-2">
            <div class="flex gap-2">
              <button id="rp-use-location" class="flex-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-3 py-2 rounded-lg text-xs font-medium transition hover:bg-gray-300 dark:hover:bg-gray-600">
                📍 Use My Location
              </button>
              <button id="rp-set-on-map" class="flex-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-3 py-2 rounded-lg text-xs font-medium transition hover:bg-gray-300 dark:hover:bg-gray-600">
                🗺️ Click on Map
              </button>
            </div>
            <p id="rp-start-status" class="text-xs text-gray-500 mt-2">Start location not set</p>
          </div>

          <!-- Route Settings -->
          <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 class="font-semibold text-gray-900 dark:text-white text-sm mb-3">Route Settings</h3>
            <label class="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Travel Mode</label>
            <select id="rp-travel-mode" class="w-full mt-1 mb-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none">
              <option value="driving">🚗 Driving</option>
              <option value="walking">🚶 Walking</option>
              <option value="bicycling">🚴 Bicycling</option>
            </select>
            <label class="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Algorithm</label>
            <select id="rp-algorithm" class="w-full mt-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none">
              <option value="hybrid">Hybrid (recommended)</option>
              <option value="nearest_neighbor">Nearest Neighbor</option>
              <option value="2opt">2-Opt Improvement</option>
            </select>
          </div>

          <!-- Selection Summary & Calculate -->
          <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-semibold text-gray-900 dark:text-white text-sm">Selection</h3>
              <span id="rp-selection-count" class="text-xs font-medium text-primary-600 dark:text-primary-400">0 voters selected</span>
            </div>
            <div class="flex gap-2 mb-3">
              <button id="rp-select-all" class="flex-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-1.5 rounded-lg font-medium transition hover:bg-gray-300">Select All</button>
              <button id="rp-clear-selection" class="flex-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-1.5 rounded-lg font-medium transition hover:bg-gray-300">Clear Selection</button>
            </div>
            <button id="rp-calculate" class="w-full bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed" disabled>
              Calculate Route
            </button>
          </div>

          <!-- Route Results -->
          <div id="rp-results" class="hidden space-y-4">
            <div class="bg-white dark:bg-gray-900 rounded-xl border border-green-300 dark:border-green-700 p-4">
              <h3 class="font-semibold text-green-700 dark:text-green-300 text-sm mb-3">Route Results</h3>
              <div class="grid grid-cols-2 gap-2 text-sm">
                <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <p class="text-xs text-gray-500">Distance</p>
                  <p class="text-lg font-bold text-gray-900 dark:text-white" id="rp-distance">--</p>
                </div>
                <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <p class="text-xs text-gray-500">Duration</p>
                  <p class="text-lg font-bold text-gray-900 dark:text-white" id="rp-duration">--</p>
                </div>
                <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <p class="text-xs text-gray-500">Stops</p>
                  <p class="text-lg font-bold text-gray-900 dark:text-white" id="rp-stops">--</p>
                </div>
                <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <p class="text-xs text-gray-500">Efficiency</p>
                  <p class="text-lg font-bold text-gray-900 dark:text-white" id="rp-efficiency">--</p>
                </div>
              </div>
              <div class="flex gap-2 mt-3">
                <button id="rp-save" class="flex-1 bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg text-xs font-medium transition">💾 Save</button>
                <button id="rp-print" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-xs font-medium transition">🖨️ Print</button>
                <button id="rp-clear-route" class="flex-1 bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded-lg text-xs font-medium transition">✕ Clear</button>
              </div>
              <!-- Google Maps Export -->
              <div id="rp-gmaps-export" class="mt-2 space-y-1.5 hidden">
                <a id="rp-gmaps-single"
                   href=""
                   target="_blank"
                   rel="noopener noreferrer"
                   class="flex items-center justify-center gap-2 w-full bg-[#1a73e8] hover:bg-[#1557b0] text-white px-3 py-2.5 rounded-lg text-xs font-semibold transition">
                  <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z"/>
                  </svg>
                  Open in Google Maps
                </a>
                <div id="rp-gmaps-segments" class="space-y-1.5"></div>
                <button id="rp-share-route"
                        class="w-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-xs font-medium transition flex items-center justify-center gap-1.5">
                  🔗 Share Route Link
                </button>
                <p class="text-[10px] text-gray-400 dark:text-gray-500 text-center pt-1">
                  Tip: Open the Google Maps app first for best results on mobile.
                </p>
              </div>
            </div>

            <!-- Turn-by-Turn -->
            <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 class="font-semibold text-gray-900 dark:text-white text-sm mb-3">Turn-by-Turn Stops</h3>
              <div id="rp-stop-list" class="divide-y divide-gray-100 dark:divide-gray-800 max-h-72 overflow-y-auto text-sm">
              </div>
            </div>
          </div>

          <!-- Load Saved Route -->
          <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 class="font-semibold text-gray-900 dark:text-white text-sm mb-3">Load Saved Route</h3>
            <div class="flex gap-2 mb-3">
              <input id="rp-load-id" type="text" placeholder="Route ID..." maxlength="50"
                class="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none">
              <button id="rp-load-route" class="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition">Load</button>
            </div>
            <!-- Saved Routes List -->
            <div id="rp-saved-list" class="space-y-2"></div>
          </div>
        </div>

        <!-- Right: Voter Selection List -->
        <div class="lg:col-span-2">
          <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div class="space-y-3 mb-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 class="font-semibold text-gray-900 dark:text-white text-sm">Geocoded Voters</h3>
                <input id="rp-search" type="text" placeholder="Search loaded voters..." maxlength="100"
                  class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs focus:ring-2 focus:ring-primary-500 outline-none w-44">
              </div>
              <!-- Filter controls — passed to API on load -->
              <div class="flex flex-wrap items-center gap-2">
                <select id="rp-filter-type" class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-xs focus:ring-2 focus:ring-primary-500 outline-none">
                  <option value="">All Voter Types</option>
                  <option value="super">Super Voters Only</option>
                  <option value="regular">Regular Voters</option>
                  <option value="never">Never Voted</option>
                </select>
                <select id="rp-filter-party" class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-xs focus:ring-2 focus:ring-primary-500 outline-none">
                  <option value="">All Parties</option>
                  <option value="R">Republican</option>
                  <option value="D">Democrat</option>
                  <option value="R,D">R + D</option>
                </select>
                <input id="rp-filter-precinct" type="text" placeholder="Precinct #" maxlength="3"
                  class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-xs focus:ring-2 focus:ring-primary-500 outline-none w-24">
                <button id="rp-apply-filters" class="bg-primary-600 hover:bg-primary-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition">
                  Load
                </button>
                <span id="rp-voter-count" class="text-xs text-gray-400 ml-auto"></span>
              </div>
            </div>
            <div id="rp-voter-list" class="max-h-[500px] overflow-y-auto">${spinner('Loading voters...')}</div>
          </div>
        </div>
      </div>
    `;
  }

  wireEvents() {
    // Use My Location
    const useLocBtn = this.container.querySelector('#rp-use-location');
    useLocBtn?.addEventListener('click', () => {
      if (!navigator.geolocation) {
        showToast('Geolocation not supported by your browser', 'error');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.setStartLocation(pos.coords.latitude, pos.coords.longitude);
          showToast('Start location set to your current position', 'success');
        },
        () => showToast('Unable to get your location', 'error')
      );
    });

    // Click on Map to set start
    const setOnMapBtn = this.container.querySelector('#rp-set-on-map');
    setOnMapBtn?.addEventListener('click', () => {
      if (!this.state.map.instance) {
        showToast('Map not loaded yet', 'error');
        return;
      }
      showToast('Click on the map to set start location', 'info');
      
      // Switch to map tab
      this.state.setActiveTab('map');
      
      // Set up map click listener
      const listener = this.state.map.instance.addListener('click', (e) => {
        this.setStartLocation(e.latLng.lat(), e.latLng.lng());
        google.maps.event.removeListener(listener);
        showToast('Start location set', 'success');
      });
      this.state.setMapClickListener(listener);
    });

    // Calculate Route
    this.container.querySelector('#rp-calculate')?.addEventListener('click', () => this.calculateRoute());

    // Select All / Clear Selection
    this.container.querySelector('#rp-select-all')?.addEventListener('click', () => {
      this.state.routing.voterDataCache.forEach(v => {
        this.state.routing.selectedVoterIds.add(v.id);
      });
      this.renderVoterCheckboxes();
      this.updateSelectionCount();
      this.state._notify('selectionChanged', Array.from(this.state.routing.selectedVoterIds));
    });

    this.container.querySelector('#rp-clear-selection')?.addEventListener('click', () => {
      this.state.clearVoterSelection();
      this.renderVoterCheckboxes();
      this.updateSelectionCount();
    });

    // Save / Print / Clear Route
    this.container.querySelector('#rp-save')?.addEventListener('click', () => this.saveCurrentRoute());
    this.container.querySelector('#rp-print')?.addEventListener('click', () => {
      const route = this.state.routing.currentRoute;
      if (!route?._savedId) {
        showToast('Save the route first to get a printable version', 'info');
        return;
      }
      window.open(`/api/routes/${route._savedId}/print`, '_blank');
    });
    this.container.querySelector('#rp-clear-route')?.addEventListener('click', () => {
      this.state.setCurrentRoute(null);
      this.container.querySelector('#rp-results')?.classList.add('hidden');
      showToast('Route cleared', 'info');
    });

    // Share Route Link
    this.container.querySelector('#rp-share-route')?.addEventListener('click', () => {
      this.shareRouteLink();
    });

    // Load saved route
    this.container.querySelector('#rp-load-route')?.addEventListener('click', () => {
      const id = this.container.querySelector('#rp-load-id')?.value?.trim();
      if (!id) {
        showToast('Enter a route ID', 'error');
        return;
      }
      this.loadSavedRoute(id);
    });

    // Search filter
    this.container.querySelector('#rp-search')?.addEventListener('input', () => this.renderVoterCheckboxes());

    // Apply filters and reload voter list
    this.container.querySelector('#rp-apply-filters')?.addEventListener('click', () => {
      this.state.clearVoterSelection();
      this.loadVoters();
      this.updateSelectionCount();
    });

    // Also reload on Enter key in precinct field
    this.container.querySelector('#rp-filter-precinct')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.state.clearVoterSelection();
        this.loadVoters();
        this.updateSelectionCount();
      }
    });

    // Voter list checkbox delegation
    this.container.querySelector('#rp-voter-list')?.addEventListener('change', (e) => {
      if (e.target.matches('.voter-cb')) {
        const vid = parseInt(e.target.dataset.vid);
        this.state.toggleVoterSelection(vid);
        this.updateSelectionCount();
      }
    });
  }

  setStartLocation(lat, lng) {
    this.state.setStartLocation({ lat, lng });
    
    // Create visual marker
    if (this.state.map.instance) {
      const marker = createStartMarker({ lat, lng }, this.state.map.instance);
      this.state.setStartMarker(marker);
    }

    // Update status text
    const statusEl = this.container.querySelector('#rp-start-status');
    if (statusEl) {
      statusEl.textContent = `Start: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }

    this.updateCalculateButton();
  }

  updateSelectionCount() {
    const el = this.container.querySelector('#rp-selection-count');
    if (el) {
      el.textContent = `${this.state.routing.selectedVoterIds.size} voters selected`;
    }
    this.updateCalculateButton();
  }

  updateCalculateButton() {
    const btn = this.container.querySelector('#rp-calculate');
    if (btn) {
      btn.disabled = this.state.routing.selectedVoterIds.size === 0 || !this.state.routing.startLocation;
    }
  }

  async loadVoters() {
    const listEl = this.container.querySelector('#rp-voter-list');
    if (!listEl) return;
    listEl.innerHTML = spinner('Loading voters...');

    try {
      const params = { geocoded: true, limit: VOTER_LOAD_LIMIT };

      // Read filter controls (if rendered)
      const typeFilter     = this.container.querySelector('#rp-filter-type')?.value;
      const partyFilter    = this.container.querySelector('#rp-filter-party')?.value;
      const precinctFilter = this.container.querySelector('#rp-filter-precinct')?.value?.trim();

      if (typeFilter === 'super')   params.super_voter = true;
      if (typeFilter === 'regular') params.super_voter = false;
      if (typeFilter === 'never')   params.voting_status = 'never';
      if (partyFilter)              params.party = partyFilter;
      if (precinctFilter)           params.precinct = precinctFilter;

      const res = await fetchVoters(params);
      const voters = (res.data || []).filter(v => v.latitude && v.longitude);
      this.state.setVoterDataCache(voters);
      this.renderVoterCheckboxes();
      this.updateVoterCount(voters.length);
    } catch (err) {
      console.error('Failed to load voters for route planning:', err);
      let message = 'Failed to load voter data';
      if (err.status >= 500) message = 'Server error - please try again';
      else if (!navigator.onLine) message = 'No internet connection';
      else if (err.message) message = err.message;
      listEl.innerHTML = errorBox(message);
      this.state.setError({ operation: 'loadVotersForRouting', error: err });
    }
  }

  updateVoterCount(count) {
    const el = this.container.querySelector('#rp-voter-count');
    if (el) el.textContent = count > 0 ? `${count} voter${count !== 1 ? 's' : ''} loaded` : 'No voters match';
  }

  renderVoterCheckboxes() {
    const listEl = this.container.querySelector('#rp-voter-list');
    if (!listEl) return;

    const search = (this.container.querySelector('#rp-search')?.value || '').toLowerCase();
    const voters = this.state.routing.voterDataCache.filter(v => {
      if (!search) return true;
      const full = `${v.firstName} ${v.lastName} ${v.address || ''} ${v.precinctNumber || ''}`.toLowerCase();
      return full.includes(search);
    });

    if (voters.length === 0) {
      listEl.innerHTML = emptyState('No geocoded voters found');
      return;
    }

    listEl.innerHTML = `
      <table class="min-w-full text-xs">
        <thead class="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 sticky top-0">
          <tr>
            <th class="px-2 py-2 text-left w-8"></th>
            <th class="px-2 py-2 text-left">Name</th>
            <th class="px-2 py-2 text-left">Address</th>
            <th class="px-2 py-2 text-left">Party</th>
            <th class="px-2 py-2 text-left">Precinct</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
          ${voters.map(v => `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
              <td class="px-2 py-1.5"><input type="checkbox" class="voter-cb rounded" data-vid="${v.id}" ${this.state.routing.selectedVoterIds.has(v.id) ? 'checked' : ''}></td>
              <td class="px-2 py-1.5 whitespace-nowrap">${escapeHtml(v.firstName)} ${escapeHtml(v.lastName)}${v.superVoter ? ' <span class="text-green-600">★</span>' : ''}</td>
              <td class="px-2 py-1.5 text-gray-500">${escapeHtml(v.address || '')}, ${escapeHtml(v.city || '')}</td>
              <td class="px-2 py-1.5 whitespace-nowrap"><span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${v.mostRecentParty === 'D' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' : v.mostRecentParty === 'R' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}">${escapeHtml(v.mostRecentParty === 'D' ? 'DEM' : v.mostRecentParty === 'R' ? 'REP' : v.mostRecentParty || '—')}</span></td>
              <td class="px-2 py-1.5 text-gray-500">${escapeHtml(v.precinctNumber || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  async calculateRoute() {
    if (this.state.routing.selectedVoterIds.size === 0 || !this.state.routing.startLocation) {
      showToast('Select voters and set a start location first', 'error');
      return;
    }

    const btn = this.container.querySelector('#rp-calculate');
    const prevText = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Calculating...';
    }

    try {
      const mode = this.container.querySelector('#rp-travel-mode')?.value || 'driving';
      const algorithm = this.container.querySelector('#rp-algorithm')?.value || 'hybrid';

      const res = await calcRoute({
        voterIds: Array.from(this.state.routing.selectedVoterIds),
        startLocation: this.state.routing.startLocation,
        mode,
        algorithm,
      });

      if (!res.success || !res.route) {
        throw new Error('Route calculation failed');
      }

      res.route._travelMode = mode;
      this.state.setCurrentRoute(res.route);
      this.displayRouteResults(res.route);
      showToast(`Route calculated: ${res.route.metrics?.stopCount || 0} stops`, 'success');
    } catch (err) {
      console.error('Failed to calculate route:', err);
      let message = 'Failed to calculate route';
      if (err.status === 400) message = 'Invalid route parameters - check start location and selected voters';
      else if (err.status >= 500) message = 'Route calculation failed - server error';
      else if (!navigator.onLine) message = 'Cannot calculate route - no internet connection';
      else if (err.message) message = err.message;
      showToast(message, 'error');
      this.state.setError({ operation: 'calculateRoute', error: err });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevText || 'Calculate Route';
      }
      this.updateCalculateButton();
    }
  }

  displayRouteResults(route) {
    const metrics = route.metrics || {};

    const distEl = this.container.querySelector('#rp-distance');
    const durEl = this.container.querySelector('#rp-duration');
    const stopsEl = this.container.querySelector('#rp-stops');
    const effEl = this.container.querySelector('#rp-efficiency');

    if (distEl) distEl.textContent = formatDistance(metrics.totalDistanceMiles);
    if (durEl) durEl.textContent = formatDuration(metrics.totalDurationMinutes);
    if (stopsEl) stopsEl.textContent = metrics.stopCount || 0;
    if (effEl) effEl.textContent = formatEfficiency(metrics.routeEfficiency);

    // Stop list
    const stopListEl = this.container.querySelector('#rp-stop-list');
    if (stopListEl) {
      stopListEl.innerHTML = createStopList(route.locations);
    }

    // Google Maps export
    this.updateGoogleMapsExport(route);

    // Show results panel
    this.container.querySelector('#rp-results')?.classList.remove('hidden');
  }

  updateGoogleMapsExport(route) {
    const exportEl = this.container.querySelector('#rp-gmaps-export');
    const singleBtn = this.container.querySelector('#rp-gmaps-single');
    const segmentsEl = this.container.querySelector('#rp-gmaps-segments');
    if (!exportEl) return;

    const startLocation = this.state.routing.startLocation;
    const locations = route.locations || [];
    const travelMode = route._travelMode || 'driving';

    if (locations.length === 0 || !startLocation) {
      exportEl.classList.add('hidden');
      return;
    }

    const segments = buildGoogleMapsUrls(locations, startLocation, travelMode);

    if (segments.length === 0) {
      exportEl.classList.add('hidden');
      return;
    }

    if (segments.length === 1) {
      singleBtn.href = segments[0].url;
      singleBtn.classList.remove('hidden');
      segmentsEl.innerHTML = '';
    } else {
      singleBtn.classList.add('hidden');
      segmentsEl.innerHTML = '';
      const frag = document.createDocumentFragment();
      segments.forEach(seg => {
        const a = document.createElement('a');
        a.href = seg.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'flex items-center justify-center gap-2 w-full bg-[#1a73e8] hover:bg-[#1557b0] text-white px-3 py-2 rounded-lg text-xs font-semibold transition';
        a.textContent = `📍 ${seg.label}`;
        frag.appendChild(a);
      });
      segmentsEl.appendChild(frag);
    }

    exportEl.dataset.mapsUrls = JSON.stringify(segments.map(s => s.url));
    exportEl.classList.remove('hidden');
  }

  async saveCurrentRoute() {
    const route = this.state.routing.currentRoute;
    if (!route) {
      showToast('No route to save', 'error');
      return;
    }

    const routeName = prompt('Enter a name for this route:', 'Canvassing Route');
    if (!routeName) return;

    try {
      const mode = route._travelMode || 'driving';
      const res = await saveRouteAPI({
        routeData: {
          locations: route.locations,
          metrics: route.metrics,
          startLocation: this.state.routing.startLocation,
        },
        options: { routeName, travelMode: mode },
      });

      if (res.success && res.routeId) {
        route._savedId = res.routeId;
        this.state.addSavedRoute({
          id: res.routeId,
          name: routeName,
          date: new Date().toISOString()
        });
        this.renderSavedRoutesList();
        showToast(`Route saved! ID: ${res.routeId}`, 'success');

        if (res.shareableUrl) {
          try {
            await navigator.clipboard.writeText(res.shareableUrl);
            showToast('Shareable URL copied to clipboard', 'info');
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      console.error('Failed to save route:', err);
      let message = 'Failed to save route';
      if (err.status === 401 || err.status === 403) message = 'Cannot save route - permission denied';
      else if (err.status >= 500) message = 'Server error - please try again';
      else if (err.message) message = err.message;
      showToast(message, 'error');
      this.state.setError({ operation: 'saveRoute', error: err });
    }
  }

  async loadSavedRoute(routeId) {
    try {
      showToast('Loading route...', 'info');
      const res = await fetchRoute(routeId);
      if (!res.success || !res.route) {
        throw new Error('Route not found');
      }

      const rd = res.route.routeData || res.route;
      const route = {
        locations: rd.locations || [],
        metrics: rd.metrics || {},
        _savedId: routeId,
        _travelMode: res.route.travelMode || 'driving',
      };

      if (rd.startLocation) {
        this.setStartLocation(rd.startLocation.lat, rd.startLocation.lng);
      }

      this.state.setCurrentRoute(route);
      this.displayRouteResults(route);
      this.state.setActiveTab('map'); // Switch to map to see route
      showToast(`Route "${res.route.routeName || routeId}" loaded`, 'success');
    } catch (err) {
      console.error('Failed to load saved route:', err);
      let message = 'Failed to load route';
      if (err.status === 404) message = 'Route not found - it may have been deleted';
      else if (err.status === 401 || err.status === 403) message = 'Cannot access route - permission denied';
      else if (err.status >= 500) message = 'Server error - please try again';
      else if (err.message) message = err.message;
      showToast(message, 'error');
      this.state.setError({ operation: 'loadRoute', error: err });
    }
  }

  renderSavedRoutesList() {
    const listEl = this.container.querySelector('#rp-saved-list');
    if (!listEl) return;

    const routes = this.state.routing.savedRoutes;
    if (routes.length === 0) {
      listEl.innerHTML = '<p class="text-xs text-gray-400 text-center py-2">No saved routes</p>';
      return;
    }

    listEl.innerHTML = routes.map(r => `
      <div class="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-lg p-2 text-xs">
        <div class="min-w-0">
          <p class="font-medium text-gray-900 dark:text-white truncate">${escapeHtml(r.name || r.id)}</p>
          <p class="text-gray-500">${r.date ? new Date(r.date).toLocaleDateString() : ''}</p>
        </div>
        <div class="flex gap-1 flex-shrink-0">
          <button class="text-blue-500 hover:text-blue-700 font-medium" data-action="load" data-rid="${escapeHtml(r.id)}">Load</button>
          <button class="text-red-500 hover:text-red-700 font-medium" data-action="delete" data-rid="${escapeHtml(r.id)}">Delete</button>
        </div>
      </div>
    `).join('');

    // Event delegation for saved routes
    listEl.onclick = async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      
      const rid = btn.dataset.rid;
      if (btn.dataset.action === 'load') {
        this.loadSavedRoute(rid);
      } else if (btn.dataset.action === 'delete') {
        if (confirm('Delete this saved route?')) {
          try {
            await deleteRoute(rid);
            this.state.removeSavedRoute(rid);
            this.renderSavedRoutesList();
            showToast('Route deleted', 'success');
          } catch (err) {
            console.error('Failed to delete route:', err);
            let message = 'Failed to delete route';
            if (err.status === 404) message = 'Route not found - may already be deleted';
            else if (err.status === 401 || err.status === 403) message = 'Cannot delete route - permission denied';
            else if (err.message) message = err.message;
            showToast(message, 'error');
          }
        }
      }
    };
  }

  shareRouteLink() {
    const exportEl = this.container.querySelector('#rp-gmaps-export');
    const urlsJson = exportEl?.dataset.mapsUrls;
    if (!urlsJson) return;

    let urls;
    try {
      urls = JSON.parse(urlsJson);
    } catch {
      return;
    }

    const primaryUrl = urls[0];
    const shareData = {
      title: 'Voter Canvassing Route',
      text: urls.length > 1
        ? `Voter route (${urls.length} segments). Tap the link for segment 1.`
        : 'Open your voter canvassing route in Google Maps.',
      url: primaryUrl
    };

    if (navigator.share) {
      navigator.share(shareData)
        .catch(err => {
          if (err.name !== 'AbortError') {
            this.fallbackCopyToClipboard(primaryUrl);
          }
        });
    } else {
      this.fallbackCopyToClipboard(primaryUrl);
    }
  }

  fallbackCopyToClipboard(url) {
    navigator.clipboard.writeText(url)
      .then(() => showToast('Google Maps link copied to clipboard', 'success'))
      .catch(() => showToast('Could not copy link — please copy manually', 'error'));
  }

  cleanup() {
    // Remove map click listener if active
    if (this.state.map.mapClickListener) {
      google.maps.event.removeListener(this.state.map.mapClickListener);
      this.state.setMapClickListener(null);
    }
  }
}
