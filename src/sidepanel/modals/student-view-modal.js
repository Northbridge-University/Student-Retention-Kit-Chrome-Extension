// Student View Modal - Shows detailed student information
import { GENERIC_AVATAR_URL } from '../../constants/index.js';
import { elements } from '../ui-manager.js';
import { resolveStudentData } from '../student-renderer.js';

// Store the current student for the student view modal
let currentStudentViewStudent = null;

/**
 * Gets the current student displayed in the student view modal
 * @returns {Object|null} The current student data or null
 */
export function getCurrentStudentViewStudent() {
    return currentStudentViewStudent;
}

/**
 * Opens the student view modal with student details
 * @param {Object} student - The student data object
 * @param {boolean} hasMultipleCampuses - Whether there are multiple campuses in the list
 * @param {string} [campusPrefix=''] - Common prefix to trim from campus names for display
 */
export function openStudentViewModal(student, hasMultipleCampuses = false, campusPrefix = '') {
    if (!elements.studentViewModal || !student) return;

    // Store the current student for access by email button
    currentStudentViewStudent = student;

    const data = resolveStudentData(student);

    // Reset to main view
    showStudentViewMain();

    // Generate initials for avatar fallback
    const nameParts = (data.name || '').trim().split(/\s+/);
    let initials = '';
    if (nameParts.length > 0) {
        const firstInitial = nameParts[0][0] || '';
        const lastInitial = nameParts.length > 1 ? nameParts[nameParts.length - 1][0] : '';
        initials = (firstInitial + lastInitial).toUpperCase();
        if (!initials) initials = '?';
    }

    // Avatar
    if (elements.studentViewAvatar) {
        if (data.Photo && data.Photo !== GENERIC_AVATAR_URL) {
            elements.studentViewAvatar.textContent = '';
            elements.studentViewAvatar.style.backgroundImage = `url('${data.Photo}')`;
            elements.studentViewAvatar.style.backgroundSize = 'cover';
            elements.studentViewAvatar.style.backgroundPosition = 'center';
            elements.studentViewAvatar.style.backgroundColor = 'transparent';
            elements.studentViewAvatar.style.color = 'transparent';
        } else {
            elements.studentViewAvatar.style.backgroundImage = 'none';
            elements.studentViewAvatar.textContent = initials;

            // Gender-based avatar colors
            const gender = (student.Gender || student.gender || '').toLowerCase();
            if (gender === 'male' || gender === 'm' || gender === 'boy') {
                elements.studentViewAvatar.style.backgroundColor = 'rgb(18, 120, 255)'; // Blue
                elements.studentViewAvatar.style.color = 'rgb(255, 255, 255)'; // White
            } else if (gender === 'female' || gender === 'f' || gender === 'girl') {
                elements.studentViewAvatar.style.backgroundColor = 'rgb(255, 145, 175)'; // Pastel pink
                elements.studentViewAvatar.style.color = 'rgb(255, 255, 255)'; // White
            } else {
                elements.studentViewAvatar.style.backgroundColor = '#e5e7eb'; // Gray
                elements.studentViewAvatar.style.color = '#6b7280';
            }
        }
    }

    // Name
    if (elements.studentViewName) {
        elements.studentViewName.textContent = data.name || 'Unknown Student';
    }

    // Campus (only show if multiple campuses) - access raw student field
    if (elements.studentViewCampus) {
        const campusSpan = elements.studentViewCampus.querySelector('span');
        const campus = student.campus || student.Campus || '';
        if (hasMultipleCampuses && campus) {
            elements.studentViewCampus.style.display = 'block';
            // Trim common prefix for cleaner display
            let displayCampus = campus;
            if (campusPrefix && campus.startsWith(campusPrefix)) {
                displayCampus = campus.substring(campusPrefix.length).replace(/^[\s\-–—:]+/, '').trim() || campus;
            }
            if (campusSpan) campusSpan.textContent = displayCampus;
        } else {
            elements.studentViewCampus.style.display = 'none';
        }
    }

    // New badge
    if (elements.studentViewNewBadge) {
        elements.studentViewNewBadge.style.display = data.isNew ? 'block' : 'none';
    }

    // Days Out - gray by default, red if >= 14
    if (elements.studentViewDaysOut && elements.studentViewDaysOutCard) {
        const daysOut = data.daysOut !== undefined && data.daysOut !== null ? data.daysOut : '-';
        elements.studentViewDaysOut.textContent = daysOut;

        const daysOutNum = parseInt(daysOut) || 0;
        if (daysOutNum >= 14) {
            elements.studentViewDaysOutCard.style.background = 'rgba(239, 68, 68, 0.15)';
            elements.studentViewDaysOutCard.style.color = '#b91c1c';
        } else {
            elements.studentViewDaysOutCard.style.background = 'rgba(107, 114, 128, 0.15)';
            elements.studentViewDaysOutCard.style.color = '#4b5563';
        }
    }

    // Days Out Detail View population
    if (elements.studentViewDaysOutTitle && elements.studentViewDaysLeftText && elements.studentViewDeadlineText) {
        const daysOut = data.daysOut !== undefined && data.daysOut !== null ? parseInt(data.daysOut) : 0;

        // Title: "X Days Out"
        elements.studentViewDaysOutTitle.textContent = `${daysOut} Days Out`;

        // Calculate days left (assuming 14 days total for a standard period)
        const daysLeft = Math.max(0, 14 - daysOut);
        elements.studentViewDaysLeftText.textContent = `The student has ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left.`;

        // Calculate deadline date
        const today = new Date();
        const deadlineDate = new Date(today);
        deadlineDate.setDate(today.getDate() + daysLeft);

        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        const formattedDate = deadlineDate.toLocaleDateString('en-US', options);
        elements.studentViewDeadlineText.textContent = `They have until ${formattedDate} to submit work.`;
    }

    // Grade - access raw student field, always gray
    if (elements.studentViewGrade && elements.studentViewGradeCard) {
        const rawGrade = student.grade ?? student.Grade ?? student.currentGrade ?? null;
        const grade = rawGrade !== undefined && rawGrade !== null ? rawGrade : '-';
        elements.studentViewGrade.textContent = (typeof grade === 'number' || !isNaN(parseFloat(grade))) && grade !== '-' ? `${parseFloat(grade).toFixed(0)}%` : grade;

        // Always gray
        elements.studentViewGradeCard.style.background = 'rgba(107, 114, 128, 0.15)';
        elements.studentViewGradeCard.style.color = '#4b5563';
    }

    // Missing Assignments Card - show count, always gray
    const missing = student.missingAssignments || [];
    if (elements.studentViewMissingCount && elements.studentViewMissingCard) {
        elements.studentViewMissingCount.textContent = missing.length;

        // Always gray
        elements.studentViewMissingCard.style.background = 'rgba(107, 114, 128, 0.15)';
        elements.studentViewMissingCard.style.color = '#4b5563';
    }

    // Populate missing assignments list for detail view
    if (elements.studentViewMissingList) {
        if (missing.length > 0) {
            elements.studentViewMissingList.innerHTML = missing.map((assignment, index) => {
                const title = assignment.assignmentTitle || assignment.Assignment || assignment.name || `Assignment ${index + 1}`;
                const dueDate = assignment.dueDate || assignment.DueDate || assignment.due_at || '';
                const submissionLink = assignment.submissionLink || '';
                // Make title a clickable link if submission link exists
                const titleHtml = submissionLink
                    ? `<a href="${submissionLink}" target="_blank" style="color: var(--text-main); font-weight: 500; font-size: 0.9em; text-decoration: none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${title}</a>`
                    : `<div style="color: var(--text-main); font-weight: 500; font-size: 0.9em;">${title}</div>`;
                return `
                    <div style="padding: 10px 12px; background: rgba(245, 158, 11, 0.08); border-radius: 8px; margin-bottom: 8px;">
                        ${titleHtml}
                        ${dueDate ? `<div style="color: var(--text-secondary); font-size: 0.8em; margin-top: 4px;"><i class="fas fa-clock" style="margin-right: 4px;"></i>Due: ${dueDate}</div>` : ''}
                    </div>
                `;
            }).join('');
        } else {
            elements.studentViewMissingList.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.9em; text-align: center; padding: 40px 20px;"><i class="fas fa-check-circle" style="font-size: 2em; margin-bottom: 10px; opacity: 0.5; display: block;"></i>No missing assignments</div>';
        }
    }

    // Next Assignment Card - show due date (always gray)
    const nextAssignment = student.nextAssignment || null;
    if (elements.studentViewNextDate && elements.studentViewNextCard) {
        if (nextAssignment && nextAssignment.DueDate) {
            elements.studentViewNextDate.textContent = nextAssignment.DueDate;
        } else {
            elements.studentViewNextDate.textContent = '-';
        }
        // Always use gray color
        elements.studentViewNextCard.style.background = 'rgba(107, 114, 128, 0.15)';
        elements.studentViewNextCard.style.color = '#4b5563';
    }

    // Populate next assignment detail view
    if (nextAssignment && nextAssignment.Assignment) {
        if (elements.studentViewNextAssignment) {
            // Make title a clickable link if assignment link exists
            if (nextAssignment.AssignmentLink) {
                elements.studentViewNextAssignment.innerHTML = `<a href="${nextAssignment.AssignmentLink}" target="_blank" style="color: inherit; text-decoration: none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${nextAssignment.Assignment}</a>`;
            } else {
                elements.studentViewNextAssignment.textContent = nextAssignment.Assignment;
            }
        }
        if (elements.studentViewNextAssignmentDate) {
            elements.studentViewNextAssignmentDate.textContent = nextAssignment.DueDate ? `Due: ${nextAssignment.DueDate}` : 'No due date';
        }
        if (elements.studentViewNextDetailContent) {
            elements.studentViewNextDetailContent.style.display = 'block';
        }
        if (elements.studentViewNoNextAssignment) {
            elements.studentViewNoNextAssignment.style.display = 'none';
        }
    } else {
        if (elements.studentViewNextDetailContent) {
            elements.studentViewNextDetailContent.style.display = 'none';
        }
        if (elements.studentViewNoNextAssignment) {
            elements.studentViewNoNextAssignment.style.display = 'block';
        }
    }

    // Store current student reference for button actions
    elements.studentViewModal.dataset.studentName = data.name || '';

    // Show modal
    elements.studentViewModal.style.display = 'flex';
}

