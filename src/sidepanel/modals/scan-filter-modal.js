// Scan Filter Modal - Handles the scan filter configuration dialog
import { STORAGE_KEYS } from '../../constants/index.js';
import { storageGet, storageSet } from '../../utils/storage.js';
import { elements } from '../ui-manager.js';

/**
 * Shows or hides the filter controls based on the Manual Adjustments
 * toggle. In auto mode (manual off) the settings are managed by the Excel
 * add-in's LDA sync on Start, so the controls are hidden entirely and the
 * sync hint shown in their place.
 * @param {boolean} manual
 */
function applyScanFilterMode(manual) {
    if (elements.manualScanFilterToggle) {
        elements.manualScanFilterToggle.className = manual ? 'fas fa-toggle-on' : 'fas fa-toggle-off';
        elements.manualScanFilterToggle.style.color = manual ? 'var(--primary-color)' : 'gray';
    }
    if (elements.scanFilterControls) {
        elements.scanFilterControls.style.display = manual ? 'block' : 'none';
    }
    if (elements.scanFilterAutoHint) {
        elements.scanFilterAutoHint.style.display = manual ? 'none' : 'block';
    }
}

/**
 * Toggles the Manual Adjustments state (persisted on Save, like the other
 * controls in this modal).
 */
export function toggleManualScanFilter() {
    if (!elements.manualScanFilterToggle) return;
    const manual = !elements.manualScanFilterToggle.classList.contains('fa-toggle-on');
    applyScanFilterMode(manual);
}

/**
 * Opens the scan filter modal
 */
export async function openScanFilterModal() {
    if (!elements.scanFilterModal) return;

    // Load current settings
    const settings = await storageGet([
        STORAGE_KEYS.LOOPER_DAYS_OUT_FILTER,
        STORAGE_KEYS.SCAN_FILTER_INCLUDE_FAILING,
        STORAGE_KEYS.MANUAL_SCAN_FILTER
    ]);

    const daysOutFilter = settings[STORAGE_KEYS.LOOPER_DAYS_OUT_FILTER] || '>=5';
    const includeFailing = settings[STORAGE_KEYS.SCAN_FILTER_INCLUDE_FAILING] || false;

    applyScanFilterMode(!!settings[STORAGE_KEYS.MANUAL_SCAN_FILTER]);

    // Parse days out filter (e.g., ">=5" -> operator: ">=", value: "5")
    const match = daysOutFilter.match(/^\s*([><]=?|=)\s*(\d+)\s*$/);
    if (match && elements.daysOutOperator && elements.daysOutValue) {
        elements.daysOutOperator.value = match[1];
        elements.daysOutValue.value = match[2];
    }

    // Set failing toggle state
    if (elements.failingToggle) {
        if (includeFailing) {
            elements.failingToggle.className = 'fas fa-toggle-on';
            elements.failingToggle.style.color = 'var(--primary-color)';
        } else {
            elements.failingToggle.className = 'fas fa-toggle-off';
            elements.failingToggle.style.color = 'gray';
        }
    }

    // Calculate and display initial count
    await updateScanFilterCount();

    // Show modal
    elements.scanFilterModal.style.display = 'flex';
}

/**
 * Closes the scan filter modal
 */
export function closeScanFilterModal() {
    if (!elements.scanFilterModal) return;
    elements.scanFilterModal.style.display = 'none';
}

/**
 * Updates the student count based on current filter settings
 */
export async function updateScanFilterCount() {
    if (!elements.daysOutOperator || !elements.daysOutValue || !elements.failingToggle || !elements.studentCountValue) return;

    const operator = elements.daysOutOperator.value;
    const value = parseInt(elements.daysOutValue.value, 10);
    const includeFailing = elements.failingToggle.classList.contains('fa-toggle-on');

    const data = await storageGet([STORAGE_KEYS.MASTER_ENTRIES]);
    const masterEntries = data[STORAGE_KEYS.MASTER_ENTRIES] || [];

    let filteredCount = 0;

    masterEntries.forEach(entry => {
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
        if (includeFailing) {
            const rawGrade = entry.grade ?? entry.currentGrade ?? null;
            if (rawGrade != null) {
                const grade = parseFloat(rawGrade);
                if (!isNaN(grade) && grade < 60) {
                    isFailing = true;
                }
            }
        }

        if (meetsDaysOutCriteria || isFailing) {
            filteredCount++;
        }
    });

    elements.studentCountValue.textContent = filteredCount;
}

/**
 * Toggles the failing filter state
 */
export function toggleFailingFilter() {
    if (!elements.failingToggle) return;

    const isOn = elements.failingToggle.classList.contains('fa-toggle-on');
    if (isOn) {
        elements.failingToggle.className = 'fas fa-toggle-off';
        elements.failingToggle.style.color = 'gray';
    } else {
        elements.failingToggle.className = 'fas fa-toggle-on';
        elements.failingToggle.style.color = 'var(--primary-color)';
    }
}

/**
 * Saves the scan filter settings. In auto mode (Manual Adjustments off)
 * only the mode flag is saved — the filter values belong to the LDA sync
 * and the hidden controls may hold stale values.
 */
export async function saveScanFilterSettings() {
    if (!elements.daysOutOperator || !elements.daysOutValue || !elements.failingToggle) return;

    const manual = !!elements.manualScanFilterToggle
        && elements.manualScanFilterToggle.classList.contains('fa-toggle-on');

    const settingsToSave = { [STORAGE_KEYS.MANUAL_SCAN_FILTER]: manual };

    // In auto mode still persist a baseline on first save (no stored filter
    // yet) so the looper has a fallback when the LDA sync can't run.
    const stored = await storageGet([STORAGE_KEYS.LOOPER_DAYS_OUT_FILTER]);
    const hasStoredFilter = stored[STORAGE_KEYS.LOOPER_DAYS_OUT_FILTER] !== undefined;

    if (manual || !hasStoredFilter) {
        const operator = elements.daysOutOperator.value;
        const value = elements.daysOutValue.value;
        settingsToSave[STORAGE_KEYS.LOOPER_DAYS_OUT_FILTER] = `${operator}${value}`;
        settingsToSave[STORAGE_KEYS.SCAN_FILTER_INCLUDE_FAILING] = elements.failingToggle.classList.contains('fa-toggle-on');
    }

    await storageSet(settingsToSave);

    closeScanFilterModal();
    console.log('Scan filter settings saved:', settingsToSave);
}
