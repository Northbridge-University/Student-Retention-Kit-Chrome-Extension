// File Handler - CSV/Excel import and export functionality
import {
    STORAGE_KEYS,
    FIELD_ALIASES,
    MASTER_LIST_COLUMNS,
    EXPORT_MISSING_ASSIGNMENTS_COLUMNS,
    LDA_VISIBLE_COLUMNS
} from '../constants/index.js';
import {
    normalizeFieldName,
    convertExcelDate,
    calculateDaysSinceLastAttendance,
    parseDate,
    formatDateToMMDDYY,
    trimCommonPrefix,
    numericToLetterGrade
} from '../constants/field-utils.js';
import { updateStepIcon } from '../utils/ui-helpers.js';
import { elements } from './ui-manager.js';
import { formatDuration, updateTotalTime } from './canvas-api.js';

/**
 * Sends master list data to Excel via SRK_IMPORT_MASTER_LIST payload
 * @param {Array} students - Array of student objects
 * @param {number|null} targetTabId - Optional specific tab ID to send to (null = send to all)
 */
export async function sendMasterListToExcel(students, targetTabId = null) {
    if (!students || students.length === 0) {
        console.log('No students to send to Excel');
        return;
    }

    // Check if sending master list to Excel is enabled
    const settings = await chrome.storage.local.get([STORAGE_KEYS.SEND_MASTER_LIST_TO_EXCEL]);
    const isEnabled = settings[STORAGE_KEYS.SEND_MASTER_LIST_TO_EXCEL] !== undefined
        ? settings[STORAGE_KEYS.SEND_MASTER_LIST_TO_EXCEL]
        : true; // Default to enabled

    if (!isEnabled) {
        console.log('Send master list to Excel is disabled - skipping');
        return;
    }

    try {
        // Only send columns where at least one student has data
        const activeColumns = MASTER_LIST_COLUMNS.filter(col => {
            return students.some(student => {
                const value = getFieldValue(student, col.field, col.fallback);
                return value !== null && value !== undefined && value !== '';
            });
        });

        const headers = activeColumns.map(col => col.header);

        // Transform students into data rows using only active columns
        const data = students.map(student => {
            return activeColumns.map(col => {
                let value = getFieldValue(student, col.field, col.fallback);

                // Format LDA dates to MM-DD-YY format
                if (col.field === 'lda') {
                    if (value) {
                        const dateObj = parseDate(value);
                        if (dateObj) {
                            value = formatDateToMMDDYY(dateObj);
                        }
                    }
                }

                // Return value or empty string
                return value !== null && value !== undefined ? value : '';
            });
        });

        // Create the payload
        const payload = {
            type: "SRK_IMPORT_MASTER_LIST",
            data: {
                headers: headers,
                data: data
            }
        };

        // Send message to background script to forward to Excel
        chrome.runtime.sendMessage({
            type: "SRK_SEND_IMPORT_MASTER_LIST",
            payload: payload,
            targetTabId: targetTabId // Pass specific tab ID if provided
        }).catch(() => {
            console.log('Background script might not be ready');
        });

        console.log(`Sent ${students.length} students to Excel for import with ${headers.length} columns${targetTabId ? ` (tab ${targetTabId})` : ' (all tabs)'}`);
    } catch (error) {
        console.error('Error sending master list to Excel:', error);
    }
}

/**
 * Sends master list data with missing assignments to Excel via SRK_IMPORT_MASTER_LIST payload
 * This function includes both the traditional headers/data arrays AND the students array with missingAssignments
 * @param {Array} students - Array of student objects with missingAssignments data
 * @param {number|null} targetTabId - Optional specific tab ID to send to (null = send to all)
 */
export async function sendMasterListWithMissingAssignmentsToExcel(students, targetTabId = null) {
    if (!students || students.length === 0) {
        console.log('No students to send to Excel');
        return;
    }

    // Check if sending master list to Excel is enabled
    const settings = await chrome.storage.local.get([STORAGE_KEYS.SEND_MASTER_LIST_TO_EXCEL]);
    const isEnabled = settings[STORAGE_KEYS.SEND_MASTER_LIST_TO_EXCEL] !== undefined
        ? settings[STORAGE_KEYS.SEND_MASTER_LIST_TO_EXCEL]
        : true; // Default to enabled

    if (!isEnabled) {
        console.log('Send master list to Excel is disabled - skipping');
        return;
    }

    try {
        // Only send columns where at least one student has data
        const activeColumns = MASTER_LIST_COLUMNS.filter(col => {
            return students.some(student => {
                const value = getFieldValue(student, col.field, col.fallback);
                return value !== null && value !== undefined && value !== '';
            });
        });

        const headers = activeColumns.map(col => col.header);

        // Transform students into data rows using only active columns
        const data = students.map(student => {
            return activeColumns.map(col => {
                let value = getFieldValue(student, col.field, col.fallback);

                // Format LDA dates to MM-DD-YY format
                if (col.field === 'lda') {
                    if (value) {
                        const dateObj = parseDate(value);
                        if (dateObj) {
                            value = formatDateToMMDDYY(dateObj);
                        }
                    }
                }

                // Return value or empty string
                return value !== null && value !== undefined ? value : '';
            });
        });

        // Create students array with missing assignments
        const studentsWithMissingAssignments = students
            .filter(student => student.missingAssignments && student.missingAssignments.length > 0)
            .map(student => {
                // Format student data for the students array
                const studentData = {
                    "Student Name": getFieldValue(student, 'name'),
                    "Grade": getFieldValue(student, 'currentGrade', 'grade'),
                    "Grade Book": getFieldValue(student, 'url')
                };

                // Format missing assignments according to MissingAssignmentImport interface
                // Handle both 'title' and 'assignmentTitle' for robustness
                studentData.missingAssignments = student.missingAssignments.map(assignment => ({
                    assignmentTitle: assignment.assignmentTitle || assignment.title || '',
                    assignmentLink: assignment.assignmentLink || assignment.assignmentUrl || '',
                    submissionLink: assignment.submissionLink || assignment.submissionUrl || '',
                    dueDate: assignment.dueDate || '',
                    score: assignment.score || ''
                }));

                return studentData;
            });

        // Create the payload with both traditional format and students array
        const payload = {
            type: "SRK_IMPORT_MASTER_LIST",
            data: {
                headers: headers,
                data: data,
                students: studentsWithMissingAssignments
            }
        };

        // Send message to background script to forward to Excel
        chrome.runtime.sendMessage({
            type: "SRK_SEND_IMPORT_MASTER_LIST",
            payload: payload,
            targetTabId: targetTabId // Pass specific tab ID if provided
        }).catch(() => {
            console.log('Background script might not be ready');
        });

        const totalMissingAssignments = studentsWithMissingAssignments.reduce(
            (sum, s) => sum + (s.missingAssignments?.length || 0),
            0
        );

        console.log(`Sent ${students.length} students to Excel for import with ${headers.length} columns${targetTabId ? ` (tab ${targetTabId})` : ' (all tabs)'}`);
        console.log(`Including ${studentsWithMissingAssignments.length} students with ${totalMissingAssignments} total missing assignments`);
    } catch (error) {
        console.error('Error sending master list with missing assignments to Excel:', error);
    }
}

