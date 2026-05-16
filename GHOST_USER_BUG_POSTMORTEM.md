# Ghost User Bug — Post-Mortem

**Date:** 2026-05-16
**Severity:** P0 — affected 100% of new user registrations in dev/test environments
**Status:** Fixed

---

## What was the bug?

When a new user tapped "Continue" on the profile setup screen, the app called the backend
API to register them in PostgreSQL. If that API call failed for **any reason** (database down,
network error, validation failure), the app silently caught the error and created a **fake local
user** with a hardcoded ID (`test-buyer-001` or `test-provider-001`).

This fake "ghost" user was stored in the Zustand auth store, setting `isAuthenticated: true`.
The app then navigated to the main screen as if registration had succeeded.

**Every downstream feature failed silently** because the user didn't exist in the database:
- **Matching engine:** Dropped the user from the queue (no DB record to read AI score from)
- **GST/Email/Portfolio verification:** All returned errors or failed silently
- **Deal rooms, billing, credits:** All 404'd or threw because the userId wasn't in PostgreSQL

## Why was it introduced?

During **Mission 2-3** development, the backend database was not yet fully functional. To allow
UI development and visual testing to proceed, a `try/catch` fallback was added:

```typescript
// THE BUG — SetupProfileScreen.tsx
try {
  await register({ role, displayName, industry, phone });
} catch {
  // "Fallback to mock login for dev/offline mode"
  const uid = role === 'buyer' ? 'test-buyer-001' : 'test-provider-001';
  mockLogin(uid, displayName, role!, industry!);
}
```

This was intended as a temporary developer convenience but was never removed. By the time
Mission 4-7 built real backend infrastructure on top, the mock fallback was silently masking
every registration failure.

## What safeguards were added?

### 1. Core Fix — Error Surfacing (Phase 1)
- **Removed** the entire `catch { mockLogin() }` block
- **Removed** the `mockLogin()` method from the auth store entirely
- Registration failures now show a **red error banner** to the user
- The catch block **never** navigates or mutates auth state

### 2. Input Validation (Phase 2)
- Client validates required fields before firing the API call
- `registerUser()` throws immediately if no Firebase token exists
- Backend returns structured errors: `409 USER_ALREADY_EXISTS`, `422 VALIDATION_FAILED`

### 3. Ghost User Detection (Phase 3-4)
- Socket.IO `join:room` handler emits `USER_NOT_FOUND` → client auto-clears session
- Global API interceptor catches `404 USER_NOT_FOUND` → auto-clears session
- Both redirect the user back to the registration flow

### 4. Session Integrity (Phase 5)
- Added `clearSession()` method to auth store for clean teardown
- Ghost users hitting any authenticated endpoint are auto-logged out

### 5. Prevention (Phase 6)
- ESLint `no-restricted-syntax` rule blocks any string literal matching
  `test-buyer-\d+`, `test-provider-\d+`, or `mock.*user` in production source files

## How to verify the fix is working

1. **Start the app with the database DOWN.** Enter a phone number, complete OTP, select
   role and industry, tap "Continue". You should see a **red error banner** saying
   "Could not complete your profile". You should **NOT** be navigated to the main screen.

2. **Start the app with the database UP.** Complete the same flow. You should be
   registered in PostgreSQL and navigated to the main screen. Verify with:
   ```bash
   Invoke-RestMethod -Uri "http://localhost:4002/api/auth/me" -Headers @{"X-Test-User-Id"="<your-firebase-uid>"}
   ```

3. **Run the test suite:**
   ```bash
   cd packages/api && npm test
   ```
   All 40 tests should pass.

4. **TypeScript compilation:**
   ```bash
   cd packages/api && npx tsc --noEmit
   cd apps/mobile && npx tsc --noEmit
   ```
   Both should compile with zero errors.
