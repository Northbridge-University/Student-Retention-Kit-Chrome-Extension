// Latest Updates Modal - Shows release notes for new versions
import { STORAGE_KEYS } from '../../constants/index.js';
import { storageGetValue, storageSet } from '../../utils/storage.js';
import { hasReleaseNotes, getLatestReleaseNotes, getReleaseNotes, getAllVersionsWithNotes } from '../../constants/release-notes.js';
import { elements } from '../ui-manager.js';

// Version currently displayed in the main view; its notes are excluded from
// the Previous Updates history view
let currentDisplayedVersion = null;

/**
 * Checks if the latest updates modal should be shown
 * Returns true if:
 * 1. The current version has release notes defined
 * 2. The user hasn't seen the updates for this version yet
 * @returns {Promise<boolean>} Whether the modal should be shown
 */
export async function shouldShowLatestUpdatesModal() {
    try {
        // Get the current version from the manifest
        const manifest = chrome.runtime.getManifest();
        const currentVersion = manifest.version;

        // Check if there are release notes for this version
        if (!hasReleaseNotes(currentVersion)) {
            return false;
        }

        // Get the last seen version from storage
        const lastSeenVersion = await storageGetValue(STORAGE_KEYS.LAST_SEEN_VERSION, null);

        // Show modal if user hasn't seen this version's updates
        return lastSeenVersion !== currentVersion;
    } catch (error) {
        console.error('Error checking if latest updates modal should show:', error);
        return false;
    }
}

/**
 * Opens the latest updates modal and populates it with release notes
 */
export function openLatestUpdatesModal() {
    if (!elements.latestUpdatesModal) return;

    // Get the latest release notes (version comes from release-notes.js, not manifest)
    const latest = getLatestReleaseNotes();

    if (!latest) {
        console.warn('No release notes found');
        return;
    }

    const { version, notes: releaseNotes } = latest;
    currentDisplayedVersion = version;

    // Always open on the main (current version) view
    showLatestUpdatesMain();

    // Update the modal title
    if (elements.latestUpdatesTitle) {
        elements.latestUpdatesTitle.textContent = releaseNotes.title || "What's New";
    }

    // Update the version display (uses version from release notes)
    if (elements.latestUpdatesVersion) {
        elements.latestUpdatesVersion.textContent = `Version ${version}`;
    }

    // Update the date display
    if (elements.latestUpdatesDate) {
        if (releaseNotes.date) {
            elements.latestUpdatesDate.textContent = `Last Updated: ${releaseNotes.date}`;
            elements.latestUpdatesDate.style.display = '';
        } else {
            elements.latestUpdatesDate.style.display = 'none';
        }
    }

    // Populate the updates list
    if (elements.latestUpdatesList) {
        elements.latestUpdatesList.innerHTML = '';

        if (releaseNotes.updates && Array.isArray(releaseNotes.updates)) {
            releaseNotes.updates.forEach(update => {
                const li = document.createElement('li');
                li.textContent = update;
                elements.latestUpdatesList.appendChild(li);
            });
        }
    }

    // Show the modal
    elements.latestUpdatesModal.style.display = 'flex';
}

/**
 * Shows the main view (current version's notes) of the latest updates modal
 */
export function showLatestUpdatesMain() {
    if (elements.latestUpdatesMain) elements.latestUpdatesMain.style.display = '';
    if (elements.latestUpdatesHistory) elements.latestUpdatesHistory.style.display = 'none';
}

/**
 * Shows the Previous Updates view with the release notes of older versions
 */
export function showLatestUpdatesHistory() {
    populateLatestUpdatesHistory();
    if (elements.latestUpdatesMain) elements.latestUpdatesMain.style.display = 'none';
    if (elements.latestUpdatesHistory) elements.latestUpdatesHistory.style.display = '';
}

/**
 * Populates the history list with one card per previous version
 * (every version with notes except the one shown in the main view)
 */
function populateLatestUpdatesHistory() {
    if (!elements.latestUpdatesHistoryList) return;
    elements.latestUpdatesHistoryList.innerHTML = '';

    const previousVersions = getAllVersionsWithNotes().filter(v => v !== currentDisplayedVersion);

    if (previousVersions.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'text-align:center; color:var(--text-secondary); font-size:0.9em; padding:20px;';
        empty.textContent = 'No previous release notes available.';
        elements.latestUpdatesHistoryList.appendChild(empty);
        return;
    }

    previousVersions.forEach(version => {
        const notes = getReleaseNotes(version);
        if (!notes) return;

        const card = document.createElement('div');
        card.style.cssText = 'background: rgba(59, 130, 246, 0.08); border-left: 4px solid #3b82f6; padding: 12px 15px; border-radius: 0.5rem; margin-bottom: 12px;';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex; justify-content:space-between; align-items:baseline; gap:10px; margin-bottom:8px;';

        const versionLabel = document.createElement('span');
        versionLabel.style.cssText = 'font-weight:600; color:var(--text-main);';
        versionLabel.textContent = `Version ${version}`;
        header.appendChild(versionLabel);

        if (notes.date) {
            const dateLabel = document.createElement('span');
            dateLabel.style.cssText = 'font-size:0.75em; color:var(--text-secondary); white-space:nowrap;';
            dateLabel.textContent = notes.date;
            header.appendChild(dateLabel);
        }
        card.appendChild(header);

        const ul = document.createElement('ul');
        ul.style.cssText = 'margin:0; padding-left:18px; color:var(--text-main); line-height:1.6; font-size:0.85em;';
        (notes.updates || []).forEach(update => {
            const li = document.createElement('li');
            li.textContent = update;
            ul.appendChild(li);
        });
        card.appendChild(ul);

        elements.latestUpdatesHistoryList.appendChild(card);
    });
}

/**
 * Closes the latest updates modal and marks the version as seen
 */
export async function closeLatestUpdatesModal() {
    if (!elements.latestUpdatesModal) return;

    // Hide the modal
    elements.latestUpdatesModal.style.display = 'none';

    // Mark this version as seen
    const manifest = chrome.runtime.getManifest();
    const currentVersion = manifest.version;

    await storageSet({ [STORAGE_KEYS.LAST_SEEN_VERSION]: currentVersion });
    console.log(`Marked version ${currentVersion} as seen`);
}
