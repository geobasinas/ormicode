import { toast } from 'sonner';

export interface FeedbackAction { label: string; onClick(): void }

export const feedback = {
  success(message: string, action?: FeedbackAction) {
    toast.success(message, { duration: 3000, ...(action ? { action: { label: action.label, onClick: action.onClick } } : {}) });
  },
  error(message: string) {
    toast.error(message, { duration: 3000 });
  },
  info(message: string, action?: FeedbackAction) {
    toast(message, { duration: 3000, ...(action ? { action: { label: action.label, onClick: action.onClick } } : {}) });
  },
};
