/**
 * Upload Service
 * Handles file upload API communication
 */
class UploadService {
    constructor(baseUrl = window.APP_CONFIG?.uploadApiUrl || '/api/upload') {
        this.baseUrl = baseUrl;
        this.currentUpload = null;
    }
    
    /**
     * Upload a file to the server
     * @param {File} file - File to upload
     * @param {Object} options - Upload options
     * @param {Function} onProgress - Progress callback
     * @returns {Promise<Object>} Upload response
     */
    async uploadFile(file, options = {}, onProgress = null) {
        const formData = new FormData();
        formData.append('file', file);
        
        if (options.importMode) {
            formData.append('importMode', options.importMode);
        }
        
        if (options.hasHeaders !== undefined) {
            formData.append('hasHeaders', options.hasHeaders);
        }
        
        const endpoint = file.name.toLowerCase().endsWith('.dbf') 
            ? `${this.baseUrl}/dbf` 
            : `${this.baseUrl}/csv`;
        
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            
            // Progress tracking
            if (onProgress) {
                xhr.upload.addEventListener('progress', (e) => {
                    if (e.lengthComputable) {
                        const percent = Math.round((e.loaded / e.total) * 100);
                        onProgress({ type: 'upload', percent, loaded: e.loaded, total: e.total });
                    }
                });
            }
            
            // Success/Error handling
            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        resolve(data);
                    } catch (err) {
                        reject(new Error('Invalid JSON response'));
                    }
                } else {
                    try {
                        const error = JSON.parse(xhr.responseText);
                        reject(new Error(error.message || `Upload failed: ${xhr.status}`));
                    } catch (err) {
                        reject(new Error(`Upload failed: ${xhr.status}`));
                    }
                }
            });
            
            xhr.addEventListener('error', () => {
                reject(new Error('Network error occurred'));
            });
            
            xhr.addEventListener('abort', () => {
                reject(new Error('Upload cancelled'));
            });
            
            xhr.open('POST', endpoint, true);
            xhr.send(formData);
            
            // Store XHR for cancellation
            this.currentUpload = xhr;
        });
    }
    
    /**
     * Cancel current upload
     */
    cancelUpload() {
        if (this.currentUpload) {
            this.currentUpload.abort();
            this.currentUpload = null;
        }
    }
    
    /**
     * Get upload job status
     * @param {number} uploadId - Upload job ID
     * @returns {Promise<Object>} Upload status
     */
    async getUploadStatus(uploadId) {
        const response = await fetch(`${this.baseUrl}/${uploadId}`);
        if (!response.ok) {
            throw new Error(`Failed to get upload status: ${response.status}`);
        }
        return response.json();
    }
    
    /**
     * Get upload history
     * @param {Object} params - Query parameters
     * @returns {Promise<Object>} Upload history
     */
    async getUploadHistory(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const url = queryString 
            ? `${this.baseUrl}/history?${queryString}`
            : `${this.baseUrl}/history`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to get upload history: ${response.status}`);
        }
        return response.json();
    }
    
    /**
     * Get errors for specific upload
     * @param {number} uploadId - Upload job ID
     * @param {number} limit - Maximum errors to retrieve
     * @returns {Promise<Object>} Upload errors
     */
    async getUploadErrors(uploadId, limit = 100) {
        const response = await fetch(
            `${this.baseUrl}/${uploadId}/errors?limit=${limit}`
        );
        if (!response.ok) {
            throw new Error(`Failed to get upload errors: ${response.status}`);
        }
        return response.json();
    }
    
    /**
     * Poll upload status until complete
     * IMPROVEMENT #3: Adaptive polling with exponential backoff to reduce server load
     * FIX: Increased intervals (1s → 10s) to prevent 429 rate limit errors
     * @param {number} uploadId - Upload job ID
     * @param {Function} onProgress - Progress callback
     * @param {number} interval - Initial polling interval in ms
     * @returns {Promise<Object>} Final upload status
     */
    async pollUploadStatus(uploadId, onProgress = null, interval = 1000) {
        return new Promise((resolve, reject) => {
            let currentInterval = interval;
            let pollTimeout = null;
            let lastProgress = 0;
            // Use configuration for polling intervals with fallback defaults
            const MIN_INTERVAL = window.APP_CONFIG?.uploadPolling?.minInterval || 1000;
            const MAX_INTERVAL = window.APP_CONFIG?.uploadPolling?.maxInterval || 10000;
            
            const poll = async () => {
                try {
                    const result = await this.getUploadStatus(uploadId);
                    
                    if (onProgress && result.data.progress) {
                        const progressData = {
                            type: 'processing',
                            ...result.data.progress
                        };
                        onProgress(progressData);
                        
                        // Adaptive interval based on progress changes
                        const currentProgress = result.data.progress.percent || 0;
                        if (currentProgress !== lastProgress) {
                            // Progress changed - reset to faster polling
                            currentInterval = MIN_INTERVAL;
                            lastProgress = currentProgress;
                        } else {
                            // No progress change - exponential backoff
                            currentInterval = Math.min(currentInterval * 1.5, MAX_INTERVAL);
                        }
                    }
                    
                    // Check if complete
                    if (result.data.status === 'completed') {
                        if (pollTimeout) clearTimeout(pollTimeout);
                        resolve(result.data);
                    } else if (result.data.status === 'failed') {
                        if (pollTimeout) clearTimeout(pollTimeout);
                        reject(new Error(result.data.errorMessage || 'Upload failed'));
                    } else {
                        // Schedule next poll with adaptive interval
                        pollTimeout = setTimeout(poll, currentInterval);
                    }
                } catch (error) {
                    if (pollTimeout) clearTimeout(pollTimeout);
                    reject(error);
                }
            };
            
            poll(); // Start immediately
        });
    }
}
