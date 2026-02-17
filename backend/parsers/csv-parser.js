/**
 * CSV Parser
 * Parses CSV files with voter registration data
 * Supports flexible header mapping and various CSV formats
 */

const csv = require('csv-parser');
const fs = require('fs');
const readline = require('readline');
const { sanitizeText, sanitizeZipCode, sanitizePrecinct, sanitizeDate } = require('./parser-utils');

/**
 * Parse a CSV file and extract voter records
 * Supports automatic delimiter detection and flexible header mapping
 * @param {string} filePath - Absolute path to CSV file
 * @param {Object} [options={}] - Parsing options
 * @param {boolean} [options.hasHeaders=true] - Whether CSV file has a header row
 * @param {string} [options.delimiter=null] - Delimiter character (auto-detected if not provided)
 * @returns {Promise<Object>} Parsed data with records and metadata
 * @property {Array<Object>} records - Array of normalized voter records
 * @property {number} totalCount - Total number of successfully parsed records
 * @property {Array<string>} headers - Column headers found in CSV
 * @property {boolean} success - Always true if no exception thrown
 * @throws {Error} If file cannot be read or parsed
 */
async function parseCSV(filePath, options = {}) {
    const { hasHeaders = true, delimiter = null } = options;

    try {
        // Auto-detect delimiter if not provided
        const detectedDelimiter = delimiter || await detectDelimiter(filePath);

        const records = [];
        let recordNumber = 0;
        let headers = [];

        return new Promise((resolve, reject) => {
            const stream = fs.createReadStream(filePath)
                .pipe(csv({
                    separator: detectedDelimiter,
                    strict: false,
                    skipLines: hasHeaders ? 0 : 0,
                    mapHeaders: ({ header, index }) => {
                        if (!hasHeaders) {
                            // Generate default headers if none provided
                            return `column_${index}`;
                        }
                        // Normalize header names
                        const normalized = header.trim().toLowerCase();
                        headers.push(normalized);
                        return normalized;
                    }
                }))
                .on('data', (row) => {
                    recordNumber++;
                    try {
                        const normalizedRecord = normalizeCSVRecord(row, recordNumber, hasHeaders);
                        records.push(normalizedRecord);
                    } catch (error) {
                        // Still push invalid records so import processor can handle validation
                        // Create a partial record with whatever data is available
                        const partialRecord = {
                            voter_id: row.voter_id || row.voterid || row.id || '',
                            last_name: row.last_name || row.lastname || '',
                            first_name: row.first_name || row.firstname || '',
                            address: row.address || row.street || '',
                            city: row.city || '',
                            zip_code: row.zip_code || row.zip || '',
                            precinct_number: row.precinct_number || row.precinct || '',
                            recordNumber,
                            electionHistory: [],
                            _parseError: error.message // Flag for debugging
                        };
                        records.push(partialRecord);
                    }
                })
                .on('end', () => {
                    resolve({
                        records,
                        totalCount: records.length,
                        headers,
                        success: true
                    });
                })
                .on('error', (error) => {
                    reject(new Error(`Failed to parse CSV file: ${error.message}`));
                });
        });
    } catch (error) {
        console.error('CSV parsing error:', error);
        throw new Error(`Failed to parse CSV file: ${error.message}`);
    }
}

/**
 * Detect CSV delimiter by analyzing first line
 * Counts occurrences of common delimiters and returns the most frequent
 * @param {string} filePath - Absolute path to CSV file
 * @returns {Promise<string>} Detected delimiter: ',' (comma), ';' (semicolon), or '\t' (tab)
 * @throws {Error} If file cannot be read
 */
