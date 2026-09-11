'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'normal' | 'small' | 'icon';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  outline: 'border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  danger: 'border border-red-300 bg-red-50 text-red-700 hover:bg-red-100',
};

const sizes: Record<ButtonSize, string> = {
  normal: 'min-h-10 px-4 py-2.5 text-sm',
  small: 'min-h-8 px-3 py-1.5 text-xs',
  icon: 'h-9 w-9 p-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; children: ReactNode }>(function Button({ variant = 'secondary', size = 'normal', className, children, ...props }, ref) {
  return <button {...props} ref={ref} className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className ?? ''}`}>{children}</button>;
});
