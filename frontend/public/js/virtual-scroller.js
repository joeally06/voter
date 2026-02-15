/**
 * VirtualScroller
 * Renders only visible rows in a scrollable container for performance
 * Works with existing table structure
 */
class VirtualScroller {
    constructor(options) {
        this.container = options.container;       // Scrollable wrapper div
        this.rowHeight = options.rowHeight || 52;  // Fixed row height in pixels
        this.bufferSize = options.bufferSize || 5; // Extra rows above/below viewport
        this.data = [];
        this.renderRow = options.renderRow;        // Function to render a single row
        this.totalHeight = 0;
        this.visibleRange = { start: -1, end: -1 };
        this.tbody = null;

        // Create spacer elements
        this.topSpacer = document.createElement('tr');
        this.topSpacer.setAttribute('aria-hidden', 'true');
        this.bottomSpacer = document.createElement('tr');
        this.bottomSpacer.setAttribute('aria-hidden', 'true');

        this._onScroll = this._onScroll.bind(this);
        this._ticking = false;
    }

    /**
     * Set data and trigger render
     * @param {Array} data - Array of items to render
     */
    setData(data) {
        this.data = data || [];
        this.totalHeight = this.data.length * this.rowHeight;
        this.visibleRange = { start: -1, end: -1 }; // Force re-render
        this.container.scrollTop = 0; // Reset scroll on data change
        this.render();
    }

    /**
     * Attach scroll listener to container
     */
    attach() {
        this.container.addEventListener('scroll', this._onScroll, { passive: true });
    }

    /**
     * Internal scroll handler using rAF
     */
    _onScroll() {
        if (!this._ticking) {
            requestAnimationFrame(() => {
                this.render();
                this._ticking = false;
            });
            this._ticking = true;
        }
    }

    /**
     * Render visible rows
     */
    render() {
        this.tbody = this.container.querySelector('tbody');
        if (!this.tbody) return;

        const scrollTop = this.container.scrollTop;
        const viewportHeight = this.container.clientHeight;

        // Calculate visible range
        const startIndex = Math.max(0, Math.floor(scrollTop / this.rowHeight) - this.bufferSize);
        const endIndex = Math.min(
            this.data.length,
            Math.ceil((scrollTop + viewportHeight) / this.rowHeight) + this.bufferSize
        );

        // Skip if range hasn't changed
        if (startIndex === this.visibleRange.start && endIndex === this.visibleRange.end) {
            return;
        }

        this.visibleRange = { start: startIndex, end: endIndex };

        // Clear and rebuild tbody
        this.tbody.innerHTML = '';

        // Top spacer
        const topHeight = startIndex * this.rowHeight;
        this.topSpacer.innerHTML = '<td colspan="7" style="height: ' + topHeight + 'px; padding: 0; border: none;"></td>';
        this.tbody.appendChild(this.topSpacer);

        // Render visible rows
        for (var i = startIndex; i < endIndex; i++) {
            var row = this.renderRow(this.data[i], i);
            if (row) {
                this.tbody.appendChild(row);
            }
        }

        // Bottom spacer
        var bottomSpace = (this.data.length - endIndex) * this.rowHeight;
        this.bottomSpacer.innerHTML = '<td colspan="7" style="height: ' + Math.max(0, bottomSpace) + 'px; padding: 0; border: none;"></td>';
        this.tbody.appendChild(this.bottomSpacer);
    }

    /**
     * Scroll to a specific row index
     * @param {number} index - Row index to scroll to
     */
    scrollToIndex(index) {
        this.container.scrollTop = index * this.rowHeight;
    }

    /**
     * Get currently rendered range info
     * @returns {Object} Visible range
     */
    getVisibleRange() {
        return { ...this.visibleRange };
    }

    /**
     * Destroy and clean up
     */
    destroy() {
        this.container.removeEventListener('scroll', this._onScroll);
        this.data = [];
        this.visibleRange = { start: -1, end: -1 };
    }
}

window.VirtualScroller = VirtualScroller;
