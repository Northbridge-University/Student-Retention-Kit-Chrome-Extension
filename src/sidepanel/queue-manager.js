// Queue Manager - Handles multi-select queue operations
import { setActiveStudent, setAutomationModeUI } from './student-renderer.js';
import { elements, switchTab } from './ui-manager.js';
import { updateFive9ConnectionIndicator } from './five9-integration.js';
import { STORAGE_KEYS } from '../constants/index.js';
import { storageGetValue } from '../utils/storage.js';
import { openStudentViewModal } from './modals/student-view-modal.js';

/**
 * Queue Manager Class - Manages student queue operations
 */
export class QueueManager {
    constructor(callManager) {
        this.selectedQueue = [];
        this.callManager = callManager;
    }

    /**
     * Gets the current queue
     */
    getQueue() {
        return this.selectedQueue;
    }

    /**
     * Gets the queue length
     */
    getLength() {
        return this.selectedQueue.length;
    }

    /**
     * Toggles multi-selection for a student
     * @param {Object} entry - Student data
     * @param {HTMLElement} liElement - List item element
     */
    toggleMultiSelection(entry, liElement) {
        const index = this.selectedQueue.findIndex(s => s.name === entry.name);

        if (index > -1) {
            // Deselect
            this.selectedQueue.splice(index, 1);
            liElement.classList.remove('multi-selected');
        } else {
            // Select
            this.selectedQueue.push(entry);
            liElement.classList.add('multi-selected');
        }

        // Update call manager's queue reference
        if (this.callManager) {
            this.callManager.updateQueue(this.selectedQueue);
        }

        // Update UI based on queue size
        if (this.selectedQueue.length === 1) {
            setActiveStudent(this.selectedQueue[0], this.callManager);
        } else if (this.selectedQueue.length > 1) {
            setAutomationModeUI(this.selectedQueue.length, this.selectedQueue);
        } else {
            setActiveStudent(null, this.callManager);
        }
    }

    /**
     * Sets the queue to a single student (standard single select)
     * @param {Object} entry - Student data
     * @param {HTMLElement} liElement - List item element
     */
    async setSingleStudent(entry, liElement) {
        this.selectedQueue = [entry];

        if (this.callManager) {
            this.callManager.updateQueue(this.selectedQueue);
        }

        // Visually clear other rows
        document.querySelectorAll('.glass-list li').forEach(el => el.classList.remove('multi-selected'));
        liElement.classList.add('multi-selected');

        setActiveStudent(entry, this.callManager);

        // Check if auto-switch to Call tab is enabled
        const autoSwitchEnabled = await storageGetValue(STORAGE_KEYS.AUTO_SWITCH_TO_CALL_TAB, false);
        if (autoSwitchEnabled) {
            switchTab('contact');
            // Check Five9 connection when switching to contact tab
            updateFive9ConnectionIndicator(this.selectedQueue);
        } else {
            // Show student view modal when auto-switch is disabled
            const campusList = await storageGetValue(STORAGE_KEYS.CAMPUS_LIST, []);
            const hasMultipleCampuses = Array.isArray(campusList) && campusList.length > 1;
            const campusPrefix = await storageGetValue(STORAGE_KEYS.CAMPUS_PREFIX, '');
            openStudentViewModal(entry, hasMultipleCampuses, campusPrefix);
        }
    }

    /**
     * Handles student click with CTRL/CMD key detection
     * @param {Object} entry - Student data
     * @param {HTMLElement} liElement - List item element
     * @param {Event} event - Click event
     */
    handleStudentClick(entry, liElement, event) {
        // Block student selection during active call, automation mode, or awaiting disposition
        // This prevents accidentally changing the active student mid-call
        if (this.callManager) {
            if (this.callManager.getCallActiveState()) {
                console.log('[QueueManager] Ignoring student selection - call is active');
                switchTab('contact');
                return;
            }
            if (this.callManager.getAutomationModeState()) {
                console.log('[QueueManager] Ignoring student selection - automation mode active');
                switchTab('contact');
                return;
            }
            if (this.callManager.getWaitingForDisposition()) {
                console.log('[QueueManager] Ignoring student selection - awaiting disposition');
                switchTab('contact');
                return;
            }
        }

        if (event.ctrlKey || event.metaKey) {
            this.toggleMultiSelection(entry, liElement);
        } else {
            this.setSingleStudent(entry, liElement);
        }
    }

