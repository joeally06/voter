# File Upload Interface Specification
## Voter Outreach Platform - Frontend Upload UI

**Created:** February 7, 2026  
**Phase:** 4.5 - Upload Interface Enhancement  
**Priority:** High  
**Status:** Specification Complete

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Backend API Endpoints](#backend-api-endpoints)
3. [Party Code System](#party-code-system)
4. [Research Findings](#research-findings)
5. [Proposed UI Design](#proposed-ui-design)
6. [Implementation Steps](#implementation-steps)
7. [User Flow](#user-flow)
8. [Integration Points](#integration-points)
9. [Accessibility Considerations](#accessibility-considerations)
10. [Dependencies and Requirements](#dependencies-and-requirements)
11. [Potential Risks and Mitigations](#potential-risks-and-mitigations)

---

## Current State Analysis

### What Exists

**Frontend Structure:**
- Modern responsive layout using Bootstrap 5.3.2
- Modular JavaScript architecture:
  - `app.js` - Main application controller
  - `state-manager.js` - Centralized state management
  - `voter-service.js` - API communication layer
  - `map-controller.js` - Google Maps integration
  - `filter-controller.js` - Filter management
  - `chart-controller.js` - Analytics charts
  - `utils.js` - Utility functions (toast notifications, CSV export, etc.)

**Current UI Features:**
- Interactive voter map with markers
- Advanced filtering (precinct, super voter, geocoded status)
- Analytics dashboard with charts
- CSV export functionality
- Responsive design (desktop + mobile offcanvas)
- Accessibility features (ARIA labels, keyboard navigation)
- Phase progress indicator
- System status dashboard

**Backend Capabilities:**
- Two upload endpoints already exist:
  - `POST /api/upload/dbf` - For DBF voter files
  - `POST /api/upload/csv` - For CSV voter files
- Upload history tracking (`GET /api/upload/history`)
- Import job status monitoring (`GET /api/upload/:id`)
- Error logging and retrieval (`GET /api/upload/:id/errors`)
- Async file processing with progress tracking
- Three import modes: skip, replace, flag

### What's Missing

**No Frontend Upload Interface:**
- NO file selection UI component
- NO drag-and-drop zone
- NO file upload progress display
- NO upload history viewer
- NO error message display for failed imports
- NO file validation feedback
- NO import mode selector
- Users currently must use API directly or backend tools to upload data

**Business Impact:**
- Election Commission staff cannot easily update voter data
- Requires technical knowledge to use backend upload endpoints
- No visibility into upload status or errors
- Manual file management is error-prone

---

## Backend API Endpoints

### Available Endpoints

#### 1. Upload DBF File
```http
POST /api/upload/dbf
Content-Type: multipart/form-data

Body Parameters:
- file: File (required) - DBF voter data file
- description: String (optional) - Upload description
- importMode: String (default: 'replace') - One of: skip, replace, flag

Response (Success - 200):
{
  "success": true,
  "message": "File uploaded and queued for processing",
  "import": {
    "id": 123,
    "filename": "1770428876047_test-upload.dbf",
    "originalName": "test-upload.dbf",
    "size": 2048576,
    "status": "pending",
    "progress": {
      "processed": 0,
      "successful": 0,
      "failed": 0,
      "total": null
    },
    "startTime": "2026-02-07T10:30:00.000Z"
  }
}

Response (Error - 400):
{
  "success": false,
  "error": "No file uploaded",
  "message": "Please upload a .dbf file"
}
```

#### 2. Upload CSV File
```http
POST /api/upload/csv
Content-Type: multipart/form-data

Body Parameters:
- file: File (required) - CSV voter data file
- description: String (optional) - Upload description
- importMode: String (default: 'replace') - One of: skip, replace, flag
- hasHeaders: Boolean (default: true) - CSV has header row

Response: Same as DBF upload
```

#### 3. Get Upload Status
```http
GET /api/upload/:id

Response:
{
  "success": true,
  "data": {
    "id": 123,
    "filename": "1770428876047_test-upload.dbf",
    "fileSize": 2048576,
    "status": "completed|pending|failed",
    "progress": {
      "processed": 1000,
      "successful": 995,
      "failed": 5,
      "percent": 100.0
    },
    "startTime": "2026-02-07T10:30:00.000Z",
    "endTime": "2026-02-07T10:35:00.000Z",
    "errorMessage": null,
    "errors": [
      {
        "recordNumber": 42,
        "errorType": "VALIDATION",
        "message": "Missing required field: voter_id"
      }
    ]
  }
}
```

#### 4. Get Upload History
```http
GET /api/upload/history?limit=20&status=completed

Response:
{
  "success": true,
  "count": 20,
  "data": [
    {
      "id": 123,
      "filename": "...",
      "file_size": 2048576,
      "status": "completed",
      "records_processed": 1000,
      "records_successful": 995,
      "records_failed": 5,
      "start_time": "2026-02-07T10:30:00.000Z",
      "end_time": "2026-02-07T10:35:00.000Z"
    }
  ]
}
```

#### 5. Get Upload Errors
```http
GET /api/upload/:id/errors?limit=100

Response:
{
  "success": true,
  "count": 5,
  "errors": [
    {
      "recordNumber": 42,
      "errorType": "VALIDATION",
      "message": "Missing required field: voter_id",
      "timestamp": "2026-02-07T10:32:15.000Z"
    }
  ]
}
```

### File Constraints

**DBF Files:**
- Extension: `.dbf` only
- Max size: 100MB
- Filename validation: alphanumeric, spaces, hyphens, underscores only
- Security: Path traversal prevention

**CSV Files:**
- Extension: `.csv` only
- Max size: 100MB
- Same filename validation
- Optional headers detection

---

## Party Code System

### Overview
The party code system is used to track voter participation in primary elections, indicating which party's primary they voted in.

### Party Codes
- `R` - Republican primary voter
- `D` - Democratic primary voter
- `I` - Independent primary voter (rare)
- `null` - Non-primary election or no party affiliation

### Election History Format
Each voter record can have multiple election history entries stored in `E_*` columns (E_1, E_2, E_3, etc.) in DBF files.

### Code Patterns (from dbf-parser.js)

#### Republican Patterns
- `R` - Voted in Republican primary
- `RE` - Early voted in Republican primary

#### Democratic Patterns
- `D` - Voted in Democratic primary
- `DE` - Early voted in Democratic primary

#### Independent Patterns
- `I` - Voted in Independent primary
- `IE` - Early voted in Independent primary

#### General Election Patterns
- `Y`, `YES`, `1` - Voted in general election (no party)
- `E` - Early voted in general election
- `YE` - Alternative early vote indicator
- `N`, `NO`, `0` - Did not vote

### Data Structure
```javascript
{
  electionCode: "E_1",        // Column identifier
  voted: true,                 // Whether voter participated
  partyCode: "R",             // Party code (R/D/I) or null
  earlyVoted: false           // Whether they voted early
}
```

### Usage in Application
- Analytics: Track party participation trends
- Filtering: Identify primary voters by party
- Reporting: Generate party-specific turnout statistics
- Super Voter Detection: Voters who participate across multiple elections

---

## Research Findings

### Source 1: MDN Web Docs - File API
**URL:** https://developer.mozilla.org/en-US/docs/Web/API/File_API/Using_files_from_web_applications

**Key Findings:**
1. **File Selection Methods:**
   - Standard `<input type="file">` with `multiple` and `accept` attributes
   - Hidden input with custom button/label trigger
   - Drag-and-drop with `dragenter`, `dragover`, `drop` events
   - Both methods can coexist for progressive enhancement

2. **File API Capabilities:**
   - Access file metadata: name, size, type (MIME)
   - Read file contents with FileReader API
   - Create object URLs for preview
   - FormData API for multipart uploads

3. **Best Practice:**
   - Always provide fallback `<input type="file">` for accessibility
   - Use `accept` attribute to filter file types client-side
   - Validate file size before upload
   - Preview files when appropriate (images, documents)

4. **Security:**
   - Browser sandboxing prevents access to file paths
   - File data only accessible after user selection
   - Always validate on server-side

### Source 2: Smashing Magazine - Drag-and-Drop Uploader
**URL:** https://www.smashingmagazine.com/2018/01/drag-drop-file-uploader-vanilla-js/

**Key Findings:**
1. **Drag-and-Drop Events:**
   - `dragenter` - Item enters drop zone (highlight zone)
   - `dragover` - Item continues over zone (maintain highlight)
   - `dragleave` - Item leaves zone (remove highlight)
   - `drop` - Item dropped (process files)
   - Must call `preventDefault()` on all events

2. **Visual Feedback:**
   - Add "highlight" class on dragenter/dragover
   - Remove on dragleave/drop
   - Use distinct border color/style for drop zone
   - Provide clear instructions ("Drag files here")

3. **Progress Tracking:**
   - Use HTML5 `<progress>` element
   - XMLHttpRequest provides `upload.progress` event
   - Track both individual file progress and total progress
   - Update UI in real-time

4. **File Preview:**
   - Use FileReader.readAsDataURL() for images
   - Display thumbnails before upload
   - Show file name, size, type
   - Allow removal of selected files

5. **Error Handling:**
   - Validate file type matches accept attribute
   - Check file size before upload
   - Display user-friendly error messages
   - Allow retry for failed uploads

### Source 3: Web Accessibility (WCAG 2.1 Standards)
**Research Areas:** File upload accessibility

**Key Findings:**
1. **Keyboard Navigation:**
   - Hidden file input must remain keyboard-accessible
   - Custom buttons need proper focus indicators
   - Tab order must be logical
   - Support Enter/Space to activate file picker

2. **Screen Reader Support:**
   - ARIA labels for all interactive elements
   - `aria-live` regions for status updates
   - Announce file selection and upload progress
   - Error messages must be programmatically associated

3. **Visual Accessibility:**
   - Sufficient color contrast (4.5:1 minimum)
   - Don't rely on color alone (use icons + text)
   - Support for high contrast mode
   - Visible focus indicators

4. **Instructions:**
   - Clear, concise upload instructions
   - Explain accepted file types and size limits
   - Provide examples when helpful
   - Error messages should suggest corrections

### Source 4: Progressive Web App Patterns
**Research:** Upload UX patterns in modern web apps

**Key Findings:**
1. **Multi-Step Uploads:**
   - Step 1: File selection + validation
   - Step 2: Configure options (import mode)
   - Step 3: Upload with progress
   - Step 4: Results summary

2. **Immediate Feedback:**
   - Show selected files instantly
   - Validate before upload starts
   - Real-time progress indicators
   - Success/error states with icons

3. **Cancellation:**
   - Allow users to cancel in-progress uploads
   - Confirm cancellation to prevent accidents
   - Clean up partial uploads

4. **Multiple Files:**
   - Support batch uploads
   - Show individual file status
   - Allow selective removal
   - Aggregate progress display

### Source 5: Material Design Guidelines
**Research:** File upload component design

**Key Findings:**
1. **Visual Hierarchy:**
   - Primary action (upload) should be prominent
   - Secondary actions (configure) less prominent
   - Tertiary actions (cancel) least prominent
   - Clear separation of steps

2. **Loading States:**
   - Indeterminate spinner while processing
   - Determinate progress bar with percentage
   - Keep user informed of what's happening
   - Estimated time remaining when possible

3. **Micro-interactions:**
   - Smooth transitions between states
   - Subtle animations for feedback
   - Hover states for interactive elements
   - Success animations to celebrate completion

### Source 6: Bootstrap 5 Documentation
**Research:** Using Bootstrap components for upload UI

**Key Findings:**
1. **Form Components:**
   - `.form-control` for custom file styling
   - `.form-select` for dropdowns (import mode)
   - `.form-text` for helper text
   - `.is-invalid` / `.is-valid` for validation states

2. **Progress Component:**
   - `<progress>` element with Bootstrap classes
   - `.progress` container with `.progress-bar`
   - Animated stripes for active uploads
   - Color variants for success/error states

3. **Modal Dialogs:**
   - Upload interface in modal overlay
   - Prevents interaction with background
   - Focused user experience
   - Easy dismiss when complete

4. **Toast Notifications:**
   - Non-blocking success messages
   - Error alerts for failed uploads
   - Auto-dismiss or manual close
   - Positioned to avoid covering content

---

## Proposed UI Design

### Placement Options

**Option 1: Actions Card (Recommended)**
- Add "Upload Data" button to existing Actions card in left sidebar
- Opens modal dialog with upload interface
- Keeps main UI uncluttered
- Consistent with existing design pattern

**Option 2: New Top Bar Action**
- Add upload button to navbar
- Makes upload more discoverable
- May clutter navigation

**Option 3: Dedicated Upload Page**
- Separate route for upload interface
- More space for complex workflows
- Requires additional navigation

**DECISION: Option 1 - Modal Dialog from Actions Card**

### Layout (Modal Dialog)

```
┌─────────────────────────────────────────────────────┐
│  Upload Voter Data                              [X] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌───────────────────────────────────────────────┐ │
│  │                                               │ │
│  │     [📁 Icon]                                 │ │
│  │                                               │ │
│  │     Drag and drop file here                   │ │
│  │     or click to browse                        │ │
│  │                                               │ │
│  │     Accepted formats: .dbf, .csv              │ │
│  │     Maximum size: 100MB                       │ │
│  │                                               │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  Import Mode:                                       │
│  ◉ Replace existing records                        │
│  ○ Skip duplicates                                 │
│  ○ Flag conflicts                                  │
│                                                     │
│  ☑ CSV has header row                              │
│                                                     │
│  ┌─────────────────────────────────────┐           │
│  │ No file selected                    │           │
│  └─────────────────────────────────────┘           │
│                                                     │
│  [Cancel]                    [Upload File]         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Upload Progress View

```
┌─────────────────────────────────────────────────────┐
│  Uploading: voters_2026.dbf                     [X] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Processing file...                                 │
│                                                     │
│  [████████████████░░░░░░░░░░] 65%                   │
│                                                     │
│  Records Processed: 650 / 1000                      │
│  Successful: 645                                    │
│  Failed: 5                                          │
│                                                     │
│  Elapsed: 00:32                                     │
│  Estimated remaining: 00:17                         │
│                                                     │
│                          [Cancel Upload]            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Results View

```
┌─────────────────────────────────────────────────────┐
│  Upload Complete                                [X] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ✓ Successfully processed voters_2026.dbf           │
│                                                     │
│  Summary:                                           │
│  • Total records: 1,000                             │
│  • Successfully imported: 995                       │
│  • Failed: 5                                        │
│  • Duration: 00:49                                  │
│                                                     │
│  ⚠ 5 records failed validation                      │
│  [View Error Details]                               │
│                                                     │
│  [Upload Another File]           [Close]            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Error Details Modal

```
┌─────────────────────────────────────────────────────┐
│  Import Errors                                  [X] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  5 records failed to import:                        │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ Record #42                                  │   │
│  │ Error: Missing required field: voter_id     │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ Record #108                                 │   │
│  │ Error: Invalid ZIP code format              │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ Record #203                                 │   │
│  │ Error: Missing required field: last_name    │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  [Download Error Report]         [Close]            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Components to Create

1. **Upload Modal Component** (`upload-modal`)
   - Bootstrap modal dialog
   - Three states: selection, progress, results
   - State transitions managed by UploadController

2. **Drop Zone Component** (`drop-zone`)
   - Drag-and-drop target area
   - File input trigger
   - Visual feedback (highlight on hover)
   - File validation display

3. **Upload Progress Component** (`upload-progress`)
   - Progress bar with percentage
   - Real-time statistics
   - Cancel button
   - Time estimates

4. **Results Summary Component** (`upload-results`)
   - Success/error summary
   - Link to error details
   - Action buttons (upload another, close)

5. **Upload History Panel** (Future Enhancement)
   - List of recent uploads
   - Status badges (pending, completed, failed)
   - Clickable to view details
   - Accessible from Actions card

---

## Implementation Steps

### Phase 1: HTML Structure

**File:** `frontend/public/index.html`

**Tasks:**
1. Add "Upload Data" button to Actions card (existing sidebar)
   ```html
   <button class="btn btn-sm btn-outline-success" 
           id="uploadBtn" 
           data-bs-toggle="modal" 
           data-bs-target="#uploadModal"
           aria-label="Upload voter data file">
     <i class="bi bi-cloud-upload" aria-hidden="true"></i> Upload Data
   </button>
   ```

2. Add upload modal structure at end of body (before scripts)
   ```html
   <!-- Upload Modal -->
   <div class="modal fade" id="uploadModal" tabindex="-1" 
        aria-labelledby="uploadModalLabel" aria-hidden="true">
     <div class="modal-dialog modal-dialog-centered">
       <div class="modal-content">
         <!-- Modal header -->
         <div class="modal-header">
           <h5 class="modal-title" id="uploadModalLabel">Upload Voter Data</h5>
           <button type="button" class="btn-close" 
                   data-bs-dismiss="modal" 
                   aria-label="Close"></button>
         </div>
         
         <!-- Modal body - File Selection View -->
         <div class="modal-body" id="uploadSelectionView">
           <!-- Drop zone -->
           <div id="dropZone" class="drop-zone" 
                role="button" 
                tabindex="0"
                aria-label="Drag and drop files here or click to browse">
             <div class="drop-zone-content">
               <i class="bi bi-cloud-upload drop-zone-icon" aria-hidden="true"></i>
               <p class="drop-zone-text">Drag and drop file here</p>
               <p class="drop-zone-subtext">or click to browse</p>
               <p class="drop-zone-info text-muted small">
                 Accepted formats: .dbf, .csv<br>
                 Maximum size: 100MB
               </p>
             </div>
             <input type="file" 
                    id="fileInput" 
                    class="visually-hidden" 
                    accept=".dbf,.csv"
                    aria-label="Select voter data file">
           </div>
           
           <!-- Import options -->
           <div class="mt-4">
             <label class="form-label fw-bold">Import Mode</label>
             <div class="form-check">
               <input class="form-check-input" type="radio" 
                      name="importMode" id="modeReplace" 
                      value="replace" checked>
               <label class="form-check-label" for="modeReplace">
                 Replace existing records
                 <small class="text-muted d-block">
                   Update existing voter records with new data
                 </small>
               </label>
             </div>
             <div class="form-check">
               <input class="form-check-input" type="radio" 
                      name="importMode" id="modeSkip" 
                      value="skip">
               <label class="form-check-label" for="modeSkip">
                 Skip duplicates
                 <small class="text-muted d-block">
                   Keep existing records, only add new ones
                 </small>
               </label>
             </div>
             <div class="form-check">
               <input class="form-check-input" type="radio" 
                      name="importMode" id="modeFlag" 
                      value="flag">
               <label class="form-check-label" for="modeFlag">
                 Flag conflicts
                 <small class="text-muted d-block">
                   Mark records that differ from existing data
                 </small>
               </label>
             </div>
           </div>
           
           <!-- CSV options (hidden by default) -->
           <div class="mt-3" id="csvOptions" style="display: none;">
             <div class="form-check">
               <input class="form-check-input" type="checkbox" 
                      id="hasHeaders" checked>
               <label class="form-check-label" for="hasHeaders">
                 CSV file has header row
               </label>
             </div>
           </div>
           
           <!-- Selected file info -->
           <div id="fileInfo" class="mt-4 alert alert-info" 
                style="display: none;" role="status">
             <strong id="fileName">No file selected</strong><br>
             <small id="fileSize" class="text-muted"></small>
             <button type="button" class="btn-close float-end" 
                     id="removeFile"
                     aria-label="Remove selected file"></button>
           </div>
         </div>
         
         <!-- Modal body - Progress View -->
         <div class="modal-body" id="uploadProgressView" style="display: none;">
           <div class="text-center mb-4">
             <h6 id="progressFileName">Uploading...</h6>
           </div>
           
           <div class="mb-3">
             <div class="d-flex justify-content-between mb-2">
               <span id="progressStatus">Processing file...</span>
               <span id="progressPercent">0%</span>
             </div>
             <div class="progress" style="height: 25px;">
               <div id="progressBar" 
                    class="progress-bar progress-bar-striped progress-bar-animated" 
                    role="progressbar" 
                    aria-valuenow="0" 
                    aria-valuemin="0" 
                    aria-valuemax="100"
                    style="width: 0%">
                 0%
               </div>
             </div>
           </div>
           
           <div id="uploadStats" class="mt-3" style="display: none;">
             <div class="row text-center">
               <div class="col-4">
                 <small class="text-muted">Processed</small>
                 <p class="mb-0 fw-bold" id="statsProcessed">0</p>
               </div>
               <div class="col-4">
                 <small class="text-muted">Successful</small>
                 <p class="mb-0 fw-bold text-success" id="statsSuccessful">0</p>
               </div>
               <div class="col-4">
                 <small class="text-muted">Failed</small>
                 <p class="mb-0 fw-bold text-danger" id="statsFailed">0</p>
               </div>
             </div>
           </div>
           
           <div id="uploadTimer" class="mt-3 text-center text-muted small">
             <div>Elapsed: <span id="timerElapsed">00:00</span></div>
             <div id="timerEstimate" style="display: none;">
               Estimated remaining: <span id="timerRemaining">--:--</span>
             </div>
           </div>
         </div>
         
         <!-- Modal body - Results View -->
         <div class="modal-body" id="uploadResultsView" style="display: none;">
           <div class="text-center mb-4">
             <i id="resultIcon" class="bi bi-check-circle-fill text-success" 
                style="font-size: 3rem;" aria-hidden="true"></i>
             <h5 id="resultTitle" class="mt-2">Upload Complete</h5>
             <p id="resultMessage" class="text-muted"></p>
           </div>
           
           <div class="card">
             <div class="card-body">
               <h6 class="card-title">Summary</h6>
               <ul class="list-unstyled mb-0">
                 <li>Total records: <strong id="resultTotal">0</strong></li>
                 <li>Successfully imported: <strong id="resultSuccess" class="text-success">0</strong></li>
                 <li>Failed: <strong id="resultFailed" class="text-danger">0</strong></li>
                 <li>Duration: <strong id="resultDuration">00:00</strong></li>
               </ul>
             </div>
           </div>
           
           <div id="errorSection" class="mt-3 alert alert-warning" 
                style="display: none;" role="alert">
             <i class="bi bi-exclamation-triangle" aria-hidden="true"></i>
             <strong id="errorCount">0</strong> records failed validation
             <button type="button" class="btn btn-sm btn-outline-warning float-end"
                     id="viewErrorsBtn">
               View Error Details
             </button>
           </div>
         </div>
         
         <!-- Modal footer - varies by view -->
         <div class="modal-footer" id="uploadFooter">
           <button type="button" class="btn btn-secondary" 
                   data-bs-dismiss="modal" id="cancelBtn">
             Cancel
           </button>
           <button type="button" class="btn btn-primary" 
                   id="uploadFileBtn" disabled>
             Upload File
           </button>
         </div>
       </div>
     </div>
   </div>
   
   <!-- Error Details Modal -->
   <div class="modal fade" id="errorDetailsModal" tabindex="-1">
     <div class="modal-dialog modal-dialog-scrollable">
       <div class="modal-content">
         <div class="modal-header">
           <h5 class="modal-title">Import Errors</h5>
           <button type="button" class="btn-close" 
                   data-bs-dismiss="modal"></button>
         </div>
         <div class="modal-body">
           <div id="errorDetailsList"></div>
         </div>
         <div class="modal-footer">
           <button type="button" class="btn btn-outline-primary" 
                   id="downloadErrorsBtn">
             <i class="bi bi-download"></i> Download Error Report
           </button>
           <button type="button" class="btn btn-secondary" 
                   data-bs-dismiss="modal">
             Close
           </button>
         </div>
       </div>
     </div>
   </div>
   ```

### Phase 2: CSS Styling

**File:** `frontend/public/css/styles.css`

**Tasks:**
1. Add upload modal specific styles
   ```css
   /* ============================================================================
      UPLOAD MODAL
      ============================================================================ */
   
   /* Drop Zone */
   .drop-zone {
     border: 3px dashed #ccc;
     border-radius: 12px;
     padding: 40px 20px;
     text-align: center;
     cursor: pointer;
     transition: all 0.3s ease;
     background-color: #f8f9fa;
   }
   
   .drop-zone:hover,
   .drop-zone:focus {
     border-color: #0d6efd;
     background-color: #e7f1ff;
   }
   
   .drop-zone.drag-over {
     border-color: #0d6efd;
     background-color: #cfe2ff;
     border-style: solid;
   }
   
   .drop-zone.drag-over .drop-zone-icon {
     transform: scale(1.1);
   }
   
   .drop-zone-icon {
     font-size: 3rem;
     color: #6c757d;
     margin-bottom: 1rem;
     transition: transform 0.2s ease;
   }
   
   .drop-zone:hover .drop-zone-icon {
     color: #0d6efd;
   }
   
   .drop-zone-text {
     font-size: 1.1rem;
     font-weight: 500;
     margin-bottom: 0.5rem;
     color: #495057;
   }
   
   .drop-zone-subtext {
     font-size: 0.9rem;
     color: #6c757d;
     margin-bottom: 1rem;
   }
   
   .drop-zone-info {
     margin-bottom: 0;
   }
   
   /* File Info Display */
   #fileInfo {
     position: relative;
   }
   
   #fileInfo .btn-close {
     position: absolute;
     top: 10px;
     right: 10px;
   }
   
   /* Progress Bar */
   #uploadProgressView .progress {
     height: 25px;
     border-radius: 8px;
   }
   
   #uploadProgressView .progress-bar {
     font-size: 14px;
     line-height: 25px;
     font-weight: 600;
   }
   
   /* Results Icons */
   #resultIcon.success {
     color: #198754;
   }
   
   #resultIcon.error {
     color: #dc3545;
   }
   
   #resultIcon.warning {
     color: #ffc107;
   }
   
   /* Upload Stats Grid */
   #uploadStats .col-4 {
     border-right: 1px solid #dee2e6;
   }
   
   #uploadStats .col-4:last-child {
     border-right: none;
   }
   
   /* Error Details */
   .error-item {
     padding: 12px;
     margin-bottom: 10px;
     border-left: 4px solid #dc3545;
     background-color: #f8d7da;
     border-radius: 4px;
   }
   
   .error-item strong {
     color: #842029;
   }
   
   .error-item small {
     color: #58151c;
   }
   
   /* Responsive Adjustments */
   @media (max-width: 576px) {
     .drop-zone {
       padding: 30px 15px;
     }
     
     .drop-zone-icon {
       font-size: 2rem;
     }
     
     #uploadStats .col-4 {
       border-right: none;
       border-bottom: 1px solid #dee2e6;
       padding-bottom: 10px;
       margin-bottom: 10px;
     }
     
     #uploadStats .col-4:last-child {
       border-bottom: none;
       margin-bottom: 0;
     }
   }
   ```

### Phase 3: JavaScript - Upload Service

**File:** `frontend/public/js/upload-service.js` (NEW)

**Tasks:**
1. Create UploadService class for API communication
   ```javascript
   /**
    * Upload Service
    * Handles file upload API communication
    */
   class UploadService {
     constructor(baseUrl = '/api/upload') {
       this.baseUrl = baseUrl;
     }
     
     /**
      * Upload a file to the server
      * @param {File} file - File to upload
      * @param {Object} options - Upload options
      * @param {Function} onProgress - Progress callback
      * @returns {Promise<Object>} Upload response
      */
     async uploadFile(file, options = {}, onProgress = null) {
       const formData = new FormData();
       formData.append('file', file);
       
       if (options.importMode) {
         formData.append('importMode', options.importMode);
       }
       
       if (options.hasHeaders !== undefined) {
         formData.append('hasHeaders', options.hasHeaders);
       }
       
       const endpoint = file.name.toLowerCase().endsWith('.dbf') 
         ? `${this.baseUrl}/dbf` 
         : `${this.baseUrl}/csv`;
       
       return new Promise((resolve, reject) => {
         const xhr = new XMLHttpRequest();
         
         // Progress tracking
         if (onProgress) {
           xhr.upload.addEventListener('progress', (e) => {
             if (e.lengthComputable) {
               const percent = Math.round((e.loaded / e.total) * 100);
               onProgress({ type: 'upload', percent, loaded: e.loaded, total: e.total });
             }
           });
         }
         
         // Success/Error handling
         xhr.addEventListener('load', () => {
           if (xhr.status >= 200 && xhr.status < 300) {
             try {
               const data = JSON.parse(xhr.responseText);
               resolve(data);
             } catch (err) {
               reject(new Error('Invalid JSON response'));
             }
           } else {
             try {
               const error = JSON.parse(xhr.responseText);
               reject(new Error(error.message || `Upload failed: ${xhr.status}`));
             } catch (err) {
               reject(new Error(`Upload failed: ${xhr.status}`));
             }
           }
         });
         
         xhr.addEventListener('error', () => {
           reject(new Error('Network error occurred'));
         });
         
         xhr.addEventListener('abort', () => {
           reject(new Error('Upload cancelled'));
         });
         
         xhr.open('POST', endpoint, true);
         xhr.send(formData);
         
         // Store XHR for cancellation
         this.currentUpload = xhr;
       });
     }
     
     /**
      * Cancel current upload
      */
     cancelUpload() {
       if (this.currentUpload) {
         this.currentUpload.abort();
         this.currentUpload = null;
       }
     }
     
     /**
      * Get upload job status
      * @param {number} uploadId - Upload job ID
      * @returns {Promise<Object>} Upload status
      */
     async getUploadStatus(uploadId) {
       const response = await fetch(`${this.baseUrl}/${uploadId}`);
       if (!response.ok) {
         throw new Error(`Failed to get upload status: ${response.status}`);
       }
       return response.json();
     }
     
     /**
      * Get upload history
      * @param {Object} params - Query parameters
      * @returns {Promise<Object>} Upload history
      */
     async getUploadHistory(params = {}) {
       const queryString = new URLSearchParams(params).toString();
       const url = queryString 
         ? `${this.baseUrl}/history?${queryString}`
         : `${this.baseUrl}/history`;
       
       const response = await fetch(url);
       if (!response.ok) {
         throw new Error(`Failed to get upload history: ${response.status}`);
       }
       return response.json();
     }
     
     /**
      * Get errors for specific upload
      * @param {number} uploadId - Upload job ID
      * @param {number} limit - Maximum errors to retrieve
      * @returns {Promise<Object>} Upload errors
      */
     async getUploadErrors(uploadId, limit = 100) {
       const response = await fetch(
         `${this.baseUrl}/${uploadId}/errors?limit=${limit}`
       );
       if (!response.ok) {
         throw new Error(`Failed to get upload errors: ${response.status}`);
       }
       return response.json();
     }
     
     /**
      * Poll upload status until complete
      * @param {number} uploadId - Upload job ID
      * @param {Function} onProgress - Progress callback
      * @param {number} interval - Polling interval in ms
      * @returns {Promise<Object>} Final upload status
      */
     async pollUploadStatus(uploadId, onProgress = null, interval = 1000) {
       return new Promise((resolve, reject) => {
         const poll = async () => {
           try {
             const result = await this.getUploadStatus(uploadId);
             
             if (onProgress && result.data.progress) {
               onProgress({
                 type: 'processing',
                 ...result.data.progress
               });
             }
             
             // Check if complete
             if (result.data.status === 'completed') {
               clearInterval(pollInterval);
               resolve(result.data);
             } else if (result.data.status === 'failed') {
               clearInterval(pollInterval);
               reject(new Error(result.data.errorMessage || 'Upload failed'));
             }
           } catch (error) {
             clearInterval(pollInterval);
             reject(error);
           }
         };
         
         const pollInterval = setInterval(poll, interval);
         poll(); // Start immediately
       });
     }
   }
   ```

### Phase 4: JavaScript - Upload Controller

**File:** `frontend/public/js/upload-controller.js` (NEW)

**Tasks:**
1. Create UploadController class for UI management
   ```javascript
   /**
    * Upload Controller
    * Manages upload modal UI and interactions
    */
   class UploadController {
     constructor(uploadService) {
       this.uploadService = uploadService;
       this.selectedFile = null;
       this.uploadId = null;
       this.startTime = null;
       this.timerInterval = null;
       
       this.initializeElements();
       this.attachEventListeners();
     }
     
     /**
      * Initialize DOM element references
      */
     initializeElements() {
       // Modal
       this.modal = document.getElementById('uploadModal');
       this.errorModal = document.getElementById('errorDetailsModal');
       
       // Views
       this.selectionView = document.getElementById('uploadSelectionView');
       this.progressView = document.getElementById('uploadProgressView');
       this.resultsView = document.getElementById('uploadResultsView');
       
       // Drop zone
       this.dropZone = document.getElementById('dropZone');
       this.fileInput = document.getElementById('fileInput');
       
       // File info
       this.fileInfo = document.getElementById('fileInfo');
       this.fileName = document.getElementById('fileName');
       this.fileSize = document.getElementById('fileSize');
       this.removeFileBtn = document.getElementById('removeFile');
       
       // Options
       this.importModeInputs = document.querySelectorAll('input[name="importMode"]');
       this.hasHeadersInput = document.getElementById('hasHeaders');
       this.csvOptions = document.getElementById('csvOptions');
       
       // Progress elements
       this.progressBar = document.getElementById('progressBar');
       this.progressPercent = document.getElementById('progressPercent');
       this.progressStatus = document.getElementById('progressStatus');
       this.progressFileName = document.getElementById('progressFileName');
       this.uploadStats = document.getElementById('uploadStats');
       this.statsProcessed = document.getElementById('statsProcessed');
       this.statsSuccessful = document.getElementById('statsSuccessful');
       this.statsFailed = document.getElementById('statsFailed');
       this.timerElapsed = document.getElementById('timerElapsed');
       this.timerEstimate = document.getElementById('timerEstimate');
       this.timerRemaining = document.getElementById('timerRemaining');
       
       // Results elements
       this.resultIcon = document.getElementById('resultIcon');
       this.resultTitle = document.getElementById('resultTitle');
       this.resultMessage = document.getElementById('resultMessage');
       this.resultTotal = document.getElementById('resultTotal');
       this.resultSuccess = document.getElementById('resultSuccess');
       this.resultFailed = document.getElementById('resultFailed');
       this.resultDuration = document.getElementById('resultDuration');
       this.errorSection = document.getElementById('errorSection');
       this.errorCount = document.getElementById('errorCount');
       this.viewErrorsBtn = document.getElementById('viewErrorsBtn');
       
       // Buttons
       this.uploadFileBtn = document.getElementById('uploadFileBtn');
       this.cancelBtn = document.getElementById('cancelBtn');
       this.downloadErrorsBtn = document.getElementById('downloadErrorsBtn');
     }
     
     /**
      * Attach event listeners
      */
     attachEventListeners() {
       // Drop zone events
       this.dropZone.addEventListener('click', () => this.fileInput.click());
       this.dropZone.addEventListener('keydown', (e) => {
         if (e.key === 'Enter' || e.key === ' ') {
           e.preventDefault();
           this.fileInput.click();
         }
       });
       
       // Drag and drop
       ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
         this.dropZone.addEventListener(eventName, (e) => {
           e.preventDefault();
           e.stopPropagation();
         });
       });
       
       ['dragenter', 'dragover'].forEach(eventName => {
         this.dropZone.addEventListener(eventName, () => {
           this.dropZone.classList.add('drag-over');
         });
       });
       
       ['dragleave', 'drop'].forEach(eventName => {
         this.dropZone.addEventListener(eventName, () => {
           this.dropZone.classList.remove('drag-over');
         });
       });
       
       this.dropZone.addEventListener('drop', (e) => {
         const files = e.dataTransfer.files;
         if (files.length > 0) {
           this.handleFileSelect(files[0]);
         }
       });
       
       // File input
       this.fileInput.addEventListener('change', (e) => {
         if (e.target.files.length > 0) {
           this.handleFileSelect(e.target.files[0]);
         }
       });
       
       // Remove file
       this.removeFileBtn.addEventListener('click', () => {
         this.clearFileSelection();
       });
       
       // Upload button
       this.uploadFileBtn.addEventListener('click', () => {
         this.startUpload();
       });
       
       // Cancel button
       this.cancelBtn.addEventListener('click', () => {
         this.handleCancel();
       });
       
       // View errors
       this.viewErrorsBtn.addEventListener('click', async () => {
         await this.showErrorDetails();
       });
       
       // Download errors
       this.downloadErrorsBtn.addEventListener('click', async () => {
         await this.downloadErrorReport();
       });
       
       // Modal events
       this.modal.addEventListener('hidden.bs.modal', () => {
         this.resetModal();
       });
     }
     
     /**
      * Handle file selection
      */
     handleFileSelect(file) {
       // Validate file type
       const ext = file.name.split('.').pop().toLowerCase();
       if (ext !== 'dbf' && ext !== 'csv') {
         Utils.showToast('Invalid file type. Please select a .dbf or .csv file.', 'error');
         return;
       }
       
       // Validate file size (100MB)
       if (file.size > 100 * 1024 * 1024) {
         Utils.showToast('File too large. Maximum size is 100MB.', 'error');
         return;
       }
       
       this.selectedFile = file;
       
       // Show/hide CSV options
       if (ext === 'csv') {
         this.csvOptions.style.display = 'block';
       } else {
         this.csvOptions.style.display = 'none';
       }
       
       // Display file info
       this.fileName.textContent = file.name;
       this.fileSize.textContent = this.formatFileSize(file.size);
       this.fileInfo.style.display = 'block';
       
       // Enable upload button
       this.uploadFileBtn.disabled = false;
     }
     
     /**
      * Clear file selection
      */
     clearFileSelection() {
       this.selectedFile = null;
       this.fileInput.value = '';
       this.fileInfo.style.display = 'none';
       this.uploadFileBtn.disabled = true;
       this.csvOptions.style.display = 'none';
     }
     
     /**
      * Start upload process
      */
     async startUpload() {
       if (!this.selectedFile) return;
       
       // Get options
       const importMode = document.querySelector('input[name="importMode"]:checked').value;
       const hasHeaders = this.hasHeadersInput.checked;
       
       const options = {
         importMode,
         hasHeaders: this.selectedFile.name.endsWith('.csv') ? hasHeaders : undefined
       };
       
       // Switch to progress view
       this.showProgressView();
       this.progressFileName.textContent = `Uploading: ${this.selectedFile.name}`;
       
       // Start timer
       this.startTime = Date.now();
       this.startTimer();
       
       try {
         // Upload file
         const uploadResponse = await this.uploadService.uploadFile(
           this.selectedFile,
           options,
           (progress) => this.handleUploadProgress(progress)
         );
         
         if (!uploadResponse.success) {
           throw new Error(uploadResponse.message || 'Upload failed');
         }
         
         this.uploadId = uploadResponse.import.id;
         
         // Switch to processing status
         this.progressStatus.textContent = 'Processing records...';
         this.uploadStats.style.display = 'block';
         
         // Poll for completion
         const finalStatus = await this.uploadService.pollUploadStatus(
           this.uploadId,
           (progress) => this.handleProcessingProgress(progress)
         );
         
         // Show results
         this.showResults(finalStatus);
         
       } catch (error) {
         this.stopTimer();
         
         if (error.message === 'Upload cancelled') {
           // User cancelled - just close modal
           bootstrap.Modal.getInstance(this.modal).hide();
         } else {
           // Show error
           this.showError(error.message);
         }
       }
     }
     
     /**
      * Handle upload progress
      */
     handleUploadProgress(progress) {
       if (progress.type === 'upload') {
         const percent = progress.percent;
         this.updateProgressBar(percent);
         this.progressStatus.textContent = 'Uploading file...';
       }
     }
     
     /**
      * Handle processing progress
      */
     handleProcessingProgress(progress) {
       if (progress.type === 'processing') {
         this.statsProcessed.textContent = Utils.formatNumber(progress.processed || 0);
         this.statsSuccessful.textContent = Utils.formatNumber(progress.successful || 0);
         this.statsFailed.textContent = Utils.formatNumber(progress.failed || 0);
         
         if (progress.percent !== undefined) {
           this.updateProgressBar(progress.percent);
         }
       }
     }
     
     /**
      * Update progress bar
      */
     updateProgressBar(percent) {
       const rounded = Math.round(percent);
       this.progressBar.style.width = `${rounded}%`;
       this.progressBar.setAttribute('aria-valuenow', rounded);
       this.progressBar.textContent = `${rounded}%`;
       this.progressPercent.textContent = `${rounded}%`;
     }
     
     /**
      * Start elapsed time timer
      */
     startTimer() {
       this.timerInterval = setInterval(() => {
         const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
         this.timerElapsed.textContent = this.formatTime(elapsed);
       }, 1000);
     }
     
     /**
      * Stop timer
      */
     stopTimer() {
       if (this.timerInterval) {
         clearInterval(this.timerInterval);
         this.timerInterval = null;
       }
     }
     
     /**
      * Show progress view
      */
     showProgressView() {
       this.selectionView.style.display = 'none';
       this.progressView.style.display = 'block';
       this.resultsView.style.display = 'none';
       
       // Update footer
       this.uploadFileBtn.style.display = 'none';
       this.cancelBtn.textContent = 'Cancel Upload';
     }
     
     /**
      * Show results view
      */
     showResults(status) {
       this.stopTimer();
       
       const duration = Math.floor((Date.now() - this.startTime) / 1000);
       
       this.selectionView.style.display = 'none';
       this.progressView.style.display = 'none';
       this.resultsView.style.display = 'block';
       
       // Success or partial success
       const hasErrors = status.progress?.failed > 0;
       
       if (hasErrors) {
         this.resultIcon.className = 'bi bi-exclamation-circle-fill text-warning';
         this.resultTitle.textContent = 'Upload Completed with Errors';
         this.resultMessage.textContent = `Successfully processed ${status.filename}`;
       } else {
         this.resultIcon.className = 'bi bi-check-circle-fill text-success';
         this.resultTitle.textContent = 'Upload Complete';
         this.resultMessage.textContent = `Successfully processed ${status.filename}`;
       }
       
       // Summary
       this.resultTotal.textContent = Utils.formatNumber(status.progress?.processed || 0);
       this.resultSuccess.textContent = Utils.formatNumber(status.progress?.successful || 0);
       this.resultFailed.textContent = Utils.formatNumber(status.progress?.failed || 0);
       this.resultDuration.textContent = this.formatTime(duration);
       
       // Error section
       if (hasErrors) {
         this.errorCount.textContent = status.progress.failed;
         this.errorSection.style.display = 'block';
       }
       
       // Update footer
       this.cancelBtn.textContent = 'Close';
       
       // Show toast
       if (hasErrors) {
         Utils.showToast(
           `Upload completed with ${status.progress.failed} errors`,
           'warning'
         );
       } else {
         Utils.showToast('Upload completed successfully!', 'success');
       }
     }
     
     /**
      * Show error view
      */
     showError(message) {
       this.selectionView.style.display = 'none';
       this.progressView.style.display = 'none';
       this.resultsView.style.display = 'block';
       
       this.resultIcon.className = 'bi bi-x-circle-fill text-danger';
       this.resultTitle.textContent = 'Upload Failed';
       this.resultMessage.textContent = message;
       
       // Hide summary
       document.querySelector('#uploadResultsView .card').style.display = 'none';
       
       this.cancelBtn.textContent = 'Close';
       
       Utils.showToast(message, 'error');
     }
     
     /**
      * Show error details modal
      */
     async showErrorDetails() {
       if (!this.uploadId) return;
       
       try {
         Utils.showLoading(true);
         const errorsData = await this.uploadService.getUploadErrors(this.uploadId);
         
         const errorsList = document.getElementById('errorDetailsList');
         errorsList.innerHTML = '';
         
         if (errorsData.errors && errorsData.errors.length > 0) {
           errorsData.errors.forEach(error => {
             const errorDiv = document.createElement('div');
             errorDiv.className = 'error-item';
             errorDiv.innerHTML = `
               <strong>Record #${error.recordNumber}</strong><br>
               <small>${error.errorType}: ${Utils.escapeHtml(error.message)}</small>
             `;
             errorsList.appendChild(errorDiv);
           });
         } else {
           errorsList.innerHTML = '<p class="text-muted">No detailed errors available.</p>';
         }
         
         const modal = new bootstrap.Modal(this.errorModal);
         modal.show();
         
       } catch (error) {
         Utils.showToast('Failed to load error details', 'error');
       } finally {
         Utils.showLoading(false);
       }
     }
     
     /**
      * Download error report as CSV
      */
     async downloadErrorReport() {
       if (!this.uploadId) return;
       
       try {
         const errorsData = await this.uploadService.getUploadErrors(this.uploadId);
         
         if (!errorsData.errors || errorsData.errors.length === 0) {
           Utils.showToast('No errors to download', 'info');
           return;
         }
         
         Utils.exportToCSV(errorsData.errors, `upload_errors_${this.uploadId}.csv`);
       } catch (error) {
         Utils.showToast('Failed to download error report', 'error');
       }
     }
     
     /**
      * Handle cancel button
      */
     handleCancel() {
       if (this.progressView.style.display === 'block') {
         // Upload in progress
         if (confirm('Are you sure you want to cancel the upload?')) {
           this.uploadService.cancelUpload();
           this.stopTimer();
         }
       } else {
         // Just close modal
         bootstrap.Modal.getInstance(this.modal).hide();
       }
     }
     
     /**
      * Reset modal to initial state
      */
     resetModal() {
       this.clearFileSelection();
       this.stopTimer();
       
       // Reset views
       this.selectionView.style.display = 'block';
       this.progressView.style.display = 'none';
       this.resultsView.style.display = 'none';
       
       // Reset progress
       this.updateProgressBar(0);
       this.uploadStats.style.display = 'none';
       this.statsProcessed.textContent = '0';
       this.statsSuccessful.textContent = '0';
       this.statsFailed.textContent = '0';
       this.timerElapsed.textContent = '00:00';
       
       // Reset results
       this.errorSection.style.display = 'none';
       document.querySelector('#uploadResultsView .card').style.display = 'block';
       
       // Reset footer
       this.uploadFileBtn.style.display = 'inline-block';
       this.cancelBtn.textContent = 'Cancel';
       
       this.uploadId = null;
       this.startTime = null;
     }
     
     /**
      * Format file size for display
      */
     formatFileSize(bytes) {
       if (bytes === 0) return '0 Bytes';
       const k = 1024;
       const sizes = ['Bytes', 'KB', 'MB', 'GB'];
       const i = Math.floor(Math.log(bytes) / Math.log(k));
       return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
     }
     
     /**
      * Format seconds to MM:SS
      */
     formatTime(seconds) {
       const mins = Math.floor(seconds / 60);
       const secs = seconds % 60;
       return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
     }
     
     /**
      * Initialize controller
      */
     async init() {
       console.log('✅ UploadController initialized');
     }
   }
   ```

### Phase 5: Integration with Main App

**File:** `frontend/public/js/app.js`

**Tasks:**
1. Add UploadController initialization in `initializeControllers()`:
   ```javascript
   // Initialize Upload Controller with error boundary
   this.initWithErrorBoundary('UploadController', async () => {
     this.uploadService = new UploadService('/api/upload');
     this.uploadController = new UploadController(this.uploadService);
     await this.uploadController.init();
   })
   ```

2. Add script tags to `index.html` before app.js:
   ```html
   <script src="/js/upload-service.js"></script>
   <script src="/js/upload-controller.js"></script>
   ```

**File:** `frontend/public/index.html` (Actions Card Section)

**Tasks:**
1. Update Actions card to include Upload button:
   ```html
   <div class="card">
     <div class="card-header bg-secondary text-white">
       <i class="bi bi-lightning-charge" aria-hidden="true"></i> Actions
     </div>
     <div class="card-body">
       <div class="d-grid gap-2">
         <!-- NEW: Upload Data Button -->
         <button class="btn btn-sm btn-outline-success" 
                 id="uploadBtn" 
                 data-bs-toggle="modal" 
                 data-bs-target="#uploadModal"
                 aria-label="Upload voter data file">
           <i class="bi bi-cloud-upload" aria-hidden="true"></i> Upload Data
         </button>
         
         <!-- Existing Export Button -->
         <button class="btn btn-sm btn-outline-primary" id="exportBtn"
                 aria-label="Export filtered voters to CSV file">
           <i class="bi bi-download" aria-hidden="true"></i> Export to CSV
         </button>
       </div>
     </div>
   </div>
   ```

---

## User Flow

### Primary Flow: Successful Upload

```
1. User clicks "Upload Data" button in Actions card
   ↓
2. Upload modal opens (Selection View)
   - Drop zone visible
   - Import mode options (Replace selected by default)
   - CSV options hidden
   ↓
3. User selects file (drag-and-drop OR click to browse)
   ↓
4. File validation:
   - Check file type (.dbf or .csv)
   - Check file size (< 100MB)
   ↓
   SUCCESS → Continue
   FAILURE → Show error toast, stay in selection view
   ↓
5. File info displayed
   - File name
   - File size
   - CSV options appear if CSV file
   - "Upload File" button enabled
   ↓
6. User configures options:
   - Select import mode (Replace/Skip/Flag)
   - Toggle "CSV has headers" if CSV
   ↓
7. User clicks "Upload File"
   ↓
8. Progress View shown
   - Progress bar at 0%
   - "Uploading file..." status
   - Timer starts
   ↓
9. File uploads to server
   - Progress bar updates with upload %
   ↓
10. Server begins processing
    - Status changes to "Processing records..."
    - Stats appear (Processed, Successful, Failed)
    - Progress bar shows processing %
    ↓
11. Processing completes
    ↓
12. Results View shown
    - Success icon and message
    - Summary statistics
    - Duration displayed
    - "Close" button available
    ↓
13. User clicks "Close"
    ↓
14. Modal closes, returns to main map view
    - Map refreshes with new data
    - Toast notification confirms success
```

### Alternate Flow: Upload with Errors

```
Steps 1-10 same as Primary Flow
   ↓
11. Processing completes with some errors
    ↓
12. Results View shown
    - Warning icon
    - "Completed with Errors" message
    - Summary shows successful + failed counts
    - Error section visible
    ↓
13. User clicks "View Error Details"
    ↓
14. Error Details modal opens
    - List of all errors with:
      - Record number
      - Error type
      - Error message
    - "Download Error Report" button
    ↓
15. User can:
    a) Download CSV of errors for fixing
    b) Close and accept partial import
```

### Alternate Flow: Upload Failure

```
Steps 1-8 same as Primary Flow
   ↓
9. Upload fails (network error, server error, file too large)
   ↓
10. Results View shown
    - Error icon (red X)
    - "Upload Failed" message
    - Error message displayed
    - Summary section hidden
    ↓
11. User clicks "Close"
    ↓
12. Modal closes
    - Error toast shown
    - User can try again
```

### Alternate Flow: User Cancellation

```
Steps 1-9 same as Primary Flow
   ↓
10. User clicks "Cancel Upload" during progress
    ↓
11. Confirmation dialog: "Are you sure?"
    ↓
    YES → Upload cancelled, modal closes
    NO → Continue upload
```

---

## Integration Points

### 1. VoterService Integration
**Location:** `frontend/public/js/voter-service.js`

**Purpose:** Refresh voter data after successful upload

**Method to add:**
```javascript
/**
 * Refresh voter data after import
 * Called after successful file upload
 */
async refreshAfterImport() {
  // Clear cache to force fresh data
  this.cache.clear();
  
  // Fetch updated voter data
  return this.fetchVoters(this.lastFilters, this.lastPagination);
}
```

**Integration:**
In `UploadController.showResults()`, after showing results:
```javascript
// Refresh map data
if (window.app && window.app.voterService) {
  try {
    await window.app.voterService.refreshAfterImport();
    if (window.app.mapController) {
      await window.app.mapController.refreshMarkers();
    }
    if (window.app.chartController) {
      await window.app.chartController.refresh();
    }
  } catch (error) {
    console.warn('Failed to refresh data after import:', error);
  }
}
```

### 2. StateManager Integration
**Location:** `frontend/public/js/state-manager.js`

**Purpose:** Track upload state for app-wide awareness

**State to add:**
```javascript
// In StateManager constructor
this.state = {
  // ... existing state ...
  
  upload: {
    inProgress: false,
    currentUploadId: null,
    lastUploadTime: null,
    lastUploadStatus: null
  }
}
```

**Usage in UploadController:**
```javascript
// When upload starts
if (window.app && window.app.stateManager) {
  window.app.stateManager.setState({
    upload: {
      inProgress: true,
      currentUploadId: this.uploadId
    }
  });
}

// When upload completes
if (window.app && window.app.stateManager) {
  window.app.stateManager.setState({
    upload: {
      inProgress: false,
      lastUploadTime: new Date().toISOString(),
      lastUploadStatus: 'success'
    }
  });
}
```

### 3. MapController Integration
**Location:** `frontend/public/js/map-controller.js`

**Purpose:** Refresh map markers after new data imported

**Method to add:**
```javascript
/**
 * Refresh map markers
 * Clears and reloads all markers
 */
async refreshMarkers() {
  console.log('🗺️ Refreshing map markers after import');
  
  // Clear existing markers
  this.clearMarkers();
  
  // Reload voter data
  const state = this.stateManager.getState();
  await this.loadVoters(state.filters);
}
```

### 4. ChartController Integration
**Location:** `frontend/public/js/chart-controller.js`

**Purpose:** Update analytics charts with new data

**Method to add:**
```javascript
/**
 * Refresh all charts
 * Reloads data and updates visualizations
 */
async refresh() {
  console.log('📊 Refreshing charts after import');
  
  try {
    // Reload analytics data
    await this.loadAnalytics();
    
    // Update charts
    this.updatePrecinctChart();
    this.updateSuperVoterChart();
  } catch (error) {
    console.error('Failed to refresh charts:', error);
  }
}
```

### 5. Utils Integration
**Location:** `frontend/public/js/utils.js`

**Purpose:** Use existing utilities for consistent UX

**Methods used:**
- `Utils.showToast()` - Upload status notifications
- `Utils.showLoading()` - Loading overlay during API calls
- `Utils.exportToCSV()` - Download error reports
- `Utils.escapeHtml()` - XSS prevention in error messages
- `Utils.formatNumber()` - Format statistics

### 6. Backend API Integration
**Location:** `backend/routes/upload.js`

**Already exists - no changes needed:**
- `POST /api/upload/dbf` - Upload DBF files
- `POST /api/upload/csv` - Upload CSV files
- `GET /api/upload/:id` - Get upload status
- `GET /api/upload/history` - Get upload history
- `GET /api/upload/:id/errors` - Get error details

### 7. Error Logging Integration
**Location:** `backend/services/import-processor.js`

**Already exists - no changes needed:**
- Logs all import errors to `import_errors` table
- Records detailed error information per record
- Tracks error types (VALIDATION, PARSING, DATABASE)

---

## Accessibility Considerations

### WCAG 2.1 Level AA Compliance

#### 1. Keyboard Navigation

**Requirements:**
- All interactive elements must be keyboard accessible
- Logical tab order
- Visible focus indicators
- Keyboard shortcuts where appropriate

**Implementation:**

**Drop Zone:**
```html
<div id="dropZone" 
     role="button" 
     tabindex="0"
     aria-label="Drag and drop files here or click to browse">
```
- `tabindex="0"` makes it keyboard focusable
- `role="button"` announces it as interactive
- Support for Enter/Space to activate file picker

**File Input:**
```html
<input type="file" 
       id="fileInput" 
       class="visually-hidden" 
       accept=".dbf,.csv"
       aria-label="Select voter data file">
```
- `visually-hidden` keeps it accessible to screen readers
- File input remains keyboard navigable

**Focus Indicators:**
```css
.drop-zone:focus {
  outline: 2px solid #0d6efd;
  outline-offset: 2px;
}

.btn:focus {
  box-shadow: 0 0 0 0.25rem rgba(13, 110, 253, 0.25);
}
```

#### 2. Screen Reader Support

**ARIA Labels:**
```html
<!-- Modal title -->
<h5 class="modal-title" id="uploadModalLabel">Upload Voter Data</h5>

<!-- Progress bar -->
<div id="progressBar" 
     class="progress-bar" 
     role="progressbar" 
     aria-valuenow="0" 
     aria-valuemin="0" 
     aria-valuemax="100">
  0%
</div>

<!-- File info -->
<div id="fileInfo" role="status">
  <strong id="fileName">No file selected</strong>
</div>
```

**Live Regions:**
```html
<!-- Progress updates -->
<div id="uploadStats" aria-live="polite" aria-atomic="true">
  <div class="col-4">
    <small class="text-muted">Processed</small>
    <p class="mb-0 fw-bold" id="statsProcessed">0</p>
  </div>
</div>

<!-- Error messages -->
<div class="alert alert-danger" role="alert" aria-live="assertive">
  Upload failed: File too large
</div>
```

**ARIA Attributes:**
- `aria-label` - Descriptive labels for interactive elements
- `aria-labelledby` - Associate labels with controls
- `aria-describedby` - Additional context for controls
- `aria-live="polite"` - Announce updates (non-critical)
- `aria-live="assertive"` - Announce immediately (errors)
- `aria-atomic="true"` - Read entire region on change
- `aria-busy="true"` - Indicate loading states

#### 3. Visual Accessibility

**Color Contrast:**
```css
/* Minimum 4.5:1 contrast ratio for text */
.drop-zone-text {
  color: #495057; /* 7.3:1 on white background */
}

/* 3:1 for large text and UI components */
.btn-primary {
  background-color: #0d6efd; /* Sufficient contrast */
  color: white;
}
```

**Don't Rely on Color Alone:**
```html
<!-- Success with icon + color + text -->
<i class="bi bi-check-circle-fill text-success"></i>
<h5>Upload Complete</h5>

<!-- Error with icon + color + text -->
<i class="bi bi-x-circle-fill text-danger"></i>
<h5>Upload Failed</h5>

<!-- Progress with percentage + visual bar -->
<div class="progress-bar" style="width: 75%">75%</div>
```

**Focus Indicators:**
All interactive elements have visible focus states with 2px outlines and sufficient contrast.

#### 4. Semantic HTML

**Proper Structure:**
```html
<!-- Modal structure -->
<div class="modal" role="dialog" aria-modal="true">
  <div class="modal-dialog">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title">...</h5>
      </div>
      <div class="modal-body">...</div>
      <div class="modal-footer">...</div>
    </div>
  </div>
</div>

<!-- Form structure -->
<form>
  <div class="mb-3">
    <label for="importMode" class="form-label">Import Mode</label>
    <div class="form-check">
      <input class="form-check-input" type="radio" id="modeReplace">
      <label class="form-check-label" for="modeReplace">Replace</label>
    </div>
  </div>
</form>
```

**Button Types:**
```html
<!-- Type specified for all buttons -->
<button type="button" class="btn btn-primary">Upload</button>
<button type="button" class="btn btn-secondary">Cancel</button>
```

#### 5. Error Handling

**Accessible Error Messages:**
```html
<!-- Associated with form fields -->
<input type="file" 
       id="fileInput" 
       aria-describedby="fileError"
       aria-invalid="true">
<div id="fileError" class="invalid-feedback" role="alert">
  File too large. Maximum size is 100MB.
</div>

<!-- Error summary -->
<div class="alert alert-danger" role="alert">
  <h6 class="alert-heading">Upload Failed</h6>
  <p>The following errors occurred:</p>
  <ul>
    <li>File too large (150MB > 100MB limit)</li>
  </ul>
</div>
```

**Error Prevention:**
- Client-side validation before upload
- Clear file size and type requirements
- Confirmation for destructive actions
- Undo/retry options where possible

#### 6. Time Limits

**No Time Constraints:**
- Upload can take as long as needed
- No automatic timeouts on modal
- User controls when to proceed/cancel

**Progress Indication:**
- Clear feedback on progress
- Estimated time remaining
- Cancel option available

#### 7. Instructions and Labels

**Clear Instructions:**
```html
<p class="drop-zone-text">Drag and drop file here</p>
<p class="drop-zone-subtext">or click to browse</p>
<p class="drop-zone-info text-muted small">
  Accepted formats: .dbf, .csv<br>
  Maximum size: 100MB
</p>
```

**Descriptive Labels:**
```html
<label for="modeReplace" class="form-check-label">
  Replace existing records
  <small class="text-muted d-block">
    Update existing voter records with new data
  </small>
</label>
```

#### 8. Responsive Design

**Mobile Accessibility:**
- Touch targets minimum 44x44px
- Adequate spacing between interactive elements
- Readable text sizes (minimum 16px)
- No horizontal scrolling required

```css
/* Mobile adjustments */
@media (max-width: 576px) {
  .drop-zone {
    padding: 30px 15px;
    min-height: 200px;
  }
  
  .btn {
    min-height: 44px;
    padding: 12px 20px;
  }
  
  .form-check-input {
    width: 20px;
    height: 20px;
  }
}
```

---

## Dependencies and Requirements

### Frontend Dependencies

**Already Available (via CDN in index.html):**
- Bootstrap 5.3.2 - UI components and modals
- Bootstrap Icons - Icon set for UI elements
- Chart.js 4.4.0 - Analytics charts
- Google Maps API - Map visualization

**New Files to Create:**
1. `frontend/public/js/upload-service.js` - API communication
2. `frontend/public/js/upload-controller.js` - UI controller
3. CSS additions to `frontend/public/css/styles.css`
4. HTML additions to `frontend/public/index.html`

### Backend Dependencies

**Already Installed:**
- `express` - Web framework
- `multer` - File upload middleware
- `shapefile` - DBF parsing
- `csv-parser` - CSV parsing
- `sqlite3` - Database
- `express-validator` - Input validation

**No New Backend Dependencies Required**

### Browser Requirements

**Minimum Browser Versions:**
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+
- Mobile Safari 14+
- Chrome Android 90+

**Required Browser APIs:**
- File API (File, FileReader, FileList)
- FormData API
- Fetch API or XMLHttpRequest (Level 2 for progress)
- Drag and Drop API
- Bootstrap JavaScript (requires modern JS)

**Graceful Degradation:**
- If drag-and-drop not supported, file input still works
- If File API not supported, show upgrade message
- All features accessible via keyboard if mouse unavailable

### Environment Requirements

**Server:**
- Node.js 14+ (already required)
- Writable `data/raw` directory for uploads
- SQLite database with `import_logs` and `import_errors` tables

**Client:**
- JavaScript enabled
- Cookies enabled (for session management)
- Minimum 1024x768 screen resolution recommended
- Internet connection for CDN resources

### Database Schema

**Already Exists:**

**import_logs table:**
```sql
CREATE TABLE import_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  status TEXT NOT NULL,
  records_processed INTEGER DEFAULT 0,
  records_successful INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,
  start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  end_time DATETIME,
  error_message TEXT
);
```

**import_errors table:**
```sql
CREATE TABLE import_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL,
  record_number INTEGER NOT NULL,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (import_id) REFERENCES import_logs(id)
);
```

---

## Potential Risks and Mitigations

### Risk 1: Large File Upload Timeout

**Risk:** Network timeouts when uploading very large files (near 100MB limit)

**Probability:** Medium  
**Impact:** High (user frustration, incomplete uploads)

**Mitigation:**
1. **Chunked Upload Support (Future Enhancement):**
   - Break large files into smaller chunks
   - Upload chunks sequentially
   - Resume capability if connection drops

2. **Progress Feedback:**
   - Real-time upload progress bar
   - Show bytes transferred
   - Estimat time remaining

3. **Timeout Configuration:**
   ```javascript
   // In upload-service.js
   xhr.timeout = 600000; // 10 minute timeout for large files
   xhr.ontimeout = () => {
     reject(new Error('Upload timed out. Please try again.'));
   };
   ```

4. **User Guidance:**
   - Recommend stable internet connection
   - Suggest breaking very large files into smaller batches
   - Provide best practices documentation

### Risk 2: Browser Crashes with Large Files

**Risk:** Browser memory issues when reading large files client-side

**Probability:** Low  
**Impact:** High (lost work, poor UX)

**Mitigation:**
1. **Stream Processing:**
   - Don't read entire file into memory
   - Use FormData directly (no FileReader for large files)
   - Let browser handle file streaming

2. **File Size Validation:**
   ```javascript
   // Warn users about very large files
   if (file.size > 50 * 1024 * 1024) { // >50MB
     const confirmed = confirm(
       'This is a large file and may take several minutes to upload. Continue?'
     );
     if (!confirmed) return;
   }
   ```

3. **Memory Management:**
   - Clear file references after upload
   - Revoke object URLs when done
   - No unnecessary file previews for large files

### Risk 3: Concurrent Uploads

**Risk:** Multiple users uploading simultaneously could overload server

**Probability:** Medium  
**Impact:** Medium (slow performance, database locks)

**Mitigation:**
1. **Server-Side Queue:**
   - Already implemented in backend (async processing)
   - Uploads queued and processed sequentially
   - User gets immediate confirmation

2. **Client-Side Prevention:**
   ```javascript
   // Disable upload button while upload in progress
   this.uploadFileBtn.disabled = true;
   
   // Only allow one upload per session
   if (this.uploadInProgress) {
     alert('Please wait for current upload to complete');
     return;
   }
   ```

3. **Rate Limiting (Backend):**
   - Implement rate limiting middleware
   - Limit uploads per user per hour
   - Return 429 Too Many Requests if exceeded

### Risk 4: Malicious File Upload

**Risk:** User attempts to upload malicious files or exploit file parser

**Probability:** Low  
**Impact:** High (security breach, data corruption)

**Mitigation:**
1. **Client-Side Validation:**
   ```javascript
   // File type validation
   const ext = file.name.split('.').pop().toLowerCase();
   if (ext !== 'dbf' && ext !== 'csv') {
     throw new Error('Invalid file type');
   }
   
   // File size limit
   if (file.size > 100 * 1024 * 1024) {
     throw new Error('File too large');
   }
   ```

2. **Server-Side Validation (Already Implemented):**
   - Multer fileFilter checks extension
   - File size limits enforced
   - Filename sanitization (path traversal prevention)
   - Content-type validation

3. **Secure File Handling:**
   - Files stored outside web root (`data/raw/`)
   - Timestamped filenames prevent collisions
   - No execution permissions on upload directory

4. **Parser Security:**
   - DBF parser (shapefile library) is well-maintained
   - CSV parser has sanitization
   - All input fields sanitized before database insertion

### Risk 5: XSS via Error Messages

**Risk:** Malicious data in error messages could execute scripts

**Probability:** Low  
**Impact:** High (XSS vulnerability)

**Mitigation:**
1. **HTML Escaping:**
   ```javascript
   // Use Utils.escapeHtml() for all user data
   errorDiv.innerHTML = `
     <strong>Record #${error.recordNumber}</strong><br>
     <small>${Utils.escapeHtml(error.message)}</small>
   `;
   ```

2. **Content Security Policy:**
   ```html
   <!-- Add to index.html -->
   <meta http-equiv="Content-Security-Policy" 
         content="default-src 'self'; script-src 'self' cdn.jsdelivr.net;">
   ```

3. **Sanitization:**
   - All error messages sanitized on backend
   - No raw HTML in error responses
   - Use textContent instead of innerHTML where possible

### Risk 6: Database Corruption from Failed Imports

**Risk:** Partial imports could leave database in inconsistent state

**Probability:** Low  
**Impact:** High (data integrity issues)

**Mitigation:**
1. **Transaction Support (Already Implemented):**
   - Backend uses database transactions
   - Rollback on critical errors
   - Import modes (replace/skip/flag) prevent duplicates

2. **Import Modes:**
   - **Replace:** Uses REPLACE INTO for safe updates
   - **Skip:** Uses INSERT OR IGNORE to avoid conflicts
   - **Flag:** Marks conflicts for manual review

3. **Error Recovery:**
   - Continue processing after individual record errors
   - Log all errors for review
   - Provide detailed error report

4. **Database Backups:**
   - Regular automated backups (recommend before imports)
   - Point-in-time recovery capability
   - Export functionality for manual backups

### Risk 7: Poor Mobile Experience

**Risk:** Upload interface difficult to use on mobile devices

**Probability:** Medium  
**Impact:** Medium (reduced functionality for mobile users)

**Mitigation:**
1. **Responsive Design:**
   ```css
   @media (max-width: 576px) {
     .drop-zone {
       padding: 20px 10px;
       font-size: 0.9rem;
     }
     
     .modal-dialog {
       margin: 0.5rem;
     }
   }
   ```

2. **Touch-Friendly:**
   - Minimum 44x44px touch targets
   - Adequate spacing between buttons
   - Larger drop zone on mobile

3. **Mobile Upload Support:**
   - File input supports camera on mobile
   - `accept` attribute filters to relevant files
   - Native file picker integration

4. **Progressive Enhancement:**
   - Core functionality works without drag-and-drop
   - File input always available
   - Graceful fallback to standard upload

### Risk 8: Accessibility Compliance Failures

**Risk:** UI doesn't meet WCAG 2.1 Level AA standards

**Probability:** Low (with proper implementation)  
**Impact:** High (legal issues, excluded users)

**Mitigation:**
1. **Comprehensive ARIA:**
   - All interactive elements properly labeled
   - Live regions for dynamic updates
   - Proper roles and states

2. **Keyboard Navigation:**
   - All functionality available via keyboard
   - Logical tab order
   - Clear focus indicators

3. **Testing:**
   - Manual testing with screen readers (NVDA, JAWS, VoiceOver)
   - Automated testing with axe or Lighthouse
   - Keyboard-only navigation testing
   - Color contrast validation

4. **Documentation:**
   - Accessibility features documented
   - User guides for assistive technology users
   - Regular audits and updates

### Risk 9: Browser Compatibility Issues

**Risk:** Features not working in older browsers

**Probability:** Low  
**Impact:** Medium (some users unable to upload)

**Mitigation:**
1. **Feature Detection:**
   ```javascript
   // Check for File API support
   if (!window.File || !window.FileReader || !window.FileList) {
     // Show fallback message or disable upload
     showWarning('Your browser does not support file uploads. Please upgrade.');
     return;
   }
   
   // Check for drag-and-drop
   const supportsDragDrop = 'draggable' in document.createElement('div');
   if (!supportsDragDrop) {
     // Hide drag indicator, keep file input
     dropZone.classList.add('no-drag-support');
   }
   ```

2. **Graceful Degradation:**
   - File input always works (standard HTML)
   - Drag-and-drop is enhancement
   - Progress polling instead of WebSocket

3. **Browser Requirements:**
   - Document minimum browser versions
   - Show upgrade notice for unsupported browsers
   - Provide alternative upload methods (email, direct server access)

4. **Testing:**
   - Test on target browsers (Chrome, Firefox, Safari, Edge)
   - Test on mobile browsers (iOS Safari, Chrome Android)
   - Test with browser compatibility tools

---

## Success Metrics

### Functional Metrics

1. **Upload Success Rate:** >95% of uploads complete successfully
2. **Error Recovery:** Users can identify and fix errors in <5 minutes
3. **Performance:** 1000-record file processes in <60 seconds
4. **Accessibility:** WCAG 2.1 Level AA compliance score >95%

### User Experience Metrics

1. **Task Completion:** >90% of users can upload file without help
2. **Time to Upload:** Average <2 minutes from start to completion
3. **Error Understanding:** >85% of users understand error messages
4. **Satisfaction:** >4.0/5.0 user satisfaction rating

### Technical Metrics

1. **Browser Support:** Works in >98% of user browsers
2. **Mobile Support:** Functional on all modern mobile browsers
3. **Performance:** Modal loads in <500ms
4. **Reliability:** <1% upload failures due to client-side errors

---

## Future Enhancements

### Phase 2 Features (Post-MVP)

1. **Upload History Panel**
   - View recent uploads
   - Re-download error reports
   - Delete old import logs
   - Export upload statistics

2. **Batch Upload**
   - Select multiple files
   - Queue uploads sequentially
   - Aggregate progress display

3. **Scheduled Imports**
   - Schedule regular data updates
   - Email notifications on completion
   - Automatic retry on failure

4. **Advanced Validation**
   - Pre-upload schema validation
   - Duplicate detection preview
   - Data quality checks

5. **Import Preview**
   - Show sample records before import
   - Side-by-side comparison with existing data
   - Approve/reject before processing

6. **Chunked Upload**
   - Break large files into chunks
   - Resume capability
   - Better support for slow connections

7. **Websocket Progress**
   - Real-time progress updates
   - No polling required
   - Instant error notifications

---

## Conclusion

This specification provides a comprehensive plan for implementing a production-ready file upload interface for the Voter Outreach Platform. The design prioritizes:

✅ **User Experience** - Simple, intuitive workflow with clear feedback  
✅ **Accessibility** - WCAG 2.1 Level AA compliance  
✅ **Security** - Client and server-side validation, XSS prevention  
✅ **Reliability** - Error handling, progress tracking, recovery options  
✅ **Performance** - Efficient upload processing, responsive UI  
✅ **Maintainability** - Clean code structure, well-documented

The implementation leverages existing backend APIs and follows established patterns in the codebase for consistency and ease of maintenance.

**Recommended Implementation Timeline:**
- Phase 1 (HTML): 2 hours
- Phase 2 (CSS): 2 hours  
- Phase 3 (Upload Service): 4 hours
- Phase 4 (Upload Controller): 6 hours
- Phase 5 (Integration): 2 hours
- Testing & Refinement: 4 hours

**Total Estimated Time:** 20 hours

---

**End of Specification**
