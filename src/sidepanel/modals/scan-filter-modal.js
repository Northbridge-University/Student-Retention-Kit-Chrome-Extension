// Scan Filter Modal - Handles the scan filter configuration dialog
import { STORAGE_KEYS } from '../../constants/index.js';
import { storageGet, storageSet } from '../../utils/storage.js';
import { elements } from '../ui-manager.js';

/**
 * Opens the scan filter modal
 */
export async function openScanFilterModal() {
    if (!elements.scanFilterModal) return;

    // Load current settings
    const settings = await storageGet([
        STORAGE_KEYS.LOOPER_DAYS_OUT_FILTER,
        STORAGE_KEYS.SCAN_FILTER_INCLUDE_FAILING
    ]);

    const daysOutFilter = settings[STORAGE_KEYS.LOOPER_DAYS_OUT_FILTER] || '>=5';
    const includeFailing = settings[STORAGE_KEYS.SCAN_FILTER_INCLUDE_FAILING] || false;

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
 * Saves the scan filter settings
 */
export async function saveScanFilterSettings() {
    if (!elements.daysOutOperator || !elements.daysOutValue || !elements.failingToggle) return;

    const operator = elements.daysOutOperator.value;
    const value = elements.daysOutValue.value;
    const daysOutFilter = `${operator}${value}`;
    const includeFailing = elements.failingToggle.classList.contains('fa-toggle-on');

    await storageSet({
        [STORAGE_KEYS.LOOPER_DAYS_OUT_FILTER]: daysOutFilter,
        [STORAGE_KEYS.SCAN_FILTER_INCLUDE_FAILING]: includeFailing
    });

    closeScanFilterModal();
    console.log('Scan filter settings saved:', { daysOutFilter, includeFailing });
}
