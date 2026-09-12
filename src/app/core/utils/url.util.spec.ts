import { describe, expect, it } from 'vitest';
import { getSafeReturnUrl } from './url.util';

describe('getSafeReturnUrl', () => {
  it('should allow valid relative paths', () => {
    expect(getSafeReturnUrl('/')).toBe('/');
    expect(getSafeReturnUrl('/dashboard')).toBe('/dashboard');
    expect(getSafeReturnUrl('/inventory/items')).toBe('/inventory/items');
    expect(getSafeReturnUrl('/settings?tab=security&lang=id')).toBe('/settings?tab=security&lang=id');
    expect(getSafeReturnUrl('/reports#summary')).toBe('/reports#summary');
  });

  it('should trim surrounding whitespace on valid paths', () => {
    expect(getSafeReturnUrl('   /dashboard   ')).toBe('/dashboard');
  });

  it('should return fallback for null, undefined, or empty string', () => {
    expect(getSafeReturnUrl(null)).toBe('/');
    expect(getSafeReturnUrl(undefined)).toBe('/');
    expect(getSafeReturnUrl('')).toBe('/');
    expect(getSafeReturnUrl('   ')).toBe('/');
  });

  it('should use custom fallback when provided', () => {
    expect(getSafeReturnUrl(null, '/home')).toBe('/home');
    expect(getSafeReturnUrl('https://evil.com', '/fallback')).toBe('/fallback');
  });

  it('should reject absolute URLs with schemes', () => {
    expect(getSafeReturnUrl('https://evil.com')).toBe('/');
    expect(getSafeReturnUrl('http://evil.com')).toBe('/');
    expect(getSafeReturnUrl('ftp://evil.com')).toBe('/');
    expect(getSafeReturnUrl('javascript:alert(1)')).toBe('/');
    expect(getSafeReturnUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe('/');
  });

  it('should reject protocol-relative URLs', () => {
    expect(getSafeReturnUrl('//evil.com')).toBe('/');
    expect(getSafeReturnUrl('//evil.com/path')).toBe('/');
    expect(getSafeReturnUrl('///evil.com')).toBe('/');
  });

  it('should reject backslash bypass attempts', () => {
    expect(getSafeReturnUrl('/\\evil.com')).toBe('/');
    expect(getSafeReturnUrl('/evil.com\\..')).toBe('/');
    expect(getSafeReturnUrl('\\evil.com')).toBe('/');
  });

  it('should reject URLs containing control characters', () => {
    expect(getSafeReturnUrl('/dashboard\r\n')).toBe('/');
    expect(getSafeReturnUrl('/dashboard\0')).toBe('/');
  });
});
