/**
 * Archive page — Election Cycle Archive Management
 *
 * Allows users to:
 *  - View the current unarchived state (counts of records not yet in any cycle)
 *  - Create a named cycle and roll over current records into it
 *  - Browse past archived cycles
 *  - Export cycle data as a JSON download
 *  - Soft-delete cycles
 */
import {
    sectionHeading, spinner, errorBox, statCard, fmt, escapeHtml
} from '../components/ui.js';
import {
    fetchCycles, createCycle, fetchCycle, rolloverCycle, deleteCycle, fetchCurrentStatus
} from '../api/client.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(status) {
    const map = {
        active:   'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
        archived: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
        deleted:  'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
    };
    return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status] || map.active}">
        ${escapeHtml(status)}
    </span>`;
}

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
    });
}

// ── Render cycles table ───────────────────────────────────────────────────────

function renderCyclesTable(cycles) {
    if (!cycles || cycles.length === 0) {
        return `
            <div class="text-center py-12 text-gray-400 dark:text-gray-500">
                <svg class="mx-auto h-12 w-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                          d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/>
                </svg>
                <p class="text-sm">No archived cycles yet. Archive your first election cycle using the button above.</p>
            </div>`;
    }

    const rows = cycles.map(c => `
        <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
            <td class="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">${escapeHtml(c.name)}</td>
            <td class="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">${fmtDate(c.election_date)}</td>
            <td class="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 capitalize">${escapeHtml(c.cycle_type || 'general')}</td>
            <td class="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">${fmt(c.voters_count)}</td>
            <td class="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">${fmt(c.total_election_records)}</td>
            <td class="px-4 py-3">${statusBadge(c.status)}</td>
            <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-2">
                    ${c.status === 'active' ? `
                        <button data-action="rollover" data-id="${c.id}" data-name="${escapeHtml(c.name)}"
                                class="text-xs px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300 font-medium transition">
                            Rollover
                        </button>` : ''}
                    ${c.status === 'archived' ? `
                        <a href="/api/archive/cycles/${c.id}/export"
                           download
                           class="text-xs px-2.5 py-1 rounded-lg bg-primary-100 text-primary-700 hover:bg-primary-200 dark:bg-primary-900/40 dark:text-primary-300 font-medium transition">
                            Export JSON
                        </a>` : ''}
                    ${c.status !== 'deleted' ? `
                        <button data-action="delete" data-id="${c.id}" data-name="${escapeHtml(c.name)}"
                                class="text-xs px-2.5 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 font-medium transition">
                            Delete
                        </button>` : ''}
                </div>
            </td>
        </tr>`).join('');

    return `
        <div class="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
            <table class="w-full text-left">
                <thead class="bg-gray-50 dark:bg-gray-800 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    <tr>
                        <th class="px-4 py-3 rounded-tl-xl">Cycle Name</th>
                        <th class="px-4 py-3">Election Date</th>
                        <th class="px-4 py-3">Type</th>
                        <th class="px-4 py-3 text-right">Voters</th>
                        <th class="px-4 py-3 text-right">Records</th>
                        <th class="px-4 py-3">Status</th>
                        <th class="px-4 py-3 text-right rounded-tr-xl">Actions</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-900">
                    ${rows}
                </tbody>
            </table>
        </div>`;
}

// ── Multi-step Archive Modal ──────────────────────────────────────────────────

function openArchiveModal(container, onDone) {
    let step = 1;
    let formData = {
        name: '',
        description: '',
        election_date: '',
        cycle_type: 'general',
        notes: ''
    };
    // Pre-fetch current record counts for Step 2 summary
    let currentStatus = null;
    fetchCurrentStatus()
        .then(r => { if (r && r.data) currentStatus = r.data; })
        .catch(() => {});

    function renderModal() {
        // Remove existing modal if any
        const existing = document.getElementById('archive-modal-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'archive-modal-overlay';
        overlay.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';

        overlay.innerHTML = `
            <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg" role="dialog" aria-modal="true">
                <div class="px-6 pt-6 pb-4 border-b border-gray-200 dark:border-gray-700">
                    <div class="flex items-center justify-between">
                        <h3 class="text-lg font-bold text-gray-900 dark:text-white">
                            Archive Election Cycle
                        </h3>
                        <span class="text-xs text-gray-400 dark:text-gray-500">Step ${step} of 3</span>
                    </div>
                    <!-- Step progress -->
                    <div class="flex gap-1 mt-3">
                        ${[1, 2, 3].map(s => `
                            <div class="h-1 flex-1 rounded-full ${s <= step
                                ? 'bg-primary-500'
                                : 'bg-gray-200 dark:bg-gray-700'}"></div>
                        `).join('')}
                    </div>
                </div>
                <div id="modal-body" class="px-6 py-5">
                    ${renderStep()}
                </div>
                <div class="px-6 pb-6 flex items-center justify-between gap-3">
                    ${step > 1
                        ? `<button id="modal-back" class="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition">← Back</button>`
                        : `<button id="modal-cancel" class="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition">Cancel</button>`}
                    <button id="modal-next" class="px-5 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed">
                        ${step === 3 ? 'Archive Now' : 'Next →'}
                    </button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        attachModalEvents(overlay, onDone);
    }

    function renderStep() {
        if (step === 1) {
            return `
                <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Give this election cycle a descriptive name so you can identify it later.
                </p>
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Cycle Name <span class="text-red-500">*</span>
                        </label>
                        <input id="field-name" type="text" maxlength="100"
                               value="${escapeHtml(formData.name)}"
                               placeholder="e.g. 2024 General Election"
                               class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"/>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                        <textarea id="field-description" maxlength="500" rows="2"
                                  placeholder="Optional notes about this election cycle"
                                  class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500">${escapeHtml(formData.description)}</textarea>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Election Date</label>
                            <input id="field-date" type="date"
                                   value="${escapeHtml(formData.election_date)}"
                                   class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"/>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
                            <select id="field-type"
                                    class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                                ${['general', 'primary', 'runoff', 'special', 'other'].map(t =>
                                    `<option value="${t}" ${formData.cycle_type === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`
                                ).join('')}
                            </select>
                        </div>
                    </div>
                </div>`;
        }

        if (step === 2) {
            return `
                <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Review the cycle details before archiving.
                </p>
                <div class="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 space-y-2 text-sm mb-4">
                    <div class="flex justify-between">
                        <span class="text-gray-500 dark:text-gray-400">Cycle Name</span>
                        <span class="font-medium text-gray-900 dark:text-white">${escapeHtml(formData.name)}</span>
                    </div>
                    ${formData.election_date ? `
                    <div class="flex justify-between">
                        <span class="text-gray-500 dark:text-gray-400">Election Date</span>
                        <span class="font-medium text-gray-900 dark:text-white">${fmtDate(formData.election_date)}</span>
                    </div>` : ''}
                    <div class="flex justify-between">
                        <span class="text-gray-500 dark:text-gray-400">Type</span>
                        <span class="font-medium text-gray-900 dark:text-white capitalize">${escapeHtml(formData.cycle_type)}</span>
                    </div>
                    ${formData.description ? `
                    <div class="flex justify-between">
                        <span class="text-gray-500 dark:text-gray-400">Description</span>
                        <span class="font-medium text-gray-900 dark:text-white text-right max-w-xs">${escapeHtml(formData.description)}</span>
                    </div>` : ''}
                </div>
                <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm text-blue-700 dark:text-blue-300 mb-3">
                    <strong>Records to be archived:</strong>
                    <ul class="mt-1 space-y-0.5">
                        <li>• Election history rows: <strong>${currentStatus ? fmt(currentStatus.election_history_count) : '…'}</strong></li>
                        <li>• Saved routes: <strong>${currentStatus ? fmt(currentStatus.saved_routes_count) : '…'}</strong></li>
                        <li>• Import logs: <strong>${currentStatus ? fmt(currentStatus.import_logs_count) : '…'}</strong></li>
                    </ul>
                </div>
                <div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-700 dark:text-amber-300">
                    <strong>What happens next:</strong> All current election history records, saved routes,
                    and import logs will be tagged with this cycle name. The archived data is preserved —
                    nothing is deleted. Future imports will start a fresh current dataset.
                </div>`;
        }

        if (step === 3) {
            return `
                <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Type the cycle name to confirm this irreversible operation.
                </p>
                <p class="text-sm text-gray-700 dark:text-gray-300 mb-3">
                    Archiving: <strong>${escapeHtml(formData.name)}</strong>
                </p>
                <input id="field-confirm" type="text"
                       placeholder="Type: ${escapeHtml(formData.name)}"
                       class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 mb-3"/>
                <p id="confirm-error" class="text-xs text-red-500 hidden">
                    Name does not match. Please type the exact cycle name.
                </p>
                <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
                    ⚠️ This will archive all current (untagged) election history, routes, and import logs.
                    This action cannot be undone via the UI — archived data is preserved but labeled.
                </div>`;
        }

        return '';
    }

    function attachModalEvents(overlay, doneCb) {
        // Cancel / close
        const cancelBtn = overlay.querySelector('#modal-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => overlay.remove());
        }

        // Back
        const backBtn = overlay.querySelector('#modal-back');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                step--;
                renderModal();
            });
        }

        // Next / Submit
        const nextBtn = overlay.querySelector('#modal-next');
        if (nextBtn) {
            nextBtn.addEventListener('click', async () => {
                if (step === 1) {
                    const name = overlay.querySelector('#field-name').value.trim();
                    if (!name) {
                        overlay.querySelector('#field-name').focus();
                        overlay.querySelector('#field-name').classList.add('border-red-500');
                        return;
                    }
                    formData.name = name;
                    formData.description = overlay.querySelector('#field-description').value.trim();
                    formData.election_date = overlay.querySelector('#field-date').value;
                    formData.cycle_type = overlay.querySelector('#field-type').value;
                    step = 2;
                    renderModal();
                } else if (step === 2) {
                    step = 3;
                    renderModal();
                } else if (step === 3) {
                    const confirmInput = overlay.querySelector('#field-confirm');
                    const confirmError = overlay.querySelector('#confirm-error');
                    if (confirmInput.value.trim().toLowerCase() !== formData.name.trim().toLowerCase()) {
                        confirmError.classList.remove('hidden');
                        confirmInput.focus();
                        return;
                    }
                    confirmError.classList.add('hidden');

                    // Show progress state
                    nextBtn.disabled = true;
                    nextBtn.textContent = 'Archiving…';
                    overlay.querySelector('#modal-body').innerHTML = `
                        <div class="flex flex-col items-center py-8 gap-4">
                            <svg class="animate-spin h-8 w-8 text-primary-500" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                            </svg>
                            <p class="text-sm text-gray-600 dark:text-gray-300" id="archive-progress-text">Creating cycle record…</p>
                        </div>`;

                    try {
                        const progressEl = overlay.querySelector('#archive-progress-text');

                        // Step 1: create the cycle record
                        progressEl.textContent = 'Creating cycle record…';
                        const created = await createCycle({
                            name: formData.name,
                            description: formData.description || undefined,
                            election_date: formData.election_date || undefined,
                            cycle_type: formData.cycle_type,
                            notes: formData.notes || undefined
                        });

                        const cycleId = created.data.id;

                        // Step 2: rollover all current records
                        progressEl.textContent = 'Archiving records…';
                        await rolloverCycle(cycleId);

                        overlay.remove();
                        if (doneCb) doneCb({ success: true });
                    } catch (err) {
                        overlay.querySelector('#modal-body').innerHTML = `
                            <div class="py-4">
                                ${errorBox(err.message || 'Archive failed. Please try again.')}
                            </div>`;
                        nextBtn.disabled = false;
                        nextBtn.textContent = 'Archive Now';
                    }
                }
            });
        }

        // Dismiss overlay by clicking outside the card
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay && step < 3) overlay.remove();
        });
    }

    renderModal();
}

