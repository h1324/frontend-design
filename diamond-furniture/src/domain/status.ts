import type { Status } from './types';

/**
 * Status colour palette — ported verbatim from the prototype's STATUS_META.
 * These are intentional custom statuses defined in logic, not design-system tokens.
 */
export const STATUS_META: Record<Status, { bg: string; fg: string; accent: string }> = {
  Negative: { bg: '#f3d9d9', fg: '#8f2d2d', accent: '#a63a3a' },
  Low: { bg: '#f7e6c6', fg: '#875312', accent: '#b5852a' },
  Overstock: { bg: '#d6ebff', fg: '#2c455d', accent: '#416180' },
  'No activity': { bg: '#e7e7ea', fg: '#5d5d60', accent: '#7a7a7d' },
  OK: { bg: '#dde9dd', fg: '#39633f', accent: '#4e8055' },
  Empty: { bg: '#efefef', fg: '#9a9a9d', accent: '#b7b7ba' },
};

/** Ordered status list used for the "Status of every SKU" segmented bar. */
export const STATUS_ORDER: Status[] = ['OK', 'Low', 'Negative', 'Overstock', 'No activity', 'Empty'];

export const ALL_STATUSES: Status[] = ['Negative', 'Low', 'Overstock', 'No activity', 'OK', 'Empty'];
