/**
 * Theme Controller - Manages light/dark mode switching
 * Part of Phase 1: Design System Foundation
 */

class ThemeController {
    constructor() {
        this.themeKey = 'voter-platform-theme';
        this.currentTheme = this.getStoredTheme() || this.getSystemPreference();
        this.init();
    }

    /**
     * Initialize theme controller
     */
    init() {
        // Apply initial theme
        this.applyTheme(this.currentTheme);
        
        // Set up toggle button listener
        this.setupToggleButton();
        
        // Listen for system theme changes
        this.listenForSystemThemeChanges();
        
        Logger.info('ThemeController initialized with theme:', this.currentTheme);
    }

    /**
     * Get theme from localStorage
     * @returns {string|null} Stored theme preference or null
     */
    getStoredTheme() {
        try {
            return localStorage.getItem(this.themeKey);
        } catch (error) {
            Logger.warn('localStorage not available:', error);
            return null;
        }
    }

    /**
     * Get system color scheme preference
     * @returns {string} 'light' or 'dark'
     */
    getSystemPreference() {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    }

    /**
     * Apply theme to document
     * @param {string} theme - 'light' or 'dark'
     */
    applyTheme(theme) {
        const root = document.documentElement;

        // Use Tailwind's dark mode class strategy
        if (theme === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }

        // Update current theme
        this.currentTheme = theme;

        // Store preference
        this.storeTheme(theme);

        // Update toggle button icon
        this.updateToggleButton(theme);

        // Dispatch event for other components to react
        this.dispatchThemeChangeEvent(theme);

        Logger.debug('Theme applied:', theme);
    }

    /**
     * Store theme preference in localStorage
     * @param {string} theme - Theme to store
     */
    storeTheme(theme) {
        try {
            localStorage.setItem(this.themeKey, theme);
        } catch (error) {
            Logger.warn('Failed to store theme preference:', error);
        }
    }

    /**
     * Toggle between light and dark themes
     */
    toggleTheme() {
        const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
        this.applyTheme(newTheme);
    }

    /**
     * Set up theme toggle button
     */
    setupToggleButton() {
        const toggleBtn = document.getElementById('theme-toggle-btn');
        
        if (!toggleBtn) {
            Logger.warn('Theme toggle button not found in DOM');
            return;
        }

        // Add click listener
        toggleBtn.addEventListener('click', () => {
            this.toggleTheme();
        });

        // Set initial icon
        this.updateToggleButton(this.currentTheme);
    }

    /**
     * Update toggle button icon based on current theme
     * @param {string} theme - Current theme
     */
    updateToggleButton(theme) {
        const toggleBtn = document.getElementById('theme-toggle-btn');
        const icon = toggleBtn?.querySelector('i');
        
        if (!icon) return;

        // Remove all theme icons
        icon.classList.remove('bi-sun-fill', 'bi-moon-fill', 'bi-moon-stars-fill');

        // Add appropriate icon
        if (theme === 'dark') {
            icon.classList.add('bi-sun-fill');
            toggleBtn.setAttribute('aria-label', 'Switch to light mode');
            toggleBtn.setAttribute('title', 'Switch to light mode');
        } else {
            icon.classList.add('bi-moon-fill');
            toggleBtn.setAttribute('aria-label', 'Switch to dark mode');
            toggleBtn.setAttribute('title', 'Switch to dark mode');
        }
    }

    /**
     * Listen for system theme preference changes
     */
    listenForSystemThemeChanges() {
        if (!window.matchMedia) return;

        const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
        
        // Modern browsers
        if (darkModeQuery.addEventListener) {
            darkModeQuery.addEventListener('change', (e) => {
                // Only auto-switch if user hasn't set a manual preference
                if (!this.getStoredTheme()) {
                    this.applyTheme(e.matches ? 'dark' : 'light');
                }
            });
        } 
        // Older browsers
        else if (darkModeQuery.addListener) {
            darkModeQuery.addListener((e) => {
                if (!this.getStoredTheme()) {
                    this.applyTheme(e.matches ? 'dark' : 'light');
                }
            });
        }
    }

    /**
     * Dispatch custom theme change event
     * @param {string} theme - New theme
     */
    dispatchThemeChangeEvent(theme) {
        const event = new CustomEvent('themechange', {
            detail: { theme }
        });
        document.dispatchEvent(event);
    }

    /**
     * Get current theme
     * @returns {string} Current theme ('light' or 'dark')
     */
    getCurrentTheme() {
        return this.currentTheme;
    }

    /**
     * Set theme programmatically
     * @param {string} theme - 'light' or 'dark'
     */
    setTheme(theme) {
        if (theme !== 'light' && theme !== 'dark') {
            Logger.error('Invalid theme:', theme);
            return;
        }
        this.applyTheme(theme);
    }

    /**
     * Clear stored theme preference
     */
    clearThemePreference() {
        try {
            localStorage.removeItem(this.themeKey);
            // Revert to system preference
            this.applyTheme(this.getSystemPreference());
        } catch (error) {
            Logger.warn('Failed to clear theme preference:', error);
        }
    }
}

// Initialize theme controller when DOM is ready
if (typeof window !== 'undefined') {
    // Export to window for global access
    window.ThemeController = ThemeController;
    
    // Auto-initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.themeController = new ThemeController();
        });
    } else {
        // DOM already loaded
        window.themeController = new ThemeController();
    }
}
