/**
 * Analytics page - voter statistics, turnout, demographics
 */
import { fetchDashboard, fetchEngagement, fetchPartyAffil, fetchNonVoterPrecinct, fetchDemographics, fetchLastElectionBreakdown, fetchElectionCodes } from '../api/client.js';
import { sectionHeading, spinner, errorBox, statCard, fmt, pct, escapeHtml } from '../components/ui.js';
import { createChart, destroyChart, chartConfigs, colors } from '../utils/chart-utils.js';
import { generateAnalyticsReportPDF, exportSectionAsPNG, exportChartAsPNG } from '../utils/pdfmake-generator.js';
import { exportSectionCSV, exportAllAnalyticsCSV, downloadCSV } from '../utils/csv-export.js';

// Store chart instances for cleanup and export
const chartInstances = new Map();

/**
 * Validates that a percentage value is in reasonable range (0-100)
 * @param {number} value - The percentage value to validate
 * @param {string} context - Description for logging purposes
 * @returns {number} - The capped value
 */
function validatePercentage(value, context = '') {
  if (typeof value !== 'number' || isNaN(value)) {
    if (context) console.warn(`Analytics: Invalid percentage value "${value}" at ${context}, defaulting to 0`);
    return 0;
  }
  
  if (value < 0) {
    if (context) console.warn(`Analytics: Negative percentage ${value} at ${context}, capping to 0`);
    return 0;
  }
  
  if (value > 100) {
    if (context) console.warn(`Analytics: Percentage ${value} exceeds 100% at ${context}, capping to 100`);
    return 100;
  }
  
  return value;
}

