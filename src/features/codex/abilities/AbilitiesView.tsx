import React from 'react';
import useAbilities from './useAbilities';
import { AbilityIcon } from '../ui/AbilityIcon';

export function AbilitiesView(){
  const { list } = useAbilities();
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {list.map(a => (
        <div key={a.id} className="holo glass neon-border rounded-lg p-3 flex items-center gap-3">
          <AbilityIcon src={a.icon} alt={a.name} />
          <div>
            <div className="font-semibold text-white">{a.name}</div>
            <div className="text-xs text-white/70">{typeof a.cooldown === 'number' ? `CD ${a.cooldown}s — ` : ''}{a.description}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default AbilitiesView;
