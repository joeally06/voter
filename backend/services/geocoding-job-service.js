/**
 * Geocoding Job Service
 * Orchestrates batch geocoding operations
 * 
 * Features:
 * - Create and manage geocoding batch jobs
 * - Process addresses in configurable batch sizes
 * - Track job progress in real-time
 * - Handle job resumption after failures
 * - Coordinate cache and API services
 * - Error logging and retry management
 */

const database = require('../config/database');
const GeocodingService = require('./geocoding-service');
const AddressCacheService = require('./address-cache-service');

class GeocodingJobService {
  constructor() {
    this.geocodingService = new GeocodingService();
    this.cacheService = new AddressCacheService();
  }

  /**
   * Create a new geocoding job
   * 
   * @param {Array<number>} voterIds - Array of voter IDs to geocode
   * @param {Object} options - Job options (batch_size, rate_limit, etc.)
   * @returns {Promise<number>} Job ID
   */
  async createJob(voterIds, options = {}) {
    try {
      // Check for active jobs to prevent concurrent processing
      const activeJobs = await database.get(`
        SELECT COUNT(*) as count FROM geocoding_jobs
        WHERE status IN ('PENDING', 'PROCESSING')
      `);
      
      if (activeJobs?.count > 0) {
        throw new Error('Another geocoding job is already in progress. Please wait for completion.');
      }

      // Validate voter IDs exist
      // Use parameterized query to prevent SQL injection
      const placeholders = voterIds.map(() => '?').join(',');
      const validVoters = await database.all(
        `SELECT id FROM voters WHERE id IN (${placeholders})`,
        voterIds
      );

      if (validVoters.length === 0) {
        throw new Error('No valid voter IDs provided');
      }

      // Check quota limit
      const estimatedApiCalls = Math.ceil(validVoters.length * 0.2); // Assume 80% cache hit rate
      await this.geocodingService.checkQuotaLimit(estimatedApiCalls);

      // Include voter IDs in job options so processJob can scope its query
      const jobOptions = {
        ...options,
        voter_ids: validVoters.map(v => v.id)
      };

      // Create job record
      const result = await database.run(`
        INSERT INTO geocoding_jobs (
          total_records, 
          options, 
          created_by,
          status
        ) VALUES (?, ?, ?, 'PENDING')
      `, [
        validVoters.length,
        JSON.stringify(jobOptions),
        options.created_by || 'system'
      ]);
      
      const jobId = result.lastID;
      
      // Trigger async processing (don't await)
      setImmediate(() => {
        this.processJob(jobId).catch(err => {
          console.error(`Job ${jobId} failed:`, err);
        });
      });
      
      return jobId;
      
    } catch (error) {
      console.error('Job creation error:', error.message);
      throw error;
    }
  }

