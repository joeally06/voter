/**
 * PDF Generator using PDFMake
 * Generates professional analytics reports with charts and tables
 * 
 * Replaces html2pdf.js to eliminate OKLCH color issues and improve file sizes
 */

import * as pdfMakeModule from 'pdfmake/build/pdfmake';
import * as pdfFontsModule from 'pdfmake/build/vfs_fonts';
import { Chart } from 'chart.js';
import { chartToImage } from './chart-utils.js';
import { fmt, pct } from '../components/ui.js';

// Get the actual pdfMake instance (handle ESM default exports)
const pdfMake = pdfMakeModule.default || pdfMakeModule;

// Register fonts - vfs_fonts exports the vfs object directly or nested
const vfs = pdfFontsModule.pdfMake?.vfs || pdfFontsModule.default || pdfFontsModule;
pdfMake.vfs = vfs;

// ============================================================================
// SECTION 1: CONSTANTS AND CONFIGURATION
// ============================================================================

const COLORS = {
  primary: '#3b82f6',      // blue-500
  success: '#10b981',      // green-500
  warning: '#f59e0b',      // amber-500
  danger: '#ef4444',       // red-500
  gray: {
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    700: '#374151',
    900: '#111827'
  },
  democrat: '#2563eb',     // blue-600
  republican: '#dc2626',   // red-600
  independent: '#9333ea',  // purple-600
};

const styles = {
  // Headers
  title: {
    fontSize: 24,
    bold: true,
    color: COLORS.gray[900],
    margin: [0, 0, 0, 10]
  },
  
  sectionHeader: {
    fontSize: 16,
    bold: true,
    color: COLORS.gray[900],
    margin: [0, 15, 0, 10]
  },
  
  subsectionHeader: {
    fontSize: 14,
    bold: true,
    color: COLORS.gray[700],
    margin: [0, 10, 0, 5]
  },
  
  // Body text
  normal: {
    fontSize: 10,
    color: COLORS.gray[700]
  },
  
  small: {
    fontSize: 8,
    color: COLORS.gray[500]
  },
  
  // Tables
  tableHeader: {
    fontSize: 10,
    bold: true,
    fillColor: COLORS.gray[50],
    color: COLORS.gray[700],
    margin: [5, 5, 5, 5]
  },
  
  tableCell: {
    fontSize: 9,
    margin: [5, 3, 5, 3]
  },
  
  // Stat cards
  statValue: {
    fontSize: 18,
    bold: true,
    color: COLORS.gray[900]
  },
  
  statLabel: {
    fontSize: 10,
    color: COLORS.gray[500]
  },
  
  // Highlights
  badge: {
    fontSize: 9,
    bold: true,
    margin: [5, 3, 5, 3]
  }
};

// ============================================================================
// SECTION 2: UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a timestamped filename
 */
function generateFilename(prefix, suffix = '') {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '');
  const suffixPart = suffix ? `_${suffix}` : '';
  return `${prefix}${suffixPart}_${dateStr}_${timeStr}.pdf`;
}

/**
 * Show progress modal
 */
function showProgressModal(message) {
  // Remove existing modal if any
  hideProgressModal();
  
  const modal = document.createElement('div');
  modal.id = 'pdf-progress-modal';
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
      <div class="text-center">
        <svg class="animate-spin h-12 w-12 mx-auto text-primary-500 mb-4" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">${message}</h3>
        <div class="w-full bg progress-bar-bg rounded-full h-2 mb-2">
          <div id="pdf-progress-bar" class="bg-primary-500 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
        </div>
        <p id="pdf-progress-text" class="text-sm text-gray-500 dark:text-gray-400">Starting...</p>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  return modal;
}

/**
 * Update progress bar
 */
function updateProgress(percentage, text = '') {
  const progressBar = document.getElementById('pdf-progress-bar');
  const progressText = document.getElementById('pdf-progress-text');
  
  if (progressBar) {
    progressBar.style.width = `${percentage}%`;
  }
  
  if (progressText && text) {
    progressText.textContent = text;
  }
}

