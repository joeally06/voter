/**
 * Two-Sided Flyer PDF Generator
 *
 * Generates a multi-page PDF for duplex printing where pages alternate:
 *   [front (full-bleed canvas image), voter address back, front, voter address back, …]
 *
 * For N voters: 2N total pages. Each physical sheet has the flyer front on one
 * side and a unique voter mailing address on the reverse.
 *
 * Uses pdfmake (already installed as a frontend dependency).
 */

import * as pdfMakeModule from 'pdfmake/build/pdfmake';
import * as pdfFontsModule from 'pdfmake/build/vfs_fonts';

// Handle both ESM default exports and CommonJS module shapes
const pdfMake = pdfMakeModule.default || pdfMakeModule;
const vfs = pdfFontsModule.pdfMake?.vfs || pdfFontsModule.default || pdfFontsModule;
pdfMake.vfs = vfs;

// ── Layout constants (all values in pdfmake points = 1/72 inch) ──────────────
const PAGE_WIDTH  = 612;  // 8.5"
const PAGE_HEIGHT = 792;  // 11"
const HALF        = Math.floor(PAGE_HEIGHT / 2); // 396pt — fold line for half-fold self-mailer

// Horizontal padding inside the address panel
const PANEL_MARGIN = 18;

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Build a pdfmake content item for one front-of-flyer page.
 * The canvas JPEG data URL fills the entire 612×792pt page (zero-margin document).
 *
 * @param {string} canvasDataUrl — JPEG base64 data URL from fabric canvas.toDataURL()
 * @param {boolean} addPageBreak — whether to force a page break after this item
 * @returns {Object} pdfmake content item
 */
function buildFrontPage(canvasDataUrl, pageBreakBefore) {
    return {
        image: canvasDataUrl,
        // fit scales the image to fill the page without ever overflowing into a second page
        fit: [PAGE_WIDTH, PAGE_HEIGHT],
        ...(pageBreakBefore ? { pageBreak: 'before' } : {}),
    };
}

/**
 * Build a pdfmake content item for one voter address back page.
 *
 * Half-fold self-mailer layout (image folds to the inside):
 *   Upper half (0–396pt) — blank, faces inward after folding
 *   ─ ─ ─ ─ ─ ─ ─ fold here ─ ─ ─ ─ ─ ─ ─
 *   Lower half (396–792pt) — visible address panel:
 *     [Return address]  [Voter name & address]  [STAMP]
 *
 * @param {{ firstName, lastName, address, city, state, zipCode }} voter
 * @param {string} [returnAddress] — optional multi-line sender return address
 * @returns {Object} pdfmake content item
 */
