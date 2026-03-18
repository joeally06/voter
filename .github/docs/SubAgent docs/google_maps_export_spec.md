# Google Maps Export Feature — Specification

**Feature:** Export Calculated Route to Google Maps (Mobile)
**Author:** Research SubAgent
**Date:** March 12, 2026
**Status:** Ready for Implementation

---

## 1. Current State Analysis

### 1.1 Route Planning Architecture

The platform has a fully functioning route planning system:

| Layer | File | Role |
|-------|------|------|
| Route Planner UI | `frontend/src/pages/MapView/tabs/RoutePlannerTab.js` | Main component for the Route Planner tab |
| Route Utilities | `frontend/src/pages/MapView/utils/routeUtils.js` | Format helpers: distance, duration, stop list |
| API Client | `frontend/src/api/client.js` | Route endpoints (`calcRoute`, `saveRoute`, `fetchRoute`, `deleteRoute`) |
| Route Backend | `backend/routes/routes.js` | All route endpoints including save/share/print |
| Optimizer Service | `backend/services/route-optimizer-service.js` | TSP solving (Nearest Neighbor + 2-opt) |
| Saved Route Model | `backend/models/saved-route.js` | Persist and retrieve routes by ID |

### 1.2 Route Data Structure

After a successful `POST /api/routes/calculate`, the response `route` object contains:

```json
{
  "locations": [
    {
      "voterId": 12345,
      "lat": 36.5040,
      "lng": -89.1872,
      "address": "123 Main St",
      "city": "Jackson",
      "firstName": "Jane",
      "lastName": "Doe"
    }
  ],
  "metrics": {
    "totalDistanceMiles": 4.7,
    "totalDurationMinutes": 18,
    "stopCount": 8,
    "routeEfficiency": 0.87
  },
  "_travelMode": "walking",
  "_savedId": "optional-if-saved"
}
```

The start location is stored separately in `this.state.routing.startLocation` as `{ lat, lng }`.

### 1.3 Existing Action Buttons

After route calculation, three buttons appear in the Route Results card:

```html
<div class="flex gap-2 mt-3">
  <button id="rp-save">💾 Save</button>
  <button id="rp-print">🖨️ Print</button>
  <button id="rp-clear-route">✕ Clear</button>
</div>
```

**There is no "Open in Google Maps" or mobile export functionality today.**

The print view (`GET /api/routes/:routeId/print`) generates a static HTML page with voter stop details but no Google Maps integration.

### 1.4 What Data Is Available for URL Construction

All required data is available client-side immediately after route calculation **without a save step**:
- `route.locations[]` — ordered array of stops with `lat`, `lng`, `address`, `city`
- `this.state.routing.startLocation` — `{ lat, lng }` of the user's starting point
- `route._travelMode` — `"walking"`, `"driving"`, or `"bicycling"`
- Voter names and addresses for meaningful labels in the stop list

---

## 2. Research Findings

### Source 1 — Google Maps Platform: Universal URL Scheme
**URL:** https://developers.google.com/maps/documentation/urls/get-started

Key findings:
- Universal URL format: `https://www.google.com/maps/dir/?api=1&parameters`
- **No Google API key required** for URL-based deep linking
- On Android: Opens native Google Maps app if installed, otherwise opens in browser
- On iOS: Opens native Google Maps app if installed, otherwise opens browser
- `origin` — starting point as `lat,lng` or address string
- `destination` — final stop as `lat,lng` or address string
- `waypoints` — intermediate stops separated by pipe `|`
- `travelmode` — `driving`, `walking`, `bicycling`, `transit`, `two-wheeler`
- `dir_action=navigate` — launches turn-by-turn navigation or route preview
- **URL length limit: 2,048 characters**

### Source 2 — Google Maps Waypoint Limits (Official Documentation)
**URL:** https://developers.google.com/maps/documentation/urls/get-started#waypoints

> "The number of waypoints allowed varies by the platform where the link opens,
> **with up to three waypoints supported on mobile browsers**, and a **maximum of
> nine waypoints** supported otherwise."

