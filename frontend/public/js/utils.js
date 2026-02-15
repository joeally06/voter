/**
 * Utility Functions
 * Helper functions for common operations
 */

const Utils = {
  /**
   * Debounce function execution
   * @param {Function} func - Function to debounce
   * @param {number} wait - Wait time in milliseconds
   * @returns {Function} Debounced function
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  /**
   * Format number with commas
   * @param {number} num - Number to format
   * @returns {string} Formatted number
   */
  formatNumber(num) {
    if (num === null || num === undefined) return '0';
    return num.toLocaleString('en-US');
  },

  /**
   * Format percentage
   * @param {number} value - Value to format
   * @param {number} total - Total value
   * @param {number} decimals - Decimal places
   * @returns {string} Formatted percentage
   */
  formatPercentage(value, total, decimals = 1) {
    if (!total || total === 0) return '0%';
    const percentage = (value / total) * 100;
    return `${percentage.toFixed(decimals)}%`;
  },

  /**
   * Show toast notification
   * @param {string} message - Message to display
   * @param {string} type - Toast type (success, error, info, warning)
   */
  showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      Logger.warn('Toast container not found');
      return;
    }

    const toastId = `toast-${Date.now()}`;
    const bgClass = {
      success: 'bg-success',
      error: 'bg-danger',
      info: 'bg-info',
      warning: 'bg-warning'
    }[type] || 'bg-info';

    const toastHTML = `
      <div id="${toastId}" class="toast align-items-center text-white ${bgClass} border-0" role="alert" aria-live="assertive" aria-atomic="true">
        <div class="d-flex">
          <div class="toast-body">
            ${message}
          </div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
      </div>
    `;

    toastContainer.insertAdjacentHTML('beforeend', toastHTML);
    const toastElement = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElement, { delay: 5000 });
    toast.show();

    // Remove from DOM after hidden
    toastElement.addEventListener('hidden.bs.toast', () => {
      toastElement.remove();
    });
  },

  /**
   * Show loading overlay
   * @param {boolean} show - Show or hide overlay
   */
  showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.style.display = show ? 'flex' : 'none';
    }
  },

  /**
   * Export data to CSV
   * @param {Array} data - Array of objects to export
   * @param {string} filename - Filename for download
   */
  exportToCSV(data, filename = 'voters.csv') {
    if (!data || data.length === 0) {
      this.showToast('No data to export', 'warning');
      return;
    }

    // Get headers from first object
    const headers = Object.keys(data[0]);
    
    // Build CSV content
    const csvContent = [
      headers.join(','),
      ...data.map(row => 
        headers.map(header => {
          const value = row[header];
          // Escape values containing commas or quotes
          if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value ?? '';
        }).join(',')
      )
    ].join('\n');

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    this.showToast('Export completed successfully', 'success');
  },

  /**
   * Sanitize user input to prevent XSS attacks
   * CRITICAL FIX #2: XSS Vulnerability
   * @param {string} input - User input to sanitize
   * @returns {string} Sanitized input
   */
  sanitizeInput(input) {
    if (!input || typeof input !== 'string') return '';
    return input
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  },

  /**
   * Escape HTML for safe insertion into DOM
   * @param {string} html - HTML string to escape
   * @returns {string} Escaped HTML
   */
  escapeHtml(html) {
    const div = document.createElement('div');
    div.textContent = html;
    return div.innerHTML;
  },

  /**
   * Get error message from API response
   * @param {Error} error - Error object
   * @returns {string} User-friendly error message
   */
  getErrorMessage(error) {
    if (error.message) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'An unexpected error occurred';
  },

  /**
   * Standardized error handler
   * RECOMMENDED FIX #8: Consistent error handling
   * @param {Error} error - Error object
   * @param {string} context - Error context/location
   * @param {Object} options - Handler options
   */
  handleError(error, context, options = {}) {
    const {
      showToast = true,
      updateState = true,
      customMessage = null,
      recoveryAction = null
    } = options;

    // Log error
    Logger.error(`[${context}] Error:`, error);

    // Show user notification
    if (showToast) {
      const message = customMessage || this.getErrorMessage(error);
      this.showToast(message, 'error');
    }

    // Update application state
    if (updateState && window.stateManager) {
      window.stateManager.setState({
        ui: { 
          error: {
            message: this.getErrorMessage(error),
            context,
            timestamp: Date.now()
          }
        }
      });
    }

    // Provide recovery action
    if (recoveryAction) {
      setTimeout(() => {
        this.showToast(
          `Would you like to retry? Click here to try again.`,
          'warning'
        );
      }, 2000);
    }
  },

  /**
   * Validate if coordinates are valid
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @returns {boolean} True if valid
   */
  isValidCoordinates(lat, lng) {
    return (
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    );
  }
};

// Make available globally
window.Utils = Utils;
