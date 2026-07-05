# Demo Globe Sign-In Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "→ SIGN IN" button next to the demo-mode account chip so visitors on the demo globe (`?demo=1`) can reach the real sign-in form without going through the crewlu.net marketing site.

**Architecture:** Extend the existing HUD's `#account` chip area with a sibling `.navbtn` button, wired through `createHud`'s existing opts-callback pattern (mirrors `onSignOut`). Clicking it strips `?demo=1` from the URL and reloads, which hits the app's existing `requireSession()` auth gate — no new auth code.

**Tech Stack:** TypeScript, Vite, plain CSS (reusing `.navbtn`), no new dependencies.

**Testing note:** Per the approved design doc (`docs/superpowers/specs/2026-07-05-demo-signin-button-design.md`), this is DOM+navigation wiring with no new branching logic — verification is manual/browser-based (matching how this codebase already verifies other HUD/visual features, e.g. `2026-07-01-jumpseat-mode.md`), not new Vitest coverage.

---

### Task 1: HUD markup + createHud wiring

**Files:**
- Modify: `src/globe/hud.ts:171` (HUD_HTML template)
- Modify: `src/globe/hud.ts:44-57` (createHud signature + wiring)

- [ ] **Step 1: Replace the account chip markup with a two-child flex row**

In `src/globe/hud.ts`, find this exact line (currently line 171):

```html
<div id="account" class="hud" style="top:25px;right:50px">Signed in</div>
```

Replace it with:

```html
<div style="position:absolute;top:22px;right:50px;display:flex;align-items:center;gap:10px;z-index:5;pointer-events:none">
  <button id="signInBtn" class="navbtn" style="display:none">→ SIGN IN</button>
  <div id="account" class="hud" style="position:static">Signed in</div>
</div>
```

The wrapper carries the positioning that `#account` used to carry directly (`position:absolute;top:22px;right:50px`), plus `z-index:5` and `pointer-events:none` to match every other top-level `.hud` row. `#account` gets `position:static` so it lays out inside the flex row instead of escaping it via the `.hud` class's own `position:absolute`. `#signInBtn` starts `display:none` — it only appears once `createHud` is given an `onSignIn` callback (Step 2).

- [ ] **Step 2: Extend createHud's opts type and wire up the button**

In `src/globe/hud.ts`, find this exact block (currently lines 44-57):

```typescript
export function createHud(host: HTMLElement, opts?: { account?: string; onSignOut?: () => void }): Hud {
  host.insertAdjacentHTML('beforeend', HUD_HTML)
  const q = <T extends HTMLElement>(s: string) => host.querySelector<T>(s)!
  const moment = q<HTMLDivElement>('#momentChip')
  moment.style.pointerEvents = 'auto'  // critical: parent panel is pointer-events:none

  const accountEl = q<HTMLElement>('#account')
  accountEl.textContent = opts?.account ?? 'Signed in'
  if (opts?.onSignOut) {
    accountEl.style.pointerEvents = 'auto'
    accountEl.style.cursor = 'pointer'
    accountEl.title = 'Sign out'
    accountEl.addEventListener('click', opts.onSignOut)
  }
```

Replace it with:

```typescript
export function createHud(host: HTMLElement, opts?: { account?: string; onSignOut?: () => void; onSignIn?: () => void }): Hud {
  host.insertAdjacentHTML('beforeend', HUD_HTML)
  const q = <T extends HTMLElement>(s: string) => host.querySelector<T>(s)!
  const moment = q<HTMLDivElement>('#momentChip')
  moment.style.pointerEvents = 'auto'  // critical: parent panel is pointer-events:none

  const accountEl = q<HTMLElement>('#account')
  accountEl.textContent = opts?.account ?? 'Signed in'
  if (opts?.onSignOut) {
    accountEl.style.pointerEvents = 'auto'
    accountEl.style.cursor = 'pointer'
    accountEl.title = 'Sign out'
    accountEl.addEventListener('click', opts.onSignOut)
  }

  const signInEl = q<HTMLButtonElement>('#signInBtn')
  if (opts?.onSignIn) {
    signInEl.style.display = 'inline-block'
    signInEl.addEventListener('click', opts.onSignIn)
  }
```

Only add the new `signInEl` block — everything else in the excerpt (including the `accountEl`/`onSignOut` block) stays exactly as it already reads; it's included above only to give you a unique anchor and to show where the new block goes (immediately after it).

- [ ] **Step 3: Typecheck**

Run: `cd /Users/toddanderson/Dev/crewlu-globe && npx tsc --noEmit`
Expected: exits with no output and status 0. (`onSignIn` is optional and unused by any current call site yet, so this should not error.)

- [ ] **Step 4: Commit**

```bash
cd /Users/toddanderson/Dev/crewlu-globe
git add src/globe/hud.ts
git commit -m "feat(hud): add hidden Sign In button next to account chip"
```

---

### Task 2: Wire the demo-only click handler in main.ts

**Files:**
- Modify: `src/main.ts:98-105`

- [ ] **Step 1: Pass onSignIn, demo-only, stripping the demo param and reloading**

In `src/main.ts`, find this exact block (currently lines 98-105):

```typescript
  // FIX 5: pass real account email and sign-out handler to the HUD chip
  // (in demo mode the chip is a call-to-action that opens crewlu.net instead)
  const hud = createHud(hudHost, {
    account,
    onSignOut: demo
      ? () => { window.open('https://crewlu.net', '_blank', 'noopener') }
      : async () => { await supabase.auth.signOut(); location.reload() },
  })
```

Replace it with:

```typescript
  // FIX 5: pass real account email and sign-out handler to the HUD chip
  // (in demo mode the chip is a call-to-action that opens crewlu.net instead)
  const hud = createHud(hudHost, {
    account,
    onSignOut: demo
      ? () => { window.open('https://crewlu.net', '_blank', 'noopener') }
      : async () => { await supabase.auth.signOut(); location.reload() },
    onSignIn: demo
      ? () => {
          const url = new URL(location.href)
          url.searchParams.delete('demo')
          location.href = url.toString()
        }
      : undefined,
  })
```

`onSignIn` is `undefined` for real (non-demo) sessions, so `signInEl` stays `display:none` for them — they're already signed in and never see the button.

- [ ] **Step 2: Typecheck**

Run: `cd /Users/toddanderson/Dev/crewlu-globe && npx tsc --noEmit`
Expected: exits with no output and status 0.

- [ ] **Step 3: Manual browser verification — demo mode shows the button and it works**

Using the running "globe" preview server (`localhost:8798`):

1. Navigate to `http://localhost:8798/?demo=1` and reload so the new build is picked up.
2. Confirm via screenshot/snapshot: a "→ SIGN IN" button renders immediately left of "DEMO · GET CREWLU" in the top-right corner, styled like the other `.navbtn` buttons (LUNAR RETURN, SHARE, etc.).
3. Click the "→ SIGN IN" button.
4. Confirm the page reloads to a URL with no `demo` query param, and the real email+password sign-in form (`requireSession()`'s form) is now showing.

Expected: all four checks pass.

- [ ] **Step 4: Manual browser verification — real sessions never see the button**

1. Navigate to `http://localhost:8798/` (no `?demo=1`) with a real signed-in session.
2. Confirm via screenshot/snapshot: the top-right corner shows only the account email — no "→ SIGN IN" button is present.

Expected: both checks pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/toddanderson/Dev/crewlu-globe
git add src/main.ts
git commit -m "feat(main): wire demo Sign In button to strip ?demo=1 and reload"
```
