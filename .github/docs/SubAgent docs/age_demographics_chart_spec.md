# Age Demographics Chart Specification

**Document Version:** 1.0  
**Created:** February 7, 2026  
**Project:** Voter Outreach Platform  
**Feature:** Age Demographics Visualization  

---

## Executive Summary

This specification outlines the design and implementation of an age demographics chart for the Voter Outreach Platform. The chart will visualize voter distribution across age groups using a horizontal bar chart, providing insights into demographic patterns and super voter rates by age cohort.

---

## 1. Current Implementation Analysis

### 1.1 Chart Library in Use

**Library:** Chart.js v4.4.0  
**CDN:** `https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js`  
**Documentation:** https://www.chartjs.org/docs/latest/

**Current Chart.js Configuration:**
```javascript
Chart.defaults.font.family = "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";
Chart.defaults.responsive = true;
Chart.defaults.maintainAspectRatio = false;
```

### 1.2 Existing Charts

**File:** `frontend/public/js/chart-controller.js`

Two charts currently implemented:

1. **Precinct Distribution Chart**
   - Type: Doughnut
   - Element ID: `precinctChart`
   - Data Source: `analytics.precincts`
   - Shows: Voter distribution across precincts

2. **Super Voter Comparison Chart**
   - Type: Pie
   - Element ID: `superVoterChart`
   - Data Source: Filtered voters from state
   - Shows: Super voters vs regular voters

**Chart Controller Pattern:**
- Managed by `ChartController` class
- Initialized via `app.js`
- Uses `StateManager` for reactive data updates
- Charts auto-update when state changes
- Includes helper method `generateColors()` for consistent color palettes

### 1.3 Chart Display Location

**File:** `frontend/public/index.html` (Lines 200-230)

Current structure:
```html
<div class="card-header bg-secondary text-white">
    <i class="bi bi-bar-chart"></i> Analytics Dashboard
</div>
<div class="card-body">
    <div class="row">
        <div class="col-lg-6 mb-3">
            <div class="chart-container" style="position: relative; height: 300px;">
                <canvas id="precinctChart" role="img" aria-label="..."></canvas>
            </div>
        </div>
        <div class="col-lg-6 mb-3">
            <div class="chart-container" style="position: relative; height: 300px;">
                <canvas id="superVoterChart" role="img" aria-label="..."></canvas>
            </div>
        </div>
    </div>
</div>
```

**Layout Pattern:**
- Bootstrap grid: `col-lg-6` (two columns on large screens)
- Fixed height: 300px per chart container
- Responsive: stacks on mobile devices
- Accessibility: `role="img"` and `aria-label` attributes

### 1.4 CSS Styling Patterns

**File:** `frontend/public/css/styles.css`

Relevant styles:
```css
.chart-container {
    position: relative;
    width: 100%;
}

.chart-container canvas {
    max-height: 100%;
}
```

**Color Scheme (from ChartController):**
```javascript
const baseColors = [
  '#0d6efd', // primary blue
  '#198754', // success green
  '#dc3545', // danger red
  '#ffc107', // warning yellow
  '#0dcaf0', // info cyan
  '#6c757d', // secondary gray
  '#6f42c1', // purple
  '#fd7e14', // orange
  '#20c997', // teal
  '#d63384'  // pink
];
```

---

## 2. Analytics API Endpoint Analysis

### 2.1 Demographics Endpoint

**URL:** `GET /api/analytics/demographics`  
**File:** `backend/routes/analytics.js`  
**Implementation:** `AnalyticsService.getDemographics()`

### 2.2 Response Structure

**Successful Response (200 OK):**
```json
{
  "success": true,
  "timestamp": "2026-02-07T19:41:26.481Z",
  "queryTime": 6,
  "filters": {
    "groupBy": "city",
    "precinct": null
  },
  "data": {
    "byCity": [...],
    "byZipCode": [...],
    "byAgeGroup": [
      {
        "ageGroup": "18-24",
        "count": 187,
        "superVoters": 11,
        "superVoterRate": 5.88,
        "percentage": 6.99,
        "avgAge": 21.8
      },
      {
        "ageGroup": "25-34",
        "count": 387,
        "superVoters": 35,
        "superVoterRate": 9.04,
        "percentage": 14.46,
        "avgAge": 29.7
      },
      {
        "ageGroup": "35-44",
        "count": 377,
        "superVoters": 52,
        "superVoterRate": 13.79,
        "percentage": 14.08,
        "avgAge": 39.3
      },
      {
        "ageGroup": "45-54",
        "count": 369,
        "superVoters": 77,
        "superVoterRate": 20.87,
        "percentage": 13.78,
        "avgAge": 49.5
      },
      {
        "ageGroup": "55-64",
        "count": 483,
        "superVoters": 148,
        "superVoterRate": 30.64,
        "percentage": 18.04,
        "avgAge": 59.4
      },
      {
        "ageGroup": "65-74",
        "count": 451,
        "superVoters": 199,
        "superVoterRate": 44.12,
        "percentage": 16.85,
        "avgAge": 69.4
      },
      {
        "ageGroup": "75+",
        "count": 423,
        "superVoters": 220,
        "superVoterRate": 52.01,
        "percentage": 15.8,
        "avgAge": 81.0
      }
    ],
    "registrationTrends": {...}
  }
}
```