/**
 * Validates if a string is a valid student name
 */
function isValidStudentName(name) {
    if (!name) return false;
    if (/^\d+$/.test(name)) return false;  // All digits
    if (name.includes('/')) return false;   // Contains date-like patterns
    return true;
}

/**
 * Checks if a field name indicates it should contain a date.
 * Used to determine which fields to apply Excel date conversion to.
 *
 * @param {string} fieldName - The field name to check
 * @returns {boolean} True if field appears to be a date field
 */
function isDateField(fieldName) {
    if (!fieldName) return false;
    const normalized = normalizeFieldName(fieldName);
    // Check if field name contains date-related keywords
    return normalized.includes('date') ||
           normalized.includes('lda') ||
           normalized === 'expstartdate' ||
           normalized === 'lastlda';
}

/**
 * Cleans up program version strings by removing year prefix and everything before it.
 * Examples:
 * - "D2-Q-2024 Medical Billing and Coding Specialist" → "Medical Billing and Coding Specialist"
 * - "A1-2025 Nursing Program" → "Nursing Program"
 * - "Medical Billing" → "Medical Billing" (unchanged if no year found)
 *
 * @param {string} value - The program version string to clean
 * @returns {string} The cleaned program version string
 */
function cleanProgramVersion(value) {
    if (!value || typeof value !== 'string') return value;

    // Match a 4-digit year (19xx or 20xx) and remove everything up to and including it
    // Also removes any trailing separator (space, dash, etc.) after the year
    const yearPattern = /.*\b(19\d{2}|20\d{2})\b[\s\-]*/;
    const cleaned = value.replace(yearPattern, '');

    // Return trimmed result, or original if no year was found
    return cleaned.trim() || value.trim();
}

/**
 * Cleans up phone number strings by removing trailing spaces and anything after the phone number.
 * Examples:
 * - "555-1234 " → "555-1234"
 * - "555-1234 ext 123" → "555-1234"
 * - "(555) 123-4567 work" → "(555) 123-4567"
 * - "+1-555-123-4567 mobile" → "+1-555-123-4567"
 *
 * @param {string|number} value - The phone number string to clean
 * @returns {string} The cleaned phone number string
 */
function cleanPhoneNumber(value) {
    if (!value) return value;

    // Convert to string and trim
    let cleaned = String(value).trim();

    // Extract only the phone number part (digits, hyphens, parentheses, spaces, dots, plus signs)
    // This regex captures the phone number portion and stops at any trailing text/spaces
    const phonePattern = /^([+\d\s\-().]+?)(?:\s+[a-zA-Z].*)?$/;
    const match = cleaned.match(phonePattern);

    if (match) {
        // Return the captured phone number, trimmed
        return match[1].trim();
    }

    // If no match, just return trimmed value
    return cleaned;
}

/**
 * Pre-computed normalized alias lookup.
 * Maps each normalized alias string to the canonical field name,
 * so alias resolution is O(1) instead of O(aliases) per header.
 */
const _normalizedAliasToField = {};
const _normalizedFieldNames = {};
for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const normalizedField = normalizeFieldName(field);
    _normalizedFieldNames[field] = normalizedField;
    // Map the field's own normalized form
    _normalizedAliasToField[normalizedField] = field;
    for (const alias of aliases) {
        _normalizedAliasToField[normalizeFieldName(alias)] = field;
    }
}
// Also pre-compute normalized names for MASTER_LIST_COLUMNS fields without aliases
for (const col of MASTER_LIST_COLUMNS) {
    if (!_normalizedFieldNames[col.field]) {
        _normalizedFieldNames[col.field] = normalizeFieldName(col.field);
    }
}

/**
 * Finds the column index for a field using normalized matching and aliases.
 * Uses pre-computed alias lookup for O(1) matching per header.
 *
 * @param {Array} normalizedHeaders - Array of pre-normalized header strings
 * @param {Array} rawHeaders - Array of original header names (same length)
 * @param {String} fieldName - The internal field name to match
 * @returns {Number} The column index, or -1 if not found
 */
function findColumnIndex(normalizedHeaders, rawHeaders, fieldName) {
    const normalizedFieldName = _normalizedFieldNames[fieldName] || normalizeFieldName(fieldName);

    for (let i = 0; i < normalizedHeaders.length; i++) {
        const nh = normalizedHeaders[i];
        // Direct match against the target field name
        if (nh === normalizedFieldName) return i;
        // Alias match: check if this header is a known alias for the target field
        if (_normalizedAliasToField[nh] === fieldName) return i;
    }
    return -1;
}

/**
 * Detects if the imported file is an Academic report (vs Eduk Master).
 * Academic reports contain course-level columns like CourseCode, CourseDescrip, InstructorName.
 *
 * @param {Array} normalizedHeaders - Array of pre-normalized header strings
 * @returns {boolean} True if the file appears to be an Academic report
 */
function detectAcademicReport(normalizedHeaders) {
    const academicIndicators = ['coursecode', 'coursedescrip', 'adcourseid', 'instructorname', 'section'];
    const matchCount = academicIndicators.filter(indicator => normalizedHeaders.includes(indicator)).length;
    // Require at least 2 matching indicators to avoid false positives
    return matchCount >= 2;
}

/**
 * Ranks course rows by relevance, most current first.
 * Priority: active course (started but not ended) > latest end date > latest start date.
 *
 * @param {Array} rows - Array of student entry objects (same SyStudentId)
 * @param {Date} referenceDate - Reference date for determining "current"
 * @returns {Array} Rows sorted from most current to least current
 */
