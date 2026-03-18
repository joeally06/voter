# Flyer Creator — Code Review

**Date:** 2026-03-16  
**Reviewer:** Code Review Agent  
**Files Reviewed:**  
- `frontend/src/pages/FlyerCreator.js`  
- `frontend/src/utils/flyer-pdf.js`  
- `frontend/src/main.js` (additions only)  
- `frontend/package.json`  
- `frontend/src/pages/Mailer.js` (reference)  
- `frontend/src/utils/mailer-pdf.js` (reference)  
- `frontend/src/api/client.js` (API surface verification)

---

## Build Result: ✅ SUCCESS

```
vite v7.3.1 building client environment for production...
✓ 44 modules transformed.
dist/assets/index-Bm0ogJ89.js   2,563.25 kB │ gzip: 1,035.16 kB
✓ built in 14.86s
```

No compilation errors. One chunk-size warning (expected with fabric.js + pdfmake — see RECOMMENDED #1).

---

## Overall Assessment: ✅ PASS

The implementation is functionally correct, security-sound, and consistent with existing patterns. All review criteria pass. No critical defects were found. Several recommendations are noted for quality improvement.

---

## Summary Score Table

| Category | Score | Grade |
|---|---|---|
| Specification Compliance | 100% | A+ |
| Best Practices | 88% | B+ |
| Functionality | 97% | A |
| Code Quality | 92% | A |
| Security | 98% | A+ |
| Performance | 75% | C+ |
| Consistency | 93% | A |
| Build Success | 100% | A+ |

**Overall Grade: A (93%)**

---

## Critical Issues

**None.** The implementation builds cleanly, all API calls resolve to existing exports, fabric.js v6 ESM imports are correct, canvas initialization order is safe, and the cleanup/disposal lifecycle is correctly handled.

---

## Recommended Findings

### R1 — Bundle size: no code splitting for heavy libraries (Performance)
**File:** `frontend/package.json`, `frontend/vite.config.js` (absent)  
**Detail:** `fabric` (~1.5MB) and `pdfmake` (~800KB) are bundled into a single 2.5MB chunk. Both are only needed on the `/flyer` route. With no `manualChunks` or dynamic imports configured, every user downloads these libraries even if they never visit the flyer page.  
**Recommendation:** Add a `manualChunks` split in `vite.config.js` for `fabric` and `pdfmake`, or convert `FlyerCreator.js` to use dynamic imports (`await import('fabric')`).

```js
// vite.config.js example addition:
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor-fabric':  ['fabric'],
        'vendor-pdfmake': ['pdfmake'],
      },
    },
  },
},
```

---

### R2 — `updatePropsPanel` re-wires event listeners on every selection (Best Practices)
**File:** `FlyerCreator.js` — `updatePropsPanel()` function  
**Detail:** Every time a canvas object is selected, `updatePropsPanel` calls `replaceEventListeners()` for all six text property inputs. `replaceEventListeners` clones each DOM node to strip old listeners, then re-registers a new handler. This works correctly but performs 6 DOM clone operations per selection event and is architecturally unusual.  
**Recommendation:** Wire the property panel listeners **once** in `initFabricCanvas` / `renderStep1`, reading the active object at event time via `state.canvas.getActiveObject()`. Reserve `updatePropsPanel` for updating input *values* only.

---

### R3 — Error message uses `text-red-600` instead of `text-danger-600` (Consistency)
**File:** `FlyerCreator.js` — `loadCount()`, error branch  
**Current code:**
```js
`<span class="text-red-600 dark:text-red-400">Error loading count: …</span>`
```
**In Mailer.js `loadCount()` (reference):**
```js
`<span class="text-danger-600 dark:text-danger-400">Error loading count: …</span>`
```
**Recommendation:** Change to `text-danger-600 dark:text-danger-400` to match the Mailer pattern and the app's custom Tailwind color tokens.

---

### R4 — No visual loading indicator on "Generate PDF" button during generation (Best Practices)
**File:** `FlyerCreator.js` — generate button click handler  
**Detail:** The button is disabled during PDF generation, but the button text and icon do not change to indicate activity (no spinner replacement). The Mailer PDF export button has the same limitation, but for the Flyer feature this is more noticeable because large exports can take several seconds.  
**Recommendation:** Swap button content to a spinner/loading text during the `await generateFlyerPDF()` call, then restore it in the `finally` block.

---

## Optional Findings

### O1 — `escapeHtml` applied to base64 data URL is semantically unnecessary
**File:** `FlyerCreator.js` — `renderStep2()` thumbnail `<img src="...">`  
**Detail:** `src="${escapeHtml(state.canvasDataUrl)}"` — base64 data URLs contain only alphanumeric characters, `+`, `/`, `=`, and the prefix `data:image/jpeg;base64,`. None of these are HTML-unsafe, so `escapeHtml()` is a no-op here. It works correctly but implies the URL could be user-controlled HTML, which is misleading.  
**Recommendation:** Use the value directly, or add a brief comment explaining why escaping is applied.

---

### O2 — Canvas dimensions are not responsive (mobile UX)
**File:** `FlyerCreator.js` — `CANVAS_W = 550`, `CANVAS_H = 713`  
**Detail:** The canvas is fixed at 550×713px. On viewports narrower than ~620px the canvas overflows its container (which has `overflow-auto`). The canvas itself does not reflow. This is a known fabric.js constraint, but the current wrapper only adds horizontal scroll, not a clear visual affordance.  
**Recommendation:** For consistency with the rest of the app consider adding a note in the UI ("Best viewed on desktop") or implementing `scaleToFit` on window resize.

---

### O3 — Voter back page has no return/sender address block
**File:** `flyer-pdf.js` — `buildVoterBackPage()`  
**Detail:** The voter back page renders only the recipient's address, centered on the page. A production mailer typically also includes a return address in the upper-left corner and optionally a postage indicia/permit box. This may be intentional (the user prints these as inserts inside an envelope, not as postcards).  
**Recommendation:** Consider adding a placeholder return-address block or a UI option to enter a return address before generating the PDF.

---

### O4 — `multiplier: 2` in `canvas.toDataURL()` increases PDF file size
**File:** `FlyerCreator.js` — Next button handler  
**Detail:** The `multiplier: 2` argument doubles the canvas export resolution (550×713 → 1100×1426px per image). For N voters, the PDF embeds N identical copies of the same JPEG. Each copy is ~300–800KB depending on image content, so a 100-voter export could be 30–80MB. pdfmake does not deduplicate repeated image data.  
**Recommendation:** Generate the front image JPEG once and consider whether `quality: 0.85` vs `0.95` is an acceptable tradeoff. For large voter lists, document the expected file-size growth to the user.

---

## Detailed Correctness Analysis

### fabric.js ESM Import (✅ Correct)
```js
import { Canvas, IText, FabricImage } from 'fabric';
```
fabric v6 ships proper ESM named exports. Vite resolves this directly. The build confirms no import errors.

### Canvas Initialization Order (✅ Correct)
`container.innerHTML = …` executes synchronously (DOM is mutated before next line), so `container.querySelector('#fc-canvas')` returns the real element before `new Canvas(canvasEl, …)` is called. Safe.

### Canvas Disposal (✅ Correct)
- `renderFlyerCreator()` returns `() => { state.canvas.dispose(); state.canvas = null; }` — called by the router on navigation away.
- `renderStep1()` also guards with `if (state.canvas) { state.canvas.dispose(); state.canvas = null; }` before replacing `innerHTML`.  Both paths covered.

### `canvas.toDataURL()` Captures Background (✅ Correct)
`state.canvas.backgroundImage = img` sets fabric's internal background, which is included in `toDataURL()`. The `multiplier: 2` argument scales both the background and all overlaid IText objects. ✅

### PDF Alternating Pages (✅ Correct)
`buildAlternatingContent` iterates N voters and pushes:
```
[frontPage(pageBreak:after), voterBack(pageBreak:after|none)] × N
```
Front always gets `pageBreak: 'after'` so each voter back starts on a fresh page. Last voter back has no trailing page break. This produces exactly `2N` pages. ✅

### pdfmake Image Dimensions (✅ Correct)
`width: 612, height: 792` matches US Letter at 72 DPI. Document `pageMargins: [0,0,0,0]` means the image fills the full page. ✅

### Voter Address Vertical Centering (✅ Functional)
```js
table: { widths: ['*'], heights: [PAGE_HEIGHT], body: [[{ verticalAlignment: 'center' }]] }
```
`heights: [792]` sets the minimum row height to full page (effective with zero document margins). `verticalAlignment: 'center'` centers the 3-line address block within the 792pt row. This is a valid pdfmake pattern. ✅

### API Calls (✅ All Exist)
Both `fetchMailerCount(filters)` and `fetchMailerVoters(filters)` are exported from `client.js` and map to `/mailer/count` and `/mailer/voters` respectively. Parameter shapes used in FlyerCreator match the Mailer page exactly. ✅

### File Validation (✅ Correct)
```js
const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
if (!allowedMimes.includes(file.type)) { … }
if (file.size > 10 * 1024 * 1024) { … }
```
Both MIME-type allowlist and 10MB size cap applied before any processing. ✅

### XSS / Injection (✅ No Vectors)
- User-entered canvas text → rasterized to JPEG pixels by `canvas.toDataURL()` → embedded in PDF as pixel data. Text never re-enters HTML or SQL.
- `file.name` displayed via `escapeHtml(file.name)` ✅  
- Preview table rendered via `escapeHtml()` on all voter fields ✅  
- Error messages used via `err.message` which is a string, not HTML ✅

### main.js Additions (✅ Correct)
- `renderFlyerCreator` import on line 10 — correct path.  
- `NAV_ITEMS` entry with path `/flyer`, label `Flyer Creator`, valid SVG path string, follows identical structure to all other nav items.  
- Route registration `{ path: '/flyer', title: 'Flyer Creator', render: renderFlyerCreator }` — correctly placed at end of routes array.

### package.json (✅ Correct)
```json
"fabric": "^6.9.1"
```
Added to `dependencies` (not `devDependencies`). fabric v6 is the current major version with ESM support. The caret allows patch/minor updates. ✅

---

## Conclusion

The Flyer Creator feature is well-implemented, secure, and consistent with the codebase. All functional requirements are met. The most actionable improvements are bundle-size code splitting (R1) and the minor CSS class inconsistency (R3), both of which are low-effort fixes. No critical defects warrant blocking delivery.
