import type {
  CarrierConnector,
  ShipmentRequest,
  ShipmentResponse,
  TrackingStatus,
  TrackingEvent,
  LabelData,
} from "./types";

// ─────────────────────────────────────────────
// Aramex Carrier Connector
// ─────────────────────────────────────────────
// Aramex API docs: https://www.aramex.com/developers/apis
// Uses the Shipping Services REST API

interface AramexConfig {
  accountNumber: string;
  userName: string;
  password: string;
  accountPin: string;
  accountEntity: string;
  accountCountryCode: string;
  baseUrl: string;
}

function getConfig(): AramexConfig {
  return {
    accountNumber: process.env.ARAMEX_ACCOUNT_NUMBER || "",
    userName: process.env.ARAMEX_USERNAME || "",
    password: process.env.ARAMEX_PASSWORD || "",
    accountPin: process.env.ARAMEX_ACCOUNT_PIN || "",
    accountEntity: process.env.ARAMEX_ACCOUNT_ENTITY || "",
    accountCountryCode: process.env.ARAMEX_ACCOUNT_COUNTRY_CODE || "TR",
    baseUrl:
      process.env.ARAMEX_BASE_URL ||
      "https://ws.aramex.net/ShippingAPI/RateCalculator/Service_1_0.svc",
  };
}

function buildClientInfo(config: AramexConfig) {
  return {
    Version: "v1",
    AccountNumber: config.accountNumber,
    AccountPin: config.accountPin,
    AccountEntity: config.accountEntity,
    AccountCountryCode: config.accountCountryCode,
    UserName: config.userName,
    Password: config.password,
    Source: 24, // REST API source code
  };
}

export const aramexConnector: CarrierConnector = {
  carrierName: "ARAMEX",

  async createShipment(params: ShipmentRequest): Promise<ShipmentResponse> {
    const config = getConfig();

    const payload = {
      ClientInfo: buildClientInfo(config),
      LabelInfo: {
        ReportID: 9201, // standard label
        ReportType: "URL",
      },
      Shipments: [
        {
          Reference1: params.reference,
          Reference2: params.orderId,
          Shipper: {
            AccountNumber: config.accountNumber,
            PartyAddress: {
              Line1: params.senderAddress.line1,
              Line2: params.senderAddress.line2 || "",
              City: params.senderAddress.city,
              StateOrProvinceCode: params.senderAddress.province || "",
              PostCode: params.senderAddress.zip,
              CountryCode: params.senderAddress.country,
            },
            Contact: {
              PersonName: params.senderAddress.name,
              CompanyName: params.senderAddress.company || "FulfillHub",
              PhoneNumber1: params.senderAddress.phone,
              EmailAddress: params.senderAddress.email || "",
            },
          },
          Consignee: {
            PartyAddress: {
              Line1: params.recipientAddress.line1,
              Line2: params.recipientAddress.line2 || "",
              City: params.recipientAddress.city,
              StateOrProvinceCode: params.recipientAddress.province || "",
              PostCode: params.recipientAddress.zip,
              CountryCode: params.recipientAddress.country,
            },
            Contact: {
              PersonName: params.recipientAddress.name,
              CompanyName: params.recipientAddress.company || "",
              PhoneNumber1: params.recipientAddress.phone,
              EmailAddress: params.recipientAddress.email || "",
            },
          },
          ShippingDateTime: `/Date(${Date.now()})/`,
          DueDate: `/Date(${Date.now() + 7 * 24 * 60 * 60 * 1000})/`,
          Details: {
            Dimensions: params.parcels[0]
              ? {
                  Length: params.parcels[0].lengthCm || 0,
                  Width: params.parcels[0].widthCm || 0,
                  Height: params.parcels[0].heightCm || 0,
                  Unit: "CM",
                }
              : null,
            ActualWeight: {
              Value: params.parcels.reduce((sum, p) => sum + p.weightKg, 0),
              Unit: "KG",
            },
            ProductGroup: params.productType === "DOM" ? "DOM" : "EXP",
            ProductType: params.productType === "DOM" ? "OND" : "PPX", // Priority Parcel Express
            PaymentType: "P", // Prepaid
            PaymentOptions: "",
            NumberOfPieces: params.parcels.reduce(
              (sum, p) => sum + p.quantity,
              0,
            ),
            DescriptionOfGoods:
              params.description || "Consumer goods from Turkey",
            GoodsOriginCountry: "TR",
            CashOnDeliveryAmount: params.cashOnDelivery
              ? {
                  Value: params.cashOnDelivery,
                  CurrencyCode: params.codCurrency || "USD",
                }
              : null,
            CustomsValueAmount: {
              Value: params.parcels.reduce(
                (sum, p) => sum + p.value * p.quantity,
                0,
              ),
              CurrencyCode:
                params.parcels[0]?.currency || "USD",
            },
          },
        },
      ],
      Transaction: {
        Reference1: params.orderId,
      },
    };

    const response = await fetch(
      `${config.baseUrl}/json/CreateShipments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Aramex API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();

    if (data.HasErrors) {
      const errors = data.Notifications?.map(
        (n: { Message: string }) => n.Message,
      ).join("; ");
      throw new Error(`Aramex shipment creation failed: ${errors}`);
    }

    const shipment = data.Shipments?.[0];
    const awb = shipment?.ID || "";

    return {
      trackingNumber: awb,
      labelUrl: shipment?.ShipmentLabel?.LabelURL || undefined,
      estimatedDelivery: undefined, // Aramex doesn't return this in create
      rawResponse: data,
    };
  },

  async cancelShipment(trackingNumber: string): Promise<void> {
    const config = getConfig();

    const response = await fetch(
      `${config.baseUrl}/json/CancelPickup`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ClientInfo: buildClientInfo(config),
          ShipmentNumber: trackingNumber,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Aramex cancel failed: ${response.status}`);
    }
  },

  async getTrackingStatus(trackingNumber: string): Promise<TrackingStatus> {
    const config = getConfig();

    const response = await fetch(
      "https://ws.aramex.net/ShippingAPI/Tracking/Service_1_0.svc/json/TrackShipments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ClientInfo: buildClientInfo(config),
          Shipments: [trackingNumber],
          GetLastTrackingUpdateOnly: false,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Aramex tracking failed: ${response.status}`);
    }

    const data = await response.json();
    const results = data.TrackingResults?.[0];
    const events: TrackingEvent[] = (results?.Value || []).map(
      (e: {
        UpdateDateTime: string;
        UpdateDescription: string;
        UpdateLocation: string;
        Comments: string;
      }) => ({
        timestamp: new Date(
          parseInt(e.UpdateDateTime.replace(/[^0-9-]/g, "")),
        ),
        status: e.UpdateDescription,
        location: e.UpdateLocation,
        description: e.Comments || e.UpdateDescription,
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
      `${config.baseUrl}/json/PrintLabel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ClientInfo: buildClientInfo(config),
          ShipmentNumber: trackingNumber,
          LabelInfo: {
            ReportID: 9201,
            ReportType: "URL",
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Aramex label failed: ${response.status}`);
    }

    const data = await response.json();

    return {
      format: "PDF",
      data: data.ShipmentLabel?.LabelFileContents || "",
      url: data.ShipmentLabel?.LabelURL,
    };
  },
};

// Tracking URL builder
export function getAramexTrackingUrl(trackingNumber: string): string {
  return `https://www.aramex.com/track/results?ShipmentNumber=${trackingNumber}`;
}
