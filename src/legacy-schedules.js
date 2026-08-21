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
    id: "legacy-uptime-monitor",
    title: "Uptime monitor",
    taskType: "daily_operations",
    cron: "*/5 * * * *",
    timezone: "America/New_York",
    payload: { workflow: "uptime_monitor", mode: "shadow" }
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
    id: "legacy-notion-dashboard",
    title: "Notion dashboard refresh",
    taskType: "daily_operations",
    cron: "0 6-22/3 * * *",
    timezone: "America/New_York",
    payload: { workflow: "notion_dashboard", mode: "shadow" }
  },
  {
    id: "legacy-blog-publish",
    title: "Weekly blog publishing workflow",
    taskType: "content_draft",
    cron: "0 9 * * 3",
    timezone: "America/New_York",
    payload: { workflow: "blog_publish", mode: "shadow" }
  },
  {
    id: "legacy-platform-update-check",
    title: "Weekly platform update check",
    taskType: "daily_operations",
    cron: "0 9 * * 1",
    timezone: "America/New_York",
    payload: { workflow: "platform_update_check", mode: "shadow" }
  }
];
