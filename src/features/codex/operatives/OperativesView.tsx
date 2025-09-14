import React from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { OperativeCard } from './OperativeCard';
import type { Operative } from '../types';

export function OperativesView({
  list,
  onViewDetails,
  onSelect,
  onOpenWeapons,
}: {
  list: Operative[];
  onViewDetails(id: string): void;
  onSelect(id: string): void;
  onOpenWeapons?(id: string): void;
}){
  // Tuning for smoothness and proper end spacing:
  // - keepSnaps preserves ends (we add container padding so last/first have breathing room)
  // - dragFree=false provides smooth, consistent snap feel
  // - loop=false so the “end of cycle” shows natural end with gap rather than an abrupt seam
  const [viewportRef] = useEmblaCarousel({
    align: 'start',
    dragFree: true, // momentum for smoother feel
    containScroll: 'keepSnaps', // preserve natural ends; we add padding for gap
    loop: false,
  });
  return (
    <div className="space-y-4">
      {list.length === 0 ? (
        <div className="text-white/70 text-sm">No operatives match your search.</div>
      ) : (
        <div className="embla overflow-hidden" ref={viewportRef}>
          <div className="embla__container flex gap-5 px-6 md:px-8 lg:px-10">
            {list.map(op => (
              <OperativeCard
                key={op.id}
                operative={op}
                onViewDetails={() => onViewDetails(op.id)}
                onSelect={() => onSelect(op.id)}
                onOpenWeapons={() => onOpenWeapons?.(op.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default OperativesView;