async function detectDelimiter(filePath) {
    return new Promise((resolve, reject) => {
        let lineProcessed = false;
        
        const rl = readline.createInterface({
            input: fs.createReadStream(filePath),
            crlfDelay: Infinity
        });

        rl.on('line', (line) => {
            lineProcessed = true;
            rl.close();
            
            // Count occurrences of common delimiters
            const commaCount = (line.match(/,/g) || []).length;
            const semicolonCount = (line.match(/;/g) || []).length;
            const tabCount = (line.match(/\t/g) || []).length;

            // Return the most common delimiter
            if (semicolonCount > commaCount && semicolonCount > tabCount) {
                resolve(';');
            } else if (tabCount > commaCount && tabCount > semicolonCount) {
                resolve('\t');
            } else {
                resolve(','); // Default to comma
            }
        });

        rl.on('close', () => {
            if (!lineProcessed) {
                // Empty file or no lines - reject with error
                reject(new Error('CSV file is empty or has no content'));
            }
        });

        rl.on('error', reject);
    });
}

/**
 * Normalize a CSV record to standard voter format with field mapping
 * Handles 30+ header name variations and sanitizes all data
 * @param {Object} rawRecord - Raw CSV record with header-mapped fields
 * @param {number} recordNumber - Record line number (for error reporting)
 * @param {boolean} hasHeaders - Whether CSV file has headers (affects field mapping)
 * @returns {Object} Normalized voter record
 * @property {string} voter_id - State voter ID (sanitized, uppercase)
 * @property {string} last_name - Last name (sanitized, uppercase)
 * @property {string} first_name - First name (sanitized, uppercase)
 * @property {string} address - Street address (sanitized, uppercase)
 * @property {string} city - City name (sanitized, uppercase)
 * @property {string} zip_code - ZIP code (validated format)
 * @property {string} precinct_number - Precinct number (zero-padded)
 * @property {number} recordNumber - Original record number
 * @property {Array<Object>} electionHistory - Empty array (CSV files don't include election history)
 * @throws {Error} If required fields are missing after normalization
 */
function normalizeCSVRecord(rawRecord, recordNumber, hasHeaders) {
    // Map CSV field names to standardized names (case-insensitive)
    const fieldMappings = {
        // Voter ID variations
        'voter_id': 'voter_id',
        'voterid': 'voter_id',
        'voter id': 'voter_id',
        'id': 'voter_id',
        'state_id': 'voter_id',
        
        // Last name variations
        'last_name': 'last_name',
        'lastname': 'last_name',
        'lname': 'last_name',
        'surname': 'last_name',
        'family_name': 'last_name',
        
        // First name variations
        'first_name': 'first_name',
        'firstname': 'first_name',
        'fname': 'first_name',
        'given_name': 'first_name',
        
        // Address variations
        'address': 'address',
        'street': 'address',
        'street_address': 'address',
        'addr': 'address',
        'street_addr': 'address',
        'street address': 'address',
        
        // City variations
        'city': 'city',
        
        // ZIP code variations
        'zip': 'zip_code',
        'zip_code': 'zip_code',
        'zipcode': 'zip_code',
        'postal_code': 'zip_code',
        'zip code': 'zip_code',
        
        // Precinct variations
        'precinct': 'precinct_number',
        'precinct_number': 'precinct_number',
        'precinctNumber': 'precinct_number',
        'precinctnumber': 'precinct_number',
        'pct_nbr': 'precinct_number',
        'pct': 'precinct_number',
        'precinct number': 'precinct_number',
        
        // State variations (CRITICAL FIX: Add state field mapping)
        'state': 'state',
        'st': 'state',
        'mailstate': 'state',
        
        // Date of birth variations
        'dob': 'date_of_birth',
        'date_of_birth': 'date_of_birth',
        'dateofbirth': 'date_of_birth',
        'birthdate': 'date_of_birth',
        'birth_date': 'date_of_birth',
        'birthday': 'date_of_birth'
    };

    // Map fields using case-insensitive matching
    const normalizedFields = {};
    for (const [key, value] of Object.entries(rawRecord)) {
        const lowerKey = key.toLowerCase();
        const mappedKey = fieldMappings[lowerKey] || key.toLowerCase();
        normalizedFields[mappedKey] = value;
    }

    // Extract required fields
    const voter = {
        voter_id: sanitizeText(normalizedFields.voter_id),
        last_name: sanitizeText(normalizedFields.last_name),
        first_name: sanitizeText(normalizedFields.first_name),
        address: normalizeAddress(sanitizeText(normalizedFields.address)), // CRITICAL FIX: Add address normalization
        city: sanitizeText(normalizedFields.city),
        state: sanitizeText(normalizedFields.state), // CRITICAL FIX: Add state field
        zip_code: sanitizeZipCode(normalizedFields.zip_code),
        precinct_number: sanitizePrecinct(normalizedFields.precinct_number),
        date_of_birth: sanitizeDate(normalizedFields.date_of_birth),
        recordNumber
    };

    // Validate required fields - don't throw, just note missing fields
    const missingFields = [];
    for (const [field, value] of Object.entries(voter)) {
        if (field !== 'recordNumber' && (!value || value === '')) {
            missingFields.push(field);
        }
    }

    // Note: Don't throw error here - let import processor validate
    // This ensures all records reach the validation phase for proper error logging
    if (missingFields.length > 0) {
        // Add metadata for import processor to detect
        voter._missingFields = missingFields;
    }

    // Parse election history from E_* columns (E_1, E_2, E_3, etc.)
    voter.electionHistory = parseElectionHistory(rawRecord);

    return voter;
}

