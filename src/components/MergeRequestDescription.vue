<template>
    <span v-if="false" />
</template>

<script
    lang="ts"
    setup
>
    import { useLocalStorage } from '@vueuse/core';
    import {
        computed,
        onBeforeUnmount,
        onMounted,
        type Ref,
        ref,
        shallowRef,
        watch,
    } from 'vue';
    import { useWatchedElement } from '../composables/useWatchedElement';
    import { APP_NAMESPACE } from '../constants';
    import { Preference } from '../enums';
    import { useExtensionStore } from '../store';
    import {
        descriptionSections,
        taskSummary,
    } from '../utils/mergeRequestPage';

    interface Props {
        iid: number,
        currentProjectPath: string,
    }

    const {
        iid,
        currentProjectPath,
    } = defineProps<Props>();

    const HEADING_CLASS = 'glab-enhancer-section-heading';
    const COLLAPSED_CLASS = 'glab-enhancer-section-collapsed';
    const HIDDEN_CLASS = 'glab-enhancer-section-hidden';
    const TASKS_TOGGLE_CLASS = 'glab-enhancer-tasks-toggle';
    const DONE_CLASS = 'glab-enhancer-task-done';
    // Fewer ticked items than this are quicker to read than to open
    const MIN_DONE_TO_SHRINK = 3;
    const MAX_REMEMBERED = 300;

    const { getSetting } = useExtensionStore();
    const isEnabled = computed(() => !!getSetting(Preference.MR_DESCRIPTION_SECTIONS, true));

    // The sections you keep open, per merge request. Nothing stored means your first visit.
    const openByMergeRequest: Ref<Map<string, string[]>> = useLocalStorage(`${APP_NAMESPACE}/mr-description-sections`, ref(new Map()));
    const storageKey = `${currentProjectPath}!${iid}`;
    const stored = openByMergeRequest.value.get(storageKey);
    const openSections: Ref<Set<string> | null> = shallowRef(stored ? new Set(stored) : null);
    const expandedTaskLists = ref(new Set<number>());
    let titles: string[] = [];

    function remember(open: string[]) {
        openByMergeRequest.value.delete(storageKey);
        openByMergeRequest.value.set(storageKey, open);
        if (openByMergeRequest.value.size > MAX_REMEMBERED) {
            openByMergeRequest.value.delete(openByMergeRequest.value.keys().next().value!);
        }
    }

    function titleOf(heading: Element) {
        return heading.textContent?.trim() || '';
    }

    function toggleSection(title: string) {
        const open = new Set(openSections.value ?? titles);
        open.has(title) ? open.delete(title) : open.add(title);
        openSections.value = open;
        remember([...open]);
        run();
    }

    function toggleTaskList(index: number) {
        const expanded = new Set(expandedTaskLists.value);
        expanded.has(index) ? expanded.delete(index) : expanded.add(index);
        expandedTaskLists.value = expanded;
        run();
    }

    function setAttribute(element: Element, name: string, value: string | null) {
        if (value === null) {
            element.removeAttribute(name);
        } else if (element.getAttribute(name) !== value) {
            element.setAttribute(name, value);
        }
    }

    function shrinkTaskList(list: HTMLElement, index: number) {
        const items = [...list.querySelectorAll(':scope > li.task-list-item')];
        const done = items.filter(item => (item.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]') as HTMLInputElement | null)?.checked);
        const isShrunk = done.length >= MIN_DONE_TO_SHRINK && !expandedTaskLists.value.has(index);

        items.forEach(item => item.classList.toggle(DONE_CLASS, isShrunk && done.includes(item)));

        let toggle = list.nextElementSibling?.classList.contains(TASKS_TOGGLE_CLASS) ? list.nextElementSibling as HTMLButtonElement : null;
        if (done.length < MIN_DONE_TO_SHRINK) {
            toggle?.remove();
            return;
        }

        if (!toggle) {
            toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = TASKS_TOGGLE_CLASS;
            toggle.addEventListener('click', () => toggleTaskList(index));
            list.insertAdjacentElement('afterend', toggle);
        }

        const text = isShrunk
            ? `✓ ${taskSummary(done.length, items.length)} · show all`
            : 'Hide done items';
        if (toggle.textContent !== text) {
            toggle.textContent = text;
        }
    }

    function clean(root: ParentNode) {
        root.querySelectorAll(`.${TASKS_TOGGLE_CLASS}`).forEach(toggle => toggle.remove());
        root.querySelectorAll(`.${HEADING_CLASS}`).forEach((heading) => {
            heading.classList.remove(HEADING_CLASS, COLLAPSED_CLASS);
            ['role', 'tabindex', 'aria-expanded', 'data-glab-summary'].forEach(name => heading.removeAttribute(name));
        });
        root.querySelectorAll(`.${HIDDEN_CLASS}, .${DONE_CLASS}`).forEach(element => element.classList.remove(HIDDEN_CLASS, DONE_CLASS));
    }

    /**
     * Makes each section of the description collapsible, and shrinks checklists to what is left.
     * On your first visit everything is open; afterwards only the first section, unless you chose.
     */
    function apply(description: HTMLElement) {
        const markdown = description.querySelector('.md');
        if (!markdown || !isEnabled.value) {
            clean(description);
            return;
        }

        const children = [...markdown.children].filter(child => !child.classList.contains(TASKS_TOGGLE_CLASS)) as HTMLElement[];
        const sections = descriptionSections(children.map(child => child.tagName));
        titles = sections.map(section => titleOf(children[section.heading]));

        if (!stored && sections.length && !openByMergeRequest.value.has(storageKey)) {
            remember(titles.slice(0, 1));
        }

        sections.forEach((section, index) => {
            const heading = children[section.heading];
            const isOpen = openSections.value === null || openSections.value.has(titles[index]);
            const tasks = section.members.flatMap(member => [...children[member].querySelectorAll('input.task-list-item-checkbox')]) as HTMLInputElement[];

            heading.classList.add(HEADING_CLASS);
            heading.classList.toggle(COLLAPSED_CLASS, !isOpen);
            setAttribute(heading, 'role', 'button');
            setAttribute(heading, 'tabindex', '0');
            setAttribute(heading, 'aria-expanded', String(isOpen));
            setAttribute(heading, 'data-glab-summary', tasks.length ? taskSummary(tasks.filter(task => task.checked).length, tasks.length) : null);
            section.members.forEach(member => children[member].classList.toggle(HIDDEN_CLASS, !isOpen));
        });

        children.filter(child => child.matches('ul.task-list'))
            .forEach((list, index) => shrinkTaskList(list, index));
    }

    const { run } = useWatchedElement('.detail-page-description .description', apply);

    function headingOf(event: Event) {
        const target = event.target as Element;

        // The anchor link GitLab adds to headings keeps working
        return target.closest('a') ? null : target.closest(`.${HEADING_CLASS}`);
    }

    function onClick(event: MouseEvent) {
        const heading = headingOf(event);
        if (heading) {
            toggleSection(titleOf(heading));
        }
    }

    function onKeydown(event: KeyboardEvent) {
        const heading = headingOf(event);
        if (heading && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            toggleSection(titleOf(heading));
        }
    }

    watch(isEnabled, run);

    onMounted(() => {
        document.addEventListener('click', onClick);
        document.addEventListener('keydown', onKeydown);
    });

    onBeforeUnmount(() => {
        document.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKeydown);
        clean(document);
    });
</script>
