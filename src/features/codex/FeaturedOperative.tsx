import React from 'react';
import { Tooltip } from './ui/Tooltip';

export function FeaturedOperative(props: { onEnter?: () => void }){
  return (
    <div className="mb-4 flex items-center justify-between rounded-xl holo glass neon-border p-4 md:p-5">
      <div className="flex items-center gap-4">
  <img src={(window as any).AssetLoader ? (window as any).AssetLoader.normalizePath('/assets/player/cyber_runner.png') : '/assets/player/cyber_runner.png'} alt="Featured Operative" className="h-16 w-16 rounded object-cover md:h-20 md:w-20" />
        <div>
          <div className="font-orbitron text-lg md:text-xl text-white">Featured Operative</div>
          <div className="text-sm md:text-base text-white/80">Cyber Runner</div>
          <div className="mt-1 text-xs text-white/60">Blink‑dash mobility with i‑frames—perfect for dodging elites.</div>
          <div className="mt-1 text-xs font-semibold text-acid/90">Daily Bonus: +20% Scrap</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Tooltip content="Vyber pro +20% scrap">
          <span className="hidden sm:inline-block animate-pulse rounded-full border border-acid/60 bg-acid/15 px-3 py-1 text-xs font-semibold text-acid">Daily Bonus</span>
        </Tooltip>
        <button
          className="rounded-md border border-neon-cyan/60 bg-neon-cyan/15 px-3 py-2 text-sm font-semibold text-neon-cyan hover:bg-neon-cyan/20"
          onClick={()=> props.onEnter?.()}
        >Enter</button>
      </div>
    </div>
  );
}

export default FeaturedOperative;