/**
 * Hide progress modal
 */
function hideProgressModal() {
  const modal = document.getElementById('pdf-progress-modal');
  if (modal) {
    modal.remove();
  }
}

/**
 * Show success notification
 */
function showSuccessNotification(filename) {
  const notification = document.createElement('div');
  notification.className = 'fixed top-4 right-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded-lg shadow-lg z-50 max-w-md';
  notification.innerHTML = `
    <div class="flex items-start gap-3">
      <svg class="h-5 w-5 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
      </svg>
      <div class="flex-1">
        <p class="font-semibold">PDF Generated Successfully</p>
        <p class="text-sm mt-1">Saved as: ${filename}</p>
      </div>
    </div>
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 5000);
}

/**
 * Show error notification
 */
function showErrorNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'fixed top-4 right-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg shadow-lg z-50 max-w-md';
  notification.innerHTML = `
    <div class="flex items-start gap-3">
      <svg class="h-5 w-5 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
      </svg>
      <div class="flex-1">
        <p class="font-semibold">PDF Generation Failed</p>
        <p class="text-sm mt-1">${message}</p>
      </div>
    </div>
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 7000);
}

// ============================================================================
// SECTION 3: DATA TRANSFORMATION
// ============================================================================

/**
 * Build a data table for PDFMake
 */
function buildDataTable(data, columns, options = {}) {
  const {
    headerStyle = 'tableHeader',
    cellStyle = 'tableCell',
    layout = 'lightHorizontalLines',
    widths = null,
    headerRows = 1
  } = options;

  // Handle empty data
  if (!data || data.length === 0) {
    return {
      text: 'No data available',
      style: 'small',
      color: COLORS.gray[400],
      italics: true,
      margin: [0, 10, 0, 10]
    };
  }

  // Limit very large tables
  const MAX_ROWS = 200;
  let tableData = data;
  let truncated = false;

  if (data.length > MAX_ROWS) {
    console.warn(`Table truncated: ${data.length} rows -> ${MAX_ROWS} rows`);
    tableData = data.slice(0, MAX_ROWS);
    truncated = true;
  }

  // Build header row
  const tableBody = [
    columns.map(col => ({
      text: col.header,
      style: headerStyle,
      bold: true,
      alignment: col.headerAlignment || 'left'
    }))
  ];

  // Build data rows
  tableData.forEach(row => {
    const rowCells = columns.map(col => {
      // Get value
      let value = col.getValue ? col.getValue(row) : row[col.key];
      
      // Format value
      if (col.format) {
        value = col.format(value);
      } else if (typeof value === 'number') {
        value = value.toLocaleString();
      } else if (value === null || value === undefined) {
        value = '-';
      }

      // Truncate very long text
      if (typeof value === 'string' && value.length > 100) {
        value = value.substring(0, 97) + '...';
      }

      // Build cell
      return {
        text: String(value),
        style: cellStyle,
        alignment: col.alignment || 'left',
        ...(col.getCellStyle ? col.getCellStyle(row) : {})
      };
    });
    tableBody.push(rowCells);
  });

  const table = {
    table: {
      headerRows: headerRows,
      widths: widths || columns.map(c => c.width || '*'),
      body: tableBody
    },
    layout: layout,
    margin: [0, 10, 0, 15]
  };

  // Add truncation notice if needed
  if (truncated) {
    return [
      table,
      {
        text: `Table truncated to ${MAX_ROWS} rows (${data.length} total rows)`,
        style: 'small',
        color: COLORS.warning,
        italics: true,
        margin: [0, 5, 0, 10]
      }
    ];
  }

  return table;
}

/**
 * Build a stat card for PDFMake with colored background
 */
