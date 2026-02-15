/**
 * Logger Utility
 * Production-safe logging with configurable levels
 * Replaces raw console.log calls throughout the application
 */
const Logger = (() => {
    const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

    // Default: 'error' in production, 'info' in development
    // Can be overridden via localStorage or APP_CONFIG
    let currentLevel = 'error';

    function init() {
        // Check for development mode
        const isDev = window.APP_CONFIG?.isDevelopment
            || window.location.hostname === 'localhost'
            || window.location.hostname === '127.0.0.1';

        // Allow localStorage override: localStorage.setItem('logLevel', 'debug')
        const storedLevel = localStorage.getItem('logLevel');
        currentLevel = storedLevel || (isDev ? 'info' : 'error');
    }

    function shouldLog(level) {
        return LEVELS[level] <= LEVELS[currentLevel];
    }

    function error(...args) {
        if (shouldLog('error')) console.error(...args);
    }

    function warn(...args) {
        if (shouldLog('warn')) console.warn(...args);
    }

    function info(...args) {
        if (shouldLog('info')) console.log(...args);
    }

    function debug(...args) {
        if (shouldLog('debug')) console.log(...args);
    }

    function setLevel(level) {
        if (LEVELS[level] !== undefined) {
            currentLevel = level;
            localStorage.setItem('logLevel', level);
        }
    }

    function getLevel() {
        return currentLevel;
    }

    // Auto-initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return { error, warn, info, debug, setLevel, getLevel, init };
})();

window.Logger = Logger;
