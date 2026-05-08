// [2025-12-18] Version 1.3 - Call Manager Module
// Handles all call state management, automation, and Five9 integration
// v1.2: Skip button marks students to skip over without removing from queue
// v1.3: Dial button cancels automation and keeps only current student

import { STORAGE_KEYS } from '../constants/index.js';
import { CONFIG } from '../constants/config.js';
import { storageGet } from '../utils/storage.js';

/**
 * CallManager class - Manages call state, timers, and automation sequences
 */
export default class CallManager {
    constructor(elements, uiCallbacks = {}) {
        this.elements = elements;
        this.isCallActive = false;
        this.callTimerInterval = null;
        this.dispositionTimerInterval = null; // Timer for disposition wait time
        this.selectedQueue = [];
        this.debugMode = false;
        this.automationMode = false;
        this.currentAutomationIndex = 0;
        this.skippedIndices = new Set(); // Track indices of students to skip
        this.uiCallbacks = uiCallbacks; // Callbacks for UI updates
        this.waitingForDisposition = false; // Track if call ended but waiting for disposition
        this._dispositionInProgress = false; // Guard against double-clicks during disposition
        this.isPaused = false; // Track if automation is paused between calls
        this.previousCalls = []; // Last few completed calls (most recent first), capped at MAX_PREVIOUS_CALLS
        this._redialingFromHistory = false; // True while a previous-calls redial is in flight
        this._pendingRedialStudent = null; // Loaded by loadFromHistory; consumed by next toggleCallState
        this._currentCallStudent = null; // Snapshot of who the active call is for (used to log to history)
        this._phaseHasBeenConnected = false; // True once Five9 reports ACTIVE/TALKING for the current call
        this._adoptingExternalCall = false; // Re-entry guard for handleExternalCallStart's async lookup
    }

    /**
     * Maximum number of entries to keep in the Previous Calls list
     */
    static get MAX_PREVIOUS_CALLS() {
        return 3;
    }

    /**
     * Updates the reference to the selected queue
     * @param {Array} queue - Array of selected student entries
     */
    updateQueue(queue) {
        this.selectedQueue = queue;
        // The user picked a different student/queue — abandon any staged redial
        this._pendingRedialStudent = null;
    }

    /**
     * Sets debug mode state
     * @param {boolean} enabled - Whether debug mode is enabled
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
        this.updateCallInterfaceState();
        if (this.elements.demoModeBanner) {
            this.elements.demoModeBanner.style.display = enabled ? '' : 'none';
        }
    }

    /**
     * Renders the call status text + indicator to reflect the current
     * Five9 call phase. Driven by toggleCallState on dial (initial 'ringing')
     * and by FIVE9_CALL_STATE_CHANGED in five9-integration.js as the call
     * progresses (-> 'connected' once the line picks up).
     * @param {'ringing'|'connected'} phase
     */
    setCallPhase(phase) {
        if (!this.elements.callStatusText) return;
        if (phase === 'ringing') {
            this.elements.callStatusText.innerHTML = `<span class="status-indicator" style="background:${CONFIG.COLORS.WARNING}; animation: blink 1s infinite;"></span> Ringing`;
        } else {
            // Mirror Five9: the ring-time stopwatch ends and the talk-time
            // stopwatch starts fresh on the first transition to connected.
            if (!this._phaseHasBeenConnected) {
                this._phaseHasBeenConnected = true;
                this.startCallTimer();
            }
            this.elements.callStatusText.innerHTML = `<span class="status-indicator" style="background:${CONFIG.COLORS.ERROR}; animation: blink 1s infinite;"></span> Connected`;
        }
    }

    /**
     * Gets current call active state
     * @returns {boolean} Whether a call is currently active
     */
    getCallActiveState() {
        return this.isCallActive;
    }

    /**
     * Gets current automation mode state
     * @returns {boolean} Whether automation mode is currently active
     */
    getAutomationModeState() {
        return this.automationMode;
    }

    /**
     * Gets whether we're waiting for disposition after a call
     * @returns {boolean} Whether we're awaiting disposition selection
     */
    getWaitingForDisposition() {
        return this.waitingForDisposition;
    }

    /**
     * Extracts phone number from student object
     * Prioritizes directPhone (from single cell selection in Excel) for quick dialing
     * @param {Object} student - Student object with phone property
     * @returns {string} Phone number or "No Phone Listed"
     */
    getPhoneNumber(student) {
        if (!student) return "No Phone Listed";

        // Highest priority: user selected a phone cell directly in Excel
        if (student.directPhone) return student.directPhone;

        // Handle different possible property names
        if (student.phone) return student.phone;
        if (student.Phone) return student.Phone;
        if (student.PrimaryPhone) return student.PrimaryPhone;

        return "No Phone Listed";
    }

