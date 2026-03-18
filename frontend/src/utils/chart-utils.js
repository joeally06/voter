/**
 * Chart utilities for Chart.js
 * Provides centralized chart configuration and rendering for analytics
 */
import {
  Chart,
  BarController,
  PieController,
  DoughnutController,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Title
} from 'chart.js';

// Register Chart.js components
// Note: Chart.js v3+ requires explicit registration of controllers, scales, elements, and plugins
// This is required for tree-shaking and modular architecture
Chart.register(
  BarController,
  PieController,
  DoughnutController,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Title
);

// Tailwind color palette for charts
const colors = {
  primary: '#3b82f6',    // blue-500
  success: '#10b981',    // green-500
  warning: '#f59e0b',    // amber-500
  danger: '#ef4444',     // red-500
  purple: '#a855f7',     // purple-500
  teal: '#14b8a6',       // teal-500
  indigo: '#6366f1',     // indigo-500
  pink: '#ec4899',       // pink-500
  gray: '#6b7280',       // gray-500
  democrat: '#2563eb',   // blue-600
  republican: '#dc2626', // red-600
  independent: '#9333ea', // purple-600
  other: '#64748b',      // slate-500
};

// Default chart options matching Tailwind theme
const defaultOptions = {
  responsive: true,
  maintainAspectRatio: true,
  plugins: {
    legend: {
      display: true,
      position: 'top',
      labels: {
        padding: 15,
        font: {
          family: 'system-ui, -apple-system, sans-serif',
          size: 12
        },
        usePointStyle: true,
        pointStyle: 'circle',
      }
    },
    tooltip: {
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      padding: 12,
      cornerRadius: 6,
      titleFont: {
        size: 13,
        weight: 'bold'
      },
      bodyFont: {
        size: 12
      },
      displayColors: true,
      boxPadding: 6,
    }
  }
};

/**
 * Create a Chart.js instance with default styling
 * @param {HTMLCanvasElement} canvas - Canvas element to render the chart
 * @param {string} type - Chart type (bar, pie, doughnut, line, etc.)
 * @param {Object} data - Chart data object
 * @param {Object} options - Additional chart options
 * @returns {Chart} Chart.js instance
 */
export function createChart(canvas, type, data, options = {}) {
  if (!canvas) {
    console.error('Chart creation failed: canvas element is null');
    return null;
  }

  // Merge default options with custom options
  const mergedOptions = {
    ...defaultOptions,
    ...options,
    plugins: {
      ...defaultOptions.plugins,
      ...(options.plugins || {})
    }
  };

  try {
    const chart = new Chart(canvas, {
      type,
      data,
      options: mergedOptions
    });
    return chart;
  } catch (error) {
    console.error('Failed to create chart:', error);
    return null;
  }
}

/**
 * Convert a chart to a base64 image for PDF embedding
 * @param {Chart} chartInstance - Chart.js instance
 * @param {number} width - Desired width in pixels (default: canvas width)
 * @param {number} height - Desired height in pixels (default: canvas height)
 * @returns {string} Base64 encoded PNG image
 */
export function chartToImage(chartInstance, width = null, height = null) {
  if (!chartInstance || !chartInstance.canvas) {
    console.error('Invalid chart instance');
    return null;
  }

  try {
    // Get the canvas and its context
    const canvas = chartInstance.canvas;
    
    // If custom dimensions specified, create a new canvas
    if (width && height && (width !== canvas.width || height !== canvas.height)) {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = width;
      tempCanvas.height = height;
      const ctx = tempCanvas.getContext('2d');
      
      // Draw the original canvas onto the temp canvas
      ctx.drawImage(canvas, 0, 0, width, height);
      return tempCanvas.toDataURL('image/png');
    }
    
    // Return original canvas as data URL
    return canvas.toDataURL('image/png');
  } catch (error) {
    console.error('Failed to convert chart to image:', error);
    return null;
  }
}

/**
 * Destroy a chart instance to prevent memory leaks
 * @param {Chart} chartInstance - Chart.js instance to destroy
 */
export function destroyChart(chartInstance) {
  if (chartInstance && typeof chartInstance.destroy === 'function') {
    try {
      chartInstance.destroy();
    } catch (error) {
      console.warn('Error destroying chart:', error);
    }
  }
}

/**
 * Pre-configured chart configurations for common chart types
 */
