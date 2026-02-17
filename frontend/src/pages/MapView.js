/**
 * Enhanced Map page - Google Maps voter visualization with
 * Route Planning, Geocoding Management, and Saved Routes
 */
import {
  fetchConfig, fetchVoters, fetchPrecincts,
  calcRoute, saveRoute, fetchRoute, deleteRoute,
  fetchQuotaStatus,
  startBatchGeocode, fetchGeoJob, fetchGeoStats,
  fetchGeoReview, retryGeoJob, fetchGeoFailed
} from '../api/client.js';
import {
  sectionHeading, spinner, errorBox, fmt, pct, escapeHtml, statCard, emptyState
} from '../components/ui.js';
import { showToast } from '../main.js';

/* ── Module-level state ──────────────────────────────────────── */

let map = null;
let markers = [];
let routeMarkers = [];
let routePath = null;
let infoWindow = null;
let selectedVoterIds = new Set();
let currentRoute = null;
let geocodingJobId = null;
let geocodingPollTimer = null;
let activeTab = 'map';
let startMarker = null;
let startLocation = null;
let voterDataCache = [];   // cached voter list for route planner
let savedRouteIds = [];    // from localStorage
let mapClickListener = null; // for "click on map" start location

/* ── Constants ───────────────────────────────────────────────── */

const GEOCODE_POLL_MS = 3000;
const VOTER_LOAD_LIMIT = 500;

/* ── Main render ─────────────────────────────────────────────── */

export async function renderMap(container) {
  savedRouteIds = JSON.parse(localStorage.getItem('voter_saved_routes') || '[]');

  container.innerHTML = `
    ${sectionHeading('Voter Map', 'Map visualization, route planning & geocoding management')}

    <!-- Tabs -->
    <div class="flex border-b border-gray-200 dark:border-gray-700 mb-4" id="map-tabs">
      <button data-tab="map" class="tab-btn px-5 py-2.5 text-sm font-medium border-b-2 border-primary-600 text-primary-600 dark:text-primary-400 transition">
        Map
      </button>
      <button data-tab="route" class="tab-btn px-5 py-2.5 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 transition">
        Route Planner
      </button>
      <button data-tab="geocoding" class="tab-btn px-5 py-2.5 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 transition">
        Geocoding
      </button>
    </div>

    <!-- Tab: Map -->
    <div id="tab-map" class="tab-panel">
      ${renderMapTabHTML()}
    </div>

    <!-- Tab: Route Planner -->
    <div id="tab-route" class="tab-panel hidden">
      ${renderRouteTabHTML()}
    </div>

    <!-- Tab: Geocoding -->
    <div id="tab-geocoding" class="tab-panel hidden">
      ${renderGeocodingTabHTML()}
    </div>
  `;

  // Wire tab switching
  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(container, btn.dataset.tab));
  });

  // ── Map Tab Setup ──
  try {
    const precincts = await fetchPrecincts();
    const select = container.querySelector('#map-precinct');
    const rpSelect = container.querySelector('#rp-precinct-filter');
    const list = Array.isArray(precincts) ? precincts : precincts.data || [];
    list.forEach(p => {
      const val = p.precinct_number || p.number || '';
      const label = `Precinct ${val} (${fmt(p.voter_count || p.count || 0)})`;
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      select.appendChild(opt);
      if (rpSelect) {
        const opt2 = document.createElement('option');
        opt2.value = val;
        opt2.textContent = label;
        rpSelect.appendChild(opt2);
      }
    });
  } catch { /* ignore */ }

  try {
    const config = await fetchConfig();
    if (!config.googleMapsApiKey) {
      container.querySelector('#map-canvas').innerHTML = `
        <div class="text-center text-gray-500">
          <p class="font-medium">Google Maps API key not configured</p>
          <p class="text-sm mt-1">Set GOOGLE_MAPS_API_KEY in your .env file</p>
        </div>`;
      return;
    }

    await loadGoogleMapsScript(config.googleMapsApiKey);

    const mapCenter = config.mapCenter || { lat: 36.2639, lng: -89.1929 };
    const mapZoom = config.mapZoom || 11;

    map = new google.maps.Map(container.querySelector('#map-canvas'), {
      center: mapCenter,
      zoom: mapZoom,
      mapTypeControl: true,
      streetViewControl: false,
      styles: document.documentElement.classList.contains('dark') ? darkMapStyle : [],
    });

    infoWindow = new google.maps.InfoWindow();

    // Wire map tab controls
    container.querySelector('#map-reload').addEventListener('click', () => loadMapVoters(container));

    // Initial load
    loadMapVoters(container);
  } catch (err) {
    container.querySelector('#map-canvas').innerHTML = `
      <div class="text-center text-red-500 p-4">
        <p class="font-medium">Failed to load map</p>
        <p class="text-sm mt-1">${escapeHtml(err.message)}</p>
      </div>`;
  }

  // ── Route Planner Tab Setup ──
  wireRoutePlannerEvents(container);

  // ── Geocoding Tab Setup ──
  wireGeocodingEvents(container);

  // ── Cleanup on page leave ──
  return () => {
    clearMarkers();
    clearRouteVisuals();
    stopGeocodingPoll();
    if (mapClickListener) { google.maps.event.removeListener(mapClickListener); mapClickListener = null; }
    if (startMarker) { startMarker.setMap(null); startMarker = null; }
    startLocation = null;
    selectedVoterIds.clear();
    currentRoute = null;
    voterDataCache = [];
    infoWindow = null;
    activeTab = 'map';
    map = null;
  };
}

/* ── Tab switching ───────────────────────────────────────────── */

function switchTab(container, tab) {
  activeTab = tab;
  container.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('border-primary-600', isActive);
    btn.classList.toggle('text-primary-600', isActive);
    btn.classList.toggle('dark:text-primary-400', isActive);
    btn.classList.toggle('border-transparent', !isActive);
    btn.classList.toggle('text-gray-500', !isActive);
  });
  container.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  const panel = container.querySelector(`#tab-${tab}`);
  if (panel) panel.classList.remove('hidden');

  // Lazy-load tab data
  if (tab === 'route') loadRoutePlannerVoters(container);
  if (tab === 'geocoding') loadGeocodingStats(container);
}

