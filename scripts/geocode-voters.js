/**
 * Geocode Voters Script
 * 
 * This script triggers batch geocoding for all voters without coordinates.
 * Uses the Google Maps Geocoding API via the application's geocoding service.
 */

const axios = require('axios');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

async function geocodeVoters() {
  console.log('🗺️  Starting voter geocoding process...\n');

  try {
    // Step 1: Check server health
    console.log('1️⃣  Checking server status...');
    const healthResponse = await axios.get(`${API_BASE_URL}/api/health`);
    console.log(`   ✅ Server is healthy`);
    console.log(`   📊 Database: ${healthResponse.data.database.totalVoters} voters, ${healthResponse.data.database.geocodedVoters} geocoded\n`);

    // Step 2: Get ungeocodedcount
    const ungeocodedCount = healthResponse.data.database.totalVoters - healthResponse.data.database.geocodedVoters;
    
    if (ungeocodedCount === 0) {
      console.log('✨ All voters are already geocoded! Nothing to do.\n');
      return;
    }

    console.log(`📍 Found ${ungeocodedCount} voters needing geocoding\n`);

    // Step 3: Start batch geocoding job
    console.log('2️⃣  Starting batch geocoding job...');
    const batchResponse = await axios.post(`${API_BASE_URL}/api/geocode/batch`, {
      limit: ungeocodedCount, // Geocode all ungeocodedvoters
      forceRefresh: false      // Use cache when available
    });

    const jobId = batchResponse.data.jobId;
    console.log(`   ✅ Job created: ${jobId}`);
    console.log(`   📦 Processing ${batchResponse.data.totalAddresses} addresses\n`);

    // Step 4: Monitor progress
    console.log('3️⃣  Monitoring geocoding progress...');
    console.log('   (This may take several minutes depending on API rate limits)\n');

    let completed = false;
    let lastProgress = 0;

    while (!completed) {
      await sleep(5000); // Check every 5 seconds

      const statusResponse = await axios.get(`${API_BASE_URL}/api/geocode/jobs/${jobId}`);
      const job = statusResponse.data.job;

      // Show progress if it changed
      if (job.progress > lastProgress) {
        const progressBar = generateProgressBar(job.progress);
        console.log(`   ${progressBar} ${job.progress.toFixed(1)}% (${job.processed}/${job.total})`);
        lastProgress = job.progress;
      }

      // Check if completed
      if (job.status === 'COMPLETED' || job.status === 'FAILED') {
        completed = true;
        console.log('');

        if (job.status === 'COMPLETED') {
          console.log('✅ Geocoding completed successfully!\n');
          console.log('📊 Results:');
          console.log(`   ✓ Successfully geocoded: ${job.successful}`);
          console.log(`   ✗ Failed: ${job.failed}`);
          console.log(`   💾 Cache hits: ${job.cacheHits || 0}`);
          console.log(`   🌐 API calls: ${job.apiCalls || 0}\n`);

          if (job.failed > 0) {
            console.log(`⚠️  Some addresses failed to geocode. View details at:`);
            console.log(`   ${API_BASE_URL}/api/geocode/failed/${jobId}\n`);
          }
        } else {
          console.log(`❌ Geocoding job failed: ${job.error || 'Unknown error'}\n`);
          process.exit(1);
        }
      }
    }

    // Step 5: Show final statistics
    console.log('4️⃣  Final statistics...');
    const statsResponse = await axios.get(`${API_BASE_URL}/api/geocode/stats`);
    const stats = statsResponse.data;
    
    console.log(`   📊 Cache size: ${stats.cache.totalEntries} entries`);
    console.log(`   📈 Cache hit rate: ${stats.cache.hitRate.toFixed(1)}%`);
    console.log(`   🗓️  API calls today: ${stats.quota.apiCallsToday} / ${stats.quota.dailyLimit}\n`);

    console.log('🎉 Geocoding process complete!');
    console.log(`   👉 Refresh your browser to see voters on the map: ${API_BASE_URL}\n`);

  } catch (error) {
    console.error('❌ Error during geocoding:', error.message);
    
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Details: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    
    console.error('\n💡 Troubleshooting:');
    console.error('   1. Ensure server is running: npm start');
    console.error('   2. Check GOOGLE_MAPS_GEOCODING_API_KEY in .env file');
    console.error('   3. Verify Google Maps API is enabled in Google Cloud Console\n');
    
    process.exit(1);
  }
}

// Helper function to generate progress bar
function generateProgressBar(percent, length = 30) {
  const filled = Math.floor(percent / 100 * length);
  const empty = length - filled;
  return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
}

// Helper function to sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the script
console.log('═══════════════════════════════════════════════');
console.log('   Voter Geocoding Script');
console.log('   Voter Outreach & Mapping Platform');
console.log('═══════════════════════════════════════════════\n');

geocodeVoters().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