Critical implications for voter outreach (mobile-first use case):
- **Mobile browser (no app):** max 3 intermediate waypoints = **5 total stops** (origin + 3 waypoints + destination)
- **Native Google Maps app (Android/iOS):** max 9 intermediate waypoints = **11 total stops** (origin + 9 waypoints + destination)
- Most canvassers will have the Google Maps app installed → target 9 waypoints per segment
- For routes > 10 stops, split into **segments of max 10 stops each**

### Source 3 — Apple Maps URL Scheme
**URL:** https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html

Key findings:
- Apple Maps URL format: `http://maps.apple.com/?saddr=...&daddr=...&dirflg=d`
- `saddr` — source address (start)
- `daddr` — destination address
- `dirflg` — transport: `d` (driving), `w` (walking), `r` (transit)
- **Apple Maps URL scheme does NOT support waypoints** (only origin + destination)
- For iOS users without Google Maps installed, the Google Maps URL will open in Safari, which can display directions (limited to 3 waypoints in mobile browser)
- **Recommendation:** Use Google's universal URL (`https://www.google.com/maps/dir/`) as the primary approach. It gracefully falls back to browser on iOS.

### Source 4 — Google Maps iOS URL Scheme
**URL:** https://developers.google.com/maps/documentation/urls/ios-urlscheme

- iOS-specific scheme: `comgooglemaps://?...` 
- Requires checking if app is installed before using (`canOpenURL`)
- Since this is a web app (not a native iOS app), we **cannot use `canOpenURL`**
- **Resolution:** The universal `https://www.google.com/maps/dir/` URL is the correct choice for web/PWA contexts — it automatically handles app vs. browser on all platforms

### Source 5 — Web Share API (MDN / web.dev)
**URL:** https://web.dev/articles/web-share

Key findings:
```javascript
if (navigator.share) {
  navigator.share({
    title: 'Voter Route – 8 stops',
    text: 'Open your canvassing route in Google Maps',
    url: googleMapsUrl
  });
}
```
- Supported: Chrome 128+, Safari 12.1+, Edge 93+
- Triggers the native OS share sheet on mobile devices
- **Requires HTTPS** and must be called from a user gesture (click)
- Falls back gracefully: if `navigator.share` is not available, copy to clipboard instead
- Ideal for sending the Google Maps URL to another device (e.g., from desktop to phone)

### Source 6 — Progressive Web App (PWA) Mobile Deep Linking Best Practices

Key principles for mobile canvassing deep linking:
1. **Prefer universal web URLs over native app schemes** — `https://www.google.com/maps/dir/` works regardless of whether the native app is installed
2. **Use `target="_blank"`** for the Google Maps button so it opens in a new tab/app without losing the route planner state
3. **Segment large routes** — present multiple clickable links for routes that exceed the waypoint limit
4. **Clipboard fallback** — if `navigator.share` is not available (desktop), copy the URL to the clipboard
5. **URL encoding** — use `encodeURIComponent()` for address strings; lat/lng coordinates do not need encoding beyond ensuring correct decimal format
6. **Don't require saving first** — the Google Maps URL should be generated entirely client-side from the in-memory route data. No backend round-trip needed.

---

## 3. Proposed Solution Architecture

### 3.1 Core URL Generation Algorithm

