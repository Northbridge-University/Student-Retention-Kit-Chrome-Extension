// [2025-12-10 11:30 AM]
// Version: 18.2 - Organized Storage Structure
import { STORAGE_KEYS, CHECKER_MODES, ADVANCED_FILTER_REGEX, DEFAULT_SETTINGS, EXTENSION_STATES, MESSAGE_TYPES, normalizeCanvasUrl } from '../constants/index.js';
import { CONFIG } from '../constants/config.js';
import { storageGet, storageSet } from '../utils/storage.js';

let isLooping = false;
let batchQueue = [];
let foundUrlCache = new Set();
let currentLoopIndex = 0;
let maxConcurrentRequests = CONFIG.LOOPER.MAX_CONCURRENT_REQUESTS;
let currentCheckerMode = DEFAULT_SETTINGS[STORAGE_KEYS.CHECKER_MODE];
let onCompleteCallback = null;
let onFoundCallback = null;
let onMissingFoundCallback = null;
let activeRequests = 0;

// Progress Tracking Variables
let totalStudents = 0;
let processedCount = 0;

// Canvas Auth Error handling
let isPausedForAuthError = false;
let authErrorResolve = null;
let consecutiveAuthErrors = 0;

const BATCH_SIZE = CONFIG.LOOPER.BATCH_SIZE;
const REQUEST_TIMEOUT_MS = CONFIG.LOOPER.REQUEST_TIMEOUT_MS; 

function parseIdsFromUrl(url) {
    try {
        // Normalize the URL to handle legacy domains
        const normalizedUrl = normalizeCanvasUrl(url);
        const urlObj = new URL(normalizedUrl);
        const regex = /courses\/(\d+)\/grades\/(\d+)/;
        const match = urlObj.pathname.match(regex);
        if (match) {
            return {
                origin: urlObj.origin,
                courseId: match[1],
                studentId: match[2]
            };
        }
    } catch (e) {
        console.warn('Invalid URL object:', url);
    }
    return null;
}

function getNextPageUrl(linkHeader) {
    if (!linkHeader) return null;
    const links = linkHeader.split(',');
    const nextLink = links.find(link => link.includes('rel="next"'));
    if (!nextLink) return null;
    const match = nextLink.match(/<([^>]+)>/);
    return match ? match[1] : null;
}

async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

async function fetchPaged(url, items = []) {
    const headers = {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
    };

    try {
        const response = await fetchWithTimeout(url, { method: 'GET', credentials: 'include', headers });

        // Check for Canvas authorization errors
        if (response.status === 401 || response.status === 403) {
            if (response.status === 401) {
                consecutiveAuthErrors++;

                // Only show modal after hitting the threshold
                if (consecutiveAuthErrors >= CONFIG.LOOPER.AUTH_ERROR_THRESHOLD) {
                    console.warn(`[LOOPER] ${consecutiveAuthErrors} consecutive 401 errors — prompting user`);
                    logToDebug('warn', `${consecutiveAuthErrors} consecutive unauthorized errors - pausing for user input`);

                    const userChoice = await handleCanvasAuthError();
                    consecutiveAuthErrors = 0;

                    if (userChoice === 'shutdown') {
                        throw new Error('CANVAS_AUTH_SHUTDOWN');
                    }
                } else {
                    console.warn(`[LOOPER] 401 Unauthorized (${consecutiveAuthErrors}/${CONFIG.LOOPER.AUTH_ERROR_THRESHOLD}) - skipping`);
                }
                return items;
            }

            // 403 = user lacks permission for this specific course — skip silently
            const error = new Error('CANVAS_ACCESS_DENIED');
            error.statusCode = 403;
            throw error;
        }

        // Successful response — reset consecutive error counter
        consecutiveAuthErrors = 0;

        if (!response.ok) {
            if (items.length > 0) return items;
            throw new Error(`HTTP ${response.status}`);
        }

        const newItems = await response.json();
        const allItems = items.concat(newItems);

        const linkHeader = response.headers.get('Link');
        const nextUrl = getNextPageUrl(linkHeader);

        if (nextUrl) {
            return fetchPaged(nextUrl, allItems);
        }

        return allItems;
    } catch (e) {
        if (e.name === 'AbortError') {
            console.warn("Request timed out - returning partial data.");
            return items;
        }
        throw e;
    }
}

