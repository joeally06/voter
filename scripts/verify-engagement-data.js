/**
 * Voter Engagement Data Verification Script
 * 
 * Purpose: Diagnose voter engagement data issues by checking:
 * - Database voter count
 * - Election history table population
 * - Engagement levels calculation
 * - Data distribution across engagement categories
 * 
 * Usage: node scripts/verify-engagement-data.js
 */

const path = require('path');
const db = require('../backend/config/database');

async function verifyEngagementData() {
  console.log('=================================================');
  console.log('   Voter Engagement Data Verification');
  console.log('=================================================\n');

  try {
    // Connect to database
    await db.connect();
    console.log('✅ Database connected\n');

    // ============================================================
    // CHECK 1: Count total voters
    // ============================================================
    console.log('📊 CHECK 1: Total Voters Count');
    console.log('─────────────────────────────────────────────────');
    const voterCount = await db.get('SELECT COUNT(*) as count FROM voters');
    console.log(`Total Voters: ${voterCount.count.toLocaleString()}`);
    
    if (voterCount.count === 0) {
      console.log('❌ WARNING: No voters found in database!');
      console.log('   → Please import voter data using the upload feature\n');
      await db.close();
      return;
    }
    console.log('✅ Voters table populated\n');

    // ============================================================
    // CHECK 2: Count election history records
    // ============================================================
    console.log('📊 CHECK 2: Election History Records');
    console.log('─────────────────────────────────────────────────');
    const historyCount = await db.get('SELECT COUNT(*) as count FROM election_history');
    console.log(`Total Election History Records: ${historyCount.count.toLocaleString()}`);
    
    if (historyCount.count === 0) {
      console.log('⚠️  WARNING: No election history records found!');
      console.log('   This means all voters will be categorized as "Never Voted"');
      console.log('   Possible causes:');
      console.log('   1. CSV files lack E_* columns (E_1, E_2, E_3, etc.)');
      console.log('   2. Election history data was not imported');
      console.log('   3. Import process failed to insert history records\n');
    } else {
      console.log('✅ Election history table populated\n');
    }

    // ============================================================
    // CHECK 3: Count voters with election history
    // ============================================================
    console.log('📊 CHECK 3: Voters with Election History');
    console.log('─────────────────────────────────────────────────');
    const votersWithHistory = await db.get(`
      SELECT COUNT(DISTINCT voter_id) as count 
      FROM election_history
      WHERE voted = 1
    `);
    console.log(`Voters with at least 1 election participation: ${votersWithHistory.count.toLocaleString()}`);
    
    const participationRate = voterCount.count > 0 
      ? ((votersWithHistory.count / voterCount.count) * 100).toFixed(1) 
      : '0.0';
    console.log(`Participation Rate: ${participationRate}%`);
    
    if (votersWithHistory.count === 0) {
      console.log('⚠️  WARNING: No voters have participated in any elections');
    } else {
      console.log('✅ Some voters have election participation history\n');
    }

    // ============================================================
    // CHECK 4: Engagement levels breakdown (MAIN QUERY)
    // ============================================================
    console.log('📊 CHECK 4: Engagement Levels Distribution');
    console.log('─────────────────────────────────────────────────');
    console.log('Running engagement calculation query...\n');
    
    const engagement = await db.get(`
      SELECT 
        SUM(CASE 
          WHEN (SELECT COUNT(*) FROM election_history 
                WHERE voter_id = voters.voter_id AND voted = 1) = 0 
          THEN 1 ELSE 0 
        END) as neverVoted,
        SUM(CASE 
          WHEN (SELECT COUNT(*) FROM election_history 
                WHERE voter_id = voters.voter_id AND voted = 1) BETWEEN 1 AND 3 
          THEN 1 ELSE 0 
        END) as occasionalVoters,
        SUM(CASE WHEN super_voter = 1 THEN 1 ELSE 0 END) as superVoters,
        COUNT(*) as totalVoters
      FROM voters
    `);

    console.log('Engagement Category Breakdown:');
    console.log('┌────────────────────────┬─────────┬────────────┐');
    console.log('│ Category               │ Count   │ Percentage │');
    console.log('├────────────────────────┼─────────┼────────────┤');
    
    const neverVotedPct = engagement.totalVoters > 0 
      ? ((engagement.neverVoted / engagement.totalVoters) * 100).toFixed(1) 
      : '0.0';
    const occasionalPct = engagement.totalVoters > 0 
      ? ((engagement.occasionalVoters / engagement.totalVoters) * 100).toFixed(1) 
      : '0.0';
    const superVoterPct = engagement.totalVoters > 0 
      ? ((engagement.superVoters / engagement.totalVoters) * 100).toFixed(1) 
      : '0.0';

    console.log(`│ Never Voted (0)        │ ${String(engagement.neverVoted).padStart(7)} │ ${String(neverVotedPct + '%').padStart(10)} │`);
    console.log(`│ Occasional Voters (1-3)│ ${String(engagement.occasionalVoters).padStart(7)} │ ${String(occasionalPct + '%').padStart(10)} │`);
    console.log(`│ Super Voters (4+)      │ ${String(engagement.superVoters).padStart(7)} │ ${String(superVoterPct + '%').padStart(10)} │`);
    console.log('├────────────────────────┼─────────┼────────────┤');
    console.log(`│ TOTAL                  │ ${String(engagement.totalVoters).padStart(7)} │ 100.0%     │`);
    console.log('└────────────────────────┴─────────┴────────────┘\n');

    // ============================================================
    // CHECK 5: Data quality assessment
    // ============================================================
    console.log('📊 CHECK 5: Data Quality Assessment');
    console.log('─────────────────────────────────────────────────');
    
    const warnings = [];
    
    // Check for suspiciously high "Never Voted" rate
    if (parseFloat(neverVotedPct) > 60) {
      warnings.push('⚠️  High "Never Voted" rate (>60%) - possible data import issue');
    }
    
    // Check for suspiciously high "Super Voter" rate
    if (parseFloat(superVoterPct) > 50) {
      warnings.push('⚠️  High "Super Voter" rate (>50%) - possible over-counting');
    }
    
    // Check for missing election history
    if (historyCount.count === 0 && voterCount.count > 0) {
      warnings.push('⚠️  No election history records - all voters categorized as "Never Voted"');
    }
    
    // Expected distribution (based on national averages)
    if (parseFloat(superVoterPct) < 15 || parseFloat(superVoterPct) > 45) {
      warnings.push(`ℹ️  Super Voter rate (${superVoterPct}%) outside typical range (15-45%)`);
    }

    if (warnings.length > 0) {
      console.log('Data Quality Warnings:');
      warnings.forEach(warning => console.log(`  ${warning}`));
      console.log();
    } else {
      console.log('✅ Data distribution looks healthy - no warnings\n');
    }

    // ============================================================
    // CHECK 6: Sample election history records
    // ============================================================
    console.log('📊 CHECK 6: Sample Election History Records');
    console.log('─────────────────────────────────────────────────');
    
    const sampleHistory = await db.all(`
      SELECT voter_id, election_code, voted, party_code, early_voted
      FROM election_history 
      LIMIT 10
    `);
    
    if (sampleHistory.length > 0) {
      console.log('Sample of election participation records:');
      console.table(sampleHistory);
    } else {
      console.log('❌ No election history records to display\n');
    }

    // ============================================================
    // CHECK 7: Simulate API endpoint response
    // ============================================================
    console.log('📊 CHECK 7: Simulated API Response');
    console.log('─────────────────────────────────────────────────');
    console.log('This is what /api/analytics/engagement-levels returns:\n');
    
    const apiResponse = {
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        neverVoted: engagement.neverVoted,
        occasionalVoters: engagement.occasionalVoters,
        superVoters: engagement.superVoters,
        totalVoters: engagement.totalVoters,
        percentages: {
          neverVoted: parseFloat(neverVotedPct),
          occasionalVoters: parseFloat(occasionalPct),
          superVoters: parseFloat(superVoterPct)
        }
      }
    };
    
    console.log(JSON.stringify(apiResponse, null, 2));
    console.log();

    // ============================================================
    // SUMMARY & RECOMMENDATIONS
    // ============================================================
    console.log('=================================================');
    console.log('   Summary & Recommendations');
    console.log('=================================================\n');

    if (voterCount.count === 0) {
      console.log('❌ NO VOTERS IN DATABASE');
      console.log('   → Import voter data using the frontend upload feature\n');
    } else if (historyCount.count === 0) {
      console.log('⚠️  VOTERS EXIST BUT NO ELECTION HISTORY');
      console.log('   Recommendations:');
      console.log('   1. Check if CSV files contain E_* columns (E_1, E_2, E_3, etc.)');
      console.log('   2. Re-import data if election columns were missing');
      console.log('   3. Check import logs for errors during election history insertion');
      console.log('   4. All voters will appear as "Never Voted" until history is imported\n');
      console.log('   NOTE: The chart CAN render with all voters as "Never Voted"');
      console.log('         The validation bug has been fixed to allow 0 values.\n');
    } else {
      console.log('✅ DATA LOOKS GOOD');
      console.log('   Voters and election history are both populated.');
      console.log('   The engagement chart should render correctly.\n');
    }

    // Close database connection
    await db.close();
    console.log('✅ Database connection closed\n');
    
  } catch (error) {
    console.error('❌ Error during verification:', error);
    await db.close();
    process.exit(1);
  }
}

// Run the verification
verifyEngagementData()
  .then(() => {
    console.log('=================================================');
    console.log('Verification complete!');
    console.log('=================================================\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