```javascript
/**
 * Build Google Maps Directions URL(s) for a calculated route.
 *
 * Google Maps URL format:
 * https://www.google.com/maps/dir/?api=1
 *   &origin={lat},{lng}
 *   &destination={lat},{lng}
 *   &waypoints={lat},{lng}|{lat},{lng}|...
 *   &travelmode={walking|driving|bicycling}
 *   &dir_action=navigate
 *
 * Waypoint limits:
 *   - Max 9 intermediate waypoints per URL segment (11 total stops incl. origin + destination)
 *   - For routes > 10 stops, return an array of segment URLs
 *
 * @param {Array} locations   - Ordered array of {lat, lng, firstName, lastName, address}
 * @param {Object} startLocation - {lat, lng}
 * @param {string} travelMode - 'walking' | 'driving' | 'bicycling'
 * @returns {Array<{label: string, url: string, stopRange: string}>}
 */
export function buildGoogleMapsUrls(locations, startLocation, travelMode) {
  const MAX_WAYPOINTS = 9; // max 9 intermediate = 11 total (origin + 9wp + dest)
  const MAX_STOPS_PER_SEGMENT = MAX_WAYPOINTS + 1; // 10 stops per segment (excl. shared origin)

  const MODE_MAP = {
    walking: 'walking',
    driving: 'driving',
    bicycling: 'bicycling'
  };
  const mode = MODE_MAP[travelMode] || 'driving';

  if (!locations || locations.length === 0 || !startLocation) return [];

  // Split locations into segments of MAX_STOPS_PER_SEGMENT
  const segments = [];
  for (let i = 0; i < locations.length; i += MAX_STOPS_PER_SEGMENT) {
    segments.push(locations.slice(i, i + MAX_STOPS_PER_SEGMENT));
  }

  return segments.map((segment, segIdx) => {
    // Origin: for first segment = user's start location; for subsequent = last stop of previous segment
    const origin = segIdx === 0
      ? `${startLocation.lat},${startLocation.lng}`
      : `${segments[segIdx - 1][segments[segIdx - 1].length - 1].lat},${segments[segIdx - 1][segments[segIdx - 1].length - 1].lng}`;

    // Destination: last stop in this segment
    const destination = `${segment[segment.length - 1].lat},${segment[segment.length - 1].lng}`;

    // Intermediate waypoints: all stops in segment except last
    const waypoints = segment.slice(0, -1)
      .map(loc => `${loc.lat},${loc.lng}`)
      .join('|');

    // Build URL
    const base = 'https://www.google.com/maps/dir/?api=1';
    const params = new URLSearchParams({
      origin,
      destination,
      travelmode: mode,
      dir_action: 'navigate'
    });
    if (waypoints) {
      params.set('waypoints', waypoints);
    }

    const url = `${base}&${params.toString()}`;

    // Determine stop range for label
    const startStop = segIdx * MAX_STOPS_PER_SEGMENT + 1;
    const endStop = startStop + segment.length - 1;
    const label = segments.length > 1
      ? `Stops ${startStop}–${endStop}`
      : `Open in Google Maps`;
    const stopRange = `${startStop}–${endStop}`;

    return { label, url, stopRange };
  });
}
```

### 3.2 URL Length Validation

A lat/lng coordinate is typically ~18 characters (e.g., `36.504012,-89.187234`). With 9 waypoints:
- 9 waypoints × 18 chars + 8 pipe separators = ~170 characters for waypoints
- Add origin, destination, parameters: ~250 characters total
- Well within the 2,048 character limit for up to ~90 stops per segment

No URL shortening needed. Segment splitting handles all practical voter route sizes.

### 3.3 Component Placement

The "Open in Google Maps" button appears in **`RoutePlannerTab.js`** within the Route Results card, **as a full-width button below the existing Save/Print/Clear row**:

```
┌─────────────────────────────────────────┐
│ Route Results                           │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │
│ │Dist. │ │ Dur. │ │Stops │ │ Eff. │   │
│ └──────┘ └──────┘ └──────┘ └──────┘   │
│                                         │
│ [💾 Save] [🖨️ Print] [✕ Clear]         │  ← existing row
│                                         │
│ [📱 Open in Google Maps          ▶]    │  ← NEW full-width button
│                                         │
│  (If > 10 stops, show segmented links): │
│ [📍 Stops 1-10] [📍 Stops 11-20]      │
└─────────────────────────────────────────┘
```

For **single-segment routes (≤ 10 stops):** one prominent green/teal button.
For **multi-segment routes (> 10 stops):** a row of segment buttons with stop ranges.

