// Minimal shape of the Supabase client this helper needs — kept local so the unit test can
// pass a mock without importing (or constructing) the real CrewLu Cloud client.
export interface SignOutClient {
  auth: { signOut: (options: { scope: 'local' }) => Promise<unknown> }
}

/** Where the session is stored: localStorage in the browser, a mock in the tests. */
export interface SessionStorage {
  removeItem: (key: string) => void
}

/**
 * Sign out of THIS browser only, and always leave it signed out.
 *
 * supabase-js v2's `signOut()` defaults to `scope: 'global'`, which revokes EVERY refresh
 * token on the account. The globe signs in with the pilot's own CrewLu Cloud account, so a
 * global sign-out here would also sign the pilot's CrewLu iPhone app (and any other device)
 * out of CrewLu Cloud, silently breaking their sync until they sign in again. `scope: 'local'`
 * removes only this browser's session; the on-device behaviour is identical.
 *
 * The Duty app hit the global-scope default in production on 2026-07-14 and fixed it the same
 * way (see SupabaseAuthService.swift `signOut(scope: .local)`).
 *
 * supabase-js also returns early and KEEPS the stored session when it can't reach CrewLu Cloud
 * (offline, or an expired token it can't refresh), so the stored session under `storageKey` is
 * removed directly afterwards. Otherwise the pilot would stay signed in on a shared computer.
 */
export async function signOutHere(
  client: SignOutClient,
  storageKey: string,
  storage: SessionStorage | undefined = globalThis.localStorage,
): Promise<unknown> {
  let result: unknown
  try {
    result = await client.auth.signOut({ scope: 'local' })
  } catch (error) {
    result = { error }
  }
  try {
    storage?.removeItem(storageKey)
  } catch {
    // Storage is blocked, so there is no stored session to leave behind.
  }
  return result
}
