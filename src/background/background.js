// [2025-12-17 01:25 PM]
// Version: 14.5 - Organized Storage Structure
import { startLoop, stopLoop, addToFoundUrlCache } from './looper.js';
import { STORAGE_KEYS, CHECKER_MODES, MESSAGE_TYPES, EXTENSION_STATES, CONNECTION_TYPES, FIVE9_CONNECTION_STATES, CANVAS_DOMAIN, HIGHLIGHT_STATUS } from '../constants/index.js';
import { storageGet, storageSet, storageGetValue, migrateStorage, sessionGet, sessionSet, sessionGetValue } from '../utils/storage.js';
import { decrypt } from '../utils/encryption.js';

let logBuffer = [];
const MAX_LOG_BUFFER_SIZE = 100;

/**
 * Safely sends a message to the sidepanel/runtime.
 * Silently ignores "receiving end does not exist" errors (sidepanel closed).
 * Logs unexpected errors for debugging.
 * @param {Object} message - The message to send
 * @param {string} context - Description for error logging (e.g., "log to panel")
 */
function safeSendMessage(message, context = 'message') {
    chrome.runtime.sendMessage(message).catch(err => {
        // Ignore expected error when sidepanel is not open
        if (err?.message?.includes('Receiving end does not exist')) {
            return;
        }
        // Log unexpected errors
        originalConsole.error(`[Background] Failed to send ${context}:`, err?.message || err);
    });
}

// --- State for collecting missing assignment results ---
let missingAssignmentsCollector = [];
let missingCheckStartTime = null;

// --- Five9 Connection State Tracking ---
let five9ConnectionState = FIVE9_CONNECTION_STATES.NO_TAB;
let lastAgentConnectionTime = null;

function addToLogBuffer(level, payload) {
    logBuffer.push({ level, payload, timestamp: new Date().toISOString() });
    if (logBuffer.length > MAX_LOG_BUFFER_SIZE) {
        logBuffer.shift();
    }
}

// Intercept console logs and send to sidepanel
const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info
};

function sendLogToPanel(level, args) {
    safeSendMessage({
        type: MESSAGE_TYPES.LOG_TO_PANEL,
        level: level,
        args: args
    }, 'log to panel');
}

console.log = function(...args) {
    originalConsole.log.apply(console, args);
    sendLogToPanel('log', args);
};

console.warn = function(...args) {
    originalConsole.warn.apply(console, args);
    sendLogToPanel('warn', args);
};

console.error = function(...args) {
    originalConsole.error.apply(console, args);
    sendLogToPanel('error', args);
};

console.info = function(...args) {
    originalConsole.info.apply(console, args);
    sendLogToPanel('info', args);
};

// --- CALLBACKS FOR LOOPER ---

// Handle found submissions (Submission Mode)
async function onSubmissionFound(entry) {
    console.log('%c [SRK] onSubmissionFound triggered', 'background: #2196F3; color: white; font-weight: bold; padding: 2px 4px;', entry);

    await addStudentToFoundList(entry);
    await sendConnectionPings(entry);
    await sendHighlightStudentRowPayload(entry);
    await sendPowerAutomateRequest(entry);

    const logPayload = { type: 'SUBMISSION', ...entry };
    addToLogBuffer('log', logPayload);
    safeSendMessage({ type: MESSAGE_TYPES.LOG_TO_PANEL, level: 'log', payload: logPayload }, 'submission log');
}

/**
 * Converts student name from "Last, First" format to "First Last" format
 * @param {string} name - The student name to convert
 * @returns {string} The converted name in "First Last" format
 */
function convertNameToFirstLast(name) {
    if (!name || typeof name !== 'string') return name || '';

    // Check if the name contains a comma (Last, First format)
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
 * Sends HTTP request to Power Automate when a submission is found
 * @param {Object} entry - The found submission entry
 */
async function sendPowerAutomateRequest(entry) {
    try {
        // Get Power Automate settings
        const settings = await storageGet([
            STORAGE_KEYS.POWER_AUTOMATE_URL,
            STORAGE_KEYS.POWER_AUTOMATE_ENABLED,
            STORAGE_KEYS.POWER_AUTOMATE_DEBUG
        ]);

        const encryptedUrl = settings[STORAGE_KEYS.POWER_AUTOMATE_URL];
        const enabled = settings[STORAGE_KEYS.POWER_AUTOMATE_ENABLED];
        const debug = settings[STORAGE_KEYS.POWER_AUTOMATE_DEBUG];

        // Skip if not enabled or no URL configured
        if (!enabled || !encryptedUrl || !encryptedUrl.trim()) {
            return;
        }

        // Decrypt the URL
        const url = await decrypt(encryptedUrl);

        // Build payload - convert name to "First Last" format
        const payload = {
            name: convertNameToFirstLast(entry.name),
            assignment: entry.assignment || '',
            url: entry.url || ''
        };

        // Add debug flag if debug mode is enabled
        if (debug) {
            payload.debug = true;
        }

        console.log('%c [Power Automate] Sending HTTP request', 'background: #0078D4; color: white; font-weight: bold; padding: 2px 4px;', payload);

        // Send HTTP request
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.ok || response.status === 202) {
            console.log('%c [Power Automate] Request successful', 'background: #107C10; color: white; font-weight: bold; padding: 2px 4px;');
        } else {
            console.warn(`[Power Automate] Request failed with status: ${response.status}`);
        }
    } catch (error) {
        console.error('[Power Automate] Error sending request:', error);
    }
}

// Handle found missing assignments (Missing Mode)
function onMissingFound(payload) {
    missingAssignmentsCollector.push(payload);
    
    const logMessage = payload.count > 0 
          ? `Missing Found: ${payload.studentName} (${payload.count})`
          : `Clean: ${payload.studentName}`;
          
    safeSendMessage({
        type: MESSAGE_TYPES.LOG_TO_PANEL,
        level: payload.count > 0 ? 'warn' : 'log',
        args: [ logMessage ]
    }, 'missing assignment log');
}

