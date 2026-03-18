/**
 * Color conversion utilities for PDF export
 * Converts OKLCH colors to RGB for html2canvas compatibility
 * 
 * Tailwind CSS v4 uses OKLCH as the default color format, but html2canvas
 * only supports RGB, RGBA, HEX, HSL, HSLA, and named colors.
 * This utility leverages the browser's native color conversion capabilities.
 */

/**
 * Convert OKLCH or OKLAB color string to RGB using browser's native parser
 * This function works for BOTH oklch() and oklab() formats because
 * the browser's style parser supports both CSS Color Level 4 formats
 * 
 * @param {string} colorString - OKLCH or OKLAB color
 *   Examples: "oklch(63.7% .237 25.331)" or "oklab(0.637 0.228 0.089)"
 * @returns {string} RGB color (e.g., "rgb(239, 68, 68)")
 */
export function oklchToRgb(colorString) {
  try {
    // Create temporary element to leverage browser's color conversion
    const div = document.createElement('div');
    div.style.color = colorString;
    document.body.appendChild(div);
    
    // Browser automatically converts OKLCH/OKLAB to RGB in computed styles
    const computed = getComputedStyle(div).color; // Returns rgb(...) or rgba(...)
    document.body.removeChild(div);
    
    return computed;
  } catch (error) {
    console.warn(`Failed to convert ${colorString}:`, error);
    return 'rgb(0, 0, 0)'; // Fallback to black
  }
}

/**
 * Convert all OKLCH colors in CSS text to RGB
 * Uses caching to avoid redundant conversions for repeated colors
 * 
 * @param {string} cssText - Raw CSS text with OKLCH colors
 * @returns {string} CSS text with RGB colors
 */
export function convertCssOklchToRgb(cssText) {
  // Regex to match oklch() and oklab() functions including optional alpha channel
  // Matches: oklch(L C H) or oklch(L C H / A) or oklab(L A B) or oklab(L A B / A)
  const oklchRegex = /ok(?:lch|lab)\([^)]+\)/gi;
  
  const matches = cssText.match(oklchRegex) || [];
  const conversions = new Map();
  
  // Build conversion map (cache conversions for duplicate colors)
  matches.forEach(oklch => {
    if (!conversions.has(oklch)) {
      const rgb = oklchToRgb(oklch);
      conversions.set(oklch, rgb);
    }
  });
  
  // Replace all OKLCH occurrences with RGB equivalents
  let converted = cssText;
  conversions.forEach((rgb, oklch) => {
    // Use replaceAll for global replacement
    converted = converted.replaceAll(oklch, rgb);
  });
  
  return converted;
}

/**
 * Ensure a color value is in RGB format, convert if necessary
 * Handles OKLCH, OKLAB, or returns existing RGB values
 * 
 * This is critical for PDF export because getComputedStyle() can return OKLAB
 * values in certain scenarios (transitions, animations, color-mix), even when
 * the CSS defines colors as OKLCH. html2canvas cannot parse OKLAB/OKLCH.
 * 
 * @param {string} colorValue - Color value from getComputedStyle()
 * @returns {string} RGB/RGBA color value
 */
export function ensureRgbColor(colorValue) {
  if (!colorValue || typeof colorValue !== 'string') {
    return colorValue;
  }
  
  // If already RGB/RGBA, return as-is (most common case - fast path)
  if (colorValue.startsWith('rgb')) {
    return colorValue;
  }
  
  // Check for OKLCH or OKLAB format
  // Matches: oklch(...) or oklab(...)
  const oklabPattern = /^ok(?:lch|lab)\([^)]+\)$/i;
  
  if (oklabPattern.test(colorValue)) {
    try {
      // Convert using existing oklchToRgb function
      // (works for both OKLCH and OKLAB)
      return oklchToRgb(colorValue);
    } catch (error) {
      console.warn(`[Color Converter] Failed to convert ${colorValue}:`, error);
      return 'rgb(0, 0, 0)'; // Fallback
    }
  }
  
  // For any other format (HEX, HSL, named colors), return as-is
  // html2canvas can handle these
  return colorValue;
}

/**
 * Process element in html2canvas clone to convert OKLCH to RGB
 * This is called from html2canvas's onclone callback
 * 
 * CRITICAL: html2canvas parses stylesheets BEFORE applying inline styles.
 * We must convert OKLCH in stylesheets themselves, not just computed styles.
 * 
 * @param {Document} clonedDocument - The cloned document html2canvas creates
 */
