import React from 'react';

type Props = React.PropsWithChildren<{ className?: string; style?: React.CSSProperties; ariaLabel?: string }>

export function HoloPanel({ children, className = '', style, ariaLabel }: Props){
  return (
    <section
      role="region"
      aria-label={ariaLabel}
      className={`relative holo glass neon-border rounded-xl p-4 md:p-6 ${className}`}
      style={style}
    >
      <div className="absolute inset-0 scanlines pointer-events-none" aria-hidden="true" />
      {children}
    </section>
  );
}

export default HoloPanel;