async function onMissingCheckCompleted() {
    console.log("MESSAGE RECEIVED: MISSING_CHECK_COMPLETED");
    const completionEndTime = Date.now();
    const settings = await chrome.storage.local.get(STORAGE_KEYS.INCLUDE_ALL_ASSIGNMENTS);
    const includeAll = settings[STORAGE_KEYS.INCLUDE_ALL_ASSIGNMENTS];

    let finalPayload;

    if (missingAssignmentsCollector.length > 0) {
        const transformedData = missingAssignmentsCollector.map(studentReport => {
            const transformedAssignments = studentReport.assignments.map(assignment => ({
                assignmentTitle: assignment.assignmentTitle || assignment.title || '',
                assignmentLink: assignment.assignmentLink || assignment.link || '',
                submissionLink: assignment.submissionLink || '',
                dueDate: assignment.dueDate || '',
                score: assignment.score || ''
            }));

            return {
                studentName: studentReport.studentName,
                studentGrade: studentReport.currentGrade,
                totalMissing: studentReport.count,
                gradeBook: studentReport.gradeBook,
                assignments: transformedAssignments,
                gradeBookLink: studentReport.gradeBook 
            };
        });
        
        const studentsWithMissingCount = missingAssignmentsCollector.filter(studentReport => 
            studentReport.count > 0
        ).length;

        // --- Performance Calculations ---
        let totalCompletionTime = null;
        if (missingCheckStartTime) {
            totalCompletionTime = `${((completionEndTime - missingCheckStartTime) / 1000).toFixed(2)} seconds`;
        }
        
        finalPayload = {
            reportGenerated: new Date().toISOString(),
            totalStudentsInReport: missingAssignmentsCollector.length,
            totalStudentsWithMissing: studentsWithMissingCount,
            totalCompletionTime: totalCompletionTime,
            type: "MISSING_ASSIGNMENTS_REPORT",
            mode: "API_HEADLESS",
            CUSTOM_IMPORT: {
                importName: "Missing Assignments Report",
                dataArrayKey: "assignments",
                targetSheet: "Missing Assignments",
                overwriteTargetSheet: true,
                sheetKeyColumn: ["submissionLink", "Grade Book"],
                columnMappings: [
                  { source: "studentName", target: "Student Name" },
                  { source: "studentGrade", target: ["grade", "Grade"] },
                  { source: "totalMissing", target: "Missing Assignments" },
                  { source: "assignmentTitle", target: "Assignment Title" },
                  { source: "dueDate", target: "Due Date" },
                  { source: "score", target: "Score" },
                  { source: "gradeBook", target: "Grade Book" },
                  { source: "submissionLink", target: "submissionLink" },
                  { source: "gradeBookLink", target: "gradeBookLink" }
                ],
                data: transformedData
            }
        };
        
        await sendConnectionPings(finalPayload);

        safeSendMessage({
            type: MESSAGE_TYPES.LOG_TO_PANEL,
            level: 'warn',
            args: [ `Final Missing Assignments Report (API Mode)`, finalPayload ]
        }, 'missing report');
        
        addToLogBuffer('warn', finalPayload);
        
    } else {
        const successMessage = "Missing Assignments Check Complete: No missing assignments were found.";
        finalPayload = { 
            reportGenerated: new Date().toISOString(),
            totalStudentsInReport: 0,
            totalStudentsWithMissing: 0,
            type: 'MISSING_ASSIGNMENTS_REPORT',
            message: successMessage,
            CUSTOM_IMPORT: { data: [] }
        };
        addToLogBuffer('log', finalPayload);
        
        safeSendMessage({
            type: MESSAGE_TYPES.LOG_TO_PANEL,
            level: 'log',
            args: [ successMessage ]
        }, 'success message');
    }
    
    await chrome.storage.local.set({ [STORAGE_KEYS.LATEST_MISSING_REPORT]: finalPayload });
    
    missingCheckStartTime = null;

    safeSendMessage({
        type: MESSAGE_TYPES.SHOW_MISSING_ASSIGNMENTS_REPORT,
        payload: finalPayload
    }, 'missing assignments report');
    
    await sessionSet({ [STORAGE_KEYS.EXTENSION_STATE]: EXTENSION_STATES.OFF });
}

// --- CORE LISTENERS ---

chrome.action.onClicked.addListener((tab) => chrome.sidePanel.open({ tabId: tab.id }));
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === '_execute_action') chrome.sidePanel.open({ tabId: tab.id });
});
chrome.runtime.onStartup.addListener(async () => {
  updateBadge();
  // Extension state is now in session storage - starts fresh on browser restart
  const state = await sessionGetValue(STORAGE_KEYS.EXTENSION_STATE, EXTENSION_STATES.OFF);
  handleStateChange(state);
});

// Listen for session storage changes (for EXTENSION_STATE)
chrome.storage.session.onChanged.addListener((changes) => {
  // Handle nested storage structure for EXTENSION_STATE (stored under 'state.extensionState')
  // The change event reports changes by root key ('state'), not the full nested path
  if (changes.state) {
    const oldState = changes.state.oldValue?.extensionState;
    const newState = changes.state.newValue?.extensionState;
    if (newState !== undefined && newState !== oldState) {
      handleStateChange(newState, oldState);
    }
  }
});

// Listen for local storage changes (for FOUND_ENTRIES badge updates)
chrome.storage.local.onChanged.addListener((changes) => {
  // Update badge when found entries change
  if (changes.foundEntries || changes.data) {
    updateBadge();
  }
});

chrome.webRequest.onErrorOccurred.addListener(
  async (details) => {
    if (details.url.includes('/api/v1/courses/')) {
        console.warn('API Connection Error:', details.error);
    }
  },
  { urls: [`${CANVAS_DOMAIN}/api/*`] }
);