export async function processHtml2CanvasClone(clonedDocument) {
  try {
    console.log('[PDF OKLCH Fix] Processing html2canvas clone...');
    
    // STEP 1: Convert OKLCH in stylesheets FIRST (async)
    // This is the root cause fix - stylesheets contain raw OKLCH that html2canvas parses
    await convertStylesheetsInClone(clonedDocument);
    
    // STEP 2: Process element inline styles as fallback
    const allElements = clonedDocument.querySelectorAll('*');
    console.log(`[PDF OKLCH Fix] Processing ${allElements.length} elements`);
    
    let processedCount = 0;
    
    allElements.forEach(el => {
      try {
        const computed = clonedDocument.defaultView.getComputedStyle(el);
        
        // Color properties to override with RGB values
        const colorProps = [
          'backgroundColor',
          'color',
          'borderColor',
          'borderTopColor',
          'borderRightColor',
          'borderBottomColor',
          'borderLeftColor',
          'fill',
          'stroke',
          'outlineColor',
          'textDecorationColor',
          'caretColor',
          'columnRuleColor'
        ];
        
        let elementProcessed = false;
        
        colorProps.forEach(prop => {
          const value = computed[prop];
          // Skip transparent/empty values but process everything else
          if (value && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent' && value !== 'none') {
            // CRITICAL FIX: Ensure RGB format (handles OKLCH and OKLAB)
            // getComputedStyle() may return OKLAB even when CSS defines OKLCH
            const rgbValue = ensureRgbColor(value);
            
            // Apply as important inline style to override any OKLCH/OKLAB values
            el.style.setProperty(prop, rgbValue, 'important');
            elementProcessed = true;
          }
        });
        
        if (elementProcessed) {
          processedCount++;
        }
        
        // Handle SVG elements specifically
        if (el instanceof clonedDocument.defaultView.SVGElement) {
          const fill = computed.fill;
          const stroke = computed.stroke;
          
          if (fill && fill !== 'none') {
            // Ensure SVG fill is also converted from OKLAB/OKLCH to RGB
            const rgbFill = ensureRgbColor(fill);
            el.setAttribute('fill', rgbFill);
          }
          if (stroke && stroke !== 'none') {
            // Ensure SVG stroke is also converted from OKLAB/OKLCH to RGB
            const rgbStroke = ensureRgbColor(stroke);
            el.setAttribute('stroke', rgbStroke);
          }
        }
      } catch (error) {
        // Skip elements that can't be processed
        console.warn('[PDF OKLCH Fix] Failed to process element:', error.message);
      }
    });
    
    console.log(`[PDF OKLCH Fix] Successfully processed ${processedCount} elements with color properties`);
  } catch (error) {
    console.error('[PDF OKLCH Fix] Failed in processHtml2CanvasClone:', error);
    // Don't throw - allow PDF generation to continue with best effort
  }
}

/**
 * Convert OKLCH colors in stylesheets to RGB
 * This is the KEY FIX - html2canvas parses stylesheet content directly
 * and encounters OKLCH colors before inline styles are applied.
 * 
 * @param {Document} clonedDocument - The cloned document
 */
async function convertStylesheetsInClone(clonedDocument) {
  console.log('[PDF OKLCH Fix] Converting stylesheets...');
  
  let convertedSheets = 0;
  let convertedLinks = 0;
  
  // Process <style> tags
  const styleTags = clonedDocument.querySelectorAll('style');
  styleTags.forEach(styleTag => {
    try {
      const originalCss = styleTag.textContent;
      if (originalCss && /ok(?:lch|lab)/i.test(originalCss)) {
        const convertedCss = convertCssOklchToRgb(originalCss);
        styleTag.textContent = convertedCss;
        convertedSheets++;
        console.log('[PDF OKLCH Fix] Converted <style> tag with OKLCH colors');
      }
    } catch (error) {
      console.warn('[PDF OKLCH Fix] Failed to convert style tag:', error);
    }
  });
  
  // Process <link> stylesheets by FETCHING their content
  // This bypasses CORS/cssRules access issues
  const linkTags = clonedDocument.querySelectorAll('link[rel="stylesheet"]');
  const fetchPromises = [];
  
  linkTags.forEach(linkTag => {
    const href = linkTag.href;
    if (href && !href.startsWith('data:')) {
      // Fetch the stylesheet content
      const fetchPromise = fetch(href)
        .then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.text();
        })
        .then(cssText => {
          if (/ok(?:lch|lab)/i.test(cssText)) {
            console.log(`[PDF OKLCH Fix] Fetched stylesheet with OKLCH/OKLAB: ${href}`);
            const convertedCss = convertCssOklchToRgb(cssText);
            
            // Replace link with inline style
            const newStyleTag = clonedDocument.createElement('style');
            newStyleTag.textContent = convertedCss;
            newStyleTag.setAttribute('data-converted-from', href);
            linkTag.parentNode.insertBefore(newStyleTag, linkTag);
            
            // CRITICAL: Remove the original link to prevent html2canvas from parsing it
            linkTag.remove();
            
            convertedLinks++;
            console.log(`[PDF OKLCH Fix] Converted and replaced linked stylesheet: ${href}`);
          }
        })
        .catch(error => {
          console.warn(`[PDF OKLCH Fix] Failed to fetch/convert stylesheet ${href}:`, error.message);
          // Don't remove the link - let html2canvas try its best
        });
      
      fetchPromises.push(fetchPromise);
    }
  });
  
  // Wait for all stylesheet conversions to complete
  await Promise.all(fetchPromises);
  
  console.log(`[PDF OKLCH Fix] Converted ${convertedSheets} style tags and ${convertedLinks} linked stylesheets`);
}

