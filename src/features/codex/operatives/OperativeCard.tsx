import React from 'react';
import type { Operative } from '../types';
import { RarityBadge } from '../ui/RarityBadge';
import { StatChip } from '../ui/StatChip';
import { NeonButton } from '../ui/NeonButton';
import { Tooltip } from '../ui/Tooltip';

export function OperativeCard({ operative, onSelect, onViewDetails, onOpenWeapons }: {
  operative: Operative;
  onSelect?(): void;
  onViewDetails?(): void;
  onOpenWeapons?(): void;
}){
  return (
    <div className="relative w-[300px] shrink-0 rounded-xl overflow-hidden holo glass neon-border">
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
      <div className="h-48 w-full flex items-center justify-center bg-black/20">
        <img
          src={operative.portrait}
          alt={operative.name}
          className="max-h-44 object-contain image-render-pixel"
          draggable={false}
          loading="lazy"
        />
      </div>
      <div className="absolute left-3 top-3">
        <RarityBadge rarity={operative.rarity} label={operative.rarity} />
      </div>
      <div className="relative p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-orbitron text-lg text-white drop-shadow">{operative.name}</div>
            <div className="text-white/70 text-xs">{operative.role}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <StatChip label="HP" value={operative.hp} hint="Health points (survivability)." />
          <StatChip label="DMG" value={operative.dmg} hint="Base damage per hit; higher increases DPS." />
          <StatChip label="SPD" value={operative.spd} hint="Movement speed; affects kiting and pickup radius feel." />
        </div>
        <div className="flex items-center gap-2 pt-2">
          <Tooltip content="Set this operative">
            <NeonButton size="sm" onClick={onSelect}>Set as Operative</NeonButton>
          </Tooltip>
          <NeonButton size="sm" variant="ghost" onClick={onOpenWeapons}>Open Weapon</NeonButton>
          <NeonButton size="sm" variant="ghost" onClick={onViewDetails}>View Details</NeonButton>
        </div>
      </div>
    </div>
  );
}

export default OperativeCard;
