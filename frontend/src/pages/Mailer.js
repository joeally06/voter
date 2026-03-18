/**
 * Mailer page - Generate physical mailing labels and CSV mail merge files
 *
 * Provides filter controls (precinct, party, super_voter, city, zip_code),
 * a live voter count, a 10-row preview table, and two export buttons:
 *   - PDF Avery 5160 mailing labels (generated client-side via pdfmake)
 *   - CSV mail merge file (generated server-side)
 */

import { fetchMailerCount, fetchMailerVoters, exportMailerCsv } from '../api/client.js';
import { sectionHeading, spinner, errorBox, buildTable, emptyState, fmt, escapeHtml, debounce } from '../components/ui.js';
import { showToast } from '../main.js';
import { generateMailingLabelsPDF } from '../utils/mailer-pdf.js';

// Module-level state — reset on each renderMailer() call
let state = {
    filters: {
        precinct:    undefined,
        party:       undefined,
        super_voter: undefined,
        city:        undefined,
        zip_code:    undefined,
        limit:       5000,
    },
    count:       0,
    previewData: [],
    loading:     false,
};

// ============================================================================
// PUBLIC RENDER FUNCTION
// ============================================================================

export async function renderMailer(container) {
    // Reset state on each page mount
    state = {
        filters: {
            precinct:    undefined,
            party:       undefined,
            super_voter: undefined,
            city:        undefined,
            zip_code:    undefined,
            limit:       5000,
        },
        count:       0,
        previewData: [],
        loading:     false,
    };

    container.innerHTML = `
        ${sectionHeading('Mailing Labels', 'Export voter addresses for physical mail outreach — Avery 5160 compatible')}

        <!-- Filter Panel -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6">
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <input id="m-precinct" type="text" placeholder="Precinct #" maxlength="3"
                    class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500" />

                <select id="m-party"
                    class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none text-gray-900 dark:text-gray-100">
                    <option value="">All Parties</option>
                    <option value="R">Republican</option>
                    <option value="D">Democrat</option>
                </select>

                <select id="m-super"
                    class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none text-gray-900 dark:text-gray-100">
                    <option value="">All Voters</option>
                    <option value="true">Super Voters Only</option>
                    <option value="false">Non-Super Voters</option>
                </select>

                <input id="m-city" type="text" placeholder="City" maxlength="100"
                    class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500" />

                <input id="m-zip" type="text" placeholder="ZIP Code" maxlength="10"
                    class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500" />

                <input id="m-limit" type="number" placeholder="Max labels (default 5000)" min="1" max="5000" value="5000"
                    class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500" />
            </div>
        </div>

        <!-- Count Bar -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-5 py-4 mb-6">
            <div id="m-count" class="text-sm text-gray-600 dark:text-gray-400">${spinner('Calculating...')}</div>
        </div>

        <!-- Export Buttons -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Export Options</h3>
            <div class="flex flex-wrap gap-3">
                <button id="m-export-pdf" disabled
                    title="No voters match current filters"
                    class="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition">
                    <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    Download PDF Labels
                </button>

                <button id="m-export-csv" disabled
                    title="No voters match current filters"
                    class="flex items-center gap-2 bg-success-600 hover:bg-success-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition">
                    <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                    </svg>
                    Download CSV Mail Merge
                </button>
            </div>
        </div>

        <!-- Preview Table -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Preview (first 10 results)</h3>
            <div id="m-preview">${spinner('Loading preview...')}</div>
        </div>
    `;

    // ── Element refs ────────────────────────────────────────────────────────
    const precinctInput = container.querySelector('#m-precinct');
    const partySelect   = container.querySelector('#m-party');
    const superSelect   = container.querySelector('#m-super');
    const cityInput     = container.querySelector('#m-city');
    const zipInput      = container.querySelector('#m-zip');
    const limitInput    = container.querySelector('#m-limit');

    // ── Debounced reload ────────────────────────────────────────────────────
    const reload = debounce(() => {
        state.filters.precinct    = precinctInput.value.trim() || undefined;
        state.filters.party       = partySelect.value || undefined;
        state.filters.super_voter = superSelect.value || undefined;
        state.filters.city        = cityInput.value.trim() || undefined;
        state.filters.zip_code    = zipInput.value.trim() || undefined;
        const limitVal = parseInt(limitInput.value, 10);
        state.filters.limit = (limitVal >= 1 && limitVal <= 5000) ? limitVal : 5000;

        loadCount(container);
        loadPreview(container);
    }, 350);

    precinctInput.addEventListener('input', reload);
    partySelect.addEventListener('change', reload);
    superSelect.addEventListener('change', reload);
    cityInput.addEventListener('input', reload);
    zipInput.addEventListener('input', reload);
    limitInput.addEventListener('input', reload);

    // ── PDF Export ──────────────────────────────────────────────────────────
    container.querySelector('#m-export-pdf').addEventListener('click', async () => {
        const btn = container.querySelector('#m-export-pdf');
        btn.disabled = true;

        showToast('Fetching voter data for PDF…', 'info');

        try {
            const response = await fetchMailerVoters(state.filters);
            const voters = response.data || [];

            if (voters.length === 0) {
                showToast('No voters match current filters', 'warning');
                return;
            }

            if (voters.length > 2000) {
                showToast(
                    `Large export: generating labels for ${fmt(voters.length)} voters. This may take a moment…`,
                    'info'
                );
            } else {
                showToast(`Generating PDF labels for ${fmt(voters.length)} voters…`, 'info');
            }

            await generateMailingLabelsPDF(voters);
            showToast('PDF labels downloaded successfully', 'success');
        } catch (err) {
            showToast('PDF export failed: ' + err.message, 'error');
        } finally {
            btn.disabled = state.count === 0;
        }
    });

    // ── CSV Export ──────────────────────────────────────────────────────────
    container.querySelector('#m-export-csv').addEventListener('click', async () => {
        const btn = container.querySelector('#m-export-csv');
        btn.disabled = true;

        showToast('Generating CSV mail merge file…', 'info');

        try {
            const csvText = await exportMailerCsv(state.filters);
            const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `mailer-export-${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            URL.revokeObjectURL(a.href);
            showToast('CSV mail merge file downloaded', 'success');
        } catch (err) {
            showToast('CSV export failed: ' + err.message, 'error');
        } finally {
            btn.disabled = state.count === 0;
        }
    });

    // ── Initial load ────────────────────────────────────────────────────────
    loadCount(container);
    loadPreview(container);
}

// ============================================================================
// COUNT LOADER
// ============================================================================

async function loadCount(container) {
    const countEl   = container.querySelector('#m-count');
    const pdfBtn    = container.querySelector('#m-export-pdf');
    const csvBtn    = container.querySelector('#m-export-csv');

    countEl.innerHTML = spinner('Calculating…');
    pdfBtn.disabled = true;
    csvBtn.disabled = true;

    try {
        const res = await fetchMailerCount(state.filters);
        state.count = res.count || 0;

        const pages = Math.ceil(state.count / 30);

        countEl.innerHTML = state.count > 0
            ? `<span class="font-semibold text-gray-900 dark:text-gray-100">${fmt(state.count)}</span>
               <span> voters match your filters</span>
               <span class="text-gray-400 dark:text-gray-500"> — ${fmt(pages)} page${pages !== 1 ? 's' : ''} of 30 labels</span>`
            : `<span class="text-gray-500 dark:text-gray-400">No voters match your filters</span>`;

        pdfBtn.disabled = state.count === 0;
        csvBtn.disabled = state.count === 0;

        if (state.count > 0) {
            pdfBtn.title = `Download PDF labels for ${fmt(state.count)} voters`;
            csvBtn.title = `Download CSV mail merge for ${fmt(state.count)} voters`;
        } else {
            pdfBtn.title = 'No voters match current filters';
            csvBtn.title = 'No voters match current filters';
        }
    } catch (err) {
        countEl.innerHTML = `<span class="text-danger-600 dark:text-danger-400">Error loading count: ${escapeHtml(err.message)}</span>`;
        pdfBtn.disabled = true;
        csvBtn.disabled = true;
    }
}

// ============================================================================
// PREVIEW LOADER
// ============================================================================

async function loadPreview(container) {
    const previewEl = container.querySelector('#m-preview');
    previewEl.innerHTML = spinner('Loading preview…');

    try {
        const res = await fetchMailerVoters({ ...state.filters, limit: 10 });
        const rows = res.data || [];

        if (rows.length === 0) {
            previewEl.innerHTML = emptyState('No voters match your filters');
            return;
        }

        const columns = [
            {
                label: 'Name',
                render: r =>
                    `${escapeHtml(r.lastName || '—')}, ${escapeHtml(r.firstName || '')}`,
            },
            { label: 'Address', render: r => escapeHtml(r.address || '—') },
            { label: 'City',    render: r => escapeHtml(r.city    || '—') },
            { label: 'State',   render: r => escapeHtml(r.state   || '—') },
            { label: 'ZIP',     render: r => escapeHtml(r.zipCode || '—') },
        ];

        previewEl.innerHTML = buildTable(columns, rows);
    } catch (err) {
        previewEl.innerHTML = errorBox(err.message);
    }
}
