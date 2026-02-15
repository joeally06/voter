/**
 * State Manager
 * Centralized state management with observer pattern
 * Supports selector-based subscriptions and batch updates
 */
class StateManager {
  constructor(initialState = {}) {
    this.state = {
      // Voter data
      voters: [],
      totalVoters: 0,
      filteredVoters: [],
      totalFiltered: 0,
      
      // Filters
      filters: {
        precinct: null,
        name: '',
        superVoterOnly: false,
        geocodedOnly: false  // Changed from true to false - show all voters by default
      },
      
      // Pagination
      pagination: {
        limit: window.APP_CONFIG?.defaultPageSize || 1000,
        offset: 0,
        total: 0
      },
      
      // Map state
      map: {
        center: window.APP_CONFIG?.mapCenter || { lat: 36.2639, lng: -89.1929 },
        zoom: window.APP_CONFIG?.mapZoom || 11,
        markers: [],
        selectedMarker: null
      },
      
      // Analytics
      analytics: {
        precincts: [],
        votingPatterns: null,
        turnout: null,
        stats: null
      },
      
      // UI state
      ui: {
        loading: false,
        error: null,
        activeView: 'map'
      },
      
      // Routing state
      routing: {
        selectedVoterIds: [],
        count: 0
      },
      
      ...initialState
    };

    this.listeners = [];
    this._batching = false;
    this._batchPrevState = null;
    this._batchDirty = false;

    // Action history for undo/redo
    this.history = [];
    this.historyIndex = -1;
    this.maxHistory = 50;
    this._undoing = false;
  }

  /**
   * Get current state
   * @returns {Object} Current state
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Update state with new values
   * @param {Object} updates - Partial state updates
   */
  setState(updates) {
    var prevState = { ...this.state };
    
    // Merge updates (deep merge for nested objects)
    this.state = this.deepMerge(this.state, updates);
    
    // Push to history for undo/redo (skip if we're undoing/redoing)
    if (!this._undoing && !this._batching) {
      // Truncate any redo history ahead of current index
      if (this.historyIndex < this.history.length - 1) {
        this.history = this.history.slice(0, this.historyIndex + 1);
      }
      this.history.push(prevState);
      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }
      this.historyIndex = this.history.length - 1;
    }

    if (this._batching) {
      // During batch, capture the earliest prevState and mark dirty
      if (!this._batchDirty) {
        this._batchPrevState = prevState;
        this._batchDirty = true;
      }
      return;
    }

    // Notify all listeners
    this.notify(this.state, prevState);
  }

  /**
   * Batch multiple setState calls, only notifying listeners once at the end
   * @param {Function} callback - Function containing setState calls
   */
  batchUpdate(callback) {
    this._batching = true;
    this._batchDirty = false;
    this._batchPrevState = { ...this.state };
    
    try {
      callback();
    } finally {
      this._batching = false;
      if (this._batchDirty) {
        this.notify(this.state, this._batchPrevState);
      }
      this._batchPrevState = null;
      this._batchDirty = false;
    }
  }

  /**
   * Subscribe to state changes
   * @param {Function} listener - Callback function to execute on state change
   * @param {string|Function} [selector] - Optional selector path ('filters.precinct') or function (state => state.filters)
   * @returns {Function} Unsubscribe function
   */
  subscribe(listener, selector) {
    var entry = { listener: listener, selector: selector || null };
    this.listeners.push(entry);
    
    // Return unsubscribe function
    return function() {
      this.listeners = this.listeners.filter(function(l) { return l !== entry; });
    }.bind(this);
  }

  /**
   * Resolve a selector to a value from state
   * @param {Object} state - State object
   * @param {string|Function} selector - Selector path or function
   * @returns {*} Selected value
   */
  _resolveSelector(state, selector) {
    if (typeof selector === 'function') {
      return selector(state);
    }
    // String path: 'filters.precinct'
    var parts = selector.split('.');
    var val = state;
    for (var i = 0; i < parts.length; i++) {
      if (val == null) return undefined;
      val = val[parts[i]];
    }
    return val;
  }

  /**
   * Notify all listeners of state change
   * @param {Object} newState - New state
   * @param {Object} prevState - Previous state
   */
  notify(newState, prevState) {
    this.listeners.forEach(function(entry) {
      try {
        if (entry.selector) {
          var newVal = this._resolveSelector(newState, entry.selector);
          var oldVal = this._resolveSelector(prevState, entry.selector);
          if (newVal !== oldVal) {
            entry.listener(newState, prevState);
          }
        } else {
          entry.listener(newState, prevState);
        }
      } catch (error) {
        Logger.error('Error in state listener:', error);
      }
    }.bind(this));
  }

  /**
   * Deep merge objects
   * @param {Object} target - Target object
   * @param {Object} source - Source object
   * @returns {Object} Merged object
   */
  deepMerge(target, source) {
    const output = { ...target };
    
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            output[key] = source[key];
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          output[key] = source[key];
        }
      });
    }
    
    return output;
  }

  /**
   * Check if value is an object
   * @param {*} item - Item to check
   * @returns {boolean} True if object
   */
  isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
  }

  /**
   * Undo the last state change
   * @returns {boolean} True if undo was performed
   */
  undo() {
    if (!this.canUndo()) return false;
    this._undoing = true;
    var current = { ...this.state };
    var prev = this.history[this.historyIndex];
    this.state = { ...prev };
    this.historyIndex--;
    // Save current state for redo
    if (!this._redoStack) this._redoStack = [];
    this._redoStack.push(current);
    this.notify(this.state, current);
    this._undoing = false;
    return true;
  }

  /**
   * Redo a previously undone state change
   * @returns {boolean} True if redo was performed
   */
  redo() {
    if (!this.canRedo()) return false;
    this._undoing = true;
    var current = { ...this.state };
    var next = this._redoStack.pop();
    this.state = { ...next };
    this.historyIndex++;
    this.notify(this.state, current);
    this._undoing = false;
    return true;
  }

  /**
   * @returns {boolean} True if undo is possible
   */
  canUndo() {
    return this.historyIndex >= 0 && this.history.length > 0;
  }

  /**
   * @returns {boolean} True if redo is possible
   */
  canRedo() {
    return this._redoStack && this._redoStack.length > 0;
  }

  /**
   * Create a debounced state setter that batches rapid updates
   * @param {number} delay - Debounce delay in milliseconds (default 300)
   * @returns {Function} Debounced setState function
   */
  createDebouncedSetter(delay) {
    if (delay === undefined) delay = 300;
    var self = this;
    var timer = null;
    var pending = {};
    return function(updates) {
      pending = self.deepMerge(pending, updates);
      if (timer) clearTimeout(timer);
      timer = setTimeout(function() {
        self.setState(pending);
        pending = {};
        timer = null;
      }, delay);
    };
  }

  /**
   * Reset state to initial values
   */
  reset() {
    this.setState({
      voters: [],
      totalVoters: 0,
      filteredVoters: [],
      totalFiltered: 0,
      filters: {
        precinct: null,
        name: '',
        superVoterOnly: false,
        geocodedOnly: false
      },
      ui: {
        loading: false,
        error: null,
        activeView: 'map'
      }
    });
  }
}

// Make available globally
window.StateManager = StateManager;
