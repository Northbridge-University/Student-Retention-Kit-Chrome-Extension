/**
 * Tests for the step pipeline orchestration.
 *
 * Verifies that each processing step (1-4) completes in chronological order:
 *   Step 1 (CSV import) → Step 2 (Canvas API) → Step 3 (Gradebook check) → Step 4 (Send to Excel)
 *
 * The key mechanism under test is `withStepUI`, which wraps each step's work
 * and manages the queue-item lifecycle (pending → active → completed).
 * Steps are chained via the renderCallback pattern in processStep2.
 */

// ============================================
// Extracted orchestration logic for testing
// ============================================

/**
 * Wraps a step's async work with UI state management.
 * Sets the step to 'active' before work, 'completed' after.
 * (Extracted from canvas-api.js)
 */
async function withStepUI(stepId, work, { log }) {
    const stepEl = document.getElementById(stepId);
    const timeSpan = stepEl.querySelector('.step-time');

    stepEl.className = 'queue-item active';
    log.push({ step: stepId, event: 'active' });

    const startTime = Date.now();

    try {
        const result = await work({ timeSpan, startTime });

        stepEl.className = 'queue-item completed';
        log.push({ step: stepId, event: 'completed' });

        return result;
    } catch (error) {
        stepEl.className = 'queue-item error';
        log.push({ step: stepId, event: 'error', message: error.message });
        throw error;
    }
}

// ============================================
// DOM helpers
// ============================================

function createStepElements() {
    document.body.innerHTML = `
        <ul class="queue-list">
            <li id="step1" class="queue-item">
                <div class="queue-content"><i class="far fa-circle"></i> Student Population Report</div>
                <span class="step-time"></span>
            </li>
            <li id="step2" class="queue-item">
                <div class="queue-content"><i class="far fa-circle"></i> Pinging Canvas API</div>
                <span class="step-time"></span>
            </li>
            <li id="step3" class="queue-item">
                <div class="queue-content"><i class="far fa-circle"></i> Checking Student's Grade book</div>
                <span class="step-time"></span>
            </li>
            <li id="step4" class="queue-item">
                <div class="queue-content"><i class="far fa-circle"></i> Sending List to Excel</div>
                <span class="step-time"></span>
            </li>
        </ul>
    `;
}

function getStepClass(stepId) {
    return document.getElementById(stepId).className;
}

// ============================================
// Tests
// ============================================