function rankCourseRows(rows, referenceDate) {
    const now = referenceDate || new Date();

    const scored = rows.map(row => {
        let score = 0;

        const endDate = parseDate(row.courseEndDate);
        const startDate = parseDate(row.courseStartDate);

        // Highest priority: course currently active (started and not yet ended)
        if (startDate && endDate && startDate <= now && endDate >= now) {
            score += 100000;
        }

        // Prefer courses with later end dates
        if (endDate) {
            score += endDate.getTime() / 1e10;
        }

        // Tiebreaker: prefer courses with later start dates
        if (startDate) {
            score += startDate.getTime() / 1e13;
        }

        return { row, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.row);
}

/**
 * Finds the final grade from the previous (non-current) course.
 * Looks through ranked rows starting from the second one and returns
 * the first non-empty FinalNumericGrade found.
 *
 * @param {Array} rankedRows - Rows sorted by rankCourseRows (index 0 = current)
 * @returns {string|null} The previous course's final grade, or null if not found
 */
function getLastCourseGrade(rankedRows) {
    for (let i = 1; i < rankedRows.length; i++) {
        const grade = rankedRows[i]._rawFinalGrade;
        if (grade && grade !== '') {
            return String(grade);
        }
    }
    return null;
}

/**
 * Deduplicates Academic report rows by SyStudentId.
 * Academic reports contain one row per course per student, so the same student
 * appears multiple times. This groups rows by SyStudentId and selects the
 * "current class" row to represent each student.
 *
 * Also derives a lastCourseGrade from the previous course's final grade.
 *
 * @param {Array} students - Array of parsed student entries (may contain duplicates)
 * @param {Date} referenceDate - Reference date for current-class selection
 * @returns {Array} Deduplicated array of student entries
 */
function deduplicateAcademicStudents(students, referenceDate) {
    const grouped = new Map();

    for (const student of students) {
        const id = student.SyStudentId;
        if (!id) {
            // No SyStudentId - can't deduplicate, keep as-is with a unique key
            const fallbackKey = `__no_id_${grouped.size}`;
            grouped.set(fallbackKey, [student]);
            continue;
        }
        if (!grouped.has(id)) {
            grouped.set(id, []);
        }
        grouped.get(id).push(student);
    }

    const deduplicated = [];

    for (const [id, rows] of grouped) {
        let selected;
        if (rows.length === 1) {
            selected = rows[0];
        } else {
            const ranked = rankCourseRows(rows, referenceDate);
            selected = ranked[0];

            // Grab the final grade from the previous course for comparison
            const prevGrade = getLastCourseGrade(ranked);
            if (prevGrade) {
                selected.lastCourseGrade = prevGrade;
                selected.lastCourseLetterGrade = numericToLetterGrade(prevGrade);
            }
        }

        deduplicated.push(selected);
    }

    console.log(`Academic report: ${students.length} rows deduplicated to ${deduplicated.length} unique students by SyStudentId`);
    return deduplicated;
}

/**
 * Unified parser for both CSV and Excel files using SheetJS
 * @param {String|ArrayBuffer} data - File content
 * @param {Boolean} isCSV - True if parsing CSV, false for Excel
 * @param {Number} fileModifiedTime - File last modified timestamp (milliseconds since epoch)
 * @returns {Object} Object containing { students: Array, referenceDate: Date }
 */
export function parseFileWithSheetJS(data, isCSV, fileModifiedTime = null) {
    try {
        if (typeof XLSX === 'undefined') {
            throw new Error('XLSX library not loaded. Please refresh the page.');
        }

        let workbook;
        if (isCSV) {
            workbook = XLSX.read(data, { type: 'string' });
        } else {
            workbook = XLSX.read(data, { type: 'array', cellDates: true });
        }

        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });

        // Determine reference date for daysOut calculation
        // For Excel files, try to get creation date from workbook properties
        // Otherwise use file modified time or current date
        let referenceDate = null;
        if (!isCSV && workbook.Props && workbook.Props.CreatedDate) {
            referenceDate = new Date(workbook.Props.CreatedDate);
        } else if (fileModifiedTime) {
            referenceDate = new Date(fileModifiedTime);
        } else {
            referenceDate = new Date(); // Fallback to current date
        }

        if (rows.length < 2) {
            return { students: [], referenceDate: null };
        }

        // Find header row
        let headerRowIndex = -1;
        let headers = [];
        // Pre-compute what we're looking for: the 'name' field and its aliases
        const nameNormalized = _normalizedFieldNames['name'] || normalizeFieldName('name');

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;

            // Check if this row contains a name field using pre-computed alias map
            const hasNameField = row.some(cell => {
                if (!cell) return false;
                const normalized = normalizeFieldName(cell);
                return normalized === nameNormalized || _normalizedAliasToField[normalized] === 'name';
            });

            if (hasNameField) {
                headerRowIndex = i;
                headers = row;
                break;
            }
        }

        if (headerRowIndex === -1) {
            return { students: [], referenceDate: null };
        }

        // Pre-normalize all headers once for efficient column matching
        const normalizedHeaders = headers.map(h => h ? normalizeFieldName(h) : '');

        // Map column indices for all MASTER_LIST_COLUMNS using normalized field matching
        const columnMapping = {};
        MASTER_LIST_COLUMNS.forEach(col => {
            const index = findColumnIndex(normalizedHeaders, headers, col.field);
            if (index !== -1) {
                columnMapping[col.field] = index;
            }
            // Also check fallback field if it exists
            if (col.fallback && index === -1) {
                const fallbackIndex = findColumnIndex(normalizedHeaders, headers, col.fallback);
                if (fallbackIndex !== -1) {
                    columnMapping[col.field] = fallbackIndex;
                }
            }
        });

        // Ensure we have at least a name column
        if (!columnMapping.name) {
            return { students: [], referenceDate: null };
        }

        // Locate FinalNumericGrade column for internal use (Last Course Grade derivation)
        // This is not in MASTER_LIST_COLUMNS but needed during Academic report deduplication
        const finalGradeColIndex = normalizedHeaders.indexOf('finalnumericgrade');

        // Parse data rows
        let students = [];
        for (let i = headerRowIndex + 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;

            const studentName = row[columnMapping.name];
            if (!isValidStudentName(studentName)) continue;

            // Create entry with ONLY whitelisted columns from MASTER_LIST_COLUMNS
            const entry = {};

            // Map each MASTER_LIST_COLUMNS field to the imported data
            MASTER_LIST_COLUMNS.forEach(col => {
                const colIndex = columnMapping[col.field];
                if (colIndex !== undefined && colIndex < row.length) {
                    let value = row[colIndex];

                    // Special validation for grade field - only accept integers
                    if (col.field === 'grade' && value !== null && value !== undefined && value !== '') {
                        const gradeNum = Number(value);
                        if (isNaN(gradeNum) || !Number.isInteger(gradeNum)) {
                            console.log(`Student ${studentName}: Skipping invalid grade '${value}' (not an integer)`);
                            value = null; // Don't import invalid grade, but still import student
                        }
                    }

                    // Apply Excel date conversion to date fields
                    if (isDateField(col.field)) {
                        // Handle Date objects (from XLSX cellDates: true)
                        if (value instanceof Date) {
                            value = formatDateToMMDDYY(value);
                        } else {
                            // Handle Excel serial numbers
                            value = convertExcelDate(value);
                        }
                    }

                    // Clean program version by removing year prefix
                    if (col.field === 'programVersion' && value !== null && value !== undefined && value !== '') {
                        value = cleanProgramVersion(value);
                    }

                    // Clean phone numbers by removing trailing spaces and text
                    if ((col.field === 'phone' || col.field === 'otherPhone') && value !== null && value !== undefined && value !== '') {
                        value = cleanPhoneNumber(value);
                    }

                    // Use the field name from MASTER_LIST_COLUMNS definition
                    entry[col.field] = value !== null && value !== undefined ? value : null;
                }
            });

            // Ensure critical fields are present with proper types
            entry.name = String(studentName);
            if (entry.phone) entry.phone = String(entry.phone);
            if (entry.otherPhone) entry.otherPhone = String(entry.otherPhone);
            if (entry.grade) entry.grade = String(entry.grade);
            if (entry.StudentNumber) entry.StudentNumber = String(entry.StudentNumber);
            if (entry.SyStudentId) entry.SyStudentId = String(entry.SyStudentId);

            // Ensure LDA is stored as a string (handle Date objects that might slip through)
            if (entry.lda instanceof Date) {
                entry.lda = formatDateToMMDDYY(entry.lda);
            }

            // Calculate daysOut based on LDA if available, otherwise use imported value
            // Only set daysOut if lda or daysOut was actually in the report
            if (columnMapping.lda !== undefined || columnMapping.daysOut !== undefined) {
                const ldaValue = entry.lda;
                if (ldaValue && referenceDate) {
                    entry.daysOut = calculateDaysSinceLastAttendance(ldaValue, referenceDate);
                } else {
                    entry.daysOut = parseInt(entry.daysOut) || 0;
                }
            }

            // Store raw FinalNumericGrade for Last Course Grade derivation (internal only)
            if (finalGradeColIndex !== -1 && finalGradeColIndex < row.length) {
                const rawFinal = row[finalGradeColIndex];
                if (rawFinal !== null && rawFinal !== undefined && rawFinal !== '') {
                    entry._rawFinalGrade = String(rawFinal);
                }
            }

            students.push(entry);
        }

        // Detect Academic report and deduplicate by SyStudentId
        // Academic reports have multiple rows per student (one per course)
        const isAcademicReport = detectAcademicReport(normalizedHeaders);
        if (isAcademicReport && students.length > 0) {
            students = deduplicateAcademicStudents(students, referenceDate);
        }

        // Compute letter grades from any available numeric grades
        for (const student of students) {
            const gradeValue = student.grade || student.currentGrade;
            if (gradeValue) {
                student.letterGrade = numericToLetterGrade(gradeValue);
            }
        }

        // Trim common campus name prefix for cleaner display
        const campusValues = [...new Set(students.map(s => s.campus).filter(Boolean))];
        if (campusValues.length > 1) {
            // Multiple campuses - detect and trim common prefix
            const { trimmedNames, prefix } = trimCommonPrefix(campusValues);
            if (prefix) {
                for (const student of students) {
                    if (student.campus) {
                        student.campus = trimmedNames.get(student.campus) || student.campus;
                    }
                }
            }
        } else if (campusValues.length === 1) {
            // Single campus - trim prefix before separator (e.g. "Northbridge - South Miami" → "South Miami")
            const campus = campusValues[0];
            const sepMatch = campus.match(/\s[-–—:]\s/);
            if (sepMatch) {
                const trimmed = campus.substring(sepMatch.index + sepMatch[0].length).trim();
                if (trimmed) {
                    for (const student of students) {
                        if (student.campus === campus) {
                            student.campus = trimmed;
                        }
                    }
                }
            }
        }

        return { students, referenceDate };

    } catch (error) {
        console.error('Error parsing file with SheetJS:', error);
        throw new Error(`File parsing failed: ${error.message}`);
    }
}

