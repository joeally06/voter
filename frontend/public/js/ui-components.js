/**
 * UI Components - Vanilla JavaScript replacements for Bootstrap components
 * Part of Tailwind Migration - Removes Bootstrap JS dependency
 */

/**
 * Modal Component - Replaces Bootstrap modal
 * Provides show/hide functionality with backdrop
 */
class Modal {
    constructor(modalId) {
        this.modal = document.getElementById(modalId);
        this.backdrop = null;
        this.isShowing = false; // Track modal state to prevent duplicate show() calls
        
        if (!this.modal) {
            Logger.warn(`Modal with ID "${modalId}" not found`);
            return;
        }
        
        // Set up close button listeners
        this.setupCloseButtons();
        
        // Set up backdrop click to close
        this.setupBackdropClose();
    }
    
    /**
     * Show the modal
     */
    show() {
        if (!this.modal) return;
        
        // DEFENSIVE: Prevent duplicate show() calls
        if (this.isShowing) {
            Logger.warn('Modal already showing, ignoring duplicate show() call');
            return;
        }
        
        // DEFENSIVE: Clean up any orphaned backdrops from previous bugs
        this.cleanupOrphanedBackdrops();
        
        // Show modal
        this.modal.classList.remove('hidden');
        this.modal.classList.add('flex');
        this.modal.setAttribute('aria-hidden', 'false');
        
        // Create and show backdrop (ONLY if not exists)
        if (!this.backdrop) {
            this.backdrop = document.createElement('div');
            this.backdrop.className = 'fixed inset-0 bg-black/50 z-40 transition-opacity duration-300';
            this.backdrop.style.opacity = '0';
            this.backdrop.setAttribute('data-modal-backdrop', this.modal.id); // Track ownership
            document.body.appendChild(this.backdrop);
            
            // Trigger fade-in
            setTimeout(() => {
                if (this.backdrop) this.backdrop.style.opacity = '1';
            }, 10);
        }
        
        // Prevent body scroll
        document.body.classList.add('overflow-hidden');
        
        this.isShowing = true; // Set state
        
        // Dispatch show event
        this.modal.dispatchEvent(new CustomEvent('modal:show'));
    }
    
    /**
     * Hide the modal
     */
    hide() {
        if (!this.modal) return;
        
        // Remove backdrop immediately (don't wait for animation)
        if (this.backdrop) {
            this.backdrop.remove();
            this.backdrop = null;
        }
        
        // Hide modal
        this.modal.classList.add('hidden');
        this.modal.classList.remove('flex');
        this.modal.setAttribute('aria-hidden', 'true');
        
        // Restore body scroll (check if other modals are open)
        const otherModalsOpen = document.querySelectorAll('.modal.flex:not(.hidden)').length > 0;
        if (!otherModalsOpen) {
            document.body.classList.remove('overflow-hidden');
        }
        
        this.isShowing = false; // Reset state
        
        // Dispatch hide event
        this.modal.dispatchEvent(new CustomEvent('modal:hide'));
    }
    
    /**
     * Toggle modal visibility
     */
    toggle() {
        if (this.modal.classList.contains('hidden')) {
            this.show();
        } else {
            this.hide();
        }
    }
    
    /**
     * Set up close button listeners
     */
    setupCloseButtons() {
        if (!this.modal) return;
        
        const closeButtons = this.modal.querySelectorAll('[data-dismiss="modal"], [data-bs-dismiss="modal"]');
        closeButtons.forEach(btn => {
            btn.addEventListener('click', () => this.hide());
        });
    }
    
    /**
     * Set up backdrop click to close
     */
    setupBackdropClose() {
        if (!this.modal) return;
        
        this.modal.addEventListener('click', (e) => {
            // Only close if clicking the modal background, not its content
            if (e.target === this.modal) {
                this.hide();
            }
        });
    }
    
    /**
     * Clean up any orphaned backdrops from previous bugs
     */
    cleanupOrphanedBackdrops() {
        const orphanedBackdrops = document.querySelectorAll('[data-modal-backdrop]');
        orphanedBackdrops.forEach(backdrop => {
            const modalId = backdrop.getAttribute('data-modal-backdrop');
            const modalExists = document.getElementById(modalId);
            const modalIsVisible = modalExists && !modalExists.classList.contains('hidden');
            
            if (!modalIsVisible) {
                Logger.warn('Removing orphaned backdrop for modal:', modalId);
                backdrop.remove();
            }
        });
    }
}

/**
 * Offcanvas Component - Replaces Bootstrap offcanvas
 * Provides slide-in panel functionality
 */
class Offcanvas {
    constructor(offcanvasId) {
        this.offcanvas = document.getElementById(offcanvasId);
        this.backdrop = null;
        
        if (!this.offcanvas) {
            Logger.warn(`Offcanvas with ID "${offcanvasId}" not found`);
            return;
        }
        
        // Set up close button listeners
        this.setupCloseButtons();
    }
    
    /**
     * Toggle offcanvas visibility
     */
    toggle() {
        if (this.offcanvas.classList.contains('translate-x-full')) {
            this.show();
        } else {
            this.hide();
        }
    }
    
