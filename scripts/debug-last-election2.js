const db = require('../backend/config/database');
const AnalyticsService = require('../backend/services/analytics-service');

(async () => {
  await db.connect();
  
  const svc = new AnalyticsService();
  
  console.log('=== Calling getLastElectionBreakdown() ===\n');
  
  try {
    const result = await svc.getLastElectionBreakdown({});
    console.log('SUCCESS - Result keys:', Object.keys(result));
    console.log('election:', JSON.stringify(result.election, null, 2));
    console.log('ageBreakdown count:', result.ageBreakdown?.length);
    console.log('precinctBreakdown count:', result.precinctBreakdown?.length);
    console.log('summary:', JSON.stringify(result.summary, null, 2));
    
    if (result.precinctBreakdown?.length === 0) {
      console.log('\n=== DEBUGGING EMPTY PRECINCT BREAKDOWN ===');
      
      // Check if precincts table has data
      const precincts = await db.all('SELECT * FROM precincts LIMIT 5');
      console.log('Precincts table sample:', JSON.stringify(precincts));
      
      // Check voter precinct_number values
      const voterPrecincts = await db.all('SELECT precinct_number, COUNT(*) as cnt FROM voters GROUP BY precinct_number');
      console.log('Voter precincts:', JSON.stringify(voterPrecincts));
      
      // Check if the HAVING clause is the issue - test without it
      const lastElection = await db.get(`SELECT election_code FROM election_history WHERE voted = 1 GROUP BY election_code ORDER BY CASE WHEN election_code LIKE 'E_%' THEN CAST(SUBSTR(election_code, 3) AS INTEGER) ELSE 0 END DESC LIMIT 1`);
      
      // Test: COUNT with alias 'voted' vs HAVING on 'voted'
      const testWithHaving = await db.all(`
        SELECT 
          v.precinct_number as precinctNumber,
          COUNT(CASE WHEN e.voted = 1 THEN 1 END) as voted
        FROM voters v
        LEFT JOIN election_history e ON v.voter_id = e.voter_id AND e.election_code = ?
        GROUP BY v.precinct_number
        HAVING voted > 0
      `, [lastElection.election_code]);
      console.log('\nTest WITH HAVING voted > 0:', testWithHaving.length, 'rows');
      
      // Test: same but rename alias to avoid ambiguity
      const testRenamed = await db.all(`
        SELECT 
          v.precinct_number as precinctNumber,
          COUNT(CASE WHEN e.voted = 1 THEN 1 END) as votedCount
        FROM voters v
        LEFT JOIN election_history e ON v.voter_id = e.voter_id AND e.election_code = ?
        GROUP BY v.precinct_number
        HAVING votedCount > 0
      `, [lastElection.election_code]);
      console.log('Test WITH HAVING votedCount > 0:', testRenamed.length, 'rows');
      if (testRenamed.length > 0) {
        console.log('Sample:', JSON.stringify(testRenamed.slice(0, 3)));
      }
      
      // Also test: does e.voted column cause ambiguity?
      const testExplicit = await db.all(`
        SELECT 
          v.precinct_number as precinctNumber,
          COUNT(CASE WHEN e.voted = 1 THEN 1 END) as voted_count
        FROM voters v
        LEFT JOIN election_history e ON v.voter_id = e.voter_id AND e.election_code = ?
        GROUP BY v.precinct_number
        HAVING COUNT(CASE WHEN e.voted = 1 THEN 1 END) > 0
      `, [lastElection.election_code]);
      console.log('Test WITH explicit HAVING COUNT(...) > 0:', testExplicit.length, 'rows');
    }
    
    // Also test the totalVoted issue
    console.log('\n=== DEBUGGING totalVoted ===');
    const lastElection = await db.get(`SELECT election_code FROM election_history WHERE voted = 1 GROUP BY election_code ORDER BY CASE WHEN election_code LIKE 'E_%' THEN CAST(SUBSTR(election_code, 3) AS INTEGER) ELSE 0 END DESC LIMIT 1`);
    
    const countDistinct = await db.get(`
      SELECT 
        COUNT(DISTINCT CASE WHEN e.voted = 1 THEN v.id END) as totalVoted,
        COUNT(DISTINCT v.id) as totalRegistered
      FROM voters v
      LEFT JOIN election_history e ON v.voter_id = e.voter_id AND e.election_code = ?
    `, [lastElection.election_code]);
    console.log('COUNT(DISTINCT CASE WHEN e.voted = 1 THEN v.id END):', countDistinct.totalVoted);
    console.log('COUNT(DISTINCT v.id):', countDistinct.totalRegistered);
    
    // Compare with simple count
    const simpleCount = await db.get(`
      SELECT COUNT(DISTINCT eh.voter_id) as cnt
      FROM election_history eh
      WHERE eh.election_code = ? AND eh.voted = 1
    `, [lastElection.election_code]);
    console.log('Simple COUNT(DISTINCT voter_id) from election_history:', simpleCount.cnt);
    
  } catch (err) {
    console.error('FAILED:', err.message);
    console.error('Stack:', err.stack);
  }
  
  process.exit(0);
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
