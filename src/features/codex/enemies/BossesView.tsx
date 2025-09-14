import React from 'react';
import useEnemies from './useEnemies';

export function BossesView(){
  const { bosses } = useEnemies();
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {bosses.map(b => (
        <div key={b.id} className="holo glass neon-border rounded-xl p-4">
          <div className="flex items-start gap-4">
            <img src={b.splash} alt="" className="h-20 w-20 object-contain" loading="lazy" />
            <div className="flex-1">
              <div className="font-orbitron text-white text-lg">{b.name}</div>
              <div className="mt-2 text-xs text-white/70">Drops: {b.drops.join(', ')}</div>
              <div className="mt-2 text-xs text-white/80">
                {b.phases.map((p,i)=>(
                  <div key={i} className="mb-1">
                    <span className="font-semibold">{p.name}:</span> {p.abilities.join(', ')}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default BossesView;
