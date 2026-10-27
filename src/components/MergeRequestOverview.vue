<template>
    <teleport
        v-if="isSummaryEnabled && barElement && mergeRequest"
        :to="barElement"
    >
        <div class="glab-enhancer-summary">
            <span
                v-if="status.category"
                :class="`badge-${CATEGORY_META[status.category].badge}`"
                class="gl-badge badge badge-pill has-tooltip"
                :title="status.reasons.length ? `${CATEGORY_META[status.category].label}: ${status.reasons.join(', ')}` : CATEGORY_META[status.category].label"
            >
                <span class="gl-badge-content">{{ CATEGORY_META[status.category].chip }}</span>
            </span>

            <span
                v-if="status.yourTurn"
                class="gl-badge badge badge-pill glab-enhancer-your-turn-badge has-tooltip"
                :title="status.yourTurn"
            >
                <span class="gl-badge-content">Your turn</span>
            </span>

            <button
                v-if="openThreads.length"
                class="glab-enhancer-summary__item has-tooltip"
                title="Go to the next open thread"
                type="button"
                @click="scrollToNext(openThreads, 'thread')"
            >
                <SvgIcon :path="mdiCommentAlertOutline" />
                {{ openThreads.length }} open {{ openThreads.length === 1 ? 'thread' : 'threads' }}
            </button>

            <a
                v-if="pipeline && pipeline.status !== 'success'"
                :class="`glab-enhancer-summary__item--${pipeline.status === 'failed' ? 'danger' : 'muted'}`"
                class="glab-enhancer-summary__item"
                :href="pipeline.web_url"
            >
                <SvgIcon :path="pipeline.status === 'failed' ? mdiCloseCircleOutline : mdiProgressClock" />
                Pipeline {{ pipeline.detailed_status?.text?.toLowerCase() || pipeline.status }}
            </a>

            <span
                v-if="approvals"
                :class="{
                    'glab-enhancer-summary__item--success': approvals.approved,
                }"
                class="glab-enhancer-summary__item has-tooltip"
                :title="approvals.missingRules.length ? `Still needs code owners: ${approvals.missingRules.join(', ')}` : ''"
            >
                <SvgIcon :path="mdiCheckDecagramOutline" />
                {{ approvals.approved ? 'Approved' : `${approvals.given} of ${approvals.required} approvals` }}
                <template v-if="!approvals.approved && approvals.missingRules.length">
                    · {{ approvals.missingRules.length }} code {{ approvals.missingRules.length === 1 ? 'owner' : 'owners' }}
                </template>
            </span>

            <button
                v-if="mergeRequest.diverged_commits_count"
                class="glab-enhancer-summary__item has-tooltip"
                title="Go to the merge widget"
                type="button"
                @click="scrollToWidget"
            >
                <SvgIcon :path="mdiSourceBranchSync" />
                {{ mergeRequest.diverged_commits_count }} {{ mergeRequest.diverged_commits_count === 1 ? 'commit' : 'commits' }} behind
            </button>

            <button
                v-if="newEntries.length"
                class="glab-enhancer-summary__item glab-enhancer-summary__item--new has-tooltip"
                title="Go to the next activity since your last visit"
                type="button"
                @click="scrollToNext(newEntries, 'new')"
            >
                <SvgIcon :path="mdiArrowDown" />
                {{ newEntries.length }} new since your last visit
            </button>
        </div>
    </teleport>
</template>

<script
    lang="ts"
    setup
