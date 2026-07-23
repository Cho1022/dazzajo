import { AlertTriangle, Info, X } from 'lucide-react';

type MutationToastProps = {
  message?: string | null;
  variant?: 'error' | 'info';
  onClose: () => void;
};

export function MutationToast({ message, variant = 'error', onClose }: MutationToastProps) {
  if (!message) return null;

  const isError = variant === 'error';
  const tone = isError
    ? 'border-red-200 bg-red-50 text-red-800'
    : 'border-blue-200 bg-blue-50 text-blue-800';

  return (
    <div className="pointer-events-none fixed inset-x-4 top-4 z-[140] flex justify-end sm:inset-x-6">
      <div
        role={isError ? 'alert' : 'status'}
        aria-live={isError ? 'assertive' : 'polite'}
        data-testid="mutation-toast"
        className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg border p-4 shadow-product ${tone}`}
      >
        <span className="mt-0.5 shrink-0" aria-hidden="true">
          {isError ? <AlertTriangle size={18} /> : <Info size={18} />}
        </span>
        <p className="min-w-0 flex-1 break-words text-sm font-bold leading-6">{message}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="알림 닫기"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-current"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
