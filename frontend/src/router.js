/**
 * Simple hash-based router for SPA navigation.
 * Routes are defined as { path, title, render(container) }.
 */

let routes = [];
let currentCleanup = null;

export function registerRoutes(routeList) {
  routes = routeList;
}

export function navigateTo(path) {
  window.location.hash = path;
}

export function getCurrentPath() {
  return window.location.hash.slice(1) || '/';
}

export function startRouter(container) {
  async function handleRoute() {
    const path = getCurrentPath();
    const route = routes.find(r => r.path === path) || routes.find(r => r.path === '/');

    // Run cleanup from previous page
    if (typeof currentCleanup === 'function') {
      currentCleanup();
      currentCleanup = null;
    }

    document.title = `${route.title} | Voter Platform`;

    // Transition animation
    container.classList.remove('page-active');
    container.classList.add('page-enter');

    container.innerHTML = '';
    const cleanup = await route.render(container);
    if (typeof cleanup === 'function') currentCleanup = cleanup;

    // Trigger enter animation
    requestAnimationFrame(() => {
      container.classList.remove('page-enter');
      container.classList.add('page-active');
    });
  }

  window.addEventListener('hashchange', handleRoute);
  handleRoute();

  return () => window.removeEventListener('hashchange', handleRoute);
}
