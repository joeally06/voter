/**
 * CSV export utilities for analytics data
 * Converts analytics data to CSV format with proper encoding
 */

/**
 * Convert array of objects to CSV string
 * @param {Array} data - Array of objects to convert
 * @param {Array} columns - Column definitions [{key, header}]
 * @returns {string} CSV formatted string
 */
export function toCSV(data, columns) {
  if (!Array.isArray(data) || data.length === 0) {
    return '';
  }

  // Build header row
  const headers = columns.map(col => col.header || col.key);
  let csv = headers.map(escapeCSVField).join(',') + '\n';

  // Build data rows
  data.forEach(row => {
    const values = columns.map(col => {
      const value = row[col.key];
      return escapeCSVField(value);
    });
    csv += values.join(',') + '\n';
  });

  return csv;
}

/**
 * Escape a field for CSV output
 * @param {*} value - Value to escape
 * @returns {string} Escaped value
 */
function escapeCSVField(value) {
  if (value === null || value === undefined) {
    return '';
  }

  // Convert to string
  let strValue = String(value);

  // If contains comma, quote, or newline, wrap in quotes and escape internal quotes
  if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n') || strValue.includes('\r')) {
    strValue = '"' + strValue.replace(/"/g, '""') + '"';
  }

  return strValue;
}

/**
 * Generate a filename with timestamp
 * @param {string} prefix - Filename prefix
 * @param {string} suffix - Optional suffix
 * @returns {string} Formatted filename
 */
function generateFilename(prefix, suffix = '') {
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  const suffixPart = suffix ? `_${suffix}` : '';
  return `${prefix}${suffixPart}_${dateStr}.csv`;
}

/**
 * Trigger browser download of CSV data
 * @param {string} csvContent - CSV formatted string
 * @param {string} filename - Filename for download
 */
