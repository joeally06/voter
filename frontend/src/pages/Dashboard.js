/**
 * Dashboard page - overview stats from /api/analytics/dashboard
 */
import { fetchDashboard, fetchHealth } from '../api/client.js';
import { statCard, spinner, errorBox, sectionHeading, fmt, pct, buildTable, escapeHtml } from '../components/ui.js';

export async function renderDashboard(container) {
  container.innerHTML = sectionHeading('Dashboard', 'Platform overview and key metrics') + spinner('Loading dashboard...');

  try {
    const [dashRaw, health] = await Promise.all([fetchDashboard(), fetchHealth()]);
    const dash = dashRaw.data || dashRaw;

    const totals = dash.totals || dash;
    const totalVoters    = totals.voters    ?? totals.totalVoters    ?? totals.total_voters ?? 0;
    const superVoters    = totals.superVoters    ?? totals.super_voters ?? 0;
    const totalPrecincts = totals.precincts ?? totals.totalPrecincts ?? totals.total_precincts ?? 0;
    const geocoded       = totals.geocoded       ?? totals.geocoded_voters ?? 0;
    const geocodedPct    = totalVoters > 0 ? ((geocoded / totalVoters) * 100) : 0;

    container.innerHTML = `
      ${sectionHeading('Dashboard', 'Platform overview and key metrics')}

      <!-- Stats Grid -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        ${statCard('Total Voters', fmt(totalVoters), '', 'primary')}
        ${statCard('Super Voters', fmt(superVoters), totalVoters > 0 ? `${pct((superVoters / totalVoters) * 100)} of total` : '', 'success')}
        ${statCard('Precincts', fmt(totalPrecincts), '', 'warning')}
        ${statCard('Geocoded', fmt(geocoded), pct(geocodedPct) + ' coverage', 'gray')}
      </div>

      <!-- Server Health -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 class="font-semibold text-gray-900 dark:text-white mb-4">Server Health</h3>
          <div class="space-y-3 text-sm">
            <div class="flex justify-between">
              <span class="text-gray-500">Status</span>
              <span class="font-medium ${health.status === 'healthy' ? 'text-green-600' : 'text-red-600'}">${health.status}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-500">Uptime</span>
              <span class="font-medium">${formatUptime(health.uptime)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-500">Database</span>
              <span class="font-medium">${health.database ? 'Connected' : 'Disconnected'}</span>
            </div>
          </div>
        </div>

        <!-- Precinct Summary -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 class="font-semibold text-gray-900 dark:text-white mb-4">Precinct Summary</h3>
          ${dash.precinctSummary || dash.precinct_summary
            ? buildPrecinctMini(dash.precinctSummary || dash.precinct_summary)
            : '<p class="text-sm text-gray-400">No precinct data available</p>'
          }
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = sectionHeading('Dashboard') + errorBox(err.message);
  }
}

function buildPrecinctMini(precincts) {
  if (!Array.isArray(precincts) || precincts.length === 0) {
    return '<p class="text-sm text-gray-400">No precinct data</p>';
  }

  const top = precincts.slice(0, 8);
  return `
    <div class="space-y-2">
      ${top.map(p => {
        const name = p.precinct_number || p.precinct || p.name || '?';
        const count = p.voter_count || p.count || p.total || 0;
        return `
          <div class="flex items-center justify-between text-sm">
            <span class="text-gray-600 dark:text-gray-400">Precinct ${escapeHtml(name)}</span>
            <span class="font-medium">${fmt(count)}</span>
          </div>`;
      }).join('')}
      ${precincts.length > 8 ? `<p class="text-xs text-gray-400 mt-2">+ ${precincts.length - 8} more precincts</p>` : ''}
    </div>`;
}

function formatUptime(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
