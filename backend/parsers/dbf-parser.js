/**
 * DBF Parser
 * Parses DBF (dBASE) files from voter registration databases
 * Uses shapefile library for reading DBF format
 */

const shapefile = require('shapefile');
const { sanitizeText, sanitizeZipCode, sanitizePrecinct, sanitizeDate } = require('./parser-utils');

/**
 * Parse a DBF file and extract voter records with election history
 * @param {string} filePath - Absolute path to DBF file
 * @returns {Promise<Object>} Parsed data with records and metadata
 * @property {Array<Object>} records - Array of normalized voter records
 * @property {number} totalCount - Total number of successfully parsed records
 * @property {Array<string>} electionCodes - List of election column codes found (e.g., ['E_1', 'E_2'])
 * @property {boolean} success - Always true if no exception thrown
 * @throws {Error} If file cannot be opened or read
 */
async function parseDBF(filePath) {
    try {
        const source = await shapefile.openDbf(filePath);
        const records = [];
        let result;
        let recordNumber = 0;

        // Stream records from DBF file
        while ((result = await source.read()).done === false) {
            recordNumber++;
            const rawRecord = result.value;
            
            try {
                // Parse and normalize the record
                const normalizedRecord = normalizeDBFRecord(rawRecord, recordNumber);
                records.push(normalizedRecord);
            } catch (error) {
                // Log parsing error but continue processing
                console.warn(`Warning: Failed to parse record ${recordNumber}:`, error.message);
            }
        }

        // Extract election codes from first record
        const electionCodes = records.length > 0 
            ? Object.keys(records[0].raw).filter(key => key.toUpperCase().startsWith('E_'))
            : [];

        return {
            records,
            totalCount: records.length,
            electionCodes,
            success: true
        };
    } catch (error) {
        console.error('DBF parsing error:', error);
        throw new Error(`Failed to parse DBF file: ${error.message}`);
    }
}

/**
 * Normalize a DBF record to standard voter format with field mapping
 * Handles multiple field name variations and sanitizes all data
 * @param {Object} rawRecord - Raw DBF record with arbitrary field names
 * @param {number} recordNumber - Record line number (for error reporting)
 * @returns {Object} Normalized voter record
 * @property {string} voter_id - State voter ID (sanitized, uppercase)
 * @property {string} last_name - Last name (sanitized, uppercase)
 * @property {string} first_name - First name (sanitized, uppercase)
 * @property {string} address - Street address (sanitized, uppercase)
 * @property {string} city - City name (sanitized, uppercase)
 * @property {string} zip_code - ZIP code (validated format: 12345 or 12345-6789)
 * @property {string} precinct_number - Precinct number (zero-padded to 2 digits)
 * @property {number} recordNumber - Original record number
 * @property {Object} raw - Original DBF record (for election history parsing)
 * @property {Array<Object>} electionHistory - Parsed election history entries
 * @throws {Error} If required fields are missing after normalization
 */
