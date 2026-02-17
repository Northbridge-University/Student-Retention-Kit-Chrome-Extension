// Connections Modal - Handles settings for Excel, Power Automate, Canvas, and Five9
import { STORAGE_KEYS, CANVAS_DOMAIN, FIVE9_CONNECTION_STATES, EXTENSION_STATES } from '../../constants/index.js';
import { storageGet, storageSet, storageGetValue, sessionGetValue } from '../../utils/storage.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { updateToggleUI, isToggleEnabled, setElementEnabled } from '../../utils/ui-helpers.js';
import { elements } from '../ui-manager.js';

/**
 * Opens the connections modal for a specific connection type
 * @param {string} connectionType - 'excel', 'powerAutomate', 'canvas', or 'five9'
 */
export async function openConnectionsModal(connectionType) {
    if (!elements.connectionsModal) return;

    // Show the modal
    elements.connectionsModal.style.display = 'flex';

    // Hide all configuration content
    if (elements.excelConfigContent) {
        elements.excelConfigContent.style.display = 'none';
    }
    if (elements.powerAutomateConfigContent) {
        elements.powerAutomateConfigContent.style.display = 'none';
    }
    if (elements.canvasConfigContent) {
        elements.canvasConfigContent.style.display = 'none';
    }
    if (elements.five9ConfigContent) {
        elements.five9ConfigContent.style.display = 'none';
    }

    // Show the appropriate configuration content
    if (connectionType === 'excel') {
        if (elements.connectionModalTitle) {
            elements.connectionModalTitle.textContent = 'Excel Add-in Settings';
        }
        if (elements.excelConfigContent) {
            elements.excelConfigContent.style.display = 'block';
        }
    } else if (connectionType === 'powerAutomate') {
        if (elements.connectionModalTitle) {
            elements.connectionModalTitle.textContent = 'Power Automate Settings';
        }
        if (elements.powerAutomateConfigContent) {
            elements.powerAutomateConfigContent.style.display = 'block';
        }
    } else if (connectionType === 'canvas') {
        if (elements.connectionModalTitle) {
            elements.connectionModalTitle.textContent = 'Canvas Settings';
        }
        if (elements.canvasConfigContent) {
            elements.canvasConfigContent.style.display = 'block';
        }
        // Load canvas cache stats when Canvas settings are opened
        loadCacheStatsForModal();
    } else if (connectionType === 'five9') {
        if (elements.connectionModalTitle) {
            elements.connectionModalTitle.textContent = 'Five9 Settings';
        }
        if (elements.five9ConfigContent) {
            elements.five9ConfigContent.style.display = 'block';
        }
    }

    // Load current settings into modal
    const result = await storageGet([
        STORAGE_KEYS.AUTO_UPDATE_MASTER_LIST,
        STORAGE_KEYS.SYNC_ACTIVE_STUDENT,
        STORAGE_KEYS.SEND_MASTER_LIST_TO_EXCEL,
        STORAGE_KEYS.REFORMAT_NAME_ENABLED,
        STORAGE_KEYS.HIGHLIGHT_STUDENT_ROW_ENABLED,
        STORAGE_KEYS.POWER_AUTOMATE_URL,
        STORAGE_KEYS.POWER_AUTOMATE_ENABLED,
        STORAGE_KEYS.POWER_AUTOMATE_DEBUG,
        STORAGE_KEYS.EMBED_IN_CANVAS,
        STORAGE_KEYS.HIGHLIGHT_COLOR,
        STORAGE_KEYS.CANVAS_CACHE_ENABLED,
        STORAGE_KEYS.NON_API_COURSE_FETCH,
        STORAGE_KEYS.NEXT_ASSIGNMENT_ENABLED,
        STORAGE_KEYS.CALL_DEMO,
        STORAGE_KEYS.AUTO_SWITCH_TO_CALL_TAB,
        STORAGE_KEYS.HIGHLIGHT_START_COL,
        STORAGE_KEYS.HIGHLIGHT_END_COL,
        STORAGE_KEYS.HIGHLIGHT_EDIT_COLUMN,
        STORAGE_KEYS.HIGHLIGHT_EDIT_TEXT,
        STORAGE_KEYS.HIGHLIGHT_TARGET_SHEET,
        STORAGE_KEYS.HIGHLIGHT_ROW_COLOR
    ]);

    // Load auto-update setting
    const setting = result[STORAGE_KEYS.AUTO_UPDATE_MASTER_LIST] || 'always';
    if (elements.autoUpdateSelectModal) {
        elements.autoUpdateSelectModal.value = setting;
    }

    // Load sync active student setting
    const syncActiveStudent = result[STORAGE_KEYS.SYNC_ACTIVE_STUDENT] !== undefined ? result[STORAGE_KEYS.SYNC_ACTIVE_STUDENT] : true;
    updateSyncActiveStudentModalUI(syncActiveStudent);

    // Load send master list to Excel setting
    const sendMasterListToExcel = result[STORAGE_KEYS.SEND_MASTER_LIST_TO_EXCEL] !== undefined ? result[STORAGE_KEYS.SEND_MASTER_LIST_TO_EXCEL] : true;
    updateSendMasterListModalUI(sendMasterListToExcel);

    // Load reformat name setting
    const reformatNameEnabled = result[STORAGE_KEYS.REFORMAT_NAME_ENABLED] !== undefined ? result[STORAGE_KEYS.REFORMAT_NAME_ENABLED] : true;
    updateReformatNameModalUI(reformatNameEnabled);

    // Load highlight student row enabled setting
    const highlightStudentRowEnabled = result[STORAGE_KEYS.HIGHLIGHT_STUDENT_ROW_ENABLED] !== undefined ? result[STORAGE_KEYS.HIGHLIGHT_STUDENT_ROW_ENABLED] : true;
    updateHighlightStudentRowModalUI(highlightStudentRowEnabled);

    // Load Power Automate settings (decrypt the URL)
    const encryptedPaUrl = result[STORAGE_KEYS.POWER_AUTOMATE_URL] || '';
    const paUrl = await decrypt(encryptedPaUrl);
    if (elements.powerAutomateUrlInput) {
        elements.powerAutomateUrlInput.value = paUrl;
    }

    const paEnabled = result[STORAGE_KEYS.POWER_AUTOMATE_ENABLED] || false;
    updatePowerAutomateEnabledUI(paEnabled);

    const paDebug = result[STORAGE_KEYS.POWER_AUTOMATE_DEBUG] || false;
    updatePowerAutomateDebugUI(paDebug);

    // Load Canvas settings
    const embedHelper = result[STORAGE_KEYS.EMBED_IN_CANVAS] !== undefined ? result[STORAGE_KEYS.EMBED_IN_CANVAS] : true;
    updateEmbedHelperModalUI(embedHelper);

    const highlightColor = result[STORAGE_KEYS.HIGHLIGHT_COLOR] || '#ffff00';
    if (elements.highlightColorPickerModal) {
        elements.highlightColorPickerModal.value = highlightColor;
    }

    const canvasCacheEnabled = result[STORAGE_KEYS.CANVAS_CACHE_ENABLED] !== undefined ? result[STORAGE_KEYS.CANVAS_CACHE_ENABLED] : true;
    updateCanvasCacheModalUI(canvasCacheEnabled);

    const nonApiCourseFetch = result[STORAGE_KEYS.NON_API_COURSE_FETCH] !== undefined ? result[STORAGE_KEYS.NON_API_COURSE_FETCH] : true;
    updateNonApiCourseFetchUI(nonApiCourseFetch);

    const nextAssignmentEnabled = result[STORAGE_KEYS.NEXT_ASSIGNMENT_ENABLED] !== undefined ? result[STORAGE_KEYS.NEXT_ASSIGNMENT_ENABLED] : false;
    updateNextAssignmentUI(nextAssignmentEnabled);

    // Load Five9 settings (Call Demo mode, formerly debugMode)
    const callDemo = result[STORAGE_KEYS.CALL_DEMO] || false;
    updateDebugModeModalUI(callDemo);

    // Load Auto Switch to Call Tab setting
    const autoSwitchCallTab = result[STORAGE_KEYS.AUTO_SWITCH_TO_CALL_TAB] !== undefined ? result[STORAGE_KEYS.AUTO_SWITCH_TO_CALL_TAB] : true;
    updateAutoSwitchCallTabUI(autoSwitchCallTab);

    // Load Highlight Student Row settings
    if (elements.highlightStartColInput) {
        elements.highlightStartColInput.value = result[STORAGE_KEYS.HIGHLIGHT_START_COL] || 'Student Name';
    }
    if (elements.highlightEndColInput) {
        elements.highlightEndColInput.value = result[STORAGE_KEYS.HIGHLIGHT_END_COL] || 'Outreach';
    }
    if (elements.highlightEditColumnInput) {
        elements.highlightEditColumnInput.value = result[STORAGE_KEYS.HIGHLIGHT_EDIT_COLUMN] || 'Outreach';
    }
    if (elements.highlightEditTextInput) {
        elements.highlightEditTextInput.value = result[STORAGE_KEYS.HIGHLIGHT_EDIT_TEXT] || 'Submitted {assignment}';
    }
    if (elements.highlightTargetSheetInput) {
        elements.highlightTargetSheetInput.value = result[STORAGE_KEYS.HIGHLIGHT_TARGET_SHEET] || 'LDA MM-DD-YYYY';
    }
    if (elements.highlightRowColorInput && elements.highlightRowColorTextInput) {
        const color = result[STORAGE_KEYS.HIGHLIGHT_ROW_COLOR] || '#92d050';
        elements.highlightRowColorInput.value = color;
        elements.highlightRowColorTextInput.value = color;
    }

    // Load cache stats
    loadCacheStatsForModal();
}

