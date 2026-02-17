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

// FIX: Load .env file from explicit path instead of relying on current working directory
// This ensures environment variables are loaded correctly regardless of where node is started from
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Environment-aware logging: suppress verbose output in production
const isDev = process.env.NODE_ENV !== 'production';
const log = {
  info: (...args) => isDev && console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  always: (...args) => console.log(...args)
};

// STARTUP VALIDATION: Check working directory and environment
const projectRoot = path.join(__dirname, '..');
const expectedPackageJson = path.join(projectRoot, 'package.json');

if (!require('fs').existsSync(expectedPackageJson)) {
    console.error('❌ CRITICAL: Invalid working directory');
    console.error('📋 package.json not found at:', expectedPackageJson);
    console.error('📋 Server must be run from Voter project directory');
    console.error('🔧 Current directory:', process.cwd());
    console.error('🔧 Expected directory:', projectRoot);
    console.error('');
    console.error('✅ Correct startup command:');
    console.error('   cd C:\\Voter');
    console.error('   npm start');
    console.error('');
    process.exit(1);
}

log.info('✅ Working directory validated:', projectRoot);

// STARTUP VALIDATION: Fail fast if critical environment variables are missing
// This prevents the application from starting in a broken state and makes debugging easier
const apiKeys = require('./config/api-keys');
const keyValidation = apiKeys.validate();
if (!keyValidation.valid) {
    console.error('❌ CRITICAL: GOOGLE_MAPS_API_KEY not found in environment variables');
    console.error('📋 Make sure .env file exists in the project root directory (C:\\Voter\\.env)');
    console.error('📋 The .env file should contain: GOOGLE_MAPS_API_KEY=your_api_key_here');
    console.error('🛑 Server cannot start without Google Maps API key - exiting...');
    process.exit(1);
}
keyValidation.warnings.forEach(w => console.warn(`⚠️  ${w}`));

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
// Split read vs write: GET requests need higher limits for rapid filter changes
const apiReadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 read requests per window
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers
});

const apiWriteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 write requests per window
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply different rate limits for read vs write operations
app.use('/api/', (req, res, next) => {
    if (req.method === 'GET') {
        apiReadLimiter(req, res, next);
    } else {
        apiWriteLimiter(req, res, next);
    }
});

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

// Static file serving - Vite-built frontend from frontend/dist
const frontendDist = path.join(__dirname, '../frontend/dist');
const frontendFallback = path.join(__dirname, '../frontend/public');
const servePath = require('fs').existsSync(frontendDist) ? frontendDist : frontendFallback;

