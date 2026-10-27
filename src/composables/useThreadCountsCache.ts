import {
    createGlobalState,
    useLocalStorage,
} from '@vueuse/core';
import {
    type Ref,
    ref,
} from 'vue';
import { APP_NAMESPACE } from '../constants';

export interface ThreadCounts {
    unresolved: number;
    mine: number;
    mineWithResponses: number;
}

/**
 * Last known unresolved thread counts per merge request or issue, keyed by "project!iid",
 * shared by the thread badges and the list rows.
 */
export const useThreadCountsCache = createGlobalState((): Ref<Map<string, ThreadCounts>> => useLocalStorage(`${APP_NAMESPACE}/unresolved-threads`, ref(new Map())));
