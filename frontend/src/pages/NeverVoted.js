/**
 * Never Voted page - voters with zero election participation
 */
import { fetchNeverVoted, exportNeverVotedCsv } from '../api/client.js';
import { sectionHeading, spinner, errorBox, buildTable, pagination, emptyState, fmt, escapeHtml, debounce } from '../components/ui.js';
import { showToast } from '../main.js';

let state = {
  filters: { limit: 50, offset: 0, sort: 'lastName', order: 'asc' },
  data: [],
  total: 0,
};

export async function renderNeverVoted(container) {
  container.innerHTML = `
    ${sectionHeading('Never Voted', 'Voters with no election participation — outreach targets')}

    <!-- Filters -->
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <input id="nv-search" type="text" placeholder="Search by name..."
          class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none" />

        <input id="nv-precinct" type="text" placeholder="Precinct(s) e.g. 01,02"
          class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none" />

        <input id="nv-city" type="text" placeholder="City"
          class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none" />

        <div class="flex gap-2">
          <input id="nv-age-min" type="number" placeholder="Min age" min="18" max="120" value="18"
            class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none" />
          <input id="nv-age-max" type="number" placeholder="Max age" min="18" max="120" value="120"
            class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none" />
        </div>

        <button id="nv-export" class="flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          Export CSV
        </button>
      </div>
    </div>

    <div id="nv-results">${spinner('Loading...')}</div>
    <div id="nv-pagination"></div>
  `;

  const els = {
    search:   container.querySelector('#nv-search'),
    precinct: container.querySelector('#nv-precinct'),
    city:     container.querySelector('#nv-city'),
    ageMin:   container.querySelector('#nv-age-min'),
    ageMax:   container.querySelector('#nv-age-max'),
  };

  const reload = debounce(() => {
    state.filters.offset  = 0;
    state.filters.search  = els.search.value || undefined;
    state.filters.precinct = els.precinct.value || undefined;
    state.filters.city    = els.city.value || undefined;
    state.filters.ageMin  = els.ageMin.value || undefined;
    state.filters.ageMax  = els.ageMax.value || undefined;
    loadData(container);
  }, 350);

  Object.values(els).forEach(el => el.addEventListener('input', reload));

  container.querySelector('#nv-export').addEventListener('click', async () => {
    try {
      showToast('Generating CSV export...', 'info');
      const csv = await exportNeverVotedCsv(state.filters);
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'never-voted-export.csv';
      a.click();
      URL.revokeObjectURL(a.href);
      showToast('CSV exported successfully', 'success');
    } catch (err) {
      showToast('Export failed: ' + err.message, 'error');
    }
  });

  loadData(container);
}

async function loadData(container) {
  const results = container.querySelector('#nv-results');
  const paginationEl = container.querySelector('#nv-pagination');
  results.innerHTML = spinner();
  paginationEl.innerHTML = '';

  try {
    const res = await fetchNeverVoted(state.filters);
    state.data  = res.data || [];
    state.total = res.pagination?.total || res.total || 0;

    const columns = [
      { label: 'Name',     render: r => `${escapeHtml(r.last_name || r.lastName)}, ${escapeHtml(r.first_name || r.firstName)}` },
      { label: 'Age',      render: r => r.age || '—' },
      { label: 'Address',  render: r => escapeHtml(r.address || '—') },
      { label: 'City',     render: r => escapeHtml(r.city || '—') },
      { label: 'Precinct', render: r => escapeHtml(r.precinct_number || r.precinct || '—') },
    ];

    results.innerHTML = state.data.length > 0
      ? buildTable(columns, state.data)
      : emptyState('No never-voted voters match filters');

    if (state.total > state.filters.limit) {
      paginationEl.appendChild(pagination(state.total, state.filters.limit, state.filters.offset, (o) => {
        state.filters.offset = o;
        loadData(container);
      }));
    }
  } catch (err) {
    results.innerHTML = errorBox(err.message);
  }
}
