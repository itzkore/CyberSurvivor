/**
 * Generates cyberpunk style nicknames combining an adjective and a noun.
 * Keeps lists intentionally small for style consistency and low bundle size.
 */
const ADJECTIVES = [
  'Neon','Quantum','Cyber','Ghost','Shadow','Nova','Chrome','Pixel','Viral','Synaptic'
];

const NOUNS = [
  'Runner','Hacker','Wraith','Nomad','Cipher','Rogue','Phantom','Gunner','Weaver','Operative'
];

export function generateNickname(existing?: Set<string>): string {
  // Attempt a few times to avoid simple collisions if a set is provided
  for (let attempt = 0; attempt < 10; attempt++) {
     const adj = ADJECTIVES[(Math.random() * ADJECTIVES.length) | 0];
     const noun = NOUNS[(Math.random() * NOUNS.length) | 0];
     const num = (Math.random() * 99) | 0; // 0-98
     const nick = `${adj}${noun}${num.toString().padStart(2,'0')}`;
     if (!existing || !existing.has(nick)) return nick;
  }
  // Fallback deterministic
  return 'CyberOperative';
}
