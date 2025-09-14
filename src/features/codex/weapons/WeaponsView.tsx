import React, { useEffect, useMemo, useState } from 'react';
import useWeapons from './useWeapons';
import { RarityBadge } from '../ui/RarityBadge';
import { StatChip } from '../ui/StatChip';
import { Tooltip } from '../ui/Tooltip';

export function WeaponsView({ focusId }: { focusId?: number }){
  const { list, query, setQuery, sort, setSort, getById, describe } = useWeapons();
  const [active, setActive] = useState<number | null>(null);
  useEffect(()=>{ if (focusId != null) setActive(focusId); }, [focusId]);

  const activeWeapon = useMemo(() => (
    active != null ? getById(active) : null
  ), [active, getById]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e)=>setQuery(e.currentTarget.value)}
          placeholder="Search weapons…"
          className="w-64 rounded-md border border-white/20 bg-black/40 px-3 py-2 text-sm outline-none focus:border-neon-cyan/60"
        />
        <select
          aria-label="Sort by"
          value={sort}
          onChange={(e)=>setSort(e.currentTarget.value as any)}
          className="rounded-md border border-white/20 bg-black/40 px-2 py-2 text-sm"
        >
          <option value="name">Name</option>
          <option value="dps">DPS</option>
          <option value="dmg">DMG</option>
          <option value="cd">Cooldown</option>
          <option value="pierce">Pierce</option>
        </select>
        <div className="text-xs text-white/60">Tip: Click a weapon to see full details on the right.</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 no-select">
          {list.map(w => (
            <button key={w.id} onClick={()=>setActive(w.id)} className={`holo glass neon-border rounded-lg p-4 text-left transition-colors ${active===w.id?'ring-1 ring-neon-cyan/60 bg-white/5':''}`}>
              <div className="flex items-start gap-3">
                {w.icon && (<img src={w.icon} alt="" className="h-10 w-10 object-contain" loading="lazy" />)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-white truncate" title={w.name}>{w.name}</div>
                    <RarityBadge rarity={w.rarity} />
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-xs text-white/80">
                    <div>DMG {w.dmg}</div>
                    <div>CD {w.cd}s</div>
                    <div>Pierce {w.pierce}</div>
                    <div>Max {w.maxLevel}</div>
                  </div>
                </div>
              </div>
            </button>
          ))}
          {list.length === 0 && (
            <div className="text-sm text-white/70">No weapons match your search.</div>
          )}
        </div>

        <div className="min-h-[220px] rounded-lg holo glass neon-border p-4">
          {!activeWeapon ? (
            <div className="text-white/70 text-sm">Select a weapon to see details: damage formula, scaling, evolution, and synergy notes.</div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                {activeWeapon.icon && (<img src={activeWeapon.icon} alt="" className="h-12 w-12 object-contain" loading="lazy" />)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-orbitron text-lg text-white drop-shadow truncate" title={activeWeapon.name}>{activeWeapon.name}</div>
                    <RarityBadge rarity={activeWeapon.rarity} />
                  </div>
                  <div className="mt-1 text-xs text-white/70">Base stats and computed DPS are approximations at level 1 unless noted.</div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <StatChip label="DMG" value={activeWeapon.dmg} />
                <StatChip label="CD (s)" value={activeWeapon.cd} />
                <StatChip label="Pierce" value={activeWeapon.pierce} />
                <StatChip label="Max Level" value={activeWeapon.maxLevel} />
                <StatChip label="DPS (est.)" value={describe(activeWeapon).dps} />
              </div>
              <div className="rounded-md border border-white/15 bg-black/30 p-3 text-sm leading-relaxed text-white/85">
                <div className="font-semibold text-white mb-1">What these mean</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li><b>DMG</b>: Base damage per hit. Some weapons scale with passives/evolutions.</li>
                  <li><b>CD</b>: Cooldown between attacks (seconds). Lower is faster.</li>
                  <li><b>Pierce</b>: How many enemies a projectile can pass through.</li>
                  <li><b>DPS</b>: Estimated damage per second: <code>DMG / CD</code> adjusted by behavior.</li>
                </ul>
              </div>
              {describe(activeWeapon).notes && (
                <div className="rounded-md border border-white/15 bg-black/30 p-3 text-sm text-white/85">
                  <div className="font-semibold text-white mb-1">Notes</div>
                  <div>{describe(activeWeapon).notes}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default WeaponsView;
