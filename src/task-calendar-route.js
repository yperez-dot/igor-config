const GHL_TASK_RE = /\b(?:ghl|crm|go\s*high\s*level|xclusive)(?:\s+contact)?\s+task\b|\b(?:contact|follow[- ]?up)\s+task\b|\b(?:create|add|make|set(?:\s+up)?)\s+(?:a|an|the)\s+(?:ghl\s+|crm\s+|go\s*high\s*level\s+|xclusive\s+|contact\s+)?task\b|\btask\s+due\b|\btask\s+on\s+(?:that|this|the)\s+contact\b|\btask\s+(?:on|for)\s+[A-Za-z]/i;
const GHL_APPOINTMENT_RE = /\b(?:ghl|crm|go\s*high\s*level|xclusive)\s+appoint/i;
const EXPLICIT_CALENDAR_RE = /\b(?:google\s+)?calendar\b|\bappoint(?:ment|ments)?\b|\bappt\b|\bmeeting\b|\bbook\s+\d+\s*min|\bput\s+(?:it\s+)?on\s+(?:my|mine|the)\s+calendar\b|\bput mine\b|\bcalendar\s+(?:hold|event|reminder)\b|\bhold\s+on\s+(?:my|the)\s+calendar\b|\b(?:am i free|what.?s on my calendar)\b|\bschool\s+pick\s*up\b/i;
const AMBIGUOUS_FOLLOWUP_RE = /\b(?:create|add|make|set)\s+(?:a|an|the)\s+follow[- ]?up\b/i;
const PERSONAL_REMINDER_RE = /\bremind me\b|\bset (?:a )?reminder\b/i;
const SMOKE_LEAD_RE = /\b(?:smoke\s*test|test\s+contact|qa\s+test|dummy\s+(?:contact|lead)|fake\s+contact)\b/i;

export const CALENDAR_WRITE_TOOLS = new Set([
  "calendar_create_event",
  "calendar_update_event",
  "calendar_delete_event"
]);

export function isGhlContactTaskRequest(text) {
  return GHL_TASK_RE.test(String(text ?? ""));
}

export function isExplicitCalendarRequest(text) {
  const raw = String(text ?? "");
  if (GHL_APPOINTMENT_RE.test(raw)) return false;
  return EXPLICIT_CALENDAR_RE.test(raw);
}

export function resolveTaskCalendarRoute(text) {
  const raw = String(text ?? "");
  const task = isGhlContactTaskRequest(raw);
  const calendar = isExplicitCalendarRequest(raw);
  if (task && calendar) return "ghl_task_prefer";
  if (task) return "ghl_task";
  if (calendar) return "calendar";
  if (AMBIGUOUS_FOLLOWUP_RE.test(raw) && !PERSONAL_REMINDER_RE.test(raw)) return "ghl_task_prefer";
  return "unspecified";
}

export function blocksCalendarWrite(text) {
  const raw = String(text ?? "");
  if (GHL_APPOINTMENT_RE.test(raw)) return true;
  const route = resolveTaskCalendarRoute(raw);
  return route === "ghl_task" || route === "ghl_task_prefer";
}

export function toolsForUserRequest(tools, text) {
  if (!blocksCalendarWrite(text)) return tools;
  return (tools ?? []).filter((tool) => !CALENDAR_WRITE_TOOLS.has(tool?.function?.name ?? tool?.name));
}

export function toolChoiceForUserRequest(text, tools = []) {
  if (!blocksCalendarWrite(text)) return "auto";
  const names = (tools ?? []).map((tool) => tool?.function?.name ?? tool?.name);
  if (names.includes("ghl_create_contact_task")) {
    return { type: "function", function: { name: "ghl_create_contact_task" } };
  }
  return "auto";
}

export function taskCalendarRoutingPrompt(text) {
  const route = resolveTaskCalendarRoute(text);
  if (route === "ghl_task") {
    return [
      "## Hard routing for this turn",
      "This request is a GoHighLevel / Xclusive CRM contact task, not a Google Calendar event or reminder.",
      "Call ghl_create_contact_task without confirmed and preview the contact, title, due date, and assignee.",
      "Do not call calendar_create_event, calendar_update_event, or calendar_delete_event.",
      "Do not create a Telegram/personal ledger reminder instead of the GHL task."
    ].join("\n");
  }
  if (route === "ghl_task_prefer") {
    return [
      "## Hard routing for this turn",
      "Prefer a GoHighLevel / Xclusive CRM contact task (ghl_create_contact_task) over Google Calendar.",
      "Do not invent a calendar event. After previewing the GHL task, ask one short question only if they also wanted something on the calendar."
    ].join("\n");
  }
  return "";
}

export function calendarWriteBlockedResult(name) {
  return {
    error: "ghl_task_not_calendar",
    tool: name,
    hint: "This request is a GHL/CRM contact task. Use ghl_create_contact_task. Do not create, update, or delete a Google Calendar event."
  };
}

export function isSmokeOrMetaLeadSubject(subject) {
  const raw = String(subject ?? "").trim();
  if (!raw) return true;
  if (isGhlContactTaskRequest(raw)) return true;
  if (SMOKE_LEAD_RE.test(raw)) return true;
  if (/^(?:reminder|untitled(?: task)?|follow up\s*\/\s*overdue)$/i.test(raw)) return true;
  if (/\bcreate\s+(?:a\s+)?task\s+on\s+(?:that|this|the)\s+contact\b/i.test(raw)) return true;
  return false;
}

export function isSmokeOrMetaGhlTask(task = {}) {
  const blob = [task.title, task.name, task.body, task.description, task.contactName, task.contact]
    .filter(Boolean)
    .join(" ");
  return isSmokeOrMetaLeadSubject(blob);
}