    /**
     * Toggles call state between active and inactive
     * Handles both single calls and automation mode
     * @param {boolean} forceEnd - Force end the call regardless of current state
     */
    async toggleCallState(forceEnd = false) {
        // Block clicks while a disposition is being processed
        if (this._dispositionInProgress) {
            console.log("⏳ Disposition in progress — ignoring dial button click");
            return;
        }

        // --- PENDING REDIAL FROM HISTORY ---
        // A previous-calls row was clicked; dial that student instead of the
        // queue's next one. Takes precedence over the automation branch so it
        // doesn't accidentally re-trigger startAutomationSequence.
        if (this._pendingRedialStudent && !this.isCallActive && !forceEnd) {
            this._initiateRedial();
            return;
        }
        // --------------------------------------

        // --- CANCEL AUTOMATION MODE ---
        // If in automation mode and call is active, cancel automation
        if (this.automationMode && this.isCallActive) {
            this.cancelAutomation();
            return;
        }
        // --------------------------------------

        // --- CHECK FOR AUTOMATION MODE ---
        if (this.selectedQueue.length > 1 && !this.isCallActive) {
            this.startAutomationSequence();
            return;
        }
        // --------------------------------------

        if (forceEnd && !this.isCallActive) return;
        this.isCallActive = !this.isCallActive;
        if (forceEnd) this.isCallActive = false;

        if (this.isCallActive) {
            // Reset waiting for disposition flag when starting new call
            this.waitingForDisposition = false;

            // --- INITIATE FIVE9 CALL (ONLY IF DEBUG MODE OFF) ---
            const currentStudent = this.selectedQueue[0];
            this._currentCallStudent = currentStudent || null;
            if (!this.debugMode) {
                if (currentStudent) {
                    const phoneNumber = this.getPhoneNumber(currentStudent);
                    if (phoneNumber && phoneNumber !== "No Phone Listed") {
                        this.initiateCall(phoneNumber); // Trigger Five9 API call
                    } else {
                        console.warn("No valid phone number for current student");
                    }
                }
            } else {
                console.log("📞 [DEMO MODE] Simulating call initiation (Five9 API not called)");
            }
            // --------------------------------------------------

            this.elements.dialBtn.style.background = `${CONFIG.COLORS.ERROR}`;
            this.elements.dialBtn.style.transform = 'rotate(135deg)';
            this.setCallPhase('ringing');

            // Show Disposition Grid and reset button states
            if (this.elements.callDispositionSection) {
                this.elements.callDispositionSection.style.display = 'flex';
                this.resetDispositionButtons();
            }

            this.startCallTimer();
            this.refreshPreviousCallsUI();
        } else {
            // Call is ending. Lock out other call-state transitions (a second
            // dial click or a parallel disposition click) until the hangup
            // completes; otherwise we'd race against ourselves on Five9 and
            // produce double-hangups or post-hangup re-dials.
            this._dispositionInProgress = true;
            // Disable the dial button immediately so subsequent clicks during
            // the await don't even queue events.
            if (this.elements.dialBtn) {
                this.elements.dialBtn.disabled = true;
                this.elements.dialBtn.style.cursor = 'not-allowed';
                this.elements.dialBtn.style.opacity = '0.6';
            }
            try {
                this.elements.callStatusText.innerHTML = `<span class="status-indicator" style="background:${CONFIG.COLORS.WARNING};"></span> Ending call...`;


                let hangupResult = { success: true, state: 'WRAP_UP' };

                // --- HANGUP FIVE9 CALL (ONLY IF DEBUG MODE OFF) ---
                if (!this.debugMode) {
                    hangupResult = await this.hangupCall(); // Trigger Five9 API hangup and wait for response
                } else {
                    console.log("📞 [DEMO MODE] Simulating hangup (Five9 API not called)");
                }
                // -------------------------

                // Set button to gray while awaiting disposition
                this.elements.dialBtn.style.background = `${CONFIG.COLORS.MUTED}`;
                this.elements.dialBtn.style.transform = 'rotate(0deg)';

                // Check the interaction state
                const state = hangupResult?.state || 'WRAP_UP';
                console.log("📊 Call state after hangup:", state);

                if (state === 'WRAP_UP') {
                    // Call disconnected but waiting for disposition
                    this.elements.callStatusText.innerHTML = `<span class="status-indicator" style="background:${CONFIG.COLORS.WARNING};"></span> Awaiting Disposition`;

                    // KEEP call active to block pings until disposition is set
                    this.isCallActive = true;
                    this.waitingForDisposition = true;

                    // Dial button stays disabled while awaiting disposition
                    // (already disabled at the top of this branch).

                    // If a disposition button was clicked during the hangup,
                    // its no-op handler left the grid greyed out. Reset so the
                    // user can actually pick a code now.
                    this.resetDispositionButtons();

                    // Start disposition timer to show waiting time
                    this.startDispositionTimer();

                    // Focus Five9 tab for disposition (only in non-demo mode)
                    if (!this.debugMode) {
                        this.focusFive9Tab();
                    }
                } else {
                    // Call fully completed (shouldn't normally happen without disposition)
                    this.elements.dialBtn.style.background = `${CONFIG.COLORS.SUCCESS}`; // Turn green when ready
                    this.elements.callStatusText.innerHTML = '<span class="status-indicator ready"></span> Ready to Dial';
                    this.isCallActive = false;
                    this.waitingForDisposition = false;
                    // Re-enable so the user can dial again.
                    if (this.elements.dialBtn) {
                        this.elements.dialBtn.disabled = false;
                        this.elements.dialBtn.style.cursor = 'pointer';
                        this.elements.dialBtn.style.opacity = '1';
                    }
                }

                // Hide custom input area if it was open
                if (this.elements.otherInputArea) {
                    this.elements.otherInputArea.style.display = 'none';
                }

                this.stopCallTimer();
                // Reflect the new isCallActive / waitingForDisposition values in the
                // Previous Calls list (now disabled while awaiting disposition).
                this.refreshPreviousCallsUI();
            } finally {
                // Release the lock so handleDisposition can run when the user
                // picks a code (or so the user can dial again if the call
                // fully completed without disposition).
                this._dispositionInProgress = false;
            }
        }
    }

    /**
     * Starts the automation sequence for multiple students
     */
    startAutomationSequence() {
        if (this.selectedQueue.length === 0) {
            console.warn('No students selected for automation.');
            return;
        }

        this.automationMode = true;
        this.currentAutomationIndex = 0;
        this.skippedIndices.clear(); // Reset skipped indices
        this.isPaused = false;

        // Show pause button
        if (this.elements.pauseAutomationBtn) {
            this.elements.pauseAutomationBtn.style.display = 'block';
            this.elements.pauseAutomationBtn.innerHTML = '<i class="fas fa-pause"></i> Pause After This Call';
            this.elements.pauseAutomationBtn.classList.remove('paused');
        }

        // Start calling the first student
        this.callNextStudentInQueue();
    }

    /**
     * Finds the next non-skipped student index starting from a given index
     * @param {number} startIndex - Index to start searching from
     * @returns {number} Next non-skipped index, or -1 if none found
     */
    findNextNonSkippedIndex(startIndex) {
        for (let i = startIndex; i < this.selectedQueue.length; i++) {
            if (!this.skippedIndices.has(i)) {
                return i;
            }
        }
        return -1; // No non-skipped students found
    }

    /**
     * Calls the next student in the automation queue
     */
    callNextStudentInQueue() {
        // Find next non-skipped student
        const nextIndex = this.findNextNonSkippedIndex(this.currentAutomationIndex);

        if (nextIndex === -1) {
            // No more non-skipped students - automation complete
            this.endAutomationSequence();
            return;
        }

        // Update current index to the next non-skipped student
        this.currentAutomationIndex = nextIndex;
        const currentStudent = this.selectedQueue[this.currentAutomationIndex];
        this._currentCallStudent = currentStudent;

        // Update UI to show current student
        if (this.uiCallbacks.updateCurrentStudent) {
            this.uiCallbacks.updateCurrentStudent(currentStudent);
        }

        // Update "Up Next" card
        this.updateUpNextCard();

        // --- INITIATE FIVE9 CALL (ONLY IF DEBUG MODE OFF) ---
        if (!this.debugMode) {
            const phoneNumber = this.getPhoneNumber(currentStudent);
            if (phoneNumber && phoneNumber !== "No Phone Listed") {
                this.initiateCall(phoneNumber); // Trigger Five9 API call
            } else {
                console.warn(`No valid phone number for student: ${currentStudent.name || 'Unknown'}`);
            }
        } else {
            console.log(`📞 [DEMO MODE] Simulating call to: ${currentStudent.name || 'Unknown'}`);
        }
        // ----------------------------------------------

        // Start the call
        this.isCallActive = true;
        this.waitingForDisposition = false;
        this.elements.dialBtn.disabled = false;
        this.elements.dialBtn.style.cursor = 'pointer';
        this.elements.dialBtn.style.opacity = '1';
        this.elements.dialBtn.style.background = `${CONFIG.COLORS.ERROR}`;
        this.elements.dialBtn.style.transform = 'rotate(135deg)';
        this.setCallPhase('ringing');

        // Show Disposition Grid and reset button states
        if (this.elements.callDispositionSection) {
            this.elements.callDispositionSection.style.display = 'flex';
            this.resetDispositionButtons();
        }

        this.startCallTimer();
        this.refreshPreviousCallsUI();
    }

    /**
     * Updates the "Up Next" card during automation
     */
    updateUpNextCard() {
        if (!this.elements.upNextCard || !this.elements.upNextName) return;

        if (!this.automationMode) {
            this.elements.upNextCard.style.display = 'none';
            return;
        }

        // Find next non-skipped student
        const nextIndex = this.findNextNonSkippedIndex(this.currentAutomationIndex + 1);

        if (nextIndex !== -1) {
            // Show next non-skipped student
            this.elements.upNextCard.style.display = 'block';
            this.elements.upNextName.textContent = this.selectedQueue[nextIndex].name;
        } else {
            // No more non-skipped students
            this.elements.upNextCard.style.display = 'none';
        }

        // Update skip button state
        this.updateSkipButtonState();
    }

