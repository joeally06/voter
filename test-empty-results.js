const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('data/voter_platform.db');

console.log('Testing avgElections query (with super_voter = 1)...\n');

const query1 = `
  SELECT 
    AVG(election_count) as averageElectionsVoted
  FROM (
    SELECT 
      v.id,
      COUNT(DISTINCT e.election_code) as election_count
    FROM voters v
    LEFT JOIN election_history e ON v.voter_id = e.voter_id AND e.voted = 1
    WHERE v.super_voter = 1
    GROUP BY v.id
  )
`;

db.get(query1, (err, row) => {
  if (err) {
    console.log('❌ ERROR:', err.message);
  } else {
    console.log('✅ Result:', row);
    console.log('   Type of row:', typeof row);
    console.log('   Is null?:', row === null);
    console.log('   Is undefined?:', row === undefined);
  }
  
  console.log('\n\nTesting participationPatterns query...\n');
  
  const query2 = `
    SELECT 
      COUNT(DISTINCT v.id) as consistentVoters,
      SUM(CASE WHEN early_pref > 0.5 THEN 1 ELSE 0 END) as earlyVoterPreference,
      SUM(CASE WHEN early_pref <= 0.5 THEN 1 ELSE 0 END) as electionDayPreference
    FROM (
      SELECT 
        v.id,
        CAST(SUM(CASE WHEN e.early_voted = 1 THEN 1 ELSE 0 END) AS REAL) / 
          NULLIF(COUNT(e.id), 0) as early_pref
      FROM voters v
      JOIN election_history e ON v.voter_id = e.voter_id AND e.voted = 1
      WHERE v.super_voter = 1
      GROUP BY v.id
    )
  `;
  
  db.get(query2, (err, row) => {
    if (err) {
      console.log('❌ ERROR:', err.message);
    } else {
      console.log('✅ Result:', row);
    }
    db.close();
  });
});
