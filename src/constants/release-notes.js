/**
 * Release Notes Configuration
 *
 * This file contains the release notes for the extension.
 * To add new release notes:
 * 1. Add a new entry with the version number as the key
 * 2. Fill in the title, date, and updates array
 * 3. The modal will automatically show when users update to this version
 *
 * Example:
 * '10.4': {
 *     title: 'New Feature Release',
 *     date: 'February 1, 2026',
 *     updates: [
 *         'Added new feature X',
 *         'Fixed bug Y',
 *         'Improved performance of Z'
 *     ]
 * }
 */

export const RELEASE_NOTES = {
    // Add new version entries here (newest first)
    // The key should match the version in manifest.json
	'15.1': {
        title: 'Latest Updates',
        date: 'May 8, 2026',
        updates: [
			'Improved Call Page UI',
			'Added Previous Calls list',
			'You can now manually input numbers',
			'Improved call reliability',
			'Fixed bugs'
        ]
    },
	'15.0': {
        title: 'Latest Updates',
        date: 'April 17, 2026',
        updates: [
			'Massive improvements to Canvas fetching speed and Settings UI',
			'Try the new faster method: Canvas Settings → Advanced → API Mode → switch to GraphQL',
			'Run into any issues? Report a bug from the Settings tab (bottom of the page)',
        ]
    },
	'14.5': {
        title: 'Latest Updates',
        date: 'April 15, 2026',
        updates: [
			'Fixed "Campus" target sheet setting silently falling back to LDA MM-DD-YYYY when highlighting rows',
        ]
    },
	'14.4': {
        title: 'Latest Updates',
        date: 'April 11, 2026',
        updates: [
			'Submission checker now batches rapid submissions into one bulk update for faster highlighting',
			'Call button now ignores rows hidden by filters',
			'Fixed an extra comment being added when the student view is open during a submission',
		]
    },
	'14.3': {
        title: 'Latest Updates',
        date: 'April 6, 2026',
        updates: [
			'New popup shows live progress when sending data to Excel',
			'Retry button refreshes Excel and tries again if it gets stuck',
			'Excel can no longer overwrite your data during an import',
			'Campus dropdown is now hidden if you only have one campus',
			'Fixed "Last Updated" showing "Never" after closing the panel',
        ]
    },
	'14.2': {
        title: 'Latest Updates',
        date: 'March 30, 2026',
        updates: [
			'Fixed Date issue with Attendance Reports',
			'Included .1 Decimal in attendance %',
        ]
    },
	'14.1': {
        title: 'Latest Updates',
        date: 'March 27, 2026',
        updates: [
			'Fixed Office Add In not loading for some users',
        ]
    },
	'14.0': {
        title: 'Latest Updates',
        date: 'March 23, 2026',
        updates: [
			'Fixed Numerous Bugs',
			'Improved Update Master List Process',
			'Improved Calling Five9 Feature',
        ]
    },
	'13.2': {
        title: 'Latest Updates',
        date: 'March 16, 2026',
        updates: [
			'Hotfix Five9 tab not being detected',
			'Report any bugs via the settings section'
        ]
    },
	'13.1': {
        title: 'Latest Updates',
        date: 'March 13, 2026',
        updates: [
			'Improved Update Master List Process',
			'Created the Call Button on the Excel Ribbon',
			'Improved connection relability with Five9',
			'Added SSO Microsoft login button for Five9',
			'Improved automation sequence in calls',
			'Added a pause feature for call automations'
        ]
    },
	'13.0': {
        title: 'Latest Updates',
        date: 'March 5, 2026',
        updates: [
			'Implemented Stats view in the Data Tab (Experimental)',
			'Can handle 3 files imports now',
            'Improved Submission Checker with error logging',
            'Added Attendance Report',
			'Added a Backups Section. Right click anywhere on the Data tab.',
			'Added Console Tab (Right Click on the Tabs)'
        ]
    },
	'12.2': {
        title: 'Latest Updates',
        date: 'February 24, 2026',
        updates: [
            'Fixed Include Failing Students Toggle',
            'Added a Backups Section. Right click anywhere on the Data tab.'
        ]
    },
	'12.1': {
        title: 'Latest Updates',
        date: 'February 24, 2026',
        updates: [
            'Fixed Auto Highlight Sheet Name for Campus',
            'Improved connection status for Excel'
        ]
    },
	'12.0': {
        title: 'Latest Updates',
        date: 'February 18, 2026',
        updates: [
            'Revamped the downloadable report',
            'You can now select two files at once — the second file fills in additional columns',
			'Multiple Campusus are now automatically detected and organized',
            'Target Highlight Sheet setting is now a dropdown: choose LDA date, Campus name, or a custom sheet name',
			'Implemented Next Assignmet Due feature',
			'Implemented Previous Class Grade',
			'Significantly faster Update Master List process with optimized Canvas API calls',
			'For any bugs or feature requests please refer to settings'
        ]
    },
	'11.2': {
        title: 'Latest Updates',
        date: 'February 9, 2026',
        updates: [
            'Significantly faster Update Master List process with optimized Canvas API calls',
            'Improved searching the master list',
            'Improved code organization and testing infrastructure',
			'Hotfix the update master list process with new courses not fetching correctly'
        ]
    },
	'11.1': {
        title: 'Latest Updates',
        date: 'February 4, 2026',
        updates: [
            'Introduced the "Next Assignment" tracking feature (Experimental)',
            'Refined and modernized Context Menu UI (When you right click on certain places)',
			'Added Recheck Grade Book in the conext menu (Right click update master list)',
			'Implemented Student Details view',
			'Updated all assets for the Northbridge University rebranding',
			'Integrated Issue and Feature Request forms within Settings',
			'Enhanced call stability and resolved various performance bugs'
        ]
    },
    '11.0': {
        title: 'Latest Updates',
        date: 'January 30, 2026',
        updates: [
            'Added numerous bug fixes and stababilty',
            'Added support for Power Automate integration',
			'Created an Excel Instance Modal in case you have multiple Excel tabs open',
            'Included a non api feature for users without API permissions.',
            'Adjusted UI for a more professional and polished look',
            'Improved data management handling with 6k students',
            'Included a Campus filter in case you import multiple Campus populations',
            'Added safety guards for the extension to disable if Chrome crashes'
        ]
    }

    // Example of how to add future versions:
    // '10.4': {
    //     title: 'Performance Improvements',
    //     date: 'February 15, 2026',
    //     updates: [
    //         'Faster master list loading',
    //         'Improved Canvas API caching',
    //         'Bug fixes and stability improvements'
    //     ]
    // }
};

