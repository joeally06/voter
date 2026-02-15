const database = require('./backend/config/database');

async function checkTables() {
  try {
    await database.connect();
    console.log('✅ Database connected');
    
    const tables = await database.all(`
      SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
    `);
    
    console.log('\n📋 Existing tables:');
    tables.forEach(t => console.log(`  - ${t.name}`));
    
    // Check specific geocoding tables
    const requiredTables = ['geocoding_jobs', 'geocoding_errors', 'api_quotas'];
    console.log('\n🔍 Checking required geocoding tables:');
    
    for (const tableName of requiredTables) {
      const exists = tables.find(t => t.name === tableName);
      if (exists) {
        console.log(`  ✅ ${tableName}`);
      } else {
        console.log(`  ❌ ${tableName} (MISSING)`);
      }
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkTables();
