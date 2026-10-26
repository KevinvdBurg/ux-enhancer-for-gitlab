<template>
    <div v-if="isReady">
        <Preferences />

        <CommandPanelEnhancer />

        <IssueDetail
            v-if="isIssuePage && iid"
            :current-project-path="projectPath"
            :iid="iid"
        />

        <MyUnresolvedThreads
            v-if="isMrIssueOverviewReady && !iid"
            :current-project-path="projectPath"
            :is-merge-request="isMergeRequestPage"
        />

        <MergeRequestDetail
            v-if="isMergeRequestPage && iid"

            :csrf-token="csrfToken"
            :current-project-path="projectPath"
            :iid="iid"
        />

        <TodoList v-if="isTodoPage" />

        <ScopedLabelsDropdowns
            v-if="isScopedLabelsDropdownEnabled"
            :csrf-token="csrfToken"
            :current-project-path="effectiveProjectPath"
            :iid="effectiveIid"
        />

        <StarIssueBoards v-if="isStarIssueBoardsEnabled" />

        <ContributorsSidebar
            v-if="isContributorsSidebarEnabled && projectPath"
            :key="projectPath"
            :current-project-path="projectPath"
            :is-group="isGroupPage"
        />

        <QuickReactions
            v-if="isQuickReactionsEnabled && isMergeRequestPage && iid"
            :current-project-path="projectPath"
            :csrf-token="csrfToken"
            :iid="iid"
        />
    </div>
</template>

<script
    lang="ts"
    setup
