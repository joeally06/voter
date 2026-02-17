/**
 * Shared Parser Utilities
 * Common sanitization functions used by both CSV and DBF parsers.
 * Extracted to eliminate duplication and ensure consistent behavior.
 */

/**
 * Sanitize text fields - trim, uppercase, remove non-printable characters
 * @param {string|number|null|undefined} value - Text value to sanitize
 * @param {number} [maxLength=255] - Maximum length (characters will be truncated)
 * @returns {string} Sanitized text (uppercase, printable ASCII only) or empty string if input is null/undefined
 */
function sanitizeText(value, maxLength = 255) {
    if (!value || value === null || value === undefined) {
        return '';
    }
    
    return value
        .toString()
        .trim()
        .replace(/[^\x20-\x7E]/g, '') // Remove non-printable characters
        .substring(0, maxLength)
        .toUpperCase();
}

/**
 * Sanitize and validate ZIP code format
 * Accepts 5-digit or ZIP+4 format (12345 or 12345-6789)
 * @param {string|number|null|undefined} value - ZIP code value
 * @returns {string} Sanitized ZIP code in valid format, or invalid string if format cannot be normalized
 */
function sanitizeZipCode(value) {
    if (!value) return '';
    
    const cleaned = value.toString().trim().replace(/[^0-9-]/g, '');
    
    // Validate format (5 digits or ZIP+4)
    if (!/^\d{5}(-\d{4})?$/.test(cleaned)) {
        // Try to extract just the 5-digit ZIP
        const match = cleaned.match(/(\d{5})/);
        if (match) {
            return match[1];
        }
        return cleaned; // Return as-is, will fail validation later
    }
    
    return cleaned;
}

/**
 * Sanitize precinct number — PRESERVE ORIGINAL FORMAT
 * CRITICAL FIX: Do NOT strip hyphens to preserve district-precinct format like "2-4"
 * Obion County uses format: "{district}-{precinct}" (e.g., "2-4", "1-3")
 * @param {string|number|null|undefined} value - Precinct number (e.g., '2-4', '1-3')
 * @returns {string} Sanitized precinct preserving hyphens and original format
 */
function sanitizePrecinct(value) {
    if (!value) return '';
    
    // Preserve hyphens and numbers only, remove other non-alphanumeric chars
    const cleaned = value.toString().trim().replace(/[^0-9-]/g, '');
    
    // Return as-is to preserve district-precinct format like "2-4"
    return cleaned;
}

/**
 * Sanitize and validate date of birth
 * Accepts ISO-8601 format (YYYY-MM-DD) and common US formats (MM/DD/YYYY)
 * Returns NULL for invalid dates to maintain data quality
 * @param {string|null|undefined} value - Date string to sanitize
 * @returns {string|null} ISO-8601 formatted date (YYYY-MM-DD) or null if invalid
 */
function sanitizeDate(value) {
    if (!value || value === null || value === undefined) {
        return null;
    }
    
    const cleaned = value.toString().trim();
    if (cleaned === '') {
        return null;
    }
    
    // Try parsing as-is (ISO-8601 format: YYYY-MM-DD)
    let parsedDate = new Date(cleaned);
    
    // Try parsing MM/DD/YYYY format (common in US data files)
    if (isNaN(parsedDate.getTime())) {
        const match = cleaned.match(/^(\d{1,2})[\/ \-](\d{1,2})[\/ \-](\d{4})$/);
        if (match) {
            const [, month, day, year] = match;
            parsedDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
        }
    }
    
    // Validate parsed date is a real date
    if (isNaN(parsedDate.getTime())) {
        console.warn(`Invalid date format: ${cleaned}`);
        return null;
    }
    
    // Check for future dates (birth date cannot be in the future)
    const today = new Date();
    if (parsedDate > today) {
        console.warn(`Future date of birth rejected: ${cleaned}`);
        return null;
    }
    
    // Check for unrealistic dates (before 1900)
    // Log warning but don't reject - may be data entry errors we want to preserve
    const minDate = new Date('1900-01-01');
    if (parsedDate < minDate) {
        console.warn(`Unrealistic date of birth (before 1900): ${cleaned}`);
        // Don't reject, just warn
    }
    
    // Return ISO-8601 format (YYYY-MM-DD)
    const year = parsedDate.getFullYear();
    const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
    const day = String(parsedDate.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
}

module.exports = {
    sanitizeText,
    sanitizeZipCode,
    sanitizePrecinct,
    sanitizeDate
};
