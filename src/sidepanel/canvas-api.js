// Canvas Integration - Handles all Canvas API calls for student data and assignments
//
// File structure:
//   1. Imports & Constants
//   2. Auth & Shutdown State
//   3. UI Helpers (step progress, formatting)
//   4. Canvas API Layer (fetch, pagination, auth error handling)
//   5. Data Analysis (missing assignments, next assignment, grade extraction)
//   6. Step Orchestrators (processStep2, processStep3, processStep4)

import { STORAGE_KEYS, CANVAS_DOMAIN, LEGACY_CANVAS_SUBDOMAINS, GENERIC_AVATAR_URL, CANVAS_API_TYPES, normalizeCanvasUrl } from '../constants/index.js';
import { numericToLetterGrade } from '../constants/field-utils.js';
import { getCachedData, getCache, stageCacheData, flushPendingCacheWrites } from '../utils/canvasCache.js';
import { openCanvasAuthErrorModal, isCanvasAuthError } from './modals/canvas-auth-modal.js';
import { ensureCanvasLogin } from './modals/canvas-login-modal.js';
import { storageGet } from '../utils/storage.js';
import { updateStepIcon } from '../utils/ui-helpers.js';
import { isUpdateCancelled, setUpdateButtonsDisabled } from './file-handler.js';
import { fetchCourseGroupDataGraphQL } from './canvas-graphql.js';
import { getCachedCanvasUserId, setCachedCanvasUserId, clearCachedCanvasUserId } from '../utils/canvasUserIdCache.js';

// Custom error for cancelled updates
class UpdateCancelledError extends Error {
    constructor() { super('Update cancelled by user'); this.name = 'UpdateCancelledError'; }
}

// ============================================================================
// 2. AUTH & SHUTDOWN STATE + DOMAIN FALLBACK
// ============================================================================

let authErrorShownInSession = false;
let shutdownRequested = false;

// Domain fallback state — handles branding transition issues
const FALLBACK_DOMAIN = LEGACY_CANVAS_SUBDOMAINS.length > 0
    ? `https://${LEGACY_CANVAS_SUBDOMAINS[0]}.instructure.com`
    : null;
const FALLBACK_THRESHOLD = 5;
let domainFallbackCount = 0;
let useFallbackDomain = false;

/** Returns the current Canvas domain, using fallback if activated. */
function getCanvasDomain() {
    return (useFallbackDomain && FALLBACK_DOMAIN) ? FALLBACK_DOMAIN : CANVAS_DOMAIN;
}

/**
 * Fetches a Canvas API URL with automatic legacy domain fallback.
 * If the primary domain fails with a non-auth error, retries with the legacy domain.
 * After FALLBACK_THRESHOLD consecutive fallbacks, locks to the legacy domain.
 */
async function fetchWithFallback(url, options = {}) {
    const response = await fetch(url, options);

    if (response.ok || isCanvasAuthError(response) || !FALLBACK_DOMAIN) {
        if (response.ok) domainFallbackCount = 0;
        return response;
    }

    // Primary domain failed — try legacy domain
    const fallbackUrl = url.replace(CANVAS_DOMAIN, FALLBACK_DOMAIN);
    if (fallbackUrl === url) return response; // URL doesn't use primary domain

    console.warn(`[Canvas] Primary domain failed (${response.status}), trying legacy: ${FALLBACK_DOMAIN}`);
    const fallbackResp = await fetch(fallbackUrl, options);

    if (fallbackResp.ok) {
        domainFallbackCount++;
        if (domainFallbackCount >= FALLBACK_THRESHOLD && !useFallbackDomain) {
            useFallbackDomain = true;
            console.warn(`[Canvas] ${FALLBACK_THRESHOLD} consecutive fallbacks — using ${FALLBACK_DOMAIN} for remaining requests`);
        }
        return fallbackResp;
    }

    return response; // Both failed, return original error
}

/** Resets auth error state and domain fallback — call when starting a new pipeline run. */
export function resetAuthErrorState() {
    authErrorShownInSession = false;
    shutdownRequested = false;
    domainFallbackCount = 0;
    useFallbackDomain = false;
}

/** @returns {boolean} True if the user requested shutdown via the auth error modal. */
export function isShutdownRequested() {
    return shutdownRequested;
}

/** Custom error thrown when the user clicks "Shutdown" in the auth error modal. */
export class CanvasAuthShutdownError extends Error {
    constructor() {
        super('Canvas authentication shutdown requested by user');
        this.name = 'CanvasAuthShutdownError';
    }
}

/** Custom error thrown when the user clicks "Retry" in the auth error modal. */
class CanvasAuthRetryError extends Error {
    constructor() {
        super('Canvas authentication retry requested by user');
        this.name = 'CanvasAuthRetryError';
    }
}

/** Throws CanvasAuthShutdownError if the user previously requested shutdown. */
function checkShutdown() {
    if (shutdownRequested) {
        throw new CanvasAuthShutdownError();
    }
}

/**
 * Shows the auth error modal (once per session) and returns the user's choice.
 * Throws CanvasAuthShutdownError on shutdown, CanvasAuthRetryError on retry.
 * @param {string} context - What was being fetched when the error occurred (for logging).
 */
async function handleCanvasAuthError(context) {
    console.warn(`[Canvas] Authorization error during ${context}`);

    if (shutdownRequested) throw new CanvasAuthShutdownError();
    if (authErrorShownInSession) throw new CanvasAuthRetryError();

    authErrorShownInSession = true;
    const choice = await openCanvasAuthErrorModal();
    authErrorShownInSession = false;

    if (choice === 'shutdown') {
        shutdownRequested = true;
        throw new CanvasAuthShutdownError();
    }
    // 'retry' — throw retry error so the step restarts
    throw new CanvasAuthRetryError();
}


// ============================================================================
// 3. UI HELPERS
// ============================================================================

/**
 * Formats a duration in seconds to a human-readable string.
 * Shows minutes when >= 60s, otherwise seconds with one decimal.
 */
export function formatDuration(seconds) {
    if (seconds >= 60) {
        return `${(seconds / 60).toFixed(1)}m`;
    }
    return `${seconds.toFixed(1)}s`;
}