// Five9 Network Monitoring - Detect agent connection
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    // Detect successful POST to agent-connection endpoint
    if (details.method === 'POST' &&
        details.url.includes('/voice-events/agent-connection') &&
        details.statusCode === 204) {

      lastAgentConnectionTime = Date.now();
      const previousState = five9ConnectionState;
      five9ConnectionState = FIVE9_CONNECTION_STATES.ACTIVE_CONNECTION;

      // Store in chrome.storage for persistence
      await chrome.storage.local.set({
        five9ConnectionState: FIVE9_CONNECTION_STATES.ACTIVE_CONNECTION,
        lastAgentConnectionTime: lastAgentConnectionTime
      });

      // Notify sidepanel of state change
      safeSendMessage({
        type: 'FIVE9_CONNECTION_STATE_CHANGED',
        state: FIVE9_CONNECTION_STATES.ACTIVE_CONNECTION
      }, 'Five9 connection state');
    }
  },
  { urls: ["https://*.five9.net/*"] }
);

// Pre-cache the manifest XML into chrome.storage.local so content scripts
// (especially those in cross-origin iframes) can read it without messaging.
async function cacheManifestXml() {
    try {
        const response = await fetch(chrome.runtime.getURL('assets/Excel Add-In Manifest.xml'));
        const xml = await response.text();
        await chrome.storage.local.set({ _manifestXmlCache: xml });
        console.log('[SRK] Manifest XML cached in storage');
    } catch (err) {
        console.warn('[SRK] Failed to cache manifest XML:', err.message);
    }
}

