// Canvas GraphQL Integration - Step 3 (submissions + grades) runs through
// GraphQL when the user enables it in Canvas Settings. Step 2 (SIS → Canvas
// user ID resolution) stays on REST because Canvas GraphQL redacts sisId /
// email / loginId on usersConnection for non-admin sessions, and there's no
// top-level users(sisIds: [...]) lookup.
//
// Canvas GraphQL requires a matching X-CSRF-Token header on every POST (read
// from the _csrf_token cookie). Without it, Canvas Rails rejects the request
// with HTTP 422.

import { CANVAS_DOMAIN } from '../constants/index.js';
import { isCanvasAuthError } from './modals/canvas-auth-modal.js';

const GRAPHQL_ENDPOINT = `${CANVAS_DOMAIN}/api/graphql`;
const SUBMISSIONS_PAGE_SIZE = 500;

let cachedCsrfToken = null;

async function getCsrfToken() {
    if (cachedCsrfToken) return cachedCsrfToken;
    if (!chrome.cookies || !chrome.cookies.get) return null;
    try {
        const cookie = await chrome.cookies.get({ url: CANVAS_DOMAIN, name: '_csrf_token' });
        if (cookie && cookie.value) {
            cachedCsrfToken = decodeURIComponent(cookie.value);
            return cachedCsrfToken;
        }
    } catch (e) {
        console.warn('[GraphQL] Failed to read CSRF cookie:', e.message);
    }
    return null;
}

async function graphqlRequest(query, variables = {}) {
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
    };
    const csrf = await getCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;

    const response = await fetch(GRAPHQL_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ query, variables })
    });

    if (isCanvasAuthError(response)) {
        const err = new Error('Canvas GraphQL auth error');
        err.response = response;
        err.isCanvasAuth = true;
        throw err;
    }

    if (!response.ok) {
        let detail = '';
        try { detail = (await response.text()).slice(0, 500); } catch (_) { /* ignore */ }
        if (response.status === 422) cachedCsrfToken = null;
        throw new Error(`Canvas GraphQL HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }

    const payload = await response.json();
    if (payload.errors && payload.errors.length > 0) {
        const msg = payload.errors.map(e => e.message).join('; ');
        throw new Error(`Canvas GraphQL error: ${msg}`);
    }
    return payload.data;
}

// --- Step 3: per-course submissions + grades ------------------------------

const COURSE_DATA_QUERY = `
query CourseSubmissions($courseId: ID!, $submissionsCursor: String, $userCursor: String, $fetchSubs: Boolean!, $fetchUsers: Boolean!) {
  course(id: $courseId) {
    _id
    submissionsConnection(first: ${SUBMISSIONS_PAGE_SIZE}, after: $submissionsCursor,
      filter: { states: [submitted, unsubmitted, graded, pending_review] }) @include(if: $fetchSubs) {
      pageInfo { hasNextPage endCursor }
      nodes {
        _id
        userId
        missing
        late
        excused
        score
        grade
        submittedAt
        cachedDueDate
        state
        assignment {
          _id
          name
          dueAt
          pointsPossible
          htmlUrl
        }
      }
    }
    enrollmentsConnection(after: $userCursor) @include(if: $fetchUsers) {
      pageInfo { hasNextPage endCursor }
      nodes {
        _id
        type
        user { _id }
        grades { currentScore finalScore currentGrade }
      }
    }
  }
}`;

export async function fetchCourseGroupDataGraphQL(origin, courseId, studentIds) {
    const wanted = new Set(studentIds.map(id => String(id)));

    const submissions = [];
    const enrollments = [];
    let submissionsCursor = null;
    let userCursor = null;
    let hasMoreSubs = true;
    let hasMoreUsers = true;

    while (hasMoreSubs || hasMoreUsers) {
        const data = await graphqlRequest(COURSE_DATA_QUERY, {
            courseId,
            submissionsCursor,
            userCursor,
            fetchSubs: hasMoreSubs,
            fetchUsers: hasMoreUsers
        });
        const course = data && data.course;
        if (!course) break;

        if (hasMoreSubs && course.submissionsConnection) {
            for (const node of (course.submissionsConnection.nodes || [])) {
                if (wanted.size > 0 && !wanted.has(String(node.userId))) continue;
                submissions.push(mapSubmission(node, origin, courseId));
            }
            const info = course.submissionsConnection.pageInfo || {};
            hasMoreSubs = !!info.hasNextPage;
            submissionsCursor = info.endCursor || null;
        }

        if (hasMoreUsers && course.enrollmentsConnection) {
            for (const node of (course.enrollmentsConnection.nodes || [])) {
                enrollments.push(node);
            }
            const info = course.enrollmentsConnection.pageInfo || {};
            hasMoreUsers = !!info.hasNextPage;
            userCursor = info.endCursor || null;
        }
    }

    const usersData = buildUsersData(enrollments, wanted);
    return { submissionsData: submissions, usersData };
}

function mapSubmission(node, origin, courseId) {
    const assignmentId = node.assignment ? parseInt(node.assignment._id, 10) : null;
    const previewUrl = assignmentId && node.userId
        ? `${origin}/courses/${courseId}/assignments/${assignmentId}/submissions/${node.userId}`
        : '';
    return {
        id: parseInt(node._id, 10),
        user_id: parseInt(node.userId, 10),
        missing: !!node.missing,
        late: !!node.late,
        excused: !!node.excused,
        score: node.score,
        grade: node.grade,
        submitted_at: node.submittedAt,
        cached_due_date: node.cachedDueDate,
        workflow_state: node.state,
        preview_url: previewUrl,
        assignment: node.assignment ? {
            id: assignmentId,
            name: node.assignment.name,
            due_at: node.assignment.dueAt,
            points_possible: node.assignment.pointsPossible,
            html_url: node.assignment.htmlUrl
        } : null
    };
}

function buildUsersData(enrollments, wanted) {
    const byUser = new Map();
    for (const enr of enrollments) {
        const userId = enr.user && enr.user._id ? parseInt(enr.user._id, 10) : null;
        if (!userId) continue;
        if (wanted.size > 0 && !wanted.has(String(userId))) continue;

        const grades = enr.grades || {};
        const existing = byUser.get(userId);
        if (!existing || enr.type === 'StudentEnrollment') {
            byUser.set(userId, {
                id: userId,
                enrollments: [{
                    type: enr.type || 'StudentEnrollment',
                    grades: {
                        current_score: grades.currentScore != null ? grades.currentScore : null,
                        final_score: grades.finalScore != null ? grades.finalScore : null,
                        current_grade: grades.currentGrade || null
                    }
                }]
            });
        }
    }
    return Array.from(byUser.values());
}
