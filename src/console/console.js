/**
 * SRK Console — standalone tab that receives and displays logs from the side panel.
 *
 * Communication:
 *   Side panel stores logs in chrome.storage.local under 'srk_console_logs'.
 *   It also sends a runtime message { type: 'SRK_CONSOLE_LOG', entry } for live updates.
 *   On open, the console reads the stored log buffer to show history.
 */

const output = document.getElementById('output');
const emptyState = document.getElementById('emptyState');
const logCountBadge = document.getElementById('logCount');
const statusText = document.getElementById('statusText');
const statusDetail = document.getElementById('statusDetail');
const statusBar = document.getElementById('statusBar');
const searchInput = document.getElementById('searchInput');

let allEntries = [];
let activeFilter = 'all';
let searchTerm = '';
let autoScroll = true;

// ── Rendering ──────────────────────────────────────────────

function renderEntry(entry) {
    const div = document.createElement('div');
    div.className = `log-entry ${entry.type}`;
    div.dataset.level = entry.type;

    const ts = document.createElement('span');
    ts.className = 'timestamp';
    ts.textContent = entry.timestamp;

    const lvl = document.createElement('span');
    lvl.className = 'level';
    lvl.textContent = entry.type;

    const msg = document.createElement('span');
    msg.className = 'message';
    msg.textContent = entry.message;

    div.appendChild(ts);
    div.appendChild(lvl);
    div.appendChild(msg);

    return div;
}

function shouldShow(entry) {
    if (activeFilter !== 'all' && entry.type !== activeFilter) return false;
    if (searchTerm && !entry.message.toLowerCase().includes(searchTerm)) return false;
    return true;
}

function rebuildOutput() {
    // Clear existing entries (keep empty state hidden)
    output.innerHTML = '';
    let visible = 0;

    for (const entry of allEntries) {
        if (shouldShow(entry)) {
            output.appendChild(renderEntry(entry));
            visible++;
        }
    }

    if (visible === 0 && allEntries.length === 0) {
        output.appendChild(emptyState);
        emptyState.classList.remove('hidden');
    }

    updateCount();
    if (autoScroll) scrollToBottom();
}

function appendEntry(entry) {
    emptyState.classList.add('hidden');

    if (shouldShow(entry)) {
        output.appendChild(renderEntry(entry));
        if (autoScroll) scrollToBottom();
    }

    updateCount();
}

function updateCount() {
    const visible = output.querySelectorAll('.log-entry').length;
    logCountBadge.textContent = `${visible} ${visible === 1 ? 'entry' : 'entries'}`;
}

function scrollToBottom() {
    output.scrollTop = output.scrollHeight;
}

// ── Detect custom types (same logic as sidepanel) ──────────

function detectCustomType(type, message) {
    if (message.includes('Sending payload to Office Add-in') || message.includes('SRK_HIGHLIGHT_STUDENT_ROW')) {
        return 'ping';
    }
    if (message.includes('onSubmissionFound triggered') || message.includes('Submission Found')) {
        return 'submission';
    }
    return type;
}

// ── Load history from storage ──────────────────────────────

async function loadHistory() {
    try {
        const data = await chrome.storage.local.get('srk_console_logs');
        const logs = data.srk_console_logs || [];
        allEntries = logs;
        rebuildOutput();
        statusDetail.textContent = `${logs.length} entries loaded`;
    } catch (e) {
        statusBar.className = 'status-bar disconnected';
        statusText.textContent = 'Error loading logs';
    }
}

// ── Live message listener ──────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SRK_CONSOLE_LOG' && msg.entry) {
        allEntries.push(msg.entry);
        appendEntry(msg.entry);

        // Cap local array to 500
        if (allEntries.length > 500) {
            allEntries = allEntries.slice(-500);
        }
    }
});

// ── Toolbar actions ────────────────────────────────────────

document.getElementById('clearBtn').addEventListener('click', () => {
    allEntries = [];
    chrome.storage.local.set({ srk_console_logs: [] });
    output.innerHTML = '';
    output.appendChild(emptyState);
    emptyState.classList.remove('hidden');
    updateCount();
});

document.getElementById('scrollBottomBtn').addEventListener('click', () => {
    scrollToBottom();
});

// Auto-scroll detection: disable when user scrolls up, re-enable at bottom
output.addEventListener('scroll', () => {
    const atBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
    autoScroll = atBottom;
});

// ── Filter buttons ─────────────────────────────────────────

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.dataset.level;
        rebuildOutput();
    });
});

// ── Search ─────────────────────────────────────────────────

searchInput.addEventListener('input', () => {
    searchTerm = searchInput.value.toLowerCase().trim();
    rebuildOutput();
});

// ── Init ───────────────────────────────────────────────────

loadHistory();
