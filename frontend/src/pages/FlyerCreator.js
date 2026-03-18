/**
 * Flyer Creator page — Two-step campaign flyer builder
 *
 * Step 1: Upload a background image and layer text using a fabric.js canvas editor.
 * Step 2: Filter voters (same fields as Mailer) and generate a two-sided PDF
 *         where pages alternate [front, voter_back, front, voter_back, …] for duplex printing.
 */

import { Canvas, IText, FabricImage } from 'fabric';
import { fetchMailerCount, fetchMailerVoters } from '../api/client.js';
import {
    sectionHeading, spinner, errorBox, buildTable,
    emptyState, fmt, escapeHtml, debounce,
} from '../components/ui.js';
import { showToast } from '../main.js';
import { generateFlyerPDF } from '../utils/flyer-pdf.js';

// Canvas display dimensions — letter-size ratio (8.5 : 11 ≈ 550 : 713)
const CANVAS_W = 550;
const CANVAS_H = 713;

// Module-level state — reset on each renderFlyerCreator() call
let state = {
    step: 1,
    canvas: null,
    frontImageBase64: null,
    canvasDataUrl: null,
    filters: {
        precinct:    undefined,
        party:       undefined,
        super_voter: undefined,
        city:        undefined,
        zip_code:    undefined,
        limit:       500,
    },
    count:            0,
    previewData:      [],
    loading:          false,
    returnAddress:    '',
    dedupeHousehold:  true,
};

// ============================================================================
// HOUSEHOLD DEDUPLICATION
// ============================================================================

/**
 * Given an array of voter objects, returns one entry per unique mailing address.
 * Multiple voters at the same address have their names combined:
 *   same last name  → "John & Jane SMITH"
 *   different names → "John SMITH, Jane DOE & Bob JONES"
 *   All names are listed regardless of count.
 */
function deduplicateByHousehold(voters) {
    const map = new Map();
    for (const v of voters) {
        const key = [
            (v.address || '').toLowerCase().trim(),
            (v.city    || '').toLowerCase().trim(),
            (v.zipCode || '').toLowerCase().trim(),
        ].join('|');
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(v);
    }
    return Array.from(map.values()).map(group => {
        if (group.length === 1) return group[0];
        const rep = group[0];
        // Check if everyone shares the same last name
        const lastName = (rep.lastName || '').trim().toUpperCase();
        const allSameLast = group.every(v => (v.lastName || '').trim().toUpperCase() === lastName);
        let combinedName;
        if (allSameLast) {
            // "John, Jane & Bob SMITH"
            const firstNames = group.map(v => (v.firstName || '').trim());
            const allButLast = firstNames.slice(0, -1).join(', ');
            combinedName = `${allButLast} & ${firstNames[firstNames.length - 1]} ${lastName}`;
        } else {
            // "John SMITH, Jane DOE & Bob JONES"
            const fullNames = group.map(v =>
                `${(v.firstName || '').trim()} ${(v.lastName || '').trim().toUpperCase()}`.trim()
            );
            const allButLast = fullNames.slice(0, -1).join(', ');
            combinedName = `${allButLast} & ${fullNames[fullNames.length - 1]}`;
        }
        // Return a copy of the representative voter with the combined name
        return { ...rep, firstName: combinedName, lastName: '' };
    });
}

// ============================================================================
// PUBLIC RENDER FUNCTION
// ============================================================================

/**
 * Entry point called by the router when navigating to /flyer.
 * Resets state, renders step 1, returns a cleanup function.
 *
 * @param {HTMLElement} container — the #page-content element
 * @returns {Function} cleanup function (disposes fabric canvas on nav away)
 */
