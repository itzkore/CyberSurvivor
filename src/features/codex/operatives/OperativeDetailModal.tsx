import * as Dialog from '@radix-ui/react-dialog';
import React from 'react';
import type { Operative } from '../types';
import { StatChip } from '../ui/StatChip';
import { NeonButton } from '../ui/NeonButton';
import { motion, AnimatePresence } from 'framer-motion';

export function OperativeDetailModal({ open, onOpenChange, operative, onSelect }: { open: boolean; onOpenChange(v:boolean): void; operative: Operative; onSelect?(): void; }){
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <AnimatePresence>
          {open && (
            <Dialog.Overlay asChild>
              <motion.div className="fixed inset-0 bg-black/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
          )}
        </AnimatePresence>
        <Dialog.Content asChild>
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="fixed left-1/2 top-1/2 z-[100] w-[min(960px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl holo glass neon-border p-6"
            role="dialog" aria-modal="true"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="relative">
                <img src={operative.portrait} alt="" className="h-72 w-full object-cover rounded-lg" />
              </div>
              <div className="space-y-4">
                <div className="font-orbitron text-2xl text-white">{operative.name}</div>
                <div className="grid grid-cols-3 gap-2">
                  <StatChip label="HP" value={operative.hp} />
                  <StatChip label="DMG" value={operative.dmg} />
                  <StatChip label="SPD" value={operative.spd} />
                </div>
                <section>
                  <div className="text-white/80 font-semibold mb-2">Signature Weapon</div>
                  <div className="rounded-md border border-white/15 bg-white/5 p-3 text-sm text-white/80">
                    {operative.signatureWeapon.name} — {operative.signatureWeapon.rarity}
                  </div>
                </section>
                <section>
                  <div className="text-white/80 font-semibold mb-2">Ability</div>
                  <div className="rounded-md border border-white/15 bg-white/5 p-3 text-sm text-white/80">
                    {operative.ability.name} · CD {operative.ability.cooldown}s
                  </div>
                </section>
                <section>
                  <div className="text-white/80 font-semibold mb-2">How to Play</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-white/80">
                    <ul className="list-disc pl-5">{operative.tips?.early?.map((t,i)=>(<li key={i}>{t}</li>))}</ul>
                    <ul className="list-disc pl-5">{operative.tips?.mid?.map((t,i)=>(<li key={i}>{t}</li>))}</ul>
                    <ul className="list-disc pl-5">{operative.tips?.late?.map((t,i)=>(<li key={i}>{t}</li>))}</ul>
                  </div>
                </section>
                <section>
                  <div className="text-white/80 font-semibold mb-2">Lore</div>
                  <div className="rounded-md border border-white/15 bg-white/5 p-3 text-sm text-white/80">
                    {operative.loreLocked ? '???' : (operative.lore || '—')}
                  </div>
                </section>
                <div className="flex gap-2 pt-2">
                  <NeonButton onClick={onSelect}>Select Operative</NeonButton>
                  <NeonButton variant="ghost" onClick={()=>onOpenChange(false)}>Back</NeonButton>
                </div>
              </div>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default OperativeDetailModal;
