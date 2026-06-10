// Daily Update Modal - Reminds users to update their master list daily
import { STORAGE_KEYS } from '../../constants/index.js';
import { storageGetValue, storageSet } from '../../utils/storage.js';
import { elements } from '../ui-manager.js';

/**
 * Gets the greeting matching the time of day
 * @param {number} hour - Hour of the day (0-23)
 * @returns {{text: string, icon: string, color: string}} Greeting text plus icon class and color
 */
export function getDailyUpdateGreeting(hour) {
    if (hour < 12) return { text: 'Good Morning!', icon: 'fa-sun', color: '#f59e0b' };
    if (hour < 17) return { text: 'Good Afternoon!', icon: 'fa-cloud-sun', color: '#f59e0b' };
    return { text: 'Good Evening!', icon: 'fa-moon', color: '#6366f1' };
}

/**
 * Checks if the daily update modal should be shown
 * Returns true if the modal should be shown, false otherwise
 */
export async function shouldShowDailyUpdateModal() {
    const lastUpdated = await storageGetValue(STORAGE_KEYS.LAST_UPDATED);

    // If there's no master list yet, don't show the modal
    if (!lastUpdated) {
        return false;
    }

    const now = new Date();
    const todayDateString = now.toLocaleDateString('en-US');

    // Don't show again today if the user clicked "Maybe Later"
    const snoozedDate = await storageGetValue(STORAGE_KEYS.DAILY_UPDATE_SNOOZED_DATE);
    if (snoozedDate === todayDateString) {
        return false;
    }

    // Check if master list was updated today
    const lastUpdatedDate = new Date(lastUpdated);
    const lastUpdatedDateString = lastUpdatedDate.toLocaleDateString('en-US');

    if (todayDateString === lastUpdatedDateString) {
        // Master list already updated today
        return false;
    }

    // Show modal if:
    // 1. Master list exists
    // 2. Master list hasn't been updated today
    // 3. The user hasn't snoozed the reminder today
    return true;
}

/**
 * Opens the daily update modal
 */
export function openDailyUpdateModal() {
    if (!elements.dailyUpdateModal) return;

    const greeting = getDailyUpdateGreeting(new Date().getHours());
    if (elements.dailyUpdateGreetingText) {
        elements.dailyUpdateGreetingText.textContent = greeting.text;
    }
    if (elements.dailyUpdateGreetingIcon) {
        elements.dailyUpdateGreetingIcon.className = `fas ${greeting.icon}`;
        elements.dailyUpdateGreetingIcon.style.color = greeting.color;
    }

    elements.dailyUpdateModal.style.display = 'flex';
}

/**
 * Closes the daily update modal
 */
export async function closeDailyUpdateModal() {
    if (!elements.dailyUpdateModal) return;
    elements.dailyUpdateModal.style.display = 'none';
}

/**
 * Snoozes the daily update modal for the rest of the day and closes it.
 * Called when the user clicks "Maybe Later".
 */
export async function snoozeDailyUpdateModal() {
    const todayDateString = new Date().toLocaleDateString('en-US');
    await storageSet({ [STORAGE_KEYS.DAILY_UPDATE_SNOOZED_DATE]: todayDateString });
    await closeDailyUpdateModal();
}
