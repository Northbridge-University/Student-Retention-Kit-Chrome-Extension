// [2025-12-18] Version 1.3 - Call Manager Module
// Handles all call state management, automation, and Five9 integration
// v1.2: Skip button marks students to skip over without removing from queue
// v1.3: Dial button cancels automation and keeps only current student

import { STORAGE_KEYS } from '../constants/index.js';
import { CONFIG } from '../constants/config.js';

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
    }

    /**
     * Updates the reference to the selected queue
     * @param {Array} queue - Array of selected student entries
     */
    updateQueue(queue) {
        this.selectedQueue = queue;
    }

    /**
     * Sets debug mode state
     * @param {boolean} enabled - Whether debug mode is enabled
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
        this.updateCallInterfaceState();
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
            if (!this.debugMode) {
                const currentStudent = this.selectedQueue[0];
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
            const statusText = this.debugMode ? '🎭 Demo Call Active' : 'Connected';
            this.elements.callStatusText.innerHTML = `<span class="status-indicator" style="background:${CONFIG.COLORS.ERROR}; animation: blink 1s infinite;"></span> ${statusText}`;

            // Show Disposition Grid and reset button states
            if (this.elements.callDispositionSection) {
                this.elements.callDispositionSection.style.display = 'flex';
                this.resetDispositionButtons();
            }

            this.startCallTimer();
        } else {
            // Call is ending - show "Ending call" status
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

                // Disable dial button while awaiting disposition
                this.elements.dialBtn.disabled = true;
                this.elements.dialBtn.style.cursor = 'not-allowed';
                this.elements.dialBtn.style.opacity = '0.6';

                // Start disposition timer to show waiting time
                this.startDispositionTimer();

                // Focus Five9 tab for disposition (only in non-demo mode)
                if (!this.debugMode) {
                    this.focusFive9Tab();
                }
            } else {
                // Call fully completed (shouldn't normally happen without disposition)
                this.elements.dialBtn.style.background = `${CONFIG.COLORS.SUCCESS}`; // Turn green when ready
                this.elements.callStatusText.innerHTML = '<span class="status-indicator ready"></span> Ready to Connect';
                this.isCallActive = false;
                this.waitingForDisposition = false;
            }

            // Hide custom input area if it was open
            if (this.elements.otherInputArea) {
                this.elements.otherInputArea.style.display = 'none';
            }

            this.stopCallTimer();
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
        this.elements.dialBtn.style.background = `${CONFIG.COLORS.ERROR}`;
        this.elements.dialBtn.style.transform = 'rotate(135deg)';
        const statusText = this.debugMode ? '🎭 Demo Call Active' : 'Connected';
        this.elements.callStatusText.innerHTML = `<span class="status-indicator" style="background:${CONFIG.COLORS.ERROR}; animation: blink 1s infinite;"></span> ${statusText}`;

        // Show Disposition Grid and reset button states
        if (this.elements.callDispositionSection) {
            this.elements.callDispositionSection.style.display = 'flex';
            this.resetDispositionButtons();
        }

        this.startCallTimer();
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

        // Hide "Up Next" card
        if (this.elements.upNextCard) {
            this.elements.upNextCard.style.display = 'none';
        }

        // Reset call UI to regular mode
        if (this.elements.dialBtn) {
            this.elements.dialBtn.classList.remove('automation');
            this.elements.dialBtn.innerHTML = '<i class="fas fa-phone"></i>';
            this.elements.dialBtn.style.background = `${CONFIG.COLORS.SUCCESS}`;
            this.elements.dialBtn.style.transform = 'rotate(0deg)';
        }

        if (this.elements.callStatusText) {
            this.elements.callStatusText.innerHTML = '<span class="status-indicator ready"></span> Ready to Connect';
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
     * Cancels the automation sequence and returns to normal calling mode
     * Keeps only the current student being called
     */
    cancelAutomation() {
        // Get the current student (the one currently being called)
        const currentStudent = this.selectedQueue[this.currentAutomationIndex];

        // End the current call
        this.isCallActive = false;
        this._dispositionInProgress = false;
        this.stopCallTimer();
        this.stopDispositionTimer();

        // Exit automation mode
        this.automationMode = false;
        this.currentAutomationIndex = 0;
        this.skippedIndices.clear();

        // Hide "Up Next" card
        if (this.elements.upNextCard) {
            this.elements.upNextCard.style.display = 'none';
        }

        // Reset call UI to regular mode
        if (this.elements.dialBtn) {
            this.elements.dialBtn.classList.remove('automation');
            this.elements.dialBtn.innerHTML = '<i class="fas fa-phone"></i>';
            this.elements.dialBtn.style.background = `${CONFIG.COLORS.SUCCESS}`;
            this.elements.dialBtn.style.transform = 'rotate(0deg)';
        }

        if (this.elements.callStatusText) {
            this.elements.callStatusText.innerHTML = '<span class="status-indicator ready"></span> Ready to Connect';
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
    }

    /**
     * Starts the disposition timer to show time waiting for disposition
     */
    startDispositionTimer() {
        let seconds = 0;
        this.elements.callTimer.textContent = "00:00";
        clearInterval(this.dispositionTimerInterval);

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
            const tabs = await chrome.tabs.query({ url: "https://app-atl.five9.com/*" });
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
            this.elements.callStatusText.innerHTML = '<span class="status-indicator ready"></span> Ready to Connect';
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

        // If in automation mode, move to next student
        if (this.automationMode) {
            this.currentAutomationIndex++;
            this.callNextStudentInQueue();
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

        // Clear waiting for disposition flag
        this.waitingForDisposition = false;

        // Check if in automation mode
        if (this.automationMode) {
            // Move to next student
            this.currentAutomationIndex++;

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
            this.elements.callStatusText.innerHTML = '<span class="status-indicator ready"></span> Ready to Connect';

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
        this._dispositionInProgress = false;
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
            if (this.debugMode) {
                // Demo mode
                this.elements.dialBtn.title = 'Demo Mode - Simulates calling without Five9 API';
                this.elements.callStatusText.innerHTML = `<span class="status-indicator" style="background:${CONFIG.COLORS.WARNING};"></span> 🎭 Demo Mode Active`;
            } else {
                // Five9 mode
                this.elements.dialBtn.title = 'Live Mode - Calls via Five9 API';
                this.elements.callStatusText.innerHTML = '<span class="status-indicator ready"></span> Ready to Connect';
            }
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
            if (this.elements.upNextCard) {
                this.elements.upNextCard.style.display = 'none';
            }
        }

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
    }
}