export async function renderFlyerCreator(container) {
    state = {
        step: 1,
        canvas: null,
        frontImageBase64: null,
        canvasDataUrl: null,
        filters: {
            precinct:    undefined,
            party:       undefined,
            super_voter: undefined,
            city:        undefined,
            zip_code:    undefined,
            limit:       500,
        },
        count:            0,
        previewData:      [],
        loading:          false,
        returnAddress:    '',
        dedupeHousehold:  true,
    };

    renderStep1(container);

    return () => {
        if (state.canvas) {
            state.canvas.dispose();
            state.canvas = null;
        }
    };
}

// ============================================================================
// STEP 1 — CANVAS EDITOR
// ============================================================================

function renderStep1(container) {
    // Dispose any existing fabric canvas before replacing DOM content
    if (state.canvas) {
        state.canvas.dispose();
        state.canvas = null;
    }

    container.innerHTML = `
        ${sectionHeading('Flyer Creator', 'Design your flyer front, then generate address backs for each voter')}

        <!-- Progress indicator -->
        <div class="flex items-center gap-4 mb-6 text-sm">
            <span class="flex items-center gap-2 font-semibold text-primary-600 dark:text-primary-400">
                <span class="w-6 h-6 rounded-full bg-primary-600 text-white flex items-center justify-center text-xs font-bold">1</span>
                Design Front
            </span>
            <span class="flex-1 border-t border-gray-300 dark:border-gray-600"></span>
            <span class="flex items-center gap-2 text-gray-400 dark:text-gray-500">
                <span class="w-6 h-6 rounded-full border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center text-xs">2</span>
                Choose Recipients
            </span>
        </div>

        <!-- Upload zone -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-primary-400 transition p-6 mb-4 text-center cursor-pointer" id="fc-upload-zone">
            <input type="file" id="fc-image-input" accept="image/jpeg,image/png,image/webp" class="hidden" />
            <svg class="mx-auto h-10 w-10 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
            <p class="text-sm text-gray-600 dark:text-gray-400" id="fc-upload-label">
                <span class="font-semibold text-primary-600 dark:text-primary-400">Click to upload</span> or drag and drop a background image
            </p>
            <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">JPEG, PNG, or WebP · Recommended: 8.5" × 11" at 150 dpi (1275×1650 px)</p>
        </div>

        <!-- Canvas toolbar -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-3 mb-2 flex flex-wrap gap-2 items-center" id="fc-toolbar">
            <button id="fc-add-text" class="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
                Add Text
            </button>
            <button id="fc-delete-obj" disabled class="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg text-sm font-medium transition">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                </svg>
                Delete Selected
            </button>
            <span class="text-xs text-gray-400 dark:text-gray-500 ml-2">Click to select · Double-click to edit text · Drag to move</span>
        </div>

        <!-- Text property panel (hidden until text object selected) -->
        <div id="fc-props-panel" class="hidden bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-2">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">Text Properties</h3>
            <div class="flex flex-wrap gap-3 items-center">
                <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    Size:
                    <input type="number" id="fc-prop-size" min="8" max="200" value="24"
                        class="w-16 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm focus:ring-2 focus:ring-primary-500 outline-none text-gray-900 dark:text-gray-100" />
                </label>
                <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    Font:
                    <select id="fc-prop-font"
                        class="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm focus:ring-2 focus:ring-primary-500 outline-none text-gray-900 dark:text-gray-100">
                        <option value="Arial">Arial</option>
                        <option value="Times New Roman">Times New Roman</option>
                        <option value="Georgia">Georgia</option>
                        <option value="Verdana">Verdana</option>
                        <option value="Impact">Impact</option>
                        <option value="Courier New">Courier New</option>
                    </select>
                </label>
                <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    Color:
                    <input type="color" id="fc-prop-color" value="#ffffff"
                        class="w-8 h-8 rounded cursor-pointer border border-gray-300 dark:border-gray-600" />
                </label>
                <button id="fc-prop-bold" data-active="false"
                    class="px-3 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-sm font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                    B
                </button>
                <button id="fc-prop-italic" data-active="false"
                    class="px-3 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-sm italic text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                    I
                </button>
                <select id="fc-prop-align"
                    class="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm focus:ring-2 focus:ring-primary-500 outline-none text-gray-900 dark:text-gray-100">
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                </select>
            </div>
        </div>

        <!-- Canvas container (letter-size aspect ratio) -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6 overflow-auto">
            <div class="relative inline-block border border-gray-300 dark:border-gray-600 shadow-sm" id="fc-canvas-wrapper" style="width:${CANVAS_W}px;height:${CANVAS_H}px;">
                <canvas id="fc-canvas" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
                <div id="fc-canvas-placeholder" class="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-gray-50 dark:bg-gray-800 pointer-events-none">
                    <svg class="w-16 h-16 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                    </svg>
                    <p class="text-sm">Upload a background image to begin</p>
                </div>
            </div>
        </div>

        <!-- Navigation bar -->
        <div class="flex items-center justify-between">
            <p class="text-sm text-gray-500 dark:text-gray-400" id="fc-canvas-status">No image loaded</p>
            <button id="fc-next-btn" disabled
                class="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg text-sm font-medium transition">
                Next: Choose Recipients
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                </svg>
            </button>
        </div>
    `;

    // Initialize fabric canvas
    const canvasEl = container.querySelector('#fc-canvas');
    initFabricCanvas(canvasEl, container);

    // Restore background if the user is returning from step 2
    if (state.frontImageBase64) {
        loadCanvasBackground(state.frontImageBase64, container);
        container.querySelector('#fc-canvas-placeholder').classList.add('hidden');
        container.querySelector('#fc-canvas-status').textContent = 'Background image restored';
        container.querySelector('#fc-next-btn').disabled = false;
        container.querySelector('#fc-upload-label').innerHTML =
            `<span class="font-semibold text-green-600 dark:text-green-400">✓ Previous image</span> — click to replace`;
    }

    // Wire up upload zone
    wireUploadZone(container);

    // Wire toolbar
    wireToolbar(container);

    // Wire "Next" button
    container.querySelector('#fc-next-btn').addEventListener('click', () => {
        if (!state.frontImageBase64) return;
        state.canvasDataUrl = state.canvas.toDataURL({ format: 'jpeg', quality: 0.95, multiplier: 2 });
        state.step = 2;
        renderStep2(container);
    });
}

