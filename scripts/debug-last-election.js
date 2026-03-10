const db = require('../backend/config/database');

(async () => {
  await db.connect();
  
  // Check tables
  const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
  console.log('Tables:', tables.map(t => t.name).join(', '));
  
  // Check election_history schema
  const ehCols = await db.all("PRAGMA table_info(election_history)");
  console.log('\nelection_history columns:');
  ehCols.forEach(c => console.log(`  ${c.name} (${c.type})`));
  
  // Check voters schema
  const vCols = await db.all("PRAGMA table_info(voters)");
  console.log('\nvoters columns:');
  vCols.forEach(c => console.log(`  ${c.name} (${c.type})`));
  
  // Check data counts
  const ehCount = await db.get("SELECT COUNT(*) as cnt FROM election_history");
  console.log('\nelection_history total rows:', ehCount.cnt);
  
  const votedCount = await db.get("SELECT COUNT(*) as cnt FROM election_history WHERE voted = 1");
  console.log('election_history voted=1 rows:', votedCount.cnt);
  
  // Sample data
  const ehSample = await db.all("SELECT * FROM election_history LIMIT 5");
  console.log('\nelection_history sample:', JSON.stringify(ehSample, null, 2));
  
  // Check distinct election codes
  const codes = await db.all("SELECT election_code, COUNT(*) as cnt FROM election_history GROUP BY election_code ORDER BY election_code");
  console.log('\nElection codes:', JSON.stringify(codes, null, 2));
  
  // Try the last election query
  const lastElection = await db.get(`
    SELECT election_code 
    FROM election_history 
    WHERE voted = 1
    GROUP BY election_code 
    ORDER BY 
      CASE 
        WHEN election_code LIKE 'E_%' 
        THEN CAST(SUBSTR(election_code, 3) AS INTEGER) 
        ELSE 0 
      END DESC,
      election_code DESC
    LIMIT 1
  `);
  console.log('\nLast election result:', JSON.stringify(lastElection));
  
  // Check voters with date_of_birth
  const dobCount = await db.get("SELECT COUNT(*) as cnt FROM voters WHERE date_of_birth IS NOT NULL AND date_of_birth != ''");
  console.log('\nVoters with date_of_birth:', dobCount.cnt);
  
  // Check voter_id linkage
  const linkCheck = await db.get(`
    SELECT COUNT(*) as cnt FROM election_history eh 
    WHERE NOT EXISTS (SELECT 1 FROM voters v WHERE v.voter_id = eh.voter_id)
  `);
  console.log('Orphaned election_history rows (no matching voter):', linkCheck.cnt);
  
  // If there is a last election, try the full query
  if (lastElection) {
    const electionCode = lastElection.election_code;
    console.log('\n--- Attempting full last election breakdown for:', electionCode, '---');
    
    try {
      const electionStats = await db.get(`
        SELECT 
          COUNT(DISTINCT v.id) as totalRegistered,
          COUNT(DISTINCT CASE WHEN e.voted = 1 THEN v.id END) as totalVoted,
          SUM(CASE WHEN e.voted = 1 AND e.early_voted = 1 THEN 1 ELSE 0 END) as earlyVoted,
          SUM(CASE WHEN e.voted = 1 AND (e.early_voted = 0 OR e.early_voted IS NULL) THEN 1 ELSE 0 END) as electionDayVoted
        FROM voters v
        LEFT JOIN election_history e ON v.voter_id = e.voter_id AND e.election_code = ?
        WHERE 1=1
      `, [electionCode]);
      console.log('Election stats:', JSON.stringify(electionStats, null, 2));
    } catch (err) {
      console.error('Election stats query FAILED:', err.message);
    }
    
    try {
      const ageBreakdown = await db.all(`
        SELECT 
          CASE 
            WHEN v.date_of_birth IS NULL THEN 'Unknown'
            WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) < 18 THEN 'Under 18'
            WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) BETWEEN 18 AND 24 THEN '18-24'
            WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) BETWEEN 25 AND 34 THEN '25-34'
            WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) BETWEEN 35 AND 44 THEN '35-44'
            WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) BETWEEN 45 AND 54 THEN '45-54'
            WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) BETWEEN 55 AND 64 THEN '55-64'
            WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) BETWEEN 65 AND 74 THEN '65-74'
            WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) >= 75 THEN '75+'
            ELSE 'Unknown'
          END AS ageGroup,
          COUNT(*) as count,
          SUM(CASE WHEN e.early_voted = 1 THEN 1 ELSE 0 END) as earlyVoted
        FROM voters v
        JOIN election_history e ON v.voter_id = e.voter_id
        WHERE e.election_code = ? AND e.voted = 1
        GROUP BY ageGroup
        ORDER BY 
          CASE ageGroup
            WHEN 'Under 18' THEN 1
            WHEN '18-24' THEN 2
            WHEN '25-34' THEN 3
            WHEN '35-44' THEN 4
            WHEN '45-54' THEN 5
            WHEN '55-64' THEN 6
            WHEN '65-74' THEN 7
            WHEN '75+' THEN 8
            WHEN 'Unknown' THEN 9
          END
      `, [electionCode]);
      console.log('Age breakdown:', JSON.stringify(ageBreakdown, null, 2));
    } catch (err) {
      console.error('Age breakdown query FAILED:', err.message);
    }
    
    try {
      const precinctBreakdown = await db.all(`
        SELECT 
          v.precinct_number as precinctNumber,
          p.name as precinctName,
          COUNT(CASE WHEN e.voted = 1 THEN 1 END) as voted,
          reg.cnt as registered,
          SUM(CASE WHEN e.voted = 1 AND e.early_voted = 1 THEN 1 ELSE 0 END) as earlyVoted,
          SUM(CASE WHEN e.voted = 1 AND e.party_code = 'D' THEN 1 ELSE 0 END) as democrat,
          SUM(CASE WHEN e.voted = 1 AND e.party_code = 'R' THEN 1 ELSE 0 END) as republican,
          SUM(CASE WHEN e.voted = 1 AND e.party_code = 'I' THEN 1 ELSE 0 END) as independent,
          SUM(CASE WHEN e.voted = 1 AND (e.party_code IS NULL OR e.party_code = '') THEN 1 ELSE 0 END) as unknownParty
        FROM voters v
        LEFT JOIN election_history e ON v.voter_id = e.voter_id AND e.election_code = ?
        LEFT JOIN precincts p ON v.precinct_number = p.precinct_number
        LEFT JOIN (SELECT precinct_number, COUNT(*) as cnt FROM voters GROUP BY precinct_number) reg
          ON v.precinct_number = reg.precinct_number
        WHERE 1=1
        GROUP BY v.precinct_number, p.name
        HAVING voted > 0
        ORDER BY v.precinct_number
      `, [electionCode]);
      console.log('Precinct breakdown:', JSON.stringify(precinctBreakdown, null, 2));
    } catch (err) {
      console.error('Precinct breakdown query FAILED:', err.message);
    }
  }
  
  process.exit(0);
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