// Separate non-async listener for manifest XML requests.
// Must NOT be async — Chrome only honors `return true` (keep sendResponse open)
// from synchronous listeners. The main listener below is async, which breaks sendResponse.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === MESSAGE_TYPES.SRK_GET_MANIFEST_XML) {
        // Content scripts in cross-origin iframes can't use chrome.runtime.getURL(),
        // so the background script fetches the manifest XML on their behalf.
        fetch(chrome.runtime.getURL('assets/Excel Add-In Manifest.xml'))
            .then(response => response.text())
            .then(xml => {
                // Also update the cache for future use
                chrome.storage.local.set({ _manifestXmlCache: xml });
                sendResponse({ success: true, xml });
            })
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep sendResponse channel open for async response
    }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // IMPORTANT: Don't handle SRK_GET_MANIFEST_XML here — it's handled by the
  // dedicated synchronous listener above. An async listener always returns a
  // Promise (truthy), which can cause Chrome to close the sendResponse port
  // before the sync listener's fetch completes, resulting in an undefined
  // response on the content-script side.
  if (msg.type === MESSAGE_TYPES.SRK_GET_MANIFEST_XML) return false;

  // Wrap in async IIFE so the outer function stays synchronous and can
  // return false/true correctly to Chrome's messaging system.
  const _handleAsync = (async () => {
  if (msg.type === MESSAGE_TYPES.REQUEST_STORED_LOGS) {
      if (logBuffer.length > 0) {
          safeSendMessage({ type: MESSAGE_TYPES.STORED_LOGS, payload: logBuffer }, 'stored logs');
          logBuffer = [];
      }
  } else if (msg.type === MESSAGE_TYPES.TEST_CONNECTION_PA) {
    await handlePaConnectionTest(msg.connection);
  } else if (msg.type === MESSAGE_TYPES.SEND_DEBUG_PAYLOAD) {
    if (msg.payload) {
      await sendConnectionPings(msg.payload);
    }
  } else if (msg.type === MESSAGE_TYPES.RESEND_HIGHLIGHT_PING) {
    if (msg.entry) {
      await sendHighlightStudentRowPayload(msg.entry, msg.targetTabId || null);
      console.log('Resent highlight ping for:', msg.entry.name);
    }
  } else if (msg.type === MESSAGE_TYPES.RESEND_ALL_HIGHLIGHT_PINGS) {
    const data = await chrome.storage.local.get(STORAGE_KEYS.FOUND_ENTRIES);
    const foundEntries = data[STORAGE_KEYS.FOUND_ENTRIES] || [];
    for (const entry of foundEntries) {
      await sendHighlightStudentRowPayload(entry, msg.targetTabId || null);
    }
    console.log('Resent all highlight pings for', foundEntries.length, 'students');
  } else if (msg.type === 'FIVE9_STATION_RESTART_VERIFIED') {
    // Content script verified station reconnected after restart —
    // update state immediately since the webRequest listener may not fire
    console.log('Five9 station restart verified by content script, updating connection state');
    lastAgentConnectionTime = Date.now();
    five9ConnectionState = FIVE9_CONNECTION_STATES.ACTIVE_CONNECTION;

    chrome.storage.local.set({
      five9ConnectionState: FIVE9_CONNECTION_STATES.ACTIVE_CONNECTION,
      lastAgentConnectionTime: lastAgentConnectionTime
    });

    // Notify sidepanel of state change
    safeSendMessage({
      type: 'FIVE9_CONNECTION_STATE_CHANGED',
      state: FIVE9_CONNECTION_STATES.ACTIVE_CONNECTION
    }, 'Five9 restart verified state');
  } else if (msg.type === MESSAGE_TYPES.LOG_TO_PANEL) {
      // Re-broadcast logs
  }

  // --- AUTO-SIDELOAD MANIFEST HANDLERS ---
  else if (msg.type === MESSAGE_TYPES.SRK_MANIFEST_INJECTED) {
      console.log(`%c [Background] Manifest Auto-Sideloaded!`, "color: #4CAF50; font-weight: bold");
      console.log(`   Add-in ID: ${msg.addinId}`);
      console.log(`   Timestamp: ${msg.timestamp}`);

      // Log to panel
      safeSendMessage({
          type: MESSAGE_TYPES.LOG_TO_PANEL,
          level: 'log',
          args: [`Excel Add-in manifest auto-sideloaded successfully`]
      }, 'manifest sideload log');
  }

  // --- MASTER LIST UPDATE HANDLERS ---
  else if (msg.type === MESSAGE_TYPES.SRK_MASTER_LIST_UPDATED) {
      console.log(`%c [Background] Master List Updated!`, "color: green; font-weight: bold");
      console.log(`   Students: ${msg.studentCount}`);
      console.log(`   Source Timestamp: ${msg.sourceTimestamp}`);

      // Log to panel
      safeSendMessage({
          type: MESSAGE_TYPES.LOG_TO_PANEL,
          level: 'log',
          args: [`Master List auto-updated: ${msg.studentCount} students`]
      }, 'master list update log');

      // Update badge to reflect new data
      updateBadge();
  }
  else if (msg.type === MESSAGE_TYPES.SRK_MASTER_LIST_ERROR) {
      console.error(`%c [Background] Master List Update Error:`, "color: red; font-weight: bold", msg.error);

      // Log error to panel
      safeSendMessage({
          type: MESSAGE_TYPES.LOG_TO_PANEL,
          level: 'error',
          args: [`Master List update failed: ${msg.error}`]
      }, 'master list error log');
  }
  else if (msg.type === MESSAGE_TYPES.SRK_SELECTED_STUDENTS) {
      const studentText = msg.count === 1
          ? msg.students[0]?.name
          : `${msg.count} students`;
      console.log(`%c [Background] Selected Students Received:`, "color: purple; font-weight: bold", studentText);

      // If this is an autoCall (ribbon call button), ensure the side panel is open
      // so the sidepanel listener can process the call request.
      if (msg.autoCall && sender?.tab?.id) {
          console.log('%c [Background] autoCall detected — ensuring side panel is open', 'color: green; font-weight: bold');
          // Store the pending message WITHOUT awaiting — any await before
          // sidePanel.open() breaks Chrome's user-gesture chain and causes
          // "may only be called in response to a user gesture" error.
          sessionSet({ pendingAutoCall: { ...msg, _timestamp: Date.now() } }); // fire-and-forget
          try {
              await chrome.sidePanel.open({ tabId: sender.tab.id });
          } catch (e) {
              console.warn('[Background] Could not open side panel:', e?.message || e);
          }
      }

      // NOTE: Do NOT forward to sidepanel here. The sidepanel already receives
      // this message directly from the content script via chrome.runtime.sendMessage.
      // Re-forwarding causes the sidepanel to process it twice, which triggers
      // the autoCall logic twice (call then immediate hangup).
  }

  // --- HIGHLIGHT CONFIRMATION FROM EXCEL ADD-IN ---
  else if (msg.type === MESSAGE_TYPES.SRK_HIGHLIGHT_CONFIRMATION) {
      const { syStudentId, status, message } = msg.data || {};
      const confirmStatus = status === 'success' ? HIGHLIGHT_STATUS.CONFIRMED : HIGHLIGHT_STATUS.ERROR;
      console.log(`%c [Background] Highlight Confirmation: ${status}`, `color: ${confirmStatus === HIGHLIGHT_STATUS.CONFIRMED ? 'green' : 'orange'}; font-weight: bold`, message);

      // Update the matching found entry's highlightStatus
      const data = await chrome.storage.local.get(STORAGE_KEYS.FOUND_ENTRIES);
      const foundEntries = data[STORAGE_KEYS.FOUND_ENTRIES] || [];
      let updated = false;
      for (const entry of foundEntries) {
          if (entry.syStudentId === syStudentId) {
              entry.highlightStatus = confirmStatus;
              updated = true;
          }
      }
      if (updated) {
          await chrome.storage.local.set({ [STORAGE_KEYS.FOUND_ENTRIES]: foundEntries });
          console.log(`[SRK] Updated highlightStatus to '${confirmStatus}' for SyStudentId: ${syStudentId}`);
      } else {
          console.warn(`[SRK] No found entry matched SyStudentId: ${syStudentId}`);
      }
  }

  // --- IMPORT MASTER LIST TO EXCEL ---
  else if (msg.type === 'SRK_SEND_IMPORT_MASTER_LIST') {
      console.log('%c [Background] Forwarding Master List Import to Excel', 'background: #4CAF50; color: white; font-weight: bold; padding: 2px 4px;');

      // Forward the payload to specific tab or all Excel tabs
      (async () => {
          try {
              // If targetTabId is specified, only send to that tab
              if (msg.targetTabId) {
                  try {
                      await chrome.tabs.sendMessage(msg.targetTabId, {
                          action: 'postToPage',
                          message: msg.payload
                      });
                      console.log(`[SRK] Sent import payload to specific tab ${msg.targetTabId}`);
                  } catch (err) {
                      console.warn(`[SRK] Failed to send import payload to tab ${msg.targetTabId}:`, err.message);
                  }
              } else {
                  // Send to all matching tabs
                  const tabs = await chrome.tabs.query({ url: TARGET_URL_PATTERNS });
                  for (const tab of tabs) {
                      try {
                          await chrome.tabs.sendMessage(tab.id, {
                              action: 'postToPage',
                              message: msg.payload
                          });
                          console.log(`[SRK] Sent import payload to tab ${tab.id}`);
                      } catch (err) {
                          console.warn(`[SRK] Failed to send import payload to tab ${tab.id}:`, err.message);
                      }
                  }
              }
          } catch (err) {
              console.error('[SRK] Failed to query Excel tabs:', err);
          }
      })();
  }

  // --- PING EXCEL ADD-IN ---
  else if (msg.type === MESSAGE_TYPES.SRK_PING) {
      console.log('%c [Background] Forwarding SRK_PING to Excel', 'background: #FF9800; color: white; font-weight: bold; padding: 2px 4px;');

      // Forward the payload to all Excel tabs
      (async () => {
          try {
              const tabs = await chrome.tabs.query({ url: TARGET_URL_PATTERNS });
              for (const tab of tabs) {
                  try {
                      await chrome.tabs.sendMessage(tab.id, {
                          action: 'postToPage',
                          message: msg.payload
                      });
                      console.log(`[SRK] Sent SRK_PING to tab ${tab.id}`);
                  } catch (err) {
                      console.warn(`[SRK] Failed to send SRK_PING to tab ${tab.id}:`, err.message);
                  }
              }
          } catch (err) {
              console.error('[SRK] Failed to query Excel tabs:', err);
          }
      })();
  }

  // --- NAVIGATE TO STUDENT IN EXCEL ---
  else if (msg.type === MESSAGE_TYPES.SRK_NAVIGATE_TO_STUDENT) {
      console.log('%c [SRK] Navigate to Student in Excel', 'background: #2196F3; color: white; font-weight: bold; padding: 2px 4px;', msg.syStudentId);

      (async () => {
          try {
              // Resolve targetSheet using the same settings as highlight
              const settings = await storageGet([STORAGE_KEYS.HIGHLIGHT_TARGET_SHEET]);
              let targetSheet = settings[STORAGE_KEYS.HIGHLIGHT_TARGET_SHEET] || 'LDA MM-DD-YYYY';
              const now = new Date();
              const month = String(now.getMonth() + 1);
              const day = String(now.getDate());
              const year = now.getFullYear();

              if (targetSheet === 'Campus') {
                  targetSheet = msg.campus || `LDA ${month}-${day}-${year}`;
              } else {
                  targetSheet = targetSheet.replace(/MM/g, month).replace(/DD/g, day).replace(/YYYY/g, year);
              }

              const payload = {
                  type: 'SRK_NAVIGATE_TO_STUDENT',
                  data: {
                      syStudentId: msg.syStudentId,
                      targetSheet: targetSheet
                  }
              };

              // Determine which tab to send to and focus
              const targetTabId = await storageGetValue(STORAGE_KEYS.HIGHLIGHT_TARGET_TAB_ID, null);
              let focusTabId = null;

              if (targetTabId) {
                  try {
                      await chrome.tabs.sendMessage(targetTabId, {
                          action: 'postToPage',
                          message: payload
                      });
                      focusTabId = targetTabId;
                      console.log(`[SRK] Sent navigate payload to selected tab ${targetTabId}`);
                  } catch (err) {
                      console.warn(`[SRK] Failed to send navigate to selected tab ${targetTabId}:`, err.message);
                      // Fallback to all Excel tabs
                      const tabs = await chrome.tabs.query({ url: TARGET_URL_PATTERNS });
                      for (const tab of tabs) {
                          try {
                              await chrome.tabs.sendMessage(tab.id, {
                                  action: 'postToPage',
                                  message: payload
                              });
                              if (!focusTabId) focusTabId = tab.id;
                              console.log(`[SRK] Sent navigate payload to tab ${tab.id}`);
                          } catch (tabErr) {
                              console.warn(`[SRK] Failed to send navigate to tab ${tab.id}:`, tabErr.message);
                          }
                      }
                  }
              } else {
                  const tabs = await chrome.tabs.query({ url: TARGET_URL_PATTERNS });
                  for (const tab of tabs) {
                      try {
                          await chrome.tabs.sendMessage(tab.id, {
                              action: 'postToPage',
                              message: payload
                          });
                          if (!focusTabId) focusTabId = tab.id;
                          console.log(`[SRK] Sent navigate payload to tab ${tab.id}`);
                      } catch (err) {
                          console.warn(`[SRK] Failed to send navigate to tab ${tab.id}:`, err.message);
                      }
                  }
              }

              // Focus the Excel tab after sending the navigate payload
              if (focusTabId) {
                  const tab = await chrome.tabs.get(focusTabId);
                  await chrome.tabs.update(focusTabId, { active: true });
                  await chrome.windows.update(tab.windowId, { focused: true });
                  console.log(`[SRK] Focused Excel tab ${focusTabId}`);
              }
          } catch (err) {
              console.error('[SRK] Failed to navigate to student:', err);
          }
      })();
  }

  // --- CREATE SHEET IN EXCEL ---
  else if (msg.type === MESSAGE_TYPES.SRK_CREATE_SHEET) {
      console.log('%c [Background] Forwarding Create Sheet Request to Excel', 'background: #4CAF50; color: white; font-weight: bold; padding: 2px 4px;');

      // Forward the payload to all Excel tabs
      (async () => {
          try {
              const tabs = await chrome.tabs.query({ url: TARGET_URL_PATTERNS });
              for (const tab of tabs) {
                  try {
                      await chrome.tabs.sendMessage(tab.id, {
                          action: 'postToPage',
                          message: msg.payload
                      });
                      console.log(`[SRK] Sent create sheet request to tab ${tab.id}`);
                  } catch (err) {
                      console.warn(`[SRK] Failed to send create sheet request to tab ${tab.id}:`, err.message);
                  }
              }
          } catch (err) {
              console.error('[SRK] Failed to query Excel tabs:', err);
          }
      })();
  }

  // --- REQUEST SHEET LIST FROM EXCEL ---
  else if (msg.type === MESSAGE_TYPES.SRK_REQUEST_SHEET_LIST) {
      console.log('%c [Background] Forwarding Sheet List Request to Excel', 'background: #4CAF50; color: white; font-weight: bold; padding: 2px 4px;');

      // Forward the payload to all Excel tabs
      (async () => {
          try {
              const tabs = await chrome.tabs.query({ url: TARGET_URL_PATTERNS });
              for (const tab of tabs) {
                  try {
                      await chrome.tabs.sendMessage(tab.id, {
                          action: 'postToPage',
                          message: msg.payload
                      });
                      console.log(`[SRK] Sent sheet list request to tab ${tab.id}`);
                  } catch (err) {
                      console.warn(`[SRK] Failed to send sheet list request to tab ${tab.id}:`, err.message);
                  }
              }
          } catch (err) {
              console.error('[SRK] Failed to query Excel tabs:', err);
          }
      })();
  }

  // --- SHEET LIST RESPONSE FROM EXCEL ---
  else if (msg.type === MESSAGE_TYPES.SRK_SHEET_LIST_RESPONSE) {
      console.log('%c [Background] Sheet List Response Received from Excel', 'background: #9C27B0; color: white; font-weight: bold; padding: 2px 4px;');
      console.log('   Sheets:', msg.sheets);

      // Forward to sidepanel
      chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.SRK_SHEET_LIST_RESPONSE,
          sheets: msg.sheets
      }).catch(() => {
          // Sidepanel might not be open, that's ok
      });
  }

  // --- OPEN LINKS FROM EXCEL ---
  else if (msg.type === MESSAGE_TYPES.SRK_LINKS) {
      console.log('%c [Background] Opening Links from Excel', 'background: #2196F3; color: white; font-weight: bold; padding: 2px 4px;');
      console.log('   Links count:', msg.links?.length || 0);

      if (msg.links && Array.isArray(msg.links)) {
          for (const link of msg.links) {
              try {
                  await chrome.tabs.create({ url: link, active: false });
                  console.log(`[SRK] Opened link: ${link}`);
              } catch (err) {
                  console.error(`[SRK] Failed to open link ${link}:`, err.message);
              }
          }
          console.log(`[SRK] Opened ${msg.links.length} links successfully`);
      } else {
          console.warn('[SRK] No valid links array provided');
      }
  }

  // --- FIVE9 INTEGRATION ---
  else if (msg.type === 'triggerFive9Call') {
      (async () => {
          const tabs = await chrome.tabs.query({ url: "https://*.five9.com/*" });
          if (tabs.length === 0) {
              chrome.runtime.sendMessage({ 
                  type: 'callStatus', 
                  success: false, 
                  error: "Five9 tab not found. Please open Five9." 
              });
              return;
          }
          
          const five9TabId = tabs[0].id;
          // Clean number logic
          let cleanNumber = msg.phoneNumber.replace(/[^0-9+]/g, '');
          if (!cleanNumber.startsWith('+1') && cleanNumber.length === 10) {
              cleanNumber = '+1' + cleanNumber;
          }

          chrome.tabs.sendMessage(five9TabId, { 
              type: 'executeFive9Call', 
              phoneNumber: cleanNumber 
          }, (response) => {
              if (chrome.runtime.lastError) {
                  console.error("Five9 Connection Error:", chrome.runtime.lastError.message); 
                  chrome.runtime.sendMessage({ type: 'callStatus', success: false, error: "Five9 disconnected. Refresh tab." });
              } else {
                  chrome.runtime.sendMessage({ type: 'callStatus', success: response?.success, error: response?.error });
              }
          });
      })();
  }
  else if (msg.type === 'triggerFive9Hangup') {
      (async () => {
          const tabs = await chrome.tabs.query({ url: "https://*.five9.com/*" });
          if (tabs.length === 0) {
              chrome.runtime.sendMessage({ type: 'hangupStatus', success: false, error: "Five9 tab not found." });
              return;
          }

          chrome.tabs.sendMessage(tabs[0].id, {
              type: 'executeFive9Hangup',
              dispositionType: msg.dispositionType
          }, (response) => {
              if (chrome.runtime.lastError) {
                  console.error("Five9 Hangup Error:", chrome.runtime.lastError.message);
                  chrome.runtime.sendMessage({ type: 'hangupStatus', success: false, error: "Five9 disconnected." });
              } else {
                  chrome.runtime.sendMessage({
                      type: 'hangupStatus',
                      success: response?.success,
                      error: response?.error,
                      state: response?.state
                  });
              }
          });
      })();
  }
  else if (msg.type === 'triggerFive9DisposeOnly') {
      (async () => {
          const tabs = await chrome.tabs.query({ url: "https://*.five9.com/*" });
          if (tabs.length === 0) {
              chrome.runtime.sendMessage({ type: 'disposeStatus', success: false, error: "Five9 tab not found." });
              return;
          }

          chrome.tabs.sendMessage(tabs[0].id, {
              type: 'executeFive9DisposeOnly',
              dispositionType: msg.dispositionType
          }, (response) => {
              if (chrome.runtime.lastError) {
                  console.error("Five9 Dispose Error:", chrome.runtime.lastError.message);
                  chrome.runtime.sendMessage({ type: 'disposeStatus', success: false, error: "Five9 disconnected." });
              } else {
                  chrome.runtime.sendMessage({
                      type: 'disposeStatus',
                      success: response?.success,
                      error: response?.error,
                      state: response?.state
                  });
              }
          });
      })();
  }
  })(); // end _handleAsync IIFE

  // Synchronous handlers that need sendResponse — must live outside the async IIFE
  if (msg.type === 'GET_FIVE9_CONNECTION_STATE') {
    sendResponse({
      state: five9ConnectionState,
      lastAgentConnectionTime: lastAgentConnectionTime
    });
    return true;
  }

  // For triggerFive9* messages the async IIFE calls sendResponse via callbacks,
  // so we must keep the port open.
  if (msg.type === 'triggerFive9Call' || msg.type === 'triggerFive9Hangup' || msg.type === 'triggerFive9DisposeOnly') {
    return true;
  }

  return false; // No sendResponse needed for all other message types
});

