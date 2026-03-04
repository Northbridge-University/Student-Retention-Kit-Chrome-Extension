// Attendance Report Modal - Asks if user wants to ping Canvas or just export attendance
import { elements } from '../ui-manager.js';

// Modal state
let attendanceReportResolve = null;

/**
 * Opens the Attendance Report modal and returns a promise that resolves with the user's choice.
 * @returns {Promise<boolean|null>} true = ping Canvas, false = attendance only, null = cancelled
 */
export function openAttendanceReportModal() {
    return new Promise((resolve) => {
        if (!elements.attendanceReportModal) {
            resolve(true); // Default to full flow if modal not available
            return;
        }

        attendanceReportResolve = resolve;
        elements.attendanceReportModal.style.display = 'flex';
    });
}

/**
 * Closes the Attendance Report modal
 * @param {boolean|null} choice - true for Canvas ping, false for attendance only, null if cancelled
 */
export function closeAttendanceReportModal(choice = null) {
    if (elements.attendanceReportModal) {
        elements.attendanceReportModal.style.display = 'none';
    }

    if (attendanceReportResolve) {
        attendanceReportResolve(choice);
        attendanceReportResolve = null;
    }
}
