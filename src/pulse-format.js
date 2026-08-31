export const PULSE_LOGO_URL = "https://agentmedicarehub.com/thei-logo.png";
export const PULSE_LOGO_CID = "thei-logo";

const FLAG_EMOJI = {
  ACTION: "🚨",
  IMPORTANT: "📋",
  FYI: "📰",
  FLORIDA: "🌴"
};

const COPY = {
  en: {
    lang: "en",
    issuePrefix: "ISSUE",
    greeting: "Happy Monday, team! 👋",
    greetingRe: /happy monday|hey team/i,
    weekOf: "Week of",
    theWeekIn: "The Week in",
    medicare: "Medicare",
    forward: "📬 Reading THE Health Experts Insider? If a colleague would benefit, please forward it on!",
    weekBanner: "— THE WEEK IN MEDICARE —",
    meaning: "What this means for you:",
    source: "Source:",
    minuteRead: (n) => `${n}-minute read`,
    watch: "— WHAT TO WATCH THIS WEEK —",
    sourcesReviewed: "SOURCES REVIEWED",
    footer: "You're receiving this because you're a contracted agent with The Health Experts Insurance.<br><br><b>Questions? Tips? Carrier intel to share?</b> Reply to this email.",
    tagline: "Making Healthcare Easy",
    flags: { ACTION: "ACTION", IMPORTANT: "IMPORTANT", FYI: "FYI", FLORIDA: "FLORIDA" },
    correctionRe: /corrected version/i
  },
  es: {
    lang: "es",
    issuePrefix: "EDICIÓN",
    greeting: "¡Feliz lunes, equipo! 👋",
    greetingRe: /feliz lunes|hola equipo/i,
    weekOf: "Semana del",
    theWeekIn: "La semana en",
    medicare: "Medicare",
    forward: "📬 ¿Lees THE Health Experts Insider? Si un colega se beneficiaría, ¡reenvíalo!",
    weekBanner: "— LA SEMANA EN MEDICARE —",
    meaning: "Qué significa esto para ti:",
    source: "Fuente:",
    minuteRead: (n) => `lectura de ${n} minutos`,
    watch: "— QUÉ VIGILAR ESTA SEMANA —",
    sourcesReviewed: "FUENTES REVISADAS",
    footer: "Recibes esto porque eres un agente contratado de The Health Experts Insurance.<br><br><b>¿Preguntas? ¿Tips? ¿Intel de carriers para compartir?</b> Responde a este correo.",
    tagline: "Haciendo la salud fácil",
    flags: { ACTION: "ACCIÓN", IMPORTANT: "IMPORTANTE", FYI: "PARA TU INFO", FLORIDA: "FLORIDA" },
    correctionRe: /versi[oó]n corregida|corrected version/i
  }
};

export function pulseCopy(locale = "en") {
  return COPY[locale] ?? COPY.en;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[<>&"]/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;"
  })[char]);
}

export function issueBadge(issue, locale = "en") {
  const number = Number(issue);
  const prefix = pulseCopy(locale).issuePrefix;
  if (!Number.isInteger(number) || number < 1) return `${prefix} 000`;
  return `${prefix} ${String(number).padStart(3, "0")}`;
}

function extractJson(raw) {
  const trimmed = String(raw ?? "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function richText(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<b style="background:#FBEFC8;">$1</b>');
}

function paragraphs(value) {
  const chunks = String(value ?? "").split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean);
  if (!chunks.length) return "";
  return chunks.map((chunk) => `<p>${richText(chunk).replace(/\n/g, "<br>")}</p>`).join("");
}

function normalizeFlag(flag) {
  const raw = String(flag ?? "FYI")
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Z]/g, "");
  if (FLAG_EMOJI[raw]) return raw;
  if (raw === "ACCION") return "ACTION";
  if (raw === "IMPORTANTE") return "IMPORTANT";
  if (raw === "PARATUINFO" || raw === "INFO") return "FYI";
  return "FYI";
}