// --- HIGHLIGHT STUDENT ROW HANDLING ---
async function sendHighlightStudentRowPayload(entry, overrideTabId = null) {
    console.log('%c [SRK] Submission Found - Sending payload to Office Add-in', 'background: #4CAF50; color: white; font-weight: bold; padding: 2px 4px;', entry.name);

    // Check if highlight feature is enabled
    const isEnabled = await storageGetValue(STORAGE_KEYS.HIGHLIGHT_STUDENT_ROW_ENABLED, true);

    if (!isEnabled) {
        console.log('[SRK] Student row highlighting is disabled - skipping highlight payload');
        return;
    }

    // Only send if we have the required SyStudentId
    if (!entry.syStudentId) {
        console.warn('[SRK] Cannot send highlight payload: missing SyStudentId');
        return;
    }

    // Load highlight settings
    const settings = await storageGet([
        STORAGE_KEYS.HIGHLIGHT_START_COL,
        STORAGE_KEYS.HIGHLIGHT_END_COL,
        STORAGE_KEYS.HIGHLIGHT_EDIT_COLUMN,
        STORAGE_KEYS.HIGHLIGHT_EDIT_TEXT,
        STORAGE_KEYS.HIGHLIGHT_TARGET_SHEET,
        STORAGE_KEYS.HIGHLIGHT_ROW_COLOR
    ]);

    // Process editText to replace {assignment} placeholder
    let editText = settings[STORAGE_KEYS.HIGHLIGHT_EDIT_TEXT] || 'Submitted {assignment}';
    if (entry.assignment) {
        editText = editText.replace(/{assignment}/g, entry.assignment);
    }

    // Resolve targetSheet based on the selected mode
    let targetSheet = settings[STORAGE_KEYS.HIGHLIGHT_TARGET_SHEET] || 'LDA MM-DD-YYYY';
    // Replace MM-DD-YYYY placeholders with current date (used for default and as campus fallback)
    const now = new Date();
    const month = String(now.getMonth() + 1);
    const day = String(now.getDate());
    const year = now.getFullYear();

    if (targetSheet === 'Campus') {
        // Use the student's trimmed campus name, fall back to date-based sheet name
        targetSheet = entry.campus || `LDA ${month}-${day}-${year}`;
    } else {
        targetSheet = targetSheet.replace(/MM/g, month).replace(/DD/g, day).replace(/YYYY/g, year);
    }

    // Build the payload
    const payload = {
        type: 'SRK_HIGHLIGHT_STUDENT_ROW',
        data: {
            studentName: entry.name,
            syStudentId: entry.syStudentId,
            startCol: settings[STORAGE_KEYS.HIGHLIGHT_START_COL] || 'Student Name',
            endCol: settings[STORAGE_KEYS.HIGHLIGHT_END_COL] || 'Outreach',
            targetSheet: targetSheet,
            color: settings[STORAGE_KEYS.HIGHLIGHT_ROW_COLOR] || '#92d050',
            editColumn: settings[STORAGE_KEYS.HIGHLIGHT_EDIT_COLUMN] || 'Outreach',
            editText: editText
        }
    };

    console.log('[SRK] Sending highlight student row payload:', payload);

    // Use override tab ID if provided (e.g. from context menu), otherwise fall back to stored setting
    const targetTabId = overrideTabId || await storageGetValue(STORAGE_KEYS.HIGHLIGHT_TARGET_TAB_ID, null);

    try {
        if (targetTabId) {
            // Send to specific selected tab
            try {
                await chrome.tabs.sendMessage(targetTabId, {
                    action: 'postToPage',
                    message: payload
                });
                console.log(`[SRK] Sent highlight payload to selected tab ${targetTabId}`);
            } catch (err) {
                console.warn(`[SRK] Failed to send highlight payload to selected tab ${targetTabId}:`, err.message);
                // Fallback: try sending to all tabs if the selected tab fails
                console.log('[SRK] Falling back to all Excel tabs...');
                const tabs = await chrome.tabs.query({ url: TARGET_URL_PATTERNS });
                for (const tab of tabs) {
                    try {
                        await chrome.tabs.sendMessage(tab.id, {
                            action: 'postToPage',
                            message: payload
                        });
                        console.log(`[SRK] Sent highlight payload to tab ${tab.id}`);
                    } catch (tabErr) {
                        console.warn(`[SRK] Failed to send highlight payload to tab ${tab.id}:`, tabErr.message);
                    }
                }
            }
        } else {
            // No specific tab selected, send to all Excel tabs
            const tabs = await chrome.tabs.query({ url: TARGET_URL_PATTERNS });
            for (const tab of tabs) {
                try {
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'postToPage',
                        message: payload
                    });
                    console.log(`[SRK] Sent highlight payload to tab ${tab.id}`);
                } catch (err) {
                    console.warn(`[SRK] Failed to send highlight payload to tab ${tab.id}:`, err.message);
                }
            }
        }
    } catch (err) {
        console.error('[SRK] Failed to query Excel tabs:', err);
    }
}

