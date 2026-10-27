import assert from 'node:assert/strict';
import test from 'node:test';
import {
    descriptionSections,
    emptyBlocksLabel,
    hasActiveSession,
    reportName,
    reviewStateLabel,
    taskSummary,
} from '../mergeRequestPage.js';

test('splits a description by its largest repeated heading', () => {
    assert.deepEqual(descriptionSections(['P', 'H2', 'P', 'P', 'H2', 'H3', 'OL', 'H3', 'UL']), [
        {
            heading: 1,
            members: [2, 3],
        },
        {
            heading: 4,
            members: [5, 6, 7, 8],
        },
    ]);
});

test('skips a heading level that is used once', () => {
    assert.deepEqual(descriptionSections(['H1', 'P', 'H3', 'P', 'H3']), [
        {
            heading: 2,
            members: [3],
        },
        {
            heading: 4,
            members: [],
        },
    ]);
});

test('leaves a description without repeated headings alone', () => {
    assert.deepEqual(descriptionSections(['P', 'H2', 'UL']), []);
    assert.deepEqual(descriptionSections([]), []);
});

test('sums up a checklist', () => {
    assert.equal(taskSummary(11, 13), '11 of 13 done');
    assert.equal(taskSummary(5, 5), 'All 5 done');
});

test('shortens reviewer states', () => {
    assert.equal(reviewStateLabel('Reviewer commented'), 'Commented');
    assert.equal(reviewStateLabel('Reviewer requested changes'), 'Requested changes');
    assert.equal(reviewStateLabel('Awaiting review'), 'Awaiting review');
    assert.equal(reviewStateLabel(''), '');
});

test('names the empty sidebar blocks in one line', () => {
    assert.equal(emptyBlocksLabel(['labels', 'milestone', 'work items', 'time tracking']), 'No labels, milestone, work items or time tracking');
    assert.equal(emptyBlocksLabel(['labels', 'milestone']), 'No labels or milestone');
    assert.equal(emptyBlocksLabel(['labels']), 'No labels');
});

test('names report widgets by their status icon', () => {
    assert.equal(reportName('Success WidgetTestSummary'), 'Test summary');
    assert.equal(reportName('Success WidgetSecurityReports'), 'Security reports');
    assert.equal(reportName('Success'), '');
});

test('tells running sessions from finished ones', () => {
    assert.equal(hasActiveSession('Sessions 2 2 sessions completed #18490 Review giveaway entry hook fix'), false);
    assert.equal(hasActiveSession('Sessions 1 1 session running'), true);
});
