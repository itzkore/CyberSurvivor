import React from 'react';
import usePassives from './usePassives';

export function PassivesView(){
  const { list, q, setQ } = usePassives();
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <input
          aria-label="Search Passives"
          placeholder="Search passives…"
          value={q}
          onChange={e=>setQ(e.currentTarget.value)}
          className="w-64 rounded-md border border-white/20 bg-black/40 px-3 py-2 text-sm outline-none focus:border-neon-cyan/60" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {list.map(p => (
          <div key={p.id} className="holo glass neon-border rounded-lg p-3">
            <div className="font-semibold text-white">{p.name}</div>
            <div className="text-xs text-white/70">{p.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default PassivesView;
