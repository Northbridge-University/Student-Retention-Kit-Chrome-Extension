// Import Status Modal - Shows real-time progress when importing master list to Excel
import { elements } from '../ui-manager.js';
import { MESSAGE_TYPES } from '../../constants/index.js';

// --- Step definitions in order ---
const IMPORT_STEPS = [
    'send',
    'received',
    'reading_data',
    'preserving_data',
    'writing_data',
    'formatting',
    'highlighting',
    'missing_assignments',
    'autofitting'
];

// --- Module state ---
let _lastPayload = null;
let _lastTargetTabId = null;
let _timeoutTimer = null;
let _currentStatus = null;
let _retryReconnectTimer = null;
let _sendMasterListFn = null;

/**
 * Registers the sendMasterList function reference for retry capability.
 * Called once during sidepanel initialization so we can re-invoke on retry.
 * @param {Function} fn - The sendMasterListToExcel or sendMasterListWithMissingAssignmentsToExcel function
 */
export function registerSendFunction(fn) {
    _sendMasterListFn = fn;
}

/**
 * Opens the import status modal in the initial "sending" state.
 * @param {Object} payload - The import payload (stored for retry)
 * @param {number|null} targetTabId - The target Excel tab ID (stored for retry)
 */
export function openImportStatusModal(payload, targetTabId = null) {
    _lastPayload = payload;
    _lastTargetTabId = targetTabId;
    _currentStatus = 'sending';

    // Set session flag so content script blocks any incoming master list data
    // while the modal is open (prevents overwrite from refreshed Excel tab)
    try {
        chrome.storage.session.set({ importStatusModalOpen: true });
    } catch (e) {
        console.warn('Failed to set importStatusModalOpen flag:', e);
    }

    if (!elements.importStatusModal) return;

    // Reset UI
    setStatusIcon('spinner', '#217346');
    setStatusText('Sending payload to Excel', 'Delivering data to Office Add-in...');
    elements.importStatusRetryContainer.style.display = 'none';

    // Reset all steps
    resetSteps();
    setStepState('send', 'active');

    // Show modal
    elements.importStatusModal.style.display = 'flex';

    // Start timeout - if no "received" within 15s, show error
    clearTimeoutTimer();
    _timeoutTimer = setTimeout(() => {
        if (_currentStatus === 'sending' || _currentStatus === 'waiting') {
            updateImportStatus({
                status: 'error',
                message: 'Excel did not respond',
                error: 'The Excel tab may have timed out or the add-in is not loaded. Try refreshing the Excel tab.'
            });
        }
    }, 15000);

    // Transition to "waiting" after a short delay to show the send step completing
    setTimeout(() => {
        if (_currentStatus === 'sending') {
            _currentStatus = 'waiting';
            setStepState('send', 'completed');
            setStatusText('Waiting for response', 'Waiting for Excel to acknowledge...');
        }
    }, 800);
}

/**
 * Updates the import status modal with a status update from the Office Add-in.
 * @param {Object} statusData - Status update data
 * @param {string} statusData.status - Status key
 * @param {string} statusData.message - Human-readable message
 * @param {number} [statusData.progress] - Optional progress percentage
 * @param {string} [statusData.error] - Error message (for error status)
 */