function buildStatCard(label, value, sublabel = '', colorType = 'primary') {
  // Define background colors that match the screenshot
  const colorMap = {
    primary: { bg: '#2e3b5f', text: '#ffffff' },    // Dark blue like VOTED card
    gray: { bg: '#374151', text: '#ffffff' },       // Gray like REGISTERED card
    success: { bg: '#065f46', text: '#ffffff' },    // Dark green like EARLY VOTED card
    warning: { bg: '#78350f', text: '#ffffff' }     // Dark orange like ELECTION DAY card
  };
  
  const colors = colorMap[colorType] || colorMap.primary;
  
  return {
    stack: [
      {
        text: label.toUpperCase(),
        style: 'statLabel',
        color: colors.text,
        opacity: 0.8,
        fontSize: 8,
        bold: false,
        margin: [10, 10, 10, 5]
      },
      {
        text: value,
        style: 'statValue',
        color: colors.text,
        bold: true,
        fontSize: 32,
        margin: [10, 0, 10, 3]
      },
      ...(sublabel ? [{
        text: sublabel,
        fontSize: 10,
        color: colors.text,
        opacity: 0.7,
        margin: [10, 0, 10, 10]
      }] : [{
        text: ' ',
        margin: [10, 0, 10, 10]
      }])
    ],
    fillColor: colors.bg,
    margin: [0, 0, 0, 0]
  };
}

// ============================================================================
// SECTION 4: DOCUMENT SECTION BUILDERS
// ============================================================================

/**
 * Build document header
 */
function buildHeader(currentPage, pageCount) {
  return {
    text: `Voter Analytics Report - Page ${currentPage} of ${pageCount}`,
    alignment: 'right',
    fontSize: 8,
    color: COLORS.gray[500],
    margin: [40, 20, 40, 10]
  };
}

/**
 * Build document footer
 */
function buildFooter(currentPage, pageCount) {
  return {
    columns: [
      {
        text: 'Voter Platform',
        fontSize: 8,
        color: COLORS.gray[400]
      },
      {
        text: 'Confidential',
        fontSize: 8,
        color: COLORS.gray[400],
        alignment: 'right'
      }
    ],
    margin: [40, 10, 40, 20]
  };
}

/**
 * Build title section
 */
function buildTitleSection(options = {}) {
  const {
    electionCode = null,
    filters = null,
    generatedDate = new Date()
  } = options;

  const content = [
    {
      text: 'Voter Analytics Report',
      style: 'title',
      alignment: 'center',
      margin: [0, 0, 0, 5]
    },
    {
      text: `Generated on ${generatedDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })}`,
      style: 'small',
      alignment: 'center',
      margin: [0, 0, 0, 15]
    }
  ];

  // Add election code if specified
  if (electionCode) {
    content.push({
      text: `Election: ${electionCode}`,
      style: 'normal',
      alignment: 'center',
      margin: [0, 0, 0, 5]
    });
  }

  // Add filters if specified
  if (filters && Object.keys(filters).length > 0) {
    content.push({
      text: 'Filters Applied:',
      style: 'subsectionHeader',
      margin: [0, 10, 0, 5]
    });
    
    Object.entries(filters).forEach(([key, value]) => {
      content.push({
        text: `• ${key}: ${value}`,
        style: 'small',
        margin: [20, 2, 0, 2]
      });
    });
  }

  return content;
}

/**
 * Build overview section
 */
function buildOverviewSection(totals) {
  if (!totals) {
    return [];
  }

  return [
    {
      text: 'Overview',
      style: 'sectionHeader'
    },
    {
      columns: [
        { width: '*', ...buildStatCard('Total Voters', fmt(totals.voters), '', 'primary') },
        { width: '*', ...buildStatCard('Super Voters', fmt(totals.superVoters), '', 'success') }
      ],
      columnGap: 20,
      margin: [0, 0, 0, 10]
    },
    {
      columns: [
        { width: '*', ...buildStatCard('Precincts', fmt(totals.precincts), '', 'warning') },
        { width: '*', ...buildStatCard('Geocoded', fmt(totals.geocoded), '', 'gray') }
      ],
      columnGap: 20,
      margin: [0, 0, 0, 20]
    }
  ];
}