/**
 * Closes the connections modal
 */
export function closeConnectionsModal() {
    if (elements.connectionsModal) {
        elements.connectionsModal.style.display = 'none';
    }
}

/**
 * Saves connections settings from the modal
 */
export async function saveConnectionsSettings() {
    const settingsToSave = {};

    // Save auto-update setting
    if (elements.autoUpdateSelectModal) {
        const newSetting = elements.autoUpdateSelectModal.value;
        settingsToSave[STORAGE_KEYS.AUTO_UPDATE_MASTER_LIST] = newSetting;
        console.log(`Auto-update master list setting saved: ${newSetting}`);
    }

    // Save sync active student setting
    const syncEnabled = isToggleEnabled(elements.syncActiveStudentToggleModal);
    settingsToSave[STORAGE_KEYS.SYNC_ACTIVE_STUDENT] = syncEnabled;
    console.log(`Sync Active Student setting saved: ${syncEnabled}`);

    // Save send master list to Excel setting
    const sendEnabled = isToggleEnabled(elements.sendMasterListToggleModal);
    settingsToSave[STORAGE_KEYS.SEND_MASTER_LIST_TO_EXCEL] = sendEnabled;
    console.log(`Send Master List to Excel setting saved: ${sendEnabled}`);

    // Save reformat name setting
    const reformatEnabled = isToggleEnabled(elements.reformatNameToggleModal);
    settingsToSave[STORAGE_KEYS.REFORMAT_NAME_ENABLED] = reformatEnabled;
    console.log(`Reformat Name setting saved: ${reformatEnabled}`);

    // Save highlight student row enabled setting
    const highlightEnabled = isToggleEnabled(elements.highlightStudentRowToggleModal);
    settingsToSave[STORAGE_KEYS.HIGHLIGHT_STUDENT_ROW_ENABLED] = highlightEnabled;
    console.log(`Highlight Student Row enabled setting saved: ${highlightEnabled}`);

    // Save Power Automate settings (encrypt the URL)
    if (elements.powerAutomateUrlInput) {
        const paUrl = elements.powerAutomateUrlInput.value.trim();
        const encryptedPaUrl = paUrl ? await encrypt(paUrl) : '';
        settingsToSave[STORAGE_KEYS.POWER_AUTOMATE_URL] = encryptedPaUrl;
        console.log(`Power Automate URL saved: ${paUrl ? 'URL configured (encrypted)' : 'URL cleared'}`);
    }

    const paEnabled = isToggleEnabled(elements.powerAutomateEnabledToggle);
    settingsToSave[STORAGE_KEYS.POWER_AUTOMATE_ENABLED] = paEnabled;
    console.log(`Power Automate Enabled saved: ${paEnabled}`);

    const paDebug = isToggleEnabled(elements.powerAutomateDebugToggle);
    settingsToSave[STORAGE_KEYS.POWER_AUTOMATE_DEBUG] = paDebug;
    console.log(`Power Automate Debug saved: ${paDebug}`);

    // Update status text immediately with enabled state
    if (elements.powerAutomateUrlInput) {
        updatePowerAutomateStatus(elements.powerAutomateUrlInput.value.trim(), paEnabled);
    }

    // Save Canvas settings
    const embedEnabled = isToggleEnabled(elements.embedHelperToggleModal);
    settingsToSave[STORAGE_KEYS.EMBED_IN_CANVAS] = embedEnabled;
    console.log(`Embed Helper setting saved: ${embedEnabled}`);

    if (elements.highlightColorPickerModal) {
        const highlightColor = elements.highlightColorPickerModal.value;
        settingsToSave[STORAGE_KEYS.HIGHLIGHT_COLOR] = highlightColor;
        console.log(`Highlight Color saved: ${highlightColor}`);
    }

    const cacheEnabled = isToggleEnabled(elements.canvasCacheToggleModal);
    settingsToSave[STORAGE_KEYS.CANVAS_CACHE_ENABLED] = cacheEnabled;
    console.log(`Canvas Cache setting saved: ${cacheEnabled}`);

    const nonApiCourseFetch = isToggleEnabled(elements.nonApiCourseFetchToggle);
    settingsToSave[STORAGE_KEYS.NON_API_COURSE_FETCH] = nonApiCourseFetch;
    console.log(`Non API Course Fetch setting saved: ${nonApiCourseFetch}`);

    const nextAssignmentEnabled = isToggleEnabled(elements.nextAssignmentToggle);
    settingsToSave[STORAGE_KEYS.NEXT_ASSIGNMENT_ENABLED] = nextAssignmentEnabled;
    console.log(`Next Assignment setting saved: ${nextAssignmentEnabled}`);

    // Save Five9 settings (Call Demo mode)
    const callDemoEnabled = isToggleEnabled(elements.debugModeToggleModal);
    settingsToSave[STORAGE_KEYS.CALL_DEMO] = callDemoEnabled;
    console.log(`Call Demo mode setting saved: ${callDemoEnabled}`);

    // Save Auto Switch to Call Tab setting
    const autoSwitchEnabled = isToggleEnabled(elements.autoSwitchCallTabToggle);
    settingsToSave[STORAGE_KEYS.AUTO_SWITCH_TO_CALL_TAB] = autoSwitchEnabled;
    console.log(`Auto Switch to Call Tab setting saved: ${autoSwitchEnabled}`);

    // Save Highlight Student Row settings
    if (elements.highlightStartColInput) {
        settingsToSave[STORAGE_KEYS.HIGHLIGHT_START_COL] = elements.highlightStartColInput.value || 'Student Name';
    }
    if (elements.highlightEndColInput) {
        settingsToSave[STORAGE_KEYS.HIGHLIGHT_END_COL] = elements.highlightEndColInput.value || 'Outreach';
    }
    if (elements.highlightEditColumnInput) {
        settingsToSave[STORAGE_KEYS.HIGHLIGHT_EDIT_COLUMN] = elements.highlightEditColumnInput.value || 'Outreach';
    }
    if (elements.highlightEditTextInput) {
        settingsToSave[STORAGE_KEYS.HIGHLIGHT_EDIT_TEXT] = elements.highlightEditTextInput.value || 'Submitted {assignment}';
    }
    if (elements.highlightTargetSheetInput) {
        settingsToSave[STORAGE_KEYS.HIGHLIGHT_TARGET_SHEET] = elements.highlightTargetSheetInput.value || 'LDA MM-DD-YYYY';
    }
    if (elements.highlightRowColorTextInput) {
        settingsToSave[STORAGE_KEYS.HIGHLIGHT_ROW_COLOR] = elements.highlightRowColorTextInput.value || '#92d050';
    }

    // Save all settings
    await storageSet(settingsToSave);

    // Update Five9 status to reflect Call Demo mode change
    updateFive9Status();

    // Close modal after saving
    closeConnectionsModal();
}

