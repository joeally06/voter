const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

/**
 * Project Setup Script
 * Creates necessary directories and initializes the database
 */

console.log('🚀 Setting up Voter Outreach Platform...\n');

// Create directory structure
const directories = [
    'backend/routes',
    'backend/models',
    'backend/parsers',
    'backend/services',
    'backend/config',
    'frontend/public/css',
    'frontend/public/js',
    'frontend/public/assets/icons',
    'data/raw',
    'data/processed',
    'data/cache',
    'data/backups',
    'logs',
    'docs',
    'tests/unit',
    'tests/integration',
    'scripts'
];

console.log('📁 Creating directory structure...');
directories.forEach(dir => {
    const dirPath = path.join(process.cwd(), dir);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`✅ Created: ${dir}`);
    } else {
        console.log(`⚠️  Already exists: ${dir}`);
    }
});

// Database setup
console.log('\n🗄️  Setting up SQLite database...');

const dbPath = path.join(process.cwd(), 'data', 'voter_platform.db');
const db = new sqlite3.Database(dbPath);

const sqlSchema = `
-- Voters table
CREATE TABLE IF NOT EXISTS voters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voter_id TEXT UNIQUE,
    last_name TEXT NOT NULL,
    first_name TEXT NOT NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    zip_code TEXT NOT NULL,
    precinct_number TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    geocoding_quality TEXT,
    date_of_birth TEXT,
    state TEXT,
    super_voter BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Election history table
CREATE TABLE IF NOT EXISTS election_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voter_id TEXT,
    election_code TEXT,
    voted BOOLEAN DEFAULT 0,
    party_code TEXT,
    early_voted BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (voter_id) REFERENCES voters(voter_id)
);

-- Precincts table  
CREATE TABLE IF NOT EXISTS precincts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    precinct_number TEXT UNIQUE NOT NULL,
    name TEXT,
    total_voters INTEGER DEFAULT 0,
    active_voters INTEGER DEFAULT 0,
    super_voters INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Geocoding cache table
CREATE TABLE IF NOT EXISTS geocoding_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address_hash TEXT UNIQUE NOT NULL,
    original_address TEXT NOT NULL,
    formatted_address TEXT,
    latitude REAL,
    longitude REAL,
    quality_score REAL,
    place_id TEXT,
    components TEXT, -- JSON string of address components
    cached_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Import logs table
CREATE TABLE IF NOT EXISTS import_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    file_size INTEGER,
    total_records INTEGER DEFAULT 0,
    records_processed INTEGER DEFAULT 0,
    records_successful INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_time DATETIME,
    status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
    error_message TEXT
);

-- Import errors table (Phase 2)
CREATE TABLE IF NOT EXISTS import_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id INTEGER NOT NULL,
    record_number INTEGER,
    error_type TEXT,
    error_message TEXT,
    record_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (import_id) REFERENCES import_logs(id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_voters_precinct ON voters(precinct_number);
CREATE INDEX IF NOT EXISTS idx_voters_name ON voters(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_voters_address ON voters(address, city, zip_code);
CREATE INDEX IF NOT EXISTS idx_voters_coords ON voters(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_election_voter ON election_history(voter_id);
CREATE INDEX IF NOT EXISTS idx_geocoding_hash ON geocoding_cache(address_hash);
CREATE INDEX IF NOT EXISTS idx_import_errors_import ON import_errors(import_id);

-- Geocoding jobs table (from migration 003)
CREATE TABLE IF NOT EXISTS geocoding_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT DEFAULT 'PENDING',
    total_records INTEGER NOT NULL,
    processed_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    cache_hits INTEGER DEFAULT 0,
    api_calls INTEGER DEFAULT 0,
    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_time DATETIME,
    estimated_completion DATETIME,
    last_processed_id INTEGER,
    options TEXT,
    created_by TEXT,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_geocoding_jobs_status ON geocoding_jobs(status);

-- Geocoding errors table (from migration 003)
CREATE TABLE IF NOT EXISTS geocoding_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    voter_id INTEGER NOT NULL,
    address TEXT NOT NULL,
    city TEXT,
    zip_code TEXT,
    error_type TEXT,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES geocoding_jobs(id),
    FOREIGN KEY (voter_id) REFERENCES voters(id)
);

CREATE INDEX IF NOT EXISTS idx_geocoding_errors_job ON geocoding_errors(job_id);
CREATE INDEX IF NOT EXISTS idx_geocoding_errors_type ON geocoding_errors(error_type);
CREATE INDEX IF NOT EXISTS idx_geocoding_errors_voter ON geocoding_errors(voter_id);

-- API quotas table (from migration 003)
CREATE TABLE IF NOT EXISTS api_quotas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    service TEXT NOT NULL,
    request_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, service)
);

CREATE INDEX IF NOT EXISTS idx_quotas_date ON api_quotas(date, service);

-- Route cache table (from migration 006)
CREATE TABLE IF NOT EXISTS route_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin_lat REAL NOT NULL,
    origin_lng REAL NOT NULL,
    destination_lat REAL NOT NULL,
    destination_lng REAL NOT NULL,
    route_hash TEXT UNIQUE NOT NULL,
    travel_mode TEXT NOT NULL,
    distance_meters INTEGER,
    duration_seconds INTEGER,
    duration_in_traffic_seconds INTEGER,
    api_status TEXT,
    cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    UNIQUE(origin_lat, origin_lng, destination_lat, destination_lng, travel_mode)
);

CREATE INDEX IF NOT EXISTS idx_route_hash ON route_cache(route_hash);
CREATE INDEX IF NOT EXISTS idx_route_expires ON route_cache(expires_at);

-- API usage table (from migration 006)
CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_name TEXT NOT NULL,
    call_date DATE NOT NULL,
    call_count INTEGER DEFAULT 0,
    cache_hits INTEGER DEFAULT 0,
    cache_misses INTEGER DEFAULT 0,
    quota_remaining INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(api_name, call_date)
);

CREATE INDEX IF NOT EXISTS idx_api_usage_date ON api_usage(api_name, call_date);

-- Saved routes table (from migration 008)
CREATE TABLE IF NOT EXISTS saved_routes (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    route_name TEXT,
    route_data JSON NOT NULL,
    travel_mode TEXT DEFAULT 'walking',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    accessed_at DATETIME,
    access_count INTEGER DEFAULT 0,
    expires_at DATETIME,
    is_public BOOLEAN DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_saved_routes_user ON saved_routes(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_routes_created ON saved_routes(created_at);
CREATE INDEX IF NOT EXISTS idx_saved_routes_expires ON saved_routes(expires_at);
`;

