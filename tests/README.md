# Test Suite Documentation

## Overview

Comprehensive test suite for the Voter Outreach & Mapping Platform Phase 2 Data Import system.

## Test Structure

```
tests/
├── unit/                           # Unit tests (isolated component testing)
│   ├── parsers/
│   │   ├── dbf-parser.test.js     # DBF file parsing tests
│   │   └── csv-parser.test.js     # CSV file parsing tests
│   └── models/
│       └── voter.test.js          # Voter model CRUD tests
└── integration/                    # Integration tests (end-to-end workflows)
    ├── import-flow.test.js        # Complete import workflow tests
    └── api-routes.test.js         # API endpoint tests
```

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Unit Tests Only
```bash
npm test -- tests/unit
```

### Run Integration Tests Only
```bash
npm test -- tests/integration
```

### Run Specific Test File
```bash
npm test -- tests/unit/parsers/dbf-parser.test.js
```

### Run Tests with Coverage
```bash
npm test -- --coverage
```

### Run Tests in Watch Mode
```bash
npm test -- --watch
```

## Coverage Goals

- **Minimum Target**: 80% code coverage
- **Current Coverage**: Run `npm test -- --coverage` to see current metrics

### Coverage Breakdown by Component:

| Component | Target | Description |
|-----------|--------|-------------|
| Parsers | 85% | DBF and CSV parsing logic |
| Models | 85% | Voter CRUD operations |
| Services | 80% | Import processor |
| Routes | 75% | API endpoints |

## Test Categories

### Unit Tests

Test individual functions and components in isolation:

1. **DBF Parser** (`dbf-parser.test.js`)
   - Field name variations
   - Election history parsing
   - Data sanitization
   - Error handling

2. **CSV Parser** (`csv-parser.test.js`)
   - Delimiter detection
   - Header mapping
   - Data validation
   - Template generation

3. **Voter Model** (`voter.test.js`)
   - CRUD operations
   - Deduplication modes (skip/replace/flag)
   - Super voter calculation
   - Precinct statistics

### Integration Tests

Test complete workflows and system interactions:

1. **Import Flow** (`import-flow.test.js`)
   - End-to-end CSV import
   - Batch processing (500 records/batch)
   - Transaction rollback on errors
   - Progress tracking
   - Error logging
   - Precinct statistics updates

2. **API Routes** (`api-routes.test.js`)
   - File upload endpoints (DBF/CSV)
   - Upload history and status
   - Voter listing and filtering
   - Search functionality
   - Input validation
   - Error responses

## Test Data

Tests use temporary:
- SQLite databases (automatically cleaned up)
- CSV/DBF files in system temp directory
- No effect on production or development data

## Debugging Tests

### Run Single Test
```bash
npm test -- -t "test name pattern"
```

### Enable Debug Output
```bash
DEBUG=* npm test
```

### Check for Open Handles
```bash
npm test -- --detectOpenHandles
```

## Continuous Integration

Tests should pass before:
- Committing code
- Creating pull requests
- Deploying to production

## Writing New Tests

### Test File Naming
- Unit tests: `<component>.test.js`
- Integration tests: `<feature>.test.js`

### Test Structure
```javascript
describe('Component Name', () => {
    describe('function or feature', () => {
        test('should do something specific', () => {
            // Arrange
            const input = setupInput();
            
            // Act
            const result = functionUnderTest(input);
            
            // Assert
            expect(result).toBe(expectedValue);
        });
    });
});
```

### Best Practices
- One assertion per test when possible
- Clear, descriptive test names
- Test both success and error paths
- Clean up resources (databases, files)
- Mock external dependencies
- Use beforeEach/afterEach for setup/teardown

## Troubleshooting

### Tests Timeout
Increase timeout in jest.config.js or specific test:
```javascript
test('slow test', async () => {
    // test code
}, 60000); // 60 second timeout
```

### Database Locked
Ensure tests properly close database connections:
```javascript
afterAll(async () => {
    await database.close();
});
```

### File Cleanup Issues
Verify temp files are removed:
```javascript
afterEach(() => {
    if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
    }
});
```

## Dependencies

Test framework dependencies (already in package.json):
- `jest`: Test runner and assertion library
- `supertest`: HTTP endpoint testing
- `@types/jest`: TypeScript type definitions

## Next Steps

1. Run tests: `npm test`
2. Check coverage: `npm test -- --coverage`
3. Review failed tests (if any)
4. Add tests for new features
5. Maintain 80%+ coverage