export async function renderAnalytics(container) {
  // Cleanup existing charts before re-rendering
  chartInstances.forEach(chart => destroyChart(chart));
  chartInstances.clear();

  container.innerHTML = sectionHeading('Analytics', 'Voter statistics and insights') + spinner('Loading analytics data...');

  try {
    // First, get election codes to fetch multiple election breakdowns
    const codesResult = await fetchElectionCodes();
    const codes = codesResult?.data || codesResult || [];

    // Fetch breakdown for first 5 elections (or fewer if not available)
    const electionCodesToFetch = codes.slice(0, 5);
    const electionBreakdownPromises = electionCodesToFetch.map(code =>
      fetchLastElectionBreakdown({ electionCode: code })
    );

    // Fetch all data in parallel
    const [dashboard, engagement, party, nonVoterPct, demographics, lastElection, ...electionBreakdowns] = await Promise.allSettled([
      fetchDashboard(),
      fetchEngagement(),
      fetchPartyAffil(),
      fetchNonVoterPrecinct(),
      fetchDemographics(),
      fetchLastElectionBreakdown(), // Default to most recent
      ...electionBreakdownPromises
    ]);

    const dash = dashboard.status === 'fulfilled' ? (dashboard.value.data || dashboard.value) : null;
    const eng  = engagement.status === 'fulfilled' ? (engagement.value.data || engagement.value) : null;
    const pty  = party.status === 'fulfilled' ? (party.value.data || party.value) : null;
    const nvp  = nonVoterPct.status === 'fulfilled' ? (nonVoterPct.value.data || nonVoterPct.value) : null;
    const demo = demographics.status === 'fulfilled' ? (demographics.value.data || demographics.value) : null;
    const leb  = lastElection.status === 'fulfilled' ? (lastElection.value.data || lastElection.value) : null;

    // Map election breakdowns to object for easy access
    const electionData = {};
    electionBreakdowns.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        const data = result.value?.data || result.value;
        if (data?.election?.electionCode) {
          electionData[data.election.electionCode] = data;
        }
      }
    });

    const totals = dash?.totals || dash || {};
    const totalVoters = totals.voters || totals.totalVoters || totals.total_voters || 0;

    // Store analytics data for export
    const analyticsData = {
      dashboard: dash,
      engagement: eng,
      party: pty,
      nonVoterPrecinct: nvp,
      demographics: demo,
      lastElection: leb,
      electionCodes: codes,
      electionData: electionData
    };

    container.innerHTML = `
      ${sectionHeading('Analytics', 'Voter statistics and insights')}

      <!-- Export Options Bar -->
      ${renderExportBar()}

      <!-- Main Analytics Content Container -->
      <div id="analytics-content">
        <!-- Overview Cards -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          ${statCard('Total Voters', fmt(totalVoters), '', 'primary')}
          ${statCard('Super Voters', fmt(totals.superVoters || totals.super_voters || 0), '', 'success')}
          ${statCard('Precincts', fmt(totals.precincts || totals.totalPrecincts || totals.total_precincts || 0), '', 'warning')}
          ${statCard('Geocoded', fmt(totals.geocoded || totals.geocoded_voters || 0), '', 'gray')}
        </div>

      <!-- Last Election Breakdown -->
      <div id="last-election-section">
        ${leb ? renderLastElectionBreakdown(leb, codes) : ''}
      </div>

      <!-- Election Comparison Chart -->
      <div id="election-comparison-section">
        ${electionData && Object.keys(electionData).length >= 2 
          ? renderElectionComparisonChart(electionData, ['E_1', 'E_2']) 
          : ''}
      </div>

      <!-- Engagement Levels -->
      ${eng ? renderEngagement(eng) : ''}

      <!-- Party Affiliation -->
      ${pty ? renderParty(pty) : ''}

      <!-- Non-Voter Precinct Analysis -->
      ${nvp ? renderNonVoterPrecincts(nvp) : ''}

        <!-- Demographics -->
        ${demo ? renderDemographics(demo) : ''}
      </div>
    `;

    // Initialize all charts after DOM is ready
    setTimeout(() => {
      initializeCharts(analyticsData);
      attachExportHandlers(container, analyticsData);
    }, 100);

    // Event delegation for election code dropdown — survives re-renders
    const onElectionChange = async (e) => {
      if (e.target.id !== 'election-code-select') return;

      const selectedCode = e.target.value;
      const sectionEl = container.querySelector('#last-election-section');
      if (!sectionEl) return;

      sectionEl.innerHTML = `<div class="flex items-center justify-center py-12 text-gray-400">${spinner('Loading election data...')}</div>`;

      try {
        const res = await fetchLastElectionBreakdown({ electionCode: selectedCode });
        const newData = res.data || res;
        sectionEl.innerHTML = renderLastElectionBreakdown(newData, codes);
        // Re-initialize charts for the updated election data
        setTimeout(() => {
          initializeLastElectionCharts(newData);
        }, 100);
      } catch (err) {
        sectionEl.innerHTML = `<div class="text-red-500 p-4">Failed to load election data: ${escapeHtml(err.message)}</div>`;
      }
    };
    container.addEventListener('change', onElectionChange);

    // Event delegation for election comparison multi-select
    const onElectionComparisonChange = async (e) => {
      if (e.target.id !== 'election-comparison-select') return;

      const selectedOptions = Array.from(e.target.selectedOptions);
      const selectedElections = selectedOptions.map(opt => opt.value);

      // Need at least 2 elections
      if (selectedElections.length < 2) {
        console.warn('Select at least 2 elections to compare');
        return;
      }

      const sectionEl = container.querySelector('#comparison-section');
      if (!sectionEl) return;

      // Show loading state
      sectionEl.innerHTML = `<div class="flex items-center justify-center py-12 text-gray-400">${spinner('Loading comparison data...')}</div>`;

      try {
        // Fetch data for any newly selected elections not already loaded
        const missingElections = selectedElections.filter(code => !electionData[code]);
        if (missingElections.length > 0) {
          const fetchPromises = missingElections.map(code =>
            fetchLastElectionBreakdown({ electionCode: code })
          );
          const results = await Promise.allSettled(fetchPromises);
          
          results.forEach((result, idx) => {
            if (result.status === 'fulfilled') {
              const data = result.value?.data || result.value;
              if (data?.election?.electionCode) {
                electionData[data.election.electionCode] = data;
              }
            }
          });
        }

        // Re-render section
        sectionEl.outerHTML = renderElectionComparisonChart(electionData, selectedElections);
        
        // Re-initialize chart
        setTimeout(() => {
          // Destroy old chart if exists
          const oldChart = chartInstances.get('election-comparison');
          if (oldChart) destroyChart(oldChart);
          
          // Create new chart
          initializeElectionComparisonChart(electionData, selectedElections);
        }, 100);
        
      } catch (err) {
        sectionEl.innerHTML = `<div class="text-red-500 p-4">Failed to load comparison data: ${escapeHtml(err.message)}</div>`;
      }
    };
    container.addEventListener('change', onElectionComparisonChange);

    // Return cleanup function so the router can remove the listener on navigation
    return () => {
      container.removeEventListener('change', onElectionChange);
      container.removeEventListener('change', onElectionComparisonChange);
      // Cleanup charts on navigation
      chartInstances.forEach(chart => destroyChart(chart));
      chartInstances.clear();
    };
  } catch (err) {
    container.innerHTML = sectionHeading('Analytics') + errorBox(err.message);
  }
}