// --- CONNECTION HANDLING ---
async function sendConnectionPings(payload) {
    const data = await storageGet([STORAGE_KEYS.CONNECTIONS, STORAGE_KEYS.CALL_DEMO]);
    const connections = data[STORAGE_KEYS.CONNECTIONS] || [];
    const callDemo = data[STORAGE_KEYS.CALL_DEMO] || false;
    const bodyPayload = { ...payload };
    if (!bodyPayload.debug && callDemo) {
      bodyPayload.debug = true;
    }

    const pingPromises = [];

    for (const conn of connections) {
        if (conn.type === CONNECTION_TYPES.POWER_AUTOMATE) {
            pingPromises.push(triggerPowerAutomate(conn, bodyPayload));
        }
    }
    await Promise.all(pingPromises);
}

async function handlePaConnectionTest(connection) {
    const testPayload = { name: 'Test Submission', url: '#', grade: '100', timestamp: new Date().toISOString(), test: true };
    const result = await triggerPowerAutomate(connection, testPayload);
    safeSendMessage({
        type: MESSAGE_TYPES.CONNECTION_TEST_RESULT,
        connectionType: CONNECTION_TYPES.POWER_AUTOMATE,
        success: result.success,
        error: result.error || 'Check service worker console for details.'
    }, 'PA connection test result');
}