/* ════════════════════════════════════════════════════════════════
   MAP TAB
   ════════════════════════════════════════════════════════════════ */

function renderMapTabHTML() {
  return `
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

async function loadMapVoters(container) {
  if (!map) return;

  const precinct = container.querySelector('#map-precinct')?.value;
  const filter = container.querySelector('#map-filter')?.value;
  const countEl = container.querySelector('#map-count');

  clearMarkers();
  if (countEl) countEl.textContent = 'Loading...';

  try {
    const params = { limit: 1000, geocoded: true };
    if (precinct) params.precinct = precinct;
    if (filter === 'super') params.super_voter = true;
    if (filter === 'regular') params.super_voter = false;

    const res = await fetchVoters(params);
    const voters = res.data || [];

    let plotted = 0;
    voters.forEach(v => {
      if (!v.latitude || !v.longitude) return;

      const isSelected = selectedVoterIds.has(v.id);
      const marker = new google.maps.Marker({
        position: { lat: parseFloat(v.latitude), lng: parseFloat(v.longitude) },
        map,
        icon: isSelected ? selectedMarkerIcon() : voterMarkerIcon(v.superVoter),
        title: `${v.firstName} ${v.lastName}`,
      });
      marker._voterId = v.id;
      marker._voterData = v;

      marker.addListener('click', () => {
        const inRoute = selectedVoterIds.has(v.id);
        infoWindow.setContent(`
          <div style="font-family: system-ui; font-size: 13px; max-width: 240px;">
            <strong>${escapeHtml(v.firstName)} ${escapeHtml(v.lastName)}</strong><br>
            ${escapeHtml(v.address || '')}<br>
            ${escapeHtml(v.city || '')} ${escapeHtml(v.zipCode || '')}<br>
            <span style="color: ${v.superVoter ? 'green' : 'gray'}">
              ${v.superVoter ? '★ Super Voter' : 'Regular Voter'}
            </span><br>
            Precinct: ${escapeHtml(v.precinctNumber || '')}<br>
            <button onclick="document.dispatchEvent(new CustomEvent('toggle-route-voter', {detail:{id:${v.id}}}))"
              style="margin-top:6px;padding:3px 10px;font-size:12px;border-radius:4px;cursor:pointer;
              background:${inRoute ? '#ef4444' : '#3b82f6'};color:#fff;border:none;">
              ${inRoute ? 'Remove from Route' : 'Add to Route'}
            </button>
          </div>
        `);
        infoWindow.open(map, marker);
      });

      markers.push(marker);
      plotted++;
    });

    if (countEl) countEl.textContent = `${fmt(plotted)} voters plotted`;

    if (plotted > 0) {
      const bounds = new google.maps.LatLngBounds();
      markers.forEach(m => bounds.extend(m.getPosition()));
      map.fitBounds(bounds);
    }
  } catch (err) {
    if (countEl) countEl.textContent = 'Error loading voters';
    showToast('Map error: ' + err.message, 'error');
  }
}

// Listen for "Add to Route" / "Remove from Route" from InfoWindow buttons
document.addEventListener('toggle-route-voter', (e) => {
  if (!map) return;
  const id = e.detail.id;
  if (selectedVoterIds.has(id)) {
    selectedVoterIds.delete(id);
  } else {
    selectedVoterIds.add(id);
  }
  // Update marker icon
  const m = markers.find(mk => mk._voterId === id);
  if (m) {
    const v = m._voterData;
    m.setIcon(selectedVoterIds.has(id) ? selectedMarkerIcon() : voterMarkerIcon(v?.superVoter));
  }
  if (infoWindow) infoWindow.close();
  // Update route planner count if visible
  updateSelectionCount();
});

/* ════════════════════════════════════════════════════════════════
   ROUTE PLANNER TAB
   ════════════════════════════════════════════════════════════════ */

function renderRouteTabHTML() {
  return `
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <!-- Left: Configuration -->
      <div class="lg:col-span-1 space-y-4">
        <!-- Start Location -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h3 class="font-semibold text-gray-900 dark:text-white text-sm mb-3">Start Location</h3>
          <input id="rp-start-address" type="text" placeholder="Enter start address..."
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
          <div class="flex gap-2">
            <input id="rp-load-id" type="text" placeholder="Route ID..."
              class="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none">
            <button id="rp-load-route" class="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition">Load</button>
          </div>
          <!-- Saved Routes List -->
          <div id="rp-saved-list" class="mt-3 space-y-2"></div>
        </div>
      </div>

      <!-- Right: Voter Selection List -->
      <div class="lg:col-span-2">
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h3 class="font-semibold text-gray-900 dark:text-white text-sm">Geocoded Voters</h3>
            <input id="rp-search" type="text" placeholder="Search voters..."
              class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs focus:ring-2 focus:ring-primary-500 outline-none w-40">
          </div>
          <div class="flex flex-wrap items-center gap-2 mb-3">
            <select id="rp-precinct-filter" class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs focus:ring-2 focus:ring-primary-500 outline-none">
              <option value="">All Precincts</option>
            </select>
            <select id="rp-party-filter" class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs focus:ring-2 focus:ring-primary-500 outline-none">
              <option value="">All Parties</option>
              <option value="D">Democrat</option>
              <option value="R">Republican</option>
            </select>
            <select id="rp-super-voter-filter" class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs focus:ring-2 focus:ring-primary-500 outline-none">
              <option value="">All Voters</option>
              <option value="true">Super Voters ★</option>
              <option value="false">Regular Voters</option>
            </select>
            <select id="rp-voting-status-filter" class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs focus:ring-2 focus:ring-primary-500 outline-none">
              <option value="">Any Voting History</option>
              <option value="regular">Has Voted</option>
              <option value="never">Never Voted</option>
            </select>
            <button id="rp-apply-filters" class="bg-primary-600 hover:bg-primary-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition">
              Apply Filters
            </button>
          </div>
          <div id="rp-voter-list" class="max-h-[500px] overflow-y-auto">
            ${spinner('Loading voters...')}
          </div>
        </div>
      </div>
    </div>
  `;
}

function wireRoutePlannerEvents(container) {
  // Use My Location
  container.querySelector('#rp-use-location')?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showToast('Geolocation not supported by your browser', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStartLocation(container, pos.coords.latitude, pos.coords.longitude);
        showToast('Start location set to your current position', 'success');
      },
      () => showToast('Unable to get your location', 'error')
    );
  });

  // Click on Map to set start
  container.querySelector('#rp-set-on-map')?.addEventListener('click', () => {
    if (!map) {
      showToast('Map not loaded yet', 'error');
      return;
    }
    showToast('Click on the map to set start location', 'info');
    // Switch to map tab to allow clicking
    switchTab(container, 'map');
    // Remove previous listener if any
    if (mapClickListener) google.maps.event.removeListener(mapClickListener);
    mapClickListener = map.addListener('click', (e) => {
      setStartLocation(container, e.latLng.lat(), e.latLng.lng());
      google.maps.event.removeListener(mapClickListener);
      mapClickListener = null;
      showToast('Start location set', 'success');
    });
  });

  // Calculate Route
  container.querySelector('#rp-calculate')?.addEventListener('click', () => calculateRoute(container));

  // Select All
  container.querySelector('#rp-select-all')?.addEventListener('click', () => {
    voterDataCache.forEach(v => selectedVoterIds.add(v.id));
    renderVoterCheckboxes(container);
    updateSelectionCount(container);
    updateMarkerStyles();
  });

  // Clear Selection
  container.querySelector('#rp-clear-selection')?.addEventListener('click', () => {
    selectedVoterIds.clear();
    renderVoterCheckboxes(container);
    updateSelectionCount(container);
    updateMarkerStyles();
  });

  // Save Route
  container.querySelector('#rp-save')?.addEventListener('click', () => saveCurrentRoute(container));

  // Print Route
  container.querySelector('#rp-print')?.addEventListener('click', () => {
    if (!currentRoute?._savedId) {
      showToast('Save the route first to get a printable version', 'info');
      return;
    }
    window.open(`/api/routes/${currentRoute._savedId}/print`, '_blank');
  });

  // Clear Route
  container.querySelector('#rp-clear-route')?.addEventListener('click', () => {
    clearRouteVisuals();
    currentRoute = null;
    container.querySelector('#rp-results')?.classList.add('hidden');
    container.querySelector('#route-overlay')?.classList.add('hidden');
    showToast('Route cleared', 'info');
  });

  // Overlay clear
  container.querySelector('#overlay-clear')?.addEventListener('click', () => {
    clearRouteVisuals();
    currentRoute = null;
    container.querySelector('#rp-results')?.classList.add('hidden');
    container.querySelector('#route-overlay')?.classList.add('hidden');
  });

  // Load saved route by ID
  container.querySelector('#rp-load-route')?.addEventListener('click', () => {
    const id = container.querySelector('#rp-load-id')?.value?.trim();
    if (!id) { showToast('Enter a route ID', 'error'); return; }
    loadSavedRoute(container, id);
  });

  // Voter search filter
  container.querySelector('#rp-search')?.addEventListener('input', () => {
    renderVoterCheckboxes(container);
  });
  container.querySelector('#rp-precinct-filter')?.addEventListener('change', () => {
    loadRoutePlannerVoters(container);
  });
  container.querySelector('#rp-party-filter')?.addEventListener('change', () => {
    loadRoutePlannerVoters(container);
  });
  container.querySelector('#rp-super-voter-filter')?.addEventListener('change', () => {
    loadRoutePlannerVoters(container);
  });
  container.querySelector('#rp-voting-status-filter')?.addEventListener('change', () => {
    loadRoutePlannerVoters(container);
  });
  container.querySelector('#rp-apply-filters')?.addEventListener('click', () => {
    loadRoutePlannerVoters(container);
  });

  // Voter list event delegation (checkboxes)
  container.querySelector('#rp-voter-list')?.addEventListener('change', (e) => {
    if (e.target.matches('.voter-cb')) {
      const vid = parseInt(e.target.dataset.vid);
      if (e.target.checked) selectedVoterIds.add(vid);
      else selectedVoterIds.delete(vid);
      updateSelectionCount(container);
      updateMarkerStyles();
    }
  });

  // Render saved routes list
  renderSavedRoutesList(container);
}

function setStartLocation(container, lat, lng) {
  startLocation = { lat, lng };
  if (map) {
    if (startMarker) startMarker.setMap(null);
    startMarker = new google.maps.Marker({
      position: startLocation,
      map,
      icon: {
        path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
        scale: 8,
        fillColor: '#22c55e',
        fillOpacity: 1.0,
        strokeColor: '#fff',
        strokeWeight: 2,
      },
      title: 'Start Location',
      zIndex: 2000,
    });
  }
  const statusEl = container.querySelector('#rp-start-status');
  if (statusEl) statusEl.textContent = `Start: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  updateCalculateButton(container);
}

