import { Toaster } from 'sonner';

export function AppToaster() {
  return (
    <Toaster
      closeButton
      expand={false}
      position="top-right"
      richColors
      theme="dark"
      visibleToasts={5}
      toastOptions={{
        className: '!border !border-white/10 !bg-bg-secondary/95 !text-text-primary !backdrop-blur-xl',
        descriptionClassName: '!text-text-secondary',
      }}
    />
  );
}