/**
 * Handles Canvas authorization errors by notifying the sidepanel and waiting for user response
 * @returns {Promise<'continue'|'shutdown'>} The user's choice
 */
async function handleCanvasAuthError() {
    if (isPausedForAuthError) {
        // Already showing modal, wait for existing promise
        return new Promise(resolve => {
            const checkInterval = setInterval(() => {
                if (!isPausedForAuthError) {
                    clearInterval(checkInterval);
                    resolve('continue');
                }
            }, 100);
        });
    }

    isPausedForAuthError = true;

    return new Promise((resolve) => {
        authErrorResolve = resolve;

        // Send message to sidepanel to show the auth error modal
        chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.CANVAS_AUTH_ERROR
        }).catch(() => {
            // If sidepanel is not open, default to continue
            console.warn('[LOOPER] Could not reach sidepanel - continuing');
            isPausedForAuthError = false;
            resolve('continue');
        });
    });
}

async function fetchBatchData(batch) {
    const firstEntry = batch[0];
    const { origin, courseId } = firstEntry.parsed;
    const studentIds = batch.map(e => e.parsed.studentId);
    
    // 1. Submissions Endpoint
    const idsQuery = studentIds.map(id => `student_ids[]=${id}`).join('&');
    const submissionsEndpoint = `${origin}/api/v1/courses/${courseId}/students/submissions?${idsQuery}&include[]=assignment&per_page=100`;

    // 2. Users Endpoint
    const userIdsQuery = studentIds.map(id => `user_ids[]=${id}`).join('&');
    const usersEndpoint = `${origin}/api/v1/courses/${courseId}/users?${userIdsQuery}&include[]=enrollments&per_page=100`;

    let submissionsData = [];
    let usersData = [];
    let error = null;

    const studentNames = batch.map(e => e.name || 'Unknown').join(', ');

    try {
        submissionsData = await fetchPaged(submissionsEndpoint);
    } catch (e) {
        if (e.message === 'CANVAS_AUTH_SHUTDOWN') {
            return { batch, error: 'CANVAS_AUTH_SHUTDOWN', shutdown: true };
        }
        if (e.message === 'CANVAS_ACCESS_DENIED') {
            console.warn(`[LOOPER] 403 Access Denied — Course ${courseId} | Students: ${studentNames}\n  URL: ${submissionsEndpoint}`);
            return { batch, error: e.message };
        }
        console.error(`Submissions fetch failed for course ${courseId}:`, e);
        return { batch, error: e.message };
    }

    try {
        usersData = await fetchPaged(usersEndpoint);
    } catch (e) {
        if (e.message === 'CANVAS_AUTH_SHUTDOWN') {
            return { batch, error: 'CANVAS_AUTH_SHUTDOWN', shutdown: true };
        }
        if (e.message === 'CANVAS_ACCESS_DENIED') {
            console.warn(`[LOOPER] 403 Access Denied (users) — Course ${courseId} | Students: ${studentNames}\n  URL: ${usersEndpoint}`);
        } else {
            console.warn(`Users/Grades fetch failed for course ${courseId} (continuing with blank grades):`, e);
        }
    }

    return { batch, submissionsData, usersData };
}

function logToDebug(level, message) {
    chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.LOG_TO_PANEL,
        level: level,
        args: [message]
    }).catch(err => {
        // Ignore expected "sidepanel not open" errors
        if (!err?.message?.includes('Receiving end does not exist')) {
            console.error('[Looper] Failed to log to panel:', err?.message);
        }
    });
}