function normalizeItem(item = {}) {
  const beat = String(item.beat ?? "OPS").toUpperCase();
  const headline = String(item.headline ?? "").trim();
  if (!headline) return null;
  const minutes = Number(item.minutes);
  return {
    flag: normalizeFlag(item.flag),
    beat: beat.replace(/[^A-Z]/g, "").slice(0, 12) || "OPS",
    headline: headline.slice(0, 200),
    minutes: Number.isInteger(minutes) && minutes > 0 ? minutes : 2,
    body: String(item.body ?? "").trim(),
    meaning: String(item.meaning ?? "").trim(),
    source: String(item.source ?? "").trim()
  };
}

function withSignoff(intro, locale = "en") {
  const copy = pulseCopy(locale);
  const lines = intro.map((line) => String(line).trim()).filter(Boolean);
  if (!lines.length) lines.push(copy.greeting);
  if (!copy.greetingRe.test(lines[0])) {
    lines.unshift(copy.greeting);
  }
  if (!lines.some((line) => /yahoska/i.test(line))) {
    lines.push("— Yahoska & Katy");
  }
  return lines;
}

export function parseInsiderIssue(raw, { emptyScan: _emptyScan = false, locale = "en" } = {}) {
  const parsed = extractJson(raw);
  const intro = parsed
    ? (Array.isArray(parsed.intro) ? parsed.intro : [parsed.intro]).filter(Boolean)
    : String(raw ?? "").split(/\n{2,}/).map((line) => line.trim()).filter(Boolean);
  const items = parsed
    ? (Array.isArray(parsed.items) ? parsed.items : []).map(normalizeItem).filter(Boolean)
    : [];
  const watch = parsed && Array.isArray(parsed.watch)
    ? parsed.watch.map((row) => ({
      title: String(row?.title ?? "").trim(),
      detail: String(row?.detail ?? row?.body ?? "").trim()
    })).filter((row) => row.title)
    : [];
  const sources = String(parsed?.sources ?? "CMS Newsroom, KFF, public industry sources this week").trim();
  return {
    preheader: String(parsed?.preheader ?? items[0]?.headline ?? "THE Health Experts Insider").slice(0, 160),
    intro: withSignoff(intro, locale),
    items,
    watch,
    sources
  };
}