    /**
     * Skips the "Up Next" student (marks them to be skipped without calling)
     */
    skipToNext() {
        if (!this.automationMode) {
            console.warn('Skip only available in automation mode');
            return;
        }

        if (!this.isCallActive) {
            console.warn('No active call');
            return;
        }

        // Find the next non-skipped student index
        const upNextIndex = this.findNextNonSkippedIndex(this.currentAutomationIndex + 1);

        // Check if there is a student to skip
        if (upNextIndex === -1) {
            console.warn('No up next student to skip');
            return;
        }

        // Mark this student as skipped
        this.skippedIndices.add(upNextIndex);
        const skippedStudent = this.selectedQueue[upNextIndex];
        console.log(`Marked student to skip: ${skippedStudent.name}`);

        // Update the "Up Next" card to show the new next non-skipped student
        this.updateUpNextCard();

        // Update skip button state
        this.updateSkipButtonState();
    }

    /**
     * Updates skip button enabled/disabled state
     */
    updateSkipButtonState() {
        if (!this.elements.skipStudentBtn) return;

        // Check if there's a non-skipped student after the current one
        const upNextIndex = this.findNextNonSkippedIndex(this.currentAutomationIndex + 1);
        const hasUpNext = this.automationMode && upNextIndex !== -1;

        if (hasUpNext) {
            // Enable skip button
            this.elements.skipStudentBtn.disabled = false;
            this.elements.skipStudentBtn.style.opacity = '1';
            this.elements.skipStudentBtn.style.cursor = 'pointer';
        } else {
            // Disable skip button
            this.elements.skipStudentBtn.disabled = true;
            this.elements.skipStudentBtn.style.opacity = '0.3';
            this.elements.skipStudentBtn.style.cursor = 'not-allowed';
        }
    }

    /**
     * Ends the automation sequence
     */
    endAutomationSequence() {
        const totalCalled = this.selectedQueue.length;
        const lastStudent = this.selectedQueue[this.selectedQueue.length - 1];

        this.automationMode = false;
        this.currentAutomationIndex = 0;

        // Hide "Up Next" card and pause button
        if (this.elements.upNextCard) {
            this.elements.upNextCard.style.display = 'none';
        }
        if (this.elements.pauseAutomationBtn) {
            this.elements.pauseAutomationBtn.style.display = 'none';
        }
        if (this.elements.stopAutomationBtn) {
            this.elements.stopAutomationBtn.style.display = 'none';
        }
        if (this.elements.cancelRedialBtn) {
            this.elements.cancelRedialBtn.style.display = 'none';
        }
        this.isPaused = false;

        // Reset call UI to regular mode
        if (this.elements.dialBtn) {
            this.elements.dialBtn.classList.remove('automation');
            this.elements.dialBtn.innerHTML = '<i class="fas fa-phone"></i>';
            this.elements.dialBtn.style.background = `${CONFIG.COLORS.SUCCESS}`;
            this.elements.dialBtn.style.transform = 'rotate(0deg)';
            this.elements.dialBtn.disabled = false;
            this.elements.dialBtn.style.cursor = 'pointer';
            this.elements.dialBtn.style.opacity = '1';
        }

        if (this.elements.callStatusText) {
            this.elements.callStatusText.innerHTML = '<span class="status-indicator ready"></span> Ready to Dial';
        }

        // Hide disposition section
        if (this.elements.callDispositionSection) {
            this.elements.callDispositionSection.style.display = 'none';
        }

        // Update UI to show last student and reset to single-student mode
        if (lastStudent) {
            if (this.uiCallbacks.finalizeAutomation) {
                this.uiCallbacks.finalizeAutomation(lastStudent);
            } else if (this.uiCallbacks.updateCurrentStudent) {
                // Fallback if finalizeAutomation not provided
                this.uiCallbacks.updateCurrentStudent(lastStudent);
            }
        }

        // Notify completion
        console.log(`✅ Automation complete! Called ${totalCalled} students.`);
    }

    /**
     * Toggles the pause state for automation
     */
    togglePause() {
        if (!this.automationMode) return;

        this.isPaused = !this.isPaused;

        if (this.elements.pauseAutomationBtn) {
            if (this.isPaused) {
                this.elements.pauseAutomationBtn.innerHTML = '<i class="fas fa-play"></i> Resume Automation';
                this.elements.pauseAutomationBtn.classList.add('paused');
            } else {
                this.elements.pauseAutomationBtn.innerHTML = '<i class="fas fa-pause"></i> Pause After This Call';
                this.elements.pauseAutomationBtn.classList.remove('paused');

                // Resuming hides the Stop + Cancel buttons and abandons any
                // loaded previous-call redial.
                if (this.elements.stopAutomationBtn) {
                    this.elements.stopAutomationBtn.style.display = 'none';
                }
                if (this.elements.cancelRedialBtn) {
                    this.elements.cancelRedialBtn.style.display = 'none';
                }
                this._pendingRedialStudent = null;
                this._redialingFromHistory = false;

                // If we're not in a call (paused between calls), resume immediately
                if (!this.isCallActive && !this.waitingForDisposition) {
                    this.callNextStudentInQueue();
                }
            }
        }
    }

    /**
     * Returns how many automation queue entries are still queued to be called
     * starting from the current index (skipped indices excluded).
     * @returns {number}
     */
    getRemainingAutomationCount() {
        if (!this.automationMode) return 0;
        let count = 0;
        for (let i = this.currentAutomationIndex; i < this.selectedQueue.length; i++) {
            if (!this.skippedIndices.has(i)) count++;
        }
        return count;
    }

    /**
     * Shows the paused state UI between calls
     */
    showPausedState() {
        if (this.elements.dialBtn) {
            this.elements.dialBtn.style.background = `${CONFIG.COLORS.WARNING}`;
            this.elements.dialBtn.style.transform = 'rotate(0deg)';
            this.elements.dialBtn.disabled = true;
            this.elements.dialBtn.style.cursor = 'not-allowed';
            this.elements.dialBtn.style.opacity = '0.6';
        }

        if (this.elements.callStatusText) {
            this.elements.callStatusText.innerHTML = `<span class="status-indicator" style="background:${CONFIG.COLORS.WARNING};"></span> Paused`;
        }

        // Replace the contact card's name with the remaining-queue count while
        // paused. setActiveStudent will overwrite it back to the student's
        // name on the next state transition (resume / stop / cancel-redial).
        if (this.elements.contactName) {
            const remaining = this.getRemainingAutomationCount();
            if (remaining > 0) {
                this.elements.contactName.textContent = `${remaining} student${remaining === 1 ? '' : 's'} left`;
            }
        }

        // Hide the days-out / other-contact detail line while paused — the
        // count is what matters here, not the queued student's stats.
        // setActiveStudent restores it on the next transition.
        if (this.elements.contactDetail) {
            this.elements.contactDetail.style.display = 'none';
        }

        // Swap the avatar to a gray play/resume glyph so the card looks like
        // a generic "queue paused" header instead of mixing the queued
        // student's photo with the count text. setActiveStudent will restore
        // the photo / fa-user icon on the next transition.
        if (this.elements.contactAvatar) {
            this.elements.contactAvatar.style.backgroundImage = 'none';
            this.elements.contactAvatar.innerHTML = '<i class="fas fa-play"></i>';
            this.elements.contactAvatar.style.backgroundColor = '#e5e7eb';
            this.elements.contactAvatar.style.color = '#6b7280';
        }

        // Hide disposition section
        if (this.elements.callDispositionSection) {
            this.elements.callDispositionSection.style.display = 'none';
        }

        // Reveal the Stop Automation option while we're paused between calls
        if (this.elements.stopAutomationBtn) {
            this.elements.stopAutomationBtn.style.display = '';
        }

        // Update Up Next card
        this.updateUpNextCard();

        // Re-render Previous Calls so the items pick up the now-cleared
        // isCallActive/waitingForDisposition state and become clickable.
        this.refreshPreviousCallsUI();
    }