/** Updates the "Total Time" display at the bottom of the step queue. */
export function updateTotalTime() {
    const el = document.getElementById('queueTotalTime');
    if (el && el.dataset.processStartTime) {
        const totalSeconds = (Date.now() - parseInt(el.dataset.processStartTime)) / 1000;
        el.textContent = `Total Time: ${formatDuration(totalSeconds)}`;
        el.style.display = 'block';
    }
}

/**
 * Wraps a step's async work with consistent UI state management.
 * Handles the active/spinner → completed/check or error/red transitions
 * so each processStepN doesn't need to repeat the boilerplate.
 *
 * @param {string} stepId - DOM element ID (e.g. 'step2', 'step3')
 * @param {function} work - Async function that receives { timeSpan, startTime } and returns a result
 * @returns {Promise<*>} The result of work()
 */
async function withStepUI(stepId, work, options = {}) {
    // Check if the update was cancelled before starting this step
    if (isUpdateCancelled()) {
        throw new UpdateCancelledError();
    }

    const { final = true } = options;

    const stepEl = document.getElementById(stepId);
    const timeSpan = stepEl.querySelector('.step-time');

    stepEl.className = 'queue-item active';
    updateStepIcon(stepEl, 'spinner');

    // Re-use an in-flight startTime when successive phases share the same
    // step element (e.g. Step 2+3+4 all map to the 'Fetch Canvas Data' row).
    const existingStart = stepEl.dataset.startTime;
    const startTime = existingStart ? parseInt(existingStart, 10) : Date.now();
    if (!existingStart) stepEl.dataset.startTime = String(startTime);

    try {
        const result = await work({ timeSpan, startTime });

        if (final) {
            const durationSeconds = (Date.now() - startTime) / 1000;
            stepEl.className = 'queue-item completed';
            updateStepIcon(stepEl, 'check');
            timeSpan.textContent = formatDuration(durationSeconds);
            delete stepEl.dataset.startTime;
            updateTotalTime();
        }

        return result;
    } catch (error) {
        delete stepEl.dataset.startTime;

        if (error instanceof UpdateCancelledError) {
            console.log(`[${stepId}] Cancelled by user`);
            setUpdateButtonsDisabled(false);
            throw error;
        }

        if (error instanceof CanvasAuthShutdownError) {
            console.log(`[${stepId}] Stopped by user due to Canvas auth error`);
            updateStepIcon(stepEl, 'error');
            stepEl.style.color = '#ef4444';
            timeSpan.textContent = 'Stopped by user';
            setUpdateButtonsDisabled(false);
            throw error;
        }

        if (error instanceof CanvasAuthRetryError) {
            console.log(`[${stepId}] Retrying after Canvas auth error`);
            timeSpan.textContent = 'Retrying...';
            throw error;
        }

        console.error(`[${stepId} Error]`, error);
        updateStepIcon(stepEl, 'error');
        stepEl.style.color = '#ef4444';
        timeSpan.textContent = 'Error';
        setUpdateButtonsDisabled(false);
        throw error;
    }
}

/** Preloads an image for faster rendering when the student list is displayed. */
function preloadImage(url) {
    if (!url) return;
    const img = new Image();
    img.src = url;
}


// ============================================================================
// 4. CANVAS API LAYER
// ============================================================================

/**
 * Parses a Canvas gradebook URL into its component parts.
 * @param {string} url - e.g. "https://northbridge.instructure.com/courses/123/grades/456"
 * @returns {{ origin: string, courseId: string, studentId: string } | null}
 */
function parseGradebookUrl(url) {
    try {
        const normalizedUrl = normalizeCanvasUrl(url);
        const urlObj = new URL(normalizedUrl);
        const match = urlObj.pathname.match(/courses\/(\d+)\/grades\/(\d+)/);
        if (match) {
            return { origin: urlObj.origin, courseId: match[1], studentId: match[2] };
        }
    } catch (e) {
        console.warn('Invalid gradebook URL:', url);
    }
    return null;
}

/**
 * Fetches paginated data from the Canvas API, following `rel="next"` Link headers.
 * Accumulates all pages into a single array.
 *
 * @param {string} url - The initial API endpoint URL
 * @param {Array} items - Accumulated items from previous pages (used in recursion)
 * @returns {Promise<Array>} All items across all pages
 */
async function fetchPaged(url, items = []) {
    checkShutdown();

    const headers = {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
    };

    try {
        const response = await fetch(url, { method: 'GET', credentials: 'include', headers });

        if (isCanvasAuthError(response)) {
            await handleCanvasAuthError('fetching paged data');
        }

        if (!response.ok) {
            if (items.length > 0) return items;
            throw new Error(`HTTP ${response.status}`);
        }

        const newItems = await response.json();
        const allItems = items.concat(newItems);

        const nextUrl = getNextPageUrl(response.headers.get('Link'));
        if (nextUrl) {
            return fetchPaged(nextUrl, allItems);
        }
        return allItems;
    } catch (e) {
        if (e instanceof CanvasAuthShutdownError || e instanceof CanvasAuthRetryError) throw e;
        console.warn('Fetch error:', e);
        return items;
    }
}

/** Extracts the `rel="next"` URL from a Canvas Link header. */
function getNextPageUrl(linkHeader) {
    if (!linkHeader) return null;
    const nextLink = linkHeader.split(',').find(link => link.includes('rel="next"'));
    if (!nextLink) return null;
    const match = nextLink.match(/<([^>]+)>/);
    return match ? match[1] : null;
}

/**
 * Fetches courses by scraping the Canvas user profile HTML page.
 * This is a workaround for when the user lacks API permissions.
 *
 * @param {number|string} canvasUserId - The Canvas user ID
 * @returns {Promise<Array>} Array of course objects matching the API shape
 */
