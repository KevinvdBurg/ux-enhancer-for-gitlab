<template>
    <div
        v-if="layout"
        :class="{
            'contributors-sidebar--collapsed': isCollapsed,
        }"
        class="contributors-sidebar"
        :style="layout.style"
    >
        <button
            v-if="isCollapsed"
            class="contributors-sidebar__expand btn btn-default btn-md gl-button has-tooltip"
            title="Show contributors"
            type="button"
            @click="isCollapsed = false"
        >
            <SvgIcon :path="mdiAccountGroupOutline" />

            <span>{{ summaries.length }}</span>
        </button>

        <template v-else>
            <div class="contributors-sidebar__header">
                <SvgIcon :path="mdiAccountGroupOutline" />

                <strong class="gl-flex-grow-1">Contributors</strong>

                <button
                    class="btn btn-default btn-sm gl-button btn-default-tertiary btn-icon has-tooltip"
                    title="Refresh"
                    type="button"
                    @click="refresh"
                >
                    <SvgIcon
                        :class="{
                            'contributors-sidebar__spin': isLoading,
                        }"
                        :path="mdiRefresh"
                    />
                </button>

                <button
                    class="btn btn-default btn-sm gl-button btn-default-tertiary btn-icon has-tooltip"
                    title="Hide contributors"
                    type="button"
                    @click="isCollapsed = true"
                >
                    <SvgIcon :path="mdiChevronRight" />
                </button>
            </div>

            <div
                v-if="gitlabUsername"
                aria-label="My reviews"
                class="contributors-sidebar__reviews"
                role="group"
            >
                <button
                    v-for="option in reviewedOptions"
                    :key="option.value"

                    :aria-pressed="reviewedFilter === option.value"
                    :class="{
                        'contributors-sidebar__review--active': reviewedFilter === option.value,
                    }"
                    class="contributors-sidebar__review"
                    :title="reviewedFilter === option.value ? 'Clear filter' : option.title"
                    type="button"
                    @click="toggleReviewedByMe(option.value)"
                >
                    <span class="gl-flex-grow-1">{{ option.label }}</span>

                    <span class="contributors-sidebar__count">{{ reviewedCounts[option.value] ?? '…' }}</span>
                </button>
            </div>

            <div class="contributors-sidebar__modes">
                <button
                    v-for="option in modeOptions"
                    :key="option.value"

                    :aria-pressed="mode === option.value"
                    :class="{
                        'contributors-sidebar__mode--active': mode === option.value,
                    }"
                    class="contributors-sidebar__mode"
                    type="button"
                    @click="mode = option.value"
                >
                    {{ option.label }}
                </button>
            </div>

            <div class="contributors-sidebar__legend">
                <span
                    v-for="category in visibleCategories"
                    :key="category"
                >
                    <i
                        class="contributors-sidebar__dot"
                        :style="{ background: CATEGORY_META[category].color }"
                    />
                    {{ CATEGORY_META[category].label }}
                </span>
            </div>

            <div
                :class="{
                    'contributors-sidebar__list--stale': isStale,
                }"
                class="contributors-sidebar__list"
            >
                <p
                    v-if="error"
                    class="contributors-sidebar__message"
                >
                    Could not load merge requests: {{ error }}
                </p>

                <p
                    v-else-if="isLoading && !summaries.length"
                    class="contributors-sidebar__message"
                >
                    Loading…
                </p>

                <p
                    v-else-if="!summaries.length"
                    class="contributors-sidebar__message"
                >
                    No {{ mode === 'reviewers' ? 'reviewers' : 'authors' }} for these filters
                </p>

                <button
                    v-for="summary in summaries"
                    :key="summary.user.id"

                    :aria-pressed="summary.user.username === selectedUsername"
                    :class="{
                        'contributors-sidebar__row--active': summary.user.username === selectedUsername,
                    }"
                    class="contributors-sidebar__row"
                    :title="summary.user.username === selectedUsername ? 'Clear filter' : `Show only merge requests ${mode === 'reviewers' ? 'reviewed by' : 'by'} ${summary.user.name}`"
                    type="button"
                    @click="toggleFilter(summary.user.username)"
                >
                    <img
                        alt=""
                        class="contributors-sidebar__avatar"
                        :src="summary.user.avatar_url"
                    >

                    <span class="contributors-sidebar__details">
                        <span class="contributors-sidebar__name">
                            <span>{{ summary.user.name }}</span>

                            <SvgIcon
                                v-if="summary.user.username === selectedUsername"
                                class="contributors-sidebar__clear"
                                :path="mdiClose"
                            />
                        </span>

                        <span class="contributors-sidebar__bar">
                            <span
                                v-for="category in CONTRIBUTOR_CATEGORIES.filter(key => summary.counts[key])"
                                :key="category"
                                :style="{
                                    background: CATEGORY_META[category].color,
                                    flexGrow: summary.counts[category],
                                }"
                            />
                        </span>

                        <span class="contributors-sidebar__meta">
                            <span
                                v-for="category in CONTRIBUTOR_CATEGORIES.filter(key => summary.counts[key])"
                                :key="category"
                                :title="CATEGORY_META[category].label"
                            >
                                <i
                                    class="contributors-sidebar__dot"
                                    :style="{ background: CATEGORY_META[category].color }"
                                />
                                {{ summary.counts[category] }}
                            </span>

                            <span
                                v-if="isOpenState && summary.oldestCreatedAt"
                                class="gl-ml-auto"
                                title="Age of oldest merge request"
                            >
                                oldest {{ formatAge(summary.oldestCreatedAt) }}
                            </span>
                        </span>
                    </span>

                    <span class="contributors-sidebar__count">{{ summary.total }}</span>
                </button>
            </div>

            <p
                v-if="fetchedCount < total"
                class="contributors-sidebar__footer"
            >
                Based on the newest {{ fetchedCount }} of {{ total }} merge requests
            </p>
        </template>
    </div>
