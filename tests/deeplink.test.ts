import { describe, it, expect } from 'vitest'
import { parseDeepLink } from '../src/globe/deeplink'

describe('parseDeepLink', () => {
  it('parses trip + play', () => {
    expect(parseDeepLink('#trip=DEMO-T3W&play=1')).toEqual({ trip: 'DEMO-T3W', play: true })
  })
  it('handles missing/garbage hashes', () => {
    expect(parseDeepLink('')).toEqual({ trip: null, play: false })
    expect(parseDeepLink('#play=maybe')).toEqual({ trip: null, play: false })
    expect(parseDeepLink('trip=X')).toEqual({ trip: 'X', play: false })
  })
})