// ============================================
// Toggle UI Update Functions
// ============================================

function updateEmbedHelperModalUI(isEnabled) {
    updateToggleUI(elements.embedHelperToggleModal, isEnabled);
}

function updateCanvasCacheModalUI(isEnabled) {
    updateToggleUI(elements.canvasCacheToggleModal, isEnabled);
    setElementEnabled(elements.cacheSettingsContainer, isEnabled, '0.4');
}

function updateNonApiCourseFetchUI(isEnabled) {
    updateToggleUI(elements.nonApiCourseFetchToggle, isEnabled);
}

function updateNextAssignmentUI(isEnabled) {
    updateToggleUI(elements.nextAssignmentToggle, isEnabled);
}

function updateDebugModeModalUI(isEnabled) {
    updateToggleUI(elements.debugModeToggleModal, isEnabled);
}

function updateAutoSwitchCallTabUI(isEnabled) {
    updateToggleUI(elements.autoSwitchCallTabToggle, isEnabled);
}

function updateSyncActiveStudentModalUI(isEnabled) {
    updateToggleUI(elements.syncActiveStudentToggleModal, isEnabled);
}

function updateSendMasterListModalUI(isEnabled) {
    updateToggleUI(elements.sendMasterListToggleModal, isEnabled);
}

function updateReformatNameModalUI(isEnabled) {
    updateToggleUI(elements.reformatNameToggleModal, isEnabled);
}

