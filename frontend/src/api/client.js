/**
 * API Client - Centralized HTTP layer for all backend calls
 * Every API call in the app goes through this module.
 */

const BASE = '/api';

async function request(method, path, { body, params, signal } = {}) {
  let url = `${BASE}${path}`;

  if (params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    }
    const str = qs.toString();
    if (str) url += `?${str}`;
  }

  const opts = { method, headers: {}, signal };

  if (body instanceof FormData) {
    opts.body = body; // let browser set Content-Type with boundary
  } else if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw Object.assign(new Error(err.message || `HTTP ${res.status}`), {
      status: res.status,
      data: err,
    });
  }

  // Handle non-JSON responses (CSV exports, print pages)
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/html') || ct.includes('text/csv')) {
    return res.text();
  }
  return res.json();
}

// ── Convenience wrappers ──────────────────────────────────────────

const get  = (p, params, signal) => request('GET',    p, { params, signal });
const post = (p, body)           => request('POST',   p, { body });
const put  = (p, body)           => request('PUT',    p, { body });
const del  = (p)                 => request('DELETE', p);

// ── Config & Health ───────────────────────────────────────────────

export const fetchConfig = () => get('/config');
export const fetchHealth = () => get('/health');

// ── Voters ────────────────────────────────────────────────────────

export function fetchVoters(filters = {}) {
  return get('/voters', filters);
}

export function searchVoters(query, limit = 50) {
  return get(`/voters/search/${encodeURIComponent(query)}`, { limit });
}

export function fetchVotersByPrecinct(precinct) {
  return get(`/voters/precinct/${encodeURIComponent(precinct)}`);
}

export function fetchVoter(id) {
  return get(`/voters/${id}`);
}

// ── Never Voted ───────────────────────────────────────────────────

export function fetchNeverVoted(filters = {}) {
  return get('/voters/never-voted', filters);
}

export function exportNeverVotedCsv(filters = {}) {
  return get('/voters/never-voted', { ...filters, export: 'csv' });
}

// ── Upload ────────────────────────────────────────────────────────

export function uploadDbf(file, importMode = 'replace') {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('importMode', importMode);
  return post('/upload/dbf', fd);
}

export function uploadCsv(file, importMode = 'replace', hasHeaders = true) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('importMode', importMode);
  fd.append('hasHeaders', hasHeaders);
  return post('/upload/csv', fd);
}

export function fetchUploadHistory(limit = 20, status) {
  return get('/upload/history', { limit, status });
}

export function fetchUploadStatus(id) {
  return get(`/upload/${id}`);
}

export function fetchUploadErrors(id, limit = 100) {
  return get(`/upload/${id}/errors`, { limit });
}

// ── Analytics ─────────────────────────────────────────────────────

export const fetchDashboard       = ()       => get('/analytics/dashboard');
export const fetchTurnout         = (p = {}) => get('/analytics/turnout', p);
export const fetchVotingPatterns  = (p = {}) => get('/analytics/voting-patterns', p);
export const fetchSuperVoters     = (p = {}) => get('/analytics/super-voters', p);
export const fetchPartyAffil      = (p = {}) => get('/analytics/party-affiliation', p);
export const fetchDemographics    = (p = {}) => get('/analytics/demographics', p);
export const fetchEngagement      = (p = {}) => get('/analytics/engagement-levels', p);
export const fetchNonVoterDemo    = (p = {}) => get('/analytics/non-voter-demographics', p);
export const fetchNonVoterPrecinct = ()      => get('/analytics/non-voters-by-precinct');

// ── Precincts ─────────────────────────────────────────────────────

export const fetchPrecincts = () => get('/precincts');
export const fetchPrecinct  = (n) => get(`/precincts/${n}`);

// ── Geocoding ─────────────────────────────────────────────────────

export const startBatchGeocode = (body) => post('/geocode/batch', body);
export const fetchGeoJob       = (id)   => get(`/geocode/jobs/${id}`);
export const geocodeSingle     = (body) => post('/geocode/single', body);
export const fetchGeoFailed    = (id)   => get(`/geocode/failed/${id}`);
export const manualGeocode     = (voterId, body) => put(`/geocode/manual/${voterId}`, body);
export const fetchGeoStats     = ()     => get('/geocode/stats');
export const retryGeoJob       = (id, body) => post(`/geocode/retry/${id}`, body);
export const fetchGeoReview    = (p)    => get('/geocode/review', p);

// ── Route Planning ────────────────────────────────────────────────

export const calcRoute        = (body) => post('/routes/calculate', body);
export const calcDistMatrix   = (body) => post('/routes/distance-matrix', body);
export const fetchQuotaStatus = ()     => get('/routes/quota-status');
export const fetchCacheStats  = ()     => get('/routes/cache-stats');
export const cleanCache       = ()     => post('/routes/cache-cleanup');
export const saveRoute        = (body) => post('/routes/save', body);
export const fetchRoute       = (id)   => get(`/routes/${id}`);
export const deleteRoute      = (id)   => del(`/routes/${id}`);
export const cleanExpiredRoutes = ()   => post('/routes/cleanup-expired');
