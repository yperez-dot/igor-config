/** Complete Pulse send-path env for tests that are not about readiness. */
export const PULSE_READY_ENV = {
  XAI_API_KEY: "test-xai",
  PULSE_IMAP_PASS: "test-pulse",
  SMTP_HOST: "smtp.gmail.com",
  SMTP_USER: "info@healthexps.com",
  SMTP_PASS: "test-smtp",
  FROM_EMAIL: "info@healthexps.com",
  AGENT_PULSE_RECIPIENTS: "agents@example.com"
};
