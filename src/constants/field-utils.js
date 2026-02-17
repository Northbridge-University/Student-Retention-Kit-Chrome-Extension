/**
 * Field normalization, alias matching, and date conversion utilities.
 * Used primarily by file-handler.js for CSV/XLSX import processing.
 */

/**
 * Normalizes a field name for comparison by:
 * - Converting to lowercase
 * - Removing spaces, hyphens, underscores
 * - Removing special characters
 *
 * Examples:
 * - "Student Number" → "studentnumber"
 * - "StudentNumber" → "studentnumber"
 * - "student-number" → "studentnumber"
 * - "STUDENT_NUMBER" → "studentnumber"
 *
 * @param {string} fieldName - The field name to normalize
 * @returns {string} The normalized field name
 */
export function normalizeFieldName(fieldName) {
    if (!fieldName) return '';
    return String(fieldName)
        .toLowerCase()
        .replace(/[\s\-_]/g, '') // Remove spaces, hyphens, underscores
        .replace(/[^a-z0-9]/g, ''); // Remove any remaining special characters
}

/**
 * Converts an Excel date serial number to a JavaScript Date object.
 * Excel dates are stored as the number of days since January 1, 1900.
 *
 * @param {number} excelDate - The Excel date serial number
 * @returns {Date} JavaScript Date object
 */
export function excelDateToJSDate(excelDate) {
    // Excel date serial number starts from 1/1/1900
    // Use December 30, 1899 as base to account for Excel's leap year bug
    const excelEpoch = new Date(1899, 11, 30);
    const daysOffset = excelDate;
    const jsDate = new Date(excelEpoch.getTime() + daysOffset * 24 * 60 * 60 * 1000);
    return jsDate;
}

/**
 * Formats a JavaScript Date object to MM-DD-YY format.
 *
 * @param {Date} date - JavaScript Date object
 * @returns {string} Date formatted as MM-DD-YY
 */
