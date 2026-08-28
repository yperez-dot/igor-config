import assert from "node:assert/strict";
import test from "node:test";
import { parseRecipientList, smtpConfig, validateSmtpConfig } from "../src/email.js";

test("parses comma-separated recipient lists", () => {
  assert.deepEqual(parseRecipientList("a@example.com, b@example.com"), [
    "a@example.com",
    "b@example.com"
  ]);
});

test("requires core smtp settings", () => {
  assert.throws(
    () => validateSmtpConfig({ fromEmail: "info@example.com" }),
    /SMTP is not fully configured/
  );
  assert.doesNotThrow(() => validateSmtpConfig({
    fromEmail: "info@example.com",
    sendgridApiKey: "sg.test"
  }));
});

test("SendGrid defaults FROM_EMAIL to info@healthexps.com", () => {
  const config = smtpConfig({ SENDGRID_API_KEY: "sg.test" });
  assert.equal(config.fromEmail, "info@healthexps.com");
  assert.doesNotThrow(() => validateSmtpConfig(config));
});
