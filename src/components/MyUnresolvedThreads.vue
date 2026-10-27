<template>
    <div>
        <div v-if="isShowMyUnresolvedEnabled">
            <template
                v-for="teleportId in teleportIds"
                :key="teleportId"
            >
                <teleport
                    v-if="teleportElements[teleportId]"
                    :to="`#${teleportId}`"
                >
                    <li
                        v-if="myBadges.get(teleportId)"
                        :class="myBadges.get(teleportId)!.hasResponses ? 'badge-info' : 'badge-neutral'"
                        class="has-tooltip gl-display-none gl-sm-display-block md badge badge-pill gl-badge"
                        :style="{
                            color: `var(--gl-badge-${myBadges.get(teleportId)!.hasResponses ? 'info' : 'neutral'}-text-color-default) !important`,
                            listStyle: 'none',
                        }"
                        :title="myBadges.get(teleportId)!.title"
                    >
                        <SvgIcon
                            class="gl-icon s16 gl-mr-2"
                            :path="myBadges.get(teleportId)!.hasResponses ? mdiCommentTextMultipleOutline : mdiCommentAccountOutline"
                            style="fill: currentColor;"
                        />

                        <span class="gl-font-weight-bold">{{ myBadges.get(teleportId)!.count }}</span>
                    </li>

                    <li
                        v-if="unresolvedThreadsCount.get(teleportId) && !nativeThreadStatusIds.has(teleportId)"
                        class="has-tooltip gl-display-none gl-sm-display-block gl-mr-3 md badge badge-pill gl-badge badge-warning"
                        :style="{
                            color: 'var(--gl-badge-warning-text-color-default) !important',
                            listStyle: 'none',
                        }"
                        title="Unresolved threads"
                    >
                        <SvgIcon
                            class="gl-icon s16 gl-mr-2"
                            :path="mdiCommentAlertOutline"
                            style="fill: currentColor;"
                        />

                        <span class="gl-font-weight-bold">{{ unresolvedThreadsCount.get(teleportId) }}</span>
                    </li>
                </teleport>
            </template>
        </div>
    </div>
</template>

<script
    lang="ts"
    setup
