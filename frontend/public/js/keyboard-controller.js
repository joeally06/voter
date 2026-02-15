/**
 * Keyboard Controller
 * Manages keyboard shortcuts, navigation, and accessibility features
 * 
 * Phase 3: Layout & Navigation Improvements
 * Implementation Date: February 8, 2026
 */

class KeyboardController {
    constructor() {
        this.shortcuts = new Map();
        this.helpVisible = false;
        this.enabled = true;
        
        // Initialize keyboard navigation
        this.init();
    }

    /**
     * Initialize keyboard shortcuts and listeners
     */
    init() {
        this.registerDefaultShortcuts();
        this.attachEventListeners();
        this.createHelpOverlay();
        Logger.info('✓ Keyboard controller initialized');
    }

    /**
     * Register default keyboard shortcuts
     */
    registerDefaultShortcuts() {
        // Tab Navigation (Numbers 1-3)
        this.registerShortcut('1', () => {
            this.switchTab('route-tab');
        }, 'Switch to Route Planning tab');

        this.registerShortcut('2', () => {
            this.switchTab('analytics-tab');
        }, 'Switch to Analytics tab');

        this.registerShortcut('3', () => {
            this.switchTab('voters-tab');
        }, 'Switch to Voter List tab');

        // Search Focus (/)
        this.registerShortcut('/', () => {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.focus();
                searchInput.select();
            }
        }, 'Focus search input');

        // Clear Filters (C)
        this.registerShortcut('c', () => {
            const clearBtn = document.getElementById('clearFilters');
            if (clearBtn) {
                clearBtn.click();
            }
        }, 'Clear all filters');

        // Toggle Theme (T)
        this.registerShortcut('t', () => {
            const themeBtn = document.getElementById('theme-toggle-btn');
            if (themeBtn) {
                themeBtn.click();
            }
        }, 'Toggle dark/light theme');

        // Toggle Filter Panel on Mobile (F)
        this.registerShortcut('f', () => {
            const filterBtn = document.getElementById('mobileFilterBtn');
            if (filterBtn && window.innerWidth < 768) {
                filterBtn.click();
            }
        }, 'Toggle filter panel (mobile)');

        // Help Overlay (? or Shift+/)
        this.registerShortcut('?', () => {
            this.toggleHelpOverlay();
        }, 'Show keyboard shortcuts');

        // Escape key - Close overlays
        this.registerShortcut('Escape', () => {
            this.closeAllOverlays();
        }, 'Close open overlays/modals');