function updateHighlightStudentRowModalUI(isEnabled) {
    updateToggleUI(elements.highlightStudentRowToggleModal, isEnabled);
    setElementEnabled(elements.highlightSettingsContainer, isEnabled, '0.4');
}

function updatePowerAutomateEnabledUI(isEnabled) {
    updateToggleUI(elements.powerAutomateEnabledToggle, isEnabled);
    setElementEnabled(elements.powerAutomateSettingsContainer, isEnabled);
    setElementEnabled(elements.powerAutomateDebugContainer, isEnabled);
}

function updatePowerAutomateDebugUI(isEnabled) {
    updateToggleUI(elements.powerAutomateDebugToggle, isEnabled);
}

// ============================================
// Toggle Export Functions
// ============================================

export function toggleEmbedHelperModal() {
    updateEmbedHelperModalUI(!isToggleEnabled(elements.embedHelperToggleModal));
}

export function toggleCanvasCacheModal() {
    updateCanvasCacheModalUI(!isToggleEnabled(elements.canvasCacheToggleModal));
}

export function toggleNonApiCourseFetch() {
    updateNonApiCourseFetchUI(!isToggleEnabled(elements.nonApiCourseFetchToggle));
}

export function toggleNextAssignment() {
    updateNextAssignmentUI(!isToggleEnabled(elements.nextAssignmentToggle));
}

