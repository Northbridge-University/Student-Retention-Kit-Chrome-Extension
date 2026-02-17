// More Settings Modal - Handles additional settings accessed via right-click context menu
import { STORAGE_KEYS } from '../../constants/index.js';
import { storageGet, storageSet } from '../../utils/storage.js';
import { elements } from '../ui-manager.js';

/**
 * Opens the More Settings modal and loads current values
 */
export async function openMoreSettingsModal() {
    if (!elements.moreSettingsModal) return;

    elements.moreSettingsModal.style.display = 'flex';

    const result = await storageGet([
        STORAGE_KEYS.EXPORT_TAB_COLOR,
        STORAGE_KEYS.EXPORT_COLOR_SCALE_LOW,
        STORAGE_KEYS.EXPORT_COLOR_SCALE_MID,
        STORAGE_KEYS.EXPORT_COLOR_SCALE_HIGH
    ]);

    // Load export tab color
    if (elements.exportTabColorInput && elements.exportTabColorTextInput) {
        const tabColor = result[STORAGE_KEYS.EXPORT_TAB_COLOR] || '#FFC000';
        elements.exportTabColorInput.value = tabColor;
        elements.exportTabColorTextInput.value = tabColor;
    }

    // Load color scale
    if (elements.exportColorScaleLowInput) {
        elements.exportColorScaleLowInput.value = result[STORAGE_KEYS.EXPORT_COLOR_SCALE_LOW] || '#F8696B';
    }
    if (elements.exportColorScaleMidInput) {
        elements.exportColorScaleMidInput.value = result[STORAGE_KEYS.EXPORT_COLOR_SCALE_MID] || '#FFEB84';
    }
    if (elements.exportColorScaleHighInput) {
        elements.exportColorScaleHighInput.value = result[STORAGE_KEYS.EXPORT_COLOR_SCALE_HIGH] || '#63BE7B';
    }
}

/**
 * Closes the More Settings modal
 */
export function closeMoreSettingsModal() {
    if (elements.moreSettingsModal) {
        elements.moreSettingsModal.style.display = 'none';
    }
}

/**
 * Saves the More Settings and closes the modal
 */
export async function saveMoreSettings() {
    const settingsToSave = {};

    if (elements.exportTabColorTextInput) {
        settingsToSave[STORAGE_KEYS.EXPORT_TAB_COLOR] = elements.exportTabColorTextInput.value || '#FFC000';
    }
    if (elements.exportColorScaleLowInput) {
        settingsToSave[STORAGE_KEYS.EXPORT_COLOR_SCALE_LOW] = elements.exportColorScaleLowInput.value || '#F8696B';
    }
    if (elements.exportColorScaleMidInput) {
        settingsToSave[STORAGE_KEYS.EXPORT_COLOR_SCALE_MID] = elements.exportColorScaleMidInput.value || '#FFEB84';
    }
    if (elements.exportColorScaleHighInput) {
        settingsToSave[STORAGE_KEYS.EXPORT_COLOR_SCALE_HIGH] = elements.exportColorScaleHighInput.value || '#63BE7B';
    }

    await storageSet(settingsToSave);
    closeMoreSettingsModal();
}