/**
 * Parse election history from CSV columns (E_1, E_2, E_3, etc.)
 * Format: YDY = {Voted: Y, Party: D, EarlyVoted: Y}
 * @param {Object} rawRecord - Raw CSV record with all original columns
 * @returns {Array<Object>} Array of election history records
 */
function parseElectionHistory(rawRecord) {
    const electionHistory = [];
    
    // Find all E_* columns in the record
    for (const [key, value] of Object.entries(rawRecord)) {
        // Match columns like E_1, E_2, e_10, etc.
        const match = key.match(/^e_(\d+)$/i);
        if (match) {
            const electionNumber = match[1];
            const electionCode = `E_${electionNumber}`;
            
            // Parse the election data value
            const parsedData = parseElectionValue(value);
            
            // Only add to history if there's meaningful data
            if (parsedData.voted || parsedData.partyCode) {
                electionHistory.push({
                    electionCode,
                    voted: parsedData.voted,
                    partyCode: parsedData.partyCode,
                    earlyVoted: parsedData.earlyVoted
                });
            }
        }
    }
    
    return electionHistory;
}

/**
 * Parse individual election value format
 * Format examples:
 * - "YDY" = Voted: true, Party: D, EarlyVoted: true
 * - "YRN" = Voted: true, Party: R, EarlyVoted: false
 * - "NDN" = Voted: false (N at position 1 means no participation)
 * - "N" = Voted: false
 * - "" (empty) = No participation data
 * - "Y" = Voted: true, no party, election day
 * @param {string|null|undefined} value - Election data string
 * @returns {Object} Parsed election data
 */
function parseElectionValue(value) {
    const result = {
        voted: false,
        partyCode: null,
        earlyVoted: false
    };
    
    // Handle null, undefined, or empty values
    if (!value || value === null || value === undefined) {
        return result;
    }
    
    const cleaned = value.toString().trim().toUpperCase();
    
    // Empty string = no participation
    if (cleaned === '') {
        return result;
    }
    
    // Position 1: Voted (Y/N)
    const votedChar = cleaned.charAt(0);
    if (votedChar === 'Y') {
        result.voted = true;
    } else if (votedChar === 'N') {
        // N at position 1 means didn't vote, regardless of other characters
        result.voted = false;
        return result;
    }
    
    // Position 2: Party affiliation (D/R/I or blank)
    if (cleaned.length >= 2) {
        const partyChar = cleaned.charAt(1);
        if (partyChar === 'D' || partyChar === 'R' || partyChar === 'I') {
            result.partyCode = partyChar;
        }
    }
    
    // Position 3: Early voted (Y/N or blank)
    if (cleaned.length >= 3) {
        const earlyChar = cleaned.charAt(2);
        if (earlyChar === 'Y') {
            result.earlyVoted = true;
        }
    }
    
    return result;
}

