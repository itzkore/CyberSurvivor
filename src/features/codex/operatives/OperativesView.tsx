import React, { useEffect, useMemo, useRef } from 'react';
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
  const [viewportRef, emblaApi] = useEmblaCarousel({
    align: 'start',
    dragFree: true, // momentum for smoother feel
    containScroll: 'keepSnaps', // preserve natural ends; we add padding for gap
    loop: false,
  });
  // Guard: ignore clicks that happen as a result of a drag/momentum scroll
  const dragGuard = useRef<{ dragging: boolean; ignoreUntil: number }>({ dragging: false, ignoreUntil: 0 });
  useEffect(() => {
    if (!emblaApi) return;
    const onPointerDown = () => { dragGuard.current.dragging = false; };
    const onScroll = () => { dragGuard.current.dragging = true; };
    const onPointerUp = () => {
      if (dragGuard.current.dragging) {
        dragGuard.current.ignoreUntil = performance.now() + 140; // small window to suppress click
      }
      dragGuard.current.dragging = false;
    };
    emblaApi.on('pointerDown', onPointerDown);
    emblaApi.on('scroll', onScroll);
    emblaApi.on('pointerUp', onPointerUp);
    return () => {
      try {
        emblaApi.off('pointerDown', onPointerDown);
        emblaApi.off('scroll', onScroll);
        emblaApi.off('pointerUp', onPointerUp);
      } catch {}
    };
  }, [emblaApi]);

  const safe = useMemo(() => {
    return (fn: () => void) => () => {
      if (performance.now() < dragGuard.current.ignoreUntil) return; // ignore click after drag
      fn();
    };
  }, []);
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
                onViewDetails={safe(() => onViewDetails(op.id))}
                onSelect={safe(() => onSelect(op.id))}
                onOpenWeapons={safe(() => onOpenWeapons?.(op.id))}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default OperativesView;
