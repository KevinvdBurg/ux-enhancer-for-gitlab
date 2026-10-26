import assert from 'node:assert/strict';
import test from 'node:test';
import {
    activeContributor,
    contributorApiParams,
    contributorCategory,
    contributorFilterUrl,
    excludedApprovers,
    reviewedByMeFilter,
    reviewedByMeUrl,
    summarizeContributors,
} from '../mergeRequestContributors.js';

const listUrl = 'https://gitlab.example/group/project/-/merge_requests';

test('maps list page filters to REST API params', () => {
    const params = contributorApiParams(`${listUrl}?draft=no&label_name[]=bug&label_name[]=ui&milestone_title=19.3&author_username=kevin&page=2`, 'reviewers');

    assert.equal(params.toString(), 'state=opened&author_username=kevin&wip=no&milestone=19.3&labels=bug%2Cui');
});

test('maps negated list filters to REST API names', () => {
    const params = contributorApiParams(`${listUrl}?not[author_username][]=kevin`, 'authors');

    assert.equal(decodeURIComponent(params.toString()), 'state=opened&not[author_username]=kevin');
});

test('leaves out the filter of the current mode', () => {
    const href = `${listUrl}?state=merged&author_username=kevin&reviewer_username=tom`;

    assert.equal(contributorApiParams(href, 'authors').toString(), 'state=merged&reviewer_username=tom');
    assert.equal(contributorApiParams(href, 'reviewers').toString(), 'state=merged&author_username=kevin');
    assert.equal(contributorApiParams(href).toString(), 'state=merged&author_username=kevin&reviewer_username=tom');
});

test('categorizes merge requests by merge status', () => {
    assert.equal(contributorCategory({ state: 'opened', detailed_merge_status: 'mergeable' }), 'ready');
    assert.equal(contributorCategory({ state: 'opened', detailed_merge_status: 'not_approved' }), 'review');
    assert.equal(contributorCategory({ state: 'opened', detailed_merge_status: 'checking' }), 'review');
    assert.equal(contributorCategory({ state: 'opened', detailed_merge_status: 'conflict' }), 'blocked');
    assert.equal(contributorCategory({ state: 'opened', draft: true, detailed_merge_status: 'conflict' }), 'draft');
    assert.equal(contributorCategory({ state: 'merged', detailed_merge_status: 'mergeable' }), 'merged');
    assert.equal(contributorCategory({ state: 'closed' }), 'closed');
});

test('summarizes authors and reviewers, busiest first', () => {
    const kevin = { id: 1, name: 'Kevin' };
    const tom = { id: 2, name: 'Tom' };
    const stefani = { id: 3, name: 'Stefani' };
    const mergeRequests = [
        { author: kevin, reviewers: [tom], state: 'opened', detailed_merge_status: 'mergeable', created_at: '2026-10-20T00:00:00Z' },
        { author: stefani, reviewers: [tom, kevin], state: 'opened', detailed_merge_status: 'not_approved', created_at: '2026-10-21T00:00:00Z' },
        { author: stefani, reviewers: [], state: 'opened', draft: true, created_at: '2026-10-19T00:00:00Z' },
    ];

    const authors = summarizeContributors(mergeRequests, 'authors');
    assert.deepEqual(authors.map(summary => [summary.user.name, summary.total]), [['Stefani', 2], ['Kevin', 1]]);
    assert.equal(authors[0].counts.draft, 1);
    assert.equal(authors[0].counts.review, 1);
    assert.equal(authors[0].oldestCreatedAt, '2026-10-19T00:00:00Z');

    const reviewers = summarizeContributors(mergeRequests, 'reviewers');
    assert.deepEqual(reviewers.map(summary => [summary.user.name, summary.total]), [['Tom', 2], ['Kevin', 1]]);
});

test('toggles the contributor filter and drops pagination', () => {
    const filtered = contributorFilterUrl(`${listUrl}?state=opened&page=3`, 'authors', 'kevin');
    assert.equal(filtered, `${listUrl}?state=opened&author_username=kevin`);
    assert.equal(activeContributor(filtered, 'authors'), 'kevin');

    assert.equal(contributorFilterUrl(filtered, 'authors', 'kevin'), `${listUrl}?state=opened`);
});

test('sets, inverts and clears the reviewed by me filter', () => {
    const reviewed = reviewedByMeUrl(`${listUrl}?draft=no&page=2`, 'K40530', 'reviewed');
    assert.equal(decodeURIComponent(reviewed), `${listUrl}?draft=no&state=opened&approved_by_usernames[]=K40530`);
    assert.equal(reviewedByMeFilter(reviewed, 'k40530'), 'reviewed');

    const notReviewed = reviewedByMeUrl(reviewed, 'K40530', 'not_reviewed');
    assert.equal(decodeURIComponent(notReviewed), `${listUrl}?draft=no&state=opened&not[approved_by_usernames][]=K40530&not[author_username][]=K40530`);
    assert.equal(reviewedByMeFilter(notReviewed, 'K40530'), 'not_reviewed');

    assert.equal(reviewedByMeUrl(notReviewed, 'K40530', null), `${listUrl}?draft=no&state=opened`);
    assert.equal(reviewedByMeFilter(`${listUrl}?draft=no`, 'K40530'), null);
});

test('reads the approved by != filter', () => {
    assert.deepEqual(excludedApprovers(`${listUrl}?not[approved_by_usernames][]=tom`), ['tom']);
});