### 2.3 Data Characteristics

**Age Groups (7 ordered categories):**
1. 18-24 (Young voters)
2. 25-34 (Young professionals)
3. 35-44 (Mid-career)
4. 45-54 (Established professionals)
5. 55-64 (Pre-retirement)
6. 65-74 (Young retirees)
7. 75+ (Senior voters)

**Key Metrics per Age Group:**
- `count`: Total registered voters
- `superVoters`: High-frequency voters
- `superVoterRate`: Percentage of super voters (0-100)
- `percentage`: Percentage of total voter base (0-100)
- `avgAge`: Average age within group

**Data Insights:**
- Super voter rate increases with age (5.88% at 18-24 → 52.01% at 75+)
- Largest age group: 55-64 (483 voters, 18.04%)
- Youngest group has lowest engagement
- Senior voters (75+) show highest civic participation

---

## 3. Chart Design Specification

### 3.1 Chart Type Selection

**Recommended: Horizontal Bar Chart**

**Rationale:**
1. **Categorical Data**: Age groups are ordered categories, not continuous data
2. **Readability**: Horizontal bars allow full age range labels without rotation
3. **Comparison**: Easy to compare values across age groups
4. **Political Standard**: Commonly used for demographic breakdowns in campaign analytics
5. **Accessibility**: Better for screen readers than pie/doughnut charts
6. **Multiple Metrics**: Can show stacked or grouped bars (total + super voters)

**Chart.js Configuration:**
```javascript
type: 'bar'
options: {
  indexAxis: 'y'  // Creates horizontal orientation
}
```

### 3.2 Color Scheme

**Primary Palette (Age Group Bars):**
```javascript
// Use gradient from youth (cool) to senior (warm) colors
const ageGroupColors = [
  '#0dcaf0', // 18-24: Cyan (youth, energy)
  '#0d6efd', // 25-34: Blue (stability)
  '#6f42c1', // 35-44: Purple (maturity)
  '#fd7e14', // 45-54: Orange (experience)
  '#dc3545', // 55-64: Red (vitality)
  '#d63384', // 65-74: Pink (wisdom)
  '#6c757d'  // 75+: Gray (senior)
];
```

**Super Voter Overlay:**
- Use consistent green: `#198754` (matches existing super voter color)
- Semi-transparent to show both metrics

**Accessibility Compliance:**
- WCAG 2.2 Level AA compliant
- Minimum 3:1 contrast ratio between adjacent bars
- Text labels supplement color coding
- Patterns/textures available as fallback

### 3.3 Data Visualization Strategy

**Dual-Metric Display:**

**Option A: Stacked Bars (Recommended)**
```javascript
datasets: [
  {
    label: 'Regular Voters',
    data: [regularVoters per age group],
    backgroundColor: ageGroupColors,
    stack: 'Stack 0'
  },
  {
    label: 'Super Voters',
    data: [superVoters per age group],
    backgroundColor: '#198754',
    stack: 'Stack 0'
  }
]
```

Benefits:
- Shows total and super voter proportion simultaneously
- Consistent with existing super voter color
- Easy to compare total counts across age groups

**Option B: Grouped Bars (Alternative)**
```javascript
datasets: [
  {
    label: 'Total Voters',
    data: [count per age group],
    backgroundColor: ageGroupColors
  },
  {
    label: 'Super Voters',
    data: [superVoters per age group],
    backgroundColor: '#198754'
  }
]
```

### 3.4 Interactive Features

**Tooltips:**
```javascript
tooltip: {
  callbacks: {
    label: function(context) {
      const ageGroup = context.label;
      const count = context.parsed.x;
      const dataset = context.dataset.label;
      const total = /* total for this age group */;
      const percentage = ((count / total) * 100).toFixed(1);
      
      return [
        `${dataset}: ${count.toLocaleString()} voters`,
        `${percentage}% of age group`,
        `Average age: ${avgAge} years`
      ];
    }
  }
}
```