Additionally, add a **Share button** using the Web Share API (with clipboard fallback):
```
[📱 Open in Google Maps] [🔗 Share Link]
```

---

## 4. Implementation Steps

### Phase 1: Add URL Generator Utility (routeUtils.js)

**File:** `c:\Voter\frontend\src\pages\MapView\utils\routeUtils.js`

Add the `buildGoogleMapsUrls(locations, startLocation, travelMode)` function (see Section 3.1).

No extra dependencies needed — uses only native `URLSearchParams`.

### Phase 2: Add Google Maps Export UI (RoutePlannerTab.js)

**File:** `c:\Voter\frontend\src\pages\MapView\tabs\RoutePlannerTab.js`

**2a. Add button HTML in `render()`**

In the Route Results section, after the existing `<div class="flex gap-2 mt-3">` that contains Save/Print/Clear:

```html
<!-- Google Maps Export -->
<div id="rp-gmaps-export" class="mt-2 space-y-1.5 hidden">
  <!-- Single route button (≤ 10 stops) -->
  <a id="rp-gmaps-single"
     href="#"
     target="_blank"
     rel="noopener noreferrer"
     class="flex items-center justify-center gap-2 w-full bg-[#1a73e8] hover:bg-[#1557b0] text-white px-3 py-2.5 rounded-lg text-xs font-semibold transition">
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z"/>
    </svg>
    Open in Google Maps
  </a>
  <!-- Multi-segment buttons (> 10 stops) – rendered dynamically -->
  <div id="rp-gmaps-segments" class="space-y-1.5"></div>
  <!-- Share button (Web Share API with clipboard fallback) -->
  <button id="rp-share-route"
          class="w-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-xs font-medium transition flex items-center justify-center gap-1.5">
    🔗 Share Route Link
  </button>
</div>
```

**2b. Import `buildGoogleMapsUrls` at top of file**

Add to existing import from `routeUtils.js`:
```javascript
import {
  formatDistance,
  formatDuration,
  formatEfficiency,
  createStopList,
  buildGoogleMapsUrls   // ← add this
} from '../utils/routeUtils.js';
```

**2c. Update `displayRouteResults(route)` method**

After setting the stop list HTML, call `updateGoogleMapsExport(route)`:

```javascript
displayRouteResults(route) {
  const metrics = route.metrics || {};
  // ... existing metric display code ...

  // Stop list
  const stopListEl = this.container.querySelector('#rp-stop-list');
  if (stopListEl) {
    stopListEl.innerHTML = createStopList(route.locations || []);
  }

  // Google Maps export
  this.updateGoogleMapsExport(route);

  this.container.querySelector('#rp-results')?.classList.remove('hidden');
}
```

**2d. Add `updateGoogleMapsExport(route)` method**

```javascript
updateGoogleMapsExport(route) {
  const exportEl = this.container.querySelector('#rp-gmaps-export');
  const singleBtn = this.container.querySelector('#rp-gmaps-single');
  const segmentsEl = this.container.querySelector('#rp-gmaps-segments');
  if (!exportEl) return;

  const startLocation = this.state.routing.startLocation;
  const locations = route.locations || [];
  const travelMode = route._travelMode || 'driving';

  if (locations.length === 0 || !startLocation) {
    exportEl.classList.add('hidden');
    return;
  }

  const segments = buildGoogleMapsUrls(locations, startLocation, travelMode);

  if (segments.length === 0) {
    exportEl.classList.add('hidden');
    return;
  }

  if (segments.length === 1) {
    // Single URL — use the primary button
    singleBtn.href = segments[0].url;
    singleBtn.classList.remove('hidden');
    segmentsEl.innerHTML = '';
  } else {
    // Multiple segments — hide single button, render segment buttons
    singleBtn.classList.add('hidden');
    segmentsEl.innerHTML = segments.map(seg => `
      <a href="${escapeHtml(seg.url)}"
         target="_blank"
         rel="noopener noreferrer"
         class="flex items-center justify-center gap-2 w-full bg-[#1a73e8] hover:bg-[#1557b0] text-white px-3 py-2 rounded-lg text-xs font-semibold transition">
        📍 ${escapeHtml(seg.label)}
      </a>
    `).join('');
  }

  // Store URLs on the element for the share handler
  exportEl.dataset.mapsUrls = JSON.stringify(segments.map(s => s.url));

  exportEl.classList.remove('hidden');
}
```