async function triggerPowerAutomate(connection, payload) {
  try {
    const resp = await fetch(connection.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!resp.ok && resp.status !== 202) { throw new Error(`HTTP Error: ${resp.status}`); }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- STATE & DATA MANAGEMENT ---
async function updateBadge() {
  // Get extension state from session storage, found entries from local storage
  const stateData = await sessionGet([STORAGE_KEYS.EXTENSION_STATE]);
  const localData = await storageGet([STORAGE_KEYS.FOUND_ENTRIES]);
  const state = stateData[STORAGE_KEYS.EXTENSION_STATE];
  const foundCount = localData[STORAGE_KEYS.FOUND_ENTRIES]?.length || 0;

  if (state === EXTENSION_STATES.ON) {
    chrome.action.setBadgeBackgroundColor({ color: '#0052cc' });
    chrome.action.setBadgeText({ text: foundCount > 0 ? foundCount.toString() : 'API' });
  } else if (state === EXTENSION_STATES.PAUSED) {
    chrome.action.setBadgeBackgroundColor({ color: '#f5a623' });
    chrome.action.setBadgeText({ text: 'WAIT' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

async function handleStateChange(newState, oldState) {
    console.log(`%c [BACKGROUND] State Change: ${oldState} -> ${newState}`, 'background: #9C27B0; color: white; font-weight: bold; padding: 4px;');

    if (newState === EXTENSION_STATES.ON) {
        const settings = await chrome.storage.local.get(STORAGE_KEYS.CHECKER_MODE);
        const currentMode = settings[STORAGE_KEYS.CHECKER_MODE] || CHECKER_MODES.SUBMISSION;

        console.log(`%c ▶ STARTING CHECKER - Mode: ${currentMode}`, 'background: #4CAF50; color: white; font-weight: bold; font-size: 14px; padding: 4px;');

        if (currentMode === CHECKER_MODES.MISSING) {
            missingAssignmentsCollector = [];
            missingCheckStartTime = Date.now();
            console.log("Starting Missing Assignments check (API Mode).");
            startLoop({
                onComplete: onMissingCheckCompleted,
                onMissingFound: onMissingFound
            });
        } else {
            console.log("Starting Submission check (API Mode).");
            startLoop({ onFound: onSubmissionFound });
        }
    } else if (newState === EXTENSION_STATES.OFF && (oldState === EXTENSION_STATES.ON || oldState === EXTENSION_STATES.PAUSED)) {
        console.log(`%c ■ STOPPING CHECKER`, 'background: #F44336; color: white; font-weight: bold; font-size: 14px; padding: 4px;');
        stopLoop();
    }
}

async function addStudentToFoundList(entry) {
    const data = await chrome.storage.local.get(STORAGE_KEYS.FOUND_ENTRIES);
    const foundEntries = data[STORAGE_KEYS.FOUND_ENTRIES] || [];
    const map = new Map(foundEntries.map(e => [e.url, e]));
    // Set initial highlightStatus to pending (waiting for Excel confirmation)
    const entryWithStatus = { ...entry, highlightStatus: HIGHLIGHT_STATUS.PENDING };
    map.set(entry.url, entryWithStatus);
    addToFoundUrlCache(entry.url);
    await chrome.storage.local.set({ [STORAGE_KEYS.FOUND_ENTRIES]: Array.from(map.values()) });
}

// --- INJECTION LOGIC FOR EXCEL CONNECTOR ---

const CONTENT_SCRIPT_FILE = "src/content/excelConnector.js";

// UPDATED PATTERNS: Added SharePoint
const TARGET_URL_PATTERNS = [
  "https://excel.office.com/*",
  "https://*.officeapps.live.com/*",
  "https://*.sharepoint.com/*",
  "https://vsblanco.github.io/*" 
];

async function injectScriptIntoTab(tabId, url) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      files: [CONTENT_SCRIPT_FILE]
    });
    console.log(`[SRK] SUCCESS: Injected connector into tab ${tabId} (${url})`);
  } catch (err) {
    console.warn(`[SRK] FAILED to inject into tab ${tabId}: ${err.message}`);
  }
}

// 1. On Install / Reload
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[SRK] Extension installed/updated. Running storage migration...");

  // Pre-cache manifest XML so content scripts can read it from storage
  cacheManifestXml();

  // Run storage migration to convert old flat keys to new nested structure
  await migrateStorage();

  console.log("[SRK] Scanning for open Excel tabs...");

  // Query specifically for our target URLs
  const tabs = await chrome.tabs.query({ url: TARGET_URL_PATTERNS });

  console.log(`[SRK] Found ${tabs.length} matching tabs.`);

  if (tabs.length === 0) {
      console.log("[SRK] No tabs matched. Listing first 3 open tabs to debug URL mismatches:");
      const allTabs = await chrome.tabs.query({});
      allTabs.slice(0, 3).forEach(t => console.log(" - Open URL:", t.url));
  }

  for (const tab of tabs) {
    injectScriptIntoTab(tab.id, tab.url);
  }
});

