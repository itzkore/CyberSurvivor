import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { getOrCreateNickname, setNickname } from '../leaderboard/store.js';

describe('Profile nickname persistence (memory)', () => {
  beforeAll(() => { process.env.TEST_LEADERBOARD_MEMORY = '1'; });

  it('generates deterministic nickname per user (stored)', () => {
    return getOrCreateNickname('userA').then(a1 => {
      return getOrCreateNickname('userA').then(a2 => {
        expect(a1.nickname).toBeTruthy();
        expect(a1.nickname).toBe(a2.nickname);
      });
    });
  });

  it('allows setting nickname', () => {
    return setNickname('userB', 'CustomNick').then(() => getOrCreateNickname('userB')).then(b => {
      expect(b.nickname).toBe('CustomNick');
      expect(b.profileComplete).toBe(true);
    });
  });
});
