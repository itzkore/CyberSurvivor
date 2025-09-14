import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import clsx from 'clsx';

const styles = cva('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide', {
  variants: {
    rarity: {
      common: 'bg-white/5 text-white border border-white/20',
      rare: 'bg-neon-violet/15 text-neon-violet border border-neon-violet/60',
      epic: 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/60',
      legendary: 'bg-acid/15 text-acid border border-acid/60',
    }
  },
  defaultVariants: { rarity: 'common' }
});

export type RarityBadgeProps = { label?: string } & VariantProps<typeof styles>;

export function RarityBadge({ rarity, label, children }: React.PropsWithChildren<RarityBadgeProps>){
  return <span className={clsx(styles({ rarity }))}>{label || children}</span>
}

export default RarityBadge;
