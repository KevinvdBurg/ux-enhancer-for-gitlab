<template>
    <teleport
        v-if="isPanelEnabled && panelElement && mergeRequest"
        :to="panelElement"
    >
        <MergeReadinessPanel
            :checklist="checklist"
            :failed-jobs="failedJobs"
            :me="gitlabUsername"
            :merge-request="mergeRequest"
            :new-entries="newEntries"
            :open-threads="openThreads"
            :reports="reports"
            :review-state="reviewState"
            :since-review="sinceReview"
        />
    </teleport>
</template>

<script
    lang="ts"
    setup
>
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
        type FailedJob,
        fetchFailedJobs,
        fetchMergeRequestApprovals,
        fetchMergeRequestVersions,
        type MergeRequestApprovals,
        type MergeRequestVersion,
    } from '../apis/mergeRequest';
    import { useMitt } from '../composables/useMitt';
    import { useWatchedElement } from '../composables/useWatchedElement';
    import { APP_NAMESPACE } from '../constants';
    import {
        MittEventKey,
        Preference,
    } from '../enums';
    import { useExtensionStore } from '../store';
    import {
        authorsLabel,
        classifySystemNote,
        dayLabel,
        describeFold,
        foldRuns,
    } from '../utils/mergeRequestActivity';
    import {
        changesSinceReview,
        reportName,
    } from '../utils/mergeRequestPage';
    import MergeReadinessPanel, {
        type Checklist,
        type MergeRequest,
        type OpenThread,
        type WidgetReport,
    } from './MergeReadinessPanel.vue';

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

    const FOLD_CLASS = 'glab-enhancer-fold';
    const FOLDED_CLASS = 'glab-enhancer-folded';
    const NEW_CLASS = 'glab-enhancer-new';
    const THREADS_FIRST_CLASS = 'glab-enhancer-threads-first';
    const OPEN_THREAD_CLASS = 'glab-enhancer-open-thread';
    const HEADING_CLASS = 'glab-enhancer-activity-heading';
    const PANEL_ID = 'glab-enhancer-ready-panel';
    const MAX_LAST_SEEN = 300;
    const REVIEW_NOTE = /^(approved this merge request|requested changes|left review comments)/;

    const { getSetting } = useExtensionStore();
    const { gitlabUsername } = storeToRefs(useExtensionStore());
    const {
        on,
        off,
    } = useMitt();

    const isPanelEnabled = computed(() => !!getSetting(Preference.MR_SUMMARY_BAR, true));
    const isCleanActivityEnabled = computed(() => !!getSetting(Preference.MR_CLEAN_ACTIVITY, true));
    const isThreadsFirstEnabled = computed(() => !!getSetting(Preference.MR_THREADS_FIRST, true));
    const isNewSinceVisitEnabled = computed(() => !!getSetting(Preference.MR_NEW_SINCE_VISIT, true));

    const mergeRequest: Ref<MergeRequest | null> = shallowRef(null);
    const reviewState: Ref<MergeRequestApprovals | null> = shallowRef(null);
    const failedJobs: Ref<FailedJob[]> = shallowRef([]);
    const versions: Ref<MergeRequestVersion[]> = shallowRef([]);
    const panelElement: Ref<HTMLElement | null> = shallowRef(null);
    const openThreads: Ref<OpenThread[]> = shallowRef([]);
    const newEntries: Ref<HTMLElement[]> = shallowRef([]);
    const reports: Ref<WidgetReport[]> = shallowRef([]);
    const checklist: Ref<Checklist> = shallowRef({
        done: 0,
        total: 0,
        firstOpen: null,
    });
    const myLastNoteAt: Ref<string | null> = ref(null);

    const sinceReview = computed(() => {
        // Only reviewers come back to see what changed
        if (!mergeRequest.value || mergeRequest.value.author?.username === gitlabUsername.value) {
            return null;
        }

        const changes = changesSinceReview(versions.value, myLastNoteAt.value);

        return changes
            ? {
                count: changes.count,
                url: `${mergeRequest.value.web_url}/diffs?diff_id=${changes.diffId}&start_sha=${changes.startSha}`,
            }
            : null;
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
        reviewState.value = approvalData;

        const data = mergeRequest.value;
        const pipeline = data?.head_pipeline;
        const [jobs, pushes] = await Promise.all([
            pipeline?.status === 'failed' ? fetchFailedJobs(currentProjectPath, pipeline.id) : [],
            data && data.state === 'opened' && data.author?.username !== gitlabUsername.value ? fetchMergeRequestVersions(currentProjectPath, iid) : [],
        ]);
        failedJobs.value = jobs;
        versions.value = pushes;
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

    function commentsOf(entry: Element) {
        return [entry, ...entry.querySelectorAll('[id^="note_"]')].filter(note => note.id.startsWith('note_') && !note.classList.contains('system-note'));
    }

    function authorOf(note: Element) {
        return note.querySelector('.author-name-link')?.getAttribute('data-username') || '';
    }

    /**
     * Whether an entry holds a comment by someone else that is newer than your last visit.
     * History, like pushes and submitted reviews, does not count, so it keeps folding.
     */
    function hasNewNote(entry: HTMLElement) {
        [entry, ...entry.querySelectorAll('[id^="note_"]')].forEach((note) => {
            newestNoteId = Math.max(newestNoteId, noteIdOf(note));
        });

        return lastSeen !== undefined && commentsOf(entry).some(note => noteIdOf(note) > lastSeen && authorOf(note) !== gitlabUsername.value);
    }

    // --- Folding the activity ---

    const expandedFolds = ref(new Set<string>());
    let foldSignature = '';

    function dayOf(entry: Element) {
        const time = entry.querySelector('time')?.getAttribute('datetime');

        return time ? new Date(time).toDateString() : '';
    }

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

        const datetime = entries.map(entry => entry.querySelector('time')?.getAttribute('datetime')).find(Boolean);
        const time = document.createElement('span');
        time.className = `${FOLD_CLASS}__time`;
        time.textContent = datetime ? dayLabel(new Date(datetime), new Date()) : '';

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
     * Keeps the "To resolve" and "History" headings in place. CSS moves open threads above the
     * history, so GitLab's own list stays in its order.
     */
    function placeHeadings(list: Element, openCount: number) {
        const isShown = isThreadsFirstEnabled.value && openCount > 0;
        list.classList.toggle(THREADS_FIRST_CLASS, isShown);

        ['open', 'history'].forEach((kind) => {
            let heading = list.querySelector(`:scope > .${HEADING_CLASS}--${kind}`);
            if (!isShown) {
                heading?.remove();
                return;
            }

            if (!heading) {
                heading = document.createElement('li');
                heading.className = `${HEADING_CLASS} ${HEADING_CLASS}--${kind}`;
                list.prepend(heading);
            }

            const text = kind === 'open' ? `To resolve · ${openCount}` : 'History';
            if (heading.textContent !== text) {
                heading.textContent = text;
            }
        });
    }

    function threadOf(item: HTMLElement): OpenThread {
        const comments = commentsOf(item);
        const first = comments[0];

        return {
            element: item,
            starter: first ? authorOf(first) : '',
            starterName: first?.querySelector('[data-testid="author-name"]')?.textContent?.trim() || '',
            last: comments.length ? authorOf(comments[comments.length - 1]) : '',
            file: item.querySelector('.file-title-name, .js-file-title')?.textContent?.trim() || '',
        };
    }

    /**
     * Folds runs of history and resolved threads per day, lifts open threads to the top, and marks
     * what is new since your last visit. GitLab adds and changes notes while you read, so this runs
     * on every change and only rebuilds the folds when they differ.
     */
    function scan() {
        const list = document.querySelector('#notes-list');
        if (!list) {
            return;
        }

        const hashTarget = window.location.hash.startsWith('#note_') ? document.getElementById(window.location.hash.slice(1)) : null;
        const items = [...list.children].filter(item => !item.classList.contains(FOLD_CLASS) && !item.classList.contains(HEADING_CLASS)) as HTMLElement[];
        const open = items.filter(item => item.querySelector('.discussion[data-discussion-resolvable="true"]:not([data-discussion-resolved="true"])'));
        const isLifting = isThreadsFirstEnabled.value && open.length > 0;
        let lastNoteAt = '';

        const entries = items.map((item) => {
            const isNew = hasNewNote(item);
            item.classList.toggle(NEW_CLASS, isNewSinceVisitEnabled.value && isNew);
            item.classList.toggle(OPEN_THREAD_CLASS, isLifting && open.includes(item));

            // Your last review is your last comment, approval or submitted review
            const reviewNotes = item.classList.contains('system-note') && REVIEW_NOTE.test(item.querySelector('.system-note-message')?.textContent?.trim() || '') ? [item] : [];
            [...commentsOf(item), ...reviewNotes].filter(note => authorOf(note) === gitlabUsername.value).forEach((note) => {
                const time = note.querySelector('time')?.getAttribute('datetime') || '';
                lastNoteAt = time > lastNoteAt ? time : lastNoteAt;
            });

            let kind = 'keep';
            if (item.classList.contains('system-note')) {
                kind = classifySystemNote(item.querySelector('.system-note-message')?.textContent || '');
            } else if (item.querySelector('.discussion[data-discussion-resolved="true"]')) {
                kind = 'resolved';
            }

            return {
                kind,
                day: dayOf(item),
                isSkipped: isLifting && open.includes(item),
                isFoldable: isCleanActivityEnabled.value && kind !== 'keep' && !isNew && !item.contains(hashTarget),
            };
        });

        if (myLastNoteAt.value !== (lastNoteAt || null)) {
            myLastNoteAt.value = lastNoteAt || null;
        }

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

        placeHeadings(list, open.length);

        const threads = open.map(threadOf);
        const threadSignature = (items: OpenThread[]) => items.map(thread => `${thread.element.id}:${thread.last}`).join('|');
        if (threadSignature(threads) !== threadSignature(openThreads.value) || threads.some((thread, index) => thread.element !== openThreads.value[index].element)) {
            openThreads.value = threads;
        }

        const fresh = items.filter(item => item.classList.contains(NEW_CLASS));
        if (fresh.length !== newEntries.value.length || fresh.some((item, index) => item !== newEntries.value[index])) {
            newEntries.value = fresh;
        }
    }

    // --- Reports and checklist, read from GitLab's own widgets ---

    useWatchedElement('.mr-state-widget', (widget) => {
        const container = widget.querySelector('.reports-widgets-container');
        const found = [...(container?.children || [])].map((report) => {
            const icon = report.querySelector('[data-testid^="status-"][data-testid$="-icon"]');
            const name = reportName(icon?.getAttribute('aria-label') || '');

            return name && icon
                ? {
                    name,
                    detail: report.querySelector('[data-testid="widget-extension-top-level"]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 100) || '',
                    isPassing: icon.getAttribute('data-testid') === 'status-success-icon',
                    element: report as HTMLElement,
                }
                : null;
        }).filter(Boolean) as WidgetReport[];

        const signature = (items: WidgetReport[]) => items.map(report => `${report.name}:${report.isPassing}:${report.detail}`).join('|');
        if (signature(found) !== signature(reports.value) || found.some((report, index) => report.element !== reports.value[index]?.element)) {
            reports.value = found;
        }
    });

    useWatchedElement('.detail-page-description .description', (description) => {
        const boxes = [...description.querySelectorAll('.md input.task-list-item-checkbox:not([data-inapplicable])')] as HTMLInputElement[];
        const done = boxes.filter(box => box.checked).length;
        const firstOpen = boxes.find(box => !box.checked)?.closest('li') || null;

        if (done !== checklist.value.done || boxes.length !== checklist.value.total || firstOpen !== checklist.value.firstOpen) {
            checklist.value = {
                done,
                total: boxes.length,
                firstOpen,
            };
        }
    });

    // --- Panel ---

    function placePanel() {
        // At the top of the overview, so it leaves the other tabs alone
        const description = document.querySelector('.issuable-discussion > .detail-page-description');
        let panel = document.getElementById(PANEL_ID);

        if (description && (!panel || panel.nextElementSibling !== description)) {
            panel?.remove();
            panel = document.createElement('div');
            panel.id = PANEL_ID;
            description.insertAdjacentElement('beforebegin', panel);
        }

        if (panelElement.value !== panel) {
            panelElement.value = panel;
        }
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
        placePanel();

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
        isThreadsFirstEnabled,
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
        document.querySelectorAll(`.${FOLD_CLASS}, .${HEADING_CLASS}`).forEach(element => element.remove());
        document.querySelectorAll(`.${FOLDED_CLASS}, .${NEW_CLASS}, .${OPEN_THREAD_CLASS}, .${THREADS_FIRST_CLASS}`)
            .forEach(item => item.classList.remove(FOLDED_CLASS, NEW_CLASS, OPEN_THREAD_CLASS, THREADS_FIRST_CLASS));
        document.getElementById(PANEL_ID)?.remove();
    });
</script>
