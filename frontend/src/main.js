import './styles/main.css';
import { registerRoutes, startRouter, getCurrentPath, navigateTo } from './router.js';
import { renderDashboard } from './pages/Dashboard.js';
import { renderVoters } from './pages/Voters.js';
import { renderUpload } from './pages/Upload.js';
import { renderMap } from './pages/MapView/MapView.js';
import { renderAnalytics } from './pages/Analytics.js';
import { renderNeverVoted } from './pages/NeverVoted.js';
import { renderArchive } from './pages/Archive.js';
import { renderMailer } from './pages/Mailer.js';
import { renderFlyerCreator } from './pages/FlyerCreator.js';

// ── App Shell ──────────────────────────────────────────────────────

const NAV_ITEMS = [
  { path: '/',          label: 'Dashboard',   icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1' },
  { path: '/voters',    label: 'Voters',      icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  { path: '/never-voted', label: 'Never Voted', icon: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636' },
  { path: '/upload',    label: 'Upload',      icon: 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12' },
  { path: '/map',       label: 'Map',         icon: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7' },
  { path: '/analytics', label: 'Analytics',   icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { path: '/archive',   label: 'Archive',     icon: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4' },
  { path: '/mailer',    label: 'Mailer',      icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  { path: '/flyer',     label: 'Flyer Creator', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
];

function createAppShell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <!-- Top Nav -->
    <nav class="bg-primary-600 text-white shadow-lg sticky top-0 z-50">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="text-2xl">🗳️</span>
          <div>
            <h1 class="text-lg font-bold leading-tight">Voter Outreach Platform</h1>
            <p class="text-xs text-primary-200 hidden sm:block">Obion County, Tennessee</p>
          </div>
        </div>
        <button id="dark-toggle" class="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition" aria-label="Toggle dark mode">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/>
          </svg>
        </button>
      </div>
    </nav>

    <!-- Tab bar -->
    <div class="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
      <div class="max-w-7xl mx-auto px-4 sm:px-6">
        <nav id="tab-bar" class="flex gap-1 -mb-px" role="tablist">
        </nav>
      </div>
    </div>

    <!-- Page content -->
    <main id="page-content" class="max-w-7xl mx-auto px-4 sm:px-6 py-6 page-active"></main>

    <!-- Toast container -->
    <div id="toast-container" class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2"></div>
  `;

  // Build tab bar
  const tabBar = document.getElementById('tab-bar');
  NAV_ITEMS.forEach(item => {
    const btn = document.createElement('a');
    btn.href = `#${item.path}`;
    btn.dataset.path = item.path;
    btn.setAttribute('role', 'tab');
    btn.className = 'tab-link flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 dark:text-gray-400 hover:text-primary-600 hover:border-primary-300 transition whitespace-nowrap';
    btn.innerHTML = `
      <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${item.icon}"/>
      </svg>
      <span>${item.label}</span>
    `;
    tabBar.appendChild(btn);
  });

  // Highlight active tab
  function updateActiveTab() {
    const current = getCurrentPath();
    tabBar.querySelectorAll('.tab-link').forEach(link => {
      const isActive = link.dataset.path === current;
      link.classList.toggle('border-primary-600', isActive);
      link.classList.toggle('text-primary-600', isActive);
      link.classList.toggle('dark:text-primary-400', isActive);
      link.classList.toggle('border-transparent', !isActive);
      link.classList.toggle('text-gray-500', !isActive);
      link.setAttribute('aria-selected', isActive);
    });
  }

  window.addEventListener('hashchange', updateActiveTab);
  updateActiveTab();

  // Dark mode toggle
  const darkBtn = document.getElementById('dark-toggle');
  const html = document.documentElement;

  if (localStorage.getItem('theme') === 'dark' || 
      (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    html.classList.add('dark');
  }

  darkBtn.addEventListener('click', () => {
    html.classList.toggle('dark');
    localStorage.setItem('theme', html.classList.contains('dark') ? 'dark' : 'light');
  });

  return document.getElementById('page-content');
}

// ── Toast Notifications ────────────────────────────────────────────

export function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  const colors = {
    info: 'bg-primary-600 text-white',
    success: 'bg-success-600 text-white',
    warning: 'bg-warning-500 text-white',
    error: 'bg-danger-600 text-white',
  };

  const toast = document.createElement('div');
  toast.className = `${colors[type] || colors.info} px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all duration-300 translate-x-full opacity-0`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-x-full', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('translate-x-full', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Bootstrap ──────────────────────────────────────────────────────

const container = createAppShell();

registerRoutes([
  { path: '/',            title: 'Dashboard',   render: renderDashboard },
  { path: '/voters',      title: 'Voters',      render: renderVoters },
  { path: '/never-voted', title: 'Never Voted', render: renderNeverVoted },
  { path: '/upload',      title: 'Upload',      render: renderUpload },
  { path: '/map',         title: 'Map',         render: renderMap },
  { path: '/analytics',   title: 'Analytics',   render: renderAnalytics },
  { path: '/archive',     title: 'Archive',     render: renderArchive },
  { path: '/mailer',      title: 'Mailing Labels', render: renderMailer },
  { path: '/flyer',       title: 'Flyer Creator',  render: renderFlyerCreator },
]);

startRouter(container);