function normalizeDBFRecord(rawRecord, recordNumber) {
    // Map DBF field names to standardized names (case-insensitive)
    const fieldMappings = {
        // Voter ID variations
        'VOTER_ID': 'voter_id',
        'VOTERID': 'voter_id',
        'ID': 'voter_id',
        
        // Name variations
        'LNAME': 'last_name',
        'LAST_NAME': 'last_name',
        'LASTNAME': 'last_name',
        'SURNAME': 'last_name',
        
        'FNAME': 'first_name',
        'FIRST_NAME': 'first_name',
        'FIRSTNAME': 'first_name',
        
        // Address variations
        'ADDRESS': 'address',
        'STREET': 'address',
        'ADDR': 'address',
        'STREET_ADDR': 'address',
        
        'CITY': 'city',
        
        'ZIP': 'zip_code',
        'ZIP_CODE': 'zip_code',
        'ZIPCODE': 'zip_code',
        
        // Precinct variations
        'PCT_NBR': 'precinct_number',
        'PRECINCT': 'precinct_number',
        'PRECINCT_NUMBER': 'precinct_number',
        'PCT': 'precinct_number',
        'PREC': 'precinct_number',
        
        // Date of birth variations
        'DOB': 'date_of_birth',
        'DATE_OF_BIRTH': 'date_of_birth',
        'BIRTH_DATE': 'date_of_birth',
        'BIRTHDATE': 'date_of_birth'
    };

    // Create a case-insensitive lookup map
    const normalizedFields = {};
    for (const [key, value] of Object.entries(rawRecord)) {
        const upperKey = key.toUpperCase();
        const mappedKey = fieldMappings[upperKey] || key.toLowerCase();
        normalizedFields[mappedKey] = value;
    }

    // Extract required fields
    const voter = {
        voter_id: sanitizeText(normalizedFields.voter_id || normalizedFields.id),
        last_name: sanitizeText(normalizedFields.last_name),
        first_name: sanitizeText(normalizedFields.first_name),
        address: sanitizeText(normalizedFields.address),
        city: sanitizeText(normalizedFields.city),
        zip_code: sanitizeZipCode(normalizedFields.zip_code || normalizedFields.zip),
        precinct_number: sanitizePrecinct(normalizedFields.precinct_number || normalizedFields.precinct),
        date_of_birth: sanitizeDate(normalizedFields.date_of_birth),
        recordNumber,
        raw: rawRecord // Keep original for election history parsing
    };

    // Validate required fields
    const missingFields = [];
    for (const [field, value] of Object.entries(voter)) {
        if (field !== 'raw' && field !== 'recordNumber' && (!value || value === '')) {
            missingFields.push(field);
        }
    }

    if (missingFields.length > 0) {
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    // Parse election history from E_* columns
    voter.electionHistory = parseElectionHistory(rawRecord);

    return voter;
}

/**
 * Parse election history columns from DBF record (E_* columns)
 * Extracts voting participation and party affiliation from election code columns
 * @param {Object} record - Raw DBF record with E_* columns
 * @returns {Array<Object>} Election history entries
 * @property {string} electionCode - Election identifier (column name like 'E_1')
 * @property {boolean} voted - Whether voter participated
 * @property {string|null} partyCode - Party code: 'R' (Republican), 'D' (Democratic), 'I' (Independent), or null
 * @property {boolean} earlyVoted - Whether voter voted early
 */
function parseElectionHistory(record) {
    const electionHistory = [];
    
    // Find all columns that start with E_ (election columns)
    const electionColumns = Object.keys(record).filter(key => 
        key.toUpperCase().startsWith('E_')
    );

    for (const electionCode of electionColumns) {
        const value = record[electionCode];
        if (!value || value === null || value === '') {
            continue; // Skip empty election entries
        }

        const historyEntry = parseElectionCode(value, electionCode);
        if (historyEntry) {
            electionHistory.push(historyEntry);
        }
    }

    return electionHistory;
}

/**
 * Parse election code value to extract voting information
 * Supports various formats: Y/N, R/D, RE/DE, IE, E (early), etc.
 * @param {string} value - Election code value from DBF column
 * @param {string} electionCode - Election column name (E_1, E_2, etc.)
 * @returns {Object|null} Election history entry or null if not voted
 * @property {string} electionCode - Election identifier
 * @property {boolean} voted - Whether voter participated
 * @property {string|null} partyCode - Party code ('R', 'D', 'I') or null for non-primary
 * @property {boolean} earlyVoted - Whether voter voted early
 */
function parseElectionCode(value, electionCode) {
    const str = value.toString().trim().toUpperCase();
    
    if (!str || str === 'N' || str === 'NO' || str === '0') {
        return {
            electionCode,
            voted: false,
            partyCode: null,
            earlyVoted: false
        };
    }

    // Parse voting patterns
    const patterns = [
        // Republican patterns
        { test: /^RE$/i, voted: true, partyCode: 'R', earlyVoted: true },
        { test: /^R$/i, voted: true, partyCode: 'R', earlyVoted: false },
        
        // Democratic patterns
        { test: /^DE$/i, voted: true, partyCode: 'D', earlyVoted: true },
        { test: /^D$/i, voted: true, partyCode: 'D', earlyVoted: false },
        
        // Independent patterns
        { test: /^IE$/i, voted: true, partyCode: 'I', earlyVoted: true },
        { test: /^I$/i, voted: true, partyCode: 'I', earlyVoted: false },
        
        // General election patterns
        { test: /^(Y|YES|1|E)$/i, voted: true, partyCode: null, earlyVoted: str === 'E' },
        { test: /^YE$/i, voted: true, partyCode: null, earlyVoted: true }
    ];

    for (const pattern of patterns) {
        if (pattern.test.test(str)) {
            return {
                electionCode,
                voted: pattern.voted,
                partyCode: pattern.partyCode,
                earlyVoted: pattern.earlyVoted
            };
        }
    }

    // Unknown pattern - log and treat as voted
    console.warn(`Unknown election code format: "${str}" in ${electionCode}`);
    return {
        electionCode,
        voted: true,
        partyCode: null,
        earlyVoted: false
    };
}

/**
 * Inspect DBF file structure without full parsing
 * Useful for debugging, validation, and determining file schema
 * @param {string} filePath - Absolute path to DBF file
 * @returns {Promise<Object>} File structure information
 * @property {Array<string>} fields - All field names found in DBF
 * @property {Array<string>} electionFields - Election history field names (E_* columns)
 * @property {Object|null} sampleRecord - First record from file (for schema inspection)
 * @property {boolean} isEmpty - True if file has no records
 * @throws {Error} If file cannot be opened or read
 */
async function inspectDBF(filePath) {
    try {
        const source = await shapefile.openDbf(filePath);
        const firstRecord = await source.read();
        
        if (firstRecord.done) {
            return {
                fields: [],
                sampleRecord: null,
                isEmpty: true
            };
        }

        const fields = Object.keys(firstRecord.value);
        const electionFields = fields.filter(f => f.toUpperCase().startsWith('E_'));

        return {
            fields,
            electionFields,
            sampleRecord: firstRecord.value,
            isEmpty: false
        };
    } catch (error) {
        throw new Error(`Failed to inspect DBF file: ${error.message}`);
    }
}

module.exports = {
    parseDBF,
    inspectDBF,
    parseElectionHistory,
    normalizeDBFRecord
};