/**
 * Shows the main view of the student modal
 */
export function showStudentViewMain() {
    if (elements.studentViewMain) elements.studentViewMain.style.display = 'block';
    if (elements.studentViewMissingDetail) elements.studentViewMissingDetail.style.display = 'none';
    if (elements.studentViewNextDetail) elements.studentViewNextDetail.style.display = 'none';
    if (elements.studentViewDaysOutDetail) elements.studentViewDaysOutDetail.style.display = 'none';
}

/**
 * Shows the missing assignments detail view
 */
export function showStudentViewMissing() {
    if (elements.studentViewMain) elements.studentViewMain.style.display = 'none';
    if (elements.studentViewMissingDetail) elements.studentViewMissingDetail.style.display = 'block';
    if (elements.studentViewNextDetail) elements.studentViewNextDetail.style.display = 'none';
    if (elements.studentViewDaysOutDetail) elements.studentViewDaysOutDetail.style.display = 'none';
}

/**
 * Shows the next assignment detail view
 */
export function showStudentViewNext() {
    if (elements.studentViewMain) elements.studentViewMain.style.display = 'none';
    if (elements.studentViewMissingDetail) elements.studentViewMissingDetail.style.display = 'none';
    if (elements.studentViewNextDetail) elements.studentViewNextDetail.style.display = 'block';
    if (elements.studentViewDaysOutDetail) elements.studentViewDaysOutDetail.style.display = 'none';
}