export function formatDateToMMDDYY(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${month}-${day}-${year}`;
}

/**
 * Checks if a value appears to be an Excel date serial number.
 * Excel dates are positive integers typically in the range 1-100000.
 *
 * @param {*} value - The value to check
 * @returns {boolean} True if value appears to be an Excel date number
 */
export function isExcelDateNumber(value) {
    if (typeof value !== 'number') return false;
    if (!Number.isInteger(value)) return false;
    // Reasonable range: 1 (1/1/1900) to 100000 (~year 2173)
    if (value < 1 || value > 100000) return false;
    return true;
}

/**
 * Converts an Excel date serial number to MM-DD-YY format string.
 * If the value is not an Excel date number, returns it unchanged.
 *
 * @param {*} value - The value to convert
 * @returns {string|*} Formatted date string or original value
 */
export function convertExcelDate(value) {
    if (isExcelDateNumber(value)) {
        const jsDate = excelDateToJSDate(value);
        return formatDateToMMDDYY(jsDate);
    }
    return value;
}

/**
 * Parses a date string in various formats and returns a JavaScript Date object.
 * Supports formats like: MM-DD-YY, MM/DD/YY, MM-DD-YYYY, MM/DD/YYYY
 *
 * @param {string|number} dateValue - The date value to parse
 * @returns {Date|null} JavaScript Date object or null if parsing fails
 */
export function parseDate(dateValue) {
    if (!dateValue) return null;

    // If it's an Excel date number, convert it first
    if (isExcelDateNumber(dateValue)) {
        return excelDateToJSDate(dateValue);
    }

    // If it's already a Date object, return it
    if (dateValue instanceof Date) {
        return dateValue;
    }

    // Convert to string and try to parse
    const dateStr = String(dateValue).trim();
    if (!dateStr) return null;

    // Try parsing common date formats: MM-DD-YY, MM/DD/YY, MM-DD-YYYY, MM/DD/YYYY
    const patterns = [
        /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2})$/,     // MM-DD-YY or MM/DD/YY
        /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/      // MM-DD-YYYY or MM/DD/YYYY
    ];

    for (const pattern of patterns) {
        const match = dateStr.match(pattern);
        if (match) {
            const month = parseInt(match[1], 10);
            const day = parseInt(match[2], 10);
            let year = parseInt(match[3], 10);

            // Convert 2-digit year to 4-digit year
            if (year < 100) {
                year += year < 50 ? 2000 : 1900;
            }

            // Validate month and day
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                return new Date(year, month - 1, day);
            }
        }
    }

    // Try standard Date parsing as fallback
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Detects the longest common prefix among an array of strings and returns
 * trimmed display names with the prefix removed.
 *
 * The prefix is trimmed back to a complete word boundary so partial words
 * are never stripped. After removal, any leading separators (-, –, —, :)
 * and whitespace are also stripped from each name.
 *
 * @param {string[]} names - Array of names to process
 * @returns {{ trimmedNames: Map<string, string>, prefix: string }}
 *   trimmedNames maps each original name to its display name;
 *   prefix is the detected common prefix (empty string if none found)
 *
 * @example
 *   trimCommonPrefix([
 *     'Northbridge - South Miami',
 *     'Northbridge Hialeah - South Florida',
 *     'Northbridge - Kissimmee'
 *   ])
 *   // prefix: 'Northbridge'
 *   // trimmedNames: Map {
 *   //   'Northbridge - South Miami' => 'South Miami',
 *   //   'Northbridge Hialeah - South Florida' => 'Hialeah - South Florida',
 *   //   'Northbridge - Kissimmee' => 'Kissimmee'
 *   // }
 */
export function trimCommonPrefix(names) {
    const identity = new Map(names?.map(n => [n, n]) || []);
    if (!names || names.length <= 1) {
        return { trimmedNames: identity, prefix: '' };
    }

    // Find longest common prefix character by character
    let prefix = names[0];
    for (let i = 1; i < names.length; i++) {
        while (prefix && !names[i].startsWith(prefix)) {
            prefix = prefix.slice(0, -1);
        }
    }

    // Strip trailing separators and whitespace to get a clean word prefix
    prefix = prefix.replace(/[\s\-–—:]+$/, '');

    // Require at least 3 meaningful characters
    if (prefix.length < 3) {
        return { trimmedNames: identity, prefix: '' };
    }

    // Ensure prefix ends at a word boundary — don't cut mid-word
    const cutsMidWord = names.some(name => {
        if (name.length <= prefix.length) return false;
        return /[a-zA-Z0-9]/.test(name[prefix.length]);
    });
    if (cutsMidWord) {
        return { trimmedNames: identity, prefix: '' };
    }

    const trimmedNames = new Map();
    for (const name of names) {
        let trimmed = name.substring(prefix.length);
        // Strip leading separators and whitespace
        trimmed = trimmed.replace(/^[\s\-–—:]+/, '').trim();
        trimmedNames.set(name, trimmed || name);
    }

    return { trimmedNames, prefix };
}

/**
 * Calculates the number of days between two dates.
 * Returns the absolute difference in days, rounded down.
 *
 * @param {Date} date1 - First date
 * @param {Date} date2 - Second date
 * @returns {number} Number of days between the dates
 */
export function daysBetween(date1, date2) {
    if (!date1 || !date2) return 0;

    const msPerDay = 24 * 60 * 60 * 1000;
    const diffMs = Math.abs(date2.getTime() - date1.getTime());
    return Math.floor(diffMs / msPerDay);
}

/**
 * Calculates days since last attendance based on LDA value and reference date.
 * Used for both Excel and CSV imports.
 *
 * @param {string|number} ldaValue - The Last Day of Attendance value
 * @param {Date|number} referenceDate - Reference date (file creation date or current date)
 * @returns {number} Number of days since last attendance, or 0 if calculation fails
 */
export function calculateDaysSinceLastAttendance(ldaValue, referenceDate) {
    if (!ldaValue || !referenceDate) return 0;

    // Parse the LDA date
    const ldaDate = parseDate(ldaValue);
    if (!ldaDate) return 0;

    // Ensure referenceDate is a Date object
    let refDate = referenceDate;
    if (typeof referenceDate === 'number') {
        refDate = new Date(referenceDate);
    }
    if (!(refDate instanceof Date) || isNaN(refDate.getTime())) {
        return 0;
    }

    // Calculate days between LDA and reference date
    return daysBetween(ldaDate, refDate);
}

/**
 * Formats a date into a friendly relative phrase for outreach messages.
 * - Same day: "today"
 * - Next day: "tomorrow"
 * - Within the current week (same Sun-Sat): "this Wednesday"
 * - Within the next week: "next Monday"
 * - Further out: "February 14th"
 *
 * @param {Date} date - The target date
 * @param {Date} [referenceDate] - The "today" baseline (defaults to new Date())
 * @returns {string} A friendly date phrase (lowercase)
 */
export function formatFriendlyDate(date, referenceDate) {
    if (!date) return '';
    const today = referenceDate ? new Date(referenceDate) : new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);

    const diffDays = Math.round((target - today) / (24 * 60 * 60 * 1000));

    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'tomorrow';

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const targetDay = dayNames[target.getDay()];

    // Days remaining in the current week (0=Sun based week)
    // "this <day>" = same Sun–Sat week as today
    const todayDow = today.getDay(); // 0=Sun
    const daysUntilEndOfWeek = 6 - todayDow; // days left until Saturday

    if (diffDays > 0 && diffDays <= daysUntilEndOfWeek) {
        return `this ${targetDay}`;
    }

    // "next <day>" = the immediately following Sun–Sat week
    if (diffDays > 0 && diffDays <= daysUntilEndOfWeek + 7) {
        return `next ${targetDay}`;
    }

    // Absolute date: "February 14th"
    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const day = target.getDate();
    const suffix = getOrdinalSuffix(day);
    return `${monthNames[target.getMonth()]} ${day}${suffix}`;
}

/**
 * Returns the ordinal suffix for a number (st, nd, rd, th).
 * @param {number} n
 * @returns {string}
 */
function getOrdinalSuffix(n) {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return 'th';
    switch (n % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

/**
 * Converts a numeric grade to a letter grade.
 * A: 90-100, B: 80-89, C: 70-79, D: 60-69, F: below 60
 *
 * @param {string|number} grade - The numeric grade value
 * @returns {string} The letter grade (A, B, C, D, F) or empty string if invalid
 */
export function numericToLetterGrade(grade) {
    const num = Number(grade);
    if (isNaN(num)) return '';
    if (num >= 90) return 'A';
    if (num >= 80) return 'B';
    if (num >= 70) return 'C';
    if (num >= 60) return 'D';
    return 'F';
}
