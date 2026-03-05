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
        grade: entry.grade || entry.currentGrade || null,
        enrollGpa: entry.enrollGpa || null,
        attendancePercent: entry.attendancePercent || null,
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
        li.setAttribute('data-grade', data.grade || '');
        li.setAttribute('data-gpa', data.enrollGpa || '');
        li.setAttribute('data-attendance', data.attendancePercent || '');
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
 * Distribution type configurations for the whisker plot
 */
const DISTRIBUTION_TYPES = {
    daysOut: { attr: 'data-days', label: 'Days Out', unit: 'days', parse: v => parseInt(v), isValid: v => v !== '' && !isNaN(parseInt(v)) },
    grade: { attr: 'data-grade', label: 'Grade', unit: '%', parse: v => parseFloat(v), isValid: v => v !== '' && !isNaN(parseFloat(v)) },
    missing: { attr: 'data-missing', label: 'Missing Assignments', unit: '', parse: v => parseInt(v), isValid: v => v !== '' && !isNaN(parseInt(v)) },
    gpa: { attr: 'data-gpa', label: 'GPA', unit: '', parse: v => parseFloat(v), isValid: v => v !== '' && !isNaN(parseFloat(v)) },
    attendance: { attr: 'data-attendance', label: 'Attendance %', unit: '%', parse: v => { const n = parseFloat(v); return n <= 1 ? Math.round(n * 100) : Math.round(n); }, isValid: v => v !== '' && v !== '0' && !isNaN(parseFloat(v)) }
};

/**
 * Bucket configurations for histogram and pie chart per distribution type.
 * Each bucket: { label, min (inclusive), max (exclusive, except last bucket) }
 */
const BUCKET_CONFIGS = {
    daysOut: [
        { label: '0–2', min: 0, max: 3, color: '#22c55e' },
        { label: '3–5', min: 3, max: 6, color: '#eab308' },
        { label: '6–10', min: 6, max: 11, color: '#f97316' },
        { label: '11+', min: 11, max: Infinity, color: '#ef4444' }
    ],
    grade: [
        { label: 'A (90–100)', min: 90, max: 101, color: '#22c55e' },
        { label: 'B (80–89)', min: 80, max: 90, color: '#3b82f6' },
        { label: 'C (70–79)', min: 70, max: 80, color: '#eab308' },
        { label: 'D (60–69)', min: 60, max: 70, color: '#f97316' },
        { label: 'F (0–59)', min: 0, max: 60, color: '#ef4444' }
    ],
    missing: [
        { label: '0', min: 0, max: 1, color: '#22c55e' },
        { label: '1–2', min: 1, max: 3, color: '#eab308' },
        { label: '3–5', min: 3, max: 6, color: '#f97316' },
        { label: '6+', min: 6, max: Infinity, color: '#ef4444' }
    ],
    gpa: [
        { label: '3.5–4.0', min: 3.5, max: 4.01, color: '#22c55e' },
        { label: '3.0–3.49', min: 3.0, max: 3.5, color: '#3b82f6' },
        { label: '2.5–2.99', min: 2.5, max: 3.0, color: '#eab308' },
        { label: '2.0–2.49', min: 2.0, max: 2.5, color: '#f97316' },
        { label: '< 2.0', min: 0, max: 2.0, color: '#ef4444' }
    ],
    attendance: [
        { label: '90–100%', min: 90, max: 101, color: '#22c55e' },
        { label: '80–89%', min: 80, max: 90, color: '#3b82f6' },
        { label: '70–79%', min: 70, max: 80, color: '#eab308' },
        { label: '< 70%', min: 0, max: 70, color: '#ef4444' }
    ]
};

/** Currently selected chart type */
let currentChartType = 'whisker';

/**
 * Extracts sorted numeric data from the master list for a given distribution type
 */
function extractChartData(distributionType) {
    const type = distributionType || elements.distributionSelect?.value || 'daysOut';
    const config = DISTRIBUTION_TYPES[type] || DISTRIBUTION_TYPES.daysOut;
    const listItems = Array.from(elements.masterList?.querySelectorAll('li.expandable') || []);
    const data = listItems
        .map(li => li.getAttribute(config.attr) || '')
        .filter(v => config.isValid(v))
        .map(v => config.parse(v))
        .sort((a, b) => a - b);
    return { data, type, config };
}

/**
 * Prepares canvas for drawing and returns context + dimensions, or null if no data
 */