        // Navigation within lists (Arrow keys handled separately)
        // These are registered but handled in their own method
    }

    /**
     * Register a keyboard shortcut
     * @param {string} key - The key to bind
     * @param {Function} callback - Function to execute
     * @param {string} description - Description for help overlay
     * @param {Object} options - Additional options (ctrl, alt, shift)
     */
    registerShortcut(key, callback, description, options = {}) {
        const shortcut = {
            key: key.toLowerCase(),
            callback,
            description,
            ctrl: options.ctrl || false,
            alt: options.alt || false,
            shift: options.shift || false
        };

        // Create a unique identifier for the shortcut
        const id = this.getShortcutId(key, options);
        this.shortcuts.set(id, shortcut);
    }

    /**
     * Get unique identifier for shortcut
     */
    getShortcutId(key, options = {}) {
        const parts = [];
        if (options.ctrl) parts.push('ctrl');
        if (options.alt) parts.push('alt');
        if (options.shift) parts.push('shift');
        parts.push(key.toLowerCase());
        return parts.join('+');
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        document.addEventListener('keydown', (e) => {
            if (!this.enabled) return;

            // Don't trigger shortcuts when typing in inputs (except specific keys)
            const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
            const allowedInInput = ['Escape', 'Tab'];
            
            if (isInput && !allowedInInput.includes(e.key)) {
                return;
            }

            // Build the shortcut ID based on pressed keys
            const parts = [];
            if (e.ctrlKey || e.metaKey) parts.push('ctrl');
            if (e.altKey) parts.push('alt');
            if (e.shiftKey) parts.push('shift');
            
            // Handle special case for "?"
            let key = e.key.toLowerCase();
            if (e.shiftKey && e.key === '/') {
                key = '?';
                parts.pop(); // Remove shift from parts for '?'
            }
            
            parts.push(key);
            const shortcutId = parts.join('+');

            // Check if this shortcut is registered
            const shortcut = this.shortcuts.get(shortcutId);
            if (shortcut) {
                e.preventDefault();
                shortcut.callback(e);
            }
        });

        // Handle arrow key navigation in lists
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                this.handleArrowNavigation(e);
            }
        });
    }

    /**
     * Switch to a specific tab
     */
    switchTab(tabId) {
        const tabButton = document.querySelector(`[data-bs-target="#${tabId}"]`);
        if (tabButton) {
            const tab = new bootstrap.Tab(tabButton);
            tab.show();
            
            // Announce to screen readers
            this.announceToScreenReader(`Switched to ${tabButton.textContent.trim()}`);
        }
    }

    /**
     * Create help overlay for keyboard shortcuts
     */
    createHelpOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'keyboard-help-overlay';
        overlay.className = 'vp-kbd-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-labelledby', 'kbd-overlay-title');
        overlay.setAttribute('aria-modal', 'true');

        const shortcuts = Array.from(this.shortcuts.values());
        
        // Group shortcuts by category
        const categories = {
            'Navigation': shortcuts.filter(s => 
                ['1', '2', '3'].includes(s.key)
            ),
            'Search & Filters': shortcuts.filter(s => 
                ['/', 'c', 'f'].includes(s.key)
            ),
            'General': shortcuts.filter(s => 
                ['t', '?', 'escape'].includes(s.key)
            )
        };

        let sectionsHTML = '';
        for (const [category, items] of Object.entries(categories)) {
            if (items.length === 0) continue;
            
            sectionsHTML += `
                <div class="vp-kbd-overlay__section">
                    <h3 class="vp-kbd-overlay__section-title">${category}</h3>
                    ${items.map(item => `
                        <div class="vp-kbd-overlay__item">
                            <span class="vp-kbd-overlay__description">${item.description}</span>
                            <div class="vp-kbd-overlay__keys">
                                ${this.renderShortcutKeys(item)}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        overlay.innerHTML = `
            <div class="vp-kbd-overlay__content">
                <div class="vp-kbd-overlay__header">
                    <h2 id="kbd-overlay-title" class="vp-kbd-overlay__title">
                        <i class="bi bi-keyboard"></i> Keyboard Shortcuts
                    </h2>
                    <button class="vp-kbd-overlay__close" aria-label="Close keyboard shortcuts">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
                ${sectionsHTML}
                <p class="vp-kbd-overlay__footer">
                    <i class="bi bi-info-circle"></i> Press <kbd class="vp-kbd">?</kbd> or <kbd class="vp-kbd">Esc</kbd> to close this overlay
                </p>
            </div>
        `;

        document.body.appendChild(overlay);

        // Close button event
        const closeBtn = overlay.querySelector('.vp-kbd-overlay__close');
        closeBtn.addEventListener('click', () => this.toggleHelpOverlay());

        // Close on background click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.toggleHelpOverlay();
            }
        });
    }

    /**
     * Render shortcut keys as HTML
     */
    renderShortcutKeys(shortcut) {
        const keys = [];
        
        if (shortcut.ctrl) keys.push('Ctrl');
        if (shortcut.alt) keys.push('Alt');
        if (shortcut.shift) keys.push('Shift');
        
        // Special display for certain keys
        let keyDisplay = shortcut.key;
        if (shortcut.key === 'escape') keyDisplay = 'Esc';
        if (shortcut.key === '?') keyDisplay = '?';
        
        keys.push(keyDisplay.toUpperCase());
        
        return keys.map(k => `<kbd class="vp-kbd">${k}</kbd>`).join(' + ');
    }

    /**
     * Toggle help overlay visibility
     */
    toggleHelpOverlay() {
        const overlay = document.getElementById('keyboard-help-overlay');
        if (!overlay) return;

        this.helpVisible = !this.helpVisible;
        
        if (this.helpVisible) {
            overlay.classList.add('vp-kbd-overlay--active');
            // Create backdrop
            this.createBackdrop();
            // Trap focus in overlay
            this.trapFocus(overlay);
            // Announce to screen readers
            this.announceToScreenReader('Keyboard shortcuts dialog opened');
        } else {
            overlay.classList.remove('vp-kbd-overlay--active');
            this.removeBackdrop();
            this.announceToScreenReader('Keyboard shortcuts dialog closed');
        }
    }

    /**
     * Create backdrop for overlay
     */
    createBackdrop() {
        if (document.getElementById('kbd-overlay-backdrop')) return;
        
        const backdrop = document.createElement('div');
        backdrop.id = 'kbd-overlay-backdrop';
        backdrop.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: calc(var(--z-modal) - 1);
            backdrop-filter: blur(4px);
        `;
        backdrop.addEventListener('click', () => this.toggleHelpOverlay());
        document.body.appendChild(backdrop);
    }

    /**
     * Remove backdrop
     */
    removeBackdrop() {
        const backdrop = document.getElementById('kbd-overlay-backdrop');
        if (backdrop) {
            backdrop.remove();
        }
    }

    /**
     * Close all open overlays
     */
    closeAllOverlays() {
        // Close help overlay if open
        if (this.helpVisible) {
            this.toggleHelpOverlay();
        }

        // Close Bootstrap modals
        const modals = document.querySelectorAll('.modal.show');
        modals.forEach(modal => {
            const modalInstance = bootstrap.Modal.getInstance(modal);
            if (modalInstance) {
                modalInstance.hide();
            }
        });

        // Close Bootstrap offcanvas
        const offcanvas = document.querySelectorAll('.offcanvas.show');
        offcanvas.forEach(oc => {
            const ocInstance = bootstrap.Offcanvas.getInstance(oc);
            if (ocInstance) {
                ocInstance.hide();
            }
        });
    }

    /**
     * Handle arrow key navigation in lists
     */
    handleArrowNavigation(e) {
        const activeElement = document.activeElement;
        
        // Check if we're in a list or table
        const isList = activeElement.closest('.list-group, table, .voter-list');
        if (!isList) return;

        const focusableElements = Array.from(
            isList.querySelectorAll('a, button, [tabindex]:not([tabindex="-1"])')
        );

        const currentIndex = focusableElements.indexOf(activeElement);
        if (currentIndex === -1) return;

        e.preventDefault();

        let nextIndex;
        if (e.key === 'ArrowDown') {
            nextIndex = Math.min(currentIndex + 1, focusableElements.length - 1);
        } else if (e.key === 'ArrowUp') {
            nextIndex = Math.max(currentIndex - 1, 0);
        }

        if (nextIndex !== undefined && focusableElements[nextIndex]) {
            focusableElements[nextIndex].focus();
        }
    }

    /**
     * Trap focus within an element (for modals/overlays)
     */
    trapFocus(element) {
        const focusableElements = element.querySelectorAll(
            'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );

        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];

        // Focus first element
        if (firstFocusable) {
            firstFocusable.focus();
        }

        // Trap focus in element
        const trapListener = (e) => {
            if (e.key !== 'Tab') return;

            if (e.shiftKey) {
                if (document.activeElement === firstFocusable) {
                    lastFocusable.focus();
                    e.preventDefault();
                }
            } else {
                if (document.activeElement === lastFocusable) {
                    firstFocusable.focus();
                    e.preventDefault();
                }
            }
        };

        element.addEventListener('keydown', trapListener);
        
        // Store listener for cleanup
        element._focusTrapListener = trapListener;
    }

    /**
     * Announce message to screen readers
     */
    announceToScreenReader(message) {
        const announcement = document.createElement('div');
        announcement.setAttribute('role', 'status');
        announcement.setAttribute('aria-live', 'polite');
        announcement.className = 'vp-sr-only';
        announcement.textContent = message;
        
        document.body.appendChild(announcement);
        
        // Remove after announcement
        setTimeout(() => {
            announcement.remove();
        }, 1000);
    }

    /**
     * Enable keyboard shortcuts
     */
    enable() {
        this.enabled = true;
    }

    /**
     * Disable keyboard shortcuts
     */
    disable() {
        this.enabled = false;
    }

    /**
     * Add keyboard hint to an element
     */
    addKeyboardHint(element, key) {
        if (!element) return;

        const hint = document.createElement('kbd');
        hint.className = 'vp-kbd';
        hint.textContent = key;
        hint.style.marginLeft = 'var(--space-2)';
        hint.style.fontSize = 'var(--text-xs)';
        
        element.appendChild(hint);
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = KeyboardController;
}