// ============================================================================
// FABRIC.JS CANVAS INITIALIZATION
// ============================================================================

function initFabricCanvas(canvasEl, container) {
    state.canvas = new Canvas(canvasEl, {
        width: CANVAS_W,
        height: CANVAS_H,
        backgroundColor: '#f9fafb',
        selection: true,
        preserveObjectStacking: true,
    });

    state.canvas.on('selection:created', (e) => {
        updatePropsPanel(e.selected[0], container);
    });
    state.canvas.on('selection:updated', (e) => {
        updatePropsPanel(e.selected[0], container);
    });
    state.canvas.on('selection:cleared', () => {
        const panel = container.querySelector('#fc-props-panel');
        if (panel) panel.classList.add('hidden');
        const deleteBtn = container.querySelector('#fc-delete-obj');
        if (deleteBtn) deleteBtn.disabled = true;
    });
    state.canvas.on('object:modified', () => {
        const obj = state.canvas.getActiveObject();
        if (obj) updatePropsPanel(obj, container);
    });

    // Wire property panel event listeners once (read active object at event time)
    container.querySelector('#fc-prop-size').addEventListener('input', (e) => {
        const active = state.canvas.getActiveObject();
        if (active instanceof IText) {
            active.set({ fontSize: parseInt(e.target.value, 10) || 24 });
            state.canvas.requestRenderAll();
        }
    });
    container.querySelector('#fc-prop-font').addEventListener('change', (e) => {
        const active = state.canvas.getActiveObject();
        if (active instanceof IText) {
            active.set({ fontFamily: e.target.value });
            state.canvas.requestRenderAll();
        }
    });
    container.querySelector('#fc-prop-color').addEventListener('input', (e) => {
        const active = state.canvas.getActiveObject();
        if (active instanceof IText) {
            active.set({ fill: e.target.value });
            state.canvas.requestRenderAll();
        }
    });
    container.querySelector('#fc-prop-align').addEventListener('change', (e) => {
        const active = state.canvas.getActiveObject();
        if (active instanceof IText) {
            active.set({ textAlign: e.target.value });
            state.canvas.requestRenderAll();
        }
    });
    container.querySelector('#fc-prop-bold').addEventListener('click', () => {
        const btn    = container.querySelector('#fc-prop-bold');
        const active = state.canvas.getActiveObject();
        if (!(active instanceof IText)) return;
        const isBold = active.fontWeight === 'bold';
        active.set({ fontWeight: isBold ? 'normal' : 'bold' });
        syncToggleButton(btn, !isBold);
        state.canvas.requestRenderAll();
    });
    container.querySelector('#fc-prop-italic').addEventListener('click', () => {
        const btn    = container.querySelector('#fc-prop-italic');
        const active = state.canvas.getActiveObject();
        if (!(active instanceof IText)) return;
        const isItalic = active.fontStyle === 'italic';
        active.set({ fontStyle: isItalic ? 'normal' : 'italic' });
        syncToggleButton(btn, !isItalic);
        state.canvas.requestRenderAll();
    });
}

