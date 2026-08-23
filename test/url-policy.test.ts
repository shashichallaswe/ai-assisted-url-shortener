import { describe, expect, it } from 'vitest';
import { inspectDestination } from '../src/security/url-policy.js';

describe('inspectDestination', () => {
  it('accepts a public https URL and returns a canonical href', () => {
    const result = inspectDestination('https://Example.COM/Path?q=1');

    expect(result).toStrictEqual({ ok: true, href: 'https://example.com/Path?q=1' });
  });

  it.each([
    ['http://example.com', 'http'],
    ['javascript:alert(1)', 'javascript'],
    ['data:text/html,hello', 'data'],
    ['file:///etc/passwd', 'file'],
    ['ftp://example.com', 'ftp'],
  ])('rejects %s because the scheme is not https', (raw) => {
    const result = inspectDestination(raw);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toMatch(/https/i);
    expect(result.reason).not.toContain(raw);
  });

  it.each([
    'https://localhost/',
    'https://localhost.localdomain/',
    'https://app.localhost/path',
    'https://127.0.0.1/',
    'https://127.1/',
    'https://10.0.0.1/',
    'https://10.255.255.254/x',
    'https://172.16.0.1/',
    'https://172.31.255.1/',
    'https://192.168.0.1/',
    'https://169.254.1.1/',
    'https://0.0.0.0/',
    'https://100.64.0.1/',
    'https://2130706433/',
    'https://[::1]/',
    'https://[::]/',
    'https://[fe80::1]/',
    'https://[fc00::1]/',
    'https://[fd12:3456::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:10.0.0.1]/',
  ])('rejects private or local address %s', (raw) => {
    const result = inspectDestination(raw);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toMatch(/private or local/i);
    expect(result.reason).not.toMatch(/https?:\/\//);
  });

  it('rejects embedded credentials', () => {
    const result = inspectDestination('https://user:secret@example.com/');

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toMatch(/credentials/i);
    expect(result.reason).not.toContain('secret');
  });

  it('rejects a relative URL', () => {
    expect(inspectDestination('/relative')).toMatchObject({ ok: false });
  });

  it('rejects a URL longer than 2048 characters', () => {
    const raw = `https://example.com/${'a'.repeat(2048)}`;

    expect(inspectDestination(raw)).toMatchObject({ ok: false });
  });

  it('does not treat a public hostname that merely contains a private label as local', () => {
    expect(inspectDestination('https://localhost.example.com/')).toMatchObject({ ok: true });
    expect(inspectDestination('https://192.168.1.1.example.com/')).toMatchObject({ ok: true });
  });

  it('allows a public IPv4 literal and a documentation IPv6', () => {
    expect(inspectDestination('https://8.8.8.8/')).toMatchObject({ ok: true });
    expect(inspectDestination('https://[2001:db8::1]/')).toMatchObject({ ok: true });
  });

  it('allows 172.15 and 172.32, which sit outside the 172.16/12 private block', () => {
    expect(inspectDestination('https://172.15.0.1/')).toMatchObject({ ok: true });
    expect(inspectDestination('https://172.32.0.1/')).toMatchObject({ ok: true });
  });
});