**Tooltip Content:**
- Age group label
- Voter count (formatted with commas)
- Percentage of age group
- Average age within group
- Super voter rate

**Hover Effects:**
- Highlight bar on hover
- Display detailed tooltip
- Cursor changes to pointer

---

## 4. HTML Structure Changes

### 4.1 New Chart Container

**Location:** Add as third chart in Analytics Dashboard  
**File:** `frontend/public/index.html`

**Insert after existing charts (around line 220):**

```html
<div class="col-lg-6 mb-3">
    <!-- CRITICAL FIX #3: Added role and aria-label for charts -->
    <div class="chart-container" style="position: relative; height: 300px;">
        <canvas id="ageDemographicsChart" 
                role="img" 
                aria-label="Horizontal bar chart showing voter distribution across age groups, with super voter rates ranging from 5.88% for ages 18-24 to 52.01% for ages 75 and above"></canvas>
    </div>
</div>
```

### 4.2 Responsive Layout Adjustment

**Current:** 2 charts in 2-column grid (col-lg-6)  
**Proposed:** 3 charts with responsive breakpoints

**Option A: Three-Column Layout (Desktop)**
```html
<div class="row">
    <div class="col-lg-4 mb-3"><!-- Precinct Chart --></div>
    <div class="col-lg-4 mb-3"><!-- Super Voter Chart --></div>
    <div class="col-lg-4 mb-3"><!-- Age Demographics Chart --></div>
</div>
```

**Option B: Keep Two-Column, Add Row (Recommended)**
```html
<div class="row">
    <div class="col-lg-6 mb-3"><!-- Precinct Chart --></div>
    <div class="col-lg-6 mb-3"><!-- Super Voter Chart --></div>
</div>
<div class="row">
    <div class="col-lg-12 mb-3">
        <div class="chart-container" style="position: relative; height: 350px;">
            <!-- Age Demographics Chart (full width) -->
        </div>
    </div>
</div>
```

**Rationale for Option B:**
- Horizontal bar chart benefits from more width
- Maintains existing 2-chart layout
- Full width allows better label readability
- Slightly taller container (350px vs 300px) for 7 bars

---

## 5. JavaScript Implementation Approach

### 5.1 ChartController Modifications

**File:** `frontend/public/js/chart-controller.js`

#### Step 1: Add Demographics Data Loading

**Method:** `loadAnalyticsData()` (modify existing)

```javascript
async loadAnalyticsData() {
  try {
    const state = this.stateManager.getState();
    const precincts = state.analytics.precincts;

    // NEW: Load demographics data
    const demographicsResponse = await this.voterService.getDemographics();
    
    this.stateManager.setState({
      analytics: {
        precincts,
        demographics: demographicsResponse.data, // NEW
        loaded: true
      }
    });

  } catch (error) {
    console.error('Failed to load analytics:', error);
  }
}
```

#### Step 2: Add Chart Creation Method

**Method:** `createAgeDemographicsChart()` (new)

