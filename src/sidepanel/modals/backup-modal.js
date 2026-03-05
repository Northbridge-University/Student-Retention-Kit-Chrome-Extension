// Backup Modal - Manages master list backups with view/revert functionality
import { STORAGE_KEYS } from '../../constants/index.js';
import { elements } from '../ui-manager.js';

const BACKUP_STORAGE_KEY = 'masterListBackups';
const MAX_BACKUPS = 4;

/**
 * Creates a backup of the current master list.
 * Called automatically after Update Master List completes.
 * Keeps up to MAX_BACKUPS entries, removing the oldest when full.
 * @param {Array} students - The master list array
 * @param {string} lastUpdated - The formatted timestamp string from the update
 * @param {number} [fileCount=1] - Number of files used to create the master list
 * @param {number} [totalDuration=0] - Total completion time in seconds
 */
export async function createMasterListBackup(students, lastUpdated, fileCount = 1, totalDuration = 0) {
    if (!students || students.length === 0) return;

    try {
        const data = await chrome.storage.local.get([BACKUP_STORAGE_KEY]);
        const backups = data[BACKUP_STORAGE_KEY] || [];

        // Calculate approximate size of the backup data in bytes
        const serialized = JSON.stringify(students);
        const sizeBytes = new Blob([serialized]).size;

        const backup = {
            id: Date.now(),
            timestamp: lastUpdated,
            createdAt: new Date().toISOString(),
            studentCount: students.length,
            sizeBytes: sizeBytes,
            fileCount: fileCount,
            totalDuration: totalDuration,
            data: students
        };

        // Add new backup to the front
        backups.unshift(backup);

        // Keep only the most recent MAX_BACKUPS
        if (backups.length > MAX_BACKUPS) {
            backups.length = MAX_BACKUPS;
        }

        await chrome.storage.local.set({ [BACKUP_STORAGE_KEY]: backups });
        console.log(`[Backup] Created backup: ${students.length} students, ${formatSize(sizeBytes)}`);
    } catch (error) {
        console.error('[Backup] Failed to create backup:', error);
    }
}

/**
 * Loads all backups from storage (metadata only, no data array).
 * @returns {Promise<Array>} Array of backup metadata objects
 */
async function loadBackups() {
    const data = await chrome.storage.local.get([BACKUP_STORAGE_KEY]);
    return data[BACKUP_STORAGE_KEY] || [];
}

/**
 * Formats byte size into a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Formats a duration in seconds to a human-readable string.
 * @param {number} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
    if (!seconds) return '';
    if (seconds >= 60) return `${(seconds / 60).toFixed(1)}m`;
    return `${seconds.toFixed(1)}s`;
}

/**
 * Formats the backup timestamp for display.
 * @param {string} timestamp - The lastUpdated string
 * @param {string} createdAt - ISO string of when the backup was created
 * @returns {string}
 */
