/**
 * GeocodingTab.js - Geocoding management component
 * 
 * Handles:
 * - Geocoding statistics dashboard
 * - Batch geocoding job management
 * - Job progress monitoring with polling
 * - API quota tracking (daily/monthly)
 * - Low quality address review
 * - Failed address retry
 */

import {
  fetchGeoStats,
  startBatchGeocode as startBatchAPI,
  fetchGeoJob,
  fetchQuotaStatus,
  fetchGeoReview,
  retryGeoJob,
  fetchGeoFailed
} from '../../../api/client.js';
import {
  spinner,
  errorBox,
  emptyState,
  statCard,
  fmt,
  pct,
  escapeHtml
} from '../../../components/ui.js';
import { showToast } from '../../../main.js';

const GEOCODE_POLL_MS = 3000;

export default class GeocodingTab {
  constructor(container, state) {
    this.container = container;
    this.state = state;
    this.panelId = 'tab-geocoding';
    this.isInitialized = false;
  }

  async initialize() {
    this.render();
    this.wireEvents();
    await Promise.all([
      this.loadStats(),
      this.loadQuotaStatus()
    ]);
    this.isInitialized = true;
  }

  async onActivate() {
    // Refresh stats when tab becomes active
    await this.loadStats();
    
    // Resume monitoring if there's an active job
    if (this.state.geocoding.jobId) {
      this.monitorJob(this.state.geocoding.jobId);
    }
  }

