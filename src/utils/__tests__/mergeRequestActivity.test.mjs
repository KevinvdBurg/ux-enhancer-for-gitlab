import assert from 'node:assert/strict';
import test from 'node:test';
import {
    approvalSummary,
    authorsLabel,
    classifySystemNote,
    describeFold,
    foldRuns,
} from '../mergeRequestActivity.js';

test('classifies history entries by their message', () => {
    assert.equal(classifySystemNote('added 8 commits'), 'push');
    assert.equal(classifySystemNote('added 1 commit'), 'push');
    assert.equal(classifySystemNote('marked the checklist item Unit tests as completed'), 'checklist');
    assert.equal(classifySystemNote('changed the description'), 'description');
    assert.equal(classifySystemNote('left review comments'), 'review');
    assert.equal(classifySystemNote('assigned to @K40530'), 'other');
});

test('describes a fold in a few words', () => {
    const kinds = [
        ...Array(24).fill('push'),
        ...Array(9).fill('checklist'),
        'description',
        'review',
        'review',
        'resolved',
        'resolved',
        'other',
    ];

    assert.equal(describeFold(kinds), 'pushed 24 times · ticked 9 checklist items · 2 resolved threads · submitted 2 reviews · edited the description · 1 other update');
    assert.equal(describeFold(['push', 'resolved']), 'pushed once · 1 resolved thread');
});

test('names up to two authors', () => {
    assert.equal(authorsLabel(['Kevin']), 'Kevin');
    assert.equal(authorsLabel(['Kevin', 'Joren', 'Kevin']), 'Kevin and Joren');
    assert.equal(authorsLabel(['Kevin', 'Joren', 'Andre']), 'Kevin and 2 others');
});

test('folds runs of history and resolved threads, keeping the rest visible', () => {
    const entries = ['push', 'push', 'open', 'push', 'resolved', 'resolved', 'comment', 'push', 'new', 'resolved'];

    assert.deepEqual(foldRuns(entries.map(kind => ({ kind, isFoldable: !['open', 'comment', 'new'].includes(kind) }))), [
        [0, 1],
        [3, 4, 5],
        [9],
    ]);
});

test('leaves a single history entry unfolded', () => {
    assert.deepEqual(foldRuns([{ kind: 'push', isFoldable: true }, { kind: 'open', isFoldable: false }]), []);
});

test('sums up approvals from the approval rules', () => {
    const rules = [
        { name: 'All Members', type: 'ANY_APPROVER', approvalsRequired: 2, approved: false, approvedBy: { nodes: [] } },
        { name: 'Platform', type: 'CODE_OWNER', approvalsRequired: 1, approved: false, approvedBy: { nodes: [] } },
        { name: '/docs/', type: 'CODE_OWNER', approvalsRequired: 0, approved: true, approvedBy: { nodes: [] } },
    ];

    assert.deepEqual(approvalSummary({ approved: false, approvedBy: { nodes: [] }, approvalState: { rules } }), {
        approved: false,
        given: 0,
        required: 2,
        missingRules: ['Platform'],
    });
    assert.equal(approvalSummary({ approved: true, approvedBy: { nodes: [{ username: 'a' }, { username: 'b' }] }, approvalState: { rules: [] } }).given, 2);
});