    /**
     * Cancels the automation sequence and returns to normal calling mode
     * Keeps only the current student being called
     */
    cancelAutomation() {
        // Get the current student (the one currently being called)
        const currentStudent = this.selectedQueue[this.currentAutomationIndex];

        // End the current call
        this.isCallActive = false;
        this._dispositionInProgress = false;
        this._redialingFromHistory = false;
        this._pendingRedialStudent = null;
        this._currentCallStudent = null;
        this.stopCallTimer();
        this.stopDispositionTimer();

        // Exit automation mode
        this.automationMode = false;
        this.currentAutomationIndex = 0;
        this.skippedIndices.clear();
        this.isPaused = false;

        // Hide "Up Next" card and pause button
        if (this.elements.upNextCard) {
            this.elements.upNextCard.style.display = 'none';
        }
        if (this.elements.pauseAutomationBtn) {
            this.elements.pauseAutomationBtn.style.display = 'none';
        }
        if (this.elements.stopAutomationBtn) {
            this.elements.stopAutomationBtn.style.display = 'none';
        }
        if (this.elements.cancelRedialBtn) {
            this.elements.cancelRedialBtn.style.display = 'none';
        }

        // Reset call UI to regular mode
        if (this.elements.dialBtn) {
            this.elements.dialBtn.classList.remove('automation');
            this.elements.dialBtn.innerHTML = '<i class="fas fa-phone"></i>';
            this.elements.dialBtn.style.background = `${CONFIG.COLORS.SUCCESS}`;
            this.elements.dialBtn.style.transform = 'rotate(0deg)';
            this.elements.dialBtn.disabled = false;
            this.elements.dialBtn.style.cursor = 'pointer';
            this.elements.dialBtn.style.opacity = '1';
        }

        if (this.elements.callStatusText) {
            this.elements.callStatusText.innerHTML = '<span class="status-indicator ready"></span> Ready to Dial';
        }

        // Hide disposition section
        if (this.elements.callDispositionSection) {
            this.elements.callDispositionSection.style.display = 'none';
        }

        // Hide custom input area if it was open
        if (this.elements.otherInputArea) {
            this.elements.otherInputArea.style.display = 'none';
        }

        // Clear queue to only current student and update UI
        if (currentStudent && this.uiCallbacks.cancelAutomation) {
            this.uiCallbacks.cancelAutomation(currentStudent);
        }

        this.refreshPreviousCallsUI();

        // Focus Five9 tab for disposition (only in non-demo mode)
        if (!this.debugMode) {
            this.focusFive9Tab();
        }
    }

    /**
     * Starts the call timer and updates display every second
     */
    startCallTimer() {
        let seconds = 0;
        this.elements.callTimer.textContent = "00:00";
        clearInterval(this.callTimerInterval);
        // The call and disposition timers share elements.callTimer as their
        // display surface. If the disposition timer was running, kill it now
        // so the two intervals don't fight over textContent every tick.
        if (this.dispositionTimerInterval) {
            clearInterval(this.dispositionTimerInterval);
            this.dispositionTimerInterval = null;
        }

        this.callTimerInterval = setInterval(() => {
            seconds++;
            const m = Math.floor(seconds / 60).toString().padStart(2, '0');
            const s = (seconds % 60).toString().padStart(2, '0');
            this.elements.callTimer.textContent = `${m}:${s}`;
        }, 1000);
    }

    /**
     * Stops the call timer and resets display
     */
    stopCallTimer() {
        clearInterval(this.callTimerInterval);
        this.callTimerInterval = null;
        this.elements.callTimer.textContent = "00:00";
        // Reset the phase tracker so the next call's first ACTIVE/TALKING event
        // restarts the timer as a fresh talk-time count.
        this._phaseHasBeenConnected = false;
    }

    /**
     * Starts the disposition timer to show time waiting for disposition
     */
    startDispositionTimer() {
        let seconds = 0;
        this.elements.callTimer.textContent = "00:00";
        clearInterval(this.dispositionTimerInterval);
        // Same shared-element guard as startCallTimer: if the call timer is
        // still ticking, stop it before the disposition timer takes over so
        // they don't both write to elements.callTimer.
        if (this.callTimerInterval) {
            clearInterval(this.callTimerInterval);
            this.callTimerInterval = null;
            this._phaseHasBeenConnected = false;
        }

        this.dispositionTimerInterval = setInterval(() => {
            seconds++;
            const m = Math.floor(seconds / 60).toString().padStart(2, '0');
            const s = (seconds % 60).toString().padStart(2, '0');
            this.elements.callTimer.textContent = `${m}:${s}`;
        }, 1000);
    }

    /**
     * Stops the disposition timer and resets display
     */
    stopDispositionTimer() {
        clearInterval(this.dispositionTimerInterval);
        this.dispositionTimerInterval = null;
        this.elements.callTimer.textContent = "00:00";
    }

    /**
     * Focuses the Five9 tab (for setting disposition in Five9)
     */
    async focusFive9Tab() {
        try {
            const tabs = await chrome.tabs.query({ url: "https://*.five9.com/*" });
            if (tabs.length > 0) {
                await chrome.tabs.update(tabs[0].id, { active: true });
                await chrome.windows.update(tabs[0].windowId, { focused: true });
                console.log("✓ Focused Five9 tab for disposition");
            }
        } catch (error) {
            console.error("Error focusing Five9 tab:", error);
        }
    }

    /**
     * Handles disposition set externally (through Five9 UI)
     * Resets the call state to ready
     */
    async handleExternalDisposition() {
        console.log("📋 Handling external disposition");

        // Stop any running timers
        this.stopCallTimer();
        this.stopDispositionTimer();

        // Reset call state
        this.isCallActive = false;
        this.waitingForDisposition = false;
        this._dispositionInProgress = false;

        // Update UI to ready state
        if (this.elements.dialBtn) {
            this.elements.dialBtn.style.background = `${CONFIG.COLORS.SUCCESS}`;
            this.elements.dialBtn.style.transform = 'rotate(0deg)';
            this.elements.dialBtn.disabled = false;
            this.elements.dialBtn.style.cursor = 'pointer';
            this.elements.dialBtn.style.opacity = '1';
        }

        if (this.elements.callStatusText) {
            this.elements.callStatusText.innerHTML = '<span class="status-indicator ready"></span> Ready to Dial';
        }

        // Hide disposition section
        if (this.elements.callDispositionSection) {
            this.elements.callDispositionSection.style.display = 'none';
        }

        // Hide custom input area if it was open
        if (this.elements.otherInputArea) {
            this.elements.otherInputArea.style.display = 'none';
        }

        // Update last call timestamp
        await this.updateLastCallTimestamp();

        // Add to previous-calls history
        this.addToPreviousCalls(this._currentCallStudent);
        this._currentCallStudent = null;
        this.refreshPreviousCallsUI();

        // If in automation mode, move to next student
        if (this.automationMode) {
            // If this was a redial from history, don't advance the queue index
            if (this._redialingFromHistory) {
                this._redialingFromHistory = false;
                const queueStudent = this.selectedQueue[this.currentAutomationIndex];
                if (queueStudent && this.uiCallbacks.updateCurrentStudent) {
                    this.uiCallbacks.updateCurrentStudent(queueStudent);
                }
                this.showPausedState();
                return;
            }

            this.currentAutomationIndex++;

            // Check if paused — wait instead of calling next
            if (this.isPaused) {
                this.showPausedState();
                return;
            }

            this.callNextStudentInQueue();
        }
    }

