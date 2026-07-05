# Demo Globe Sign-In Button

Date: 2026-07-05
Status: Approved

## Goal

Jumpseat Mode (`?demo=1`) gives visitors a fully live globe with no account, but the only path back to a real account is the "DEMO · GET CREWLU" chip, which just bounces to the crewlu.net marketing site. Add a direct Sign In entry point so a visitor who already has an account isn't forced through the marketing site to find the login form.

## Components

1. **Sign In button** (`src/globe/hud.ts`): New `#signInBtn` (`.navbtn`, hidden by default) added next to `#account`, both wrapped in a small flex container (`position:absolute;top:22px;right:50px;display:flex;gap:10px`) anchored where `#account` sits today — replaces the single absolutely-positioned `#account` div with a two-child flex row so the elements lay out side by side without hand-tuned offsets. `createHud`'s opts gains `onSignIn?: () => void`; when present, the button is shown and wired to the callback (mirrors the existing `onSignOut` wiring immediately above it). Label: "→ SIGN IN", matching the icon+all-caps convention of sibling buttons (LUNAR RETURN, SHARE, ALL TIME, RECORDS, FLEET).
2. **Click behavior** (`src/main.ts`): `onSignIn` is passed only when `demo` is true — it deletes the `demo` param from the current URL and navigates there. That reload hits the existing `requireSession()` gate untouched and shows the real email+password form; no new auth logic. Real (non-demo) sessions get `onSignIn: undefined`, so the button stays hidden — they're already signed in.

## Explicitly out

No inline/overlay sign-in (no modal, no swapping demo data for real data in place) — signing in always reloads to the real gate. The existing "DEMO · GET CREWLU" chip and its click-through to crewlu.net are untouched; the new button sits alongside it, not instead of it.

## Testing & verification

Manual: load `?demo=1`, confirm the button renders next to the demo chip and is absent when signed in normally; click it, confirm it lands on the real sign-in form with `demo` stripped from the URL. No new Vitest coverage — this is a DOM+navigation wire-up with no new logic to unit test.

## Risks

Low risk: reuses existing `.navbtn` CSS and the existing `requireSession()` gate; only new behavior is a URL rewrite + reload. `#account` is referenced only in `hud.ts` (verified no other file or CSS selector targets it by ID), so restructuring its wrapper is safe.
