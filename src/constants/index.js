// [2025-12-18 09:30 AM]
// Version: 15.0
/*
* Timestamp: 2025-12-18 09:30 AM
* Version: 15.0
*/

// Centralized configuration for the Submission Checker extension.

/**
 * An enum-like object for the different checker modes.
 */
export const CHECKER_MODES = {
    SUBMISSION: 'submission',
    MISSING: 'missing'
};

/**
 * An enum-like object for the possible states of the extension.
 */
export const EXTENSION_STATES = {
    ON: 'on',
    OFF: 'off',
    PAUSED: 'paused'
};

/**
 * An enum-like object for message types sent between components.
 */
export const MESSAGE_TYPES = {
    INSPECTION_RESULT: 'inspectionResult',
    FOUND_SUBMISSION: 'foundSubmission',
    FOUND_MISSING_ASSIGNMENTS: 'foundMissingAssignments',
    MISSING_CHECK_COMPLETED: 'missingCheckCompleted',
    REQUEST_STORED_LOGS: 'requestingStoredLogs',
    STORED_LOGS: 'storedLogs',
    TEST_CONNECTION_PA: 'test-connection-pa',
    CONNECTION_TEST_RESULT: 'connection-test-result',
    SEND_DEBUG_PAYLOAD: 'send-debug-payload',
    LOG_TO_PANEL: 'logToPanel',
    SHOW_MISSING_ASSIGNMENTS_REPORT: 'showMissingAssignmentsReport',
    SRK_CONNECTOR_ACTIVE: 'SRK_CONNECTOR_ACTIVE',
    SRK_OFFICE_ADDIN_CONNECTED: 'SRK_OFFICE_ADDIN_CONNECTED',
    SRK_MASTER_LIST_UPDATED: 'SRK_MASTER_LIST_UPDATED',
    SRK_MASTER_LIST_ERROR: 'SRK_MASTER_LIST_ERROR',
    SRK_SELECTED_STUDENTS: 'SRK_SELECTED_STUDENTS',
    SRK_OFFICE_USER_INFO: 'SRK_OFFICE_USER_INFO',
    SRK_SEND_IMPORT_MASTER_LIST: 'SRK_SEND_IMPORT_MASTER_LIST',
    SRK_TASKPANE_PING: 'SRK_TASKPANE_PING',
    SRK_TASKPANE_PONG: 'SRK_TASKPANE_PONG',
    SRK_PING: 'SRK_PING',
    SRK_PONG: 'SRK_PONG',
    SRK_MANIFEST_INJECTED: 'SRK_MANIFEST_INJECTED',
    SRK_CREATE_SHEET: 'SRK_CREATE_SHEET',
    SRK_REQUEST_SHEET_LIST: 'SRK_REQUEST_SHEET_LIST',
    SRK_SHEET_LIST_RESPONSE: 'SRK_SHEET_LIST_RESPONSE',
    SRK_LINKS: 'SRK_LINKS',
    RESEND_HIGHLIGHT_PING: 'resendHighlightPing',
    RESEND_ALL_HIGHLIGHT_PINGS: 'resendAllHighlightPings',
    CANVAS_AUTH_ERROR: 'canvasAuthError',
    CANVAS_AUTH_RESPONSE: 'canvasAuthResponse'
};

/**
 * An enum-like object for connection types.
 */
export const CONNECTION_TYPES = {
    POWER_AUTOMATE: 'power-automate',
    EXCEL: 'excel'
};

/**
 * An enum-like object for Five9 connection states.
 */
export const FIVE9_CONNECTION_STATES = {
    NO_TAB: 'no_tab',                           // No Five9 tab detected
    AWAITING_CONNECTION: 'awaiting_connection', // Tab exists but agent not connected
    ACTIVE_CONNECTION: 'active_connection'      // Agent connected (network activity detected)
};

/**
 * UI feature flags for call controls
 * Set to true to show the feature, false to hide
 */
export const UI_FEATURES = {
    SHOW_MUTE_BUTTON: false,    // Future feature - mute/unmute during calls
    SHOW_SPEAKER_BUTTON: false  // Future feature - speaker volume control
};

