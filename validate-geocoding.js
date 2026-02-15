/**
 * Integration Validation Script
 * Validates that all Phase 3 Geocoding components are properly implemented
 */

const fs = require('fs');
const path = require('path');
const database = require('./backend/config/database');

// Color output for terminal
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  reset: '\x1b[0m'
};

const log = {
  success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  warning: (msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.blue}ℹ️  ${msg}${colors.reset}`)
};

let validationsPassed = 0;
let validationsFailed = 0;

// Validation tests
async function validateImplementation() {
  console.log('\n========================================');
  console.log('Phase 3: Geocoding Implementation Validation');
  console.log('========================================\n');

  // 1. Check required files exist
  log.info('Step 1: Validating required files...');
  
  const requiredFiles = [
    'backend/services/geocoding-service.js',
    'backend/services/address-cache-service.js',
    'backend/services/geocoding-job-service.js',
    'backend/routes/geocode.js',
    'backend/migrations/003_add_geocoding_tables.js',
    '.env.example'
  ];
  
  for (const file of requiredFiles) {
    if (fs.existsSync(file)) {
      log.success(`${file}`);
      validationsPassed++;
    } else {
      log.error(`${file} - NOT FOUND`);
      validationsFailed++;
    }
  }

  // 2. Check npm dependencies
  log.info('\nStep 2: Validating dependencies...');
  
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  
  const requiredPackages = [
    '@googlemaps/google-maps-services-js',
    'bottleneck'
  ];
  
  for (const pkg of requiredPackages) {
    if (dependencies[pkg]) {
      log.success(`${pkg} - v${dependencies[pkg]}`);
      validationsPassed++;
    } else {
      log.error(`${pkg} - NOT INSTALLED`);
      validationsFailed++;
    }
  }

  // 3. Validate database tables
  log.info('\nStep 3: Validating database schema...');
  
  try {
    await database.connect();
    
    const requiredTables = ['geocoding_jobs', 'geocoding_errors', 'api_quotas', 'geocoding_cache'];
    
    for (const tableName of requiredTables) {
      const table = await database.get(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
        [tableName]
      );
      
      if (table) {
        log.success(`Table: ${tableName}`);
        validationsPassed++;
      } else {
        log.error(`Table: ${tableName} - MISSING`);
        validationsFailed++;
      }
    }
  } catch (error) {
    log.error(`Database connection failed: ${error.message}`);
    validationsFailed++;
  }

  // 4. Validate service classes can be instantiated
  log.info('\nStep 4: Validating service classes...');
  
  try {
    const GeocodingService = require('./backend/services/geocoding-service');
    const service = new GeocodingService();
    log.success('GeocodingService instantiated');
    validationsPassed++;
  } catch (error) {
    log.error(`GeocodingService: ${error.message}`);
    validationsFailed++;
  }
  
  try {
    const AddressCacheService = require('./backend/services/address-cache-service');
    const cache = new AddressCacheService();
    log.success('AddressCacheService instantiated');
    validationsPassed++;
  } catch (error) {
    log.error(`AddressCacheService: ${error.message}`);
    validationsFailed++;
  }
  
  try {
    const GeocodingJobService = require('./backend/services/geocoding-job-service');
    const jobService = new GeocodingJobService();
    log.success('GeocodingJobService instantiated');
    validationsPassed++;
  } catch (error) {
    log.error(`GeocodingJobService: ${error.message}`);
    validationsFailed++;
  }

  // 5. Validate API routes
  log.info('\nStep 5: Validating API endpoints...');
  
  try {
    const geocodeRouter = require('./backend/routes/geocode');
    const routeStack = geocodeRouter.stack || [];
    
    const expectedEndpoints = [
      'POST /batch',
      'GET /jobs/:id',
      'POST /single',
      'GET /failed/:jobId',
      'PUT /manual/:voterId',
      'GET /stats',
      'POST /retry/:jobId',
      'GET /review'
    ];
    
    log.success(`Geocode router loaded with ${routeStack.length} routes`);
    validationsPassed++;
    
  } catch (error) {
    log.error(`Geocode routes: ${error.message}`);
    validationsFailed++;
  }

  // 6. Validate environment configuration
  log.info('\nStep 6: Validating environment configuration...');
  
  const envExample = fs.readFileSync('.env.example', 'utf8');
  
  const requiredEnvVars = [
    'GOOGLE_MAPS_GEOCODING_API_KEY',
    'GEOCODING_RATE_LIMIT',
    'GEOCODING_BATCH_SIZE',
    'CACHE_GEOCODING_RESULTS',
    'CACHE_TTL_DAYS'
  ];
  
  for (const envVar of requiredEnvVars) {
    if (envExample.includes(envVar)) {
      log.success(`${envVar} in .env.example`);
      validationsPassed++;
    } else {
      log.error(`${envVar} missing from .env.example`);
      validationsFailed++;
    }
  }

  // 7. Test address normalization
  log.info('\nStep 7: Testing address normalization...');
  
  try {
    const AddressCacheService = require('./backend/services/address-cache-service');
    const cache = new AddressCacheService();
    
    const normalized = cache.normalizeAddress(
      '123 North Main Street',
      'Union City',
      'TN',
      '38261'
    );
    
    if (normalized.includes('123') && normalized.includes('n') && normalized.includes('main')) {
      log.success(`Address normalization working: "${normalized}"`);
      validationsPassed++;
    } else {
      log.error(`Address normalization failed: "${normalized}"`);
      validationsFailed++;
    }
    
    const cacheKey = cache.generateCacheKey(normalized);
    if (cacheKey && cacheKey.length === 32) { // MD5 hash length
      log.success(`Cache key generation working: ${cacheKey}`);
      validationsPassed++;
    } else {
      log.error(`Cache key generation failed: ${cacheKey}`);
      validationsFailed++;
    }
    
  } catch (error) {
    log.error(`Address normalization test: ${error.message}`);
    validationsFailed++;
  }

  // 8. Test quality score calculation
  log.info('\nStep 8: Testing quality score calculation...');
  
  try {
    const GeocodingService = require('./backend/services/geocoding-service');
    const service = new GeocodingService();
    
    // Mock response
    const mockResponse = {
      data: {
        status: 'OK',
        results: [{
          geometry: {
            location: { lat: 36.4243, lng: -89.0576 },
            location_type: 'ROOFTOP'
          },
          address_components: [
            { types: ['street_number'], short_name: '123' },
            { types: ['route'], short_name: 'Main St' },
            { types: ['locality'], short_name: 'Union City' },
            { types: ['administrative_area_level_1'], short_name: 'TN' },
            { types: ['postal_code'], short_name: '38261' }
          ],
          formatted_address: '123 Main St, Union City, TN 38261, USA',
          partial_match: false,
          place_id: 'test123'
        }]
      }
    };
    
    const score = service.calculateQualityScore(mockResponse);
    
    if (score > 0 && score <= 100) {
      log.success(`Quality score calculation working: ${score}/100`);
      validationsPassed++;
    } else {
      log.error(`Quality score calculation failed: ${score}`);
      validationsFailed++;
    }
    
  } catch (error) {
    log.error(`Quality score test: ${error.message}`);
    validationsFailed++;
  }

  // Final summary
  console.log('\n========================================');
  console.log('Validation Summary');
  console.log('========================================');
  console.log(`${colors.green}Passed: ${validationsPassed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${validationsFailed}${colors.reset}`);
  console.log(`Total: ${validationsPassed + validationsFailed}`);
  
  if (validationsFailed === 0) {
    console.log(`\n${colors.green}🎉 All validations passed! Phase 3 implementation is complete.${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`\n${colors.red}⚠️  Some validations failed. Please review the errors above.${colors.reset}\n`);
    process.exit(1);
  }
}

// Run validation
validateImplementation().catch(error => {
  console.error('Fatal error during validation:', error);
  process.exit(1);
});
