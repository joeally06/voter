/**
 * Voters page - searchable, filterable, paginated voter list
 */
import { fetchVoters, searchVoters, fetchVoter } from '../api/client.js';
import { sectionHeading, spinner, errorBox, buildTable, pagination, emptyState, fmt, escapeHtml, debounce } from '../components/ui.js';

let state = {
  filters: { limit: 50, offset: 0, sort: 'last_name', order: 'asc' },
  data: [],
  total: 0,
};

export async function renderVoters(container) {
  container.innerHTML = `
    ${sectionHeading('Voter Directory', 'Search, filter, and view voter records')}

    <!-- Filters -->
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <input id="v-search" type="text" placeholder="Search by name..."
          class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />

        <input id="v-precinct" type="text" placeholder="Precinct #"
          class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />

        <select id="v-super" class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none">
          <option value="">All Voters</option>
          <option value="true">Super Voters Only</option>
          <option value="false">Non-Super Voters</option>
        </select>

        <select id="v-party" class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none">
          <option value="">All Parties</option>
          <option value="R">Republican</option>
          <option value="D">Democrat</option>
        </select>
      </div>
    </div>

    <!-- Results -->
    <div id="v-results">${spinner('Loading voters...')}</div>
    <div id="v-pagination"></div>

    <!-- Detail Modal -->
    <div id="v-modal" class="fixed inset-0 z-50 hidden bg-black/50 flex items-center justify-center p-4">
      <div class="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6">
        <div class="flex justify-between items-center mb-4">
          <h3 class="font-bold text-lg">Voter Detail</h3>
          <button id="v-modal-close" class="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div id="v-modal-body"></div>
      </div>
    </div>
  `;

  // Wire up filters
  const searchInput    = container.querySelector('#v-search');
  const precinctInput  = container.querySelector('#v-precinct');
  const superSelect    = container.querySelector('#v-super');
  const partySelect    = container.querySelector('#v-party');

  const reload = debounce(() => {
    state.filters.offset = 0;
    state.filters.name = searchInput.value || undefined;
    state.filters.precinct = precinctInput.value || undefined;
    state.filters.super_voter = superSelect.value || undefined;
    state.filters.party = partySelect.value || undefined;
    loadVoters(container);
  }, 350);

  searchInput.addEventListener('input', reload);
  precinctInput.addEventListener('input', reload);
  superSelect.addEventListener('change', reload);
  partySelect.addEventListener('change', reload);

  // Modal
  const modal     = container.querySelector('#v-modal');
  const modalBody = container.querySelector('#v-modal-body');
  container.querySelector('#v-modal-close').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

  container.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-voter-id]');
    if (!row) return;
    const id = row.dataset.voterId;
    modal.classList.remove('hidden');
    modalBody.innerHTML = spinner('Loading...');
    try {
      const voter = await fetchVoter(id);
      const v = voter.data || voter;
      modalBody.innerHTML = `
        <div class="space-y-3 text-sm">
          <div class="grid grid-cols-2 gap-3">
            <div><span class="text-gray-500">Name</span><p class="font-medium">${escapeHtml(v.first_name)} ${escapeHtml(v.last_name)}</p></div>
            <div><span class="text-gray-500">Voter ID</span><p class="font-medium">${escapeHtml(v.voter_id)}</p></div>
            <div><span class="text-gray-500">Address</span><p class="font-medium">${escapeHtml(v.address)}</p></div>
            <div><span class="text-gray-500">City</span><p class="font-medium">${escapeHtml(v.city)}</p></div>
            <div><span class="text-gray-500">ZIP</span><p class="font-medium">${escapeHtml(v.zip_code)}</p></div>
            <div><span class="text-gray-500">Precinct</span><p class="font-medium">${escapeHtml(v.precinct_number)}</p></div>
            <div><span class="text-gray-500">Super Voter</span><p class="font-medium">${v.super_voter ? '✅ Yes' : 'No'}</p></div>
            ${v.date_of_birth ? `<div><span class="text-gray-500">DOB</span><p class="font-medium">${escapeHtml(v.date_of_birth)}</p></div>` : ''}
            ${v.age ? `<div><span class="text-gray-500">Age</span><p class="font-medium">${v.age}</p></div>` : ''}
          </div>
        </div>
      `;
    } catch (err) {
      modalBody.innerHTML = errorBox(err.message);
    }
  });

  loadVoters(container);
}

async function loadVoters(container) {
  const results = container.querySelector('#v-results');
  const paginationEl = container.querySelector('#v-pagination');
  results.innerHTML = spinner('Loading voters...');
  paginationEl.innerHTML = '';

  try {
    const res = await fetchVoters(state.filters);
    state.data  = res.data || [];
    state.total = res.total || 0;

    const columns = [
      { label: 'Name',     key: 'last_name', render: r => `<span class="cursor-pointer text-primary-600 hover:underline font-medium" data-voter-id="${r.id}">${escapeHtml(r.last_name)}, ${escapeHtml(r.first_name)}</span>` },
      { label: 'Address',  key: 'address', render: r => escapeHtml(r.address || '—') },
      { label: 'City',     key: 'city',    render: r => escapeHtml(r.city || '—') },
      { label: 'ZIP',      key: 'zip_code' },
      { label: 'Precinct', key: 'precinct_number' },
      { label: 'Super',    key: 'super_voter', render: r => r.super_voter ? '<span class="text-green-600 font-bold">★</span>' : '—' },
    ];

    results.innerHTML = state.data.length > 0
      ? buildTable(columns, state.data)
      : emptyState('No voters match your filters');

    if (state.total > state.filters.limit) {
      const pagEl = pagination(state.total, state.filters.limit, state.filters.offset, (newOffset) => {
        state.filters.offset = newOffset;
        loadVoters(container);
      });
      paginationEl.appendChild(pagEl);
    }
  } catch (err) {
    results.innerHTML = errorBox(err.message);
  }
}
