import type { EffSku } from '../domain/types';

export type View = 'dashboard' | 'inventory' | 'orders' | 'production' | 'trends' | 'alerts' | 'reports' | 'activity' | 'team';

export interface ViewProps {
  setView: (v: View) => void;
  onEdit: (sku: EffSku) => void;
}
