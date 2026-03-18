/**
 * MapView.js - Main MapView Component Orchestrator
 * 
 * Entry point for the refactored map application.
 * Coordinates between tab components (MapTab, RoutePlannerTab, GeocodingTab)
 * and manages shared state (MapState).
 * 
 * Architecture:
 * - Modular tab components with clear responsibilities
 * - Centralized state management via MapState
 * - Lazy initialization - tabs only render when first activated
 * - Backward compatible with original MapView API
 */

import MapState from './state/MapState.js';
import MapTab from './tabs/MapTab.js';
import RoutePlannerTab from './tabs/RoutePlannerTab.js';
import GeocodingTab from './tabs/GeocodingTab.js';
import { loadGoogleMapsScript } from './utils/mapUtils.js';
import { fetchConfig } from '../../api/client.js';

const TAB_IDS = {
  MAP: 'tab-map',
  ROUTE: 'tab-route',
  GEOCODING: 'tab-geocoding'
};

/**
 * Main render function for MapView
 * @param {HTMLElement} container - Container element to render into
 * @returns {Function} Cleanup function to unmount the map
 */
export async function renderMap(container) {
  // Initialize shared state
  const state = new MapState();

  // Create tab container HTML
  container.innerHTML = createTabShell();

  // Initialize tab instances (but don't render yet)
  const tabs = {
    map: new MapTab(container, state),
    route: new RoutePlannerTab(container, state),
    geocoding: new GeocodingTab(container, state)
  };

  let currentTab = null;

  /**
   * Switch to a specific tab
   * @param {string} tabId - Tab identifier (TAB_IDS)
   */
  async function switchTab(tabId) {
    // Hide all panels
    Object.values(TAB_IDS).forEach(id => {
      const panel = container.querySelector(`#${id}`);
      if (panel) panel.classList.add('hidden');
    });

    // Update button states
    container.querySelectorAll('[data-tab]').forEach(btn => {
      const isActive = btn.dataset.tab === tabId;
      btn.classList.toggle('bg-blue-500', isActive);
      btn.classList.toggle('text-white', isActive);
      btn.classList.toggle('shadow', isActive);
      btn.classList.toggle('bg-gray-200', !isActive);
      btn.classList.toggle('dark:bg-gray-700', !isActive);
      btn.classList.toggle('text-gray-700', !isActive);
      btn.classList.toggle('dark:text-gray-300', !isActive);
    });

    // Show target panel
    const targetPanel = container.querySelector(`#${tabId}`);
    if (targetPanel) targetPanel.classList.remove('hidden');

    // Get tab instance
    let tab = null;
    if (tabId === TAB_IDS.MAP) tab = tabs.map;
    else if (tabId === TAB_IDS.ROUTE) tab = tabs.route;
    else if (tabId === TAB_IDS.GEOCODING) tab = tabs.geocoding;

    if (!tab) return;

    // Initialize tab on first activation
    if (!tab.isInitialized) {
      try {
        await tab.initialize();
      } catch (err) {
        console.error(`Failed to initialize tab ${tabId}:`, err);
      }
    } else if (tab.onActivate) {
      // Call activation hook if available
      await tab.onActivate();
    }

    currentTab = tab;
  }

  /**
   * Wire up tab switching event handlers
   * Attaches click listeners to all tab buttons to enable navigation between tabs
   */
  function wireTabSwitching() {
    container.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        if (tabId) switchTab(tabId);
      });
    });
  }

  // Load configuration (including Google Maps API key)
  try {
    const config = await fetchConfig();
    state.setConfig({
      googleMapsApiKey: config.googleMapsApiKey,
      mapCenter: config.mapCenter || { lat: 36.2639, lng: -89.1929 },
      mapZoom: config.mapZoom || 11,
      mapId: config.mapId || 'DEMO_MAP_ID'  // Required for AdvancedMarkerElement
    });
  } catch (err) {
    console.error('Failed to load configuration:', err);
    container.innerHTML = `
      <div class="flex items-center justify-center h-full">
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 max-w-md">
          <h3 class="text-red-700 dark:text-red-300 font-semibold mb-2">Configuration Error</h3>
          <p class="text-red-600 dark:text-red-400 text-sm">Failed to load map configuration. Please check your API keys.</p>
        </div>
      </div>
    `;
    return () => {}; // Return no-op cleanup
  }

  // Load Google Maps API with the API key from config
  try {
    await loadGoogleMapsScript(state.config.googleMapsApiKey);
  } catch (err) {
    console.error('Failed to load Google Maps:', err);
    container.innerHTML = `
      <div class="flex items-center justify-center h-full">
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 max-w-md">
          <h3 class="text-red-700 dark:text-red-300 font-semibold mb-2">Failed to load Google Maps</h3>
          <p class="text-red-600 dark:text-red-400 text-sm">${err.message}</p>
          <p class="text-red-600 dark:text-red-400 text-xs mt-2">Please verify your Google Maps API key is configured correctly.</p>
        </div>
      </div>
    `;
    return () => {}; // Return no-op cleanup
  }

  // Wire up tab switching
  wireTabSwitching();

  // Initialize first tab (Map)
  await switchTab(TAB_IDS.MAP);

  // Restore previous state if available
  state.restore();

  // Return cleanup function
  return () => {
    // Cleanup all tabs
    Object.values(tabs).forEach(tab => {
      if (tab.cleanup) tab.cleanup();
    });

    // Clear state observers
    state.reset();

    // Clear container
    container.innerHTML = '';
  };
}

/**
 * Creates the tab shell HTML structure
 * @returns {string} HTML string for tab shell
 */
function createTabShell() {
  return `
    <div class="h-full flex flex-col">
      <!-- Tab Navigation -->
      <div class="flex items-center gap-2 p-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <button 
          data-tab="${TAB_IDS.MAP}"
          class="px-4 py-2 rounded-lg font-medium text-sm transition bg-blue-500 text-white shadow">
          🗺️ Map
        </button>
        <button 
          data-tab="${TAB_IDS.ROUTE}"
          class="px-4 py-2 rounded-lg font-medium text-sm transition bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
          🧭 Route Planner
        </button>
        <button 
          data-tab="${TAB_IDS.GEOCODING}"
          class="px-4 py-2 rounded-lg font-medium text-sm transition bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
          📍 Geocoding
        </button>
      </div>

      <!-- Tab Content Panels -->
      <div class="flex-1 overflow-auto">
        <!-- Map Tab -->
        <div id="${TAB_IDS.MAP}" class="h-full hidden">
          <!-- MapTab will render its content here -->
        </div>

        <!-- Route Planner Tab -->
        <div id="${TAB_IDS.ROUTE}" class="h-full hidden">
          <!-- RoutePlannerTab will render its content here -->
        </div>

        <!-- Geocoding Tab -->
        <div id="${TAB_IDS.GEOCODING}" class="h-full p-4 hidden overflow-auto">
          <!-- GeocodingTab will render its content here -->
        </div>
      </div>
    </div>
  `;
}

// Export default for backward compatibility
export default { renderMap };
