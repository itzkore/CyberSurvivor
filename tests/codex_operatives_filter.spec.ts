import { describe, it, expect } from 'vitest';
import { __test } from '../src/features/codex/useOperatives';

describe('Codex Operatives filter', () => {
  it('returns all on empty query', () => {
    const res = __test.filter('');
    expect(res.length).toBeGreaterThan(0);
  });
  it('filters by name/role/id', () => {
    const res = __test.filter('runner');
    expect(res.some(o => o.id === 'cyber_runner')).toBe(true);
    const res2 = __test.filter('UTILITY');
    expect(res2.some(o => o.role === 'UTILITY')).toBe(true);
  });
});
