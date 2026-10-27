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
        hasActiveSession,
        reportName,
    } from '../utils/mergeRequestPage';

    const HIDDEN_CLASS = 'glab-enhancer-widget-hidden';
    const REPORTS_CLASS = 'glab-enhancer-passing-reports';

    const { getSetting } = useExtensionStore();
    const isEnabled = computed(() => !!getSetting(Preference.MR_COMPACT_WIDGETS, true));
    const isReportsExpanded = ref(false);

    function hide(element: Element | null, isHidden: boolean) {
        if (element && element.classList.contains(HIDDEN_CLASS) !== isHidden) {
            element.classList.toggle(HIDDEN_CLASS, isHidden);
        }
    }

    /**
     * Turns reports that found nothing into one line, since each says the same: all good.
     */
    function foldPassingReports(widget: HTMLElement) {
        const container = widget.querySelector('.reports-widgets-container');
        if (!container) {
            return;
        }

        const reports = [...container.children].filter(child => !child.classList.contains(REPORTS_CLASS));
        const passing = reports.filter(report => report.querySelector('[data-testid^="status-"][data-testid$="-icon"]')?.getAttribute('data-testid') === 'status-success-icon');
        const isFolded = passing.length > 1;
        let line = container.querySelector(`:scope > .${REPORTS_CLASS}`);

        reports.forEach(report => hide(report, isFolded && !isReportsExpanded.value && passing.includes(report)));

        if (!isFolded) {
            line?.remove();
            return;
        }

        if (!line) {
            line = document.createElement('button');
            line.setAttribute('type', 'button');
            line.className = REPORTS_CLASS;
            line.addEventListener('click', () => {
                isReportsExpanded.value = !isReportsExpanded.value;
                run();
            });
            container.prepend(line);
        }

        const names = passing.map(report => reportName(report.querySelector('[data-testid="status-success-icon"]')?.getAttribute('aria-label') || '') || 'Report');
        const text = `✓ ${names.join(' · ✓ ')}${isReportsExpanded.value ? ' · hide' : ''}`;
        if (line.textContent !== text) {
            line.textContent = text;
        }
        line.setAttribute('aria-expanded', String(isReportsExpanded.value));
    }

    /**
     * The merge checks already say approvals are missing, with the same "Assign reviewers" button.
     * The approvals widget stays when you can approve from it.
     */
    function foldApprovals(widget: HTMLElement) {
        const approvals = widget.querySelector('.js-mr-approvals');
        if (!approvals) {
            return;
        }

        const isInMergeChecks = [...widget.querySelectorAll('.mr-section-container')]
            .some(section => section !== approvals && /required approvals/i.test(section.textContent || ''));
        const canApprove = [...approvals.querySelectorAll('button')].some(button => /approve|revoke/i.test(button.textContent || ''));

        hide(approvals, isInMergeChecks && !canApprove);
    }

    function apply(widget: HTMLElement) {
        if (!isEnabled.value) {
            clean();
            return;
        }

        const sessions = widget.querySelector('[data-testid="agent-sessions-widget"]');
        hide(sessions, !!sessions && !hasActiveSession(sessions.textContent || ''));

        foldPassingReports(widget);
        foldApprovals(widget);
    }

    function clean() {
        document.querySelectorAll(`.${REPORTS_CLASS}`).forEach(line => line.remove());
        document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(element => element.classList.remove(HIDDEN_CLASS));
    }

    const { run } = useWatchedElement('.mr-state-widget', apply);

    watch(isEnabled, run);

    onBeforeUnmount(clean);
</script>