export function togglePowerAutomateEnabled() {
    updatePowerAutomateEnabledUI(!isToggleEnabled(elements.powerAutomateEnabledToggle));
}

export function togglePowerAutomateDebug() {
    updatePowerAutomateDebugUI(!isToggleEnabled(elements.powerAutomateDebugToggle));
}

export function toggleDebugModeModal() {
    updateDebugModeModalUI(!isToggleEnabled(elements.debugModeToggleModal));
}

export function toggleAutoSwitchCallTabModal() {
    updateAutoSwitchCallTabUI(!isToggleEnabled(elements.autoSwitchCallTabToggle));
}

export function toggleSyncActiveStudentModal() {
    updateSyncActiveStudentModalUI(!isToggleEnabled(elements.syncActiveStudentToggleModal));
}

export function toggleSendMasterListModal() {
    updateSendMasterListModalUI(!isToggleEnabled(elements.sendMasterListToggleModal));
}

export function toggleReformatNameModal() {
    updateReformatNameModalUI(!isToggleEnabled(elements.reformatNameToggleModal));
}

export function toggleHighlightStudentRowModal() {
    updateHighlightStudentRowModalUI(!isToggleEnabled(elements.highlightStudentRowToggleModal));
}

// ============================================
// Status Update Functions
// ============================================