db.exec(sqlSchema, (err) => {
    if (err) {
        console.error('❌ Database setup failed:', err.message);
        process.exit(1);
    } else {
        console.log('✅ Database schema created successfully');
        
        // Precincts are created dynamically from imported voter data.
        // No hardcoded seed precincts are inserted here.
        
        db.close();
        console.log('\n🎉 Setup completed successfully!');
        console.log('\nNext steps:');
        console.log('1. Copy .env.example to .env and configure your Google Maps API keys');
        console.log('2. Run "npm run dev" to start the development server');
        console.log('3. Open http://localhost:3000 to access the application');
    }
});

// Create .gitignore file
console.log('\n📋 Creating .gitignore file...');
const gitignoreContent = `# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment files
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Database
*.db
*.sqlite

# Logs
logs/
*.log

# Runtime data
pids/
*.pid
*.seed
*.pid.lock

# Data files
data/raw/*.dbf
data/processed/*
data/cache/*
data/backups/*

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# IDE files
.vscode/
.idea/
*.swp
*.swo
*~

# Build outputs
dist/
build/

# Coverage directory used by tools like istanbul
coverage/
`;

fs.writeFileSync(path.join(process.cwd(), '.gitignore'), gitignoreContent);
console.log('✅ .gitignore created');

console.log('\n🔒 Security reminders:');
console.log('- Keep your Google Maps API keys secure');
console.log('- Never commit .env files to version control');
console.log('- This application is for local use only');
console.log('- Voter data must be used for political purposes only');