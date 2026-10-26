export interface MergeRequestStateCounts {
    opened: number;
    merged: number;
    closed: number;
    all: number;
}

interface CountsQuery {
    options: {
        query: unknown;
        variables: (this: MergeRequestListApp) => Record<string, unknown>;
    };
}

interface MergeRequestListApp {
    $router?: { mode?: string };
    $apollo: {
        queries: { mergeRequestCounts?: CountsQuery };
        query: (options: { query: unknown, variables: Record<string, unknown> }) => Promise<{ data: Record<string, Record<string, { count: number }> | null> }>;
    };
}

// Variables that differ per page or tab, but not per filter
const NON_FILTER_VARIABLES = ['draft', 'state', 'sort', 'firstPageSize', 'lastPageSize', 'afterCursor', 'beforeCursor'];

/**
 * GitLab's Vue merge request list, found through the instance Vue 2 leaves on its element.
 * Older GitLab versions render the list on the server, and have none.
 */
function findMergeRequestListApp(): MergeRequestListApp | null {
    let element = document.querySelector('.issuable-list-container');

    while (element) {
        try {
            const vm = (element as HTMLElement & { __vue__?: MergeRequestListApp }).__vue__;
            if (vm?.$apollo?.queries?.mergeRequestCounts) {
                return vm;
            }
        } catch {
            return null;
        }

        element = element.parentElement;
    }

    return null;
}

/**
 * Applies new list filters in place when the list follows the address, and loads the page otherwise.
 */
export function navigateMergeRequestList(url: string, replace = false) {
    if (findMergeRequestListApp()?.$router?.mode !== 'history') {
        window.location[replace ? 'replace' : 'assign'](url);
        return;
    }

    history[replace ? 'replaceState' : 'pushState'](history.state, '', url);
    window.dispatchEvent(new PopStateEvent('popstate', {
        state: history.state,
    }));
}

/**
 * Runs the list's own count query with a different draft filter, so every other filter still applies.
 * Resolves to null when the list has no such query.
 */
export function fetchMergeRequestCounts() {
    const app = findMergeRequestListApp();
    const countsQuery = app?.$apollo.queries.mergeRequestCounts;
    if (!app || !countsQuery) {
        return null;
    }

    const variables = countsQuery.options.variables.call(app);
    const filterKey = JSON.stringify(Object.entries(variables).filter(([key]) => !NON_FILTER_VARIABLES.includes(key)));

    const count = async (draft?: boolean) => {
        const { data } = await app.$apollo.query({
            query: countsQuery.options.query,
            variables: {
                ...variables,
                draft,
            },
        });
        const namespace = data.namespace || data.project || data.group;

        return {
            opened: namespace?.openedMergeRequests?.count ?? 0,
            merged: namespace?.mergedMergeRequests?.count ?? 0,
            closed: namespace?.closedMergeRequests?.count ?? 0,
            all: namespace?.allMergeRequests?.count ?? 0,
        };
    };

    return {
        filterKey,
        load: () => Promise.all([
            count(false),
            count(true),
            count(),
        ]),
    };
}
