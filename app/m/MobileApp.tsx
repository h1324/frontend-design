"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MobileCatalogue, CatalogueLine } from "@/lib/mobile/mobile";
import { loadCatalogueAction, submitMobileOrderAction } from "./actions";
import { allOrders, putOrder, putCatalogue, getCatalogue, type QueuedOrder } from "./idb";

interface CustomerLite {
  id: string;
  code: string;
  name: string;
  tier: string;
}

function rupees(paise: string | null): string {
  if (paise == null) return "—";
  return `₹${(Number(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

const statusChip: Record<QueuedOrder["status"], string> = {
  pending: "bg-amber-100 text-amber-900",
  synced: "bg-emerald-100 text-emerald-900",
  failed: "bg-red-100 text-red-900",
};

export function MobileApp({ customers }: { customers: CustomerLite[] }) {
  const [online, setOnline] = useState(true);
  const [customerId, setCustomerId] = useState("");
  const [catalogue, setCatalogue] = useState<MobileCatalogue | null>(null);
  const [shipToId, setShipToId] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [queue, setQueue] = useState<QueuedOrder[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingCat, setLoadingCat] = useState(false);

  const customer = customers.find((c) => c.id === customerId) ?? null;

  const refreshQueue = useCallback(async () => {
    try {
      const rows = await allOrders();
      rows.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
      setQueue(rows);
    } catch {
      /* IDB unavailable — queue view stays empty */
    }
  }, []);

  const syncOne = useCallback(
    async (order: QueuedOrder) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      try {
        const res = await submitMobileOrderAction({
          clientRequestId: order.clientRequestId,
          customerId: order.customerId,
          shipToId: order.shipToId,
          capturedAt: order.capturedAt,
          lines: order.lines.map((l) => ({
            itemId: l.itemId,
            qtyOrdered: l.qtyOrdered,
            uom: l.uom,
            devicePricePaise: l.devicePricePaise,
          })),
        });
        const next: QueuedOrder = res.ok
          ? {
              ...order,
              status: "synced",
              soId: res.result.soId,
              soStatus: res.result.soStatus,
              creditStatus: res.result.creditStatus,
              priceDelta: res.result.priceDelta,
              message: undefined,
            }
          : { ...order, status: "failed", message: res.error };
        await putOrder(next);
      } catch {
        // transport failure — leave it pending so it retries when back online
        await putOrder({ ...order, status: "pending" });
      }
      await refreshQueue();
    },
    [refreshQueue],
  );

  const syncAll = useCallback(async () => {
    const rows = await allOrders();
    for (const o of rows) {
      if (o.status !== "synced") await syncOne(o);
    }
  }, [syncOne]);

  useEffect(() => {
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    const goOnline = () => {
      setOnline(true);
      void syncAll();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    void refreshQueue().then(() => {
      if (navigator.onLine) void syncAll();
    });
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [refreshQueue, syncAll]);

  const selectCustomer = useCallback(async (id: string) => {
    setCustomerId(id);
    setCatalogue(null);
    setShipToId("");
    setQty({});
    setNotice(null);
    if (!id) return;
    setLoadingCat(true);
    try {
      if (navigator.onLine) {
        const res = await loadCatalogueAction(id);
        if (res.ok) {
          setCatalogue(res.catalogue);
          setShipToId(
            res.catalogue.shipTos.find((s) => s.isDefault)?.id ??
              res.catalogue.shipTos[0]?.id ??
              "",
          );
          await putCatalogue(res.catalogue as unknown as { customerId: string });
        } else {
          setNotice(res.error);
        }
      } else {
        const cached = (await getCatalogue(id)) as unknown as MobileCatalogue | undefined;
        if (cached) {
          setCatalogue(cached);
          setShipToId(
            cached.shipTos.find((s) => s.isDefault)?.id ?? cached.shipTos[0]?.id ?? "",
          );
          setNotice(
            `Offline — showing catalogue cached ${new Date(cached.pricedAsOf).toLocaleString("en-GB")}`,
          );
        } else {
          setNotice("Offline and no cached catalogue for this customer yet.");
        }
      }
    } finally {
      setLoadingCat(false);
    }
  }, []);

  const cartLines = useMemo(() => {
    if (!catalogue) return [] as { line: CatalogueLine; qty: string }[];
    return catalogue.lines
      .map((line) => ({ line, qty: (qty[line.itemId] ?? "").trim() }))
      .filter((r) => r.qty !== "" && Number(r.qty) > 0);
  }, [catalogue, qty]);

  const cartTotalPaise = useMemo(
    () =>
      cartLines.reduce(
        (s, r) => s + (r.line.ratePaise ? Number(r.qty) * Number(r.line.ratePaise) : 0),
        0,
      ),
    [cartLines],
  );

  const captureOrder = useCallback(async () => {
    if (!catalogue || !customer) return;
    if (!shipToId) {
      setNotice("Pick a ship-to first.");
      return;
    }
    if (cartLines.length === 0) {
      setNotice("Add a quantity to at least one item.");
      return;
    }
    const shipToLabel = catalogue.shipTos.find((s) => s.id === shipToId)?.label ?? "";
    const order: QueuedOrder = {
      clientRequestId:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `crq-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      customerId: customer.id,
      customerName: customer.name,
      shipToId,
      shipToLabel,
      capturedAt: new Date().toISOString(),
      status: "pending",
      lines: cartLines.map((r) => ({
        itemId: r.line.itemId,
        code: r.line.code,
        name: r.line.name,
        uom: r.line.uomBase,
        qtyOrdered: r.qty,
        devicePricePaise: r.line.ratePaise,
      })),
    };
    await putOrder(order);
    setQty({});
    setNotice(`Captured — ${online ? "syncing…" : "will sync when back online"}`);
    await refreshQueue();
    await syncOne(order);
  }, [catalogue, customer, shipToId, cartLines, online, refreshQueue, syncOne]);

  const pendingCount = queue.filter((q) => q.status !== "synced").length;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 bg-slate-50 px-4 py-6 text-slate-900">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500">EPE Foam · Field orders</p>
          <h1 className="text-lg font-semibold">Take an order</h1>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            online ? "bg-emerald-100 text-emerald-900" : "bg-slate-200 text-slate-700"
          }`}
        >
          {online ? "Online" : "Offline"}
        </span>
      </header>

      {notice ? (
        <p className="rounded-md bg-slate-200/70 px-3 py-2 text-xs text-slate-800">
          {notice}
        </p>
      ) : null}

      <section className="flex flex-col gap-2 rounded-lg bg-white p-3 shadow-sm">
        <label className="text-xs font-medium text-slate-600">Customer</label>
        <select
          value={customerId}
          onChange={(e) => void selectCustomer(e.target.value)}
          className="h-11 rounded-md border border-slate-300 bg-white px-2 text-sm"
        >
          <option value="">Select a customer…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.name} ({c.tier})
            </option>
          ))}
        </select>

        {catalogue ? (
          <>
            <label className="mt-1 text-xs font-medium text-slate-600">Ship-to</label>
            <select
              value={shipToId}
              onChange={(e) => setShipToId(e.target.value)}
              className="h-11 rounded-md border border-slate-300 bg-white px-2 text-sm"
            >
              {catalogue.shipTos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                  {s.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </section>

      {loadingCat ? <p className="text-sm text-slate-500">Loading catalogue…</p> : null}

      {catalogue ? (
        <section className="flex flex-col gap-2 rounded-lg bg-white p-3 shadow-sm">
          <h2 className="text-sm font-semibold">Catalogue</h2>
          <p className="text-xs text-slate-500">
            Prices are the last cached contract/list price. The server re-prices on sync —
            it wins if they differ.
          </p>
          <ul className="flex flex-col divide-y">
            {catalogue.lines.map((line) => (
              <li key={line.itemId} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{line.name}</p>
                  <p className="text-xs text-slate-500">
                    {line.code} · {rupees(line.ratePaise)}/{line.uomBase}
                    {line.priceSource
                      ? ` · ${line.priceSource.toLowerCase()}`
                      : " · no price"}
                  </p>
                </div>
                <input
                  inputMode="decimal"
                  placeholder="qty"
                  value={qty[line.itemId] ?? ""}
                  onChange={(e) =>
                    setQty((q) => ({ ...q, [line.itemId]: e.target.value }))
                  }
                  className="h-11 w-20 rounded-md border border-slate-300 px-2 text-right text-sm"
                />
              </li>
            ))}
          </ul>

          <div className="mt-1 flex items-center justify-between border-t pt-3">
            <span className="text-sm text-slate-600">
              {cartLines.length} line{cartLines.length === 1 ? "" : "s"} ·{" "}
              <span className="font-semibold tabular-nums">
                {rupees(String(cartTotalPaise))}
              </span>
            </span>
            <button
              onClick={() => void captureOrder()}
              disabled={cartLines.length === 0}
              className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Capture order
            </button>
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-2 rounded-lg bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Sync queue</h2>
          <button
            onClick={() => void syncAll()}
            disabled={!online || pendingCount === 0}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          >
            Sync now ({pendingCount})
          </button>
        </div>
        {queue.length === 0 ? (
          <p className="py-3 text-center text-xs text-slate-500">
            No captured orders yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {queue.map((o) => (
              <li key={o.clientRequestId} className="flex flex-col gap-1 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{o.customerName}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusChip[o.status]}`}
                  >
                    {o.status}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {o.lines.length} line{o.lines.length === 1 ? "" : "s"} ·{" "}
                  {new Date(o.capturedAt).toLocaleString("en-GB")}
                </p>
                {o.status === "synced" ? (
                  <p className="text-xs text-emerald-800">
                    SO {o.soStatus}
                    {o.creditStatus === "BLOCKED"
                      ? " · credit blocked (needs override)"
                      : ""}
                    {o.priceDelta && o.priceDelta.length > 0
                      ? ` · ${o.priceDelta.length} price change${o.priceDelta.length === 1 ? "" : "s"} on sync`
                      : ""}
                  </p>
                ) : null}
                {o.status === "failed" ? (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-red-800">{o.message}</p>
                    <button
                      onClick={() => void syncOne(o)}
                      disabled={!online}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
                    >
                      Retry
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