/**
 * Normalize address - clean whitespace and standardize abbreviations
 * CRITICAL FIX: Address normalization for better geocoding quality
 * @param {string} address - Address string to normalize
 * @returns {string} Normalized address
 */
function normalizeAddress(address) {
    if (!address || address === '') {
        return '';
    }
    
    let normalized = address
        .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
        .trim();
    
    // Normalize common street abbreviations (maintain uppercase from sanitizeText)
    const abbreviations = {
        ' STREET': ' ST',
        ' ROAD': ' RD',
        ' DRIVE': ' DR',
        ' AVENUE': ' AVE',
        ' LANE': ' LN',
        ' COURT': ' CT',
        ' CIRCLE': ' CIR',
        ' BOULEVARD': ' BLVD',
        ' PARKWAY': ' PKWY',
        ' HIGHWAY': ' HWY',
        ' NORTH': ' N',
        ' SOUTH': ' S',
        ' EAST': ' E',
        ' WEST': ' W'
    };
    
    for (const [full, abbr] of Object.entries(abbreviations)) {
        normalized = normalized.replace(new RegExp(full + '$'), abbr);
        normalized = normalized.replace(new RegExp(full + ' '), abbr + ' ');
    }
    
    return normalized;
}

/**
 * Validate CSV file structure and check for required headers
 * @param {string} filePath - Absolute path to CSV file
 * @returns {Promise<Object>} Validation result
 * @property {boolean} valid - True if all required fields are present
 * @property {Array<string>} headers - All column headers found
 * @property {Array<string>} missingFields - Required fields that are missing
 * @property {string} delimiter - Detected delimiter character
 * @throws {Error} If file cannot be read
 */
async function validateCSVStructure(filePath) {
    try {
        const firstLine = await new Promise((resolve, reject) => {
            const rl = readline.createInterface({
                input: fs.createReadStream(filePath),
                crlfDelay: Infinity
            });

            rl.on('line', (line) => {
                rl.close();
                resolve(line);
            });

            rl.on('error', reject);
        });

        const delimiter = await detectDelimiter(filePath);
        const headers = firstLine.split(delimiter).map(h => h.trim().toLowerCase());

        // Required fields (must have at least one variation of each)
        const requiredFields = {
            voter_id: ['voter_id', 'voterid', 'id', 'voter id'],
            last_name: ['last_name', 'lastname', 'lname', 'surname'],
            first_name: ['first_name', 'firstname', 'fname'],
            address: ['address', 'street', 'street_address'],
            city: ['city'],
            zip_code: ['zip', 'zip_code', 'zipcode'],
            precinct_number: ['precinct', 'precinct_number', 'pct_nbr', 'pct']
        };

        const missingFields = [];
        for (const [field, variations] of Object.entries(requiredFields)) {
            const hasField = variations.some(variation => headers.includes(variation));
            if (!hasField) {
                missingFields.push(field);
            }
        }

        return {
            valid: missingFields.length === 0,
            headers,
            missingFields,
            delimiter
        };
    } catch (error) {
        throw new Error(`Failed to validate CSV structure: ${error.message}`);
    }
}

/**
 * Generate a CSV template file with sample data
 * Creates a properly formatted CSV with all required columns and example records
 * @param {string} outputPath - Absolute path for output file
 * @returns {string} Path to created template file
 * @throws {Error} If file cannot be written
 */
function generateCSVTemplate(outputPath) {
    const template = `voter_id,last_name,first_name,address,city,zip_code,precinct_number
TN12345678,SMITH,JOHN,123 MAIN ST,UNION CITY,38261,05
TN12345679,JOHNSON,MARY,456 OAK AVE,UNION CITY,38261,03
TN12345680,WILLIAMS,ROBERT,789 ELM ST,TROY,38260,01`;

    fs.writeFileSync(outputPath, template);
    return outputPath;
}

module.exports = {
    parseCSV,
    validateCSVStructure,
    generateCSVTemplate,
    detectDelimiter
};
