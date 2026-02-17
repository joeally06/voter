/**
 * Geocode Active Voters Script
 * 
 * This script geocodes ONLY voters who have actually voted (electionsVoted > 0).
 * Skips never-voted voters to save API quota and costs.
 * 
 * Usage: node scripts/geocode-active-voters.js
 */

const axios = require('axios');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

async function geocodeActiveVoters() {
  console.log('🗺️  Starting ACTIVE voter geocoding process...\n');
  console.log('   ℹ️  This will only geocode voters who have voted\n');

  try {
    // Step 1: Check server health
    console.log('1️⃣  Checking server status...');
    const healthResponse = await axios.get(`${API_BASE_URL}/api/health`);
    console.log(`   ✅ Server is healthy`);
    console.log(`   📊 Total voters: ${healthResponse.data.database.totalVoters}`);
    console.log(`   📊 Already geocoded: ${healthResponse.data.database.geocodedVoters}\n`);

    // Step 2: Get voters who have voted but aren't geocoded
    console.log('2️⃣  Fetching active voters without coordinates...');
    
    // Fetch ungecoded voters in batches (API limit is 1000 per request)
    let allUngecoded = [];
    let offset = 0;
    const limit = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const votersResponse = await axios.get(`${API_BASE_URL}/api/voters`, {
        params: {
          geocoded: 'false',  // Only ungecoded voters
          limit: limit,
          offset: offset
        }
      });
      
      const batch = votersResponse.data.data || [];
      allUngecoded = allUngecoded.concat(batch);
      
      offset += limit;
      hasMore = batch.length === limit; // Continue if we got a full batch
      
      if (hasMore) {
        console.log(`   📥 Fetched ${allUngecoded.length} ungecoded voters so far...`);
      }
    }
    
    console.log(`   ✅ Fetched ${allUngecoded.length} total ungecoded voters`);

    // Filter to only voters who have actually voted (electionsVoted > 0)
    const activeVoters = allUngecoded.filter(v => (v.electionsVoted || 0) > 0);
    const activeVoterIds = activeVoters.map(v => v.id);
    
    // Calculate never-voted count for stats
    const neverVotedUngeocodedCount = allUngecoded.length - activeVoters.length;
    
    if (activeVoterIds.length === 0) {
      console.log('   ✨ All active voters are already geocoded!\n');
      
      if (neverVotedUngeocodedCount > 0) {
        console.log(`   ℹ️  Note: ${neverVotedUngeocodedCount} never-voted voters remain ungecoded`);
        console.log(`   💡 To geocode them too, run: node scripts/geocode-voters.js\n`);
      }
      
      return;
    }

    console.log(`   ✅ Found ${activeVoterIds.length} active voters needing geocoding`);
    console.log(`   📊 Breaking down:`);
    
    // Show breakdown by voting category
    const superVoters = activeVoters.filter(v => v.superVoter).length;
    const regularVoters = activeVoters.length - superVoters;
    
    console.log(`      • Super voters: ${superVoters}`);
    console.log(`      • Regular voters: ${regularVoters}`);
    console.log(`      • Never voted (skipped): ${neverVotedUngeocodedCount}\n`);

    // Step 3: Start batch geocoding job with active voter IDs
    console.log('3️⃣  Starting batch geocoding job...');
    const batchResponse = await axios.post(`${API_BASE_URL}/api/geocode/batch`, {
      voterIds: activeVoterIds,
      options: {
        forceRefresh: false  // Use cache when available
      }
    });

    const jobId = batchResponse.data.jobId;
    console.log(`   ✅ Job created: ${jobId}`);
    console.log(`   📦 Processing ${batchResponse.data.totalRecords} voters`);
    console.log(`   ⏱️  Estimated time: ${batchResponse.data.estimatedDuration}\n`);

    // Step 4: Monitor progress
    console.log('4️⃣  Monitoring geocoding progress...');
    console.log('   (This may take several minutes depending on API rate limits)\n');

    let completed = false;
    let lastProgress = 0;

    while (!completed) {
      await sleep(5000); // Check every 5 seconds

      const statusResponse = await axios.get(`${API_BASE_URL}/api/geocode/jobs/${jobId}`);
      const job = statusResponse.data; // Data is returned directly, not nested in .job

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
            console.log(`   ⚠️  Some addresses failed to geocode.`);
          }
        } else {
          console.log(`❌ Geocoding job failed: ${job.error || 'Unknown error'}\n`);
          process.exit(1);
        }
      }
    }

    // Step 5: Show final statistics
    console.log('5️⃣  Final statistics...');
    const statsResponse = await axios.get(`${API_BASE_URL}/api/geocode/stats`);
    const stats = statsResponse.data;
    
    console.log(`   📊 Cache size: ${stats.cache.totalEntries} entries`);
    console.log(`   📈 Cache hit rate: ${stats.cache.hitRate.toFixed(1)}%`);
    console.log(`   🗓️  API calls today: ${stats.quota.apiCallsToday} / ${stats.quota.dailyLimit}\n`);

    console.log('🎉 Active voter geocoding complete!');
    console.log(`   👉 Refresh your browser to see voters on the map: ${API_BASE_URL}`);
    
    if (neverVotedUngeocodedCount > 0) {
      console.log(`\n   ℹ️  Note: ${neverVotedUngeocodedCount} never-voted voters remain ungecoded`);
      console.log(`   💡 To geocode them too, run: node scripts/geocode-voters.js`);
    }
    
    console.log('');

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
  const filled = Math.min(Math.floor(percent / 100 * length), length);
  const empty = length - filled;
  return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
}

// Helper function to sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the script
console.log('═══════════════════════════════════════════════');
console.log('   Active Voter Geocoding Script');
console.log('   Voter Outreach & Mapping Platform');
console.log('═══════════════════════════════════════════════\n');

geocodeActiveVoters().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