/**
 * Updates the campus filter dropdown based on student data
 * @param {Array} students - Array of student objects
 */
export function updateCampusFilter(students) {
    const container = elements.campusFilterContainer;
    const select = elements.campusFilter;

    if (!container || !select) return;

    // Extract unique campus values (filter out empty/null values)
    const campuses = [...new Set(
        students
            .map(s => s.campus)
            .filter(c => c && c.trim() !== '')
    )].sort();

    // If no campuses found, hide the filter
    if (campuses.length === 0) {
        container.style.display = 'none';
        select.value = ''; // Reset selection
        return;
    }

    // Detect and trim common prefix for cleaner display names
    const { trimmedNames, prefix } = trimCommonPrefix(campuses);

    // Store campus list and detected prefix in storage for persistence
    chrome.storage.local.set({
        [STORAGE_KEYS.CAMPUS_LIST]: campuses,
        [STORAGE_KEYS.CAMPUS_PREFIX]: prefix
    });

    // Populate dropdown options (value = original name, display = trimmed name)
    select.innerHTML = '<option value="">All Campuses</option>';
    campuses.forEach(campus => {
        const option = document.createElement('option');
        option.value = campus;
        option.textContent = trimmedNames.get(campus) || campus;
        select.appendChild(option);
    });

    // Show the filter
    container.style.display = 'block';
}

/**
 * Hides and resets the campus filter dropdown
 */
