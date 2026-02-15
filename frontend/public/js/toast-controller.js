/**
 * Toast Controller
 * Manages toast notifications for user feedback
 * Phase 4: Enhanced Interactivity
 */
class ToastController {
    constructor() {
        this.toasts = [];
        this.container = null;
        this.maxToasts = 5;
        this.defaultDuration = 5000; // 5 seconds
        this.init();
    }

    /**
     * Initialize toast controller
     */
    init() {
        // Create toast container if it doesn't exist
        this.container = document.querySelector('.vp-toast-container');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'vp-toast-container';
            this.container.setAttribute('role', 'region');
            this.container.setAttribute('aria-label', 'Notifications');
            this.container.setAttribute('aria-live', 'polite');
            document.body.appendChild(this.container);
        }
        Logger.info('✅ Toast Controller initialized');
    }

    /**
     * Show a toast notification
     * @param {string} message - Toast message
     * @param {string} type - Toast type (success, error, warning, info)
     * @param {Object} options - Additional options
     * @returns {string} Toast ID
     */
    show(message, type = 'info', options = {}) {
        const {
            title = null,
            duration = this.defaultDuration,
            dismissible = true,
            autoClose = true
        } = options;

        // Generate unique ID
        const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Remove oldest toast if we've hit the limit
        if (this.toasts.length >= this.maxToasts) {
            this.dismiss(this.toasts[0].id);
        }

        // Create toast element
        const toast = this.createToastElement(id, message, type, title, dismissible, duration, autoClose);

        // Add to container
        this.container.appendChild(toast);

        // Store toast reference
        this.toasts.push({
            id,
            element: toast,
            type,
            message
        });

        // Trigger entrance animation
        requestAnimationFrame(() => {
            toast.classList.add('vp-toast--visible');
        });

        // Auto-dismiss if enabled
        if (autoClose && duration > 0) {
            setTimeout(() => {
                this.dismiss(id);
            }, duration);
        }

        // Announce to screen readers
        this.announceToScreenReader(message, type);

        return id;
    }

    /**
     * Create toast DOM element
     * @private
     */
    createToastElement(id, message, type, title, dismissible, duration, autoClose) {
        const toast = document.createElement('div');
        toast.className = `vp-toast vp-toast--${type}`;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('data-toast-id', id);

        // Icon
        const icon = this.getIcon(type);
        const iconElement = document.createElement('div');
        iconElement.className = 'vp-toast__icon';
        iconElement.innerHTML = icon;
        toast.appendChild(iconElement);

        // Content
        const content = document.createElement('div');
        content.className = 'vp-toast__content';

        if (title) {
            const titleElement = document.createElement('div');
            titleElement.className = 'vp-toast__title';
            titleElement.textContent = title;
            content.appendChild(titleElement);
        }

        const messageElement = document.createElement('div');
        messageElement.className = 'vp-toast__message';
        messageElement.textContent = message;
        content.appendChild(messageElement);

        toast.appendChild(content);

        // Close button
        if (dismissible) {
            const closeButton = document.createElement('button');
            closeButton.className = 'vp-toast__close';
            closeButton.setAttribute('aria-label', 'Close notification');
            closeButton.innerHTML = '<i class="bi bi-x-lg"></i>';
            closeButton.onclick = () => this.dismiss(id);
            toast.appendChild(closeButton);
        }

        // Progress bar
        if (autoClose && duration > 0) {
            const progress = document.createElement('div');
            progress.className = 'vp-toast__progress';
            progress.style.animationDuration = `${duration}ms`;
            toast.appendChild(progress);
        }

        return toast;
    }

    /**
     * Get icon for toast type
     * @private
     */
    getIcon(type) {
        const icons = {
            success: '<i class="bi bi-check-circle-fill"></i>',
            error: '<i class="bi bi-exclamation-circle-fill"></i>',
            warning: '<i class="bi bi-exclamation-triangle-fill"></i>',
            info: '<i class="bi bi-info-circle-fill"></i>'
        };
        return icons[type] || icons.info;
    }

    /**
     * Dismiss a toast
     * @param {string} id - Toast ID
     */
    dismiss(id) {
        const toastIndex = this.toasts.findIndex(t => t.id === id);
        if (toastIndex === -1) return;

        const toast = this.toasts[toastIndex];
        
        // Add exit animation
        toast.element.classList.add('vp-toast--removing');

        // Remove after animation
        setTimeout(() => {
            if (toast.element.parentNode) {
                toast.element.parentNode.removeChild(toast.element);
            }
            this.toasts.splice(toastIndex, 1);
        }, 500); // Match animation duration
    }

    /**
     * Dismiss all toasts
     */
    dismissAll() {
        const toastIds = this.toasts.map(t => t.id);
        toastIds.forEach(id => this.dismiss(id));
    }

    /**
     * Show success toast
     * @param {string} message - Toast message
     * @param {Object} options - Additional options
     * @returns {string} Toast ID
     */
    success(message, options = {}) {
        return this.show(message, 'success', {
            title: options.title || 'Success',
            ...options
        });
    }

    /**
     * Show error toast
     * @param {string} message - Toast message
     * @param {Object} options - Additional options
     * @returns {string} Toast ID
     */
    error(message, options = {}) {
        return this.show(message, 'error', {
            title: options.title || 'Error',
            duration: options.duration || 7000, // Errors stay longer
            ...options
        });
    }

    /**
     * Show warning toast
     * @param {string} message - Toast message
     * @param {Object} options - Additional options
     * @returns {string} Toast ID
     */
    warning(message, options = {}) {
        return this.show(message, 'warning', {
            title: options.title || 'Warning',
            ...options
        });
    }

    /**
     * Show info toast
     * @param {string} message - Toast message
     * @param {Object} options - Additional options
     * @returns {string} Toast ID
     */
    info(message, options = {}) {
        return this.show(message, 'info', {
            title: options.title || 'Info',
            ...options
        });
    }

    /**
     * Announce to screen readers
     * @private
     */
    announceToScreenReader(message, type) {
        const announcement = document.createElement('div');
        announcement.className = 'vp-sr-only';
        announcement.setAttribute('role', 'status');
        announcement.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
        announcement.textContent = message;
        
        document.body.appendChild(announcement);
        
        // Remove after announcement
        setTimeout(() => {
            document.body.removeChild(announcement);
        }, 1000);
    }

    /**
     * Destroy toast controller
     */
    destroy() {
        this.dismissAll();
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.toasts = [];
        this.container = null;
    }
}

// Create global toast instance
window.Toast = new ToastController();

// Also create a simpler global utility function for backward compatibility
window.showToast = (message, type = 'info', options = {}) => {
    return window.Toast.show(message, type, options);
};
