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

    async function checkApproval(gitlabUserId: number, projectPath: string, iid: string) {
        const key = `${projectPath}!${iid}`;
        if (knownApprovals.value.has(key)) {
            applyHighlight(projectPath, iid, knownApprovals.value.get(key)!);
        }

        if (checked.has(key)) {
            return;
        }

        checked.add(key);

        const { data } = await useFetch(`/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests/${iid}/approval_state?is_custom=1`).json();
        if (!data.value?.rules) {
            return;
        }

        const isApproved = data.value.rules.some((rule: { approved_by: Array<{ id: number }> }) => rule.approved_by.some(user => user.id === gitlabUserId));

        knownApprovals.value.delete(key);
        knownApprovals.value.set(key, isApproved);
        if (knownApprovals.value.size > MAX_KNOWN_APPROVALS) {
            knownApprovals.value.delete(knownApprovals.value.keys().next().value!);
        }

        applyHighlight(projectPath, iid, isApproved);
    }

    function highlight(gitlabUserId: number) {
        if (!gitlabUserId || !isMergeRequestPage.value || !getSetting(Preference.MR_HIGHLIGHT_MY_APPROVALS, true)) {
            return;
        }

        const currentProjectPath = extract()?.[0];

        document.querySelectorAll('.issuable-list > li .issuable-reference')
            .forEach((el) => {
                const [projectPath, iid] = el.textContent?.trim()?.split('!') || [];
                if (iid) {
                    checkApproval(gitlabUserId, projectPath || currentProjectPath, iid);
                }
            });
    }

    return {
        highlight,
    };
}
