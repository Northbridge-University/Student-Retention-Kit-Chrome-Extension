// Canvas GraphQL Integration - Alternate path for building the Master List.
//
// Canvas GraphQL requires:
//   - Session cookies (credentials: 'include')
//   - A matching X-CSRF-Token header (fetched from the _csrf_token cookie)
// Without the CSRF header, Canvas Rails rejects the POST with HTTP 422.

import { STORAGE_KEYS, CANVAS_DOMAIN } from '../constants/index.js';
import { storageGet, storageSet } from '../utils/storage.js';
import { isCanvasAuthError } from './modals/canvas-auth-modal.js';

const GRAPHQL_ENDPOINT = `${CANVAS_DOMAIN}/api/graphql`;
const SUBMISSIONS_PAGE_SIZE = 500;
const USERS_PAGE_SIZE = 100;

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
        // CSRF token may have rotated — clear the cache so the next call re-reads it.
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

// --- SIS → course cache ---------------------------------------------------

async function readSisCourseCache() {
    const data = await storageGet([STORAGE_KEYS.CANVAS_SIS_COURSE_CACHE]);
    return data[STORAGE_KEYS.CANVAS_SIS_COURSE_CACHE] || {};
}

async function writeSisCourseCacheEntry(syStudentId, entry) {
    const cache = await readSisCourseCache();
    cache[String(syStudentId)] = { ...entry, savedAt: new Date().toISOString() };
    await storageSet({ [STORAGE_KEYS.CANVAS_SIS_COURSE_CACHE]: cache });
}

