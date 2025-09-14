import React from 'react';

export function AbilityIcon({ src, alt }: { src: string; alt: string }){
  return (
    <div className="relative inline-flex h-12 w-12 items-center justify-center rounded-md border border-neon-cyan/60 bg-black/40 shadow-neon">
      <img src={src} alt={alt} className="h-10 w-10 object-contain" loading="lazy" />
    </div>
  );
}

export default AbilityIcon;
