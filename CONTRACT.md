# Build Contract — Coffee Shop Management System (Next.js 16)

Project root: `~/workspace/goals/cafe-shop-management-system/files/cafe-shop-nextjs`
You are one of 4 parallel module teams. **Read this whole file before writing code.**

## Stack & non-negotiables

- Next.js 16.3 App Router (`src/`), React 19, Tailwind CSS v4 (class-based dark mode via `.dark`).
- Prisma + SQLite (dev). Import DB via `import { prisma } from "@/lib/db"`. **Never edit `prisma/schema.prisma`.**
- Auth: `requireUser()` / `requireRole(...roles)` from `@/lib/session` at the top of every
  server action. Roles: `owner > manager > cashier > barista` (rank 4/3/2/1).
- **Pages are client components** (`"use client"`) at `src/app/(app)/<module>/page.tsx`.
  Use `useLang()` from `@/lib/i18n/provider` for ALL user-facing strings (instant toggle, no reload).
  Wrap any `useSearchParams()` usage in `<Suspense>`.
- **Mutations AND reads go through Server Actions** in `src/app/actions/<module>.ts`
  (`"use server"` at top). Validate every input with zod `safeParse`.
  Return the shared `ActionResult<T>` envelope from `@/lib/action-result`
  (`{ ok: true, data }` / `{ ok: false, error, fieldErrors? }`) using the
  `ok()` / `okVoid()` / `fail()` / `zodFail()` helpers. Never expose prisma to client.
  Log sensitive ops with `logAudit()` from `@/lib/audit`.
- UI kit ONLY: `@/components/ui/*` (Button, Input/Textarea/Label/Select, Card/CardHeader/CardTitle/CardContent,
  Table/THead/TBody/TR/TH/TD, Dialog, Badge, Skeleton). `cn` from `@/lib/cn`.
- Money: integer Ks. Format with `formatKs()` from `@/lib/format`.
  Dates: `formatDateTime(d, lang)` / `formatDate(d, lang)`, `yangonDayStart()` from `@/lib/format`.
- Names: `useDisplayName()` hook → `dn(name, nameMy)`.
- i18n: create `src/lib/i18n/<module>.ts` exporting
  `export const my: Record<string,string>` and `export const en: Record<string,string>`,
  keys prefixed by module (`pos.*`, `kds.*`…). **Do NOT edit `src/lib/i18n/dictionaries.ts`** —
  the coordinator registers your file.
- Validations: shared primitives in `@/lib/validators`
  (`mmkSchema`, `pinSchema`, `mmPhoneSchema`, `roleSchema`, `paginationSchema`,
  `dateRangeSchema`, `orderItemSchema`, `createOrderSchema`, `paymentSchema`).
  Module-specific schemas live in `src/lib/validations/<module>.ts` (zod, shared by
  actions; react-hook-form + `@hookform/resolvers/zod` for forms).
- PIN hashing: `hashPin`/`verifyPin` from `@/lib/session` (re-exported) or the
  dependency-free `@/lib/pin` (safe for scripts/seed).
- Every query filters by the user's `branchId`. No cross-branch leaks.
- Status fields are plain strings (no Prisma enums). Follow the schema's documented values.

## Shared helpers you MUST use (don't reinvent)

- `@/lib/orders`: `computeTotals(lines, {discountType, discountValue, taxRate, taxInclusive, serviceKs, deliveryFeeKs})`,
  `lineTotalFor(cartLine)`, `nextOrderNumber(branchId)`, `nextQueueNumber(branchId)`,
  `deductInventory(db, orderId, items, userId)`, `checkLowStock(branchId, ingredientId)`
- `@/lib/settings`: `getSetting/getBranchSettings/setSetting`
- `@/lib/format`: `formatKs, parseKs, formatDateTime, formatDate, normalizeMmPhone, yangonDayStart, yangonDateKey`
- `@/lib/session`: `requireUser, requireRole, hashPin, verifyPin`
- `@/lib/audit`: `logAudit`

