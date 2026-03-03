# FulfillHub — MVP Specification

> **Shopify Dropshipping/Fulfillment Platform: Turkey → GCC**
> Version: 1.0-MVP | Date: 2026-03-01

---

## 1. MVP SPECIFICATION

### 1.1 Assumptions & Defaults

| Decision | Default |
|---|---|
| Stack | Remix (Shopify template) + Prisma + PostgreSQL |
| Hosting | Any Node host (Railway / Render / VPS); DB on managed Postgres |
| Auth – Sellers | Shopify OAuth (embedded app) |
| Auth – Admin | Email/password with bcrypt + JWT, protected by middleware |
| Billing model (MVP) | Prepaid wallet; seller tops up, each order deducts |
| Currency | USD internally; display currency configurable per seller |
| Default carrier rules | KSA → SMSA; all other GCC → Aramex |
| Catalog scope | ≤500 curated SKUs at launch |
| Trendyol | Internal reference only; sellers submit links via "Request Product" |

### 1.2 User Stories

#### Seller (Shopify Store Owner)

| # | Story |
|---|---|
| S1 | As a seller, I install the FulfillHub app from Shopify so that my store is connected. |
| S2 | As a seller, I browse the curated catalog and import products to my Shopify store with one click. |
| S3 | As a seller, I see my orders (auto-captured via webhook) and their fulfillment status pipeline. |
| S4 | As a seller, I see tracking numbers and confirmation that tracking was pushed to Shopify. |
| S5 | As a seller, I top up my wallet balance so orders can be processed. |
| S6 | As a seller, I submit a Trendyol link to request a product be added to the catalog. |
| S7 | As a seller, I configure private-label packaging options (insert cards, branded box). |
| S8 | As a seller, I view billing history (deductions, top-ups, invoices). |

#### Admin (Internal Ops)

| # | Story |
|---|---|
| A1 | As an admin, I manage the curated catalog (add/edit/disable products, set pricing, eligibility). |
| A2 | As an admin, I review and approve/reject product requests from sellers. |
| A3 | As an admin, I see all incoming orders and route them through the status pipeline. |
| A4 | As an admin, I manage the packing workflow (pick list, QC checklist, packing slip with private-label info). |
| A5 | As an admin, I create shipments with Aramex or SMSA (API or manual tracking entry). |
| A6 | As an admin, I push tracking info to Shopify fulfillments. |
| A7 | As an admin, I manage seller accounts, view balances, adjust wallets. |
| A8 | As an admin, I handle exceptions: out-of-stock, cancellations, address errors, returns. |
| A9 | As an admin, I view analytics: orders/day, revenue, top SKUs, fulfillment SLA. |

### 1.3 Core Features (MVP)

1. **Shopify OAuth + Embedded App** — install flow, session tokens, App Bridge
2. **Curated Catalog** — CRUD, country eligibility, stock type, cost/price, images
3. **Product Import to Shopify** — create Shopify product via Admin API from catalog item
4. **Order Ingestion** — `orders/paid` webhook → internal order creation, SKU mapping
5. **Order Status Pipeline** — Processing → Purchased → Packed → Shipped → Delivered/Exception/Returned
6. **Shipment Creation** — Aramex/SMSA API integration (with manual fallback)
7. **Tracking Push to Shopify** — create/update fulfillment with tracking via Fulfillment API
8. **Seller Wallet** — balance, top-up (manual in MVP), per-order deduction
9. **Product Request Workflow** — seller submits Trendyol link, admin approves/rejects
10. **Admin Dashboard** — full ops control
11. **Seller Dashboard** — embedded Shopify Polaris UI
12. **Idempotent Webhook Processing** — dedup by Shopify webhook ID
13. **Multi-tenant Isolation** — all queries scoped by `sellerId`
14. **Audit Log** — key actions logged with actor, timestamp, details

### 1.4 Non-Goals (MVP)

