// content/excel_connector.js
// Version 2.0 - Updated for nested storage structure

// Prevent multiple injections
if (window.hasSRKConnectorRun) {
  // Script already loaded, stop here.
  console.log("SRK Connector already active.");
} else {
  window.hasSRKConnectorRun = true;

  console.log("%c SRK: Excel Connector Script LOADED", "background: #222; color: #bada55; font-size: 14px");

  /**
   * Checks if the extension context is still valid.
   * Returns false if the extension has been reloaded/updated.
   */
  function isExtensionContextValid() {
      try {
          return !!chrome.runtime.id;
      } catch (e) {
          return false;
      }
  }

  /**
   * Safely sends a message to the extension.
   * Silently fails if the extension context is invalidated.
   * @param {Object} message - The message to send
   * @returns {Promise} - Resolves with response or undefined if context invalid
   */
  function safeSendMessage(message) {
      if (!isExtensionContextValid()) {
          console.warn('%c [safeSendMessage] Extension context invalid — message dropped', 'color: red; font-weight: bold', message.type);
          return Promise.resolve(undefined);
      }
      console.log('%c [safeSendMessage] Sending to background:', 'color: lime; font-weight: bold', message.type, 'autoCall:', message.autoCall);
      return chrome.runtime.sendMessage(message).then((response) => {
          console.log('%c [safeSendMessage] Background responded:', 'color: lime', response);
      }).catch((err) => {
          console.error('%c [safeSendMessage] Failed to send:', 'color: red; font-weight: bold', err?.message || err);
      });
  }

  /**
   * Helper to get value from nested storage structure.
   * Checks new nested path first, then falls back to legacy flat key.
   * @param {Object} data - Storage data object
   * @param {string} key - The legacy flat key name
   * @param {*} defaultValue - Default value if not found
   * @returns {*} The setting value
   */
  function getSettingValue(data, key, defaultValue = undefined) {
      // Check nested paths first based on the key
      if (key === 'autoUpdateMasterList') {
          if (data.settings?.autoUpdateMasterList !== undefined) {
              return data.settings.autoUpdateMasterList;
          }
      } else if (key === 'syncActiveStudent') {
          if (data.settings?.excelAddIn?.syncActiveStudent !== undefined) {
              return data.settings.excelAddIn.syncActiveStudent;
          }
      }
      // Fall back to legacy flat key
      return data[key] !== undefined ? data[key] : defaultValue;
  }

  /**
   * Normalizes a field name for comparison by:
   * - Converting to lowercase
   * - Removing spaces, hyphens, underscores
   * - Removing special characters
   *
   * @param {string} fieldName - The field name to normalize
   * @returns {string} The normalized field name
   */
  function normalizeFieldName(fieldName) {
    if (!fieldName) return '';
    return String(fieldName)
        .toLowerCase()
        .replace(/[\s\-_]/g, '') // Remove spaces, hyphens, underscores
        .replace(/[^a-z0-9]/g, ''); // Remove any remaining special characters
  }

  /**
   * Field aliases for semantic field matching.
   * NOTE: Case/space variations are handled automatically by normalizeFieldName().
   * Only specify true semantic aliases here.
   */
  const FIELD_ALIASES = {
    name: ['studentname', 'student'],
    phone: ['primaryphone', 'phonenumber', 'mobile', 'cell', 'cellphone', 'contact', 'telephone', 'otherphone'],
    grade: ['gradelevel', 'level'],
    StudentNumber: ['studentid', 'sisid'],
    SyStudentId: ['studentsis'],
    daysOut: ['daysinactive', 'days'],
    url: ['gradebook', 'gradebookurl', 'canvasurl', 'studenturl'],
    lda: ['lastdayofattendance', 'lastattendance', 'lastdateofattendance', 'lastdayattended']
  };

  /**
   * Finds a field value in an object using normalized matching and aliases.
   * Matches fields case-insensitively and ignoring spaces/special characters.
   *
   * @param {Object} obj - The object to search in
   * @param {String} fieldName - The internal field name
   * @param {*} defaultValue - Default value if field not found
   * @returns {*} The field value or defaultValue
   */
  function getFieldWithAlias(obj, fieldName, defaultValue = null) {
    if (!obj || !fieldName) return defaultValue;

    // Normalize the target field name
    const normalizedFieldName = normalizeFieldName(fieldName);

    // Get aliases for this field
    const aliases = FIELD_ALIASES[fieldName] || [];
    const normalizedAliases = aliases.map(alias => normalizeFieldName(alias));

    // Search through object keys
    for (const key in obj) {
      const normalizedKey = normalizeFieldName(key);

      // Check direct match
      if (normalizedKey === normalizedFieldName) {
        const value = obj[key];
        return value !== null && value !== undefined ? value : defaultValue;
      }

      // Check alias matches
      if (normalizedAliases.includes(normalizedKey)) {
        const value = obj[key];
        return value !== null && value !== undefined ? value : defaultValue;
      }
    }

    return defaultValue;
  }

  /**
   * Converts an Excel date serial number to a JavaScript Date object.
   * Excel dates are stored as the number of days since January 1, 1900.
   *
   * @param {number} excelDate - The Excel date serial number
   * @returns {Date} JavaScript Date object
   */
  function excelDateToJSDate(excelDate) {
    // Excel date serial number starts from 1/1/1900
    // Use December 30, 1899 as base to account for Excel's leap year bug
    const excelEpoch = new Date(1899, 11, 30);
    const daysOffset = excelDate;
    const jsDate = new Date(excelEpoch.getTime() + daysOffset * 24 * 60 * 60 * 1000);
    return jsDate;
  }

  /**
   * Formats a JavaScript Date object to MM-DD-YY format.
   *
   * @param {Date} date - JavaScript Date object
   * @returns {string} Date formatted as MM-DD-YY
   */
  function formatDateToMMDDYY(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${month}-${day}-${year}`;
  }

  /**
   * Checks if a value appears to be an Excel date serial number.
   * Excel dates are positive integers typically in the range 1-100000.
   *
   * @param {*} value - The value to check
   * @returns {boolean} True if value appears to be an Excel date number
   */
  function isExcelDateNumber(value) {
    if (typeof value !== 'number') return false;
    if (!Number.isInteger(value)) return false;
    // Reasonable range: 1 (1/1/1900) to 100000 (~year 2173)
    if (value < 1 || value > 100000) return false;
    return true;
  }

  /**
   * Converts an Excel date serial number to MM-DD-YY format string.
   * If the value is not an Excel date number, returns it unchanged.
   *
   * @param {*} value - The value to convert
   * @returns {string|*} Formatted date string or original value
   */
  function convertExcelDate(value) {
    if (isExcelDateNumber(value)) {
      const jsDate = excelDateToJSDate(value);
      return formatDateToMMDDYY(jsDate);
    }
    return value;
  }

  /**
   * Checks if a field name indicates it should contain a date.
   * Used to determine which fields to apply Excel date conversion to.
   *
   * @param {string} fieldName - The field name to check
   * @returns {boolean} True if field appears to be a date field
   */
  function isDateField(fieldName) {
    if (!fieldName) return false;
    const normalized = normalizeFieldName(fieldName);
    // Check if field name contains date-related keywords
    return normalized.includes('date') ||
           normalized.includes('lda') ||
           normalized === 'expstartdate' ||
           normalized === 'lastlda';
  }

  /**
   * Cleans up program version strings by removing year prefix and everything before it.
   * Examples:
   * - "D2-Q-2024 Medical Billing and Coding Specialist" → "Medical Billing and Coding Specialist"
   * - "A1-2025 Nursing Program" → "Nursing Program"
   * - "Medical Billing" → "Medical Billing" (unchanged if no year found)
   *
   * @param {string} value - The program version string to clean
   * @returns {string} The cleaned program version string
   */
  function cleanProgramVersion(value) {
    if (!value || typeof value !== 'string') return value;

    // Match a 4-digit year (19xx or 20xx) and remove everything up to and including it
    // Also removes any trailing separator (space, dash, etc.) after the year
    const yearPattern = /.*\b(19\d{2}|20\d{2})\b[\s\-]*/;
    const cleaned = value.replace(yearPattern, '');

    // Return trimmed result, or original if no year was found
    return cleaned.trim() || value.trim();
  }

  /**
   * Converts student name from "Last, First" format to "First Last" format if a comma is present.
   * Examples:
   * - "Smith, John" → "John Smith"
   * - "Doe, Jane Marie" → "Jane Marie Doe"
   * - "Johnson" → "Johnson" (unchanged if no comma)
   *
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

  // Notify extension that connector is active
  safeSendMessage({
      type: "SRK_CONNECTOR_ACTIVE",
      timestamp: Date.now()
  });

  window.addEventListener("message", (event) => {
      if (!event.data || !event.data.type) return;

      // If the extension has been reloaded, this listener belongs to a stale
      // content-script instance.  Bail out so only the fresh instance processes
      // the message — this prevents duplicate log spam and wasted work.
      if (!isExtensionContextValid()) return;

      // Check for the Ping from Office Add-in
      if (event.data.type === "SRK_CHECK_EXTENSION") {
          console.log("%c SRK Connector: Ping Received! Ponging Sender...", "color: green; font-weight: bold");

          // Reply specifically to the window that sent the message
          if (event.source) {
              event.source.postMessage({ type: "SRK_EXTENSION_INSTALLED" }, "*");
          }

          // Notify extension that Office Add-in is connected
          safeSendMessage({
              type: "SRK_OFFICE_ADDIN_CONNECTED",
              timestamp: Date.now()
          });
      }

      // Handle Taskpane Pong from Office Add-in - forward to extension
      else if (event.data.type === "SRK_TASKPANE_PONG") {
          console.log("%c SRK Connector: Pong received from Office Add-in, forwarding to extension", "color: green; font-weight: bold");

          // Notify extension that we received a pong
          safeSendMessage({
              type: "SRK_TASKPANE_PONG",
              timestamp: Date.now()
          });
      }

      // Handle SRK_PONG from Office Add-in - forward to extension
      else if (event.data.type === "SRK_PONG") {
          console.log("%c SRK Connector: SRK_PONG received from Office Add-in", "color: green; font-weight: bold");
          console.log("   Timestamp:", event.data.timestamp);
          console.log("   Source:", event.data.source);

          // Forward SRK_PONG to extension with all payload data
          safeSendMessage({
              type: "SRK_PONG",
              timestamp: event.data.timestamp,
              source: event.data.source
          });
      }

      // Handle Master List Request
      else if (event.data.type === "SRK_REQUEST_MASTER_LIST") {
          console.log("%c SRK Connector: Master List Request Received", "color: blue; font-weight: bold");
          console.log("Request timestamp:", event.data.timestamp);

          // Check setting to determine if we should accept the data
          checkIfShouldAcceptMasterList(event.source);
      }

      // Handle Master List Data
      else if (event.data.type === "SRK_MASTER_LIST_DATA") {
          console.log("%c SRK Connector: Master List Data Received!", "color: green; font-weight: bold");
          // Block if import status modal is open - prevents accidental overwrite
          // when Excel tab is refreshed during retry flow
          chrome.storage.session.get(['importStatusModalOpen'], (result) => {
              if (result.importStatusModalOpen) {
                  console.log("%c SRK Connector: Import status modal is open - ignoring incoming master list data to prevent overwrite", "color: orange; font-weight: bold");
                  return;
              }
              handleMasterListData(event.data.data);
          });
      }

      // Handle Selected Students
      else if (event.data.type === "SRK_SELECTED_STUDENTS") {
          console.log("%c SRK Connector: Selected Students Received!", "color: purple; font-weight: bold");
          handleSelectedStudents(event.data.data);
      }

      // Handle Office User Info
      else if (event.data.type === "SRK_OFFICE_USER_INFO") {
          console.log("%c SRK Connector: Office User Info Received!", "color: cyan; font-weight: bold");
          handleOfficeUserInfo(event.data.data);
      }

      // Handle Sheet List Response from Excel Add-in
      else if (event.data.type === "SRK_SHEET_LIST_RESPONSE") {
          console.log("%c SRK Connector: Sheet List Response Received!", "color: green; font-weight: bold");
          console.log("   Sheets:", event.data.sheets);

          // Forward sheet list to extension
          safeSendMessage({
              type: "SRK_SHEET_LIST_RESPONSE",
              sheets: event.data.sheets
          });
      }

      // Handle Highlight Confirmation from Excel Add-in
      else if (event.data.type === "SRK_HIGHLIGHT_CONFIRMATION") {
          console.log("%c SRK Connector: Highlight Confirmation received from Office Add-in", "color: green; font-weight: bold");
          console.log("   Status:", event.data.data?.status);
          console.log("   SyStudentId:", event.data.data?.syStudentId);

          // Forward confirmation to extension background
          safeSendMessage({
              type: "SRK_HIGHLIGHT_CONFIRMATION",
              data: event.data.data
          });
      }

      // Handle Import Status updates from Excel Add-in
      else if (event.data.type === "SRK_IMPORT_STATUS") {
          console.log("%c SRK Connector: Import Status update from Office Add-in", "color: #217346; font-weight: bold", event.data.data?.status);

          // Forward status to extension background
          safeSendMessage({
              type: "SRK_IMPORT_STATUS",
              data: event.data.data
          });
      }

      // Handle Links Request from Excel Add-in
      else if (event.data.type === "SRK_LINKS") {
          console.log("%c SRK Connector: Links Received!", "color: blue; font-weight: bold");
          console.log("   Links count:", event.data.links?.length || 0);

          // Forward links to extension to open
          safeSendMessage({
              type: "SRK_LINKS",
              links: event.data.links
          });
      }
  });

  /**
   * Checks if we should accept the master list update based on user settings
   * @param {MessageEventSource} source - The event source to send response to
   */
  function checkIfShouldAcceptMasterList(source) {
      // Block if import status modal is open - prevents accidental overwrite
      // when Excel tab is refreshed during retry flow
      chrome.storage.session.get(['importStatusModalOpen'], (sessionResult) => {
          if (sessionResult.importStatusModalOpen) {
              console.log("%c Import status modal is open. Rejecting master list to prevent overwrite.", "color: orange; font-weight: bold");
              try {
                  source.postMessage({
                      type: "SRK_MASTER_LIST_RESPONSE",
                      wantsData: false,
                      reason: "import_in_progress"
                  }, "*");
              } catch (e) {
                  console.warn("Failed to send master list response:", e);
              }
              return;
          }

          // Get both nested 'settings' and legacy flat keys, plus 'timestamps' for lastUpdated
          chrome.storage.local.get(['settings', 'timestamps', 'autoUpdateMasterList', 'lastUpdated'], (result) => {
          const setting = getSettingValue(result, 'autoUpdateMasterList', 'always');
          // Check for lastUpdated in nested path first
          const lastUpdated = result.timestamps?.lastUpdated || result.lastUpdated;
          let wantsData = false;

          if (setting === 'never') {
              console.log("%c Auto-update is disabled. Rejecting data.", "color: orange");
              wantsData = false;
          } else if (setting === 'always') {
              console.log("%c Auto-update is set to always. Accepting data.", "color: green");
              wantsData = true;
          } else if (setting === 'once-daily') {
              // Check if last update was today
              const isToday = checkIfUpdatedToday(lastUpdated);

              if (isToday) {
                  console.log("%c Already updated today. Rejecting data.", "color: orange");
                  wantsData = false;
              } else {
                  console.log("%c Not updated today. Accepting data.", "color: green");
                  wantsData = true;
              }
          }

          // Send response
          if (source) {
              source.postMessage({
                  type: "SRK_MASTER_LIST_RESPONSE",
                  wantsData: wantsData
              }, "*");
          }
      });
      });
  }

  /**
   * Checks if the last update timestamp was today
   * @param {string} lastUpdated - The last updated timestamp
   * @returns {boolean} True if last update was today
   */
  function checkIfUpdatedToday(lastUpdated) {
      if (!lastUpdated) return false;

      try {
          const lastUpdateDate = new Date(lastUpdated);
          const today = new Date();

          return lastUpdateDate.getDate() === today.getDate() &&
                 lastUpdateDate.getMonth() === today.getMonth() &&
                 lastUpdateDate.getFullYear() === today.getFullYear();
      } catch (error) {
          console.error("Error parsing last updated date:", error);
          return false;
      }
  }

  /**
   * Handles incoming Master List data from the Office Add-in
   * Transforms the data from add-in format to extension format and stores it
   * Uses FIELD_ALIASES to handle different capitalizations and field name variations
   * Dynamically includes all fields from source data, applying special logic only where needed
   */
  function handleMasterListData(data) {
      try {
          console.log(`Processing Master List with ${data.totalStudents} students`);
          console.log("Data timestamp:", data.timestamp);

          // Transform students from add-in format to extension format
          const transformedStudents = data.students.map(student => {
              // Start by including all fields from the source student object
              const transformedStudent = {};

              // Copy all fields from source to preserve all Excel columns
              // Apply Excel date conversion to date fields and program version cleaning
              for (const key in student) {
                  let value = student[key];

                  // Convert Excel date numbers to MM-DD-YY format for date fields
                  if (isDateField(key)) {
                      value = convertExcelDate(value);
                  }

                  // Clean program version by removing year prefix
                  const normalizedKey = normalizeFieldName(key);
                  if (normalizedKey === 'programversion' && value !== null && value !== undefined && value !== '') {
                      value = cleanProgramVersion(value);
                  }

                  transformedStudent[key] = value;
              }

              // Use getFieldWithAlias to ensure our standard field names are present
              // This handles cases where fields come with different names (aliases)

              // Name - store original and formatted versions
              const rawName = getFieldWithAlias(student, 'name', 'Unknown') || 'Unknown';
              transformedStudent.nameOriginal = rawName;
              transformedStudent.name = rawName; // Will be formatted based on user setting in display logic

              // Phone - use aliases to find it
              const phone = getFieldWithAlias(student, 'phone');
              if (phone !== null && phone !== undefined) {
                  transformedStudent.phone = phone;
              }

              // StudentNumber - use aliases to find it
              const StudentNumber = getFieldWithAlias(student, 'StudentNumber');
              if (StudentNumber !== null && StudentNumber !== undefined) {
                  transformedStudent.StudentNumber = StudentNumber;
              }

              // SyStudentId - use aliases to find it
              const SyStudentId = getFieldWithAlias(student, 'SyStudentId');
              if (SyStudentId !== null && SyStudentId !== undefined) {
                  transformedStudent.SyStudentId = SyStudentId;
              }

              // SPECIAL LOGIC FIELDS - These need transformation or initialization

              // Grade - convert to string
              const gradeValue = getFieldWithAlias(student, 'grade');
              transformedStudent.grade = gradeValue !== undefined && gradeValue !== null ? String(gradeValue) : null;

              // Days Out - trust the value from Excel master list (use camelCase for consistency)
              const daysOutValue = getFieldWithAlias(student, 'daysOut');
              transformedStudent.daysOut = parseInt(daysOutValue) || 0;

              // URL/Gradebook - use aliases to find it
              const url = getFieldWithAlias(student, 'url');
              if (url !== null && url !== undefined) {
                  transformedStudent.url = url;
              }

              // Student Email - use aliases to find it
              const studentEmail = getFieldWithAlias(student, 'studentEmail');
              if (studentEmail !== null && studentEmail !== undefined) {
                  transformedStudent.studentEmail = studentEmail;
              }

              // Personal Email - use aliases to find it
              const personalEmail = getFieldWithAlias(student, 'personalEmail');
              if (personalEmail !== null && personalEmail !== undefined) {
                  transformedStudent.personalEmail = personalEmail;
              }

              // LDA (Last Day of Attendance) - use aliases to find it
              const lda = getFieldWithAlias(student, 'lda');
              if (lda !== null && lda !== undefined) {
                  transformedStudent.lda = lda;
              }

              // Assignments - initialize if not present
              if (!('assignments' in transformedStudent)) {
                  transformedStudent.assignments = [];
              }

              // Missing Assignments - process and convert Excel dates in dueDate field
              if (student.missingAssignments && Array.isArray(student.missingAssignments)) {
                  transformedStudent.missingAssignments = student.missingAssignments.map(assignment => {
                      // Normalize assignment fields to use standardized names
                      const normalizedAssignment = {
                          assignmentTitle: assignment.assignmentTitle || assignment.title || '',
                          assignmentLink: assignment.assignmentLink || assignment.assignmentUrl || '',
                          submissionLink: assignment.submissionLink || assignment.submissionUrl || '',
                          score: assignment.score || ''
                      };

                      // Convert Excel date serial number to MM-DD-YY format for dueDate
                      const dueDateValue = assignment.dueDate;
                      normalizedAssignment.dueDate = convertExcelDate(dueDateValue) || '';

                      return normalizedAssignment;
                  });

                  // Update missingCount to match the actual number of missing assignments
                  transformedStudent.missingCount = transformedStudent.missingAssignments.length;
              } else {
                  transformedStudent.missingAssignments = [];
                  transformedStudent.missingCount = 0;
              }

              return transformedStudent;
          });

          const lastUpdated = new Date().toLocaleString('en-US', {
              year: 'numeric',
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
          });

          // Store the transformed data using chrome storage
          chrome.storage.local.set({
              masterEntries: transformedStudents,
              lastUpdated: lastUpdated,
              masterListSourceTimestamp: data.timestamp
          }, () => {
              console.log(`%c ✓ Master List Updated Successfully!`, "color: green; font-weight: bold");
              console.log(`   Students: ${transformedStudents.length}`);
              console.log(`   Updated: ${lastUpdated}`);

              // Notify the extension that master list has been updated
              safeSendMessage({
                  type: "SRK_MASTER_LIST_UPDATED",
                  timestamp: Date.now(),
                  studentCount: transformedStudents.length,
                  sourceTimestamp: data.timestamp
              });
          });

      } catch (error) {
          console.error("%c Error processing Master List data:", "color: red; font-weight: bold", error);

          // Notify extension of error
          safeSendMessage({
              type: "SRK_MASTER_LIST_ERROR",
              error: error.message,
              timestamp: Date.now()
          });
      }
  }

  /**
   * Handles incoming Selected Students data from the Office Add-in
   * Transforms and sends student data to the extension
   * @param {Object} data - The selected students data
   */
  function handleSelectedStudents(data) {
      try {
          console.log(`Processing ${data.count} selected student(s)`);
          console.log("Selection timestamp:", data.timestamp);

          if (!data.students || data.students.length === 0) {
              console.log("No students selected");
              return;
          }

          /**
           * Transforms student data and sends it to the extension.
           * Extracted so it can be called with or without the settings check.
           */
          function transformAndSend() {
              // Transform all students from add-in format to extension format
              const transformedStudents = data.students.map(student => {
                  const rawName = student.name || 'Unknown';
                  return {
                      nameOriginal: rawName,
                      name: rawName, // Will be formatted based on user setting in display logic
                      phone: student.phone || null,
                      otherPhone: student.otherPhone || null,
                      SyStudentId: student.syStudentId ? String(student.syStudentId) : null,
                      // Per-student phone override and contact type from add-in
                      ...(student.directPhone ? { directPhone: student.directPhone } : {}),
                      ...(student.isOtherContact ? { isOtherContact: true } : {}),
                      // Set defaults for fields not provided by the Office add-in
                      grade: null,
                      StudentNumber: null,
                      daysOut: 0,
                      missingCount: 0,
                      url: null,
                      assignments: []
                  };
              });

              if (data.count === 1) {
                  console.log(`Setting active student: ${transformedStudents[0].name}`);
              } else {
                  console.log(`Setting up automation mode with ${data.count} students`);
              }

              // Send to extension (works for both single and multiple)
              safeSendMessage({
                  type: "SRK_SELECTED_STUDENTS",
                  students: transformedStudents,
                  count: data.count,
                  timestamp: Date.now(),
                  sourceTimestamp: data.timestamp,
                  directPhone: data.directPhone || null,  // Phone from single cell selection
                  autoCall: data.autoCall || false  // Auto-initiate call (ribbon call button)
              });
          }

          // Check if extension context is still valid before accessing chrome.storage
          if (!isExtensionContextValid()) {
              console.warn("%c Extension context invalidated — sending student data without settings check", "color: orange; font-weight: bold");
              transformAndSend();
              return;
          }

          // Check if sync active student is enabled - check both nested and legacy paths
          chrome.storage.local.get(['settings', 'syncActiveStudent'], (result) => {
              const syncEnabled = getSettingValue(result, 'syncActiveStudent', true);
              console.log(`%c [excelConnector] syncActiveStudent=${syncEnabled}, autoCall=${data.autoCall}`, 'color: cyan; font-weight: bold');

              // Always send if autoCall — the call must go through regardless of sync setting
              if (data.autoCall) {
                  console.log('%c [excelConnector] autoCall=true — forcing transformAndSend', 'color: green; font-weight: bold');
                  transformAndSend();
                  return;
              }

              if (!syncEnabled) {
                  console.log("%c Sync Active Student is disabled. Skipping student sync.", "color: orange; font-weight: bold");
                  return;
              }

              transformAndSend();
          });

      } catch (error) {
          console.error("%c Error processing Selected Students data:", "color: red; font-weight: bold", error);
      }
  }

  /**
   * Handles incoming Office User Info from the Office Add-in
   * Stores the authenticated user's name, email, and other profile data
   * @param {Object} data - The user info data
   */
  function handleOfficeUserInfo(data) {
      try {
          console.log(`Processing Office User Info`);
          console.log(`  Name: ${data.name}`);
          console.log(`  Email: ${data.email}`);
          console.log("User info timestamp:", data.timestamp);

          // Validate required fields
          if (!data.name && !data.email) {
              console.warn("Office user info missing both name and email");
              return;
          }

          // Store the user info
          const userInfo = {
              name: data.name || null,
              email: data.email || null,
              userId: data.userId || null,
              jobTitle: data.jobTitle || null,
              department: data.department || null,
              officeLocation: data.officeLocation || null,
              lastUpdated: new Date().toISOString(),
              sourceTimestamp: data.timestamp || null
          };

          chrome.storage.local.set({
              officeUserInfo: userInfo
          }, () => {
              console.log(`%c ✓ Office User Info Stored Successfully!`, "color: cyan; font-weight: bold");
              console.log(`   Name: ${userInfo.name}`);
              console.log(`   Email: ${userInfo.email}`);

              // Notify the extension that user info has been updated
              safeSendMessage({
                  type: "SRK_OFFICE_USER_INFO",
                  userInfo: userInfo,
                  timestamp: Date.now()
              });
          });

      } catch (error) {
          console.error("%c Error processing Office User Info:", "color: red; font-weight: bold", error);

          // Notify extension of error
          safeSendMessage({
              type: "SRK_OFFICE_USER_INFO_ERROR",
              error: error.message,
              timestamp: Date.now()
          });
      }
  }

  // Listen for messages from extension (e.g., highlight student row requests, ping checks)
  // Wrap in try-catch in case extension context is already invalid
  try {
      if (isExtensionContextValid()) {
          chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
              // Check context validity at the start of each message
              if (!isExtensionContextValid()) {
                  return;
              }

              if (request.action === "postToPage" && request.message) {
                  console.log("%c SRK Connector: Forwarding message to page", "color: blue; font-weight: bold", request.message);
                  window.postMessage(request.message, "*");
                  sendResponse({ success: true });
              }
              // Handle taskpane ping from extension - forward to Office Add-in
              else if (request.type === "SRK_TASKPANE_PING") {
                  console.log("%c SRK Connector: Ping request from taskpane, forwarding to Office Add-in", "color: blue; font-weight: bold");
                  window.postMessage({ type: "SRK_TASKPANE_PING", timestamp: request.timestamp }, "*");
                  sendResponse({ success: true });
              }
              // Handle SRK_PING from extension - forward to Office Add-in
              else if (request.type === "SRK_PING") {
                  console.log("%c SRK Connector: SRK_PING request from side panel, forwarding to Office Add-in", "color: blue; font-weight: bold");
                  window.postMessage({ type: "SRK_PING" }, "*");
                  sendResponse({ success: true });
              }
              return true; // Keep channel open for async response
          });
      }
  } catch (e) {
      // Extension context invalidated, script will stop processing extension messages
      console.log("SRK Connector: Extension context invalidated, message listener not registered");
  }
}