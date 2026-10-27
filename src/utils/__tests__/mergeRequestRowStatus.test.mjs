import assert from 'node:assert/strict';
import test from 'node:test';
import {
    parseReference,
    rowStatus,
    shortTaskStatus,
} from '../mergeRequestRowStatus.js';

const me = 'kevin';

function mergeRequest(overrides = {}) {
    return {
        state: 'opened',
        draft: false,
        detailed_merge_status: 'not_approved',
        author: { username: 'tom' },
        reviewers: [],
        ...overrides,
    };
}

test('reads the project and iid from a list reference', () => {
    assert.deepEqual(parseReference(' !6218 ', 'group/project'), { projectPath: 'group/project', iid: '6218' });
    assert.deepEqual(parseReference('gitlab-org/auth/iam!996', 'groups/gitlab-org'), { projectPath: 'gitlab-org/auth/iam', iid: '996' });
    assert.equal(parseReference('#12', 'group/project'), null);
});

test('shows the category of open merge requests only', () => {
    assert.equal(rowStatus(mergeRequest({ detailed_merge_status: 'mergeable' }), me).category, 'ready');
    assert.equal(rowStatus(mergeRequest({ state: 'merged' }), me).category, null);
});

test('lists blocked reasons', () => {
    const status = rowStatus(mergeRequest({ detailed_merge_status: 'ci_must_pass', has_conflicts: true }), me);

    assert.equal(status.category, 'blocked');
    assert.deepEqual(status.reasons, ['Pipeline must succeed', 'Merge conflicts']);
});

test('asks for your review until you approve', () => {
    const requested = mergeRequest({ reviewers: [{ username: me }] });

    assert.equal(rowStatus(requested, me, { approvedByMe: false }).yourTurn, 'Your review is requested');
    assert.equal(rowStatus(requested, me, { approvedByMe: true }).yourTurn, null);
    assert.equal(rowStatus({ ...requested, draft: true }, me, { approvedByMe: false }).yourTurn, null);
});

test('tells authors when their merge request is ready or blocked', () => {
    assert.equal(rowStatus(mergeRequest({ author: { username: me }, detailed_merge_status: 'mergeable' }), me).yourTurn, 'Ready for you to merge');
    assert.equal(rowStatus(mergeRequest({ author: { username: me }, detailed_merge_status: 'conflict' }), me).yourTurn, 'Blocked: Merge conflicts');
    assert.equal(rowStatus(mergeRequest({ author: { username: me } }), me).yourTurn, null);
});

test('puts replies to your threads first', () => {
    const status = rowStatus(mergeRequest({ reviewers: [{ username: me }] }), me, { approvedByMe: false, threadsWithReplies: 2 });

    assert.equal(status.yourTurn, '2 of your threads have replies');
});

test('shortens checklist progress', () => {
    assert.equal(shortTaskStatus(' 1 of 12 checklist items completed '), '1/12');
    assert.equal(shortTaskStatus('something else'), null);
});