/**
 * Keys for data stored in chrome.storage.local.
 *
 * Storage Structure:
 * - settings: Nested settings organized by feature/integration
 *   - excelAddIn: Excel add-in related settings
 *     - highlight: Row highlighting configuration
 *   - powerAutomate: Power Automate integration settings
 *   - canvas: Canvas LMS settings
 *   - five9: Five9 telephony settings
 *   - submissionChecker: Submission checker filter settings
 * - state: Extension state information
 * - timestamps: Various timestamp values
 * - Flat keys: Frequently written data (foundEntries, masterEntries, canvasApiCache)
 */
export const STORAGE_KEYS = {
    // === SETTINGS (nested) ===
    SETTINGS: 'settings',

    // General settings (settings.*)
    AUTO_UPDATE_MASTER_LIST: 'settings.autoUpdateMasterList',
    TUTORIAL_COMPLETED: 'settings.tutorialCompleted',
    LAST_SEEN_VERSION: 'settings.lastSeenVersion',

    // Excel Add-in settings (settings.excelAddIn.*)
    SEND_MASTER_LIST_TO_EXCEL: 'settings.excelAddIn.sendMasterListToExcel',
    REFORMAT_NAME_ENABLED: 'settings.excelAddIn.reformatNameEnabled',
    SYNC_ACTIVE_STUDENT: 'settings.excelAddIn.syncActiveStudent',
    AUTO_SIDELOAD_MANIFEST: 'settings.excelAddIn.autoSideloadManifest',

    // Excel Add-in Highlight settings (settings.excelAddIn.highlight.*)
    HIGHLIGHT_STUDENT_ROW_ENABLED: 'settings.excelAddIn.highlight.studentRowEnabled',
    HIGHLIGHT_ROW_COLOR: 'settings.excelAddIn.highlight.rowColor',
    HIGHLIGHT_START_COL: 'settings.excelAddIn.highlight.startCol',
    HIGHLIGHT_END_COL: 'settings.excelAddIn.highlight.endCol',
    HIGHLIGHT_EDIT_COLUMN: 'settings.excelAddIn.highlight.editColumn',
    HIGHLIGHT_EDIT_TEXT: 'settings.excelAddIn.highlight.editText',
    HIGHLIGHT_TARGET_SHEET: 'settings.excelAddIn.highlight.targetSheet',
    HIGHLIGHT_TARGET_TAB_ID: 'highlightTargetTabId', // Selected Excel tab ID for highlight pings

    // Excel export color settings (settings.excelAddIn.export.*)
    EXPORT_TAB_COLOR: 'settings.excelAddIn.export.tabColor',
    EXPORT_COLOR_SCALE_LOW: 'settings.excelAddIn.export.colorScaleLow',
    EXPORT_COLOR_SCALE_MID: 'settings.excelAddIn.export.colorScaleMid',
    EXPORT_COLOR_SCALE_HIGH: 'settings.excelAddIn.export.colorScaleHigh',

    // Power Automate settings (settings.powerAutomate.*)
    POWER_AUTOMATE_URL: 'settings.powerAutomate.url',
    POWER_AUTOMATE_ENABLED: 'settings.powerAutomate.enabled',
    POWER_AUTOMATE_DEBUG: 'settings.powerAutomate.debug',

    // Canvas settings (settings.canvas.*)
    EMBED_IN_CANVAS: 'settings.canvas.embedInCanvas',
    HIGHLIGHT_COLOR: 'settings.canvas.highlightColor',
    CANVAS_CACHE_ENABLED: 'settings.canvas.cacheEnabled',
    NON_API_COURSE_FETCH: 'settings.canvas.nonApiCourseFetch',
    NEXT_ASSIGNMENT_ENABLED: 'settings.canvas.nextAssignmentEnabled',

    // Five9 settings (settings.five9.*)
    CALL_DEMO: 'settings.five9.callDemo',
    AUTO_SWITCH_TO_CALL_TAB: 'settings.five9.autoSwitchToCallTab',

    // Submission Checker settings (settings.submissionChecker.*)
    LOOPER_DAYS_OUT_FILTER: 'settings.submissionChecker.looperDaysOutFilter',
    SCAN_FILTER_INCLUDE_FAILING: 'settings.submissionChecker.scanFilterIncludeFailing',

    // === STATE (nested) ===
    STATE: 'state',
    EXTENSION_STATE: 'state.extensionState',
    SRK_SESSION_ID: 'state.srkSessionId',

    // === TIMESTAMPS (nested) ===
    TIMESTAMPS: 'timestamps',
    LAST_CALL_TIMESTAMP: 'timestamps.lastCallTimestamp',
    LAST_UPDATED: 'timestamps.lastUpdated',
    MASTER_LIST_SOURCE_TIMESTAMP: 'timestamps.masterListSourceTimestamp',
    REFERENCE_DATE: 'timestamps.referenceDate',

    // === FLAT KEYS (frequently written) ===
    FOUND_ENTRIES: 'foundEntries',
    MASTER_ENTRIES: 'masterEntries',
    CAMPUS_LIST: 'campusList',
    CAMPUS_PREFIX: 'campusPrefix',
    CANVAS_API_CACHE: 'canvasApiCache',

    // === OTHER (flat for backwards compatibility or misc) ===
    LOOP_STATUS: 'loopStatus',
    CONNECTIONS: 'connections',
    LATEST_MISSING_REPORT: 'latestMissingReport',
    CHECKER_MODE: 'checkerMode',
    CONCURRENT_TABS: 'concurrentTabs',
    CUSTOM_KEYWORD: 'customKeyword',
    INCLUDE_ALL_ASSIGNMENTS: 'includeAllAssignments',
    USE_SPECIFIC_DATE: 'useSpecificDate',
    SPECIFIC_SUBMISSION_DATE: 'specificSubmissionDate',
    OFFICE_USER_INFO: 'officeUserInfo',

    // Legacy key aliases (for migration compatibility)
    // These map old flat keys to new nested paths
    LEGACY_DEBUG_MODE: 'debugMode' // Now at settings.five9.callDemo
};