async function fetchCoursesFromHtml(canvasUserId) {
    const profileUrl = `${getCanvasDomain()}/users/${canvasUserId}`;
    console.log(`[Non-API] Fetching courses from HTML: ${profileUrl}`);

    try {
        const response = await fetchWithFallback(profileUrl, {
            headers: { 'Accept': 'text/html' },
            credentials: 'include'
        });

        if (!response.ok) {
            console.warn(`[Non-API] Failed to fetch user profile page: ${response.status}`);
            return [];
        }

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const coursesList = doc.querySelector('#courses_list ul.context_list');
        if (!coursesList) {
            console.warn('[Non-API] Could not find courses list in HTML');
            return [];
        }

        const courses = [];
        coursesList.querySelectorAll('li').forEach(li => {
            const link = li.querySelector('a');
            if (!link) return;

            const href = link.getAttribute('href');
            const match = href.match(/\/courses\/(\d+)\/users\/(\d+)/);
            if (!match) return;

            const courseId = parseInt(match[1], 10);
            const nameSpan = link.querySelector('span.name');
            const courseName = nameSpan ? (nameSpan.getAttribute('title') || nameSpan.textContent.trim()) : '';

            const subtitles = link.querySelectorAll('span.subtitle');
            const termInfo = subtitles.length >= 1 ? subtitles[0].textContent.trim() : '';
            const enrollmentStatus = subtitles.length >= 2 ? subtitles[1].textContent.trim() : '';

            const isActive = li.classList.contains('active') || enrollmentStatus.toLowerCase().includes('active');
            const isCompleted = li.classList.contains('inactive') || enrollmentStatus.toLowerCase().includes('completed');

            // Extract start date from term info like "FTC 2026 01C January (1/12/2026)"
            let startDate = null;
            let endDate = null;
            const dateMatch = termInfo.match(/\((\d{1,2})\/(\d{1,2})\/(\d{4})\)/);
            if (dateMatch) {
                const month = parseInt(dateMatch[1], 10);
                const day = parseInt(dateMatch[2], 10);
                const year = parseInt(dateMatch[3], 10);
                startDate = new Date(year, month - 1, day);
                endDate = new Date(startDate);
                endDate.setDate(endDate.getDate() + 35); // ~5 week course estimate
            }

            courses.push({
                id: courseId,
                name: courseName,
                start_at: startDate ? startDate.toISOString() : null,
                end_at: endDate ? endDate.toISOString() : null,
                workflow_state: isActive ? 'available' : (isCompleted ? 'completed' : 'unpublished'),
                enrollments: [{
                    type: 'StudentEnrollment',
                    enrollment_state: isActive ? 'active' : (isCompleted ? 'completed' : 'invited'),
                    grades: {}
                }]
            });
        });

        console.log(`[Non-API] Extracted ${courses.length} course(s) from HTML`);
        return courses;
    } catch (error) {
        console.error('[Non-API] Error fetching courses from HTML:', error);
        return [];
    }
}

/**
 * Fetches submissions and user/enrollment data for a group of students in the same course
 * using a single pair of batch API calls (multi-student query params).
 *
 * This is dramatically more efficient than per-student calls when multiple students
 * share the same course — e.g. 50 students in one course = 2 API calls instead of 100.
 *
 * @param {string} origin - The Canvas domain origin
 * @param {string} courseId - The course ID
 * @param {Array<string>} studentIds - Canvas student IDs to fetch for this course
 * @returns {Promise<{ submissionsData: Array, usersData: Array }>}
 */
async function fetchCourseGroupData(origin, courseId, studentIds) {
    checkShutdown();

    const idsQuery = studentIds.map(id => `student_ids[]=${id}`).join('&');
    const userIdsQuery = studentIds.map(id => `user_ids[]=${id}`).join('&');

    const submissionsUrl = `${origin}/api/v1/courses/${courseId}/students/submissions?${idsQuery}&include[]=assignment&per_page=100`;
    const usersUrl = `${origin}/api/v1/courses/${courseId}/users?${userIdsQuery}&include[]=enrollments&per_page=100`;

    const [submissionsData, usersData] = await Promise.all([
        fetchPaged(submissionsUrl),
        fetchPaged(usersUrl)
    ]);

    return { submissionsData, usersData };
}


// ============================================================================
// 5. DATA ANALYSIS
// ============================================================================

/**
 * Extracts the current grade from a Canvas user object's enrollment data.
 * Tries current_score → final_score → current_grade in order.
 *
 * @param {Object|null} userObject - Canvas user object with enrollments
 * @returns {string|number} The grade value, or empty string if unavailable
 */
function extractCurrentGrade(userObject) {
    if (!userObject || !userObject.enrollments) return '';

    const enrollment = userObject.enrollments.find(e => e.type === 'StudentEnrollment')
        || userObject.enrollments[0];

    if (!enrollment || !enrollment.grades) return '';

    const { current_score, final_score, current_grade } = enrollment.grades;
    if (current_score != null) return current_score;
    if (final_score != null) return final_score;
    if (current_grade != null) return String(current_grade).replace(/%/g, '');
    return '';
}

/**
 * Analyzes a student's submissions to find missing assignments.
 *
 * An assignment is considered "missing" if:
 *  - Canvas explicitly flags it as `missing: true`, OR
 *  - It's unsubmitted and past due, OR
 *  - It has a score of 0
 *
 * @param {Array} submissions - Raw submission objects from Canvas API
 * @param {Object|null} userObject - Canvas user object (for grade extraction)
 * @param {string} studentName - For logging
 * @param {string} courseId - Course ID (for building assignment URLs)
 * @param {string} origin - Canvas domain origin
 * @param {Date} referenceDate - "Today" for due-date comparisons
 * @returns {{ currentGrade: string|number, count: number, assignments: Array }}
 */
