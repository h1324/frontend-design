// app/m/idb.ts — the device-side offline store for the field-orders PWA (spec S27).
// Two IndexedDB object stores: a durable order queue (keyed by the idempotency key so a retried
// sync is safe) and a per-customer catalogue cache so a rep can keep working with no signal.
// Browser-only — call from client effects/handlers, never on the server.

export interface QueuedLine {
  itemId: string;
  code: string;
  name: string;
  uom: string;
  qtyOrdered: string;
  devicePricePaise: string | null;
}
export interface QueuedOrder {
  clientRequestId: string;
  customerId: string;
  customerName: string;
  shipToId: string;
  shipToLabel: string;
  lines: QueuedLine[];
  capturedAt: string;
  status: "pending" | "synced" | "failed";
  message?: string;
  soId?: string | null;
  soStatus?: string | null;
  creditStatus?: string | null;
  priceDelta?: { itemId: string; devicePricePaise: string; serverPricePaise: string }[];
}

// A cached catalogue is stored verbatim as returned by the server; typed loosely here to avoid
// importing server types into the browser bundle.
export interface CachedCatalogue {
  customerId: string;
  [k: string]: unknown;
}

const DB_NAME = "epe-mobile";
const DB_VERSION = 1;
const QUEUE = "queue";
const CATALOGUES = "catalogues";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE)) {
        db.createObjectStore(QUEUE, { keyPath: "clientRequestId" });
      }
      if (!db.objectStoreNames.contains(CATALOGUES)) {
        db.createObjectStore(CATALOGUES, { keyPath: "customerId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function putOrder(order: QueuedOrder): Promise<IDBValidKey> {
  return tx(QUEUE, "readwrite", (s) => s.put(order));
}
export function allOrders(): Promise<QueuedOrder[]> {
  return tx<QueuedOrder[]>(
    QUEUE,
    "readonly",
    (s) => s.getAll() as IDBRequest<QueuedOrder[]>,
  );
}
export function deleteOrder(clientRequestId: string): Promise<undefined> {
  return tx(QUEUE, "readwrite", (s) => s.delete(clientRequestId));
}
export function putCatalogue(cat: CachedCatalogue): Promise<IDBValidKey> {
  return tx(CATALOGUES, "readwrite", (s) => s.put(cat));
}
export function getCatalogue(customerId: string): Promise<CachedCatalogue | undefined> {
  return tx<CachedCatalogue | undefined>(
    CATALOGUES,
    "readonly",
    (s) => s.get(customerId) as IDBRequest<CachedCatalogue | undefined>,
  );
}