/**
 * Gets the release notes for a specific version
 * @param {string} version - The version number to get notes for
 * @returns {Object|null} The release notes object or null if not found
 */
export function getReleaseNotes(version) {
    return RELEASE_NOTES[version] || null;
}

/**
 * Checks if release notes exist for a version
 * @param {string} version - The version number to check
 * @returns {boolean} True if release notes exist for this version
 */
export function hasReleaseNotes(version) {
    return version in RELEASE_NOTES;
}

/**
 * Gets all versions that have release notes (sorted newest first)
 * @returns {string[]} Array of version strings
 */
export function getAllVersionsWithNotes() {
    return Object.keys(RELEASE_NOTES).sort((a, b) => {
        // Sort by version number (descending)
        const partsA = a.split('.').map(Number);
        const partsB = b.split('.').map(Number);

        for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
            const numA = partsA[i] || 0;
            const numB = partsB[i] || 0;
            if (numA !== numB) return numB - numA;
        }
        return 0;
    });
}

/**
 * Gets the latest release notes entry (most recent version)
 * @returns {{ version: string, notes: Object } | null} The latest version and its notes, or null if none exist
 */
export function getLatestReleaseNotes() {
    const versions = getAllVersionsWithNotes();
    if (versions.length === 0) return null;

    const latestVersion = versions[0];
    return {
        version: latestVersion,
        notes: RELEASE_NOTES[latestVersion]
    };
}








