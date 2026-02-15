/**
 * Template Loader
 * Loads HTML template partials dynamically to reduce index.html monolith.
 * Templates are fetched once and cached in memory for subsequent use.
 */
class TemplateLoader {
    static cache = new Map();

    /**
     * Load an HTML template and insert it into a container element
     * @param {string} templatePath - Path to the template HTML file
     * @param {string} containerId - ID of the container element to insert into
     * @returns {Promise<boolean>} True if loaded successfully
     */
    static async load(templatePath, containerId) {
        try {
            let html = this.cache.get(templatePath);
            if (!html) {
                const response = await fetch(templatePath);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${templatePath}`);
                }
                html = await response.text();
                this.cache.set(templatePath, html);
            }
            const container = document.getElementById(containerId);
            if (container) {
                container.innerHTML = html;
                return true;
            }
            Logger.warn(`Template container not found: #${containerId}`);
            return false;
        } catch (error) {
            Logger.error(`Template load failed: ${templatePath}`, error);
            return false;
        }
    }

    /**
     * Load all application templates in parallel
     * Called during app initialization before controllers are set up
     * @returns {Promise<void>}
     */
    static async loadAll() {
        const templates = [
            { path: '/templates/upload-modal.html', container: 'upload-modal-container' },
            { path: '/templates/voter-detail-modal.html', container: 'voter-detail-container' },
            { path: '/templates/filter-offcanvas.html', container: 'filter-offcanvas-container' },
        ];

        const results = await Promise.allSettled(
            templates.map(t => this.load(t.path, t.container))
        );

        const loaded = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
        Logger.info(`Templates loaded: ${loaded}/${templates.length}`);
    }

    /**
     * Clear the template cache (useful for hot-reload during development)
     */
    static clearCache() {
        this.cache.clear();
    }
}

window.TemplateLoader = TemplateLoader;
