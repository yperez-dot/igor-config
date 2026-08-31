import { DEFAULT_SALES_SHEET_CSV_URL } from "./sales-sync.js";
import { hasPulseInbox } from "./imap-accounts.js";

export const DEFAULT_OLICOMM_BASE_URL = "https://commission-tracker-production-e4fc.up.railway.app";
export { DEFAULT_SALES_SHEET_CSV_URL };

export const SYSTEM_IDS = [
  {
    id: "ghl",
    label: "GoHighLevel CRM",
    env: ["GHL_API_TOKEN"]
  },
  {
    id: "notion",
    label: "Notion",
    env: ["NOTION_TOKEN"]
  },
  {
    id: "github",
    label: "GitHub",
    env: ["GITHUB_TOKEN"]
  },
  {
    id: "netlify",
    label: "Netlify",
    env: ["NETLIFY_AUTH_TOKEN"]
  },
  {
    id: "facebook",
    label: "Facebook Ads",
    env: ["FACEBOOK_ACCESS_TOKEN"]
  },
  {
    id: "tavily",
    label: "Tavily web search",
    env: ["TAVILY_API_KEY"]
  },
  {
    id: "olicomm",
    label: "OliComm commission tracker",
    env: ["OLICOMM_BASE_URL"]
  },
  {
    id: "medicarepro",
    label: "MedicarePro CRM",
    env: ["MEDICAREPRO_API_KEY", "MEDICAREPRO_BASE_URL"]
  },
  {
    id: "email",
    label: "Email (info@ Gmail SMTP)",
    env: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]
  },
  {
    id: "sheets",
    label: "Google Sheets (approved CSV)",
    env: ["SALES_SHEET_CSV_URL"]
  },
  {
    id: "calendar",
    label: "Google Calendar (Yahoska)",
    env: ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET", "GOOGLE_CALENDAR_REFRESH_TOKEN"]
  },
  {
    id: "imap",
    label: "Leadership inbox (IMAP)",
    env: ["HEARTBEAT_IMAP_USER", "HEARTBEAT_IMAP_PASS"]
  },
  {
    id: "pulse",
    label: "Agent Pulse inbox (theiagentpulse)",
    env: ["PULSE_IMAP_PASS"]
  }
];

export function envPresent(environment, keys) {
  return keys.every((key) => Boolean(String(environment[key] ?? "").trim()));
}

export function connectedSystems(environment = process.env) {
  return SYSTEM_IDS.map((system) => {
    const connected = system.id === "email"
      ? Boolean(String(environment.SMTP_HOST ?? "").trim() && String(environment.SMTP_USER ?? "").trim() && String(environment.SMTP_PASS ?? "").trim())
      : system.id === "olicomm"
        ? Boolean(String(environment.OLICOMM_BASE_URL ?? DEFAULT_OLICOMM_BASE_URL).trim())
        : system.id === "sheets"
          ? Boolean(String(environment.SALES_SHEET_CSV_URL ?? DEFAULT_SALES_SHEET_CSV_URL).trim())
          : system.id === "pulse"
            ? hasPulseInbox(environment)
            : envPresent(environment, system.env);
    const missingEnv = connected
      ? []
      : system.env.filter((key) => !String(environment[key] ?? "").trim());
    return { ...system, connected, missingEnv };
  });
}

export function connectedSystemIds(environment = process.env) {
  return connectedSystems(environment).filter((system) => system.connected).map((system) => system.id);
}
