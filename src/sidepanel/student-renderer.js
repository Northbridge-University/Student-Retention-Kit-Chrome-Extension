// Student Renderer - Handles rendering of student lists and active student display
import { elements } from './ui-manager.js';
import { GENERIC_AVATAR_URL, STORAGE_KEYS, HIGHLIGHT_STATUS, MESSAGE_TYPES } from '../constants/index.js';
import { updateCallTabDisplay } from './call-tab-placeholder.js';

/**
 * Converts student name from "Last, First" format to "First Last" format if a comma is present.
 * @param {string} name - The student name to convert
 * @returns {string} The converted name in "First Last" format
 */
function convertNameFormat(name) {
    if (!name || typeof name !== 'string') return name;

    // Check if the name contains a comma
    if (!name.includes(',')) {
        return name.trim();
    }

    // Split by comma and trim whitespace
    const parts = name.split(',').map(part => part.trim());

    // If we don't have exactly 2 parts, return the original name
    if (parts.length !== 2) {
        return name.trim();
    }

    // Convert from "Last, First" to "First Last"
    const [lastName, firstName] = parts;
    return `${firstName} ${lastName}`;
}

/**
 * Gets the display name for a student based on the reformat name setting
 * @param {Object} entry - The student entry
 * @param {boolean} reformatEnabled - Whether name reformatting is enabled
 * @returns {string} The formatted or original name
 */
export function getDisplayName(entry, reformatEnabled = true) {
    const originalName = entry.nameOriginal || entry.name || 'Unknown Student';

    if (reformatEnabled) {
        return convertNameFormat(originalName);
    }

    return originalName;
}

/**
 * Normalizes student data for consistent rendering
 * @param {Object} entry - The student entry
 * @param {boolean} reformatEnabled - Whether name reformatting is enabled
 */
export function resolveStudentData(entry, reformatEnabled = true) {
    return {
        name: getDisplayName(entry, reformatEnabled),
        nameOriginal: entry.nameOriginal || entry.name || 'Unknown Student',
        sortable_name: entry.sortable_name || null,
        phone: entry.phone || null,
        daysOut: parseInt(entry.daysOut || 0),
        missing: parseInt(entry.missingCount || 0),
        StudentNumber: entry.StudentNumber || null,
        SyStudentId: entry.SyStudentId || null,
        url: entry.url || entry.Gradebook || null, // Fallback to Gradebook for legacy data
        Photo: entry.Photo || null,
        isNew: entry.isNew || false,
        created_at: entry.created_at || null,
        timestamp: entry.timestamp || null,
        assignment: entry.assignment || null
    };
}

/**
 * Sets the active student in the contact tab
 * @param {Object|null} rawEntry - The student data or null to clear
 * @param {Object} callManager - Reference to call manager for state updates
 */
