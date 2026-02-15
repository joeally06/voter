/**
 * Service Worker - Voter Outreach Platform
 * Provides offline support and caching strategies
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = 'voter-platform-' + CACHE_VERSION;
const API_CACHE_NAME = 'voter-api-' + CACHE_VERSION;

var STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/output.css',
    '/js/logger.js',
    '/js/ui-components.js',
    '/js/keyboard-controller.js',
    '/js/toast-controller.js',
    '/js/config.js',
    '/js/theme-controller.js',
    '/js/utils.js',
    '/js/state-manager.js',
    '/js/voter-service.js',
    '/js/upload-service.js',
    '/js/upload-controller.js',
    '/js/map-controller.js',
    '/js/filter-controller.js',
    '/js/virtual-scroller.js',
    '/js/voter-list-controller.js',
    '/js/chart-controller.js',
    '/js/target-list-controller.js',
    '/js/route-planner-controller.js',
    '/js/app.js'
];

// Install - cache static assets
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(
                keys
                    .filter(function(key) { return key !== CACHE_NAME && key !== API_CACHE_NAME; })
                    .map(function(key) { return caches.delete(key); })
            );
        })
    );
    self.clients.claim();
});

// Fetch - strategy-based caching
self.addEventListener('fetch', function(event) {
    var url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // API requests: Network-first with cache fallback
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirstWithCacheFallback(event.request));
        return;
    }

    // Static assets: Cache-first with network fallback
    event.respondWith(cacheFirstWithNetworkFallback(event.request));
});

function cacheFirstWithNetworkFallback(request) {
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
        }).catch(function() {
            return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        });
    });
}

function networkFirstWithCacheFallback(request) {
    return fetch(request).then(function(response) {
        if (response.ok) {
            var responseClone = response.clone();
            caches.open(API_CACHE_NAME).then(function(cache) {
                cache.put(request, responseClone);
            });
        }
        return response;
    }).catch(function() {
        return caches.match(request).then(function(cached) {
            if (cached) return cached;
            return new Response(
                JSON.stringify({ error: 'Offline', cached: false }),
                { status: 503, headers: { 'Content-Type': 'application/json' } }
            );
        });
    });
}
