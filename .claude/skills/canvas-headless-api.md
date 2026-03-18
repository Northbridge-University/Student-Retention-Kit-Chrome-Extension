---
name: Canvas Headless API
description: How we interact with the Canvas LMS REST API v1 using session cookies (headless/cookie-based auth) — no OAuth tokens
---

# Canvas Headless API Skill

How we interact with the Canvas LMS REST API v1 without OAuth — using session cookies from the browser (headless/cookie-based auth).

## Architecture Overview

This Chrome Extension calls Canvas API endpoints directly from the browser using the user's active Canvas session. There are no API tokens or OAuth flows. Authentication relies entirely on `credentials: 'include'` to send session cookies with every request.

**Primary domain**: `https://northbridge.instructure.com` (configured in `src/constants/index.js`)
**Legacy fallback**: `https://nuc.instructure.com`

## Authentication

### Session-Based (Cookie) Auth

Every Canvas API call uses this pattern:

```js
const response = await fetch(url, {
  method: 'GET',
  credentials: 'include', // sends session cookies
  headers: {
    'Accept': 'application/json',
    'X-Requested-With': 'XMLHttpRequest'
  }
});
```

- No `Authorization` header or Bearer token
- User must be logged into Canvas in the browser
- Pre-flight check: `GET /api/v1/users/self` via `ensureCanvasLogin()` to verify session is active before starting the pipeline

### Auth Error Handling

- **401 Unauthorized** → session expired; show auth error modal (Retry / Shutdown)
- **403 Forbidden** → resource-specific permission issue; do not retry auth
- `isCanvasAuthError(response)` checks for both 401 and 403
- Auth modal shown once per session via `authErrorShownInSession` flag
- Custom error classes: `CanvasAuthShutdownError`, `CanvasAuthRetryError`

### Domain Fallback

`fetchWithFallback()` handles school rebranding scenarios:

1. Try primary domain (`northbridge.instructure.com`)
2. On non-auth failure, retry with legacy domain (`nuc.instructure.com`)
3. After 5 consecutive fallback successes, lock to legacy domain for remaining requests

## API Endpoints

### 1. User Profile Lookup

```
GET /api/v1/users/sis_user_id:{SyStudentId}
```

- Looks up a Canvas user by SIS (Student Information System) ID
- Returns: `id`, `name`, `sortable_name`, `avatar_url`, `created_at`
- The returned `id` is the Canvas user ID used in all subsequent calls
- File: `src/sidepanel/canvas-api.js` → `fetchCanvasDetails()`

### 2. Courses List

```
GET /api/v1/users/{canvasUserId}/courses?include[]=enrollments&per_page=100
```

- Returns all courses for the student with enrollment data
- Enrollment includes `enrollment_state` and `grades` (current_score, final_score, current_grade)
- Paginated — follow `Link` header with `rel="next"`

### 3. Batch Submissions (Multi-Student)

```
GET /api/v1/courses/{courseId}/students/submissions?student_ids[]={id1}&student_ids[]={id2}&include[]=assignment&per_page=100
```

- Fetches submissions for multiple students in one request
- Dramatically reduces API calls (50 students in 1 course = 1 paginated call instead of 50)
- Includes assignment metadata: `name`, `points_possible`, `due_at`
- File: `src/sidepanel/canvas-api.js` → `fetchCourseGroupData()`

### 4. Batch Users/Enrollments

```
GET /api/v1/courses/{courseId}/users?user_ids[]={id1}&user_ids[]={id2}&include[]=enrollments&per_page=100
```

- Fetches enrollment and grade data for multiple students in a course
- Called in parallel with batch submissions via `Promise.all`

### 5. HTML Fallback (Non-API Mode)

```
GET /users/{canvasUserId}
```

- Scrapes the user profile HTML page when API permissions are unavailable
- Parses `#courses_list ul.context_list` for course list
- Returns course objects matching the API shape
- Toggled by `settings.canvas.nonApiCourseFetch`
- File: `src/sidepanel/canvas-api.js` → `fetchCoursesFromHtml()`

## Pagination

Canvas uses `Link` header pagination with `rel="next"`:

```
Link: <https://northbridge.instructure.com/api/v1/courses/123/submissions?page=2&per_page=100>; rel="next"
```

Our `fetchPaged()` function recursively follows `rel="next"` links, accumulating all results into a single array. Always use `per_page=100` for optimal throughput.

