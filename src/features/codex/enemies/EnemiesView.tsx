import React from 'react';
import useEnemies from './useEnemies';

export function EnemiesView(){
  const { enemies } = useEnemies();
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {enemies.map(e => (
        <div key={e.id} className="holo glass neon-border rounded-lg p-3 text-center">
          <img src={e.sprite} alt="" className="mx-auto h-16 w-16 object-contain" loading="lazy" />
          <div className="mt-2 font-semibold text-white">{e.name}</div>
          <div className="text-xs text-white/70">HP {e.hp} · DMG {e.dmg}</div>
        </div>
      ))}
    </div>
  );
}

export default EnemiesView;
