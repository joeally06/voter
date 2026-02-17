/**
 * Project Health Check Script
 * Validates environment, database, and configuration
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const projectRoot = process.cwd();
const checks = [];

console.log('🏥 Voter Platform Health Check\n');
console.log('='.repeat(80));

// Check 1: Working Directory
const checkWorkingDirectory = () => {
    const expectedFiles = ['package.json', 'backend', 'frontend', 'data'];
    const missing = expectedFiles.filter(f => !fs.existsSync(path.join(projectRoot, f)));
    
    if (missing.length === 0) {
        console.log('✅ Working directory is correct:', projectRoot);
        return true;
    } else {
        console.log('❌ Working directory check failed');
        console.log('   Missing:', missing.join(', '));
        console.log('   Ensure you are in the project root (C:\\Voter)');
        return false;
    }
};

// Check 2: Database exists
const checkDatabase = () => {
    const dbPath = path.join(projectRoot, 'data', 'voter_platform.db');
    if (fs.existsSync(dbPath)) {
        console.log('✅ Database file exists:', dbPath);
        return true;
    } else {
        console.log('❌ Database file not found:', dbPath);
        console.log('   Run: npm run setup');
        return false;
    }
};

// Check 3: Database schema
const checkSchema = () => {
    return new Promise((resolve) => {
        const dbPath = path.join(projectRoot, 'data', 'voter_platform.db');
        const db = new sqlite3.Database(dbPath);
        
        db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
            if (err) {
                console.log('❌ Database schema check failed:', err.message);
                db.close();
                resolve(false);
                return;
            }
            
            const requiredTables = ['voters', 'precincts', 'election_history', 'geocoding_cache'];
            const existingTables = tables.map(t => t.name);
            const missingTables = requiredTables.filter(t => !existingTables.includes(t));
            
            if (missingTables.length === 0) {
                console.log(`✅ Database schema valid (${existingTables.length} tables)`);
                db.close();
                resolve(true);
            } else {
                console.log('❌ Missing database tables:', missingTables.join(', '));
                console.log('   Run: npm run setup');
                db.close();
                resolve(false);
            }
        });
    });
};

// Check 4: Environment variables
const checkEnvironment = () => {
    const envPath = path.join(projectRoot, '.env');
    if (!fs.existsSync(envPath)) {
        console.log('❌ .env file not found');
        console.log('   Copy .env.example to .env and configure');
        return false;
    }
    
    require('dotenv').config({ path: envPath });
    
    if (!process.env.GOOGLE_MAPS_API_KEY) {
        console.log('⚠️  GOOGLE_MAPS_API_KEY not configured in .env');
        console.log('   Application will start but geocoding will not work');
        return false;
    }
    
    console.log('✅ Environment variables configured');
    return true;
};

// Check 5: Dependencies
const checkDependencies = () => {
    const nodeModules = path.join(projectRoot, 'node_modules');
    if (fs.existsSync(nodeModules)) {
        console.log('✅ Dependencies installed');
        return true;
    } else {
        console.log('❌ node_modules not found');
        console.log('   Run: npm install');
        return false;
    }
};

// Run all checks
(async () => {
    const results = [
        checkWorkingDirectory(),
        checkDatabase(),
        await checkSchema(),
        checkEnvironment(),
        checkDependencies()
    ];
    
    console.log('='.repeat(80));
    const passed = results.filter(r => r).length;
    const total = results.length;
    
    if (passed === total) {
        console.log(`\n✅ All checks passed (${passed}/${total})`);
        console.log('🚀 Ready to start: npm start\n');
        process.exit(0);
    } else {
        console.log(`\n⚠️  ${total - passed} check(s) failed (${passed}/${total} passed)`);
        console.log('🔧 Fix the issues above before starting\n');
        process.exit(1);
    }
})();
