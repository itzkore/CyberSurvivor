import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HoloPanel } from './ui/HoloPanel';
import OperativesView from './operatives/OperativesView';
import OperativeDetailModal from './operatives/OperativeDetailModal';
import useOperatives from './useOperatives';
import type { Operative } from './types';
import { CHARACTERS } from '../../data/characters';
import WeaponsView from './weapons/WeaponsView';
import AbilitiesView from './abilities/AbilitiesView';
import PassivesView from './passives/PassivesView';
import { EnemiesView, BossesView } from './enemies';

type Tab = 'Operatives' | 'Weapons' | 'Abilities' | 'Passives' | 'Enemies' | 'Bosses';

const tabs: Tab[] = ['Operatives','Weapons','Abilities','Passives','Enemies','Bosses'];

export function CodexRoute(props?: { tab?: string; operativeId?: string }){
  const initialTab = (props?.tab && ['Operatives','Weapons','Abilities','Passives','Enemies','Bosses'].includes(props.tab)) ? (props.tab as Tab) : 'Operatives';
  const [active, setActive] = useState<Tab>(initialTab);
  const { list, query, setQuery, getById, sort, setSort } = useOperatives();
  const [detailId, setDetailId] = useState<string | null>(props?.operativeId ?? null);
  const [weaponFocusId, setWeaponFocusId] = useState<number | null>(null);

  const handleSelect = (id: string) => {
    const op = getById(id);
    if (!op) return;
    // Map Operatives -> CharacterData minimal shape used by main menu/game
    const mapToCharacter = (o: Operative) => {
      // Resolve by id to full CharacterData for compatibility
      const full = CHARACTERS.find(c => c.id === o.id);
      const character = full || ({ id: o.id, name: o.name } as any);
    try { window.dispatchEvent(new CustomEvent('characterSelected', { detail: character })); } catch {}
    // Close Codex after selection
    try { window.dispatchEvent(new CustomEvent('hideCodex')); } catch {}
    };
    mapToCharacter(op);
  };

  const TabContent = useMemo(() => {
    switch(active){
      case 'Operatives':
        return (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-white/70">
              <span className="hidden md:inline">Legend:</span>
              <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-white/20 border border-white/30"/> Common</span>
              <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-neon-violet/30 border border-neon-violet/60"/> Rare</span>
              <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-neon-cyan/30 border border-neon-cyan/60"/> Epic</span>
              <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-acid/30 border border-acid/60"/> Legendary</span>
            </div>
            <OperativesView
              list={list}
              onViewDetails={(id)=>setDetailId(id)}
              onSelect={handleSelect}
              onOpenWeapons={(id)=>{
              const op = getById(id);
              if (op) {
                setWeaponFocusId(op.signatureWeapon.id as unknown as number);
                setActive('Weapons');
              }
            }}
            />
          </>
        );
      case 'Weapons':
        return <WeaponsView focusId={weaponFocusId ?? undefined} />;
      case 'Abilities':
        return <AbilitiesView />;
      case 'Passives':
        return <PassivesView />;
      case 'Enemies':
        return <EnemiesView />;
      case 'Bosses':
        return <BossesView />;
      default: return <div className="text-white/70 text-sm">Coming soon…</div>
    }
  }, [active, list, weaponFocusId]);

  // On mount: push a history state so a single back swipe closes the Codex
  useEffect(() => {
    try {
      const url = new URL(location.href);
      url.searchParams.set('codex', '1');
      history.pushState({ codex: 1 }, '', url);
    } catch {}
    const onPop = () => {
      try { window.dispatchEvent(new CustomEvent('hideCodex')); } catch {}
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // URL sync: codexTab + q
  useEffect(()=>{
    try {
      const url = new URL(location.href);
      url.searchParams.set('codex','1');
      url.searchParams.set('codexTab', active);
      if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
      history.replaceState(history.state, '', url);
    } catch {}
  }, [active, query]);

  // Close helpers
  const close = () => {
    try { window.dispatchEvent(new CustomEvent('hideCodex')); } catch {}
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div
      className="codex-overlay fixed inset-0 z-[2001] font-inter text-white"
      role="dialog"
      aria-modal="true"
      onClick={(e)=>{
        // click-out: only when backdrop is clicked
        if (e.currentTarget === e.target) close();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
      <div className="absolute inset-0 -z-10 scanlines pointer-events-none" aria-hidden="true" />
      {/* Content frame */}
      <div className="relative mx-auto h-[92vh] w-[min(1680px,95vw)] px-4 py-5">
          <div className="mb-3 flex items-center justify-between">
          <div className="font-orbitron text-2xl text-neon-cyan drop-shadow">CODEX</div>
            <div className="flex items-center gap-2">
              {/* Search only shown on Operatives */}
              {active === 'Operatives' && (
                <>
              <input
                aria-label="Search Operatives"
                placeholder="Search operatives…"
                value={query}
                onChange={e=>setQuery(e.currentTarget.value)}
                className="w-64 rounded-md border border-white/20 bg-black/40 px-3 py-2 text-sm outline-none focus:border-neon-cyan/60" />
              <select aria-label="Sort by" value={sort} onChange={e=>setSort(e.currentTarget.value as any)} className="rounded-md border border-white/20 bg-black/40 px-2 py-2 text-sm">
                <option value="name">Name</option>
                <option value="hp">HP</option>
                <option value="dmg">DMG</option>
                <option value="spd">SPD</option>
                <option value="power">Power</option>
              </select>
                </>
              )}
              <button
                aria-label="Close Codex"
                onClick={close}
                className="ml-3 rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-sm text-white/90 hover:bg-white/15"
              >Close</button>
            </div>
        </div>
        {/* Scrollable content */}
        <HoloPanel className="h-[calc(92vh-52px)] overflow-hidden">
          <div role="tablist" aria-label="Codex Tabs" className="mb-3 flex flex-wrap gap-2">
            {tabs.map(t => (
              <button
                key={t}
                role="tab"
                aria-selected={active===t}
                className={`rounded-md border px-3 py-1.5 text-sm ${active===t? 'border-neon-cyan/60 bg-neon-cyan/15 text-neon-cyan' : 'border-white/15 bg-white/5 text-white/80 hover:bg-white/10'}`}
                onClick={() => setActive(t)}
              >{t}</button>
            ))}
          </div>
          <div className="relative h-[calc(100%-40px)] overflow-auto pr-1">
            <AnimatePresence mode="wait">
              <motion.div key={active} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                {TabContent}
              </motion.div>
            </AnimatePresence>
          </div>
        </HoloPanel>
      </div>
      <AnimatePresence>
        {detailId && (
          <OperativeDetailModal
            open={!!detailId}
            onOpenChange={(v)=>{ if(!v) setDetailId(null); }}
            operative={getById(detailId)!}
            onSelect={()=>{ handleSelect(detailId); setDetailId(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default CodexRoute;
