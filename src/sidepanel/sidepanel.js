// Sidepanel Main - Orchestrates all modules and manages app lifecycle
import { STORAGE_KEYS, EXTENSION_STATES, MESSAGE_TYPES, GUIDES, UI_FEATURES, FIVE9_CONNECTION_STATES, GENERIC_AVATAR_URL } from '../constants/index.js';
import { storageGet, storageSet, storageGetValue, migrateStorage, sessionGet, sessionSet, sessionGetValue } from '../utils/storage.js';
import { hasDispositionCode } from '../constants/dispositions.js';
import { getCacheStats, clearAllCache } from '../utils/canvasCache.js';
import { loadAndRenderMarkdown } from '../utils/markdownRenderer.js';
import CallManager from './callManager.js';
import { tutorialManager } from './tutorial-manager.js';

// Import all module functions
import {
    elements,
    cacheDomElements,
    switchTab,
    updateTabBadge,
    updateButtonVisuals,
    updateDebugModeUI,
    updateEmbedHelperUI,
    updateHighlightColorUI,
    blockTextSelection
} from './ui-manager.js';

import {
    setActiveStudent,
    renderFoundList,
    filterFoundList,
    renderMasterList,
    filterMasterList,
    filterByCampus,
    sortMasterList,
    setSortCriteria,
    updateDistributionDropdown,
    renderChart,
    setChartType,
    toggleWhiskerOrientation,
    initChartResizeObserver
} from './student-renderer.js';

import {
    handleFileImport,
    exportReport,
    sendMasterListToExcel,
    sendMasterListWithMissingAssignmentsToExcel,
    updateCampusFilter,
    hideCampusFilter,
    cancelUpdate,
    isUpdateCancelled,
    setUpdateButtonsDisabled
} from './file-handler.js';

import { processStep2, processStep3, processStep4, formatDuration } from './canvas-api.js';

// Import modal functions from separate files
import {
    openScanFilterModal,
    closeScanFilterModal,
    updateScanFilterCount,
    toggleFailingFilter,
    saveScanFilterSettings
} from './modals/scan-filter-modal.js';

import {
    openQueueModal,
    closeQueueModal,
    renderQueueModal
} from './modals/queue-modal.js';

import { openGuidesModal, closeGuidesModal } from './modals/guides-modal.js';

import {
    openConnectionsModal,
    closeConnectionsModal,
    saveConnectionsSettings,
    updatePowerAutomateStatus,
    updateCanvasStatus,
    updateFive9Status,
    toggleEmbedHelperModal,
    toggleCanvasCacheModal,
    toggleNonApiCourseFetch,
    toggleNextAssignment,
    initCanvasApiTypeToggle,
    initCanvasAdvancedToggle,
    initHighlightStudentRowToggle,
    togglePowerAutomateEnabled,
    togglePowerAutomateDebug,
    toggleDebugModeModal,
    toggleAutoSwitchCallTabModal,
    toggleSyncActiveStudentModal,
    toggleSendMasterListModal,
    toggleReformatNameModal,
    toggleHighlightStudentRowModal,
    clearCacheFromModal,
    downloadCacheFromModal,
    updateStartButtonForMasterList
} from './modals/connections-modal.js';

import {
    shouldShowDailyUpdateModal,
    openDailyUpdateModal,
    closeDailyUpdateModal
} from './modals/daily-update-modal.js';

import {
    getExcelTabs,
    openExcelInstanceModal,
    closeExcelInstanceModal
} from './modals/excel-instance-modal.js';

import {
    getCampusesFromStudents,
    openCampusSelectionModal,
    closeCampusSelectionModal
} from './modals/campus-selection-modal.js';

import {
    openStudentViewModal,
    closeStudentViewModal,
    showStudentViewMain,
    showStudentViewMissing,
    showStudentViewNext,
    showStudentViewDaysOut,
    getCurrentStudentViewStudent,
    generateStudentEmailTemplate
} from './modals/student-view-modal.js';

import {
    openCanvasAuthErrorModal,
    closeCanvasAuthErrorModal,
    toggleCanvasAuthNonApi
} from './modals/canvas-auth-modal.js';

import { closeCanvasLoginModal } from './modals/canvas-login-modal.js';
import { openAttendanceReportModal, closeAttendanceReportModal } from './modals/attendance-report-modal.js';
import { openMoreSettingsModal, closeMoreSettingsModal, saveMoreSettings, toggleShowPowerAutomate, applyPowerAutomateVisibility } from './modals/more-settings-modal.js';
import { openBackupModal, closeBackupModal, initBackupModal, createMasterListBackup } from './modals/backup-modal.js';
import { initImportStatusModal, updateImportStatus, closeImportStatusModal, onAddinReconnected } from './modals/import-status-modal.js';

import {
    shouldShowLatestUpdatesModal,
    openLatestUpdatesModal,
    closeLatestUpdatesModal
} from './modals/latest-updates-modal.js';

import { QueueManager } from './queue-manager.js';

import {
    updateFive9ConnectionIndicator,
    checkFive9Connection,
    getCachedDebugMode,
    startFive9ConnectionMonitor,
    stopFive9ConnectionMonitor,
    setupFive9StatusListeners,
    initDebugModeCache
} from './five9-integration.js';

import {
    startExcelConnectionMonitor,
    stopExcelConnectionMonitor,
    pingExcelAddIn,
    sendConnectionPing,
    checkExcelConnectionStatus
} from './excel-integration.js';

// --- STATE MANAGEMENT ---
let isScanning = false;
let callManager;
let queueManager;
let isDebugMode = false;
// True when the Scan Filter modal was opened from the Start button (because no
// filter was saved yet). Saving while this is true auto-starts the scan so the
// user doesn't have to click Start a second time.
let pendingAutoStartAfterFilterSave = false;

// Download button state: disabled while in cooldown OR when the master list is
// empty (nothing to export). refreshDownloadButtonState() applies both.
let downloadCooldownActive = false;
let masterListIsEmpty = true;
function refreshDownloadButtonState() {
    if (!elements.downloadMasterBtn) return;
    const disabled = downloadCooldownActive || masterListIsEmpty;
    elements.downloadMasterBtn.disabled = disabled;
    elements.downloadMasterBtn.title = masterListIsEmpty
        ? 'No data to download — update the master list first'
        : (downloadCooldownActive ? 'Please wait before downloading again' : 'Download CSV');
}
let embedHelperEnabled = true;
let highlightColor = '#ffff00';

// --- RESEND HIGHLIGHT PING FUNCTIONS ---
async function resendHighlightPing(entry, targetTabId = null) {
    await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.RESEND_HIGHLIGHT_PING,
        entry: entry,
        targetTabId: targetTabId
    });
}

async function resendAllHighlightPings(targetTabId = null) {
    await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.RESEND_ALL_HIGHLIGHT_PINGS,
        targetTabId: targetTabId
    });
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    blockTextSelection();
    cacheDomElements();
    initializeApp();
});

async function initializeApp() {
    // Run storage migration if needed
    await migrateStorage();

    // Set version from manifest
    const manifest = chrome.runtime.getManifest();
    if (elements.versionText && manifest.version) {
        elements.versionText.textContent = `Version ${manifest.version}`;
    }

    // Initialize call manager with UI callbacks
    const uiCallbacks = {
        updateCurrentStudent: (student) => {
            setActiveStudent(student, callManager);
        },
        finalizeAutomation: (lastStudent) => {
            queueManager.setQueue([lastStudent]);
            setActiveStudent(lastStudent, callManager);
        },
        cancelAutomation: (currentStudent) => {
            queueManager.setQueue([currentStudent]);
            setActiveStudent(currentStudent, callManager);
        },
        renderPreviousCalls: (entries) => {
            renderPreviousCalls(entries);
        },
        adoptExternalCall: (student) => {
            queueManager.setQueue([student]);
            setActiveStudent(student, callManager);
        }
    };
    callManager = new CallManager(elements, uiCallbacks);

    // Initialize queue manager
    queueManager = new QueueManager(callManager);

    // Ensure checker is stopped when side panel opens (use session storage)
    await sessionSet({ [STORAGE_KEYS.EXTENSION_STATE]: EXTENSION_STATES.OFF });

    // Cache debug mode state before any Five9 checks or student renders
    // to prevent "Awaiting Five9 Tab" flash when demo mode is enabled
    await initDebugModeCache();

    setupEventListeners();
    initializeCallControlButtons();
    await loadStorageData();
    setActiveStudent(null, callManager);
    populateGuides();

    // Apply the saved Power Automate visibility preference to the Settings tab
    const { [STORAGE_KEYS.SHOW_POWER_AUTOMATE]: showPA } = await storageGet([STORAGE_KEYS.SHOW_POWER_AUTOMATE]);
    applyPowerAutomateVisibility(!!showPA);

    // Load and display last call timestamp
    await callManager.loadLastCallTimestamp();

    // Restore the Previous Calls list from storage
    await callManager.loadPreviousCalls();

    // Start Five9 connection monitoring
    startFive9ConnectionMonitor(() => queueManager.getQueue());

    // Check Five9 connection immediately on sidepanel open
    updateFive9ConnectionIndicator(queueManager.getQueue());

    // Setup Five9 status listeners
    setupFive9StatusListeners(callManager, () => queueManager.getQueue());

    // Start Excel connection monitoring
    startExcelConnectionMonitor();

    // Send ping to Excel add-in to check connectivity on taskpane open
    await pingExcelAddIn();

    // Send simple SRK_PING to instantly test connection when side panel opens
    await sendConnectionPing();

    // Initialize tutorial manager (must be done before other modals)
    await tutorialManager.init();

    // Modal priority order (highest to lowest):
    // 1. Tutorial (blocks all other modals when active)
    // 2. Latest Updates Modal (shows on version change)
    // 3. Daily Update Modal (shows once per day)
    if (!tutorialManager.isActiveTutorial()) {
        // Check for Latest Updates modal first (highest priority after tutorial)
        const showLatestUpdates = await shouldShowLatestUpdatesModal();
        if (showLatestUpdates) {
            openLatestUpdatesModal();
        } else {
            // Only show daily update modal if latest updates modal is not shown
            const showDailyUpdate = await shouldShowDailyUpdateModal();
            if (showDailyUpdate) {
                openDailyUpdateModal();
            }
        }
    }

    // Periodically check Canvas connection status (every 5 seconds)
    setInterval(async () => {
        await updateCanvasStatus();
    }, 5000);

    // Check for a pending autoCall message (ribbon call button opened the panel)
    await processPendingAutoCall();
}

/**
 * Checks session storage for a pending autoCall message that was stored by
 * the background script before opening the side panel. This handles the case
 * where the panel wasn't open yet when the ribbon call button was pressed.
 */
async function processPendingAutoCall() {
    try {
        const data = await sessionGet(['pendingAutoCall']);
        const pending = data.pendingAutoCall;
        if (!pending) return;

        // Clear it immediately so it doesn't fire again on next open
        await sessionSet({ pendingAutoCall: null });

        // Ignore stale messages (older than 5 seconds) — prevents auto-call
        // when the panel is reopened after being closed
        const age = Date.now() - (pending._timestamp || 0);
        if (age > 5000) {
            console.log(`%c [Sidepanel] Ignoring stale pendingAutoCall (${Math.round(age / 1000)}s old)`, 'color: orange; font-weight: bold');
            return;
        }

        console.log('%c [Sidepanel] Processing pending autoCall from ribbon', 'color: green; font-weight: bold');

        // Process through the same handler used by the runtime message listener
        await handleSelectedStudentsMessage(pending);
    } catch (e) {
        console.warn('[Sidepanel] Error checking pending autoCall:', e);
    }
}

