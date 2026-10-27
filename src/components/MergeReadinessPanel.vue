<template>
    <section
        class="glab-enhancer-ready"
        :class="`glab-enhancer-ready--${tone}`"
    >
        <header class="glab-enhancer-ready__header">
            <SvgIcon
                class="glab-enhancer-ready__state-icon"
                :path="TONE_ICONS[tone]"
            />

            <h2 class="glab-enhancer-ready__title">
                {{ title }}
            </h2>

            <button
                v-if="newEntries.length"
                class="glab-enhancer-ready__new"
                type="button"
                @click="scrollToNext(newEntries, 'new')"
            >
                <SvgIcon :path="mdiArrowDown" />
                {{ newEntries.length }} new since your last visit
            </button>

            <button
                v-if="mergeRequest.state === 'opened'"
                class="glab-enhancer-ready__action"
                type="button"
                @click="scrollToMergeOptions"
            >
                Merge options
                <SvgIcon :path="mdiArrowDown" />
            </button>
        </header>

        <p
            v-if="waiting.length"
            class="glab-enhancer-ready__waiting"
        >
            Waiting on
            <template
                v-for="(item, index) in waiting"
                :key="index"
            >
                <span v-if="index"> · </span>
                <strong :class="{ 'glab-enhancer-ready__you': item.usernames.includes(me) }">{{ item.label }}</strong>
                to {{ item.task }}
            </template>
        </p>

        <ul
            v-if="people.length"
            class="glab-enhancer-ready__people"
        >
            <li
                v-for="person in people"
                :key="person.username"
                class="glab-enhancer-ready__person"
            >
                <a
                    class="glab-enhancer-ready__person-link"
                    :href="person.webUrl"
                >
                    <img
                        alt=""
                        class="gl-avatar gl-avatar-circle gl-avatar-s24"
                        :src="person.avatarUrl"
                    >
                    {{ person.username === me ? 'You' : shortName(person.name) }}
                </a>

                <span
                    class="glab-enhancer-ready__person-state"
                    :class="`glab-enhancer-ready__person-state--${person.tone}`"
                >{{ person.state }}</span>
            </li>
        </ul>

        <ul
            v-if="checks.length || passing.length"
            class="glab-enhancer-ready__checks"
        >
            <li
                v-for="check in checks"
                :key="check.key"
                class="glab-enhancer-ready__check"
                :class="`glab-enhancer-ready__check--${check.tone}`"
            >
                <SvgIcon :path="TONE_ICONS[check.tone]" />

                <span class="glab-enhancer-ready__check-text">
                    <strong>{{ check.text }}</strong>
                    <span
                        v-if="check.detail"
                        class="glab-enhancer-ready__check-detail"
                    >{{ check.detail }}</span>
                </span>

                <a
                    v-if="check.href"
                    class="glab-enhancer-ready__action"
                    :href="check.href"
                >{{ check.action }}</a>
                <button
                    v-else-if="check.onAction"
                    class="glab-enhancer-ready__action"
                    type="button"
                    @click="check.onAction"
                >
                    {{ check.action }}
                </button>
            </li>

            <li
                v-if="passing.length"
                class="glab-enhancer-ready__check glab-enhancer-ready__check--success"
            >
                <SvgIcon :path="TONE_ICONS.success" />

                <span class="glab-enhancer-ready__check-text">{{ passing.join(' · ') }}</span>
            </li>
        </ul>

    </section>
</template>

<script
    lang="ts"
    setup
