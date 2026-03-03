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

// Warehouse address (configurable via env)
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