// ── Delete Confirmation Modal ─────────────────────────────────────────────────

function openDeleteModal(cycleId, cycleName, onDone) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
    overlay.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6" role="dialog">
            <h3 class="text-lg font-bold text-gray-900 dark:text-white mb-2">Delete Cycle</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
                This will soft-delete "<strong>${escapeHtml(cycleName)}</strong>". The underlying election data is preserved.
            </p>
            <p class="text-sm text-gray-700 dark:text-gray-300 mb-2">
                Type the cycle name to confirm:
            </p>
            <input id="delete-confirm" type="text"
                   placeholder="${escapeHtml(cycleName)}"
                   class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 mb-1"/>
            <p id="delete-error" class="text-xs text-red-500 mb-4 hidden">Name does not match.</p>
            <div class="flex justify-end gap-3">
                <button id="delete-cancel" class="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 transition">Cancel</button>
                <button id="delete-confirm-btn" class="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition">Delete Cycle</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);

    overlay.querySelector('#delete-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#delete-confirm-btn').addEventListener('click', async () => {
        const input = overlay.querySelector('#delete-confirm').value.trim();
        if (input.toLowerCase() !== cycleName.trim().toLowerCase()) {
            overlay.querySelector('#delete-error').classList.remove('hidden');
            return;
        }
        try {
            await deleteCycle(cycleId, cycleName);
            overlay.remove();
            if (onDone) onDone({ success: true });
        } catch (err) {
            overlay.querySelector('#delete-error').textContent = err.message || 'Delete failed.';
            overlay.querySelector('#delete-error').classList.remove('hidden');
        }
    });
}

