import { debounce } from 'lodash-es';
import { storeToRefs } from 'pinia';
import { onMounted } from 'vue';
import {
    PageType,
    Preference,
} from '../enums';
import { useExtensionStore } from '../store';
import { usePageDetectionStore } from '../stores';
import {
    mergeRequestDraftFilterUrl,
    mergeRequestStateUrl,
} from '../utils/mergeRequestDraftFilter';
import {
    fetchMergeRequestCounts,
    type MergeRequestStateCounts,
    navigateMergeRequestList,
} from '../utils/mergeRequestListApp';

const DRAFT_TAB_ID = 'glab-enhancer-drafts-tab';
const OTHER_STATES = ['merged', 'closed', 'all'];

interface TabCounts {
    withoutDrafts: MergeRequestStateCounts;
    drafts: MergeRequestStateCounts;
    everything: MergeRequestStateCounts;
}

const TAB_COUNTS_STORAGE_KEY = 'glab-enhancer-browser-extension/tab-counts';
const MAX_STORED_TAB_COUNTS = 50;

let tabCounts: TabCounts | null = null;
let tabCountsKey = '';

// Counts per filter from earlier visits, so the tabs show them before the fresh counts arrive
function readStoredTabCounts(): Record<string, TabCounts> {
    try {
        return JSON.parse(localStorage.getItem(TAB_COUNTS_STORAGE_KEY) || '{}');
    } catch {
        return {};
    }
}

function storeTabCounts(filterKey: string, counts: TabCounts) {
    const stored = readStoredTabCounts();
    delete stored[filterKey];
    stored[filterKey] = counts;

    const keys = Object.keys(stored);
    keys.slice(0, Math.max(0, keys.length - MAX_STORED_TAB_COUNTS)).forEach(key => delete stored[key]);

    localStorage.setItem(TAB_COUNTS_STORAGE_KEY, JSON.stringify(stored));
}
let countsObserver: MutationObserver | null = null;
let observedTabs: Element | null = null;

