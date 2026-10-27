import { useIntervalFn } from '@vueuse/core';
import {
    onBeforeUnmount,
    type Ref,
    shallowRef,
} from 'vue';

/**
 * Calls `apply` with the element that matches `selector` whenever GitLab changes what is inside it.
 * GitLab renders parts of the page late and can replace them, so the element is looked up again
 * every second. `apply` must skip what it already did, because its own changes trigger it too.
 */
export function useWatchedElement(selector: string, apply: (element: HTMLElement) => void) {
    const element: Ref<HTMLElement | null> = shallowRef(null);
    let frame = 0;

    const run = () => {
        if (element.value?.isConnected) {
            apply(element.value);
        }
    };

    const observer = new MutationObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(run);
    });

    useIntervalFn(() => {
        const found = document.querySelector(selector) as HTMLElement | null;
        if (found === element.value) {
            return;
        }

        observer.disconnect();
        element.value = found;

        if (found) {
            observer.observe(found, {
                childList: true,
                subtree: true,
                characterData: true,
            });
            run();
        }
    }, 1000, { immediateCallback: true });

    onBeforeUnmount(() => {
        observer.disconnect();
        cancelAnimationFrame(frame);
    });

    return {
        element,
        run,
    };
}