</template>

<script
    lang="ts"
    setup
>
    import {
        mdiAccountGroupOutline,
        mdiChevronRight,
        mdiClose,
        mdiRefresh,
    } from '@mdi/js';
    import {
        useEventListener,
        useMutationObserver,
    } from '@vueuse/core';
    import { debounce } from 'lodash-es';
    import { storeToRefs } from 'pinia';
    import {
        computed,
        onBeforeUnmount,
        onMounted,
        ref,
        type Ref,
        shallowRef,
        watch,
    } from 'vue';
    import {
        countMergeRequests,
        fetchMergeRequests,
        mergeRequestsEndpoint,
    } from '../apis/mergeRequest';
    import { APP_NAMESPACE } from '../constants';
    import { Preference } from '../enums';
    import { useExtensionStore } from '../store';
    import { usePageDetectionStore } from '../stores';
    import {
        activeContributor,
        CONTRIBUTOR_CATEGORIES,
        contributorApiParams,
        contributorFilterUrl,
        excludedApprovers,
        reviewedByMeFilter,
        reviewedByMeUrl,
        summarizeContributors,
    } from '../utils/mergeRequestContributors';
    import { navigateMergeRequestList } from '../utils/mergeRequestListApp';
    import SvgIcon from './SvgIcon.vue';

    type ContributorMode = 'authors' | 'reviewers';
    type ReviewedMode = 'reviewed' | 'not_reviewed';
    type ContributorSummary = ReturnType<typeof summarizeContributors>[number];

    interface Props {
        currentProjectPath: string,
        isGroup?: boolean,
    }

    const {
        currentProjectPath,
        isGroup = false,
    } = defineProps<Props>();

    const MAX_PAGES = 5;
    const PANEL_WIDTH = 300;
    const MIN_DOCKED_WIDTH = 220;
    const COLLAPSED_WIDTH = 72;
    const GAP = 16;

    const CATEGORY_META: Record<string, { label: string, color: string }> = {
        ready: {
            label: 'Ready to merge',
            color: 'var(--gl-status-success-icon-color, #108548)',
        },
        review: {
            label: 'Waiting for review',
            color: 'var(--gl-status-info-icon-color, #1f75cb)',
        },
        blocked: {
            label: 'Blocked',
            color: 'var(--gl-status-warning-icon-color, #c17d10)',
        },
        draft: {
            label: 'Draft',
            color: 'var(--gl-status-neutral-icon-color, #737278)',
        },
        merged: {
            label: 'Merged',
            color: 'var(--gl-status-brand-icon-color, #7b58cf)',
        },
        closed: {
            label: 'Closed',
            color: 'var(--gl-status-danger-icon-color, #dd2b0e)',
        },
    };

    const reviewedOptions: Array<{ value: ReviewedMode, label: string, title: string }> = [
        {
            value: 'reviewed',
            label: 'Reviewed',
            title: 'Open merge requests matching the other filters that you have approved',
        },
        {
            value: 'not_reviewed',
            label: 'Not reviewed',
            title: 'Open merge requests of others matching the other filters that you have not approved',
        },
    ];

    const modeOptions: Array<{ value: ContributorMode, label: string }> = [
        {
            value: 'authors',
            label: 'Authors',
        },
        {
            value: 'reviewers',
            label: 'Reviewers',
        },
    ];

    const {
        getSetting,
        setSetting,
    } = useExtensionStore();
    const { gitlabUsername } = storeToRefs(useExtensionStore());
    const { search } = storeToRefs(usePageDetectionStore());

    const mode = computed<ContributorMode>({
        get: () => getSetting(Preference.MR_CONTRIBUTORS_SIDEBAR_MODE, 'authors') as ContributorMode,
        set: value => setSetting(Preference.MR_CONTRIBUTORS_SIDEBAR_MODE, value),
    });

    const isCollapsed = computed<boolean>({
        get: () => !!getSetting(Preference.MR_CONTRIBUTORS_SIDEBAR_COLLAPSED, false),
        set: value => setSetting(Preference.MR_CONTRIBUTORS_SIDEBAR_COLLAPSED, value),
    });

    const summaries: Ref<ContributorSummary[]> = shallowRef([]);
    const total = ref(0);
    const fetchedCount = ref(0);
    const isLoading = ref(false);
    const isStale = ref(false);
    const error = ref('');
    const reviewedCounts: Ref<Record<ReviewedMode, number | null>> = ref({
        reviewed: null,
        not_reviewed: null,
    });

    // `search` follows GitLab's own pushState navigation, unlike the location href
    const href = computed(() => `${window.location.origin}${window.location.pathname}${search.value}`);

    const pageState = computed(() => new URL(href.value).searchParams.get('state') || 'opened');
    const isOpenState = computed(() => pageState.value === 'opened');
    const selectedUsername = computed(() => activeContributor(href.value, mode.value));
    // The page's filters without the reviewed filter itself, so both buttons count what the list would show
    const reviewedCountParams = computed(() => {
        const params = contributorApiParams(reviewedByMeUrl(href.value, gitlabUsername.value, null));
        params.set('state', 'opened');
        return params.toString();
    });
    const reviewedFilter = computed(() => gitlabUsername.value ? reviewedByMeFilter(href.value, gitlabUsername.value) : null);

    const visibleCategories = computed(() => {
        if (pageState.value === 'all') {
            return CONTRIBUTOR_CATEGORIES;
        }

        if (pageState.value === 'opened') {
            return CONTRIBUTOR_CATEGORIES.filter(category => category !== 'merged' && category !== 'closed');
        }

        return [pageState.value];
    });

    let lastRequestKey = '';
    let requestId = 0;

    async function load(isForced = false) {
        const endpoint = mergeRequestsEndpoint(currentProjectPath, isGroup);
        const params = contributorApiParams(href.value, mode.value);
        const requestKey = `${endpoint}?${params.toString()}#${mode.value}`;

        if (!isForced && requestKey === lastRequestKey) {
            return;
        }

        lastRequestKey = requestKey;
        const currentRequestId = ++requestId;
        const cacheKey = `${APP_NAMESPACE}/contributors/${requestKey}`;
        isLoading.value = true;
        error.value = '';

        // Show the last result for these filters right away, or dim the outdated one, while fetching
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
            ({
                summaries: summaries.value,
                total: total.value,
                fetchedCount: fetchedCount.value,
            } = JSON.parse(cached));
        }
        isStale.value = !cached;

        try {
            const [result, ...approvedResults] = await Promise.all([
                fetchMergeRequests(endpoint, params, MAX_PAGES),
                ...excludedApprovers(href.value).map((username) => {
                    const approvedParams = new URLSearchParams(params);
                    approvedParams.set('approved_by_usernames[]', username);
                    return fetchMergeRequests(endpoint, approvedParams, MAX_PAGES);
                }),
            ]);
            if (currentRequestId !== requestId) {
                return;
            }

            const approvedIds = new Set(approvedResults.flatMap(approved => approved.mergeRequests.map(mergeRequest => mergeRequest.id)));
            const mergeRequests = result.mergeRequests.filter(mergeRequest => !approvedIds.has(mergeRequest.id));
            const approvedCount = approvedResults.reduce((sum, approved) => sum + approved.total, 0);

            summaries.value = summarizeContributors(mergeRequests, mode.value);
            total.value = Math.max(result.total - approvedCount, mergeRequests.length);
            fetchedCount.value = mergeRequests.length;

            sessionStorage.setItem(cacheKey, JSON.stringify({
                summaries: summaries.value,
                total: total.value,
                fetchedCount: fetchedCount.value,
            }));
        } catch (err) {
            if (currentRequestId === requestId) {
                error.value = err instanceof Error ? err.message : 'unknown error';
                lastRequestKey = '';
            }
        } finally {
            if (currentRequestId === requestId) {
                isLoading.value = false;
                isStale.value = false;
            }
        }
    }

    let reviewedCountsRequestId = 0;

    async function loadReviewedByMeCount() {
        if (!gitlabUsername.value) {
            return;
        }

        const endpoint = mergeRequestsEndpoint(currentProjectPath, isGroup);
        const username = gitlabUsername.value;
        const currentRequestId = ++reviewedCountsRequestId;
        const params = (extra: Record<string, string>) => {
            const query = new URLSearchParams(reviewedCountParams.value);
            Object.entries(extra).forEach(([key, value]) => query.set(key, value));
            return query;
        };

        try {
            const [approved, othersOpen, othersApproved] = await Promise.all([
                countMergeRequests(endpoint, params({
                    'approved_by_usernames[]': username,
                })),
                countMergeRequests(endpoint, params({
                    'not[author_username]': username,
                })),
                countMergeRequests(endpoint, params({
                    'not[author_username]': username,
                    'approved_by_usernames[]': username,
                })),
            ]);

            if (currentRequestId === reviewedCountsRequestId) {
                reviewedCounts.value = {
                    reviewed: approved,
                    not_reviewed: othersOpen - othersApproved,
                };
            }
        } catch {
            if (currentRequestId === reviewedCountsRequestId) {
                reviewedCounts.value = {
                    reviewed: null,
                    not_reviewed: null,
                };
            }
        }
    }

    function toggleReviewedByMe(filter: ReviewedMode) {
        navigateMergeRequestList(reviewedByMeUrl(window.location.href, gitlabUsername.value, reviewedFilter.value === filter ? null : filter));
    }

    function refresh() {
        load(true);
        loadReviewedByMeCount();
    }

    function toggleFilter(username: string) {
        navigateMergeRequestList(contributorFilterUrl(window.location.href, mode.value, username));
    }

    function formatAge(createdAt: string) {
        const days = Math.floor((Date.now() - Date.parse(createdAt)) / 86_400_000);
        return days < 1 ? 'today' : `${days}d`;
    }

    // --- Layout: dock right of the list, making room for it when the page has no empty space there ---

    const layout: Ref<{ style: Record<string, string> } | null> = ref(null);

    let reservedElement: HTMLElement | null = null;
    let reservedSpace = 0;

    function reserveSpace(element: HTMLElement | null, space: number) {
        if (reservedElement && reservedElement !== element) {
            reservedElement.style.marginRight = '';
        }

        reservedElement = element;
        reservedSpace = space;

        if (element) {
            element.style.marginRight = space ? `${space}px` : '';
        }
    }

    function updateLayout() {
        const list = document.querySelector('.issuable-list-container');
        const content = list?.closest('main') as HTMLElement | null;
        const panel = document.querySelector('.js-static-panel-inner, .content-wrapper');

        if (!list || !content || !panel) {
            layout.value = null;
            reserveSpace(null, 0);
            return;
        }

        const panelRight = panel.getBoundingClientRect().right;
        const naturalGutter = panelRight - (list.getBoundingClientRect().right + reservedSpace) - GAP * 2;
        const minimumWidth = isCollapsed.value ? COLLAPSED_WIDTH : MIN_DOCKED_WIDTH;
        const wantedWidth = isCollapsed.value ? COLLAPSED_WIDTH : PANEL_WIDTH;

        reserveSpace(content, naturalGutter < minimumWidth ? Math.ceil(wantedWidth - naturalGutter) : 0);

        const listRect = list.getBoundingClientRect();
        const scrollArea = document.querySelector('.js-static-panel')?.getBoundingClientRect();
        const top = Math.max(listRect.top, (scrollArea?.top ?? 0) + GAP);

        layout.value = {
            style: {
                top: `${top}px`,
                left: `${listRect.right + GAP}px`,
                width: isCollapsed.value ? 'auto' : `${Math.min(PANEL_WIDTH, panelRight - listRect.right - GAP * 2)}px`,
                maxHeight: `${window.innerHeight - top - GAP}px`,
            },
        };
    }

    let layoutFrame = 0;

    function scheduleLayout() {
        cancelAnimationFrame(layoutFrame);
        layoutFrame = requestAnimationFrame(updateLayout);
    }

    useEventListener(window, 'resize', scheduleLayout);
    useEventListener(document, 'scroll', scheduleLayout, {
        capture: true,
        passive: true,
    });

    // GitLab can update the address a few times in a row when filtering
    const debouncedLoad = debounce(() => load(), 100);

    watch(href, () => {
        debouncedLoad();
        scheduleLayout();
    });

    watch(mode, () => load());

    watch(isCollapsed, scheduleLayout);

    watch([
        gitlabUsername,
        reviewedCountParams,
    ], loadReviewedByMeCount, {
        immediate: true,
    });

    onMounted(() => {
        load();
        updateLayout();
    });

    // The list renders after the app starts and can shift while it loads, so measure again on changes
    useMutationObserver(document.body, scheduleLayout, {
        childList: true,
        subtree: true,
    });

    onBeforeUnmount(() => reserveSpace(null, 0));
