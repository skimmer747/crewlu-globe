import { describe, it, expect, vi } from 'vitest'
import { signOutHere } from '../src/auth/signOut'

// Pins the sign-out scope. supabase-js v2 defaults signOut() to scope:'global', which revokes
// every refresh token on the account and would sign the pilot's other devices (the CrewLu
// iPhone app) out of CrewLu Cloud. The globe must only ever sign out LOCALLY. A mock client is
// used — this never touches the real CrewLu Cloud project.
describe('signOutHere', () => {
  it("calls signOut with scope 'local' (never global)", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null })
    const client = { auth: { signOut } }

    await signOutHere(client)

    expect(signOut).toHaveBeenCalledTimes(1)
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('returns the underlying signOut promise', async () => {
    const result = { error: null }
    const client = { auth: { signOut: vi.fn().mockResolvedValue(result) } }

    await expect(signOutHere(client)).resolves.toBe(result)
  })
})
