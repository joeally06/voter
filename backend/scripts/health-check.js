/**
 * Backend Health Check Script
 * Comprehensive validation of database connectivity, schema, and configuration
 */

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

// Find project root
function findProjectRoot(startPath = __dirname) {
    let currentPath = startPath;
    const rootPath = path.parse(currentPath).root;
    
    while (currentPath !== rootPath) {
        if (fs.existsSync(path.join(currentPath, 'package.json'))) {
            return currentPath;
        }
        currentPath = path.dirname(currentPath);
    }
    
    throw new Error('Could not find project root (package.json not found)');
}

const projectRoot = findProjectRoot();
console.log('🏥 Backend Health Check\n');
console.log('='.repeat(80));
console.log(`📂 Project Root: ${projectRoot}\n`);

// All expected database tables
const REQUIRED_TABLES = [
    'voters',
    'election_history',
    'precincts',
    'geocoding_cache',
    'import_logs',
    'import_errors',
    'geocoding_jobs',
    'geocoding_errors',
    'api_quotas',
    'route_cache',
    'api_usage',
    'saved_routes'
];

async function checkDatabasePath() {
    console.log('📍 Database Path Resolution');
    console.log('-'.repeat(80));
    
    // Get DB path from environment or use default
    let dbPath = process.env.DB_PATH || path.join(projectRoot, 'data', 'voter_platform.db');
    
    // Convert relative paths to absolute
    if (!path.isAbsolute(dbPath)) {
        dbPath = path.join(projectRoot, dbPath);
    }
    
    console.log(`✅ Resolved Path: ${dbPath}`);
    
    // Check if file exists
    if (fs.existsSync(dbPath)) {
        const stats = fs.statSync(dbPath);
        console.log(`✅ Database File Exists (${(stats.size / 1024).toFixed(2)} KB)`);
        return dbPath;
    } else {
        console.log(`❌ Database File Not Found: ${dbPath}`);
        console.log(`🔧 Run: npm run setup`);
        return null;
    }
}

async function checkDatabaseConnection(dbPath) {
    return new Promise((resolve, reject) => {
        console.log('\n🔌 Database Connection');
        console.log('-'.repeat(80));
        
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.log('❌ Connection Failed:', err.message);
                reject(err);
            } else {
                console.log('✅ Connection Successful');
                resolve(db);
            }
        });
    });
}

async function checkDatabaseSchema(db) {
    return new Promise((resolve) => {
        console.log('\n📊 Database Schema Validation');
        console.log('-'.repeat(80));
        
        db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", [], (err, tables) => {
            if (err) {
                console.log('❌ Schema Check Failed:', err.message);
                resolve(false);
                return;
            }
            
            const existingTables = tables.map(t => t.name);
            const missingTables = REQUIRED_TABLES.filter(t => !existingTables.includes(t));
            const extraTables = existingTables.filter(t => 
                !REQUIRED_TABLES.includes(t) && !t.startsWith('sqlite_')
            );
            
            console.log(`📋 Total Tables: ${existingTables.length}`);
            console.log(`✅ Required Tables Found: ${REQUIRED_TABLES.length - missingTables.length}/${REQUIRED_TABLES.length}`);
            
            if (missingTables.length === 0) {
                console.log('✅ All required tables exist');
            } else {
                console.log(`❌ Missing Tables (${missingTables.length}):`, missingTables.join(', '));
                console.log('🔧 Run migrations: node backend/migrations/[migration-file].js');
            }
            
            if (extraTables.length > 0) {
                console.log(`ℹ️  Additional Tables: ${extraTables.join(', ')}`);
            }
            
            resolve(missingTables.length === 0);
        });
    });
}

