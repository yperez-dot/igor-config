import assert from "node:assert/strict";
import test from "node:test";
import { maybeReplyToGreeting } from "../src/greeting-kickoff.js";

test("hi from role yahoska returns lock down kickoff reply", async () => {
  const result = await maybeReplyToGreeting({ text: "hi", speaker: { role: "yahoska" } });
  assert.ok(result);
  assert.match(result.reply, /lock down/i);
});

test("Hello from role katy returns kickoff reply", async () => {
  const result = await maybeReplyToGreeting({ text: "Hello", speaker: { role: "katy" } });
  assert.ok(result);
  assert.equal(typeof result.reply, "string");
});

test("good morning from role carolina returns kickoff reply", async () => {
  const result = await maybeReplyToGreeting({ text: "good morning", speaker: { role: "carolina" } });
  assert.ok(result);
  assert.equal(typeof result.reply, "string");
});

test("hey from role husband returns null", async () => {
  const result = await maybeReplyToGreeting({ text: "hey", speaker: { role: "husband" } });
  assert.equal(result, null);
});

test("hi from role allowlisted returns null", async () => {
  const result = await maybeReplyToGreeting({ text: "hi", speaker: { role: "allowlisted" } });
  assert.equal(result, null);
});

test("good afternoon! from yahoska returns kickoff reply", async () => {
  const result = await maybeReplyToGreeting({ text: "good afternoon!", speaker: { role: "yahoska" } });
  assert.ok(result);
});

test("Hi, how are you? from yahoska (too much text) returns null", async () => {
  const result = await maybeReplyToGreeting({ text: "Hi, how are you?", speaker: { role: "yahoska" } });
  assert.equal(result, null);
});

test("goodbye from yahoska returns null", async () => {
  const result = await maybeReplyToGreeting({ text: "goodbye", speaker: { role: "yahoska" } });
  assert.equal(result, null);
});

test("reply includes all four lead-accountability questions", async () => {
  const result = await maybeReplyToGreeting({ text: "hi", speaker: { role: "yahoska" } });
  assert.ok(result);
  assert.match(result.reply, /open leads/i);
  assert.match(result.reply, /GHL/);
  assert.match(result.reply, /follow up/i);
  assert.match(result.reply, /status updated/i);
});

test("each allowed role triggers the kickoff reply", async () => {
  for (const role of ["yahoska", "katy", "carolina"]) {
    const result = await maybeReplyToGreeting({ text: "hi", speaker: { role } });
    assert.ok(result, `expected greeting to trigger for role ${role}`);
  }
});

test("each excluded role does not trigger the kickoff reply", async () => {
  for (const role of ["husband", "allowlisted"]) {
    const result = await maybeReplyToGreeting({ text: "hi", speaker: { role } });
    assert.equal(result, null, `expected greeting to be suppressed for role ${role}`);
  }
});
