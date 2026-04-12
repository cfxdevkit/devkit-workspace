import type { ReactNode } from 'react';

type StatusTone = 'accent' | 'success' | 'error' | 'warning';

interface StatusBannerProps {
  message: ReactNode;
  tone?: StatusTone;
  className?: string;
  textClassName?: string;
}

const TONE_CLASSES: Record<StatusTone, { container: string; dot: string }> = {
  accent: {
    container: 'border-accent/10 bg-accent/5 text-accent',
    dot: 'bg-accent animate-pulse shadow-[0_0_8px_currentColor]',
  },
  success: {
    container: 'border-success/10 bg-success/5 text-success',
    dot: 'bg-success shadow-[0_0_8px_currentColor]',
  },
  error: {
    container: 'border-error/10 bg-error/5 text-error',
    dot: 'bg-error',
  },
  warning: {
    container: 'border-warning/10 bg-warning/5 text-warning',
    dot: 'bg-warning shadow-[0_0_8px_currentColor]',
  },
};

export function StatusBanner({ message, tone = 'accent', className = '', textClassName = '' }: StatusBannerProps) {
  const palette = TONE_CLASSES[tone];

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 animate-fade-in ${palette.container} ${className}`}>
      <div className={`h-1.5 w-1.5 rounded-full ${palette.dot}`} />
      <p className={`text-[9px] font-black uppercase tracking-[0.15em] ${textClassName}`}>{message}</p>
    </div>
  );
}