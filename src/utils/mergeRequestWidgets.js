import { reportName } from './mergeRequestPage.js';

/** The panel replaces known summaries; unfamiliar checks and native actions stay visible. */
export function duplicateWidgetElements(widget, panel) {
    const hidden = new Set();
    const add = element => element && hidden.add(element);
    if (!panel) {
        return hidden;
    }

    if (panel.hasAttribute('data-pipeline')) {
        add(widget.querySelector('[data-testid="pipeline-container"]'));
    }

    const approvals = widget.querySelector('.js-mr-approvals');
    if (approvals && panel.hasAttribute('data-approvals')) {
        if (approvals.querySelector('[data-testid="approve-button"]')) {
            add(approvals.querySelector('[data-testid="approvals-summary-content"]'));
            add(approvals.querySelector('[data-testid="widget-toggle"]')?.parentElement);
            add(approvals.querySelector('[data-testid="extension-actions-button"]')?.closest('.gl-font-size-0'));
            add(approvals.querySelector('.mr-widget-body > :first-child'));
        } else {
            add(approvals);
        }
    }

    const reports = widget.querySelector('.reports-widgets-container');
    if (reports) {
        for (const report of reports.children) {
            const icon = report.querySelector('[data-testid^="status-"][data-testid$="-icon"]');
            const name = reportName(icon?.getAttribute('aria-label') || '');
            if (name && panel.getAttribute('data-reports')?.split('|').includes(name)) {
                add(report);
            }
        }
        const reportRows = [...reports.children].filter(report => !report.classList.contains('glab-enhancer-passing-reports'));
        if (reportRows.length && reportRows.every(report => hidden.has(report))) {
            add(reports.querySelector('.glab-enhancer-passing-reports'));
        }
    }

    const checks = [...widget.querySelectorAll('[data-testid="merge-check"]')];
    const covered = checks.filter((check) => {
        const text = check.textContent.trim();
        const isDraft = text.startsWith('Merge request must not be draft.') && panel.hasAttribute('data-draft');
        const isDuplicate = (text.startsWith('Open threads must be resolved.') && document.querySelector('#notes-list'))
            || (text.startsWith('Pipeline must succeed.') && panel.hasAttribute('data-pipeline'))
            || (text.startsWith('All required approvals must be given.') && panel.hasAttribute('data-approvals'));

        if (isDraft && check.querySelector('[data-testid="mark-as-ready-button"]')) {
            add(check.querySelector('.gl-w-full'));
            add(check.querySelector('.gl-relative'));
            return true;
        }

        // Only these navigation buttons have an equivalent in the panel.
        const hasOtherAction = [...check.querySelectorAll('button, a, input')]
            .some(action => !['Go to first open thread', 'Assign reviewers'].includes(action.textContent.trim()));
        if ((isDuplicate || isDraft) && !hasOtherAction) {
            add(check);
            return true;
        }
        return false;
    });

    const checksBody = widget.querySelector('[data-testid="merge-checks-full"]');
    if (checks.length && covered.length === checks.length) {
        const header = checksBody?.previousElementSibling;
        if (header?.matches('.mr-widget-body') && !header.querySelector('.state-container-action-buttons button, .state-container-action-buttons a')) {
            add(header);
        }
        if (checks.every(check => hidden.has(check))) {
            add(checksBody);
        }
    }

    if (!checks.length && panel.querySelector('.glab-enhancer-ready__title')?.textContent.trim() === 'Ready to merge') {
        widget.querySelectorAll('.mr-widget-body').forEach((header) => {
            if (/^Ready to merge[.!]?$/.test(header.textContent.trim()) && !header.querySelector('button, a, input')) {
                add(header);
            }
        });
    }

    return hidden;
}
