import assert from "node:assert/strict";
import test from "node:test";
import {
  isSendGridQuotaError,
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

test("ops alerts go to the test mailbox when configured", () => {
  assert.deepEqual(
    opsAlertRecipients({ INDUSTRY_PULSE_TEST_TO: "yperez@healthexps.com" }),
    ["yperez@healthexps.com"]
  );
});

test("SendGrid defaults FROM_EMAIL to info@healthexps.com", () => {
  const config = smtpConfig({ SENDGRID_API_KEY: "sg.test" });
  assert.equal(config.fromEmail, "info@healthexps.com");
  assert.doesNotThrow(() => validateSmtpConfig(config));
});

test("detects SendGrid credit exhaustion without treating SMTP as ready", () => {
  assert.equal(smtpTransportReady({ host: "smtp.gmail.com" }), false);
  assert.equal(smtpTransportReady({
    host: "smtp.gmail.com",
    user: "info@healthexps.com",
    pass: "app-pass"
  }), true);
  assert.equal(
    isSendGridQuotaError(new Error('SendGrid request failed with HTTP 401: {"errors":[{"message":"Maximum credits exceeded"}]}')),
    true
  );
});

function sendgridQuotaFetch() {
  return async () => ({
    ok: false,
    status: 401,
    headers: { get: () => null },
    text: async () => JSON.stringify({ errors: [{ message: "Maximum credits exceeded", field: null, help: null }] })
  });
}

test("falls back to SMTP from info@ when SendGrid credits are exhausted", async () => {
  const sent = [];
  const result = await sendEmail({
    config: {
      fromEmail: "info@healthexps.com",
      sendgridApiKey: "sg.test",
      host: "smtp.gmail.com",
      user: "info@healthexps.com",
      pass: "app-pass"
    },
    to: "agents@example.com",
    subject: "THE Health Experts Insider — Issue #11",
    text: "Issue #11 body",
    fetchImpl: sendgridQuotaFetch(),
    transporter: {
      sendMail: async (mail) => {
        sent.push(mail);
        return { messageId: "smtp-pulse" };
      }
    }
  });
  assert.equal(result.messageId, "smtp-pulse");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].from, "info@healthexps.com");
  assert.equal(sent[0].to, "agents@example.com");
});

test("does not call SMTP when SendGrid accepts the message", async () => {
  let smtpCalled = false;
  const result = await sendEmail({
    config: {
      fromEmail: "info@healthexps.com",
      sendgridApiKey: "sg.test",
      host: "smtp.gmail.com",
      user: "info@healthexps.com",
      pass: "app-pass"
    },
    to: "agents@example.com",
    subject: "ok",
    text: "ok",
    fetchImpl: async () => ({
      ok: true,
      status: 202,
      headers: { get: () => "sg-message-id" }
    }),
    transporter: {
      sendMail: async () => {
        smtpCalled = true;
        return { messageId: "should-not-run" };
      }
    }
  });
  assert.equal(result.messageId, "sg-message-id");
  assert.equal(smtpCalled, false);
});

test("fails loud when SendGrid is out of credits and SMTP is not configured", async () => {
  await assert.rejects(
    sendEmail({
      config: {
        fromEmail: "info@healthexps.com",
        sendgridApiKey: "sg.test"
      },
      to: "agents@example.com",
      subject: "Issue #11",
      text: "body",
      fetchImpl: sendgridQuotaFetch()
    }),
    /SendGrid credits are exhausted.*not Anthropic/
  );
});

test("keeps the SendGrid quota error if SMTP from info@ also fails", async () => {
  await assert.rejects(
    sendEmail({
      config: {
        fromEmail: "info@healthexps.com",
        sendgridApiKey: "sg.test",
        host: "smtp.gmail.com",
        user: "info@healthexps.com",
        pass: "app-pass"
      },
      to: "agents@example.com",
      subject: "Issue #11",
      text: "body",
      fetchImpl: sendgridQuotaFetch(),
      transporter: {
        sendMail: async () => {
          throw new Error("Connection timeout");
        }
      }
    }),
    /SendGrid credits are exhausted.*SMTP from info@ also failed.*Railway Hobby/
  );
});