export const chartConfigs = {
  /**
   * Create a bar chart configuration
   * @param {Array} labels - X-axis labels
   * @param {Array} datasets - Array of dataset objects
   * @param {Object} options - Additional options
   * @returns {Object} Chart configuration object
   */
  barChart(labels, datasets, options = {}) {
    return {
      labels,
      datasets: datasets.map((dataset, idx) => ({
        backgroundColor: dataset.backgroundColor || colors.primary,
        borderColor: dataset.borderColor || colors.primary,
        borderWidth: 1,
        borderRadius: 4,
        ...dataset
      })),
      ...options
    };
  },

  /**
   * Create a pie chart configuration
   * @param {Array} labels - Slice labels
   * @param {Array} data - Slice values
   * @param {Array} backgroundColors - Optional custom colors
   * @param {Object} options - Additional options
   * @returns {Object} Chart configuration object
   */
  pieChart(labels, data, backgroundColors = null, options = {}) {
    const defaultColors = [
      colors.primary,
      colors.success,
      colors.warning,
      colors.danger,
      colors.purple,
      colors.teal,
      colors.indigo,
      colors.pink
    ];

    return {
      labels,
      datasets: [{
        data,
        backgroundColor: backgroundColors || defaultColors.slice(0, labels.length),
        borderColor: '#ffffff',
        borderWidth: 2,
      }],
      ...options
    };
  },

  /**
   * Create a horizontal bar chart configuration
   * @param {Array} labels - Y-axis labels
   * @param {Array} data - Bar values
   * @param {string} backgroundColor - Bar color
   * @param {Object} options - Additional options
   * @returns {Object} Chart configuration object
   */
  horizontalBarChart(labels, data, backgroundColor = null, options = {}) {
    return {
      labels,
      datasets: [{
        label: options.label || 'Value',
        data,
        backgroundColor: backgroundColor || colors.primary,
        borderColor: backgroundColor || colors.primary,
        borderWidth: 1,
        borderRadius: 4,
      }],
      ...options
    };
  },

  /**
   * Create a doughnut chart configuration
   * @param {Array} labels - Slice labels
   * @param {Array} data - Slice values
   * @param {Array} backgroundColors - Optional custom colors
   * @param {Object} options - Additional options
   * @returns {Object} Chart configuration object
   */
  doughnutChart(labels, data, backgroundColors = null, options = {}) {
    const config = this.pieChart(labels, data, backgroundColors, options);
    return {
      ...config,
      cutout: '60%', // Creates the doughnut hole
    };
  },

  /**
   * Create engagement levels chart (specifically for engagement data)
   * @param {Array} levels - Engagement level data [{label, count, percentage}]
   * @returns {Object} Chart configuration object
   */
  engagementChart(levels) {
    return this.doughnutChart(
      levels.map(l => l.label),
      levels.map(l => l.count),
      [colors.danger, colors.warning, colors.success] // red, amber, green
    );
  },

  /**
   * Create party affiliation chart (specifically for party data)
   * @param {Array} parties - Party data [{party, count}]
   * @returns {Object} Chart configuration object
   */
  partyChart(parties) {
    const colorMap = {
      'D': colors.democrat,
      'R': colors.republican,
      'I': colors.independent,
      'Independent': colors.independent,
      'Other': colors.other,
    };

    return this.pieChart(
      parties.map(p => p.party || p.name),
      parties.map(p => p.count),
      parties.map(p => colorMap[p.party || p.name] || colors.gray)
    );
  },

  /**
   * Create age distribution chart (specifically for age breakdown data)
   * @param {Array} ageGroups - Age group data [{ageGroup, count}]
   * @returns {Object} Chart configuration object
   */
  ageDistributionChart(ageGroups) {
    const colorPalette = [
      colors.primary,
      colors.success,
      colors.warning,
      colors.danger,
      colors.purple,
      colors.teal,
      colors.indigo,
      colors.pink
    ];
    
    return this.pieChart(
      ageGroups.map(a => a.ageGroup),
      ageGroups.map(a => a.count),
      colorPalette.slice(0, ageGroups.length)
    );
  },

  /**
   * Create demographics chart (specifically for city/geographic data)
   * @param {Array} cities - City data [{city, totalVoters}]
   * @returns {Object} Chart configuration object
   */
  demographicsChart(cities) {
    const colorPalette = [
      colors.primary,
      colors.success,
      colors.warning,
      colors.danger,
      colors.purple,
      colors.teal,
      colors.indigo,
      colors.pink,
      colors.gray,
      '#f97316', // orange-500
      '#06b6d4', // cyan-500
      '#8b5cf6'  // violet-500
    ];
    
    return this.pieChart(
      cities.map(c => c.city || c.name),
      cities.map(c => c.totalVoters || c.count),
      colorPalette.slice(0, cities.length)
    );
  },

  /**
   * Create election comparison chart (grouped bar chart)
   * @param {Object} electionData - Map of election codes to breakdown data
   * @param {Array} selectedElections - Array of election codes to display
   * @returns {Object} Chart configuration object
   */
  electionComparisonChart(electionData, selectedElections) {
    const labels = selectedElections;
    const registeredData = selectedElections.map(code => 
      electionData[code]?.election?.totalRegistered || 0
    );
    const votedData = selectedElections.map(code => 
      electionData[code]?.election?.totalVoted || 0
    );

    return this.barChart(
      labels,
      [
        {
          label: 'Total Registered',
          data: registeredData,
          backgroundColor: colors.gray,
          borderColor: colors.gray
        },
        {
          label: 'Total Voted',
          data: votedData,
          backgroundColor: colors.primary,
          borderColor: colors.primary
        }
      ]
    );
  }
};

/**
 * Chart color utilities
 */
export { colors };
