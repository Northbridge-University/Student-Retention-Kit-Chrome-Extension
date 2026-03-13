// Error Blanket - Full-screen error overlay for unrecoverable runtime errors
// Shows a user-friendly message when the extension loses connection to a page

let errorBlanketVisible = false;

// Error patterns that should trigger the blanket
const BLANKET_ERROR_PATTERNS = [
    /Cannot read properties of undefined/i,
    /Cannot read properties of null/i,
    /Could not establish connection/i,
    /Receiving end does not exist/i,
    /Extension context invalidated/i,
    /runtime\.lastError/i
];

/**
 * Shows the error blanket overlay with a message
 * @param {string} [errorDetail] - Optional technical error detail to display
 */
export function showErrorBlanket(errorDetail) {
    if (errorBlanketVisible) return; // Prevent stacking

    const blanket = document.getElementById('errorBlanket');
    if (!blanket) return;

    errorBlanketVisible = true;
    blanket.style.display = 'flex';

    // Show technical details if provided
    const detailsEl = document.getElementById('errorBlanketDetails');
    if (detailsEl && errorDetail) {
        detailsEl.textContent = errorDetail;
        detailsEl.style.display = 'block';
    }
}

/**
 * Hides the error blanket overlay
 */
export function hideErrorBlanket() {
    const blanket = document.getElementById('errorBlanket');
    if (!blanket) return;

    errorBlanketVisible = false;
    blanket.style.display = 'none';

    const detailsEl = document.getElementById('errorBlanketDetails');
    if (detailsEl) {
        detailsEl.textContent = '';
        detailsEl.style.display = 'none';
    }
}

/**
 * Checks if an error message matches known blanket-worthy patterns
 * @param {string} message - The error message to check
 * @returns {boolean}
 */
function isBlanketError(message) {
    if (!message || typeof message !== 'string') return false;
    return BLANKET_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * Initializes the error blanket system:
 * - Listens for unhandled errors and promise rejections
 * - Wires up the refresh button
 */
export function initErrorBlanket() {
    // Refresh button reloads the sidepanel
    const refreshBtn = document.getElementById('errorBlanketRefreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            window.location.reload();
        });
    }

    // Catch unhandled errors
    window.addEventListener('error', (event) => {
        const message = event.message || String(event.error);
        if (isBlanketError(message)) {
            console.error('Error blanket triggered by error:', message);
            showErrorBlanket(message);
        }
    });

    // Catch unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
        const message = event.reason?.message || String(event.reason);
        if (isBlanketError(message)) {
            console.error('Error blanket triggered by rejection:', message);
            showErrorBlanket(message);
        }
    });

    console.log('🛡️ Error blanket initialized');
}