// ── Last Election Breakdown ────────────────────────────────────────

/**
 * Render the election comparison chart section
 * @param {Object} electionData - Map of election codes to breakdown data
 * @param {Array} selectedElections - Array of election codes to display (default: E_1 and E_2)
 * @returns {string} HTML string for the election comparison section
 */
function renderElectionComparisonChart(electionData, selectedElections = ['E_1', 'E_2']) {
  // Validate we have data for at least 2 elections
  const validElections = selectedElections.filter(code => electionData[code]);
  if (validElections.length < 2) {
    return ''; // Don't render if insufficient data
  }

  // Calculate summary statistics
  const turnoutRates = validElections.map(code => 
    electionData[code].election.turnoutRate || 0
  );
  const avgTurnout = turnoutRates.reduce((sum, rate) => sum + rate, 0) / turnoutRates.length;
  const maxTurnout = Math.max(...turnoutRates);
  const minTurnout = Math.min(...turnoutRates);
  const maxElection = validElections[turnoutRates.indexOf(maxTurnout)];
  const minElection = validElections[turnoutRates.indexOf(minTurnout)];

  // Create multi-select options for all available elections
  const allElections = Object.keys(electionData).sort();
  const electionOptions = allElections.map(code => `
    <option value="${escapeHtml(code)}" ${selectedElections.includes(code) ? 'selected' : ''}>
      ${escapeHtml(code)}
    </option>
  `).join('');

  return `
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6" id="comparison-section">
      <div class="flex items-center justify-between mb-1">
        <h3 class="font-semibold text-gray-900 dark:text-white">Election Turnout Comparison</h3>
        <select id="election-comparison-select" multiple
                class="text-sm bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600
                       text-gray-900 dark:text-gray-100 rounded-lg px-3 py-1.5 focus:ring-2
                       focus:ring-primary-500 focus:border-primary-500 cursor-pointer"
                style="min-width: 120px;">
          ${electionOptions}
        </select>
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Comparing: ${validElections.join(', ')}
      </p>

      <!-- Summary Stats Row -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        ${statCard('Avg Turnout', pct(avgTurnout), 'across elections', 'primary')}
        ${statCard('Highest', pct(maxTurnout), escapeHtml(maxElection), 'success')}
        ${statCard('Lowest', pct(minTurnout), escapeHtml(minElection), 'warning')}
        ${statCard('Elections', validElections.length.toString(), 'compared', 'gray')}
      </div>

      <!-- Chart -->
      <div class="mb-4">
        <canvas id="election-comparison-chart" width="400" height="300"></canvas>
      </div>
    </div>
  `;
}

