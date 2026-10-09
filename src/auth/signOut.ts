// Minimal shape of the Supabase client this helper needs — kept local so the unit test can
// pass a mock without importing (or constructing) the real CrewLu Cloud client.
export interface SignOutClient {
  auth: { signOut: (options: { scope: 'local' }) => Promise<unknown> }
}

/**
 * Sign out of THIS browser only.
 *
 * supabase-js v2's `signOut()` defaults to `scope: 'global'`, which revokes EVERY refresh
 * token on the account. The globe signs in with the pilot's own CrewLu Cloud account, so a
 * global sign-out here would also sign the pilot's CrewLu iPhone app (and any other device)
 * out of CrewLu Cloud, silently breaking their sync until they sign in again. `scope: 'local'`
 * removes only this browser's session; the on-device behaviour is identical.
 *
 * The Duty app hit the global-scope default in production on 2026-07-14 and fixed it the same
 * way (see SupabaseAuthService.swift `signOut(scope: .local)`).
 */
export function signOutHere(client: SignOutClient): Promise<unknown> {
  return client.auth.signOut({ scope: 'local' })
}