async function processBatchResult(result) {
    if (!result || result.error) {
        // Check if this was a shutdown request
        if (result && result.shutdown) {
            console.log('[LOOPER] Stopping loop due to Canvas auth shutdown request');
            stopLoop();
        }
        return;
    }
    const { batch, submissionsData, usersData } = result;

    const batchResults = [];

    for (const entry of batch) {
        const studentId = parseInt(entry.parsed.studentId, 10);
        
        const studentSubmissions = submissionsData ? submissionsData.filter(sub => sub.user_id === studentId) : [];
        const studentUser = usersData ? usersData.find(u => u.id === studentId) : null;

        if (currentCheckerMode === CHECKER_MODES.MISSING) {
            const studentResult = await analyzeMissingMode(entry, studentSubmissions, studentUser);
            if (studentResult) batchResults.push(studentResult);
        } else {
            await analyzeSubmissionMode(entry, studentSubmissions);
        }
    }

    if (batchResults.length > 0 && onMissingFoundCallback) {
        batchResults.forEach(payload => onMissingFoundCallback(payload));
    }
}

async function analyzeMissingMode(entry, submissions, userObject) {
    // Support both 'url' field and legacy 'Gradebook' field
    const gradebookUrl = entry.url || entry.Gradebook;

    const now = new Date();
    const collectedAssignments = [];

    let debugStats = {
        total: submissions.length,
        foundMissing: 0
    };

    let currentGrade = "";
    if (userObject && userObject.enrollments) {
        const enrollment = userObject.enrollments.find(e => e.type === 'StudentEnrollment') || userObject.enrollments[0];
        
        if (enrollment && enrollment.grades) {
            if (enrollment.grades.current_score != null) {
                currentGrade = enrollment.grades.current_score;
            } else if (enrollment.grades.final_score != null) {
                currentGrade = enrollment.grades.final_score;
            } else if (enrollment.grades.current_grade != null) {
                currentGrade = String(enrollment.grades.current_grade).replace(/%/g, ''); 
            }
        }
    }

    submissions.forEach(sub => {
        const dueDate = sub.cached_due_date ? new Date(sub.cached_due_date) : null;

        if (dueDate && dueDate > now) return;

        // Check if score indicates completion (e.g., "complete", "Complete", "COMPLETE")
        const scoreStr = String(sub.score || sub.grade || '').toLowerCase();
        const isComplete = scoreStr === 'complete';

        // Skip assignments marked as complete - they're submitted even if score is 0 or null
        if (isComplete) return;

        const isMissing = (sub.missing === true) ||
                          ((sub.workflow_state === 'unsubmitted' || sub.workflow_state === 'unsubmitted (ungraded)') && (dueDate && dueDate < now)) ||
                          (sub.score === 0);

        if (isMissing) {
            debugStats.foundMissing++;
            collectedAssignments.push({
                title: sub.assignment ? sub.assignment.name : 'Unknown Assignment',
                link: gradebookUrl,
                submissionLink: sub.preview_url || gradebookUrl,
                dueDate: sub.cached_due_date ? new Date(sub.cached_due_date).toLocaleDateString() : 'No Date',
                score: sub.grade || (sub.score !== null ? sub.score : '-'),
                isMissing: isMissing
            });
        }
    });

    if (debugStats.foundMissing > 0) {
        logToDebug('log', `[DEBUG] ${entry.name}: Grade=${currentGrade} | Found ${debugStats.foundMissing}`);
    }

    return {
        studentName: entry.name,
        gradeBook: gradebookUrl,
        currentGrade: currentGrade,
        count: collectedAssignments.length,
        duration: "0.2",
        assignments: collectedAssignments
    };
}