>
    import {
        mdiArrowDown,
        mdiCheckDecagramOutline,
        mdiCloseCircleOutline,
        mdiCommentAlertOutline,
        mdiProgressClock,
        mdiSourceBranchSync,
    } from '@mdi/js';
    import {
        useIntervalFn,
        useLocalStorage,
    } from '@vueuse/core';
    import { debounce } from 'lodash-es';
    import { storeToRefs } from 'pinia';
    import {
        computed,
        onBeforeUnmount,
        onMounted,
        type Ref,
        ref,
        shallowRef,
        watch,
    } from 'vue';
    import {
        fetchMergeRequestApprovals,
        type IMergeRequestListItem,
    } from '../apis/mergeRequest';
    import { useMitt } from '../composables/useMitt';
    import { APP_NAMESPACE } from '../constants';
    import {
        MittEventKey,
        Preference,
    } from '../enums';
    import { useExtensionStore } from '../store';
    import {
        approvalSummary,
        authorsLabel,
        classifySystemNote,
        describeFold,
        foldRuns,
    } from '../utils/mergeRequestActivity';
    import { CATEGORY_META } from '../utils/mergeRequestCategories';
    import { rowStatus } from '../utils/mergeRequestRowStatus';
    import SvgIcon from './SvgIcon.vue';

    interface Props {
        iid: number,
        currentProjectPath: string,
        csrfToken: string,
    }

    const {
        iid,
        currentProjectPath,
        csrfToken,
    } = defineProps<Props>();

    type MergeRequest = IMergeRequestListItem & {
        diverged_commits_count?: number;
        head_pipeline?: { status: string, web_url: string, detailed_status?: { text?: string } } | null;
    };

    const FOLD_CLASS = 'glab-enhancer-fold';
    const FOLDED_CLASS = 'glab-enhancer-folded';
    const NEW_CLASS = 'glab-enhancer-new';
    const MAX_LAST_SEEN = 300;

    const { getSetting } = useExtensionStore();
    const { gitlabUsername } = storeToRefs(useExtensionStore());
    const {
        on,
        off,
    } = useMitt();

    const isSummaryEnabled = computed(() => !!getSetting(Preference.MR_SUMMARY_BAR, true));
    const isCleanActivityEnabled = computed(() => !!getSetting(Preference.MR_CLEAN_ACTIVITY, true));
    const isNewSinceVisitEnabled = computed(() => !!getSetting(Preference.MR_NEW_SINCE_VISIT, true));

    const mergeRequest: Ref<MergeRequest | null> = shallowRef(null);
    const approvals: Ref<ReturnType<typeof approvalSummary> | null> = shallowRef(null);
    const approvedByMe: Ref<boolean | undefined> = ref(undefined);
    const barElement: Ref<HTMLElement | null> = shallowRef(null);
    const openThreads: Ref<HTMLElement[]> = shallowRef([]);
    const newEntries: Ref<HTMLElement[]> = shallowRef([]);

    const pipeline = computed(() => mergeRequest.value?.head_pipeline || null);
    const status = computed(() => mergeRequest.value
        ? rowStatus(mergeRequest.value, gitlabUsername.value, { approvedByMe: approvedByMe.value })
        : {
            category: null,
            reasons: [],
            yourTurn: null,
        });

    // --- Merge request data ---

    async function load() {
        const [response, approvalData] = await Promise.all([
            fetch(`/api/v4/projects/${encodeURIComponent(currentProjectPath)}/merge_requests/${iid}?is_custom=1&include_diverged_commits_count=true`),
            fetchMergeRequestApprovals(currentProjectPath, iid, csrfToken),
        ]);

        if (response.ok) {
            mergeRequest.value = await response.json();
        }

        approvals.value = approvalData ? approvalSummary(approvalData) : null;
        approvedByMe.value = approvalData ? approvalData.approvedBy.nodes.some(user => user.username === gitlabUsername.value) : undefined;
    }

    const debouncedLoad = debounce(load, 1000);

    function onBrowserRequestCompleted(data?: Record<string, any> | string | number) {
        // Approving, resolving and pushing change the merge status, reading does not
        if (typeof data === 'object' && data !== null && data['method'] !== 'GET' && !String(data['url']).includes('/api/graphql')) {
            debouncedLoad();
        }
    }

    // --- Since your last visit ---

    const lastSeenByMergeRequest: Ref<Map<string, number>> = useLocalStorage(`${APP_NAMESPACE}/mr-last-seen`, ref(new Map()));
    const lastSeenKey = `${currentProjectPath}!${iid}`;
    // Read once, so what was new when the page opened stays new while you read it
    const lastSeen = lastSeenByMergeRequest.value.get(lastSeenKey);
    let newestNoteId = 0;

    function rememberLastSeen() {
        if (!newestNoteId || !isNewSinceVisitEnabled.value) {
            return;
        }

        lastSeenByMergeRequest.value.delete(lastSeenKey);
        lastSeenByMergeRequest.value.set(lastSeenKey, Math.max(newestNoteId, lastSeen || 0));
        if (lastSeenByMergeRequest.value.size > MAX_LAST_SEEN) {
            lastSeenByMergeRequest.value.delete(lastSeenByMergeRequest.value.keys().next().value!);
        }
    }

    function noteIdOf(element: Element) {
        return parseInt(element.id.replace('note_', ''), 10) || 0;
    }

    /**
     * Whether an entry holds a comment by someone else that is newer than your last visit.
     * History, like pushes and submitted reviews, does not count, so it keeps folding.
     */
    function hasNewNote(entry: HTMLElement) {
        const notes = [entry, ...entry.querySelectorAll('[id^="note_"]')].filter(note => note.id.startsWith('note_'));

        return notes.some((note) => {
            const id = noteIdOf(note);
            newestNoteId = Math.max(newestNoteId, id);

            const author = note.querySelector('.author-name-link')?.getAttribute('data-username');
            return lastSeen !== undefined && id > lastSeen && author !== gitlabUsername.value && !note.classList.contains('system-note');
        });
    }

    // --- Folding the activity ---

    const expandedFolds = ref(new Set<string>());
    let foldSignature = '';

    function createFold(key: string, entries: HTMLElement[], kinds: string[], isExpanded: boolean) {
        const fold = document.createElement('li');
        fold.className = `timeline-entry ${FOLD_CLASS}`;
        fold.dataset.foldKey = key;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = `${FOLD_CLASS}__toggle`;
        button.setAttribute('aria-expanded', String(isExpanded));
        button.addEventListener('click', () => toggleFold(key));

        const chevron = document.createElement('span');
        chevron.className = `${FOLD_CLASS}__chevron`;
        chevron.textContent = '›';

        const authors = document.createElement('strong');
        authors.textContent = authorsLabel(entries.map(entry => entry.querySelector('[data-testid="author-name"]')?.textContent?.trim() || '').filter(Boolean));

        const text = document.createElement('span');
        text.className = `${FOLD_CLASS}__text`;
        text.append(authors, ` ${describeFold(kinds)}`);

        const times = entries.map(entry => entry.querySelector('time')?.textContent?.trim()).filter(Boolean);
        const time = document.createElement('span');
        time.className = `${FOLD_CLASS}__time`;
        time.textContent = [...new Set([times[0], times[times.length - 1]])].join(' – ');

        button.append(chevron, text, time);
        fold.append(button);

        return fold;
    }

    function toggleFold(key: string) {
        const expanded = new Set(expandedFolds.value);
        expanded.has(key) ? expanded.delete(key) : expanded.add(key);
        expandedFolds.value = expanded;
        foldSignature = '';
        scan();
    }

    /**
     * Folds runs of history and resolved threads, and marks what is new since your last visit.
     * GitLab adds and changes notes while you read, so this runs on every change and only
     * rebuilds the folds when they differ.
     */
    function scan() {
        const list = document.querySelector('#notes-list');
        if (!list) {
            return;
        }

        const hashTarget = window.location.hash.startsWith('#note_') ? document.getElementById(window.location.hash.slice(1)) : null;
        const items = [...list.children].filter(item => !item.classList.contains(FOLD_CLASS)) as HTMLElement[];

        const entries = items.map((item) => {
            const isNew = hasNewNote(item);
            item.classList.toggle(NEW_CLASS, isNewSinceVisitEnabled.value && isNew);

            let kind = 'keep';
            if (item.classList.contains('system-note')) {
                kind = classifySystemNote(item.querySelector('.system-note-message')?.textContent || '');
            } else if (item.querySelector('.discussion[data-discussion-resolved="true"]')) {
                kind = 'resolved';
            }

            return {
                kind,
                isFoldable: isCleanActivityEnabled.value && kind !== 'keep' && !isNew && !item.contains(hashTarget),
            };
        });

        const runs = foldRuns(entries);
        const signature = runs.map(run => `${items[run[0]].id}:${run.length}:${expandedFolds.value.has(items[run[0]].id)}`).join('|');
        const folds = [...list.querySelectorAll(`:scope > .${FOLD_CLASS}`)];
        const isInPlace = folds.length === runs.length && runs.every((run, index) => folds[index].nextElementSibling === items[run[0]]);

        if (signature !== foldSignature || !isInPlace) {
            folds.forEach(fold => fold.remove());
            runs.forEach((run) => {
                const key = items[run[0]].id;
                list.insertBefore(createFold(key, run.map(index => items[index]), run.map(index => entries[index].kind), expandedFolds.value.has(key)), items[run[0]]);
            });
            foldSignature = signature;
        }

        const folded = new Set(runs.filter(run => !expandedFolds.value.has(items[run[0]].id)).flat().map(index => items[index]));
        items.forEach(item => item.classList.toggle(FOLDED_CLASS, folded.has(item)));

        const threads = [...list.querySelectorAll('.discussion[data-discussion-resolvable="true"]:not([data-discussion-resolved="true"])')] as HTMLElement[];
        if (threads.length !== openThreads.value.length || threads.some((thread, index) => thread !== openThreads.value[index])) {
            openThreads.value = threads;
        }

        const fresh = items.filter(item => item.classList.contains(NEW_CLASS));
        if (fresh.length !== newEntries.value.length || fresh.some((item, index) => item !== newEntries.value[index])) {
            newEntries.value = fresh;
        }
    }

    // --- Summary bar ---

    function placeBar() {
        // Below the sticky header, whose height is fixed
        const header = document.querySelector('.merge-request-sticky-header-wrapper');
        let bar = document.getElementById('glab-enhancer-summary-bar');

        if (header && (!bar || bar.previousElementSibling !== header)) {
            bar?.remove();
            bar = document.createElement('div');
            bar.id = 'glab-enhancer-summary-bar';
            header.insertAdjacentElement('afterend', bar);
        }

        if (barElement.value !== bar) {
            barElement.value = bar;
        }
    }

    const nextIndex: Record<string, number> = {};

    function scrollToNext(elements: HTMLElement[], key: string) {
        nextIndex[key] = ((nextIndex[key] ?? -1) + 1) % elements.length;
        elements[nextIndex[key]]?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
        });
    }

    function scrollToWidget() {
        document.querySelector('.mr-state-widget')?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
        });
    }

    // --- Watching the page ---

    let observedList: Element | null = null;
    let frame = 0;
    const observer = new MutationObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(scan);
    });

    // The notes load after the page, and GitLab can replace the list when you change the activity filter
    useIntervalFn(() => {
        placeBar();

        const list = document.querySelector('#notes-list');
        if (list !== observedList) {
            observer.disconnect();
            observedList = list;
            foldSignature = '';

            if (list) {
                observer.observe(list, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['data-discussion-resolved'],
                });
                scan();
            }
        }
    }, 1000, { immediateCallback: true });

    watch([
        isCleanActivityEnabled,
        isNewSinceVisitEnabled,
    ], () => {
        foldSignature = '';
        scan();
    });

    function onVisibilityChange() {
        if (document.visibilityState === 'hidden') {
            rememberLastSeen();
        }
    }

    function onHashChange() {
        foldSignature = '';
        scan();
    }

    onMounted(() => {
        load();
        on(MittEventKey.BROWSER_REQUEST_COMPLETED, onBrowserRequestCompleted);
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('pagehide', rememberLastSeen);
        window.addEventListener('hashchange', onHashChange);
    });

    onBeforeUnmount(() => {
        rememberLastSeen();
        observer.disconnect();
        off(MittEventKey.BROWSER_REQUEST_COMPLETED, onBrowserRequestCompleted);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('pagehide', rememberLastSeen);
        window.removeEventListener('hashchange', onHashChange);
        document.querySelectorAll(`.${FOLD_CLASS}`).forEach(fold => fold.remove());
        document.querySelectorAll(`.${FOLDED_CLASS}, .${NEW_CLASS}`).forEach(item => item.classList.remove(FOLDED_CLASS, NEW_CLASS));
        document.getElementById('glab-enhancer-summary-bar')?.remove();
    });
</script>