export async function setActiveStudent(rawEntry, callManager) {
    const contactTab = document.getElementById('contact');
    if (!contactTab) return;

    // Reset automation styles when switching (but not during active automation)
    if (!callManager?.automationMode) {
        if (elements.dialBtn) {
            elements.dialBtn.classList.remove('automation');
            elements.dialBtn.innerHTML = '<i class="fas fa-phone"></i>';
        }
        if (callManager) {
            callManager.updateCallInterfaceState();

            // Hide disposition section when new student is selected
            callManager.waitingForDisposition = false;
            if (elements.callDispositionSection) {
                elements.callDispositionSection.style.display = 'none';
            }
        }
        if (elements.upNextCard) {
            elements.upNextCard.style.display = 'none';
        }
        if (elements.manageQueueBtn) {
            elements.manageQueueBtn.style.display = 'none';
        }
    }

    // 1. Handle "No Student Selected" State - use unified placeholder system
    if (!rawEntry) {
        // Get debug mode from storage
        const debugData = await chrome.storage.local.get(STORAGE_KEYS.CALL_DEMO);
        const debugMode = debugData[STORAGE_KEYS.CALL_DEMO] || false;

        // Update the call tab display with no student selected
        await updateCallTabDisplay({
            selectedQueue: [],
            debugMode: debugMode
        });
        return;
    }

    // 2. Handle "Student Selected" State - use unified placeholder system
    // Get debug mode from storage
    const debugData = await chrome.storage.local.get(STORAGE_KEYS.CALL_DEMO);
    const debugMode = debugData[STORAGE_KEYS.CALL_DEMO] || false;

    // Update the call tab display with the selected student
    // This will check Five9 status and show appropriate message or call section
    await updateCallTabDisplay({
        selectedQueue: [rawEntry],
        debugMode: debugMode
    });

    // Get reformat name setting
    const settings = await chrome.storage.local.get(['reformatNameEnabled']);
    const reformatEnabled = settings.reformatNameEnabled !== undefined ? settings.reformatNameEnabled : true;

    const data = resolveStudentData(rawEntry, reformatEnabled);

    // Generate initials from name
    const nameParts = data.name.trim().split(/\s+/);
    let initials = '';
    if (nameParts.length > 0) {
        const firstInitial = nameParts[0][0] || '';
        const lastInitial = nameParts.length > 1 ? nameParts[nameParts.length - 1][0] : '';
        initials = (firstInitial + lastInitial).toUpperCase();
        if (!initials) initials = '?';
    }

    const displayPhone = data.phone ? data.phone : "No Phone Listed";

    // AVATAR LOGIC
    if (elements.contactAvatar) {
        elements.contactAvatar.style.color = '';
        if (data.Photo && data.Photo !== GENERIC_AVATAR_URL) {
            elements.contactAvatar.textContent = '';
            elements.contactAvatar.style.backgroundImage = `url('${data.Photo}')`;
            elements.contactAvatar.style.backgroundSize = 'cover';
            elements.contactAvatar.style.backgroundPosition = 'center';
            elements.contactAvatar.style.backgroundColor = 'transparent';
        } else {
            elements.contactAvatar.style.backgroundImage = 'none';
            elements.contactAvatar.textContent = initials;
            elements.contactAvatar.style.backgroundColor = '#e0e7ff';
        }
    }

    if (elements.contactName) elements.contactName.textContent = data.name;
    if (elements.contactPhone) elements.contactPhone.textContent = displayPhone;

    if (elements.contactDetail) {
        elements.contactDetail.textContent = `${data.daysOut} Days Out`;
        elements.contactDetail.style.display = 'block';
    }

    let colorCode = '#10b981';
    if (data.daysOut > 10) colorCode = '#ef4444';
    else if (data.daysOut > 5) colorCode = '#f97316';
    else if (data.daysOut > 2) colorCode = '#f59e0b';

    if (elements.contactCard) {
        elements.contactCard.style.borderLeftColor = colorCode;
    }
}

/**
 * Sets the automation mode UI with gray styling
 * @param {number} queueLength - Number of students in queue
 */
export function setAutomationModeUI(queueLength) {
    const contactTab = document.getElementById('contact');
    if (!contactTab) return;

    // Ensure content is visible (hide placeholder)
    Array.from(contactTab.children).forEach(child => {
        if (child.id === 'callTabPlaceholder') {
            child.style.display = 'none';
        } else if (child.classList.contains('section')) {
            child.style.display = '';
        }
    });

    // Update Contact Card
    if (elements.contactName) elements.contactName.textContent = "Automation Mode";
    if (elements.contactDetail) elements.contactDetail.textContent = `${queueLength} Students Selected`;
    if (elements.contactPhone) elements.contactPhone.textContent = "Multi-Dial Queue";

    // Create visual badge for count
    if (elements.contactAvatar) {
        elements.contactAvatar.textContent = queueLength;
        elements.contactAvatar.style.backgroundImage = 'none';
        elements.contactAvatar.style.backgroundColor = '#6b7280';
        elements.contactAvatar.style.color = '#ffffff';
    }

    // Transform the Dial Button to Gray
    if (elements.dialBtn) {
        elements.dialBtn.classList.add('automation');
        elements.dialBtn.innerHTML = '<i class="fas fa-robot"></i>';
    }

    // Update Status Text
    if (elements.callStatusText) {
        elements.callStatusText.innerHTML = `<span class="status-indicator" style="background:#6b7280;"></span> Ready to Auto-Dial`;
    }

    if (elements.contactCard) {
        elements.contactCard.style.borderLeftColor = '#6b7280';
    }

    // Show Manage Queue Button
    if (elements.manageQueueBtn) {
        elements.manageQueueBtn.style.display = 'block';
    }
}