function renderLastElectionBreakdown(data, electionCodes = []) {
  const election = data.election;
  if (!election) return '';

  const currentCode = election.electionCode;

  const dropdown = electionCodes.length > 0 ? `
    <select id="election-code-select"
            class="ml-auto text-sm bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600
                   text-gray-900 dark:text-gray-100 rounded-lg px-3 py-1.5 focus:ring-2
                   focus:ring-primary-500 focus:border-primary-500 cursor-pointer">
      ${electionCodes.map(code =>
        `<option value="${escapeHtml(code)}" ${code === currentCode ? 'selected' : ''}>${escapeHtml(code)}</option>`
      ).join('')}
    </select>` : '';

  return `
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
      <div class="flex items-center justify-between mb-1">
        <h3 class="font-semibold text-gray-900 dark:text-white">Last Election Breakdown</h3>
        ${dropdown}
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-4">Election: ${escapeHtml(currentCode)}</p>

      <!-- Summary Stats Row -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        ${statCard('Voted', fmt(election.totalVoted), pct(election.turnoutRate) + ' turnout', 'primary')}
        ${statCard('Registered', fmt(election.totalRegistered), '', 'gray')}
        ${statCard('Early Voted', fmt(election.earlyVoted), pct(election.earlyVoteRate), 'success')}
        ${statCard('Election Day', fmt(election.electionDayVoted), '', 'warning')}
      </div>

      <!-- Summary Highlights -->
      ${renderSummaryHighlights(data.summary)}

      <!-- Age Distribution -->
      ${renderAgeBreakdown(data.ageBreakdown)}

      <!-- Precinct Breakdown -->
      ${renderPrecinctTurnout(data.precinctBreakdown)}
    </div>`;
}

function renderSummaryHighlights(summary) {
  if (!summary) return '';

  const badges = [];
  if (summary.highestTurnoutPrecinct) {
    badges.push(`
      <div class="flex items-center gap-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-lg px-3 py-2">
        <span class="text-xs font-semibold uppercase tracking-wider opacity-70">Highest Turnout</span>
        <span class="text-sm font-bold">Precinct ${escapeHtml(summary.highestTurnoutPrecinct)}</span>
      </div>`);
  }
  if (summary.lowestTurnoutPrecinct) {
    badges.push(`
      <div class="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg px-3 py-2">
        <span class="text-xs font-semibold uppercase tracking-wider opacity-70">Lowest Turnout</span>
        <span class="text-sm font-bold">Precinct ${escapeHtml(summary.lowestTurnoutPrecinct)}</span>
      </div>`);
  }
  if (summary.largestAgeGroup) {
    badges.push(`
      <div class="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg px-3 py-2">
        <span class="text-xs font-semibold uppercase tracking-wider opacity-70">Largest Age Group</span>
        <span class="text-sm font-bold">${escapeHtml(summary.largestAgeGroup)}</span>
      </div>`);
  }
  if (summary.medianAgeGroup) {
    badges.push(`
      <div class="flex items-center gap-2 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 rounded-lg px-3 py-2">
        <span class="text-xs font-semibold uppercase tracking-wider opacity-70">Median Age Group</span>
        <span class="text-sm font-bold">${escapeHtml(summary.medianAgeGroup)}</span>
      </div>`);
  }

  if (badges.length === 0) return '';

  return `
    <div class="mb-6">
      <h4 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Key Highlights</h4>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        ${badges.join('')}
      </div>
    </div>`;
}

