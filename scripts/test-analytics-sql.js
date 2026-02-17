const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('data/voter_platform.db');

console.log('Testing partyAffiliation query WITHOUT alias...\n');

// This should FAIL - subquery without alias
const query1 = `
  SELECT 
    SUM(CASE WHEN latest_party = 'D' THEN 1 ELSE 0 END) as democrat,
    SUM(CASE WHEN latest_party = 'R' THEN 1 ELSE 0 END) as republican
  FROM (
    SELECT 
      v.id,
      (
        SELECT e.party_code 
        FROM election_history e 
        WHERE e.voter_id = v.voter_id 
          AND e.party_code IS NOT NULL 
        ORDER BY e.election_code DESC 
        LIMIT 1
      ) as latest_party
    FROM voters v
    WHERE v.super_voter = 1
  )
`;

db.get(query1, (err, row) => {
  if (err) {
    console.log('❌ FAILED (expected):', err.message);
  } else {
    console.log('✅ PASSED (unexpected):', row);
  }
  
  console.log('\nTesting partyAffiliation query WITH alias...\n');
  
  // This should PASS - subquery with alias
  const query2 = `
    SELECT 
      SUM(CASE WHEN latest_party = 'D' THEN 1 ELSE 0 END) as democrat,
      SUM(CASE WHEN latest_party = 'R' THEN 1 ELSE 0 END) as republican
    FROM (
      SELECT 
        v.id,
        (
          SELECT e.party_code 
          FROM election_history e 
          WHERE e.voter_id = v.voter_id 
            AND e.party_code IS NOT NULL 
          ORDER BY e.election_code DESC 
          LIMIT 1
        ) as latest_party
      FROM voters v
      WHERE v.super_voter = 1
    ) AS subquery
  `;
  
  db.get(query2, (err, row) => {
    if (err) {
      console.log('❌ FAILED:', err.message);
    } else {
      console.log('✅ PASSED:', row);
    }
    db.close();
  });
});