/**
 * Build engagement levels section
 */
async function buildEngagementSection(data, chartInstances) {
  const content = [
    {
      text: 'Engagement Levels',
      style: 'sectionHeader',
      pageBreak: 'before'
    }
  ];

  // Add chart if available
  const chartInstance = chartInstances.get('engagement-chart');
  if (chartInstance) {
    try {
      const chartImage = chartToImage(chartInstance);
      if (chartImage) {
        content.push({
          image: chartImage,
          width: 400,
          alignment: 'center',
          margin: [0, 10, 0, 15]
        });
      }
    } catch (error) {
      console.error('Failed to convert engagement chart to image:', error);
      content.push({
        text: '[Chart rendering failed]',
        style: 'small',
        color: COLORS.gray[400],
        italics: true,
        alignment: 'center',
        margin: [0, 10, 0, 15]
      });
    }
  }

  // Add data table
  if (data && data.levels && data.levels.length > 0) {
    content.push(
      buildDataTable(
        data.levels,
        [
          {
            key: 'level',
            header: 'Engagement Level',
            width: '*',
            format: (val) => {
              const labels = {
                'super_voters': 'Super Voters',
                'regular_voters': 'Regular Voters',
                'occasional_voters': 'Occasional Voters',
                'infrequent_voters': 'Infrequent Voters',
                'never_voted': 'Never Voted'
              };
              return labels[val] || val;
            }
          },
          {
            key: 'count',
            header: 'Voters',
            width: 80,
            format: fmt,
            alignment: 'right'
          },
          {
            key: 'percentage',
            header: 'Percentage',
            width: 80,
            format: pct,
            alignment: 'right',
            getCellStyle: (row) => ({
              bold: row.percentage > 30
            })
          }
        ],
        { layout: 'lightHorizontalLines' }
      )
    );
  } else {
    content.push({
      text: 'No engagement data available',
      style: 'normal',
      color: COLORS.gray[500],
      italics: true,
      margin: [0, 10, 0, 20]
    });
  }

  return content;
}

/**
 * Build party affiliation section
 */
async function buildPartySection(data, chartInstances) {
  const content = [
    {
      text: 'Party Affiliation',
      style: 'sectionHeader',
      pageBreak: 'before'
    }
  ];

  // Add chart if available
  const chartInstance = chartInstances.get('party-chart');
  if (chartInstance) {
    try {
      const chartImage = chartToImage(chartInstance);
      if (chartImage) {
        content.push({
          image: chartImage,
          width: 400,
          alignment: 'center',
          margin: [0, 10, 0, 15]
        });
      }
    } catch (error) {
      console.error('Failed to convert party chart to image:', error);
    }
  }

  // Add data table
  if (data && data.parties && data.parties.length > 0) {
    content.push(
      buildDataTable(
        data.parties,
        [
          { key: 'party', header: 'Party', width: '*' },
          { key: 'voters', header: 'Voters', width: 80, format: fmt, alignment: 'right' },
          { key: 'percentage', header: 'Percentage', width: 80, format: pct, alignment: 'right' }
        ],
        { layout: 'lightHorizontalLines' }
      )
    );
  } else {
    content.push({
      text: 'No party data available',
      style: 'normal',
      color: COLORS.gray[500],
      italics: true,
      margin: [0, 10, 0, 20]
    });
  }

  return content;
}

/**
 * Build non-voter precinct section
 */
function buildNonVoterSection(data) {
  const content = [
    {
      text: 'Non-Voter Precinct Analysis',
      style: 'sectionHeader',
      pageBreak: 'before'
    }
  ];

  if (data && data.length > 0) {
    content.push(
      buildDataTable(
        data,
        [
          { key: 'precinct', header: 'Precinct', width: 80 },
          { key: 'nonVoters', header: 'Non-Voters', width: 100, format: fmt, alignment: 'right' },
          { key: 'percentage', header: 'Percentage', width: 80, format: pct, alignment: 'right' }
        ],
        { layout: 'lightHorizontalLines' }
      )
    );
  } else {
    content.push({
      text: 'No non-voter precinct data available',
      style: 'normal',
      color: COLORS.gray[500],
      italics: true,
      margin: [0, 10, 0, 20]
    });
  }

  return content;
}