function formatBackupTime(timestamp, createdAt) {
    if (timestamp) return timestamp;
    if (createdAt) {
        return new Date(createdAt).toLocaleString('en-US', {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    return 'Unknown';
}

/**
 * Opens the backup modal and renders the list of backups.
 */
export async function openBackupModal() {
    if (!elements.backupModal) return;

    await renderBackupList();
    elements.backupModal.style.display = 'flex';
}

/**
 * Closes the backup modal.
 */
export function closeBackupModal() {
    if (!elements.backupModal) return;
    elements.backupModal.style.display = 'none';

    // Also hide confirmation view if open
    hideConfirmation();
}

/**
 * Renders the backup list inside the modal.
 */
async function renderBackupList() {
    const list = elements.backupList;
    if (!list) return;

    const backups = await loadBackups();

    if (backups.length === 0) {
        list.innerHTML = `
            <div style="text-align:center; padding:30px 15px; color:#9ca3af;">
                <i class="fas fa-box-open" style="font-size:2em; margin-bottom:10px; opacity:0.5;"></i>
                <div style="font-size:0.95em; font-weight:500;">No Backups Available</div>
                <div style="font-size:0.8em; margin-top:4px;">Backups are created automatically<br>after each Update Master List.</div>
            </div>
        `;
        return;
    }

    list.innerHTML = '';

    backups.forEach((backup, index) => {
        const card = document.createElement('div');
        card.className = 'setting-card';
        card.style.cssText = 'margin-bottom:10px; border-left:4px solid var(--primary-color); position:relative;';

        const timeDisplay = formatBackupTime(backup.timestamp, backup.createdAt);
        const isLatest = index === 0;
        const multiFile = backup.fileCount > 1;

        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; width:100%;">
                <div style="flex-grow:1; min-width:0;">
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                        <i class="fas fa-clock" style="color:var(--primary-color); font-size:0.85em;"></i>
                        <span style="font-weight:600; font-size:0.9em; color:var(--text-main);">${timeDisplay}</span>
                        ${isLatest ? '<span style="font-size:0.7em; background:#10b981; color:white; padding:1px 6px; border-radius:8px; font-weight:600;">Latest</span>' : ''}
                        ${multiFile ? `<span title="Created from ${backup.fileCount} files" style="font-size:0.7em; background:#6366f1; color:white; padding:1px 6px; border-radius:8px; font-weight:600;"><i class="fas fa-copy" style="margin-right:2px;"></i>${backup.fileCount} Files</span>` : ''}
                    </div>
                    <div style="display:flex; gap:12px; font-size:0.8em; color:var(--text-secondary); margin-top:2px;">
                        <span><i class="fas fa-users" style="margin-right:3px;"></i>${backup.studentCount} students</span>
                        <span><i class="fas fa-database" style="margin-right:3px;"></i>${formatSize(backup.sizeBytes)}</span>
                        ${backup.totalDuration ? `<span><i class="fas fa-stopwatch" style="margin-right:3px;"></i>${formatDuration(backup.totalDuration)}</span>` : ''}
                    </div>
                </div>
                <button class="backup-revert-btn btn-secondary" data-backup-index="${index}" style="padding:5px 12px; font-size:0.8em; white-space:nowrap; flex-shrink:0; margin-left:8px;">
                    <i class="fas fa-undo"></i> Revert
                </button>
            </div>
        `;

        // Attach revert click handler
        const revertBtn = card.querySelector('.backup-revert-btn');
        revertBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showConfirmation(backup, index);
        });

        list.appendChild(card);
    });
}

/**
 * Shows the revert confirmation view inside the modal.
 * @param {Object} backup - The backup metadata
 * @param {number} index - The backup index
 */
function showConfirmation(backup, index) {
    const mainView = elements.backupMainView;
    const confirmView = elements.backupConfirmView;
    if (!mainView || !confirmView) return;

    const timeDisplay = formatBackupTime(backup.timestamp, backup.createdAt);
    const multiFile = backup.fileCount > 1;

    // Populate confirmation details
    const detailEl = elements.backupConfirmDetail;
    if (detailEl) {
        detailEl.innerHTML = `
            <div class="setting-card" style="border-left:4px solid #f59e0b; margin-bottom:0;">
                <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
                    <i class="fas fa-clock" style="color:var(--primary-color); font-size:0.85em;"></i>
                    <span style="font-weight:600; font-size:0.9em;">${timeDisplay}</span>
                    ${multiFile ? `<span style="font-size:0.7em; background:#6366f1; color:white; padding:1px 6px; border-radius:8px; font-weight:600;"><i class="fas fa-copy" style="margin-right:2px;"></i>${backup.fileCount} Files</span>` : ''}
                </div>
                <div style="display:flex; gap:12px; font-size:0.8em; color:var(--text-secondary);">
                    <span><i class="fas fa-users" style="margin-right:3px;"></i>${backup.studentCount} students</span>
                    <span><i class="fas fa-database" style="margin-right:3px;"></i>${formatSize(backup.sizeBytes)}</span>
                    ${backup.totalDuration ? `<span><i class="fas fa-stopwatch" style="margin-right:3px;"></i>${formatDuration(backup.totalDuration)}</span>` : ''}
                </div>
            </div>
        `;
    }

    // Store selected index for the confirm action
    confirmView.dataset.backupIndex = index;

    mainView.style.display = 'none';
    confirmView.style.display = 'block';
}

/**
 * Hides the confirmation view and shows the main backup list.
 */
function hideConfirmation() {
    const mainView = elements.backupMainView;
    const confirmView = elements.backupConfirmView;
    if (mainView) mainView.style.display = 'block';
    if (confirmView) confirmView.style.display = 'none';
}

/**
 * Reverts the master list to the selected backup.
 * @param {number} index - The backup index
 */
async function revertToBackup(index) {
    try {
        const backups = await loadBackups();
        const backup = backups[index];

        if (!backup || !backup.data) {
            console.error('[Backup] Invalid backup at index', index);
            return;
        }

        const lastUpdated = formatBackupTime(backup.timestamp, backup.createdAt);

        // Restore master list data
        await chrome.storage.local.set({
            [STORAGE_KEYS.MASTER_ENTRIES]: backup.data,
            [STORAGE_KEYS.LAST_UPDATED]: lastUpdated
        });

        console.log(`[Backup] Reverted to backup: ${backup.studentCount} students from ${lastUpdated}`);

        // Close the modal
        closeBackupModal();
    } catch (error) {
        console.error('[Backup] Failed to revert:', error);
    }
}

/**
 * Initializes the backup modal event listeners.
 * Called once during setupEventListeners.
 */
export function initBackupModal() {
    // Close button
    if (elements.closeBackupModalBtn) {
        elements.closeBackupModalBtn.addEventListener('click', closeBackupModal);
    }

    // Confirmation cancel button
    if (elements.backupConfirmCancelBtn) {
        elements.backupConfirmCancelBtn.addEventListener('click', hideConfirmation);
    }

    // Confirmation revert button
    if (elements.backupConfirmRevertBtn) {
        elements.backupConfirmRevertBtn.addEventListener('click', async () => {
            const confirmView = elements.backupConfirmView;
            if (!confirmView) return;

            const index = parseInt(confirmView.dataset.backupIndex);
            if (isNaN(index)) return;

            await revertToBackup(index);
        });
    }
}
