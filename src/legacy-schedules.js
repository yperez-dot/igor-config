export const legacySchedules = [
  {
    id: "legacy-site-health-daily",
    title: "Daily site health check",
    taskType: "daily_operations",
    cron: "0 7 * * *",
    timezone: "America/New_York",
    payload: { workflow: "site_health", mode: "shadow" }
  },
  {
    id: "legacy-seo-weekly",
    title: "Weekly SEO report",
    taskType: "daily_operations",
    cron: "0 7 * * 1",
    timezone: "America/New_York",
    payload: { workflow: "seo_weekly", mode: "shadow" }
  },
  {
    id: "legacy-sep-email-monitor",
    title: "HealthSpring SEP email monitor",
    taskType: "daily_operations",
    cron: "0 9,15 * * *",
    timezone: "America/New_York",
    payload: { workflow: "sep_email_monitor", mode: "shadow" }
  },
  {
    id: "legacy-igor-watchdog",
    title: "Igor watchdog",
    taskType: "daily_operations",
    cron: "*/5 * * * *",
    timezone: "America/New_York",
    payload: { workflow: "igor_watchdog", mode: "shadow" }
  },
  {
    id: "legacy-netlify-rebuild",
    title: "Nightly Netlify rebuild",
    taskType: "daily_operations",
    cron: "0 2 * * *",
    timezone: "America/New_York",
    payload: { workflow: "netlify_rebuild", mode: "shadow" }
  },
  {
    id: "legacy-sunfire-login",
    title: "Sunfire session refresh",
    taskType: "daily_operations",
    cron: "0 6 * * 1",
    timezone: "America/New_York",
    payload: { workflow: "sunfire_login", mode: "shadow" }
  },
  {
    id: "legacy-content-freshness",
    title: "Content freshness check",
    taskType: "daily_operations",
    cron: "0 8 * * 0",
    timezone: "America/New_York",
    payload: { workflow: "content_freshness", mode: "shadow" }
  },
  {
    id: "legacy-blog-publish-scheduler",
    title: "Blog publishing scheduler",
    taskType: "content_draft",
    cron: "0 0 * * *",
    timezone: "America/New_York",
    payload: { workflow: "blog_publish_scheduler", mode: "shadow" }
  },
  {
    id: "legacy-broken-link-scanner",
    title: "Broken-link scanner",
    taskType: "daily_operations",
    cron: "0 6 * * 6",
    timezone: "America/New_York",
    payload: { workflow: "broken_link_scanner", mode: "shadow" }
  },
  {
    id: "legacy-tpmo-annual-check",
    title: "Annual TPMO check",
    taskType: "compliance_research",
    cron: "0 9 1 10 *",
    timezone: "America/New_York",
    payload: { workflow: "tpmo_annual_check", mode: "shadow" }
  },
  {
    id: "legacy-irmaa-reminder",
    title: "Annual IRMAA reminder",
    taskType: "daily_operations",
    cron: "0 9 14 8 *",
    timezone: "America/New_York",
    payload: { workflow: "irmaa_reminder", mode: "shadow" }
  },
  {
    id: "legacy-session-compaction",
    title: "Legacy session compaction",
    taskType: "daily_operations",
    cron: "30 3 * * *",
    timezone: "America/New_York",
    payload: { workflow: "session_compaction", mode: "shadow" }
  }
];
