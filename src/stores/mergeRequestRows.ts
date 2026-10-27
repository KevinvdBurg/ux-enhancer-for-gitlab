import { useLocalStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import {
    type Ref,
    ref,
} from 'vue';
import {
    fetchMergeRequestsByIids,
    type IMergeRequestListItem,
} from '../apis/mergeRequest';
import { APP_NAMESPACE } from '../constants';
import { useExtensionStore } from '../store';

export interface RowReference {
    projectPath: string;
    iid: string;
}

export interface MergeRequestRow {
    mergeRequest: Pick<IMergeRequestListItem, 'state' | 'draft' | 'detailed_merge_status' | 'has_conflicts' | 'blocking_discussions_resolved'> & {
        author: { username: string } | null;
        reviewers: Array<{ username: string }>;
    };
    approvedByMe: boolean;
}

export type ContributorHover = {
    username: string;
    mode: 'authors' | 'reviewers';
} | null;

const MAX_CACHED_ROWS = 500;

export function rowKey({ projectPath, iid }: RowReference) {
    return `${projectPath}!${iid}`;
}

/**
 * Merge requests shown in the list, fetched once per page load with one request per project,
 * plus what the contributors sidebar wants highlighted or filtered in the list.
 */
export const useMergeRequestRowsStore = defineStore(`${APP_NAMESPACE}/mergeRequestRows`, () => {
    // The last known data shows right away on the next visit
    const rows: Ref<Map<string, MergeRequestRow>> = useLocalStorage(`${APP_NAMESPACE}/merge-request-rows`, ref(new Map()));
    const checked = new Set<string>();

    const hoveredContributor: Ref<ContributorHover> = ref(null);
    const categoryFilter: Ref<string | null> = ref(null);

    function remember(key: string, row: MergeRequestRow) {
        rows.value.delete(key);
        rows.value.set(key, row);
        if (rows.value.size > MAX_CACHED_ROWS) {
            rows.value.delete(rows.value.keys().next().value!);
        }
    }

    async function fetchProjectRows(projectPath: string, iids: string[]) {
        const { gitlabUserId } = useExtensionStore();

        try {
            const [mergeRequests, approved] = await Promise.all([
                fetchMergeRequestsByIids(projectPath, iids),
                fetchMergeRequestsByIids(projectPath, iids, {
                    'approved_by_ids[]': String(gitlabUserId),
                }),
            ]);
            const approvedIids = new Set(approved.map(mergeRequest => String(mergeRequest.iid)));

            mergeRequests.forEach((mergeRequest) => {
                remember(rowKey({
                    projectPath,
                    iid: String(mergeRequest.iid),
                }), {
                    mergeRequest: {
                        state: mergeRequest.state,
                        draft: mergeRequest.draft,
                        detailed_merge_status: mergeRequest.detailed_merge_status,
                        has_conflicts: mergeRequest.has_conflicts,
                        blocking_discussions_resolved: mergeRequest.blocking_discussions_resolved,
                        author: mergeRequest.author ? { username: mergeRequest.author.username } : null,
                        reviewers: (mergeRequest.reviewers || []).map(reviewer => ({ username: reviewer.username })),
                    },
                    approvedByMe: approvedIids.has(String(mergeRequest.iid)),
                });
            });
        } catch {
            iids.forEach(iid => checked.delete(rowKey({
                projectPath,
                iid,
            })));
        }
    }

    /**
     * Fetches the rows not fetched yet during this page load.
     */
    function load(references: RowReference[]) {
        const uncheckedByProject = new Map<string, string[]>();

        references.forEach((reference) => {
            const key = rowKey(reference);
            if (checked.has(key)) {
                return;
            }

            checked.add(key);
            uncheckedByProject.set(reference.projectPath, [...(uncheckedByProject.get(reference.projectPath) || []), reference.iid]);
        });

        uncheckedByProject.forEach((iids, projectPath) => {
            for (let start = 0; start < iids.length; start += 100) {
                fetchProjectRows(projectPath, iids.slice(start, start + 100));
            }
        });
    }

    return {
        rows,
        hoveredContributor,
        categoryFilter,
        load,
    };
});
