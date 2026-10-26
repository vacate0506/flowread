import { describe, expect, it } from 'vitest'
import { isPrivateAddress, toArrayBuffer } from '../lib/fetcher'

describe('SSRF guard', () => {
  const privateAddresses = [
    '127.0.0.1',
    '127.1.2.3',
    '0.0.0.0',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ]

  const publicAddresses = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2001:4860:4860::8888', '2606:4700::1111']

  it.each(privateAddresses)('blocks %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each(publicAddresses)('allows %s', (address) => {
    expect(isPrivateAddress(address)).toBe(false)
  })

  it('treats malformed input as private', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true)
    expect(isPrivateAddress('')).toBe(true)
    expect(isPrivateAddress('999.1.1.1')).toBe(true)
  })
})

describe('toArrayBuffer', () => {
  it('copies bytes into a plain ArrayBuffer', () => {
    const source = new Uint8Array([1, 2, 3, 255])
    const buffer = toArrayBuffer(source)
    expect(buffer).toBeInstanceOf(ArrayBuffer)
    expect([...new Uint8Array(buffer)]).toEqual([1, 2, 3, 255])
    source[0] = 9
    expect(new Uint8Array(buffer)[0]).toBe(1)
  })
})
