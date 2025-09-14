import React from 'react';
import useElites from './useElites';

export function ElitesView(){
  const { list, q, setQ } = useElites();
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <input
          aria-label="Search Elites"
          placeholder="Search elites…"
          value={q}
          onChange={e=>setQ(e.currentTarget.value)}
          className="w-64 rounded-md border border-white/20 bg-black/40 px-3 py-2 text-sm outline-none focus:border-neon-cyan/60" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.map(e => (
          <div key={e.id} className="holo glass neon-border rounded-lg p-3">
            <div className="flex items-start gap-3">
              <img src={e.icon} alt="" className="h-14 w-14 object-contain" loading="lazy" />
              <div className="flex-1">
                <div className="font-orbitron text-white">{e.name}</div>
                <div className="mt-1 text-xs text-white/80">{e.blurb}</div>
                {e.tips?.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-xs text-white/70">
                    {e.tips.map((t,i)=> <li key={i}>{t}</li>)}
                  </ul>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ElitesView;