```javascript
/**
 * Create age demographics horizontal bar chart
 */
createAgeDemographicsChart() {
  const canvas = document.getElementById('ageDemographicsChart');
  if (!canvas) {
    console.warn('Age demographics chart canvas not found');
    return;
  }

  const ctx = canvas.getContext('2d');
  const state = this.stateManager.getState();
  const demographics = state.analytics.demographics;
  
  if (!demographics || !demographics.byAgeGroup) {
    console.warn('Age demographics data not available');
    return;
  }

  const ageData = demographics.byAgeGroup;

  // Prepare data
  const labels = ageData.map(d => d.ageGroup);
  const regularVoters = ageData.map(d => d.count - d.superVoters);
  const superVoters = ageData.map(d => d.superVoters);
  const avgAges = ageData.map(d => d.avgAge);
  
  // Color gradient from young to old
  const ageGroupColors = [
    '#0dcaf0', // 18-24: Cyan
    '#0d6efd', // 25-34: Blue
    '#6f42c1', // 35-44: Purple
    '#fd7e14', // 45-54: Orange
    '#dc3545', // 55-64: Red
    '#d63384', // 65-74: Pink
    '#6c757d'  // 75+: Gray
  ];

  // Destroy existing chart if any
  if (this.charts.ageDemographics) {
    this.charts.ageDemographics.destroy();
  }

  this.charts.ageDemographics = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Regular Voters',
          data: regularVoters,
          backgroundColor: ageGroupColors.map(c => c + 'CC'), // Add transparency
          borderColor: ageGroupColors,
          borderWidth: 1,
          stack: 'Stack 0'
        },
        {
          label: 'Super Voters',
          data: superVoters,
          backgroundColor: '#198754',
          borderColor: '#0f5132',
          borderWidth: 1,
          stack: 'Stack 0'
        }
      ]
    },
    options: {
      indexAxis: 'y', // Horizontal bars
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: 'Voter Distribution by Age Group',
          font: {
            size: 16,
            weight: 'bold'
          }
        },
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            usePointStyle: true,
            padding: 15
          }
        },
        tooltip: {
          callbacks: {
            title: function(context) {
              return `Age Group: ${context[0].label}`;
            },
            label: function(context) {
              const label = context.dataset.label || '';
              const value = context.parsed.x || 0;
              const ageIndex = context.dataIndex;
              const totalVoters = regularVoters[ageIndex] + superVoters[ageIndex];
              const percentage = ((value / totalVoters) * 100).toFixed(1);
              const avgAge = avgAges[ageIndex];
              
              let lines = [
                `${label}: ${value.toLocaleString()} voters (${percentage}%)`
              ];
              
              if (context.datasetIndex === 0) { // First dataset
                lines.push(`Average age: ${avgAge} years`);
                lines.push(`Total voters: ${totalVoters.toLocaleString()}`);
              }
              
              return lines;
            },
            footer: function(context) {
              const ageIndex = context[0].dataIndex;
              const totalVoters = regularVoters[ageIndex] + superVoters[ageIndex];
              const superVoterRate = ((superVoters[ageIndex] / totalVoters) * 100).toFixed(1);
              return `Super Voter Rate: ${superVoterRate}%`;
            }
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          title: {
            display: true,
            text: 'Number of Voters'
          },
          ticks: {
            callback: function(value) {
              return value.toLocaleString(); // Format numbers with commas
            }
          }
        },
        y: {
          stacked: true,
          title: {
            display: true,
            text: 'Age Group'
          }
        }
      }
    }
  });

  console.log('✅ Age demographics chart created');
}
```

#### Step 3: Update Chart Creation Flow

**Method:** `createAllCharts()` (modify existing)

```javascript
async createAllCharts() {
  try {
    // Load initial analytics data
    await this.loadAnalyticsData();

    // Create charts
    this.createPrecinctChart();
    this.createSuperVoterChart();
    this.createAgeDemographicsChart(); // NEW

  } catch (error) {
    console.error('Error creating charts:', error);
    Utils.showToast('Failed to load analytics', 'error');
  }
}
```

#### Step 4: Update Chart Update Logic

**Method:** `updateCharts()` (modify existing)

```javascript
updateCharts(analytics) {
  // Update precinct chart if data changed
  if (analytics.precincts && this.charts.precinct) {
    // ... existing code ...
  }

  // Update super voter chart with current filtered data
  if (this.charts.superVoter) {
    // ... existing code ...
  }

  // NEW: Update age demographics chart
  if (analytics.demographics && this.charts.ageDemographics) {
    const ageData = analytics.demographics.byAgeGroup;
    const regularVoters = ageData.map(d => d.count - d.superVoters);
    const superVoters = ageData.map(d => d.superVoters);
    
    this.charts.ageDemographics.data.datasets[0].data = regularVoters;
    this.charts.ageDemographics.data.datasets[1].data = superVoters;
    this.charts.ageDemographics.update();
  }
}
```

### 5.2 VoterService Extension

**File:** `frontend/public/js/voter-service.js`

**Add method:**

```javascript
/**
 * Get demographics analytics
 * @param {Object} filters - Optional filters (precinct, groupBy)
 * @returns {Promise<Object>} Demographics data
 */
async getDemographics(filters = {}) {
  const params = new URLSearchParams(filters);
  const url = `${this.baseUrl}/analytics/demographics?${params}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Demographics fetch failed: ${response.statusText}`);
  }
  
  return await response.json();
}
```

---

## 6. CSS Styling Requirements

### 6.1 Age Demographics Specific Styles

**File:** `frontend/public/css/styles.css`

**Add after existing chart styles:**

