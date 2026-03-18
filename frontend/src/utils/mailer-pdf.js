/**
 * Avery 5160 Mailing Label PDF Generator
 *
 * Generates a printable PDF of mailing labels formatted for Avery 5160 sheets:
 *   - US Letter page (8.5" × 11" = 612pt × 792pt)
 *   - 3 columns × 10 rows = 30 labels per page
 *   - Label size: 2.625" × 1" (189pt × 72pt)
 *   - Column gap: 0.125" (9pt)
 *   - Margins: 0.5" top/bottom (36pt), 0.1875" left/right (13.5pt)
 *
 * Uses pdfmake (already installed as frontend dependency).
 */

import * as pdfMakeModule from 'pdfmake/build/pdfmake';
import * as pdfFontsModule from 'pdfmake/build/vfs_fonts';

// Handle both ESM default exports and CommonJS module shapes
const pdfMake = pdfMakeModule.default || pdfMakeModule;
const vfs = pdfFontsModule.pdfMake?.vfs || pdfFontsModule.default || pdfFontsModule;
pdfMake.vfs = vfs;

// ── Avery 5160 layout constants (all values in pdfmake points = 1/72 inch) ──
const LABEL_WIDTH   = 189; // 2.625"
const LABEL_HEIGHT  = 72;  // 1"
const GAP_WIDTH     = 9;   // 0.125" inter-column gutter
const PAGE_MARGINS  = [13.5, 36, 13.5, 36]; // [left, top, right, bottom]

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Build the pdfmake cell content for a single mailing label.
 * Returns an empty-text cell when voter is null (padding).
 *
 * @param {{ firstName, lastName, address, city, state, zipCode }|null} voter
 * @returns {Object} pdfmake table cell
 */
function buildLabelCell(voter) {
    if (!voter) {
        return { text: '', border: [false, false, false, false] };
    }

    const name = `${voter.firstName || ''} ${voter.lastName || ''}`.trim();
    const address = voter.address || '';
    const cityStateZip =
        `${voter.city || ''}, ${voter.state || ''} ${voter.zipCode || ''}`.trim();

    return {
        border: [false, false, false, false],
        stack: [
            {
                text: name,
                fontSize: 10,
                bold: false,
                margin: [0, 0, 0, 2],
            },
            {
                text: address,
                fontSize: 9,
                margin: [0, 0, 0, 2],
            },
            {
                text: cityStateZip,
                fontSize: 9,
            },
        ],
    };
}

/**
 * Build a gap column cell (transparent spacer between label columns).
 *
 * @returns {Object} pdfmake table cell
 */
function buildGapCell() {
    return { text: '', border: [false, false, false, false] };
}

/**
 * Convert a flat array of voters into pdfmake table rows.
 * Each row contains 5 cells: [label, gap, label, gap, label].
 * The last group is right-padded with empty cells if voters.length % 3 !== 0.
 *
 * @param {Array} voters
 * @returns {Array} pdfmake table body (array of rows)
 */
function buildTableBody(voters) {
    const rows = [];

    for (let i = 0; i < voters.length; i += 3) {
        const group = voters.slice(i, i + 3);
        // Pad to exactly 3 entries
        while (group.length < 3) {
            group.push(null);
        }

        rows.push([
            buildLabelCell(group[0]),
            buildGapCell(),
            buildLabelCell(group[1]),
            buildGapCell(),
            buildLabelCell(group[2]),
        ]);
    }

    return rows;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Generate and download an Avery 5160 mailing label PDF.
 *
 * @param {Array<{firstName, lastName, address, city, state, zipCode}>} voters
 * @param {string} [filename] - Optional filename override
 */
export async function generateMailingLabelsPDF(voters, filename) {
    if (!voters || voters.length === 0) {
        throw new Error('No voters provided for label generation');
    }

    const tableBody = buildTableBody(voters);
    const dateStr   = new Date().toISOString().split('T')[0];
    const outputName = filename || `mailing-labels-${dateStr}.pdf`;

    const docDefinition = {
        pageSize: 'LETTER',
        pageOrientation: 'portrait',
        pageMargins: PAGE_MARGINS,

        content: [
            {
                layout: {
                    hLineWidth: () => 0,
                    vLineWidth: () => 0,
                    paddingLeft:   () => 4,
                    paddingRight:  () => 4,
                    paddingTop:    () => 6,
                    paddingBottom: () => 0,
                },
                table: {
                    // 3 label columns separated by 2 narrow gap columns
                    widths: [LABEL_WIDTH, GAP_WIDTH, LABEL_WIDTH, GAP_WIDTH, LABEL_WIDTH],
                    // Every row is exactly one label tall (72pt = 1")
                    heights: () => LABEL_HEIGHT,
                    dontBreakRows: true,
                    body: tableBody,
                },
            },
        ],

        defaultStyle: {
            font: 'Roboto',
            fontSize: 10,
        },
    };

    pdfMake.createPdf(docDefinition).download(outputName);
}
