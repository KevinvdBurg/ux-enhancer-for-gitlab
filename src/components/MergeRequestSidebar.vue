<template>
    <span v-if="false" />
</template>

<script
    lang="ts"
    setup
>
    import {
        computed,
        onBeforeUnmount,
        ref,
        watch,
    } from 'vue';
    import { useWatchedElement } from '../composables/useWatchedElement';
    import { Preference } from '../enums';
    import { useExtensionStore } from '../store';
    import {
        emptyBlocksLabel,
        reviewStateLabel,
    } from '../utils/mergeRequestPage';

    const HIDDEN_CLASS = 'glab-enhancer-sidebar-hidden';
    const EMPTY_LINE_CLASS = 'glab-enhancer-empty-blocks';
    const STATE_CLASS = 'glab-enhancer-review-state';

    // Blocks that often stay empty, and how to name them in one line
    const EMPTY_BLOCK_NAMES: Record<string, string> = {
        labels: 'labels',
        milestone: 'milestone',
        'related-work-items': 'work items',
        'time-tracking': 'time tracking',
    };
    const EMPTY_TEXTS = ['None', 'No estimate or time spent'];

    const { getSetting } = useExtensionStore();
    const isCompactEnabled = computed(() => !!getSetting(Preference.MR_COMPACT_SIDEBAR, true));
    const isReviewStatesEnabled = computed(() => !!getSetting(Preference.MR_REVIEWER_STATES, true));
    const isSummaryEnabled = computed(() => !!getSetting(Preference.MR_SUMMARY_BAR, true));
    const isEmptyExpanded = ref(false);

    function hide(element: Element | null, isHidden: boolean) {
        if (element && element.classList.contains(HIDDEN_CLASS) !== isHidden) {
            element.classList.toggle(HIDDEN_CLASS, isHidden);
        }
    }

    function isEmptyBlock(block: Element) {
        // An open dropdown, for example from the "l" shortcut, needs its block
        if (block.querySelector('[aria-expanded="true"]')) {
            return false;
        }

        return [...block.querySelectorAll('span, div')].some(element => !element.children.length
            && EMPTY_TEXTS.includes(element.textContent?.trim() || '')
            && !element.closest('.gl-new-dropdown, .sidebar-collapsed-icon'));
    }

    function showReviewStates(sidebar: HTMLElement) {
        sidebar.querySelectorAll('.block.reviewer [data-testid="reviewer"]').forEach((row) => {
            const name = row.querySelector('a.js-user-link .gl-grid');
            const label = isReviewStatesEnabled.value
                ? reviewStateLabel(row.querySelector('[data-testid="reviewer-state-icon-parent"]')?.getAttribute('title') || '')
                : '';
            let state = name?.querySelector(`.${STATE_CLASS}`);

            if (!name || !label) {
                state?.remove();
                return;
            }

            if (!state) {
                state = document.createElement('span');
                name.append(state);
            }

            const tone = /approved/i.test(label) && !/revoked/i.test(label)
                ? 'success'
                : /changes/i.test(label) ? 'danger' : /commented|started/i.test(label) ? 'info' : 'muted';
            const className = `${STATE_CLASS} ${STATE_CLASS}--${tone}`;
            if (state.className !== className) {
                state.className = className;
            }
            if (state.textContent !== label) {
                state.textContent = label;
            }
        });
    }

    function groupEmptyBlocks(sidebar: HTMLElement) {
        const empty = Object.keys(EMPTY_BLOCK_NAMES)
            .map(name => ({
                name,
                block: sidebar.querySelector(`.block.${name}`),
            }))
            .filter(({ block }) => block && isEmptyBlock(block)) as Array<{ name: string, block: Element }>;
        const isGrouped = isCompactEnabled.value && empty.length > 1;
        let line = sidebar.querySelector(`.${EMPTY_LINE_CLASS}`);

        Object.keys(EMPTY_BLOCK_NAMES).forEach((name) => {
            const block = sidebar.querySelector(`.block.${name}`);
            hide(block, isGrouped && !isEmptyExpanded.value && empty.some(item => item.block === block));
        });

        if (!isGrouped) {
            line?.remove();
            return;
        }

        if (!line || line.nextElementSibling !== empty[0].block) {
            line?.remove();
            line = document.createElement('button');
            line.setAttribute('type', 'button');
            line.className = `block ${EMPTY_LINE_CLASS}`;
            line.addEventListener('click', () => {
                isEmptyExpanded.value = !isEmptyExpanded.value;
                run();
            });
            empty[0].block.insertAdjacentElement('beforebegin', line);
        }

        const text = isEmptyExpanded.value ? 'Hide empty fields' : emptyBlocksLabel(empty.map(item => EMPTY_BLOCK_NAMES[item.name]));
        if (line.textContent !== text) {
            line.textContent = text;
        }
        line.setAttribute('aria-expanded', String(isEmptyExpanded.value));
    }

    /**
     * Participants only add something when someone is not already the author, an assignee or a reviewer.
     */
    function hideKnownParticipants(sidebar: HTMLElement) {
        const participants = sidebar.querySelector('.block.participants');
        const usernames = (selector: string, root: ParentNode = sidebar) => [...root.querySelectorAll(`${selector} a[data-username]`)].map(link => link.getAttribute('data-username'));
        const known = new Set([
            ...usernames('.block.assignee'),
            ...usernames('.block.reviewer [data-testid="reviewer"]'),
            ...usernames('.merge-request-author-container', document),
        ]);
        const participantNames = usernames('.block.participants');

        hide(participants, isCompactEnabled.value && participantNames.length > 0 && participantNames.every(name => known.has(name)));
    }

    function apply(sidebar: HTMLElement) {
        showReviewStates(sidebar);
        groupEmptyBlocks(sidebar);
        hideKnownParticipants(sidebar);

        // The summary bar shows how many approvals are needed
        hide(sidebar.querySelector('.block.reviewer p.gl-text-sm'), isCompactEnabled.value && isSummaryEnabled.value);
    }

    const { run } = useWatchedElement('aside.right-sidebar', apply);

    watch([
        isCompactEnabled,
        isReviewStatesEnabled,
        isSummaryEnabled,
    ], run);

    onBeforeUnmount(() => {
        document.querySelectorAll(`.${EMPTY_LINE_CLASS}, .${STATE_CLASS}`).forEach(element => element.remove());
        document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(element => element.classList.remove(HIDDEN_CLASS));
    });
</script>