/**
 * Default values for all extension settings.
 */
export const DEFAULT_SETTINGS = {
    // General settings
    [STORAGE_KEYS.AUTO_UPDATE_MASTER_LIST]: 'always', // Options: 'always', 'once-daily', 'never'
    [STORAGE_KEYS.TUTORIAL_COMPLETED]: false,
    [STORAGE_KEYS.LAST_SEEN_VERSION]: null, // Tracks last version user has seen updates for

    // Excel Add-in settings
    [STORAGE_KEYS.SEND_MASTER_LIST_TO_EXCEL]: true,
    [STORAGE_KEYS.REFORMAT_NAME_ENABLED]: true,
    [STORAGE_KEYS.SYNC_ACTIVE_STUDENT]: true,
    [STORAGE_KEYS.AUTO_SIDELOAD_MANIFEST]: true,

    // Excel Add-in Highlight settings
    [STORAGE_KEYS.HIGHLIGHT_STUDENT_ROW_ENABLED]: true,
    [STORAGE_KEYS.HIGHLIGHT_ROW_COLOR]: '#92d050',
    [STORAGE_KEYS.HIGHLIGHT_START_COL]: 'Student Name',
    [STORAGE_KEYS.HIGHLIGHT_END_COL]: 'Outreach',
    [STORAGE_KEYS.HIGHLIGHT_EDIT_COLUMN]: 'Outreach',
    [STORAGE_KEYS.HIGHLIGHT_EDIT_TEXT]: 'Submitted {assignment}',
    [STORAGE_KEYS.HIGHLIGHT_TARGET_SHEET]: 'LDA MM-DD-YYYY',

    // Excel export color settings
    [STORAGE_KEYS.EXPORT_TAB_COLOR]: '#fcd5b4',
    [STORAGE_KEYS.EXPORT_COLOR_SCALE_LOW]: '#F8696B',
    [STORAGE_KEYS.EXPORT_COLOR_SCALE_MID]: '#FFEB84',
    [STORAGE_KEYS.EXPORT_COLOR_SCALE_HIGH]: '#63BE7B',

    // Power Automate settings
    [STORAGE_KEYS.POWER_AUTOMATE_URL]: '',
    [STORAGE_KEYS.POWER_AUTOMATE_ENABLED]: false,
    [STORAGE_KEYS.POWER_AUTOMATE_DEBUG]: false,

    // Canvas settings
    [STORAGE_KEYS.EMBED_IN_CANVAS]: true,
    [STORAGE_KEYS.HIGHLIGHT_COLOR]: '#ffff00',
    [STORAGE_KEYS.CANVAS_CACHE_ENABLED]: true,
    [STORAGE_KEYS.NON_API_COURSE_FETCH]: true,
    [STORAGE_KEYS.NEXT_ASSIGNMENT_ENABLED]: false,

    // Five9 settings
    [STORAGE_KEYS.CALL_DEMO]: false, // Call demo mode (was debugMode)
    [STORAGE_KEYS.AUTO_SWITCH_TO_CALL_TAB]: true, // Auto switch to Call tab when clicking student

    // Submission Checker settings
    [STORAGE_KEYS.LOOPER_DAYS_OUT_FILTER]: '>=5',
    [STORAGE_KEYS.SCAN_FILTER_INCLUDE_FAILING]: false,

    // Other flat settings
    [STORAGE_KEYS.CHECKER_MODE]: CHECKER_MODES.SUBMISSION,
    [STORAGE_KEYS.CONCURRENT_TABS]: 5,
    [STORAGE_KEYS.CUSTOM_KEYWORD]: '',
    [STORAGE_KEYS.INCLUDE_ALL_ASSIGNMENTS]: false,
    [STORAGE_KEYS.USE_SPECIFIC_DATE]: false,
    [STORAGE_KEYS.SPECIFIC_SUBMISSION_DATE]: null
};

