/**
 * Tests for modal-manager functions
 *
 * These tests verify the pure/testable logic in modal-manager.js:
 * - Campus extraction from student data
 * - Email template generation
 * - Time-based greetings
 * - Filter logic for scan filters
 * - Daily update modal logic
 */

// ============================================
// Pure functions extracted for testing
// ============================================

/**
 * Gets unique campuses from student array
 */
function getCampusesFromStudents(students) {
    if (!students || students.length === 0) return [];

    const campuses = [...new Set(
        students
            .map(s => s.campus)
            .filter(c => c && c.trim() !== '')
    )].sort();

    return campuses;
}

/**
 * Gets the appropriate greeting based on time of day
 */
function getTimeOfDayGreeting(hour) {
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
}

/**
 * Gets the first name from a full name
 */
function getFirstName(fullName) {
    if (!fullName) return '';
    const parts = fullName.trim().split(/\s+/);
    return parts[0] || '';
}

/**
 * Checks if a Canvas response indicates an authorization error
 */
function isCanvasAuthError(response) {
    return response && (response.status === 401 || response.status === 403);
}

/**
 * Checks if a JSON error body indicates a Canvas authorization error
 */
function isCanvasAuthErrorBody(errorBody) {
    if (!errorBody) return false;

    if (errorBody.status === 'unauthorized') return true;

    if (errorBody.errors && Array.isArray(errorBody.errors)) {
        return errorBody.errors.some(err =>
            err.message && (
                err.message.toLowerCase().includes('unauthorized') ||
                err.message.toLowerCase().includes('not authorized')
            )
        );
    }

    return false;
}

/**
 * Applies scan filter logic to determine if a student meets criteria
 */
function meetsFilterCriteria(entry, operator, value, includeFailing) {
    const daysOut = entry.daysOut;

    let meetsDaysOutCriteria = false;
    if (daysOut != null) {
        switch (operator) {
            case '>': meetsDaysOutCriteria = daysOut > value; break;
            case '<': meetsDaysOutCriteria = daysOut < value; break;
            case '>=': meetsDaysOutCriteria = daysOut >= value; break;
            case '<=': meetsDaysOutCriteria = daysOut <= value; break;
            case '=': meetsDaysOutCriteria = daysOut === value; break;
            default: meetsDaysOutCriteria = false;
        }
    }

    let isFailing = false;
    if (includeFailing && entry.grade != null) {
        const grade = parseFloat(entry.grade);
        if (!isNaN(grade) && grade < 60) {
            isFailing = true;
        }
    }

    return meetsDaysOutCriteria || isFailing;
}

/**
 * Checks if the daily update modal should be shown
 */
function shouldShowDailyUpdate(lastUpdated, now, snoozedDate) {
    if (!lastUpdated) {
        return false;
    }

    const todayDateString = now.toLocaleDateString('en-US');

    if (snoozedDate === todayDateString) {
        return false;
    }

    const lastUpdatedDate = new Date(lastUpdated);
    const lastUpdatedDateString = lastUpdatedDate.toLocaleDateString('en-US');

    if (todayDateString === lastUpdatedDateString) {
        return false;
    }

    return true;
}

/**
 * Gets the greeting matching the time of day for the daily update modal
 */
function getDailyUpdateGreeting(hour) {
    if (hour < 12) return { text: 'Good Morning!', icon: 'fa-sun', color: '#f59e0b' };
    if (hour < 17) return { text: 'Good Afternoon!', icon: 'fa-cloud-sun', color: '#f59e0b' };
    return { text: 'Good Evening!', icon: 'fa-moon', color: '#6366f1' };
}

/**
 * Applies the Redact Data preference by toggling the redact-mode class on body
 */
function applyRedactData(enabled) {
    document.body.classList.toggle('redact-mode', !!enabled);
}

/**
 * Generates initials from a name
 */
function generateInitials(name) {
    const nameParts = (name || '').trim().split(/\s+/);
    let initials = '';
    if (nameParts.length > 0) {
        const firstInitial = nameParts[0][0] || '';
        const lastInitial = nameParts.length > 1 ? nameParts[nameParts.length - 1][0] : '';
        initials = (firstInitial + lastInitial).toUpperCase();
        if (!initials) initials = '?';
    }
    return initials || '?';
}

// ============================================
// Tests
// ============================================

