/**
 * @typedef {'authors' | 'reviewers'} ContributorMode
 * @typedef {'ready' | 'review' | 'blocked' | 'draft' | 'merged' | 'closed'} ContributorCategory
 */

/** @type {ContributorCategory[]} */
export const CONTRIBUTOR_CATEGORIES = ['ready', 'review', 'blocked', 'draft', 'merged', 'closed'];

const FILTER_KEY_BY_MODE = {
    authors: 'author_username',
    reviewers: 'reviewer_username',
};

// List page params that the REST API accepts under the same name
const PASSTHROUGH_PARAMS = [
    'search',
    'in',
    'author_username',
    'reviewer_username',
    'target_branch',
    'source_branch',
    'my_reaction_emoji',
    'environment',
    'deployed_before',
    'deployed_after',
    'not[author_username]',
    'not[reviewer_username]',
    'not[my_reaction_emoji]',
];

// List page params whose REST API name differs
const RENAMED_PARAMS = {
    'draft': 'wip',
    'milestone_title': 'milestone',
    'not[milestone_title]': 'not[milestone]',
    'assignee_username[]': 'assignee_username',
    'not[assignee_username][]': 'not[assignee_username]',
    'not[author_username][]': 'not[author_username]',
    'not[reviewer_username][]': 'not[reviewer_username]',
};

const LIST_PARAMS = {
    'label_name[]': 'labels',
    'not[label_name][]': 'not[labels]',
    'approved_by_usernames[]': 'approved_by_usernames[]',
};

// What keeps a merge request from merging, per detailed_merge_status
const BLOCKED_REASONS = {
    blocked_status: 'Blocked by another merge request',
    ci_must_pass: 'Pipeline must succeed',
    conflict: 'Merge conflicts',
    discussions_not_resolved: 'Unresolved threads',
    external_status_checks: 'Status checks must pass',
    jira_association_missing: 'Missing Jira issue',
    locked_lfs_files: 'Locked files',
    locked_paths: 'Locked paths',
    merge_request_blocked: 'Blocked by another merge request',
    need_rebase: 'Needs a rebase',
    requested_changes: 'Changes requested',
    security_policy_violations: 'Security policy violations',
    status_checks_must_pass: 'Status checks must pass',
    title_regex: 'Title does not match the required format',
};
const BLOCKED_STATUSES = Object.keys(BLOCKED_REASONS);

/**
 * Translates the filters of a merge request list page into REST API query params.
 * The filter for the given mode is left out, so every contributor stays visible.
 *
 * @param {string} href
 * @param {ContributorMode | null} [mode]
 * @returns {URLSearchParams}
 */
export function contributorApiParams(href, mode = null) {
    const pageParams = new URL(href).searchParams;
    const apiParams = new URLSearchParams();
    const ignoredKey = mode ? FILTER_KEY_BY_MODE[mode] : null;

    apiParams.set('state', pageParams.get('state') || 'opened');

    PASSTHROUGH_PARAMS.forEach((key) => {
        const value = pageParams.get(key);
        if (value && key !== ignoredKey) {
            apiParams.set(key, value);
        }
    });

    Object.entries(RENAMED_PARAMS).forEach(([pageKey, apiKey]) => {
        const value = pageParams.get(pageKey);
        if (value) {
            apiParams.set(apiKey, value);
        }
    });

    Object.entries(LIST_PARAMS).forEach(([pageKey, apiKey]) => {
        const values = pageParams.getAll(pageKey);
        if (!values.length) {
            return;
        }

        if (apiKey.endsWith('[]')) {
            values.forEach(value => apiParams.append(apiKey, value));
        } else {
            apiParams.set(apiKey, values.join(','));
        }
    });

    return apiParams;
}

/**
 * Usernames from an "Approved by !=" filter. The REST API ignores that filter, so callers subtract these themselves.
 *
 * @param {string} href
 * @returns {string[]}
 */
export function excludedApprovers(href) {
    return new URL(href).searchParams.getAll('not[approved_by_usernames][]');
}

/**
 * Which "reviewed by me" filter the page has: approved by you, or not approved by you.
 *
 * @param {string} href
 * @param {string} username
 * @returns {'reviewed' | 'not_reviewed' | null}
 */
export function reviewedByMeFilter(href, username) {
    const params = new URL(href).searchParams;
    const hasUsername = (/** @type {string} */ key) => params.getAll(key).some(value => value.toLowerCase() === username.toLowerCase());

    if (hasUsername('approved_by_usernames[]')) {
        return 'reviewed';
    }

    if (hasUsername('not[approved_by_usernames][]')) {
        return 'not_reviewed';
    }

    return null;
}

/**
 * Sets or clears the filter for open merge requests you have approved, or have not approved.
 * The second leaves out your own merge requests, since you cannot review those.
 *
 * @param {string} href
 * @param {string} username
 * @param {'reviewed' | 'not_reviewed' | null} filter
 * @returns {string}
 */