// ============================================================================
// IMAGE UPLOAD HANDLER
// ============================================================================

function wireUploadZone(container) {
    const zone  = container.querySelector('#fc-upload-zone');
    const input = container.querySelector('#fc-image-input');

    zone.addEventListener('click', () => input.click());

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('border-primary-400', 'bg-primary-50', 'dark:bg-primary-900/10');
    });
    zone.addEventListener('dragleave', () => {
        zone.classList.remove('border-primary-400', 'bg-primary-50', 'dark:bg-primary-900/10');
    });
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('border-primary-400', 'bg-primary-50', 'dark:bg-primary-900/10');
        const file = e.dataTransfer.files[0];
        if (file) handleImageFile(file, container);
    });

    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleImageFile(file, container);
    });
}

async function handleImageFile(file, container) {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimes.includes(file.type)) {
        showToast('Only JPEG, PNG, or WebP images are supported', 'error');
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        showToast('Image must be smaller than 10 MB', 'error');
        return;
    }

    showToast('Loading image…', 'info');

    try {
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });

        state.frontImageBase64 = dataUrl;

        await loadCanvasBackground(dataUrl, container);

        container.querySelector('#fc-upload-label').innerHTML =
            `<span class="font-semibold text-green-600 dark:text-green-400">✓ ${escapeHtml(file.name)}</span> — click to replace`;
        container.querySelector('#fc-canvas-placeholder').classList.add('hidden');
        container.querySelector('#fc-canvas-status').textContent =
            `Background loaded (${Math.round(file.size / 1024)} KB)`;
        container.querySelector('#fc-next-btn').disabled = false;

        showToast('Background image loaded', 'success');
    } catch (err) {
        showToast('Failed to load image: ' + err.message, 'error');
    }
}

async function loadCanvasBackground(dataUrl, container) {
    const img = await FabricImage.fromURL(dataUrl, { crossOrigin: 'anonymous' });
    img.scaleToWidth(state.canvas.width);
    state.canvas.backgroundImage = img;
    state.canvas.requestRenderAll();
}

// ============================================================================
// TOOLBAR (ADD TEXT / DELETE)
// ============================================================================

function wireToolbar(container) {
    container.querySelector('#fc-add-text').addEventListener('click', () => {
        const text = new IText('Your text here', {
            left: 50,
            top: 50,
            fontFamily: 'Arial',
            fontSize: 28,
            fill: '#ffffff',
            fontWeight: 'normal',
            fontStyle: 'normal',
            textAlign: 'left',
            editable: true,
            selectable: true,
            shadow: { color: 'rgba(0,0,0,0.8)', blur: 4, offsetX: 1, offsetY: 1 },
        });

        state.canvas.add(text);
        state.canvas.setActiveObject(text);
        state.canvas.requestRenderAll();
        showToast('Text added — double-click to edit', 'info');
    });

    container.querySelector('#fc-delete-obj').addEventListener('click', () => {
        const active = state.canvas.getActiveObject();
        if (!active) return;
        state.canvas.remove(active);
        state.canvas.discardActiveObject();
        state.canvas.requestRenderAll();
    });
}

