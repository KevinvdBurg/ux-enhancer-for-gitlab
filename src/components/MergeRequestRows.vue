<template>
    <div>
        <template v-if="isRowStatusEnabled">
            <template
                v-for="row in rows"
                :key="row.key"
            >
                <teleport
                    v-if="statuses.get(row.key)?.category"
                    :to="`#${row.teleportId}`"
                >
                    <span
                        :class="`badge-${CATEGORY_META[statuses.get(row.key)!.category!].badge}`"
                        class="gl-badge badge badge-pill has-tooltip"
                        :title="statusTitle(statuses.get(row.key)!)"
                    >
                        <SvgIcon
                            class="gl-icon s16 gl-badge-icon"
                            :path="CATEGORY_ICONS[statuses.get(row.key)!.category!]"
                            style="fill: currentColor;"
                        />

                        <span class="gl-badge-content">{{ CATEGORY_META[statuses.get(row.key)!.category!].chip }}</span>
                    </span>

                    <span
                        v-if="statuses.get(row.key)!.yourTurn"
                        class="gl-badge badge badge-pill glab-enhancer-your-turn-badge has-tooltip"
                        :title="statuses.get(row.key)!.yourTurn!"
                    >
                        <SvgIcon
                            class="gl-icon s16 gl-badge-icon"
                            :path="mdiAccountArrowLeftOutline"
                            style="fill: currentColor;"
                        />

                        <span class="gl-badge-content">Your turn</span>
                    </span>
                </teleport>
            </template>
        </template>

        <teleport
            v-if="categoryFilter && bannerElement"
            :to="bannerElement"
        >
            <div class="glab-enhancer-filter-banner">
                <span>
                    Showing <strong>{{ CATEGORY_META[categoryFilter].short }}</strong> merge requests on this page:
                    {{ filterMatchCount }} of {{ rows.length }}
                </span>

                <button
                    class="btn btn-default btn-sm gl-button btn-default-tertiary"
                    type="button"
                    @click="categoryFilter = null"
                >
                    Show all
                </button>
            </div>
        </teleport>
    </div>
</template>

<script
    lang="ts"
    setup