>
    import {
        mdiCommentAccountOutline,
        mdiCommentAlertOutline,
        mdiCommentTextMultipleOutline,
    } from '@mdi/js';
    import { debounce } from 'lodash-es';
    import {
        computed,
        onBeforeUnmount,
        onMounted,
        ref,
        type Ref,
        shallowRef,
        type ShallowRef,
    } from 'vue';
    import { fetchUnresolvedThreadCounts } from '../apis/mergeRequest';
    import { useFetchPaging } from '../composables/useFetchPaging';
    import { useMitt } from '../composables/useMitt';
    import {
        type ThreadCounts,
        useThreadCountsCache,
    } from '../composables/useThreadCountsCache';
    import {
        MittEventKey,
        Preference,
    } from '../enums';
    import { useExtensionStore } from '../store';
    import type { GitLabDiscussion } from '../types';
    import SvgIcon from './SvgIcon.vue';

    type IID = string | Array<string>;

    interface Props {
        currentProjectPath?: string,
        isMergeRequest?: boolean,
    }

    const {
        currentProjectPath = '',
        isMergeRequest = true,
    } = defineProps<Props>();

    const {
        gitlabUserId,
        getSetting,
    } = useExtensionStore();

    const {
        on,
        off,
    } = useMitt();

    const extractIssuableIds: ShallowRef<Array<IID>> = shallowRef([]);
    const discussions: Ref<Map<string, GitLabDiscussion[]>> = ref(new Map());

    function getProjectPath(iid: IID): string {
        return Array.isArray(iid) ? iid[0] : currentProjectPath;
    }

    function getIid(iid: IID): string {
        return Array.isArray(iid) ? iid[1] : iid;
    }

    function getTeleportId(idd: IID): string {
        return ('teleport-issuable-meta-' + getProjectPath(idd) + '-' + getIid(idd)).replace(/\//g, '_');
    }

    const isShowMyUnresolvedWithResponsesEnabled = computed(() => (isMergeRequest && !!getSetting(Preference.MR_SHOW_MY_UNRESOLVED_THREADS_WITH_RESPONSES, true) || (!isMergeRequest && !!getSetting(Preference.ISSUE_SHOW_MY_UNRESOLVED_THREADS_WITH_RESPONSES, true))));
    const isShowMyUnresolvedEnabled = computed(() => (isMergeRequest && !!getSetting(Preference.MR_SHOW_MY_UNRESOLVED_THREADS, true) || (!isMergeRequest && !!getSetting(Preference.ISSUE_SHOW_MY_UNRESOLVED_THREADS, true))));
    const teleportIds = computed(() => extractIssuableIds.value.map((iid) => getTeleportId(iid)));

    const teleportElements = computed(() => teleportIds.value.reduce((acc, teleportId) => {
        acc[teleportId] = document.getElementById(teleportId);
        return acc;
    }, {} as Record<string, HTMLElement | null>));

    // Last known counts per merge request, so badges show right away on the next visit
    const cachedCounts = useThreadCountsCache();
    const csrfToken = (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement | null)?.content || '';
    const MAX_CACHED_COUNTS = 500;
    const pendingIds = new Set<string>();

    function cacheKey(iid: IID) {
        return `${getProjectPath(iid)}!${getIid(iid)}`;
    }

    function countThreads(items: GitLabDiscussion[]): ThreadCounts {
        const counts = {
            unresolved: 0,
            mine: 0,
            mineWithResponses: 0,
        };

        items.forEach((discussion) => {
            const firstNote = discussion?.notes?.[0] || null;
            if (!firstNote?.resolvable || firstNote?.resolved) {
                return;
            }

            counts.unresolved++;

            if (firstNote?.author?.id !== gitlabUserId) {
                return;
            }

            counts.mine++;

            const notes = (discussion?.notes || []).filter(note => !note.system);
            const lastNote = notes[notes.length - 1] || null;
            if (lastNote && lastNote.author.id !== gitlabUserId) {
                counts.mineWithResponses++;
            }
        });

        return counts;
    }

    const threadCounts = computed(() => {
        const items: Map<string, ThreadCounts | undefined> = new Map();

        extractIssuableIds.value.forEach((iid) => {
            const loaded = discussions.value.get(getIid(iid));
            items.set(getTeleportId(iid), loaded ? countThreads(loaded) : cachedCounts.value.get(cacheKey(iid)));
        });

        return items;
    });

    const unresolvedThreadsCount = computed(() => new Map([...threadCounts.value].map(([id, counts]) => [id, counts?.unresolved || 0])));

    // One badge for your own unresolved threads, highlighted when someone replied to them
    const myBadges = computed(() => {
        const badges: Map<string, { count: number, hasResponses: boolean, title: string }> = new Map();

        threadCounts.value.forEach((counts, id) => {
            const withResponses = isShowMyUnresolvedWithResponsesEnabled.value ? counts?.mineWithResponses || 0 : 0;
            const mine = counts?.mine || 0;

            if (withResponses) {
                badges.set(id, {
                    count: withResponses,
                    hasResponses: true,
                    title: `${withResponses} of your ${mine} unresolved ${mine === 1 ? 'thread has' : 'threads have'} a reply`,
                });
            } else if (mine) {
                badges.set(id, {
                    count: mine,
                    hasResponses: false,
                    title: `Your ${mine} unresolved ${mine === 1 ? 'thread' : 'threads'}, without replies`,
                });
            }
        });

        return badges;
    });

    // Rows where GitLab shows thread status itself, as "Resolved" or "1 of 3"
    const nativeThreadStatusIds: Ref<Set<string>> = shallowRef(new Set());

    function rememberCounts(iid: IID, counts: ThreadCounts) {
        const key = cacheKey(iid);
        cachedCounts.value.delete(key);
        cachedCounts.value.set(key, counts);
        if (cachedCounts.value.size > MAX_CACHED_COUNTS) {
            cachedCounts.value.delete(cachedCounts.value.keys().next().value!);
        }
    }

    function fetchDiscussionsOf(iid: IID) {
        const id = getIid(iid);
        const endpoint = `/api/v4/projects/${encodeURIComponent(getProjectPath(iid))}/${isMergeRequest ? 'merge_requests' : 'issues'}/${id}/discussions`;

        return useFetchPaging(endpoint)
            .then(({ data }) => {
                if (data?.value) {
                    discussions.value.set(id, data?.value || [] as GitLabDiscussion[]);
                    rememberCounts(iid, countThreads(data.value));
                }
            });
    }

    /**
     * Counts unresolved threads with one request per project first, so only merge requests that
     * have some need their discussions fetched. Falls back to fetching them all.
     */
    async function fetchMergeRequestDiscussions(projectPath: string, iids: IID[]) {
        const counts = await fetchUnresolvedThreadCounts(projectPath, iids.map(getIid), csrfToken);

        return Promise.all(iids.map((iid) => {
            if (counts?.get(getIid(iid)) === 0) {
                discussions.value.set(getIid(iid), []);
                rememberCounts(iid, countThreads([]));
                return null;
            }

            return fetchDiscussionsOf(iid);
        }));
    }

    function fetchDiscussions(isForced: boolean = false) {
        const toFetch = extractIssuableIds.value.filter((iid) => {
            const id = getIid(iid);
            return id && !pendingIds.has(id) && (isForced || !discussions.value.has(id));
        });
        toFetch.forEach(iid => pendingIds.add(getIid(iid)));

        const release = (iids: IID[]) => () => iids.forEach(iid => pendingIds.delete(getIid(iid)));

        if (!isMergeRequest) {
            toFetch.forEach(iid => fetchDiscussionsOf(iid).finally(release([iid])));
            return;
        }

        const byProject = new Map<string, IID[]>();
        toFetch.forEach(iid => byProject.set(getProjectPath(iid), [...(byProject.get(getProjectPath(iid)) || []), iid]));
        byProject.forEach((iids, projectPath) => {
            for (let start = 0; start < iids.length; start += 100) {
                const batch = iids.slice(start, start + 100);
                fetchMergeRequestDiscussions(projectPath, batch).finally(release(batch));
            }
        });
    }

    function extractIssuableIids() {
        const values: Array<string | Array<string>> = [];
        const nativeIds = new Set<string>();
        document.querySelectorAll('.issuable-list > li .issuable-reference, div[data-testid="merge-request-dashboard-tab"] div[data-testid="merge-request"] > div[role="cell"]:nth-child(2) > div:not([data-testid="labels-container"])')
            .forEach((el) => {
                const text = el.textContent || '';
                const regex = /^[\s\n]*([a-zA-Z0-9/_-]+)[!#](\d+)|[!#](\d+)/;
                const match = text.match(regex);

                let resolvedId: string | string[] = '';
                if (match) {
                    if (match[1] && match[2]) {
                        // Has explicit project path before ! or #
                        resolvedId = [
                            match[1],
                            match[2],
                        ];
                    } else if (match[3]) {
                        // Only an IID like #123 or !123
                        resolvedId = match[3];
                    }
                }

                values.push(resolvedId);

                // add teleport placeholder
                const containerElement = el.closest(isMergeRequest ? '.issuable-info-container, .issue, div[data-testid="merge-request"]' : 'li.issue');
                const metaElement = containerElement?.querySelector('li[data-testid="issuable-comments"], li:has(svg[data-testid="comments-icon"]), div[role="cell"] > div:has(svg[data-testid="comments-icon"])');

                const teleportId = getTeleportId(resolvedId);
                const hasNativeThreadStatus = [...containerElement?.querySelectorAll('.gl-badge, .badge') || []]
                    .some(badge => /^(Resolved|\d+ of \d+)$/.test(badge.textContent?.trim() || ''));
                if (hasNativeThreadStatus) {
                    nativeIds.add(teleportId);
                }

                if (!document.getElementById(teleportId) && metaElement?.parentElement) {
                    const placeholderElement = document.createElement('div');
                    placeholderElement.style.display = 'flex';
                    placeholderElement.style.alignItems = 'center';
                    placeholderElement.style.gap = '4px';
                    placeholderElement.id = teleportId;
                    metaElement.parentElement.insertBefore(placeholderElement, metaElement.nextSibling);
                }
            });

        extractIssuableIds.value = values;
        if ([...nativeIds].join() !== [...nativeThreadStatusIds.value].join()) {
            nativeThreadStatusIds.value = nativeIds;
        }

        fetchDiscussions();
    }

    const debouncedExtractIssuableIids = debounce(extractIssuableIids, 400);
    const debouncedForceFetchDiscussions = debounce(() => fetchDiscussions(true), 600);

    function onClickHandler(event: Event) {
        const targetEl = event.target as HTMLElement;
        if (targetEl.closest('.crud-header [data-testid="crud-collapse-toggle"]')) {
            debouncedExtractIssuableIids();
        }
    }

    function onPageContentChanged() {
        extractIssuableIids();
    }

    function onBrowserRequestCompleted(data?: Record<string, any> | string | number) {
        debouncedExtractIssuableIids();

        // GraphQL reads are POST requests too, so only other requests can mean threads changed
        if (typeof data === 'object' && data !== null && data['method'] !== 'GET' && !String(data['url']).includes('/api/graphql')) {
            debouncedForceFetchDiscussions();
        }
    }

    onMounted(() => {
        if (!isShowMyUnresolvedEnabled.value) {
            return;
        }

        if (document.querySelector('.crud-header [data-testid="crud-collapse-toggle"]')) {
            document.addEventListener('click', onClickHandler);
        }

        on(MittEventKey.BROWSER_REQUEST_COMPLETED, onBrowserRequestCompleted);
        on(MittEventKey.PAGE_CONTENT_CHANGED, onPageContentChanged);
        extractIssuableIids();
    });

    onBeforeUnmount(() => {
        off(MittEventKey.BROWSER_REQUEST_COMPLETED, onBrowserRequestCompleted);
        off(MittEventKey.PAGE_CONTENT_CHANGED, onPageContentChanged);
        document.removeEventListener('click', onClickHandler);
    });
</script>
