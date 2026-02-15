/**
 * Unit Tests for DBF Parser
 * Tests DBF file parsing, field mapping, and election history extraction
 */

const { parseDBF, inspectDBF, normalizeDBFRecord, parseElectionHistory } = require('../../../backend/parsers/dbf-parser');
const path = require('path');
const fs = require('fs');

describe('DBF Parser', () => {
    describe('normalizeDBFRecord', () => {
        test('should normalize a valid DBF record with all required fields', () => {
            const rawRecord = {
                VOTER_ID: 'TN12345678',
                LNAME: 'Smith',
                FNAME: 'John',
                ADDRESS: '123 Main St',
                CITY: 'Union City',
                ZIP: '38261',
                PCT_NBR: '5'
            };

            const normalized = normalizeDBFRecord(rawRecord, 1);

            expect(normalized.voter_id).toBe('TN12345678');
            expect(normalized.last_name).toBe('SMITH');
            expect(normalized.first_name).toBe('JOHN');
            expect(normalized.address).toBe('123 MAIN ST');
            expect(normalized.city).toBe('UNION CITY');
            expect(normalized.zip_code).toBe('38261');
            expect(normalized.precinct_number).toBe('05');
            expect(normalized.recordNumber).toBe(1);
        });

        test('should handle field name variations (case-insensitive)', () => {
            const baseRecord = {
                VOTER_ID: 'TN12345678',
                LNAME: 'Test',
                FNAME: 'User',
                ADDRESS: '123 Test',
                CITY: 'Test City',
                ZIP: '12345',
                PCT_NBR: '1'
            };

            // Test voter_id variations
            const voterIdVariations = ['VOTER_ID', 'VOTERID', 'ID'];
            voterIdVariations.forEach(variant => {
                const record = { ...baseRecord };
                delete record.VOTER_ID;
                record[variant] = 'TN87654321';
                const normalized = normalizeDBFRecord(record, 1);
                expect(normalized.voter_id).toBe('TN87654321');
            });

            // Test last_name variations
            const lastNameVariations = ['LNAME', 'LAST_NAME', 'LASTNAME', 'SURNAME'];
            lastNameVariations.forEach(variant => {
                const record = { ...baseRecord };
                delete record.LNAME;
                record[variant] = 'TestLast';
                const normalized = normalizeDBFRecord(record, 1);
                expect(normalized.last_name).toBe('TESTLAST');
            });

            // Test precinct variations
            const precinctVariations = ['PCT_NBR', 'PRECINCT', 'PRECINCT_NUMBER', 'PCT', 'PREC'];
            precinctVariations.forEach(variant => {
                const record = { ...baseRecord };
                delete record.PCT_NBR;
                record[variant] = '8';
                const normalized = normalizeDBFRecord(record, 1);
                expect(normalized.precinct_number).toBe('08');
            });
        });

        test('should throw error when required fields are missing', () => {
            const invalidRecord = {
                VOTER_ID: 'TN12345678',
                LNAME: 'Smith'
                // Missing other required fields
            };

            expect(() => normalizeDBFRecord(invalidRecord, 1)).toThrow('Missing required fields');
        });

        test('should sanitize ZIP code formats correctly', () => {
            const testCases = [
                { input: '38261', expected: '38261' },
                { input: '38261-1234', expected: '38261-1234' },
                { input: '382611234', expected: '38261' }, // Extract first 5 digits
                { input: ' 38261 ', expected: '38261' }
            ];

            testCases.forEach(({ input, expected }) => {
                const record = {
                    VOTER_ID: 'TN12345678',
                    LNAME: 'Test',
                    FNAME: 'User',
                    ADDRESS: '123 Test',
                    CITY: 'Test',
                    ZIP: input,
                    PCT_NBR: '1'
                };

                const normalized = normalizeDBFRecord(record, 1);
                expect(normalized.zip_code).toBe(expected);
            });
        });

        test('should zero-pad precinct numbers', () => {
            const testCases = [
                { input: '1', expected: '01' },
                { input: '5', expected: '05' },
                { input: '12', expected: '12' },
                { input: 5, expected: '05' }
            ];

            testCases.forEach(({ input, expected }) => {
                const record = {
                    VOTER_ID: 'TN12345678',
                    LNAME: 'Test',
                    FNAME: 'User',
                    ADDRESS: '123 Test',
                    CITY: 'Test',
                    ZIP: '12345',
                    PCT_NBR: input
                };

                const normalized = normalizeDBFRecord(record, 1);
                expect(normalized.precinct_number).toBe(expected);
            });
        });

        test('should remove non-printable characters from text fields', () => {
            const record = {
                VOTER_ID: 'TN12345678',
                LNAME: 'Smith\x00\x01',
                FNAME: 'John\t\n',
                ADDRESS: '123\x00 Main',
                CITY: 'Union\rCity',
                ZIP: '38261',
                PCT_NBR: '5'
            };

            const normalized = normalizeDBFRecord(record, 1);

            expect(normalized.last_name).not.toContain('\x00');
            expect(normalized.first_name).not.toContain('\t');
            expect(normalized.address).not.toContain('\x00');
        });
    });

    describe('parseElectionHistory', () => {
        test('should parse election codes for Republican voters', () => {
            const record = {
                E_1: 'R',   // Republican
                E_2: 'RE',  // Republican Early
                E_3: 'D',   // Democratic
                E_4: 'N'    // Did not vote
            };

            const history = parseElectionHistory(record);

            expect(history).toHaveLength(4);
            expect(history[0]).toMatchObject({
                electionCode: 'E_1',
                voted: true,
                partyCode: 'R',
                earlyVoted: false
            });
            expect(history[1]).toMatchObject({
                electionCode: 'E_2',
                voted: true,
                partyCode: 'R',
                earlyVoted: true
            });
            expect(history[2]).toMatchObject({
                electionCode: 'E_3',
                voted: true,
                partyCode: 'D',
                earlyVoted: false
            });
            expect(history[3]).toMatchObject({
                electionCode: 'E_4',
                voted: false,
                partyCode: null,
                earlyVoted: false
            });
        });

        test('should parse general election codes', () => {
            const record = {
                E_1: 'Y',   // Yes (voted)
                E_2: 'E',   // Early voted
                E_3: 'YE',  // Yes, early
                E_4: '1'    // Voted (numeric)
            };

            const history = parseElectionHistory(record);

            expect(history).toHaveLength(4);
            expect(history[0].voted).toBe(true);
            expect(history[1].earlyVoted).toBe(true);
            expect(history[2].voted).toBe(true);
            expect(history[2].earlyVoted).toBe(true);
        });

        test('should skip empty or null election values', () => {
            const record = {
                E_1: 'R',
                E_2: '',
                E_3: null,
                E_4: 'D'
            };

            const history = parseElectionHistory(record);

            expect(history).toHaveLength(2); // Only E_1 and E_4
            expect(history[0].electionCode).toBe('E_1');
            expect(history[1].electionCode).toBe('E_4');
        });

        test('should handle Independent voters', () => {
            const record = {
                E_1: 'I',   // Independent
                E_2: 'IE'   // Independent Early
            };

            const history = parseElectionHistory(record);

            expect(history[0]).toMatchObject({
                voted: true,
                partyCode: 'I',
                earlyVoted: false
            });
            expect(history[1]).toMatchObject({
                voted: true,
                partyCode: 'I',
                earlyVoted: true
            });
        });
    });

    describe('Error Handling', () => {
        test('should handle malformed records gracefully', () => {
            const malformedRecord = {
                VOTER_ID: null,
                LNAME: undefined,
                FNAME: '',
                ADDRESS: 123,  // Number instead of string
                CITY: 'Test',
                ZIP: 'invalid',
                PCT_NBR: 'abc'
            };

            expect(() => normalizeDBFRecord(malformedRecord, 1)).toThrow();
        });

        test('should handle records with extra fields', () => {
            const recordWithExtras = {
                VOTER_ID: 'TN12345678',
                LNAME: 'Smith',
                FNAME: 'John',
                ADDRESS: '123 Main',
                CITY: 'Union City',
                ZIP: '38261',
                PCT_NBR: '5',
                // Extra fields
                PHONE: '555-1234',
                EMAIL: 'test@test.com',
                NOTES: 'Extra data'
            };

            const normalized = normalizeDBFRecord(recordWithExtras, 1);
            expect(normalized.voter_id).toBe('TN12345678');
            // Extra fields should be in the raw object
            expect(normalized.raw.PHONE).toBe('555-1234');
        });
    });
});