/**
 * Build demographics section
 */
async function buildDemographicsSection(data, chartInstances) {
  const content = [
    {
      text: 'Demographics',
      style: 'sectionHeader',
      pageBreak: 'before'
    }
  ];

  // Gender distribution
  if (data && data.gender && data.gender.length > 0) {
    content.push({
      text: 'Gender Distribution',
      style: 'subsectionHeader'
    });

    const genderChartInstance = chartInstances.get('gender-chart');
    if (genderChartInstance) {
      try {
        const genderChartImage = chartToImage(genderChartInstance);
        if (genderChartImage) {
          content.push({
            image: genderChartImage,
            width: 350,
            alignment: 'center',
            margin: [0, 10, 0, 15]
          });
        }
      } catch (error) {
        console.error('Failed to convert gender chart to image:', error);
      }
    }

    content.push(
      buildDataTable(
        data.gender,
        [
          { key: 'gender', header: 'Gender', width: '*' },
          { key: 'count', header: 'Voters', width: 80, format: fmt, alignment: 'right' },
          { key: 'percentage', header: '%', width: 60, format: pct, alignment: 'right' }
        ],
        { layout: 'lightHorizontalLines' }
      )
    );
  }

  // Age distribution
  if (data && data.age && data.age.length > 0) {
    content.push({
      text: 'Age Distribution',
      style: 'subsectionHeader'
    });

    const ageChartInstance = chartInstances.get('age-demographics-chart');
    if (ageChartInstance) {
      try {
        const ageChartImage = chartToImage(ageChartInstance);
        if (ageChartImage) {
          content.push({
            image: ageChartImage,
            width: 350,
            alignment: 'center',
            margin: [0, 10, 0, 15]
          });
        }
      } catch (error) {
        console.error('Failed to convert age chart to image:', error);
      }
    }

    content.push(
      buildDataTable(
        data.age,
        [
          { key: 'ageRange', header: 'Age Range', width: '*' },
          { key: 'count', header: 'Voters', width: 80, format: fmt, alignment: 'right' },
          { key: 'percentage', header: '%', width: 60, format: pct, alignment: 'right' }
        ],
        { layout: 'lightHorizontalLines' }
      )
    );
  }

  if ((!data || !data.gender || data.gender.length === 0) && 
      (!data || !data.age || data.age.length === 0)) {
    content.push({
      text: 'No demographics data available',
      style: 'normal',
      color: COLORS.gray[500],
      italics: true,
      margin: [0, 10, 0, 20]
    });
  }

  return content;
}

/**
 * Build last election section
 */