async function analyzeSubmissionMode(entry, submissions) {
    // Support both 'url' field and legacy 'Gradebook' field
    const gradebookUrl = entry.url || entry.Gradebook;

    const settings = await storageGet([
        STORAGE_KEYS.CUSTOM_KEYWORD,
        STORAGE_KEYS.USE_SPECIFIC_DATE,
        STORAGE_KEYS.SPECIFIC_SUBMISSION_DATE
    ]);

    let keyword = settings[STORAGE_KEYS.CUSTOM_KEYWORD];
    const isCustomKeyword = !!keyword; // Check if user provided a specific custom keyword

    // Check if using a specific submission date
    const useSpecificDate = settings[STORAGE_KEYS.USE_SPECIFIC_DATE];
    const specificDate = settings[STORAGE_KEYS.SPECIFIC_SUBMISSION_DATE];

    let now = new Date();

    // If using specific date and it's set, use that date instead of today
    if (useSpecificDate && specificDate) {
        // Parse date string in LOCAL timezone to avoid UTC conversion issues
        // Format expected: YYYY-MM-DD
        const [year, month, day] = specificDate.split('-').map(Number);
        now = new Date(year, month - 1, day); // month is 0-indexed
        console.log(`%c [LOOPER] Using specific date: ${specificDate} -> ${now.toDateString()}`, 'color: #FF5722; font-weight: bold;');
    }

    if (!keyword) {
        keyword = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).replace(',', '');
    }

    console.log(`%c [LOOPER] Checking ${entry.name}`, 'color: #00BCD4;');

    let found = false;
    let foundDetails = null;

    for (const sub of submissions) {
        if (sub.submitted_at) {
            const subDate = new Date(sub.submitted_at);
            const subDateStr = subDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).replace(',', '');

            // FIX: If using default date (Today), use strict equality (===) to prevent "Dec 10" matching "Dec 1".
            // If using a custom keyword (e.g. "Dec"), allow .includes() for partial matching.
            let isMatch = false;
            if (isCustomKeyword) {
                isMatch = subDateStr.includes(keyword);
            } else {
                isMatch = subDateStr === keyword;
            }

            if (isMatch) {
                found = true;

                foundDetails = {
                    name: entry.name,
                    sortable_name: entry.sortable_name || null,
                    time: subDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
                    url: gradebookUrl,
                    timestamp: sub.submitted_at,
                    assignment: sub.assignment ? sub.assignment.name : 'Unknown Assignment',
                    syStudentId: entry.SyStudentId || null,
                    campus: entry.campus || null
                };
                break;
            }
        }
    }

    if (found && foundDetails) {
        console.log(`%c [LOOPER] Submission detected! ${foundDetails.name} - ${foundDetails.assignment}`, 'background: #FF9800; color: white; font-weight: bold; padding: 2px 4px;');
        logToDebug('log', `Found submission: ${foundDetails.name} - ${foundDetails.assignment}`);
        if (onFoundCallback) {
            onFoundCallback(foundDetails);
        } else {
            console.warn('[LOOPER] onFoundCallback is not set!');
        }
    }
}

async function loadSettings() {
    const settings = await storageGet([
        STORAGE_KEYS.CONCURRENT_TABS,
        STORAGE_KEYS.CHECKER_MODE
    ]);
    maxConcurrentRequests = settings[STORAGE_KEYS.CONCURRENT_TABS] || 5;
    currentCheckerMode = settings[STORAGE_KEYS.CHECKER_MODE] || DEFAULT_SETTINGS[STORAGE_KEYS.CHECKER_MODE];
}

function prepareBatches(entries) {
    const courses = {};
    const skippedStudents = [];

    entries.forEach(entry => {
        // Support both 'url' field and legacy 'Gradebook' field
        const gradebookUrl = entry.url || entry.Gradebook;
        const parsed = parseIdsFromUrl(gradebookUrl);
        if (parsed) {
            entry.parsed = parsed;
            if (!courses[parsed.courseId]) {
                courses[parsed.courseId] = [];
            }
            courses[parsed.courseId].push(entry);
        } else {
            // Log skipped students with invalid URLs
            const studentName = entry.name || 'Unknown Student';
            const urlStatus = gradebookUrl === undefined ? 'undefined' : (gradebookUrl === null ? 'null' : `invalid: ${gradebookUrl}`);
            skippedStudents.push({ name: studentName, url: urlStatus });
            console.warn(`[LOOPER] Skipping student with invalid URL - Name: ${studentName}, URL: ${urlStatus}`);
            logToDebug('warn', `Skipping student with invalid URL - Name: ${studentName}, URL: ${urlStatus}`);
        }
    });

    // Log summary if any students were skipped
    if (skippedStudents.length > 0) {
        console.warn(`[LOOPER] Total students skipped due to invalid URLs: ${skippedStudents.length}`);
        logToDebug('warn', `Total students skipped due to invalid URLs: ${skippedStudents.length}`);
    }

    const batches = [];
    Object.values(courses).forEach(courseEntries => {
        for (let i = 0; i < courseEntries.length; i += BATCH_SIZE) {
            batches.push(courseEntries.slice(i, i + BATCH_SIZE));
        }
    });

    return batches;
}