export function updateImportStatus(statusData) {
    if (!elements.importStatusModal || elements.importStatusModal.style.display === 'none') return;

    const { status, message, progress, error } = statusData;
    _currentStatus = status;

    // Clear timeout on any response from add-in
    if (status !== 'error') {
        clearTimeoutTimer();
    }

    switch (status) {
        case 'awaiting_confirmation':
            // Master List sheet is missing — the add-in has opened a confirmation
            // dialog in Excel and is waiting for the user. Show a paused/waiting
            // state instead of letting the previous step look stuck or complete.
            setStatusIcon('hourglass-half', '#d29922');
            setStatusText(
                'Waiting for confirmation',
                message || 'Confirm in the Excel dialog to create a Master List sheet.'
            );
            // Mark the current active step as paused (visually distinct from error/completed)
            const waitingActiveStep = elements.importStatusSteps?.querySelector('.import-step.active');
            if (waitingActiveStep) {
                waitingActiveStep.classList.remove('active');
                waitingActiveStep.classList.add('pending');
                const icon = waitingActiveStep.querySelector('.import-step-icon');
                if (icon) {
                    icon.className = 'fas fa-hourglass-half import-step-icon';
                    icon.style.fontSize = '0.75em';
                }
            }
            break;

        case 'cancelled':
            setStatusIcon('ban', '#6c757d');
            setStatusText('Import cancelled', message || 'No Master List sheet was created.');
            // Mark the current active step as skipped
            const cancelledActiveStep = elements.importStatusSteps?.querySelector('.import-step.active');
            if (cancelledActiveStep) {
                cancelledActiveStep.classList.remove('active');
                cancelledActiveStep.classList.add('skipped');
                const icon = cancelledActiveStep.querySelector('.import-step-icon');
                if (icon) {
                    icon.className = 'fas fa-minus-circle import-step-icon';
                    icon.style.fontSize = '0.7em';
                }
            }
            break;

        case 'received':
            setStatusIcon('spinner', '#217346');
            setStatusText('Excel received payload', message || 'Validating data...');
            markStepsCompletedUpTo('received');
            setStepState('received', 'active');
            break;

        case 'reading_data':
            setStatusIcon('spinner', '#217346');
            setStatusText('Reading existing data', message || 'Reading current spreadsheet data...');
            markStepsCompletedUpTo('reading_data');
            setStepState('reading_data', 'active');
            break;

        case 'preserving_data':
            setStatusIcon('spinner', '#217346');
            setStatusText('Preserving data', message || 'Saving assigned values and colors...');
            markStepsCompletedUpTo('preserving_data');
            setStepState('preserving_data', 'active');
            break;

        case 'writing_data':
            setStatusIcon('spinner', '#217346');
            const writeMsg = progress != null
                ? `Writing student data (${progress}%)`
                : 'Writing student data';
            setStatusText(writeMsg, message || 'Writing data to spreadsheet...');
            markStepsCompletedUpTo('writing_data');
            setStepState('writing_data', 'active');
            break;

        case 'formatting':
            setStatusIcon('spinner', '#217346');
            setStatusText('Applying formatting', message || 'Setting up conditional formatting...');
            markStepsCompletedUpTo('formatting');
            setStepState('formatting', 'active');
            break;

        case 'highlighting':
            setStatusIcon('spinner', '#217346');
            setStatusText('Highlighting students', message || 'Marking new students...');
            markStepsCompletedUpTo('highlighting');
            setStepState('highlighting', 'active');
            break;

        case 'missing_assignments':
            setStatusIcon('spinner', '#217346');
            setStatusText('Importing assignments', message || 'Writing missing assignments data...');
            markStepsCompletedUpTo('missing_assignments');
            setStepState('missing_assignments', 'active');
            break;

        case 'autofitting':
            setStatusIcon('spinner', '#217346');
            setStatusText('Finalizing', message || 'Auto-fitting columns...');
            markStepsCompletedUpTo('autofitting');
            setStepState('autofitting', 'active');
            break;

        case 'complete':
            setStatusIcon('check-circle', '#28a745');
            setStatusText('Import complete!', message || 'Master list imported successfully');
            markStepsCompletedUpTo('autofitting');
            // Mark all steps completed
            IMPORT_STEPS.forEach(step => setStepState(step, 'completed'));
            break;

        case 'error':
            setStatusIcon('times-circle', '#dc3545');
            setStatusText('Import failed', error || message || 'An error occurred during import');
            elements.importStatusRetryContainer.style.display = '';
            // Mark current active step as error
            const activeStep = elements.importStatusSteps?.querySelector('.import-step.active');
            if (activeStep) {
                activeStep.classList.remove('active');
                activeStep.classList.add('error');
                const icon = activeStep.querySelector('.import-step-icon');
                if (icon) {
                    icon.className = 'fas fa-times-circle import-step-icon';
                    icon.style.fontSize = '0.85em';
                }
            }
            break;
    }
}