  /**
   * Process a geocoding job
   * 
   * Main processing loop that:
   * 1. Fetches addresses from voters table
   * 2. Checks cache for each address
   * 3. Calls Google Maps API for cache misses
   * 4. Updates voters table with coordinates
   * 5. Logs errors for failed geocoding
   * 
   * @param {number} jobId - Job ID to process
   * @returns {Promise<Object>} Job completion statistics
   */
  async processJob(jobId) {
    console.log(`Starting geocoding job ${jobId}...`);
    
    try {
      // Update status to PROCESSING
      await database.run(`
        UPDATE geocoding_jobs 
        SET status = 'PROCESSING', start_time = CURRENT_TIMESTAMP 
        WHERE id = ?
      `, [jobId]);
      
      // Get job details
      const job = await database.get('SELECT * FROM geocoding_jobs WHERE id = ?', [jobId]);
      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }

      const options = JSON.parse(job.options || '{}');
      const batchSize = options.batch_size || parseInt(process.env.GEOCODING_BATCH_SIZE) || 100;
      
      let processedCount = 0;
      let successCount = 0;
      let failedCount = 0;
      let cacheHits = 0;
      let apiCalls = 0;
      
      // Use voter IDs from job options if available
      const voterIds = options.voter_ids;

      // Process in batches until all addresses are geocoded
      while (processedCount < job.total_records) {
        // Fetch next batch of voters needing geocoding
        let voters;

        if (voterIds && voterIds.length > 0) {
          // Scope to specific voter IDs from the job
          const placeholders = voterIds.map(() => '?').join(',');
          voters = await database.all(`
            SELECT id, voter_id, address, city, state, zip_code, latitude
            FROM voters
            WHERE id IN (${placeholders})
              AND latitude IS NULL
            LIMIT ?
          `, [...voterIds, batchSize]);
        } else {
          // Fallback: process any ungeocoded voters
          voters = await database.all(`
            SELECT id, voter_id, address, city, state, zip_code, latitude
            FROM voters
            WHERE latitude IS NULL
            LIMIT ?
          `, [batchSize]);
        }
        
        if (voters.length === 0) {
          console.log('No more addresses to process');
          break; // No more addresses to process
        }
        
        // Process each voter in the batch
        for (const voter of voters) {
          try {
            // Warn once per voter if state is missing
            if (!voter.state) {
              console.warn(`⚠️ Voter ${voter.id} missing state, defaulting to TN`);
            }

            // Step 1: Check cache
            const cached = await this.cacheService.getCachedGeocode(
              voter.address,
              voter.city,
              voter.state || 'TN',
              voter.zip_code
            );
            
            let geocodeResult;
            
            if (cached) {
              // Use cached result — add success flag since cache doesn't include it
              geocodeResult = {
                ...cached,
                success: cached.latitude != null && cached.longitude != null
              };
              cacheHits++;
              console.log(`Cache hit for voter ${voter.id}: ${voter.address}`);
            } else {
              // Step 2: Call Google Maps API
              const state = voter.state || 'TN';
              console.log(`Geocoding voter ${voter.id}: ${voter.address}, ${voter.city}, ${state} ${voter.zip_code}`);
              
              geocodeResult = await this.geocodingService.geocodeWithRetry(
                voter.address,
                { 
                  locality: voter.city, 
                  administrative_area: state,
                  postal_code: voter.zip_code 
                },
                3 // Max 3 retries
              );
              
              apiCalls++;
              
              // Step 3: Store in cache if successful
              if (geocodeResult.success) {
                await this.cacheService.setCachedGeocode(
                  voter.address,
                  voter.city,
                  voter.state || 'TN',
                  voter.zip_code,
                  geocodeResult
                );
              }
            }
            
            // Step 4: Update voter record
            if (geocodeResult.success) {
              await database.run(`
                UPDATE voters
                SET latitude = ?, 
                    longitude = ?, 
                    geocoding_quality = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `, [
                geocodeResult.latitude,
                geocodeResult.longitude,
                geocodeResult.quality_score,
                voter.id
              ]);
              successCount++;
              console.log(`✅ Successfully geocoded voter ${voter.id}`);
            } else {
              // Log error
              await this.logGeocodingError(jobId, voter, geocodeResult);
              failedCount++;
              console.log(`❌ Failed to geocode voter ${voter.id}: ${geocodeResult.error}`);
            }
            
          } catch (error) {
            // Handle individual address errors
            console.error(`Error processing voter ${voter.id}:`, error.message);
            await this.logGeocodingError(jobId, voter, { 
              error: error.message, 
              error_type: 'EXCEPTION' 
            });
            failedCount++;
          }
          
          processedCount++;

          // Stop if we've reached the target
          if (processedCount >= job.total_records) {
            break;
          }
          
          // Update job progress every 10 records
          if (processedCount % 10 === 0) {
            await this.updateJobProgress(jobId, {
              processed_count: processedCount,
              success_count: successCount,
              failed_count: failedCount,
              cache_hits: cacheHits,
              api_calls: apiCalls
            });
            console.log(`Progress: ${processedCount}/${job.total_records} (${successCount} success, ${failedCount} failed)`);
          }
        }

        // Break outer loop if we've reached the target
        if (processedCount >= job.total_records) {
          break;
        }
        
        // Small delay between batches to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Final job update
      await database.run(`
        UPDATE geocoding_jobs
        SET status = 'COMPLETED',
            end_time = CURRENT_TIMESTAMP,
            processed_count = ?,
            success_count = ?,
            failed_count = ?,
            cache_hits = ?,
            api_calls = ?
        WHERE id = ?
      `, [processedCount, successCount, failedCount, cacheHits, apiCalls, jobId]);
      
      console.log(`✅ Job ${jobId} completed: ${successCount} successful, ${failedCount} failed`);
      
      return {
        success: true,
        jobId,
        processedCount,
        successCount,
        failedCount,
        cacheHits,
        apiCalls
      };
      
    } catch (error) {
      // Job-level error
      console.error(`Job ${jobId} failed:`, error.message);
      
      await database.run(`
        UPDATE geocoding_jobs
        SET status = 'FAILED', 
            error_message = ?, 
            end_time = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [error.message, jobId]);
      
      throw error;
    }
  }

  /**
   * Update job progress
   * 
   * @private
   */
  async updateJobProgress(jobId, stats) {
    try {
      await database.run(`
        UPDATE geocoding_jobs
        SET processed_count = ?,
            success_count = ?,
            failed_count = ?,
            cache_hits = ?,
            api_calls = ?
        WHERE id = ?
      `, [
        stats.processed_count,
        stats.success_count,
        stats.failed_count,
        stats.cache_hits,
        stats.api_calls,
        jobId
      ]);
    } catch (error) {
      console.error('Failed to update job progress:', error.message);
    }
  }

  /**
   * Log geocoding error
   * 
   * @private
   */
  async logGeocodingError(jobId, voter, errorInfo) {
    try {
      await database.run(`
        INSERT INTO geocoding_errors (
          job_id,
          voter_id,
          address,
          city,
          zip_code,
          error_type,
          error_message,
          retry_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        jobId,
        voter.id,
        voter.address,
        voter.city,
        voter.zip_code,
        errorInfo.error_type || 'UNKNOWN',
        errorInfo.error || 'Unknown error',
        0
      ]);
    } catch (error) {
      console.error('Failed to log geocoding error:', error.message);
    }
  }

