/**
 * Analytics page - voter statistics, turnout, demographics
 */
import { fetchDashboard, fetchEngagement, fetchPartyAffil, fetchNonVoterPrecinct, fetchDemographics } from '../api/client.js';
import { sectionHeading, spinner, errorBox, statCard, fmt, pct, escapeHtml } from '../components/ui.js';

export async function renderAnalytics(container) {
  container.innerHTML = sectionHeading('Analytics', 'Voter statistics and insights') + spinner('Loading analytics data...');

  try {
    const [dashboard, engagement, party, nonVoterPct, demographics] = await Promise.allSettled([
      fetchDashboard(),
      fetchEngagement(),
      fetchPartyAffil(),
      fetchNonVoterPrecinct(),
      fetchDemographics(),
    ]);

    const dash = dashboard.status === 'fulfilled' ? (dashboard.value.data || dashboard.value) : null;
    const eng  = engagement.status === 'fulfilled' ? (engagement.value.data || engagement.value) : null;
    const pty  = party.status === 'fulfilled' ? (party.value.data || party.value) : null;
    const nvp  = nonVoterPct.status === 'fulfilled' ? (nonVoterPct.value.data || nonVoterPct.value) : null;
    const demo = demographics.status === 'fulfilled' ? (demographics.value.data || demographics.value) : null;

    const totals = dash?.totals || dash || {};
    const totalVoters = totals.voters || totals.totalVoters || totals.total_voters || 0;

    container.innerHTML = `
      ${sectionHeading('Analytics', 'Voter statistics and insights')}

      <!-- Overview Cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        ${statCard('Total Voters', fmt(totalVoters), '', 'primary')}
        ${statCard('Super Voters', fmt(totals.superVoters || totals.super_voters || 0), '', 'success')}
        ${statCard('Precincts', fmt(totals.precincts || totals.totalPrecincts || totals.total_precincts || 0), '', 'warning')}
        ${statCard('Geocoded', fmt(totals.geocoded || totals.geocoded_voters || 0), '', 'gray')}
      </div>

      <!-- Engagement Levels -->
      ${eng ? renderEngagement(eng) : ''}

      <!-- Party Affiliation -->
      ${pty ? renderParty(pty) : ''}

      <!-- Non-Voter Precinct Analysis -->
      ${nvp ? renderNonVoterPrecincts(nvp) : ''}

      <!-- Demographics -->
      ${demo ? renderDemographics(demo) : ''}
    `;
  } catch (err) {
    container.innerHTML = sectionHeading('Analytics') + errorBox(err.message);
  }
}

function renderEngagement(data) {
  // data can have various shapes — handle both
  const levels = data.levels || data.data || data;

  const items = Array.isArray(levels) ? levels : [
    { label: 'Never Voted', count: data.neverVoted || 0, pct: data.percentages?.neverVoted || 0 },
    { label: 'Occasional (1-3)', count: data.occasionalVoters || 0, pct: data.percentages?.occasionalVoters || 0 },
    { label: 'Super Voters (4+)', count: data.superVoters || 0, pct: data.percentages?.superVoters || 0 },
  ];

  return `
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
      <h3 class="font-semibold text-gray-900 dark:text-white mb-4">Engagement Levels</h3>
      <div class="space-y-4">
        ${items.map(item => {
          const label = item.label || item.level || item.name || '—';
          const count = item.count || item.total || 0;
          const percent = item.pct || item.percentage || 0;
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
                <div class="${color} h-2.5 rounded-full" style="width: ${Math.min(percent, 100)}%"></div>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderParty(data) {
  let parties = data.distribution || data.parties || [];

  // Backend may return currentDistribution as named-keys object - convert to array
  if (!Array.isArray(parties) && data.currentDistribution) {
    const dist = data.currentDistribution;
    const pcts = data.percentages || {};
    parties = Object.entries(dist).map(([key, count]) => ({
      party: key === 'democrat' ? 'D' : key === 'republican' ? 'R' : key.charAt(0).toUpperCase(),
      count: count,
      percentage: pcts[key] || 0,
    }));
  }

  if (!Array.isArray(parties) || parties.length === 0) return '';

  return `
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
      <h3 class="font-semibold text-gray-900 dark:text-white mb-4">Party Affiliation</h3>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        ${parties.map(p => {
          const name = p.party || p.name || p.code || '?';
          const count = p.count || p.total || 0;
          const percent = p.percentage || p.pct || 0;
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
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
      <h3 class="font-semibold text-gray-900 dark:text-white mb-4">Voter Distribution by City</h3>
      <div class="space-y-3">
        ${items.slice(0, 12).map(item => {
          const name = item.city || item.name || item.group || '—';
          const count = item.totalVoters || item.voter_count || item.count || item.total || 0;
          const percent = item.percentage || item.pct || 0;
          return `
            <div class="flex items-center gap-3">
              <span class="text-sm font-medium w-32 truncate">${escapeHtml(name)}</span>
              <div class="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div class="bg-primary-500 h-2 rounded-full" style="width: ${Math.min(percent, 100)}%"></div>
              </div>
              <span class="text-xs text-gray-500 w-20 text-right">${fmt(count)}</span>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}
