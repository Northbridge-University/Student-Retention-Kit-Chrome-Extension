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
import { getCachedCanvasCourseId, setCachedCanvasCourseIds } from '../utils/canvasCourseIdCache.js';

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

// --- Course SIS → Canvas ID bulk resolver ---------------------------------
//
// The plural `courses(sisIds:)` field on Canvas GraphQL only returns
// courses the caller is enrolled in, so retention staff get zero hits.
// The singular `course(sisId:)` uses a more permissive loader and works
// for admin-like roles, so we fan that out with aliased queries per
// request (~50 courses per round-trip).
//
// Results go through the permanent canvasCourseIdCache so warm runs do
// zero network work.

/**
 * Resolves a list of ClassSectionIds (SIS course IDs) to Canvas numeric
 * course IDs. Reads from the permanent course ID cache first, resolves
 * misses via aliased GraphQL `course(sisId:)` queries in chunks of 50,
 * and writes the resolved pairs back to the cache.
 *
 * @param {string[]} sisCourseIds
 * @returns {Promise<Map<string, string>>} SIS ID → Canvas course ID
 */
export async function resolveCourseCanvasIds(sisCourseIds) {
    const result = new Map();
    if (!sisCourseIds || sisCourseIds.length === 0) return result;

    const unique = Array.from(new Set(sisCourseIds.map(String).filter(Boolean)));
    const misses = [];

    for (const sis of unique) {
        const cached = await getCachedCanvasCourseId(sis);
        if (cached != null) {
            result.set(sis, String(cached));
        } else {
            misses.push(sis);
        }
    }

    if (misses.length === 0) return result;

    // Try GraphQL first (cheap, one round-trip per 10 courses). Canvas's
    // course(sisId:) routes through a loader that may return null for
    // browser sessions lacking admin scope; for those misses we fall back
    // to REST per-course in parallel.
    const CHUNK = 10;
    const pairsToCache = [];
    const stillMissing = [];
    let loggedSample = false;

    for (let i = 0; i < misses.length; i += CHUNK) {
        const batch = misses.slice(i, i + CHUNK);
        const varDefs = batch.map((_, idx) => `$sis${idx}: String!`).join(', ');
        const fields = batch.map((_, idx) =>
            `  q${idx}: course(sisId: $sis${idx}) { _id sisId }`
        ).join('\n');
        const query = `query ResolveCourses(${varDefs}) {\n${fields}\n}`;
        const variables = {};
        batch.forEach((sis, idx) => { variables[`sis${idx}`] = sis; });

        try {
            const data = await graphqlRequest(query, variables);
            if (!loggedSample) {
                console.log('[GraphQL] course resolver sample response:', data);
                loggedSample = true;
            }
            if (data) {
                for (let idx = 0; idx < batch.length; idx++) {
                    const course = data[`q${idx}`];
                    const sis = batch[idx];
                    if (course && course.sisId && course._id) {
                        result.set(String(course.sisId), String(course._id));
                        pairsToCache.push([String(course.sisId), String(course._id)]);
                    } else {
                        stillMissing.push(sis);
                    }
                }
            } else {
                stillMissing.push(...batch);
            }
        } catch (e) {
            if (e && e.isCanvasAuth) throw e;
            console.warn(`[GraphQL] course alias batch failed: ${e.message}`);
            stillMissing.push(...batch);
        }
    }

    // REST fallback for anything GraphQL couldn't resolve. Parallelized so
    // this stays fast even when GraphQL gives us nothing.
    if (stillMissing.length > 0) {
        console.log(`[Course resolver] ${stillMissing.length} SIS IDs fell back to REST`);
        const CONCURRENCY = 20;
        for (let i = 0; i < stillMissing.length; i += CONCURRENCY) {
            const chunk = stillMissing.slice(i, i + CONCURRENCY);
            const responses = await Promise.all(chunk.map(sis =>
                fetch(`${CANVAS_DOMAIN}/api/v1/courses/sis_course_id:${encodeURIComponent(sis)}`, {
                    credentials: 'include',
                    headers: { 'Accept': 'application/json' }
                }).then(r => r.ok ? r.json() : null).catch(() => null)
            ));
            responses.forEach((course, idx) => {
                const sis = chunk[idx];
                if (course && course.id) {
                    result.set(String(sis), String(course.id));
                    pairsToCache.push([String(sis), String(course.id)]);
                }
            });
        }
    }

    if (pairsToCache.length > 0) {
        await setCachedCanvasCourseIds(pairsToCache);
    }

    return result;
}

// --- Step 3: per-course submissions + grades ------------------------------

const COURSE_DATA_QUERY = `
query CourseSubmissions($courseId: ID!, $submissionsCursor: String, $userCursor: String, $fetchSubs: Boolean!, $fetchUsers: Boolean!, $studentIds: [ID!]) {
  course(id: $courseId) {
    _id
    submissionsConnection(first: ${SUBMISSIONS_PAGE_SIZE}, after: $submissionsCursor,
      studentIds: $studentIds,
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
    // Pass Canvas user IDs to Canvas so submissionsConnection only returns
    // rows for our cohort instead of the whole course. For a course where
    // the roster is a small subset, this cuts submissions pagination from
    // many pages down to one or two.
    const studentIdArg = studentIds && studentIds.length > 0
        ? studentIds.map(id => String(id))
        : null;

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
            fetchUsers: hasMoreUsers,
            studentIds: studentIdArg
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
