import type { Status } from './types';

/**
 * Status colour palette. These are intentional custom statuses defined in logic
 * (matching the client's Master workbook), not design-system tokens.
 */
export const STATUS_META: Record<Status, { bg: string; fg: string; accent: string }> = {
  Negative: { bg: '#f3d9d9', fg: '#8f2d2d', accent: '#a63a3a' },
  Low: { bg: '#f7e6c6', fg: '#875312', accent: '#b5852a' },
  Overstock: { bg: '#d6ebff', fg: '#2c455d', accent: '#416180' },
  'No activity': { bg: '#e7e7ea', fg: '#5d5d60', accent: '#7a7a7d' },
  OK: { bg: '#dde9dd', fg: '#39633f', accent: '#4e8055' },
};

/**
 * "Idle stock" is an insight, not a status (these SKUs stay 'OK' so counts still
 * reconcile with the workbook). Its own muted-teal colour keeps it distinct.
 */
export const IDLE_META = { bg: '#dce9e7', fg: '#35605b', accent: '#4e7d78' };

/** Ordered status list used for the "Status of every SKU" segmented bar. */
export const STATUS_ORDER: Status[] = ['OK', 'Low', 'Negative', 'Overstock', 'No activity'];

export const ALL_STATUSES: Status[] = ['Negative', 'Low', 'Overstock', 'No activity', 'OK'];