  render() {
    const panel = this.container.querySelector(`#${this.panelId}`);
    if (!panel) return;

    panel.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <!-- Left: Stats & Actions -->
        <div class="lg:col-span-1 space-y-4">
          <!-- Stats Dashboard -->
          <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 class="font-semibold text-gray-900 dark:text-white text-sm mb-3">Geocoding Stats</h3>
            <div id="geo-stats-content">${spinner('Loading stats...')}</div>
          </div>

          <!-- Actions -->
          <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2">
            <h3 class="font-semibold text-gray-900 dark:text-white text-sm mb-3">Actions</h3>
            <button id="geo-batch-all" class="w-full bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition">
              📍 Geocode All Pending
            </button>
            <button id="geo-refresh" class="w-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2.5 rounded-lg text-sm font-medium transition hover:bg-gray-300 dark:hover:bg-gray-600">
              🔄 Refresh Stats
            </button>
          </div>

          <!-- Job Progress -->
          <div id="geo-job-panel" class="hidden bg-white dark:bg-gray-900 rounded-xl border border-blue-300 dark:border-blue-700 p-4">
            <div class="flex items-center justify-between mb-2">
              <h3 class="font-semibold text-blue-700 dark:text-blue-300 text-sm">Job Progress</h3>
              <span id="geo-job-status" class="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">--</span>
            </div>
            <p class="text-xs text-gray-500 mb-2">Job #<span id="geo-job-id">--</span></p>
            <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 mb-2">
              <div id="geo-job-bar" class="bg-blue-500 h-3 rounded-full transition-all duration-300" style="width: 0%"></div>
            </div>
            <div class="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-400">
              <span>Processed: <strong id="geo-job-processed">0</strong>/<strong id="geo-job-total">0</strong></span>
              <span>Failed: <strong id="geo-job-failed" class="text-red-500">0</strong></span>
              <span>Cache hits: <strong id="geo-job-cache">0</strong></span>
              <span>API calls: <strong id="geo-job-api">0</strong></span>
            </div>
            <div id="geo-job-actions" class="hidden mt-3 space-y-2">
              <button id="geo-retry-failed" class="w-full bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg text-xs font-medium transition">
                🔁 Retry Failed Addresses
              </button>
              <button id="geo-show-failed" class="w-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-3 py-2 rounded-lg text-xs font-medium transition hover:bg-gray-300 dark:hover:bg-gray-600">
                📋 Show Failed Addresses
              </button>
            </div>
            <div id="geo-failed-list" class="hidden mt-3 max-h-48 overflow-y-auto text-xs"></div>
          </div>

          <!-- Quota Status -->
          <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 class="font-semibold text-gray-900 dark:text-white text-sm mb-3">API Quota Status</h3>
            <div id="geo-quota-content">${spinner('Loading quota...')}</div>
          </div>

          <!-- Recent Jobs -->
          <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 class="font-semibold text-gray-900 dark:text-white text-sm mb-3">Recent Jobs</h3>
            <p class="text-[10px] text-gray-400 mb-2">Click a job to view details and failed addresses</p>
            <div id="geo-recent-jobs">
              <p class="text-xs text-gray-400 text-center py-2">No recent jobs</p>
            </div>
          </div>
        </div>

        <!-- Right: Low Quality Review -->
        <div class="lg:col-span-2">
          <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-semibold text-gray-900 dark:text-white text-sm">Low Quality Addresses</h3>
              <button id="geo-load-review" class="text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded-lg font-medium transition hover:bg-gray-300">Load Review</button>
            </div>
            <p class="text-xs text-gray-500 mb-3">Addresses with geocoding quality score below 70%</p>
            <div id="geo-review-list">
              ${emptyState('Click "Load Review" to check for low quality addresses')}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  wireEvents() {
    this.container.querySelector('#geo-batch-all')?.addEventListener('click', () => this.startBatchGeocoding());
    this.container.querySelector('#geo-refresh')?.addEventListener('click', () => this.loadStats());
    this.container.querySelector('#geo-load-review')?.addEventListener('click', () => this.loadGeoReview());
    this.container.querySelector('#geo-retry-failed')?.addEventListener('click', () => this.retryFailedGeocoding());
    this.container.querySelector('#geo-show-failed')?.addEventListener('click', () => this.showFailedAddresses());

    // Recent jobs click delegation
    this.container.querySelector('#geo-recent-jobs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-job-id]');
      if (!btn) return;
      const jobId = parseInt(btn.dataset.jobId);
      if (!isNaN(jobId)) {
        this.loadPastJob(jobId);
      }
    });
  }

  async loadStats() {
    const statsEl = this.container.querySelector('#geo-stats-content');
    if (!statsEl) return;
    statsEl.innerHTML = spinner('Loading stats...');

    try {
      const stats = await fetchGeoStats();
      this.state.setGeocodingStats(stats);

      const progress = stats.geocodingProgress || 0;
      const total = stats.totalVoters || 0;
      const geocoded = stats.geocodedVoters || 0;
      const pending = stats.pendingVoters || 0;
      const quality = stats.averageQualityScore || '--';

      statsEl.innerHTML = `
        <div class="space-y-3">
          <div class="flex justify-between text-sm">
            <span class="text-gray-600 dark:text-gray-400">Geocoded</span>
            <span class="font-medium text-gray-900 dark:text-white">${fmt(geocoded)} / ${fmt(total)}</span>
          </div>
          <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
            <div class="bg-green-500 h-2.5 rounded-full transition-all" style="width: ${Math.min(progress, 100)}%"></div>
          </div>
          <p class="text-xs text-center text-gray-500">${pct(progress)} complete</p>
          <div class="grid grid-cols-2 gap-2">
            ${statCard('Pending', fmt(pending), '', 'warning')}
            ${statCard('Avg Quality', quality, '', 'primary')}
          </div>
        </div>
      `;

      // Render recent jobs
      this.renderRecentJobs(stats.recentJobs || []);
    } catch (err) {
      console.error('Failed to load geocoding stats:', err);
      let message = 'Failed to load stats';
      if (err.status >= 500) message = 'Server error - unable to retrieve stats';
      else if (!navigator.onLine) message = 'No internet connection';
      else if (err.message) message = err.message;
      statsEl.innerHTML = errorBox(message);
      this.state.setError({ operation: 'loadGeoStats', error: err });
    }
  }

  renderRecentJobs(jobs) {
    const jobsEl = this.container.querySelector('#geo-recent-jobs');
    if (!jobsEl || !jobs.length) return;

    jobsEl.innerHTML = jobs.slice(0, 5).map(j => {
      const jid = j.id || j.job_id;
      const failed = j.failed_count || j.failed || 0;
      const processed = j.processed_count || j.processed || j.total_processed || 0;
      const total = j.total_records || j.total || 0;
      const succeeded = j.success_count || j.successful || (processed - failed);
      const startTime = j.start_time ? new Date(j.start_time).toLocaleString() : '';
      const isActive = this.state.geocoding.jobId === jid;

      return `
        <div data-job-id="${jid}" class="cursor-pointer rounded-lg border p-2.5 mb-2 last:mb-0 transition
          ${isActive
            ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20'
            : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-gray-50 dark:hover:bg-gray-800/50'}">
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs font-semibold text-gray-700 dark:text-gray-300">Job #${jid}</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-medium
              ${j.status === 'COMPLETED' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                j.status === 'FAILED' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
                j.status === 'PROCESSING' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}">
              ${j.status || 'UNKNOWN'}
            </span>
          </div>
          <div class="flex items-center gap-3 text-[10px] text-gray-500 dark:text-gray-400">
            <span>✅ ${fmt(succeeded)}</span>
            ${failed > 0 ? `<span class="text-red-500 font-semibold">❌ ${fmt(failed)} failed</span>` : '<span>❌ 0</span>'}
            <span>/ ${fmt(total)} total</span>
          </div>
          ${startTime ? `<p class="text-[10px] text-gray-400 mt-1">${startTime}</p>` : ''}
        </div>
      `;
    }).join('');
  }

  async startBatchGeocoding() {
    const btn = this.container.querySelector('#geo-batch-all');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Starting...';
    }

    try {
      const res = await startBatchAPI({ all: true });
      if (!res.success || !res.jobId) {
        throw new Error('Failed to start geocoding job');
      }

      this.state.setGeocodingJob(res.jobId);
      showToast(`Geocoding job #${res.jobId} started — ${fmt(res.totalRecords || 0)} records`, 'success');

      // Show job panel and start monitoring
      const panel = this.container.querySelector('#geo-job-panel');
      if (panel) panel.classList.remove('hidden');
      const idEl = this.container.querySelector('#geo-job-id');
      if (idEl) idEl.textContent = res.jobId;

      this.monitorJob(res.jobId);
    } catch (err) {
      console.error('Failed to start batch geocoding:', err);
      let message = 'Failed to start geocoding job';
      if (err.status === 429) message = 'Geocoding quota exceeded - try again later';
      else if (err.status >= 500) message = 'Server error - unable to start geocoding';
      else if (!navigator.onLine) message = 'Cannot start geocoding - no internet connection';
      else if (err.message) message = err.message;
      showToast(message, 'error');
      this.state.setError({ operation: 'startBatchGeocoding', error: err });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '📍 Geocode All Pending';
      }
    }
  }

  monitorJob(jobId) {
    this.stopMonitoring();

    const pollFn = setInterval(async () => {
      try {
        const job = await fetchGeoJob(jobId);
        this.updateJobProgress(job);

        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
          this.stopMonitoring();
          
          if (job.status === 'COMPLETED') {
            showToast('Geocoding complete!', 'success');
            await this.loadStats();
          } else {
            showToast(`Geocoding job ${job.status.toLowerCase()}`, 'error');
          }
        }
      } catch (err) {
        console.error('Lost connection to geocoding job:', err);
        this.stopMonitoring();
        let message = 'Lost connection to geocoding job';
        if (!navigator.onLine) message = 'Connection lost - check internet connection';
        else if (err.status === 404) message = 'Geocoding job not found';
        showToast(message, 'error');
      }
    }, GEOCODE_POLL_MS);

    this.state.startGeocodingPoll(pollFn);
  }

  stopMonitoring() {
    this.state.stopGeocodingPoll();
  }

  updateJobProgress(job) {
    const statusEl = this.container.querySelector('#geo-job-status');
    const barEl = this.container.querySelector('#geo-job-bar');
    const processedEl = this.container.querySelector('#geo-job-processed');
    const totalEl = this.container.querySelector('#geo-job-total');
    const failedEl = this.container.querySelector('#geo-job-failed');
    const cacheEl = this.container.querySelector('#geo-job-cache');
    const apiEl = this.container.querySelector('#geo-job-api');

    if (statusEl) statusEl.textContent = job.status || '--';
    if (barEl) barEl.style.width = `${Math.min(job.progress || 0, 100)}%`;
    if (processedEl) processedEl.textContent = fmt(job.processed || 0);
    if (totalEl) totalEl.textContent = fmt(job.total || 0);
    if (failedEl) failedEl.textContent = fmt(job.failed || 0);
    if (cacheEl) cacheEl.textContent = fmt(job.cacheHits || 0);
    if (apiEl) apiEl.textContent = fmt(job.apiCalls || 0);

    // Show retry/failed buttons if failures exist
    const actionsEl = this.container.querySelector('#geo-job-actions');
    if (actionsEl) {
      (job.failed || 0) > 0 ? actionsEl.classList.remove('hidden') : actionsEl.classList.add('hidden');
    }

    // Color progress bar based on status
    if (barEl) {
      barEl.classList.remove('bg-blue-500', 'bg-green-500', 'bg-red-500');
      if (job.status === 'COMPLETED') barEl.classList.add('bg-green-500');
      else if (job.status === 'FAILED') barEl.classList.add('bg-red-500');
      else barEl.classList.add('bg-blue-500');
    }
  }

  async loadPastJob(jobId) {
    this.state.setGeocodingJob(jobId);

    const panel = this.container.querySelector('#geo-job-panel');
    if (panel) panel.classList.remove('hidden');
    const idEl = this.container.querySelector('#geo-job-id');
    if (idEl) idEl.textContent = jobId;

    try {
      const job = await fetchGeoJob(jobId);
      this.updateJobProgress(job);

      // If job is still running, start polling
      if (job.status === 'PROCESSING' || job.status === 'PENDING') {
        this.monitorJob(jobId);
      }

      // Auto-load failed addresses if present
      if ((job.failed || 0) > 0) {
        this.showFailedAddresses();
      }

      showToast(`Loaded job #${jobId}`, 'info');
    } catch (err) {
      console.error('Failed to load past job:', err);
      let message = 'Failed to load job';
      if (err.status === 404) message = 'Job not found - it may have been deleted';
      else if (err.status >= 500) message = 'Server error - unable to load job details';
      else if (err.message) message = err.message;
      showToast(message, 'error');
      this.state.setError({ operation: 'loadPastJob', error: err });
    }
  }

  async loadQuotaStatus() {
    const quotaEl = this.container.querySelector('#geo-quota-content');
    if (!quotaEl) return;

    try {
      const quota = await fetchQuotaStatus();
      
      // Daily geocoding usage
      const geocodingDaily = quota.geocoding || {};
      const dailyUsed = geocodingDaily.used || 0;
      const dailyLimit = geocodingDaily.quota || 333;
      const dailyPct = Math.min((dailyUsed / dailyLimit) * 100, 100);
      const dailyBarColor = dailyPct > 80 ? 'bg-red-500' : dailyPct > 50 ? 'bg-amber-500' : 'bg-green-500';

      // Monthly usage
      const monthly = quota.monthly || {};
      const geoMonthly = monthly.geocoding || {};
      const dmMonthly = monthly.distance_matrix || {};

      const geoMonthlyUsed = geoMonthly.used || 0;
      const geoMonthlyLimit = geoMonthly.limit || 10000;
      const geoMonthlyPct = Math.min((geoMonthlyUsed / geoMonthlyLimit) * 100, 100);
      const geoBarColor = geoMonthlyPct >= 80 ? 'bg-red-500' : geoMonthlyPct >= 50 ? 'bg-amber-500' : 'bg-green-500';

      const dmMonthlyUsed = dmMonthly.used || 0;
      const dmMonthlyLimit = dmMonthly.limit || 10000;
      const dmMonthlyPct = Math.min((dmMonthlyUsed / dmMonthlyLimit) * 100, 100);
      const dmBarColor = dmMonthlyPct >= 80 ? 'bg-red-500' : dmMonthlyPct >= 50 ? 'bg-amber-500' : 'bg-green-500';

      quotaEl.innerHTML = `
        <div class="space-y-3">
          <p class="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Daily (Geocoding)</p>
          <div class="flex justify-between text-xs">
            <span class="text-gray-600 dark:text-gray-400">Today</span>
            <span class="font-medium text-gray-900 dark:text-white">${fmt(dailyUsed)} / ${fmt(dailyLimit)}</span>
          </div>
          <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div class="${dailyBarColor} h-2 rounded-full transition-all" style="width: ${dailyPct}%"></div>
          </div>

          <p class="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mt-2">Monthly</p>
          <div class="flex justify-between text-xs">
            <span class="text-gray-600 dark:text-gray-400">Geocoding</span>
            <span class="font-medium text-gray-900 dark:text-white">${fmt(geoMonthlyUsed)} / ${fmt(geoMonthlyLimit)}</span>
          </div>
          <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
            <div class="${geoBarColor} h-1.5 rounded-full" style="width: ${geoMonthlyPct}%"></div>
          </div>
          <div class="flex justify-between text-xs">
            <span class="text-gray-600 dark:text-gray-400">Distance Matrix</span>
            <span class="font-medium text-gray-900 dark:text-white">${fmt(dmMonthlyUsed)} / ${fmt(dmMonthlyLimit)}</span>
          </div>
          <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
            <div class="${dmBarColor} h-1.5 rounded-full" style="width: ${dmMonthlyPct}%"></div>
          </div>
        </div>
      `;
    } catch (err) {
      console.error('Failed to load quota status:', err);
      quotaEl.innerHTML = `<p class="text-xs text-gray-400">Quota info unavailable${err.status >= 500 ? ' - server error' : ''}</p>`;
    }
  }

  async retryFailedGeocoding() {
    if (!this.state.geocoding.jobId) {
      showToast('No geocoding job to retry', 'error');
      return;
    }

    const btn = this.container.querySelector('#geo-retry-failed');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Retrying...';
    }

    try {
      const res = await retryGeoJob(this.state.geocoding.jobId, {});
      if (res.success && res.jobId) {
        this.state.setGeocodingJob(res.jobId);
        showToast(`Retry job #${res.jobId} started`, 'success');
        this.monitorJob(res.jobId);
      } else {
        showToast('Failed to retry geocoding job', 'error');
      }
    } catch (err) {
      console.error('Failed to retry geocoding:', err);
      let message = 'Retry failed';
      if (err.status === 429) message = 'Geocoding quota exceeded - try again later';
      else if (err.status === 404) message = 'Original job not found';
      else if (err.status >= 500) message = 'Server error - unable to retry';
      else if (err.message) message = err.message;
      showToast(message, 'error');
      this.state.setError({ operation: 'retryGeocoding', error: err });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🔁 Retry Failed Addresses';
      }
    }
  }

  async showFailedAddresses() {
    if (!this.state.geocoding.jobId) {
      showToast('No geocoding job selected', 'error');
      return;
    }

    const listEl = this.container.querySelector('#geo-failed-list');
    if (!listEl) return;

    listEl.classList.remove('hidden');
    listEl.innerHTML = spinner('Loading failed addresses...');

    try {
      const res = await fetchGeoFailed(this.state.geocoding.jobId);
      const failed = res.errors || [];

      if (failed.length === 0) {
        listEl.innerHTML = `<p class="text-xs text-gray-400 text-center py-2">No failed addresses found</p>`;
        return;
      }

      listEl.innerHTML = `
        <p class="text-xs text-gray-500 mb-1 font-medium">${fmt(res.failedCount || failed.length)} failed address${failed.length !== 1 ? 'es' : ''}</p>
        <div class="space-y-1">
          ${failed.map(f => `
            <div class="flex items-start gap-2 py-1 border-b border-gray-100 dark:border-gray-800 last:border-0">
              <span class="text-red-400 mt-0.5">✗</span>
              <div>
                <p class="text-gray-700 dark:text-gray-300">${escapeHtml(f.firstName || '')} ${escapeHtml(f.lastName || '')} — ${escapeHtml(f.address || 'Unknown address')}</p>
                <p class="text-gray-400 text-[10px]">${escapeHtml(f.error_type || 'UNKNOWN')}: ${escapeHtml(f.error_message || 'Geocoding failed')}</p>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    } catch (err) {
      console.error('Failed to load failed addresses:', err);
      let message = 'Failed to load failed addresses';
      if (err.status === 404) message = 'Job not found';
      else if (err.status >= 500) message = 'Server error';
      else if (err.message) message = err.message;
      listEl.innerHTML = `<p class="text-xs text-red-400">${escapeHtml(message)}</p>`;
      this.state.setError({ operation: 'showFailedAddresses', error: err });
    }
  }

  async loadGeoReview() {
    const listEl = this.container.querySelector('#geo-review-list');
    if (!listEl) return;
    listEl.innerHTML = spinner('Loading review data...');

    try {
      const res = await fetchGeoReview({ minQuality: 0, maxQuality: 70, limit: 100 });
      const voters = res.voters || [];

      if (voters.length === 0) {
        listEl.innerHTML = emptyState('No low quality addresses found — all addresses are above 70% quality');
        return;
      }

      listEl.innerHTML = `
        <p class="text-xs text-gray-500 mb-2">${fmt(res.count || voters.length)} addresses need review</p>
        <div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table class="min-w-full text-xs">
            <thead class="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
              <tr>
                <th class="px-3 py-2 text-left">Name</th>
                <th class="px-3 py-2 text-left">Address</th>
                <th class="px-3 py-2 text-left">Quality</th>
                <th class="px-3 py-2 text-left">Coords</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              ${voters.map(v => `
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td class="px-3 py-2 whitespace-nowrap">${escapeHtml(v.firstName || '')} ${escapeHtml(v.lastName || '')}</td>
                  <td class="px-3 py-2 text-gray-500">${escapeHtml(v.address || '')} ${escapeHtml(v.city || '')}</td>
                  <td class="px-3 py-2">
                    <span class="px-2 py-0.5 rounded-full text-xs font-medium ${
                      parseFloat(v.geocoding_quality) < 40 ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
                      'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
                    }">${v.geocoding_quality || 0}%</span>
                  </td>
                  <td class="px-3 py-2 text-gray-500 text-xs">${v.latitude ? `${parseFloat(v.latitude).toFixed(4)}, ${parseFloat(v.longitude).toFixed(4)}` : 'N/A'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      console.error('Failed to load geocoding review data:', err);
      let message = 'Failed to load review data';
      if (err.status >= 500) message = 'Server error - unable to load review data';
      else if (!navigator.onLine) message = 'No internet connection';
      else if (err.message) message = err.message;
      listEl.innerHTML = errorBox(message);
      this.state.setError({ operation: 'loadGeoReview', error: err });
    }
  }

  cleanup() {
    this.stopMonitoring();
  }
}