describe('getCampusesFromStudents', () => {
    test('extracts unique campuses from students', () => {
        const students = [
            { name: 'Alice', campus: 'North' },
            { name: 'Bob', campus: 'South' },
            { name: 'Charlie', campus: 'North' },
            { name: 'Diana', campus: 'East' }
        ];

        const result = getCampusesFromStudents(students);

        expect(result).toEqual(['East', 'North', 'South']);
    });

    test('returns empty array for empty student list', () => {
        expect(getCampusesFromStudents([])).toEqual([]);
        expect(getCampusesFromStudents(null)).toEqual([]);
        expect(getCampusesFromStudents(undefined)).toEqual([]);
    });

    test('filters out empty/null campuses', () => {
        const students = [
            { name: 'Alice', campus: 'North' },
            { name: 'Bob', campus: '' },
            { name: 'Charlie', campus: null },
            { name: 'Diana', campus: '   ' },
            { name: 'Eve', campus: 'South' }
        ];

        const result = getCampusesFromStudents(students);

        expect(result).toEqual(['North', 'South']);
    });

    test('sorts campuses alphabetically', () => {
        const students = [
            { name: 'Alice', campus: 'Zebra' },
            { name: 'Bob', campus: 'Alpha' },
            { name: 'Charlie', campus: 'Middle' }
        ];

        const result = getCampusesFromStudents(students);

        expect(result).toEqual(['Alpha', 'Middle', 'Zebra']);
    });
});

describe('getTimeOfDayGreeting', () => {
    test('returns Good Morning for hours before noon', () => {
        expect(getTimeOfDayGreeting(0)).toBe('Good Morning');
        expect(getTimeOfDayGreeting(6)).toBe('Good Morning');
        expect(getTimeOfDayGreeting(11)).toBe('Good Morning');
    });

    test('returns Good Afternoon for hours 12-16', () => {
        expect(getTimeOfDayGreeting(12)).toBe('Good Afternoon');
        expect(getTimeOfDayGreeting(14)).toBe('Good Afternoon');
        expect(getTimeOfDayGreeting(16)).toBe('Good Afternoon');
    });

    test('returns Good Evening for hours 17+', () => {
        expect(getTimeOfDayGreeting(17)).toBe('Good Evening');
        expect(getTimeOfDayGreeting(20)).toBe('Good Evening');
        expect(getTimeOfDayGreeting(23)).toBe('Good Evening');
    });
});

describe('getFirstName', () => {
    test('extracts first name from full name', () => {
        expect(getFirstName('John Smith')).toBe('John');
        expect(getFirstName('Jane Doe')).toBe('Jane');
    });

    test('handles single name', () => {
        expect(getFirstName('Prince')).toBe('Prince');
    });

    test('handles multiple names', () => {
        expect(getFirstName('Mary Jane Watson')).toBe('Mary');
    });

    test('handles empty/null input', () => {
        expect(getFirstName('')).toBe('');
        expect(getFirstName(null)).toBe('');
        expect(getFirstName(undefined)).toBe('');
    });

    test('trims whitespace', () => {
        expect(getFirstName('  John Smith  ')).toBe('John');
    });
});

describe('isCanvasAuthError', () => {
    test('returns true for 401 status', () => {
        expect(isCanvasAuthError({ status: 401 })).toBe(true);
    });

    test('returns true for 403 status', () => {
        expect(isCanvasAuthError({ status: 403 })).toBe(true);
    });

    test('returns false for other status codes', () => {
        expect(isCanvasAuthError({ status: 200 })).toBe(false);
        expect(isCanvasAuthError({ status: 404 })).toBe(false);
        expect(isCanvasAuthError({ status: 500 })).toBe(false);
    });

    test('returns falsy for null/undefined', () => {
        expect(isCanvasAuthError(null)).toBeFalsy();
        expect(isCanvasAuthError(undefined)).toBeFalsy();
    });
});

describe('isCanvasAuthErrorBody', () => {
    test('returns true for unauthorized status', () => {
        expect(isCanvasAuthErrorBody({ status: 'unauthorized' })).toBe(true);
    });

    test('returns true for unauthorized error message', () => {
        const errorBody = {
            errors: [{ message: 'User is not authorized to perform this action' }]
        };
        expect(isCanvasAuthErrorBody(errorBody)).toBe(true);
    });

    test('returns true for "not authorized" message', () => {
        const errorBody = {
            errors: [{ message: 'You are not authorized' }]
        };
        expect(isCanvasAuthErrorBody(errorBody)).toBe(true);
    });

    test('returns false for other errors', () => {
        const errorBody = {
            errors: [{ message: 'Resource not found' }]
        };
        expect(isCanvasAuthErrorBody(errorBody)).toBe(false);
    });

    test('returns false for null/undefined', () => {
        expect(isCanvasAuthErrorBody(null)).toBe(false);
        expect(isCanvasAuthErrorBody(undefined)).toBe(false);
    });
});