async function resolveClassSectionIdViaRest(syStudentId) {
    const cache = await readSisCourseCache();
    const cached = cache[String(syStudentId)];
    if (cached && cached.ClassSectionId) return cached;

    const userUrl = `${CANVAS_DOMAIN}/api/v1/users/sis_user_id:${syStudentId}?include[]=enrollments`;
    const userResp = await fetch(userUrl, { credentials: 'include', headers: { 'Accept': 'application/json' } });
    if (!userResp.ok) return null;
    const user = await userResp.json();

    const coursesUrl = `${CANVAS_DOMAIN}/api/v1/users/${user.id}/courses?include[]=enrollments&per_page=100`;
    const coursesResp = await fetch(coursesUrl, { credentials: 'include', headers: { 'Accept': 'application/json' } });
    if (!coursesResp.ok) return null;
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

// --- Step 2: resolve student.url in one query per course ------------------

const COURSE_USERS_QUERY = `
query CourseUsersBySisId($sisId: String!) {
  course(sisId: $sisId) {
    _id
    name
    sisId
    usersConnection(first: ${USERS_PAGE_SIZE}, filter: { enrollmentTypes: [StudentEnrollment], enrollmentStates: [active] }) {
      nodes { _id sisId integrationId name email loginId }
    }
    enrollmentsConnection {
      nodes {
        type
        user { _id }
        grades { currentScore finalScore currentGrade }
      }
    }
  }
}`;

/**
 * Batch-resolves `url` and `grade` for every student that has a ClassSectionId.
 * Students are grouped by ClassSectionId, and one GraphQL query per group pulls
 * back the course + all enrolled users + their grades. Students without a
 * ClassSectionId fall through to resolveClassSectionIdViaRest().
 *
 * @param {Array} students - Student objects (mutated in place).
 * @returns {Promise<Array>} The same students, with url/grade populated where possible.
 */
export async function resolveStudentsViaGraphQL(students) {
    const byClassSection = new Map();
    const unresolved = [];

    for (const student of students) {
        const sis = student.ClassSectionId && String(student.ClassSectionId).trim();
        if (sis) {
            if (!byClassSection.has(sis)) byClassSection.set(sis, []);
            byClassSection.get(sis).push(student);
        } else {
            unresolved.push(student);
        }
    }

    console.log(`[GraphQL] Step 2: ${byClassSection.size} course(s), ${unresolved.length} unresolved`);

    let totalMatched = 0;
    let totalGroup = 0;
    let diagnosticLogged = false;
    for (const [sisCourseId, group] of byClassSection.entries()) {
        try {
            const data = await graphqlRequest(COURSE_USERS_QUERY, { sisId: sisCourseId });
            const course = data && data.course;
            if (!course) {
                console.warn(`[GraphQL] Course sisId=${sisCourseId} not found`);
                continue;
            }
            if (!diagnosticLogged) {
                const sample = (course.usersConnection && course.usersConnection.nodes) || [];
                console.log(`[GraphQL] Sample course ${sisCourseId}: ${sample.length} users returned, first:`, sample[0]);
                diagnosticLogged = true;
            }
            const matched = applyCourseDataToStudents(course, group);
            totalMatched += matched;
            totalGroup += group.length;
            if (matched === 0) {
                const sample = (course.usersConnection && course.usersConnection.nodes) || [];
                console.warn(`[GraphQL] Course ${sisCourseId}: matched 0/${group.length} students. Roster SyStudentIds: [${group.slice(0, 3).map(s => s.SyStudentId).join(', ')}]. Canvas nodes had sisId/email: [${sample.slice(0, 3).map(u => `${u.sisId}|${u.email}`).join(', ')}]`);
            }
        } catch (e) {
            if (e && e.isCanvasAuth) throw e;
            console.warn(`[GraphQL] Course ${sisCourseId} failed:`, e.message);
        }
    }
    console.log(`[GraphQL] Step 2 matched ${totalMatched}/${totalGroup} students across ${byClassSection.size} courses`);

    // Fallback: students without ClassSectionId resolve individually via REST,
    // which seeds student.ClassSectionId for next run and sets url/grade.
    for (const student of unresolved) {
        try {
            await resolveUnknownStudent(student);
        } catch (e) {
            console.warn(`[GraphQL] Fallback failed for ${student.SyStudentId}:`, e.message);
        }
    }

    return students;
}

function applyCourseDataToStudents(course, group) {
    const canvasCourseId = course._id;
    const users = (course.usersConnection && course.usersConnection.nodes) || [];

    const bySisId = new Map();
    const byIntegrationId = new Map();
    const byEmail = new Map();
    const byLoginId = new Map();
    for (const u of users) {
        if (u.sisId) bySisId.set(String(u.sisId), u);
        if (u.integrationId) byIntegrationId.set(String(u.integrationId), u);
        if (u.email) byEmail.set(String(u.email).toLowerCase(), u);
        if (u.loginId) byLoginId.set(String(u.loginId).toLowerCase(), u);
    }

    const gradesByUserId = new Map();
    for (const e of (course.enrollmentsConnection && course.enrollmentsConnection.nodes) || []) {
        if (e.user && e.user._id) gradesByUserId.set(String(e.user._id), e.grades || {});
    }

    let matched = 0;
    for (const student of group) {
        const syId = String(student.SyStudentId || '');
        const email = student.studentEmail ? String(student.studentEmail).toLowerCase() : '';

        const user =
            (syId && bySisId.get(syId)) ||
            (syId && byIntegrationId.get(syId)) ||
            (email && byEmail.get(email)) ||
            (email && byLoginId.get(email));
        if (!user) continue;

        matched++;
        student.url = `${CANVAS_DOMAIN}/courses/${canvasCourseId}/grades/${user._id}`;
        if (!student.name && user.name) student.name = user.name;

        const grades = gradesByUserId.get(String(user._id)) || {};
        if (grades.currentScore != null) {
            student.grade = `${grades.currentScore}%`;
        } else if (grades.finalScore != null) {
            student.grade = `${grades.finalScore}%`;
        } else if (grades.currentGrade != null) {
            student.grade = String(grades.currentGrade);
        }
    }
    return matched;
}

async function resolveUnknownStudent(student) {
    if (!student.SyStudentId) return;
    const resolved = await resolveClassSectionIdViaRest(student.SyStudentId);
    if (!resolved) return;
    if (resolved.ClassSectionId) student.ClassSectionId = resolved.ClassSectionId;
    if (resolved.canvasUserId && resolved.canvasCourseId) {
        student.url = `${CANVAS_DOMAIN}/courses/${resolved.canvasCourseId}/grades/${resolved.canvasUserId}`;
    }
}

/**
 * Single-student entry point preserved for existing call sites. Groups of one
 * student aren't useful, so this just wraps resolveStudentsViaGraphQL.
 */
export async function fetchCanvasDetailsGraphQL(student) {
    await resolveStudentsViaGraphQL([student]);
    return student;
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
