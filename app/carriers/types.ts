// ─────────────────────────────────────────────
// Carrier Connector Interface
// ─────────────────────────────────────────────

export interface Address {
  name: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  province?: string;
  country: string; // ISO 2-letter
  zip: string;
  phone: string;
  email?: string;
}

export interface Parcel {
  weightKg: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  description: string;
  quantity: number;
  value: number;
  currency: string;
}

export interface ShipmentRequest {
  orderId: string;
  reference: string; // internal order reference
  senderAddress: Address;
  recipientAddress: Address;
  parcels: Parcel[];
  productType: "DOM" | "EXP"; // domestic vs international
  serviceType?: string;
  cashOnDelivery?: number;
  codCurrency?: string;
  description?: string;
}

export interface ShipmentResponse {
  trackingNumber: string;
  labelUrl?: string;
  estimatedDelivery?: Date;
  rawResponse: unknown;
}

export interface TrackingStatus {
  trackingNumber: string;
  status: string;
  statusCode: string;
  lastUpdate: Date;
  events: TrackingEvent[];
}

export interface TrackingEvent {
  timestamp: Date;
  status: string;
  location?: string;
  description: string;
}

export interface LabelData {
  format: "PDF" | "PNG" | "ZPL";
  data: Buffer | string; // base64 or raw
  url?: string;
}

export interface CarrierConnector {
  readonly carrierName: "ARAMEX" | "SMSA";

  createShipment(params: ShipmentRequest): Promise<ShipmentResponse>;

  cancelShipment(trackingNumber: string): Promise<void>;

  getTrackingStatus(trackingNumber: string): Promise<TrackingStatus>;

  generateLabel(trackingNumber: string): Promise<LabelData>;
}

// Warehouse address — static fallback (used when DB is unavailable)
export const WAREHOUSE_ADDRESS: Address = {
  name: "FulfillHub Warehouse",
  company: "FulfillHub",
  line1: process.env.WAREHOUSE_ADDRESS_LINE1 || "Warehouse Address Line 1",
  city: process.env.WAREHOUSE_CITY || "Istanbul",
  province: process.env.WAREHOUSE_PROVINCE || "Istanbul",
  country: "TR",
  zip: process.env.WAREHOUSE_ZIP || "34000",
  phone: process.env.WAREHOUSE_PHONE || "+905001234567",
  email: process.env.WAREHOUSE_EMAIL || "ops@fulfillhub.com",
};

/**
 * Reads warehouse address from AppSetting (admin-configurable),
 * falling back to env vars / defaults above.
 */
export async function getWarehouseAddress(): Promise<Address> {
  try {
    const { prisma } = await import("~/db.server");
    const rows = await prisma.appSetting.findMany({
      where: { key: { startsWith: "warehouse." } },
    });
    if (rows.length === 0) return WAREHOUSE_ADDRESS;

    const m: Record<string, string> = {};
    for (const r of rows) m[r.key] = r.value;

    return {
      name: m["warehouse.name"] || WAREHOUSE_ADDRESS.name,
      company: m["warehouse.company"] || WAREHOUSE_ADDRESS.company,
      line1: m["warehouse.line1"] || WAREHOUSE_ADDRESS.line1,
      line2: m["warehouse.line2"] || WAREHOUSE_ADDRESS.line2,
      city: m["warehouse.city"] || WAREHOUSE_ADDRESS.city,
      province: m["warehouse.province"] || WAREHOUSE_ADDRESS.province,
      country: m["warehouse.country"] || WAREHOUSE_ADDRESS.country,
      zip: m["warehouse.zip"] || WAREHOUSE_ADDRESS.zip,
      phone: m["warehouse.phone"] || WAREHOUSE_ADDRESS.phone,
      email: m["warehouse.email"] || WAREHOUSE_ADDRESS.email,
    };
  } catch {
    return WAREHOUSE_ADDRESS;
  }
}