export function hideCampusFilter() {
    const container = elements.campusFilterContainer;
    const select = elements.campusFilter;

    if (container) {
        container.style.display = 'none';
    }
    if (select) {
        select.innerHTML = '<option value="">All Campuses</option>';
        select.value = '';
    }

    // Clear stored campus list and prefix
    chrome.storage.local.remove([STORAGE_KEYS.CAMPUS_LIST, STORAGE_KEYS.CAMPUS_PREFIX]);
}

/**
 * Handles CSV/Excel file import
 * @param {File} file - The uploaded file
 * @param {Function} onSuccess - Callback after successful import
 */
export function handleFileImport(file, onSuccess) {
    if (!file) {
        resetQueueUI();
        return;
    }

    const step1 = document.getElementById('step1');
    const timeSpan = step1.querySelector('.step-time');
    const startTime = Date.now();

    // Store the overall process start time for total time calculation
    // Show total time from the start so user can track overall progress
    const queueTotalTimeDiv = document.getElementById('queueTotalTime');
    if (queueTotalTimeDiv) {
        queueTotalTimeDiv.dataset.processStartTime = startTime;
        queueTotalTimeDiv.textContent = 'Total Time: 0.0s';
        queueTotalTimeDiv.style.display = 'block';
    }

    const isCSV = file.name.toLowerCase().endsWith('.csv');
    const isXLSX = file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls');

    if (!isCSV && !isXLSX) {
        alert("Unsupported file type. Please use .csv or .xlsx files.");
        resetQueueUI();
        return;
    }

    const reader = new FileReader();

    reader.onload = function (e) {
        const content = e.target.result;
        let students = [];
        let referenceDate = null;

        try {
            // Pass file last modified time for daysOut calculation
            const result = parseFileWithSheetJS(content, isCSV, file.lastModified);
            students = result.students;
            referenceDate = result.referenceDate;

            if (students.length === 0) {
                throw new Error("No valid student data found (Check header row).");
            }

            // Update campus filter dropdown based on imported data
            updateCampusFilter(students);

            const lastUpdated = new Date().toLocaleString('en-US', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            chrome.storage.local.set({
                [STORAGE_KEYS.MASTER_ENTRIES]: students,
                [STORAGE_KEYS.LAST_UPDATED]: lastUpdated,
                [STORAGE_KEYS.REFERENCE_DATE]: referenceDate ? referenceDate.toISOString() : null
            }, async () => {
                const durationSeconds = (Date.now() - startTime) / 1000;
                step1.className = 'queue-item completed';
                updateStepIcon(step1, 'check');
                timeSpan.textContent = formatDuration(durationSeconds);

                // Update total time counter
                updateTotalTime();

                if (elements.lastUpdatedText) {
                    elements.lastUpdatedText.textContent = lastUpdated;
                }

                if (onSuccess) {
                    onSuccess(students);
                }
            });

        } catch (error) {
            console.error("Error parsing file:", error);
            updateStepIcon(step1, 'error');
            step1.style.color = '#ef4444';
            timeSpan.textContent = 'Error: ' + error.message;
        }

        elements.studentPopFile.value = '';
    };

    if (isCSV) {
        reader.readAsText(file);
    } else if (isXLSX) {
        reader.readAsArrayBuffer(file);
    }
}

/**
 * Resets the queue UI to default state
 */
export function resetQueueUI() {
    const steps = ['step1', 'step2', 'step3', 'step4'];
    steps.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.className = 'queue-item';
        updateStepIcon(el, 'pending');
        el.querySelector('.step-time').textContent = '';
        el.style.color = '';
    });
    const totalTimeDisplay = document.getElementById('queueTotalTime');
    if (totalTimeDisplay) {
        totalTimeDisplay.style.display = 'none';
        totalTimeDisplay.textContent = 'Total Time: 0.0s';
        delete totalTimeDisplay.dataset.processStartTime;
    }
}

/**
 * Restores default queue UI for CSV import
 */
export async function restoreDefaultQueueUI() {
    const s1 = document.getElementById('step1');
    const s2 = document.getElementById('step2');
    const s3 = document.getElementById('step3');
    const s4 = document.getElementById('step4');

    if (s1) {
        s1.style.display = '';
        s1.querySelector('.queue-content').innerHTML = '<i class="far fa-circle"></i> Student Population Report';
    }
    if (s2) { s2.style.display = ''; }
    if (s3) { s3.style.display = ''; }
    if (s4) {
        const settings = await chrome.storage.local.get([STORAGE_KEYS.SEND_MASTER_LIST_TO_EXCEL]);
        const sendEnabled = settings[STORAGE_KEYS.SEND_MASTER_LIST_TO_EXCEL] !== undefined
            ? settings[STORAGE_KEYS.SEND_MASTER_LIST_TO_EXCEL]
            : true;
        s4.style.display = sendEnabled ? '' : 'none';
        s4.querySelector('.queue-content').innerHTML = '<i class="far fa-circle"></i> Sending List to Excel';
    }
}

/**
 * Helper function to get nested property value from an object
 */
function getNestedValue(obj, path) {
    return path.split('.').reduce((current, prop) => current?.[prop], obj);
}

/**
 * Finds a field value in an object using normalized matching and aliases.
 * Uses pre-computed alias map for O(1) lookups instead of re-normalizing aliases each call.
 *
 * @param {Object} obj - The object to search in
 * @param {String} fieldName - The internal field name
 * @param {*} defaultValue - Default value if field not found
 * @returns {*} The field value or defaultValue
 */
function getFieldWithAlias(obj, fieldName, defaultValue = null) {
    if (!obj || !fieldName) return defaultValue;

    // Fast path: direct property access (covers most cases after parsing)
    if (fieldName in obj) {
        const value = obj[fieldName];
        return value !== null && value !== undefined ? value : defaultValue;
    }

    // Slow path: normalized matching using pre-computed alias map
    const normalizedFieldName = _normalizedFieldNames[fieldName] || normalizeFieldName(fieldName);

    for (const key in obj) {
        const normalizedKey = normalizeFieldName(key);
        // Check direct normalized match or alias match
        if (normalizedKey === normalizedFieldName || _normalizedAliasToField[normalizedKey] === fieldName) {
            const value = obj[key];
            return value !== null && value !== undefined ? value : defaultValue;
        }
    }

    return defaultValue;
}

/**
 * Helper function to get field value with fallback support
 * Now uses alias-based matching for better field resolution
 * Supports nested field access with dot notation (e.g., 'nextAssignment.DueDate')
 */
