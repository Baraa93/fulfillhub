import type {
  CarrierConnector,
  ShipmentRequest,
  ShipmentResponse,
  TrackingStatus,
  LabelData,
} from "./types";

// ─────────────────────────────────────────────
// Manual Carrier Connector (Fallback)
// ─────────────────────────────────────────────
// Used when carrier APIs are unavailable.
// Admin enters tracking number manually.

export function createManualShipmentResponse(
  trackingNumber: string,
  carrier: "ARAMEX" | "SMSA",
): ShipmentResponse {
  return {
    trackingNumber,
    labelUrl: undefined,
    estimatedDelivery: undefined,
    rawResponse: { manual: true, carrier, enteredAt: new Date().toISOString() },
  };
}

// Placeholder connector that throws for API-dependent methods
export const manualConnector: CarrierConnector = {
  carrierName: "ARAMEX", // overridden at call site

  async createShipment(_params: ShipmentRequest): Promise<ShipmentResponse> {
    throw new Error(
      "Manual connector does not support createShipment. Use createManualShipmentResponse() instead.",
    );
  },

  async cancelShipment(_trackingNumber: string): Promise<void> {
    throw new Error("Manual connector does not support cancelShipment.");
  },

  async getTrackingStatus(_trackingNumber: string): Promise<TrackingStatus> {
    throw new Error(
      "Manual connector does not support getTrackingStatus. Check carrier website directly.",
    );
  },

  async generateLabel(_trackingNumber: string): Promise<LabelData> {
    throw new Error(
      "Manual connector does not support generateLabel. Upload label manually.",
    );
  },
};