function updateSelectionCount(container) {
  const el = container?.querySelector('#rp-selection-count') || document.querySelector('#rp-selection-count');
  if (el) el.textContent = `${selectedVoterIds.size} voters selected`;
  updateCalculateButton(container);
}

function updateCalculateButton(container) {
  const btn = container?.querySelector('#rp-calculate') || document.querySelector('#rp-calculate');
  if (btn) btn.disabled = selectedVoterIds.size === 0 || !startLocation;
}

async function loadRoutePlannerVoters(container) {
  const listEl = container.querySelector('#rp-voter-list');
  if (!listEl) return;
  listEl.innerHTML = spinner('Loading voters...');

  try {
    const precinct = container.querySelector('#rp-precinct-filter')?.value;
    const party = container.querySelector('#rp-party-filter')?.value;
    const superVoter = container.querySelector('#rp-super-voter-filter')?.value;
    const votingStatus = container.querySelector('#rp-voting-status-filter')?.value;
    const params = { geocoded: true, limit: VOTER_LOAD_LIMIT };
    if (precinct) params.precinct = precinct;
    if (party) params.party = party;
    if (superVoter) params.super_voter = superVoter;
    if (votingStatus) params.voting_status = votingStatus;
    const res = await fetchVoters(params);
    voterDataCache = (res.data || []).filter(v => v.latitude && v.longitude);
    renderVoterCheckboxes(container);
  } catch (err) {
    listEl.innerHTML = errorBox('Failed to load voters: ' + err.message);
  }
}

