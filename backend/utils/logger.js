/**
 * Simple environment-aware logging utility
 * 
 * Usage:
 *   const log = require('./utils/logger');
 *   log.info('Server started');      // Only in development
 *   log.warn('Low memory');          // Always shown
 *   log.error('DB connection failed'); // Always shown
 *   log.debug('Raw API response:', data); // Only in development
 * 
 * Log Levels:
 *   debug - Verbose debugging (dev only)
 *   info  - Informational messages (dev only)
 *   warn  - Warnings (always)
 *   error - Errors (always)
 */

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Remove emojis and format message consistently
 * Input:  "✅ Successfully geocoded voter 1234"
 * Output: "[INFO] Successfully geocoded voter 1234"
 */
function formatMessage(level, ...args) {
  // Convert all arguments to strings and join
  const message = args
    .map(arg => {
      if (typeof arg === 'object') {
        return JSON.stringify(arg);
      }
      return String(arg);
    })
    .join(' ')
    .replace(/[🎯✅🔄❌🚨⚠️📊🗺️🧹⏹️]/g, '') // Remove emojis
    .trim();

  return `[${level.toUpperCase()}] ${message}`;
}

module.exports = {
  /**
   * Debug-level logging (verbose details)
   * Only shown in development mode
   */
  debug: (...args) => {
    if (isDev) {
      console.debug(formatMessage('debug', ...args));
    }
  },

  /**
   * Info-level logging (routine operations)
   * Only shown in development mode
   */
  info: (...args) => {
    if (isDev) {
      console.log(formatMessage('info', ...args));
    }
  },

  /**
   * Warning-level logging (recoverable issues)
   * Always shown in all environments
   */
  warn: (...args) => {
    console.warn(formatMessage('warn', ...args));
  },

  /**
   * Error-level logging (failures)
   * Always shown in all environments
   */
  error: (...args) => {
    console.error(formatMessage('error', ...args));
  }
};