// ── Rollover Confirmation Shortcut (for existing active cycles) ───────────────

function openRolloverModal(cycleId, cycleName, onDone) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';
    overlay.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6" role="dialog">
            <h3 class="text-lg font-bold text-gray-900 dark:text-white mb-2">Rollover into "${escapeHtml(cycleName)}"</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
                All current (unarchived) election history, saved routes, and import logs will be tagged
                with this cycle. This cannot be undone via the UI.
            </p>
            <p class="text-sm text-gray-700 dark:text-gray-300 mb-2">
                Type the cycle name to confirm:
            </p>
            <input id="rollover-confirm-input" type="text"
                   placeholder="${escapeHtml(cycleName)}"
                   class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 mb-1"/>
            <p id="rollover-name-error" class="text-xs text-red-500 mb-4 hidden">Name does not match.</p>
            <div class="flex justify-end gap-3">
                <button id="rollover-cancel" class="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 transition">Cancel</button>
                <button id="rollover-confirm" disabled
                        class="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed">Archive Now</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);

    overlay.querySelector('#rollover-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // Enable confirm button only when the typed name matches
    overlay.querySelector('#rollover-confirm-input').addEventListener('input', (e) => {
        const matches = e.target.value.trim().toLowerCase() === cycleName.trim().toLowerCase();
        overlay.querySelector('#rollover-confirm').disabled = !matches;
        if (matches) overlay.querySelector('#rollover-name-error').classList.add('hidden');
    });

    overlay.querySelector('#rollover-confirm').addEventListener('click', async () => {
        const input = overlay.querySelector('#rollover-confirm-input').value.trim();
        if (input.toLowerCase() !== cycleName.trim().toLowerCase()) {
            overlay.querySelector('#rollover-name-error').classList.remove('hidden');
            return;
        }
        overlay.querySelector('#rollover-confirm').disabled = true;
        overlay.querySelector('#rollover-confirm').textContent = 'Archiving…';
        try {
            await rolloverCycle(cycleId);
            overlay.remove();
            if (onDone) onDone({ success: true });
        } catch (err) {
            overlay.querySelector('#rollover-confirm').disabled = false;
            overlay.querySelector('#rollover-confirm').textContent = 'Archive Now';
            const errEl = document.createElement('p');
            errEl.className = 'text-xs text-red-500 mt-2';
            errEl.textContent = err.message || 'Rollover failed.';
            overlay.querySelector('.flex.justify-end').before(errEl);
        }
    });
}

