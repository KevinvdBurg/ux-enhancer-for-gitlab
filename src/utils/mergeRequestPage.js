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