app.use(express.static(servePath, {
    setHeaders: (res, filePath) => {
        // Vite hashed assets get long cache; everything else gets short cache
        if (/\.[a-f0-9]{8}\.(js|css)$/.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

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
        log.info('📊 Database Stats:', stats);
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
            googleMapsApiKey: apiKeys.mapsApiKey,
            
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
            status: stats ? 'healthy' : 'degraded',
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
 * API 404 handler — catch ALL methods for unmatched /api/* routes
 * Must come BEFORE the SPA catch-all to ensure API requests get JSON responses
 */
app.all('/api/*', (req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `API route ${req.method} ${req.path} not found`,
        timestamp: new Date().toISOString()
    });
});

/**
 * Serve index.html for all non-API GET routes (SPA support)
 * Serves from Vite dist/ build if available, otherwise falls back to frontend/public
 */
app.get('*', (req, res) => {
    const distIndex = path.join(__dirname, '../frontend/dist/index.html');
    const fallbackIndex = path.join(__dirname, '../frontend/public/index.html');
    const indexPath = require('fs').existsSync(distIndex) ? distIndex : fallbackIndex;
    res.sendFile(indexPath);
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * 404 handler for non-GET requests to non-API routes
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
// GLOBAL ERROR HANDLERS
// ============================================================================

/**
 * CRITICAL: Global error handlers for uncaught exceptions and unhandled rejections
 * These prevent silent failures and ensure proper logging before process termination
 * Source: Node.js Official Documentation - https://nodejs.org/api/process.html
 */

// Handle uncaught exceptions (synchronous errors not caught by try-catch)
process.on('uncaughtException', (error, origin) => {
    console.error('='.repeat(80));
    console.error('💥 FATAL: Uncaught Exception');
    console.error('Time:', new Date().toISOString());
    console.error('Origin:', origin);
    console.error('Error:', error.name);
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    console.error('='.repeat(80));
    
    // Attempt cleanup before termination
    // Per Node.js docs: must exit after uncaughtException (app state is undefined)
    try {
        if (database && database.isConnected) {
            database.close().then(() => {
                log.always('✅ Database connection closed');
                process.exit(1);
            }).catch((cleanupError) => {
                console.error('❌ Database cleanup failed:', cleanupError);
                process.exit(1);
            });
        } else {
            process.exit(1);
        }
    } catch (cleanupError) {
        console.error('❌ Cleanup failed:', cleanupError);
        process.exit(1);
    }
});

// Handle unhandled promise rejections (async errors without .catch())
process.on('unhandledRejection', (reason, promise) => {
    console.error('='.repeat(80));
    console.error('⚠️  CRITICAL: Unhandled Promise Rejection');
    console.error('Time:', new Date().toISOString());
    console.error('Promise:', promise);
    console.error('Reason:', reason);
    if (reason instanceof Error) {
        console.error('Stack:', reason.stack);
    }
    console.error('='.repeat(80));
    
    // In Node.js v15+, unhandled rejections will terminate the process
    // Log with full context for debugging
    // Consider: In production, send alerts to monitoring service
});

// Warning handler (useful for detecting deprecated API usage)
process.on('warning', (warning) => {
    console.warn('⚠️  Node.js Warning:');
    console.warn('Name:', warning.name);
    console.warn('Message:', warning.message);
    if (warning.stack) {
        console.warn('Stack:', warning.stack);
    }
});

// ============================================================================
// SERVER STARTUP & SHUTDOWN
// ============================================================================

// Store server instance globally for graceful shutdown
let server;
let isShuttingDown = false;

/**
 * Graceful shutdown handler
 * Ensures clean resource cleanup before process termination
 * Source: Node.js Best Practices - Graceful Shutdown Pattern
 */
const gracefulShutdown = async (signal) => {
    if (isShuttingDown) {
        log.always('Shutdown already in progress...');
        return;
    }
    
    isShuttingDown = true;
    log.always('='.repeat(80));
    log.always(`🛑 ${signal} received - Starting graceful shutdown`);
    log.always('='.repeat(80));
    
    // 1. Stop accepting new connections
    if (server) {
        server.close(() => {
            log.always('✅ HTTP server closed - no longer accepting connections');
        });
    }
    
    // 2. Wait for existing requests to complete (with timeout)
    const shutdownTimeout = setTimeout(() => {
        console.error('⚠️  Graceful shutdown timeout (10s) - forcing exit');
        process.exit(1);
    }, 10000); // 10 second timeout
    
    // 3. Close database connections
    try {
        if (database && database.isConnected) {
            await database.close();
            log.always('✅ Database connection closed');
        }
    } catch (error) {
        console.error('❌ Error closing database:', error);
    }
    
    // 4. Clear shutdown timeout and exit cleanly
    clearTimeout(shutdownTimeout);
    log.always('✅ Graceful shutdown complete');
    log.always('='.repeat(80));
    process.exit(0);
};

/**
 * Start the Express server with comprehensive error handling
 * Handles port conflicts (EADDRINUSE) and permission errors (EACCES)
 */
const startServer = async () => {
    try {
        // Initialize database first
        await initializeDatabase();
        
        // Start HTTP server with error handling
        server = app.listen(PORT, HOST, () => {
            log.always(`\n🚀 Server running at http://${HOST}:${PORT}`);
            log.always(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
            log.always(`🗺️  Google Maps API: ${process.env.GOOGLE_MAPS_API_KEY ? 'Configured' : 'NOT CONFIGURED'}`);
            log.always('\n✅ Ready to accept requests\n');
        });
        
        // Handle server errors (port conflicts, permission issues)
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error('='.repeat(80));
                console.error('❌ PORT CONFLICT ERROR');
                console.error(`Port ${PORT} is already in use`);
                console.error('='.repeat(80));
                console.error('\n💡 Solutions:');
                console.error(`1. Kill the process using port ${PORT}:`);
                console.error('   Windows: Get-Process -Name node | Stop-Process -Force');
                console.error('   Linux/Mac: killall node');
                console.error(`2. Change PORT in .env file to a different value`);
                console.error('3. Find process using port:');
                console.error(`   Windows: netstat -ano | findstr :${PORT}`);
                console.error(`   Linux/Mac: lsof -i :${PORT}\n`);
                console.error('='.repeat(80));
                process.exit(1);
            } else if (error.code === 'EACCES') {
                console.error('='.repeat(80));
                console.error('❌ PERMISSION ERROR');
                console.error(`Permission denied to bind to port ${PORT}`);
                console.error('Ports below 1024 require administrator privileges');
                console.error('='.repeat(80));
                process.exit(1);
            } else {
                console.error('='.repeat(80));
                console.error('❌ SERVER ERROR');
                console.error('Error Code:', error.code);
                console.error('Error Message:', error.message);
                console.error('Stack:', error.stack);
                console.error('='.repeat(80));
                process.exit(1);
            }
        });
        
    } catch (error) {
        console.error('='.repeat(80));
        console.error('❌ Server startup failed');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        console.error('='.repeat(80));
        
        // Cleanup on startup failure
        try {
            await database.close();
        } catch (cleanupError) {
            console.error('Database cleanup error:', cleanupError);
        }
        process.exit(1);
    }
};

// Register shutdown handlers for graceful termination
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start the server
startServer();

module.exports = app;
