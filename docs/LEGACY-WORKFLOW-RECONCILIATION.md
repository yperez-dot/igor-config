# Legacy workflow reconciliation

This record distinguishes evidence observed directly on BOSGAME from workflows reported by the legacy Igor inventory. A reported workflow is not enabled in v2 until its runtime trigger and behavior are independently verified.

## Directly verified on BOSGAME

- OpenClaw gateway is active.
- Thirteen user-cron jobs are configured.
- Daily and weekly systemd backup timers are configured but their services are currently failing.
- Site health, SEO report, SEP email monitor, watchdog, Netlify rebuild, Sunfire refresh, content freshness, blog scheduler, broken-link scan, annual TPMO/IRMAA jobs, gateway restart, and session compaction appear in the live crontab.

## Reported by legacy Igor; verification still required

| Workflow | Reported trigger | Why it needs separate validation |
| --- | --- | --- |
| OpenClaw heartbeat | About every 30 minutes during active hours | It is gateway-native, not shown in `crontab`; it also has cost and quiet-hour behavior. |
| Carrier update monitoring | Heartbeat | It may update knowledge files and perform GitHub/deploy actions; v2 must not auto-publish or deploy. |
| Stale-lead digest | Sunday preview and Monday final | It is not in the observed user crontab and touches GHL lead/contact data. |
| Industry Pulse | Manual/ad-hoc daily or weekly request | Requires recipient, template, compliance, and send approval controls. |

## Design constraints for v2

- WhatsApp is not a v2 internal-agent target unless separately approved; Telegram remains the test channel.
- Discord is unused and out of scope.
- Any workflow that writes knowledge, pushes GitHub, triggers a deployment, generates agent documents, or sends email must begin in draft/report-only mode.
- Lead and client-contact workflows require data-minimization review before any connection is configured.

## Verified heartbeat carrier workflow

The live `HEARTBEAT.md` confirms that each legacy heartbeat scans the leadership inbox for carrier updates. When it finds one, it can edit the carrier knowledge base and Hub files, push changes to GitHub, redeploy the Hub, and send an immediate WhatsApp update.

This workflow is **not eligible for direct lift-and-shift**. The v2 replacement will split it into:

1. Read-only email detection and cited summary.
2. Draft knowledge/Hub changes.
3. Human approval of the exact diff and deployment target.
4. Approved publish/deploy and delivery confirmation.

The same approval rule applies to an instruction to “add this to the pulse.”