function analyzeMissingAssignments(submissions, userObject, studentName, courseId, origin, referenceDate = new Date()) {
    const now = referenceDate;
    const currentGrade = extractCurrentGrade(userObject);
    const collectedAssignments = [];

    for (const sub of submissions) {
        const dueDate = sub.cached_due_date ? new Date(sub.cached_due_date) : null;

        // Skip future assignments
        if (dueDate && dueDate > now) continue;

        // Skip completed assignments
        const scoreStr = String(sub.score || sub.grade || '').toLowerCase();
        if (scoreStr === 'complete') continue;

        const isMissing = (sub.missing === true) ||
            ((sub.workflow_state === 'unsubmitted' || sub.workflow_state === 'unsubmitted (ungraded)') && dueDate && dueDate < now) ||
            (sub.score === 0);

        if (!isMissing) continue;

        const assignmentId = sub.assignment ? sub.assignment.id : null;
        const assignmentUrl = assignmentId ? `${origin}/courses/${courseId}/assignments/${assignmentId}` : '';

        let formattedScore = '-';
        if (sub.score !== null && sub.assignment && sub.assignment.points_possible !== null) {
            formattedScore = `${sub.score}/${sub.assignment.points_possible}`;
        } else if (sub.grade) {
            formattedScore = sub.grade;
        }

        collectedAssignments.push({
            assignmentTitle: sub.assignment ? sub.assignment.name : 'Unknown Assignment',
            submissionLink: sub.preview_url || '',
            assignmentLink: assignmentUrl,
            dueDate: dueDate ? dueDate.toLocaleDateString() : 'No Date',
            score: formattedScore,
            workflow_state: sub.workflow_state
        });
    }

    return { currentGrade, count: collectedAssignments.length, assignments: collectedAssignments };
}

/**
 * Finds the next upcoming unsubmitted assignment for a student.
 *
 * @param {Array} submissions - Raw submission objects from Canvas API
 * @param {string} courseId - Course ID (for building assignment URLs)
 * @param {string} origin - Canvas domain origin
 * @param {Date} referenceDate - "Today" for due-date comparisons
 * @returns {Object|null} { Assignment, DueDate, AssignmentLink } or null if none found
 */
function findNextAssignment(submissions, courseId, origin, referenceDate = new Date()) {
    const todayStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
    const tomorrow = new Date(todayStart);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const upcomingAssignments = [];

    for (const sub of submissions) {
        if (!sub.assignment) continue;

        const dueDate = sub.assignment.due_at ? new Date(sub.assignment.due_at) : null;
        if (!dueDate || dueDate < todayStart) continue;

        // Check if already submitted or completed
        const submittedStates = ['submitted', 'graded', 'pending_review'];
        const isSubmitted = submittedStates.includes(sub.workflow_state)
            || (sub.submitted_at != null && sub.submitted_at !== '')
            || (sub.score != null && sub.score > 0);

        const scoreStr = String(sub.score || sub.grade || '').toLowerCase();
        if (isSubmitted || scoreStr === 'complete') continue;

        // Format due date label
        const dueDateStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
        let formattedDueDate;
        if (dueDateStart.getTime() === todayStart.getTime()) {
            formattedDueDate = 'Today';
        } else if (dueDateStart.getTime() === tomorrow.getTime()) {
            formattedDueDate = 'Tomorrow';
        } else {
            formattedDueDate = dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }

        const assignmentId = sub.assignment.id;
        upcomingAssignments.push({
            Assignment: sub.assignment.name || 'Unknown Assignment',
            DueDate: formattedDueDate,
            AssignmentLink: assignmentId ? `${origin}/courses/${courseId}/assignments/${assignmentId}` : '',
            _dueDateObj: dueDate
        });
    }

    if (upcomingAssignments.length === 0) return null;

    // Return the nearest-due assignment
    upcomingAssignments.sort((a, b) => a._dueDateObj - b._dueDateObj);
    const next = upcomingAssignments[0];
    delete next._dueDateObj;
    return next;
}

/**
 * Splits a combined course-group API response into per-student analysis results.
 *
 * After fetchCourseGroupData fetches submissions/users for all students in a course,
 * this function filters the combined response by user_id and runs the analysis
 * for each student individually.
 *
 * @param {Array} studentsInCourse - [{ student, parsed, originalIndex }]
 * @param {{ submissionsData: Array, usersData: Array }} courseGroupData
 * @param {Date} referenceDate
 * @param {boolean} includeNextAssignment
 * @returns {Array} Updated student objects with missingCount, missingAssignments, etc.
 */
function processCourseGroupResults(studentsInCourse, courseGroupData, referenceDate, includeNextAssignment) {
    const { submissionsData, usersData } = courseGroupData;

    return studentsInCourse.map(({ student, parsed }) => {
        const canvasStudentId = parseInt(parsed.studentId, 10);
        const { origin, courseId } = parsed;

        const studentSubmissions = submissionsData
            ? submissionsData.filter(sub => sub.user_id === canvasStudentId)
            : [];
        const userObject = usersData
            ? usersData.find(u => u.id === canvasStudentId)
            : null;

        const result = analyzeMissingAssignments(
            studentSubmissions, userObject, student.name, courseId, origin, referenceDate
        );

        let nextAssignment = null;
        if (includeNextAssignment) {
            nextAssignment = findNextAssignment(studentSubmissions, courseId, origin, referenceDate);
        }

        return {
            ...student,
            missingCount: result.count,
            missingAssignments: result.assignments,
            currentGrade: result.currentGrade,
            letterGrade: numericToLetterGrade(result.currentGrade),
            nextAssignment
        };
    });
}


// ============================================================================
// 6. STEP ORCHESTRATORS
// ============================================================================

/**
 * Loads all settings needed by Step 2 and Step 3 from Chrome storage.
 * Called once at the start of processStep2 to avoid per-student storage reads.
 *
 * @returns {Promise<{ cacheEnabled: boolean, useNonApiFetch: boolean, courseReferenceDate: Date }>}
 */