// NEW: Core Logic extracted to allow re-runs
async function performLoop() {
    // Reset state for new cycle
    currentLoopIndex = 0;
    processedCount = 0;
    activeRequests = 0;

    await loadSettings();

    // 1. Fetch Fresh Data
    const data = await storageGet([
        STORAGE_KEYS.MASTER_ENTRIES,
        STORAGE_KEYS.FOUND_ENTRIES,
        STORAGE_KEYS.LOOPER_DAYS_OUT_FILTER,
        STORAGE_KEYS.SCAN_FILTER_INCLUDE_FAILING
    ]);

    const masterEntries = data[STORAGE_KEYS.MASTER_ENTRIES] || [];
    const foundEntries = data[STORAGE_KEYS.FOUND_ENTRIES] || [];
    const filterText = (data[STORAGE_KEYS.LOOPER_DAYS_OUT_FILTER] || 'all').trim().toLowerCase();
    const includeFailing = data[STORAGE_KEYS.SCAN_FILTER_INCLUDE_FAILING] || false;


    // 2. Re-build Cache
    foundUrlCache = new Set(foundEntries.map(e => e.url || e.Gradebook).filter(Boolean));

    let filteredList = masterEntries;

    // 3. Apply Filters
    if (filterText !== 'all' && filterText !== '') {
        const match = filterText.match(ADVANCED_FILTER_REGEX);
        if (match) {
            filteredList = masterEntries.filter(entry => {
                const operator = match[1];
                const value = parseInt(match[2], 10);
                const daysOut = entry.daysOut;

                // Check if student meets days out criteria
                let meetsDaysOutCriteria = false;
                if (daysOut != null) {
                    switch (operator) {
                        case '>':  meetsDaysOutCriteria = daysOut > value; break;
                        case '<':  meetsDaysOutCriteria = daysOut < value; break;
                        case '>=': meetsDaysOutCriteria = daysOut >= value; break;
                        case '<=': meetsDaysOutCriteria = daysOut <= value; break;
                        case '=':  meetsDaysOutCriteria = daysOut === value; break;
                        default:   meetsDaysOutCriteria = false;
                    }
                }

                // Check if student is failing (grade < 60)
                let isFailing = false;
                if (includeFailing && entry.grade != null) {
                    const grade = parseFloat(entry.grade);
                    if (!isNaN(grade) && grade < 60) {
                        isFailing = true;
                    }
                }

                // Include student if they meet days out criteria OR are failing (if toggle is enabled)
                return meetsDaysOutCriteria || isFailing;
            });
        }
    }

    // 4. Remove Already Found Students (Submission Mode)
    if (currentCheckerMode === CHECKER_MODES.SUBMISSION) {
        const initialCount = filteredList.length;
        filteredList = filteredList.filter(entry => !foundUrlCache.has(entry.url || entry.Gradebook));
    }

    if (filteredList.length === 0) {
        if (currentCheckerMode === CHECKER_MODES.SUBMISSION) {
             // Update UI to show 0/0 so user knows it's waiting
             storageSet({
                [STORAGE_KEYS.LOOP_STATUS]: { current: 0, total: 0 }
             });
             // Poll again in 5 seconds (keeps loop alive)
             setTimeout(() => { if (isLooping) performLoop(); }, 5000);
             return;
        }
        console.warn('No students to check (Missing Mode). Stopping.');
        stopLoop();
        return;
    }

    // 5. Build Batches
    totalStudents = filteredList.length;
    batchQueue = prepareBatches(filteredList);

    console.log(`%c [LOOPER] Checking ${totalStudents} students in ${batchQueue.length} batches`, 'color: #00BCD4; font-weight: bold;');

    // Update UI immediately
    storageSet({
        [STORAGE_KEYS.LOOP_STATUS]: { current: 0, total: totalStudents }
    });

    // 6. Launch
    for (let i = 0; i < maxConcurrentRequests; i++) {
        next();
    }
}