async function buildLastElectionSection(data, chartInstances) {
  if (!data || !data.election) {
    return [];
  }

  const { election, summary, ageBreakdown, precinctBreakdown } = data;
  
  const content = [
    {
      text: 'Last Election Breakdown',
      style: 'sectionHeader',
      pageBreak: 'before'
    },
    {
      text: `Election: ${election.electionCode}`,
      style: 'normal',
      color: COLORS.gray[600],
      fontSize: 10,
      margin: [0, 0, 0, 15]
    }
  ];

  // Summary stats in grid - all 4 cards in one row
  content.push({
    columns: [
      { width: '*', ...buildStatCard('Voted', fmt(election.totalVoted), pct(election.turnoutRate) + ' turnout', 'primary') },
      { width: '*', ...buildStatCard('Registered', fmt(election.totalRegistered), '', 'gray') },
      { width: '*', ...buildStatCard('Early Voted', fmt(election.earlyVoted), pct(election.earlyVoteRate), 'success') },
      { width: '*', ...buildStatCard('Election Day', fmt(election.electionDayVoted), '', 'warning') }
    ],
    columnGap: 15,
    margin: [0, 0, 0, 20]
  });

  // Key Highlights with colored badges
  if (summary) {
    content.push({
      text: 'Key Highlights',
      style: 'subsectionHeader',
      margin: [0, 0, 0, 10]
    });

    const badges = [];
    
    if (summary.highestTurnoutPrecinct) {
      badges.push({
        text: [
          { text: 'HIGHEST TURNOUT  ', fontSize: 9, bold: true, color: '#065f46' },
          { text: `Precinct ${summary.highestTurnoutPrecinct}`, fontSize: 10, bold: true, color: '#065f46' }
        ],
        fillColor: '#d1fae5',
        margin: [8, 6, 8, 6]
      });
    }
    
    if (summary.lowestTurnoutPrecinct) {
      badges.push({
        text: [
          { text: 'LOWEST TURNOUT  ', fontSize: 9, bold: true, color: '#991b1b' },
          { text: `Precinct ${summary.lowestTurnoutPrecinct}`, fontSize: 10, bold: true, color: '#991b1b' }
        ],
        fillColor: '#fee2e2',
        margin: [8, 6, 8, 6]
      });
    }
    
    if (summary.largestAgeGroup) {
      badges.push({
        text: [
          { text: 'LARGEST AGE GROUP  ', fontSize: 9, bold: true, color: '#1e40af' },
          { text: summary.largestAgeGroup, fontSize: 10, bold: true, color: '#1e40af' }
        ],
        fillColor: '#dbeafe',
        margin: [8, 6, 8, 6]
      });
    }
    
    if (summary.medianAgeGroup) {
      badges.push({
        text: [
          { text: 'MEDIAN AGE GROUP  ', fontSize: 9, bold: true, color: '#6b21a8' },
          { text: summary.medianAgeGroup, fontSize: 10, bold: true, color: '#6b21a8' }
        ],
        fillColor: '#e9d5ff',
        margin: [8, 6, 8, 6]
      });
    }

    if (badges.length > 0) {
      // Layout badges in a grid
      const badgeColumns = [];
      for (let i = 0; i < badges.length; i += 2) {
        const row = {
          columns: [
            { width: '48%', ...badges[i] },
            badges[i + 1] ? { width: '48%', ...badges[i + 1] } : { width: '48%', text: '' }
          ],
          columnGap: 10,
          margin: [0, 0, 0, i < badges.length - 2 ? 10 : 15]
        };
        content.push(row);
      }
    }
  }

  // Age distribution chart + table
  if (ageBreakdown && ageBreakdown.length > 0) {
    content.push({
      text: 'Voters by Age Group',
      style: 'subsectionHeader'
    });

    const ageChartInstance = chartInstances.get('age-distribution-chart');
    if (ageChartInstance) {
      try {
        const ageChartImage = chartToImage(ageChartInstance);
        if (ageChartImage) {
          content.push({
            image: ageChartImage,
            width: 350,
            alignment: 'center',
            margin: [0, 10, 0, 15]
          });
        }
      } catch (error) {
        console.error('Failed to convert age distribution chart to image:', error);
      }
    }

    content.push(
      buildDataTable(
        ageBreakdown,
        [
          { key: 'ageGroup', header: 'Age Group', width: '*' },
          { key: 'count', header: 'Voters', width: 80, format: fmt, alignment: 'right' },
          { key: 'percentage', header: '%', width: 60, format: pct, alignment: 'right' }
        ],
        { layout: 'lightHorizontalLines' }
      )
    );
  }

  // Precinct turnout table
  if (precinctBreakdown && precinctBreakdown.length > 0) {
    content.push({
      text: 'Turnout by Precinct',
      style: 'subsectionHeader',
      pageBreak: 'before'
    });

    content.push(
      buildDataTable(
        precinctBreakdown,
        [
          { key: 'precinctNumber', header: 'Precinct', width: 60, getValue: (row) => row.precinctNumber || row.precinct },
          { key: 'voted', header: 'Voted', width: 60, format: fmt, alignment: 'right', getValue: (row) => row.voted || row.totalVoted },
          { key: 'registered', header: 'Registered', width: 80, format: fmt, alignment: 'right', getValue: (row) => row.registered || row.totalRegistered },
          {
            key: 'turnoutRate',
            header: 'Turnout',
            width: 70,
            format: pct,
            alignment: 'right',
            getCellStyle: (row) => {
              if (row.turnoutRate >= 70) return { color: COLORS.success, bold: true };
              if (row.turnoutRate >= 50) return { color: COLORS.warning };
              return { color: COLORS.danger, bold: true };
            }
          },
          { key: 'earlyVoteRate', header: 'Early %', width: 60, format: pct, alignment: 'right' },
          { 
            key: 'democrat', 
            header: 'D', 
            width: 50, 
            format: fmt, 
            alignment: 'right',
            getValue: (row) => row.partyBreakdown?.democrat || row.democratVoted || 0,
            getCellStyle: () => ({ color: '#2563eb' })
          },
          { 
            key: 'republican', 
            header: 'R', 
            width: 50, 
            format: fmt, 
            alignment: 'right',
            getValue: (row) => row.partyBreakdown?.republican || row.republicanVoted || 0,
            getCellStyle: () => ({ color: '#dc2626' })
          }
        ],
        { layout: 'lightHorizontalLines' }
      )
    );
  }

  return content;
}

