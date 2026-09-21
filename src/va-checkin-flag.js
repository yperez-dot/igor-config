export const VA_CHECKIN_ENABLED_ENV = "VA_CHECKIN_ENABLED";

export function isVaCheckinEnabled(environment = process.env) {
  const raw = String(environment?.[VA_CHECKIN_ENABLED_ENV] ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}