function getFieldValue(obj, field, fallback) {
    let value;

    // Check for nested field access (dot notation)
    if (field && field.includes('.')) {
        value = getNestedValue(obj, field);
    } else {
        value = getFieldWithAlias(obj, field);
    }

    if ((value === null || value === undefined || value === '') && fallback) {
        if (fallback.includes('.')) {
            value = getNestedValue(obj, fallback);
        } else {
            value = getFieldWithAlias(obj, fallback);
        }
    }
    return value !== null && value !== undefined ? value : '';
}

/**
 * Writes an XLSX buffer to a file with Excel features injected via JSZip.
 * Post-processes the XLSX ZIP to add:
 *   - Conditional formatting (Green-Yellow-Red color scale on grade columns)
 *   - Tab colors for sheet tabs
 *
 * @param {ArrayBuffer} wbBuffer - The XLSX workbook as an ArrayBuffer
 * @param {string} filename - Output filename
 * @param {Array} condFmtSheets - Array of {sheetIndex, colIndex, rowCount}
 * @param {Array} tabColors - Array of {sheetIndex, rgb} for sheet tab colors
 */
async function writeXlsxWithConditionalFormatting(wbBuffer, filename, condFmtSheets, tabColors = []) {
    if (condFmtSheets.length === 0 && tabColors.length === 0) {
        const blob = new Blob([wbBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        downloadBlob(blob, filename);
        return;
    }

    const zip = await JSZip.loadAsync(wbBuffer);

    // Collect all sheet indices that need modification
    const sheetsToModify = new Set([
        ...condFmtSheets.map(s => s.sheetIndex),
        ...tabColors.map(s => s.sheetIndex)
    ]);

    for (const sheetIndex of sheetsToModify) {
        const sheetPath = `xl/worksheets/sheet${sheetIndex + 1}.xml`;
        let xml = await zip.file(sheetPath)?.async('string');
        if (!xml) continue;

        // --- Tab Color ---
        // <sheetPr> must appear before <dimension>/<sheetViews> per OOXML schema
        const tabColor = tabColors.find(t => t.sheetIndex === sheetIndex);
        if (tabColor) {
            const tabColorTag = `<tabColor rgb="${tabColor.rgb}"/>`;

            if (/<sheetPr[^>]*\/>/.test(xml)) {
                // Self-closing <sheetPr/> — expand to contain tabColor
                xml = xml.replace(/<sheetPr([^>]*)\/>/,
                    `<sheetPr$1>${tabColorTag}</sheetPr>`);
            } else if (/<sheetPr[^>]*>/.test(xml)) {
                // Opening <sheetPr> with children — insert tabColor as first child
                xml = xml.replace(/<sheetPr([^>]*)>/,
                    `<sheetPr$1>${tabColorTag}`);
            } else {
                // No <sheetPr> exists — insert before first structural element
                const anchor = ['<dimension', '<sheetViews', '<sheetFormatPr', '<sheetData']
                    .find(tag => xml.includes(tag));
                if (anchor) {
                    xml = xml.replace(anchor, `<sheetPr>${tabColorTag}</sheetPr>${anchor}`);
                }
            }
        }

        // --- Conditional Formatting ---
        // Must appear after <mergeCells> but before <hyperlinks>/<pageMargins>
        const condFmt = condFmtSheets.find(c => c.sheetIndex === sheetIndex);
        if (condFmt) {
            const colLetter = columnIndexToLetter(condFmt.colIndex);
            const sqref = `${colLetter}2:${colLetter}${condFmt.rowCount + 1}`;

            const cfXml =
                `<conditionalFormatting sqref="${sqref}">` +
                    `<cfRule type="colorScale" priority="1">` +
                        `<colorScale>` +
                            `<cfvo type="num" val="0"/>` +
                            `<cfvo type="num" val="65"/>` +
                            `<cfvo type="num" val="100"/>` +
                            `<color rgb="FFF8696B"/>` +
                            `<color rgb="FFFFEB84"/>` +
                            `<color rgb="FF63BE7B"/>` +
                        `</colorScale>` +
                    `</cfRule>` +
                `</conditionalFormatting>`;

            // Insert right after </sheetData> (or after </mergeCells> if present)
            // SheetJS generates <ignoredErrors> after </sheetData>, and
            // conditionalFormatting must appear before it per OOXML schema.
            if (xml.includes('</mergeCells>')) {
                xml = xml.replace('</mergeCells>', '</mergeCells>' + cfXml);
            } else if (xml.includes('</sheetData>')) {
                xml = xml.replace('</sheetData>', '</sheetData>' + cfXml);
            }
        }

        zip.file(sheetPath, xml);
    }

    const modifiedBuffer = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(modifiedBuffer, filename);
}

/**
 * Converts a 0-based column index to an Excel column letter (0='A', 25='Z', 26='AA').
 */
function columnIndexToLetter(index) {
    let letter = '';
    let i = index;
    while (i >= 0) {
        letter = String.fromCharCode((i % 26) + 65) + letter;
        i = Math.floor(i / 26) - 1;
    }
    return letter;
}

/**
 * Triggers a browser download for a Blob.
 */
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Calculates column widths based on custom width or auto-fit
 * @param {Array} columns - Column configuration array (e.g., MASTER_LIST_COLUMNS)
 * @param {Array} data - Data rows (including header row)
 * @returns {Array} Array of column width objects { wch: number }
 */
function calculateColumnWidths(columns, data) {
    const colWidths = [];

    for (let i = 0; i < columns.length; i++) {
        const col = columns[i];

        // Use custom width if specified
        if (col.width !== undefined && col.width !== null) {
            colWidths.push({ wch: col.width });
        } else {
            // Auto-fit based on content
            let maxWidth = col.header.length;
            for (let j = 1; j < data.length; j++) {
                const cellValue = data[j][i];
                if (cellValue) {
                    const cellLength = String(cellValue).length;
                    maxWidth = Math.max(maxWidth, cellLength);
                }
            }
            // Add some padding and cap at reasonable max
            colWidths.push({ wch: Math.min(maxWidth + 2, 50) });
        }
    }

    return colWidths;
}

/**
 * Exports master list to Excel file with three sheets
 */
export async function exportMasterListCSV() {
    try {
        const result = await chrome.storage.local.get([
            STORAGE_KEYS.MASTER_ENTRIES,
            STORAGE_KEYS.REFERENCE_DATE
        ]);
        const students = result[STORAGE_KEYS.MASTER_ENTRIES] || [];
        const referenceDateStr = result[STORAGE_KEYS.REFERENCE_DATE];
        const referenceDate = referenceDateStr ? new Date(referenceDateStr) : new Date();

        if (students.length === 0) {
            alert('No data to export. Please update the master list first.');
            return;
        }

        // Only include columns where at least one student has data
        const activeColumns = MASTER_LIST_COLUMNS.filter(col => {
            return students.some(student => {
                const value = getFieldValue(student, col.field, col.fallback);
                return value !== null && value !== undefined && value !== '';
            });
        });

        // --- SHEET 1: MASTER LIST ---
        const masterListHeaders = activeColumns.map(col => col.header);
        const masterListData = [masterListHeaders];
        const masterListHyperlinkMetadata = []; // Store hyperlink info for each row

        students.forEach(student => {
            const rowMetadata = {}; // Store hyperlink info for this row
            const row = activeColumns.map((col, colIndex) => {
                let value = getFieldValue(student, col.field, col.fallback);

                if (col.field === 'missingCount') {
                    value = value || 0;
                } else if (col.field === 'daysOut') {
                    value = parseInt(value || 0);
                } else if (col.field === 'lda') {
                    if (value) {
                        // Format LDA dates to MM-DD-YY format
                        const dateObj = parseDate(value);
                        if (dateObj) {
                            value = formatDateToMMDDYY(dateObj);
                        }
                    }
                }

                // Store hyperlink metadata for this column
                if (col.hyperlink && col.hyperlinkText && value) {
                    rowMetadata[colIndex] = { url: value, text: col.hyperlinkText };
                }

                return value;
            });
            masterListData.push(row);
            masterListHyperlinkMetadata.push(rowMetadata);
        });

        // --- SHEET 2: MISSING ASSIGNMENTS ---
        const missingAssignmentsHeaders = EXPORT_MISSING_ASSIGNMENTS_COLUMNS.map(col => col.header);
        const missingAssignmentsData = [missingAssignmentsHeaders];
        const hyperlinkMetadata = []; // Store hyperlink info for each row

        students.forEach(student => {
            if (student.missingAssignments && student.missingAssignments.length > 0) {
                student.missingAssignments.forEach(assignment => {
                    // Normalize assignment fields for export
                    // Handle both old (title, assignmentUrl, submissionUrl) and new (assignmentTitle, assignmentLink, submissionLink) field names
                    const normalizedAssignment = {
                        ...assignment,
                        assignmentTitle: assignment.assignmentTitle || assignment.title || '',
                        assignmentLink: assignment.assignmentLink || assignment.assignmentUrl || '',
                        submissionLink: assignment.submissionLink || assignment.submissionUrl || ''
                    };

                    // If assignmentLink is not set but submissionLink is, derive it
                    if (!normalizedAssignment.assignmentLink && normalizedAssignment.submissionLink) {
                        normalizedAssignment.assignmentLink = normalizedAssignment.submissionLink.replace(/\/submissions\/.*$/, '');
                    }

                    const rowMetadata = {}; // Store hyperlink info for this row
                    const row = EXPORT_MISSING_ASSIGNMENTS_COLUMNS.map((col, colIndex) => {
                        let value = '';
                        if (col.field.startsWith('student.')) {
                            const field = col.field.replace('student.', '');
                            value = getFieldValue(student, field, col.fallback?.replace('student.', ''));
                        } else if (col.field.startsWith('assignment.')) {
                            const field = col.field.replace('assignment.', '');
                            value = getFieldValue(normalizedAssignment, field, col.fallback?.replace('assignment.', ''));
                        }

                        // Store hyperlink metadata for this column
                        if (col.hyperlink) {
                            if (col.hyperlinkField) {
                                // Assignment column: use assignmentLink as URL and assignmentTitle as text
                                const linkField = col.hyperlinkField.replace('assignment.', '');
                                const url = getFieldValue(normalizedAssignment, linkField);
                                rowMetadata[colIndex] = { url: url, text: value };
                            } else if (col.hyperlinkText) {
                                // Fixed text columns: Grade Book and Submission
                                rowMetadata[colIndex] = { url: value, text: col.hyperlinkText };
                            }
                        }

                        return value;
                    });
                    missingAssignmentsData.push(row);
                    hyperlinkMetadata.push(rowMetadata);
                });
            }
        });

        // Create workbook with both sheets
        const wb = XLSX.utils.book_new();
        const ws1 = XLSX.utils.aoa_to_sheet(masterListData);
        const ws2 = XLSX.utils.aoa_to_sheet(missingAssignmentsData);

        // Add HYPERLINK formulas to Master List sheet
        masterListHyperlinkMetadata.forEach((rowMeta, rowIndex) => {
            Object.entries(rowMeta).forEach(([colIndex, linkData]) => {
                const cellAddress = XLSX.utils.encode_cell({ r: rowIndex + 1, c: parseInt(colIndex) }); // +1 to skip header row
                if (ws1[cellAddress] && linkData.url) {
                    // Create HYPERLINK formula: =HYPERLINK("url", "text")
                    const escapedUrl = linkData.url.replace(/"/g, '""'); // Escape quotes in URL
                    const escapedText = String(linkData.text || 'Link').replace(/"/g, '""'); // Escape quotes in text
                    ws1[cellAddress] = {
                        t: 'f',
                        f: `HYPERLINK("${escapedUrl}","${escapedText}")`,
                        v: linkData.text || 'Link'
                    };
                }
            });
        });

        // Add HYPERLINK formulas to Missing Assignments sheet
        hyperlinkMetadata.forEach((rowMeta, rowIndex) => {
            Object.entries(rowMeta).forEach(([colIndex, linkData]) => {
                const cellAddress = XLSX.utils.encode_cell({ r: rowIndex + 1, c: parseInt(colIndex) }); // +1 to skip header row
                if (ws2[cellAddress] && linkData.url) {
                    // Create HYPERLINK formula: =HYPERLINK("url", "text")
                    const escapedUrl = linkData.url.replace(/"/g, '""'); // Escape quotes in URL
                    const escapedText = String(linkData.text || 'Link').replace(/"/g, '""'); // Escape quotes in text
                    ws2[cellAddress] = {
                        t: 'f',
                        f: `HYPERLINK("${escapedUrl}","${escapedText}")`,
                        v: linkData.text || 'Link'
                    };
                }
            });
        });

        // Find Grade column indices for conditional formatting
        const gradeColIndex = activeColumns.findIndex(col => col.conditionalFormatting === 'grade');
        const missingGradeColIndex = EXPORT_MISSING_ASSIGNMENTS_COLUMNS.findIndex(col => col.conditionalFormatting === 'grade');

        // Build list of {sheetIndex, colIndex, rowCount} for conditional formatting injection
        const condFmtSheets = [];
        if (gradeColIndex !== -1 && students.length > 0) {
            condFmtSheets.push({ sheetIndex: 0, colIndex: gradeColIndex, rowCount: students.length });
        }
        if (missingGradeColIndex !== -1 && missingAssignmentsData.length > 1) {
            condFmtSheets.push({ sheetIndex: 1, colIndex: missingGradeColIndex, rowCount: missingAssignmentsData.length - 1 });
        }

        // Set column widths for Master List (custom or auto-fit)
        ws1['!cols'] = calculateColumnWidths(activeColumns, masterListData);

        // Set column widths for Missing Assignments (custom or auto-fit)
        ws2['!cols'] = calculateColumnWidths(EXPORT_MISSING_ASSIGNMENTS_COLUMNS, missingAssignmentsData);

        // --- SHEET 3: LDA (Filtered and Sorted Master List) ---
        // Filter students by daysOut >= 5
        const filteredStudents = students.filter(student => {
            const daysOut = parseInt(student.daysOut || 0);
            return daysOut >= 5;
        });

        // Sort by daysOut from highest to lowest
        filteredStudents.sort((a, b) => {
            const daysOutA = parseInt(a.daysOut || 0);
            const daysOutB = parseInt(b.daysOut || 0);
            return daysOutB - daysOutA; // Descending order
        });

        // Create LDA sheet data using the same active columns as Master List
        const ldaHeaders = activeColumns.map(col => col.header);
        const ldaData = [ldaHeaders];
        const ldaHyperlinkMetadata = []; // Store hyperlink info for each row

        filteredStudents.forEach(student => {
            const rowMetadata = {}; // Store hyperlink info for this row
            const row = activeColumns.map((col, colIndex) => {
                let value = getFieldValue(student, col.field, col.fallback);

                if (col.field === 'missingCount') {
                    value = value || 0;
                } else if (col.field === 'daysOut') {
                    value = parseInt(value || 0);
                } else if (col.field === 'lda') {
                    if (value) {
                        // Format LDA dates to MM-DD-YY format
                        const dateObj = parseDate(value);
                        if (dateObj) {
                            value = formatDateToMMDDYY(dateObj);
                        }
                    }
                }

                // Store hyperlink metadata for this column
                if (col.hyperlink && col.hyperlinkText && value) {
                    rowMetadata[colIndex] = { url: value, text: col.hyperlinkText };
                }

                return value;
            });
            ldaData.push(row);
            ldaHyperlinkMetadata.push(rowMetadata);
        });

        // Create worksheet for LDA sheet
        const ws3 = XLSX.utils.aoa_to_sheet(ldaData);

        // Add HYPERLINK formulas to LDA sheet
        ldaHyperlinkMetadata.forEach((rowMeta, rowIndex) => {
            Object.entries(rowMeta).forEach(([colIndex, linkData]) => {
                const cellAddress = XLSX.utils.encode_cell({ r: rowIndex + 1, c: parseInt(colIndex) }); // +1 to skip header row
                if (ws3[cellAddress] && linkData.url) {
                    // Create HYPERLINK formula: =HYPERLINK("url", "text")
                    const escapedUrl = linkData.url.replace(/"/g, '""'); // Escape quotes in URL
                    const escapedText = String(linkData.text || 'Link').replace(/"/g, '""'); // Escape quotes in text
                    ws3[cellAddress] = {
                        t: 'f',
                        f: `HYPERLINK("${escapedUrl}","${escapedText}")`,
                        v: linkData.text || 'Link'
                    };
                }
            });
        });

        // Set column widths for LDA sheet (custom or auto-fit)
        ws3['!cols'] = calculateColumnWidths(activeColumns, ldaData);

        // Hide columns not in LDA_VISIBLE_COLUMNS whitelist (applied after width calculation)
        activeColumns.forEach((col, i) => {
            if (!LDA_VISIBLE_COLUMNS.includes(col.field)) {
                if (!ws3['!cols'][i]) ws3['!cols'][i] = {};
                ws3['!cols'][i].hidden = true;
            }
        });

        // Add LDA sheet conditional formatting (same grade column as Master List)
        if (gradeColIndex !== -1 && filteredStudents.length > 0) {
            condFmtSheets.push({ sheetIndex: 2, colIndex: gradeColIndex, rowCount: filteredStudents.length });
        }

        // Create sheet name with reference date formatted as MM-DD-YYYY
        const ldaMonth = String(referenceDate.getMonth() + 1).padStart(2, '0');
        const ldaDay = String(referenceDate.getDate()).padStart(2, '0');
        const ldaYear = String(referenceDate.getFullYear());
        const ldaSheetName = `LDA ${ldaMonth}-${ldaDay}-${ldaYear}`;

        XLSX.utils.book_append_sheet(wb, ws1, 'Master List');
        XLSX.utils.book_append_sheet(wb, ws2, 'Missing Assignments');
        XLSX.utils.book_append_sheet(wb, ws3, ldaSheetName);

        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `student_report_${timestamp}.xlsx`;

        // Sheet tab colors
        const tabColors = [
            { sheetIndex: 0, rgb: 'FFFFC000' }  // Master List — light orange
        ];

        // Write workbook to buffer, then inject conditional formatting and tab colors via JSZip
        const wbBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
        await writeXlsxWithConditionalFormatting(wbBuffer, filename, condFmtSheets, tabColors);

        console.log(`✓ Exported ${students.length} students to Excel file: ${filename}`);
        console.log(`  - Master List: ${students.length} students`);
        console.log(`  - Missing Assignments: ${missingAssignmentsData.length - 1} assignments`);
        console.log(`  - ${ldaSheetName}: ${filteredStudents.length} students (Days Out >= 5)`);

    } catch (error) {
        console.error('Error exporting to Excel:', error);
        alert('Error creating Excel file. Check console for details.');
    }
}