    /**
     * Adopts a call that was started directly in Five9 (the user dialed from
     * the Five9 UI rather than through this extension). Looks up the phone
     * number against the master list and either loads that student or shows
     * an "Unknown Caller" entry, then sets up the active-call UI so the
     * extension stays in sync with Five9.
     *
     * No-op when:
     *  - we're already tracking a call (extension-initiated or previously adopted)
     *  - we're waiting for / processing a disposition
     *  - automation is running (an external call would disrupt the queue)
     *
     * @param {string|null} phoneNumber - The customer's number from Five9
     * @param {string} state - The current Five9 call state (OFFERED, RINGING_*, ACTIVE, TALKING, ...)
     */
    async handleExternalCallStart(phoneNumber, state) {
        if (this.isCallActive || this.waitingForDisposition || this._dispositionInProgress) return;
        if (this.automationMode) return;
        if (this.debugMode) return; // Demo mode ignores real Five9 events
        // Re-entry guard: the master-list lookup below is async, so two rapid
        // FIVE9_CALL_STATE_CHANGED events (e.g. OFFERED → TALKING in quick
        // succession) could both pass the isCallActive check before either
        // commits the flag. Without this, both would adopt the same call and
        // double-render the contact card / queue / timer.
        if (this._adoptingExternalCall) return;
        this._adoptingExternalCall = true;

        try {
            // Look up the master list by digits-only phone match
            let target = null;
            try {
                const data = await chrome.storage.local.get([STORAGE_KEYS.MASTER_ENTRIES]);
                const students = data[STORAGE_KEYS.MASTER_ENTRIES] || [];
                const targetDigits = String(phoneNumber || '').replace(/\D/g, '');
                if (targetDigits) {
                    const found = students.find(s => {
                        const candidates = [s.directPhone, s.phone, s.Phone, s.PrimaryPhone].filter(Boolean);
                        return candidates.some(p => String(p).replace(/\D/g, '') === targetDigits);
                    });
                    if (found) {
                        target = { ...found, directPhone: phoneNumber };
                    }
                }
            } catch (err) {
                console.warn('[CallManager] handleExternalCallStart: master-list lookup failed', err);
            }

            if (!target) {
                target = {
                    name: 'Unknown Caller',
                    directPhone: phoneNumber || '',
                    phone: phoneNumber || ''
                };
            }

            // Set call-active state up front so setActiveStudent / updateCallInterfaceState
            // don't reset the dial button to "Ready to Dial".
            this.isCallActive = true;
            this.waitingForDisposition = false;
            this._currentCallStudent = target;

        // Load the resolved student into the contact card (and queue) via the
        // sidepanel callback so the rest of the UI follows the same path as a
        // manual selection.
        if (this.uiCallbacks.adoptExternalCall) {
            this.uiCallbacks.adoptExternalCall(target);
        }

        // Active-call dial button (red, rotated) — overrides the green default
        // setActiveStudent applied a moment ago.
        if (this.elements.dialBtn) {
            this.elements.dialBtn.disabled = false;
            this.elements.dialBtn.style.cursor = 'pointer';
            this.elements.dialBtn.style.opacity = '1';
            this.elements.dialBtn.style.background = `${CONFIG.COLORS.ERROR}`;
            this.elements.dialBtn.style.transform = 'rotate(135deg)';
        }

            // Reflect Five9's current state — if it's already TALKING when we
            // detected it (e.g. panel opened mid-call), setCallPhase will start
            // the talk-time timer fresh just like a normal connect.
            if (state === 'ACTIVE' || state === 'TALKING') {
                this.setCallPhase('connected');
            } else {
                this.setCallPhase('ringing');
            }

            if (this.elements.callDispositionSection) {
                this.elements.callDispositionSection.style.display = 'flex';
                this.resetDispositionButtons();
            }

            this.startCallTimer();
            this.refreshPreviousCallsUI();
        } finally {
            this._adoptingExternalCall = false;
        }
    }

    /**
     * Handles call disconnected externally (through Five9 UI)
     * Updates state to awaiting disposition
     */
    handleExternalDisconnect() {
        console.log("📞 Handling external disconnect");

        // Stop call timer, start disposition timer
        this.stopCallTimer();
        this.startDispositionTimer();

        // Update state
        this.waitingForDisposition = true;

        // Update UI to awaiting disposition
        if (this.elements.dialBtn) {
            this.elements.dialBtn.style.background = `${CONFIG.COLORS.MUTED}`;
            this.elements.dialBtn.style.transform = 'rotate(0deg)';
            this.elements.dialBtn.disabled = true;
            this.elements.dialBtn.style.cursor = 'not-allowed';
            this.elements.dialBtn.style.opacity = '0.6';
        }

        if (this.elements.callStatusText) {
            this.elements.callStatusText.innerHTML = `<span class="status-indicator" style="background:${CONFIG.COLORS.WARNING};"></span> Awaiting Disposition`;
        }

        // Keep disposition section visible if it was showing
        // Re-render Previous Calls so items show as disabled while we wait.
        this.refreshPreviousCallsUI();
    }

    /**
     * Resets all disposition buttons to their clickable state
     */
    resetDispositionButtons() {
        if (!this.elements.callDispositionSection) return;

        const dispositionBtns = this.elements.callDispositionSection.querySelectorAll('.disposition-btn');
        dispositionBtns.forEach(btn => {
            btn.style.pointerEvents = '';
            btn.style.opacity = '';
        });
    }

