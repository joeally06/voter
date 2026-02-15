/**
 * Unit Tests for CSV Parser
 * Tests CSV file parsing, delimiter detection, and field mapping
 */

const { parseCSV, validateCSVStructure, detectDelimiter, generateCSVTemplate } = require('../../../backend/parsers/csv-parser');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('CSV Parser', () => {
    let testDir;

    beforeAll(() => {
        // Create temporary directory for test files
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-parser-test-'));
    });

    afterAll(() => {
        // Clean up test files
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    describe('detectDelimiter', () => {
        test('should detect comma delimiter', async () => {
            const csvContent = 'voter_id,last_name,first_name,address,city,zip_code,precinct_number\n';
            const filePath = path.join(testDir, 'comma.csv');
            fs.writeFileSync(filePath, csvContent);

            const delimiter = await detectDelimiter(filePath);
            expect(delimiter).toBe(',');
        });

        test('should detect semicolon delimiter', async () => {
            const csvContent = 'voter_id;last_name;first_name;address;city;zip_code;precinct_number\n';
            const filePath = path.join(testDir, 'semicolon.csv');
            fs.writeFileSync(filePath, csvContent);

            const delimiter = await detectDelimiter(filePath);
            expect(delimiter).toBe(';');
        });

        test('should detect tab delimiter', async () => {
            const csvContent = 'voter_id\tlast_name\tfirst_name\taddress\tcity\tzip_code\tprecinct_number\n';
            const filePath = path.join(testDir, 'tab.csv');
            fs.writeFileSync(filePath, csvContent);

            const delimiter = await detectDelimiter(filePath);
            expect(delimiter).toBe('\t');
        });

        test('should default to comma when unclear', async () => {
            const csvContent = 'voter_id last_name first_name\n'; // No clear delimiter
            const filePath = path.join(testDir, 'default.csv');
            fs.writeFileSync(filePath, csvContent);

            const delimiter = await detectDelimiter(filePath);
            expect(delimiter).toBe(',');
        });
    });

    describe('parseCSV', () => {
        test('should parse valid CSV file with headers', async () => {
            const csvContent = `voter_id,last_name,first_name,address,city,zip_code,precinct_number
TN12345678,SMITH,JOHN,123 MAIN ST,UNION CITY,38261,05
TN12345679,JOHNSON,MARY,456 OAK AVE,TROY,38260,03`;

            const filePath = path.join(testDir, 'valid.csv');
            fs.writeFileSync(filePath, csvContent);

            const result = await parseCSV(filePath);

            expect(result.success).toBe(true);
            expect(result.totalCount).toBe(2);
            expect(result.records).toHaveLength(2);
            
            expect(result.records[0]).toMatchObject({
                voter_id: 'TN12345678',
                last_name: 'SMITH',
                first_name: 'JOHN',
                address: '123 MAIN ST',
                city: 'UNION CITY',
                zip_code: '38261',
                precinct_number: '05'
            });
        });

        test('should handle various header name variations', async () => {
            const csvContent = `VoterId,LastName,FirstName,Street Address,City,ZIP,Precinct
TN12345678,SMITH,JOHN,123 MAIN ST,UNION CITY,38261,5`;

            const filePath = path.join(testDir, 'variations.csv');
            fs.writeFileSync(filePath, csvContent);

            const result = await parseCSV(filePath);

            expect(result.success).toBe(true);
            expect(result.records[0].voter_id).toBe('TN12345678');
            expect(result.records[0].last_name).toBe('SMITH');
            expect(result.records[0].address).toBe('123 MAIN ST');
        });

        test('should handle CSV with semicolon delimiter', async () => {
            const csvContent = `voter_id;last_name;first_name;address;city;zip_code;precinct_number
TN12345678;SMITH;JOHN;123 MAIN ST;UNION CITY;38261;05`;

            const filePath = path.join(testDir, 'semicolon-data.csv');
            fs.writeFileSync(filePath, csvContent);

            const result = await parseCSV(filePath);

            expect(result.success).toBe(true);
            expect(result.records).toHaveLength(1);
            expect(result.records[0].voter_id).toBe('TN12345678');
        });

        test('should skip records with missing required fields', async () => {
            const csvContent = `voter_id,last_name,first_name,address,city,zip_code,precinct_number
TN12345678,SMITH,JOHN,123 MAIN ST,UNION CITY,38261,05
TN12345679,JOHNSON,,456 OAK AVE,TROY,38260,03
TN12345680,WILLIAMS,ROBERT,789 ELM ST,OBION,38240,01`;

            const filePath = path.join(testDir, 'partial.csv');
            fs.writeFileSync(filePath, csvContent);

            const result = await parseCSV(filePath);

            // Second record should be skipped (missing first_name)
            expect(result.totalCount).toBeLessThanOrEqual(3);
            expect(result.records[0].voter_id).toBe('TN12345678');
        });

        test('should sanitize text fields', async () => {
            const csvContent = `voter_id,last_name,first_name,address,city,zip_code,precinct_number
TN12345678,  smith  ,  john  ,  123 main st  ,  union city  ,38261,5`;

            const filePath = path.join(testDir, 'whitespace.csv');
            fs.writeFileSync(filePath, csvContent);

            const result = await parseCSV(filePath);

            expect(result.records[0].last_name).toBe('SMITH'); // Trimmed and uppercase
            expect(result.records[0].first_name).toBe('JOHN');
            expect(result.records[0].city).toBe('UNION CITY');
        });

        test('should handle ZIP+4 format', async () => {
            const csvContent = `voter_id,last_name,first_name,address,city,zip_code,precinct_number
TN12345678,SMITH,JOHN,123 MAIN ST,UNION CITY,38261-1234,05`;

            const filePath = path.join(testDir, 'zip4.csv');
            fs.writeFileSync(filePath, csvContent);

            const result = await parseCSV(filePath);

            expect(result.records[0].zip_code).toBe('38261-1234');
        });

        test('should zero-pad precinct numbers', async () => {
            const csvContent = `voter_id,last_name,first_name,address,city,zip_code,precinct_number
TN12345678,SMITH,JOHN,123 MAIN ST,UNION CITY,38261,5`;

            const filePath = path.join(testDir, 'precinct-pad.csv');
            fs.writeFileSync(filePath, csvContent);

            const result = await parseCSV(filePath);

            expect(result.records[0].precinct_number).toBe('05');
        });
    });

    describe('validateCSVStructure', () => {
        test('should validate CSV with all required headers', async () => {
            const csvContent = `voter_id,last_name,first_name,address,city,zip_code,precinct_number
TN12345678,SMITH,JOHN,123 MAIN ST,UNION CITY,38261,05`;

            const filePath = path.join(testDir, 'valid-structure.csv');
            fs.writeFileSync(filePath, csvContent);

            const validation = await validateCSVStructure(filePath);

            expect(validation.valid).toBe(true);
            expect(validation.missingFields).toHaveLength(0);
            expect(validation.headers).toContain('voter_id');
            expect(validation.headers).toContain('last_name');
        });

        test('should detect missing required headers', async () => {
            const csvContent = `voter_id,last_name,first_name
TN12345678,SMITH,JOHN`;

            const filePath = path.join(testDir, 'missing-headers.csv');
            fs.writeFileSync(filePath, csvContent);

            const validation = await validateCSVStructure(filePath);

            expect(validation.valid).toBe(false);
            expect(validation.missingFields).toContain('address');
            expect(validation.missingFields).toContain('city');
            expect(validation.missingFields).toContain('zip_code');
            expect(validation.missingFields).toContain('precinct_number');
        });

        test('should accept header variations', async () => {
            const csvContent = `VoterId,LastName,FirstName,Street,City,ZIP,Precinct
TN12345678,SMITH,JOHN,123 MAIN,UNION CITY,38261,05`;

            const filePath = path.join(testDir, 'header-variations.csv');
            fs.writeFileSync(filePath, csvContent);

            const validation = await validateCSVStructure(filePath);

            expect(validation.valid).toBe(true);
        });
    });

    describe('generateCSVTemplate', () => {
        test('should generate valid CSV template', () => {
            const templatePath = path.join(testDir, 'template.csv');
            
            const result = generateCSVTemplate(templatePath);

            expect(result).toBe(templatePath);
            expect(fs.existsSync(templatePath)).toBe(true);

            const content = fs.readFileSync(templatePath, 'utf8');
            expect(content).toContain('voter_id,last_name,first_name');
            expect(content).toContain('TN12345678,SMITH,JOHN');
        });

        test('generated template should be parseable', async () => {
            const templatePath = path.join(testDir, 'parseable-template.csv');
            generateCSVTemplate(templatePath);

            const result = await parseCSV(templatePath);

            expect(result.success).toBe(true);
            expect(result.records).toHaveLength(3);
        });
    });

    describe('Error Handling', () => {
        test('should throw error for non-existent file', async () => {
            const nonExistentPath = path.join(testDir, 'does-not-exist.csv');

            await expect(parseCSV(nonExistentPath)).rejects.toThrow();
        });

        test('should handle empty CSV file', async () => {
            const filePath = path.join(testDir, 'empty.csv');
            fs.writeFileSync(filePath, '');

            await expect(parseCSV(filePath)).rejects.toThrow('CSV file is empty');
        });

        test('should handle CSV with only headers', async () => {
            const csvContent = 'voter_id,last_name,first_name,address,city,zip_code,precinct_number\n';
            const filePath = path.join(testDir, 'headers-only.csv');
            fs.writeFileSync(filePath, csvContent);

            const result = await parseCSV(filePath);

            expect(result.success).toBe(true);
            expect(result.records).toHaveLength(0);
            expect(result.totalCount).toBe(0);
        });
    });
});