>
    import { storeToRefs } from 'pinia';
    import {
        computed,
        onMounted,
        ref,
    } from 'vue';
    import CommandPanelEnhancer from './components/CommandPanelEnhancer.vue';
    import ContributorsSidebar from './components/ContributorsSidebar.vue';
    import IssueDetail from './components/IssueDetail.vue';
    import MergeRequestDetail from './components/MergeRequestDetail.vue';
    import MyUnresolvedThreads from './components/MyUnresolvedThreads.vue';
    import Preferences from './components/Preferences.vue';
    import QuickReactions from './components/QuickReactions.vue';
    import ScopedLabelsDropdowns from './components/ScopedLabelsDropdowns.vue';
    import StarIssueBoards from './components/StarIssueBoards.vue';
    import TodoList from './components/TodoList.vue';
    import { useDimDraftMrs } from './composables/useDimDraftMrs';
    import { useHighlightMyApprovals } from './composables/useHighlightMyApprovals';
    import { useHighlightMyIssuesMrs } from './composables/useHighlightMyIssuesMrs';
    import { useMitt } from './composables/useMitt';
    import { usePersistentFilters } from './composables/usePersistentFilters';
    import { useRenameProjectInIssueBoards } from './composables/useRenameProjectInIssueBoards';
    import { useRenderProjectAvatarIssues } from './composables/useRenderProjectAvatarIssues';
    import { useSeparateDraftMrs } from './composables/useSeparateDraftMrs';
    import { useShowEpicAssignees } from './composables/useShowEpicAssignees';
    import { DEFAULT_QUICK_REACTIONS } from './constants';
    import {
        BrowserMessageType,
        MittEventKey,
        PageType,
        Preference,
    } from './enums';
    import { useExtensionStore } from './store';
    import { usePageDetectionStore } from './stores';

    const { emit } = useMitt();

    const { getSetting } = useExtensionStore();
    const {
        gitlabUserId,
        gitlabUsername,
        isReady,
    } = storeToRefs(useExtensionStore());

    const pageDetectionStore = usePageDetectionStore();
    const {
        projectPath,
        iid,
        panelContext,
        isIssuePage,
        isMergeRequestPage,
        isBoardPage,
        isTodoPage,
        isGroupPage,
        isDetailPage,
        pageType,
    } = storeToRefs(pageDetectionStore);

    const effectiveIid = computed(() => panelContext.value?.iid ?? iid.value);
    const effectiveProjectPath = computed(() => panelContext.value?.projectPath ?? (!isGroupPage.value ? projectPath.value : ''));

    usePersistentFilters();
    const {
        render: renderProjectAvatars,
        renderNow: renderProjectAvatarsNow,
    } = useRenderProjectAvatarIssues();
    const { rename: renameProjectIssueBoards } = useRenameProjectInIssueBoards();
    const {
        highlight: highlightMyIssuesMrs,
        highlightNow: highlightMyIssuesMrsNow,
    } = useHighlightMyIssuesMrs();
    const {
        dim: dimDraftMrs,
        dimNow: dimDraftMrsNow,
    } = useDimDraftMrs();
    const { highlight: highlightMyApprovals } = useHighlightMyApprovals();
    const {
        render: renderDraftMrsTab,
        renderNow: renderDraftMrsTabNow,
    } = useSeparateDraftMrs();
    const { render: renderEpicAssignees } = useShowEpicAssignees();

    const csrfToken = ref('');
    const isMrIssueOverviewReady = ref(false);

    const isScopedLabelsDropdownEnabled = computed(() => getSetting(Preference.GENERAL_SCOPED_LABELS_DROPDOWN, true) && csrfToken.value && (isBoardPage.value || (effectiveIid.value && (isMergeRequestPage.value || isIssuePage.value))));
    const isStarIssueBoardsEnabled = computed(() => getSetting(Preference.ISSUE_STAR_BOARDS, true) && isBoardPage.value);
    const isContributorsSidebarEnabled = computed(() => getSetting(Preference.MR_CONTRIBUTORS_SIDEBAR, true) && [
        PageType.PROJECT_MERGE_REQUESTS,
        PageType.GROUP_MERGE_REQUESTS,
    ].includes(pageType.value));
    const isQuickReactionsEnabled = computed(() => !!(getSetting(Preference.MR_QUICK_REACTIONS, DEFAULT_QUICK_REACTIONS) as string || '').trim());

    function checkIsMrIssueOverviewReady() {
        isMrIssueOverviewReady.value = !!document.querySelector('ul.issuable-list > li:first-child .issuable-reference, div[data-testid="merge-request-dashboard-tab"] div[data-testid="merge-request"]');
    }

    onMounted(async () => {
        const csrfTokenMetaTag = document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement;
        csrfToken.value = csrfTokenMetaTag.content || '';

        window.addEventListener('message', (event) => {
            if (event.data.type === BrowserMessageType.BROWSER_REQUEST_COMPLETED && !event.data.data.url.includes('is_custom=1')) {
                if (event.data.data.url.includes('/api/graphql')) {
                    emit(MittEventKey.GRAPHQL_REQUEST_COMPLETED, event.data.data);
                }

                emit(MittEventKey.BROWSER_REQUEST_COMPLETED, event.data.data);

                renderProjectAvatars();
                renameProjectIssueBoards();
                highlightMyIssuesMrs(gitlabUsername.value);
                dimDraftMrs();
                renderDraftMrsTab();
                renderEpicAssignees();

                highlightMyApprovals(gitlabUserId.value);

                checkIsMrIssueOverviewReady();
            }
        });

        watchPageContent();
    });

    /**
     * Decorates lists before the browser paints what GitLab rendered, instead of after its requests
     * completed, so nothing pops in afterwards. Every step skips what it already did.
     */
    function watchPageContent() {
        let isQueued = false;

        const decorate = () => {
            // Detail pages change constantly and have no lists to decorate
            if (isDetailPage.value) {
                return;
            }

            renderProjectAvatarsNow();
            highlightMyIssuesMrsNow(gitlabUsername.value);
            dimDraftMrsNow();
            renderDraftMrsTabNow();
            highlightMyApprovals(gitlabUserId.value);
            checkIsMrIssueOverviewReady();
            emit(MittEventKey.PAGE_CONTENT_CHANGED);
        };

        new MutationObserver(() => {
            if (isQueued) {
                return;
            }

            isQueued = true;
            queueMicrotask(() => {
                isQueued = false;
                decorate();
            });
        }).observe(document.body, {
            childList: true,
            subtree: true,
        });

        decorate();
    }
</script>
