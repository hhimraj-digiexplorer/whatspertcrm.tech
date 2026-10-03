import { describe, expect, it } from 'vitest';
import { isSuperAdminEmail, superAdminEmails } from './super-admin';

describe('super-admin emails', () => {
  it('parses a comma-separated list, trimmed and case-insensitive', () => {
    expect([...superAdminEmails(' A@x.in, b@y.in ,,')]).toEqual(['a@x.in', 'b@y.in']);
    expect(isSuperAdminEmail('a@X.in', 'a@x.in')).toBe(true);
    expect(isSuperAdminEmail('c@x.in', 'a@x.in')).toBe(false);
  });

  it('grants nobody when the variable is empty or missing', () => {
    expect(isSuperAdminEmail('a@x.in', '')).toBe(false);
    expect(isSuperAdminEmail('a@x.in', undefined)).toBe(false);
    expect(isSuperAdminEmail(null, 'a@x.in')).toBe(false);
  });
});