async function loadPipelineSettings() {
    const [cacheSettings, nonApiSettings, timeMachineSettings, apiTypeSettings] = await Promise.all([
        chrome.storage.local.get([STORAGE_KEYS.CANVAS_CACHE_ENABLED]),
        storageGet([STORAGE_KEYS.NON_API_COURSE_FETCH]),
        chrome.storage.local.get([STORAGE_KEYS.USE_SPECIFIC_DATE, STORAGE_KEYS.SPECIFIC_SUBMISSION_DATE]),
        storageGet([STORAGE_KEYS.CANVAS_API_TYPE])
    ]);

    const cacheEnabled = cacheSettings[STORAGE_KEYS.CANVAS_CACHE_ENABLED] !== undefined
        ? cacheSettings[STORAGE_KEYS.CANVAS_CACHE_ENABLED]
        : true;
    const useNonApiFetch = nonApiSettings[STORAGE_KEYS.NON_API_COURSE_FETCH] !== undefined ? nonApiSettings[STORAGE_KEYS.NON_API_COURSE_FETCH] : true;
    const apiType = apiTypeSettings[STORAGE_KEYS.CANVAS_API_TYPE] === CANVAS_API_TYPES.GRAPHQL
        ? CANVAS_API_TYPES.GRAPHQL
        : CANVAS_API_TYPES.REST;

    const useSpecificDate = timeMachineSettings[STORAGE_KEYS.USE_SPECIFIC_DATE] || false;
    const specificDateStr = timeMachineSettings[STORAGE_KEYS.SPECIFIC_SUBMISSION_DATE];

    let courseReferenceDate;
    if (useSpecificDate && specificDateStr) {
        const [year, month, day] = specificDateStr.split('-').map(Number);
        courseReferenceDate = new Date(year, month - 1, day);
        console.log(`[Settings] Time Machine mode: ${specificDateStr}`);
    } else {
        courseReferenceDate = new Date();
    }

    console.log(`[Settings] Cache: ${cacheEnabled}, Non-API: ${useNonApiFetch}, API Type: ${apiType}`);

    return { cacheEnabled, useNonApiFetch, courseReferenceDate, apiType };
}

/**
 * Fetches Canvas profile + courses for a single student.
 * Called by processStep2's batch loops. Reads from cache when possible,
 * otherwise makes API calls and stages the result for batched cache writes.
 *
 * @param {Object} student - Student object (mutated with Canvas data)
 * @param {boolean} cacheEnabled
 * @param {boolean} useNonApiFetch
 * @param {Date} courseReferenceDate - Pre-computed reference date for active course selection
 * @returns {Promise<Object>} The updated student object
 */
export async function fetchCanvasDetails(student, cacheEnabled = true, useNonApiFetch = false, courseReferenceDate = null) {
    checkShutdown();

    if (!student.SyStudentId) return student;

    try {
        const syStudentId = String(student.SyStudentId);

        // --- Resolve user data + courses (cache or API) ---
        const cachedData = (cacheEnabled && !useNonApiFetch) ? await getCachedData(syStudentId) : null;

        let userData;
        let courses;

        if (cachedData) {
            userData = cachedData.userData;
            courses = cachedData.courses;
        } else {
            // Prefer a permanently cached Canvas user ID; falls back to the
            // SIS lookup and invalidates the cache on 404.
            const cachedCanvasId = await getCachedCanvasUserId(syStudentId);
            let userResp = null;
            if (cachedCanvasId) {
                const directUrl = `${getCanvasDomain()}/api/v1/users/${cachedCanvasId}`;
                userResp = await fetchWithFallback(directUrl, { headers: { 'Accept': 'application/json' } });
                if (isCanvasAuthError(userResp)) {
                    await handleCanvasAuthError('fetching user data');
                }
                if (userResp.status === 404) {
                    await clearCachedCanvasUserId(syStudentId);
                    userResp = null;
                }
            }
            if (!userResp) {
                const userUrl = `${getCanvasDomain()}/api/v1/users/sis_user_id:${student.SyStudentId}`;
                userResp = await fetchWithFallback(userUrl, { headers: { 'Accept': 'application/json' } });
                if (isCanvasAuthError(userResp)) {
                    await handleCanvasAuthError('fetching user data');
                }
            }
            if (!userResp.ok) {
                console.warn(`Failed to fetch user data for ${student.SyStudentId}: ${userResp.status}`);
                return student;
            }
            userData = await userResp.json();
            if (userData && userData.id) {
                await setCachedCanvasUserId(syStudentId, userData.id);
            }

            // Fetch courses (API or HTML scraping)
            const canvasUserId = userData.id;
            if (canvasUserId) {
                if (useNonApiFetch) {
                    courses = await fetchCoursesFromHtml(canvasUserId);
                } else {
                    const coursesUrl = `${getCanvasDomain()}/api/v1/users/${canvasUserId}/courses?include[]=enrollments&per_page=100`;
                    const coursesResp = await fetchWithFallback(coursesUrl, { headers: { 'Accept': 'application/json' } });

                    if (isCanvasAuthError(coursesResp)) {
                        await handleCanvasAuthError('fetching courses');
                    } else if (coursesResp.ok) {
                        courses = await coursesResp.json();
                    } else {
                        console.warn(`Failed to fetch courses for ${student.SyStudentId}: ${coursesResp.status}`);
                        courses = [];
                    }
                }

                if (cacheEnabled) {
                    stageCacheData(syStudentId, userData, courses);
                }
            }
        }

        // --- Apply user data to student object ---
        if (userData.name) student.name = userData.name;
        if (userData.sortable_name) student.sortable_name = userData.sortable_name;

        if (userData.avatar_url && userData.avatar_url !== GENERIC_AVATAR_URL) {
            student.Photo = userData.avatar_url;
            preloadImage(userData.avatar_url);
        }

        if (userData.created_at) {
            student.created_at = userData.created_at;
            const daysSinceCreation = (new Date() - new Date(userData.created_at)) / (1000 * 3600 * 24);
            if (daysSinceCreation < 60) {
                student.isNew = true;
            }
        }

        // --- Find active course and set gradebook URL ---
        const canvasUserId = userData.id;
        if (canvasUserId && courses && courses.length > 0) {
            const now = courseReferenceDate || new Date();
            const validCourses = courses.filter(c => c.name && !c.name.toUpperCase().includes('CAPV'));

            // Priority 1: Active enrollment + in date range
            let activeCourse = validCourses.find(c => {
                const hasActive = c.enrollments && c.enrollments.some(e => e.enrollment_state === 'active');
                if (!hasActive) return false;
                if (!c.start_at || !c.end_at) return true; // active enrollment without dates — trust it
                const start = new Date(c.start_at);
                const end = new Date(c.end_at);
                return now >= start && now <= end;
            });

            // Priority 2: Active enrollment (any dates)
            if (!activeCourse) {
                activeCourse = validCourses.find(c =>
                    c.enrollments && c.enrollments.some(e => e.enrollment_state === 'active')
                );
            }

            // Priority 3: In date range (any enrollment state)
            if (!activeCourse) {
                activeCourse = validCourses.find(c => {
                    if (!c.start_at || !c.end_at) return false;
                    const start = new Date(c.start_at);
                    const end = new Date(c.end_at);
                    return now >= start && now <= end;
                });
            }

            // Priority 4: Most recently started course
            if (!activeCourse && validCourses.length > 0) {
                validCourses.sort((a, b) => {
                    const dateA = a.start_at ? new Date(a.start_at) : new Date(0);
                    const dateB = b.start_at ? new Date(b.start_at) : new Date(0);
                    return dateB - dateA;
                });
                activeCourse = validCourses[0];
            }

            if (activeCourse) {
                student.url = `${getCanvasDomain()}/courses/${activeCourse.id}/grades/${canvasUserId}`;

                if (activeCourse.enrollments && activeCourse.enrollments.length > 0) {
                    const enrollment = activeCourse.enrollments.find(e => e.type === 'StudentEnrollment') || activeCourse.enrollments[0];
                    if (enrollment && enrollment.grades && enrollment.grades.current_score) {
                        student.grade = enrollment.grades.current_score + '%';
                    }
                }
            } else {
                console.warn(`${student.name}: No courses found, Step 3 will be skipped`);
                student.url = null;
            }
        }

        return student;
    } catch (e) {
        console.error(`Error fetching Canvas details for ${student.SyStudentId}:`, e);
        return student;
    }
}