function renderVoterCheckboxes(container) {
  const listEl = container.querySelector('#rp-voter-list');
  if (!listEl) return;
  const search = (container.querySelector('#rp-search')?.value || '').toLowerCase();
  const filtered = voterDataCache.filter(v => {
    if (!search) return true;
    const full = `${v.firstName} ${v.lastName} ${v.address || ''} ${v.precinctNumber || ''}`.toLowerCase();
    return full.includes(search);
  });

  if (filtered.length === 0) {
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
        ${filtered.map(v => `
          <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
            <td class="px-2 py-1.5"><input type="checkbox" class="voter-cb rounded" data-vid="${v.id}" ${selectedVoterIds.has(v.id) ? 'checked' : ''}></td>
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

async function calculateRoute(container) {
  if (selectedVoterIds.size === 0 || !startLocation) {
    showToast('Select voters and set a start location first', 'error');
    return;
  }

  const calcBtn = container.querySelector('#rp-calculate');
  const prevText = calcBtn?.textContent;
  if (calcBtn) { calcBtn.disabled = true; calcBtn.textContent = 'Calculating...'; }

  try {
    const mode = container.querySelector('#rp-travel-mode')?.value || 'driving';
    const algorithm = container.querySelector('#rp-algorithm')?.value || 'hybrid';

    const res = await calcRoute({
      voterIds: [...selectedVoterIds],
      startLocation,
      mode,
      algorithm,
    });

    if (!res.success || !res.route) throw new Error('Route calculation failed');

    currentRoute = res.route;
    currentRoute._travelMode = mode;
    displayRouteResults(container, res);
    drawRouteOnMap(res.route);
    showToast(`Route calculated: ${res.route.metrics?.stopCount || 0} stops`, 'success');
  } catch (err) {
    showToast('Route error: ' + err.message, 'error');
  } finally {
    if (calcBtn) { calcBtn.disabled = false; calcBtn.textContent = prevText || 'Calculate Route'; }
    updateCalculateButton(container);
  }
}

function displayRouteResults(container, res) {
  const m = res.route.metrics || {};
  const distEl = container.querySelector('#rp-distance');
  const durEl = container.querySelector('#rp-duration');
  const stopsEl = container.querySelector('#rp-stops');
  const effEl = container.querySelector('#rp-efficiency');
  if (distEl) distEl.textContent = `${(m.totalDistanceMiles || 0).toFixed(1)} mi`;
  if (durEl) durEl.textContent = `${m.totalDurationMinutes || 0} min`;
  if (stopsEl) stopsEl.textContent = m.stopCount || 0;
  if (effEl) effEl.textContent = pct((m.routeEfficiency || 0) * 100);

  // Stop list
  const stopListEl = container.querySelector('#rp-stop-list');
  if (stopListEl && res.route.locations) {
    stopListEl.innerHTML = res.route.locations.map((loc, i) => `
      <div class="flex items-center gap-3 py-2 px-1">
        <span class="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">${i + 1}</span>
        <div class="min-w-0">
          <p class="font-medium text-gray-900 dark:text-white truncate">${escapeHtml(loc.firstName || '')} ${escapeHtml(loc.lastName || '')}</p>
          <p class="text-xs text-gray-500 truncate">${escapeHtml(loc.address || '')}</p>
        </div>
      </div>
    `).join('');
  }

  container.querySelector('#rp-results')?.classList.remove('hidden');

  // Route overlay on map tab
  const overlay = container.querySelector('#route-overlay') || document.querySelector('#route-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    const od = overlay.querySelector('#overlay-distance');
    const ot = overlay.querySelector('#overlay-duration');
    const os = overlay.querySelector('#overlay-stops');
    if (od) od.textContent = `${(m.totalDistanceMiles || 0).toFixed(1)} mi`;
    if (ot) ot.textContent = `${m.totalDurationMinutes || 0} min`;
    if (os) os.textContent = m.stopCount || 0;
  }
}

function drawRouteOnMap(route) {
  clearRouteVisuals();
  if (!map || !route?.locations?.length) return;

  const locs = route.locations;
  const pathCoords = [];

  // Include start if available
  if (startLocation) pathCoords.push(startLocation);

  locs.forEach((loc, i) => {
    const pos = { lat: parseFloat(loc.lat), lng: parseFloat(loc.lng) };
    pathCoords.push(pos);

    // Numbered stop marker
    const stopMarker = new google.maps.Marker({
      position: pos,
      map,
      label: {
        text: String(i + 1),
        color: '#fff',
        fontSize: '11px',
        fontWeight: 'bold',
      },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 14,
        fillColor: '#3b82f6',
        fillOpacity: 1.0,
        strokeColor: '#1d4ed8',
        strokeWeight: 2,
      },
      zIndex: 1000 + i,
      title: `Stop ${i + 1}: ${loc.firstName || ''} ${loc.lastName || ''}`,
    });

    stopMarker.addListener('click', () => {
      infoWindow.setContent(`
        <div style="font-family: system-ui; font-size: 13px; max-width: 220px;">
          <strong>Stop ${i + 1}</strong><br>
          <strong>${escapeHtml(loc.firstName || '')} ${escapeHtml(loc.lastName || '')}</strong><br>
          ${escapeHtml(loc.address || '')}
        </div>
      `);
      infoWindow.open(map, stopMarker);
    });

    routeMarkers.push(stopMarker);
  });

  // Polyline
  routePath = new google.maps.Polyline({
    path: pathCoords,
    geodesic: true,
    strokeColor: '#3b82f6',
    strokeOpacity: 0.8,
    strokeWeight: 4,
    map,
  });

  // Fit bounds to route
  const bounds = new google.maps.LatLngBounds();
  pathCoords.forEach(p => bounds.extend(p));
  map.fitBounds(bounds);
}

function clearRouteVisuals() {
  routeMarkers.forEach(m => m.setMap(null));
  routeMarkers = [];
  if (routePath) { routePath.setMap(null); routePath = null; }
}

function updateMarkerStyles() {
  markers.forEach(m => {
    const v = m._voterData;
    if (!v) return;
    m.setIcon(selectedVoterIds.has(v.id) ? selectedMarkerIcon() : voterMarkerIcon(v.superVoter));
  });
}

async function saveCurrentRoute(container) {
  if (!currentRoute) { showToast('No route to save', 'error'); return; }

  const routeName = prompt('Enter a name for this route:', 'Canvassing Route');
  if (!routeName) return;

  try {
    const mode = currentRoute._travelMode || 'driving';
    const res = await saveRoute({
      routeData: {
        locations: currentRoute.locations,
        metrics: currentRoute.metrics,
        startLocation,
      },
      options: { routeName, travelMode: mode },
    });

    if (res.success && res.routeId) {
      currentRoute._savedId = res.routeId;
      // Store in localStorage
      savedRouteIds.push({ id: res.routeId, name: routeName, date: new Date().toISOString() });
      localStorage.setItem('voter_saved_routes', JSON.stringify(savedRouteIds));

      showToast(`Route saved! ID: ${res.routeId}`, 'success');
      if (res.shareableUrl) {
        try { await navigator.clipboard.writeText(res.shareableUrl); showToast('Shareable URL copied to clipboard', 'info'); } catch { /* ignore */ }
      }
      renderSavedRoutesList(container);
    }
  } catch (err) {
    showToast('Failed to save route: ' + err.message, 'error');
  }
}

async function loadSavedRoute(container, routeId) {
  try {
    showToast('Loading route...', 'info');
    const res = await fetchRoute(routeId);
    if (!res.success || !res.route) throw new Error('Route not found');

    const rd = res.route.routeData || res.route;
    currentRoute = {
      locations: rd.locations || [],
      metrics: rd.metrics || {},
      _savedId: routeId,
      _travelMode: res.route.travelMode || 'driving',
    };

    if (rd.startLocation) {
      setStartLocation(container, rd.startLocation.lat, rd.startLocation.lng);
    }

    displayRouteResults(container, { route: currentRoute });
    drawRouteOnMap(currentRoute);
    switchTab(container, 'map');
    showToast(`Route "${res.route.routeName || routeId}" loaded`, 'success');
  } catch (err) {
    showToast('Failed to load route: ' + err.message, 'error');
  }
}

function renderSavedRoutesList(container) {
  const listEl = container.querySelector('#rp-saved-list');
  if (!listEl) return;
  if (savedRouteIds.length === 0) {
    listEl.innerHTML = '<p class="text-xs text-gray-400 text-center py-2">No saved routes</p>';
    return;
  }
  listEl.innerHTML = savedRouteIds.map(r => `
    <div class="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-lg p-2 text-xs">
      <div class="min-w-0">
        <p class="font-medium text-gray-900 dark:text-white truncate">${escapeHtml(r.name || r.id)}</p>
        <p class="text-gray-500">${r.date ? new Date(r.date).toLocaleDateString() : ''}</p>
      </div>
      <div class="flex gap-1 flex-shrink-0">
        <button class="text-blue-500 hover:text-blue-700 font-medium saved-action" data-action="load-saved" data-rid="${escapeHtml(r.id)}">Load</button>
        <button class="text-red-500 hover:text-red-700 font-medium saved-action" data-action="delete-saved" data-rid="${escapeHtml(r.id)}">Delete</button>
      </div>
    </div>
  `).join('');

  // Use event delegation on the list container
  listEl.onclick = (e) => {
    const btn = e.target.closest('.saved-action');
    if (!btn) return;
    const rid = btn.dataset.rid;
    if (btn.dataset.action === 'load-saved') loadSavedRoute(container, rid);
    if (btn.dataset.action === 'delete-saved') deleteSavedRoute(container, rid);
  };
}

async function deleteSavedRoute(container, routeId) {
  if (!confirm('Delete this saved route?')) return;
  try {
    await deleteRoute(routeId);
    savedRouteIds = savedRouteIds.filter(r => r.id !== routeId);
    localStorage.setItem('voter_saved_routes', JSON.stringify(savedRouteIds));
    renderSavedRoutesList(container);
    showToast('Route deleted', 'success');
  } catch (err) {
    showToast('Failed to delete route: ' + err.message, 'error');
  }
}

/* ════════════════════════════════════════════════════════════════
   GEOCODING TAB
   ════════════════════════════════════════════════════════════════ */

function renderGeocodingTabHTML() {
  return `
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <!-- Left: Stats & Actions -->
      <div class="lg:col-span-1 space-y-4">
        <!-- Stats Dashboard -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h3 class="font-semibold text-gray-900 dark:text-white text-sm mb-3">Geocoding Stats</h3>
          <div id="geo-stats-content">
            ${spinner('Loading stats...')}
          </div>
        </div>

        <!-- Actions -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2">
          <h3 class="font-semibold text-gray-900 dark:text-white text-sm mb-3">Actions</h3>
          <button id="geo-batch-all" class="w-full bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition">
            📍 Geocode All Pending
          </button>
          <button id="geo-refresh" class="w-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2.5 rounded-lg text-sm font-medium transition hover:bg-gray-300 dark:hover:bg-gray-600">
            🔄 Refresh Stats
          </button>
        </div>

        <!-- Job Progress -->
        <div id="geo-job-panel" class="hidden bg-white dark:bg-gray-900 rounded-xl border border-blue-300 dark:border-blue-700 p-4">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-semibold text-blue-700 dark:text-blue-300 text-sm">Job Progress</h3>
            <span id="geo-job-status" class="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">--</span>
          </div>
          <p class="text-xs text-gray-500 mb-2">Job #<span id="geo-job-id">--</span></p>
          <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 mb-2">
            <div id="geo-job-bar" class="bg-blue-500 h-3 rounded-full transition-all duration-300" style="width: 0%"></div>
          </div>
          <div class="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-400">
            <span>Processed: <strong id="geo-job-processed">0</strong>/<strong id="geo-job-total">0</strong></span>
            <span>Failed: <strong id="geo-job-failed" class="text-red-500">0</strong></span>
            <span>Cache hits: <strong id="geo-job-cache">0</strong></span>
            <span>API calls: <strong id="geo-job-api">0</strong></span>
          </div>
          <div id="geo-job-actions" class="hidden mt-3 space-y-2">
            <button id="geo-retry-failed" class="w-full bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg text-xs font-medium transition">
              🔁 Retry Failed Addresses
            </button>
            <button id="geo-show-failed" class="w-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-3 py-2 rounded-lg text-xs font-medium transition hover:bg-gray-300 dark:hover:bg-gray-600">
              📋 Show Failed Addresses
            </button>
          </div>
          <div id="geo-failed-list" class="hidden mt-3 max-h-48 overflow-y-auto text-xs"></div>
        </div>

        <!-- Quota Status -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h3 class="font-semibold text-gray-900 dark:text-white text-sm mb-3">API Quota Status</h3>
          <div id="geo-quota-content">
            ${spinner('Loading quota...')}
          </div>
        </div>

        <!-- Recent Jobs Summary -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h3 class="font-semibold text-gray-900 dark:text-white text-sm mb-3">Recent Jobs</h3>
          <p class="text-[10px] text-gray-400 mb-2">Click a job to view details and failed addresses</p>
          <div id="geo-recent-jobs">
            <p class="text-xs text-gray-400 text-center py-2">No recent jobs</p>
          </div>
        </div>
      </div>

      <!-- Right: Low Quality Review -->
      <div class="lg:col-span-2">
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold text-gray-900 dark:text-white text-sm">Low Quality Addresses</h3>
            <button id="geo-load-review" class="text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded-lg font-medium transition hover:bg-gray-300">Load Review</button>
          </div>
          <p class="text-xs text-gray-500 mb-3">Addresses with geocoding quality score below 70%</p>
          <div id="geo-review-list">
            ${emptyState('Click "Load Review" to check for low quality addresses')}
          </div>
        </div>
      </div>
    </div>
  `;
}

function wireGeocodingEvents(container) {
  container.querySelector('#geo-batch-all')?.addEventListener('click', () => startBatchGeocoding(container));
  container.querySelector('#geo-refresh')?.addEventListener('click', () => loadGeocodingStats(container));
  container.querySelector('#geo-load-review')?.addEventListener('click', () => loadGeoReview(container));
  container.querySelector('#geo-retry-failed')?.addEventListener('click', () => retryFailedGeocoding(container));
  container.querySelector('#geo-show-failed')?.addEventListener('click', () => showFailedAddresses(container));

  // Recent jobs click delegation — select a past job to view its details/failures
  container.querySelector('#geo-recent-jobs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-job-id]');
    if (!btn) return;
    const jobId = parseInt(btn.dataset.jobId);
    if (isNaN(jobId)) return;
    loadPastJob(container, jobId);
  });

  // Load quota status on init
  loadQuotaStatus(container);
}

async function loadGeocodingStats(container) {
  const statsEl = container.querySelector('#geo-stats-content');
  if (!statsEl) return;
  statsEl.innerHTML = spinner('Loading stats...');

  try {
    const stats = await fetchGeoStats();
    const progress = stats.geocodingProgress || 0;
    const total = stats.totalVoters || 0;
    const geocoded = stats.geocodedVoters || 0;
    const pending = stats.pendingVoters || 0;
    const quality = stats.averageQualityScore || '--';
    const apiToday = stats.apiUsage?.today || 0;
    const apiLimit = stats.apiUsage?.dailyLimit || 10000;

    statsEl.innerHTML = `
      <div class="space-y-3">
        <div class="flex justify-between text-sm">
          <span class="text-gray-600 dark:text-gray-400">Geocoded</span>
          <span class="font-medium text-gray-900 dark:text-white">${fmt(geocoded)} / ${fmt(total)}</span>
        </div>
        <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
          <div class="bg-green-500 h-2.5 rounded-full transition-all" style="width: ${Math.min(progress, 100)}%"></div>
        </div>
        <p class="text-xs text-center text-gray-500">${pct(progress)} complete</p>
        <div class="grid grid-cols-2 gap-2">
          ${statCard('Pending', fmt(pending), '', 'warning')}
          ${statCard('Avg Quality', quality, '', 'primary')}
        </div>
        <div class="text-xs text-gray-500 flex justify-between">
          <span>API Usage Today</span>
          <span>${fmt(apiToday)} / ${fmt(apiLimit)}</span>
        </div>
        <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
          <div class="bg-amber-500 h-1.5 rounded-full" style="width: ${Math.min((apiToday / apiLimit) * 100, 100)}%"></div>
        </div>
      </div>
    `;

    // Recent jobs — show as clickable cards with failure counts
    const recentJobsEl = container.querySelector('#geo-recent-jobs');
    if (recentJobsEl && stats.recentJobs?.length) {
      recentJobsEl.innerHTML = stats.recentJobs.slice(0, 5).map(j => {
        const jid = j.id || j.job_id;
        const failed = j.failed_count || j.failed || 0;
        const processed = j.processed_count || j.processed || j.total_processed || 0;
        const total = j.total_records || j.total || 0;
        const succeeded = j.success_count || j.successful || (processed - failed);
        const startTime = j.start_time ? new Date(j.start_time).toLocaleString() : '';
        const isActive = geocodingJobId === jid;

        return `
          <div data-job-id="${jid}" class="cursor-pointer rounded-lg border p-2.5 mb-2 last:mb-0 transition
            ${isActive
              ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-gray-50 dark:hover:bg-gray-800/50'}">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs font-semibold text-gray-700 dark:text-gray-300">Job #${jid}</span>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-medium
                ${j.status === 'COMPLETED' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                  j.status === 'FAILED' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
                  j.status === 'PROCESSING' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                  'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}">
                ${j.status || 'UNKNOWN'}
              </span>
            </div>
            <div class="flex items-center gap-3 text-[10px] text-gray-500 dark:text-gray-400">
              <span>✅ ${fmt(succeeded)}</span>
              ${failed > 0 ? `<span class="text-red-500 font-semibold">❌ ${fmt(failed)} failed</span>` : '<span>❌ 0</span>'}
              <span>/ ${fmt(total)} total</span>
            </div>
            ${startTime ? `<p class="text-[10px] text-gray-400 mt-1">${startTime}</p>` : ''}
          </div>
        `;
      }).join('');
    }

  } catch (err) {
    statsEl.innerHTML = errorBox('Failed to load stats: ' + err.message);
  }
}

async function startBatchGeocoding(container) {
  const btn = container.querySelector('#geo-batch-all');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }

  try {
    const res = await startBatchGeocode({ all: true });
    if (!res.success || !res.jobId) throw new Error('Failed to start geocoding job');

    geocodingJobId = res.jobId;
    showToast(`Geocoding job #${res.jobId} started — ${fmt(res.totalRecords || 0)} records`, 'success');

    // Show job panel
    const panel = container.querySelector('#geo-job-panel');
    if (panel) panel.classList.remove('hidden');
    const idEl = container.querySelector('#geo-job-id');
    if (idEl) idEl.textContent = res.jobId;

    // Start polling
    startGeocodingPoll(container, res.jobId);
  } catch (err) {
    showToast('Geocoding error: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📍 Geocode All Pending'; }
  }
}

function startGeocodingPoll(container, jobId) {
  stopGeocodingPoll();
  geocodingPollTimer = setInterval(async () => {
    try {
      const job = await fetchGeoJob(jobId);
      updateJobProgress(container, job);

      if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
        stopGeocodingPoll();
        if (job.status === 'COMPLETED') {
          showToast('Geocoding complete!', 'success');
          loadGeocodingStats(container);
          // Refresh map voters
          if (map) loadMapVoters(container);
        } else {
          showToast(`Geocoding job ${job.status.toLowerCase()}`, 'error');
        }
      }
    } catch (err) {
      stopGeocodingPoll();
      showToast('Lost connection to geocoding job', 'error');
    }
  }, GEOCODE_POLL_MS);
}

function stopGeocodingPoll() {
  if (geocodingPollTimer) {
    clearInterval(geocodingPollTimer);
    geocodingPollTimer = null;
  }
}

function updateJobProgress(container, job) {
  const statusEl = container.querySelector('#geo-job-status');
  const barEl = container.querySelector('#geo-job-bar');
  const processedEl = container.querySelector('#geo-job-processed');
  const totalEl = container.querySelector('#geo-job-total');
  const failedEl = container.querySelector('#geo-job-failed');
  const cacheEl = container.querySelector('#geo-job-cache');
  const apiEl = container.querySelector('#geo-job-api');

  if (statusEl) statusEl.textContent = job.status || '--';
  if (barEl) barEl.style.width = `${Math.min(job.progress || 0, 100)}%`;
  if (processedEl) processedEl.textContent = fmt(job.processed || 0);
  if (totalEl) totalEl.textContent = fmt(job.total || 0);
  if (failedEl) failedEl.textContent = fmt(job.failed || 0);
  if (cacheEl) cacheEl.textContent = fmt(job.cacheHits || 0);
  if (apiEl) apiEl.textContent = fmt(job.apiCalls || 0);

  // Show retry/failed buttons when there are failures
  const actionsEl = container.querySelector('#geo-job-actions');
  if (actionsEl && (job.failed || 0) > 0) {
    actionsEl.classList.remove('hidden');
  } else if (actionsEl) {
    actionsEl.classList.add('hidden');
  }

  // Color the progress bar based on status
  if (barEl) {
    barEl.classList.remove('bg-blue-500', 'bg-green-500', 'bg-red-500');
    if (job.status === 'COMPLETED') barEl.classList.add('bg-green-500');
    else if (job.status === 'FAILED') barEl.classList.add('bg-red-500');
    else barEl.classList.add('bg-blue-500');
  }
}

/**
 * Load a past geocoding job's details into the progress panel.
 * Called when user clicks a job in the Recent Jobs list.
 */
async function loadPastJob(container, jobId) {
  geocodingJobId = jobId;

  // Show the progress panel
  const panel = container.querySelector('#geo-job-panel');
  if (panel) panel.classList.remove('hidden');
  const idEl = container.querySelector('#geo-job-id');
  if (idEl) idEl.textContent = jobId;

  // Clear previous failed addresses list
  const failedListEl = container.querySelector('#geo-failed-list');
  if (failedListEl) { failedListEl.classList.add('hidden'); failedListEl.innerHTML = ''; }

  try {
    const job = await fetchGeoJob(jobId);
    updateJobProgress(container, job);

    // If job is still running, start polling
    if (job.status === 'PROCESSING' || job.status === 'PENDING') {
      startGeocodingPoll(container, jobId);
    }

    // Highlight the selected job in the recent jobs list
    container.querySelectorAll('#geo-recent-jobs [data-job-id]').forEach(el => {
      if (parseInt(el.dataset.jobId) === jobId) {
        el.classList.add('border-blue-400', 'dark:border-blue-600', 'bg-blue-50', 'dark:bg-blue-900/20');
        el.classList.remove('border-gray-200', 'dark:border-gray-700');
      } else {
        el.classList.remove('border-blue-400', 'dark:border-blue-600', 'bg-blue-50', 'dark:bg-blue-900/20');
        el.classList.add('border-gray-200', 'dark:border-gray-700');
      }
    });

    // If there are failures, auto-load the failed addresses
    if ((job.failed || 0) > 0) {
      showFailedAddresses(container);
    }

    showToast(`Loaded job #${jobId} — ${fmt(job.processed || 0)} processed, ${fmt(job.failed || 0)} failed`, 'info');
  } catch (err) {
    showToast('Failed to load job: ' + err.message, 'error');
  }
}

async function loadQuotaStatus(container) {
  const quotaEl = container.querySelector('#geo-quota-content');
  if (!quotaEl) return;

  try {
    const quota = await fetchQuotaStatus();
    const used = quota.used || 0;
    const limit = quota.limit || quota.dailyLimit || 10000;
    const remaining = quota.remaining || (limit - used);
    const usagePct = Math.min((used / limit) * 100, 100);
    const barColor = usagePct > 80 ? 'bg-red-500' : usagePct > 50 ? 'bg-amber-500' : 'bg-green-500';

    quotaEl.innerHTML = `
      <div class="space-y-2">
        <div class="flex justify-between text-xs">
          <span class="text-gray-600 dark:text-gray-400">Daily Usage</span>
          <span class="font-medium text-gray-900 dark:text-white">${fmt(used)} / ${fmt(limit)}</span>
        </div>
        <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div class="${barColor} h-2 rounded-full transition-all" style="width: ${usagePct}%"></div>
        </div>
        <p class="text-xs text-center text-gray-500">${fmt(remaining)} requests remaining</p>
      </div>
    `;
  } catch (err) {
    quotaEl.innerHTML = `<p class="text-xs text-gray-400">Quota info unavailable</p>`;
  }
}

async function retryFailedGeocoding(container) {
  if (!geocodingJobId) { showToast('No geocoding job to retry', 'error'); return; }

  const btn = container.querySelector('#geo-retry-failed');
  if (btn) { btn.disabled = true; btn.textContent = 'Retrying...'; }

  try {
    const res = await retryGeoJob(geocodingJobId, {});
    if (res.success && res.jobId) {
      geocodingJobId = res.jobId;
      showToast(`Retry job #${res.jobId} started`, 'success');
      startGeocodingPoll(container, res.jobId);
    } else {
      showToast('Failed to retry geocoding job', 'error');
    }
  } catch (err) {
    showToast('Retry error: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔁 Retry Failed Addresses'; }
  }
}

async function showFailedAddresses(container) {
  if (!geocodingJobId) { showToast('No geocoding job selected', 'error'); return; }

  const listEl = container.querySelector('#geo-failed-list');
  if (!listEl) return;

  listEl.classList.remove('hidden');
  listEl.innerHTML = spinner('Loading failed addresses...');

  try {
    const res = await fetchGeoFailed(geocodingJobId);
    const failed = res.errors || [];

    if (failed.length === 0) {
      listEl.innerHTML = `<p class="text-xs text-gray-400 text-center py-2">No failed addresses found for job #${geocodingJobId}</p>`;
      return;
    }

    listEl.innerHTML = `
      <p class="text-xs text-gray-500 mb-1 font-medium">${fmt(res.failedCount || failed.length)} failed address${failed.length !== 1 ? 'es' : ''}</p>
      <div class="space-y-1">
        ${failed.map(f => `
          <div class="flex items-start gap-2 py-1 border-b border-gray-100 dark:border-gray-800 last:border-0">
            <span class="text-red-400 mt-0.5">✗</span>
            <div>
              <p class="text-gray-700 dark:text-gray-300">${escapeHtml(f.first_name || '')} ${escapeHtml(f.last_name || '')} — ${escapeHtml(f.address || 'Unknown address')}${f.city ? ', ' + escapeHtml(f.city) : ''}${f.zip_code ? ' ' + escapeHtml(f.zip_code) : ''}</p>
              <p class="text-gray-400 text-[10px]">${escapeHtml(f.error_type || 'UNKNOWN')}: ${escapeHtml(f.error_message || 'Geocoding failed')}</p>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    listEl.innerHTML = `<p class="text-xs text-red-400">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
}

async function loadGeoReview(container) {
  const listEl = container.querySelector('#geo-review-list');
  if (!listEl) return;
  listEl.innerHTML = spinner('Loading review data...');

  try {
    const res = await fetchGeoReview({ minQuality: 0, maxQuality: 70, limit: 100 });
    const voters = res.voters || [];

    if (voters.length === 0) {
      listEl.innerHTML = emptyState('No low quality addresses found — all addresses are above 70% quality');
      return;
    }

    listEl.innerHTML = `
      <p class="text-xs text-gray-500 mb-2">${fmt(res.count || voters.length)} addresses need review</p>
      <div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table class="min-w-full text-xs">
          <thead class="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
            <tr>
              <th class="px-3 py-2 text-left">Name</th>
              <th class="px-3 py-2 text-left">Address</th>
              <th class="px-3 py-2 text-left">Quality</th>
              <th class="px-3 py-2 text-left">Coords</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            ${voters.map(v => `
              <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td class="px-3 py-2 whitespace-nowrap">${escapeHtml(v.first_name || '')} ${escapeHtml(v.last_name || '')}</td>
                <td class="px-3 py-2 text-gray-500">${escapeHtml(v.address || '')} ${escapeHtml(v.city || '')}</td>
                <td class="px-3 py-2">
                  <span class="px-2 py-0.5 rounded-full text-xs font-medium ${
                    parseFloat(v.geocoding_quality) < 40 ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
                    'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
                  }">${v.geocoding_quality || 0}%</span>
                </td>
                <td class="px-3 py-2 text-gray-500 text-xs">${v.latitude ? `${parseFloat(v.latitude).toFixed(4)}, ${parseFloat(v.longitude).toFixed(4)}` : 'N/A'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    listEl.innerHTML = errorBox('Failed to load review data: ' + err.message);
  }
}

/* ════════════════════════════════════════════════════════════════
   MARKER ICON HELPERS
   ════════════════════════════════════════════════════════════════ */

function voterMarkerIcon(isSuperVoter) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 7,
    fillColor: isSuperVoter ? '#16a34a' : '#6366f1',
    fillOpacity: 0.8,
    strokeColor: '#fff',
    strokeWeight: 1.5,
  };
}

function selectedMarkerIcon() {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 10,
    fillColor: '#f59e0b',
    fillOpacity: 1.0,
    strokeColor: '#d97706',
    strokeWeight: 3,
  };
}

/* ════════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
   ════════════════════════════════════════════════════════════════ */

function clearMarkers() {
  markers.forEach(m => m.setMap(null));
  markers = [];
}

function loadGoogleMapsScript(apiKey) {
  return new Promise((resolve, reject) => {
    if (typeof google !== 'undefined' && google.maps) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });
}

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#212121' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#212121' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#373737' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#000000' }] },
];
