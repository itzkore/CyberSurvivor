import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import React from 'react';

export function Tooltip({ children, content }: { children: React.ReactNode; content: React.ReactNode }){
  return (
    <TooltipPrimitive.Provider disableHoverableContent>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          {children as any}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content side="top" sideOffset={6} className="glass neon-border rounded-md px-3 py-2 text-xs text-white shadow-neon">
            {content}
            <TooltipPrimitive.Arrow className="fill-white/20" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export default Tooltip;
