/**
 * Upload Routes
 * Handles file upload endpoints for DBF voter data files
 * 
 * Phase 1: File upload handling with validation (FUNCTIONAL) + enhanced validation
 * Phase 2: DBF parsing and database import integration
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { body, validationResult } = require('express-validator');
const database = require('../config/database');
const { processImport, getImportErrors } = require('../services/import-processor');

/**
 * INPUT VALIDATION: Helper middleware to check validation results
 */
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: errors.array()
        });
    }
    next();
};

// ============================================================================
// MULTER CONFIGURATION
// ============================================================================

/**
 * Configure multer storage for uploaded files
 * Files are saved to data/raw directory with timestamp prefix
 */
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '../../data/raw'));
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        cb(null, `${timestamp}_${file.originalname}`);
    }
});

/**
 * Multer upload configuration for DBF files
 */
const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        
        // Only accept .dbf files
        if (ext !== '.dbf') {
            return cb(new Error('Only .dbf files are allowed'));
        }
        
        // Validate filename characters (prevent path traversal)
        const filename = path.basename(file.originalname);
        if (!/^[a-zA-Z0-9_\-. ]+$/.test(filename)) {
            return cb(new Error('Invalid filename characters'));
        }
        
        cb(null, true);
    },
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit for large DBF files
    }
});

/**
 * Multer upload configuration for CSV files
 */
const uploadCSV = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        
        // Only accept .csv files
        if (ext !== '.csv') {
            return cb(new Error('Only .csv files are allowed'));
        }
        
        // Validate filename characters (prevent path traversal)
        const filename = path.basename(file.originalname);
        if (!/^[a-zA-Z0-9_\-. ]+$/.test(filename)) {
            return cb(new Error('Invalid filename characters'));
        }
        
        cb(null, true);
    },
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    }
});

// ============================================================================
// UPLOAD ROUTES
// ============================================================================

/**
 * POST /api/upload/dbf
 * Upload and process a DBF voter data file
 * 
 * Form data:
 * - file: DBF file (required)
 * - description: Optional description of the upload
 * 
 * Returns:
 * - Upload confirmation
 * - File details (name, size, path)
 * - Import job ID (Phase 2)
 * 
 * Phase 1: FUNCTIONAL - Accepts and saves file
 * Phase 2: Will trigger DBF parsing and database import
 */
