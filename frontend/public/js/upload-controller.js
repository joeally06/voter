/**
 * Upload Controller
 * Manages upload modal UI and interactions
 */
class UploadController {
    // Use configuration for max file size with fallback to 100MB
    // Implemented as getter to allow dynamic config updates
    static get MAX_FILE_SIZE() {
        return window.APP_CONFIG?.maxUploadSizeBytes || (100 * 1024 * 1024);
    }
    
    constructor(uploadService) {
        this.uploadService = uploadService;
        this.selectedFile = null;
        this.uploadId = null;
        this.startTime = null;
        this.timerInterval = null;
        
        this.initializeElements();
        this.attachEventListeners();
    }
    
    /**
     * Initialize DOM element references
     */
    initializeElements() {
        // Modal
        this.modal = document.getElementById('uploadModal');
        this.errorModal = document.getElementById('errorDetailsModal');
        
        // Views
        this.selectionView = document.getElementById('uploadSelectionView');
        this.progressView = document.getElementById('uploadProgressView');
        this.resultsView = document.getElementById('uploadResultsView');
        
        // Drop zone
        this.dropZone = document.getElementById('dropZone');
        this.fileInput = document.getElementById('fileInput');
        
        // File info
        this.fileInfo = document.getElementById('fileInfo');
        this.fileName = document.getElementById('fileName');
        this.fileSize = document.getElementById('fileSize');
        this.removeFileBtn = document.getElementById('removeFile');
        
        // Options
        this.importModeInputs = document.querySelectorAll('input[name="importMode"]');
        this.hasHeadersInput = document.getElementById('hasHeaders');
        this.csvOptions = document.getElementById('csvOptions');
        
        // Progress elements
        this.progressBar = document.getElementById('progressBar');
        this.progressPercent = document.getElementById('progressPercent');
        this.progressStatus = document.getElementById('progressStatus');
        this.progressFileName = document.getElementById('progressFileName');
        this.uploadStats = document.getElementById('uploadStats');
        this.statsProcessed = document.getElementById('statsProcessed');
        this.statsSuccessful = document.getElementById('statsSuccessful');
        this.statsFailed = document.getElementById('statsFailed');
        this.timerElapsed = document.getElementById('timerElapsed');
        this.timerEstimate = document.getElementById('timerEstimate');
        this.timerRemaining = document.getElementById('timerRemaining');
        
        // Results elements
        this.resultIcon = document.getElementById('resultIcon');
        this.resultTitle = document.getElementById('resultTitle');
        this.resultMessage = document.getElementById('resultMessage');
        this.resultTotal = document.getElementById('resultTotal');
        this.resultSuccess = document.getElementById('resultSuccess');
        this.resultFailed = document.getElementById('resultFailed');
        this.resultDuration = document.getElementById('resultDuration');
        this.errorSection = document.getElementById('errorSection');
        this.errorCount = document.getElementById('errorCount');
        this.viewErrorsBtn = document.getElementById('viewErrorsBtn');
        
        // Buttons
        this.uploadFileBtn = document.getElementById('uploadFileBtn');
        this.cancelBtn = document.getElementById('cancelBtn');
        this.downloadErrorsBtn = document.getElementById('downloadErrorsBtn');
    }
    