</script>

<style
    lang="scss"
    scoped
>
    .contributors-sidebar {
        position: fixed;
        z-index: 100;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid var(--gl-border-color-default, #dcdcde);
        border-radius: var(--gl-border-radius-lg, 0.5rem);
        background: var(--gl-background-color-default, #fff);
        color: var(--gl-text-color-default, #3a383f);
        font-size: 0.875rem;

        &--collapsed {
            border: 0;
            background: transparent;
            overflow: visible;
        }
    }

    .contributors-sidebar__expand {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .contributors-sidebar__header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.5rem 0.5rem 0.75rem;
        border-bottom: 1px solid var(--gl-border-color-default, #dcdcde);
    }

    .contributors-sidebar__reviews {
        display: flex;
        gap: 0.25rem;
        margin: 0.5rem 0.75rem 0;
    }

    .contributors-sidebar__review {
        display: flex;
        flex: 1 1 0;
        align-items: center;
        gap: 0.375rem;
        min-width: 0;
        padding: 0.25rem 0.25rem 0.25rem 0.5rem;
        border: 1px solid var(--gl-border-color-default, #dcdcde);
        border-radius: 0.375rem;
        background: transparent;
        color: inherit;
        font-weight: 600;
        text-align: left;
        white-space: nowrap;

        &:hover {
            background: var(--gl-background-color-subtle, #fbfafd);
        }

        &--active,
        &--active:hover {
            border-color: var(--gl-status-info-icon-color, #1f75cb);
            background: var(--gl-background-color-strong, #ececef);

            .contributors-sidebar__count {
                background: var(--gl-background-color-default, #fff);
            }
        }
    }

    .contributors-sidebar__modes {
        display: flex;
        gap: 0.25rem;
        margin: 0.5rem 0.75rem 0;
        padding: 0.125rem;
        border-radius: 0.375rem;
        background: var(--gl-background-color-subtle, #fbfafd);
    }

    .contributors-sidebar__mode {
        flex: 1;
        padding: 0.25rem;
        border: 0;
        border-radius: 0.25rem;
        background: transparent;
        color: var(--gl-text-color-subtle, #626168);

        &--active {
            background: var(--gl-background-color-strong, #ececef);
            color: var(--gl-text-color-default, #3a383f);
            font-weight: 600;
        }
    }

    .contributors-sidebar__legend {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem 0.75rem;
        padding: 0.5rem 0.75rem;
        color: var(--gl-text-color-subtle, #626168);
        font-size: 0.75rem;
    }

    .contributors-sidebar__dot {
        display: inline-block;
        width: 0.5rem;
        height: 0.5rem;
        margin-right: 0.125rem;
        border-radius: 50%;
    }

    .contributors-sidebar__list {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 0 0.25rem 0.25rem;
        transition: opacity 0.15s ease-in-out;

        &--stale {
            opacity: 0.5;
        }
    }

    .contributors-sidebar__spin {
        animation: contributors-sidebar-spin 0.8s linear infinite;
    }

    @keyframes contributors-sidebar-spin {
        to {
            transform: rotate(360deg);
        }
    }

    .contributors-sidebar__message {
        margin: 0.5rem;
        color: var(--gl-text-color-subtle, #626168);
    }

    .contributors-sidebar__row {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
        width: 100%;
        padding: 0.5rem;
        border: 0;
        border-radius: 0.375rem;
        background: transparent;
        color: inherit;
        text-align: left;

        &:hover {
            background: var(--gl-background-color-subtle, #fbfafd);
        }

        &--active,
        &--active:hover {
            background: var(--gl-background-color-strong, #ececef);
        }
    }

    .contributors-sidebar__avatar {
        flex: 0 0 auto;
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 50%;
    }

    .contributors-sidebar__details {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: 0.25rem;
        min-width: 0;
    }

    .contributors-sidebar__name {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-weight: 600;

        > span {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
    }

    .contributors-sidebar__clear {
        flex: 0 0 auto;
        color: var(--gl-text-color-subtle, #626168);
    }

    .contributors-sidebar__bar {
        display: flex;
        gap: 2px;
        height: 0.375rem;
        overflow: hidden;
        border-radius: 0.25rem;

        > span {
            flex-basis: 0;
        }
    }

    .contributors-sidebar__meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0 0.5rem;
        color: var(--gl-text-color-subtle, #626168);
        font-size: 0.75rem;
    }

    .contributors-sidebar__count {
        flex: 0 0 auto;
        min-width: 1.75rem;
        padding: 0 0.375rem;
        border-radius: 1rem;
        background: var(--gl-background-color-strong, #ececef);
        font-weight: 600;
        line-height: 1.5rem;
        text-align: center;
    }

    .contributors-sidebar__footer {
        margin: 0;
        padding: 0.5rem 0.75rem;
        border-top: 1px solid var(--gl-border-color-default, #dcdcde);
        color: var(--gl-text-color-subtle, #626168);
        font-size: 0.75rem;
    }
</style>
