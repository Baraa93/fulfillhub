import type {
  CarrierConnector,
  ShipmentRequest,
  ShipmentResponse,
  TrackingStatus,
  TrackingEvent,
  LabelData,
} from "./types";

// ─────────────────────────────────────────────
// SMSA Express Carrier Connector
// ─────────────────────────────────────────────
// SMSA API docs: https://www.smsaexpress.com/developer

interface SmsaConfig {
  passkey: string;
  baseUrl: string;
}

function getConfig(): SmsaConfig {
  return {
    passkey: process.env.SMSA_PASSKEY || "",
    baseUrl:
      process.env.SMSA_BASE_URL || "https://track.smsaexpress.com/SecomRestWebApi/api",
  };
}

export const smsaConnector: CarrierConnector = {
  carrierName: "SMSA",

  async createShipment(params: ShipmentRequest): Promise<ShipmentResponse> {
    const config = getConfig();
    const totalWeight = params.parcels.reduce((sum, p) => sum + p.weightKg, 0);
    const totalValue = params.parcels.reduce(
      (sum, p) => sum + p.value * p.quantity,
      0,
    );

    const payload = {
      passKey: config.passkey,
      refNo: params.reference,
      sentDate: new Date().toISOString(),
      idNo: "",
      cName: params.recipientAddress.name,
      cntry: params.recipientAddress.country,
      cCity: params.recipientAddress.city,
      cZip: params.recipientAddress.zip || "",
      cPOBox: "",
      cMobile: params.recipientAddress.phone,
      cTel1: params.recipientAddress.phone,
      cTel2: "",
      cAddr1: params.recipientAddress.line1,
      cAddr2: params.recipientAddress.line2 || "",
      shipType: "DLV", // Delivery
      PCs: params.parcels.reduce((sum, p) => sum + p.quantity, 0),
      cEmail: params.recipientAddress.email || "",
      carrValue: "0",
      carrCurr: "",
      codAmt: params.cashOnDelivery?.toString() || "0",
      weight: totalWeight.toString(),
      custVal: totalValue.toString(),
      custCurr: params.parcels[0]?.currency || "USD",
      insrAmt: "0",
      insrCurr: "",
      itemDesc:
        params.description || "Consumer goods from Turkey",
      sName: params.senderAddress.name,
      sContact: params.senderAddress.name,
      sAddr1: params.senderAddress.line1,
      sAddr2: params.senderAddress.line2 || "",
      sCity: params.senderAddress.city,
      sPhone: params.senderAddress.phone,
      sCntry: params.senderAddress.country,
      prefDelvDate: "",
      gpsPoints: "",
    };

    const response = await fetch(`${config.baseUrl}/addShipment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `SMSA API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();

    // SMSA returns the AWB number in the response
    if (!data.sawb) {
      throw new Error(
        `SMSA shipment creation failed: ${JSON.stringify(data)}`,
      );
    }

    return {
      trackingNumber: data.sawb,
      labelUrl: undefined, // need separate call to getPDF
      estimatedDelivery: undefined,
      rawResponse: data,
    };
  },

  async cancelShipment(trackingNumber: string): Promise<void> {
    const config = getConfig();

    const response = await fetch(
      `${config.baseUrl}/cancelShipment?passkey=${encodeURIComponent(config.passkey)}&awbNo=${encodeURIComponent(trackingNumber)}`,
      { method: "GET" },
    );

    if (!response.ok) {
      throw new Error(`SMSA cancel failed: ${response.status}`);
    }
  },

  async getTrackingStatus(trackingNumber: string): Promise<TrackingStatus> {
    const config = getConfig();

    const response = await fetch(
      `${config.baseUrl}/getTracking?passkey=${encodeURIComponent(config.passkey)}&awbNo=${encodeURIComponent(trackingNumber)}`,
      { method: "GET" },
    );

    if (!response.ok) {
      throw new Error(`SMSA tracking failed: ${response.status}`);
    }

    const data = await response.json();
    const activities = Array.isArray(data) ? data : data.Activities || [];

    const events: TrackingEvent[] = activities.map(
      (e: {
        Date: string;
        Activity: string;
        Details: string;
        Location: string;
      }) => ({
        timestamp: new Date(e.Date),
        status: e.Activity,
        location: e.Location,
        description: e.Details || e.Activity,
      }),
    );

    const lastEvent = events[0];

    return {
      trackingNumber,
      status: lastEvent?.status || "UNKNOWN",
      statusCode: lastEvent?.status || "UNKNOWN",
      lastUpdate: lastEvent?.timestamp || new Date(),
      events,
    };
  },

  async generateLabel(trackingNumber: string): Promise<LabelData> {
    const config = getConfig();

    const response = await fetch(
      `${config.baseUrl}/getPDF?passkey=${encodeURIComponent(config.passkey)}&awbNo=${encodeURIComponent(trackingNumber)}`,
      { method: "GET" },
    );

    if (!response.ok) {
      throw new Error(`SMSA label failed: ${response.status}`);
    }

    const data = await response.json();

    return {
      format: "PDF",
      data: data.getPDFResult || data, // base64 PDF content
    };
  },
};

// Tracking URL builder
export function getSmsaTrackingUrl(trackingNumber: string): string {
  return `https://www.smsaexpress.com/track/${trackingNumber}`;
}