    /**
     * Show the offcanvas
     */
    show() {
        if (!this.offcanvas) return;
        
        // Show offcanvas with slide animation
        this.offcanvas.classList.remove('translate-x-full');
        this.offcanvas.setAttribute('aria-hidden', 'false');
        
        // Create and show backdrop
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'fixed inset-0 bg-black/50 z-40 transition-opacity duration-300';
        this.backdrop.style.opacity = '0';
        this.backdrop.onclick = () => this.hide();
        document.body.appendChild(this.backdrop);
        
        // Trigger fade-in
        setTimeout(() => {
            this.backdrop.style.opacity = '1';
        }, 10);
        
        // Prevent body scroll
        document.body.classList.add('overflow-hidden');
        
        // Update toggle button aria-expanded
        const toggleBtn = document.querySelector(`[data-bs-target="#${this.offcanvas.id}"]`);
        if (toggleBtn) {
            toggleBtn.setAttribute('aria-expanded', 'true');
        }
        
        // Dispatch show event
        this.offcanvas.dispatchEvent(new CustomEvent('offcanvas:show'));
    }
    
    /**
     * Hide the offcanvas
     */
    hide() {
        if (!this.offcanvas) return;
        
        // Hide offcanvas with slide animation
        this.offcanvas.classList.add('translate-x-full');
        this.offcanvas.setAttribute('aria-hidden', 'true');
        
        // Fade out and remove backdrop
        if (this.backdrop) {
            this.backdrop.style.opacity = '0';
            setTimeout(() => {
                this.backdrop?.remove();
                this.backdrop = null;
            }, 300);
        }
        
        // Restore body scroll
        document.body.classList.remove('overflow-hidden');
        
        // Update toggle button aria-expanded
        const toggleBtn = document.querySelector(`[data-bs-target="#${this.offcanvas.id}"]`);
        if (toggleBtn) {
            toggleBtn.setAttribute('aria-expanded', 'false');
        }
        
        // Dispatch hide event
        this.offcanvas.dispatchEvent(new CustomEvent('offcanvas:hide'));
    }
    
    /**
     * Set up close button listeners
     */
    setupCloseButtons() {
        if (!this.offcanvas) return;
        
        const closeButtons = this.offcanvas.querySelectorAll('[data-dismiss="offcanvas"], [data-bs-dismiss="offcanvas"]');
        closeButtons.forEach(btn => {
            btn.addEventListener('click', () => this.hide());
        });
    }
}

/**
 * Tabs Component - Replaces Bootstrap tabs
 * Provides tab switching functionality
 */
class Tabs {
    /**
     * Switch to a specific tab
     * @param {string} tabId - ID of the tab pane to show
     */
    static switchTab(tabId) {
        // Hide all tab panes
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.remove('show', 'active');
            pane.setAttribute('aria-hidden', 'true');
        });
        
        // Deactivate all tab buttons
        document.querySelectorAll('[role="tab"]').forEach(btn => {
            btn.classList.remove('active');
            btn.setAttribute('aria-selected', 'false');
            btn.setAttribute('tabindex', '-1');
        });
        
        // Show target tab pane
        const targetPane = document.getElementById(tabId);
        if (targetPane) {
            targetPane.classList.add('show', 'active');
            targetPane.setAttribute('aria-hidden', 'false');
        }
        
        // Activate corresponding button
        const targetBtn = document.querySelector(`[data-bs-target="#${tabId}"]`);
        if (targetBtn) {
            targetBtn.classList.add('active');
            targetBtn.setAttribute('aria-selected', 'true');
            targetBtn.setAttribute('tabindex', '0');
        }
        
        // Dispatch tab change event
        document.dispatchEvent(new CustomEvent('tab:change', {
            detail: { tabId }
        }));
    }
    
    /**
     * Initialize all tab buttons in the document
     */
    static initAll() {
        document.querySelectorAll('[data-bs-toggle="tab"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const target = btn.getAttribute('data-bs-target');
                if (target) {
                    const tabId = target.replace('#', '');
                    Tabs.switchTab(tabId);
                }
            });
        });
    }
}

/**
 * Alert Component - Simple alert/toast notifications
 */
class Alert {
    /**
     * Show an alert message
     * @param {string} message - Alert message
     * @param {string} type - Alert type (success, danger, warning, info)
     * @param {number} duration - Auto-dismiss duration in ms (0 = manual dismiss)
     */
    static show(message, type = 'info', duration = 5000) {
        const alertDiv = document.createElement('div');
        alertDiv.className = `vp-alert-${type} relative px-4 py-3 rounded-lg mb-3 transition-opacity duration-300`;
        alertDiv.setAttribute('role', 'alert');
        alertDiv.innerHTML = `
            <span class="block sm:inline">${message}</span>
            <button type="button" class="absolute top-0 right-0 px-4 py-3 text-current opacity-70 hover:opacity-100" aria-label="Close">
                <i class="bi bi-x-lg"></i>
            </button>
        `;
        
        // Add close button listener
        const closeBtn = alertDiv.querySelector('button');
        closeBtn.addEventListener('click', () => {
            alertDiv.style.opacity = '0';
            setTimeout(() => alertDiv.remove(), 300);
        });
        
        // Add to container or body
        let container = document.getElementById('alert-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'alert-container';
            container.className = 'fixed top-20 right-4 z-50 max-w-md';
            document.body.appendChild(container);
        }
        
        container.appendChild(alertDiv);
        
        // Trigger fade-in
        setTimeout(() => {
            alertDiv.style.opacity = '1';
        }, 10);
        
        // Auto-dismiss
        if (duration > 0) {
            setTimeout(() => {
                alertDiv.style.opacity = '0';
                setTimeout(() => alertDiv.remove(), 300);
            }, duration);
        }
    }
}