/**
 * The name for the network recovery alarm.
 */
export const NETWORK_RECOVERY_ALARM_NAME = 'network_recovery_check';

/**
 * Regular expression for parsing advanced filter queries like '>=5' or '<10'.
 */
export const ADVANCED_FILTER_REGEX = /^\s*([><]=?|=)\s*(\d+)\s*$/;

/**
 * SharePoint URL for the "SharePoint" button in the settings tab.
 */
export const SHAREPOINT_URL = "https://edukgroup3_sharepoint.com/sites/SM-StudentServices/SitePages/CollabHome.aspx";

/**
 * Canvas LMS subdomain (the part before .instructure.com).
 * Change this value to update the Canvas domain across the extension.
 * Note: Also update manifest.json host_permissions and content_scripts manually.
 */
export const CANVAS_SUBDOMAIN = "northbridge";

/**
 * Canvas LMS domain URL.
 */
export const CANVAS_DOMAIN = `https://${CANVAS_SUBDOMAIN}.instructure.com`;

/**
 * Generic avatar URL used by Canvas for users without custom avatars.
 */
export const GENERIC_AVATAR_URL = `https://${CANVAS_SUBDOMAIN}.instructure.com/images/messages/avatar-50.png`;

/**
 * Legacy Canvas subdomains for backwards compatibility.
 * URLs with these subdomains will be automatically normalized to CANVAS_SUBDOMAIN.
 */
export const LEGACY_CANVAS_SUBDOMAINS = ["nuc"];

/**
 * Normalizes a Canvas URL to use the current CANVAS_SUBDOMAIN.
 * This provides backwards compatibility when the school rebrands.
 * @param {string} url - The URL to normalize
 * @returns {string} The normalized URL
 */
export function normalizeCanvasUrl(url) {
    if (!url) return url;

    for (const legacySubdomain of LEGACY_CANVAS_SUBDOMAINS) {
        const legacyPattern = new RegExp(`https://${legacySubdomain}\\.instructure\\.com`, 'gi');
        if (legacyPattern.test(url)) {
            return url.replace(legacyPattern, `https://${CANVAS_SUBDOMAIN}.instructure.com`);
        }
    }

    return url;
}

/**
 * Guide resources available in the extension.
 * Each guide has a name and path to the PDF file.
 */
