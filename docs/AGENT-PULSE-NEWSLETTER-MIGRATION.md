# Agent Pulse newsletter migration

Agent Pulse is the email newsletter sent to agents. It is an outbound communication workflow, not an OpenClaw heartbeat or a v2 background pulse.

## What is known

- The legacy system uses the `info@healthexps.com` mailbox for Industry Pulse and ad-hoc email.
- The exported configuration does not include the newsletter schedule, recipient list, template, content source, unsubscribe workflow, or send script.

## What must be collected before migration

1. Newsletter frequency and time zone.
2. Approved recipient source and list-management owner.
3. Current template, subject-line pattern, and content inputs.
4. Required CMS/carrier disclosures and internal compliance reviewer.
5. Whether recipients can unsubscribe or update preferences.
6. Existing send script and delivery/error reports.

## v2 implementation rules

1. Generate an email **draft** only; never send automatically.
2. Require an explicit approval tied to the exact subject, recipient count, and final body.
3. Send only to an approved, versioned recipient list.
4. Store send metadata, approval identity, recipient count, and provider message ID—never recipient email addresses or full body text in the audit log.
5. Use least-privilege mail credentials stored as Railway secrets.
6. Run a test send to a single internal mailbox before any group delivery.
7. Keep the legacy newsletter active until the v2 test delivery and reconciliation succeed.

No Agent Pulse newsletter schedule is seeded in v2 because its actual timing and recipient workflow are not present in the exported configuration.
