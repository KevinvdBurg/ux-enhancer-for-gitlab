/**
 * @typedef {'push' | 'checklist' | 'description' | 'review' | 'resolved' | 'other'} FoldKind
 */

/**
 * @param {string} message The text of a history entry, without the author
 * @returns {FoldKind}
 */
export function classifySystemNote(message) {
    const text = message.trim();

    if (/^added \d+ commits?/.test(text)) {
        return 'push';
    }

    if (/^marked the checklist item .* as (completed|incomplete)/.test(text)) {
        return 'checklist';
    }

    if (/^changed the description/.test(text)) {
        return 'description';
    }

    if (/left review comments/.test(text)) {
        return 'review';
    }

    return 'other';
}

/**
 * @param {number} count
 * @param {string} one
 * @param {string} many
 */
function plural(count, one, many) {
    return `${count} ${count === 1 ? one : many}`;
}

/**
 * Sums up what a fold hides, the most telling part first.
 *
 * @param {Array<FoldKind | string>} kinds
 * @returns {string}
 */
export function describeFold(kinds) {
    /** @type {Record<string, number>} */
    const counts = {};
    kinds.forEach((kind) => {
        counts[kind] = (counts[kind] || 0) + 1;
    });

    return [
        counts.push && `pushed ${counts.push === 1 ? 'once' : `${counts.push} times`}`,
        counts.checklist && `ticked ${plural(counts.checklist, 'checklist item', 'checklist items')}`,
        counts.resolved && plural(counts.resolved, 'resolved thread', 'resolved threads'),
        counts.review && `submitted ${plural(counts.review, 'review', 'reviews')}`,
        counts.description && 'edited the description',
        counts.other && plural(counts.other, 'other update', 'other updates'),
    ].filter(Boolean).join(' · ');
}

/**
 * @param {string[]} names
 * @returns {string}
 */
export function authorsLabel(names) {
    const unique = [...new Set(names)];

    if (unique.length <= 2) {
        return unique.join(' and ');
    }

    return `${unique[0]} and ${unique.length - 1} others`;
}

/**
 * Groups consecutive foldable entries of the same day. A lone history entry is as small as its fold
 * would be, so it stays, but a lone resolved thread folds. Skipped entries, such as open threads
 * shown elsewhere, neither join nor break a group.
 *
 * @param {Array<{ kind: string, isFoldable: boolean, isSkipped?: boolean, day?: string }>} entries
 * @returns {number[][]} Indexes of the entries per fold
 */
export function foldRuns(entries) {
    /** @type {number[][]} */
    const runs = [];
    /** @type {number[]} */
    let run = [];

    const close = () => {
        if (run.length > 1 || (run.length === 1 && entries[run[0]].kind === 'resolved')) {
            runs.push(run);
        }
        run = [];
    };

    entries.forEach((entry, index) => {
        if (entry.isSkipped) {
            return;
        }

        if (run.length && entries[run[0]].day !== entry.day) {
            close();
        }

        if (entry.isFoldable) {
            run.push(index);
        } else {
            close();
        }
    });
    close();

    return runs;
}

/**
 * @param {Date} date
 * @param {Date} now
 * @returns {string} For example "Today", "Yesterday", "Monday" or "20 Oct"
 */
export function dayLabel(date, now) {
    const startOfDay = (/** @type {Date} */ value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    const days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);

    if (days === 0) {
        return 'Today';
    }

    if (days === 1) {
        return 'Yesterday';
    }

    if (days > 1 && days < 7) {
        return date.toLocaleDateString('en-GB', { weekday: 'long' });
    }

    return date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
    });
}

/**
 * @param {{ approved?: boolean, approvedBy?: { nodes: Array<{ username: string }> }, approvalState?: { rules: Array<{ name: string, type: string, approvalsRequired: number, approved: boolean }> } }} mergeRequest
 * @returns {{ approved: boolean, given: number, required: number, missingRules: string[] }}
 */
export function approvalSummary(mergeRequest) {
    const rules = mergeRequest.approvalState?.rules || [];
    const general = rules.filter(rule => rule.type !== 'CODE_OWNER');

    return {
        approved: !!mergeRequest.approved,
        given: mergeRequest.approvedBy?.nodes.length || 0,
        required: Math.max(0, ...general.map(rule => rule.approvalsRequired)),
        missingRules: [...new Set(rules.filter(rule => rule.type === 'CODE_OWNER' && !rule.approved).map(rule => rule.name))],
    };
}