// ============================================================================
// SECTION 5: MAIN GENERATION FUNCTIONS
// ============================================================================

/**
 * Generate a complete analytics report PDF using PDFMake
 * 
 * @param {Object} analyticsData - Complete analytics data object
 * @param {Object} options - Export options
 * @returns {Promise<boolean>} - Resolves to true on success
 */
export async function generateAnalyticsReportPDF(analyticsData, options = {}) {
  const {
    quality = 'standard',
    filename = null,
    electionCode = null
  } = options;
  
  const modalTitle = electionCode 
    ? `Generating Election Report (${electionCode})...` 
    : 'Generating Analytics Report...';
  
  const modal = showProgressModal(modalTitle);
  
  try {
    updateProgress(10, 'Preparing data...');

    // Extract chart instances from the DOM
    updateProgress(20, 'Converting charts to images...');
    const chartInstances = new Map();
    
    const chartElements = [
      { id: 'engagement-chart', key: 'engagement-chart' },
      { id: 'party-chart', key: 'party-chart' },
      { id: 'age-distribution-chart', key: 'age-distribution-chart' },
      { id: 'gender-chart', key: 'gender-chart' },
      { id: 'age-demographics-chart', key: 'age-demographics-chart' }
    ];

    // Get Chart.js instances from canvas elements
    chartElements.forEach(({ id, key }) => {
      const canvas = document.getElementById(id);
      if (canvas) {
        const chart = Chart.getChart(canvas);
        if (chart) {
          chartInstances.set(key, chart);
        }
      }
    });

    updateProgress(40, 'Building document structure...');

    // Build document content
    const content = [];

    // Title section
    content.push(...buildTitleSection({
      electionCode: electionCode || analyticsData.lastElection?.election?.electionCode,
      generatedDate: new Date()
    }));

    // Overview section
    if (analyticsData.dashboard?.totals) {
      content.push(...buildOverviewSection(analyticsData.dashboard.totals));
    }

    updateProgress(50, 'Adding election data...');

    // Last Election section
    if (analyticsData.lastElection) {
      content.push(...await buildLastElectionSection(
        analyticsData.lastElection,
        chartInstances
      ));
    }

    updateProgress(60, 'Adding engagement data...');

    // Engagement section
    if (analyticsData.engagement) {
      content.push(...await buildEngagementSection(
        analyticsData.engagement,
        chartInstances
      ));
    }

    updateProgress(70, 'Adding party data...');

    // Party section
    if (analyticsData.party) {
      content.push(...await buildPartySection(
        analyticsData.party,
        chartInstances
      ));
    }

    updateProgress(75, 'Adding demographics...');

    // Non-voter section
    if (analyticsData.nonVoterPrecinct) {
      content.push(...buildNonVoterSection(analyticsData.nonVoterPrecinct));
    }

    // Demographics section
    if (analyticsData.demographics) {
      content.push(...await buildDemographicsSection(
        analyticsData.demographics,
        chartInstances
      ));
    }

    updateProgress(80, 'Generating PDF...');

    // Build complete document definition
    const docDefinition = {
      info: {
        title: 'Voter Analytics Report',
        author: 'Voter Platform',
        subject: `Analytics Report${electionCode ? ` - ${electionCode}` : ''}`,
        keywords: 'voter, analytics, report, statistics',
        creator: 'Voter Platform',
        producer: 'PDFMake'
      },
      
      pageSize: 'LETTER',
      pageOrientation: 'portrait',
      pageMargins: [40, 70, 40, 60],
      
      header: buildHeader,
      footer: buildFooter,
      
      content: content,
      
      styles: styles,
      
      defaultStyle: {
        font: 'Roboto',
        fontSize: 10,
        color: COLORS.gray[700]
      },
      
      compress: true
    };

    updateProgress(90, 'Finalizing...');

    // Generate filename
    const pdfFilename = filename || generateFilename(
      'analytics_report',
      electionCode || ''
    );

    // Create and download PDF
    const pdfDocGenerator = pdfMake.createPdf(docDefinition);
    
    // Set a fallback timeout in case download callback doesn't fire
    const fallbackTimeout = setTimeout(() => {
      hideProgressModal();
      showSuccessNotification(pdfFilename);
    }, 2000);
    
    pdfDocGenerator.download(pdfFilename, () => {
      clearTimeout(fallbackTimeout);
      updateProgress(100, 'Complete!');
      setTimeout(() => {
        hideProgressModal();
        showSuccessNotification(pdfFilename);
      }, 500);
    });

    return true;

  } catch (error) {
    console.error('Failed to generate analytics report:', error);
    hideProgressModal();
    showErrorNotification(error.message || 'Failed to generate PDF');
    throw error;
  }
}

