/**
 * Service Worker for Voter Outreach Platform
 * Provides offline support with cache-first for static assets
 * and network-first for API calls and navigation
 */

var CACHE_NAME = 'voter-platform-v1';

var STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/output.css',
    '/manifest.json',
    '/js/logger.js',
    '/js/config.js',
    '/js/theme-controller.js',
    '/js/utils.js',
    '/js/state-manager.js',
    '/js/voter-service.js',
    '/js/upload-service.js',
    '/js/upload-controller.js',
    '/js/map-controller.js',
    '/js/filter-controller.js',
    '/js/voter-list-controller.js',
    '/js/virtual-scroller.js',
    '/js/chart-controller.js',
    '/js/target-list-controller.js',
    '/js/route-planner-controller.js',
    '/js/ui-components.js',
    '/js/keyboard-controller.js',
    '/js/toast-controller.js',
    '/js/app.js'
];

// Install: pre-cache core static assets
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(STATIC_ASSETS);
        }).then(function() {
            return self.skipWaiting();
        })
    );
});

// Activate: clean up old cache versions
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames
                    .filter(function(name) { return name !== CACHE_NAME; })
                    .map(function(name) { return caches.delete(name); })
            );
        }).then(function() {
            return self.clients.claim();
        })
    );
});

// Fetch: strategy depends on request type
self.addEventListener('fetch', function(event) {
    var url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip cross-origin requests (CDN libraries, Google Maps, etc.)
    if (url.origin !== self.location.origin) return;

    // API calls: network-first with cache fallback
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirstWithCache(event.request));
        return;
    }

    // Navigation/HTML: network-first with cache fallback
    if (event.request.mode === 'navigate' || event.request.headers.get('accept').indexOf('text/html') !== -1) {
        event.respondWith(networkFirstWithCache(event.request));
        return;
    }

    // Static assets (CSS, JS, images): cache-first with network fallback
    event.respondWith(cacheFirstWithNetwork(event.request));
});

/**
 * Network-first strategy: try network, fall back to cache
 */
function networkFirstWithCache(request) {
    return fetch(request).then(function(response) {
        // Cache successful responses
        if (response.ok) {
            var responseClone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
                cache.put(request, responseClone);
            });
        }
        return response;
    }).catch(function() {
        return caches.match(request);
    });
}

/**
 * Cache-first strategy: try cache, fall back to network
 */
function cacheFirstWithNetwork(request) {
    return caches.match(request).then(function(cached) {
        if (cached) return cached;

        return fetch(request).then(function(response) {
            if (response.ok) {
                var responseClone = response.clone();
                caches.open(CACHE_NAME).then(function(cache) {
                    cache.put(request, responseClone);
                });
            }
            return response;
        });
    });
}
