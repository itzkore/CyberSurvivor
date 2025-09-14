import React from 'react';
import { Tooltip } from './ui/Tooltip';

export function FeaturedOperative(){
  return (
    <div className="mb-4 flex items-center justify-between rounded-lg holo glass neon-border p-4">
      <div className="flex items-center gap-3">
        <img src="/assets/player/runner.png" alt="Featured Operative" className="h-12 w-12 rounded object-cover" />
        <div>
          <div className="font-orbitron text-white">Featured Operative</div>
          <div className="text-xs text-white/70">Cyber Runner</div>
        </div>
      </div>
      <Tooltip content="Vyber pro +20% scrap">
        <span className="animate-pulse rounded-full border border-acid/60 bg-acid/15 px-3 py-1 text-xs font-semibold text-acid">Daily Bonus</span>
      </Tooltip>
    </div>
  );
}

export default FeaturedOperative;
