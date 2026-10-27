/**
 * Splits a description into sections by its largest heading that is used more than once.
 * Content before the first heading stays outside every section.
 *
 * @param {string[]} tags The tag names of the description's direct children
 * @returns {Array<{ heading: number, members: number[] }>}
 */
export function descriptionSections(tags) {
    const level = ['H1', 'H2', 'H3'].find(tag => tags.filter(item => item === tag).length > 1);
    if (!level) {
        return [];
    }

    const sections = [];
    tags.forEach((tag, index) => {
        if (tag === level) {
            sections.push({
                heading: index,
                members: [],
            });
        } else if (sections.length) {
            sections[sections.length - 1].members.push(index);
        }
    });

    return sections;
}

/**
 * @param {number} done
 * @param {number} total
 */
export function taskSummary(done, total) {
    return done === total ? `All ${total} done` : `${done} of ${total} done`;
}

/**
 * Turns the tooltip of GitLab's reviewer state icon into a short label.
 *
 * @param {string} title For example "Reviewer commented" or "Reviewer requested changes"
 */
export function reviewStateLabel(title) {
    const text = title.trim().replace(/^reviewer\s+/i, '');

    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

/**
 * @param {string[]} names For example ['labels', 'milestone', 'time tracking']
 */
export function emptyBlocksLabel(names) {
    if (names.length < 2) {
        return `No ${names.join('')}`;
    }

    return `No ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/**
 * Names a report widget by the label of its status icon.
 *
 * @param {string} ariaLabel For example "Success WidgetTestSummary"
 */
export function reportName(ariaLabel) {
    const name = ariaLabel.match(/Widget(\w+)/)?.[1];
    if (!name) {
        return '';
    }

    const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

    return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * @param {string} text The text of the sessions widget
 */
export function hasActiveSession(text) {
    return /\b(running|in progress|pending|queued|created|waiting)\b/i.test(text);
}

/**
 * @param {string[]} items
 */
function listJoin(items) {
    return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
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
 * GitLab shows names as "Last, First" here, so this picks the first name.
 *
 * @param {string} name
 */
export function shortName(name) {
    const [last, first] = name.split(', ');

    return first ? first.split(' ')[0] : last;
}

/**
 * @param {string[]} usernames
 * @param {Record<string, string>} names Full names by username
 * @param {string} me
 */
export function peopleLabel(usernames, names, me) {
    const sorted = [...usernames].sort((a, b) => Number(b === me) - Number(a === me));

    return listJoin(sorted.map(username => (username === me ? 'you' : shortName(names[username] || username))));
}

/**
 * @typedef {{ username: string, reviewState?: string | null, approved?: boolean, bot?: boolean }} Reviewer
 * @typedef {{ starter: string, last: string }} OpenThread
 */

/**
 * Works out who the merge request waits on, and for what. Several people can each have something
 * to do, for example the author a failed pipeline while a reviewer has a reply to read.
 *
 * @param {{
 *   state: string,
 *   author: string,
 *   reviewers: Reviewer[],
 *   openThreads: OpenThread[],
 *   isDraft?: boolean,
 *   isApproved?: boolean,
 *   isPipelineFailed?: boolean,
 *   hasConflicts?: boolean,
 * }} mergeRequest
 * @returns {Array<{ usernames: string[], task: string }>}
 */
export function waitingOn(mergeRequest) {
    const {
        state,
        author,
        reviewers,
        openThreads,
        isDraft,
        isApproved,
        isPipelineFailed,
        hasConflicts,
    } = mergeRequest;

    if (state !== 'opened') {
        return [];
    }

    const bots = new Set(reviewers.filter(reviewer => reviewer.bot).map(reviewer => reviewer.username));
    const authorTasks = [];
    const tasks = [];

    if (isDraft) {
        authorTasks.push('finish the draft');
    }

    if (reviewers.some(reviewer => reviewer.reviewState === 'REQUESTED_CHANGES')) {
        authorTasks.push('address the requested changes');
    }

    const toReply = openThreads.filter(thread => thread.last !== author).length;
    if (toReply) {
        authorTasks.push(`reply to ${plural(toReply, 'thread', 'threads')}`);
    }

    if (hasConflicts) {
        authorTasks.push('resolve the conflicts');
    }

    if (isPipelineFailed) {
        authorTasks.push('fix the pipeline');
    }

    // A thread the author answered last waits on whoever started it
    const answered = new Map();
    openThreads.filter(thread => thread.last === author && thread.starter !== author && !bots.has(thread.starter))
        .forEach(thread => answered.set(thread.starter, (answered.get(thread.starter) || 0) + 1));
    answered.forEach((count, username) => tasks.push({
        usernames: [username],
        task: `check ${plural(count, 'reply', 'replies')}`,
    }));

    if (!isDraft && !isApproved) {
        const people = reviewers.filter(reviewer => !reviewer.bot && reviewer.username !== author);
        const waiting = people.filter(reviewer => !reviewer.approved && reviewer.reviewState !== 'REQUESTED_CHANGES' && !answered.has(reviewer.username));
        const notStarted = waiting.filter(reviewer => !reviewer.reviewState || ['UNREVIEWED', 'REVIEW_STARTED'].includes(reviewer.reviewState));
        const reviewed = waiting.filter(reviewer => !notStarted.includes(reviewer));

        if (notStarted.length) {
            tasks.push({
                usernames: notStarted.map(reviewer => reviewer.username),
                task: 'review',
            });
        }

        if (reviewed.length) {
            tasks.push({
                usernames: reviewed.map(reviewer => reviewer.username),
                task: 'approve',
            });
        }

        if (!people.length) {
            authorTasks.push('ask for a review');
        } else if (!waiting.length && !answered.size && !people.some(reviewer => reviewer.reviewState === 'REQUESTED_CHANGES')) {
            // Everyone asked has approved, but the rules want more
            authorTasks.push('ask for another approval');
        }
    }

    if (!authorTasks.length && !tasks.length && isApproved) {
        authorTasks.push('merge');
    }

    return authorTasks.length
        ? [{
            usernames: [author],
            task: listJoin(authorTasks),
        }, ...tasks]
        : tasks;
}

/**
 * Finds the pushes after your last review, and the versions to compare them with.
 *
 * @param {Array<{ id: number, head_commit_sha: string, created_at: string }>} versions Newest first
 * @param {string | null} reviewedAt When you last commented or approved
 * @returns {{ count: number, diffId: number, startSha: string } | null}
 */
export function changesSinceReview(versions, reviewedAt) {
    if (!reviewedAt || !versions.length) {
        return null;
    }

    const time = new Date(reviewedAt).getTime();
    const newer = versions.filter(version => new Date(version.created_at).getTime() > time);
    const reviewed = versions.find(version => new Date(version.created_at).getTime() <= time);

    if (!newer.length || !reviewed) {
        return null;
    }

    return {
        count: newer.length,
        diffId: versions[0].id,
        startSha: reviewed.head_commit_sha,
    };
}
