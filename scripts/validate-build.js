/**
 * Validate Frontend Build Script
 * 
 * Ensures the frontend build completed successfully before starting the server.
 * If build artifacts are missing or stale, exits with error code 1.
 * 
 * Requirements:
 * - Node.js >= 18.17.0 (for fs.readdirSync recursive option)
 * - If using older Node versions, the stale build check will be skipped
 */

const fs = require('fs');
const path = require('path');

const REQUIRED_FILES = [
  path.join(__dirname, '..', 'frontend', 'dist', 'index.html'),
  path.join(__dirname, '..', 'frontend', 'dist', 'assets'),
];

const FRONTEND_SRC = path.join(__dirname, '..', 'frontend', 'src');
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');

console.log('🔍 Validating frontend build...');

// Check if required build files exist
for (const file of REQUIRED_FILES) {
  if (!fs.existsSync(file)) {
    console.error(`❌ Build validation failed: ${file} not found`);
    console.error('');
    console.error('The frontend build appears to be incomplete.');
    console.error('Please run: npm run build:frontend');
    console.error('');
    process.exit(1);
  }
}

// Check if build is stale (src modified after dist was built)
try {
  const distStat = fs.statSync(FRONTEND_DIST);
  const srcFiles = fs.readdirSync(FRONTEND_SRC, { recursive: true })
    .map(f => path.join(FRONTEND_SRC, f))
    .filter(f => fs.existsSync(f) && fs.statSync(f).isFile());

  const newestSrcFile = srcFiles.reduce((newest, file) => {
    const stat = fs.statSync(file);
    return stat.mtime > newest.mtime ? stat : newest;
  }, { mtime: new Date(0) });

  if (newestSrcFile.mtime > distStat.mtime) {
    console.warn('⚠️  WARNING: Frontend source files have been modified since last build');
    console.warn('   Consider running: npm run build:frontend');
    console.warn('');
    // Don't exit - just warn (developer might be editing backend only)
  }
} catch (err) {
  console.error('❌ Error checking build staleness:', err.message);
  process.exit(1);
}

console.log('✅ Frontend build validated successfully');