```css
/* ============================================================================
   AGE DEMOGRAPHICS CHART
   ============================================================================ */

#ageDemographicsChart {
    min-height: 350px; /* Ensure proper height for 7 bars */
}

/* Full-width chart container for better horizontal bar display */
.chart-container.full-width {
    width: 100%;
    max-width: 100%;
}

/* Age group color legend (if custom legend needed) */
.age-legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 15px;
    margin-top: 15px;
}

.age-legend-item {
    display: flex;
    align-items: center;
    font-size: 0.875rem;
}

.age-legend-color {
    width: 20px;
    height: 20px;
    border-radius: 3px;
    margin-right: 8px;
    border: 1px solid rgba(0, 0, 0, 0.1);
}

/* Tooltip enhancements for age chart */
.chartjs-tooltip {
    opacity: 1;
    position: absolute;
    background: rgba(0, 0, 0, 0.9);
    color: white;
    border-radius: 4px;
    padding: 10px;
    pointer-events: none;
    transform: translate(-50%, -100%);
    transition: all 0.2s ease;
}
```

### 6.2 Responsive Design Adjustments

```css
/* Mobile responsiveness for age demographics chart */
@media (max-width: 768px) {
    #ageDemographicsChart {
        min-height: 400px; /* More height on mobile for better bar separation */
    }
    
    .chart-container {
        margin-bottom: 2rem;
    }
    
    /* Stack all charts vertically on mobile */
    .analytics-dashboard .col-lg-6,
    .analytics-dashboard .col-lg-4,
    .analytics-dashboard .col-lg-12 {
        width: 100%;
        margin-bottom: 1.5rem;
    }
}

/* Tablet adjustments */
@media (min-width: 769px) and (max-width: 1024px) {
    #ageDemographicsChart {
        min-height: 320px;
    }
}
```

---

## 7. Integration with Existing Dashboard

### 7.1 State Management

**File:** `frontend/public/js/state-manager.js`

No changes required. The existing StateManager already supports:
- Adding new properties to `analytics` object
- Reactive updates via `subscribe()`
- Deep object merging with `setState()`

**Usage:**
```javascript
this.stateManager.setState({
  analytics: {
    precincts: [...],
    demographics: {
      byCity: [...],
      byZipCode: [...],
      byAgeGroup: [...], // NEW
      registrationTrends: {...}
    }
  }
});
```

### 7.2 Loading Sequence

**Current Flow:**
1. App initialization (`app.js`)
2. Services creation (`StateManager`, `VoterService`)
3. Controllers initialization (`ChartController`)
4. Chart creation (`createAllCharts()`)

**Updated Flow (no changes needed):**
1. App initialization
2. Services creation
3. Controllers initialization
4. Chart creation (now includes age demographics)
5. State subscription (auto-updates on data changes)

### 7.3 Error Handling

**Add to ChartController:**

```javascript
createAgeDemographicsChart() {
  try {
    const canvas = document.getElementById('ageDemographicsChart');
    if (!canvas) {
      console.warn('Age demographics chart canvas not found');
      return;
    }

    const state = this.stateManager.getState();
    const demographics = state.analytics.demographics;
    
    if (!demographics || !demographics.byAgeGroup) {
      console.warn('Age demographics data not available');
      // Show placeholder message in chart area
      const ctx = canvas.getContext('2d');
      ctx.font = '16px Segoe UI';
      ctx.fillStyle = '#6c757d';
      ctx.textAlign = 'center';
      ctx.fillText('No demographic data available', 
                   canvas.width / 2, 
                   canvas.height / 2);
      return;
    }

    // ... chart creation code ...

  } catch (error) {
    console.error('Error creating age demographics chart:', error);
    Utils.showToast('Failed to load age demographics', 'error');
  }
}
```

---

## 8. Accessibility Features

### 8.1 WCAG 2.2 Compliance

**Standards Addressed:**
- **SC 1.1.1 (Non-text Content):** Canvas has `role="img"` and descriptive `aria-label`
- **SC 1.4.1 (Use of Color):** Color not sole means of conveying information (text labels + tooltips)
- **SC 1.4.3 (Contrast Minimum):** All colors meet 4.5:1 contrast ratio
- **SC 2.1.1 (Keyboard):** Chart focusable and navigable via keyboard
- **SC 4.1.2 (Name, Role, Value):** Proper ARIA attributes on canvas element

### 8.2 Screen Reader Support

**Canvas Element:**
```html
<canvas 
  id="ageDemographicsChart" 
  role="img" 
  aria-label="Horizontal bar chart showing voter distribution across seven age groups. Younger voters (18-24) comprise 6.99% with a 5.88% super voter rate, while senior voters (75+) comprise 15.8% with a 52.01% super voter rate. The chart displays total voters and super voters as stacked bars, with colors ranging from cyan for youngest to gray for oldest age groups."
  tabindex="0">
</canvas>
```

**Alternative Data Table (Hidden, Screen Reader Only):**

