import assert from 'node:assert/strict';
import test from 'node:test';
import {
    changesSinceReview,
    descriptionSections,
    emptyBlocksLabel,
    hasActiveSession,
    peopleLabel,
    reportName,
    reviewStateLabel,
    shortName,
    taskSummary,
    waitingOn,
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

test('picks first names', () => {
    assert.equal(shortName('Verbaandert, Joren'), 'Joren');
    assert.equal(shortName('GitLab Duo'), 'GitLab Duo');
});

test('names people with you first', () => {
    const names = { a: 'Bovolini, Andre', j: 'Verbaandert, Joren' };

    assert.equal(peopleLabel(['a', 'me', 'j'], names, 'me'), 'you, Andre and Joren');
    assert.equal(peopleLabel(['j'], names, 'me'), 'Joren');
});

const reviewers = [
    { username: 'andre', reviewState: 'UNREVIEWED', approved: false },
    { username: 'joren', reviewState: 'REVIEWED', approved: false },
    { username: 'duo', reviewState: 'REVIEWED', approved: false, bot: true },
];

test('splits the work between author and reviewers', () => {
    assert.deepEqual(waitingOn({
        state: 'opened',
        author: 'kevin',
        reviewers,
        openThreads: [{ starter: 'joren', last: 'kevin' }, { starter: 'duo', last: 'kevin' }],
        isPipelineFailed: true,
    }), [
        { usernames: ['kevin'], task: 'fix the pipeline' },
        { usernames: ['joren'], task: 'check 1 reply' },
        { usernames: ['andre'], task: 'review' },
    ]);
});

test('waits on the author for replies and requested changes', () => {
    assert.deepEqual(waitingOn({
        state: 'opened',
        author: 'kevin',
        reviewers: [{ username: 'joren', reviewState: 'REQUESTED_CHANGES' }],
        openThreads: [{ starter: 'joren', last: 'joren' }, { starter: 'joren', last: 'joren' }],
    }), [
        { usernames: ['kevin'], task: 'address the requested changes and reply to 2 threads' },
    ]);
});

test('asks for approval once reviewed, and to merge once approved', () => {
    assert.deepEqual(waitingOn({ state: 'opened', author: 'kevin', reviewers: reviewers.slice(1), openThreads: [] }), [
        { usernames: ['joren'], task: 'approve' },
    ]);
    assert.deepEqual(waitingOn({ state: 'opened', author: 'kevin', reviewers, openThreads: [], isApproved: true }), [
        { usernames: ['kevin'], task: 'merge' },
    ]);
    assert.deepEqual(waitingOn({ state: 'opened', author: 'kevin', reviewers: [], openThreads: [] }), [
        { usernames: ['kevin'], task: 'ask for a review' },
    ]);
    assert.deepEqual(waitingOn({ state: 'opened', author: 'joren', reviewers: [{ username: 'kevin', reviewState: 'APPROVED', approved: true }, reviewers[2]], openThreads: [] }), [
        { usernames: ['joren'], task: 'ask for another approval' },
    ]);
    assert.deepEqual(waitingOn({ state: 'merged', author: 'kevin', reviewers, openThreads: [] }), []);
});

test('counts the pushes since your last review', () => {
    const versions = [
        { id: 3, head_commit_sha: 'c', created_at: '2026-10-27T12:00:00Z' },
        { id: 2, head_commit_sha: 'b', created_at: '2026-10-26T12:00:00Z' },
        { id: 1, head_commit_sha: 'a', created_at: '2026-10-25T12:00:00Z' },
    ];

    assert.deepEqual(changesSinceReview(versions, '2026-10-25T18:00:00Z'), { count: 2, diffId: 3, startSha: 'a' });
    assert.equal(changesSinceReview(versions, '2026-10-27T18:00:00Z'), null);
    assert.equal(changesSinceReview(versions, '2026-10-24T18:00:00Z'), null);
    assert.equal(changesSinceReview(versions, null), null);
});