/**
 * Shows the days out detail view
 */
export function showStudentViewDaysOut() {
    if (elements.studentViewMain) elements.studentViewMain.style.display = 'none';
    if (elements.studentViewMissingDetail) elements.studentViewMissingDetail.style.display = 'none';
    if (elements.studentViewNextDetail) elements.studentViewNextDetail.style.display = 'none';
    if (elements.studentViewDaysOutDetail) elements.studentViewDaysOutDetail.style.display = 'block';
}

/**
 * Closes the student view modal
 */
export function closeStudentViewModal() {
    if (elements.studentViewModal) {
        elements.studentViewModal.style.display = 'none';
    }
    // Clear the stored student reference
    currentStudentViewStudent = null;
    // Reset to main view for next time
    showStudentViewMain();
}

/**
 * Gets the appropriate greeting based on time of day
 * @returns {string} "Good Morning", "Good Afternoon", or "Good Evening"
 */
function getTimeOfDayGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
}

/**
 * Gets the first name from a full name
 * @param {string} fullName - The full name
 * @returns {string} The first name
 */
function getFirstName(fullName) {
    if (!fullName) return '';
    const parts = fullName.trim().split(/\s+/);
    return parts[0] || '';
}

/**
 * Generates a mailto: URL with pre-filled email template for student outreach
 * @param {Object} student - The student data object
 * @returns {string|null} The mailto: URL or null if no student email available
 */