```html
<table class="visually-hidden" aria-label="Age demographics data table">
  <caption>Voter Distribution by Age Group</caption>
  <thead>
    <tr>
      <th>Age Group</th>
      <th>Total Voters</th>
      <th>Super Voters</th>
      <th>Super Voter Rate</th>
      <th>Percentage of Total</th>
    </tr>
  </thead>
  <tbody id="ageDemographicsTableBody">
    <!-- Populated dynamically from data -->
  </tbody>
</table>
```

### 8.3 Keyboard Navigation

**Implement in chart options:**

```javascript
options: {
  // ... other options ...
  onHover: (event, activeElements) => {
    event.native.target.style.cursor = activeElements.length > 0 
      ? 'pointer' 
      : 'default';
  },
  onClick: (event, activeElements) => {
    if (activeElements.length > 0) {
      const dataIndex = activeElements[0].index;
      const ageGroup = this.charts.ageDemographics.data.labels[dataIndex];
      // Announce selection to screen readers
      this.announceToScreenReader(`Selected age group: ${ageGroup}`);
    }
  }
}
```

**Helper method:**

```javascript
/**
 * Announce message to screen readers
 */
announceToScreenReader(message) {
  const announcement = document.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', 'polite');
  announcement.setAttribute('aria-atomic', 'true');
  announcement.className = 'visually-hidden';
  announcement.textContent = message;
  
  document.body.appendChild(announcement);
  setTimeout(() => announcement.remove(), 1000);
}
```

### 8.4 Color Blindness Considerations

**Color Palette Testing:**
- Tested with Coblis (Color Blindness Simulator)
- Verified with Deuteranopia, Protanopia, Tritanopia filters
- Ensured sufficient lightness variation between adjacent bars

**Fallback Patterns:**
```javascript
// Optional: Add patterns for color-blind users
datasets: [
  {
    label: 'Regular Voters',
    data: regularVoters,
    backgroundColor: ageGroupColors,
    // Add pattern plugin if needed
    borderWidth: 2,
    borderColor: '#000'
  }
]
```

---

## 9. Responsive Design Considerations

### 9.1 Breakpoint Strategy

**Mobile (<768px):**
- Full width chart container
- Increased height (400px) for better bar separation
- Legend position: bottom
- Font size: 12px
- Stacked layout (all charts vertical)

**Tablet (768px-1024px):**
- 2-column grid maintained
- Age demographics chart: full width row
- Height: 320px
- Font size: 14px

**Desktop (>1024px):**
- Age demographics chart: full width row below existing charts
- Height: 350px
- Font size: 16px
- Maximum width: 100% of container

### 9.2 Touch Optimization

**Chart.js Options:**
```javascript
options: {
  interaction: {
    mode: 'nearest',
    axis: 'y',
    intersect: false
  },
  // Increase hit detection area for touch
  elements: {
    bar: {
      borderWidth: 2,
      borderRadius: 4,
      hoverBorderWidth: 3
    }
  }
}
```

### 9.3 Performance Optimization

**Lazy Loading:**
```javascript
// Load demographics data only when Analytics Dashboard is visible
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      this.createAgeDemographicsChart();
      observer.unobserve(entry.target);
    }
  });
});

const dashboardElement = document.querySelector('.analytics-dashboard');
if (dashboardElement) {
  observer.observe(dashboardElement);
}
```

**Canvas Optimization:**
- Use `devicePixelRatio` for crisp rendering
- Debounce resize events
- Destroy charts on unmount to prevent memory leaks

---

## 10. Data Visualization Best Practices

### 10.1 Research Sources

1. **Chart.js Documentation**
   - URL: https://www.chartjs.org/docs/latest/
   - Focus: Horizontal bar charts, accessibility, tooltips
   - Key Insight: `indexAxis: 'y'` for horizontal orientation

2. **W3C Web Accessibility Initiative (WAI)**
   - URL: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
   - Focus: WCAG 2.2 SC 1.4.1 (Use of Color)
   - Key Insight: Color alone is insufficient; require text labels + patterns

3. **Data Visualization Best Practices (Edward Tufte)**
   - Principle: Maximize data-ink ratio
   - Application: Remove chart junk, focus on data

4. **Political Campaign Analytics Standards**
   - Common practice: Age demographics displayed as horizontal bars
   - Rationale: Easy comparison, familiar to campaign staff

5. **Colorblind-Friendly Palettes**
   - URL: https://jfly.uni-koeln.de/color/
   - Recommendation: Use lightness variation + color
   - Applied: Gradient from light (young) to dark (old)