router.post('/dbf', upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded',
                message: 'Please upload a .dbf file'
            });
        }
        
        // Get import mode from request body (default: replace)
        const importMode = req.body.importMode || 'replace';
        if (!['skip', 'replace', 'flag'].includes(importMode)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid import mode',
                message: 'importMode must be one of: skip, replace, flag'
            });
        }
        
        // Log the upload to import_logs table
        const logResult = await database.run(
            `INSERT INTO import_logs (filename, file_size, status) 
             VALUES (?, ?, 'pending')`,
            [req.file.filename, req.file.size]
        );
        
        const importId = logResult.lastID;
        
        // Trigger async import processing
        processImport(importId, req.file.path, 'dbf', { importMode })
            .catch(err => {
                console.error('Import processing error:', err);
            });
        
        // Return immediate response
        res.json({
            success: true,
            message: 'File uploaded and queued for processing',
            import: {
                id: importId,
                filename: req.file.filename,
                originalName: req.file.originalname,
                size: req.file.size,
                status: 'pending',
                progress: {
                    processed: 0,
                    successful: 0,
                    failed: 0,
                    total: null
                },
                startTime: new Date().toISOString()
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/upload/csv
 * Upload and process a CSV voter data file
 * 
 * Form data:
 * - file: CSV file (required)
 * - description: Optional description
 * - importMode: skip|replace|flag (default: replace)
 * - hasHeaders: true|false (default: true)
 * 
 * Returns:
 * - Upload confirmation
 * - Import job ID for tracking
 */
router.post('/csv', uploadCSV.single('file'), async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded',
                message: 'Please upload a .csv file'
            });
        }
        
        // Get import options from request body
        const importMode = req.body.importMode || 'replace';
        const hasHeaders = req.body.hasHeaders !== 'false'; // Default true
        
        if (!['skip', 'replace', 'flag'].includes(importMode)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid import mode',
                message: 'importMode must be one of: skip, replace, flag'
            });
        }
        
        // Log the upload to import_logs table
        const logResult = await database.run(
            `INSERT INTO import_logs (filename, file_size, status) 
             VALUES (?, ?, 'pending')`,
            [req.file.filename, req.file.size]
        );
        
        const importId = logResult.lastID;
        
        // Trigger async import processing
        processImport(importId, req.file.path, 'csv', { importMode, hasHeaders })
            .catch(err => {
                console.error('Import processing error:', err);
            });
        
        // Return immediate response
        res.json({
            success: true,
            message: 'File uploaded and queued for processing',
            import: {
                id: importId,
                filename: req.file.filename,
                originalName: req.file.originalname,
                size: req.file.size,
                status: 'pending',
                progress: {
                    processed: 0,
                    successful: 0,
                    failed: 0,
                    total: null
                },
                startTime: new Date().toISOString()
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/upload/history
 * Get upload history from import_logs table
 * 
 * Query parameters:
 * - limit: Number of results (default: 20)
 * - status: Filter by status (pending, completed, failed)
 * 
 * Returns:
 * - Array of upload records with statistics
 */
router.get('/history', async (req, res, next) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const status = req.query.status;
        
        let query = 'SELECT * FROM import_logs';
        let params = [];
        
        if (status) {
            query += ' WHERE status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY start_time DESC LIMIT ?';
        params.push(limit);
        
        const history = await database.all(query, params);
        
        res.json({
            success: true,
            count: history.length,
            data: history
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/upload/:id
 * Get details of a specific upload/import job
 * 
 * Parameters:
 * - id: Import log ID
 * 
 * Returns:
 * - Upload details
 * - Processing status
 * - Progress information
 * - Error messages (if any)
 */
router.get('/:id', async (req, res, next) => {
    try {
        const upload = await database.get(
            'SELECT * FROM import_logs WHERE id = ?',
            [req.params.id]
        );
        
        if (!upload) {
            return res.status(404).json({
                success: false,
                error: 'Upload not found',
                message: `No upload with ID ${req.params.id}`
            });
        }
        
        // Calculate progress percentage
        let progress = null;
        if (upload.total_records > 0) {
            const percent = ((upload.records_processed / upload.total_records) * 100).toFixed(1);
            
            progress = {
                total: upload.total_records,
                processed: upload.records_processed,
                successful: upload.records_successful,
                failed: upload.records_failed,
                percent: Math.min(parseFloat(percent), 100.0)
            };
        } else if (upload.records_processed > 0) {
            // Fallback when total_records is not yet set (legacy imports)
            progress = {
                total: null,
                processed: upload.records_processed,
                successful: upload.records_successful,
                failed: upload.records_failed,
                percent: null
            };
        }
        
        // Get recent errors if import failed or has errors
        let errors = [];
        if (upload.records_failed > 0) {
            errors = await getImportErrors(upload.id, 10);
        }
        
        res.json({
            success: true,
            data: {
                id: upload.id,
                filename: upload.filename,
                fileSize: upload.file_size,
                status: upload.status,
                progress,
                startTime: upload.start_time,
                endTime: upload.end_time,
                errorMessage: upload.error_message,
                errors: errors.map(e => ({
                    recordNumber: e.recordNumber,
                    errorType: e.errorType,
                    message: e.errorMessage
                }))
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/upload/:id/errors
 * Get detailed error list for a specific import
 * 
 * Parameters:
 * - id: Import log ID
 * 
 * Query parameters:
 * - limit: Maximum errors to return (default: 100)
 * 
 * Returns:
 * - Array of error records
 */
router.get('/:id/errors', async (req, res, next) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const errors = await getImportErrors(req.params.id, limit);
        
        res.json({
            success: true,
            count: errors.length,
            errors: errors.map(e => ({
                recordNumber: e.recordNumber,
                errorType: e.errorType,
                message: e.errorMessage,
                timestamp: e.createdAt
            }))
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Error handler for multer file upload errors
 */
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'File too large',
                message: 'Maximum file size is 100MB'
            });
        }
        return res.status(400).json({
            success: false,
            error: 'Upload error',
            message: error.message
        });
    }
    next(error);
});

module.exports = router;