// 2. On Browser Startup
chrome.runtime.onStartup.addListener(async () => {
  // Pre-cache manifest XML so content scripts can read it from storage
  cacheManifestXml();

  const tabs = await chrome.tabs.query({ url: TARGET_URL_PATTERNS });
  for (const tab of tabs) {
    injectScriptIntoTab(tab.id, tab.url);
  }
});

// Monitor Five9 tab closes to reset connection state
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  // Check if any Five9 tabs remain open
  const five9Tabs = await chrome.tabs.query({ url: "https://*.five9.com/*" });

  if (five9Tabs.length === 0) {
    // No Five9 tabs left - reset connection state
    five9ConnectionState = FIVE9_CONNECTION_STATES.NO_TAB;
    lastAgentConnectionTime = null;

    await chrome.storage.local.set({
      five9ConnectionState: FIVE9_CONNECTION_STATES.NO_TAB,
      lastAgentConnectionTime: null
    });

    // Notify sidepanel of state change
    safeSendMessage({
      type: 'FIVE9_CONNECTION_STATE_CHANGED',
      state: FIVE9_CONNECTION_STATES.NO_TAB
    }, 'Five9 tab closed state');
  }
});

// --- INITIALIZATION ---
(async () => {
    await updateBadge();
    // Extension state is now in session storage - will be OFF on fresh browser start
    const state = await sessionGetValue(STORAGE_KEYS.EXTENSION_STATE, EXTENSION_STATES.OFF);
    handleStateChange(state);
})();