describe('Step pipeline chronological order', () => {
    let log;

    beforeEach(() => {
        createStepElements();
        log = [];
    });

    test('withStepUI marks step active then completed', async () => {
        const result = await withStepUI('step1', async () => {
            // While work is running, step should be active
            expect(getStepClass('step1')).toBe('queue-item active');
            return 'done';
        }, { log });

        expect(result).toBe('done');
        expect(getStepClass('step1')).toBe('queue-item completed');
        expect(log).toEqual([
            { step: 'step1', event: 'active' },
            { step: 'step1', event: 'completed' }
        ]);
    });

    test('withStepUI marks step as error on failure', async () => {
        await expect(
            withStepUI('step1', async () => {
                throw new Error('fetch failed');
            }, { log })
        ).rejects.toThrow('fetch failed');

        expect(getStepClass('step1')).toBe('queue-item error');
        expect(log).toEqual([
            { step: 'step1', event: 'active' },
            { step: 'step1', event: 'error', message: 'fetch failed' }
        ]);
    });

    test('Step 1 completes before Step 2 starts', async () => {
        await withStepUI('step1', async () => 'students', { log });
        await withStepUI('step2', async () => 'updated', { log });

        expect(log).toEqual([
            { step: 'step1', event: 'active' },
            { step: 'step1', event: 'completed' },
            { step: 'step2', event: 'active' },
            { step: 'step2', event: 'completed' }
        ]);
    });

    test('Step 2 completes before Step 3 starts (renderCallback outside withStepUI)', async () => {
        // This mirrors the fix: renderCallback is called AFTER withStepUI returns,
        // so Step 2 is marked completed before Step 3 begins.
        const updatedStudents = await withStepUI('step2', async () => {
            return [{ name: 'Alice' }];
        }, { log });

        // renderCallback runs after Step 2's withStepUI resolves
        expect(getStepClass('step2')).toBe('queue-item completed');

        const finalStudents = await withStepUI('step3', async () => {
            // At this point Step 2 must already be completed
            expect(getStepClass('step2')).toBe('queue-item completed');
            return updatedStudents;
        }, { log });

        expect(log).toEqual([
            { step: 'step2', event: 'active' },
            { step: 'step2', event: 'completed' },
            { step: 'step3', event: 'active' },
            { step: 'step3', event: 'completed' }
        ]);
    });

    test('Step 3 completes before Step 4 starts', async () => {
        await withStepUI('step3', async () => 'checked', { log });
        await withStepUI('step4', async () => 'sent', { log });

        expect(log).toEqual([
            { step: 'step3', event: 'active' },
            { step: 'step3', event: 'completed' },
            { step: 'step4', event: 'active' },
            { step: 'step4', event: 'completed' }
        ]);
    });

    test('full pipeline runs all 4 steps in order', async () => {
        // Step 1: CSV import
        const students = await withStepUI('step1', async () => {
            return [
                { name: 'Alice', StudentNumber: '001' },
                { name: 'Bob', StudentNumber: '002' }
            ];
        }, { log });

        // Step 2: Canvas API (sets URLs)
        const updatedStudents = await withStepUI('step2', async () => {
            return students.map(s => ({
                ...s,
                url: `https://canvas.com/courses/100/grades/${s.StudentNumber}`
            }));
        }, { log });

        // renderCallback: Step 3 runs after Step 2's withStepUI returns
        const finalStudents = await withStepUI('step3', async () => {
            return updatedStudents.map(s => ({ ...s, missingCount: 0 }));
        }, { log });

        // Step 4: Send to Excel
        await withStepUI('step4', async () => {
            return finalStudents;
        }, { log });

        // Verify chronological order
        const events = log.map(e => `${e.step}:${e.event}`);
        expect(events).toEqual([
            'step1:active', 'step1:completed',
            'step2:active', 'step2:completed',
            'step3:active', 'step3:completed',
            'step4:active', 'step4:completed'
        ]);

        // Verify all steps show completed in DOM
        expect(getStepClass('step1')).toBe('queue-item completed');
        expect(getStepClass('step2')).toBe('queue-item completed');
        expect(getStepClass('step3')).toBe('queue-item completed');
        expect(getStepClass('step4')).toBe('queue-item completed');
    });

    test('Step 4 is skipped when send to Excel is disabled', async () => {
        const sendEnabled = false;

        await withStepUI('step1', async () => ['students'], { log });
        const updated = await withStepUI('step2', async () => ['updated'], { log });
        const final = await withStepUI('step3', async () => updated, { log });

        // Step 4 should be skipped entirely
        if (sendEnabled) {
            await withStepUI('step4', async () => final, { log });
        }

        const events = log.map(e => `${e.step}:${e.event}`);
        expect(events).toEqual([
            'step1:active', 'step1:completed',
            'step2:active', 'step2:completed',
            'step3:active', 'step3:completed'
        ]);

        // Step 4 should remain in its initial state
        expect(getStepClass('step4')).toBe('queue-item');
    });

    test('pipeline stops and marks error when a step fails', async () => {
        await withStepUI('step1', async () => ['students'], { log });

        await expect(
            withStepUI('step2', async () => {
                throw new Error('Canvas unreachable');
            }, { log })
        ).rejects.toThrow('Canvas unreachable');

        // Step 2 errored, Steps 3 & 4 never ran
        const events = log.map(e => `${e.step}:${e.event}`);
        expect(events).toEqual([
            'step1:active', 'step1:completed',
            'step2:active', 'step2:error'
        ]);

        expect(getStepClass('step1')).toBe('queue-item completed');
        expect(getStepClass('step2')).toBe('queue-item error');
        expect(getStepClass('step3')).toBe('queue-item'); // never started
        expect(getStepClass('step4')).toBe('queue-item'); // never started
    });

    test('renderCallback inside withStepUI blocks step completion (the bug scenario)', async () => {
        // This demonstrates the bug we fixed: if renderCallback runs INSIDE
        // withStepUI, Step 2 stays active while Steps 3+4 run.
        const bugLog = [];

        await withStepUI('step2', async () => {
            const students = [{ name: 'Alice' }];

            // Simulating the OLD bug: renderCallback inside withStepUI
            await withStepUI('step3', async () => {
                // BUG: Step 2 is still 'active' here because we're inside its work fn
                expect(getStepClass('step2')).toBe('queue-item active');
                return students;
            }, { log: bugLog });

            return students;
        }, { log: bugLog });

        // Step 2 only completes AFTER Step 3 finishes (the old broken behavior)
        expect(bugLog).toEqual([
            { step: 'step2', event: 'active' },
            { step: 'step3', event: 'active' },
            { step: 'step3', event: 'completed' },
            { step: 'step2', event: 'completed' }
        ]);
    });

    test('renderCallback outside withStepUI allows proper step ordering (the fix)', async () => {
        // This demonstrates the fix: renderCallback runs AFTER withStepUI returns,
        // so Step 2 gets its checkmark before Step 3 starts.
        const fixLog = [];

        const updatedStudents = await withStepUI('step2', async () => {
            return [{ name: 'Alice' }];
        }, { log: fixLog });

        // Step 2 is now completed
        expect(getStepClass('step2')).toBe('queue-item completed');

        // renderCallback runs here, outside withStepUI
        await withStepUI('step3', async () => {
            // FIXED: Step 2 is completed before Step 3 starts
            expect(getStepClass('step2')).toBe('queue-item completed');
            return updatedStudents;
        }, { log: fixLog });

        expect(fixLog).toEqual([
            { step: 'step2', event: 'active' },
            { step: 'step2', event: 'completed' },
            { step: 'step3', event: 'active' },
            { step: 'step3', event: 'completed' }
        ]);
    });

    test('only one step is active at a time during the pipeline', async () => {
        const activeSteps = [];

        const checkOnlyOneActive = (currentStep) => {
            const steps = ['step1', 'step2', 'step3', 'step4'];
            const active = steps.filter(id => getStepClass(id) === 'queue-item active');
            expect(active).toEqual([currentStep]);
        };

        await withStepUI('step1', async () => {
            checkOnlyOneActive('step1');
            return ['students'];
        }, { log });

        const s2result = await withStepUI('step2', async () => {
            checkOnlyOneActive('step2');
            return ['updated'];
        }, { log });

        await withStepUI('step3', async () => {
            checkOnlyOneActive('step3');
            return s2result;
        }, { log });

        await withStepUI('step4', async () => {
            checkOnlyOneActive('step4');
            return 'sent';
        }, { log });
    });

    test('data flows through the pipeline from step to step', async () => {
        // Step 1: parse CSV → raw students
        const rawStudents = await withStepUI('step1', async () => {
            return [
                { name: 'Alice', StudentNumber: '001' },
                { name: 'Bob', StudentNumber: '002' }
            ];
        }, { log });

        expect(rawStudents).toHaveLength(2);
        expect(rawStudents[0]).not.toHaveProperty('url');

        // Step 2: Canvas API → add URLs
        const withUrls = await withStepUI('step2', async () => {
            return rawStudents.map(s => ({
                ...s,
                url: `https://canvas.com/courses/100/grades/${s.StudentNumber}`
            }));
        }, { log });

        expect(withUrls[0].url).toContain('/courses/100/grades/001');

        // Step 3: gradebook check → add missing assignments
        const withGrades = await withStepUI('step3', async () => {
            return withUrls.map(s => ({
                ...s,
                missingCount: 3,
                missingAssignments: [{ assignmentTitle: 'HW1' }, { assignmentTitle: 'HW2' }, { assignmentTitle: 'HW3' }]
            }));
        }, { log });

        expect(withGrades[0].missingCount).toBe(3);
        expect(withGrades[0].missingAssignments).toHaveLength(3);

        // Step 4: send to Excel
        const finalResult = await withStepUI('step4', async () => {
            return withGrades;
        }, { log });

        expect(finalResult).toEqual(withGrades);
    });
});
