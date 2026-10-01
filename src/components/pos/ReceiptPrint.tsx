"use client";

import { formatKs, formatDateTime } from "@/lib/format";
import { useLang } from "@/lib/i18n/provider";

export type ReceiptOrder = {
  orderNumber: string;
  queueNumber: number | null;
  type: string;
  createdAt: string | Date;
  customerName: string | null;
  table?: { label: string } | null;
  subtotalKs: number;
  discountKs: number;
  taxKs: number;
  serviceKs: number;
  deliveryFeeKs: number;
  totalKs: number;
  paidKs: number;
  changeKs: number;
  items: Array<{
    name: string;
    nameMy: string | null;
    quantity: number;
    unitPriceKs: number;
    modifiersJson: string;
    modifiersTotalKs: number;
    lineTotalKs: number;
    notes: string | null;
  }>;
  payments: Array<{ method: string; amountKs: number; reference: string | null }>;
};

export type ReceiptBranch = {
  name: string;
  nameMy: string | null;
  address: string | null;
  addressMy: string | null;
  phone: string | null;
} | null;

export type ReceiptSettings = {
  receiptHeader: string[];
  receiptFooter: string[];
  taxId: string;
};

/** Printable receipt. Parent triggers via window.print(). */
export function ReceiptPrint({
  order,
  branch,
  settings,
  cashierName,
}: {
  order: ReceiptOrder;
  branch: ReceiptBranch;
  settings: ReceiptSettings;
  cashierName?: string;
}) {
  const { lang } = useLang();
  const created = typeof order.createdAt === "string" ? order.createdAt : order.createdAt.toISOString();
  return (
    <div className="receipt-print bg-white text-black p-4 text-sm max-w-[320px] mx-auto">
      {settings.receiptHeader.map((l, i) => (
        <p key={i} className="text-center text-xs">{l}</p>
      ))}
      <h3 className="text-center font-bold text-base my-text">
        {lang === "my" ? branch?.nameMy || branch?.name : branch?.name}
      </h3>
      {(lang === "my" ? branch?.addressMy || branch?.address : branch?.address) && (
        <p className="text-center text-xs my-text">{lang === "my" ? branch?.addressMy || branch?.address : branch?.address}</p>
      )}
      {branch?.phone && <p className="text-center text-xs">{branch.phone}</p>}
      {settings.taxId && <p className="text-center text-xs">Tax ID: {settings.taxId}</p>}
      <hr className="border-dashed border-black/40 my-2" />
      <div className="flex justify-between text-xs">
        <span>#{order.orderNumber}</span>
        <span>{formatDateTime(created, lang)}</span>
      </div>
      <div className="flex justify-between text-xs">
        <span>{order.type}</span>
        {order.queueNumber != null && <span>Q: {order.queueNumber}</span>}
      </div>
      {order.table && <p className="text-xs">Table: {order.table.label}</p>}
      {order.customerName && <p className="text-xs my-text">{order.customerName}</p>}
      {cashierName && <p className="text-xs">Cashier: {cashierName}</p>}
      <hr className="border-dashed border-black/40 my-2" />
      {order.items.map((it, i) => (
        <div key={i} className="mb-1">
          <div className="flex justify-between">
            <span className="my-text">{it.quantity}x {lang === "my" ? it.nameMy || it.name : it.name}</span>
            <span>{formatKs(it.lineTotalKs)}</span>
          </div>
          {modifiersLabel(it.modifiersJson) && (
            <p className="text-xs text-black/70 pl-4 my-text">+ {modifiersLabel(it.modifiersJson)}</p>
          )}
          {it.notes && <p className="text-xs text-black/70 pl-4 my-text">{it.notes}</p>}
        </div>
      ))}
      <hr className="border-dashed border-black/40 my-2" />
      <div className="flex justify-between text-xs"><span>Subtotal</span><span>{formatKs(order.subtotalKs)}</span></div>
      {order.discountKs > 0 && (
        <div className="flex justify-between text-xs"><span>Discount</span><span>-{formatKs(order.discountKs)}</span></div>
      )}
      {order.taxKs > 0 && (
        <div className="flex justify-between text-xs"><span>Tax</span><span>{formatKs(order.taxKs)}</span></div>
      )}
      {order.serviceKs > 0 && (
        <div className="flex justify-between text-xs"><span>Service</span><span>{formatKs(order.serviceKs)}</span></div>
      )}
      {order.deliveryFeeKs > 0 && (
        <div className="flex justify-between text-xs"><span>Delivery</span><span>{formatKs(order.deliveryFeeKs)}</span></div>
      )}
      <div className="flex justify-between font-bold text-base">
        <span>Total</span><span>{formatKs(order.totalKs)}</span>
      </div>
      {order.payments.map((p, i) => (
        <div key={i} className="flex justify-between text-xs">
          <span>{p.method}{p.reference ? ` (${p.reference})` : ""}</span>
          <span>{formatKs(p.amountKs)}</span>
        </div>
      ))}
      {order.changeKs > 0 && (
        <div className="flex justify-between text-xs"><span>Change</span><span>{formatKs(order.changeKs)}</span></div>
      )}
      <hr className="border-dashed border-black/40 my-2" />
      {settings.receiptFooter.map((l, i) => (
        <p key={i} className="text-center text-xs my-text">{l}</p>
      ))}
      <p className="text-center text-xs mt-1">*** {lang === "my" ? "ကျေးဇူးတင်ပါတယ်" : "Thank you"} ***</p>
    </div>
  );
}

function modifiersLabel(json: string): string {
  try {
    const arr = JSON.parse(json) as Array<{ option?: string; delta?: number }>;
    if (!Array.isArray(arr) || !arr.length) return "";
    return arr.map((m) => m.option).filter(Boolean).join(", ");
  } catch {
    return "";
  }
}
