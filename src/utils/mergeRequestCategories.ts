// How each merge request category looks, shared by the contributors sidebar and the list rows
export const CATEGORY_META: Record<string, { label: string, short: string, chip: string, badge: string, color: string }> = {
    ready: {
        label: 'Ready to merge',
        short: 'ready',
        chip: 'Ready',
        badge: 'success',
        color: 'var(--gl-status-success-icon-color, #108548)',
    },
    running: {
        label: 'Pipeline running',
        short: 'pipeline running',
        chip: 'Pipeline running',
        badge: 'info',
        color: 'var(--gl-color-teal-400, #2ea8a2)',
    },
    review: {
        label: 'Waiting for review',
        short: 'in review',
        chip: 'In review',
        badge: 'info',
        color: 'var(--gl-status-info-icon-color, #1f75cb)',
    },
    blocked: {
        label: 'Blocked',
        short: 'blocked',
        chip: 'Blocked',
        badge: 'warning',
        color: 'var(--gl-status-warning-icon-color, #c17d10)',
    },
    draft: {
        label: 'Draft',
        short: 'draft',
        chip: 'Draft',
        badge: 'neutral',
        color: 'var(--gl-status-neutral-icon-color, #737278)',
    },
    merged: {
        label: 'Merged',
        short: 'merged',
        chip: 'Merged',
        badge: 'tier',
        color: 'var(--gl-status-brand-icon-color, #7b58cf)',
    },
    closed: {
        label: 'Closed',
        short: 'closed',
        chip: 'Closed',
        badge: 'danger',
        color: 'var(--gl-status-danger-icon-color, #dd2b0e)',
    },
};