// ── Page Entry Point ──────────────────────────────────────────────────────────

export async function renderArchive(container) {
    container.innerHTML =
        sectionHeading('Election Archive', 'Manage and preserve election cycle snapshots') +
        spinner('Loading archive data…');

    try {
        const result = await fetchCycles();
        const cycles = result.data || [];
        const total = result.total || 0;

        // Split cycles by status for summary cards
        const archived = cycles.filter(c => c.status === 'archived');
        const active   = cycles.filter(c => c.status === 'active');

        container.innerHTML = `
            ${sectionHeading('Election Archive', 'Manage and preserve election cycle snapshots')}

            <!-- Summary Stats -->
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                ${statCard('Total Cycles', fmt(total), 'all time', 'primary')}
                ${statCard('Archived', fmt(archived.length), 'completed cycles', 'success')}
                ${statCard('Active', fmt(active.length), 'ready to rollover', 'warning')}
                ${statCard('Last Archived', archived.length > 0 ? fmtDate(archived[0].archived_at) : '—', 'most recent archive', 'gray')}
            </div>

            <!-- Action Bar -->
            <div class="flex items-center justify-between mb-6 gap-4 flex-wrap">
                <h3 class="text-base font-semibold text-gray-900 dark:text-white">Election Cycles</h3>
                <button id="btn-new-cycle"
                        class="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium shadow transition">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                    </svg>
                    New Cycle
                </button>
            </div>

            <!-- Banner when there are active (non-archived) cycles awaiting rollover -->
            ${active.length > 0 ? `
            <div class="mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 text-sm text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                </svg>
                ${active.length === 1
                    ? `You have 1 cycle awaiting rollover: <strong class="ml-1">${escapeHtml(active[0].name)}</strong>.`
                    : `You have ${active.length} cycles awaiting rollover. Click <strong>Rollover</strong> on each to archive.`}
            </div>` : ''}

            <!-- Cycles Table -->
            <div id="cycles-table-container">
                ${renderCyclesTable(cycles)}
            </div>`;

        // ── Event delegation ──────────────────────────────────────────────────
        function refresh() {
            renderArchive(container);
        }

        document.getElementById('btn-new-cycle').addEventListener('click', () => {
            openArchiveModal(container, ({ success }) => {
                if (success) refresh();
            });
        });

        container.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;

            const action = btn.dataset.action;
            const id     = parseInt(btn.dataset.id);
            const name   = btn.dataset.name;

            if (action === 'rollover') {
                openRolloverModal(id, name, ({ success }) => {
                    if (success) refresh();
                });
            } else if (action === 'delete') {
                openDeleteModal(id, name, ({ success }) => {
                    if (success) refresh();
                });
            }
        });

    } catch (err) {
        container.innerHTML =
            sectionHeading('Election Archive', 'Manage and preserve election cycle snapshots') +
            errorBox(err.message || 'Failed to load archive data.');
    }
}
