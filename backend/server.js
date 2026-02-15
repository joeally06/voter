/**
 * Voter Outreach Platform - Express Server
 * Phase 1: Core Infrastructure Setup
 * 
 * This server provides:
 * - RESTful API endpoints for voter data management
 * - Static file serving for frontend
 * - Database connection management
 * - Error handling and logging
 */

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { validationResult } = require('express-validator');
require('dotenv').config();

const database = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

// ============================================================================
// MIDDLEWARE CONFIGURATION
// ============================================================================

// Security middleware - Helmet protects against common vulnerabilities
app.use(helmet({
    contentSecurityPolicy: false  // Allow Google Maps inline scripts for Phase 3
}));

// CORS configuration - Allow cross-origin requests
app.use(cors({
    origin: process.env.CORS_ORIGIN || `http://localhost:${PORT}`,
    credentials: true
}));

// Request parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Response compression
app.use(compression());

// HTTP request logging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// SECURITY ENHANCEMENT: Rate limiting to prevent API abuse and DoS attacks
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers
});

// Apply rate limiting to all API routes
app.use('/api/', apiLimiter);

// Stricter rate limiting for upload endpoint (potential abuse vector)
// FIX: Exempt GET requests (status checks) from upload rate limiting to prevent 429 errors during polling
// Only apply rate limiting to actual file uploads (POST requests)
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // Limit uploads to 10 per hour per IP
    message: 'Too many file uploads, please try again later.',
    skip: (req, res) => {
        // Skip rate limiting for status checks (GET requests)
        // Status checks are read-only and still protected by general API limiter (100/15min)
        return req.method === 'GET';
    }
});

app.use('/api/upload', uploadLimiter);

// Static file serving - Frontend files from public directory
app.use(express.static(path.join(__dirname, '../frontend/public')));

// ============================================================================
// DATABASE INITIALIZATION
// ============================================================================

/**
 * Initialize database connection and verify schema
 */
const initializeDatabase = async () => {
    try {
        await database.connect();
        const stats = await database.getStats();
        console.log('📊 Database Stats:', stats);
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        process.exit(1);
    }
};

// ============================================================================
// API ROUTES
// ============================================================================

/**
 * Configuration endpoint
 * GET /api/config
 * Returns client-safe configuration (API keys, feature flags)
 */
/**
 * Configuration endpoint
 * GET /api/config
 * Returns comprehensive client-safe configuration
 * 
 * ENHANCEMENT: Provides all frontend configuration including geographic,
 * organization, performance, and styling settings
 */