export function downloadCSV(csvContent, filename) {
  // Add UTF-8 BOM for Excel compatibility
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export engagement levels data as CSV
 * @param {Object} data - Engagement data
 * @returns {string} CSV content
 */
export function exportEngagementCSV(data) {
  const levels = data.levels || data.data || [];
  if (!Array.isArray(levels) || levels.length === 0) {
    return '';
  }

  const metadata = `Engagement Levels Report\nGenerated: ${new Date().toLocaleString()}\n\n`;
  
  const columns = [
    { key: 'label', header: 'Engagement Level' },
    { key: 'count', header: 'Count' },
    { key: 'pct', header: 'Percentage' }
  ];

  const csvData = levels.map(item => ({
    label: item.label || item.level,
    count: item.count || 0,
    pct: ((item.pct || item.percentage || 0).toFixed(2)) + '%'
  }));

  return metadata + toCSV(csvData, columns);
}

/**
 * Export party affiliation data as CSV
 * @param {Object} data - Party affiliation data
 * @returns {string} CSV content
 */
export function exportPartyAffiliationCSV(data) {
  const parties = data.distribution || data.parties || [];
  if (!Array.isArray(parties) || parties.length === 0) {
    return '';
  }

  const metadata = `Party Affiliation Report\nGenerated: ${new Date().toLocaleString()}\n\n`;
  
  const columns = [
    { key: 'party', header: 'Party' },
    { key: 'count', header: 'Count' },
    { key: 'percentage', header: 'Percentage' }
  ];

  const csvData = parties.map(item => ({
    party: item.party || item.name,
    count: item.count || 0,
    percentage: ((item.percentage || 0).toFixed(2)) + '%'
  }));

  return metadata + toCSV(csvData, columns);
}

/**
 * Export demographics data as CSV
 * @param {Object} data - Demographics data
 * @returns {string} CSV content
 */
export function exportDemographicsCSV(data) {
  const cities = data.byCity || data.distribution || data.cities || [];
  if (!Array.isArray(cities) || cities.length === 0) {
    return '';
  }

  const metadata = `Voter Distribution by City\nGenerated: ${new Date().toLocaleString()}\n\n`;
  
  const columns = [
    { key: 'city', header: 'City' },
    { key: 'totalVoters', header: 'Total Voters' },
    { key: 'percentage', header: 'Percentage' }
  ];

  const csvData = cities.map(item => ({
    city: item.city || item.name,
    totalVoters: item.totalVoters || item.count || 0,
    percentage: ((item.percentage || 0).toFixed(2)) + '%'
  }));

  return metadata + toCSV(csvData, columns);
}

/**
 * Export last election breakdown data as CSV
 * @param {Object} data - Last election data
 * @returns {string} CSV content
 */
export function exportLastElectionCSV(data) {
  const election = data.election;
  if (!election) {
    return '';
  }

  const metadata = `Last Election Breakdown\nElection Code: ${election.electionCode}\nGenerated: ${new Date().toLocaleString()}\n\n`;
  
  // Export summary
  let csv = metadata;
  csv += 'Summary\n';
  csv += 'Metric,Value\n';
  csv += `Total Voted,${election.totalVoted || 0}\n`;
  csv += `Total Registered,${election.totalRegistered || 0}\n`;
  csv += `Turnout Rate,${(election.turnoutRate || 0).toFixed(2)}%\n`;
  csv += `Early Voted,${election.earlyVoted || 0}\n`;
  csv += `Early Vote Rate,${(election.earlyVoteRate || 0).toFixed(2)}%\n`;
  csv += `Election Day Voted,${election.electionDayVoted || 0}\n`;
  csv += '\n';

  // Export age breakdown
  if (data.ageBreakdown && Array.isArray(data.ageBreakdown)) {
    csv += 'Age Distribution\n';
    csv += 'Age Group,Count,Percentage\n';
    data.ageBreakdown.forEach(age => {
      csv += `${age.ageGroup},${age.count},${(age.percentage || 0).toFixed(2)}%\n`;
    });
    csv += '\n';
  }

  // Export precinct breakdown
  if (data.precinctBreakdown && Array.isArray(data.precinctBreakdown)) {
    csv += 'Precinct Turnout\n';
    csv += 'Precinct,Voted,Registered,Turnout Rate,Early Vote Rate,Democrats,Republicans\n';
    data.precinctBreakdown.forEach(p => {
      csv += `${p.precinctNumber},${p.voted},${p.registered},${(p.turnoutRate || 0).toFixed(2)}%,${(p.earlyVoteRate || 0).toFixed(2)}%,${p.partyBreakdown?.democrat || 0},${p.partyBreakdown?.republican || 0}\n`;
    });
  }

  return csv;
}

/**
 * Export non-voters by precinct data as CSV
 * @param {Object} data - Non-voter precinct data
 * @returns {string} CSV content
 */
export function exportNonVoterPrecinctCSV(data) {
  const precincts = data.precincts || data.data || [];
  if (!Array.isArray(precincts) || precincts.length === 0) {
    return '';
  }

  const metadata = `Non-Voters by Precinct\nGenerated: ${new Date().toLocaleString()}\n\n`;
  
  const columns = [
    { key: 'precinctNumber', header: 'Precinct' },
    { key: 'neverVotedCount', header: 'Non-Voters' },
    { key: 'totalVoters', header: 'Total Voters' },
    { key: 'neverVotedPercentage', header: 'Non-Voter Rate' },
    { key: 'severity', header: 'Severity' }
  ];

  const csvData = precincts.map(item => ({
    precinctNumber: item.precinctNumber || item.precinct,
    neverVotedCount: item.neverVotedCount || item.nonVoters || 0,
    totalVoters: item.totalVoters || item.total || 0,
    neverVotedPercentage: ((item.neverVotedPercentage || item.rate || 0).toFixed(2)) + '%',
    severity: item.severity || item.level || 'unknown'
  }));

  return metadata + toCSV(csvData, columns);
}

/**
 * Export all analytics data as a single CSV with multiple sections
 * @param {Object} analyticsData - Complete analytics data object
 * @returns {string} CSV content
 */
export function exportAllAnalyticsCSV(analyticsData) {
  let csv = `Voter Analytics - Complete Report\nGenerated: ${new Date().toLocaleString()}\n\n`;

  // Dashboard overview
  if (analyticsData.dashboard) {
    const totals = analyticsData.dashboard.totals || analyticsData.dashboard;
    csv += '=== OVERVIEW ===\n';
    csv += 'Metric,Value\n';
    csv += `Total Voters,${totals.voters || totals.totalVoters || 0}\n`;
    csv += `Super Voters,${totals.superVoters || totals.super_voters || 0}\n`;
    csv += `Precincts,${totals.precincts || totals.totalPrecincts || 0}\n`;
    csv += `Geocoded,${totals.geocoded || totals.geocoded_voters || 0}\n`;
    csv += '\n\n';
  }

  // Engagement levels
  if (analyticsData.engagement) {
    csv += '=== ENGAGEMENT LEVELS ===\n';
    csv += exportEngagementCSV(analyticsData.engagement);
    csv += '\n\n';
  }

  // Party affiliation
  if (analyticsData.party) {
    csv += '=== PARTY AFFILIATION ===\n';
    csv += exportPartyAffiliationCSV(analyticsData.party);
    csv += '\n\n';
  }

  // Demographics
  if (analyticsData.demographics) {
    csv += '=== DEMOGRAPHICS ===\n';
    csv += exportDemographicsCSV(analyticsData.demographics);
    csv += '\n\n';
  }

  // Non-voters by precinct
  if (analyticsData.nonVoterPrecinct) {
    csv += '=== NON-VOTERS BY PRECINCT ===\n';
    csv += exportNonVoterPrecinctCSV(analyticsData.nonVoterPrecinct);
    csv += '\n\n';
  }

  // Last election
  if (analyticsData.lastElection) {
    csv += '=== LAST ELECTION BREAKDOWN ===\n';
    csv += exportLastElectionCSV(analyticsData.lastElection);
  }

  return csv;
}

/**
 * Main export handler for CSV exports
 * @param {string} section - Section name to export
 * @param {Object} data - Data for that section
 */
export function exportSectionCSV(section, data) {
  let csvContent = '';
  let filename = '';

  switch (section) {
    case 'engagement':
      csvContent = exportEngagementCSV(data);
      filename = generateFilename('analytics_engagement');
      break;
    case 'party':
      csvContent = exportPartyAffiliationCSV(data);
      filename = generateFilename('analytics_party_affiliation');
      break;
    case 'demographics':
      csvContent = exportDemographicsCSV(data);
      filename = generateFilename('analytics_demographics');
      break;
    case 'lastElection':
      csvContent = exportLastElectionCSV(data);
      filename = generateFilename('analytics_last_election', data.election?.electionCode || '');
      break;
    case 'nonVoterPrecinct':
      csvContent = exportNonVoterPrecinctCSV(data);
      filename = generateFilename('analytics_non_voters_by_precinct');
      break;
    case 'all':
      csvContent = exportAllAnalyticsCSV(data);
      filename = generateFilename('analytics_complete_report');
      break;
    default:
      console.error('Unknown section:', section);
      return;
  }

  if (csvContent) {
    downloadCSV(csvContent, filename);
  }
}