    /**
     * Handles call disposition selection and ends the call
     * @param {string} type - The disposition type selected
     */
    async handleDisposition(type) {
        // Prevent double-clicks while already processing
        if (this._dispositionInProgress) {
            console.log("⏳ Disposition already in progress — ignoring");
            return;
        }
        this._dispositionInProgress = true;


        console.log("Logged Disposition:", type);

        // Disable dial button immediately to prevent glitchy clicks during processing
        this.elements.dialBtn.disabled = true;
        this.elements.dialBtn.style.cursor = 'not-allowed';
        this.elements.dialBtn.style.opacity = '0.6';

        // Stop disposition timer if running
        this.stopDispositionTimer();

        // TODO: Store disposition data
        // Future implementation:
        // - Save disposition to chrome.storage
        // - Associate with current student
        // - Track disposition history

        let disposeResult = { success: true, state: 'FINISHED' };

        // Check if call was already ended (user clicked end call button first)
        if (this.waitingForDisposition) {
            // Call already ended, just setting disposition
            this.elements.callStatusText.innerHTML = `<span class="status-indicator" style="background:${CONFIG.COLORS.PRIMARY};"></span> Setting disposition...`;

            // Send dispose-only request to Five9
            console.log("📋 Setting disposition for already-ended call");

            // --- SEND DISPOSITION TO FIVE9 (ONLY IF DEBUG MODE OFF) ---
            if (!this.debugMode) {
                disposeResult = await this.sendDispositionOnly(type);
            } else {
                console.log("📞 [DEMO MODE] Simulating disposition send");
                // Small delay to simulate the operation
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            // -------------------------
        } else {
            // Call is still active, need to end it first
            this.elements.callStatusText.innerHTML = `<span class="status-indicator" style="background:${CONFIG.COLORS.WARNING};"></span> Ending call...`;

            // --- HANGUP FIVE9 CALL (ONLY IF DEBUG MODE OFF) ---
            if (!this.debugMode) {
                console.log("⏳ Waiting for Five9 dispose to complete...");
                // CRITICAL: Wait for dispose to complete before marking call as inactive
                // This prevents race conditions where pings arrive before dispose finishes
                disposeResult = await this.hangupCall(type);
            } else {
                console.log("📞 [DEMO MODE] Simulating hangup after disposition");
            }
            // -------------------------

            // Show "Setting disposition" status after call ends
            this.elements.callStatusText.innerHTML = `<span class="status-indicator" style="background:${CONFIG.COLORS.PRIMARY};"></span> Setting disposition...`;

            // Small delay to show the status
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Check the interaction state after disposition
        const state = disposeResult?.state || 'FINISHED';
        console.log("📊 Call state after disposition:", state);

        if (state === 'FINISHED') {
            // Disposition set successfully - call is completely done
            this.elements.callStatusText.innerHTML = `<span class="status-indicator" style="background:${CONFIG.COLORS.SUCCESS};"></span> Disposition Set`;

            // NOW we can mark call as inactive - disposition is confirmed
            this.isCallActive = false;
            this.stopCallTimer();

            // Small delay to show the "Disposition Set" message
            await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
            // Unexpected state - mark as inactive anyway
            console.warn("⚠️ Unexpected state after disposition:", state);
            this.isCallActive = false;
            this.stopCallTimer();
        }

        // Update last call timestamp
        await this.updateLastCallTimestamp();

        // Clear waiting for disposition flag BEFORE rendering Previous Calls so
        // the items aren't drawn as disabled with the stale "in active call"
        // tooltip. (The renderer keys off isCallActive + waitingForDisposition.)
        this.waitingForDisposition = false;

        // Add to previous-calls history
        this.addToPreviousCalls(this._currentCallStudent);

        // Check if in automation mode
        if (this.automationMode) {
            // If this call was a redial from history, don't advance the queue index;
            // restore the active student card to the queue's current student and pause.
            if (this._redialingFromHistory) {
                this._redialingFromHistory = false;
                const queueStudent = this.selectedQueue[this.currentAutomationIndex];
                if (queueStudent && this.uiCallbacks.updateCurrentStudent) {
                    this.uiCallbacks.updateCurrentStudent(queueStudent);
                }
                this.showPausedState();
                this._currentCallStudent = null;
                this._dispositionInProgress = false;
                return;
            }

            // Move to next student
            this.currentAutomationIndex++;

            // Check if paused — wait instead of calling next
            if (this.isPaused) {
                this.showPausedState();
                this._currentCallStudent = null;
                this._dispositionInProgress = false;
                return;
            }

            // Hide disposition section
            if (this.elements.callDispositionSection) {
                this.elements.callDispositionSection.style.display = 'none';
            }

            // Call next student immediately after dispose completes
            // No need for delay since we already waited for dispose
            this.callNextStudentInQueue();
        } else {
            // Single call mode - update UI to end the call
            this.elements.dialBtn.style.background = `${CONFIG.COLORS.SUCCESS}`;
            this.elements.dialBtn.style.transform = 'rotate(0deg)';
            this.elements.dialBtn.disabled = false;
            this.elements.dialBtn.style.cursor = 'pointer';
            this.elements.dialBtn.style.opacity = '1';
            this.elements.callStatusText.innerHTML = '<span class="status-indicator ready"></span> Ready to Dial';

            // Hide Disposition Grid
            if (this.elements.callDispositionSection) {
                this.elements.callDispositionSection.style.display = 'none';
            }

            // Hide custom input area if it was open
            if (this.elements.otherInputArea) {
                this.elements.otherInputArea.style.display = 'none';
            }
        }

        // Clear the disposition-in-progress guard
        this._currentCallStudent = null;
        this._dispositionInProgress = false;

        this.refreshPreviousCallsUI();
    }

    /**
     * Initiates a call through Five9
     * @param {string} phoneNumber - Phone number to dial
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async initiateCall(phoneNumber) {
        if (!phoneNumber || phoneNumber === "No Phone Listed") {
            return { success: false, error: "No valid phone number" };
        }

        try {
            // Send message to background.js (which will forward to Five9 content script)
            chrome.runtime.sendMessage({
                type: 'triggerFive9Call',
                phoneNumber: phoneNumber
            });

            // Note: Response will come via 'callStatus' message listener
            return { success: true };
        } catch (error) {
            console.error("Error initiating call:", error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Hangs up the current Five9 call
     * @param {string} dispositionType - The disposition type selected by the user
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async hangupCall(dispositionType = null) {
        try {
            // Create a promise that resolves when the hangup is complete
            return new Promise((resolve) => {
                let isResolved = false;

                // Set up one-time listener for hangup completion
                const hangupListener = (message) => {
                    if (message.type === 'hangupStatus' && !isResolved) {
                        isResolved = true;
                        // Remove listener after receiving response
                        chrome.runtime.onMessage.removeListener(hangupListener);

                        if (message.success) {
                            console.log("✓ Five9 dispose completed successfully");
                            console.log("✓ Interaction state:", message.state);
                            resolve({ success: true, state: message.state });
                        } else {
                            console.error("Five9 dispose error:", message.error);
                            resolve({ success: false, error: message.error });
                        }
                    }
                };

                // Add listener before sending message
                chrome.runtime.onMessage.addListener(hangupListener);

                // Safety timeout: If no response after 10 seconds, resolve anyway
                // This prevents the call from being stuck indefinitely
                setTimeout(() => {
                    if (!isResolved) {
                        isResolved = true;
                        chrome.runtime.onMessage.removeListener(hangupListener);
                        console.warn("⚠️ Hangup timeout - assuming dispose completed");
                        resolve({ success: true, warning: "Timeout" });
                    }
                }, 10000);

                // Send hangup request
                chrome.runtime.sendMessage({
                    type: 'triggerFive9Hangup',
                    dispositionType: dispositionType
                });
            });
        } catch (error) {
            console.error("Error hanging up call:", error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Sends disposition only (for calls already disconnected)
     * Used when user ends call first, then selects disposition
     * @param {string} dispositionType - The disposition type selected by the user
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async sendDispositionOnly(dispositionType) {
        try {
            // Create a promise that resolves when the dispose is complete
            return new Promise((resolve) => {
                let isResolved = false;

                // Set up one-time listener for dispose completion
                const disposeListener = (message) => {
                    if (message.type === 'disposeStatus' && !isResolved) {
                        isResolved = true;
                        // Remove listener after receiving response
                        chrome.runtime.onMessage.removeListener(disposeListener);

                        if (message.success) {
                            console.log("✓ Five9 disposition sent successfully");
                            console.log("✓ Interaction state:", message.state);
                            resolve({ success: true, state: message.state });
                        } else {
                            console.error("Five9 disposition error:", message.error);
                            resolve({ success: false, error: message.error });
                        }
                    }
                };

                // Add listener before sending message
                chrome.runtime.onMessage.addListener(disposeListener);

                // Safety timeout: If no response after 10 seconds, resolve anyway
                setTimeout(() => {
                    if (!isResolved) {
                        isResolved = true;
                        chrome.runtime.onMessage.removeListener(disposeListener);
                        console.warn("⚠️ Dispose timeout - assuming completed");
                        resolve({ success: true, warning: "Timeout" });
                    }
                }, 10000);

                // Send dispose request
                chrome.runtime.sendMessage({
                    type: 'triggerFive9DisposeOnly',
                    dispositionType: dispositionType
                });
            });
        } catch (error) {
            console.error("Error sending disposition:", error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Updates the call interface visual state based on debug mode
     */
    updateCallInterfaceState() {
        if (!this.elements.dialBtn || !this.elements.callStatusText) return;

        // Always enable call interface - debug mode just changes behavior
        this.elements.dialBtn.style.opacity = '1';
        this.elements.dialBtn.style.cursor = 'pointer';

        if (!this.isCallActive) {
            // The status text reads "Ready to Dial" in both modes; the active
            // mode is communicated via the demo banner (when on) and the dial
            // button's tooltip.
            this.elements.dialBtn.title = this.debugMode
                ? 'Demo Mode - Simulates calling without Five9 API'
                : 'Live Mode - Calls via Five9 API';
            this.elements.callStatusText.innerHTML = '<span class="status-indicator ready"></span> Ready to Dial';
        }
    }

    /**
     * Formats a timestamp for display
     * If today: shows time only (e.g., "3:45 PM")
     * If not today: shows date (e.g., "12-25-25")
     * @param {number} timestamp - Unix timestamp in milliseconds
     * @returns {string} Formatted timestamp string
     */
    formatLastCallTimestamp(timestamp) {
        if (!timestamp) return 'Never';

        const now = new Date();
        const callDate = new Date(timestamp);

        // Check if the call was today
        const isToday = now.toDateString() === callDate.toDateString();

        if (isToday) {
            // Return time only
            let hours = callDate.getHours();
            const minutes = callDate.getMinutes().toString().padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12; // Convert to 12-hour format
            return `${hours}:${minutes} ${ampm}`;
        } else {
            // Return date in MM-DD-YY format
            const month = (callDate.getMonth() + 1).toString().padStart(2, '0');
            const day = callDate.getDate().toString().padStart(2, '0');
            const year = callDate.getFullYear().toString().slice(-2);
            return `${month}-${day}-${year}`;
        }
    }

    /**
     * Updates the last call timestamp and saves to storage
     */
    async updateLastCallTimestamp() {
        const now = Date.now();

        // Save to storage
        await chrome.storage.local.set({
            [STORAGE_KEYS.LAST_CALL_TIMESTAMP]: now
        });

        // Update UI
        this.displayLastCallTimestamp(now);
    }

    /**
     * Displays the last call timestamp in the UI
     * @param {number} timestamp - Unix timestamp in milliseconds
     */
    displayLastCallTimestamp(timestamp) {
        if (!this.elements.lastCallTimestamp) return;

        const formattedTime = this.formatLastCallTimestamp(timestamp);
        this.elements.lastCallTimestamp.textContent = `Last call: ${formattedTime}`;
    }

    /**
     * Loads and displays the last call timestamp from storage
     */
    async loadLastCallTimestamp() {
        const result = await chrome.storage.local.get(STORAGE_KEYS.LAST_CALL_TIMESTAMP);
        const timestamp = result[STORAGE_KEYS.LAST_CALL_TIMESTAMP];

        if (timestamp) {
            this.displayLastCallTimestamp(timestamp);
        }
    }

    /**
     * Adds a student to the previous calls history (most recent first).
     * Trims to MAX_PREVIOUS_CALLS, persists to storage, and notifies the UI.
     * @param {Object} student - The student that was just called
     */
    addToPreviousCalls(student) {
        if (!student) return;

        const entry = {
            name: student.name || student.nameOriginal || 'Unknown Student',
            nameOriginal: student.nameOriginal || student.name || null,
            directPhone: student.directPhone || null,
            phone: student.phone || null,
            Phone: student.Phone || null,
            PrimaryPhone: student.PrimaryPhone || null,
            Photo: student.Photo || null,
            timestamp: Date.now()
        };

        // Remove any existing entry with the same name (move-to-front behavior)
        this.previousCalls = this.previousCalls.filter(p => p.name !== entry.name);

        // Insert at the front
        this.previousCalls.unshift(entry);

        // Trim
        if (this.previousCalls.length > CallManager.MAX_PREVIOUS_CALLS) {
            this.previousCalls = this.previousCalls.slice(0, CallManager.MAX_PREVIOUS_CALLS);
        }

        this.savePreviousCalls();
        this.refreshPreviousCallsUI();
    }

    /**
     * Persists the previous calls list to chrome.storage so it survives
     * side-panel close/reopen (and browser restarts).
     */
    async savePreviousCalls() {
        try {
            await chrome.storage.local.set({
                [STORAGE_KEYS.PREVIOUS_CALLS]: this.previousCalls
            });
        } catch (err) {
            console.warn('[CallManager] Failed to save previous calls:', err);
        }
    }

    /**
     * Loads the previous calls list from storage and renders the card.
     * Called once at startup.
     */
    async loadPreviousCalls() {
        try {
            const result = await chrome.storage.local.get(STORAGE_KEYS.PREVIOUS_CALLS);
            const stored = result[STORAGE_KEYS.PREVIOUS_CALLS];
            if (Array.isArray(stored)) {
                this.previousCalls = stored.slice(0, CallManager.MAX_PREVIOUS_CALLS);
                this.refreshPreviousCallsUI();
            }
        } catch (err) {
            console.warn('[CallManager] Failed to load previous calls:', err);
        }
    }

    /**
     * Returns a copy of the current previous-calls list
     * @returns {Array}
     */
    getPreviousCalls() {
        return this.previousCalls.slice();
    }

    /**
     * Re-renders the previous calls card. Used after call-state transitions so the
     * disabled state of the dial-back rows stays accurate.
     */
    refreshPreviousCallsUI() {
        if (this.uiCallbacks.renderPreviousCalls) {
            this.uiCallbacks.renderPreviousCalls(this.previousCalls);
        }
    }

    /**
     * Loads a student from the previous calls history into the dialer.
     * Does NOT auto-dial — the user clicks the dial button to actually call.
     *
     * - If a call is in progress (or disposition pending), this is a no-op.
     * - If automation is running, the queue stays intact and a one-shot redial
     *   is staged: automation is paused, the contact card shows the loaded
     *   student, and the dial button is re-enabled. When the user clicks dial,
     *   that student is called instead of the queue's next one. After the
     *   redial's disposition is set, the contact card is restored to the
     *   queue's current student and the user can resume automation.
     * - If automation is not running, replaces the queue with this single
     *   student so the regular dial flow calls them.
     * @param {Object} historicEntry - The student snapshot from previousCalls
     */
    loadFromHistory(historicEntry) {
        if (!historicEntry) return;

        // Don't change the loaded student during a call or disposition
        if (this.isCallActive || this.waitingForDisposition || this._dispositionInProgress) {
            console.log('[CallManager] Ignoring previous-call selection — a call is already in progress');
            return;
        }

        const phoneNumber = this.getPhoneNumber(historicEntry);
        if (!phoneNumber || phoneNumber === "No Phone Listed") {
            console.warn(`[CallManager] Cannot load ${historicEntry.name}: no phone number`);
            return;
        }

        if (this.automationMode) {
            // Stage a one-shot redial without disturbing the queue
            this.isPaused = true;
            this._redialingFromHistory = true;
            this._pendingRedialStudent = historicEntry;

            if (this.elements.pauseAutomationBtn) {
                this.elements.pauseAutomationBtn.innerHTML = '<i class="fas fa-play"></i> Resume Automation';
                this.elements.pauseAutomationBtn.classList.add('paused');
            }

            if (this.uiCallbacks.updateCurrentStudent) {
                this.uiCallbacks.updateCurrentStudent(historicEntry);
            }

            // Re-enable the dial button so the user can click it (showPausedState
            // had disabled it). Drop the .automation class so the button looks
            // like a normal "ready" dial (the .automation CSS uses !important).
            if (this.elements.dialBtn) {
                this.elements.dialBtn.classList.remove('automation');
                this.elements.dialBtn.innerHTML = '<i class="fas fa-phone"></i>';
                this.elements.dialBtn.disabled = false;
                this.elements.dialBtn.style.cursor = 'pointer';
                this.elements.dialBtn.style.opacity = '1';
                this.elements.dialBtn.style.background = `${CONFIG.COLORS.SUCCESS}`;
                this.elements.dialBtn.style.transform = 'rotate(0deg)';
            }
            if (this.elements.callStatusText) {
                this.elements.callStatusText.innerHTML = '<span class="status-indicator ready"></span> Ready to Dial';
            }

            // Hide the Up Next card during the redial; restored via showPausedState/updateUpNextCard later.
            if (this.elements.upNextCard) {
                this.elements.upNextCard.style.display = 'none';
            }

            // Show the Cancel button so the user can revert this staged redial
            // and go back to the queue's current student.
            if (this.elements.cancelRedialBtn) {
                this.elements.cancelRedialBtn.style.display = '';
            }
        } else {
            // Not in automation: replace the queue with this student so the regular
            // dial flow targets them. No auto-dial.
            if (this.uiCallbacks.cancelAutomation) {
                this.uiCallbacks.cancelAutomation(historicEntry);
            }
        }

        this.refreshPreviousCallsUI();
    }

    /**
     * Reverts a staged redial (or custom-phone selection) made during a paused
     * automation, restoring the contact card to the queue's current student.
     * No-op if there's nothing staged or we're not paused.
     */
    clearStagedRedial() {
        if (!this.automationMode || !this.isPaused) return;
        if (!this._pendingRedialStudent && !this._redialingFromHistory) return;

        this._pendingRedialStudent = null;
        this._redialingFromHistory = false;

        // Re-show the paused UI directly: showPausedState overwrites the
        // contact card with the queue-summary view (count + play avatar +
        // hidden detail line) so we don't need to load the queue student
        // first. Doing so caused setActiveStudent's async tail (it awaits
        // chrome.storage.local for the reformatNameEnabled setting) to
        // race against showPausedState's synchronous DOM writes — the
        // queue student's name/avatar/detail would land AFTER our paused
        // overrides and visibly clobber them. The next resume runs through
        // callNextStudentInQueue → updateCurrentStudent, which loads the
        // queue student into the card right before dialing.
        this.showPausedState();

        if (this.elements.cancelRedialBtn) {
            this.elements.cancelRedialBtn.style.display = 'none';
        }

        this.refreshPreviousCallsUI();
    }

    /**
     * Initiates a call to the pending redial student without disturbing the
     * automation queue. Called by toggleCallState when _pendingRedialStudent
     * is set.
     */
    _initiateRedial() {
        const student = this._pendingRedialStudent;
        this._pendingRedialStudent = null;
        if (!student) return;

        const phoneNumber = this.getPhoneNumber(student);
        if (!phoneNumber || phoneNumber === "No Phone Listed") {
            console.warn(`[CallManager] Cannot redial ${student.name}: no phone number`);
            return;
        }

        this._currentCallStudent = student;

        if (!this.debugMode) {
            this.initiateCall(phoneNumber);
        } else {
            console.log(`📞 [DEMO MODE] Simulating redial to: ${student.name || 'Unknown'}`);
        }

        this.isCallActive = true;
        this.waitingForDisposition = false;
        if (this.elements.dialBtn) {
            this.elements.dialBtn.disabled = false;
            this.elements.dialBtn.style.cursor = 'pointer';
            this.elements.dialBtn.style.opacity = '1';
            this.elements.dialBtn.style.background = `${CONFIG.COLORS.ERROR}`;
            this.elements.dialBtn.style.transform = 'rotate(135deg)';
        }
        this.setCallPhase('ringing');

        if (this.elements.callDispositionSection) {
            this.elements.callDispositionSection.style.display = 'flex';
            this.resetDispositionButtons();
        }

        if (this.elements.upNextCard) {
            this.elements.upNextCard.style.display = 'none';
        }

        // The redial is now in flight — Cancel no longer applies.
        if (this.elements.cancelRedialBtn) {
            this.elements.cancelRedialBtn.style.display = 'none';
        }

        this.startCallTimer();
        this.refreshPreviousCallsUI();
    }

    /**
     * Force-ends the current call with a default disposition.
     * Used when the ribbon sends a new student while a call is active.
     * @param {string} [disposition="No Answer"] - The disposition to use
     */
    async forceEndCall(disposition = "No Answer") {
        if (!this.isCallActive && !this.waitingForDisposition) return;

        console.log(`📞 Force-ending current call with disposition: "${disposition}"`);

        // Cancel automation mode if active
        if (this.automationMode) {
            this.automationMode = false;
            this.currentAutomationIndex = 0;
            this.skippedIndices.clear();
            this.isPaused = false;
            if (this.elements.upNextCard) {
                this.elements.upNextCard.style.display = 'none';
            }
            if (this.elements.pauseAutomationBtn) {
                this.elements.pauseAutomationBtn.style.display = 'none';
            }
        }

        // Drop any in-flight redial-from-history flag so dispose runs the regular path
        this._redialingFromHistory = false;
        this._pendingRedialStudent = null;

        // Allow forceEndCall to bypass the disposition guard since it's internal
        this._dispositionInProgress = false;

        // Use handleDisposition to properly end the call through Five9
        await this.handleDisposition(disposition);
    }

    /**
     * Cleanup method - call when disposing the manager
     */
    cleanup() {
        this.stopCallTimer();
        this.stopDispositionTimer();
        this.selectedQueue = [];
        this.isCallActive = false;
        this.previousCalls = [];
        this._redialingFromHistory = false;
        this._pendingRedialStudent = null;
        this._currentCallStudent = null;
    }
}