/**
 * Initialize UI components when DOM is ready
 */
function initUIComponents() {
    // Initialize all tabs
    Tabs.initAll();
    
    // Initialize all toggle buttons for offcanvas
    document.querySelectorAll('[data-bs-toggle="offcanvas"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const target = btn.getAttribute('data-bs-target');
            if (target) {
                const offcanvasId = target.replace('#', '');
                const offcanvas = new Offcanvas(offcanvasId);
                offcanvas.toggle();
            }
        });
    });
    
    // Initialize all toggle buttons for modals
    document.querySelectorAll('[data-bs-toggle="modal"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const target = btn.getAttribute('data-bs-target');
            if (target) {
                const modalId = target.replace('#', '');
                const modal = new Modal(modalId);
                modal.show();
            }
        });
    });
    
    Logger.info('UI Components initialized (Modal, Offcanvas, Tabs)');
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUIComponents);
} else {
    initUIComponents();
}

// Export to window for global access
window.Modal = Modal;
window.Offcanvas = Offcanvas;
window.Tabs = Tabs;
window.Alert = Alert;

/**
 * Bootstrap Compatibility Shim
 * Provides bootstrap.Modal, bootstrap.Offcanvas, and bootstrap.Toast
 * for backward compatibility with code that still references Bootstrap APIs.
 * This allows the migration from Bootstrap to vanilla JS without breaking existing code.
 */
window.bootstrap = {
    /**
     * Modal compatibility wrapper
     */
    Modal: class {
        constructor(element) {
            this.element = typeof element === 'string' ? document.getElementById(element) : element;
            if (this.element) {
                this._modal = new Modal(this.element.id);
            }
        }
        
        show() {
            if (this._modal) this._modal.show();
        }
        
        hide() {
            if (this._modal) this._modal.hide();
        }
        
        toggle() {
            if (this._modal) this._modal.toggle();
        }
        
        static getInstance(element) {
            const el = typeof element === 'string' ? document.getElementById(element) : element;
            if (el) {
                return new window.bootstrap.Modal(el);
            }
            return null;
        }
    },
    
    /**
     * Offcanvas compatibility wrapper
     */
    Offcanvas: class {
        constructor(element) {
            this.element = typeof element === 'string' ? document.getElementById(element) : element;
            if (this.element) {
                this._offcanvas = new Offcanvas(this.element.id);
            }
        }
        
        show() {
            if (this._offcanvas) this._offcanvas.show();
        }
        
        hide() {
            if (this._offcanvas) this._offcanvas.hide();
        }
        
        toggle() {
            if (this._offcanvas) this._offcanvas.toggle();
        }
        
        static getInstance(element) {
            const el = typeof element === 'string' ? document.getElementById(element) : element;
            if (el) {
                return new window.bootstrap.Offcanvas(el);
            }
            return null;
        }
    },
    
    /**
     * Toast compatibility wrapper
     * Uses the global Toast controller instead of Bootstrap Toast
     */
    Toast: class {
        constructor(element, options = {}) {
            this.element = element;
            this.options = options;
        }
        
        show() {
            // Extract message from toast element
            const messageEl = this.element.querySelector('.toast-body');
            const message = messageEl ? messageEl.textContent : 'Notification';
            
            // Determine type from class
            let type = 'info';
            if (this.element.classList.contains('bg-success')) type = 'success';
            else if (this.element.classList.contains('bg-danger')) type = 'error';
            else if (this.element.classList.contains('bg-warning')) type = 'warning';
            
            // Use global Toast controller
            if (window.Toast && window.Toast.show) {
                window.Toast.show(message, type, {
                    duration: this.options.delay || 5000,
                    autoClose: this.options.autohide !== false
                });
            }
            
            // Remove the original element since we're using our own toast system
            if (this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
        }
        
        hide() {
            if (this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
        }
    },
    
    /**
     * Tab compatibility wrapper
     * Uses the vanilla Tabs class for tab switching
     */
    Tab: class {
        constructor(element) {
            this.element = typeof element === 'string' ? document.querySelector(element) : element;
        }
        
        show() {
            if (!this.element) return;
            
            // Get the target pane ID from data-bs-target
            const target = this.element.getAttribute('data-bs-target');
            if (target) {
                const tabId = target.replace('#', '');
                Tabs.switchTab(tabId);
            }
        }
        
        static getInstance(element) {
            return new window.bootstrap.Tab(element);
        }
    }
};

Logger.info('Bootstrap compatibility shim loaded');