- Automated Trendyol scraping or price syncing
- Real-time carrier tracking polling (design for it, don't build it)
- Subscription billing (Shopify Billing API); use simple wallet instead
- Multi-warehouse support
- Returns portal for end-customers
- Mobile app
- Automated purchase orders to Turkish suppliers
- Analytics beyond basic counts/charts

### 1.5 Edge Cases & Operational Issues

| Scenario | Handling |
|---|---|
| **Out-of-stock after order** | Admin marks line item as "Exception:OOS"; seller notified; can cancel or wait for restock. |
| **Partial shipment** | Support multiple shipments per order. Each shipment → separate Shopify fulfillment. |
| **Address error** | Admin flags order as "Exception:Address"; seller must update via Shopify; webhook picks up change. |
| **Cancellation** | Admin cancels internal order; refunds wallet; does NOT cancel Shopify order (seller handles that). |
| **Return** | Admin creates return record; inventory adjusted; wallet credit if applicable. |
| **Duplicate webhook** | Store `shopifyWebhookId` in `webhook_log`; skip if already processed. |
| **Insufficient wallet balance** | Order created but held in "PendingPayment" status until topped up. |
| **Carrier API down** | Fallback to manual tracking entry; admin enters tracking number + carrier. |
| **Multiple packages** | Each package = 1 shipment record = 1 fulfillment push. |
| **Product delisted** | Soft-delete (status=inactive); existing orders still reference it; no new imports. |

---

## 2. SYSTEM ARCHITECTURE

### 2.1 Components

```
┌─────────────────────────────────────────────────────┐
│                    CLIENTS                           │
│  ┌──────────────┐     ┌──────────────────────────┐  │
│  │ Admin SPA    │     │ Seller Embedded App      │  │
│  │ (React)      │     │ (Remix + Polaris)        │  │
│  └──────┬───────┘     └────────────┬─────────────┘  │
│         │                          │                 │
└─────────┼──────────────────────────┼─────────────────┘
          │                          │
          ▼                          ▼
┌─────────────────────────────────────────────────────┐
│              APPLICATION SERVER (Remix)              │
│                                                      │
│  ┌────────┐ ┌──────────┐ ┌────────┐ ┌───────────┐  │
│  │Shopify │ │ Catalog  │ │ Order  │ │ Shipping  │  │
│  │Auth &  │ │ Service  │ │Service │ │ Service   │  │
│  │Webhook │ │          │ │        │ │           │  │
│  └────────┘ └──────────┘ └────────┘ └───────────┘  │
│  ┌────────┐ ┌──────────┐ ┌────────┐ ┌───────────┐  │
│  │Billing │ │ Product  │ │ Admin  │ │ Audit     │  │
│  │Service │ │ Request  │ │ Auth   │ │ Logger    │  │
│  └────────┘ └──────────┘ └────────┘ └───────────┘  │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│               PostgreSQL Database                    │
│  (Prisma ORM — all tables below)                    │
└─────────────────────────────────────────────────────┘
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ Shopify  │ │ Aramex   │ │ SMSA     │
   │ Admin API│ │ API      │ │ API      │
   └──────────┘ └──────────┘ └──────────┘
```

### 2.2 Permissions Model

| Role | Scope | Access |
|---|---|---|
| `SUPER_ADMIN` | Global | All operations, all sellers |
| `ADMIN` | Global | Ops: orders, packing, shipping, catalog. No billing config. |
| `WAREHOUSE` | Global | Packing workflow, shipment creation only |
| `SELLER` | Own data only | Catalog browse, own orders, own wallet, own settings |

Enforcement:
- Seller routes: `sellerId` extracted from Shopify session token; all DB queries filtered by `sellerId`.
- Admin routes: JWT middleware checks role; role-based access on each endpoint.

### 2.3 Event Flow — Order Lifecycle

```
Shopify (orders/paid webhook)
  │
  ▼
[Webhook Handler] ──→ Dedup check (webhook_log)
  │                        │ (duplicate → 200 OK, skip)
  ▼
[Order Service]
  ├─ Create internal Order (status: PROCESSING)
  ├─ Map each line item → internal SKU (via shopifyVariantId → catalog_product_variant)
  ├─ Check seller wallet balance
  │    ├─ Sufficient → Deduct, continue
  │    └─ Insufficient → status: PENDING_PAYMENT, notify seller
  └─ Save to DB
  │
  ▼
[Admin Dashboard — Order Queue]
  │
  ▼ (admin action: confirm purchase / allocate stock)
[Order status → PURCHASED / ALLOCATED]
  │
  ▼ (warehouse: pack)
[Packing Workflow]
  ├─ Print packing slip (with private-label info)
  ├─ QC checklist
  └─ Mark as PACKED
  │
  ▼ (admin/warehouse: ship)
[Shipping Service]
  ├─ Determine carrier (country rules or manual override)
  ├─ Call Aramex/SMSA API → get tracking number + label
  │    └─ (fallback: admin enters tracking manually)
  ├─ Create Shipment record (status: SHIPPED)
  └─ Push tracking to Shopify:
       POST fulfillments.json → fulfillment with tracking_number,
       tracking_company, tracking_url
  │
  ▼
[Order status → SHIPPED]
  │
  ▼ (future: carrier tracking webhook/poll)
[DELIVERED / EXCEPTION / RETURNED]
```

---

## 3. SHOPIFY SPECIFICS

### 3.1 Required OAuth Scopes

```
read_products, write_products        — import catalog items as Shopify products
read_orders, write_orders            — read order data
read_fulfillments, write_fulfillments — create fulfillments with tracking
read_shipping                        — read shipping zones/rates
read_customers                       — access customer address for shipping
```

### 3.2 Webhooks to Register

| Webhook Topic | Purpose |
|---|---|
| `orders/paid` | Trigger internal order creation |
| `orders/updated` | Detect address changes, cancellations |
| `orders/cancelled` | Handle Shopify-side cancellations |
| `app/uninstalled` | Clean up seller session, mark inactive |
| `products/update` | Sync if seller edits imported product |
| `products/delete` | Track if seller deletes imported product |

### 3.3 Fulfillment Creation Flow (Shopify 2024-01+ API)

Shopify has moved to **FulfillmentOrder-based fulfillment**. The correct flow:

```
Step 1: GET /admin/api/2024-01/orders/{order_id}/fulfillment_orders.json
        → Returns fulfillment_orders[] with line_items and assigned_location

Step 2: POST /admin/api/2024-01/fulfillments.json
{
  "fulfillment": {
    "line_items_by_fulfillment_order": [
      {
        "fulfillment_order_id": 123456,
        "fulfillment_order_line_items": [
          { "id": 111, "quantity": 1 },
          { "id": 222, "quantity": 2 }
        ]
      }
    ],
    "tracking_info": {
      "number": "AWB123456789",
      "company": "Aramex",
      "url": "https://www.aramex.com/track/results?ShipmentNumber=AWB123456789"
    },
    "notify_customer": true
  }
}
```

**Partial Fulfillment:**
- Only include the line items being shipped in `fulfillment_order_line_items`.
- Remaining items stay in the fulfillment order for a subsequent fulfillment.
- Each call to the fulfillments endpoint creates a separate fulfillment.

**Updating tracking** (if tracking number changes):
```
PUT /admin/api/2024-01/fulfillments/{fulfillment_id}/update_tracking.json
{
  "fulfillment": {
    "tracking_info": {
      "number": "NEW_AWB",
      "company": "SMSA",
      "url": "https://www.smsaexpress.com/track/NEW_AWB"
    },
    "notify_customer": true
  }
}
```

### 3.4 Product Import to Shopify

When seller clicks "Import" on a catalog product:

```
POST /admin/api/2024-01/products.json
{
  "product": {
    "title": "Turkish Cotton Towel Set",
    "body_html": "<p>Premium cotton...</p>",
    "vendor": "FulfillHub",
    "product_type": "Home & Living",
    "tags": "fulfillhub, imported",
    "variants": [
      {
        "title": "White / Large",
        "sku": "FH-TWL-001-WH-L",
        "price": "29.99",
        "inventory_management": null,
        "requires_shipping": true,
        "weight": 0.8,
        "weight_unit": "kg"
      }
    ],
    "images": [
      { "src": "https://cdn.fulfillhub.com/products/twl-001-1.jpg" }
    ]
  }
}
```

We store the `shopifyProductId` and `shopifyVariantId` in our `seller_product` table for order mapping.

---

## 4. CARRIER INTEGRATION PLAN

### 4.1 Unified Carrier Interface

```typescript
interface CarrierConnector {
  createShipment(params: ShipmentRequest): Promise<ShipmentResponse>;
  cancelShipment(trackingNumber: string): Promise<void>;
  getTrackingStatus(trackingNumber: string): Promise<TrackingStatus>;
  generateLabel(trackingNumber: string): Promise<LabelData>;
}

interface ShipmentRequest {
  orderId: string;
  senderAddress: Address;        // our warehouse
  recipientAddress: Address;     // customer
  parcels: Parcel[];
  cashOnDelivery?: number;
  productType: 'DOM' | 'EXP';   // domestic vs express/international
  serviceType: string;           // carrier-specific
  reference: string;             // our internal order ID
}

interface ShipmentResponse {
  trackingNumber: string;
  labelUrl?: string;
  estimatedDelivery?: Date;
  rawResponse: any;              // store full carrier response
}
```

### 4.2 Aramex Integration

| Field | Mapping |
|---|---|
| API | Aramex Ship & Track SOAP/REST API |
| Auth | `AccountNumber`, `UserName`, `Password`, `AccountPin`, `AccountEntity`, `AccountCountryCode` |
| Create Shipment | `POST /ShippingAPI/RateCalculator/Service_1_0.svc/json/CreateShipments` |
| Product Type | `EPX` (Express) for international GCC |
| Service Type | `PDX` (Priority Document Express) or `PPX` (Priority Parcel Express) |
| Weight | in KG |
| Dimensions | in CM |
| Payment Type | `P` (Prepaid) — we pay |
| Label | Returned in response as base64 PDF |
| Tracking URL | `https://www.aramex.com/track/results?ShipmentNumber={AWB}` |

### 4.3 SMSA Integration

| Field | Mapping |
|---|---|
| API | SMSA Express API (REST) |
| Auth | API Key in header (`passkey` parameter) |
| Create Shipment | `POST /api/addShipment` |
| Service Type | `DLV` (Delivery) |
| Reference | Our internal order reference |
| Weight | in KG |
| COD | Optional |
| Label | Separate call to `getPDF` endpoint |
| Tracking URL | `https://www.smsaexpress.com/track/{AWB}` |

### 4.4 Fallback — Manual Tracking Entry

When carrier API is unavailable:
1. Admin sees "Manual Entry" button on shipment screen.
2. Admin enters: tracking number, carrier (dropdown: Aramex/SMSA), optional label file upload.
3. System proceeds with tracking push to Shopify as normal.
4. Flag shipment as `createdVia: MANUAL` for audit.

---

## 5. UX WIREFRAME OUTLINES

### 5.1 Admin Dashboard Screens

```
[Sidebar Navigation]
├── Dashboard (home)
│   └── KPIs: orders today, pending packing, shipped today, wallet alerts
├── Catalog
│   ├── Product List (table: SKU, name, stock type, status, countries, cost)
│   ├── Add/Edit Product (form with variants, images, eligibility, pricing)
│   └── Product Requests (table: seller, trendyol link, status, actions: approve/reject)
├── Orders
│   ├── Order Queue (filterable table: status, seller, date, country, carrier)
│   ├── Order Detail (line items, customer address, status timeline, shipments, notes)
│   └── Exceptions (filtered view: OOS, address error, returns)
├── Warehouse
│   ├── Pick List (grouped by batch/date, printable)
│   ├── Pack Station (scan/select order → QC checklist → mark packed)
│   └── Packing Slips (print view with private-label info)
├── Shipping
│   ├── Ready to Ship (orders status=PACKED, bulk select → create shipments)
│   ├── Shipment Detail (tracking, carrier, label download, push-to-Shopify button)
│   └── Manual Tracking Entry (form)
├── Sellers
│   ├── Seller List (table: shop name, status, balance, orders count)
│   ├── Seller Detail (settings, packaging prefs, wallet history, imported products)
│   └── Wallet Adjustments (top-up / deduction with reason)
├── Billing
│   ├── Transactions (all wallet movements across sellers)
│   └── Revenue Report (by period, by seller)
└── Settings
    ├── Carrier Config (API keys, default rules)
    ├── Country/Shipping Rules
    ├── Admin Users
    └── Webhook Logs
```

### 5.2 Seller Dashboard Screens (Embedded in Shopify)

```
[Top Navigation — Polaris Tabs]
├── Home
│   └── Welcome, quick stats: active products, open orders, wallet balance
├── Catalog
│   ├── Browse Products (grid/list, search, filter by category/country)
│   └── Product Detail (images, variants, price, margin preview, "Import to Store" button)
├── My Products
│   └── Imported products list (synced status, Shopify link, actions)
├── Orders
│   ├── Order List (status badges, date, tracking, amount)
│   └── Order Detail (items, status timeline, tracking number, "Tracking Pushed ✓")
├── Product Requests
│   ├── Submit Request (form: Trendyol URL, notes, desired category)
│   └── My Requests (status: Pending/Approved/Rejected, admin notes)
├── Wallet
│   ├── Balance display
│   ├── Transaction History (table)
│   └── Top-Up Instructions (bank transfer details / payment link)
└── Settings
    ├── Packaging Preferences (insert card text, branded packaging toggle)
    └── Notification Preferences
```

---

## 6. PHASED BUILD PLAN

### Phase 1 — Manual-Friendly MVP (Weeks 1-6)

| Week | Deliverable |
|---|---|
| 1 | Project scaffold, DB schema, Shopify OAuth + app install flow |
| 2 | Catalog CRUD (admin), product detail pages |
| 3 | Seller embedded app: catalog browse + product import to Shopify |
| 4 | Order webhook ingestion, order status pipeline, admin order queue |
| 5 | Shipment creation (manual tracking entry), tracking push to Shopify |
| 6 | Seller wallet (balance, deduction on order), admin wallet management |

**Phase 1 delivers:** Working app install, catalog, order flow, manual shipping + tracking, basic billing.

### Phase 2 — Automation (Weeks 7-10)

| Week | Deliverable |
|---|---|
| 7 | Aramex API integration (create shipment, get label) |
| 8 | SMSA API integration (create shipment, get label) |
| 9 | Product request workflow (seller submit, admin approve/reject) |
| 10 | Packing workflow (pick list, QC, packing slip with private-label) |

**Phase 2 delivers:** Automated carrier integration, full warehouse workflow, product sourcing pipeline.

### Phase 3 — Tracking Events & Scale (Weeks 11-14)

| Week | Deliverable |
|---|---|
| 11 | Carrier tracking status polling (cron job, update internal status) |
| 12 | Analytics dashboard (admin), seller stats |
| 13 | Bulk operations (bulk ship, bulk import), performance optimization |
| 14 | Exception handling polish, returns flow, monitoring/alerting |

---

## 7. TECH STACK & PROJECT STRUCTURE

### 7.1 Stack Decision

| Layer | Choice | Rationale |
|---|---|---|
| **Framework** | Remix (Shopify app template) | Official Shopify recommendation; built-in App Bridge, session management, Polaris |
| **ORM** | Prisma | Type-safe, migrations, great DX |
| **Database** | PostgreSQL | Relational integrity for orders/billing; JSON columns for flexible metadata |
| **UI (Seller)** | Polaris React | Required for Shopify embedded apps |
| **UI (Admin)** | React + Tailwind CSS | Separate SPA, not embedded in Shopify |
| **Auth (Admin)** | bcrypt + JWT | Simple, stateless |
| **Auth (Seller)** | Shopify Session Token | Built into Remix template |
| **Queue (future)** | BullMQ + Redis | For async jobs (carrier polling, bulk ops) |
| **File Storage** | S3-compatible (R2/MinIO) | Product images, labels |

### 7.2 Folder Structure

```
fulfillhub/
├── package.json
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│   └── seed.ts
├── app/                              # Remix app (seller-facing + webhooks)
│   ├── entry.server.tsx
│   ├── entry.client.tsx
│   ├── root.tsx
│   ├── shopify.server.ts             # Shopify API client setup
│   ├── db.server.ts                  # Prisma client singleton
│   ├── routes/
│   │   ├── app._index.tsx            # Seller home
│   │   ├── app.catalog.tsx           # Seller catalog browse
│   │   ├── app.catalog.$id.tsx       # Seller product detail + import
│   │   ├── app.orders.tsx            # Seller order list
│   │   ├── app.orders.$id.tsx        # Seller order detail
│   │   ├── app.products.tsx          # Seller imported products
│   │   ├── app.requests.tsx          # Seller product requests
│   │   ├── app.requests.new.tsx      # Submit product request
│   │   ├── app.wallet.tsx            # Seller wallet
│   │   ├── app.settings.tsx          # Seller settings
│   │   ├── auth.$.tsx                # Shopify OAuth callbacks
│   │   ├── auth.login/route.tsx      # Shopify login
│   │   └── webhooks.tsx              # Shopify webhook handler
│   ├── services/
│   │   ├── catalog.server.ts
│   │   ├── order.server.ts
│   │   ├── shopify-product.server.ts
│   │   ├── shopify-fulfillment.server.ts
│   │   ├── shipping.server.ts
│   │   ├── wallet.server.ts
│   │   ├── product-request.server.ts
│   │   └── webhook.server.ts
│   ├── carriers/
│   │   ├── types.ts                  # CarrierConnector interface
│   │   ├── aramex.server.ts
│   │   ├── smsa.server.ts
│   │   └── manual.server.ts
│   └── components/
│       ├── OrderStatusBadge.tsx
│       ├── CatalogProductCard.tsx
│       ├── WalletBalance.tsx
│       └── ...
├── admin/                            # Admin dashboard (separate SPA)
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── api/                      # API client
│   │   │   └── client.ts
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── catalog/
│   │   │   │   ├── CatalogList.tsx
│   │   │   │   ├── CatalogForm.tsx
│   │   │   │   └── ProductRequests.tsx
│   │   │   ├── orders/
│   │   │   │   ├── OrderQueue.tsx
│   │   │   │   └── OrderDetail.tsx
│   │   │   ├── warehouse/
│   │   │   │   ├── PickList.tsx
│   │   │   │   └── PackStation.tsx
│   │   │   ├── shipping/
│   │   │   │   ├── ReadyToShip.tsx
│   │   │   │   └── ShipmentDetail.tsx
│   │   │   ├── sellers/
│   │   │   │   ├── SellerList.tsx
│   │   │   │   └── SellerDetail.tsx
│   │   │   └── settings/
│   │   │       └── Settings.tsx
│   │   └── components/
│   │       └── ...
│   └── index.html
├── api/                              # Admin API routes (Express or Remix resource routes)
│   ├── middleware/
│   │   ├── auth.ts
│   │   └── rbac.ts
│   ├── routes/
│   │   ├── admin-auth.ts
│   │   ├── admin-catalog.ts
│   │   ├── admin-orders.ts
│   │   ├── admin-shipping.ts
│   │   ├── admin-sellers.ts
│   │   ├── admin-wallet.ts
│   │   ├── admin-product-requests.ts
│   │   └── admin-analytics.ts
│   └── index.ts
├── .env.example
├── docker-compose.yml                # Postgres + Redis for local dev
├── Dockerfile
└── README.md
```

---

## 9. PRODUCT ELIGIBILITY RULES & SCORING

### 9.1 Shipping Eligibility Rules

| Rule | Field | Logic |
|---|---|---|
| Country restriction | `eligible_countries` (array) | Product can only ship to listed countries |
| Weight limit | `weight_kg` | Max 30kg per parcel (Aramex limit) |
| Dimension limit | `longest_side_cm` | Max 120cm any side |
| Customs risk | `customs_risk_flag` | HIGH risk items may be excluded from certain countries |
| Restricted category | `category` | Perfumes, batteries, liquids: limited to surface shipping |
| Stock availability | `stock_type` | IN_WAREHOUSE ships immediately; ON_DEMAND has 3-7 day lead |

### 9.2 Product Scoring Rubric (Internal Use — Catalog Approval)

| Criterion | Weight | Score (1-5) | Description |
|---|---|---|---|
| **Demand Signal** | 25% | 5=proven seller, 1=speculative | Based on Trendyol reviews/sales rank |
| **Margin Potential** | 25% | 5= >50% margin, 1= <15% | (seller_price - cost - shipping) / seller_price |
| **Shipping Friendliness** | 20% | 5=small/light, 1=bulky/heavy | Weight, dimensions, fragility |
| **Customs Risk** | 15% | 5=no risk, 1=high risk | Likelihood of customs hold/seizure |
| **Return Rate Prediction** | 15% | 5=unlikely returns, 1=high returns | Category-based (fashion=3, electronics=2, home=4) |

**Threshold:** Products scoring **≥ 3.0 weighted average** are approved; below → reject with notes.

Admin can override the score with justification (logged in audit).