function buildVoterBackPage(voter, returnAddress) {
    const name = `${voter.firstName || voter.first_name || ''} ${voter.lastName || voter.last_name || ''}`.trim();
    const addr = voter.address || voter.residential_address || '';
    const city = voter.city || '';
    const st   = voter.state || '';
    const zip  = voter.zipCode || voter.zip_code || '';
    const cityStateZip = [city, st].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '');
    const returnLines  = returnAddress ? String(returnAddress).split('\n').filter(Boolean) : [];

    // All positions are absolute so placement is guaranteed regardless of pdfmake flow.
    //
    // Page is 612 × 792pt.  Lower mailing panel: y 396–792 (396pt tall).
    // Center of lower panel: y = 396 + 198 = 594pt.
    // Recipient address block ≈ 75pt tall → top edge at 594 - 37 = 557pt.
    //
    // Recipient block spans full usable width (x=PANEL_MARGIN, width=PAGE_WIDTH-2*PANEL_MARGIN)
    // so alignment:'center' reliably centers text with no left-offset math required.

    const ADDR_CENTER_Y  = 557;   // top of recipient address block
    const PANEL_TOP_Y    = 420;   // top of return-address / stamp row
    const ADDR_WIDTH     = PAGE_WIDTH - PANEL_MARGIN * 2;  // full usable width
    const ADDR_LEFT      = PANEL_MARGIN;

    return {
        pageBreak: 'before',
        stack: [
            // ── Fold guide ────────────────────────────────────────────────────
            {
                absolutePosition: { x: PANEL_MARGIN, y: HALF - 2 },
                stack: [
                    {
                        canvas: [{
                            type: 'line',
                            x1: 0, y1: 0, x2: PAGE_WIDTH - PANEL_MARGIN * 2, y2: 0,
                            lineWidth: 0.5, lineColor: '#D1D5DB',
                            dash: { length: 3, space: 3 },
                        }],
                    },
                    { text: 'fold here', fontSize: 6, color: '#D1D5DB', alignment: 'center', margin: [0, 2, 0, 0] },
                ],
            },

            // ── Return address — upper-left of mailing panel ──────────────────
            {
                absolutePosition: { x: PANEL_MARGIN, y: PANEL_TOP_Y },
                width: 130,
                stack: returnLines.length > 0
                    ? returnLines.map((l, i) => ({
                        text: l, fontSize: i === 0 ? 9 : 8,
                        bold: i === 0, color: '#374151', margin: [0, 0, 0, 1],
                    }))
                    : [],
            },

            // ── Stamp box — upper-right of mailing panel ─────────────────────
            {
                absolutePosition: { x: PAGE_WIDTH - 76 - PANEL_MARGIN, y: PANEL_TOP_Y },
                width: 76,
                table: {
                    widths: [72],
                    body: [[{
                        stack: [
                            { text: 'PLACE', fontSize: 7, color: '#9CA3AF', alignment: 'center' },
                            { text: 'STAMP', fontSize: 7, color: '#9CA3AF', alignment: 'center' },
                            { text: 'HERE',  fontSize: 7, color: '#9CA3AF', alignment: 'center' },
                        ],
                        margin: [2, 8, 2, 8],
                    }]],
                },
                layout: {
                    hLineColor: () => '#9CA3AF',
                    vLineColor: () => '#9CA3AF',
                },
            },

            // ── Recipient address — centered vertically in mailing panel ──────
            {
                absolutePosition: { x: ADDR_LEFT, y: ADDR_CENTER_Y },
                width: ADDR_WIDTH,
                stack: [
                    { text: name, fontSize: 14, bold: true,  color: '#111827', alignment: 'center', margin: [0, 0, 0, 6] },
                    { text: addr, fontSize: 11, bold: false, color: '#374151', alignment: 'center', margin: [0, 0, 0, 3] },
                    { text: cityStateZip, fontSize: 11, bold: false, color: '#374151', alignment: 'center' },
                ],
            },

            // pdfmake requires at least one non-absolute item to define page flow.
            { text: '', margin: [0, 0, 0, 0] },
        ],
    };
}

/**
 * Build the full alternating content array:
 * [front₁, back₁, front₂, back₂, … frontN, backN]
 *
 * @param {string} canvasDataUrl
 * @param {Array}  voters
 * @returns {Array} pdfmake content array
 */
function buildAlternatingContent(canvasDataUrl, voters, returnAddress) {
    const content = [];

    voters.forEach((voter, i) => {
        // First front page has no pageBreak; subsequent front pages use 'before'
        // so they follow immediately after their preceding voter back page.
        content.push(buildFrontPage(canvasDataUrl, i > 0));
        // Voter back always uses pageBreak: 'before' (set inside buildVoterBackPage)
        content.push(buildVoterBackPage(voter, returnAddress));
    });

    return content;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Generate and download a two-sided flyer PDF.
 *
 * Page layout for N voters (2N pages total):
 *   Page 1:  Flyer front (full-bleed canvas image)
 *   Page 2:  Voter 1 address (centered on page)
 *   Page 3:  Flyer front (repeated)
 *   Page 4:  Voter 2 address
 *   …        (alternates for all voters)
 *
 * @param {string} canvasDataUrl — JPEG base64 data URL from fabric canvas.toDataURL()
 * @param {Array<{firstName, lastName, address, city, state, zipCode}>} voters
 * @param {string} [filename] — optional filename override
 */
export async function generateFlyerPDF(canvasDataUrl, voters, filename, returnAddress) {
    if (!canvasDataUrl) throw new Error('No flyer front image provided');
    if (!voters || voters.length === 0) throw new Error('No voters provided');

    const dateStr    = new Date().toISOString().split('T')[0];
    const outputName = filename || `flyer-${dateStr}.pdf`;

    const docDefinition = {
        pageSize:        'LETTER',
        pageOrientation: 'portrait',
        // Zero margins — front image is full-bleed; back pages manage their own padding.
        pageMargins: [0, 0, 0, 0],

        content: buildAlternatingContent(canvasDataUrl, voters, returnAddress || ''),

        defaultStyle: {
            font: 'Roboto',
        },
    };

    pdfMake.createPdf(docDefinition).download(outputName);
}
