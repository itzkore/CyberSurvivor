import React from 'react';
import usePassives from './usePassives';

export function PassivesView(){
  const { list } = usePassives();
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {list.map(p => (
        <div key={p.id} className="holo glass neon-border rounded-lg p-3">
          <div className="font-semibold text-white">{p.name}</div>
          <div className="text-xs text-white/70">{p.description}</div>
        </div>
      ))}
    </div>
  );
}

export default PassivesView;