describe('meetsFilterCriteria', () => {
    describe('days out filter', () => {
        test('> operator', () => {
            expect(meetsFilterCriteria({ daysOut: 10 }, '>', 5, false)).toBe(true);
            expect(meetsFilterCriteria({ daysOut: 5 }, '>', 5, false)).toBe(false);
            expect(meetsFilterCriteria({ daysOut: 3 }, '>', 5, false)).toBe(false);
        });

        test('< operator', () => {
            expect(meetsFilterCriteria({ daysOut: 3 }, '<', 5, false)).toBe(true);
            expect(meetsFilterCriteria({ daysOut: 5 }, '<', 5, false)).toBe(false);
            expect(meetsFilterCriteria({ daysOut: 10 }, '<', 5, false)).toBe(false);
        });

        test('>= operator', () => {
            expect(meetsFilterCriteria({ daysOut: 10 }, '>=', 5, false)).toBe(true);
            expect(meetsFilterCriteria({ daysOut: 5 }, '>=', 5, false)).toBe(true);
            expect(meetsFilterCriteria({ daysOut: 3 }, '>=', 5, false)).toBe(false);
        });

        test('<= operator', () => {
            expect(meetsFilterCriteria({ daysOut: 3 }, '<=', 5, false)).toBe(true);
            expect(meetsFilterCriteria({ daysOut: 5 }, '<=', 5, false)).toBe(true);
            expect(meetsFilterCriteria({ daysOut: 10 }, '<=', 5, false)).toBe(false);
        });

        test('= operator', () => {
            expect(meetsFilterCriteria({ daysOut: 5 }, '=', 5, false)).toBe(true);
            expect(meetsFilterCriteria({ daysOut: 3 }, '=', 5, false)).toBe(false);
        });
    });

    describe('failing filter', () => {
        test('includes failing students when enabled', () => {
            // Student doesn't meet days out criteria but is failing
            expect(meetsFilterCriteria({ daysOut: 1, grade: 50 }, '>=', 5, true)).toBe(true);
            expect(meetsFilterCriteria({ daysOut: 1, grade: 59 }, '>=', 5, true)).toBe(true);
        });

        test('does not include passing students', () => {
            expect(meetsFilterCriteria({ daysOut: 1, grade: 60 }, '>=', 5, true)).toBe(false);
            expect(meetsFilterCriteria({ daysOut: 1, grade: 85 }, '>=', 5, true)).toBe(false);
        });

        test('ignores grade when includeFailing is false', () => {
            expect(meetsFilterCriteria({ daysOut: 1, grade: 50 }, '>=', 5, false)).toBe(false);
        });
    });

    describe('combined criteria', () => {
        test('meets days out OR failing', () => {
            // Meets days out only
            expect(meetsFilterCriteria({ daysOut: 10, grade: 80 }, '>=', 5, true)).toBe(true);
            // Meets failing only
            expect(meetsFilterCriteria({ daysOut: 1, grade: 40 }, '>=', 5, true)).toBe(true);
            // Meets both
            expect(meetsFilterCriteria({ daysOut: 10, grade: 40 }, '>=', 5, true)).toBe(true);
            // Meets neither
            expect(meetsFilterCriteria({ daysOut: 1, grade: 80 }, '>=', 5, true)).toBe(false);
        });
    });

    test('handles null daysOut', () => {
        expect(meetsFilterCriteria({ daysOut: null }, '>=', 5, false)).toBe(false);
        expect(meetsFilterCriteria({ }, '>=', 5, false)).toBe(false);
    });
});

describe('shouldShowDailyUpdate', () => {
    test('returns false if no lastUpdated', () => {
        const now = new Date('2025-01-15T10:00:00');
        expect(shouldShowDailyUpdate(null, now)).toBe(false);
        expect(shouldShowDailyUpdate(undefined, now)).toBe(false);
    });

    test('returns false if updated today', () => {
        const now = new Date('2025-01-15T14:00:00');
        const lastUpdated = new Date('2025-01-15T09:00:00').getTime();

        expect(shouldShowDailyUpdate(lastUpdated, now)).toBe(false);
    });

    test('returns true if updated on a different day', () => {
        const now = new Date('2025-01-15T10:00:00');
        const lastUpdated = new Date('2025-01-14T10:00:00').getTime();

        expect(shouldShowDailyUpdate(lastUpdated, now)).toBe(true);
    });

    test('returns true if updated last week', () => {
        const now = new Date('2025-01-15T10:00:00');
        const lastUpdated = new Date('2025-01-08T10:00:00').getTime();

        expect(shouldShowDailyUpdate(lastUpdated, now)).toBe(true);
    });

    test('returns false if snoozed today via Maybe Later', () => {
        const now = new Date('2025-01-15T10:00:00');
        const lastUpdated = new Date('2025-01-14T10:00:00').getTime();
        const snoozedDate = now.toLocaleDateString('en-US');

        expect(shouldShowDailyUpdate(lastUpdated, now, snoozedDate)).toBe(false);
    });

    test('returns true if snoozed on a previous day', () => {
        const now = new Date('2025-01-15T10:00:00');
        const lastUpdated = new Date('2025-01-14T10:00:00').getTime();
        const snoozedDate = new Date('2025-01-14T11:00:00').toLocaleDateString('en-US');

        expect(shouldShowDailyUpdate(lastUpdated, now, snoozedDate)).toBe(true);
    });
});