async function next() {
    if (!isLooping) return;

    if (currentLoopIndex >= batchQueue.length) {
        if (activeRequests === 0) finishLoop();
        return;
    }

    if (activeRequests >= maxConcurrentRequests) return;

    const batch = batchQueue[currentLoopIndex];
    currentLoopIndex++;

    processedCount += batch.length;

    storageSet({
        [STORAGE_KEYS.LOOP_STATUS]: {
            current: Math.min(processedCount, totalStudents),
            total: totalStudents
        }
    });

    activeRequests++;
    
    fetchBatchData(batch)
        .then(result => processBatchResult(result))
        .finally(() => {
            activeRequests--;
            next(); 
        });

    next();
}

function finishLoop() {
    // Removed old cleanup logic that didn't support refresh
    if (currentCheckerMode === CHECKER_MODES.MISSING) {
        isLooping = false;
        console.log('%c [LOOPER] Scan complete', 'color: #4CAF50; font-weight: bold;');
        // Remove LOOP_STATUS from storage (flat key, use chrome.storage.local directly)
        chrome.storage.local.remove(STORAGE_KEYS.LOOP_STATUS);
        if (onCompleteCallback) onCompleteCallback();
    } else {
        console.log('%c [LOOPER] Cycle complete, restarting...', 'color: #00BCD4;');
        setTimeout(() => {
            if (!isLooping) return;
            // Calls performLoop instead of resetting vars to ensure new Found items are filtered out
            performLoop(); 
        }, 2000);
    }
}

// --- Public Exports ---

export function addToFoundUrlCache(url) { if (url) foundUrlCache.add(url); }

export async function startLoop(options = {}) {
    if (isLooping && !options.force) {
        console.log('%c [LOOPER] Already running, skipping start', 'color: orange; font-weight: bold;');
        return;
    }

    console.log('%c [LOOPER] Started', 'color: #4CAF50; font-weight: bold;');

    onCompleteCallback = options.onComplete || null;
    onFoundCallback = options.onFound || null;
    onMissingFoundCallback = options.onMissingFound || null;

    isLooping = true;
    consecutiveAuthErrors = 0;
    performLoop(); // Call the logic function
}

export function stopLoop() {
    console.log('%c [LOOPER] Stopped', 'color: #F44336; font-weight: bold;');

    isLooping = false;
    activeRequests = 0;
    isPausedForAuthError = false;
    authErrorResolve = null;
    onCompleteCallback = null;
    onFoundCallback = null;
    onMissingFoundCallback = null;
    // Remove LOOP_STATUS from storage (flat key, use chrome.storage.local directly)
    chrome.storage.local.remove(STORAGE_KEYS.LOOP_STATUS);
}

// Listen for Canvas auth error responses from the sidepanel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === MESSAGE_TYPES.CANVAS_AUTH_RESPONSE) {
        console.log('[LOOPER] Received Canvas auth response:', message.choice);

        if (authErrorResolve) {
            authErrorResolve(message.choice);
            authErrorResolve = null;
        }
        isPausedForAuthError = false;

        // If shutdown was chosen, stop the loop
        if (message.choice === 'shutdown') {
            stopLoop();
        }

        sendResponse({ received: true });
        return true;
    }
});