/**
 * Renders the found submissions list
 * @param {Array} rawEntries - Array of found submissions
 */
export async function renderFoundList(rawEntries) {
    if (!elements.foundList) return;
    elements.foundList.innerHTML = '';

    if (!rawEntries || rawEntries.length === 0) {
        elements.foundList.innerHTML = '<li style="justify-content:center; color:gray;">No submissions found yet.</li>';
        if (elements.clearListBtn) {
            elements.clearListBtn.style.display = 'none';
        }
        return;
    }

    // Show clear button when there are entries
    if (elements.clearListBtn) {
        elements.clearListBtn.style.display = 'block';
    }

    // Get reformat name setting
    const settings = await chrome.storage.local.get(['reformatNameEnabled']);
    const reformatEnabled = settings.reformatNameEnabled !== undefined ? settings.reformatNameEnabled : true;

    // Create pairs of raw entries and resolved data, then sort by timestamp
    const entriesWithRaw = rawEntries.map(rawEntry => ({
        raw: rawEntry,
        resolved: resolveStudentData(rawEntry, reformatEnabled)
    }));
    entriesWithRaw.sort((a, b) => new Date(b.resolved.timestamp) - new Date(a.resolved.timestamp));

    entriesWithRaw.forEach(({ raw, resolved }) => {
        const li = document.createElement('li');
        let timeDisplay = 'Just now';
        if (resolved.timestamp) {
            timeDisplay = new Date(resolved.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        const assignmentTitle = resolved.assignment || 'Untitled Assignment';

        // Determine indicator class based on highlight confirmation status
        const status = raw.highlightStatus || HIGHLIGHT_STATUS.PENDING;
        let indicatorClass = 'heatmap-gray';  // Default: pending/waiting
        if (status === HIGHLIGHT_STATUS.CONFIRMED) indicatorClass = 'heatmap-green';
        else if (status === HIGHLIGHT_STATUS.ERROR) indicatorClass = 'heatmap-orange';

        li.innerHTML = `
            <div style="display: flex; align-items: center; width:100%;">
                <div class="heatmap-indicator ${indicatorClass}" title="${status === HIGHLIGHT_STATUS.CONFIRMED ? 'Excel confirmed' : status === HIGHLIGHT_STATUS.ERROR ? 'Excel highlight failed' : 'Waiting for Excel confirmation'}"></div>
                <div style="flex-grow:1; display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; flex-direction:column;">
                        <span class="student-name" style="font-weight:500; color:${resolved.url ? 'var(--primary-color)' : 'var(--text-secondary)'}; cursor:${resolved.url ? 'pointer' : 'default'};" ${resolved.url ? '' : 'title="No gradebook URL available"'}>${resolved.name}</span>
                        <span style="font-size:0.8em; color:var(--text-secondary);">${assignmentTitle}</span>
                    </div>
                    <span class="timestamp-pill">${timeDisplay}</span>
                </div>
            </div>
        `;

        const nameLink = li.querySelector('.student-name');
        if (resolved.url) {
            nameLink.addEventListener('click', (e) => {
                e.stopPropagation();
                chrome.tabs.create({ url: resolved.url });
            });
            nameLink.addEventListener('mouseenter', () => nameLink.style.textDecoration = 'underline');
            nameLink.addEventListener('mouseleave', () => nameLink.style.textDecoration = 'none');
        }

        // Click anywhere on the row (except name link) to navigate in Excel
        if (raw.syStudentId) {
            li.style.cursor = 'pointer';
            li.addEventListener('click', () => {
                chrome.runtime.sendMessage({
                    type: MESSAGE_TYPES.SRK_NAVIGATE_TO_STUDENT,
                    syStudentId: raw.syStudentId,
                    campus: raw.campus || null
                });
            });
        }

        // Store the ORIGINAL raw entry data on the li element for context menu access
        // This ensures all fields like SyStudentId are preserved
        li.dataset.entryData = JSON.stringify(raw);

        elements.foundList.appendChild(li);
    });
}

/**
 * Filters the found list based on search term
 * @param {Event} e - Input event
 */
export function filterFoundList(e) {
    const term = e.target.value.toLowerCase();
    const items = elements.foundList.querySelectorAll('li');
    items.forEach(li => {
        const text = li.textContent.toLowerCase();
        let matches = text.includes(term);
        if (!matches) {
            const parts = term.includes(',')
                ? term.split(',').map(s => s.trim())
                : term.split(/\s+/);
            if (parts.length >= 2) {
                const reversed = [...parts].reverse();
                matches = text.includes(reversed.join(' ')) || text.includes(reversed.join(', '));
            }
        }
        li.style.display = matches ? 'flex' : 'none';
    });
}

/**
 * Renders the master student list
 * @param {Array} rawEntries - Array of student data
 * @param {Function} onStudentClick - Callback when student is clicked
 */
export async function renderMasterList(rawEntries, onStudentClick) {
    if (!elements.masterList) return;
    elements.masterList.innerHTML = '';

    // Update total count indicator
    if (elements.totalCountText) {
        const count = rawEntries ? rawEntries.length : 0;
        elements.totalCountText.textContent = `Total Students: ${count}`;
    }

    if (!rawEntries || rawEntries.length === 0) {
        elements.masterList.innerHTML = '<li style="justify-content:center;">Master list is empty.</li>';
        return;
    }

    // Get reformat name setting
    const settings = await chrome.storage.local.get(['reformatNameEnabled']);
    const reformatEnabled = settings.reformatNameEnabled !== undefined ? settings.reformatNameEnabled : true;

    rawEntries.forEach(rawEntry => {
        const data = resolveStudentData(rawEntry, reformatEnabled);

        const li = document.createElement('li');
        li.className = 'expandable';
        li.style.cursor = 'pointer';

        li.setAttribute('data-name', data.name);
        li.setAttribute('data-missing', data.missing);
        li.setAttribute('data-days', data.daysOut);
        li.setAttribute('data-created', data.created_at || '');
        li.setAttribute('data-campus', rawEntry.campus || '');

        let heatmapClass = data.daysOut > 10 ? 'heatmap-red' : (data.daysOut > 5 ? 'heatmap-orange' : (data.daysOut > 2 ? 'heatmap-yellow' : 'heatmap-green'));

        let missingPillHtml = '';
        if (data.missing > 0) {
            missingPillHtml = `<span class="missing-pill">${data.missing} Missing</span>`;
        }

        let newTagHtml = '';
        if (data.isNew) {
            newTagHtml = `<span style="background:#e0f2fe; color:#0369a1; font-size:0.7em; padding:2px 6px; border-radius:8px; margin-left:6px; font-weight:bold; border:1px solid #bae6fd;">New</span>`;
        }

        li.innerHTML = `
            <div style="display: flex; align-items: center; width:100%;">
                <div class="heatmap-indicator ${heatmapClass}"></div>
                <div style="flex-grow:1;">
                    <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                        <div style="display:flex; align-items:center;">
                            <span class="student-name" style="font-weight: 500; color:${data.url ? 'var(--text-main)' : 'var(--text-secondary)'}; position:relative; z-index:2;${data.url ? '' : ' cursor: default;'}" ${data.url ? '' : 'title="No gradebook URL available"'}>${data.name}</span>
                            ${newTagHtml}
                        </div>
                        ${missingPillHtml}
                    </div>
                    <span style="font-size:0.8em; color:gray;">${data.daysOut} Days Out</span>
                </div>
            </div>
        `;

        // Click listener for student selection
        li.addEventListener('click', (e) => {
            if (onStudentClick) {
                onStudentClick(rawEntry, li, e);
            }
        });

        // Student name click - open gradebook (only if URL exists)
        const nameLink = li.querySelector('.student-name');
        if (nameLink && data.url) {
            nameLink.style.cursor = 'pointer';
            nameLink.addEventListener('click', (e) => {
                e.stopPropagation();
                chrome.tabs.create({ url: data.url });
            });
            nameLink.addEventListener('mouseenter', () => {
                nameLink.style.textDecoration = 'underline';
                nameLink.style.color = 'var(--primary-color)';
            });
            nameLink.addEventListener('mouseleave', () => {
                nameLink.style.textDecoration = 'none';
                nameLink.style.color = 'var(--text-main)';
            });
        }

        elements.masterList.appendChild(li);
    });
}

/**
 * Applies all filters (search term and campus) to the master list
 * This unified function ensures both filters work together
 */
export function applyMasterListFilters() {
    const searchTerm = (elements.masterSearch?.value || '').toLowerCase();
    const selectedCampus = elements.campusFilter?.value || '';
    const listItems = elements.masterList.querySelectorAll('li.expandable');

    let visibleCount = 0;
    listItems.forEach(li => {
        const name = li.getAttribute('data-name').toLowerCase();
        const campus = li.getAttribute('data-campus') || '';

        // Support any name format: "First Last", "Last, First", "Last First"
        let matchesSearch = name.includes(searchTerm);
        if (!matchesSearch) {
            const parts = searchTerm.includes(',')
                ? searchTerm.split(',').map(s => s.trim())
                : searchTerm.split(/\s+/);
            if (parts.length >= 2) {
                const reversed = [...parts].reverse();
                matchesSearch = name.includes(reversed.join(' ')) || name.includes(reversed.join(', '));
            }
        }
        const matchesCampus = !selectedCampus || campus === selectedCampus;

        const isVisible = matchesSearch && matchesCampus;
        li.style.display = isVisible ? 'flex' : 'none';
        if (isVisible) visibleCount++;
    });

    // Update the displayed count to show filtered count
    if (elements.totalCountText) {
        const totalCount = listItems.length;
        if (searchTerm || selectedCampus) {
            elements.totalCountText.textContent = `Showing ${visibleCount} of ${totalCount} Students`;
        } else {
            elements.totalCountText.textContent = `Total Students: ${totalCount}`;
        }
    }
}

/**
 * Filters the master list based on search term
 * @param {Event} e - Input event
 */
export function filterMasterList(e) {
    applyMasterListFilters();
}

/**
 * Filters the master list based on campus selection
 */
export function filterByCampus() {
    applyMasterListFilters();
}

/** Current sort criteria (used by dropdown menu) */
let currentSortCriteria = 'name';

/**
 * Gets the current sort criteria
 */
export function getCurrentSortCriteria() {
    return currentSortCriteria;
}

/**
 * Sets the sort criteria and re-sorts the list
 * @param {string} criteria - Sort criteria key
 */
export function setSortCriteria(criteria) {
    currentSortCriteria = criteria;
    sortMasterList();
}

/**
 * Sorts the master list based on selected criteria
 */
export function sortMasterList() {
    const criteria = elements.sortSelect?.value || currentSortCriteria;
    const listItems = Array.from(elements.masterList.querySelectorAll('li.expandable'));

    listItems.sort((a, b) => {
        if (criteria === 'name') {
            return a.getAttribute('data-name').localeCompare(b.getAttribute('data-name'));
        } else if (criteria === 'missing') {
            return parseInt(b.getAttribute('data-missing')) - parseInt(a.getAttribute('data-missing'));
        } else if (criteria === 'days') {
            return parseInt(b.getAttribute('data-days')) - parseInt(a.getAttribute('data-days'));
        } else if (criteria === 'newest') {
            const dateA = new Date(a.getAttribute('data-created') || 0);
            const dateB = new Date(b.getAttribute('data-created') || 0);
            return dateB - dateA;
        }
    });
    listItems.forEach(item => elements.masterList.appendChild(item));
}

/**
 * Renders a vertical box-and-whisker plot of student Days Out on a canvas
 * Designed to be readable in a narrow sidepanel
 */
export function renderWhiskerPlot() {
    const canvas = elements.whiskerPlotCanvas;
    const legend = elements.whiskerPlotLegend;
    if (!canvas || !legend) return;

    const listItems = Array.from(elements.masterList?.querySelectorAll('li.expandable') || []);
    const daysData = listItems.map(li => parseInt(li.getAttribute('data-days') || '0')).sort((a, b) => a - b);

    // Set canvas size for crisp rendering
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width - 32;
    const height = 380;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    if (daysData.length === 0) {
        ctx.fillStyle = '#6b7280';
        ctx.font = '14px Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No student data available', width / 2, height / 2);
        legend.innerHTML = '';
        return;
    }

    // Calculate statistics
    const n = daysData.length;
    const min = daysData[0];
    const max = daysData[n - 1];
    const q1 = daysData[Math.floor(n * 0.25)];
    const median = daysData[Math.floor(n * 0.5)];
    const q3 = daysData[Math.floor(n * 0.75)];
    const mean = daysData.reduce((s, v) => s + v, 0) / n;
    const iqr = q3 - q1;
    const lowerFence = Math.max(min, q1 - 1.5 * iqr);
    const upperFence = Math.min(max, q3 + 1.5 * iqr);

    // Outliers
    const outliers = daysData.filter(v => v < lowerFence || v > upperFence);

    // Vertical layout: Y-axis = days out (top = high, bottom = low)
    const padding = { top: 30, bottom: 40, left: 55, right: 30 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    // Box occupies the center horizontal band
    const boxLeft = padding.left + plotWidth * 0.3;
    const boxRight = padding.left + plotWidth * 0.7;
    const boxWidth = boxRight - boxLeft;
    const midX = (boxLeft + boxRight) / 2;

    const dataMax = max || 1;
    // Scale: value -> y position (high values at top)
    const scale = (val) => padding.top + plotHeight - (val / dataMax) * plotHeight;

    // Draw horizontal grid lines
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
    ctx.lineWidth = 1;
    const gridSteps = 5;
    for (let i = 0; i <= gridSteps; i++) {
        const y = padding.top + (i / gridSteps) * plotHeight;
        ctx.beginPath();
        ctx.moveTo(padding.left - 5, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();
    }

    // Draw Y-axis labels (days out values)
    ctx.fillStyle = '#6b7280';
    ctx.font = '12px Roboto, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= gridSteps; i++) {
        const val = Math.round(((gridSteps - i) / gridSteps) * dataMax);
        const y = padding.top + (i / gridSteps) * plotHeight;
        ctx.fillText(val, padding.left - 10, y);
    }

    // Y-axis title
    ctx.save();
    ctx.translate(14, padding.top + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.font = '12px Roboto, sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.fillText('Days Out', 0, 0);
    ctx.restore();

    // Draw whisker lines (vertical)
    ctx.strokeStyle = '#6b7280';
    ctx.lineWidth = 2;

    // Bottom whisker (lower fence to Q1)
    ctx.beginPath();
    ctx.moveTo(midX, scale(lowerFence));
    ctx.lineTo(midX, scale(q1));
    ctx.stroke();
    // Bottom whisker cap
    ctx.beginPath();
    ctx.moveTo(boxLeft + boxWidth * 0.25, scale(lowerFence));
    ctx.lineTo(boxRight - boxWidth * 0.25, scale(lowerFence));
    ctx.stroke();

    // Top whisker (Q3 to upper fence)
    ctx.beginPath();
    ctx.moveTo(midX, scale(q3));
    ctx.lineTo(midX, scale(upperFence));
    ctx.stroke();
    // Top whisker cap
    ctx.beginPath();
    ctx.moveTo(boxLeft + boxWidth * 0.25, scale(upperFence));
    ctx.lineTo(boxRight - boxWidth * 0.25, scale(upperFence));
    ctx.stroke();

    // Draw IQR box (Q1 to Q3)
    const boxY = scale(q3); // top of box (higher value = higher on canvas)
    const boxH = scale(q1) - scale(q3);
    ctx.fillStyle = 'rgba(0, 90, 156, 0.15)';
    ctx.fillRect(boxLeft, boxY, boxWidth, boxH);
    ctx.strokeStyle = '#005A9C';
    ctx.lineWidth = 2;
    ctx.strokeRect(boxLeft, boxY, boxWidth, boxH);

    // Draw median line (horizontal across the box)
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(boxLeft, scale(median));
    ctx.lineTo(boxRight, scale(median));
    ctx.stroke();

    // Median label
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 12px Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${median}`, boxRight + 8, scale(median));

    // Draw mean diamond
    const meanY = scale(mean);
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.moveTo(midX, meanY - 8);
    ctx.lineTo(midX + 6, meanY);
    ctx.lineTo(midX, meanY + 8);
    ctx.lineTo(midX - 6, meanY);
    ctx.closePath();
    ctx.fill();

    // Mean label
    ctx.fillStyle = '#10b981';
    ctx.font = '11px Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${mean.toFixed(1)}`, boxRight + 8, meanY);

    // Draw outliers
    ctx.fillStyle = '#f97316';
    outliers.forEach(val => {
        const jitter = (Math.random() - 0.5) * boxWidth * 0.4;
        ctx.beginPath();
        ctx.arc(midX + jitter, scale(val), 4, 0, Math.PI * 2);
        ctx.fill();
    });

    // Draw individual data points (jittered horizontally, to the left of the box)
    const dotAreaLeft = padding.left;
    const dotAreaRight = boxLeft - 10;
    const dotAreaMid = (dotAreaLeft + dotAreaRight) / 2;
    const dotAreaWidth = dotAreaRight - dotAreaLeft;
    ctx.fillStyle = 'rgba(0, 90, 156, 0.25)';
    daysData.forEach((val) => {
        if (outliers.includes(val)) return;
        const jitter = (Math.random() - 0.5) * dotAreaWidth * 0.7;
        ctx.beginPath();
        ctx.arc(dotAreaMid + jitter, scale(val), 2.5, 0, Math.PI * 2);
        ctx.fill();
    });

    // Q1 / Q3 labels on the right side
    ctx.fillStyle = '#005A9C';
    ctx.font = '11px Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // Avoid overlap with median/mean labels by checking distance
    const labelPositions = [
        { y: scale(q3), text: `Q3: ${q3}` },
        { y: scale(q1), text: `Q1: ${q1}` }
    ];
    labelPositions.forEach(lbl => {
        ctx.fillText(lbl.text, boxRight + 8, lbl.y);
    });

    // Summary stats grid above the canvas
    if (elements.whiskerPlotStats) {
        elements.whiskerPlotStats.innerHTML = `
            <div class="whisker-stat-card">
                <div class="whisker-stat-value">${n}</div>
                <div class="whisker-stat-label">Students</div>
            </div>
            <div class="whisker-stat-card">
                <div class="whisker-stat-value" style="color:#ef4444;">${median}</div>
                <div class="whisker-stat-label">Median</div>
            </div>
            <div class="whisker-stat-card">
                <div class="whisker-stat-value" style="color:#10b981;">${mean.toFixed(1)}</div>
                <div class="whisker-stat-label">Mean</div>
            </div>
            <div class="whisker-stat-card">
                <div class="whisker-stat-value">${min}–${max}</div>
                <div class="whisker-stat-label">Range</div>
            </div>
        `;
    }

    // Legend as HTML below the canvas
    legend.innerHTML = `
        <div class="whisker-legend-item"><div class="whisker-legend-swatch" style="background:#005A9C; opacity:0.3;"></div> IQR (Q1–Q3)</div>
        <div class="whisker-legend-item"><div class="whisker-legend-swatch" style="background:#ef4444;"></div> Median</div>
        <div class="whisker-legend-item"><div class="whisker-legend-swatch" style="background:#10b981; clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%);"></div> Mean</div>
        <div class="whisker-legend-item"><div class="whisker-legend-swatch" style="background:#f97316; border-radius:50%;"></div> Outliers (${outliers.length})</div>
    `;
}
