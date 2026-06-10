// Queue Modal - Handles the queue management dialog with drag-and-drop reordering
import { STORAGE_KEYS } from '../../constants/index.js';
import { storageGetValue } from '../../utils/storage.js';
import { elements } from '../ui-manager.js';
import { resolveStudentData } from '../student-renderer.js';

// Drag and drop state
let draggedElement = null;
let draggedIndex = null;
let currentOnReorder = null;
let currentStudentIndex = null;
let automationRunning = false;

/**
 * Opens the queue management modal
 * @param {Array} selectedQueue - Full queue array
 * @param {Function} onReorder - Callback when items are reordered
 * @param {Function} onRemove - Callback when an item is removed
 * @param {Object} [automationState] - { currentIndex, skippedIndices } from callManager
 */
export function openQueueModal(selectedQueue, onReorder, onRemove, automationState) {
    if (!elements.queueModal || !elements.queueList) return;

    renderQueueModal(selectedQueue, onReorder, onRemove, automationState);
    elements.queueModal.style.display = 'flex';
}

/**
 * Closes the queue management modal
 */
export function closeQueueModal() {
    if (!elements.queueModal) return;
    elements.queueModal.style.display = 'none';
}

/**
 * Renders the queue modal content
 * Only shows students still in the queue (current + upcoming), not already-called ones.
 */
export async function renderQueueModal(selectedQueue, onReorder, onRemove, automationState) {
    if (!elements.queueList || !elements.queueCount) return;

    elements.queueList.innerHTML = '';
    currentOnReorder = onReorder;
    currentStudentIndex = automationState?.currentIndex || 0;
    automationRunning = automationState?.isRunning || false;

    // Determine which students are still pending (current + future, not skipped)
    const currentIndex = automationState?.currentIndex || 0;
    const skippedIndices = automationState?.skippedIndices || new Set();

    // Build list of pending entries: [ { originalIndex, student } ]
    const pendingEntries = [];
    selectedQueue.forEach((student, index) => {
        if (index >= currentIndex && !skippedIndices.has(index)) {
            pendingEntries.push({ originalIndex: index, student });
        }
    });

    if (pendingEntries.length === 0) {
        elements.queueList.innerHTML = '<li style="justify-content:center; color:gray;">No students in queue</li>';
        elements.queueCount.textContent = '0 students';
        return;
    }

    elements.queueCount.textContent = `${pendingEntries.length} student${pendingEntries.length !== 1 ? 's' : ''}`;

    // Get reformat name setting
    const reformatEnabled = await storageGetValue(STORAGE_KEYS.REFORMAT_NAME_ENABLED, true);

    pendingEntries.forEach((entry, displayIndex) => {
        const li = document.createElement('li');
        li.className = 'queue-item-draggable';
        li.draggable = true;
        li.dataset.index = entry.originalIndex;

        const data = resolveStudentData(entry.student, reformatEnabled);
        const isCurrent = entry.originalIndex === currentIndex;

        li.innerHTML = `
            <div style="display: flex; align-items: center; width: 100%; justify-content: space-between;">
                <div style="display: flex; align-items: center; flex-grow: 1;">
                    <i class="fas fa-grip-vertical queue-drag-handle"></i>
                    <div style="margin-right: 10px; font-weight: 600; color: var(--text-secondary); min-width: 20px;">#${displayIndex + 1}</div>
                    <div>
                        <div><span class="queue-student-name" style="font-weight: 500; color: var(--text-main);">${data.name}</span>${isCurrent ? ' <span style="font-size:0.75em; color:var(--primary-color); font-weight:600;">(current)</span>' : ''}</div>
                        ${data.daysOut != null ? `<div style="font-size: 0.8em; color: var(--text-secondary);">${data.daysOut} Days Out</div>` : ''}
                    </div>
                </div>
                ${isCurrent ? '' : `<button class="queue-remove-btn" data-index="${entry.originalIndex}" title="Remove from queue">
                    <i class="fas fa-trash-can"></i>
                </button>`}
            </div>
        `;

        // Disable dragging on the current student during active automation
        if (isCurrent && automationRunning) {
            li.draggable = false;
            li.style.cursor = 'default';
        } else {
            li.addEventListener('dragstart', (e) => handleDragStart(e));
            li.addEventListener('dragend', (e) => handleDragEnd(e));
        }

        // Remove button (not present for current call)
        const removeBtn = li.querySelector('.queue-remove-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (onRemove) {
                    onRemove(entry.originalIndex);
                }
            });
        }

        elements.queueList.appendChild(li);
    });

    // Attach drag events to the container so gaps between items are covered
    elements.queueList.removeEventListener('dragover', handleContainerDragOver);
    elements.queueList.removeEventListener('dragleave', handleContainerDragLeave);
    elements.queueList.removeEventListener('drop', handleContainerDrop);
    elements.queueList.addEventListener('dragover', handleContainerDragOver);
    elements.queueList.addEventListener('dragleave', handleContainerDragLeave);
    elements.queueList.addEventListener('drop', handleContainerDrop);
}

function handleDragStart(e) {
    draggedElement = e.currentTarget;
    draggedIndex = parseInt(e.currentTarget.dataset.index);
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.currentTarget.innerHTML);
}

function handleDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    clearAllIndicators();
}

/**
 * Finds the closest queue item to the cursor's Y position
 */
function getClosestItem(y) {
    const items = [...document.querySelectorAll('.queue-item-draggable:not(.dragging)')];
    let closest = null;
    let closestDist = Infinity;
    let position = 'bottom';

    for (const item of items) {
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const dist = Math.abs(y - midY);

        if (dist < closestDist) {
            closestDist = dist;
            closest = item;
            position = y < midY ? 'top' : 'bottom';
        }
    }

    return { item: closest, position };
}

function clearAllIndicators() {
    document.querySelectorAll('.queue-item-draggable').forEach(item => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
    });
}

function handleContainerDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    clearAllIndicators();

    const { item, position } = getClosestItem(e.clientY);
    if (item && item !== draggedElement) {
        const itemIndex = parseInt(item.dataset.index);
        // Prevent placing above the current student during active automation
        if (automationRunning && itemIndex === currentStudentIndex && position === 'top') return;
        item.classList.add(position === 'top' ? 'drag-over-top' : 'drag-over-bottom');
    }
}

function handleContainerDragLeave(e) {
    // Only clear if actually leaving the container (not entering a child)
    if (!elements.queueList.contains(e.relatedTarget)) {
        clearAllIndicators();
    }
}

function handleContainerDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    const { item, position } = getClosestItem(e.clientY);
    if (item) {
        const dropIndex = parseInt(item.dataset.index);
        // Prevent placing above the current student during active automation
        if (automationRunning && dropIndex === currentStudentIndex && position === 'top') {
            clearAllIndicators();
            return;
        }
        if (draggedIndex !== dropIndex && currentOnReorder) {
            currentOnReorder(draggedIndex, dropIndex);
        }
    }

    clearAllIndicators();
}