/**
 * Processes an array of students in batches using Promise.allSettled.
 * Shared by processStep2's cached and uncached loops.
 *
 * @param {Object} options
 * @param {Array} options.students - Students to process in this group
 * @param {Array} options.updatedStudents - The full results array (mutated in place)
 * @param {Map} options.studentIndexMap - Maps student object → index in updatedStudents
 * @param {function} options.processFn - Async function to call for each student
 * @param {number} options.batchSize - Students per batch
 * @param {number} options.delayMs - Milliseconds to wait between batches (0 = no delay)
 * @param {function} options.onProgress - Called with (processedSoFar) after each batch
 * @param {boolean} options.flushCache - Whether to flush staged cache writes after each batch
 */
async function processBatches({ students, updatedStudents, studentIndexMap, processFn, batchSize, delayMs, onProgress, flushCache }) {
    for (let i = 0; i < students.length; i += batchSize) {
        checkShutdown();

        const batch = students.slice(i, i + batchSize);
        const settledResults = await Promise.allSettled(batch.map(processFn));

        // Propagate shutdown/retry errors
        for (const result of settledResults) {
            if (result.status === 'rejected' && (result.reason instanceof CanvasAuthShutdownError || result.reason instanceof CanvasAuthRetryError)) {
                throw result.reason;
            }
        }

        // Write results back to the shared updatedStudents array
        settledResults.forEach((result, batchIndex) => {
            const originalStudent = batch[batchIndex];
            const originalIndex = studentIndexMap.get(originalStudent);
            updatedStudents[originalIndex] = result.status === 'fulfilled' ? result.value : originalStudent;
        });

        if (flushCache) {
            await flushPendingCacheWrites();
        }

        if (onProgress) {
            onProgress(Math.min(i + batchSize, students.length));
        }

        if (delayMs > 0 && i + batchSize < students.length) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}


// -- Step 2: Fetch Canvas Details (user profile, courses, photos) -----------

/**
 * Process Step 2: Fetch Canvas IDs, courses, and photos for all students.
 *
 * Optimization: Uses reverse cache lookup to separate cached vs uncached students,
 * processes cached students first (fast, no API calls), then uncached students
 * with batched API calls and batched cache writes.
 */
export async function processStep2(students, renderCallback) {
    while (true) {
        resetAuthErrorState();
        try {
            return await _processStep2(students, renderCallback);
        } catch (e) {
            if (e instanceof CanvasAuthRetryError) {
                console.log('[Step 2] Retrying with updated settings...');
                continue;
            }
            throw e;
        }
    }
}

async function _processStep2(students, renderCallback) {
    const updatedStudents = await withStepUI('step2', async ({ timeSpan }) => {
        // Pre-check: ensure user is logged into Canvas before making any API calls
        await ensureCanvasLogin(getCanvasDomain());

        console.log(`[Step 2] Pinging Canvas API: ${getCanvasDomain()}`);

        const { cacheEnabled, useNonApiFetch, courseReferenceDate, apiType } = await loadPipelineSettings();

        // Note: Step 2 always uses REST regardless of apiType. Canvas GraphQL
        // redacts sisId/email/loginId for sessions without :read_sis, so there
        // is no reliable way to map SyStudentId → canvasUserId in GraphQL under
        // a normal browser session. REST /users/sis_user_id:{id} works
        // regardless of admin scope. GraphQL is still used for Step 3.
        if (apiType === CANVAS_API_TYPES.GRAPHQL) {
            console.log('[Step 2] GraphQL mode: using REST for ID resolution (see canvas-graphql.js for rationale)');
        }

        // --- Separate students into cached vs uncached groups ---
        const cachedStudents = [];
        const uncachedStudents = [];

        if (cacheEnabled) {
            const cache = await getCache();
            const now = new Date();

            const validCachedIds = Object.keys(cache).filter(id => {
                const entry = cache[id];
                return entry && entry.expiresAt && new Date(entry.expiresAt) > now;
            });

            const studentBySyId = new Map();
            students.forEach(s => {
                if (s.SyStudentId) studentBySyId.set(String(s.SyStudentId), s);
            });

            for (const cachedId of validCachedIds) {
                if (studentBySyId.has(cachedId)) {
                    cachedStudents.push(studentBySyId.get(cachedId));
                    studentBySyId.delete(cachedId);
                }
            }
            uncachedStudents.push(...studentBySyId.values());
        } else {
            uncachedStudents.push(...students);
        }

        console.log(`[Step 2] ${cachedStudents.length} cached, ${uncachedStudents.length} uncached`);
        timeSpan.textContent = '15%';

        // --- Build shared state for batch processing ---
        const BATCH_SIZE = 20;
        const BATCH_DELAY_MS = 100;

        let updatedStudents = [...students];
        const studentIndexMap = new Map();
        students.forEach((s, i) => studentIndexMap.set(s, i));

        let processedCount = 0;
        const updateProgress = () => {
            const pct = 15 + Math.round((processedCount / students.length) * 85);
            timeSpan.textContent = `${pct}%`;
        };

        const fetchFn = (student) => fetchCanvasDetails(student, cacheEnabled, useNonApiFetch, courseReferenceDate);

        // --- Process cached students first (fast, no API delay needed) ---
        await processBatches({
            students: cachedStudents,
            updatedStudents,
            studentIndexMap,
            processFn: fetchFn,
            batchSize: BATCH_SIZE,
            delayMs: 0,
            onProgress: (n) => { processedCount = n; updateProgress(); },
            flushCache: false
        });

        // --- Process uncached students (API calls, with delay between batches) ---
        if (uncachedStudents.length > 0) {
            console.log(`[Step 2] Now fetching fresh data for ${uncachedStudents.length} uncached students...`);
        }

        const cachedCount = cachedStudents.length;
        await processBatches({
            students: uncachedStudents,
            updatedStudents,
            studentIndexMap,
            processFn: fetchFn,
            batchSize: BATCH_SIZE,
            delayMs: BATCH_DELAY_MS,
            onProgress: (n) => { processedCount = cachedCount + n; updateProgress(); },
            flushCache: true
        });

        await chrome.storage.local.set({ [STORAGE_KEYS.MASTER_ENTRIES]: updatedStudents });

        console.log(`[Step 2] Complete - ${students.length} students processed`);

        return updatedStudents;
    }, { final: false });

    if (renderCallback) await renderCallback(updatedStudents);
    return updatedStudents;
}


// -- Step 3: Check Gradebooks for Missing Assignments -----------------------

/**
 * Process Step 3: Check missing assignments and grades for all students.
 *
 * Groups students by courseId so students in the same course share a single
 * pair of API calls. Uses a worker pool to keep multiple course fetches
 * in-flight simultaneously for maximum throughput.
 */
export async function processStep3(students, renderCallback, options = {}) {
    while (true) {
        resetAuthErrorState();
        try {
            return await _processStep3(students, renderCallback, options);
        } catch (e) {
            if (e instanceof CanvasAuthRetryError) {
                console.log('[Step 3] Retrying with updated settings...');
                continue;
            }
            throw e;
        }
    }
}

async function _processStep3(students, renderCallback, options = {}) {
    // When the pipeline calls Step 3 followed by Step 4, Step 3 should not
    // finalize the 'Fetch Canvas Data' row — Step 4 does that. When Step 3
    // runs standalone (e.g. "Check Grade Book Again"), it finalizes itself.
    const finalize = options.finalize !== false;
    return withStepUI('step2', async ({ timeSpan }) => {
        // Pre-check: ensure user is logged into Canvas before making any API calls.
        // This is critical when Step 3 runs standalone (e.g. "Check Grade Book Again")
        // without Step 2 having already verified the session.
        await ensureCanvasLogin(getCanvasDomain());

        const settings = await storageGet([
            STORAGE_KEYS.USE_SPECIFIC_DATE,
            STORAGE_KEYS.SPECIFIC_SUBMISSION_DATE,
            STORAGE_KEYS.NEXT_ASSIGNMENT_ENABLED,
            STORAGE_KEYS.CANVAS_API_TYPE
        ]);

        const useSpecificDate = settings[STORAGE_KEYS.USE_SPECIFIC_DATE] || false;
        const specificDateStr = settings[STORAGE_KEYS.SPECIFIC_SUBMISSION_DATE];
        const nextAssignmentEnabled = settings[STORAGE_KEYS.NEXT_ASSIGNMENT_ENABLED] || false;
        const apiType = settings[STORAGE_KEYS.CANVAS_API_TYPE] === CANVAS_API_TYPES.GRAPHQL
            ? CANVAS_API_TYPES.GRAPHQL
            : CANVAS_API_TYPES.REST;

        let referenceDate;
        if (useSpecificDate && specificDateStr) {
            const [year, month, day] = specificDateStr.split('-').map(Number);
            referenceDate = new Date(year, month - 1, day);
            console.log(`[Step 3] Time Machine mode: Checking as of ${specificDateStr}`);
        } else {
            referenceDate = new Date();
        }

        let updatedStudents = [...students];

        // --- Group students by course ---
        const courseGroups = new Map(); // key: "origin|courseId"
        const noUrlIndices = [];

        for (let i = 0; i < updatedStudents.length; i++) {
            const student = updatedStudents[i];
            const gradebookUrl = student.url || student.Gradebook;
            if (!gradebookUrl) { noUrlIndices.push(i); continue; }

            const parsed = parseGradebookUrl(gradebookUrl);
            if (!parsed) { noUrlIndices.push(i); continue; }

            const groupKey = `${parsed.origin}|${parsed.courseId}`;
            if (!courseGroups.has(groupKey)) courseGroups.set(groupKey, []);
            courseGroups.get(groupKey).push({ student, parsed, originalIndex: i });
        }

        // Students without URLs get zero counts immediately
        for (const idx of noUrlIndices) {
            updatedStudents[idx] = {
                ...updatedStudents[idx],
                missingCount: 0, missingAssignments: [], nextAssignment: null
            };
        }

        const courseGroupEntries = Array.from(courseGroups.entries());
        const totalGroups = courseGroupEntries.length;
        console.log(`[Step 3] ${students.length} students grouped into ${totalGroups} course(s) (${noUrlIndices.length} without URL)`);

        // --- Worker pool: fetch course groups concurrently ---
        const MAX_CONCURRENT = 10;
        let processedStudents = noUrlIndices.length;
        let courseIndex = 0;

        async function worker() {
            while (courseIndex < courseGroupEntries.length) {
                checkShutdown();

                const idx = courseIndex++;
                const [, studentsInCourse] = courseGroupEntries[idx];
                const { origin, courseId } = studentsInCourse[0].parsed;
                const studentIds = studentsInCourse.map(s => s.parsed.studentId);

                try {
                    const data = apiType === CANVAS_API_TYPES.GRAPHQL
                        ? await fetchCourseGroupDataGraphQL(origin, courseId, studentIds)
                        : await fetchCourseGroupData(origin, courseId, studentIds);
                    const results = processCourseGroupResults(
                        studentsInCourse, data, referenceDate, nextAssignmentEnabled
                    );
                    results.forEach((updated, i) => {
                        updatedStudents[studentsInCourse[i].originalIndex] = updated;
                    });
                } catch (e) {
                    if (e instanceof CanvasAuthShutdownError || e instanceof CanvasAuthRetryError) throw e;
                    console.error(`[Step 3] Course ${courseId} fetch error:`, e);
                    for (const { student, originalIndex } of studentsInCourse) {
                        updatedStudents[originalIndex] = {
                            ...student,
                            missingCount: 0, missingAssignments: [], nextAssignment: null
                        };
                    }
                }

                processedStudents += studentsInCourse.length;
                timeSpan.textContent = `${Math.round((processedStudents / students.length) * 100)}%`;
            }
        }

        const workerCount = Math.min(MAX_CONCURRENT, courseGroupEntries.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));

        await chrome.storage.local.set({ [STORAGE_KEYS.MASTER_ENTRIES]: updatedStudents });

        const totalMissing = updatedStudents.reduce((sum, s) => sum + (s.missingCount || 0), 0);
        console.log(`[Step 3] Complete - ${totalGroups} course(s), ${totalMissing} missing assignments`);

        if (renderCallback) renderCallback(updatedStudents);
        return updatedStudents;
    }, { final: finalize });
}


