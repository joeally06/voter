/**
 * Upload page - CSV and DBF file uploads with progress tracking
 */
import { uploadCsv, uploadDbf, fetchUploadHistory, fetchUploadStatus, fetchUploadErrors } from '../api/client.js';
import { sectionHeading, spinner, errorBox, fmt, escapeHtml } from '../components/ui.js';
import { showToast } from '../main.js';

export async function renderUpload(container) {
  container.innerHTML = `
    ${sectionHeading('Upload Data', 'Import voter data from CSV or DBF files')}

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Upload Form -->
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 class="font-semibold text-gray-900 dark:text-white mb-4">Upload File</h3>

        <!-- Drop Zone -->
        <div id="drop-zone" class="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center hover:border-primary-400 transition cursor-pointer mb-4">
          <svg class="mx-auto h-10 w-10 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
          </svg>
          <p class="text-sm text-gray-500">Drag & drop a <strong>.csv</strong> or <strong>.dbf</strong> file here</p>
          <p class="text-xs text-gray-400 mt-1">or click to browse</p>
          <input id="file-input" type="file" accept=".csv,.dbf" class="hidden" />
        </div>

        <!-- Options -->
        <div class="flex items-center gap-4 mb-4">
          <label class="text-sm text-gray-600 dark:text-gray-400">Import Mode:</label>
          <select id="import-mode" class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm">
            <option value="replace">Replace duplicates</option>
            <option value="skip">Skip duplicates</option>
            <option value="flag">Flag duplicates as errors</option>
          </select>
        </div>

        <button id="upload-btn" disabled
          class="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg text-sm transition">
          Upload File
        </button>

        <!-- Progress -->
        <div id="upload-progress" class="hidden mt-4">
          <div class="flex justify-between text-sm mb-1">
            <span id="progress-label" class="text-gray-600 dark:text-gray-400">Importing...</span>
            <span id="progress-pct" class="font-medium">0%</span>
          </div>
          <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
            <div id="progress-bar" class="bg-primary-600 h-2.5 rounded-full transition-all duration-300" style="width: 0%"></div>
          </div>
          <div id="progress-details" class="text-xs text-gray-500 mt-2"></div>
        </div>
      </div>

      <!-- Upload History -->
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 class="font-semibold text-gray-900 dark:text-white mb-4">Upload History</h3>
        <div id="upload-history">${spinner('Loading history...')}</div>
      </div>
    </div>
  `;

  const dropZone   = container.querySelector('#drop-zone');
  const fileInput   = container.querySelector('#file-input');
  const uploadBtn   = container.querySelector('#upload-btn');
  const modeSelect  = container.querySelector('#import-mode');
  const progressDiv = container.querySelector('#upload-progress');
  let selectedFile  = null;

  // Drag & drop
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('border-primary-400', 'bg-primary-50', 'dark:bg-primary-900/10'); });
  dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('border-primary-400', 'bg-primary-50', 'dark:bg-primary-900/10'); });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('border-primary-400', 'bg-primary-50', 'dark:bg-primary-900/10');
    if (e.dataTransfer.files.length) selectFile(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) selectFile(fileInput.files[0]);
  });

  function selectFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'dbf'].includes(ext)) {
      showToast('Only .csv and .dbf files are supported', 'error');
      return;
    }
    selectedFile = file;
    dropZone.innerHTML = `
      <svg class="mx-auto h-8 w-8 text-green-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
      <p class="text-sm font-medium">${escapeHtml(file.name)}</p>
      <p class="text-xs text-gray-400">${(file.size / 1024).toFixed(1)} KB</p>
    `;
    uploadBtn.disabled = false;
  }

  // Upload
  uploadBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    uploadBtn.disabled = true;
    progressDiv.classList.remove('hidden');

    const ext = selectedFile.name.split('.').pop().toLowerCase();
    const mode = modeSelect.value;

    try {
      const result = ext === 'dbf'
        ? await uploadDbf(selectedFile, mode)
        : await uploadCsv(selectedFile, mode);

      const importId = result.import?.id || result.id;
      if (importId) {
        pollProgress(importId, container);
      } else {
        showToast('Upload submitted successfully', 'success');
        updateProgress(100, 'Complete', '');
        loadHistory(container);
      }
    } catch (err) {
      showToast('Upload failed: ' + err.message, 'error');
      progressDiv.classList.add('hidden');
      uploadBtn.disabled = false;
    }
  });

  async function pollProgress(importId, container) {
    const poll = setInterval(async () => {
      try {
        const status = await fetchUploadStatus(importId);
        const progress = status.progress || status;
        const pct = progress.percent || 0;
        const detail = `${fmt(progress.successful || 0)} imported, ${fmt(progress.failed || 0)} failed of ${fmt(progress.total || 0)}`;

        updateProgress(pct, status.status === 'completed' ? 'Complete!' : 'Importing...', detail);

        if (status.status === 'completed' || status.status === 'failed') {
          clearInterval(poll);
          showToast(
            status.status === 'completed' ? 'Import completed successfully!' : 'Import finished with errors',
            status.status === 'completed' ? 'success' : 'warning'
          );
          uploadBtn.disabled = false;
          loadHistory(container);
        }
      } catch {
        clearInterval(poll);
      }
    }, 1500);
  }

  function updateProgress(pct, label, details) {
    container.querySelector('#progress-pct').textContent = `${Math.round(pct)}%`;
    container.querySelector('#progress-bar').style.width = `${pct}%`;
    container.querySelector('#progress-label').textContent = label;
    container.querySelector('#progress-details').textContent = details;
  }

  loadHistory(container);
}

async function loadHistory(container) {
  const historyEl = container.querySelector('#upload-history');
  try {
    const history = await fetchUploadHistory(10);
    const items = Array.isArray(history) ? history : history.data || [];

    if (items.length === 0) {
      historyEl.innerHTML = '<p class="text-sm text-gray-400">No uploads yet</p>';
      return;
    }

    historyEl.innerHTML = `
      <div class="space-y-3">
        ${items.map(h => {
          const statusColor = h.status === 'completed' ? 'text-green-600 bg-green-50 dark:bg-green-900/20'
            : h.status === 'failed' ? 'text-red-600 bg-red-50 dark:bg-red-900/20'
            : 'text-amber-600 bg-amber-50 dark:bg-amber-900/20';
          return `
            <div class="flex items-center justify-between rounded-lg border border-gray-100 dark:border-gray-800 p-3">
              <div>
                <p class="text-sm font-medium">${escapeHtml(h.filename || h.file_name || 'Unknown')}</p>
                <p class="text-xs text-gray-400">${h.created_at ? new Date(h.created_at).toLocaleString() : ''}</p>
              </div>
              <span class="text-xs font-medium px-2 py-1 rounded-full ${statusColor}">${h.status}</span>
            </div>`;
        }).join('')}
      </div>`;
  } catch (err) {
    historyEl.innerHTML = errorBox(err.message);
  }
}