**2e. Wire the Share button in `wireEvents()`**

```javascript
this.container.querySelector('#rp-share-route')?.addEventListener('click', () => {
  this.shareRouteLink();
});
```

**2f. Add `shareRouteLink()` method**

```javascript
shareRouteLink() {
  const exportEl = this.container.querySelector('#rp-gmaps-export');
  const urlsJson = exportEl?.dataset.mapsUrls;
  if (!urlsJson) return;

  let urls;
  try {
    urls = JSON.parse(urlsJson);
  } catch {
    return;
  }

  // Use first segment URL for sharing (most practical for single-person canvassing)
  const primaryUrl = urls[0];

  const shareData = {
    title: 'Voter Canvassing Route',
    text: urls.length > 1
      ? `Voter route (${urls.length} segments). Tap the link for segment 1.`
      : 'Open your voter canvassing route in Google Maps.',
    url: primaryUrl
  };

  if (navigator.share) {
    navigator.share(shareData)
      .catch(err => {
        // User cancelled or share failed — fall back silently
        if (err.name !== 'AbortError') {
          this.fallbackCopyToClipboard(primaryUrl);
        }
      });
  } else {
    this.fallbackCopyToClipboard(primaryUrl);
  }
}

fallbackCopyToClipboard(url) {
  navigator.clipboard.writeText(url)
    .then(() => showToast('Google Maps link copied to clipboard', 'success'))
    .catch(() => showToast('Could not copy link — please copy manually', 'error'));
}
```

### Phase 3: Enhance Print View (routes.js) — Optional

**File:** `c:\Voter\backend\routes\routes.js`

In `generatePrintView()`, add a Google Maps link button to the printed route sheet. This is valuable for canvassers who print their route and want to also open it on a phone.

In the `<body>` after the route summary div, add:
```html
<div class="gmaps-link no-print">
  <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer">
    Open Route in Google Maps (first 10 stops)
  </a>
</div>
```

The `googleMapsUrl` for the print view can be constructed from `routeData.locations` and `routeData.startLocation` (backend Node.js equivalent of the same URL builder).

---

## 5. Dependencies and Requirements

### 5.1 Frontend Dependencies

| Dependency | Status | Notes |
|-----------|--------|-------|
| `URLSearchParams` | ✅ Native browser API | No package needed |
| `navigator.share` | ✅ Available in modern mobile browsers | Feature-detect at runtime |
| `navigator.clipboard` | ✅ Available over HTTPS | Used as fallback for desktop |
| Google Maps URL scheme | ✅ Free, no API key | Just a URL — no SDK needed |

### 5.2 Backend Dependencies

No new backend dependencies required. The Google Maps URL is generated entirely client-side.

### 5.3 Infrastructure Requirements

- **HTTPS required** for `navigator.share` and `navigator.clipboard` — the app must be served over HTTPS in production (likely already true for a voter outreach platform)
- No changes to backend `.env` configuration

---

## 6. Specific Google Maps URL Format

### 6.1 Standard Route URL (≤ 10 stops)

```
https://www.google.com/maps/dir/?api=1
  &origin=36.5040%2C-89.1872
  &destination=36.5215%2C-89.1754
  &waypoints=36.5089%2C-89.1801%7C36.5112%2C-89.1823%7C36.5156%2C-89.1790
  &travelmode=walking
  &dir_action=navigate
```

Key choices:
- Use **lat,lng coordinates** (not addresses) — more precise, no geocoding needed, shorter URL
- Include `dir_action=navigate` — opens turn-by-turn navigation when the native app handles the URL
- Waypoints separated by `|` (which URLSearchParams encodes as `%7C`)
- Commas in lat,lng encoded as `%2C`

