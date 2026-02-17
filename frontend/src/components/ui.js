/**
 * Shared UI helper functions used across pages
 */

/** Create a stat card for dashboards */
export function statCard(label, value, sub = '', color = 'primary') {
  const colors = {
    primary: 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300',
    success: 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    warning: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    danger:  'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    gray:    'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
  };
  return `
    <div class="rounded-xl p-5 ${colors[color] || colors.primary}">
      <p class="text-xs font-semibold uppercase tracking-wider opacity-70">${label}</p>
      <p class="text-3xl font-bold mt-1">${value}</p>
      ${sub ? `<p class="text-xs mt-1 opacity-60">${sub}</p>` : ''}
    </div>`;
}

/** Loading spinner */
export function spinner(text = 'Loading...') {
  return `
    <div class="flex items-center justify-center py-16 text-gray-400">
      <svg class="animate-spin h-6 w-6 mr-3" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
      </svg>
      <span class="text-sm">${text}</span>
    </div>`;
}

/** Error display */
export function errorBox(message) {
  return `
    <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg p-4 text-sm">
      <strong>Error:</strong> ${escapeHtml(message)}
    </div>`;
}

/** Empty state */
export function emptyState(message = 'No data found', icon = 'M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4') {
  return `
    <div class="text-center py-16 text-gray-400">
      <svg class="mx-auto h-12 w-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="${icon}"/>
      </svg>
      <p class="text-sm">${escapeHtml(message)}</p>
    </div>`;
}

/** Page section heading */
export function sectionHeading(title, subtitle = '') {
  return `
    <div class="mb-6">
      <h2 class="text-2xl font-bold text-gray-900 dark:text-white">${escapeHtml(title)}</h2>
      ${subtitle ? `<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">${escapeHtml(subtitle)}</p>` : ''}
    </div>`;
}

/** Escape HTML entities */
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

/** Format a number with commas */
export function fmt(n) {
  return Number(n || 0).toLocaleString();
}

/** Format a percentage */
export function pct(n) {
  return `${Number(n || 0).toFixed(1)}%`;
}

/** Debounce function */
export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Build a simple table from columns and rows */
export function buildTable(columns, rows, opts = {}) {
  if (!rows || rows.length === 0) return emptyState(opts.emptyText || 'No records found');

  return `
    <div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
      <table class="min-w-full text-sm">
        <thead class="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
          <tr>
            ${columns.map(c => `<th class="px-4 py-3 text-left font-semibold whitespace-nowrap">${c.label}</th>`).join('')}
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
          ${rows.map(row => `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
              ${columns.map(c => `<td class="px-4 py-3 ${c.class || ''}">${c.render ? c.render(row) : escapeHtml(row[c.key])}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

/** Simple pagination controls */
export function pagination(total, limit, offset, onChange) {
  const pages = Math.ceil(total / limit);
  const current = Math.floor(offset / limit) + 1;

  const div = document.createElement('div');
  div.className = 'flex items-center justify-between mt-4 text-sm text-gray-500';
  div.innerHTML = `
    <span>Showing ${offset + 1}–${Math.min(offset + limit, total)} of ${fmt(total)}</span>
    <div class="flex gap-1">
      <button data-page="prev" ${current <= 1 ? 'disabled' : ''} class="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
      <span class="px-3 py-1.5">${current} / ${pages}</span>
      <button data-page="next" ${current >= pages ? 'disabled' : ''} class="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
    </div>
  `;

  div.querySelector('[data-page="prev"]').addEventListener('click', () => {
    if (current > 1) onChange((current - 2) * limit);
  });
  div.querySelector('[data-page="next"]').addEventListener('click', () => {
    if (current < pages) onChange(current * limit);
  });

  return div;
}