export function reviewedByMeUrl(href, username, filter) {
    const url = new URL(href);

    url.searchParams.delete('approved_by_usernames[]');
    url.searchParams.delete('not[approved_by_usernames][]');
    url.searchParams.delete('not[author_username][]');
    url.searchParams.delete('page');
    url.searchParams.delete('page_after');
    url.searchParams.delete('page_before');

    if (filter) {
        url.searchParams.set('state', 'opened');
    }

    if (filter === 'reviewed') {
        url.searchParams.append('approved_by_usernames[]', username);
    } else if (filter === 'not_reviewed') {
        url.searchParams.append('not[approved_by_usernames][]', username);
        url.searchParams.set('not[author_username][]', username);
    }

    return url.toString();
}

/**
 * @param {{ state?: string, draft?: boolean, detailed_merge_status?: string }} mergeRequest
 * @returns {ContributorCategory}
 */
export function contributorCategory(mergeRequest) {
    if (mergeRequest.state === 'merged') {
        return 'merged';
    }

    if (mergeRequest.state === 'closed') {
        return 'closed';
    }

    const status = mergeRequest.detailed_merge_status || '';

    if (mergeRequest.draft || status === 'draft_status') {
        return 'draft';
    }

    if (status === 'mergeable') {
        return 'ready';
    }

    if (BLOCKED_STATUSES.includes(status)) {
        return 'blocked';
    }

    return 'review';
}

/**
 * Why a merge request cannot merge. detailed_merge_status names only the first failing check,
 * so conflicts and unresolved threads are added from their own fields.
 *
 * @param {{ detailed_merge_status?: string, has_conflicts?: boolean, blocking_discussions_resolved?: boolean }} mergeRequest
 * @returns {string[]}
 */
export function blockedReasons(mergeRequest) {
    const reasons = [BLOCKED_REASONS[/** @type {keyof typeof BLOCKED_REASONS} */ (mergeRequest.detailed_merge_status)]];

    if (mergeRequest.has_conflicts) {
        reasons.push(BLOCKED_REASONS.conflict);
    }

    if (mergeRequest.blocking_discussions_resolved === false) {
        reasons.push(BLOCKED_REASONS.discussions_not_resolved);
    }

    return [...new Set(reasons.filter(Boolean))];
}

/**
 * Groups merge requests per author or reviewer, busiest contributor first.
 *
 * @param {Array<Record<string, any>>} mergeRequests
 * @param {ContributorMode} mode
 */
export function summarizeContributors(mergeRequests, mode) {
    /** @type {Map<number, { user: Record<string, any>, total: number, counts: Record<ContributorCategory, number>, idlest: { reference: string, title: string, updatedAt: string } | null, blocked: Array<{ id: number, reference: string, title: string, webUrl: string, reasons: string[] }> }>} */
    const summaries = new Map();

    mergeRequests.forEach((mergeRequest) => {
        const users = mode === 'reviewers' ? (mergeRequest.reviewers || []) : [mergeRequest.author].filter(Boolean);
        const category = contributorCategory(mergeRequest);

        users.forEach((user) => {
            let summary = summaries.get(user.id);
            if (!summary) {
                summary = {
                    user,
                    total: 0,
                    counts: Object.fromEntries(CONTRIBUTOR_CATEGORIES.map(key => [key, 0])),
                    idlest: null,
                    blocked: [],
                };
                summaries.set(user.id, summary);
            }

            summary.total++;
            summary.counts[category]++;

            if (category === 'blocked') {
                summary.blocked.push({
                    id: mergeRequest.id,
                    reference: mergeRequest.references?.relative || `!${mergeRequest.iid}`,
                    title: mergeRequest.title,
                    webUrl: mergeRequest.web_url,
                    reasons: blockedReasons(mergeRequest),
                });
            }

            if (!summary.idlest || mergeRequest.updated_at < summary.idlest.updatedAt) {
                summary.idlest = {
                    reference: mergeRequest.references?.relative || `!${mergeRequest.iid}`,
                    title: mergeRequest.title,
                    updatedAt: mergeRequest.updated_at,
                };
            }
        });
    });

    return [...summaries.values()].sort((a, b) => b.total - a.total || a.user.name.localeCompare(b.user.name));
}

/**
 * @param {string} date
 * @param {number} [now]
 * @returns {number} Whole days since the date
 */
export function daysSince(date, now = Date.now()) {
    return Math.floor((now - Date.parse(date)) / 86_400_000);
}

/**
 * @param {number} days
 * @returns {string}
 */
export function formatIdle(days) {
    if (days >= 60) {
        return `${Math.floor(days / 30)} months idle`;
    }

    return `${days} ${days === 1 ? 'day' : 'days'} idle`;
}

/**
 * Toggles the author or reviewer filter of a merge request list page.
 *
 * @param {string} href
 * @param {ContributorMode} mode
 * @param {string} username
 * @returns {string}
 */
export function contributorFilterUrl(href, mode, username) {
    const url = new URL(href);
    const key = FILTER_KEY_BY_MODE[mode];

    if (url.searchParams.get(key) === username) {
        url.searchParams.delete(key);
    } else {
        url.searchParams.set(key, username);
    }

    url.searchParams.delete('page');
    url.searchParams.delete('page_after');
    url.searchParams.delete('page_before');

    return url.toString();
}

/**
 * @param {string} href
 * @param {ContributorMode} mode
 * @returns {string | null}
 */
export function activeContributor(href, mode) {
    return new URL(href).searchParams.get(FILTER_KEY_BY_MODE[mode]);
}