/**
 * Closes the import status modal and cleans up state.
 */
export function closeImportStatusModal() {
    if (elements.importStatusModal) {
        elements.importStatusModal.style.display = 'none';
    }
    clearTimeoutTimer();
    clearRetryTimer();
    _currentStatus = null;

    // Clear session flag so content script resumes accepting master list data
    try {
        chrome.storage.session.remove('importStatusModalOpen');
    } catch (e) {
        console.warn('Failed to clear importStatusModalOpen flag:', e);
    }
}

/**
 * Handles the retry flow:
 * 1. Refreshes the Excel tab
 * 2. Waits for the add-in to reconnect (listens for SRK_OFFICE_ADDIN_CONNECTED or SRK_PONG)
 * 3. Re-sends the payload
 */
export async function retryImport() {
    if (!_lastPayload) {
        closeImportStatusModal();
        return;
    }

    // Reset modal to retry state
    setStatusIcon('spinner', '#217346');
    setStatusText('Refreshing Excel tab...', 'Reloading the Excel page and waiting for reconnection...');
    elements.importStatusRetryContainer.style.display = 'none';
    resetSteps();

    // Find and refresh the Excel tab
    try {
        const tabs = await chrome.tabs.query({
            url: [
                "https://excel.office.com/*",
                "https://*.officeapps.live.com/*",
                "https://*.sharepoint.com/*"
            ]
        });

        if (tabs.length === 0) {
            updateImportStatus({
                status: 'error',
                message: 'No Excel tab found',
                error: 'No Excel tab is open. Please open your Excel workbook and try again.'
            });
            return;
        }

        // Refresh the target tab (or first Excel tab)
        const tabToRefresh = _lastTargetTabId
            ? tabs.find(t => t.id === _lastTargetTabId) || tabs[0]
            : tabs[0];

        _lastTargetTabId = tabToRefresh.id;
        await chrome.tabs.reload(tabToRefresh.id);

        setStatusText('Waiting for Excel to load...', 'The add-in will automatically reconnect...');

        // Wait for reconnection signal, then re-send
        _waitingForReconnect = true;
        clearRetryTimer();
        _retryReconnectTimer = setTimeout(() => {
            _waitingForReconnect = false;
            updateImportStatus({
                status: 'error',
                message: 'Could not reconnect',
                error: 'Excel did not reconnect within 30 seconds. Please ensure the add-in is loaded and try again.'
            });
        }, 30000);

    } catch (err) {
        console.error('Import retry error:', err);
        updateImportStatus({
            status: 'error',
            message: 'Retry failed',
            error: 'Failed to refresh Excel tab: ' + (err.message || err)
        });
    }
}

// Flag to track if we're waiting for reconnection during retry
let _waitingForReconnect = false;

/**
 * Called when the Office Add-in reconnects (SRK_OFFICE_ADDIN_CONNECTED or SRK_PONG).
 * If we're in retry mode, this triggers re-sending the payload.
 */
