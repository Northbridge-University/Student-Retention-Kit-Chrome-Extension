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
    formatFriendlyDate,
    trimCommonPrefix,
    numericToLetterGrade
} from '../constants/field-utils.js';
import { storageGet } from '../utils/storage.js';
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
 * Reads a File object and returns its content as a Promise.
 * @param {File} file - The file to read
 * @returns {Promise<{content: *, isCSV: boolean}>}
 */
function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const isCSV = file.name.toLowerCase().endsWith('.csv');
        const reader = new FileReader();
        reader.onload = (e) => resolve({ content: e.target.result, isCSV });
        reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
        if (isCSV) {
            reader.readAsText(file);
        } else {
            reader.readAsArrayBuffer(file);
        }
    });
}

/**
 * Merges additional columns from a supplementary file into existing students.
 * Matches students by SyStudentId, falling back to StudentNumber.
 * Only adds columns that don't already exist in the primary data.
 *
 * @param {Array} students - Primary student array to merge into (mutated)
 * @param {*} data - Raw file content from FileReader
 * @param {boolean} isCSV - Whether the supplementary file is CSV
 */
function mergeSupplementaryFile(students, data, isCSV) {
    if (!students.length) return;

    let workbook;
    if (isCSV) {
        workbook = XLSX.read(data, { type: 'string' });
    } else {
        workbook = XLSX.read(data, { type: 'array', cellDates: true });
    }

    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
    if (rows.length < 2) return;

    // Find header row using 'name' field (same logic as primary parser)
    const nameNormalized = _normalizedFieldNames['name'] || normalizeFieldName('name');
    let headerRowIndex = -1;
    let headers = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;
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
    if (headerRowIndex === -1) return;

    const normalizedHeaders = headers.map(h => h ? normalizeFieldName(h) : '');

    // Determine which columns in the supplementary file are "extra" (not in primary data)
    // Check which MASTER_LIST_COLUMNS fields the primary students already have data for
    const primaryFields = new Set();
    for (const col of MASTER_LIST_COLUMNS) {
        if (students.some(s => s[col.field] !== null && s[col.field] !== undefined)) {
            primaryFields.add(col.field);
        }
    }

    // Find supplementary columns that map to MASTER_LIST_COLUMNS fields missing from primary
    const extraColumnMapping = {};
    MASTER_LIST_COLUMNS.forEach(col => {
        if (primaryFields.has(col.field)) return; // Primary already has this column
        const index = findColumnIndex(normalizedHeaders, headers, col.field);
        if (index !== -1) {
            extraColumnMapping[col.field] = index;
        } else if (col.fallback) {
            const fallbackIndex = findColumnIndex(normalizedHeaders, headers, col.fallback);
            if (fallbackIndex !== -1) {
                extraColumnMapping[col.field] = fallbackIndex;
            }
        }
    });

    if (Object.keys(extraColumnMapping).length === 0) return; // No extra columns to merge

    // Find identifier columns in the supplementary file
    // Priority: SyStudentId > StudentNumber
    const suppSyStudentIdCol = findColumnIndex(normalizedHeaders, headers, 'SyStudentId');
    const suppStudentNumberCol = findColumnIndex(normalizedHeaders, headers, 'StudentNumber');

    if (suppSyStudentIdCol === -1 && suppStudentNumberCol === -1) return; // No way to match

    // Build lookup maps from primary students for matching
    // Priority order: SyStudentId, then StudentNumber as fallback
    const bySyStudentId = new Map();
    const byStudentNumber = new Map();
    for (const student of students) {
        if (student.SyStudentId) bySyStudentId.set(String(student.SyStudentId), student);
        if (student.StudentNumber) byStudentNumber.set(String(student.StudentNumber), student);
    }

    // Parse supplementary data rows and merge extra columns
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        // Match to a primary student using identifier priority
        let student = null;
        if (suppSyStudentIdCol !== -1 && row[suppSyStudentIdCol]) {
            student = bySyStudentId.get(String(row[suppSyStudentIdCol]));
        }
        if (!student && suppStudentNumberCol !== -1 && row[suppStudentNumberCol]) {
            student = byStudentNumber.get(String(row[suppStudentNumberCol]));
        }

        if (!student) continue;

        // Merge extra columns into the matched student
        for (const [field, colIndex] of Object.entries(extraColumnMapping)) {
            if (colIndex < row.length) {
                let value = row[colIndex];
                if (value !== null && value !== undefined) {
                    student[field] = value;
                }
            }
        }
    }
}

/**
 * Handles CSV/Excel file import (supports multiple files)
 * @param {File|FileList|Array} files - The uploaded file(s)
 * @param {Function} onSuccess - Callback after successful import
 */