async function checkDatabaseContent(db) {
    return new Promise((resolve) => {
        console.log('\n📈 Database Statistics');
        console.log('-'.repeat(80));
        
        const queries = [
            { label: 'Voters', sql: 'SELECT COUNT(*) as count FROM voters' },
            { label: 'Geocoded Voters', sql: 'SELECT COUNT(*) as count FROM voters WHERE latitude IS NOT NULL' },
            { label: 'Super Voters', sql: 'SELECT COUNT(*) as count FROM voters WHERE super_voter = 1' },
            { label: 'Precincts', sql: 'SELECT COUNT(*) as count FROM precincts' },
            { label: 'Election History Records', sql: 'SELECT COUNT(*) as count FROM election_history' },
            { label: 'Geocoding Cache Entries', sql: 'SELECT COUNT(*) as count FROM geocoding_cache' },
            { label: 'Import Logs', sql: 'SELECT COUNT(*) as count FROM import_logs' },
            { label: 'Saved Routes', sql: 'SELECT COUNT(*) as count FROM saved_routes' }
        ];
        
        let completed = 0;
        let hasData = false;
        
        queries.forEach(({ label, sql }) => {
            db.get(sql, [], (err, row) => {
                if (err) {
                    console.log(`⚠️  ${label}: Unable to query (${err.message})`);
                } else {
                    const count = row.count;
                    if (count > 0) {
                        console.log(`✅ ${label}: ${count.toLocaleString()}`);
                        hasData = true;
                    } else {
                        console.log(`ℹ️  ${label}: 0`);
                    }
                }
                
                completed++;
                if (completed === queries.length) {
                    if (!hasData) {
                        console.log('\n⚠️  Database is empty. Import voter data to get started.');
                    }
                    resolve(true);
                }
            });
        });
    });
}

async function checkEnvironment() {
    console.log('\n🔧 Environment Configuration');
    console.log('-'.repeat(80));
    
    const envPath = path.join(projectRoot, '.env');
    
    if (!fs.existsSync(envPath)) {
        console.log('❌ .env file not found');
        console.log('🔧 Copy .env.example to .env and configure');
        return false;
    }
    
    // Load .env file
    require('dotenv').config({ path: envPath });
    
    console.log('✅ .env file exists');
    
    const requiredVars = ['GOOGLE_MAPS_API_KEY'];
    const optionalVars = ['DB_PATH', 'PORT', 'NODE_ENV'];
    
    let allPresent = true;
    
    console.log('\nRequired Variables:');
    requiredVars.forEach(varName => {
        if (process.env[varName]) {
            const maskedValue = process.env[varName].substring(0, 10) + '***';
            console.log(`  ✅ ${varName}: ${maskedValue}`);
        } else {
            console.log(`  ❌ ${varName}: Not set`);
            allPresent = false;
        }
    });
    
    console.log('\nOptional Variables:');
    optionalVars.forEach(varName => {
        if (process.env[varName]) {
            console.log(`  ✅ ${varName}: ${process.env[varName]}`);
        } else {
            console.log(`  ℹ️  ${varName}: Using default`);
        }
    });
    
    return allPresent;
}

async function checkWorkingDirectory() {
    console.log('\n📁 Working Directory Validation');
    console.log('-'.repeat(80));
    
    const cwd = process.cwd();
    console.log(`Current Directory: ${cwd}`);
    console.log(`Project Root: ${projectRoot}`);
    
    if (cwd !== projectRoot) {
        console.log('⚠️  Warning: Not running from project root');
        console.log('   Recommended: cd to ' + projectRoot);
    } else {
        console.log('✅ Running from project root');
    }
    
    return true;
}

async function runHealthCheck() {
    try {
        // Check 1: Working Directory
        await checkWorkingDirectory();
        
        // Check 2: Environment Configuration
        const envOk = await checkEnvironment();
        
        // Check 3: Database Path Resolution
        const dbPath = await checkDatabasePath();
        
        if (!dbPath) {
            console.log('\n❌ HEALTH CHECK FAILED: Database file not found');
            console.log('\n🔧 Fix: Run npm run setup to create the database');
            process.exit(1);
        }
        
        // Check 4: Database Connection
        const db = await checkDatabaseConnection(dbPath);
        
        // Check 5: Database Schema
        const schemaOk = await checkDatabaseSchema(db);
        
        // Check 6: Database Content
        await checkDatabaseContent(db);
        
        // Close database
        db.close();
        
        // Final Summary
        console.log('\n' + '='.repeat(80));
        console.log('📋 HEALTH CHECK SUMMARY');
        console.log('='.repeat(80));
        
        if (schemaOk && envOk) {
            console.log('✅ ALL CHECKS PASSED - Backend is healthy and ready to run');
            console.log('\n🚀 Start server with: npm start');
            process.exit(0);
        } else {
            console.log('⚠️  SOME CHECKS FAILED - Review issues above');
            if (!schemaOk) {
                console.log('   - Database schema incomplete');
            }
            if (!envOk) {
                console.log('   - Environment configuration incomplete');
            }
            process.exit(1);
        }
        
    } catch (error) {
        console.log('\n❌ HEALTH CHECK FAILED:', error.message);
        console.log('\n🔧 Fix the issues above and try again');
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    runHealthCheck();
} else {
    module.exports = { runHealthCheck, REQUIRED_TABLES };
}