/**
 * Export a single section as PNG image (retained for compatibility)
 * 
 * @param {string} sectionId - DOM element ID
 * @param {string} sectionName - Section name for filename
 * @returns {Promise<boolean>}
 */
export async function exportSectionAsPNG(sectionId, sectionName = 'section') {
  try {
    const element = document.getElementById(sectionId) || document.querySelector(`[data-section="${sectionId}"]`);
    if (!element) {
      throw new Error(`Section not found: ${sectionId}`);
    }

    // Use html2canvas for section exports (not affected by OKLCH issues in charts)
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(element, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false
    });

    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = generateFilename(sectionName.replace(/\s+/g, '_').toLowerCase(), '').replace('.pdf', '.png');
    link.click();

    showSuccessNotification(`${sectionName} exported as PNG`);
    return true;
  } catch (error) {
    console.error('Failed to export section as PNG:', error);
    showErrorNotification(error.message || 'Failed to export section');
    throw error;
  }
}

/**
 * Export a Chart.js instance as PNG image (retained for compatibility)
 * 
 * @param {Chart} chartInstance - Chart.js instance
 * @param {string} chartName - Chart name for filename
 * @returns {Promise<boolean>}
 */
export async function exportChartAsPNG(chartInstance, chartName = 'chart') {
  try {
    if (!chartInstance || !chartInstance.canvas) {
      throw new Error('Invalid chart instance');
    }

    const dataUrl = chartInstance.canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = generateFilename(chartName.replace(/\s+/g, '_').toLowerCase(), '').replace('.pdf', '.png');
    link.click();

    showSuccessNotification(`${chartName} exported as PNG`);
    return true;
  } catch (error) {
    console.error('Failed to export chart as PNG:', error);
    showErrorNotification(error.message || 'Failed to export chart');
    throw error;
  }
}