    /**
     * Reorders the queue by moving an item from one index to another
     * @param {number} fromIndex - Source index
     * @param {number} toIndex - Destination index
     */
    reorderQueue(fromIndex, toIndex) {
        const [movedStudent] = this.selectedQueue.splice(fromIndex, 1);
        this.selectedQueue.splice(toIndex, 0, movedStudent);

        if (this.callManager) {
            this.callManager.updateQueue(this.selectedQueue);
        }

        if (this.selectedQueue.length > 1) {
            setAutomationModeUI(this.selectedQueue.length, this.selectedQueue);
        }
    }

    /**
     * Removes a student from the queue
     * @param {number} index - Index to remove
     */
    removeFromQueue(index) {
        this.selectedQueue.splice(index, 1);

        if (this.callManager) {
            this.callManager.updateQueue(this.selectedQueue);
        }

        this.updateMasterListSelection();

        // Update UI based on remaining queue size
        if (this.selectedQueue.length === 0) {
            setActiveStudent(null, this.callManager);
            return 'close'; // Signal to close modal
        } else if (this.selectedQueue.length === 1) {
            setActiveStudent(this.selectedQueue[0], this.callManager);
            return 'close'; // Signal to close modal
        } else {
            // Only update the queue count text, don't re-render the entire call tab
            this.updateQueueCountUI(this.selectedQueue.length);
            return 'refresh'; // Signal to refresh modal
        }
    }

    /**
     * Updates just the queue count displays without re-rendering the call tab
     */
    updateQueueCountUI(count) {
        if (elements.contactDetail) {
            elements.contactDetail.textContent = `${count} Students Selected`;
        }
        if (elements.contactAvatar) {
            elements.contactAvatar.textContent = count;
        }

        // Update "Up Next" preview with the current first student
        if (elements.upNextCard && elements.upNextName && this.selectedQueue.length > 0) {
            elements.upNextName.textContent = this.selectedQueue[0].name || 'Unknown Student';
        }
    }

    /**
     * Updates the visual selection in the master list
     */
    updateMasterListSelection() {
        // Clear all selections first
        document.querySelectorAll('.glass-list li.expandable').forEach(el => {
            el.classList.remove('multi-selected');
        });

        // Re-apply selections based on current queue
        const listItems = document.querySelectorAll('.glass-list li.expandable');
        listItems.forEach(li => {
            const name = li.getAttribute('data-name');
            const isInQueue = this.selectedQueue.some(s => s.name === name);
            if (isInQueue) {
                li.classList.add('multi-selected');
            }
        });
    }

    /**
     * Clears the entire queue
     */
    clearQueue() {
        this.selectedQueue = [];

        if (this.callManager) {
            this.callManager.updateQueue(this.selectedQueue);
        }

        this.updateMasterListSelection();
        setActiveStudent(null, this.callManager);
    }

    /**
     * Replaces the queue with a new array
     * @param {Array} newQueue - New queue array
     */
    setQueue(newQueue) {
        this.selectedQueue = newQueue;

        if (this.callManager) {
            this.callManager.updateQueue(this.selectedQueue);
        }

        this.updateMasterListSelection();

        if (this.selectedQueue.length === 0) {
            setActiveStudent(null, this.callManager);
        } else if (this.selectedQueue.length === 1) {
            setActiveStudent(this.selectedQueue[0], this.callManager);
        } else {
            setAutomationModeUI(this.selectedQueue.length, this.selectedQueue);
        }
    }

    /**
     * Checks if a student is in the queue
     * @param {string} studentName - Name of student to check
     * @returns {boolean}
     */
    isInQueue(studentName) {
        return this.selectedQueue.some(s => s.name === studentName);
    }

    /**
     * Gets the current student (first in queue)
     * @returns {Object|null}
     */
    getCurrentStudent() {
        return this.selectedQueue.length > 0 ? this.selectedQueue[0] : null;
    }

    /**
     * Gets the next student in queue
     * @returns {Object|null}
     */
    getNextStudent() {
        return this.selectedQueue.length > 1 ? this.selectedQueue[1] : null;
    }
}
