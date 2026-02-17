const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('data/voter_platform.db');

console.log('Testing FIXED participationPatterns query...\n');

const query1 = `
  SELECT 
    COUNT(DISTINCT id) as consistentVoters,
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

db.get(query1, (err, row) => {
  if (err) {
    console.log('❌ ERROR:', err.message);
  } else {
    console.log('✅ FIXED participationPatterns Result:', row);
  }
  
  console.log('\nTesting FIXED geographicConcentration query...\n');
  
  const query2 = `
    SELECT 
      precinct_number as precinctNumber,
      SUM(CASE WHEN latest_party = 'D' THEN 1 ELSE 0 END) as democrat,
      SUM(CASE WHEN latest_party = 'R' THEN 1 ELSE 0 END) as republican,
      SUM(CASE WHEN latest_party = 'I' THEN 1 ELSE 0 END) as independent,
      COUNT(*) as total
    FROM (
      SELECT 
        v.id,
        v.precinct_number,
        (
          SELECT e.party_code 
          FROM election_history e 
          WHERE e.voter_id = v.voter_id 
            AND e.party_code IS NOT NULL 
          ORDER BY e.election_code DESC 
          LIMIT 1
        ) as latest_party
      FROM voters v
    )
    GROUP BY precinctNumber
    ORDER BY precinctNumber
  `;
  
  db.all(query2, (err, rows) => {
    if (err) {
      console.log('❌ ERROR:', err.message);
    } else {
      console.log('✅ FIXED geographicConcentration Result:');
      console.table(rows);
    }
    db.close();
  });
});