export function insiderPlainText(issue, locale = "en") {
  const copy = pulseCopy(locale);
  const lines = [
    issue.intro.join("\n\n"),
    "",
    copy.weekBanner,
    ...issue.items.flatMap((item) => [
      "",
      `${FLAG_EMOJI[item.flag]} ${copy.flags[item.flag] ?? item.flag} · ${item.beat}`,
      item.headline,
      item.body,
      item.meaning ? `${copy.meaning} ${item.meaning}` : "",
      item.source ? `${copy.source} ${item.source}` : ""
    ]),
    issue.watch.length ? `\n${copy.watch}` : "",
    ...issue.watch.map((row) => `• ${row.title}${row.detail ? `: ${row.detail}` : ""}`),
    "",
    `${copy.sourcesReviewed}: ${issue.sources}`
  ];
  return lines.filter((line) => line !== "").join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function itemRows(items, copy) {
  return items.map((item) => {
    const flagLabel = copy.flags[item.flag] ?? item.flag;
    const source = item.source
      ? `<p style="margin:14px 0 0 0;font-family:Georgia,'Times New Roman',serif;font-size:13px;color:#8A8A8A;font-style:italic;">${escapeHtml(copy.source)} ${richText(item.source)}</p>`
      : "";
    const meaning = item.meaning
      ? `<div style="background:#FBEFC8;border-radius:6px;padding:18px 22px;margin:18px 0 0 0;font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#2A2A2A;line-height:1.55;"><p><b style="color:#3D1560;">${escapeHtml(copy.meaning)}</b> ${richText(item.meaning)}</p></div>`
      : "";
    return `<tr>
  <td style="padding:28px 36px;border-bottom:1px solid #E5E0EA;">
    <p style="margin:0 0 8px 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#D6006C;font-weight:700;letter-spacing:2px;">
      <span style="font-size:14px;letter-spacing:0;">${FLAG_EMOJI[item.flag]}</span>&nbsp;&nbsp;${escapeHtml(flagLabel)} · ${escapeHtml(item.beat)}
    </p>
    <h2 style="margin:0 0 6px 0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.25;color:#3D1560;font-weight:700;">${escapeHtml(item.headline)}</h2>
    <p style="margin:0 0 14px 0;font-family:Georgia,'Times New Roman',serif;font-size:13px;color:#8A8A8A;font-style:italic;">${escapeHtml(copy.minuteRead(item.minutes))}</p>
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#2A2A2A;line-height:1.6;">${paragraphs(item.body)}</div>
    ${meaning}
    ${source}
  </td>
</tr>`;
  }).join("\n");
}

function watchRow(watch, copy) {
  if (!watch.length) return "";
  const items = watch.map((row) => {
    const title = escapeHtml(row.title);
    const detail = row.detail ? ` ${richText(row.detail)}` : "";
    return `<li style="margin:0 0 8px 0;"><b>${title}</b>${detail ? `:${detail}` : ""}</li>`;
  }).join("");
  return `<tr>
  <td style="padding:28px 36px;border-bottom:1px solid #E5E0EA;">
    <p style="margin:0 0 14px 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#D6006C;font-weight:700;letter-spacing:2px;">${escapeHtml(copy.watch)}</p>
    <ul style="margin:0;padding:0 0 0 22px;font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#2A2A2A;line-height:1.6;">${items}</ul>
  </td>
</tr>`;
}

export function renderInsiderEmail({
  issueNumber,
  weekLabel,
  parsed,
  logoSrc = PULSE_LOGO_URL,
  correctionNote = "",
  locale = "en"
} = {}) {
  const copy = pulseCopy(locale);
  const introHtml = parsed.intro.map((line) => `<p>${richText(line)}</p>`).join("");
  const correctionRow = String(correctionNote ?? "").trim()
    ? `<tr>
          <td style="background:#D6006C;padding:16px 36px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#FFFFFF;line-height:1.5;font-weight:700;">
            ${escapeHtml(correctionNote)}
          </td>
        </tr>`
    : "";
  return `<!DOCTYPE html>
<html lang="${copy.lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>THE Health Experts Insider</title>
</head>
<body style="margin:0;padding:0;background:#EDE8F0;">
  <span style="display:none !important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(parsed.preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EDE8F0;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background:#FFFFFF;border-radius:8px;overflow:hidden;">
        <tr>
          <td style="padding:28px 36px 22px 36px;border-bottom:2px solid #D6006C;text-align:left;">
            <img src="${escapeHtml(logoSrc)}" alt="The Health Experts Insurance" width="360" style="display:block;width:360px;max-width:100%;height:auto;border:0;outline:none;">
          </td>
        </tr>
        ${correctionRow}
        <tr>
          <td style="background:#FBEFC8;padding:14px 36px;font-family:Georgia,'Times New Roman',serif;font-size:14px;color:#3D1560;line-height:1.5;">
            ${escapeHtml(copy.forward)}
          </td>
        </tr>
        <tr>
          <td style="background:#2A0E45;padding:48px 36px;text-align:center;">
            <p style="margin:0 0 14px 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#FFFFFF;letter-spacing:3px;font-weight:700;opacity:0.85;">${escapeHtml(copy.weekOf)} ${escapeHtml(weekLabel)} &nbsp;·&nbsp; ${issueBadge(issueNumber, locale)}</p>
            <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:30px;color:#FFFFFF;line-height:1;">${escapeHtml(copy.theWeekIn)}</p>
            <p style="margin:6px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-weight:900;font-size:56px;color:#E6007E;line-height:1;letter-spacing:-1px;">${escapeHtml(copy.medicare)}</p>
            <div style="width:60px;height:3px;background:#E6007E;margin:18px auto 0 auto;"></div>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 36px 8px 36px;font-family:Georgia,'Times New Roman',serif;font-size:16px;color:#2A2A2A;line-height:1.6;">
            ${introHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:8px 36px 24px 36px;text-align:center;">
            <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#D6006C;letter-spacing:3px;font-weight:700;">${escapeHtml(copy.weekBanner)}</p>
          </td>
        </tr>
        ${itemRows(parsed.items, copy)}
        ${watchRow(parsed.watch, copy)}
        <tr>
          <td style="padding:24px 36px 32px 36px;">
            <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#8A8A8A;letter-spacing:1.5px;">${escapeHtml(copy.sourcesReviewed)}</p>
            <p style="margin:8px 0 0 0;font-family:Georgia,'Times New Roman',serif;font-size:13px;color:#8A8A8A;line-height:1.55;">${escapeHtml(parsed.sources)}</p>
          </td>
        </tr>
        <tr>
          <td style="background:#2A0E45;padding:32px 36px;text-align:center;">
            <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:14px;color:#FFFFFF;line-height:1.6;">
              ${copy.footer}
            </p>
            <p style="margin:18px 0 0 0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:14px;color:#E6007E;">${escapeHtml(copy.tagline)}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
`;
}

export function wrapHubPulsePage({ weekLabel, innerHtml }) {
  const title = `THEI Agent Pulse — Week of ${weekLabel}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<script>
(function(){
  if (new URLSearchParams(window.location.search).get('preview') === 'THEI') return;
  try {
    var s = JSON.parse(localStorage.getItem('hub_session') || 'null');
    if (!s || !s.token || s.expires < Date.now()) { localStorage.removeItem('hub_session'); window.location.replace('/login.html'); }
  } catch(e) { window.location.replace('/login.html'); }
})();
function logout(){localStorage.removeItem('hub_session');window.location.replace('/login.html');}
</script>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Inter',Arial,sans-serif;background:#F6F5F8;}
.top-bar{background:#fff;border-bottom:1px solid #E7E4ED;display:flex;flex-direction:row;align-items:center;justify-content:space-between;padding:12px 32px;gap:16px;}
.logo-wrap img{height:52px;width:auto;display:block;}
.pill-nav{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
.pill-nav a{display:inline-block;padding:9px 20px;border:1.5px solid #E7E4ED;border-radius:999px;font:600 13px/1 Arial,sans-serif;color:#452068;text-decoration:none;}
.back-bar{background:#452068;padding:10px 24px;display:flex;align-items:center;gap:16px;}
.back-bar a{color:#fff;text-decoration:none;font:600 13px/1 Arial,sans-serif;opacity:.85;}
.email-wrap{max-width:680px;margin:24px auto 48px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);}
@media(max-width:600px){.email-wrap{margin:0;border-radius:0;}}
</style>
<link rel="stylesheet" href="/hub-nav.css">
<script src="/hub-nav.js" defer></script>
</head>
<body>
<div class="top-bar">
  <div class="logo-wrap"><img src="/thei-logo.png" alt="THEI"></div>
  <nav class="pill-nav">
    <a href="/home">Agent Dashboard</a>
    <a href="/pulse-library">Pulse Library</a>
    <a href="#" onclick="logout()" style="color:#D6336C;border-color:#F5C0C0;">Sign Out</a>
  </nav>
</div>
<div class="back-bar">
  <a href="/pulse-library">← Pulse Library</a>
  <span style="color:rgba(255,255,255,.3);">|</span>
  <a href="/agent-pulse">Agent Pulse</a>
</div>
<div class="email-wrap">
${innerHtml}
</div>
</body>
</html>
`;
}

export function buildInsiderEdition({
  raw,
  issueNumber,
  weekLabel,
  emptyScan = false,
  logoSrc = PULSE_LOGO_URL,
  hubLogoSrc = "/thei-logo.png",
  correctionNote = "",
  locale = "en"
} = {}) {
  const copy = pulseCopy(locale);
  const parsed = parseInsiderIssue(raw, { emptyScan, locale });
  const note = String(correctionNote ?? "").trim();
  if (note && !parsed.intro.some((line) => copy.correctionRe.test(line))) {
    const insertAt = copy.greetingRe.test(parsed.intro[0] ?? "") ? 1 : 0;
    parsed.intro.splice(insertAt, 0, note);
  }
  const html = renderInsiderEmail({ issueNumber, weekLabel, parsed, logoSrc, correctionNote: note, locale });
  return {
    parsed,
    text: insiderPlainText(parsed, locale),
    html,
    hubHtml: wrapHubPulsePage({
      weekLabel,
      innerHtml: renderInsiderEmail({ issueNumber, weekLabel, parsed, logoSrc: hubLogoSrc, correctionNote: note, locale })
    }),
    headline: parsed.preheader
  };
}

export async function pulseLogoAttachment({ fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(PULSE_LOGO_URL, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) return null;
    return {
      filename: "thei-logo.png",
      content: bytes,
      type: "image/png",
      cid: PULSE_LOGO_CID
    };
  } catch {
    return null;
  }
}
