import assert from "node:assert/strict";
import test from "node:test";
import {
  opsAlertRecipients,
  parseRecipientList,
  sendEmail,
  smtpConfig,
  smtpTransportReady,
  validateSmtpConfig
} from "../src/email.js";

test("parses comma-separated recipient lists", () => {
  assert.deepEqual(parseRecipientList("a@example.com, b@example.com"), [
    "a@example.com",
    "b@example.com"
  ]);
});

test("requires Gmail SMTP, not SendGrid", () => {
  assert.throws(
    () => validateSmtpConfig({ fromEmail: "info@healthexps.com" }),
    /Do not use SendGrid/
  );
  assert.throws(
    () => validateSmtpConfig({ fromEmail: "info@healthexps.com", sendgridApiKey: "sg.test" }),
    /SMTP is not fully configured/
  );
  assert.doesNotThrow(() => validateSmtpConfig({
    fromEmail: "info@healthexps.com",
    host: "smtp.gmail.com",
    user: "info@healthexps.com",
    pass: "app-pass"
  }));
});

test("ops alerts go to the test mailbox when configured", () => {
  assert.deepEqual(
    opsAlertRecipients({ INDUSTRY_PULSE_TEST_TO: "yperez@healthexps.com" }),
    ["yperez@healthexps.com"]
  );
});

test("SMTP defaults FROM_EMAIL to info@healthexps.com", () => {
  const config = smtpConfig({
    SMTP_HOST: "smtp.gmail.com",
    SMTP_USER: "info@healthexps.com",
    SMTP_PASS: "app-pass"
  });
  assert.equal(config.fromEmail, "info@healthexps.com");
  assert.equal(config.sendgridApiKey, undefined);
  assert.doesNotThrow(() => validateSmtpConfig(config));
  assert.equal(smtpConfig({ SENDGRID_API_KEY: "sg.test" }).fromEmail, undefined);
});

test("sends Pulse from info@ over SMTP and ignores a leftover SendGrid key", async () => {
  const sent = [];
  let fetched = false;
  const result = await sendEmail({
    config: smtpConfig({
      SMTP_HOST: "smtp.gmail.com",
      SMTP_USER: "info@healthexps.com",
      SMTP_PASS: "app-pass",
      SENDGRID_API_KEY: "sg-should-be-ignored"
    }),
    to: "agents@example.com",
    subject: "THE Health Experts Insider — Issue #11",
    text: "Issue #11 body",
    fetchImpl: async () => {
      fetched = true;
      throw new Error("must not call SendGrid");
    },
    transporter: {
      sendMail: async (mail) => {
        sent.push(mail);
        return { messageId: "smtp-pulse" };
      }
    }
  });
  assert.equal(result.messageId, "smtp-pulse");
  assert.equal(fetched, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].from, "info@healthexps.com");
  assert.equal(sent[0].to, "agents@example.com");
});

test("sends Pulse as provided Insider HTML instead of a pre dump", async () => {
  const sent = [];
  await sendEmail({
    config: smtpConfig({
      SMTP_HOST: "smtp.gmail.com",
      SMTP_USER: "info@healthexps.com",
      SMTP_PASS: "app-pass"
    }),
    to: "agents@example.com",
    subject: "THE Health Experts Insider — Issue #11",
    text: "plain fallback",
    html: "<table><tr><td>The Week in Medicare</td></tr></table>",
    transporter: {
      sendMail: async (mail) => {
        sent.push(mail);
        return { messageId: "html-pulse" };
      }
    }
  });
  assert.match(sent[0].html, /The Week in Medicare/);
  assert.equal(sent[0].html.includes("<pre"), false);
});

test("fails loud when SMTP is missing even if a SendGrid key is present", async () => {
  await assert.rejects(
    sendEmail({
      config: smtpConfig({
        FROM_EMAIL: "info@healthexps.com",
        SENDGRID_API_KEY: "sg.test"
      }),
      to: "agents@example.com",
      subject: "Issue #11",
      text: "body"
    }),
    /Do not use SendGrid/
  );
});

test("names a Pro redeploy when SMTP from info@ times out", async () => {
  await assert.rejects(
    sendEmail({
      config: smtpConfig({
        SMTP_HOST: "smtp.gmail.com",
        SMTP_USER: "info@healthexps.com",
        SMTP_PASS: "app-pass"
      }),
      to: "agents@example.com",
      subject: "Issue #11",
      text: "body",
      transporter: {
        sendMail: async () => {
          throw new Error("Connection timeout");
        }
      }
    }),
    /redeploy igor-config.*does not use SendGrid/
  );
});

test("smtpTransportReady requires host, user, and pass", () => {
  assert.equal(smtpTransportReady({ host: "smtp.gmail.com" }), false);
  assert.equal(smtpTransportReady({
    host: "smtp.gmail.com",
    user: "info@healthexps.com",
    pass: "app-pass"
  }), true);
});