describe('getDailyUpdateGreeting', () => {
    test('greets Good Morning before noon', () => {
        expect(getDailyUpdateGreeting(0).text).toBe('Good Morning!');
        expect(getDailyUpdateGreeting(9).text).toBe('Good Morning!');
        expect(getDailyUpdateGreeting(11).text).toBe('Good Morning!');
        expect(getDailyUpdateGreeting(8).icon).toBe('fa-sun');
    });

    test('greets Good Afternoon from noon to 5pm', () => {
        expect(getDailyUpdateGreeting(12).text).toBe('Good Afternoon!');
        expect(getDailyUpdateGreeting(14).text).toBe('Good Afternoon!');
        expect(getDailyUpdateGreeting(16).text).toBe('Good Afternoon!');
        expect(getDailyUpdateGreeting(13).icon).toBe('fa-cloud-sun');
    });

    test('greets Good Evening from 5pm onward', () => {
        expect(getDailyUpdateGreeting(17).text).toBe('Good Evening!');
        expect(getDailyUpdateGreeting(20).text).toBe('Good Evening!');
        expect(getDailyUpdateGreeting(23).text).toBe('Good Evening!');
        expect(getDailyUpdateGreeting(19).icon).toBe('fa-moon');
    });
});

describe('applyRedactData', () => {
    afterEach(() => {
        document.body.classList.remove('redact-mode');
    });

    test('is off by default (no redact-mode class)', () => {
        expect(document.body.classList.contains('redact-mode')).toBe(false);
    });

    test('adds redact-mode class to body when enabled', () => {
        applyRedactData(true);
        expect(document.body.classList.contains('redact-mode')).toBe(true);
    });

    test('removes redact-mode class from body when disabled', () => {
        applyRedactData(true);
        applyRedactData(false);
        expect(document.body.classList.contains('redact-mode')).toBe(false);
    });

    test('treats falsy stored values as off', () => {
        applyRedactData(undefined);
        expect(document.body.classList.contains('redact-mode')).toBe(false);
    });
});

describe('generateInitials', () => {
    test('generates initials from first and last name', () => {
        expect(generateInitials('John Smith')).toBe('JS');
        expect(generateInitials('Jane Doe')).toBe('JD');
    });

    test('handles single name', () => {
        expect(generateInitials('Prince')).toBe('P');
    });

    test('uses first and last for multiple names', () => {
        expect(generateInitials('Mary Jane Watson')).toBe('MW');
    });

    test('returns ? for empty/null names', () => {
        expect(generateInitials('')).toBe('?');
        expect(generateInitials(null)).toBe('?');
        expect(generateInitials(undefined)).toBe('?');
    });

    test('uppercases initials', () => {
        expect(generateInitials('john smith')).toBe('JS');
    });
});

describe('Excel URL patterns', () => {
    // Testing the regex patterns used for Excel tab detection
    const EXCEL_URL_PATTERNS = [
        /^https:\/\/excel\.office\.com\/.*/,
        /^https:\/\/.*\.officeapps\.live\.com\/.*/,
        /^https:\/\/.*\.sharepoint\.com\/.*/
    ];

    function matchesExcelPattern(url) {
        return EXCEL_URL_PATTERNS.some(pattern => pattern.test(url));
    }

    test('matches Excel Online URLs', () => {
        expect(matchesExcelPattern('https://excel.office.com/workbook/12345')).toBe(true);
    });

    test('matches Office Apps URLs', () => {
        expect(matchesExcelPattern('https://view.officeapps.live.com/op/view.aspx')).toBe(true);
    });

    test('matches SharePoint URLs', () => {
        expect(matchesExcelPattern('https://company.sharepoint.com/sites/team/file.xlsx')).toBe(true);
        expect(matchesExcelPattern('https://mycompany.sharepoint.com/:x:/r/sites/test')).toBe(true);
    });

    test('does not match non-Excel URLs', () => {
        expect(matchesExcelPattern('https://google.com')).toBe(false);
        expect(matchesExcelPattern('https://canvas.instructure.com')).toBe(false);
    });
});