export function updatePowerAutomateStatus(url, enabled = null) {
    if (!elements.powerAutomateStatusText) return;

    if (url && url.trim()) {
        if (enabled === false) {
            elements.powerAutomateStatusText.textContent = 'Disabled';
            elements.powerAutomateStatusText.style.color = 'var(--text-secondary)';
            if (elements.powerAutomateStatusDot) {
                elements.powerAutomateStatusDot.style.backgroundColor = '#9ca3af';
                elements.powerAutomateStatusDot.title = 'Disabled';
            }
        } else {
            elements.powerAutomateStatusText.textContent = 'Connected';
            elements.powerAutomateStatusText.style.color = 'green';
            if (elements.powerAutomateStatusDot) {
                elements.powerAutomateStatusDot.style.backgroundColor = '#10b981';
                elements.powerAutomateStatusDot.title = 'Connected';
            }
        }
    } else {
        elements.powerAutomateStatusText.textContent = 'Not configured';
        elements.powerAutomateStatusText.style.color = 'var(--text-secondary)';
        if (elements.powerAutomateStatusDot) {
            elements.powerAutomateStatusDot.style.backgroundColor = '#9ca3af';
            elements.powerAutomateStatusDot.title = 'Not configured';
        }
    }
}

export async function updateCanvasStatus() {
    if (!elements.canvasStatusText) return;

    try {
        const response = await fetch(`${CANVAS_DOMAIN}/api/v1/users/self`, {
            headers: { 'Accept': 'application/json' },
            credentials: 'include'
        });

        if (response.ok) {
            elements.canvasStatusText.textContent = 'Connected';
            elements.canvasStatusText.style.color = 'green';
            if (elements.canvasStatusDot) {
                elements.canvasStatusDot.style.backgroundColor = '#10b981';
                elements.canvasStatusDot.title = 'Connected';
            }
            await updateStartButtonForMasterList();
        } else {
            elements.canvasStatusText.textContent = 'No user logged in';
            elements.canvasStatusText.style.color = 'var(--text-secondary)';
            if (elements.canvasStatusDot) {
                elements.canvasStatusDot.style.backgroundColor = '#9ca3af';
                elements.canvasStatusDot.title = 'No user logged in';
            }
            if (elements.startBtn) {
                elements.startBtn.disabled = true;
                elements.startBtn.style.opacity = '0.5';
                elements.startBtn.style.cursor = 'not-allowed';
            }
            if (elements.statusText) {
                elements.statusText.textContent = 'Please log into Canvas';
                elements.statusText.style.textDecoration = 'underline';
                elements.statusText.style.color = 'var(--primary-color)';
                elements.statusText.onclick = () => {
                    chrome.tabs.create({ url: CANVAS_DOMAIN });
                };
            }
        }
    } catch (error) {
        console.error('Error checking Canvas status:', error);
        elements.canvasStatusText.textContent = 'No user logged in';
        elements.canvasStatusText.style.color = 'var(--text-secondary)';
        if (elements.canvasStatusDot) {
            elements.canvasStatusDot.style.backgroundColor = '#9ca3af';
            elements.canvasStatusDot.title = 'No user logged in';
        }
        if (elements.startBtn) {
            elements.startBtn.disabled = true;
            elements.startBtn.style.opacity = '0.5';
            elements.startBtn.style.cursor = 'not-allowed';
        }
        if (elements.statusText) {
            elements.statusText.textContent = 'Please log into Canvas';
            elements.statusText.style.textDecoration = 'underline';
            elements.statusText.style.color = 'var(--primary-color)';
            elements.statusText.onclick = () => {
                chrome.tabs.create({ url: CANVAS_DOMAIN });
            };
        }
    }
}

