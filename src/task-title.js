const WEEKDAYS = "sunday|monday|tuesday|wednesday|thursday|friday|saturday";

const LEADING_COMMAND_RES = [
  /^please[,.]?\s+/i,
  /^(?:can you|could you|would you)\s+(?:please\s+)?/i,
  /^(?:remind me|ping me|don['’]?t let me forget|set (?:a )?reminder)(?:\s+(?:to|for))?\s+/i,
  /^(?:add|create|make|new)\s+(?:a\s+|an\s+|the\s+)?(?:to-?do|todo|task|reminder)(?:\s+(?:for me|to me))?(?:\s+(?:to|for))?\s+/i,
  /^(?:to-?do|todo|task|reminder)\s+for me(?:\s+(?:to|for))?\s+/i,
  /^(?:for me|to me)\s+(?:to\s+)?/i,
  /^me\s+(?=(?:tomorrow|today|tonight|next\s+week|on\s+(?:next\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|at\s+\d))/i,
  /^(?:tomorrow|today|tonight|next\s+week)\s+(?:to\s+)?/i,
  /^(?:on\s+)?(?:next\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+(?:to\s+)?/i,
  /^(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\s+(?:to\s+)?/i,
  /^to\s+/i
];

const SCHEDULE_TOKEN_RE = new RegExp(
  String.raw`\b(?:please|tomorrow|today|tonight|next\s+week|on\s+(?:next\s+)?(?:${WEEKDAYS})|(?:${WEEKDAYS})|at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b`,
  "gi"
);

function collapseSpaces(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stripLeadingCommands(value) {
  let out = collapseSpaces(value);
  let changed = true;
  while (changed && out) {
    changed = false;
    for (const pattern of LEADING_COMMAND_RES) {
      const next = out.replace(pattern, "").trim();
      if (next !== out) {
        out = next;
        changed = true;
      }
    }
  }
  return out;
}

export function capitalizeActionTitle(value) {
  const trimmed = collapseSpaces(value);
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function sanitizePersonalTaskTitle(text, { fallback = "Reminder" } = {}) {
  let out = stripLeadingCommands(text);
  out = collapseSpaces(out.replace(SCHEDULE_TOKEN_RE, " "));
  out = out.replace(/^[,.:;\-–—]+|[,.:;\-–—]+$/g, "").trim();
  out = out.replace(/^(?:to|for)\s+/i, "").trim();
  return capitalizeActionTitle(out) || fallback;
}
