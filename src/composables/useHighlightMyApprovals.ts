import {
    useFetch,
    useLocalStorage,
} from '@vueuse/core';
import { storeToRefs } from 'pinia';
import {
    type Ref,
    ref,
} from 'vue';
import { APP_NAMESPACE } from '../constants';
import { Preference } from '../enums';
import { useExtensionStore } from '../store';
import { usePageDetectionStore } from '../stores';
import { useExtractProjectPaths } from './useExtractProjectPaths';

export function useHighlightMyApprovals() {
    const { isMergeRequestPage } = storeToRefs(usePageDetectionStore());
    const { getSetting } = useExtensionStore();
    const { extract } = useExtractProjectPaths();

    // Whether you approved each merge request, keyed by "project!iid". The last known answer shows right
    // away, and each merge request is checked once per page load.
    const knownApprovals: Ref<Map<string, boolean>> = useLocalStorage(`${APP_NAMESPACE}/my-approvals`, ref(new Map()));
    const MAX_KNOWN_APPROVALS = 500;
    const checked = new Set<string>();

    function applyHighlight(projectPath: string, iid: string, isApproved: boolean) {
        const referenceEl = document.querySelector(`.issuable-list .issuable-main-info a[href="/${projectPath}/-/merge_requests/${iid}"]`);
        const badge = referenceEl?.closest('li')?.querySelector('[data-testid="mr-approvals"], [data-testid="mr-appovals"]');

        if (badge && !badge.classList.contains('badge-success')) {
            badge.classList.toggle('badge-info', isApproved);
        }
    }

    function rememberApproval(key: string, isApproved: boolean) {
        knownApprovals.value.delete(key);
        knownApprovals.value.set(key, isApproved);
        if (knownApprovals.value.size > MAX_KNOWN_APPROVALS) {
            knownApprovals.value.delete(knownApprovals.value.keys().next().value!);
        }
    }

    // One request per project tells which of the listed merge requests you approved
    async function checkApprovals(gitlabUserId: number, projectPath: string, iids: string[]) {
        const query = new URLSearchParams({
            'is_custom': '1',
            'per_page': '100',
            'state': 'all',
            'approved_by_ids[]': String(gitlabUserId),
        });
        iids.forEach(iid => query.append('iids[]', iid));

        const { data } = await useFetch(`/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests?${query.toString()}`).json<Array<{ iid: number }>>();
        if (!Array.isArray(data.value)) {
            iids.forEach(iid => checked.delete(`${projectPath}!${iid}`));
            return;
        }

        const approvedIids = new Set(data.value.map(mergeRequest => String(mergeRequest.iid)));
        iids.forEach((iid) => {
            rememberApproval(`${projectPath}!${iid}`, approvedIids.has(iid));
            applyHighlight(projectPath, iid, approvedIids.has(iid));
        });
    }

    function highlight(gitlabUserId: number) {
        if (!gitlabUserId || !isMergeRequestPage.value || !getSetting(Preference.MR_HIGHLIGHT_MY_APPROVALS, true)) {
            return;
        }

        const currentProjectPath = extract()?.[0];
        const uncheckedByProject = new Map<string, string[]>();

        document.querySelectorAll('.issuable-list > li .issuable-reference')
            .forEach((el) => {
                const [path, iid] = el.textContent?.trim()?.split('!') || [];
                const projectPath = path || currentProjectPath;
                if (!iid || !projectPath) {
                    return;
                }

                const key = `${projectPath}!${iid}`;
                if (knownApprovals.value.has(key)) {
                    applyHighlight(projectPath, iid, knownApprovals.value.get(key)!);
                }

                if (!checked.has(key)) {
                    checked.add(key);
                    uncheckedByProject.set(projectPath, [...(uncheckedByProject.get(projectPath) || []), iid]);
                }
            });

        uncheckedByProject.forEach((iids, projectPath) => {
            for (let start = 0; start < iids.length; start += 100) {
                checkApprovals(gitlabUserId, projectPath, iids.slice(start, start + 100));
            }
        });
    }

    return {
        highlight,
    };
}