>
    import {
        mdiAccountArrowLeftOutline,
        mdiAlertCircleOutline,
        mdiCheckCircleOutline,
        mdiCloseCircleOutline,
        mdiEyeOutline,
        mdiPencilOutline,
        mdiProgressClock,
        mdiSourceMerge,
    } from '@mdi/js';
    import { storeToRefs } from 'pinia';
    import {
        computed,
        onBeforeUnmount,
        onMounted,
        type Ref,
        shallowRef,
        watchEffect,
    } from 'vue';
    import { useMitt } from '../composables/useMitt';
    import { useThreadCountsCache } from '../composables/useThreadCountsCache';
    import {
        MittEventKey,
        Preference,
    } from '../enums';
    import { useExtensionStore } from '../store';
    import {
        rowKey,
        useMergeRequestRowsStore,
    } from '../stores';
    import { CATEGORY_META } from '../utils/mergeRequestCategories';
    import {
        parseReference,
        rowStatus,
        shortTaskStatus,
    } from '../utils/mergeRequestRowStatus';
    import SvgIcon from './SvgIcon.vue';

    interface Props {
        currentProjectPath: string,
    }

    const { currentProjectPath } = defineProps<Props>();

    type RowStatus = ReturnType<typeof rowStatus>;

    interface ListRow {
        key: string;
        projectPath: string;
        iid: string;
        teleportId: string;
        element: HTMLElement;
    }

    const CATEGORY_ICONS: Record<string, string> = {
        ready: mdiCheckCircleOutline,
        running: mdiProgressClock,
        review: mdiEyeOutline,
        blocked: mdiAlertCircleOutline,
        draft: mdiPencilOutline,
        merged: mdiSourceMerge,
        closed: mdiCloseCircleOutline,
    };

    const { getSetting } = useExtensionStore();
    const { gitlabUsername } = storeToRefs(useExtensionStore());
    const rowsStore = useMergeRequestRowsStore();
    const {
        rows: rowData,
        hoveredContributor,
        categoryFilter,
    } = storeToRefs(rowsStore);
    const threadCounts = useThreadCountsCache();

    const {
        on,
        off,
    } = useMitt();

    const isRowStatusEnabled = computed(() => !!getSetting(Preference.MR_ROW_STATUS, true));
    const isDimEnabled = computed(() => !!getSetting(Preference.MR_DIM_NOT_YOUR_TURN, false));
    const isCompactEnabled = computed(() => !!getSetting(Preference.MR_COMPACT_LIST, false));
    const isApprovalHighlightEnabled = computed(() => !!getSetting(Preference.MR_HIGHLIGHT_MY_APPROVALS, true));

    const rows: Ref<ListRow[]> = shallowRef([]);
    const bannerElement: Ref<HTMLElement | null> = shallowRef(null);

    const statuses = computed(() => {
        const items = new Map<string, RowStatus>();

        rows.value.forEach((row) => {
            const data = rowData.value.get(row.key);
            if (!data) {
                return;
            }

            items.set(row.key, rowStatus(data.mergeRequest, gitlabUsername.value, {
                approvedByMe: data.approvedByMe,
                threadsWithReplies: threadCounts.value.get(row.key)?.mineWithResponses || 0,
            }));
        });

        return items;
    });

    const filterMatchCount = computed(() => rows.value.filter(row => statuses.value.get(row.key)?.category === categoryFilter.value).length);

    function statusTitle(status: RowStatus) {
        const meta = CATEGORY_META[status.category!];

        return status.reasons.length ? `${meta.label}: ${status.reasons.join(', ')}` : meta.label;
    }

    function matchesHover(key: string) {
        const hover = hoveredContributor.value;
        const mergeRequest = rowData.value.get(key)?.mergeRequest;
        if (!hover || !mergeRequest) {
            return false;
        }

        return hover.mode === 'reviewers'
            ? mergeRequest.reviewers.some(reviewer => reviewer.username === hover.username)
            : mergeRequest.author?.username === hover.username;
    }

    /**
     * Finds the list rows, and gives each a spot for its status chips. GitLab can render rows again,
     * so this runs on every change and skips what is already there.
     */
    function scan() {
        const found: ListRow[] = [];

        document.querySelectorAll('.issuable-list > li.merge-request')
            .forEach((element) => {
                const reference = parseReference(element.querySelector('.issuable-reference')?.textContent || '', currentProjectPath);
                if (!reference) {
                    return;
                }

                const key = rowKey(reference);
                const teleportId = `glab-enhancer-row-status-${key.replace(/[^\w-]/g, '_')}`;
                const controls = element.querySelector('.issuable-meta ul.controls');

                if (controls && !document.getElementById(teleportId)) {
                    const placeholder = document.createElement('li');
                    placeholder.id = teleportId;
                    placeholder.className = 'glab-enhancer-row-status';
                    controls.insertBefore(placeholder, controls.querySelector('[data-testid="issuable-status"]')?.nextSibling || controls.firstChild);
                }

                found.push({
                    ...reference,
                    key,
                    teleportId,
                    element: element as HTMLElement,
                });
            });

        const list = document.querySelector('.issuable-list');
        if (list && !document.getElementById('glab-enhancer-filter-banner')) {
            const banner = document.createElement('div');
            banner.id = 'glab-enhancer-filter-banner';
            list.parentElement?.insertBefore(banner, list);
        }
        bannerElement.value = document.getElementById('glab-enhancer-filter-banner');

        const isSameRows = found.length === rows.value.length && found.every((row, index) => row.key === rows.value[index].key && row.element === rows.value[index].element);
        if (!isSameRows) {
            rows.value = found;
            rowsStore.load(found);
        }

        decorate();
    }

    /**
     * Applies the classes that follow the row data, the sidebar and the preferences.
     */
    function decorate() {
        document.querySelector('.issuable-list')?.classList.toggle('glab-enhancer-compact', isCompactEnabled.value);

        rows.value.forEach((row) => {
            const status = statuses.value.get(row.key);
            const isHovered = matchesHover(row.key);

            row.element.classList.toggle('glab-enhancer-not-your-turn', isDimEnabled.value && !!status && !status.yourTurn);
            row.element.classList.toggle('glab-enhancer-hover-match', isHovered);
            row.element.classList.toggle('glab-enhancer-hover-other', !!hoveredContributor.value && !isHovered);
            row.element.classList.toggle('glab-enhancer-filtered-out', !!categoryFilter.value && !!status && status.category !== categoryFilter.value);

            const approvals = row.element.querySelector('[data-testid="mr-approvals"] .gl-badge');
            if (approvals && !approvals.classList.contains('badge-success')) {
                approvals.classList.toggle('badge-info', isApprovalHighlightEnabled.value && !!rowData.value.get(row.key)?.approvedByMe);
            }

            if (isCompactEnabled.value) {
                const taskStatus = row.element.querySelector('[data-testid="task-status"]');
                const short = shortTaskStatus(taskStatus?.textContent || '');
                if (taskStatus && short && taskStatus.getAttribute('data-glab-short') !== short) {
                    taskStatus.setAttribute('data-glab-short', short);
                }
            }
        });
    }

    watchEffect(decorate);

    onMounted(() => {
        on(MittEventKey.PAGE_CONTENT_CHANGED, scan);
        scan();
    });

    onBeforeUnmount(() => {
        off(MittEventKey.PAGE_CONTENT_CHANGED, scan);
        categoryFilter.value = null;
        hoveredContributor.value = null;
    });
</script>