```js
async function fetchPaged(url, items = []) {
  const response = await fetch(url, { method: 'GET', credentials: 'include', headers });
  const newItems = await response.json();
  const allItems = items.concat(newItems);
  const nextUrl = getNextPageUrl(response.headers.get('Link'));
  if (nextUrl) return fetchPaged(nextUrl, allItems);
  return allItems;
}
```

## Performance Patterns

### Course Grouping (Step 3)

Students are grouped by `courseId` before API calls. Multiple students in the same course share a single pair of batch API calls (submissions + users). This is the biggest optimization.

```
50 students across 5 courses = 10 API calls (2 per course)
vs. 100 API calls (2 per student) without grouping
```

### Batch Processing (Step 2)

- 20 students per batch
- 100ms delay between batches (rate limiting)
- Cached students processed first (no delay, no API calls)
- `Promise.allSettled()` for fault tolerance — one failure doesn't block the batch

### Worker Pool (Step 3)

- `MAX_CONCURRENT = 10` course groups processed simultaneously
- Keeps multiple course fetches in-flight for throughput
- Prevents Canvas rate limiting while maximizing parallelism

### Caching

- Storage: `chrome.storage.local` under key `canvasApiCache`
- Cache key: `SyStudentId`
- Expiration: latest course `end_at` date (with 30-day fallback)
- Batched writes: `stageCacheData()` queues updates, `flushPendingCacheWrites()` saves once per batch
- Only caches: `id`, `name`, `avatar_url`, `enrollments` (strips unnecessary fields)
- File: `src/utils/canvasCache.js`

## Data Analysis

### Grade Extraction

Priority order for extracting current grade from enrollment data:

1. `enrollment.grades.current_score` (numeric)
2. `enrollment.grades.final_score` (fallback)
3. `enrollment.grades.current_grade` (string, strip `%`)

### Missing Assignment Detection

An assignment is "missing" if ANY of:
- Canvas `missing: true` flag
- `workflow_state` is `unsubmitted` AND past due date
- `score === 0`

Excludes: future assignments, "complete" status.

### Active Course Selection

Priority order for selecting the student's active course:

1. Active enrollment + within course date range
2. Active enrollment (any dates)
3. Within date range (any enrollment state)
4. Most recently started course

Courses containing "CAPV" in the name are excluded.

## Pipeline Steps

The full data pipeline runs as 4 sequential steps:

| Step | Description | Key Function |
|------|-------------|--------------|
| Step 1 | Import/parse student list from Excel | (file-handler.js) |
| Step 2 | Fetch Canvas user profiles + courses | `processStep2()` |
| Step 3 | Fetch gradebook data (submissions, grades, missing) | `processStep3()` |
| Step 4 | Export results to Excel | `processStep4()` |

Steps 2 and 3 include retry loops — if the user hits a Canvas auth error and clicks "Retry", the entire step restarts with `resetAuthErrorState()`.

## Key Files

| File | Purpose |
|------|---------|
| `src/sidepanel/canvas-api.js` | Main Canvas API orchestration (all endpoints, analysis, pipeline steps) |
| `src/utils/canvasCache.js` | Caching layer (read/write/expiration/batched writes) |
| `src/sidepanel/modals/canvas-auth-modal.js` | Auth error modal (Retry / Shutdown) + non-API toggle |
| `src/sidepanel/modals/canvas-login-modal.js` | Pre-flight login check |
| `src/content/canvasGradebookInspector.js` | Content script: highlights submissions on Canvas gradebook pages |
| `src/content/canvasGradebookInjector.js` | Content script: injects student search on Canvas grades pages |
| `src/constants/index.js` | Domain config, storage keys, field mappings |
| `tests/canvas-api.test.js` | Unit tests for grade extraction, missing assignments, URL parsing |

## Common Patterns When Modifying Canvas API Code

1. **Always use `fetchWithFallback()`** for direct API calls (not `fetch()`) to get domain fallback
2. **Always use `fetchPaged()`** for list endpoints to handle pagination
3. **Always call `checkShutdown()`** at the start of async API functions
4. **Always use `credentials: 'include'`** — this is how authentication works
5. **Batch by course** when processing multiple students in the same course
6. **Use `Promise.allSettled()`** for batch operations (not `Promise.all`) so one failure doesn't crash the batch
7. **Stage cache writes** with `stageCacheData()` and flush with `flushPendingCacheWrites()` after each batch
8. **Handle auth errors** by checking `isCanvasAuthError(response)` after every API call