## Order lifecycle contract (all teams)

Statuses: `open → held → fired → preparing → ready → completed`, plus `voided`.
`OrderItem.kdsStatus`: `queued → fired → preparing → ready → bumped` (+ `recalled`).
- **Inventory is deducted exactly once, when an order becomes `completed`.**
  Guard: skip if a `StockMovement` with `reference = "order:<orderId>"` already exists.
- Refunds do NOT restock. Voids before completion deduct nothing.
- Discounts: percent > 20 or fixed > 10,000 Ks need a manager+ approver → store `discountApprovedBy`.
- Voids/refunds > 20,000 Ks need manager+ approval → `Refund.approvedById`. Provide a
  `verifyManagerPin(pin)` action (checks PIN of any active manager/owner in the branch).
- Dine-in order created on a table → table `occupied`. Table → `free` when its last open order
  closes/voids. `cleaning` is set manually.
- Loyalty on completion: customer `stamps+1`, `points += floor(totalKs/pointsPerKs)`,
  `visitCount+1`, `totalSpendKs += totalKs`.
- Payments: `method ∈ cash|kbzpay|wavepay|ayapay|onepay|mab|card`. Split payments = multiple Payment rows.
  Cash: denominations 1000/5000/10000/20000 quick keys; `changeKs = paidKs - totalKs`.

## File ownership (do not touch other teams' files)

- **Team A (POS/Orders/KDS)**: `src/app/actions/{pos,kds,orders}.ts`,
  `src/app/(app)/{pos,orders,kds}/page.tsx`, `src/components/pos/*`,
  `src/lib/i18n/{pos,kds,orders}.ts`, `src/lib/validations/{pos,kds,orders}.ts`
- **Team B (Tables/Menu/Customers)**: `src/app/actions/{tables,menu,customers}.ts`,
  `src/app/(app)/{tables,menu,customers}/page.tsx`,
  `src/lib/i18n/{tables,menu,customers}.ts`, `src/lib/validations/{tables,menu,customers}.ts`
- **Team C (Inventory/Staff/Reports)**: `src/app/actions/{inventory,staff,reports}.ts`,
  `src/app/(app)/{inventory,staff,reports}/page.tsx`,
  `src/lib/i18n/{inventory,staff,reports}.ts`, `src/lib/validations/{inventory,staff,reports}.ts`
- **Team D (Dashboard/Settings/Online/Webhooks)**: `src/app/actions/{dashboard,settings}.ts`,
  `src/app/(app)/{dashboard,settings}/page.tsx`, `src/app/online/page.tsx`,
  `src/app/api/webhooks/kbzpay/route.ts`, `src/app/api/webhooks/wavepay/route.ts`,
  `src/lib/sms.ts`, `public/manifest.json`,
  `src/lib/i18n/{dashboard,settings,online}.ts`, `src/lib/validations/{dashboard,settings}.ts`

Shared files (owned by coordinator — read-only for teams):
`src/lib/{db,session,auth,auth-client,settings,orders,audit,format,cn}.ts`,
`src/components/ui/*`, `src/components/layout/*`, `src/lib/i18n/{common,provider,dictionaries,server}.ts`,
`src/proxy.ts`, `src/app/layout.tsx`, `prisma/*`.

## UX requirements

- Bilingual EVERYTHING (Burma-first default). Touch-friendly POS (min 56px targets).
- Loading states: `Skeleton`. Empty states: `t("common.noData")`.
- Burmese text: add `my-text` class where long Myanmar strings render.
- Dark mode must look right (use theme vars, no hardcoded white/black).
- `window.print()` receipts use the `.receipt-print` CSS class (already in globals.css).

## Definition of done per team

1. All listed pages render without console errors; all actions validate + enforce RBAC + audit.
2. `npx tsc --noEmit` passes for your files (run from project root).
3. Report back: files created, actions exposed (names + signatures), anything you stubbed.