// Clear pending autoCall when the panel closes so it never fires on reopen
window.addEventListener('pagehide', () => {
    sessionSet({ pendingAutoCall: null });
});

// --- ABOUT PAGE ---
let aboutContentLoaded = false;
async function loadAboutContent() {
    // Only load once
    if (aboutContentLoaded) return;

    const aboutContainer = document.getElementById('aboutContent');
    if (!aboutContainer) {
        console.error('About content container not found');
        return;
    }

    try {
        await loadAndRenderMarkdown('../../README.md', aboutContainer);
        aboutContentLoaded = true;
    } catch (error) {
        console.error('Failed to load about content:', error);
    }
}

// --- GUIDES ---
/**
 * Populates the guides section with PDF links from GUIDES constant
 */
function populateGuides() {
    const guidesContainer = document.getElementById('guidesContainer');
    if (!guidesContainer) {
        console.error('Guides container not found');
        return;
    }

    // Clear existing content
    guidesContainer.innerHTML = '';

    // Create guide cards
    GUIDES.forEach(guide => {
        const guideCard = document.createElement('div');
        guideCard.className = 'setting-card';
        guideCard.style.cursor = 'pointer';
        guideCard.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px; flex-grow:1;">
                <i class="fas ${guide.icon}" style="color:var(--primary-color); font-size:1.5em; width:28px; text-align:center;"></i>
                <span style="font-weight:500;">${guide.name}</span>
            </div>
            <i class="fas fa-external-link-alt" style="color:var(--text-secondary); font-size:1em;"></i>
        `;

        // Add click handler to open PDF in new tab
        guideCard.addEventListener('click', () => {
            const guideUrl = chrome.runtime.getURL(guide.path);
            chrome.tabs.create({ url: guideUrl });
        });

        guidesContainer.appendChild(guideCard);
    });
}

// --- CONSOLE MESSAGE HANDLER ---
function addConsoleMessage(type, args) {
    if (!elements.consoleContent) return;

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const argsArray = args ? (Array.isArray(args) ? args : [args]) : [];

    // Extract %c CSS directives before joining args
    let cssStyle = null;
    const cleanArgs = [...argsArray];
    if (cleanArgs.length >= 2 && typeof cleanArgs[0] === 'string' && cleanArgs[0].includes('%c')) {
        cssStyle = String(cleanArgs[1]);
        cleanArgs[0] = cleanArgs[0].replace(/%c/g, '');
        cleanArgs.splice(1, 1); // remove the CSS arg
    }

    const message = cleanArgs.map(arg => {
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg, null, 2);
            } catch (e) {
                return String(arg);
            }
        }
        return String(arg);
    }).join(' ');

    // Detect specific message patterns and apply custom types
    // Error detection first — takes priority even over ping/submission patterns
    let customType = type;
    if (type !== 'error' && /\berror\b/i.test(message)) {
        customType = 'error';
    } else if (/SRK_PING|SRK_HIGHLIGHT_STUDENT_ROW|🏓|highlight.?ping|Sending payload to Office Add-in|Ping Received|Ponging|Forwarding.*PING|highlight student row|Ignoring ping|Highlight Confirmation/i.test(message)) {
        customType = 'ping';
    } else if (message.includes('onSubmissionFound triggered') || message.includes('Submission Found')) {
        customType = 'submission';
    }

    // Drop %c CSS for recognized custom types — use our own consistent styling
    const applyCss = (cssStyle && customType === type);

    const logEntry = document.createElement('div');
    logEntry.className = `console-log ${customType}`;
    logEntry.innerHTML = `<span class="timestamp">[${timestamp}]</span>${message}`;
    if (applyCss) logEntry.style.cssText += cssStyle;

    elements.consoleContent.appendChild(logEntry);
    elements.consoleContent.scrollTop = elements.consoleContent.scrollHeight;

    // Limit to 100 entries
    const entries = elements.consoleContent.querySelectorAll('.console-log');
    if (entries.length > 100) {
        entries[0].remove();
    }

    // Forward to standalone console tab via storage + runtime message
    const consoleEntry = { type: customType, message, timestamp };
    if (applyCss) consoleEntry.css = cssStyle;
    try {
        chrome.storage.local.get('srk_console_logs', (data) => {
            const logs = data.srk_console_logs || [];
            logs.push(consoleEntry);
            // Cap stored logs at 500
            const trimmed = logs.length > 500 ? logs.slice(-500) : logs;
            chrome.storage.local.set({ srk_console_logs: trimmed });
        });
        chrome.runtime.sendMessage({ type: 'SRK_CONSOLE_LOG', entry: consoleEntry }).catch(() => {});
    } catch (_) { /* console tab may not be open */ }
}

/**
 * Re-checks Excel connection when navigating to the Settings tab.
 * If the status is not 'connected', sends both pings to double-check.
 */
async function recheckExcelConnection() {
    const status = await checkExcelConnectionStatus();
    if (status !== 'connected') {
        console.log(`🏓 Settings tab opened — Excel status is "${status}", sending pings to re-check...`);
        await pingExcelAddIn();
        await sendConnectionPing();
    } else {
        console.log('🏓 Settings tab opened — Excel already connected, skipping ping');
    }
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
    // Tab switching
    elements.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            switchTab(tab.dataset.tab);
            if (tab.dataset.tab === 'settings') {
                updateCacheStats();
                recheckExcelConnection();
            } else if (tab.dataset.tab === 'about') {
                loadAboutContent();
            } else if (tab.dataset.tab === 'contact') {
                // Check Five9 connection when switching to contact tab
                updateFive9ConnectionIndicator(queueManager.getQueue());
            }
        });
    });

    // CTRL key release detection for automation mode
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Control' || e.key === 'Meta') {
            if (queueManager.getLength() > 1) {
                switchTab('contact');
                // Check Five9 connection when switching to contact tab
                updateFive9ConnectionIndicator(queueManager.getQueue());
            }
        }
    });

    // Header and modals
    if (elements.headerSettingsBtn) {
        elements.headerSettingsBtn.addEventListener('click', () => {
            switchTab('settings');
            recheckExcelConnection();
        });
    }

    // Title toggles README/About page
    let previousTab = 'checker'; // Default to checker tab
    if (elements.headerTitle) {
        elements.headerTitle.addEventListener('click', () => {
            // Check if currently on about tab
            const aboutContent = document.getElementById('about');
            const isOnAbout = aboutContent && aboutContent.classList.contains('active');

            if (isOnAbout) {
                // Go back to previous tab
                switchTab(previousTab);
            } else {
                // Save current tab and switch to about
                const activeContent = document.querySelector('.tab-content.active');
                if (activeContent) {
                    previousTab = activeContent.id;
                }
                switchTab('about');
                loadAboutContent();
            }
        });
    }

    // Version text opens Latest Updates modal
    if (elements.versionText) {
        elements.versionText.addEventListener('click', () => {
            openLatestUpdatesModal();
        });
    }

    if (elements.clearMasterListBtn) {
        elements.clearMasterListBtn.addEventListener('click', async () => {
            if (confirm('Are you sure you want to clear the master list? This cannot be undone.')) {
                await storageSet({
                    [STORAGE_KEYS.MASTER_ENTRIES]: [],
                    [STORAGE_KEYS.LAST_UPDATED]: null
                });
                // Hide the campus filter when master list is cleared
                hideCampusFilter();
            }
        });
    }

    // Specific Submission Date Toggle
    if (elements.useSpecificDateToggle) {
        elements.useSpecificDateToggle.addEventListener('click', async () => {
            const isOn = elements.useSpecificDateToggle.classList.contains('is-on');
            const newState = !isOn;

            // Update toggle visual
            elements.useSpecificDateToggle.classList.toggle('is-on', newState);
            elements.useSpecificDateToggle.setAttribute('aria-pressed', newState ? 'true' : 'false');

            // Show/hide date picker
            if (elements.specificDatePicker) {
                elements.specificDatePicker.style.display = newState ? 'block' : 'none';
            }

            // If turning on, set to today's date if no date is set
            if (newState && elements.specificDateInput) {
                const currentValue = elements.specificDateInput.value;
                if (!currentValue) {
                    const today = new Date().toISOString().split('T')[0];
                    elements.specificDateInput.value = today;
                    await storageSet({
                        [STORAGE_KEYS.SPECIFIC_SUBMISSION_DATE]: today
                    });
                }
            }

            // Save toggle state
            await storageSet({
                [STORAGE_KEYS.USE_SPECIFIC_DATE]: newState
            });
        });
    }

    // Specific Date Input Change
    if (elements.specificDateInput) {
        elements.specificDateInput.addEventListener('change', async (e) => {
            const selectedDate = e.target.value;
            await storageSet({
                [STORAGE_KEYS.SPECIFIC_SUBMISSION_DATE]: selectedDate
            });
        });
    }

    // Review Tutorial Button
    const reviewTutorialBtn = document.getElementById('reviewTutorialBtn');
    if (reviewTutorialBtn) {
        reviewTutorialBtn.addEventListener('click', () => {
            tutorialManager.restartTutorial();
        });
    }

    // Connections Modal
    if (elements.configureExcelBtn) {
        elements.configureExcelBtn.addEventListener('click', () => openConnectionsModal('excel'));
    }

    if (elements.configurePowerAutomateBtn) {
        elements.configurePowerAutomateBtn.addEventListener('click', () => openConnectionsModal('powerAutomate'));
    }

    if (elements.configureCanvasBtn) {
        elements.configureCanvasBtn.addEventListener('click', () => openConnectionsModal('canvas'));
    }

    if (elements.configureFive9Btn) {
        elements.configureFive9Btn.addEventListener('click', () => openConnectionsModal('five9'));
    }

    if (elements.closeConnectionsBtn) {
        elements.closeConnectionsBtn.addEventListener('click', closeConnectionsModal);
    }

    if (elements.saveConnectionsBtn) {
        elements.saveConnectionsBtn.addEventListener('click', async () => {
            await saveConnectionsSettings();
            // Update Five9 indicator immediately after settings change
            updateFive9ConnectionIndicator(queueManager.getQueue());
        });
    }

    // More Settings Modal (from right-click context menu on settings tab)
    if (elements.closeMoreSettingsBtn) {
        elements.closeMoreSettingsBtn.addEventListener('click', closeMoreSettingsModal);
    }
    if (elements.saveMoreSettingsBtn) {
        elements.saveMoreSettingsBtn.addEventListener('click', saveMoreSettings);
    }

    if (elements.showPowerAutomateToggle) {
        elements.showPowerAutomateToggle.addEventListener('click', toggleShowPowerAutomate);
    }

    // Canvas Modal Settings
    if (elements.embedHelperToggleModal) {
        elements.embedHelperToggleModal.addEventListener('click', toggleEmbedHelperModal);
    }

    if (elements.canvasCacheToggleModal) {
        elements.canvasCacheToggleModal.addEventListener('click', toggleCanvasCacheModal);
    }

    if (elements.nonApiCourseFetchToggle) {
        elements.nonApiCourseFetchToggle.addEventListener('click', toggleNonApiCourseFetch);
    }

    if (elements.nextAssignmentToggle) {
        elements.nextAssignmentToggle.addEventListener('click', toggleNextAssignment);
    }

    initCanvasApiTypeToggle();
    initCanvasAdvancedToggle();
    initHighlightStudentRowToggle();

    if (elements.reportIssueBtn) {
        // Report an Issue: fresh 6-digit ticket per click so each report
        // lands in its own email thread. The 5-second debounce + "Opening..."
        // label prevents spam clicks while the user's mail client spins up.
        const reportIssueLabelEl = elements.reportIssueBtn.querySelector('span');
        const originalLabel = reportIssueLabelEl ? reportIssueLabelEl.textContent : 'Report an Issue';
        let reportIssueBusy = false;

        elements.reportIssueBtn.addEventListener('click', (e) => {
            if (reportIssueBusy) {
                e.preventDefault();
                return;
            }
            reportIssueBusy = true;

            const ticket = String(Math.floor(100000 + Math.random() * 900000));
            const subject = encodeURIComponent(`Student Retention Kit Issue - ${ticket}`);
            elements.reportIssueBtn.href = `mailto:vblanco1@northbridge.edu?subject=${subject}`;

            elements.reportIssueBtn.classList.add('is-opening');
            if (reportIssueLabelEl) reportIssueLabelEl.textContent = 'Opening...';

            setTimeout(() => {
                reportIssueBusy = false;
                elements.reportIssueBtn.classList.remove('is-opening');
                if (reportIssueLabelEl) reportIssueLabelEl.textContent = originalLabel;
            }, 5000);
        });
    }

    if (elements.clearCacheBtnModal) {
        elements.clearCacheBtnModal.addEventListener('click', clearCacheFromModal);
    }

    if (elements.downloadCacheBtnModal) {
        elements.downloadCacheBtnModal.addEventListener('click', downloadCacheFromModal);
    }

    // Power Automate Modal Settings
    if (elements.powerAutomateEnabledToggle) {
        elements.powerAutomateEnabledToggle.addEventListener('click', togglePowerAutomateEnabled);
    }

    if (elements.powerAutomateDebugToggle) {
        elements.powerAutomateDebugToggle.addEventListener('click', togglePowerAutomateDebug);
    }

    // Power Automate URL visibility toggle
    if (elements.toggleUrlVisibility) {
        elements.toggleUrlVisibility.addEventListener('click', () => {
            const input = elements.powerAutomateUrlInput;
            const icon = elements.toggleUrlVisibility.querySelector('i');
            if (input && icon) {
                const isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';
                icon.className = isPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
            }
        });
    }

    // Five9 Modal Settings
    if (elements.debugModeToggleModal) {
        elements.debugModeToggleModal.addEventListener('click', toggleDebugModeModal);
    }

    if (elements.autoSwitchCallTabToggle) {
        elements.autoSwitchCallTabToggle.addEventListener('click', toggleAutoSwitchCallTabModal);
    }

    // Excel Modal Settings
    if (elements.syncActiveStudentToggleModal) {
        elements.syncActiveStudentToggleModal.addEventListener('click', toggleSyncActiveStudentModal);
    }

    if (elements.sendMasterListToggleModal) {
        elements.sendMasterListToggleModal.addEventListener('click', toggleSendMasterListModal);
    }

    if (elements.reformatNameToggleModal) {
        elements.reformatNameToggleModal.addEventListener('click', toggleReformatNameModal);
    }

    if (elements.highlightStudentRowToggleModal) {
        elements.highlightStudentRowToggleModal.addEventListener('click', toggleHighlightStudentRowModal);
    }

    // Highlight Row Color Sync
    if (elements.highlightRowColorInput && elements.highlightRowColorTextInput) {
        elements.highlightRowColorInput.addEventListener('input', (e) => {
            elements.highlightRowColorTextInput.value = e.target.value;
        });
        elements.highlightRowColorTextInput.addEventListener('input', (e) => {
            const color = e.target.value;
            if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
                elements.highlightRowColorInput.value = color;
            }
        });
    }

    // Export Tab Color Sync
    if (elements.exportTabColorInput && elements.exportTabColorTextInput) {
        elements.exportTabColorInput.addEventListener('input', (e) => {
            elements.exportTabColorTextInput.value = e.target.value;
        });
        elements.exportTabColorTextInput.addEventListener('input', (e) => {
            const color = e.target.value;
            if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
                elements.exportTabColorInput.value = color;
            }
        });
    }

    // Scan Filter Modal
    if (elements.scanFilterBtn) {
        elements.scanFilterBtn.addEventListener('click', openScanFilterModal);
    }

    if (elements.closeScanFilterBtn) {
        elements.closeScanFilterBtn.addEventListener('click', () => {
            pendingAutoStartAfterFilterSave = false;
            closeScanFilterModal();
        });
    }

    if (elements.failingToggle) {
        elements.failingToggle.addEventListener('click', () => {
            toggleFailingFilter();
            updateScanFilterCount();
        });
    }

    if (elements.daysOutOperator) {
        elements.daysOutOperator.addEventListener('change', updateScanFilterCount);
    }

    if (elements.daysOutValue) {
        elements.daysOutValue.addEventListener('input', updateScanFilterCount);
    }

    if (elements.saveScanFilterBtn) {
        elements.saveScanFilterBtn.addEventListener('click', async () => {
            await saveScanFilterSettings();
            // First-time flow: Start was clicked, modal opened because no filter
            // existed. Now that the filter is saved, kick off scanning so the
            // user doesn't have to click Start again.
            if (pendingAutoStartAfterFilterSave) {
                pendingAutoStartAfterFilterSave = false;
                await toggleScanState();
            }
        });
    }

    // Queue Modal
    if (elements.manageQueueBtn) {
        elements.manageQueueBtn.addEventListener('click', () => {
            const automationState = {
                currentIndex: callManager.currentAutomationIndex,
                skippedIndices: callManager.skippedIndices,
                isRunning: callManager.automationMode
            };
            const reorderCb = (fromIndex, toIndex) => {
                queueManager.reorderQueue(fromIndex, toIndex);
                renderQueueModal(
                    queueManager.getQueue(),
                    reorderCb,
                    (index) => handleQueueRemoval(index),
                    { currentIndex: callManager.currentAutomationIndex, skippedIndices: callManager.skippedIndices, isRunning: callManager.automationMode }
                );
            };
            openQueueModal(
                queueManager.getQueue(),
                reorderCb,
                (index) => handleQueueRemoval(index),
                automationState
            );
        });
    }

    if (elements.closeQueueModalBtn) {
        elements.closeQueueModalBtn.addEventListener('click', closeQueueModal);
    }

    // Guides Modal
    if (elements.openGuidesBtn) {
        elements.openGuidesBtn.addEventListener('click', openGuidesModal);
    }

    if (elements.closeGuidesModalBtn) {
        elements.closeGuidesModalBtn.addEventListener('click', closeGuidesModal);
    }

    // Daily Update Modal
    if (elements.closeDailyUpdateBtn) {
        elements.closeDailyUpdateBtn.addEventListener('click', closeDailyUpdateModal);
    }

    if (elements.dailyUpdateLaterBtn) {
        elements.dailyUpdateLaterBtn.addEventListener('click', closeDailyUpdateModal);
    }

    if (elements.dailyUpdateBtn) {
        elements.dailyUpdateBtn.addEventListener('click', async () => {
            // Close the modal
            await closeDailyUpdateModal();

            // Switch to data tab
            switchTab('data');

            // Trigger the update master list process
            if (elements.updateMasterBtn) {
                elements.updateMasterBtn.click();
            }
        });
    }

    // Attendance Report Modal
    if (elements.closeAttendanceReportBtn) {
        elements.closeAttendanceReportBtn.addEventListener('click', () => closeAttendanceReportModal(null));
    }
    if (elements.attendanceReportYesBtn) {
        elements.attendanceReportYesBtn.addEventListener('click', () => closeAttendanceReportModal(true));
    }
    if (elements.attendanceReportNoBtn) {
        elements.attendanceReportNoBtn.addEventListener('click', () => closeAttendanceReportModal(false));
    }

    // Latest Updates Modal
    if (elements.closeLatestUpdatesBtn) {
        elements.closeLatestUpdatesBtn.addEventListener('click', closeLatestUpdatesModal);
    }

    if (elements.latestUpdatesGotItBtn) {
        elements.latestUpdatesGotItBtn.addEventListener('click', closeLatestUpdatesModal);
    }

    // Excel Instance Modal
    if (elements.closeExcelInstanceBtn) {
        elements.closeExcelInstanceBtn.addEventListener('click', () => closeExcelInstanceModal(null));
    }

    // Campus Selection Modal
    if (elements.closeCampusSelectionBtn) {
        elements.closeCampusSelectionBtn.addEventListener('click', () => closeCampusSelectionModal(null));
    }

    // Student View Modal
    if (elements.studentViewCallBtn) {
        elements.studentViewCallBtn.addEventListener('click', () => {
            closeStudentViewModal();
            switchTab('contact');
            // Update Five9 connection indicator when switching to contact tab
            if (queueManager) {
                updateFive9ConnectionIndicator(queueManager.getQueue());
            }
        });
    }
    if (elements.studentViewEmailBtn) {
        elements.studentViewEmailBtn.addEventListener('click', () => {
            const student = getCurrentStudentViewStudent();
            if (!student) {
                console.warn('No student data available for email');
                return;
            }

            const mailtoUrl = generateStudentEmailTemplate(student);
            if (mailtoUrl) {
                window.open(mailtoUrl, '_blank');
            } else {
                // No email available - show alert
                alert('No email address found for this student.');
            }
        });
    }
    // Days Out card click - show detail view
    if (elements.studentViewDaysOutCard) {
        elements.studentViewDaysOutCard.addEventListener('click', showStudentViewDaysOut);
    }
    // Missing Assignments card click - show detail view
    if (elements.studentViewMissingCard) {
        elements.studentViewMissingCard.addEventListener('click', showStudentViewMissing);
    }
    // Next Assignment card click - show detail view
    if (elements.studentViewNextCard) {
        elements.studentViewNextCard.addEventListener('click', showStudentViewNext);
    }
    // Back buttons
    if (elements.studentViewDaysOutBackBtn) {
        elements.studentViewDaysOutBackBtn.addEventListener('click', showStudentViewMain);
    }
    if (elements.studentViewMissingBackBtn) {
        elements.studentViewMissingBackBtn.addEventListener('click', showStudentViewMain);
    }
    if (elements.studentViewNextBackBtn) {
        elements.studentViewNextBackBtn.addEventListener('click', showStudentViewMain);
    }
    // Click on non-interactive areas closes the modal
    if (elements.studentViewModal) {
        elements.studentViewModal.addEventListener('click', (e) => {
            // Check if click was on an interactive element
            const isInteractive = e.target.closest('button, .btn-primary, .btn-secondary, .icon-btn, #studentViewDaysOutCard, #studentViewMissingCard, #studentViewNextCard, #studentViewMissingList a, #studentViewNextDetailContent a');
            if (!isInteractive) {
                closeStudentViewModal();
            }
        });
    }

    // Canvas Auth Error Modal
    if (elements.canvasAuthRetryBtn) {
        elements.canvasAuthRetryBtn.addEventListener('click', () => closeCanvasAuthErrorModal('retry'));
    }
    if (elements.canvasAuthShutdownBtn) {
        elements.canvasAuthShutdownBtn.addEventListener('click', () => closeCanvasAuthErrorModal('shutdown'));
    }
    if (elements.canvasAuthNonApiToggle) {
        elements.canvasAuthNonApiToggle.addEventListener('click', toggleCanvasAuthNonApi);
    }

    // Canvas Login Modal
    if (elements.canvasLoginResumeBtn) {
        elements.canvasLoginResumeBtn.addEventListener('click', () => closeCanvasLoginModal());
    }

    // Modal outside click handlers
    window.addEventListener('click', (e) => {
        if (elements.scanFilterModal && e.target === elements.scanFilterModal) {
            pendingAutoStartAfterFilterSave = false;
            closeScanFilterModal();
        }
        if (elements.queueModal && e.target === elements.queueModal) {
            closeQueueModal();
        }
        if (elements.connectionsModal && e.target === elements.connectionsModal) {
            closeConnectionsModal();
        }
        if (elements.dailyUpdateModal && e.target === elements.dailyUpdateModal) {
            closeDailyUpdateModal();
        }
        if (elements.latestUpdatesModal && e.target === elements.latestUpdatesModal) {
            closeLatestUpdatesModal();
        }
        if (elements.excelInstanceModal && e.target === elements.excelInstanceModal) {
            closeExcelInstanceModal(null);
        }
        if (elements.campusSelectionModal && e.target === elements.campusSelectionModal) {
            closeCampusSelectionModal(null);
        }
        if (elements.studentViewModal && e.target === elements.studentViewModal) {
            closeStudentViewModal();
        }
        if (elements.guidesModal && e.target === elements.guidesModal) {
            closeGuidesModal();
        }
        if (elements.backupModal && e.target === elements.backupModal) {
            closeBackupModal();
        }
        if (elements.attendanceReportModal && e.target === elements.attendanceReportModal) {
            closeAttendanceReportModal(null);
        }
    });

    // Cache Management
    if (elements.clearCacheBtn) {
        elements.clearCacheBtn.addEventListener('click', async () => {
            if (confirm('Are you sure you want to clear all cached Canvas API data?')) {
                await clearAllCache();
                updateCacheStats();
            }
        });
    }

    // Debug Mode Toggle
    if (elements.debugModeToggle) {
        elements.debugModeToggle.addEventListener('click', toggleDebugMode);
    }

    // Embed Helper Toggle
    if (elements.embedHelperToggle) {
        elements.embedHelperToggle.addEventListener('click', toggleEmbedHelper);
    }

    // Highlight Color Picker
    if (elements.highlightColorPicker) {
        elements.highlightColorPicker.addEventListener('input', updateHighlightColor);
    }

    // Checker Tab
    if (elements.startBtn) {
        elements.startBtn.addEventListener('click', toggleScanState);
    }

    if (elements.clearListBtn) {
        elements.clearListBtn.addEventListener('click', async () => {
            await storageSet({ [STORAGE_KEYS.FOUND_ENTRIES]: [] });
        });
    }

    if (elements.foundSearch) {
        elements.foundSearch.addEventListener('input', filterFoundList);
    }

    // Call Tab
    if (elements.dialBtn) {
        elements.dialBtn.addEventListener('click', () => callManager.toggleCallState());
    }

    setupPhoneEditing();

    if (elements.skipStudentBtn) {
        elements.skipStudentBtn.addEventListener('click', () => {
            if (callManager) {
                callManager.skipToNext();
            }
        });
    }

    if (elements.pauseAutomationBtn) {
        elements.pauseAutomationBtn.addEventListener('click', () => {
            if (callManager) {
                callManager.togglePause();
            }
        });
    }

    if (elements.stopAutomationBtn) {
        elements.stopAutomationBtn.addEventListener('click', () => {
            if (callManager) {
                callManager.cancelAutomation();
            }
        });
    }

    if (elements.cancelRedialBtn) {
        elements.cancelRedialBtn.addEventListener('click', () => {
            if (callManager) {
                callManager.clearStagedRedial();
            }
        });
    }

    // Previous Calls — click a row to load that student's number into the dialer.
    // Before handing off to callManager.loadFromHistory we look the number up
    // against the current master list so the contact card can show the rich
    // student data (days out, gradebook, photo, etc.) even though the previous-
    // calls cache only stores name + phone fields.
    if (elements.previousCallsList) {
        elements.previousCallsList.addEventListener('click', async (e) => {
            const row = e.target.closest('.previous-call-item');
            if (!row || !callManager) return;
            if (row.classList.contains('disabled')) return;

            const index = parseInt(row.dataset.index, 10);
            const entries = callManager.getPreviousCalls();
            const entry = entries[index];
            if (!entry) return;

            const phone = entry.directPhone || entry.phone || entry.Phone || entry.PrimaryPhone || '';
            const found = phone ? await findStudentByPhone(phone) : null;
            const target = found
                ? { ...found, directPhone: phone || found.directPhone || null }
                : entry;

            callManager.loadFromHistory(target);
        });
    }

    // Disposition buttons
    const dispositionContainer = document.querySelector('.disposition-grid');
    if (dispositionContainer) {
        dispositionContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.disposition-btn');
            if (!btn) return;

            if (btn.classList.contains('disabled')) {
                console.warn('This disposition does not have a code set yet.');
                return;
            }

            // Disable all disposition buttons to prevent spam clicking
            const allDispositionBtns = dispositionContainer.querySelectorAll('.disposition-btn');
            allDispositionBtns.forEach(b => {
                b.style.pointerEvents = 'none';
                b.style.opacity = '0.5';
            });

            callManager.handleDisposition(btn.innerText.trim());
        });

        initializeDispositionButtons();
    }

    // Data Tab
    if (elements.updateMasterBtn) {
        elements.updateMasterBtn.addEventListener('click', handleUpdateMasterList);

        // Right-click context menu for Update Master List button
        elements.updateMasterBtn.addEventListener('contextmenu', (e) => {
            e.preventDefault();

            if (!elements.updateMasterContextMenu) return;

            positionContextMenu(elements.updateMasterContextMenu, e.pageX, e.pageY);
        });
    }

    // Context menu item - Send List to Excel
    if (elements.sendListToExcelMenuItem) {
        elements.sendListToExcelMenuItem.addEventListener('click', async () => {
            // Hide context menu
            if (elements.updateMasterContextMenu) {
                elements.updateMasterContextMenu.style.display = 'none';
            }

            // Get current master list from storage
            const data = await chrome.storage.local.get([STORAGE_KEYS.MASTER_ENTRIES]);
            const students = data[STORAGE_KEYS.MASTER_ENTRIES] || [];

            if (students.length === 0) {
                alert('No master list data to send. Please update the master list first.');
                return;
            }

            // Check if there are multiple campuses - if so, show campus selection modal
            let studentsToSend = students;
            const campuses = getCampusesFromStudents(students);

            if (campuses.length > 1) {
                const selectedCampus = await openCampusSelectionModal(campuses);

                // User cancelled
                if (selectedCampus === null) {
                    console.log('User cancelled campus selection');
                    return;
                }

                // Filter students by selected campus (empty string means all)
                if (selectedCampus !== '') {
                    studentsToSend = students.filter(s => s.campus === selectedCampus);
                    console.log(`Filtered to ${studentsToSend.length} students from campus: ${selectedCampus}`);
                }
            }

            // Check how many Excel tabs are open
            const excelTabs = await getExcelTabs();

            if (excelTabs.length === 0) {
                alert('No Excel tabs detected. Please open Excel Online first.');
                return;
            }

            let targetTabId = null;

            // If multiple Excel tabs, show selection modal
            if (excelTabs.length > 1) {
                targetTabId = await openExcelInstanceModal(excelTabs);

                // User cancelled
                if (targetTabId === null) {
                    console.log('User cancelled Excel instance selection');
                    return;
                }
            } else {
                // Only one tab, use it directly
                targetTabId = excelTabs[0].id;
            }

            // Check if any students have missing assignments data
            const hasMissingAssignments = studentsToSend.some(s => s.missingAssignments && s.missingAssignments.length > 0);

            // Send to Excel - use the appropriate function based on whether we have missing assignments
            if (hasMissingAssignments) {
                await sendMasterListWithMissingAssignmentsToExcel(studentsToSend, targetTabId);
                console.log(`Manually sent master list with missing assignments to Excel tab ${targetTabId}`);
            } else {
                await sendMasterListToExcel(studentsToSend, targetTabId);
                console.log(`Manually sent master list to Excel tab ${targetTabId}`);
            }
        });
    }

    // Context menu item - Check Grade Book Again
    if (elements.checkGradeBookMenuItem) {
        elements.checkGradeBookMenuItem.addEventListener('click', async () => {
            // Hide context menu
            if (elements.updateMasterContextMenu) {
                elements.updateMasterContextMenu.style.display = 'none';
            }

            // Get current master list from storage
            const data = await chrome.storage.local.get([STORAGE_KEYS.MASTER_ENTRIES]);
            const students = data[STORAGE_KEYS.MASTER_ENTRIES] || [];

            if (students.length === 0) {
                alert('No master list data. Please update the master list first.');
                return;
            }

            // Show update queue section and configure for grade book check only
            if (elements.updateQueueSection) {
                elements.updateQueueSection.style.display = 'block';
            }

            // Get step elements
            const step1 = document.getElementById('step1');
            const step2 = document.getElementById('step2');
            const queueTotalTime = document.getElementById('queueTotalTime');

            // Only show the Fetch Canvas Data row for a grade book recheck
            if (step1) step1.style.display = 'none';

            if (step2) {
                step2.style.display = '';
                step2.className = 'queue-item';
                step2.style.color = '';
                step2.querySelector('.queue-content').innerHTML = '<i class="far fa-circle"></i> Fetch Canvas Data';
                step2.querySelector('.step-time').textContent = '';
            }

            // Reset and show total time
            if (queueTotalTime) {
                queueTotalTime.style.display = 'none';
                queueTotalTime.textContent = 'Total Time: 0.0s';
                queueTotalTime.dataset.processStartTime = Date.now().toString();
            }

            // Run Step 3 only
            // Note: Don't pass a render callback here - the storage.onChanged listener
            // already handles re-rendering when MASTER_ENTRIES is updated in processStep3.
            // Passing a callback would cause a double render (duplicate students bug).
            try {
                const updatedStudents = await processStep3(students);

                // Show total time
                if (queueTotalTime && queueTotalTime.dataset.processStartTime) {
                    const totalSeconds = (Date.now() - parseInt(queueTotalTime.dataset.processStartTime)) / 1000;
                    queueTotalTime.textContent = `Total Time: ${formatDuration(totalSeconds)}`;
                    queueTotalTime.style.display = 'block';
                }

                console.log('[Check Grade Book] Complete - updated gradebook data for all students');
            } catch (error) {
                console.error('[Check Grade Book] Error:', error);
            }
        });
    }

    // Right-click context menu on the Settings tab
    const settingsTabContent = document.getElementById('settings');
    if (settingsTabContent && elements.settingsContextMenu) {
        settingsTabContent.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            positionContextMenu(elements.settingsContextMenu, e.pageX, e.pageY);
        });
    }

    // "More Settings" context menu item opens the modal
    if (elements.moreSettingsMenuItem) {
        elements.moreSettingsMenuItem.addEventListener('click', () => {
            if (elements.settingsContextMenu) {
                elements.settingsContextMenu.style.display = 'none';
            }
            openMoreSettingsModal();
        });
    }

    // Right-click context menu on the Data tab (except Update Master List button)
    const dataTabContent = document.getElementById('data');
    if (dataTabContent && elements.dataTabContextMenu) {
        dataTabContent.addEventListener('contextmenu', (e) => {
            // Don't show backup context menu if right-clicking on the Update Master List button
            // (that button has its own context menu)
            if (elements.updateMasterBtn && (elements.updateMasterBtn === e.target || elements.updateMasterBtn.contains(e.target))) {
                return;
            }

            e.preventDefault();
            positionContextMenu(elements.dataTabContextMenu, e.pageX, e.pageY);
        });
    }

    // "View Backups" context menu item opens the backup modal
    if (elements.viewBackupsMenuItem) {
        elements.viewBackupsMenuItem.addEventListener('click', () => {
            if (elements.dataTabContextMenu) {
                elements.dataTabContextMenu.style.display = 'none';
            }
            openBackupModal();
        });
    }

    // Initialize backup modal event listeners
    initBackupModal();

    // Initialize import status modal event listeners
    initImportStatusModal();

    // Right-click context menu on the tab bar and header area
    const tabBar = document.querySelector('.tabs');
    const headerArea = document.querySelector('.header');
    [tabBar, headerArea].forEach(el => {
        if (el && elements.tabBarContextMenu) {
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                positionContextMenu(elements.tabBarContextMenu, e.pageX, e.pageY);
            });
        }
    });

    // "Open Console" menu item opens the console in a new tab
    if (elements.openConsoleMenuItem) {
        elements.openConsoleMenuItem.addEventListener('click', () => {
            if (elements.tabBarContextMenu) {
                elements.tabBarContextMenu.style.display = 'none';
            }
            chrome.tabs.create({ url: chrome.runtime.getURL('src/console/console.html') });
        });
    }

    // Hide context menu when clicking elsewhere
    document.addEventListener('click', hideAllContextMenus);

    // Variable to track the selected student entry for context menu
    let selectedStudentEntry = null;

    /**
     * Hides all context menus. Called before showing a new one to ensure
     * only one context menu is visible at a time.
     */
    function hideAllContextMenus() {
        if (elements.updateMasterContextMenu) elements.updateMasterContextMenu.style.display = 'none';
        if (elements.checkerContextMenu) elements.checkerContextMenu.style.display = 'none';
        if (elements.settingsContextMenu) elements.settingsContextMenu.style.display = 'none';
        if (elements.dataTabContextMenu) elements.dataTabContextMenu.style.display = 'none';
        if (elements.tabBarContextMenu) elements.tabBarContextMenu.style.display = 'none';
    }

    /**
     * Positions a context menu at the mouse position, adjusting if it would overflow the viewport
     * @param {HTMLElement} menu - The context menu element
     * @param {number} mouseX - The mouse X position (e.pageX)
     * @param {number} mouseY - The mouse Y position (e.pageY)
     */
    function positionContextMenu(menu, mouseX, mouseY) {
        // Hide any other open context menus first
        hideAllContextMenus();

        // First, show the menu off-screen to measure its dimensions
        menu.style.visibility = 'hidden';
        menu.style.display = 'block';

        const menuWidth = menu.offsetWidth;
        const menuHeight = menu.offsetHeight;

        // Get viewport dimensions
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Calculate position, adjusting if menu would overflow viewport
        let left = mouseX;
        let top = mouseY;

        // Check right edge overflow
        if (left + menuWidth > viewportWidth) {
            left = mouseX - menuWidth;
        }

        // Check bottom edge overflow - position above cursor if needed
        if (top + menuHeight > viewportHeight) {
            top = mouseY - menuHeight;
        }

        // Ensure menu doesn't go off the left or top edges
        if (left < 0) left = 5;
        if (top < 0) top = 5;

        // Apply calculated position and show menu
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        menu.style.visibility = 'visible';
    }

    // Right-click context menu for Checker Tab
    const checkerTab = document.getElementById('checker');
    if (checkerTab) {
        checkerTab.addEventListener('contextmenu', async (e) => {
            e.preventDefault();

            if (!elements.checkerContextMenu || !elements.checkerContextMenuText) return;

            // Check if right-clicked on a student list item
            const listItem = e.target.closest('.glass-list li');

            if (listItem && listItem.dataset.entryData) {
                // Right-clicked on a student - show "Resend Highlight Ping"
                selectedStudentEntry = JSON.parse(listItem.dataset.entryData);
                elements.checkerContextMenuText.textContent = 'Resend Highlight Ping';

                positionContextMenu(elements.checkerContextMenu, e.pageX, e.pageY);
            } else {
                // Right-clicked elsewhere on checker tab - check if there are any students
                const data = await chrome.storage.local.get(STORAGE_KEYS.FOUND_ENTRIES);
                const foundEntries = data[STORAGE_KEYS.FOUND_ENTRIES] || [];

                if (foundEntries.length > 0) {
                    // Show "Resend All Highlight Pings" only if there are students
                    selectedStudentEntry = null;
                    elements.checkerContextMenuText.textContent = 'Resend All Highlight Pings';

                    positionContextMenu(elements.checkerContextMenu, e.pageX, e.pageY);
                }
                // If no students, don't show the context menu
            }
        });
    }

    // Context menu item - Resend Highlight Ping(s)
    if (elements.resendHighlightPingMenuItem) {
        elements.resendHighlightPingMenuItem.addEventListener('click', async () => {
            // Hide context menu
            if (elements.checkerContextMenu) {
                elements.checkerContextMenu.style.display = 'none';
            }

            // Check for multiple Excel instances and show selector if needed
            const excelTabs = await getExcelTabs();
            let targetTabId = null;

            if (excelTabs.length > 1) {
                targetTabId = await openExcelInstanceModal(
                    excelTabs,
                    'Multiple Excel instances detected. Select which one to send the highlight ping to:'
                );
                if (targetTabId === null) return; // User cancelled
            } else if (excelTabs.length === 1) {
                targetTabId = excelTabs[0].id;
            }

            if (selectedStudentEntry) {
                // Resend ping for single student
                await resendHighlightPing(selectedStudentEntry, targetTabId);
                console.log('Resent highlight ping for:', selectedStudentEntry.name);
            } else {
                // Resend pings for all students
                await resendAllHighlightPings(targetTabId);
                console.log('Resent all highlight pings');
            }
        });
    }

    // Mini Console toggle functionality is now handled in updateCanvasStatus
    // to allow status text to be a clickable link when Canvas is disconnected
    if (elements.statusText) {
        elements.statusText.style.cursor = 'pointer';
    }

    if (elements.clearConsoleBtn && elements.consoleContent) {
        elements.clearConsoleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.consoleContent.innerHTML = '';
        });
    }

    // Intercept console logs from sidepanel and display in mini console
    const originalConsole = {
        log: console.log,
        warn: console.warn,
        error: console.error,
        info: console.info
    };

    console.log = function(...args) {
        originalConsole.log.apply(console, args);
        addConsoleMessage('log', args);
    };

    console.warn = function(...args) {
        originalConsole.warn.apply(console, args);
        addConsoleMessage('warn', args);
    };

    console.error = function(...args) {
        originalConsole.error.apply(console, args);
        addConsoleMessage('error', args);
    };

    console.info = function(...args) {
        originalConsole.info.apply(console, args);
        addConsoleMessage('info', args);
    };

    if (elements.studentPopFile) {
        elements.studentPopFile.addEventListener('change', (e) => {
            const fileCount = e.target.files.length;
            handleFileImport(e.target.files, async (students, meta) => {
                if (isUpdateCancelled()) { setUpdateButtonsDisabled(false); return; }

                renderMasterList(students, (entry, li, evt) => {
                    queueManager.handleStudentClick(entry, li, evt);
                });

                // If this is an attendance-only report, ask user if they want to ping Canvas
                if (meta && meta.isAttendanceReport) {
                    const choice = await openAttendanceReportModal();

                    if (choice === false) {
                        // User chose attendance only - skip Canvas, hide remaining steps
                        enterAttendanceMode();

                        // Persist attendance mode so it survives panel close/reopen
                        await chrome.storage.local.set({ [STORAGE_KEYS.IS_ATTENDANCE_MODE]: true });

                        // Auto-download the attendance report
                        await exportReport();
                        setUpdateButtonsDisabled(false);
                        return;
                    }

                    if (choice === null) {
                        // User cancelled - do nothing further
                        setUpdateButtonsDisabled(false);
                        return;
                    }
                }

                if (isUpdateCancelled()) { setUpdateButtonsDisabled(false); return; }

                // Normal flow: exit attendance mode if previously active, then ping Canvas (Steps 2-4)
                exitAttendanceMode();
                await chrome.storage.local.set({ [STORAGE_KEYS.IS_ATTENDANCE_MODE]: false });

                // Note: Don't pass render callbacks here - the storage.onChanged listener
                // already handles re-rendering when MASTER_ENTRIES is updated.
                // Passing callbacks that also render would cause double renders (duplicate students bug).
                processStep2(students, async (updatedStudents) => {
                    if (isUpdateCancelled()) { setUpdateButtonsDisabled(false); return; }
                    const finalStudents = await processStep3(updatedStudents);
                    if (isUpdateCancelled()) { setUpdateButtonsDisabled(false); return; }
                    // Send master list with missing assignments to Excel
                    await processStep4(finalStudents);
                    // Re-enable buttons after the entire process completes
                    setUpdateButtonsDisabled(false);
                    // Create backup after the entire update process completes
                    const lastUpdatedData = await storageGet([STORAGE_KEYS.LAST_UPDATED]);
                    const totalTimeEl = document.getElementById('queueTotalTime');
                    const totalDuration = totalTimeEl?.dataset.processStartTime
                        ? (Date.now() - parseInt(totalTimeEl.dataset.processStartTime)) / 1000
                        : 0;
                    await createMasterListBackup(finalStudents, lastUpdatedData[STORAGE_KEYS.LAST_UPDATED], fileCount, totalDuration);
                });
            });
        });
    }

    if (elements.queueCloseBtn) {
        elements.queueCloseBtn.addEventListener('click', () => {
            cancelUpdate();
        });
    }

    if (elements.masterSearch) {
        elements.masterSearch.addEventListener('input', filterMasterList);
    }

    // Sort filter dropdown menu
    if (elements.sortFilterBtn && elements.sortDropdownMenu) {
        elements.sortFilterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = elements.sortDropdownMenu;
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        });

        elements.sortDropdownMenu.querySelectorAll('.sort-dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const sortValue = item.getAttribute('data-sort');
                // Update active state
                elements.sortDropdownMenu.querySelectorAll('.sort-dropdown-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                // Sort and close menu
                setSortCriteria(sortValue);
                elements.sortDropdownMenu.style.display = 'none';
            });
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            elements.sortDropdownMenu.style.display = 'none';
        });
    }

    // View toggle (List / Stats)
    if (elements.viewListBtn && elements.viewStatsBtn) {
        elements.viewListBtn.addEventListener('click', () => {
            elements.viewListBtn.classList.add('active');
            elements.viewStatsBtn.classList.remove('active');
            if (elements.listViewSection) elements.listViewSection.style.display = '';
            if (elements.statsViewSection) elements.statsViewSection.style.display = 'none';
        });

        elements.viewStatsBtn.addEventListener('click', () => {
            elements.viewStatsBtn.classList.add('active');
            elements.viewListBtn.classList.remove('active');
            if (elements.listViewSection) elements.listViewSection.style.display = 'none';
            if (elements.statsViewSection) elements.statsViewSection.style.display = '';
            updateDistributionDropdown();
            renderChart();
        });
    }

    if (elements.distributionSelect) {
        elements.distributionSelect.addEventListener('change', () => {
            renderChart(elements.distributionSelect.value);
        });
    }

    // Chart type toggle buttons
    const chartToggle = document.getElementById('chartTypeToggle');
    if (chartToggle) {
        chartToggle.addEventListener('click', (e) => {
            const btn = e.target.closest('.chart-toggle-btn');
            if (btn && btn.dataset.chart) {
                setChartType(btn.dataset.chart);
            }
        });
    }

    // Rotate box plot button
    const rotateBtn = document.getElementById('rotateWhiskerBtn');
    if (rotateBtn) {
        rotateBtn.addEventListener('click', toggleWhiskerOrientation);
    }

    // Real-time chart resize when panel width changes
    initChartResizeObserver();

    if (elements.campusFilter) {
        elements.campusFilter.addEventListener('change', filterByCampus);
    }

    if (elements.downloadMasterBtn) {
        // 5-second cooldown so the button can't be spammed
        const DOWNLOAD_COOLDOWN_MS = 5000;
        let downloadCooldownTimer = null;
        elements.downloadMasterBtn.addEventListener('click', async () => {
            if (elements.downloadMasterBtn.disabled) return;

            downloadCooldownActive = true;
            refreshDownloadButtonState();
            if (downloadCooldownTimer) clearTimeout(downloadCooldownTimer);
            downloadCooldownTimer = setTimeout(() => {
                downloadCooldownActive = false;
                downloadCooldownTimer = null;
                refreshDownloadButtonState();
            }, DOWNLOAD_COOLDOWN_MS);

            try {
                await exportReport();
            } catch (err) {
                console.error('Export failed:', err);
            }
        });
    }
}

// --- HELPER FUNCTIONS ---

/**
 * Enters attendance-only mode: hides steps 2-4.
 * Download button no longer needs swapping — exportReport auto-detects the report type.
 */
function enterAttendanceMode() {
    const s2 = document.getElementById('step2');
    if (s2) s2.style.display = 'none';
}

/**
 * Exits attendance-only mode: restores steps 2-4 visibility.
 */
function exitAttendanceMode() {
    const s2 = document.getElementById('step2');
    if (s2) s2.style.display = '';
}

/**
 * Initializes disposition button states
 * Only shows dispositions that have a valid code defined
 */
function initializeDispositionButtons() {
    const dispositionButtons = document.querySelectorAll('.disposition-btn');

    dispositionButtons.forEach(btn => {
        const buttonText = btn.innerText.trim();

        // Hide dispositions that don't have a code (including "Other")
        if (!hasDispositionCode(buttonText)) {
            btn.style.display = 'none';
        } else {
            btn.style.display = 'flex';
            btn.classList.remove('disabled');
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            btn.title = '';
        }
    });
}

/**
 * Formats a phone number string to dashed style.
 * Accepts any input; strips non-digits, then:
 *   - 10 digits        -> "XXX-XXX-XXXX"
 *   - 11 digits (lead 1) -> "1-XXX-XXX-XXXX"
 *   - 7 digits         -> "XXX-XXXX"
 *   - anything else    -> null (treated as invalid by the caller)
 * @param {string} input
 * @returns {string|null}
 */
function formatPhoneNumber(input) {
    if (!input) return null;
    const digits = String(input).replace(/\D/g, '');
    if (digits.length === 10) {
        return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    if (digits.length === 11 && digits[0] === '1') {
        return `1-${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    if (digits.length === 7) {
        return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    }
    return null;
}

/**
 * Looks up a student in the master list whose phone digits match the given number.
 * Compares digits-only versions so format differences are ignored.
 * @param {string} formattedPhone
 * @returns {Promise<Object|null>}
 */
async function findStudentByPhone(formattedPhone) {
    const targetDigits = String(formattedPhone || '').replace(/\D/g, '');
    if (!targetDigits) return null;

    try {
        const data = await chrome.storage.local.get([STORAGE_KEYS.MASTER_ENTRIES]);
        const students = data[STORAGE_KEYS.MASTER_ENTRIES] || [];
        return students.find(s => {
            const candidates = [s.directPhone, s.phone, s.Phone, s.PrimaryPhone].filter(Boolean);
            return candidates.some(p => String(p).replace(/\D/g, '') === targetDigits);
        }) || null;
    } catch (err) {
        console.warn('[Phone Lookup] Failed to read master list:', err);
        return null;
    }
}

/**
 * Wires up click-to-edit on the contact phone number display.
 *  - Click: enter text mode (only when a single student is loaded and no call is in progress).
 *  - Enter: confirm.
 *  - Escape / blur with invalid input: revert to the previous value.
 *  - Blur with valid input: format with dashes, then look up the new number in the
 *    master list. If a student is found, that student is loaded into the contact
 *    card; otherwise an "Unknown" entry is shown so the call still dials the number.
 */
function setupPhoneEditing() {
    if (!elements.contactPhone) return;

    // Discoverability: empty phone field shows this hint via CSS :empty + ::before.
    elements.contactPhone.dataset.emptyPlaceholder = 'Enter phone number';

    let beforeEdit = '';

    elements.contactPhone.addEventListener('click', () => {
        if (elements.contactPhone.contentEditable === 'true') return;

        if (!queueManager) return;

        // Block during an active call or while a disposition is being processed.
        if (callManager && (callManager.getCallActiveState() || callManager.getWaitingForDisposition())) {
            return;
        }

        // In automation mode, only allow editing while paused between calls
        // (a custom number is staged like a previous-calls redial). Block while
        // automation is actively dialing.
        if (callManager && callManager.getAutomationModeState() && !callManager.isPaused) {
            return;
        }

        // Outside automation: only when zero or one student is loaded (multi-select
        // queues haven't started automation yet — don't touch them).
        if (!callManager?.getAutomationModeState() && queueManager.getLength() > 1) {
            return;
        }

        beforeEdit = elements.contactPhone.textContent.trim();
        if (beforeEdit === 'No Phone Listed' || beforeEdit === '') {
            elements.contactPhone.textContent = '';
        }

        elements.contactPhone.contentEditable = 'true';
        elements.contactPhone.focus();

        try {
            const range = document.createRange();
            range.selectNodeContents(elements.contactPhone);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        } catch (_) { /* selection not supported in this context */ }
    });

    elements.contactPhone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            elements.contactPhone.blur();
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            elements.contactPhone.textContent = beforeEdit;
            elements.contactPhone.contentEditable = 'false';
            elements.contactPhone.blur();
            return;
        }

        // Allow modifier combos (copy/paste/select-all/etc.)
        if (e.ctrlKey || e.metaKey) return;
        // Allow non-printable keys (arrows, Backspace, Tab, etc. — all have length > 1)
        if (e.key.length > 1) return;
        // Allow digits and common phone-format characters; block everything else (letters, etc.)
        if (!/^[0-9+\-\s().]$/.test(e.key)) {
            e.preventDefault();
        }
    });

    // Sanitize pasted text: keep only digits and phone-format characters
    elements.contactPhone.addEventListener('paste', (e) => {
        if (elements.contactPhone.contentEditable !== 'true') return;
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text') || '';
        const cleaned = pasted.replace(/[^0-9+\-\s().]/g, '');
        if (cleaned) {
            document.execCommand('insertText', false, cleaned);
        }
    });

    elements.contactPhone.addEventListener('blur', async () => {
        if (elements.contactPhone.contentEditable !== 'true') return;

        const raw = elements.contactPhone.textContent.trim();
        elements.contactPhone.contentEditable = 'false';

        // Cleared the field entirely — in paused automation, revert the
        // staged redial back to the queued student. Otherwise drop to the
        // No Student Selected state.
        if (raw === '') {
            elements.contactPhone.textContent = '';
            if (callManager && callManager.getAutomationModeState() && callManager.isPaused) {
                callManager.clearStagedRedial();
            } else if (queueManager) {
                queueManager.clearQueue();
            }
            return;
        }

        const formatted = formatPhoneNumber(raw);

        if (formatted === null) {
            // Invalid input (e.g. "1334") — revert to the previous number.
            elements.contactPhone.textContent = beforeEdit;
            return;
        }

        elements.contactPhone.textContent = formatted;
        if (!queueManager) return;

        // Look up the new number in the master list.
        const found = await findStudentByPhone(formatted);
        const target = found
            ? { ...found, directPhone: formatted }
            : { name: 'Unknown', directPhone: formatted, phone: formatted };

        // In paused automation, stage the custom number as a redial so the
        // queue stays intact and the user can revert via the Cancel button.
        if (callManager && callManager.getAutomationModeState() && callManager.isPaused) {
            callManager.loadFromHistory(target);
            return;
        }

        // Otherwise replace the queue (default single-student flow).
        queueManager.setQueue([target]);
    });
}

