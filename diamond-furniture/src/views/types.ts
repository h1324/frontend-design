import type { EffSku } from '../domain/types';

export type View = 'dashboard' | 'inventory' | 'production' | 'alerts' | 'reports' | 'activity';

export interface ViewProps {
  setView: (v: View) => void;
  onEdit: (sku: EffSku) => void;
}
