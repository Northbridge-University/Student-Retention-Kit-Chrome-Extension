// UI Manager - Handles DOM element caching, tab switching, and UI state updates
import { EXTENSION_STATES } from '../constants/index.js';
import { updateToggleUI } from '../utils/ui-helpers.js';

// --- DOM ELEMENTS CACHE ---
export const elements = {};

/**
 * Caches all DOM elements for efficient access throughout the app
 */
export function cacheDomElements() {
    // Navigation
    elements.tabs = document.querySelectorAll('.tab-button');
    elements.contents = document.querySelectorAll('.tab-content');

    // Header
    elements.headerTitle = document.getElementById('headerTitle');
    elements.headerSettingsBtn = document.getElementById('headerSettingsBtn');
    elements.versionText = document.getElementById('versionText');

    // Checker Tab
    elements.startBtn = document.getElementById('startBtn');
    elements.startBtnText = document.getElementById('startBtnText');
    elements.startBtnIcon = elements.startBtn ? elements.startBtn.querySelector('i') : null;
    elements.statusDot = document.getElementById('statusDot');
    elements.statusText = document.getElementById('statusText');
    elements.foundList = document.querySelector('#checker .glass-list');
    elements.clearListBtn = document.getElementById('clearFoundListBtn');
    elements.foundSearch = document.querySelector('#checker input[type="text"]');

    // Call Tab
    elements.dialBtn = document.getElementById('dialBtn');
    elements.callStatusText = document.querySelector('.call-status-bar');
    elements.callTimer = document.querySelector('.call-timer');
    elements.callDispositionSection = document.getElementById('callDispositionSection');
    elements.lastCallTimestamp = document.getElementById('lastCallTimestamp');
    elements.otherInputArea = document.getElementById('otherInputArea');
    elements.customNote = document.getElementById('customNote');
    elements.confirmNoteBtn = elements.otherInputArea ? elements.otherInputArea.querySelector('.btn-primary') : null;
    elements.dispositionGrid = document.querySelector('.disposition-grid');

    // Call Tab - Up Next Card
    elements.upNextCard = document.getElementById('upNextCard');
    elements.upNextName = document.getElementById('upNextName');
    elements.skipStudentBtn = document.getElementById('skipStudentBtn');
    elements.pauseAutomationBtn = document.getElementById('pauseAutomationBtn');

    // Call Tab - Student Card & Placeholder Logic
    const contactTab = document.getElementById('contact');
    if (contactTab) {
        elements.contactCard = contactTab.querySelector('.setting-card');

        // --- INJECT UNIFIED PLACEHOLDER ---
        // This placeholder shows different messages based on state priority:
        // 1. Five9 connection issues (highest priority when student is selected)
        // 2. No student selected (lowest priority)
        let callTabPlaceholder = document.getElementById('callTabPlaceholder');
        if (!callTabPlaceholder) {
            callTabPlaceholder = document.createElement('div');
            callTabPlaceholder.id = 'callTabPlaceholder';
            callTabPlaceholder.style.cssText = 'display:none; flex-direction:column; align-items:center; justify-content:flex-start; padding-top:80px; height:100%; min-height:400px; color:#9ca3af; text-align:center; padding-left:20px; padding-right:20px;';
            // Default content - will be updated dynamically
            callTabPlaceholder.innerHTML = `
                <i class="fas fa-user-graduate" style="font-size:3em; margin-bottom:15px; opacity:0.5;"></i>
                <span style="font-size:1.1em; font-weight:500;">No Student Selected</span>
                <span style="font-size:0.9em; margin-top:5px; color:#6b7280;">Select a student from the Master List<br>to view details and make calls.</span>
            `;
            contactTab.insertBefore(callTabPlaceholder, contactTab.firstChild);
        }
        elements.callTabPlaceholder = callTabPlaceholder;

        // Legacy references for backwards compatibility
        elements.contactPlaceholder = callTabPlaceholder;
        elements.five9ConnectionIndicator = callTabPlaceholder;

        // Cache Card Details
        if (elements.contactCard) {
            elements.contactAvatar = contactTab.querySelector('.setting-card div[style*="border-radius:50%"]');
            const infoContainer = contactTab.querySelector('.setting-card div > div:not([style])');
            if (infoContainer) {
                elements.contactName = infoContainer.children[0];
                elements.contactDetail = infoContainer.children[1];
            } else {
                elements.contactName = contactTab.querySelector('.setting-card div > div:first-child');
                elements.contactDetail = contactTab.querySelector('.setting-card div > div:last-child');
            }
            elements.contactPhone = contactTab.querySelector('.phone-number-display');
        }
    }

    // Data Tab
    elements.masterList = document.getElementById('masterList');
    elements.masterSearch = document.getElementById('masterSearch');
    elements.sortSelect = document.getElementById('sortSelect');
    elements.sortFilterBtn = document.getElementById('sortFilterBtn');
    elements.sortDropdownMenu = document.getElementById('sortDropdownMenu');
    elements.viewListBtn = document.getElementById('viewListBtn');
    elements.viewStatsBtn = document.getElementById('viewStatsBtn');
    elements.listViewSection = document.getElementById('listViewSection');
    elements.statsViewSection = document.getElementById('statsViewSection');
    elements.whiskerPlotCanvas = document.getElementById('whiskerPlotCanvas');
    elements.whiskerPlotLegend = document.getElementById('whiskerPlotLegend');
    elements.whiskerPlotStats = document.getElementById('whiskerPlotStats');
    elements.distributionSelect = document.getElementById('distributionSelect');
    elements.campusFilter = document.getElementById('campusFilter');
    elements.campusFilterContainer = document.getElementById('campusFilterContainer');
    elements.updateMasterBtn = document.getElementById('updateMasterBtn');
    elements.downloadMasterBtn = document.getElementById('downloadMasterBtn');
    elements.updateMasterContextMenu = document.getElementById('updateMasterContextMenu');
    elements.sendListToExcelMenuItem = document.getElementById('sendListToExcelMenuItem');
    elements.checkGradeBookMenuItem = document.getElementById('checkGradeBookMenuItem');
    elements.settingsContextMenu = document.getElementById('settingsContextMenu');
    elements.moreSettingsMenuItem = document.getElementById('moreSettingsMenuItem');
    elements.moreSettingsModal = document.getElementById('moreSettingsModal');
    elements.closeMoreSettingsBtn = document.getElementById('closeMoreSettingsBtn');
    elements.saveMoreSettingsBtn = document.getElementById('saveMoreSettingsBtn');
    elements.checkerContextMenu = document.getElementById('checkerContextMenu');
    elements.resendHighlightPingMenuItem = document.getElementById('resendHighlightPingMenuItem');
    elements.checkerContextMenuText = document.getElementById('checkerContextMenuText');
    elements.updateQueueSection = document.getElementById('updateQueueSection');

    // Mini Console
    elements.miniConsole = document.getElementById('miniConsole');
    elements.consoleHeader = document.getElementById('consoleHeader');
    elements.consoleContent = document.getElementById('consoleContent');
    elements.clearConsoleBtn = document.getElementById('clearConsoleBtn');
    elements.queueCloseBtn = elements.updateQueueSection ? elements.updateQueueSection.querySelector('.icon-btn') : null;
    elements.lastUpdatedText = document.getElementById('lastUpdatedText');
    elements.totalCountText = document.getElementById('totalCountText');

    // Step 1 File Input
    elements.studentPopFile = document.getElementById('studentPopFile');

    // Modals & Settings
    elements.clearMasterListBtn = document.getElementById('clearMasterListBtn');
    elements.useSpecificDateToggle = document.getElementById('useSpecificDateToggle');
    elements.specificDatePicker = document.getElementById('specificDatePicker');
    elements.specificDateInput = document.getElementById('specificDateInput');
    elements.clearSpecificDateBtn = document.getElementById('clearSpecificDateBtn');

    // Scan Filter Modal
    elements.scanFilterModal = document.getElementById('scanFilterModal');
    elements.scanFilterBtn = document.getElementById('scanFilterBtn');
    elements.closeScanFilterBtn = document.getElementById('closeScanFilterBtn');
    elements.daysOutOperator = document.getElementById('daysOutOperator');
    elements.daysOutValue = document.getElementById('daysOutValue');
    elements.failingToggle = document.getElementById('failingToggle');
    elements.saveScanFilterBtn = document.getElementById('saveScanFilterBtn');
    elements.studentCountValue = document.getElementById('studentCountValue');

    // Queue Modal
    elements.queueModal = document.getElementById('queueModal');
    elements.closeQueueModalBtn = document.getElementById('closeQueueModalBtn');
    elements.manageQueueBtn = document.getElementById('manageQueueBtn');
    elements.queueList = document.getElementById('queueList');
    elements.queueCount = document.getElementById('queueCount');

    // Guides Modal
    elements.guidesModal = document.getElementById('guidesModal');
    elements.openGuidesBtn = document.getElementById('openGuidesBtn');
    elements.closeGuidesModalBtn = document.getElementById('closeGuidesModalBtn');
    elements.guidesContainer = document.getElementById('guidesContainer');

    // Daily Update Modal
    elements.dailyUpdateModal = document.getElementById('dailyUpdateModal');
    elements.closeDailyUpdateBtn = document.getElementById('closeDailyUpdateBtn');
    elements.dailyUpdateBtn = document.getElementById('dailyUpdateBtn');
    elements.dailyUpdateLaterBtn = document.getElementById('dailyUpdateLaterBtn');

    // Latest Updates Modal
    elements.latestUpdatesModal = document.getElementById('latestUpdatesModal');
    elements.closeLatestUpdatesBtn = document.getElementById('closeLatestUpdatesBtn');
    elements.latestUpdatesGotItBtn = document.getElementById('latestUpdatesGotItBtn');
    elements.latestUpdatesTitle = document.getElementById('latestUpdatesTitle');
    elements.latestUpdatesVersion = document.getElementById('latestUpdatesVersion');
    elements.latestUpdatesDate = document.getElementById('latestUpdatesDate');
    elements.latestUpdatesList = document.getElementById('latestUpdatesList');

    // Excel Instance Modal
    elements.excelInstanceModal = document.getElementById('excelInstanceModal');
    elements.closeExcelInstanceBtn = document.getElementById('closeExcelInstanceBtn');
    elements.excelInstanceList = document.getElementById('excelInstanceList');
    elements.excelInstanceMessage = document.getElementById('excelInstanceMessage');

    // Import Status Modal
    elements.importStatusModal = document.getElementById('importStatusModal');
    elements.importStatusTitle = document.getElementById('importStatusTitle');
    elements.importStatusIcon = document.getElementById('importStatusIcon');
    elements.importStatusIconContainer = document.getElementById('importStatusIconContainer');
    elements.importStatusText = document.getElementById('importStatusText');
    elements.importStatusSubtext = document.getElementById('importStatusSubtext');
    elements.importStatusSteps = document.getElementById('importStatusSteps');
    elements.importStatusRetryContainer = document.getElementById('importStatusRetryContainer');
    elements.importStatusRetryBtn = document.getElementById('importStatusRetryBtn');
    elements.importStatusRetrySubtext = document.getElementById('importStatusRetrySubtext');
    elements.importStatusCloseBtn = document.getElementById('importStatusCloseBtn');

    // Campus Selection Modal
    elements.campusSelectionModal = document.getElementById('campusSelectionModal');
    elements.closeCampusSelectionBtn = document.getElementById('closeCampusSelectionBtn');
    elements.campusSelectionList = document.getElementById('campusSelectionList');
    elements.campusSelectionMessage = document.getElementById('campusSelectionMessage');

    // Attendance Report Modal
    elements.attendanceReportModal = document.getElementById('attendanceReportModal');
    elements.closeAttendanceReportBtn = document.getElementById('closeAttendanceReportBtn');
    elements.attendanceReportYesBtn = document.getElementById('attendanceReportYesBtn');
    elements.attendanceReportNoBtn = document.getElementById('attendanceReportNoBtn');

    // Canvas Auth Error Modal
    elements.canvasAuthErrorModal = document.getElementById('canvasAuthErrorModal');
    elements.canvasAuthRetryBtn = document.getElementById('canvasAuthRetryBtn');
    elements.canvasAuthShutdownBtn = document.getElementById('canvasAuthShutdownBtn');
    elements.canvasAuthNonApiToggle = document.getElementById('canvasAuthNonApiToggle');

    // Canvas Login Modal
    elements.canvasLoginModal = document.getElementById('canvasLoginModal');
    elements.canvasLoginResumeBtn = document.getElementById('canvasLoginResumeBtn');
    elements.canvasLoginLink = document.getElementById('canvasLoginLink');

    // Student View Modal
    elements.studentViewModal = document.getElementById('studentViewModal');
    elements.studentViewMain = document.getElementById('studentViewMain');
    elements.studentViewAvatar = document.getElementById('studentViewAvatar');
    elements.studentViewName = document.getElementById('studentViewName');
    elements.studentViewCampus = document.getElementById('studentViewCampus');
    elements.studentViewNewBadge = document.getElementById('studentViewNewBadge');
    elements.studentViewDaysOut = document.getElementById('studentViewDaysOut');
    elements.studentViewDaysOutCard = document.getElementById('studentViewDaysOutCard');
    elements.studentViewGrade = document.getElementById('studentViewGrade');
    elements.studentViewGradeCard = document.getElementById('studentViewGradeCard');
    elements.studentViewMissingCard = document.getElementById('studentViewMissingCard');
    elements.studentViewMissingCount = document.getElementById('studentViewMissingCount');
    elements.studentViewNextCard = document.getElementById('studentViewNextCard');
    elements.studentViewNextDate = document.getElementById('studentViewNextDate');
    elements.studentViewEmailBtn = document.getElementById('studentViewEmailBtn');
    elements.studentViewCallBtn = document.getElementById('studentViewCallBtn');
    // Missing Assignments Detail View
    elements.studentViewMissingDetail = document.getElementById('studentViewMissingDetail');
    elements.studentViewMissingBackBtn = document.getElementById('studentViewMissingBackBtn');
    elements.studentViewMissingList = document.getElementById('studentViewMissingList');
    // Next Assignment Detail View
    elements.studentViewNextDetail = document.getElementById('studentViewNextDetail');
    elements.studentViewNextBackBtn = document.getElementById('studentViewNextBackBtn');
    elements.studentViewNextDetailContent = document.getElementById('studentViewNextDetailContent');
    elements.studentViewNextAssignment = document.getElementById('studentViewNextAssignment');
    elements.studentViewNextAssignmentDate = document.getElementById('studentViewNextAssignmentDate');
    elements.studentViewNoNextAssignment = document.getElementById('studentViewNoNextAssignment');
    // Days Out Detail View
    elements.studentViewDaysOutDetail = document.getElementById('studentViewDaysOutDetail');
    elements.studentViewDaysOutBackBtn = document.getElementById('studentViewDaysOutBackBtn');
    elements.studentViewDaysOutTitle = document.getElementById('studentViewDaysOutTitle');
    elements.studentViewDaysLeftText = document.getElementById('studentViewDaysLeftText');
    elements.studentViewDeadlineText = document.getElementById('studentViewDeadlineText');

    // Connections Modal
    elements.connectionsModal = document.getElementById('connectionsModal');
    elements.closeConnectionsBtn = document.getElementById('closeConnectionsBtn');
    elements.configureExcelBtn = document.getElementById('configureExcelBtn');
    elements.configurePowerAutomateBtn = document.getElementById('configurePowerAutomateBtn');
    elements.configureCanvasBtn = document.getElementById('configureCanvasBtn');
    elements.configureFive9Btn = document.getElementById('configureFive9Btn');
    elements.connectionModalTitle = document.getElementById('connectionModalTitle');
    elements.excelConfigContent = document.getElementById('excelConfigContent');
    elements.powerAutomateConfigContent = document.getElementById('powerAutomateConfigContent');
    elements.canvasConfigContent = document.getElementById('canvasConfigContent');
    elements.five9ConfigContent = document.getElementById('five9ConfigContent');
    elements.autoUpdateSelectModal = document.getElementById('autoUpdateSelectModal');
    elements.syncActiveStudentToggleModal = document.getElementById('syncActiveStudentToggleModal');
    elements.sendMasterListToggleModal = document.getElementById('sendMasterListToggleModal');
    elements.reformatNameToggleModal = document.getElementById('reformatNameToggleModal');
    elements.highlightStudentRowToggleModal = document.getElementById('highlightStudentRowToggleModal');
    elements.highlightStudentRowHeader = document.getElementById('highlightStudentRowHeader');
    elements.highlightStudentRowCollapsible = document.getElementById('highlightStudentRowCollapsible');
    elements.highlightStudentRowChevron = document.getElementById('highlightStudentRowChevron');
    elements.highlightSettingsContainer = document.getElementById('highlightSettingsContainer');
    elements.highlightStartColInput = document.getElementById('highlightStartColInput');
    elements.highlightEndColInput = document.getElementById('highlightEndColInput');
    elements.highlightEditColumnInput = document.getElementById('highlightEditColumnInput');
    elements.highlightEditTextInput = document.getElementById('highlightEditTextInput');
    elements.highlightTargetSheetSelect = document.getElementById('highlightTargetSheetSelect');
    elements.highlightTargetSheetCustomInput = document.getElementById('highlightTargetSheetCustomInput');
    elements.highlightTargetSheetHint = document.getElementById('highlightTargetSheetHint');
    elements.highlightRowColorInput = document.getElementById('highlightRowColorInput');
    elements.highlightRowColorTextInput = document.getElementById('highlightRowColorTextInput');
    elements.exportTabColorInput = document.getElementById('exportTabColorInput');
    elements.exportTabColorTextInput = document.getElementById('exportTabColorTextInput');
    elements.exportColorScaleLowInput = document.getElementById('exportColorScaleLowInput');
    elements.exportColorScaleMidInput = document.getElementById('exportColorScaleMidInput');
    elements.exportColorScaleHighInput = document.getElementById('exportColorScaleHighInput');
    elements.powerAutomateUrlInput = document.getElementById('powerAutomateUrlInput');
    elements.toggleUrlVisibility = document.getElementById('toggleUrlVisibility');
    elements.powerAutomateStatusText = document.getElementById('powerAutomateStatusText');
    elements.powerAutomateStatusDot = document.getElementById('powerAutomateStatusDot');
    elements.powerAutomateEnabledToggle = document.getElementById('powerAutomateEnabledToggle');
    elements.powerAutomateDebugToggle = document.getElementById('powerAutomateDebugToggle');
    elements.powerAutomateSettingsContainer = document.getElementById('powerAutomateSettingsContainer');
    elements.powerAutomateDebugContainer = document.getElementById('powerAutomateDebugContainer');
    elements.canvasStatusText = document.getElementById('canvasStatusText');
    elements.canvasStatusDot = document.getElementById('canvasStatusDot');
    elements.five9StatusText = document.getElementById('five9StatusText');
    elements.five9StatusDot = document.getElementById('five9StatusDot');
    elements.embedHelperToggleModal = document.getElementById('embedHelperToggleModal');
    elements.highlightColorPickerModal = document.getElementById('highlightColorPickerModal');
    elements.canvasCacheToggleModal = document.getElementById('canvasCacheToggleModal');
    elements.nonApiCourseFetchToggle = document.getElementById('nonApiCourseFetchToggle');
    elements.nextAssignmentToggle = document.getElementById('nextAssignmentToggle');
    elements.canvasApiTypeToggle = document.getElementById('canvasApiTypeToggle');
    elements.canvasAdvancedToggle = document.getElementById('canvasAdvancedToggle');
    elements.canvasAdvancedContent = document.getElementById('canvasAdvancedContent');
    elements.canvasAdvancedChevron = document.getElementById('canvasAdvancedChevron');
    elements.reportIssueBtn = document.getElementById('reportIssueBtn');
    elements.cacheSettingsContainer = document.getElementById('cacheSettingsContainer');
    elements.cacheStatsTextModal = document.getElementById('cacheStatsTextModal');
    elements.clearCacheBtnModal = document.getElementById('clearCacheBtnModal');
    elements.downloadCacheBtnModal = document.getElementById('downloadCacheBtnModal');
    elements.debugModeToggleModal = document.getElementById('debugModeToggleModal');
    elements.autoSwitchCallTabToggle = document.getElementById('autoSwitchCallTabToggle');
    elements.saveConnectionsBtn = document.getElementById('saveConnectionsBtn');

    // Data Tab Context Menu
    elements.dataTabContextMenu = document.getElementById('dataTabContextMenu');
    elements.viewBackupsMenuItem = document.getElementById('viewBackupsMenuItem');

    // Tab Bar Context Menu
    elements.tabBarContextMenu = document.getElementById('tabBarContextMenu');
    elements.openConsoleMenuItem = document.getElementById('openConsoleMenuItem');

    // Backup Modal
    elements.backupModal = document.getElementById('backupModal');
    elements.closeBackupModalBtn = document.getElementById('closeBackupModalBtn');
    elements.backupMainView = document.getElementById('backupMainView');
    elements.backupConfirmView = document.getElementById('backupConfirmView');
    elements.backupList = document.getElementById('backupList');
    elements.backupConfirmDetail = document.getElementById('backupConfirmDetail');
    elements.backupConfirmCancelBtn = document.getElementById('backupConfirmCancelBtn');
    elements.backupConfirmRevertBtn = document.getElementById('backupConfirmRevertBtn');

    // Cache Management (old reference for compatibility)
    elements.cacheStatsText = document.getElementById('cacheStatsText');
    elements.clearCacheBtn = document.getElementById('clearCacheBtn');

    // Debug Mode Toggle
    elements.debugModeToggle = document.getElementById('debugModeToggle');
}

