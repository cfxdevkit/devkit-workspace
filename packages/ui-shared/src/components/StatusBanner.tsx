import { useEffect, useRef, type ReactNode } from 'react';
import { toast } from 'sonner';

type StatusTone = 'accent' | 'success' | 'error' | 'warning';

interface StatusBannerProps {
  message: ReactNode;
  tone?: StatusTone;
  className?: string;
  textClassName?: string;
}

function isProgressMessage(message: ReactNode) {
  if (typeof message !== 'string') {
    return false;
  }

  return /(ing\.\.\.|ing…|awaiting|authorizing|preparing|syncing|quoting|swapping|approving|providing|withdrawing|depositing|funding|initializing|seeding|indexing|saving|uploading|submitting|processing|querying|mempool)/i.test(message);
}

function getDuration(tone: StatusTone) {
  if (tone === 'error') return 6000;
  if (tone === 'success') return 4200;
  if (tone === 'warning') return 4600;
  return 3200;
}

export function StatusBanner({ message, tone = 'accent', className = '', textClassName = '' }: StatusBannerProps) {
  const toastIdRef = useRef(`status-${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    if (message == null || message === '') {
      toast.dismiss(toastIdRef.current);
      return;
    }

    const options = {
      id: toastIdRef.current,
      className,
      descriptionClassName: textClassName,
      duration: isProgressMessage(message) ? Infinity : getDuration(tone),
    };

    if (tone === 'success') {
      toast.success(message, options);
      return;
    }

    if (tone === 'error') {
      toast.error(message, options);
      return;
    }

    if (tone === 'warning') {
      toast.warning(message, options);
      return;
    }

    if (isProgressMessage(message)) {
      toast.loading(message, options);
      return;
    }

    toast(message, options);
  }, [className, message, textClassName, tone]);

  return null;
}