function renderAgeBreakdown(ageData) {
  if (!Array.isArray(ageData) || ageData.length === 0) return '';

  // Division by zero protection: Calculate maxCount to normalize bar widths
  // If all counts are 0, maxCount will be 0 and we'll render 0% width bars
  const maxCount = Math.max(...ageData.map(a => a.count));

  return `
    <div class="mb-6">
      <h4 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Voters by Age Group</h4>
      <div class="mb-4 flex justify-center">
        <div style="max-width: 350px; width: 100%;">
          <canvas id="age-distribution-chart" width="400" height="250"></canvas>
        </div>
      </div>
      <div class="space-y-2">
        ${ageData.map(a => {
          // Calculate bar width as percentage of max, cap at 100% to prevent overflow
          const barWidth = maxCount > 0 ? Math.min((a.count / maxCount * 100), 100) : 0;
          return `
            <div class="flex items-center gap-3">
              <span class="text-xs font-medium w-16 text-gray-600 dark:text-gray-400">${escapeHtml(a.ageGroup)}</span>
              <div class="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                <div class="bg-primary-500 h-3 rounded-full transition-all" style="width: ${barWidth}%"></div>
              </div>
              <span class="text-xs text-gray-500 w-24 text-right">${fmt(a.count)} (${pct(a.percentage)})</span>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderPrecinctTurnout(precinctData) {
  if (!Array.isArray(precinctData) || precinctData.length === 0) return '';

  return `
    <div>
      <h4 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Turnout by Precinct</h4>
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
            <tr>
              <th class="px-4 py-3 text-left font-semibold">Precinct</th>
              <th class="px-4 py-3 text-left font-semibold">Voted</th>
              <th class="px-4 py-3 text-left font-semibold">Registered</th>
              <th class="px-4 py-3 text-left font-semibold">Turnout</th>
              <th class="px-4 py-3 text-left font-semibold">Early %</th>
              <th class="px-4 py-3 text-left font-semibold">D</th>
              <th class="px-4 py-3 text-left font-semibold">R</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            ${precinctData.map(p => {
              const turnoutColor = p.turnoutRate >= 70 ? 'text-green-600' 
                : p.turnoutRate >= 50 ? 'text-amber-600' 
                : 'text-red-600';
              return `
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td class="px-4 py-3 font-medium">${escapeHtml(p.precinctNumber)}</td>
                  <td class="px-4 py-3">${fmt(p.voted)}</td>
                  <td class="px-4 py-3">${fmt(p.registered)}</td>
                  <td class="px-4 py-3 font-semibold ${turnoutColor}">${pct(p.turnoutRate)}</td>
                  <td class="px-4 py-3">${pct(p.earlyVoteRate)}</td>
                  <td class="px-4 py-3 text-blue-600">${fmt(p.partyBreakdown.democrat)}</td>
                  <td class="px-4 py-3 text-red-600">${fmt(p.partyBreakdown.republican)}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderEngagement(data) {
  // data can have various shapes — handle both
  const levels = data.levels || data.data || data;

  // Validate we have actual data, not just an empty object
  // This prevents displaying misleading "0 voters (0%)" when no data is available
  if (!levels || (typeof levels === 'object' && !Array.isArray(levels) && Object.keys(levels).length === 0)) {
    return '';
  }

  const items = Array.isArray(levels) ? levels : [
    { label: 'Never Voted', count: data.neverVoted || 0, pct: data.percentages?.neverVoted || 0 },
    { label: 'Occasional (1-3)', count: data.occasionalVoters || 0, pct: data.percentages?.occasionalVoters || 0 },
    { label: 'Super Voters (4+)', count: data.superVoters || 0, pct: data.percentages?.superVoters || 0 },
  ];
  
  // Additional validation: if all counts are 0, hide the section to avoid confusion
  const hasAnyData = items.some(item => (item.count || 0) > 0);
  if (!hasAnyData) {
    return '';
  }

  return `
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6" id="engagement-section">
      <h3 class="font-semibold text-gray-900 dark:text-white mb-4">Engagement Levels</h3>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <canvas id="engagement-chart" width="400" height="300"></canvas>
        </div>
        <div class="space-y-4">
        ${items.map(item => {
          const label = item.label || item.level || item.name || '—';
          const count = item.count || item.total || 0;
          const percent = validatePercentage(item.pct || item.percentage || 0, 'engagement level');
          const color = label.toLowerCase().includes('never') ? 'bg-red-500'
            : label.toLowerCase().includes('super') ? 'bg-green-500'
            : 'bg-amber-500';
          return `
            <div>
              <div class="flex justify-between text-sm mb-1">
                <span class="font-medium">${escapeHtml(label)}</span>
                <span class="text-gray-500">${fmt(count)} (${pct(percent)})</span>
              </div>
              <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                <div class="${color} h-2.5 rounded-full" style="width: ${percent}%"></div>
              </div>
            </div>`;
        }).join('')}
        </div>
      </div>
    </div>`;
}

function renderParty(data) {
  let parties = data.distribution || data.parties || [];

  // Backend may return currentDistribution as named-keys object - convert to array
  if (!Array.isArray(parties) && data.currentDistribution) {
    const dist = data.currentDistribution;
    const pcts = data.percentages || {};
    
    // Calculate total for fallback percentage calculation
    const total = Object.values(dist).reduce((sum, c) => sum + (c || 0), 0);
    
    parties = Object.entries(dist).map(([key, count]) => {
      let percentage = pcts[key];
      
      // If percentage is missing or zero but we have a count, calculate it from the total
      // This ensures accurate display even when backend doesn't provide percentages
      if ((percentage === undefined || percentage === null || percentage === 0) && count > 0 && total > 0) {
        percentage = (count / total * 100);
        console.warn(`Analytics: Calculated missing percentage for party '${key}': ${percentage.toFixed(1)}%`);
      }
      
      return {
        party: key === 'democrat' ? 'D' : key === 'republican' ? 'R' : key.charAt(0).toUpperCase(),
        count: count,
        percentage: percentage || 0,
      };
    });
  }

  if (!Array.isArray(parties) || parties.length === 0) return '';

  return `
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6" id="party-section">
      <h3 class="font-semibold text-gray-900 dark:text-white mb-4">Party Affiliation</h3>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <canvas id="party-chart" width="400" height="300"></canvas>
        </div>
        <div class="grid grid-cols-2 gap-3">
        ${parties.map(p => {
          const name = p.party || p.name || p.code || '?';
          const count = p.count || p.total || 0;
          const percent = validatePercentage(p.percentage || p.pct || 0, `party ${name}`);
          const colors = {
            'R': 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300',
            'D': 'bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300',
          };
          const color = colors[name] || 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300';
          return `
            <div class="rounded-xl p-4 ${color}">
              <p class="text-xs font-semibold uppercase tracking-wider opacity-70">${escapeHtml(name)}</p>
              <p class="text-2xl font-bold mt-1">${fmt(count)}</p>
              <p class="text-xs opacity-60">${pct(percent)}</p>
            </div>`;
        }).join('')}
        </div>
      </div>
    </div>`;
}

function renderNonVoterPrecincts(data) {
  const precincts = data.precincts || data.data || data;
  if (!Array.isArray(precincts) || precincts.length === 0) return '';

  return `
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
      <h3 class="font-semibold text-gray-900 dark:text-white mb-4">Non-Voters by Precinct</h3>
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
            <tr>
              <th class="px-4 py-3 text-left font-semibold">Precinct</th>
              <th class="px-4 py-3 text-left font-semibold">Non-Voters</th>
              <th class="px-4 py-3 text-left font-semibold">Total</th>
              <th class="px-4 py-3 text-left font-semibold">Rate</th>
              <th class="px-4 py-3 text-left font-semibold">Severity</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            ${precincts.map(p => {
              const severity = p.severity || p.level || '—';
              const sevColor = severity === 'critical' ? 'text-red-600 bg-red-50 dark:bg-red-900/20'
                : severity === 'high' ? 'text-orange-600 bg-orange-50 dark:bg-orange-900/20'
                : severity === 'medium' ? 'text-amber-600 bg-amber-50 dark:bg-amber-900/20'
                : 'text-green-600 bg-green-50 dark:bg-green-900/20';
              return `
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td class="px-4 py-3 font-medium">${escapeHtml(p.precinctNumber || p.precinct_number || p.precinct || '')}</td>
                  <td class="px-4 py-3">${fmt(p.neverVotedCount || p.non_voters || p.nonVoters || 0)}</td>
                  <td class="px-4 py-3">${fmt(p.totalVoters || p.total_voters || p.total || 0)}</td>
                  <td class="px-4 py-3">${pct(p.neverVotedPercentage || p.non_voter_rate || p.rate || 0)}</td>
                  <td class="px-4 py-3"><span class="text-xs font-medium px-2 py-0.5 rounded-full ${sevColor}">${severity}</span></td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderDemographics(data) {
  const items = data.byCity || data.distribution || data.data || data.cities || [];
  if (!Array.isArray(items) || items.length === 0) return '';

  return `
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6" id="demographics-section">
      <h3 class="font-semibold text-gray-900 dark:text-white mb-4">Voter Distribution by City</h3>
      <div class="mb-4 flex justify-center">
        <div style="max-width: 350px; width: 100%;">
          <canvas id="demographics-chart" width="400" height="300"></canvas>
        </div>
      </div>
      <div class="space-y-3">
        ${items.slice(0, 12).map(item => {
          const name = item.city || item.name || item.group || '—';
          const count = item.totalVoters || item.voter_count || item.count || item.total || 0;
          const percent = validatePercentage(item.percentage || item.pct || 0, 'city demographics');
          return `
            <div class="flex items-center gap-3">
              <span class="text-sm font-medium w-32 truncate">${escapeHtml(name)}</span>
              <div class="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div class="bg-primary-500 h-2 rounded-full" style="width: ${percent}%"></div>
              </div>
              <span class="text-xs text-gray-500 w-20 text-right">${fmt(count)}</span>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

// ── Export UI Components ────────────────────────────────────────

/**
 * Render the export options bar
 */
function renderExportBar() {
  return `
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6">
      <div class="flex flex-wrap items-center gap-3">
        <button id="export-full-pdf" class="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-colors" title="Exports the selected election data">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          Export Election Report (PDF)
        </button>
        <button id="export-charts-only" class="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Export Charts Only
        </button>
        <button id="export-data-csv" class="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export Data (CSV)
        </button>
        <div class="ml-auto flex items-center gap-2">
          <span class="text-sm text-gray-600 dark:text-gray-400">Quality:</span>
          <select id="export-quality" class="text-sm bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-primary-500">
            <option value="standard">Standard</option>
            <option value="high" selected>High</option>
            <option value="print">Print (300 DPI)</option>
          </select>
        </div>
      </div>
    </div>
  `;
}

// ── Chart Initialization ────────────────────────────────────────

/**
 * Initialize all charts in the analytics page
 */
function initializeCharts(analyticsData) {
  // Initialize engagement chart
  if (analyticsData.engagement) {
    initializeEngagementChart(analyticsData.engagement);
  }

  // Initialize party affiliation chart
  if (analyticsData.party) {
    initializePartyChart(analyticsData.party);
  }

  // Initialize demographics chart
  if (analyticsData.demographics) {
    initializeDemographicsChart(analyticsData.demographics);
  }

  // Initialize last election charts
  if (analyticsData.lastElection) {
    initializeLastElectionCharts(analyticsData.lastElection);
  }

  // Initialize election comparison chart
  if (analyticsData.electionData && Object.keys(analyticsData.electionData).length >= 2) {
    initializeElectionComparisonChart(analyticsData.electionData, ['E_1', 'E_2']);
  }
}

/**
 * Initialize engagement levels chart
 */
function initializeEngagementChart(data) {
  const canvas = document.getElementById('engagement-chart');
  if (!canvas) return;

  const levels = data.levels || data.data || [];
  if (!Array.isArray(levels) || levels.length === 0) return;

  const chartData = chartConfigs.engagementChart(levels);
  const chart = createChart(canvas, 'doughnut', chartData);
  if (chart) {
    chartInstances.set('engagement', chart);
  }
}

/**
 * Initialize party affiliation chart
 */
function initializePartyChart(data) {
  const canvas = document.getElementById('party-chart');
  if (!canvas) return;

  let parties = data.distribution || data.parties || [];
  
  // Handle object-based distribution
  if (!Array.isArray(parties) && data.currentDistribution) {
    const dist = data.currentDistribution;
    parties = Object.entries(dist).map(([key, count]) => ({
      party: key === 'democrat' ? 'D' : key === 'republican' ? 'R' : key.charAt(0).toUpperCase(),
      name: key,
      count: count || 0
    }));
  }

  if (!Array.isArray(parties) || parties.length === 0) return;

  const chartData = chartConfigs.partyChart(parties);
  const chart = createChart(canvas, 'pie', chartData);
  if (chart) {
    chartInstances.set('party', chart);
  }
}

/**
 * Initialize demographics chart
 */
function initializeDemographicsChart(data) {
  const canvas = document.getElementById('demographics-chart');
  if (!canvas) return;

  const cities = (data.byCity || data.cities || []).slice(0, 12);
  if (!Array.isArray(cities) || cities.length === 0) return;

  const chartData = chartConfigs.demographicsChart(cities);
  const options = {
    plugins: {
      legend: {
        display: true,
        position: 'right'
      }
    }
  };

  const chart = createChart(canvas, 'pie', chartData, options);
  if (chart) {
    chartInstances.set('demographics', chart);
  }
}

/**
 * Initialize age distribution chart for last election
 */
function initializeLastElectionCharts(data) {
  const canvas = document.getElementById('age-distribution-chart');
  if (!canvas) return;

  const ageData = data.ageBreakdown;
  if (!Array.isArray(ageData) || ageData.length === 0) return;

  const chartData = chartConfigs.ageDistributionChart(ageData);
  const options = {
    plugins: {
      legend: {
        display: true,
        position: 'right'
      }
    }
  };

  const chart = createChart(canvas, 'pie', chartData, options);
  if (chart) {
    chartInstances.set('age-distribution', chart);
  }
}

/**
 * Initialize election comparison chart (grouped bar chart)
 * @param {Object} electionData - Map of election codes to breakdown data
 * @param {Array} selectedElections - Array of election codes to display
 */
function initializeElectionComparisonChart(electionData, selectedElections) {
  const canvas = document.getElementById('election-comparison-chart');
  if (!canvas) return;

  // Extract data for selected elections
  const labels = selectedElections;
  const registeredData = selectedElections.map(code => 
    electionData[code]?.election?.totalRegistered || 0
  );
  const votedData = selectedElections.map(code => 
    electionData[code]?.election?.totalVoted || 0
  );

  // Create chart data using barChart config
  const chartData = chartConfigs.barChart(
    labels,
    [
      {
        label: 'Total Registered',
        data: registeredData,
        backgroundColor: colors.gray,
        borderColor: colors.gray,
        borderWidth: 1,
        borderRadius: 4
      },
      {
        label: 'Total Voted',
        data: votedData,
        backgroundColor: colors.primary,
        borderColor: colors.primary,
        borderWidth: 1,
        borderRadius: 4
      }
    ]
  );

  // Chart options
  const options = {
    responsive: true,
    maintainAspectRatio: true,
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: function(value) {
            return fmt(value); // Use formatting utility
          }
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.05)'
        }
      },
      x: {
        grid: {
          display: false
        }
      }
    },
    plugins: {
      legend: {
        display: true,
        position: 'top'
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            return `${context.dataset.label}: ${fmt(context.parsed.y)}`;
          }
        }
      }
    }
  };

  const chart = createChart(canvas, 'bar', chartData, options);
  if (chart) {
    chartInstances.set('election-comparison', chart);
  }
}

