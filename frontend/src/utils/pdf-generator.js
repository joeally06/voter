/**
 * PDF generator for analytics reports
 * Uses html2pdf.js to convert HTML to PDF with professional layout
 */
import html2pdf from 'html2pdf.js';
import { chartToImage } from './chart-utils.js';
import { processHtml2CanvasClone, createRgbOverrideStylesheet, ensureRgbColor } from './color-converter.js';

/**
 * Generate a filename with timestamp
 * @param {string} prefix - Filename prefix
 * @param {string} suffix - Optional suffix
 * @returns {string} Formatted filename
 */
function generateFilename(prefix, suffix = '') {
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, ''); // HHMMSS
  const suffixPart = suffix ? `_${suffix}` : '';
  return `${prefix}${suffixPart}_${dateStr}_${timeStr}.pdf`;
}

/**
 * Show a progress modal during PDF generation
 * @param {string} message - Progress message
 * @returns {HTMLElement} Modal element
 */
function showProgressModal(message = 'Generating PDF...') {
  // Remove existing modal if any
  const existing = document.getElementById('pdf-progress-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'pdf-progress-modal';
  modal.innerHTML = `
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white dark:bg-gray-900 rounded-xl p-8 max-w-md w-full mx-4 shadow-2xl">
        <div class="text-center">
          <div class="mb-4">
            <svg class="animate-spin h-12 w-12 mx-auto text-primary-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">${message}</h3>
          <p class="text-sm text-gray-600 dark:text-gray-400">This may take a few seconds...</p>
          <div class="mt-4">
            <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div id="pdf-progress-bar" class="bg-primary-600 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
            </div>
          </div>
          <p id="pdf-progress-text" class="text-xs text-gray-500 dark:text-gray-400 mt-2"></p>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

/**
 * Update progress bar
 * @param {number} percentage - Progress percentage (0-100)
 * @param {string} text - Progress text
 */
function updateProgress(percentage, text = '') {
  const bar = document.getElementById('pdf-progress-bar');
  const textEl = document.getElementById('pdf-progress-text');
  if (bar) bar.style.width = `${percentage}%`;
  if (textEl) textEl.textContent = text;
}

/**
 * Hide progress modal
 */
function hideProgressModal() {
  const modal = document.getElementById('pdf-progress-modal');
  if (modal) modal.remove();
}

/**
 * Show success notification
 * @param {string} filename - Generated filename
 */
function showSuccessNotification(filename) {
  const notification = document.createElement('div');
  notification.className = 'fixed top-4 right-4 z-50 bg-green-500 text-white px-6 py-4 rounded-lg shadow-lg flex items-center gap-3 animate-slide-in';
  notification.innerHTML = `
    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
    </svg>
    <div>
      <p class="font-semibold">Report exported successfully!</p>
      <p class="text-sm opacity-90">${filename}</p>
    </div>
  `;
  document.body.appendChild(notification);

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    notification.classList.add('animate-fade-out');
    setTimeout(() => notification.remove(), 300);
  }, 4000);
}

/**
 * Show error notification
 * @param {string} message - Error message
 */
function showErrorNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'fixed top-4 right-4 z-50 bg-red-500 text-white px-6 py-4 rounded-lg shadow-lg flex items-center gap-3';
  notification.innerHTML = `
    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
    </svg>
    <div>
      <p class="font-semibold">Export failed</p>
      <p class="text-sm opacity-90">${message}</p>
    </div>
  `;
  document.body.appendChild(notification);

  // Auto-dismiss after 5 seconds
  setTimeout(() => notification.remove(), 5000);
}

// Removed convertOklchToRgb() - replaced with html2canvas onclone callback approach
// See processHtml2CanvasClone() in color-converter.js

/**
 * Generate PDF from HTML element
 * @param {HTMLElement} element - Element to convert to PDF
 * @param {Object} options - PDF generation options
 * @returns {Promise} Promise that resolves when PDF is generated
 */
export async function generatePDF(element, options = {}) {
  const defaultOptions = {
    margin: [15, 10, 15, 10], // top, right, bottom, left (in mm)
    filename: options.filename || generateFilename('analytics_report'),
    image: { type: 'jpeg', quality: options.quality || 0.95 },
    html2canvas: { 
      scale: options.scale || 2,
      useCORS: true,
      letterRendering: true,
      logging: false,
      // CRITICAL FIX: Use onclone callback to convert OKLCH to RGB
      // This callback is invoked AFTER html2canvas creates its internal clone
      // but BEFORE it parses CSS, allowing us to inject RGB values in place of OKLCH
      onclone: (clonedDoc) => {
        console.log('[PDF Export] Invoking onclone callback for OKLCH conversion');
        processHtml2CanvasClone(clonedDoc);
      }
    },
    jsPDF: { 
      unit: 'mm', 
      format: 'a4', 
      orientation: 'portrait',
      compress: true
    },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
  };

  const mergedOptions = { ...defaultOptions, ...options };

  try {
    console.log('[PDF Export] Starting PDF generation with OKLCH fix');
    
    // Pre-process element colors before html2pdf
    console.log('[PDF Export] Pre-processing colors in element...');
    const allElements = element.querySelectorAll('*');
    console.log(`[PDF Export] Pre-processing ${allElements.length} elements...`);
    
    let convertedCount = 0;
    allElements.forEach(el => {
      try {
        const computed = getComputedStyle(el);
        const colorProps = [
          'backgroundColor', 'color', 'borderColor', 'borderTopColor',
          'borderRightColor', 'borderBottomColor', 'borderLeftColor',
          'fill', 'stroke'
        ];
        
        colorProps.forEach(prop => {
          const value = computed[prop];
          if (value && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent' && value !== 'none') {
            if (/^ok(?:lch|lab)\([^)]+\)$/i.test(value)) {
              const rgb = ensureRgbColor(value);
              el.style.setProperty(prop, rgb, 'important');
              convertedCount++;
            }
          }
        });
      } catch (err) {
        // Skip elements that error
      }
    });
    
    console.log(`[PDF Export] Pre-processed ${convertedCount} color properties`);
    
    // Generate PDF - html2canvas will call onclone callback with cloned document
    await html2pdf().set(mergedOptions).from(element).save();
    
    console.log('[PDF Export] PDF generation completed successfully');
    
    return true;
  } catch (error) {
    console.error('[PDF Export] PDF generation failed:', error);
    throw error;
  }
}

/**
 * Generate a full analytics report PDF
 * @param {Object} analyticsData - Complete analytics data
 * @param {Object} options - Export options
 * @returns {Promise} Promise that resolves when PDF is generated
 */
export async function generateAnalyticsReportPDF(analyticsData, options = {}) {
  const modal = showProgressModal('Generating Analytics Report...');
  
  try {
    updateProgress(10, 'Preparing report...');

    const container = document.querySelector('#analytics-content');
    if (!container) {
      throw new Error('Analytics content not found');
    }

    updateProgress(30, 'Preparing color conversions...');

    updateProgress(40, 'Capturing content...');

    // Create temporary container for PDF
    const pdfContainer = document.createElement('div');
    pdfContainer.style.cssText = 'position: absolute; left: -9999px; width: 210mm; background: white;';
    pdfContainer.className = 'pdf-export-container'; // Add identifier for scoped styles
    pdfContainer.innerHTML = `
      <div style="padding: 20px; font-family: system-ui, -apple-system, sans-serif;">
        <div style="text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #e5e7eb;">
          <h1 style="font-size: 28px; font-weight: bold; color: #1f2937; margin: 0 0 10px 0;">
            Analytics Report
          </h1>
          <p style="font-size: 14px; color: #6b7280; margin: 0;">
            Generated on ${new Date().toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </p>
        </div>
        ${container.innerHTML}
      </div>
    `;
    document.body.appendChild(pdfContainer);

    // CRITICAL FIX: Pre-process colors BEFORE html2pdf to avoid OKLCH parsing errors
    // This ensures all OKLCH colors are converted to RGB before html2canvas even starts
    console.log('[PDF Export] Pre-processing colors in PDF container...');
    await new Promise(resolve => setTimeout(resolve, 50)); // Let DOM settle
    
    // Apply RGB colors to all elements in the container synchronously
    const allElements = pdfContainer.querySelectorAll('*');
    console.log(`[PDF Export] Pre-processing ${allElements.length} elements...`);
    
    let convertedCount = 0;
    allElements.forEach(el => {
      try {
        const computed = getComputedStyle(el);
        const colorProps = [
          'backgroundColor', 'color', 'borderColor', 'borderTopColor',
          'borderRightColor', 'borderBottomColor', 'borderLeftColor',
          'fill', 'stroke', 'outlineColor'
        ];
        
        colorProps.forEach(prop => {
          const value = computed[prop];
          if (value && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent' && value !== 'none') {
            // Check if it's OKLCH/OKLAB and convert
            if (/^ok(?:lch|lab)\([^)]+\)$/i.test(value)) {
              const rgb = ensureRgbColor(value);
              el.style.setProperty(prop, rgb, 'important');
              convertedCount++;
            } else if (!value.startsWith('rgb')) {
              // Also ensure any other format is RGB
              el.style.setProperty(prop, value, 'important');
            }
          }
        });
      } catch (err) {
        // Skip elements that error
      }
    });
    
    console.log(`[PDF Export] Pre-processed ${convertedCount} color properties`);

    updateProgress(60, 'Generating PDF file...');

    // Generate PDF with onclone callback for OKLCH conversion
    const filename = options.filename || generateFilename('analytics_report', options.election || '');
    const pdfOptions = {
      margin: [15, 10, 15, 10],
      filename,
      image: { 
        type: 'jpeg', 
        quality: options.quality === 'print' ? 1.0 : options.quality === 'standard' ? 0.85 : 0.95
      },
      html2canvas: { 
        scale: options.quality === 'print' ? 3 : 2,
        useCORS: true,
        letterRendering: true,
        logging: false,
        // CRITICAL FIX: Convert OKLCH to RGB in html2canvas's clone
        // This is called AFTER html2canvas creates its internal clone
        // but BEFORE it parses CSS - the perfect timing for color conversion
        onclone: (clonedDoc) => {
          console.log('[Analytics PDF] Processing OKLCH colors in cloned document');
          processHtml2CanvasClone(clonedDoc);
        }
      },
      jsPDF: { 
        unit: 'mm', 
        format: 'a4', 
        orientation: 'portrait',
        compress: true
      },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };
    
    await html2pdf().set(pdfOptions).from(pdfContainer).save();

    updateProgress(100, 'Complete!');

    // Cleanup
    document.body.removeChild(pdfContainer);
    
    setTimeout(() => {
      hideProgressModal();
      showSuccessNotification(filename);
    }, 500);

    return true;
  } catch (error) {
    console.error('Failed to generate analytics report:', error);
    hideProgressModal();
    showErrorNotification(error.message || 'An error occurred during PDF generation');
    throw error;
  }
}

/**
 * Export a single section as PNG
 * @param {string} sectionId - ID of the section element
 * @param {string} sectionName - Human-readable section name
 * @returns {Promise} Promise that resolves when export is complete
 */
export async function exportSectionAsPNG(sectionId, sectionName = 'section') {
  try {
    const section = document.getElementById(sectionId) || document.querySelector(`[data-section="${sectionId}"]`);
    if (!section) {
      throw new Error(`Section ${sectionId} not found`);
    }

    // Use html2canvas to capture the section
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(section, {
      scale: 2,
      logging: false,
      useCORS: true,
      backgroundColor: '#ffffff'
    });

    // Convert to blob and download
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = generateFilename('analytics', sectionName).replace('.pdf', '.png');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showSuccessNotification(link.download);
    }, 'image/png');

    return true;
  } catch (error) {
    console.error('Failed to export section as PNG:', error);
    showErrorNotification('Failed to export as PNG');
    throw error;
  }
}

/**
 * Export a chart as PNG
 * @param {Chart} chartInstance - Chart.js instance
 * @param {string} chartName - Name for the file
 * @returns {Promise} Promise that resolves when export is complete
 */
export async function exportChartAsPNG(chartInstance, chartName = 'chart') {
  try {
    const imageData = chartToImage(chartInstance);
    if (!imageData) {
      throw new Error('Failed to capture chart');
    }

    // Convert base64 to blob
    const base64Data = imageData.split(',')[1];
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/png' });

    // Download
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = generateFilename('analytics', chartName).replace('.pdf', '.png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showSuccessNotification(link.download);
    return true;
  } catch (error) {
    console.error('Failed to export chart as PNG:', error);
    showErrorNotification('Failed to export chart');
    throw error;
  }
}

export {
  generateFilename,
  showProgressModal,
  hideProgressModal,
  updateProgress,
  showSuccessNotification,
  showErrorNotification
};