// ============================================================================
// TEXT PROPERTY PANEL
// ============================================================================

function updatePropsPanel(obj, container) {
    const panel     = container.querySelector('#fc-props-panel');
    const deleteBtn = container.querySelector('#fc-delete-obj');

    if (deleteBtn) deleteBtn.disabled = false;

    if (!obj || !(obj instanceof IText)) {
        if (panel) panel.classList.add('hidden');
        return;
    }

    if (panel) panel.classList.remove('hidden');

    container.querySelector('#fc-prop-size').value  = Math.round(obj.fontSize || 24);
    container.querySelector('#fc-prop-font').value  = obj.fontFamily || 'Arial';
    container.querySelector('#fc-prop-color').value = obj.fill || '#ffffff';
    container.querySelector('#fc-prop-align').value = obj.textAlign || 'left';
    syncToggleButton(container.querySelector('#fc-prop-bold'),   obj.fontWeight === 'bold');
    syncToggleButton(container.querySelector('#fc-prop-italic'), obj.fontStyle  === 'italic');
}

function syncToggleButton(btn, isActive) {
    if (!btn) return;
    btn.dataset.active = isActive ? 'true' : 'false';
    btn.classList.toggle('bg-primary-100',        isActive);
    btn.classList.toggle('dark:bg-primary-900/40', isActive);
    btn.classList.toggle('text-primary-700',       isActive);
    btn.classList.toggle('dark:text-primary-300',  isActive);
}

// ============================================================================
// STEP 2 — VOTER PICKER
// ============================================================================

