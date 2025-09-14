import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import clsx from 'clsx';

const buttonStyles = cva(
  'inline-flex items-center justify-center rounded-md border transition-colors select-none focus:outline-none focus-visible:ring-2 ring-offset-2 ring-offset-bg disabled:opacity-60 disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        primary: 'bg-neon-cyan/20 hover:bg-neon-cyan/30 text-neon-cyan border-neon-cyan/60 shadow-neon',
        ghost: 'bg-transparent hover:bg-white/5 text-white border-white/20',
        danger: 'bg-neon-magenta/20 hover:bg-neon-magenta/30 text-neon-magenta border-neon-magenta/60',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base'
      }
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md'
    }
  }
);

export type NeonButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles>;

export function NeonButton({ className, variant, size, ...props }: NeonButtonProps){
  return (
    <button className={clsx(buttonStyles({ variant, size }), className)} {...props} />
  )
}

export default NeonButton;