/**
 * Switches to a different tab
 * @param {string} targetId - The ID of the tab to switch to
 */
export function switchTab(targetId) {
    elements.tabs.forEach(t => t.classList.remove('active'));
    elements.contents.forEach(c => c.classList.remove('active'));

    const targetContent = document.getElementById(targetId);
    if (targetContent) targetContent.classList.add('active');

    const targetTab = document.querySelector(`.tab-button[data-tab="${targetId}"]`);
    if (targetTab) targetTab.classList.add('active');

    // Hide mini console when not on checker tab
    if (elements.miniConsole) {
        if (targetId !== 'checker') {
            elements.miniConsole.style.display = 'none';
        }
    }
}

/**
 * Updates the badge count on a tab
 * @param {string} tabId - The tab ID
 * @param {number} count - The count to display
 */
export function updateTabBadge(tabId, count) {
    const badge = document.querySelector(`.tab-button[data-tab="${tabId}"] .badge`);
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
    }
}

/**
 * Updates the start/stop button visuals based on scanning state
 * @param {string} state - The extension state (ON or OFF)
 */
export function updateButtonVisuals(state) {
    if (!elements.startBtn) return;
    const isScanning = (state === EXTENSION_STATES.ON);

    if (isScanning) {
        elements.startBtn.style.background = '#ef4444';
        elements.startBtnText.textContent = 'Stop';
        elements.startBtnIcon.className = 'fas fa-stop';
        elements.statusDot.style.background = '#10b981';
        elements.statusDot.style.animation = 'pulse 2s infinite';
        elements.statusText.textContent = 'Monitoring...';
    } else {
        elements.startBtn.style.background = 'rgba(0, 90, 156, 0.7)';
        elements.startBtnText.textContent = 'Start';
        elements.startBtnIcon.className = 'fas fa-play';
        elements.statusDot.style.background = '#cbd5e1';
        elements.statusDot.style.animation = 'none';
        elements.statusText.textContent = 'Ready to Scan';
    }
}

/**
 * Updates debug mode toggle UI
 * @param {boolean} isDebugMode - Whether debug mode is enabled
 */
export function updateDebugModeUI(isDebugMode) {
    updateToggleUI(elements.debugModeToggle, isDebugMode);
}

/**
 * Updates embed helper toggle UI
 * @param {boolean} isEnabled - Whether embed helper is enabled
 */
export function updateEmbedHelperUI(isEnabled) {
    updateToggleUI(elements.embedHelperToggle, isEnabled);
}

/**
 * Updates highlight color picker UI
 * @param {string} color - The highlight color (hex format)
 */
export function updateHighlightColorUI(color) {
    if (!elements.highlightColorPicker) return;
    elements.highlightColorPicker.value = color;
}

/**
 * Blocks text selection globally (except for inputs/textareas)
 */
export function blockTextSelection() {
    const style = document.createElement('style');
    style.textContent = `
        * {
            -webkit-user-select: none;
            user-select: none;
        }
        input, textarea {
            -webkit-user-select: text;
            user-select: text;
        }
    `;
    document.head.appendChild(style);
}