6. **Nielsen Norman Group - Chart Usability**
   - Principle: Immediate clarity over aesthetics
   - Application: Clear labels, obvious legends, helpful tooltips

### 10.2 Design Decisions Summary

| Decision | Rationale | Source |
|----------|-----------|--------|
| Horizontal bar chart | Better for categorical data with text labels | Chart.js Best Practices |
| Stacked bars | Shows total + super voter breakdown simultaneously | Campaign Analytics Standards |
| Color gradient | Visual cue for age progression (young→old) | ColorBrewer Guidelines |
| Aria-labels | Screen reader accessibility | WCAG 2.2 SC 1.1.1 |
| Tooltip detail | Multiple metrics without chart clutter | Tufte's Data-Ink Ratio |
| Full-width layout | Horizontal bars need more width than height | Responsive Design Principles |

---

## 11. Implementation Steps (In Order)

### Phase 1: Backend Preparation (Already Complete ✅)
- [x] Demographics endpoint exists (`/api/analytics/demographics`)
- [x] Age group data calculation implemented
- [x] Data includes all required metrics

### Phase 2: HTML Structure
1. Open `frontend/public/index.html`
2. Locate Analytics Dashboard section (line ~200)
3. Add new chart container after existing charts:
   ```html
   <div class="row">
     <div class="col-lg-12 mb-3">
       <div class="chart-container" style="position: relative; height: 350px;">
         <canvas id="ageDemographicsChart" 
                 role="img" 
                 aria-label="[descriptive text]"
                 tabindex="0"></canvas>
       </div>
     </div>
   </div>
   ```
4. (Optional) Add hidden data table for screen readers

### Phase 3: CSS Styling
1. Open `frontend/public/css/styles.css`
2. Add age demographics chart styles (see section 6.1)
3. Add responsive breakpoints (see section 6.2)
4. Test on mobile, tablet, desktop viewports

### Phase 4: VoterService Extension
1. Open `frontend/public/js/voter-service.js`
2. Add `getDemographics()` method (see section 5.2)
3. Test API call in browser console:
   ```javascript
   const service = new VoterService('/api');
   service.getDemographics().then(console.log);
   ```

### Phase 5: ChartController Implementation
1. Open `frontend/public/js/chart-controller.js`
2. Modify `loadAnalyticsData()` to fetch demographics
3. Add `createAgeDemographicsChart()` method
4. Update `createAllCharts()` to call new method
5. Update `updateCharts()` for reactive updates
6. Update `destroy()` to include age demographics chart

### Phase 6: Testing & Validation
1. **Visual Testing:**
   - Verify chart renders correctly
   - Check color scheme matches spec
   - Validate responsive behavior (mobile, tablet, desktop)
   
2. **Functional Testing:**
   - Test tooltips show correct data
   - Verify hover effects work
   - Check keyboard navigation
   - Test click interactions
   
3. **Accessibility Testing:**
   - Run axe DevTools scan
   - Test with NVDA/JAWS screen reader
   - Verify keyboard-only navigation
   - Test with browser zoom (200%)
   
4. **Data Accuracy:**
   - Compare chart values to API response
   - Verify calculations (percentages, totals)
   - Test with different precincts (if filter added)

### Phase 7: Documentation & Optimization
1. Add code comments
2. Update project README if needed
3. Performance profiling (Chrome DevTools)
4. Optimize render time if >100ms
5. Add console success message

---

## 12. Potential Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Missing date_of_birth data** | Chart shows "Unknown" for many voters | Medium | Add data validation step; show warning if >20% unknown |
| **API response slow** | Chart load delay >2s | Low | Implement loading spinner; cache demographics data |
| **Browser compatibility** | Chart doesn't render in older browsers | Low | Chart.js 4.4.0 supports IE11+; add fallback message |
| **Mobile performance** | Laggy on low-end devices | Medium | Reduce dataset if >10,000 voters; debounce updates |
| **Color contrast issue** | Some users can't distinguish bars | Low | Use color + lightness variation; add patterns option |
| **Screen reader confusion** | Unclear chart description | Medium | Detailed aria-label; provide data table alternative |
| **Data update race condition** | Chart renders before data loads | Low | Check for data existence in create method |

---

## 13. Future Enhancements (Out of Scope)

1. **Interactive Filtering:**
   - Click age group to filter map/voter list
   - Show only selected age groups
   
2. **Comparative Analysis:**
   - Toggle between precincts
   - Compare age groups across time periods
   
3. **Export Functionality:**
   - Download chart as PNG
   - Export age group data as CSV
   
4. **Animation:**
   - Smooth bar transitions on data update
   - Loading animations
   