### 6.2 Segment URL (when > 10 stops)

For a 25-stop route, generate 3 segment URLs:

- **Segment 1 (Stops 1–10):** origin = `startLocation`, destination = `stops[9]`, waypoints = `stops[0..8]`
- **Segment 2 (Stops 11–20):** origin = `stops[9]` (shared with previous destination), destination = `stops[19]`, waypoints = `stops[10..18]`
- **Segment 3 (Stops 21–25):** origin = `stops[19]`, destination = `stops[24]`, waypoints = `stops[20..23]`

The segments chain together: each segment's origin is the previous segment's last stop.

### 6.3 Travel Mode Mapping

| Platform mode | Google Maps `travelmode` |
|--------------|--------------------------|
| `driving`    | `driving`                |
| `walking`    | `walking`                |
| `bicycling`  | `bicycling`              |

---

## 7. UI Component Placement Summary

### 7.1 Route Planner Tab — Route Results Card

**Location:** `RoutePlannerTab.js` → `render()` → inside `<div id="rp-results">` → after the existing button row

```
Route Results card structure (after implementation):

[Distance] [Duration] [Stops] [Efficiency]    ← existing stat grid

[💾 Save]  [🖨️ Print]  [✕ Clear]              ← existing action row (unchanged)

[📍 Open in Google Maps               ▶]      ← NEW: single-segment button
                 OR (if > 10 stops):
[📍 Stops 1–10] [📍 Stops 11–20] ...          ← NEW: multi-segment buttons

[🔗 Share Route Link                    ]      ← NEW: share/clipboard button

Turn-by-Turn Stops panel                      ← existing (unchanged)
```

### 7.2 Button Styling

- **Google Maps button:** Google Blue `#1a73e8` background, white text — matches Google Maps branding so users immediately recognize what it does
- **Share button:** Neutral gray — secondary action, less prominent
- Both buttons: full-width (`w-full`), same padding as other action buttons, rounded-lg

---

## 8. Potential Risks and Mitigations

### 8.1 Waypoint Limit on Mobile Browsers

**Risk:** If Google Maps app is not installed on the user's phone, the URL opens in the mobile browser which only supports 3 intermediate waypoints (5 total stops). Stops 4+ may be silently ignored.

**Mitigation:**
- Show a note in the UI: "For best results, open in the Google Maps app."
- The segment approach (10 stops max per link) ensures that even in the mobile browser, the user gets directions for all their stops across multiple links — they'll just need to tap each segment separately.
- Most active canvassers will have the Google Maps app installed (turn-by-turn navigation is a key use case).

### 8.2 URL Length Limits

**Risk:** Long voter addresses could exceed the 2,048-character URL limit.

**Mitigation:**
- Using lat/lng coordinates instead of addresses keeps URLs short (~18 chars per stop vs. ~50+ for full addresses).
- With 9 waypoints at 18 chars + 8 pipes = ~170 chars. Adding origin, destination, and parameters: ~350 chars total. Nowhere near 2,048.
- No URL shortening needed.

### 8.3 iOS Without Google Maps App

**Risk:** iOS users without the Google Maps app will see the URL open in Safari → Google Maps web → limited to 3 waypoints on mobile browser.