export async function updateStartButtonForMasterList() {
    const data = await storageGet([STORAGE_KEYS.MASTER_ENTRIES]);
    const masterEntries = data[STORAGE_KEYS.MASTER_ENTRIES] || [];

    if (masterEntries.length === 0) {
        if (elements.startBtn) {
            elements.startBtn.disabled = true;
            elements.startBtn.style.opacity = '0.5';
            elements.startBtn.style.cursor = 'not-allowed';
        }
        if (elements.statusText) {
            const currentState = await sessionGetValue(STORAGE_KEYS.EXTENSION_STATE, EXTENSION_STATES.OFF);
            const isCurrentlyScanning = currentState === EXTENSION_STATES.ON;
            if (!isCurrentlyScanning) {
                elements.statusText.textContent = 'No students in Master List';
                elements.statusText.style.textDecoration = 'none';
                elements.statusText.style.color = 'var(--text-secondary)';
                elements.statusText.onclick = null;
            }
        }
        return;
    }

    const studentsWithGradebook = masterEntries.filter(entry =>
        (entry.url && entry.url.trim() !== '') ||
        (entry.Gradebook && entry.Gradebook.trim() !== '')
    );

    if (studentsWithGradebook.length === 0) {
        if (elements.startBtn) {
            elements.startBtn.disabled = true;
            elements.startBtn.style.opacity = '0.5';
            elements.startBtn.style.cursor = 'not-allowed';
        }
        if (elements.statusText) {
            const currentState = await sessionGetValue(STORAGE_KEYS.EXTENSION_STATE, EXTENSION_STATES.OFF);
            const isCurrentlyScanning = currentState === EXTENSION_STATES.ON;
            if (!isCurrentlyScanning) {
                elements.statusText.textContent = 'No gradebook links found';
                elements.statusText.style.textDecoration = 'none';
                elements.statusText.style.color = 'var(--text-secondary)';
                elements.statusText.onclick = null;
            }
        }
        return;
    }

    if (elements.startBtn) {
        elements.startBtn.disabled = false;
        elements.startBtn.style.opacity = '1';
        elements.startBtn.style.cursor = 'pointer';
    }
    if (elements.statusText) {
        const currentState = await sessionGetValue(STORAGE_KEYS.EXTENSION_STATE, EXTENSION_STATES.OFF);
        const isCurrentlyScanning = currentState === EXTENSION_STATES.ON;
        elements.statusText.style.textDecoration = 'none';
        elements.statusText.style.color = '';
        if (!isCurrentlyScanning) {
            elements.statusText.textContent = 'Ready to Scan';
        }
        elements.statusText.onclick = () => {
            if (elements.miniConsole) {
                if (elements.miniConsole.style.display === 'none') {
                    elements.miniConsole.style.display = 'flex';
                } else {
                    elements.miniConsole.style.display = 'none';
                }
            }
        };
    }
}

