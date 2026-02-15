# Data Directory

This directory contains all data files for the Voter Outreach & Mapping Platform.

## Directory Structure

```
data/
├── voter_platform.db          # SQLite database (auto-created, .gitignored)
├── backups/                   # Database backups (auto-created)
├── cache/                     # Geocoding cache (auto-created)
├── processed/                 # Processed voter data files
└── raw/                       # Uploaded voter data files (CSV, DBF)
```

## Important Notes

### Security
- **The `voter_platform.db` file is excluded from version control** via `.gitignore`
- **Uploaded files in `raw/` are excluded from version control** to protect voter privacy
- **All data in this directory should be treated as sensitive**

### Backups
- Database backups are automatically created in `backups/` before:
  - Bulk data imports
  - Schema migrations
  - Manual backup operations
- Backups are retained for 30 days (configurable via `BACKUP_RETENTION_DAYS` in `.env`)

### Cache
- The `cache/` directory stores geocoded address results
- Cache reduces Google Maps API usage and improves performance
- Cache entries expire after 90 days (configurable via `CACHE_TTL_DAYS`)

### Raw Data
- Upload CSV or DBF files containing voter data
- Files are automatically moved from `uploads/` to `raw/` after processing
- **DO NOT commit these files to version control** - they contain personal information

## Database

### Location
The SQLite database is stored at: `./data/voter_platform.db`

### Schema
The database contains the following main tables:
- `voters` - Voter registration records
- `precincts` - Electoral precinct boundaries
- `geocoding_cache` - Cached address → lat/lng mappings
- `geocoding_jobs` - Batch geocoding job tracking

### Backup and Restore

**Manual Backup:**
```bash
# Create a timestamped backup
cp data/voter_platform.db data/backups/voter_platform_$(date +%Y%m%d_%H%M%S).db
```

**Restore from Backup:**
```bash
# Stop the server first, then:
cp data/backups/voter_platform_YYYYMMDD_HHMMSS.db data/voter_platform.db
```

## Best Practices

1. **Never commit the database file** - It's already in `.gitignore`
2. **Regularly backup before major operations** - Use the backup feature in the UI
3. **Test imports with small datasets first** - Verify data mapping before bulk uploads
4. **Monitor cache size** - The geocoding cache can grow large over time
5. **Secure your environment** - Ensure proper file permissions in production

## Troubleshooting

### Database Locked
If you get "database is locked" errors:
1. Ensure only one instance of the server is running
2. Check for background processes holding the database
3. Wait a few minutes for connections to timeout

### Missing Directory
The server automatically creates missing directories on startup. If you encounter issues:
```bash
mkdir -p data/backups data/cache data/processed data/raw logs
```