function prepareCanvas(data, config) {
    const canvas = elements.whiskerPlotCanvas;
    const legend = elements.whiskerPlotLegend;
    if (!canvas || !legend) return null;

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

    if (data.length === 0) {
        ctx.fillStyle = '#6b7280';
        ctx.font = '14px Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`No ${config.label.toLowerCase()} data available`, width / 2, height / 2);
        legend.innerHTML = '';
        if (elements.whiskerPlotStats) elements.whiskerPlotStats.innerHTML = '';
        return null;
    }

    return { ctx, width, height, legend, canvas };
}

/**
 * Updates the distribution dropdown, greying out options with no data
 */
export function updateDistributionDropdown() {
    const select = elements.distributionSelect;
    if (!select) return;

    const listItems = Array.from(elements.masterList?.querySelectorAll('li.expandable') || []);

    Array.from(select.options).forEach(option => {
        const type = DISTRIBUTION_TYPES[option.value];
        if (!type) return;
        const hasData = listItems.some(li => type.isValid(li.getAttribute(type.attr) || ''));
        option.disabled = !hasData;
        option.title = hasData ? '' : 'No data available';
    });
}

/**
 * Renders a vertical box-and-whisker plot on a canvas
 * @param {string} [distributionType] - The type of distribution to render (default: current dropdown value)
 */
