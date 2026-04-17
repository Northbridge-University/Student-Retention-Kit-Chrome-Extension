// Canvas GraphQL Integration - Alternate path for building the Master List.
//
// REST flow remains the default in canvas-api.js. When the user opts into
// GraphQL via the Canvas Settings modal, step orchestrators delegate their
// per-course data fetches to this module. GraphQL responses are mapped to
// the REST-compatible shapes that processCourseGroupResults already expects,
// so downstream analysis code stays untouched.

import { STORAGE_KEYS, CANVAS_DOMAIN } from '../constants/index.js';
import { storageGet, storageSet } from '../utils/storage.js';
import { isCanvasAuthError } from './modals/canvas-auth-modal.js';

const GRAPHQL_ENDPOINT = `${CANVAS_DOMAIN}/api/graphql`;
const SUBMISSIONS_PAGE_SIZE = 500; // Canvas caps at ~100, but we request more in case limits rise
const USERS_PAGE_SIZE = 100;

/**
 * Executes a GraphQL query against Canvas.
 * Returns the `data` field on success; throws on network or GraphQL errors.
 */
async function graphqlRequest(query, variables = {}) {
    const response = await fetch(GRAPHQL_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ query, variables })
    });

    if (isCanvasAuthError(response)) {
        const err = new Error('Canvas GraphQL auth error');
        err.response = response;
        err.isCanvasAuth = true;
        throw err;
    }

    if (!response.ok) {
        throw new Error(`Canvas GraphQL HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload.errors && payload.errors.length > 0) {
        const msg = payload.errors.map(e => e.message).join('; ');
        throw new Error(`Canvas GraphQL error: ${msg}`);
    }
    return payload.data;
}

// --- SIS → course cache ---------------------------------------------------
// Persisted in chrome.storage.local under STORAGE_KEYS.CANVAS_SIS_COURSE_CACHE
// Shape: { [SyStudentId]: { ClassSectionId, canvasUserId, canvasCourseId, savedAt } }

async function readSisCourseCache() {
    const data = await storageGet([STORAGE_KEYS.CANVAS_SIS_COURSE_CACHE]);
    return data[STORAGE_KEYS.CANVAS_SIS_COURSE_CACHE] || {};
}

async function writeSisCourseCacheEntry(syStudentId, entry) {
    const cache = await readSisCourseCache();
    cache[String(syStudentId)] = { ...entry, savedAt: new Date().toISOString() };
    await storageSet({ [STORAGE_KEYS.CANVAS_SIS_COURSE_CACHE]: cache });
}

/**
 * When a student row is missing ClassSectionId, resolve it via one REST call.
 * GraphQL does not expose a user(sisId:) lookup, so this fallback is unavoidable.
 * Once resolved, the mapping is cached so subsequent runs skip the hop.
 */
async function resolveClassSectionIdViaRest(syStudentId) {
    const cache = await readSisCourseCache();
    const cached = cache[String(syStudentId)];
    if (cached && cached.ClassSectionId) return cached;

    const userUrl = `${CANVAS_DOMAIN}/api/v1/users/sis_user_id:${syStudentId}?include[]=enrollments`;
    const userResp = await fetch(userUrl, { credentials: 'include', headers: { 'Accept': 'application/json' } });
    if (!userResp.ok) throw new Error(`Failed to resolve SIS user ${syStudentId}: ${userResp.status}`);
    const user = await userResp.json();

    const coursesUrl = `${CANVAS_DOMAIN}/api/v1/users/${user.id}/courses?include[]=enrollments&per_page=100`;
    const coursesResp = await fetch(coursesUrl, { credentials: 'include', headers: { 'Accept': 'application/json' } });
    if (!coursesResp.ok) throw new Error(`Failed to load courses for ${syStudentId}: ${coursesResp.status}`);
    const courses = await coursesResp.json();

    const activeCourse = pickActiveCourse(courses);
    if (!activeCourse) return null;

    const entry = {
        ClassSectionId: activeCourse.sis_course_id || null,
        canvasUserId: user.id,
        canvasCourseId: activeCourse.id
    };
    await writeSisCourseCacheEntry(syStudentId, entry);
    return entry;
}

function pickActiveCourse(courses) {
    if (!Array.isArray(courses) || courses.length === 0) return null;
    const now = new Date();
    const valid = courses.filter(c => c.name && !c.name.toUpperCase().includes('CAPV'));
    const active = valid.find(c => {
        const hasActive = c.enrollments && c.enrollments.some(e => e.enrollment_state === 'active');
        if (!hasActive) return false;
        if (!c.start_at || !c.end_at) return true;
        return now >= new Date(c.start_at) && now <= new Date(c.end_at);
    });
    if (active) return active;
    return valid.find(c => c.enrollments && c.enrollments.some(e => e.enrollment_state === 'active')) || valid[0];
}

// --- Step 2 replacement: resolve course + gradebook URL -------------------

const COURSE_BY_SIS_QUERY = `
query CourseBySisId($sisId: String!) {
  course(sisId: $sisId) {
    _id
    name
    sisId
    usersConnection(first: ${USERS_PAGE_SIZE}, filter: { enrollmentTypes: [StudentEnrollment], enrollmentStates: [active] }) {
      nodes {
        _id
        sisId
        name
      }
    }
  }
}`;

/**
 * GraphQL analog of fetchCanvasDetails. Populates student.url and student.grade
 * using ClassSectionId when available; falls back to REST to resolve missing
 * ClassSectionId values.
 *
 * @returns the same student object with canvas fields filled in.
 */
export async function fetchCanvasDetailsGraphQL(student) {
    if (!student.SyStudentId) return student;
    const syStudentId = String(student.SyStudentId);

    try {
        let sisCourseId = student.ClassSectionId || null;
        let canvasUserId = null;
        let canvasCourseId = null;

        if (!sisCourseId) {
            const resolved = await resolveClassSectionIdViaRest(syStudentId);
            if (resolved) {
                sisCourseId = resolved.ClassSectionId;
                canvasUserId = resolved.canvasUserId;
                canvasCourseId = resolved.canvasCourseId;
                if (sisCourseId) student.ClassSectionId = sisCourseId;
            }
        }

        if (sisCourseId) {
            const data = await graphqlRequest(COURSE_BY_SIS_QUERY, { sisId: sisCourseId });
            const course = data && data.course;
            if (course) {
                canvasCourseId = canvasCourseId || course._id;
                const match = course.usersConnection && course.usersConnection.nodes
                    ? course.usersConnection.nodes.find(u => u.sisId === syStudentId)
                    : null;
                if (match) {
                    canvasUserId = canvasUserId || match._id;
                    if (!student.name && match.name) student.name = match.name;
                }
            }
        }

        if (canvasUserId && canvasCourseId) {
            student.url = `${CANVAS_DOMAIN}/courses/${canvasCourseId}/grades/${canvasUserId}`;
        }
    } catch (e) {
        if (e && e.isCanvasAuth) throw e;
        console.warn(`[GraphQL] fetchCanvasDetails failed for ${student.SyStudentId}:`, e.message);
    }

    return student;
}

// --- Step 3 replacement: course-group submissions + grades ----------------

const COURSE_DATA_QUERY = `
query CourseSubmissions($courseId: ID!, $submissionsCursor: String, $userCursor: String) {
  course(id: $courseId) {
    _id
    submissionsConnection(first: ${SUBMISSIONS_PAGE_SIZE}, after: $submissionsCursor,
      filter: { states: [submitted, unsubmitted, graded, pending_review] }) {
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
    enrollmentsConnection(after: $userCursor) {
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

/**
 * GraphQL analog of fetchCourseGroupData. Paginates submissions/enrollments,
 * then maps each GraphQL node to the REST-compatible shape that
 * processCourseGroupResults expects, so downstream analysis is unchanged.
 *
 * @returns {{ submissionsData: Array, usersData: Array }}
 */
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
            submissionsCursor: hasMoreSubs ? submissionsCursor : null,
            userCursor: hasMoreUsers ? userCursor : null
        });
        const course = data && data.course;
        if (!course) break;

        if (hasMoreSubs) {
            const subPage = course.submissionsConnection || { nodes: [], pageInfo: {} };
            for (const node of (subPage.nodes || [])) {
                if (wanted.size > 0 && !wanted.has(String(node.userId))) continue;
                submissions.push(mapSubmission(node, origin, courseId));
            }
            hasMoreSubs = !!(subPage.pageInfo && subPage.pageInfo.hasNextPage);
            submissionsCursor = subPage.pageInfo ? subPage.pageInfo.endCursor : null;
        }

        if (hasMoreUsers) {
            const userPage = course.enrollmentsConnection || { nodes: [], pageInfo: {} };
            for (const node of (userPage.nodes || [])) {
                enrollments.push(node);
            }
            hasMoreUsers = !!(userPage.pageInfo && userPage.pageInfo.hasNextPage);
            userCursor = userPage.pageInfo ? userPage.pageInfo.endCursor : null;
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
    // Collapse enrollments to one record per user, preferring StudentEnrollment grades.
    const byUser = new Map();
    for (const enr of enrollments) {
        const userId = enr.user && enr.user._id ? parseInt(enr.user._id, 10) : null;
        if (!userId) continue;
        if (wanted.size > 0 && !wanted.has(String(userId))) continue;

        const grades = enr.grades || {};
        const current = grades.currentScore != null ? grades.currentScore : null;
        const final = grades.finalScore != null ? grades.finalScore : null;
        const currentGrade = grades.currentGrade || null;

        const existing = byUser.get(userId);
        if (!existing || enr.type === 'StudentEnrollment') {
            byUser.set(userId, {
                id: userId,
                enrollments: [{
                    type: enr.type || 'StudentEnrollment',
                    grades: {
                        current_score: current,
                        final_score: final,
                        current_grade: currentGrade
                    }
                }]
            });
        }
    }
    return Array.from(byUser.values());
}