>
    import {
        mdiAlertCircleOutline,
        mdiArrowDown,
        mdiCheckCircleOutline,
        mdiCloseCircleOutline,
        mdiInformationOutline,
        mdiProgressClock,
        mdiSourceMerge,
    } from '@mdi/js';
    import { computed } from 'vue';
    import type {
        FailedJob,
        IMergeRequestListItem,
        MergeRequestApprovals,
    } from '../apis/mergeRequest';
    import { approvalSummary } from '../utils/mergeRequestActivity';
    import {
        peopleLabel,
        shortName,
        taskSummary,
        waitingOn,
    } from '../utils/mergeRequestPage';
    import SvgIcon from './SvgIcon.vue';

    export interface OpenThread {
        element: HTMLElement;
        starter: string;
        starterName: string;
        last: string;
        file: string;
    }

    export interface WidgetReport {
        name: string;
        detail: string;
        isPassing: boolean;
        element: HTMLElement;
    }

    export interface Checklist {
        done: number;
        total: number;
        firstOpen: HTMLElement | null;
    }

    export type MergeRequest = IMergeRequestListItem & {
        target_branch?: string;
        diverged_commits_count?: number;
        head_pipeline?: { id: number, status: string, web_url: string, detailed_status?: { text?: string } } | null;
    };

    interface Props {
        me: string,
        mergeRequest: MergeRequest,
        reviewState: MergeRequestApprovals | null,
        openThreads: OpenThread[],
        failedJobs: FailedJob[],
        reports: WidgetReport[],
        checklist: Checklist,
        sinceReview: { count: number, url: string } | null,
        newEntries: HTMLElement[],
    }

    const {
        me,
        mergeRequest,
        reviewState,
        openThreads,
        failedJobs,
        reports,
        checklist,
        sinceReview,
        newEntries,
    } = defineProps<Props>();

    type Tone = 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'merged';

    interface Check {
        key: string;
        tone: Tone;
        text: string;
        detail?: string;
        action?: string;
        href?: string;
        onAction?: () => void;
    }

    const TONE_ICONS: Record<Tone, string> = {
        success: mdiCheckCircleOutline,
        warning: mdiAlertCircleOutline,
        danger: mdiCloseCircleOutline,
        info: mdiInformationOutline,
        muted: mdiProgressClock,
        merged: mdiSourceMerge,
    };

    const REVIEW_STATES: Record<string, { label: string, tone: string }> = {
        UNREVIEWED: {
            label: 'Not started',
            tone: 'muted',
        },
        REVIEW_STARTED: {
            label: 'Reviewing',
            tone: 'info',
        },
        REVIEWED: {
            label: 'Commented',
            tone: 'info',
        },
        REQUESTED_CHANGES: {
            label: 'Requested changes',
            tone: 'danger',
        },
        APPROVED: {
            label: 'Approved',
            tone: 'success',
        },
        UNAPPROVED: {
            label: 'Approval revoked',
            tone: 'warning',
        },
    };

    const approvals = computed(() => (reviewState ? approvalSummary(reviewState) : null));
    const pipeline = computed(() => mergeRequest.head_pipeline || null);
    const reviewers = computed(() => reviewState?.reviewers.nodes || []);

    const people = computed(() => {
        const author = reviewState?.author;
        const items = reviewers.value
            .filter(reviewer => reviewer.username !== author?.username)
            .map((reviewer) => {
                const state = reviewer.mergeRequestInteraction?.approved
                    ? REVIEW_STATES.APPROVED
                    : REVIEW_STATES[reviewer.mergeRequestInteraction?.reviewState || 'UNREVIEWED'] || REVIEW_STATES.UNREVIEWED;

                return {
                    ...reviewer,
                    state: state.label,
                    tone: state.tone,
                };
            });

        return author
            ? [{
                ...author,
                state: 'Author',
                tone: 'muted',
            }, ...items]
            : items;
    });

    const waiting = computed(() => {
        if (!reviewState?.author) {
            return [];
        }

        const names: Record<string, string> = Object.fromEntries([
            [reviewState.author.username, reviewState.author.name],
            ...reviewers.value.map(reviewer => [reviewer.username, reviewer.name]),
            ...openThreads.map(thread => [thread.starter, thread.starterName]),
        ]);

        return waitingOn({
            state: mergeRequest.state,
            author: reviewState.author.username,
            reviewers: reviewers.value.map(reviewer => ({
                username: reviewer.username,
                bot: reviewer.bot,
                reviewState: reviewer.mergeRequestInteraction?.reviewState,
                approved: reviewer.mergeRequestInteraction?.approved,
            })),
            openThreads,
            isDraft: mergeRequest.draft,
            isApproved: approvals.value?.approved,
            isPipelineFailed: pipeline.value?.status === 'failed',
            hasConflicts: mergeRequest.has_conflicts,
        }).map(item => ({
            ...item,
            label: peopleLabel(item.usernames, names, me),
        }));
    });

    const checks = computed(() => {
        if (mergeRequest.state !== 'opened') {
            return [];
        }

        const items: Check[] = [];

        if (sinceReview) {
            items.push({
                key: 'since-review',
                tone: 'info',
                text: `${sinceReview.count} ${sinceReview.count === 1 ? 'push' : 'pushes'} since your last review`,
                action: 'View changes',
                href: sinceReview.url,
            });
        }

        if (openThreads.length) {
            const starters = [...new Set(openThreads.map(thread => shortName(thread.starterName || thread.starter)))];
            const files = [...new Set(openThreads.map(thread => thread.file).filter(Boolean))];

            items.push({
                key: 'threads',
                tone: 'danger',
                text: `${openThreads.length} open ${openThreads.length === 1 ? 'thread' : 'threads'}`,
                detail: [
                    `by ${starters.join(', ')}`,
                    files.length && (files.length === 1 ? files[0].split('/').pop() : `in ${files.length} files`),
                ].filter(Boolean).join(' · '),
                action: openThreads.length === 1 ? 'Go to thread' : 'Next thread',
                onAction: () => scrollToNext(openThreads.map(thread => thread.element), 'thread'),
            });
        }

        if (mergeRequest.has_conflicts) {
            items.push({
                key: 'conflicts',
                tone: 'danger',
                text: 'Merge conflicts',
                detail: `with ${mergeRequest.target_branch || 'the target branch'}`,
                action: 'Resolve',
                onAction: () => scrollTo(document.querySelector('.mr-state-widget')),
            });
        }

        if (pipeline.value?.status === 'failed') {
            const names = failedJobs.map(job => job.name);

            items.push({
                key: 'pipeline',
                tone: 'danger',
                text: 'Pipeline failed',
                detail: names.length ? `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}` : '',
                action: names.length === 1 ? 'View job' : 'View failures',
                href: names.length === 1 ? failedJobs[0].web_url : `${pipeline.value.web_url}/failures`,
            });
        } else if (pipeline.value && pipeline.value.status !== 'success') {
            const isWaiting = ['running', 'pending', 'created', 'preparing', 'waiting_for_resource', 'scheduled'].includes(pipeline.value.status);

            items.push({
                key: 'pipeline',
                tone: isWaiting ? 'muted' : 'warning',
                text: `Pipeline ${pipeline.value.detailed_status?.text?.toLowerCase() || pipeline.value.status}`,
                action: 'View pipeline',
                href: pipeline.value.web_url,
            });
        }

        reports.filter(report => !report.isPassing).forEach((report) => {
            items.push({
                key: `report-${report.name}`,
                tone: 'warning',
                text: report.name,
                detail: report.detail,
                action: 'Show report',
                onAction: () => scrollTo(report.element),
            });
        });

        if (approvals.value && !approvals.value.approved) {
            items.push({
                key: 'approvals',
                tone: 'danger',
                text: `${approvals.value.given} of ${approvals.value.required || 1} approvals`,
                detail: approvals.value.missingRules.length ? `Code owners needed: ${approvals.value.missingRules.join(', ')}` : '',
                action: 'Assign reviewers',
                onAction: assignReviewers,
            });
        }

        if (checklist.total && checklist.done < checklist.total) {
            const open = checklist.total - checklist.done;

            items.push({
                key: 'checklist',
                tone: 'warning',
                text: `${open} checklist ${open === 1 ? 'item' : 'items'} open`,
                detail: checklist.firstOpen?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || '',
                action: 'Show',
                onAction: showChecklist,
            });
        }

        if (mergeRequest.diverged_commits_count) {
            items.push({
                key: 'behind',
                tone: 'warning',
                text: `${mergeRequest.diverged_commits_count} ${mergeRequest.diverged_commits_count === 1 ? 'commit' : 'commits'} behind ${mergeRequest.target_branch || ''}`.trim(),
                action: 'Rebase options',
                onAction: scrollToMergeOptions,
            });
        }

        return items;
    });

    const passing = computed(() => {
        if (mergeRequest.state !== 'opened') {
            return [];
        }

        return [
            pipeline.value?.status === 'success' && 'Pipeline',
            approvals.value?.approved && 'Approved',
            ...reports.filter(report => report.isPassing).map(report => report.name),
            checklist.total && checklist.done === checklist.total && `Checklist ${taskSummary(checklist.done, checklist.total).toLowerCase()}`,
        ].filter(Boolean) as string[];
    });

    const tone = computed((): Tone => {
        if (mergeRequest.state === 'merged') {
            return 'merged';
        }

        if (mergeRequest.state === 'closed' || mergeRequest.draft) {
            return 'muted';
        }

        if (checks.value.some(check => check.tone === 'danger')) {
            return 'danger';
        }

        return checks.value.some(check => check.tone === 'muted') ? 'muted' : 'success';
    });

    const title = computed(() => {
        if (mergeRequest.state === 'merged') {
            return `Merged into ${mergeRequest.target_branch}`;
        }

        if (mergeRequest.state === 'closed') {
            return 'Closed';
        }

        if (mergeRequest.draft) {
            return 'Draft';
        }

        const blocking = checks.value.filter(check => check.tone === 'danger').length;
        if (blocking) {
            return `Not ready to merge · ${blocking} ${blocking === 1 ? 'thing' : 'things'} to do`;
        }

        return tone.value === 'muted' ? 'Waiting for the pipeline' : 'Ready to merge';
    });

    function scrollTo(element: Element | null | undefined) {
        element?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
        });
    }

    const nextIndex: Record<string, number> = {};

    function scrollToNext(elements: HTMLElement[], key: string) {
        nextIndex[key] = ((nextIndex[key] ?? -1) + 1) % elements.length;
        scrollTo(elements[nextIndex[key]]);
    }

    function scrollToMergeOptions() {
        scrollTo(document.querySelector('.mr-state-widget [data-testid="ready_to_merge_state"]') || document.querySelector('.mr-state-widget'));
    }

    function assignReviewers() {
        const button = document.querySelector('[data-testid="reviewers-edit-button"]') as HTMLButtonElement | null;
        if (button) {
            scrollTo(button);
            button.click();
        }
    }

    function showChecklist() {
        const item = checklist.firstOpen;
        if (!item) {
            return;
        }

        // Opens the description section the item is in, when it is closed
        let element: Element | null = item.closest('.md > *');
        while (element && !element.classList.contains('glab-enhancer-section-heading')) {
            element = element.previousElementSibling;
        }
        if (element?.classList.contains('glab-enhancer-section-collapsed')) {
            (element as HTMLElement).click();
        }

        requestAnimationFrame(() => scrollTo(item));
    }
</script>