export const GUIDES = [
    {
        name: 'LDA Guide',
        path: '../../assets/LDA-Guide.pdf',
        icon: 'fa-book'
    },
	{
        name: 'Student Population Report Guide',
        path: '../../assets/Download-Student-Population-Report.pdf',
        icon: 'fa-book'
    }
];

/**
 * Field aliases for semantic field matching in file imports and incoming payloads.
 * Maps internal field names to semantically equivalent field names (actual aliases).
 *
 * NOTE: You don't need to specify case/space variations (e.g., "StudentNumber" vs "student number")
 * as these are handled automatically by normalizeFieldName().
 * Only specify true semantic aliases here (e.g., "Student ID" is an alias for "StudentNumber").
 */
export const FIELD_ALIASES = {
    name: ['studentname', 'student'],
    phone: ['primaryphone', 'phonenumber', 'mobile', 'cell', 'cellphone', 'contact', 'telephone', 'otherphone'],
    grade: ['gradelevel', 'level'],
    StudentNumber: ['studentid', 'sisid', 'printid'],
    SyStudentId: ['studentsis'],
    daysOut: ['daysinactive', 'days'],
    url: ['gradebook', 'gradeBookUrl', 'canvasUrl', 'studentUrl'],
	studentEmail: ['email', 'studentsemail', 'studentemails', 'studentsemails'],
	personalEmail: ['otheremail', 'studentspersonalemail', 'personalstudentemail', 'othermemails'],
	lda: ['lastdayofattendance', 'lastattendance', 'lastdateofattendance', 'lastdayattended'],
	campus: ['location', 'site', 'school', 'campusname'],
    // Academic report aliases
    programVersion: ['progverdescrip'],
    amRep: ['admrep'],
    adSAPStatus: ['sapstatus', 'sapdescripterm']
};

/**
 * Excel Export Column Configurations
 * Master List columns used for both CSV/Excel export and Excel import payload.
 * Modify this array to customize what columns appear in exports and imports.
 */

/**
 * Master List sheet columns
 * Each object defines: { header: 'Column Name', field: 'propertyName', fallback: optional fallback field, width: optional column width }
 * width: Custom column width in characters (wch). If not specified, column will auto-fit based on content.
 */
export const MASTER_LIST_COLUMNS = [
    { header: 'Student Name', field: 'name', width: 25 },
    { header: 'Student Number', field: 'StudentNumber', width: 13 },
    { header: 'Grade Book', field: 'url', hyperlink: true, hyperlinkText: 'Grade Book', width: 9 },
    { header: 'Grade', field: 'grade', fallback: 'currentGrade', conditionalFormatting: 'grade', width: 6 },
    { header: 'Missing Assignments', field: 'missingCount', width: 10 },
    { header: 'Next Assignment Due', field: 'nextAssignment.DueDate', width: 15 },
    { header: 'LDA', field: 'lda', width: 8 },
    { header: 'Days Out', field: 'daysOut', width: 8 },
    { header: 'Gender', field: 'gender', hidden: true },
    { header: 'Shift', field: 'shift', width: 10 },
    { header: 'Program Version', field: 'programVersion', width: 30 },
    { header: 'SyStudentId', field: 'SyStudentId', width: 10 },
    { header: 'Phone', field: 'phone', fallback: 'primaryPhone', width: 10 },
    { header: 'Other Phone', field: 'otherPhone', width: 10 },
    { header: 'Work Phone', field: 'workPhone', hidden: true , width: 8},
    { header: 'Mobile Number', field: 'mobileNumber', hidden: true , width: 8},
    { header: 'Student Email', field: 'studentEmail', width: 20 },
    { header: 'Personal Email', field: 'personalEmail', width: 20 },
    { header: 'ExpStartDate', field: 'expStartDate', width: 12 },
    { header: 'AmRep', field: 'amRep', width: 15 },
    { header: 'Hold', field: 'hold', width: 10 },
    { header: 'Photo', field: 'photo', hidden: true, width: 4 },
    { header: 'AdSAPStatus', field: 'adSAPStatus', width: 8 },
    // Academic report columns
    { header: 'Instructor', field: 'instructorName', width: 20 },
    { header: 'Instructor Email', field: 'instructorEmail', width: 25, hidden: true },
    { header: 'Course Code', field: 'courseCode', width: 12 },
    { header: 'Course', field: 'courseDescrip', width: 25 },
    { header: 'Course Start', field: 'courseStartDate', width: 12, hidden: true },
    { header: 'Course End', field: 'courseEndDate', width: 12, hidden: true },
    { header: 'Letter Grade', field: 'letterGrade', width: 8 },
    { header: 'Last Course Grade', field: 'lastCourseGrade', conditionalFormatting: 'grade', width: 10 },
    { header: 'Last Course Letter Grade', field: 'lastCourseLetterGrade', width: 10 },
    { header: 'Enroll GPA', field: 'enrollGpa', width: 8 },
    { header: 'Enrollment Status', field: 'currEnrollStatus', width: 15 },
    { header: 'Campus', field: 'campus', width: 15 }
];

