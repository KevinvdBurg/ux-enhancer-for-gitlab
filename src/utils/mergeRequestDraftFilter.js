/**
 * @param {string} href
 * @param {boolean} draft
 * @returns {string}
 */
export function mergeRequestDraftFilterUrl(href, draft) {
    const url = new URL(href);

    url.searchParams.set('state', 'opened');
    url.searchParams.set('draft', draft ? 'yes' : 'no');
    url.searchParams.delete('page');
    url.searchParams.delete('page_after');
    url.searchParams.delete('page_before');

    return url.toString();
}

/**
 * The draft filter only splits the open tab, so other states show drafts and non-drafts alike.
 *
 * @param {string} href
 * @param {string} state
 * @returns {string}
 */
export function mergeRequestStateUrl(href, state) {
    const url = new URL(href);

    url.searchParams.set('state', state);
    url.searchParams.delete('draft');
    url.searchParams.delete('page');
    url.searchParams.delete('page_after');
    url.searchParams.delete('page_before');

    return url.toString();
}