function renderStep2(container) {
    container.innerHTML = `
        ${sectionHeading('Choose Recipients', 'Filter voters who will receive a personalized flyer back')}

        <!-- Progress indicator -->
        <div class="flex items-center gap-4 mb-6 text-sm">
            <button id="fc-back-btn" class="flex items-center gap-2 text-primary-600 dark:text-primary-400 hover:underline font-medium">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
                </svg>
                Back to Design
            </button>
            <span class="flex-1 border-t border-gray-300 dark:border-gray-600"></span>
            <span class="flex items-center gap-2 text-primary-600 dark:text-primary-400 font-semibold">
                <span class="w-6 h-6 rounded-full bg-primary-600 text-white flex items-center justify-center text-xs font-bold">2</span>
                Choose Recipients
            </span>
        </div>

        <!-- Canvas thumbnail (front preview) -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6 flex items-center gap-4">
            <img id="fc-front-thumb" src="${escapeHtml(state.canvasDataUrl)}" alt="Flyer front preview"
                class="w-24 h-auto rounded border border-gray-200 dark:border-gray-600 shadow-sm" style="max-height:120px;object-fit:contain;" />
            <div>
                <p class="text-sm font-semibold text-gray-900 dark:text-white">Flyer Front Designed ✓</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">The PDF will alternate: [front page] → [voter address page] → [front page] → … for duplex printing.</p>
                <button id="fc-redesign-btn" class="text-xs text-primary-600 dark:text-primary-400 hover:underline mt-1">Redesign front</button>
            </div>
        </div>

        <!-- Filter panel (identical to Mailer filters) -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6">
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <input id="fc-precinct" type="text" placeholder="Precinct #" maxlength="3"
                    class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500" />
                <select id="fc-party"
                    class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none text-gray-900 dark:text-gray-100">
                    <option value="">All Parties</option>
                    <option value="R">Republican</option>
                    <option value="D">Democrat</option>
                </select>
                <select id="fc-super"
                    class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none text-gray-900 dark:text-gray-100">
                    <option value="">All Voters</option>
                    <option value="true">Super Voters Only</option>
                    <option value="false">Non-Super Voters</option>
                </select>
                <input id="fc-city" type="text" placeholder="City" maxlength="100"
                    class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500" />
                <input id="fc-zip" type="text" placeholder="ZIP Code" maxlength="10"
                    class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500" />
                <input id="fc-limit" type="number" placeholder="Max voters (default 500)" min="1" max="2000" value="500"
                    class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500" />
            </div>
            <!-- Household dedup toggle -->
            <label class="flex items-center gap-3 mt-3 cursor-pointer select-none">
                <input id="fc-dedupe" type="checkbox" ${state.dedupeHousehold ? 'checked' : ''}
                    class="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                <span class="text-sm text-gray-700 dark:text-gray-300">
                    <span class="font-medium">Combine households</span>
                    <span class="text-gray-400 dark:text-gray-500"> — one flyer per address (saves postage)</span>
                </span>
            </label>
        </div>

        <!-- Count bar -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-5 py-4 mb-6">
            <div id="fc-count">${spinner('Calculating...')}</div>
        </div>

        <!-- Return address + export -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Return Address <span class="font-normal text-gray-400">(optional)</span></h3>
            <p class="text-xs text-gray-400 dark:text-gray-500 mb-3">Printed in the upper-left of each address back. One line per entry — e.g. your name on line 1, street on line 2, city/state/zip on line 3.</p>
            <textarea id="fc-return-address" rows="3" placeholder="Your Name&#10;123 Main St&#10;City, ST 00000"
                class="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 resize-none font-mono mb-4">${escapeHtml(state.returnAddress)}</textarea>

            <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Export</h3>
            <p class="text-xs text-gray-400 dark:text-gray-500 mb-3">Half-fold self-mailer: fold with the image on the inside — the address panel faces out on the back.</p>
            <button id="fc-generate-btn" disabled
                title="No voters match current filters"
                class="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition">
                <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
                Generate Half-Fold PDF
            </button>
        </div>

        <!-- Preview table -->
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Preview (first 10 results)</h3>
            <div id="fc-preview">${spinner('Loading preview...')}</div>
        </div>
    `;

    // ── Back / Redesign buttons ─────────────────────────────────────────────
    const goBackToStep1 = () => {
        state.step = 1;
        renderStep1(container);
    };
    container.querySelector('#fc-back-btn').addEventListener('click', goBackToStep1);
    container.querySelector('#fc-redesign-btn').addEventListener('click', goBackToStep1);

    // ── Return address ──────────────────────────────────────────────────────
    container.querySelector('#fc-return-address').addEventListener('input', e => {
        state.returnAddress = e.target.value;
    });
    // ── Household dedup toggle ───────────────────────────────────────────────
    container.querySelector('#fc-dedupe').addEventListener('change', e => {
        state.dedupeHousehold = e.target.checked;
        loadCount(container);
    });
    // ── Filter refs ─────────────────────────────────────────────────────────
    const precinctInput = container.querySelector('#fc-precinct');
    const partySelect   = container.querySelector('#fc-party');
    const superSelect   = container.querySelector('#fc-super');
    const cityInput     = container.querySelector('#fc-city');
    const zipInput      = container.querySelector('#fc-zip');
    const limitInput    = container.querySelector('#fc-limit');

    // ── Debounced reload ────────────────────────────────────────────────────
    const reload = debounce(() => {
        state.filters.precinct    = precinctInput.value.trim() || undefined;
        state.filters.party       = partySelect.value || undefined;
        state.filters.super_voter = superSelect.value || undefined;
        state.filters.city        = cityInput.value.trim() || undefined;
        state.filters.zip_code    = zipInput.value.trim() || undefined;
        const limitVal = parseInt(limitInput.value, 10);
        state.filters.limit = (limitVal >= 1 && limitVal <= 2000) ? limitVal : 500;
        loadCount(container);
        loadPreview(container);
    }, 350);

    precinctInput.addEventListener('input', reload);
    partySelect.addEventListener('change', reload);
    superSelect.addEventListener('change', reload);
    cityInput.addEventListener('input', reload);
    zipInput.addEventListener('input', reload);
    limitInput.addEventListener('input', reload);

    // ── Generate PDF ────────────────────────────────────────────────────────
    container.querySelector('#fc-generate-btn').addEventListener('click', async () => {
        const btn = container.querySelector('#fc-generate-btn');
        btn.disabled = true;
        showToast('Fetching voter data…', 'info');

        try {
            const res = await fetchMailerVoters(state.filters);
            let voters = res.data || [];

            if (voters.length === 0) {
                showToast('No voters match current filters', 'warning');
                return;
            }

            const rawCount = voters.length;
            if (state.dedupeHousehold) {
                voters = deduplicateByHousehold(voters);
            }
            const householdCount = voters.length;
            const savedCount = rawCount - householdCount;
            const savedNote = savedCount > 0 ? ` (${savedCount} duplicates removed)` : '';

            showToast(`Generating ${householdCount * 2}-page half-fold PDF for ${householdCount} addresses${savedNote}…`, 'info');
            const dateStr = new Date().toISOString().split('T')[0];
            await generateFlyerPDF(state.canvasDataUrl, voters, `flyer-${dateStr}.pdf`, state.returnAddress);
            showToast(`Downloaded — ${householdCount} flyers${savedNote}`, 'success');
        } catch (err) {
            showToast('PDF generation failed: ' + err.message, 'error');
        } finally {
            btn.disabled = state.count === 0;
        }
    });

    // ── Initial load ────────────────────────────────────────────────────────
    loadCount(container);
    loadPreview(container);
}

