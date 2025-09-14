import React from 'react';

export function StatChip({ icon, label, value, hint }: { icon?: React.ReactNode; label: string; value: string | number; hint?: string }){
  const title = hint ? `${label}: ${hint}` : label;
  return (
    <div className="flex items-center gap-2 rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-xs" title={title} aria-label={title}>
      {icon && <span aria-hidden>{icon}</span>}
      <span className="text-white/70">{label}</span>
      <span className="ml-auto font-semibold text-white">{value}</span>
    </div>
  );
}

export default StatChip;