  /**
   * Get job status and progress
   * 
   * @param {number} jobId - Job ID
   * @returns {Promise<Object>} Job status details
   */
  async getJobStatus(jobId) {
    try {
      const job = await database.get(`
        SELECT * FROM geocoding_jobs WHERE id = ?
      `, [jobId]);
      
      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }
      
      // Calculate progress percentage
      const progress = job.total_records > 0
        ? ((job.processed_count / job.total_records) * 100).toFixed(2)
        : 0;
      
      // Calculate estimated time remaining
      let estimatedCompletion = null;
      if (job.status === 'PROCESSING' && job.processed_count > 0) {
        const elapsedMs = new Date() - new Date(job.start_time);
        const recordsRemaining = job.total_records - job.processed_count;
        const avgTimePerRecord = elapsedMs / job.processed_count;
        const estimatedRemainingMs = recordsRemaining * avgTimePerRecord;
        
        estimatedCompletion = new Date(Date.now() + estimatedRemainingMs).toISOString();
      }
      
      // Get recent errors
      const recentErrors = await database.all(`
        SELECT error_type, COUNT(*) as count
        FROM geocoding_errors
        WHERE job_id = ?
        GROUP BY error_type
        ORDER BY count DESC
      `, [jobId]);
      
      // Calculate duration
      let duration = null;
      if (job.end_time) {
        const durationMs = new Date(job.end_time) - new Date(job.start_time);
        const durationSeconds = Math.floor(durationMs / 1000);
        const minutes = Math.floor(durationSeconds / 60);
        const seconds = durationSeconds % 60;
        duration = minutes > 0 ? `${minutes} minutes ${seconds} seconds` : `${seconds} seconds`;
      }
      
      return {
        jobId: job.id,
        status: job.status,
        progress: parseFloat(progress),
        total: job.total_records,
        processed: job.processed_count,
        successful: job.success_count,
        failed: job.failed_count,
        cacheHits: job.cache_hits,
        apiCalls: job.api_calls,
        startTime: job.start_time,
        endTime: job.end_time,
        duration,
        estimatedCompletion,
        errors: recentErrors,
        errorMessage: job.error_message
      };
      
    } catch (error) {
      console.error('Get job status error:', error.message);
      throw error;
    }
  }

  /**
   * Cancel a running job
   * 
   * @param {number} jobId - Job ID to cancel
   * @returns {Promise<boolean>} Success status
   */
  async cancelJob(jobId) {
    try {
      const result = await database.run(`
        UPDATE geocoding_jobs
        SET status = 'CANCELLED',
            end_time = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('PENDING', 'PROCESSING')
      `, [jobId]);
      
      return result.changes > 0;
    } catch (error) {
      console.error('Cancel job error:', error.message);
      return false;
    }
  }

  /**
   * Get failed addresses from a job
   * 
   * @param {number} jobId - Job ID
   * @param {Array<string>} errorTypes - Optional filter by error types
   * @returns {Promise<Array>} Failed address records
   */
  async getFailedAddresses(jobId, errorTypes = null) {
    try {
      let query = `
        SELECT 
          ge.*,
          v.first_name,
          v.last_name,
          v.voter_id as voter_number
        FROM geocoding_errors ge
        JOIN voters v ON v.id = ge.voter_id
        WHERE ge.job_id = ?
      `;
      
      const params = [jobId];
      
      if (errorTypes && errorTypes.length > 0) {
        query += ` AND ge.error_type IN (${errorTypes.map(() => '?').join(',')})`;
        params.push(...errorTypes);
      }
      
      query += ' ORDER BY ge.created_at DESC';
      
      const errors = await database.all(query, params);
      
      return errors;
      
    } catch (error) {
      console.error('Get failed addresses error:', error.message);
      return [];
    }
  }

  /**
   * Retry failed addresses from a previous job
   * 
   * @param {number} originalJobId - Original job ID
   * @param {Array<string>} errorTypes - Optional filter by error types
   * @returns {Promise<number>} New job ID
   */
  async retryFailedAddresses(originalJobId, errorTypes = null) {
    try {
      // Get failed voter IDs
      let query = `
        SELECT DISTINCT voter_id FROM geocoding_errors 
        WHERE job_id = ?
      `;
      const params = [originalJobId];
      
      if (errorTypes && errorTypes.length > 0) {
        query += ` AND error_type IN (${errorTypes.map(() => '?').join(',')})`;
        params.push(...errorTypes);
      }
      
      const failedVoters = await database.all(query, params);
      const voterIds = failedVoters.map(v => v.voter_id);
      
      if (voterIds.length === 0) {
        throw new Error('No failed addresses to retry');
      }
      
      // Reset geocoding data for retry
      // Use parameterized query to prevent SQL injection
      const retryPlaceholders = voterIds.map(() => '?').join(',');
      await database.run(
        `UPDATE voters
        SET latitude = NULL, longitude = NULL, geocoding_quality = NULL
        WHERE id IN (${retryPlaceholders})`,
        voterIds
      );
      
      // Create new job
      const newJobId = await this.createJob(voterIds, {
        created_by: 'retry_job',
        original_job_id: originalJobId,
        error_types_filter: errorTypes
      });
      
      return newJobId;
      
    } catch (error) {
      console.error('Retry failed addresses error:', error.message);
      throw error;
    }
  }

  /**
   * Get all jobs with optional filtering
   * 
   * @param {Object} filters - Filter options (status, limit, etc.)
   * @returns {Promise<Array>} Job records
   */
  async getJobs(filters = {}) {
    try {
      let query = 'SELECT * FROM geocoding_jobs';
      const params = [];
      const conditions = [];
      
      if (filters.status) {
        conditions.push('status = ?');
        params.push(filters.status);
      }
      
      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      
      query += ' ORDER BY created_at DESC';
      
      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
      }
      
      const jobs = await database.all(query, params);
      return jobs;
      
    } catch (error) {
      console.error('Get jobs error:', error.message);
      return [];
    }
  }
}

module.exports = GeocodingJobService;