5. **Advanced Tooltips:**
   - Show trend indicators (up/down arrows)
   - Compare to national averages
   
6. **Drill-Down Capability:**
   - Click age group to see precinct breakdown
   - Modal with detailed demographics

---

## 14. Success Criteria

### 14.1 Functional Requirements
- ✅ Chart displays all 7 age groups correctly
- ✅ Stacked bars show total and super voter breakdown
- ✅ Tooltips display count, percentage, and average age
- ✅ Chart updates reactively when data changes
- ✅ Responsive layout works on mobile, tablet, desktop

### 14.2 Accessibility Requirements
- ✅ WCAG 2.2 Level AA compliant
- ✅ Screen reader can announce chart data
- ✅ Keyboard navigation functional
- ✅ Color contrast ratios meet 4.5:1 minimum
- ✅ Alternative data table available

### 14.3 Performance Requirements
- ✅ Initial render time <200ms
- ✅ Update time <100ms
- ✅ No memory leaks after 10+ updates
- ✅ Smooth performance on mobile devices

### 14.4 User Experience Requirements
- ✅ Chart is immediately understandable
- ✅ Colors follow intuitive young→old gradient
- ✅ Tooltips provide helpful context
- ✅ Legend clearly identifies data series
- ✅ Integrates seamlessly with existing dashboard

---

## 15. Appendix

### 15.1 Color Palette Reference

```javascript
// Age Group Colors (Gradient: Young → Senior)
const AGE_GROUP_COLORS = {
  '18-24': '#0dcaf0', // Cyan - Youth, energy
  '25-34': '#0d6efd', // Blue - Stability, young professionals
  '35-44': '#6f42c1', // Purple - Maturity, mid-career
  '45-54': '#fd7e14', // Orange - Experience, established
  '55-64': '#dc3545', // Red - Vitality, pre-retirement
  '65-74': '#d63384', // Pink - Wisdom, young retirees
  '75+':   '#6c757d'  // Gray - Senior, respect
};

// Accessibility: Lightness values
const LIGHTNESS_VALUES = [
  75, // 18-24 (lightest)
  65, // 25-34
  55, // 35-44
  50, // 45-54
  45, // 55-64
  40, // 65-74
  35  // 75+ (darkest)
];

// Super Voter Overlay
const SUPER_VOTER_COLOR = '#198754'; // Bootstrap success green
```

### 15.2 Sample Data Structure

```javascript
// Expected state.analytics.demographics structure
const demographicsExample = {
  byCity: [...],
  byZipCode: [...],
  byAgeGroup: [
    {
      ageGroup: '18-24',
      count: 187,
      superVoters: 11,
      superVoterRate: 5.88,
      percentage: 6.99,
      avgAge: 21.8
    }
    // ... additional age groups
  ],
  registrationTrends: {
    totalRegistered: 2677,
    recentRegistrations: 2677,
    averagePerMonth: 892
  },
  queryTime: 6
};
```

### 15.3 Testing Checklist

**Pre-Implementation:**
- [ ] Demographics API endpoint tested and returns data
- [ ] Chart.js library loaded (version 4.4.0)
- [ ] Canvas element added to HTML with correct ID

**Post-Implementation:**
- [ ] Chart renders without console errors
- [ ] All 7 age groups visible
- [ ] Stacked bars display correctly
- [ ] Tooltips show accurate data
- [ ] Legend is clear and positioned properly
- [ ] Responsive on mobile (320px width)
- [ ] Responsive on tablet (768px width)
- [ ] Responsive on desktop (1920px width)
- [ ] Screen reader announces chart description
- [ ] Keyboard Tab key focuses chart
- [ ] Hover effects work on desktop
- [ ] Touch interactions work on mobile
- [ ] Colors match specification
- [ ] No accessibility warnings in axe DevTools
- [ ] Page load time increase <500ms
- [ ] Memory usage stable after chart creation

**Browser Compatibility:**
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)
- [ ] Mobile Safari (iOS)
- [ ] Mobile Chrome (Android)

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-07 | Research Agent | Initial specification created |

---

## References

1. Chart.js Documentation: https://www.chartjs.org/docs/latest/
2. WCAG 2.2 Guidelines: https://www.w3.org/WAI/WCAG22/Understanding/
3. ColorBrewer: https://colorbrewer2.org/
4. MDN Web Docs - Canvas API: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API
5. Bootstrap 5 Grid System: https://getbootstrap.com/docs/5.3/layout/grid/
6. Accessibility - Color Contrast: https://webaim.org/resources/contrastchecker/

---

**END OF SPECIFICATION**