/**
 * Create override stylesheet to inject before PDF generation
 * This provides fallback RGB conversions for common Tailwind colors
 * 
 * Note: This is a fallback layer. The primary fix is in processHtml2CanvasClone().
 * These styles have high specificity and !important to override OKLCH colors.
 * 
 * @returns {HTMLStyleElement} Style element to inject into document head
 */
export function createRgbOverrideStylesheet() {
  const style = document.createElement('style');
  style.id = 'pdf-rgb-override';
  style.setAttribute('data-pdf-fix', 'true');
  style.textContent = `
    /* PDF Export: RGB Override for html2canvas compatibility */
    /* Tailwind v4 uses OKLCH by default, but html2canvas only supports RGB */
    
    /* Primary colors (Indigo) */
    .bg-primary-50 { background-color: rgb(238, 242, 255) !important; }
    .bg-primary-100 { background-color: rgb(224, 231, 255) !important; }
    .bg-primary-200 { background-color: rgb(199, 210, 254) !important; }
    .bg-primary-300 { background-color: rgb(165, 180, 252) !important; }
    .bg-primary-400 { background-color: rgb(129, 140, 248) !important; }
    .bg-primary-500 { background-color: rgb(99, 102, 241) !important; }
    .bg-primary-600 { background-color: rgb(79, 70, 229) !important; }
    .bg-primary-700 { background-color: rgb(67, 56, 202) !important; }
    .bg-primary-800 { background-color: rgb(55, 48, 163) !important; }
    .bg-primary-900 { background-color: rgb(49, 46, 129) !important; }
    
    .text-primary-50 { color: rgb(238, 242, 255) !important; }
    .text-primary-100 { color: rgb(224, 231, 255) !important; }
    .text-primary-200 { color: rgb(199, 210, 254) !important; }
    .text-primary-300 { color: rgb(165, 180, 252) !important; }
    .text-primary-400 { color: rgb(129, 140, 248) !important; }
    .text-primary-500 { color: rgb(99, 102, 241) !important; }
    .text-primary-600 { color: rgb(79, 70, 229) !important; }
    .text-primary-700 { color: rgb(67, 56, 202) !important; }
    .text-primary-800 { color: rgb(55, 48, 163) !important; }
    .text-primary-900 { color: rgb(49, 46, 129) !important; }
    
    /* Common grayscale colors */
    .bg-white { background-color: rgb(255, 255, 255) !important; }
    .bg-black { background-color: rgb(0, 0, 0) !important; }
    .bg-gray-50 { background-color: rgb(249, 250, 251) !important; }
    .bg-gray-100 { background-color: rgb(243, 244, 246) !important; }
    .bg-gray-200 { background-color: rgb(229, 231, 235) !important; }
    .bg-gray-300 { background-color: rgb(209, 213, 219) !important; }
    .bg-gray-400 { background-color: rgb(156, 163, 175) !important; }
    .bg-gray-500 { background-color: rgb(107, 114, 128) !important; }
    .bg-gray-600 { background-color: rgb(75, 85, 99) !important; }
    .bg-gray-700 { background-color: rgb(55, 65, 81) !important; }
    .bg-gray-800 { background-color: rgb(31, 41, 55) !important; }
    .bg-gray-900 { background-color: rgb(17, 24, 39) !important; }
    
    .text-white { color: rgb(255, 255, 255) !important; }
    .text-black { color: rgb(0, 0, 0) !important; }
    .text-gray-50 { color: rgb(249, 250, 251) !important; }
    .text-gray-100 { color: rgb(243, 244, 246) !important; }
    .text-gray-200 { color: rgb(229, 231, 235) !important; }
    .text-gray-300 { color: rgb(209, 213, 219) !important; }
    .text-gray-400 { color: rgb(156, 163, 175) !important; }
    .text-gray-500 { color: rgb(107, 114, 128) !important; }
    .text-gray-600 { color: rgb(75, 85, 99) !important; }
    .text-gray-700 { color: rgb(55, 65, 81) !important; }
    .text-gray-800 { color: rgb(31, 41, 55) !important; }
    .text-gray-900 { color: rgb(17, 24, 39) !important; }
    
    /* Common semantic colors */
    .bg-red-500 { background-color: rgb(239, 68, 68) !important; }
    .bg-green-500 { background-color: rgb(34, 197, 94) !important; }
    .bg-blue-500 { background-color: rgb(59, 130, 246) !important; }
    .bg-yellow-500 { background-color: rgb(234, 179, 8) !important; }
    
    .text-red-500 { color: rgb(239, 68, 68) !important; }
    .text-green-500 { color: rgb(34, 197, 94) !important; }
    .text-blue-500 { color: rgb(59, 130, 246) !important; }
    .text-yellow-500 { color: rgb(234, 179, 8) !important; }
  `;
  
  console.log('[PDF OKLCH Fix] Created RGB override stylesheet');
  return style;
}