/**
 * Missing Assignments sheet columns
 * Use 'student.' prefix for student fields and 'assignment.' prefix for assignment fields
 * Standardized field names: assignmentTitle, assignmentLink, submissionLink
 * Note: Some columns use hyperlink: true to indicate they should be exported as HYPERLINK formulas
 * width: Custom column width in characters (wch). If not specified, column will auto-fit based on content.
 */
export const EXPORT_MISSING_ASSIGNMENTS_COLUMNS = [
    { header: 'Student', field: 'student.name', width: 25 },
	{ header: 'Grade Book', field: 'student.url', hyperlink: true, hyperlinkText: 'Grade Book', width: 12 },
	{ header: 'Overall Grade', field: 'student.currentGrade', fallback: 'student.grade', conditionalFormatting: 'grade', width: 8 },
    { header: 'Assignment', field: 'assignment.assignmentTitle', hyperlinkField: 'assignment.assignmentLink', hyperlink: true, width: 35 },
    { header: 'Due Date', field: 'assignment.dueDate', width: 12 },
    { header: 'Score', field: 'assignment.score', width: 8 },
    { header: 'Submission', field: 'assignment.submissionLink', hyperlink: true, hyperlinkText: 'Missing', width: 12 }
];

/**
 * LDA Sheet visible columns whitelist
 * Only columns listed here will be visible in the LDA sheet
 * Columns are identified by their field name from MASTER_LIST_COLUMNS
 */
export const LDA_VISIBLE_COLUMNS = [
    'assigned',
    'name',
    'StudentNumber',
    'url',
    'grade',
    'missingCount',
    'outreach',
    'lda',
    'daysOut',
    'shift',
    'programVersion',
    'phone',
    'otherPhone'
];

/**
 * Sheet Definitions for Tutorial Setup
 * Each sheet has a name and an array of column headers
 * Used when creating sheets via the tutorial's Initial Setup page
 */
export const SHEET_DEFINITIONS = {
    MASTER_LIST: {
        name: 'Master List',
        headers: [
            'Assigned',
            'Student Name',
            'Student Number',
            'Gradebook',
            'Grade',
            'Missing Assignments',
            'LDA',
            'Days Out',
            'Gender',
            'Shift',
            'Outreach',
            'ProgramVersion',
            'SyStudentId',
            'Phone',
            'Other Phone',
            'WorkPhone',
            'MobileNumber',
            'StudentEmail',
            'PersonalEmail',
            'ExpStartDate',
            'AmRep',
            'Hold',
            'Photo',
            'AdSAPStatus',
            'Instructor',
            'Course Code',
            'Course',
            'Letter Grade',
            'Last Course Grade',
            'Last Course Letter Grade',
            'Enroll GPA',
            'Enrollment Status'
        ]
    },
    STUDENT_HISTORY: {
        name: 'Student History',
        headers: [
            'CommentID',
            'Student',
            'SyStudentId',
            'Created By',
            'Tag',
            'Timestamp',
            'Comment'
        ]
    },
    MISSING_ASSIGNMENTS: {
        name: 'Missing Assignments',
        headers: [
            'Student',
            'Grade',
            'Grade Book',
            'Assignment',
            'Due Date',
            'Score',
            'Submission'
        ]
    }
};
