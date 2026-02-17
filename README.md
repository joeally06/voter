# Voter Outreach & Mapping Platform

A local web application for processing voter database files (.dbf) from the Obion County Election Commission and visualizing voter locations using Google Maps for political outreach purposes.

## Quick Start

### Prerequisites
- Node.js 16.0+ and npm 8.0+
- Google Maps API key with Geocoding and Maps JavaScript API enabled
- Windows, Mac, or Linux operating system

### Installation

1. **Clone and Setup**
   ```bash
   cd c:\Voter
   npm install
   ```

2. **Configure Environment**
   ```bash
   copy .env.example .env
   # Edit .env file with your Google Maps API keys
   ```

3. **Initialize Database**
   ```bash
   npm run setup
   ```

4. **Start Development Server**
   ```bash
   # From project root (C:\Voter)
   npm start
   # or for auto-reload during development
   npm run dev
   ```
   
   **Important**: Always run from the project root directory, not from `backend/` subdirectory.

5. **Open Application**
   Navigate to `http://localhost:3000`

## Core Features

### 📊 Data Processing
- **DBF File Import**: Parse Obion County voter database files
- **Address Geocoding**: Convert addresses to map coordinates using Google Maps
- **Election History**: Analyze voting patterns from E_1/E_2 fields
- **Data Validation**: Clean and validate voter records

### 🗺️ Interactive Mapping
- **Voter Visualization**: Display voters as markers on Google Maps
- **Color Coding**: Markers colored by voting history and party affiliation
- **Precinct Filtering**: View voters by specific precinct numbers
- **Route Planning**: Calculate optimal canvassing routes

### 🔍 Filtering & Search
- **Super Voter Identification**: Find high-frequency voters
- **Geographic Search**: Filter by address, city, or zip code
- **Voting History**: Filter by election participation patterns
- **Custom Criteria**: Combine multiple filters for targeted lists

### 📈 Analytics & Reports
- **Turnout Analysis**: Historical voting pattern statistics
- **Precinct Summary**: Voter counts and demographics by area
- **Export Options**: Download filtered data as CSV/Excel
- **Performance Dashboard**: Real-time import and geocoding status

## File Structure

```
voter-platform/
├── backend/           # Node.js server and APIs
├── frontend/          # HTML/CSS/JavaScript interface
├── data/             # DBF files and processed data
├── docs/             # Documentation
├── tests/            # Test files
└── scripts/          # Utility scripts
```

## Data Schema (DBF Fields)

| Field | Description | Usage |
|-------|-------------|-------|
| LNAME | Last Name | Voter identification |
| FNAME | First Name | Voter identification |
| ADDRESS | Residential Address | Geocoding target |
| CITY | City | Location accuracy |
| ZIP | Zip Code | Location accuracy |
| PCT_NBR | Precinct Number | Geographic sorting |
| E_1 | Election 1 History | Voting pattern analysis |
| E_2 | Election 2 History | Voting pattern analysis |

### Election History Format (E_1/E_2)
- **Position 1**: Voted (Y/N)
- **Position 2**: Party (D/R/Other)
- **Position 3**: Early Voted (Y/N)

## API Endpoints

### Data Management
- `POST /api/upload/dbf` - Upload DBF files
- `GET /api/voters` - Get voter records
- `GET /api/precincts` - List precincts

### Mapping
- `GET /api/map/markers` - Get map markers
- `POST /api/geocode/batch` - Geocode addresses
- `GET /api/map/routes` - Calculate routes

### Analytics
- `GET /api/analytics/voting-patterns` - Voting analysis
- `GET /api/analytics/turnout` - Turnout statistics

## Configuration

### Google Maps API Setup
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable these APIs:
   - Maps JavaScript API
   - Geocoding API
   - (Optional) Distance Matrix API
4. Create API key and add to `.env` file

### Database Schema
The application uses SQLite for local data storage:
- `voters` - Main voter records
- `election_history` - Voting patterns
- `precincts` - Precinct information
- `geocoding_cache` - Cached coordinates

## Development Commands

```bash
# Start development server
npm run dev

# Import DBF file
npm run import-data -- --file path/to/voters.dbf

# Batch geocode addresses
npm run geocode

# Run tests
npm test

# Production build
npm start
```

## Data Security & Compliance

### Local-Only Hosting
- All data remains on local machine
- No public web access
- Compliant with political use requirements

### Security Features
- Secure API key management
- Audit logging for data access
- No external data transmission (except Google Maps API)
- Regular backup procedures

## Performance Optimization

### Large Dataset Handling
- **Marker Clustering**: Groups nearby markers for performance
- **Lazy Loading**: Loads data as needed
- **Geocoding Cache**: Avoids duplicate API calls
- **Database Indexes**: Optimized queries for fast filtering

### Google Maps API Efficiency
- **Request Batching**: Process multiple addresses together
- **Rate Limiting**: Stay within API quotas
- **Local Caching**: Store results to minimize API usage
- **Error Handling**: Graceful handling of API failures

## Troubleshooting

### Server Won't Start - "No Such Table: voters"

**Symptoms**:
- Error: `SQLITE_ERROR: no such table: voters`
- Server crashes immediately on startup
- All API endpoints return 500 errors

**Root Cause**: Working directory issue - server must be run from project root.

**Solution**:
```powershell
# ✅ CORRECT: Run from project root
cd C:\Voter
npm start

# ✅ ALTERNATIVE: Use npm scripts (they always run from project root)
npm run dev

# ❌ INCORRECT: Don't run from backend/ directory
cd backend
node server.js  # This will fail!
```

**Diagnosis**:
```powershell
# Run health check to diagnose issues
npm run doctor

# Check database manually
cd C:\Voter
node check-tables.js
```

**Still Having Issues?**
1. Run setup script: `npm run setup`
2. Check .env file exists and has `GOOGLE_MAPS_API_KEY`
3. Ensure you're in the correct directory: `C:\Voter`
4. Kill hanging processes: `Get-Process -Name node | Stop-Process -Force`

---

### Port 3000 Already in Use

**Symptoms**:
- Error: `PORT CONFLICT ERROR: Port 3000 is already in use`

**Solution**:
```powershell
# Kill all node processes
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force

# Or use cleanup script (included in npm start)
npm run prestart

# Then start normally
npm start
```

---

### Common Issues

1. **DBF Import Fails**
   - Check file format matches expected schema
   - Verify file permissions
   - Review import logs for specific errors

2. **Geocoding Errors**
   - Confirm Google Maps API key is valid
   - Check API quotas and billing
   - Verify internet connection

3. **Map Not Loading**
   - Ensure Maps JavaScript API is enabled
   - Check browser console for errors
   - Verify API key permissions

### Support
- Run `npm run doctor` for automated diagnostics
- Check `logs/app.log` for detailed error messages
- Review API usage in Google Cloud Console
- Test with small data files first

## License & Usage

This software is for **political campaign use only** as per the data usage agreement with Obion County Election Commission. The voter data must not be used for commercial purposes or made publicly accessible.

## Next Steps

1. **Setup Environment**: Configure Google Maps API keys
2. **Import Data**: Upload your first DBF file
3. **Explore Interface**: Test filtering and mapping features
4. **Plan Routes**: Use route planning for efficient canvassing
5. **Export Lists**: Generate targeted voter contact lists