export function generateStudentEmailTemplate(student) {
    if (!student) return null;

    // Get student email - try various field names
    const studentEmail = student.studentEmail || student.StudentEmail || student.email || student.Email || '';

    if (!studentEmail) {
        return null;
    }

    // Get personal email for CC - try various field names
    const personalEmail = student.personalEmail || student.PersonalEmail || student.otherEmail || student.OtherEmail || '';

    const data = resolveStudentData(student);
    const firstName = getFirstName(data.name);
    const greeting = getTimeOfDayGreeting();
    const daysOut = parseInt(data.daysOut) || 0;
    const missingAssignments = student.missingAssignments || [];
    const missingCount = missingAssignments.length;

    // Get grade from raw student object
    const rawGrade = student.grade ?? student.Grade ?? student.currentGrade ?? null;
    const grade = rawGrade !== undefined && rawGrade !== null ? parseFloat(rawGrade).toFixed(0) : null;

    // Build subject line
    const subject = `Checking In - ${data.name}`;

    // Build email body
    let body = `${greeting} ${firstName},\n\n`;

    // Main message
    body += `It has been ${daysOut} day${daysOut !== 1 ? 's' : ''} since you last submitted`;

    if (missingCount > 0) {
        body += ` and you currently have ${missingCount} missing assignment${missingCount !== 1 ? 's' : ''}`;
    }

    if (grade !== null) {
        body += `. Your class grade is ${grade}%`;
    }
    body += '.\n';

    // Add missing assignments bullet list with links if any
    if (missingCount > 0) {
        body += '\nMissing Assignments:\n';
        missingAssignments.forEach(assignment => {
            const title = assignment.assignmentTitle || assignment.Assignment || assignment.title || assignment.name || 'Untitled Assignment';
            const link = assignment.assignmentLink || assignment.AssignmentLink || assignment.link || '';
            if (link) {
                body += `• ${title}\n  ${link}\n`;
            } else {
                body += `• ${title}\n`;
            }
        });
    }

    // Closing
    body += '\nWould you be able to submit an assignment today?\n';

    // Build mailto URL with CC if personal email exists
    let mailtoUrl = `mailto:${encodeURIComponent(studentEmail)}?`;
    if (personalEmail) {
        mailtoUrl += `cc=${encodeURIComponent(personalEmail)}&`;
    }
    mailtoUrl += `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    return mailtoUrl;
}