export function handleFileImport(files, onSuccess) {
    // Support both single File and FileList/Array
    const fileList = files instanceof FileList ? Array.from(files) : (Array.isArray(files) ? files : [files]);
    const file = fileList[0];
    const supplementaryFile = fileList.length > 1 ? fileList[1] : null;

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

    (async () => {
        try {
            // Read and parse the primary file
            const { content, isCSV: primaryIsCSV } = await readFileContent(file);
            const result = parseFileWithSheetJS(content, primaryIsCSV, file.lastModified);
            let students = result.students;
            const referenceDate = result.referenceDate;

            if (students.length === 0) {
                throw new Error("No valid student data found (Check header row).");
            }

            // If a supplementary file was selected, merge its extra columns
            if (supplementaryFile) {
                const suppName = supplementaryFile.name.toLowerCase();
                const suppIsValid = suppName.endsWith('.csv') || suppName.endsWith('.xlsx') || suppName.endsWith('.xls');
                if (suppIsValid) {
                    const { content: suppContent, isCSV: suppIsCSV } = await readFileContent(supplementaryFile);
                    mergeSupplementaryFile(students, suppContent, suppIsCSV);
                }
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
    })();
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
 *   - Row fill highlights (e.g. light green for outreach rows)
 *
 * @param {ArrayBuffer} wbBuffer - The XLSX workbook as an ArrayBuffer
 * @param {string} filename - Output filename
 * @param {Array} condFmtSheets - Array of {sheetIndex, colIndex, rowCount}
 * @param {Array} tabColors - Array of {sheetIndex, rgb} for sheet tab colors
 * @param {Object} colorScale - {low, mid, high} ARGB strings for grade color scale
 * @param {Array} rowHighlights - Array of {sheetIndex, rows: number[], startCol, endCol, fillColor}
 * @param {Array} cellValueFmts - Array of {sheetIndex, colIndex, rowCount, value, fillColor} for cell-value conditional formatting
 * @param {Array} tableMetadata - Array of {sheetIndex, displayName, columns, dataRowCount} for Excel tables
 */
async function writeXlsxWithConditionalFormatting(wbBuffer, filename, condFmtSheets, tabColors = [], colorScale = {}, rowHighlights = [], cellValueFmts = [], tableMetadata = []) {
    if (condFmtSheets.length === 0 && tabColors.length === 0 && rowHighlights.length === 0 && cellValueFmts.length === 0 && tableMetadata.length === 0) {
        const blob = new Blob([wbBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        downloadBlob(blob, filename);
        return;
    }

    const zip = await JSZip.loadAsync(wbBuffer);

    // --- Inject Excel tables (ListObject / structured tables) ---
    if (tableMetadata.length > 0) {
        await injectExcelTables(zip, tableMetadata);
    }

    // --- Inject fill styles into styles.xml for row highlights and cell-value formatting ---
    // Maps fillColor ARGB → the xfId (s="N") to use in sheet cells
    const fillStyleMap = {};
    const allFillColors = [
        ...rowHighlights.map(h => h.fillColor),
        ...cellValueFmts.map(c => c.fillColor)
    ];
    const uniqueColors = [...new Set(allFillColors)];
    if (uniqueColors.length > 0) {
        await injectFillStyles(zip, uniqueColors, fillStyleMap);
    }

    // --- Inject dxf entries into styles.xml for cell-value conditional formatting ---
    if (cellValueFmts.length > 0) {
        await injectDxfStyles(zip, cellValueFmts);
    }

    // Collect all sheet indices that need modification
    const sheetsToModify = new Set([
        ...condFmtSheets.map(s => s.sheetIndex),
        ...tabColors.map(s => s.sheetIndex),
        ...rowHighlights.map(s => s.sheetIndex),
        ...cellValueFmts.map(s => s.sheetIndex)
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

        // --- Row Highlights (fill) ---
        // Apply in order so later highlights override earlier ones (lowest priority first)
        const highlightsForSheet = rowHighlights.filter(h => h.sheetIndex === sheetIndex);
        for (const highlight of highlightsForSheet) {
            xml = applyRowHighlights(xml, highlight, fillStyleMap);
        }

        // --- Conditional Formatting (color scale for grade/gpa columns) ---
        // Must appear after <mergeCells> but before <hyperlinks>/<pageMargins>
        // Scale presets by type
        const COLOR_SCALE_PRESETS = {
            grade: { minVal: 0, midVal: 65, maxVal: 100, low: 'FFF8696B', mid: 'FFFFEB84', high: 'FF63BE7B' },
            gpa:   { minVal: 0, midVal: 2,  maxVal: 4,   low: 'FFFFC7CE', mid: 'FF9BC2E6', high: 'FFC6EFCE' }
        };
        const condFmtsForSheet = condFmtSheets.filter(c => c.sheetIndex === sheetIndex);
        for (const condFmt of condFmtsForSheet) {
            const colLetter = columnIndexToLetter(condFmt.colIndex);
            const sqref = `${colLetter}2:${colLetter}${condFmt.rowCount + 1}`;

            const preset = COLOR_SCALE_PRESETS[condFmt.type] || COLOR_SCALE_PRESETS.grade;
            // Only apply user color-scale overrides to grade columns; GPA uses its own preset
            const csLow = condFmt.type === 'gpa' ? preset.low : (colorScale.low || preset.low);
            const csMid = condFmt.type === 'gpa' ? preset.mid : (colorScale.mid || preset.mid);
            const csHigh = condFmt.type === 'gpa' ? preset.high : (colorScale.high || preset.high);

            const cfXml =
                `<conditionalFormatting sqref="${sqref}">` +
                    `<cfRule type="colorScale" priority="1">` +
                        `<colorScale>` +
                            `<cfvo type="num" val="${preset.minVal}"/>` +
                            `<cfvo type="num" val="${preset.midVal}"/>` +
                            `<cfvo type="num" val="${preset.maxVal}"/>` +
                            `<color rgb="${csLow}"/>` +
                            `<color rgb="${csMid}"/>` +
                            `<color rgb="${csHigh}"/>` +
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

        // --- Cell-Value Conditional Formatting (e.g. Missing Assignments = 0 → green) ---
        const cellValFmtsForSheet = cellValueFmts.filter(c => c.sheetIndex === sheetIndex);
        for (const cvf of cellValFmtsForSheet) {
            const colLetter = columnIndexToLetter(cvf.colIndex);
            const sqref = `${colLetter}2:${colLetter}${cvf.rowCount + 1}`;
            const dxfIndex = cvf._dxfIndex;

            const cvfXml =
                `<conditionalFormatting sqref="${sqref}">` +
                    `<cfRule type="cellIs" dxfId="${dxfIndex}" priority="2" operator="equal">` +
                        `<formula>${cvf.value}</formula>` +
                    `</cfRule>` +
                `</conditionalFormatting>`;

            // Insert after last </conditionalFormatting>, or after </sheetData>
            const lastCfIdx = xml.lastIndexOf('</conditionalFormatting>');
            if (lastCfIdx !== -1) {
                const insertPos = lastCfIdx + '</conditionalFormatting>'.length;
                xml = xml.slice(0, insertPos) + cvfXml + xml.slice(insertPos);
            } else if (xml.includes('</sheetData>')) {
                xml = xml.replace('</sheetData>', '</sheetData>' + cvfXml);
            }
        }

        zip.file(sheetPath, xml);
    }

    const modifiedBuffer = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(modifiedBuffer, filename);
}

/**
 * Injects custom fill definitions into xl/styles.xml and creates new cellXfs entries
 * that reference those fills. Populates fillStyleMap with fillColor → xfId.
 *
 * @param {JSZip} zip - The JSZip instance
 * @param {string[]} colors - Array of ARGB color strings (e.g. 'FFE2EFDA')
 * @param {Object} fillStyleMap - Output map: color → s attribute value (xfId string)
 */
async function injectFillStyles(zip, colors, fillStyleMap) {
    const stylesPath = 'xl/styles.xml';
    let stylesXml = await zip.file(stylesPath)?.async('string');
    if (!stylesXml) return;

    // --- Add fills ---
    // Find current fill count and insert new fills before </fills>
    const fillCountMatch = stylesXml.match(/<fills count="(\d+)">/);
    if (!fillCountMatch) return;
    let fillCount = parseInt(fillCountMatch[1]);

    const newFillIndices = [];
    let newFillsXml = '';
    for (const color of colors) {
        newFillsXml += `<fill><patternFill patternType="solid"><fgColor rgb="${color}"/><bgColor indexed="64"/></patternFill></fill>`;
        newFillIndices.push(fillCount);
        fillCount++;
    }

    stylesXml = stylesXml.replace(
        /<fills count="\d+">/,
        `<fills count="${fillCount}">`
    );
    stylesXml = stylesXml.replace('</fills>', newFillsXml + '</fills>');

    // --- Add cellXfs (cell format) entries referencing the new fills ---
    const xfCountMatch = stylesXml.match(/<cellXfs count="(\d+)">/);
    if (!xfCountMatch) return;
    let xfCount = parseInt(xfCountMatch[1]);

    let newXfsXml = '';
    for (let i = 0; i < colors.length; i++) {
        const fillIdx = newFillIndices[i];
        fillStyleMap[colors[i]] = String(xfCount);
        newXfsXml += `<xf numFmtId="0" fontId="0" fillId="${fillIdx}" borderId="0" xfId="0" applyFill="1"/>`;
        xfCount++;
    }

    stylesXml = stylesXml.replace(
        /<cellXfs count="\d+">/,
        `<cellXfs count="${xfCount}">`
    );
    stylesXml = stylesXml.replace('</cellXfs>', newXfsXml + '</cellXfs>');

    zip.file(stylesPath, stylesXml);
}

/**
 * Injects differential formatting (dxf) entries into xl/styles.xml for
 * cell-value conditional formatting rules. Sets _dxfIndex on each entry.
 *
 * @param {JSZip} zip - The JSZip instance
 * @param {Array} cellValueFmts - Array of {fillColor, ...}; _dxfIndex is set on each
 */
async function injectDxfStyles(zip, cellValueFmts) {
    const stylesPath = 'xl/styles.xml';
    let stylesXml = await zip.file(stylesPath)?.async('string');
    if (!stylesXml) return;

    // Find or create <dxfs> section (handle both self-closing and open/close forms)
    const dxfOpenMatch = stylesXml.match(/<dxfs count="(\d+)">/);
    const dxfSelfCloseMatch = stylesXml.match(/<dxfs count="(\d+)"\/>/);
    let dxfCount = 0;

    if (dxfOpenMatch) {
        dxfCount = parseInt(dxfOpenMatch[1]);
    } else if (dxfSelfCloseMatch) {
        dxfCount = parseInt(dxfSelfCloseMatch[1]);
    }

    // Deduplicate by fillColor so we only add one dxf per unique color
    const colorToDxfIndex = {};
    let newDxfsXml = '';

    for (const cvf of cellValueFmts) {
        if (!(cvf.fillColor in colorToDxfIndex)) {
            colorToDxfIndex[cvf.fillColor] = dxfCount;
            newDxfsXml += `<dxf><fill><patternFill><bgColor rgb="${cvf.fillColor}"/></patternFill></fill></dxf>`;
            dxfCount++;
        }
        cvf._dxfIndex = colorToDxfIndex[cvf.fillColor];
    }

    if (dxfOpenMatch) {
        // Opening tag form: <dxfs count="N">...</dxfs>
        stylesXml = stylesXml.replace(/<dxfs count="\d+">/, `<dxfs count="${dxfCount}">`);
        stylesXml = stylesXml.replace('</dxfs>', newDxfsXml + '</dxfs>');
    } else if (dxfSelfCloseMatch) {
        // Self-closing form: <dxfs count="0"/> — replace with open/close containing new entries
        stylesXml = stylesXml.replace(/<dxfs count="\d+"\/>/,
            `<dxfs count="${dxfCount}">${newDxfsXml}</dxfs>`);
    } else {
        // No <dxfs> exists — insert before </styleSheet>
        const dxfsBlock = `<dxfs count="${dxfCount}">${newDxfsXml}</dxfs>`;
        stylesXml = stylesXml.replace('</styleSheet>', dxfsBlock + '</styleSheet>');
    }

    zip.file(stylesPath, stylesXml);
}

/**
 * Applies fill highlighting to specific rows/columns in a sheet XML string.
 * For each highlighted row, sets the s="N" attribute on cells from startCol to endCol.
 * Creates empty cells with the fill if they don't exist in the XML.
 *
 * @param {string} xml - The sheet XML
 * @param {Object} highlight - {rows: number[], startCol, endCol, fillColor}
 * @param {Object} fillStyleMap - fillColor → s attribute value
 * @returns {string} Modified XML
 */
function applyRowHighlights(xml, highlight, fillStyleMap) {
    const sValue = fillStyleMap[highlight.fillColor];
    if (!sValue) return xml;

    // Build a Set of 1-based row numbers to highlight (rows are 0-based data indices, +2 for header+1-based)
    const rowSet = new Set(highlight.rows.map(r => r + 2));

    // Process each <row> element
    xml = xml.replace(/<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g, (match, rowNumStr, rowAttrs, rowContent) => {
        const rowNum = parseInt(rowNumStr);
        if (!rowSet.has(rowNum)) return match;

        // Parse existing cells in this row into a map by column index
        const cellMap = new Map();
        const cellRegex = /<c r="([A-Z]+)(\d+)"([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
            const colLetters = cellMatch[1];
            cellMap.set(colLetters, cellMatch[0]);
        }

        // For each column in highlight range, ensure cell exists with fill
        for (let col = highlight.startCol; col <= highlight.endCol; col++) {
            const colLetter = columnIndexToLetter(col);
            const cellRef = `${colLetter}${rowNum}`;

            if (cellMap.has(colLetter)) {
                // Cell exists — add or replace s attribute
                let cellXml = cellMap.get(colLetter);
                if (/\ss="[^"]*"/.test(cellXml)) {
                    cellXml = cellXml.replace(/\ss="[^"]*"/, ` s="${sValue}"`);
                } else {
                    cellXml = cellXml.replace(/<c r="([^"]+)"/, `<c r="$1" s="${sValue}"`);
                }
                cellMap.set(colLetter, cellXml);
            } else {
                // Cell doesn't exist — create empty cell with fill
                cellMap.set(colLetter, `<c r="${cellRef}" s="${sValue}"/>`);
            }
        }

        // Rebuild row content sorted by column
        const sortedCells = [...cellMap.entries()]
            .sort((a, b) => {
                // Sort by column: first by length (A < AA), then alphabetically
                if (a[0].length !== b[0].length) return a[0].length - b[0].length;
                return a[0] < b[0] ? -1 : 1;
            })
            .map(([, cellXml]) => cellXml)
            .join('');

        return `<row r="${rowNumStr}"${rowAttrs}>${sortedCells}</row>`;
    });

    return xml;
}

/**
 * Injects Excel table definitions (ListObject / structured tables) into the workbook.
 * Creates xl/tables/tableN.xml files, updates [Content_Types].xml,
 * adds relationships, and references tables from each sheet.
 *
 * @param {JSZip} zip - The XLSX workbook as a JSZip instance
 * @param {Array} tableMetadata - Array of {sheetIndex, displayName, columns: [{header}], dataRowCount}
 */
async function injectExcelTables(zip, tableMetadata) {
    if (!tableMetadata || tableMetadata.length === 0) return;

    // 1. Update [Content_Types].xml
    let contentTypesXml = await zip.file('[Content_Types].xml')?.async('string');
    if (contentTypesXml) {
        for (let i = 1; i <= tableMetadata.length; i++) {
            const override = `<Override PartName="/xl/tables/table${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`;
            contentTypesXml = contentTypesXml.replace('</Types>', override + '</Types>');
        }
        zip.file('[Content_Types].xml', contentTypesXml);
    }

    // 2. Create each table file and wire up relationships + sheet references
    for (let i = 0; i < tableMetadata.length; i++) {
        const meta = tableMetadata[i];
        const tableId = i + 1;

        // --- Create xl/tables/tableN.xml ---
        const safeName = meta.displayName.replace(/[^a-zA-Z0-9_]/g, '_');
        const lastCol = columnIndexToLetter(meta.columns.length - 1);
        const lastRow = meta.dataRowCount + 1; // +1 for header
        const ref = `A1:${lastCol}${lastRow}`;

        const colsXml = meta.columns.map((col, idx) => {
            const name = String(col.header)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            return `<tableColumn id="${idx + 1}" name="${name}"/>`;
        }).join('');

        const tableXml =
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
            `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
            ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"` +
            ` id="${tableId}" name="${safeName}" displayName="${safeName}" ref="${ref}" totalsRowShown="0">` +
                `<autoFilter ref="${ref}"/>` +
                `<tableColumns count="${meta.columns.length}">${colsXml}</tableColumns>` +
                `<tableStyleInfo name="TableStyleMedium16" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>` +
            `</table>`;

        zip.file(`xl/tables/table${tableId}.xml`, tableXml);

        // --- Add relationship in xl/worksheets/_rels/sheetN.xml.rels ---
        const relsPath = `xl/worksheets/_rels/sheet${meta.sheetIndex + 1}.xml.rels`;
        let relsXml = await zip.file(relsPath)?.async('string') || '';

        if (!relsXml) {
            relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
                `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
        }

        // Find highest existing rId
        const rIdNums = (relsXml.match(/Id="rId(\d+)"/g) || [])
            .map(m => parseInt(m.match(/\d+/)[0]));
        const nextRId = rIdNums.length > 0 ? Math.max(...rIdNums) + 1 : 1;
        const rId = `rId${nextRId}`;

        const rel = `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table${tableId}.xml"/>`;
        relsXml = relsXml.replace('</Relationships>', rel + '</Relationships>');
        zip.file(relsPath, relsXml);

        // --- Add <tableParts> reference in sheet XML ---
        const sheetPath = `xl/worksheets/sheet${meta.sheetIndex + 1}.xml`;
        let sheetXml = await zip.file(sheetPath)?.async('string');
        if (sheetXml) {
            const tableParts = `<tableParts count="1"><tablePart r:id="${rId}"/></tableParts>`;
            // Insert right before </worksheet> to avoid conflicts with conditional formatting
            sheetXml = sheetXml.replace('</worksheet>', tableParts + '</worksheet>');
            zip.file(sheetPath, sheetXml);
        }
    }
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
        const colorSettings = await storageGet([
            STORAGE_KEYS.EXPORT_TAB_COLOR,
            STORAGE_KEYS.EXPORT_COLOR_SCALE_LOW,
            STORAGE_KEYS.EXPORT_COLOR_SCALE_MID,
            STORAGE_KEYS.EXPORT_COLOR_SCALE_HIGH
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

        // Find the most recent ExpStartDate to identify the newest cohort
        let maxExpStartTime = 0;
        students.forEach(student => {
            const expStart = getFieldValue(student, 'expStartDate');
            if (expStart) {
                const expDate = parseDate(expStart);
                if (expDate && expDate.getTime() > maxExpStartTime) {
                    maxExpStartTime = expDate.getTime();
                }
            }
        });
        const newStudentRows = []; // 0-based data row indices for new students

        students.forEach((student, studentIndex) => {
            const rowMetadata = {}; // Store hyperlink info for this row
            const row = activeColumns.map((col, colIndex) => {
                let value = getFieldValue(student, col.field, col.fallback);

                if (col.field === 'missingCount') {
                    value = (value !== null && value !== undefined && value !== '') ? value : '-';
                } else if (col.field === 'daysOut') {
                    value = parseInt(value || 0);
                } else if (col.conditionalFormatting) {
                    // Ensure grade/gpa values are numeric so Excel color scales apply
                    const num = parseFloat(value);
                    if (!isNaN(num)) value = num;
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

            // Highlight students sharing the most recent ExpStartDate (newest cohort)
            if (maxExpStartTime) {
                const expStart = getFieldValue(student, 'expStartDate');
                if (expStart) {
                    const expDate = parseDate(expStart);
                    if (expDate && expDate.getTime() === maxExpStartTime) {
                        newStudentRows.push(studentIndex);
                    }
                }
            }
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

        // Find all color-scale column indices for conditional formatting (grade + gpa)
        const colorScaleTypes = ['grade', 'gpa'];
        const findColorScaleCols = (columns) => columns
            .map((col, i) => colorScaleTypes.includes(col.conditionalFormatting) ? { index: i, type: col.conditionalFormatting } : null)
            .filter(Boolean);

        const masterListScaleCols = findColorScaleCols(activeColumns);
        const missingScaleCols = findColorScaleCols(EXPORT_MISSING_ASSIGNMENTS_COLUMNS);

        // Build list of {sheetIndex, colIndex, rowCount, type} for conditional formatting injection
        const condFmtSheets = [];
        for (const { index, type } of masterListScaleCols) {
            if (students.length > 0) {
                condFmtSheets.push({ sheetIndex: 0, colIndex: index, rowCount: students.length, type });
            }
        }
        for (const { index, type } of missingScaleCols) {
            if (missingAssignmentsData.length > 1) {
                condFmtSheets.push({ sheetIndex: 1, colIndex: index, rowCount: missingAssignmentsData.length - 1, type });
            }
        }

        // Set column widths for Master List (custom or auto-fit)
        ws1['!cols'] = calculateColumnWidths(activeColumns, masterListData);

        // Set column widths for Missing Assignments (custom or auto-fit)
        ws2['!cols'] = calculateColumnWidths(EXPORT_MISSING_ASSIGNMENTS_COLUMNS, missingAssignmentsData);

        // --- LDA SHEETS (Filtered and Sorted Master List) ---
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

        // Determine campuses for LDA sheet splitting
        const campuses = [...new Set(
            filteredStudents.map(s => s.campus).filter(c => c && c.trim() !== '')
        )].sort();
        const hasMultipleCampuses = campuses.length > 1;

        // Build groups: one per campus if multiple, otherwise one group with all students
        const ldaGroups = hasMultipleCampuses
            ? campuses.map(campus => ({
                name: campus,
                students: filteredStudents.filter(s => s.campus === campus)
            }))
            : [{ name: null, students: filteredStudents }];

        // Pastel tab colors cycled for each campus LDA sheet
        const PASTEL_TAB_COLORS = [
            'FFB4C7E7', // pastel blue
            'FFFFC7CE', // pastel red/pink
            'FFC6EFCE', // pastel green
            'FFD9C2EC', // pastel purple
            'FFFFDFBA', // pastel orange
            'FFFFFFB3', // pastel yellow
            'FFBFE6E2', // pastel teal
            'FFFFC8DD', // pastel rose
        ];

        // Create sheet name with reference date formatted as MM-DD-YYYY
        const ldaMonth = String(referenceDate.getMonth() + 1).padStart(2, '0');
        const ldaDay = String(referenceDate.getDate()).padStart(2, '0');
        const ldaYear = String(referenceDate.getFullYear());
        const ldaDateSuffix = `LDA ${ldaMonth}-${ldaDay}-${ldaYear}`;

        XLSX.utils.book_append_sheet(wb, ws1, 'Master List');
        XLSX.utils.book_append_sheet(wb, ws2, 'Missing Assignments');

        // Sheet tab colors (convert #RRGGBB to FFRRGGBB for XLSX)
        const exportTabColor = colorSettings[STORAGE_KEYS.EXPORT_TAB_COLOR] || '#fcd5b4';
        const tabColors = [
            { sheetIndex: 0, rgb: 'FF' + exportTabColor.replace('#', '') }
        ];

        const ldaSheetNames = [];
        const rowHighlights = []; // Track rows to highlight across sheets

        // New student highlight: light blue fill for entire row on Master List (lowest priority — applied first)
        if (newStudentRows.length > 0) {
            rowHighlights.push({
                sheetIndex: 0,
                rows: newStudentRows,
                startCol: 0,
                endCol: activeColumns.length - 1,
                fillColor: 'FF9BC2E6' // light blue
            });
        }

        const cellValueFmts = []; // Track cell-value conditional formatting across sheets

        // Build LDA column definitions with explicit ordering from LDA_VISIBLE_COLUMNS
        // Extra columns added for LDA only (not in activeColumns)
        const ldaExtraCols = {
            assigned: { header: 'Assigned', field: 'assigned', width: 12 },
            outreach: { header: 'Outreach', field: 'outreach', width: 35 }
        };
        // All available columns for LDA (activeColumns + extras)
        const allLdaCols = [...activeColumns];
        for (const [field, def] of Object.entries(ldaExtraCols)) {
            if (!allLdaCols.some(c => c.field === field)) allLdaCols.push(def);
        }
        // Build ordered ldaColumns: visible columns first (in LDA_VISIBLE_COLUMNS order), then the rest
        const ldaColumns = [];
        for (const field of LDA_VISIBLE_COLUMNS) {
            const col = allLdaCols.find(c => c.field === field);
            if (col) ldaColumns.push(col);
        }
        for (const col of allLdaCols) {
            if (!LDA_VISIBLE_COLUMNS.includes(col.field)) ldaColumns.push(col);
        }

        // Find the outreach column index for highlight range start
        const outreachColIndex = ldaColumns.findIndex(col => col.field === 'outreach');
        const totalLdaCols = ldaColumns.length;

        // Find all color-scale column indices for LDA sheets (grade + gpa)
        const ldaScaleCols = findColorScaleCols(ldaColumns);

        // Find Missing Assignments column index in LDA columns for cell-value formatting
        const ldaMissingColIndex = ldaColumns.findIndex(col => col.field === 'missingCount');

        // Build and append each LDA sheet
        ldaGroups.forEach((group, groupIndex) => {
            const sheetIndex = 2 + groupIndex; // 0=Master List, 1=Missing Assignments
            const ldaHeaders = ldaColumns.map(col => col.header);
            const ldaData = [ldaHeaders];
            const ldaHyperlinkMetadata = [];
            const highlightRows = []; // 0-based data row indices to highlight

            group.students.forEach((student, studentIndex) => {
                const rowMetadata = {};
                const missingRaw = getFieldValue(student, 'missingCount');
                const hasMissingData = missingRaw !== null && missingRaw !== undefined && missingRaw !== '';
                const missingCount = hasMissingData ? parseInt(missingRaw) : null;
                const nextDueRaw = getFieldValue(student, 'nextAssignment.DueDate');

                // Check if this student is in the newest cohort
                let isNewStudent = false;
                if (maxExpStartTime) {
                    const expStart = getFieldValue(student, 'expStartDate');
                    if (expStart) {
                        const expDate = parseDate(expStart);
                        if (expDate && expDate.getTime() === maxExpStartTime) {
                            isNewStudent = true;
                        }
                    }
                }

                const row = ldaColumns.map((col, colIndex) => {
                    // Custom LDA-only columns
                    if (col.field === 'assigned') return '';
                    if (col.field === 'outreach') {
                        if (missingCount === 0 && nextDueRaw) {
                            const dueDate = parseDate(nextDueRaw);
                            if (dueDate) {
                                const friendly = formatFriendlyDate(dueDate, referenceDate);
                                return `Student's next assignment is due ${friendly}.`;
                            }
                        }
                        return '';
                    }

                    let value = getFieldValue(student, col.field, col.fallback);

                    if (col.field === 'missingCount') {
                        value = (value !== null && value !== undefined && value !== '') ? value : '-';
                    } else if (col.field === 'daysOut') {
                        value = parseInt(value || 0);
                    } else if (col.conditionalFormatting) {
                        // Ensure grade/gpa values are numeric so Excel color scales apply
                        const num = parseFloat(value);
                        if (!isNaN(num)) value = num;
                    } else if (col.field === 'lda') {
                        if (value) {
                            const dateObj = parseDate(value);
                            if (dateObj) {
                                value = formatDateToMMDDYY(dateObj);
                            }
                        }
                    }

                    // New students don't have a meaningful Enroll GPA yet — leave blank
                    if (isNewStudent && col.field === 'enrollGpa') {
                        value = '';
                    }

                    if (col.hyperlink && col.hyperlinkText && value) {
                        rowMetadata[colIndex] = { url: value, text: col.hyperlinkText };
                    }

                    return value;
                });

                // Track rows that qualify for outreach highlighting
                if (missingCount === 0 && nextDueRaw && parseDate(nextDueRaw)) {
                    highlightRows.push(studentIndex);
                }

                ldaData.push(row);
                ldaHyperlinkMetadata.push(rowMetadata);
            });

            const ws = XLSX.utils.aoa_to_sheet(ldaData);

            // Add HYPERLINK formulas
            ldaHyperlinkMetadata.forEach((rowMeta, rowIndex) => {
                Object.entries(rowMeta).forEach(([colIndex, linkData]) => {
                    const cellAddress = XLSX.utils.encode_cell({ r: rowIndex + 1, c: parseInt(colIndex) });
                    if (ws[cellAddress] && linkData.url) {
                        const escapedUrl = linkData.url.replace(/"/g, '""');
                        const escapedText = String(linkData.text || 'Link').replace(/"/g, '""');
                        ws[cellAddress] = {
                            t: 'f',
                            f: `HYPERLINK("${escapedUrl}","${escapedText}")`,
                            v: linkData.text || 'Link'
                        };
                    }
                });
            });

            // Set column widths
            ws['!cols'] = calculateColumnWidths(ldaColumns, ldaData);

            // Hide columns not in LDA_VISIBLE_COLUMNS whitelist
            ldaColumns.forEach((col, i) => {
                if (!LDA_VISIBLE_COLUMNS.includes(col.field)) {
                    if (!ws['!cols'][i]) ws['!cols'][i] = {};
                    ws['!cols'][i].hidden = true;
                }
            });

            // Conditional formatting for grade/gpa columns
            for (const { index, type } of ldaScaleCols) {
                if (group.students.length > 0) {
                    condFmtSheets.push({ sheetIndex, colIndex: index, rowCount: group.students.length, type });
                }
            }

            // Conditional formatting for Missing Assignments = 0 → light green
            if (ldaMissingColIndex !== -1 && group.students.length > 0) {
                cellValueFmts.push({
                    sheetIndex,
                    colIndex: ldaMissingColIndex,
                    rowCount: group.students.length,
                    value: 0,
                    fillColor: 'FFE2EFDA' // same light green #e2efda
                });
            }

            // Record row highlights for this sheet (Assigned through Outreach — the left side)
            if (highlightRows.length > 0 && outreachColIndex !== -1) {
                rowHighlights.push({
                    sheetIndex,
                    rows: highlightRows,
                    startCol: 0,
                    endCol: outreachColIndex,
                    fillColor: 'FFE2EFDA' // light green #e2efda
                });
            }

            // Sheet name: campus name if multiple, otherwise "LDA MM-DD-YYYY"
            const sheetName = hasMultipleCampuses ? group.name : ldaDateSuffix;
            ldaSheetNames.push(sheetName);
            XLSX.utils.book_append_sheet(wb, ws, sheetName);

            // Assign pastel tab color for each campus LDA sheet
            if (hasMultipleCampuses) {
                tabColors.push({ sheetIndex, rgb: PASTEL_TAB_COLORS[groupIndex % PASTEL_TAB_COLORS.length] });
            }
        });

        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `student_report_${timestamp}.xlsx`;

        // Color scale settings (convert #RRGGBB to FFRRGGBB for XLSX)
        const colorScale = {
            low: 'FF' + (colorSettings[STORAGE_KEYS.EXPORT_COLOR_SCALE_LOW] || '#F8696B').replace('#', ''),
            mid: 'FF' + (colorSettings[STORAGE_KEYS.EXPORT_COLOR_SCALE_MID] || '#FFEB84').replace('#', ''),
            high: 'FF' + (colorSettings[STORAGE_KEYS.EXPORT_COLOR_SCALE_HIGH] || '#63BE7B').replace('#', '')
        };

        // Build table metadata for all sheets
        const tableMetadata = [
            { sheetIndex: 0, displayName: 'MasterList', columns: activeColumns, dataRowCount: students.length },
            { sheetIndex: 1, displayName: 'MissingAssignments', columns: EXPORT_MISSING_ASSIGNMENTS_COLUMNS, dataRowCount: missingAssignmentsData.length - 1 }
        ];
        ldaGroups.forEach((group, groupIndex) => {
            const sheetName = hasMultipleCampuses ? group.name : ldaDateSuffix;
            tableMetadata.push({
                sheetIndex: 2 + groupIndex,
                displayName: sheetName.replace(/[^a-zA-Z0-9_]/g, '_'),
                columns: ldaColumns,
                dataRowCount: group.students.length
            });
        });

        // Write workbook to buffer, then inject conditional formatting, tab colors, row highlights, and tables via JSZip
        const wbBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
        await writeXlsxWithConditionalFormatting(wbBuffer, filename, condFmtSheets, tabColors, colorScale, rowHighlights, cellValueFmts, tableMetadata);

        console.log(`✓ Exported ${students.length} students to Excel file: ${filename}`);
        console.log(`  - Master List: ${students.length} students`);
        console.log(`  - Missing Assignments: ${missingAssignmentsData.length - 1} assignments`);
        ldaSheetNames.forEach(name => {
            console.log(`  - ${name}: LDA sheet`);
        });

    } catch (error) {
        console.error('Error exporting to Excel:', error);
        alert('Error creating Excel file. Check console for details.');
    }
}
