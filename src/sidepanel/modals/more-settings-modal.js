// More Settings Modal - Handles additional settings accessed via right-click context menu
import { STORAGE_KEYS } from '../../constants/index.js';
import { storageGet, storageSet } from '../../utils/storage.js';
import { updateToggleUI, isToggleEnabled } from '../../utils/ui-helpers.js';
import { elements } from '../ui-manager.js';

/**
 * Applies the Power Automate visibility preference to the Settings tab card.
 * Called on startup and whenever the user toggles the preference.
 */
export function applyPowerAutomateVisibility(visible) {
    if (!elements.powerAutomateSettingCard) return;
    elements.powerAutomateSettingCard.style.display = visible ? '' : 'none';
}

export function toggleShowPowerAutomate() {
    if (!elements.showPowerAutomateToggle) return;
    updateToggleUI(elements.showPowerAutomateToggle, !isToggleEnabled(elements.showPowerAutomateToggle));
}

/**
 * Applies the Redact Data preference by toggling the redact-mode class on the
 * body. CSS rules blur student names, phone numbers, and avatars while active.
 * Called on startup and whenever the user saves the preference.
 */
export function applyRedactData(enabled) {
    document.body.classList.toggle('redact-mode', !!enabled);
}

export function toggleRedactData() {
    if (!elements.redactDataToggle) return;
    updateToggleUI(elements.redactDataToggle, !isToggleEnabled(elements.redactDataToggle));
}

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
        STORAGE_KEYS.EXPORT_COLOR_SCALE_HIGH,
        STORAGE_KEYS.SHOW_POWER_AUTOMATE,
        STORAGE_KEYS.REDACT_DATA
    ]);

    updateToggleUI(elements.showPowerAutomateToggle, !!result[STORAGE_KEYS.SHOW_POWER_AUTOMATE]);
    updateToggleUI(elements.redactDataToggle, !!result[STORAGE_KEYS.REDACT_DATA]);

    // Load export tab color
    if (elements.exportTabColorInput && elements.exportTabColorTextInput) {
        const tabColor = result[STORAGE_KEYS.EXPORT_TAB_COLOR] || '#fcd5b4';
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
        settingsToSave[STORAGE_KEYS.EXPORT_TAB_COLOR] = elements.exportTabColorTextInput.value || '#fcd5b4';
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

    const showPowerAutomate = isToggleEnabled(elements.showPowerAutomateToggle);
    settingsToSave[STORAGE_KEYS.SHOW_POWER_AUTOMATE] = showPowerAutomate;

    const redactData = isToggleEnabled(elements.redactDataToggle);
    settingsToSave[STORAGE_KEYS.REDACT_DATA] = redactData;

    await storageSet(settingsToSave);
    applyPowerAutomateVisibility(showPowerAutomate);
    applyRedactData(redactData);
    closeMoreSettingsModal();
}
