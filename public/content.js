const APP_ID = 'glab-enhancer-browser-extension';

const PERSISTENT_FILTER_PATHS = [
    '/dashboard/issues',
    '/dashboard/merge_requests',
    '/-/issues',
    '/-/boards',
    '/-/merge_requests',
    '/-/pipelines',
];

function readMap(key) {
    try {
        return new Map(JSON.parse(localStorage.getItem(key) || '[]'));
    } catch {
        return new Map();
    }
}

function sortQueryParams(search, removeKeys) {
    const params = new URLSearchParams(search);
    const sortedParams = new URLSearchParams();

    Array.from(params.keys())
        .sort()
        .forEach((key) => {
            if (!removeKeys.includes(key)) {
                sortedParams.set(key, params.get(key) || '');
            }
        });

    return sortedParams.toString();
}

function persistentFilterKey(url) {
    const pathname = url.pathname.replace(/\/$/, '');
    if (!PERSISTENT_FILTER_PATHS.some(path => pathname.includes(path))) {
        return '';
    }

    // The dashboards share one pathname, so tell them apart by their user filter
    if (pathname === '/dashboard/merge_requests' || pathname === '/dashboard/issues') {
        const key = ['assignee_username', 'assignee_username[]', 'reviewer_username'].find(name => url.searchParams.has(name));
        if (key) {
            return `${pathname}?${key}=${url.searchParams.get(key)}`;
        }
    }

    return pathname;
}

function applyPersistentFilters(url) {
    const key = persistentFilterKey(url);
    if (!key) {
        return url;
    }

    const removeKeys = ['first_page_size', 'page_after', 'page'];
    if (url.pathname === '/dashboard/issues') {
        removeKeys.push('assignee_username', 'assignee_username[]', 'sort', 'state');
    }
    if (url.pathname === '/dashboard/merge_requests') {
        removeKeys.push('assignee_username', 'reviewer_username');
    }

    const search = readMap(`${APP_ID}/persistent-filters`).get(key) || '';
    const cachedSearch = sortQueryParams(search, removeKeys);
    const currentSearch = sortQueryParams(url.search, removeKeys);

    if (currentSearch || !cachedSearch || cachedSearch === currentSearch) {
        return url;
    }

    return new URL(key + search, url.origin);
}

function applyDraftFilter(url) {
    const isOpenMergeRequestList = /\/merge_requests\/?$/.test(url.pathname) && (url.searchParams.get('state') || 'opened') === 'opened';
    if (!isOpenMergeRequestList || url.searchParams.has('draft')) {
        return url;
    }

    const draftUrl = new URL(url);
    draftUrl.searchParams.set('state', 'opened');
    draftUrl.searchParams.set('draft', 'no');

    return draftUrl;
}

/**
 * Rewrites the address before GitLab's own scripts read it, so the list loads with the right filters
 * at once instead of loading twice.
 */
function applyFiltersBeforeLoad() {
    if (document.readyState !== 'loading') {
        return;
    }

    const settings = readMap(APP_ID);
    let url = new URL(window.location.href);

    if (settings.get('general_persistent_filters') !== false) {
        url = applyPersistentFilters(url);
    }

    if (settings.get('mr_separate_drafts')) {
        url = applyDraftFilter(url);
    }

    if (url.href !== window.location.href) {
        history.replaceState(history.state, '', url);
    }
}

function initialize() {
    if (document.getElementById(APP_ID)) {
        return;
    }

    const contentWrapperDiv = document.querySelector('.layout-page .content-wrapper');
    const paddingRight = contentWrapperDiv ? window.getComputedStyle(contentWrapperDiv).getPropertyValue('padding-right').replace('px', '') : 0;

    const appContainer = document.createElement('div');
    appContainer.style.right = parseInt(paddingRight || 0) + 16 + 'px';
    appContainer.id = APP_ID;
    document.body.appendChild(appContainer);

    const cssScript = document.createElement('link');
    cssScript.rel = 'stylesheet';
    cssScript.type = 'text/css';
    cssScript.href = chrome.runtime.getURL('/assets/main.css');
    document.body.appendChild(cssScript);

    const appScript = document.createElement('script');
    appScript.src = chrome.runtime.getURL('/assets/main.js');
    appScript.type = 'module';
    document.body.appendChild(appScript);
}

applyFiltersBeforeLoad();

chrome.storage.local.get(function (result) {
    const domains = (result.customGitlabDomains || '').split(',')
        .map((url) => url.trim()
            .replace(/\/$/, ''));
    domains.push('https://gitlab.com');

    if (!domains.includes(window.location.origin)) {
        return;
    }

    // Start the app as soon as the page is parsed, without waiting for images and other slow requests
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
});