// -- Step 4: Send to Excel --------------------------------------------------

/** Process Step 4: Send the master list with missing assignments to Excel. */
export async function processStep4(students) {
    const stepEl = document.getElementById('step2');
    if (!stepEl) return students;

    // Skip Excel send when disabled, but still finalize the Fetch Canvas Data
    // row so it doesn't sit spinning after Step 3 completes.
    const settings = await storageGet([STORAGE_KEYS.SEND_MASTER_LIST_TO_EXCEL]);
    const sendEnabled = settings[STORAGE_KEYS.SEND_MASTER_LIST_TO_EXCEL] !== undefined
        ? settings[STORAGE_KEYS.SEND_MASTER_LIST_TO_EXCEL]
        : true;
    if (!sendEnabled) {
        const existingStart = stepEl.dataset.startTime;
        const startTime = existingStart ? parseInt(existingStart, 10) : Date.now();
        const durationSeconds = (Date.now() - startTime) / 1000;
        const timeSpan = stepEl.querySelector('.step-time');
        stepEl.className = 'queue-item completed';
        updateStepIcon(stepEl, 'check');
        if (timeSpan) timeSpan.textContent = formatDuration(durationSeconds);
        delete stepEl.dataset.startTime;
        updateTotalTime();
        return students;
    }

    const timeSpan = stepEl.querySelector('.step-time');
    stepEl.className = 'queue-item active';
    updateStepIcon(stepEl, 'spinner');

    // Share the startTime with the earlier Step 2/3 phases so the final
    // duration reflects the whole Canvas pipeline, not just the Excel send.
    const existingStart = stepEl.dataset.startTime;
    const startTime = existingStart ? parseInt(existingStart, 10) : Date.now();
    if (!existingStart) stepEl.dataset.startTime = String(startTime);

    const finish = (suffix = '') => {
        const durationSeconds = (Date.now() - startTime) / 1000;
        stepEl.className = 'queue-item completed';
        updateStepIcon(stepEl, 'check');
        timeSpan.textContent = suffix ? `${formatDuration(durationSeconds)} ${suffix}` : formatDuration(durationSeconds);
        delete stepEl.dataset.startTime;
        updateTotalTime();
    };

    try {
        // Dynamically import to avoid circular dependency
        const { sendMasterListWithMissingAssignmentsToExcel } = await import('./file-handler.js');
        const { getExcelTabs, openExcelInstanceModal } = await import('./modals/excel-instance-modal.js');
        const { getCampusesFromStudents, openCampusSelectionModal } = await import('./modals/campus-selection-modal.js');

        // --- Campus selection (if multiple campuses) ---
        let studentsToSend = students;
        const campuses = getCampusesFromStudents(students);

        if (campuses.length > 1) {
            const selectedCampus = await openCampusSelectionModal(campuses);

            if (selectedCampus === null) {
                finish('(skipped)');
                return students;
            }

            if (selectedCampus !== '') {
                studentsToSend = students.filter(s => s.campus === selectedCampus);
                console.log(`[Step 4] Filtered to ${studentsToSend.length} students from campus: ${selectedCampus}`);
            }
        }

        // --- Excel tab selection (if multiple tabs) ---
        const excelTabs = await getExcelTabs();
        let targetTabId = null;

        if (excelTabs.length === 0) {
            // No tabs — will attempt to send when tabs open
        } else if (excelTabs.length > 1) {
            targetTabId = await openExcelInstanceModal(excelTabs);

            if (targetTabId === null) {
                finish('(skipped)');
                return students;
            }
        } else {
            targetTabId = excelTabs[0].id;
        }

        // --- Send ---
        await sendMasterListWithMissingAssignmentsToExcel(studentsToSend, targetTabId);

        finish();
        console.log(`[Step 4] Complete`);
        return students;

    } catch (error) {
        console.error("[Step 4 Error]", error);
        updateStepIcon(stepEl, 'error');
        stepEl.style.color = '#ef4444';
        timeSpan.textContent = 'Error';
        delete stepEl.dataset.startTime;
        return students;
    }
}