// ── Export Event Handlers ────────────────────────────────────────

/**
 * Attach export handlers to buttons
 */
function attachExportHandlers(container, analyticsData) {
  // Full PDF export
  const exportFullBtn = container.querySelector('#export-full-pdf');
  if (exportFullBtn) {
    exportFullBtn.addEventListener('click', async () => {
      try {
        const quality = container.querySelector('#export-quality')?.value || 'high';
        
        // Get currently selected election code from the dropdown
        const electionSelect = container.querySelector('#election-code-select');
        const selectedElectionCode = electionSelect?.value;
        
        // If an election is selected, export only that election's data
        if (selectedElectionCode) {
          // Fetch fresh data for the selected election
          const selectedElectionData = await fetchLastElectionBreakdown({ electionCode: selectedElectionCode });
          const electionDataForExport = selectedElectionData.data || selectedElectionData;
          
          // Create export data with only the selected election
          const exportData = {
            dashboard: analyticsData.dashboard,
            lastElection: electionDataForExport,
            electionCodes: analyticsData.electionCodes,
            // Don't include other sections for election-specific export
            engagement: null,
            party: null,
            nonVoterPrecinct: null,
            demographics: null
          };
          
          await generateAnalyticsReportPDF(exportData, { 
            quality,
            electionCode: selectedElectionCode 
          });
        } else {
          // No election selected, export all data
          await generateAnalyticsReportPDF(analyticsData, { quality });
        }
      } catch (error) {
        console.error('Failed to export full report:', error);
      }
    });
  }

  // Charts only export (simplified PDF with just charts)
  const exportChartsBtn = container.querySelector('#export-charts-only');
  if (exportChartsBtn) {
    exportChartsBtn.addEventListener('click', async () => {
      try {
        // Export each chart as PNG
        for (const [name, chart] of chartInstances) {
          await exportChartAsPNG(chart, name);
        }
      } catch (error) {
        console.error('Failed to export charts:', error);
      }
    });
  }

  // CSV export
  const exportCsvBtn = container.querySelector('#export-data-csv');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      try {
        exportSectionCSV('all', analyticsData);
      } catch (error) {
        console.error('Failed to export CSV:', error);
      }
    });
  }
}
