import { describe, it, expect, vi } from 'vitest'
import { signOutHere } from '../src/auth/signOut'

// Pins the sign-out scope. supabase-js v2 defaults signOut() to scope:'global', which revokes
// every refresh token on the account and would sign the pilot's other devices (the CrewLu
// iPhone app) out of CrewLu Cloud. The globe must only ever sign out LOCALLY. A mock client is
// used — this never touches the real CrewLu Cloud project.
const KEY = 'sb-test-auth-token'
const storage = () => ({ removeItem: vi.fn() })

describe('signOutHere', () => {
  it("calls signOut with scope 'local' (never global)", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null })
    const client = { auth: { signOut } }

    await signOutHere(client, KEY, storage())

    expect(signOut).toHaveBeenCalledTimes(1)
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('returns the underlying signOut result', async () => {
    const result = { error: null }
    const client = { auth: { signOut: vi.fn().mockResolvedValue(result) } }

    await expect(signOutHere(client, KEY, storage())).resolves.toBe(result)
  })

  // supabase-js returns early and KEEPS the stored session when it can't reach CrewLu Cloud
  // (offline, or an expired token it can't refresh). Sign-out must still take, or the pilot
  // stays signed in on a shared computer.
  it('removes the stored session after a normal sign-out', async () => {
    const store = storage()
    const client = { auth: { signOut: vi.fn().mockResolvedValue({ error: null }) } }

    await signOutHere(client, KEY, store)

    expect(store.removeItem).toHaveBeenCalledTimes(1)
    expect(store.removeItem).toHaveBeenCalledWith(KEY)
  })

  it("still removes the stored session when CrewLu Cloud can't be reached", async () => {
    const store = storage()
    const offline = { error: new Error('Failed to fetch') }
    const client = { auth: { signOut: vi.fn().mockResolvedValue(offline) } }

    await expect(signOutHere(client, KEY, store)).resolves.toBe(offline)
    expect(store.removeItem).toHaveBeenCalledWith(KEY)
  })

  it('still removes it, without throwing, when signOut throws', async () => {
    const store = storage()
    const boom = new Error('boom')
    const client = { auth: { signOut: vi.fn().mockRejectedValue(boom) } }

    await expect(signOutHere(client, KEY, store)).resolves.toEqual({ error: boom })
    expect(store.removeItem).toHaveBeenCalledWith(KEY)
  })

  it('still finishes when the browser blocks storage', async () => {
    const blocked = { removeItem: vi.fn(() => { throw new Error('SecurityError') }) }
    const client = { auth: { signOut: vi.fn().mockResolvedValue({ error: null }) } }

    await expect(signOutHere(client, KEY, blocked)).resolves.toEqual({ error: null })
  })
})