app.get('/api/config', (req, res) => {
    try {
        const config = {
            // Google Maps Integration
            googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
            
            // API Configuration (derived from current deployment)
            apiBaseUrl: '/api',
            uploadApiUrl: '/api/upload',
            
            // Geographic Settings
            locationName: process.env.LOCATION_NAME || 'Obion County, TN',
            mapCenter: {
                lat: parseFloat(process.env.MAP_CENTER_LAT || '36.2639'),
                lng: parseFloat(process.env.MAP_CENTER_LNG || '-89.1929')
            },
            mapZoom: parseInt(process.env.MAP_DEFAULT_ZOOM || '11', 10),
            maxAutoZoom: parseInt(process.env.MAP_MAX_AUTO_ZOOM || '16', 10),
            
            // Organization Settings
            organizationName: process.env.ORGANIZATION_NAME || 'Obion County Election Commission',
            copyrightYear: process.env.COPYRIGHT_YEAR 
                ? parseInt(process.env.COPYRIGHT_YEAR, 10) 
                : new Date().getFullYear(),
            appVersion: process.env.APP_VERSION || require('../package.json').version || '4.0.0',
            
            // Map Display Configuration
            markerClusterThreshold: parseInt(process.env.MARKER_CLUSTER_THRESHOLD || '100', 10),
            clusterRadius: parseInt(process.env.CLUSTER_RADIUS || '100', 10),
            markerColors: {
                superVoter: process.env.MARKER_COLOR_SUPER || '#198754',
                regular: process.env.MARKER_COLOR_REGULAR || '#6c757d'
            },
            
            // Performance Configuration
            cacheTimeoutMs: parseInt(process.env.CACHE_TIMEOUT_MS || '300000', 10),
            maxCacheSize: parseInt(process.env.MAX_CACHE_SIZE || '50', 10),
            defaultPageSize: parseInt(process.env.DEFAULT_PAGE_SIZE || '1000', 10),
            
            // Upload Configuration
            maxUploadSizeBytes: parseInt(process.env.MAX_UPLOAD_SIZE_BYTES || '104857600', 10),
            uploadPolling: {
                minInterval: parseInt(process.env.UPLOAD_POLL_MIN_MS || '1000', 10),
                maxInterval: parseInt(process.env.UPLOAD_POLL_MAX_MS || '10000', 10)
            },
            
            // Network Configuration
            maxRetryAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS || '3', 10),
            
            // Styling Configuration
            chartColors: (() => {
                try {
                    return JSON.parse(process.env.CHART_COLORS || 'null') || [
                        '#0d6efd', '#198754', '#dc3545', '#ffc107',
                        '#0dcaf0', '#6c757d', '#6f42c1', '#fd7e14',
                        '#20c997', '#d63384'
                    ];
                } catch {
                    return [
                        '#0d6efd', '#198754', '#dc3545', '#ffc107',
                        '#0dcaf0', '#6c757d', '#6f42c1', '#fd7e14',
                        '#20c997', '#d63384'
                    ];
                }
            })(),
            
            // Feature Flags
            features: {
                routePlanning: process.env.ENABLE_ROUTE_PLANNING === 'true',
                dataExport: process.env.ENABLE_DATA_EXPORT !== 'false', // Default true
                analytics: process.env.ENABLE_ANALYTICS !== 'false', // Default true
                markerClustering: process.env.MAP_MARKER_CLUSTERING !== 'false' // Default true
            }
        };
        
        // Validate critical configuration
        if (!config.googleMapsApiKey) {
            console.warn('⚠️  WARNING: GOOGLE_MAPS_API_KEY not configured');
        }
        
        if (isNaN(config.mapCenter.lat) || isNaN(config.mapCenter.lng)) {
            console.warn('⚠️  WARNING: Invalid MAP_CENTER coordinates, using defaults');
            config.mapCenter = { lat: 36.2639, lng: -89.1929 };
        }
        
        res.json(config);
        
    } catch (error) {
        console.error('Error generating config:', error);
        res.status(500).json({
            error: 'Configuration Error',
            message: 'Failed to load application configuration',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Health check endpoint
 * GET /api/health
 * Returns server status and database statistics
 */
app.get('/api/health', async (req, res) => {
    try {
        const stats = await database.getStats();
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: stats,
            uptime: process.uptime()
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Mount API route modules
// CRITICAL FIX: More specific routes must come before general routes
// "/api/voters/never-voted" must be registered before "/api/voters/:id"
app.use('/api/voters/never-voted', require('./routes/never-voted'));
app.use('/api/voters', require('./routes/voters'));
app.use('/api/precincts', require('./routes/precincts'));
app.use('/api/geocode', require('./routes/geocode'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/routes', require('./routes/routes')); // Phase 5: Route Planning

// ============================================================================
// FRONTEND ROUTING
// ============================================================================

/**
 * Serve index.html for all non-API routes (SPA support)
 */
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * 404 handler for undefined routes
 */
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`,
        timestamp: new Date().toISOString()
    });
});

/**
 * Global error handler
 * Catches all errors passed to next(error)
 * ENHANCEMENT: Improved error logging with structured details
 */
app.use((err, req, res, next) => {
    // ENHANCEMENT: Structured error logging with request context
    console.error('='.repeat(80));
    console.error('ERROR OCCURRED:', new Date().toISOString());
    console.error('Path:', req.method, req.path);
    console.error('IP:', req.ip);
    console.error('Error Name:', err.name);
    console.error('Error Message:', err.message);
    if (err.stack) {
        console.error('Stack Trace:');
        console.error(err.stack);
    }
    console.error('='.repeat(80));
    
    res.status(err.status || 500).json({
        error: err.name || 'Internal Server Error',
        message: process.env.NODE_ENV === 'production' 
            ? 'An error occurred' 
            : err.message,
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

/**
 * Start the Express server
 */
const startServer = async () => {
    await initializeDatabase();
    
    app.listen(PORT, HOST, () => {
        console.log(`\n🚀 Server running at http://${HOST}:${PORT}`);
        console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🗺️  Google Maps API: ${process.env.GOOGLE_MAPS_API_KEY ? 'Configured' : 'NOT CONFIGURED'}`);
        console.log('\n✅ Ready to accept requests\n');
    });
};

// Graceful shutdown handler
process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM signal. Closing server gracefully...');
    await database.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT signal. Closing server gracefully...');
    await database.close();
    process.exit(0);
});

// Start the server
startServer();

module.exports = app;