// ============================================================================
// COUNT LOADER (STEP 2)
// ============================================================================

async function loadCount(container) {
    const countEl     = container.querySelector('#fc-count');
    const generateBtn = container.querySelector('#fc-generate-btn');

    if (!countEl) return;
    countEl.innerHTML = spinner('Calculating…');
    if (generateBtn) generateBtn.disabled = true;

    try {
        const res = await fetchMailerCount(state.filters);
        state.count = res.count || 0;

        const dedupeNote = state.dedupeHousehold
            ? ` <span class="text-gray-400 dark:text-gray-500 text-xs">— household dedup enabled; exact flyer count shown after generating</span>`
            : '';

        countEl.innerHTML = state.count > 0
            ? `<span class="font-semibold text-gray-900 dark:text-gray-100">${fmt(state.count)}</span>
               <span class="text-gray-600 dark:text-gray-400"> voters match</span>${dedupeNote}`
            : `<span class="text-gray-500 dark:text-gray-400">No voters match your filters</span>`;

        if (generateBtn) {
            generateBtn.disabled = state.count === 0;
            generateBtn.title = state.count > 0
                ? `Generate half-fold PDF for ${fmt(state.count)} voters`
                : 'No voters match current filters';
        }
    } catch (err) {
        countEl.innerHTML = `<span class="text-danger-600 dark:text-danger-400">Error loading count: ${escapeHtml(err.message)}</span>`;
    }
}

// ============================================================================
// PREVIEW LOADER (STEP 2)
// ============================================================================

async function loadPreview(container) {
    const previewEl = container.querySelector('#fc-preview');
    if (!previewEl) return;
    previewEl.innerHTML = spinner('Loading preview…');

    try {
        const res = await fetchMailerVoters({ ...state.filters, limit: 10 });
        const rows = res.data || [];

        if (rows.length === 0) {
            previewEl.innerHTML = emptyState('No voters match your filters');
            return;
        }

        const columns = [
            { label: 'Name',    render: r => `${escapeHtml(r.lastName || '—')}, ${escapeHtml(r.firstName || '')}` },
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