/**
 * Returns the ordinal suffix for a day-of-month number (1st, 2nd, 3rd, 4th, ...).
 */
function dayOrdinalSuffix(n) {
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
 * Formats a previous-call timestamp for display:
 *   - today     -> "3:45 PM"
 *   - yesterday -> "Yesterday"
 *   - older     -> "March 5th"
 * @param {number} ts - Unix timestamp in ms
 */
function formatPreviousCallTime(ts) {
    if (!ts) return '';
    const now = new Date();
    const d = new Date(ts);

    if (now.toDateString() === d.toDateString()) {
        let h = d.getHours();
        const m = d.getMinutes().toString().padStart(2, '0');
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return `${h}:${m} ${ampm}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (yesterday.toDateString() === d.toDateString()) {
        return 'Yesterday';
    }

    const month = d.toLocaleString('en-US', { month: 'long' });
    const day = d.getDate();
    return `${month} ${day}${dayOrdinalSuffix(day)}`;
}

/**
 * Renders the Previous Calls card with the given entries.
 * Hides the card when there are no entries.
 * @param {Array} entries - Recent call entries (most recent first)
 */
function renderPreviousCalls(entries) {
    if (!elements.previousCallsCard || !elements.previousCallsList) return;

    if (!entries || entries.length === 0) {
        elements.previousCallsCard.style.display = 'none';
        elements.previousCallsList.innerHTML = '';
        return;
    }

    const inActiveCall = !!(callManager && (callManager.getCallActiveState() || callManager.getWaitingForDisposition()));

    const html = entries.map((entry, index) => {
        const phone = entry.directPhone || entry.phone || entry.Phone || entry.PrimaryPhone || '';
        const hasPhone = !!phone;
        const disabled = inActiveCall || !hasPhone;
        const title = !hasPhone ? 'No phone number on file' : (inActiveCall ? 'Finish the current call first' : 'Click to load this number');
        const timeText = formatPreviousCallTime(entry.timestamp);
        const safeName = (entry.name || 'Unknown Student')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        const hasPhoto = entry.Photo && entry.Photo !== GENERIC_AVATAR_URL;
        const safePhoto = hasPhoto ? entry.Photo.replace(/'/g, '%27') : '';
        const avatarInner = hasPhoto
            ? `<div class="previous-call-avatar previous-call-avatar--photo" style="background-image:url('${safePhoto}');"></div>`
            : `<div class="previous-call-avatar"><i class="fas fa-user"></i></div>`;
        return `
            <div class="previous-call-item${disabled ? ' disabled' : ''}" data-index="${index}" title="${title}">
                ${avatarInner}
                <div class="previous-call-info">
                    <span class="previous-call-name">${safeName}</span>
                    ${timeText ? `<span class="previous-call-time">${timeText}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');

    elements.previousCallsList.innerHTML = html;
    elements.previousCallsCard.style.display = 'flex';
}

/**
 * Initializes call control button visibility based on UI_FEATURES flags
 */
function initializeCallControlButtons() {
    // Mute button visibility
    const muteButton = document.querySelector('.control-btn.mute');
    if (muteButton) {
        muteButton.style.display = UI_FEATURES.SHOW_MUTE_BUTTON ? 'flex' : 'none';
    }

    // Speaker button visibility
    const speakerButton = document.querySelector('.control-btn.speaker');
    if (speakerButton) {
        speakerButton.style.display = UI_FEATURES.SHOW_SPEAKER_BUTTON ? 'flex' : 'none';
    }
}

/**
 * Handles queue removal operations
 */
function handleQueueRemoval(index) {
    const result = queueManager.removeFromQueue(index);
    if (result === 'close') {
        closeQueueModal();
    } else if (result === 'refresh') {
        renderQueueModal(
            queueManager.getQueue(),
            (fromIdx, toIdx) => queueManager.reorderQueue(fromIdx, toIdx),
            (idx) => handleQueueRemoval(idx),
            { currentIndex: callManager.currentAutomationIndex, skippedIndices: callManager.skippedIndices }
        );
    }
}

/**
 * Handles Update Master List button click
 */
async function handleUpdateMasterList() {
    if (elements.studentPopFile) {
        elements.studentPopFile.click();
    }
}

/**
 * Loads data from storage and updates UI
 */
async function loadStorageData() {
    // Load from local storage (persistent settings)
    const data = await storageGet([
        STORAGE_KEYS.FOUND_ENTRIES,
        STORAGE_KEYS.MASTER_ENTRIES,
        STORAGE_KEYS.LAST_UPDATED,
        STORAGE_KEYS.CALL_DEMO,
        STORAGE_KEYS.EMBED_IN_CANVAS,
        STORAGE_KEYS.HIGHLIGHT_COLOR,
        STORAGE_KEYS.AUTO_UPDATE_MASTER_LIST,
        STORAGE_KEYS.POWER_AUTOMATE_URL,
        STORAGE_KEYS.USE_SPECIFIC_DATE,
        STORAGE_KEYS.SPECIFIC_SUBMISSION_DATE,
        STORAGE_KEYS.IS_ATTENDANCE_MODE
    ]);

    // Load extension state from session storage (temporary, resets on browser restart)
    const extensionState = await sessionGetValue(STORAGE_KEYS.EXTENSION_STATE, EXTENSION_STATES.OFF);

    const foundEntries = data[STORAGE_KEYS.FOUND_ENTRIES] || [];
    renderFoundList(foundEntries);
    updateTabBadge('checker', foundEntries.length);

    const masterEntries = data[STORAGE_KEYS.MASTER_ENTRIES] || [];
    renderMasterList(masterEntries, (entry, li, evt) => {
        queueManager.handleStudentClick(entry, li, evt);
    });

    // Restore campus filter if master list has campus data
    updateCampusFilter(masterEntries);

    // Update Start button based on master list (gradebook links check)
    updateStartButtonForMasterList();

    // Disable Download when there's nothing to export
    masterListIsEmpty = masterEntries.length === 0;
    refreshDownloadButtonState();

    if (elements.lastUpdatedText && data[STORAGE_KEYS.LAST_UPDATED]) {
        elements.lastUpdatedText.textContent = data[STORAGE_KEYS.LAST_UPDATED];
    }

    updateButtonVisuals(extensionState);

    // Load Call Demo mode (formerly debugMode)
    isDebugMode = data[STORAGE_KEYS.CALL_DEMO] || false;
    updateDebugModeUI(isDebugMode);
    if (callManager) {
        callManager.setDebugMode(isDebugMode);
    }

    // Load Embed Helper setting (default: true)
    embedHelperEnabled = data[STORAGE_KEYS.EMBED_IN_CANVAS] !== undefined
        ? data[STORAGE_KEYS.EMBED_IN_CANVAS]
        : true;
    updateEmbedHelperUI(embedHelperEnabled);

    // Load Highlight Color setting (default: #ffff00)
    highlightColor = data[STORAGE_KEYS.HIGHLIGHT_COLOR] || '#ffff00';
    updateHighlightColorUI(highlightColor);

    // Load Power Automate URL and update status
    const powerAutomateUrl = data[STORAGE_KEYS.POWER_AUTOMATE_URL] || '';
    updatePowerAutomateStatus(powerAutomateUrl);

    // Update Canvas connection status
    updateCanvasStatus();

    // Update Five9 connection status
    updateFive9Status();

    // Load Specific Submission Date settings
    const useSpecificDate = data[STORAGE_KEYS.USE_SPECIFIC_DATE] || false;
    const specificDate = data[STORAGE_KEYS.SPECIFIC_SUBMISSION_DATE];

    if (elements.useSpecificDateToggle) {
        elements.useSpecificDateToggle.classList.toggle('is-on', useSpecificDate);
        elements.useSpecificDateToggle.setAttribute('aria-pressed', useSpecificDate ? 'true' : 'false');
    }

    if (elements.specificDatePicker) {
        elements.specificDatePicker.style.display = useSpecificDate ? 'block' : 'none';
    }

    if (elements.specificDateInput && specificDate) {
        elements.specificDateInput.value = specificDate;
    }

    // Restore attendance-only mode if it was active before panel closed
    if (data[STORAGE_KEYS.IS_ATTENDANCE_MODE]) {
        enterAttendanceMode();
    }
}

// Local storage change listener (for persistent data like found/master entries)
chrome.storage.local.onChanged.addListener((changes) => {
    if (changes[STORAGE_KEYS.FOUND_ENTRIES] || changes.foundEntries) {
        const newValue = changes[STORAGE_KEYS.FOUND_ENTRIES]?.newValue || changes.foundEntries?.newValue;
        renderFoundList(newValue);
        updateTabBadge('checker', (newValue || []).length);
    }
    if (changes[STORAGE_KEYS.MASTER_ENTRIES] || changes.masterEntries) {
        const newMasterEntries = changes[STORAGE_KEYS.MASTER_ENTRIES]?.newValue || changes.masterEntries?.newValue || [];
        renderMasterList(newMasterEntries, (entry, li, evt) => {
            queueManager.handleStudentClick(entry, li, evt);
        });
        // Update campus filter when master list changes
        updateCampusFilter(newMasterEntries);
        // Update Start button based on master list (gradebook links check)
        updateStartButtonForMasterList();
        // Disable Download when there's nothing to export
        masterListIsEmpty = newMasterEntries.length === 0;
        refreshDownloadButtonState();
    }

    // Handle name format toggle changes - re-render all displays
    if (changes.reformatNameEnabled) {
        console.log(`Name format changed to: ${changes.reformatNameEnabled.newValue ? 'First Last' : 'Original'}`);

        // Re-render found list
        chrome.storage.local.get([STORAGE_KEYS.FOUND_ENTRIES], (data) => {
            const foundEntries = data[STORAGE_KEYS.FOUND_ENTRIES] || [];
            renderFoundList(foundEntries);
        });

        // Re-render master list
        chrome.storage.local.get([STORAGE_KEYS.MASTER_ENTRIES], (data) => {
            const masterEntries = data[STORAGE_KEYS.MASTER_ENTRIES] || [];
            renderMasterList(masterEntries, (entry, li, evt) => {
                queueManager.handleStudentClick(entry, li, evt);
            });
        });

        // Re-render active student if one is selected
        if (callManager && callManager.activeStudent) {
            setActiveStudent(callManager.activeStudent, callManager);
        }

        // Re-render queue modal if it's open
        if (elements.queueModal && elements.queueModal.style.display !== 'none') {
            queueManager.renderQueue();
        }
    }
});

// Session storage change listener (for EXTENSION_STATE - resets on browser restart)
chrome.storage.session.onChanged.addListener((changes) => {
    // Handle nested storage structure for EXTENSION_STATE (stored under 'state.extensionState')
    if (changes.state) {
        const newState = changes.state.newValue?.extensionState;
        const oldState = changes.state.oldValue?.extensionState;
        if (newState !== undefined && newState !== oldState) {
            updateButtonVisuals(newState);
        }
    }
});

/**
 * Handles incoming SRK_SELECTED_STUDENTS messages (from runtime listener or pending autoCall).
 * Sets the active student / automation queue and optionally auto-dials.
 */
async function handleSelectedStudentsMessage(msg) {
    const autoCall = msg.autoCall || false;

    // If a call is active and autoCall is requested, check if it's the same student
    if (callManager && (callManager.getCallActiveState() || callManager.getAutomationModeState()) && autoCall) {
        // Check if the incoming student is the same one already being called
        const currentStudent = callManager.selectedQueue && callManager.selectedQueue[0];
        const incomingStudent = msg.students && msg.students[0];
        const isSameStudent = currentStudent && incomingStudent && (
            (currentStudent.SyStudentId && incomingStudent.SyStudentId && currentStudent.SyStudentId === incomingStudent.SyStudentId) ||
            (currentStudent.name === incomingStudent.name)
        );

        if (isSameStudent) {
            // Same student — treat as a toggle: just end the current call
            console.log('%c [Sidepanel] Same student call button pressed again — ending call', 'color: orange; font-weight: bold');
            await callManager.forceEndCall();
            return; // Don't re-initiate
        }

        // Different student — force-end current call so we can start the new one
        console.log('%c [Sidepanel] Auto-call requested for different student — ending current call', 'color: orange; font-weight: bold');
        await callManager.forceEndCall();
    }

    // IGNORE PINGS IF CALL IS ACTIVE OR AUTOMATION MODE IS ACTIVE (non-autoCall only)
    // Don't interrupt current call session or disrupt automation queue
    if (callManager && (callManager.getCallActiveState() || callManager.getAutomationModeState())) {
        const reason = callManager.getAutomationModeState() ? 'automation mode active' : 'call already in session';
        console.log(`%c [Sidepanel] Ignoring ping - ${reason}`, 'color: orange; font-weight: bold');
        return; // Exit early, don't process this ping
    }

    const modeText = msg.count === 1 ? 'active student' : 'automation mode';
    console.log(`%c [Sidepanel] Setting ${modeText} from Office Add-in:`, 'color: purple; font-weight: bold', msg.count, 'student(s)');

    if (msg.students && msg.students.length > 0 && callManager && queueManager) {
        // Try to find matching students in master list for complete data
        const data = await chrome.storage.local.get([STORAGE_KEYS.MASTER_ENTRIES]);
        const masterEntries = data[STORAGE_KEYS.MASTER_ENTRIES] || [];

        // Normalize a phone string for comparison (digits only)
        const normalizePhone = (p) => p ? String(p).replace(/\D/g, '') : '';

        // Match all students with master list
        const studentsToSet = msg.students.map(student => {
            if (masterEntries.length > 0) {
                const studentPhoneNorm = normalizePhone(student.phone);
                const studentOtherNorm = normalizePhone(student.otherPhone);

                const matchedStudent = masterEntries.find(entry => {
                    // Match by SyStudentId if available (normalize to string for comparison)
                    if (student.SyStudentId && entry.SyStudentId) {
                        return String(entry.SyStudentId) === String(student.SyStudentId);
                    }
                    // Match by name
                    if (entry.name === student.name) return true;
                    // Match by phone number as fallback identifier
                    if (studentPhoneNorm && normalizePhone(entry.phone) === studentPhoneNorm) return true;
                    if (studentOtherNorm && normalizePhone(entry.otherPhone) === studentOtherNorm) return true;
                    return false;
                });

                if (matchedStudent) {
                    console.log(`%c [Sidepanel] Matched with master list: ${matchedStudent.name} | daysOut=${matchedStudent.daysOut} | phone=${matchedStudent.phone} | otherPhone=${matchedStudent.otherPhone}`, 'color: lime');
                    // Merge: master list as base, preserve add-in phone overrides
                    const merged = { ...matchedStudent };
                    if (student.phone) merged.phone = student.phone;
                    if (student.otherPhone) merged.otherPhone = student.otherPhone;
                    if (student.directPhone) merged.directPhone = student.directPhone;
                    if (student.isOtherContact) merged.isOtherContact = true;
                    return merged;
                } else {
                    console.log(`%c [Sidepanel] No master list match for "${student.name}" (ID: ${student.SyStudentId}) — using add-in data (daysOut will be 0)`, 'color: orange; font-weight: bold');
                }
            }
            return student;
        });

        // Resolve directPhone and isOtherContact per student
        // Handles both single-cell (msg.directPhone) and multi-row (per-student) scenarios
        for (const stu of studentsToSet) {
            // Per-student directPhone from add-in takes priority, then msg-level directPhone for single student
            const dp = stu.directPhone || (msg.directPhone && studentsToSet.length === 1 ? msg.directPhone : null);
            if (!dp) continue;

            stu.directPhone = dp;
            const dpNorm = normalizePhone(dp);
            const otherNorm = normalizePhone(stu.otherPhone);
            const phoneNorm = normalizePhone(stu.phone);

            console.log(`%c [Sidepanel] directPhone=${dp} | phone=${stu.phone} | otherPhone=${stu.otherPhone}`, 'color: cyan');

            // Use the add-in's flag if provided, otherwise determine from phone comparison
            if (stu.isOtherContact) {
                console.log(`%c [Sidepanel] "${stu.name}" flagged as Other Contact (from add-in)`, 'color: #f59e0b; font-weight: bold');
            } else if (otherNorm && dpNorm === otherNorm) {
                stu.isOtherContact = true;
                console.log(`%c [Sidepanel] "${stu.name}" flagged as Other Contact`, 'color: #f59e0b; font-weight: bold');
            } else if (phoneNorm && dpNorm !== phoneNorm) {
                stu.isOtherContact = true;
                console.log(`%c [Sidepanel] "${stu.name}" directPhone differs from primary — flagged as Other Contact`, 'color: #f59e0b; font-weight: bold');
            } else {
                stu.isOtherContact = false;
            }
        }

        // Set queue using queue manager (handles both single and multiple)
        queueManager.setQueue(studentsToSet);

        // Switch to call tab and update display
        switchTab('contact');
        updateFive9ConnectionIndicator(queueManager.getQueue());

        if (msg.count === 1) {
            console.log(`Active student set to: ${studentsToSet[0].name}`);
        } else {
            console.log(`Automation mode enabled with ${msg.count} students`);
        }

        // Auto-initiate the call if requested (ribbon call button)
        if (autoCall) {
            // Check Five9 readiness before auto-calling (skip check in demo mode)
            const isDebugMode = getCachedDebugMode();
            if (!isDebugMode) {
                const connectionState = await checkFive9Connection();
                if (connectionState !== FIVE9_CONNECTION_STATES.ACTIVE_CONNECTION) {
                    console.log(`%c [Sidepanel] Five9 not ready (${connectionState}) — skipping auto-call from ribbon`, 'color: orange; font-weight: bold');
                    return;
                }
            }

            // Small delay to let the UI render the new student before dialing
            setTimeout(() => {
                console.log('%c [Sidepanel] Auto-initiating call from ribbon', 'color: green; font-weight: bold');
                callManager.toggleCallState();
            }, 300);
        }
    }
}

// Runtime message listener for Office Add-in student selection sync
chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
    if (msg.type === MESSAGE_TYPES.SRK_SELECTED_STUDENTS) {
        await handleSelectedStudentsMessage(msg);
    }

    // Handle logs from background script
    if (msg.type === MESSAGE_TYPES.LOG_TO_PANEL) {
        addConsoleMessage(msg.level, msg.args);
    }

    // Handle import status updates from Excel Add-in
    if (msg.type === MESSAGE_TYPES.SRK_IMPORT_STATUS) {
        updateImportStatus(msg.data);
    }

    // Handle Office Add-in reconnection (for retry flow)
    if (msg.type === MESSAGE_TYPES.SRK_OFFICE_ADDIN_CONNECTED || msg.type === MESSAGE_TYPES.SRK_PONG) {
        onAddinReconnected();
    }

    // Handle Canvas auth error from looper (background)
    if (msg.type === MESSAGE_TYPES.CANVAS_AUTH_ERROR) {
        console.log('%c [Sidepanel] Canvas auth error received - showing modal', 'color: red; font-weight: bold');

        // Show the auth error modal and wait for user response
        openCanvasAuthErrorModal().then(choice => {
            // Send the user's choice back to the looper (looper understands 'continue' not 'retry')
            chrome.runtime.sendMessage({
                type: MESSAGE_TYPES.CANVAS_AUTH_RESPONSE,
                choice: choice === 'retry' ? 'continue' : choice
            }).catch(err => {
                console.warn('[Sidepanel] Could not send auth response:', err);
            });
        });

        // Return true to indicate we'll respond asynchronously (even though we're not using sendResponse)
        return true;
    }
});

/**
 * Toggles scanning state
 */
async function toggleScanState() {
    // Don't toggle if button is disabled (no Canvas connection)
    if (elements.startBtn && elements.startBtn.disabled) {
        return;
    }

    // If turning ON, check prerequisites before starting
    if (!isScanning) {
        // Check if scan filter has been configured
        const scanFilterData = await storageGet([STORAGE_KEYS.LOOPER_DAYS_OUT_FILTER]);
        const hasScanFilterSetting = scanFilterData[STORAGE_KEYS.LOOPER_DAYS_OUT_FILTER] !== undefined;

        if (!hasScanFilterSetting) {
            // No scan filter saved - open the modal for the user to configure.
            // Mark this open as "first-time from Start" so that saving the filter
            // also kicks off the scan, avoiding a second click on Start.
            console.log('No scan filter setting found - opening Scan Filter modal');
            pendingAutoStartAfterFilterSave = true;
            openScanFilterModal();
            return; // Don't start scanning until user configures the filter
        }

        // Check if highlight feature is enabled
        const highlightEnabled = await storageGetValue(STORAGE_KEYS.HIGHLIGHT_STUDENT_ROW_ENABLED, true);

        if (highlightEnabled) {
            // Get Excel tabs
            const excelTabs = await getExcelTabs();

            // If multiple Excel tabs, show selection modal
            if (excelTabs.length > 1) {
                const selectedTabId = await openExcelInstanceModal(
                    excelTabs,
                    'Multiple Excel instances detected. Select which one to send submission highlights to:'
                );

                // User cancelled - don't start the scanner
                if (selectedTabId === null) {
                    console.log('User cancelled Excel instance selection for highlights');
                    return;
                }

                // Store the selected tab ID for highlight pings
                await storageSet({ [STORAGE_KEYS.HIGHLIGHT_TARGET_TAB_ID]: selectedTabId });
                console.log(`Selected Excel tab ${selectedTabId} for submission highlights`);
            } else if (excelTabs.length === 1) {
                // Only one tab, use it directly
                await storageSet({ [STORAGE_KEYS.HIGHLIGHT_TARGET_TAB_ID]: excelTabs[0].id });
            } else {
                // No Excel tabs - clear the target tab ID
                await storageSet({ [STORAGE_KEYS.HIGHLIGHT_TARGET_TAB_ID]: null });
            }
        } else {
            // Highlight disabled - clear the target tab ID
            await storageSet({ [STORAGE_KEYS.HIGHLIGHT_TARGET_TAB_ID]: null });
        }
    } else {
        // Turning OFF - clear the target tab ID
        await storageSet({ [STORAGE_KEYS.HIGHLIGHT_TARGET_TAB_ID]: null });
    }

    isScanning = !isScanning;
    const newState = isScanning ? EXTENSION_STATES.ON : EXTENSION_STATES.OFF;
    await sessionSet({ [STORAGE_KEYS.EXTENSION_STATE]: newState });
}

/**
 * Toggles debug mode (Call Demo mode)
 */
async function toggleDebugMode() {
    isDebugMode = !isDebugMode;
    await storageSet({ [STORAGE_KEYS.CALL_DEMO]: isDebugMode });
    updateDebugModeUI(isDebugMode);
    if (callManager) {
        callManager.setDebugMode(isDebugMode);
    }
    updateFive9ConnectionIndicator(queueManager.getQueue());
}

/**
 * Updates cache statistics display
 */
async function updateCacheStats() {
    if (!elements.cacheStatsText) return;

    try {
        const stats = await getCacheStats();

        if (stats.totalEntries === 0) {
            elements.cacheStatsText.textContent = 'No cached data';
        } else {
            const validText = stats.validEntries === 1 ? 'entry' : 'entries';
            const expiredText = stats.expiredEntries > 0
                ? ` (${stats.expiredEntries} expired)`
                : '';
            elements.cacheStatsText.textContent = `${stats.validEntries} valid ${validText}${expiredText}`;
        }
    } catch (error) {
        console.error('Error updating cache stats:', error);
        elements.cacheStatsText.textContent = 'Error loading stats';
    }
}

/**
 * Toggles embed helper in Canvas
 */
async function toggleEmbedHelper() {
    embedHelperEnabled = !embedHelperEnabled;
    await storageSet({ [STORAGE_KEYS.EMBED_IN_CANVAS]: embedHelperEnabled });
    updateEmbedHelperUI(embedHelperEnabled);
}

/**
 * Updates highlight color setting
 */
async function updateHighlightColor(event) {
    highlightColor = event.target.value;
    await storageSet({ [STORAGE_KEYS.HIGHLIGHT_COLOR]: highlightColor });
}