export async function updateFive9Status() {
    if (!elements.five9StatusText) return;

    try {
        const callDemoEnabled = await storageGetValue(STORAGE_KEYS.CALL_DEMO, false);

        if (callDemoEnabled) {
            elements.five9StatusText.textContent = 'Demo Mode';
            elements.five9StatusText.style.color = '#8b5cf6';
            if (elements.five9StatusDot) {
                elements.five9StatusDot.style.backgroundColor = '#8b5cf6';
                elements.five9StatusDot.title = 'Call Demo mode is active - Five9 connection not required';
            }
            return;
        }

        const five9Tabs = await chrome.tabs.query({ url: "https://app-atl.five9.com/*" });

        if (five9Tabs.length === 0) {
            elements.five9StatusText.textContent = 'Not connected';
            elements.five9StatusText.style.color = 'var(--text-secondary)';
            if (elements.five9StatusDot) {
                elements.five9StatusDot.style.backgroundColor = '#9ca3af';
                elements.five9StatusDot.title = 'No Five9 tab detected';
            }
            return;
        }

        const response = await chrome.runtime.sendMessage({
            type: 'GET_FIVE9_CONNECTION_STATE'
        });

        const connectionState = response ? response.state : FIVE9_CONNECTION_STATES.AWAITING_CONNECTION;

        if (connectionState === FIVE9_CONNECTION_STATES.ACTIVE_CONNECTION) {
            elements.five9StatusText.textContent = 'Active Connection';
            elements.five9StatusText.style.color = 'green';
            if (elements.five9StatusDot) {
                elements.five9StatusDot.style.backgroundColor = '#10b981';
                elements.five9StatusDot.title = 'Agent connected and ready';
            }
        } else {
            elements.five9StatusText.textContent = 'Awaiting Agent';
            elements.five9StatusText.style.color = '#f59e0b';
            if (elements.five9StatusDot) {
                elements.five9StatusDot.style.backgroundColor = '#f59e0b';
                elements.five9StatusDot.title = 'Tab open, waiting for agent connection';
            }
        }
    } catch (error) {
        console.error('Error checking Five9 status:', error);
        elements.five9StatusText.textContent = 'Not connected';
        elements.five9StatusText.style.color = 'var(--text-secondary)';
        if (elements.five9StatusDot) {
            elements.five9StatusDot.style.backgroundColor = '#9ca3af';
            elements.five9StatusDot.title = 'Error checking status';
        }
    }
}

// ============================================
// Cache Functions
// ============================================

async function loadCacheStatsForModal() {
    if (!elements.cacheStatsTextModal) return;

    try {
        const { getCacheStats } = await import('../../utils/canvasCache.js');
        const stats = await getCacheStats();
        elements.cacheStatsTextModal.textContent =
            `Total: ${stats.totalEntries} | Valid: ${stats.validEntries} | Expired: ${stats.expiredEntries}`;
    } catch (error) {
        console.error('Error loading cache stats:', error);
        elements.cacheStatsTextModal.textContent = 'Error loading stats';
    }
}

export async function clearCacheFromModal() {
    try {
        if (!confirm('Clear all Canvas API cached data? Next update will require fresh API calls.')) {
            return;
        }

        const { clearAllCache } = await import('../../utils/canvasCache.js');
        await clearAllCache();
        await loadCacheStatsForModal();

        alert('✓ Canvas API cache cleared successfully!');
        console.log('Canvas API cache cleared from modal');
    } catch (error) {
        console.error('Error clearing cache from modal:', error);
        alert('Error clearing cache. Check console for details.');
    }
}