**Mitigation:**
- The universal URL is still the correct approach (Apple Maps URL doesn't support waypoints at all).
- The canvasser gets directions for at least the first 4 stops (origin + 3 waypoints), which covers most small routes.
- Segment buttons allow them to tap each group when they finish a segment.

### 8.4 No Start Location

**Risk:** User hasn't set a start location before route calculation. `startLocation` would be null.

**Mitigation:**
- `updateGoogleMapsExport()` checks for `startLocation` and hides the button if it's null.
- In practice, route calculation already requires `startLocation` (the Calculate button is disabled without it), so this is not a realistic scenario.

### 8.5 Stale Route Data After Clear

**Risk:** User clears the route, but Google Maps button still shows.

**Mitigation:**
- The existing `#rp-clear-route` handler calls `this.container.querySelector('#rp-results')?.classList.add('hidden')` which hides the entire results section including the new Google Maps export section.

### 8.6 navigator.share Cross-Origin / HTTPS Requirement

**Risk:** `navigator.share` only works over HTTPS. In local development (http://localhost), it will not be available.

**Mitigation:**
- The clipboard fallback activates automatically when `navigator.share` is not available.
- This is a graceful degradation — developers on localhost will see "copied to clipboard" behavior, which is fine for testing.

### 8.7 Print View Backend Enhancement

**Risk:** The backend print view generates Google Maps URLs server-side but lacks the utility function present on the frontend.

**Mitigation:**
- Keep a simple version of the URL builder in the backend print view (`generatePrintView()`).
- Only generate a single-segment URL for the print view (first 10 stops) with a note "See route planner for multi-segment navigation."
- This is marked as optional and can be done as a Phase 3 enhancement.

---

## 9. Testing Checklist

| Test Case | Expected Result |
|-----------|----------------|
| Route with 1 stop | Single Google Maps button visible, URL has only origin + destination |
| Route with 5 stops | Single Google Maps button with 5-stop URL |
| Route with 10 stops | Single Google Maps button with 9 waypoints + destination |
| Route with 11 stops | Two segment buttons: "Stops 1–10" and "Stops 11–11" |
| Route with 25 stops | Three segment buttons: Stops 1–10, 11–20, 21–25 |
| Click "Open in Google Maps" | New tab/window opens to `maps.google.com/dir/?...` |
| Click "Share Route Link" on mobile | Native share sheet appears with Google Maps URL |
| Click "Share Route Link" on desktop | URL copied to clipboard, toast shows "copied" |
| Clear route | Google Maps export section hidden |
| Walking mode | URL contains `travelmode=walking` |
| Driving mode | URL contains `travelmode=driving` |
| No start location | Google Maps export section hidden (should not happen in practice) |

---

## 10. File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `frontend/src/pages/MapView/utils/routeUtils.js` | **Modify** | Add `buildGoogleMapsUrls()` function |
| `frontend/src/pages/MapView/tabs/RoutePlannerTab.js` | **Modify** | Add Google Maps button HTML, `updateGoogleMapsExport()`, `shareRouteLink()`, `fallbackCopyToClipboard()`, import `buildGoogleMapsUrls`, wire events |
| `backend/routes/routes.js` | **Optional Modify** | Add Google Maps link to `generatePrintView()` function |

---

## 11. Sources Referenced

1. **Google Maps Platform — Maps URLs Get Started** (https://developers.google.com/maps/documentation/urls/get-started) — Official URL format, parameters, waypoint syntax, no-API-key confirmation, cross-platform behavior
2. **Google Maps Platform — Waypoints parameter** (https://developers.google.com/maps/documentation/urls/get-started#waypoints) — Confirmed limits: 3 on mobile browsers, 9 otherwise; pipe separator syntax
3. **Apple URL Scheme Reference — Map Links** (https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html) — Confirmed Apple Maps URL scheme has no waypoints support; `saddr`/`daddr` only
4. **Google Maps URL Scheme for iOS** (https://developers.google.com/maps/documentation/urls/ios-urlscheme) — Confirmed `comgooglemaps://` is native-app-only; web apps should use universal `https://` URLs
5. **Web Share API — web.dev** (https://web.dev/articles/web-share) — `navigator.share()` pattern, feature detection, clipboard fallback strategy, HTTPS requirement
6. **Google Maps Platform — URL Encoding** (https://developers.google.com/maps/url-encoding) — Encoding requirements: pipe as `%7C`, comma as `%2C`, use platform URL libraries (URLSearchParams)

---

## 12. Spec File Location

`c:\Voter\.github\docs\SubAgent docs\google_maps_export_spec.md`