export function onAddinReconnected() {
    if (!_waitingForReconnect || !_lastPayload) return;

    _waitingForReconnect = false;
    clearRetryTimer();

    // Re-send the payload
    setStatusText('Reconnected!', 'Re-sending payload to Excel...');

    setTimeout(() => {
        // Re-open the modal in sending state and re-send
        resetSteps();
        setStepState('send', 'active');
        _currentStatus = 'sending';
        setStatusText('Sending payload to Excel', 'Delivering data to Office Add-in...');

        // Start timeout again
        clearTimeoutTimer();
        _timeoutTimer = setTimeout(() => {
            if (_currentStatus === 'sending' || _currentStatus === 'waiting') {
                updateImportStatus({
                    status: 'error',
                    message: 'Excel did not respond after retry',
                    error: 'The add-in reconnected but did not acknowledge the import. Please try again.'
                });
            }
        }, 15000);

        // Re-send via chrome.runtime.sendMessage
        chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.SRK_SEND_IMPORT_MASTER_LIST,
            payload: _lastPayload,
            targetTabId: _lastTargetTabId
        }).catch(() => {
            console.log('Background script might not be ready for retry');
        });

        // Transition to waiting
        setTimeout(() => {
            if (_currentStatus === 'sending') {
                _currentStatus = 'waiting';
                setStepState('send', 'completed');
                setStatusText('Waiting for response', 'Waiting for Excel to acknowledge...');
            }
        }, 800);
    }, 500);
}

/**
 * Initializes event listeners for the modal (close button, retry button).
 * Call once during sidepanel setup.
 */
export function initImportStatusModal() {
    if (elements.importStatusCloseBtn) {
        elements.importStatusCloseBtn.addEventListener('click', closeImportStatusModal);
    }
    if (elements.importStatusRetryBtn) {
        elements.importStatusRetryBtn.addEventListener('click', retryImport);
    }
}

// --- Internal helpers ---

function setStatusIcon(iconName, color) {
    if (!elements.importStatusIcon) return;
    if (iconName === 'spinner') {
        elements.importStatusIcon.className = 'fas fa-spinner fa-spin';
    } else {
        elements.importStatusIcon.className = `fas fa-${iconName}`;
    }
    elements.importStatusIcon.style.color = color;
}

function setStatusText(main, sub) {
    if (elements.importStatusText) elements.importStatusText.textContent = main;
    if (elements.importStatusSubtext) elements.importStatusSubtext.textContent = sub;
}

function resetSteps() {
    if (!elements.importStatusSteps) return;
    const steps = elements.importStatusSteps.querySelectorAll('.import-step');
    steps.forEach(step => {
        step.className = 'import-step pending';
        const icon = step.querySelector('.import-step-icon');
        if (icon) {
            icon.className = 'fas fa-circle import-step-icon';
            icon.style.fontSize = '0.5em';
        }
    });
}

function setStepState(stepName, state) {
    if (!elements.importStatusSteps) return;
    const step = elements.importStatusSteps.querySelector(`[data-step="${stepName}"]`);
    if (!step) return;

    step.className = `import-step ${state}`;
    const icon = step.querySelector('.import-step-icon');
    if (!icon) return;

    switch (state) {
        case 'completed':
            icon.className = 'fas fa-check-circle import-step-icon';
            icon.style.fontSize = '0.85em';
            break;
        case 'active':
            icon.className = 'fas fa-spinner fa-spin import-step-icon';
            icon.style.fontSize = '0.75em';
            break;
        case 'pending':
            icon.className = 'fas fa-circle import-step-icon';
            icon.style.fontSize = '0.5em';
            break;
        case 'error':
            icon.className = 'fas fa-times-circle import-step-icon';
            icon.style.fontSize = '0.85em';
            break;
        case 'skipped':
            icon.className = 'fas fa-minus-circle import-step-icon';
            icon.style.fontSize = '0.7em';
            break;
    }
}

function markStepsCompletedUpTo(stepName) {
    const idx = IMPORT_STEPS.indexOf(stepName);
    if (idx === -1) return;
    for (let i = 0; i < idx; i++) {
        setStepState(IMPORT_STEPS[i], 'completed');
    }
}

function clearTimeoutTimer() {
    if (_timeoutTimer) {
        clearTimeout(_timeoutTimer);
        _timeoutTimer = null;
    }
}

function clearRetryTimer() {
    if (_retryReconnectTimer) {
        clearTimeout(_retryReconnectTimer);
        _retryReconnectTimer = null;
    }
}
