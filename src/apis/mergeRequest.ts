import type { GitlabUser } from '../types';

export interface IMergeRequestListItem {
    id: number;
    iid: number;
    title: string;
    web_url: string;
    references: { relative: string };
    state: string;
    draft: boolean;
    detailed_merge_status: string;
    has_conflicts: boolean;
    blocking_discussions_resolved: boolean;
    created_at: string;
    updated_at: string;
    author: GitlabUser;
    reviewers: GitlabUser[];
}

export function mergeRequestsEndpoint(path: string, isGroup: boolean) {
    return isGroup
        ? `/api/v4/groups/${encodeURIComponent(path.replace(/^groups\//, ''))}/merge_requests`
        : `/api/v4/projects/${encodeURIComponent(path)}/merge_requests`;
}

/**
 * Fetches merge requests newest first, stopping after `maxPages` pages of 100.
 */
export async function fetchMergeRequests(endpoint: string, params: URLSearchParams, maxPages: number) {
    const fetchPage = async (page: number) => {
        const query = new URLSearchParams(params);
        query.set('is_custom', '1');
        query.set('per_page', '100');
        query.set('page', page.toString());

        const response = await fetch(`${endpoint}?${query.toString()}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
        }

        return response;
    };

    const firstResponse = await fetchPage(1);
    const mergeRequests: IMergeRequestListItem[] = await firstResponse.json();
    const totalPages = parseInt(firstResponse.headers.get('x-total-pages') || '1', 10);
    const total = parseInt(firstResponse.headers.get('x-total') || `${mergeRequests.length}`, 10);

    const pages: Promise<IMergeRequestListItem[]>[] = [];
    for (let page = 2; page <= Math.min(totalPages, maxPages); page++) {
        pages.push(fetchPage(page).then(response => response.json()));
    }

    (await Promise.all(pages)).forEach(pageData => mergeRequests.push(...pageData));

    return {
        mergeRequests,
        total,
    };
}

export async function countMergeRequests(endpoint: string, params: URLSearchParams) {
    const query = new URLSearchParams(params);
    query.set('is_custom', '1');
    query.set('per_page', '1');

    const response = await fetch(`${endpoint}?${query.toString()}`);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
    }

    return parseInt(response.headers.get('x-total') || '0', 10);
}

/**
 * Fetches the listed merge requests of one project, up to 100 at a time.
 */
export async function fetchMergeRequestsByIids(projectPath: string, iids: string[], extraParams: Record<string, string> = {}) {
    const query = new URLSearchParams({
        is_custom: '1',
        per_page: '100',
        state: 'all',
        ...extraParams,
    });
    iids.forEach(iid => query.append('iids[]', iid));

    const response = await fetch(`/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests?${query.toString()}`);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
    }

    return response.json() as Promise<IMergeRequestListItem[]>;
}

/**
 * Counts unresolved threads of the listed merge requests of one project in a single request,
 * keyed by iid. Resolves to null when GitLab cannot answer it.
 */
export async function fetchUnresolvedThreadCounts(projectPath: string, iids: string[], csrfToken: string) {
    try {
        const response = await fetch('/api/graphql?is_custom=1', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({
                query: `query($fullPath: ID!, $iids: [String!]) {
                    project(fullPath: $fullPath) {
                        mergeRequests(iids: $iids, first: 100) {
                            nodes { iid resolvableDiscussionsCount resolvedDiscussionsCount }
                        }
                    }
                }`,
                variables: {
                    fullPath: projectPath,
                    iids,
                },
            }),
        });
        const { data } = await response.json();
        const nodes: Array<{ iid: string, resolvableDiscussionsCount: number | null, resolvedDiscussionsCount: number | null }> | undefined = data?.project?.mergeRequests?.nodes;
        if (!nodes) {
            return null;
        }

        return new Map(nodes.map(node => [node.iid, (node.resolvableDiscussionsCount || 0) - (node.resolvedDiscussionsCount || 0)]));
    } catch {
        return null;
    }
}