    /**
     * Attach event listeners
     */
    attachEventListeners() {
        // Drop zone events
        this.dropZone.addEventListener('click', () => this.fileInput.click());
        this.dropZone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.fileInput.click();
            }
        });
        
        // Drag and drop
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });
        
        ['dragenter', 'dragover'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, () => {
                this.dropZone.classList.add('drag-over');
            });
        });
        
        ['dragleave', 'drop'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, () => {
                this.dropZone.classList.remove('drag-over');
            });
        });
        
        this.dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileSelect(files[0]);
            }
        });
        
        // File input
        this.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFileSelect(e.target.files[0]);
            }
        });
        
        // Remove file
        this.removeFileBtn.addEventListener('click', () => {
            this.clearFileSelection();
        });
        
        // Upload button
        this.uploadFileBtn.addEventListener('click', () => {
            this.startUpload();
        });
        
        // Cancel button
        this.cancelBtn.addEventListener('click', () => {
            this.handleCancel();
        });
        
        // View errors
        this.viewErrorsBtn.addEventListener('click', async () => {
            await this.showErrorDetails();
        });
        
        // Download errors
        this.downloadErrorsBtn.addEventListener('click', async () => {
            await this.downloadErrorReport();
        });
        
        // Modal events
        this.modal.addEventListener('hidden.bs.modal', () => {
            this.resetModal();
        });
    }
    
    /**
     * Handle file selection
     */
    handleFileSelect(file) {
        // Validate file type
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext !== 'dbf' && ext !== 'csv') {
            Utils.showToast('Invalid file type. Please select a .dbf or .csv file.', 'error');
            return;
        }
        
        // IMPROVEMENT #2: Use extracted constant for file size validation
        if (file.size > UploadController.MAX_FILE_SIZE) {
            Utils.showToast('File too large. Maximum size is 100MB.', 'error');
            return;
        }
        
        this.selectedFile = file;
        
        // Show/hide CSV options
        if (ext === 'csv') {
            this.csvOptions.style.display = 'block';
        } else {
            this.csvOptions.style.display = 'none';
        }
        
        // Display file info
        this.fileName.textContent = file.name;
        this.fileSize.textContent = this.formatFileSize(file.size);
        this.fileInfo.style.display = 'block';
        
        // Enable upload button
        this.uploadFileBtn.disabled = false;
    }
    
    /**
     * Clear file selection
     */
    clearFileSelection() {
        this.selectedFile = null;
        this.fileInput.value = '';
        this.fileInfo.style.display = 'none';
        this.uploadFileBtn.disabled = true;
        this.csvOptions.style.display = 'none';
    }
    
    /**
     * Start upload process
     */
    async startUpload() {
        if (!this.selectedFile) return;
        
        // Get options
        const importMode = document.querySelector('input[name="importMode"]:checked').value;
        const hasHeaders = this.hasHeadersInput.checked;
        
        const options = {
            importMode,
            hasHeaders: this.selectedFile.name.endsWith('.csv') ? hasHeaders : undefined
        };
        
        // Switch to progress view
        this.showProgressView();
        this.progressFileName.textContent = `Uploading: ${this.selectedFile.name}`;
        
        // Start timer
        this.startTime = Date.now();
        this.startTimer();
        
        try {
            // Upload file
            const uploadResponse = await this.uploadService.uploadFile(
                this.selectedFile,
                options,
                (progress) => this.handleUploadProgress(progress)
            );
            
            if (!uploadResponse.success) {
                throw new Error(uploadResponse.message || 'Upload failed');
            }
            
            this.uploadId = uploadResponse.import.id;
            
            // Switch to processing status
            this.progressStatus.textContent = 'Processing records...';
            this.uploadStats.style.display = 'block';
            
            // Poll for completion
            const finalStatus = await this.uploadService.pollUploadStatus(
                this.uploadId,
                (progress) => this.handleProcessingProgress(progress)
            );
            
            // Show results
            await this.showResults(finalStatus);
            
        } catch (error) {
            this.stopTimer();
            
            if (error.message === 'Upload cancelled') {
                // User cancelled - just close modal
                bootstrap.Modal.getInstance(this.modal).hide();
            } else {
                // Show error
                this.showError(error.message);
            }
        }
    }
    
    /**
     * Handle upload progress
     */
    handleUploadProgress(progress) {
        if (progress.type === 'upload') {
            const percent = progress.percent;
            this.updateProgressBar(percent);
            this.progressStatus.textContent = 'Uploading file...';
        }
    }
    
    /**
     * Handle processing progress
     */
    handleProcessingProgress(progress) {
        if (progress.type === 'processing') {
            this.statsProcessed.textContent = Utils.formatNumber(progress.processed || 0);
            this.statsSuccessful.textContent = Utils.formatNumber(progress.successful || 0);
            this.statsFailed.textContent = Utils.formatNumber(progress.failed || 0);
            
            if (progress.percent !== undefined) {
                this.updateProgressBar(progress.percent);
            }
        }
    }
    
    /**
     * Update progress bar
     */
    updateProgressBar(percent) {
        const rounded = Math.round(percent);
        this.progressBar.style.width = `${rounded}%`;
        this.progressBar.setAttribute('aria-valuenow', rounded);
        this.progressBar.textContent = `${rounded}%`;
        this.progressPercent.textContent = `${rounded}%`;
    }
    
    /**
     * Start elapsed time timer
     * IMPROVEMENT #4: Use requestAnimationFrame for smoother, more efficient updates
     */
    startTimer() {
        const updateTimer = () => {
            if (!this.timerInterval) return; // Stopped
            
            const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
            this.timerElapsed.textContent = this.formatTime(elapsed);
            
            // Schedule next update - RAF calls ~60 times/sec but we only update when seconds change
            this.timerInterval = requestAnimationFrame(updateTimer);
        };
        
        // Use requestAnimationFrame if available, fallback to setInterval
        if (typeof requestAnimationFrame !== 'undefined') {
            this.timerInterval = requestAnimationFrame(updateTimer);
        } else {
            // Fallback for older browsers
            this.timerInterval = setInterval(() => {
                const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
                this.timerElapsed.textContent = this.formatTime(elapsed);
            }, 1000);
        }
    }
    
    /**
     * Stop timer
     * IMPROVEMENT #4: Handle both RAF and setInterval cleanup
     */
    stopTimer() {
        if (this.timerInterval) {
            // Try RAF cancellation first (works for both RAF IDs and fails silently for setInterval IDs)
            if (typeof cancelAnimationFrame !== 'undefined') {
                cancelAnimationFrame(this.timerInterval);
            }
            // Also try clearInterval for fallback compatibility
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }
    
    /**
     * Show progress view
     */
    showProgressView() {
        this.selectionView.style.display = 'none';
        this.progressView.style.display = 'block';
        this.resultsView.style.display = 'none';
        
        // Update footer
        this.uploadFileBtn.style.display = 'none';
        this.cancelBtn.textContent = 'Cancel Upload';
    }
    
    /**
     * Show results view
     */
    async showResults(status) {
        this.stopTimer();
        
        const duration = Math.floor((Date.now() - this.startTime) / 1000);
        
        this.selectionView.style.display = 'none';
        this.progressView.style.display = 'none';
        this.resultsView.style.display = 'block';
        
        // Success or partial success
        const hasErrors = status.progress?.failed > 0;
        
        if (hasErrors) {
            this.resultIcon.className = 'bi bi-exclamation-circle-fill text-warning';
            this.resultTitle.textContent = 'Upload Completed with Errors';
            this.resultMessage.textContent = `Successfully processed ${status.filename}`;
        } else {
            this.resultIcon.className = 'bi bi-check-circle-fill text-success';
            this.resultTitle.textContent = 'Upload Complete';
            this.resultMessage.textContent = `Successfully processed ${status.filename}`;
        }
        
        // Summary
        this.resultTotal.textContent = Utils.formatNumber(status.progress?.processed || 0);
        this.resultSuccess.textContent = Utils.formatNumber(status.progress?.successful || 0);
        this.resultFailed.textContent = Utils.formatNumber(status.progress?.failed || 0);
        this.resultDuration.textContent = this.formatTime(duration);
        
        // Error section
        if (hasErrors) {
            this.errorCount.textContent = status.progress.failed;
            this.errorSection.style.display = 'block';
        }
        
        // Update footer
        this.cancelBtn.textContent = 'Close';
        
        // Show toast
        if (hasErrors) {
            Utils.showToast(
                `Upload completed with ${status.progress.failed} errors`,
                'warning'
            );
        } else {
            Utils.showToast('Upload completed successfully!', 'success');
        }
        
        // Refresh map data
        await this.refreshData();
    }
    
    /**
     * Show error view
     */
    showError(message) {
        this.selectionView.style.display = 'none';
        this.progressView.style.display = 'none';
        this.resultsView.style.display = 'block';
        
        this.resultIcon.className = 'bi bi-x-circle-fill text-danger';
        this.resultTitle.textContent = 'Upload Failed';
        this.resultMessage.textContent = message;
        
        // Hide summary
        const summaryCard = this.resultsView.querySelector('.vp-card');
        if (summaryCard) {
            summaryCard.style.display = 'none';
        }
        
        this.cancelBtn.textContent = 'Close';
        
        Utils.showToast(message, 'error');
    }
    
    /**
     * Show error details modal
     */
    async showErrorDetails() {
        if (!this.uploadId) return;
        
        try {
            Utils.showLoading(true);
            const errorsData = await this.uploadService.getUploadErrors(this.uploadId);
            
            const errorsList = document.getElementById('errorDetailsList');
            errorsList.innerHTML = '';
            
            if (errorsData.errors && errorsData.errors.length > 0) {
                errorsData.errors.forEach(error => {
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'error-item';
                    // IMPROVEMENT #1: Escape error.errorType to prevent XSS (defense in depth)
                    errorDiv.innerHTML = `
                        <strong>Record #${error.recordNumber}</strong><br>
                        <small>${Utils.escapeHtml(error.errorType || 'Unknown')}: ${Utils.escapeHtml(error.message)}</small>
                    `;
                    errorsList.appendChild(errorDiv);
                });
            } else {
                errorsList.innerHTML = '<p class="text-muted">No detailed errors available.</p>';
            }
            
            const modal = new bootstrap.Modal(this.errorModal);
            modal.show();
            
        } catch (error) {
            Utils.showToast('Failed to load error details', 'error');
        } finally {
            Utils.showLoading(false);
        }
    }
    
    /**
     * Download error report as CSV
     */
    async downloadErrorReport() {
        if (!this.uploadId) return;
        
        try {
            const errorsData = await this.uploadService.getUploadErrors(this.uploadId);
            
            if (!errorsData.errors || errorsData.errors.length === 0) {
                Utils.showToast('No errors to download', 'info');
                return;
            }
            
            Utils.exportToCSV(errorsData.errors, `upload_errors_${this.uploadId}.csv`);
        } catch (error) {
            Utils.showToast('Failed to download error report', 'error');
        }
    }
    
    /**
     * Handle cancel button
     */
    handleCancel() {
        if (this.progressView.style.display === 'block') {
            // Upload in progress
            if (confirm('Are you sure you want to cancel the upload?')) {
                this.uploadService.cancelUpload();
                this.stopTimer();
            }
        } else {
            // Just close modal
            bootstrap.Modal.getInstance(this.modal).hide();
        }
    }
    
    /**
     * Reset modal to initial state
     */
    resetModal() {
        this.clearFileSelection();
        this.stopTimer();
        
        // Reset views
        this.selectionView.style.display = 'block';
        this.progressView.style.display = 'none';
        this.resultsView.style.display = 'none';
        
        // Reset progress
        this.updateProgressBar(0);
        this.uploadStats.style.display = 'none';
        this.statsProcessed.textContent = '0';
        this.statsSuccessful.textContent = '0';
        this.statsFailed.textContent = '0';
        this.timerElapsed.textContent = '00:00';
        
        // Reset results
        this.errorSection.style.display = 'none';
        const summaryCard = this.resultsView.querySelector('.vp-card');
        if (summaryCard) {
            summaryCard.style.display = 'block';
        }
        
        // Reset footer
        this.uploadFileBtn.style.display = 'inline-block';
        this.cancelBtn.textContent = 'Cancel';
        
        this.uploadId = null;
        this.startTime = null;
    }
    
    /**
     * Refresh data after successful upload
     */
    async refreshData() {
        try {
            // Refresh map and charts if controllers exist
            if (window.app && window.app.voterService) {
                // Clear cache
                if (window.app.voterService.cache) {
                    window.app.voterService.cache.clear();
                }
                
                // Refresh map
                if (window.app.mapController && window.app.mapController.refreshMarkers) {
                    await window.app.mapController.refreshMarkers();
                }
                
                // Refresh charts
                if (window.app.chartController && window.app.chartController.refresh) {
                    await window.app.chartController.refresh();
                }
            }
        } catch (error) {
            Logger.warn('Failed to refresh data after import:', error);
        }
    }
    
    /**
     * Format file size for display
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
    
    /**
     * Format seconds to MM:SS
     */
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    
    /**
     * Initialize controller
     */
    async init() {
        Logger.info('✅ UploadController initialized');
    }
}