function isPlainClick(event: MouseEvent) {
    return !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

function formatCount(count: number) {
    return count > 999 ? '999+' : String(count);
}

function setCount(link: Element | null | undefined, count: number | undefined) {
    const badge = link?.querySelector('.gl-tab-counter-badge') as HTMLElement | null;
    const content = badge?.querySelector('.gl-badge-content') || badge;
    if (!badge || !content) {
        return;
    }

    badge.style.display = count === undefined ? 'none' : '';

    const text = count === undefined ? '' : formatCount(count);
    if (content.textContent?.trim() !== text) {
        content.textContent = text;
    }
}

/**
 * GitLab counts every tab with the current draft filter. Show the open tab without drafts,
 * the drafts tab with only drafts, and the other states with both.
 */
function applyCounts(stateTabs: Element) {
    const linkFor = (testId: string) => stateTabs.querySelector(`[data-testid="${testId}"]`)?.closest('a');
    const draftLink = linkFor('drafts-issuables-tab');

    // The drafts tab can be added before GitLab gives the open tab its badge, so copy it once it exists
    const openBadge = linkFor('opened-issuables-tab')?.querySelector('.gl-tab-counter-badge');
    if (draftLink && openBadge && !draftLink.querySelector('.gl-tab-counter-badge')) {
        draftLink.appendChild(openBadge.cloneNode(true));
    }

    setCount(draftLink, tabCounts?.drafts.opened);

    if (!tabCounts) {
        return;
    }

    setCount(linkFor('opened-issuables-tab'), tabCounts.withoutDrafts.opened);
    OTHER_STATES.forEach(state => setCount(linkFor(`${state}-issuables-tab`), tabCounts!.everything[state as keyof MergeRequestStateCounts]));
}

function renderCounts(stateTabs: Element) {
    applyCounts(stateTabs);

    // Put the counts back right away when GitLab renders its own
    if (observedTabs !== stateTabs) {
        countsObserver?.disconnect();
        countsObserver = new MutationObserver(() => applyCounts(stateTabs));
        observedTabs = stateTabs;
        countsObserver.observe(stateTabs, {
            subtree: true,
            childList: true,
            characterData: true,
        });
    }

    const countsQuery = fetchMergeRequestCounts();
    if (!countsQuery || countsQuery.filterKey === tabCountsKey) {
        return;
    }

    tabCountsKey = countsQuery.filterKey;
    tabCounts = readStoredTabCounts()[countsQuery.filterKey] || null;
    applyCounts(stateTabs);

    countsQuery.load()
        .then(([withoutDrafts, drafts, everything]) => {
            if (countsQuery.filterKey !== tabCountsKey) {
                return;
            }

            tabCounts = {
                withoutDrafts,
                drafts,
                everything,
            };
            storeTabCounts(countsQuery.filterKey, tabCounts);
            applyCounts(stateTabs);
        })
        .catch(() => {
            tabCountsKey = '';
        });
}

function setActive(tab: HTMLElement, active: boolean) {
    tab.classList.toggle('active', active);

    const link = tab.querySelector('a');
    link?.classList.toggle('active', active);
    link?.classList.toggle('gl-tab-nav-item-active', active);
    link?.setAttribute('aria-selected', String(active));
    active ? link?.removeAttribute('tabindex') : link?.setAttribute('tabindex', '-1');
}

function navigate(draft: boolean, replace = false) {
    navigateMergeRequestList(mergeRequestDraftFilterUrl(window.location.href, draft), replace);
}

export function useSeparateDraftMrs() {
    const { getSetting } = useExtensionStore();
    const { pageType } = storeToRefs(usePageDetectionStore());

    function isEnabled() {
        return getSetting(Preference.MR_SEPARATE_DRAFTS, false) && [
            PageType.DASHBOARD_MERGE_REQUESTS,
            PageType.GROUP_MERGE_REQUESTS,
            PageType.PROJECT_MERGE_REQUESTS,
        ].includes(pageType.value);
    }

    function render() {
        if (!isEnabled()) {
            return;
        }

        const stateTabs = document.querySelector('.issuable-state-filters');
        const openedTitle = stateTabs?.querySelector('[data-testid="opened-issuables-tab"]');
        const openedLink = (openedTitle?.closest('a') || stateTabs?.querySelector('a[href*="state=opened"]')) as HTMLAnchorElement | null;
        const openedTab = openedLink?.closest('li');

        if (!stateTabs || !openedLink || !openedTab) {
            return;
        }

        openedLink.href = mergeRequestDraftFilterUrl(window.location.href, false);

        if (!openedLink.dataset.glabEnhancerDraftFilter) {
            openedLink.dataset.glabEnhancerDraftFilter = 'true';
            openedLink.addEventListener('click', (event) => {
                if (!isPlainClick(event)) {
                    return;
                }

                event.preventDefault();
                event.stopImmediatePropagation();
                setActive(openedTab, true);
                const draftTab = document.getElementById(DRAFT_TAB_ID);
                if (draftTab) {
                    setActive(draftTab, false);
                }
                navigate(false);
            }, true);
        }

        let draftTab = document.getElementById(DRAFT_TAB_ID) as HTMLElement | null;
        if (!draftTab) {
            draftTab = openedTab.cloneNode(true) as HTMLElement;
            draftTab.id = DRAFT_TAB_ID;
            draftTab.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));

            const title = draftTab.querySelector('[data-testid="opened-issuables-tab"]') ||
                draftTab.querySelector('a span:not(.badge)');
            if (title) {
                title.textContent = 'Drafts';
                title.setAttribute('data-testid', 'drafts-issuables-tab');
                title.removeAttribute('title');
            }

            openedTab.insertAdjacentElement('afterend', draftTab);
        }

        const draftLink = draftTab.querySelector('a') as HTMLAnchorElement | null;
        if (!draftLink) {
            return;
        }

        draftLink.href = mergeRequestDraftFilterUrl(window.location.href, true);
        draftLink.removeAttribute('aria-controls');
        draftLink.removeAttribute('data-toggle');
        draftLink.removeAttribute('data-bs-toggle');

        if (!draftLink.dataset.glabEnhancerDraftTab) {
            draftLink.dataset.glabEnhancerDraftTab = 'true';
            draftLink.addEventListener('click', (event) => {
                if (!isPlainClick(event)) {
                    return;
                }

                event.preventDefault();
                setActive(openedTab, false);
                setActive(draftTab, true);
                navigate(true);
            });
        }

        OTHER_STATES.forEach((state) => {
            const link = stateTabs.querySelector(`[data-testid="${state}-issuables-tab"]`)?.closest('a');
            if (!link || link.dataset.glabEnhancerStateTab) {
                return;
            }

            link.dataset.glabEnhancerStateTab = 'true';
            link.addEventListener('click', (event) => {
                if (!isPlainClick(event)) {
                    return;
                }

                event.preventDefault();
                event.stopImmediatePropagation();
                setActive(draftTab, false);
                navigateMergeRequestList(mergeRequestStateUrl(window.location.href, state));
            }, true);
        });

        renderCounts(stateTabs);

        const tabLinks = stateTabs.querySelectorAll('ul[role="tablist"] > li > a[role="tab"]');
        tabLinks.forEach((link, index) => {
            link.setAttribute('aria-setsize', String(tabLinks.length));
            link.setAttribute('aria-posinset', String(index + 1));
        });

        const currentUrl = new URL(window.location.href);
        const isOpenState = (currentUrl.searchParams.get('state') || 'opened') === 'opened';
        const isDraftTabActive =
            isOpenState &&
            currentUrl.searchParams.get('draft') === 'yes';

        setActive(openedTab, isOpenState && !isDraftTabActive);
        setActive(draftTab, isDraftTabActive);

        if (
            isOpenState &&
            !currentUrl.searchParams.has('draft')
        ) {
            navigate(false, true);
        }
    }

    // GitLab renders the tabs after the app starts, so add the drafts tab in the same frame they appear
    function watchForTabs() {
        let frame = 0;

        new MutationObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                if (isEnabled() && document.querySelector('.issuable-state-filters') && !document.getElementById(DRAFT_TAB_ID)) {
                    render();
                }
            });
        }).observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    onMounted(() => {
        render();
        watchForTabs();
    });

    return {
        render: debounce(render, 300),
        renderNow: render,
    };
}
