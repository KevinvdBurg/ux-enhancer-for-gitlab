import {
    blockedReasons,
    contributorCategory,
} from './mergeRequestContributors.js';

/**
 * Reads a merge request reference from a list row. Group lists show the full project path,
 * project lists only the iid.
 *
 * @param {string} text
 * @param {string} currentProjectPath
 * @returns {{ projectPath: string, iid: string } | null}
 */
export function parseReference(text, currentProjectPath) {
    const match = text.trim().match(/^([\w./-]*)!(\d+)$/);
    if (!match) {
        return null;
    }

    return {
        projectPath: match[1] || currentProjectPath,
        iid: match[2],
    };
}

/**
 * What a list row shows about an open merge request: its category, why it is blocked,
 * and why it is your turn, if it is.
 *
 * @param {Record<string, any>} mergeRequest
 * @param {string} username
 * @param {{ approvedByMe?: boolean, threadsWithReplies?: number }} [context]
 * @returns {{ category: import('./mergeRequestContributors.js').ContributorCategory | null, reasons: string[], yourTurn: string | null }}
 */
export function rowStatus(mergeRequest, username, context = {}) {
    if (mergeRequest.state !== 'opened') {
        return {
            category: null,
            reasons: [],
            yourTurn: null,
        };
    }

    const category = contributorCategory(mergeRequest);
    const reasons = category === 'blocked' ? blockedReasons(mergeRequest) : [];

    return {
        category,
        reasons,
        yourTurn: yourTurn(mergeRequest, username, category, reasons, context),
    };
}

/**
 * @param {Record<string, any>} mergeRequest
 * @param {string} username
 * @param {string} category
 * @param {string[]} reasons
 * @param {{ approvedByMe?: boolean, threadsWithReplies?: number }} context
 * @returns {string | null}
 */
function yourTurn(mergeRequest, username, category, reasons, { approvedByMe, threadsWithReplies = 0 }) {
    if (!username) {
        return null;
    }

    if (threadsWithReplies) {
        return threadsWithReplies === 1 ? '1 of your threads has a reply' : `${threadsWithReplies} of your threads have replies`;
    }

    const isAuthor = mergeRequest.author?.username === username;
    const isReviewer = (mergeRequest.reviewers || []).some((/** @type {{ username: string }} */ reviewer) => reviewer.username === username);

    if (isReviewer && !isAuthor && approvedByMe === false && category !== 'draft') {
        return 'Your review is requested';
    }

    if (isAuthor && category === 'ready') {
        return 'Ready for you to merge';
    }

    if (isAuthor && category === 'blocked') {
        return reasons.length ? `Blocked: ${reasons.join(', ')}` : 'Blocked';
    }

    return null;
}

/**
 * @param {string} text GitLab's "1 of 12 checklist items completed"
 * @returns {string | null}
 */
export function shortTaskStatus(text) {
    const match = text.match(/(\d+) of (\d+)/);

    return match ? `${match[1]}/${match[2]}` : null;
}