export function renderWhiskerPlot(distributionType) {
    const { data: daysData, type, config } = extractChartData(distributionType);
    const prepared = prepareCanvas(daysData, config);
    if (!prepared) return;
    const { ctx, width, height, legend } = prepared;

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
    const upperOutliers = daysData.filter(v => v > upperFence);
    const lowerOutliers = daysData.filter(v => v < lowerFence);
    const outliers = [...lowerOutliers, ...upperOutliers];
    const hasUpperOutliers = upperOutliers.length > 0;

    // Vertical layout: Y-axis = days out (top = high, bottom = low)
    const padding = { top: 30, bottom: 40, left: 55, right: 30 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    // Box occupies the center horizontal band
    const boxLeft = padding.left + plotWidth * 0.3;
    const boxRight = padding.left + plotWidth * 0.7;
    const boxWidth = boxRight - boxLeft;
    const midX = (boxLeft + boxRight) / 2;

    // Split-axis scale: give the fence region (where the box lives) most of the space
    // and compress outliers into a smaller top zone
    const outlierZoneRatio = hasUpperOutliers ? 0.25 : 0; // top 25% for outliers if they exist
    const breakGap = hasUpperOutliers ? 12 : 0; // gap for axis break indicator
    const mainZoneBottom = padding.top + plotHeight;
    const mainZoneTop = padding.top + plotHeight * outlierZoneRatio + breakGap;
    const mainZoneHeight = mainZoneBottom - mainZoneTop;
    const outlierZoneTop = padding.top;
    const outlierZoneBottom = padding.top + plotHeight * outlierZoneRatio;

    // Main zone maps: lowerFence..upperFence (or min..upperFence if no lower outliers)
    const mainMin = Math.min(lowerFence, min);
    const mainMax = upperFence;
    const mainRange = mainMax - mainMin || 1;

    // Scale for main zone (fence region)
    const scaleMain = (val) => {
        const ratio = (val - mainMin) / mainRange;
        return mainZoneBottom - ratio * mainZoneHeight;
    };

    // Scale for outlier zone (above upper fence)
    const outlierMax = max;
    const outlierRange = outlierMax - upperFence || 1;
    const scaleOutlier = (val) => {
        const ratio = (val - upperFence) / outlierRange;
        return outlierZoneBottom - ratio * (outlierZoneBottom - outlierZoneTop);
    };

    // Unified scale function
    const scale = (val) => {
        if (val <= upperFence || !hasUpperOutliers) {
            return scaleMain(Math.max(mainMin, Math.min(val, mainMax)));
        }
        return scaleOutlier(val);
    };

    // Draw horizontal grid lines for main zone
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
    ctx.lineWidth = 1;
    const mainGridSteps = 4;
    ctx.fillStyle = '#6b7280';
    ctx.font = '12px Roboto, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const fmtGrid = (v) => type === 'gpa' ? v.toFixed(1) : Math.round(v);
    for (let i = 0; i <= mainGridSteps; i++) {
        const val = mainMin + (i / mainGridSteps) * mainRange;
        const displayVal = type === 'gpa' ? val : Math.round(val);
        const y = scaleMain(displayVal);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
        ctx.beginPath();
        ctx.moveTo(padding.left - 5, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();
        ctx.fillStyle = '#6b7280';
        ctx.fillText(fmtGrid(val), padding.left - 10, y);
    }

    // Draw axis break and outlier zone labels if outliers exist
    if (hasUpperOutliers) {
        // Axis break indicator (zigzag)
        const breakY = mainZoneTop - breakGap / 2;
        ctx.strokeStyle = '#9ca3af';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const zigW = 6;
        const zigH = 4;
        const startX = padding.left - 8;
        ctx.moveTo(startX, breakY - zigH);
        for (let x = startX; x < width - padding.right + 8; x += zigW * 2) {
            ctx.lineTo(x + zigW, breakY + zigH);
            ctx.lineTo(x + zigW * 2, breakY - zigH);
        }
        ctx.stroke();

        // Outlier zone grid lines (fewer, just min/max)
        const outlierLabels = [upperFence + 1, max];
        // Remove duplicates and sort
        const roundOutlier = (v) => type === 'gpa' ? Math.round(v * 10) / 10 : Math.round(v);
        const uniqueLabels = [...new Set(outlierLabels.map(roundOutlier))].sort((a, b) => a - b);
        uniqueLabels.forEach(val => {
            if (val <= upperFence) return;
            const y = scaleOutlier(val);
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.04)';
            ctx.beginPath();
            ctx.moveTo(padding.left - 5, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
            ctx.fillStyle = '#9ca3af';
            ctx.font = '11px Roboto, sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(fmtGrid(val), padding.left - 10, y);
        });
    }

    // Y-axis title
    ctx.save();
    ctx.translate(14, padding.top + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.font = '12px Roboto, sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.fillText(config.label, 0, 0);
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
    const boxY = scale(q3);
    const boxH = scale(q1) - scale(q3);
    // Ensure minimum box height for readability
    const minBoxH = Math.max(boxH, 30);
    const boxYAdj = boxH < 30 ? boxY - (30 - boxH) / 2 : boxY;
    ctx.fillStyle = 'rgba(0, 90, 156, 0.15)';
    ctx.fillRect(boxLeft, boxYAdj, boxWidth, minBoxH);
    ctx.strokeStyle = '#005A9C';
    ctx.lineWidth = 2;
    ctx.strokeRect(boxLeft, boxYAdj, boxWidth, minBoxH);

    // Draw median line (horizontal across the box)
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(boxLeft, scale(median));
    ctx.lineTo(boxRight, scale(median));
    ctx.stroke();

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

    // Formatting helpers (used in labels and stats)
    const isDecimal = type === 'gpa';
    const fmtVal = (v) => isDecimal ? v.toFixed(2) : v;

    // Labels on the right side — collect all and space them to avoid overlap
    const rightLabels = [
        { y: scale(q3), text: `Q3: ${fmtVal(q3)}`, color: '#005A9C', font: '11px Roboto, sans-serif' },
        { y: scale(median), text: `Median: ${fmtVal(median)}`, color: '#ef4444', font: 'bold 12px Roboto, sans-serif' },
        { y: scale(mean), text: `Mean: ${isDecimal ? mean.toFixed(2) : mean.toFixed(1)}`, color: '#10b981', font: '11px Roboto, sans-serif' },
        { y: scale(q1), text: `Q1: ${fmtVal(q1)}`, color: '#005A9C', font: '11px Roboto, sans-serif' }
    ].sort((a, b) => a.y - b.y);

    // Push labels apart so they don't overlap (minimum 14px spacing)
    const minSpacing = 14;
    for (let i = 1; i < rightLabels.length; i++) {
        if (rightLabels[i].y - rightLabels[i - 1].y < minSpacing) {
            rightLabels[i].y = rightLabels[i - 1].y + minSpacing;
        }
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    rightLabels.forEach(lbl => {
        ctx.fillStyle = lbl.color;
        ctx.font = lbl.font;
        ctx.fillText(lbl.text, boxRight + 8, lbl.y);
    });

    // Draw outliers in the outlier zone
    ctx.fillStyle = '#f97316';
    upperOutliers.forEach(val => {
        const jitter = (Math.random() - 0.5) * boxWidth * 0.5;
        ctx.beginPath();
        ctx.arc(midX + jitter, scale(val), 4, 0, Math.PI * 2);
        ctx.fill();
    });
    lowerOutliers.forEach(val => {
        const jitter = (Math.random() - 0.5) * boxWidth * 0.5;
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
        if (val > upperFence || val < lowerFence) return;
        const jitter = (Math.random() - 0.5) * dotAreaWidth * 0.7;
        ctx.beginPath();
        ctx.arc(dotAreaMid + jitter, scale(val), 2.5, 0, Math.PI * 2);
        ctx.fill();
    });

    // Summary stats grid above the canvas
    if (elements.whiskerPlotStats) {
        elements.whiskerPlotStats.innerHTML = `
            <div class="whisker-stat-card">
                <div class="whisker-stat-value">${n}</div>
                <div class="whisker-stat-label">Students</div>
            </div>
            <div class="whisker-stat-card">
                <div class="whisker-stat-value" style="color:#ef4444;">${fmtVal(median)}</div>
                <div class="whisker-stat-label">Median</div>
            </div>
            <div class="whisker-stat-card">
                <div class="whisker-stat-value" style="color:#10b981;">${isDecimal ? mean.toFixed(2) : mean.toFixed(1)}</div>
                <div class="whisker-stat-label">Mean</div>
            </div>
            <div class="whisker-stat-card">
                <div class="whisker-stat-value">${fmtVal(min)}–${fmtVal(max)}</div>
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

/**
 * Renders a histogram (bar chart) on the canvas
 */
function renderHistogram(distributionType) {
    const { data, type, config } = extractChartData(distributionType);
    const prepared = prepareCanvas(data, config);
    if (!prepared) return;
    const { ctx, width, height, legend } = prepared;

    const buckets = BUCKET_CONFIGS[type] || BUCKET_CONFIGS.daysOut;
    const counts = buckets.map(b => ({
        ...b,
        count: data.filter(v => v >= b.min && v < b.max).length
    }));
    const maxCount = Math.max(...counts.map(c => c.count), 1);
    const n = data.length;
    const mean = data.reduce((s, v) => s + v, 0) / n;
    const median = data[Math.floor(n * 0.5)];
    const min = data[0];
    const max = data[n - 1];
    const isDecimal = type === 'gpa';
    const fmtVal = (v) => isDecimal ? v.toFixed(2) : v;

    const padding = { top: 30, bottom: 60, left: 45, right: 20 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;
    const barGap = 8;
    const barW = (plotW - barGap * (counts.length - 1)) / counts.length;

    // Y-axis grid lines and labels
    ctx.fillStyle = '#6b7280';
    ctx.font = '11px Roboto, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
        const val = Math.round((i / ySteps) * maxCount);
        const y = padding.top + plotH - (val / maxCount) * plotH;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding.left - 5, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();
        ctx.fillStyle = '#6b7280';
        ctx.fillText(val, padding.left - 8, y);
    }

    // Y-axis title
    ctx.save();
    ctx.translate(12, padding.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.font = '12px Roboto, sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.fillText('Students', 0, 0);
    ctx.restore();

    // Draw bars
    counts.forEach((bucket, i) => {
        const x = padding.left + i * (barW + barGap);
        const barH = (bucket.count / maxCount) * plotH;
        const y = padding.top + plotH - barH;

        // Bar fill
        ctx.fillStyle = bucket.color;
        ctx.beginPath();
        const radius = Math.min(4, barW / 4);
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + barW - radius, y);
        ctx.quadraticCurveTo(x + barW, y, x + barW, y + radius);
        ctx.lineTo(x + barW, padding.top + plotH);
        ctx.lineTo(x, padding.top + plotH);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.fill();

        // Count label above bar
        if (bucket.count > 0) {
            ctx.fillStyle = '#374151';
            ctx.font = 'bold 11px Roboto, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(bucket.count, x + barW / 2, y - 4);
        }

        // X-axis label
        ctx.fillStyle = '#6b7280';
        ctx.font = '11px Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(bucket.label, x + barW / 2, padding.top + plotH + 8);
    });

    // X-axis label
    ctx.fillStyle = '#6b7280';
    ctx.font = '12px Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(config.label, padding.left + plotW / 2, height - 8);

    // Stats
    if (elements.whiskerPlotStats) {
        elements.whiskerPlotStats.innerHTML = `
            <div class="whisker-stat-card">
                <div class="whisker-stat-value">${n}</div>
                <div class="whisker-stat-label">Students</div>
            </div>
            <div class="whisker-stat-card">
                <div class="whisker-stat-value" style="color:#ef4444;">${fmtVal(median)}</div>
                <div class="whisker-stat-label">Median</div>
            </div>
            <div class="whisker-stat-card">
                <div class="whisker-stat-value" style="color:#10b981;">${isDecimal ? mean.toFixed(2) : mean.toFixed(1)}</div>
                <div class="whisker-stat-label">Mean</div>
            </div>
            <div class="whisker-stat-card">
                <div class="whisker-stat-value">${fmtVal(min)}–${fmtVal(max)}</div>
                <div class="whisker-stat-label">Range</div>
            </div>
        `;
    }

    // Legend
    legend.innerHTML = counts.map(b =>
        `<div class="whisker-legend-item"><div class="whisker-legend-swatch" style="background:${b.color};"></div> ${b.label} (${b.count})</div>`
    ).join('');
}

/**
 * Renders a pie/donut chart on the canvas
 */
function renderPieChart(distributionType) {
    const { data, type, config } = extractChartData(distributionType);
    const prepared = prepareCanvas(data, config);
    if (!prepared) return;
    const { ctx, width, height, legend } = prepared;

    const buckets = BUCKET_CONFIGS[type] || BUCKET_CONFIGS.daysOut;
    const counts = buckets.map(b => ({
        ...b,
        count: data.filter(v => v >= b.min && v < b.max).length
    }));
    const n = data.length;
    const mean = data.reduce((s, v) => s + v, 0) / n;
    const median = data[Math.floor(n * 0.5)];
    const min = data[0];
    const max = data[n - 1];
    const isDecimal = type === 'gpa';
    const fmtVal = (v) => isDecimal ? v.toFixed(2) : v;

    const centerX = width / 2;
    const centerY = height / 2 + 5;
    const outerR = Math.min(width, height) / 2 - 40;
    const innerR = outerR * 0.5; // donut hole

    let startAngle = -Math.PI / 2; // start at 12 o'clock

    counts.forEach(bucket => {
        if (bucket.count === 0) return;
        const sliceAngle = (bucket.count / n) * Math.PI * 2;
        const endAngle = startAngle + sliceAngle;

        // Draw slice
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerR, startAngle, endAngle);
        ctx.arc(centerX, centerY, innerR, endAngle, startAngle, true);
        ctx.closePath();
        ctx.fillStyle = bucket.color;
        ctx.fill();

        // Thin white border between slices
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Percentage label on slice (only if large enough)
        const pct = ((bucket.count / n) * 100);
        if (pct >= 5) {
            const midAngle = startAngle + sliceAngle / 2;
            const labelR = (outerR + innerR) / 2;
            const lx = centerX + Math.cos(midAngle) * labelR;
            const ly = centerY + Math.sin(midAngle) * labelR;

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px Roboto, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${Math.round(pct)}%`, lx, ly);
        }

        startAngle = endAngle;
    });

    // Center text
    ctx.fillStyle = '#374151';
    ctx.font = 'bold 20px Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n, centerX, centerY - 8);
    ctx.fillStyle = '#9ca3af';
    ctx.font = '11px Roboto, sans-serif';
    ctx.fillText('Students', centerX, centerY + 10);

    // Stats
    if (elements.whiskerPlotStats) {
        elements.whiskerPlotStats.innerHTML = `
            <div class="whisker-stat-card">
                <div class="whisker-stat-value">${n}</div>
                <div class="whisker-stat-label">Students</div>
            </div>
            <div class="whisker-stat-card">
                <div class="whisker-stat-value" style="color:#ef4444;">${fmtVal(median)}</div>
                <div class="whisker-stat-label">Median</div>
            </div>
            <div class="whisker-stat-card">
                <div class="whisker-stat-value" style="color:#10b981;">${isDecimal ? mean.toFixed(2) : mean.toFixed(1)}</div>
                <div class="whisker-stat-label">Mean</div>
            </div>
            <div class="whisker-stat-card">
                <div class="whisker-stat-value">${fmtVal(min)}–${fmtVal(max)}</div>
                <div class="whisker-stat-label">Range</div>
            </div>
        `;
    }

    // Legend
    legend.innerHTML = counts.map(b =>
        `<div class="whisker-legend-item"><div class="whisker-legend-swatch" style="background:${b.color};"></div> ${b.label} (${b.count})</div>`
    ).join('');
}

/**
 * Main chart dispatcher — renders the selected chart type
 */
export function renderChart(distributionType) {
    const type = distributionType || elements.distributionSelect?.value || 'daysOut';
    switch (currentChartType) {
        case 'histogram':
            renderHistogram(type);
            break;
        case 'pie':
            renderPieChart(type);
            break;
        case 'whisker':
        default:
            renderWhiskerPlot(type);
            break;
    }
    // Update active toggle state
    updateChartToggleState();
}

/**
 * Sets the current chart type and re-renders
 */
export function setChartType(chartType) {
    currentChartType = chartType;
    renderChart();
}

/**
 * Updates the visual state of chart toggle buttons
 */
function updateChartToggleState() {
    const container = document.getElementById('chartTypeToggle');
    if (!container) return;
    container.querySelectorAll('.chart-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.chart === currentChartType);
    });
}
