# Website publish — healthexps.com

**Repo:** `yperez-dot/healthexps-www`  
**Live:** https://www.healthexps.com  
**Deploy:** push / merge to `main` → Netlify (Eleventy build)

Igor posts blogs and site changes **in that repo**, not in `igor-config`. This file is the standing playbook so a Cloud Agent can do it without asking.

---

## Access (required)

See [IGOR-ACCESS.md](IGOR-ACCESS.md). Short version: start (or attach) Igor on an environment that **includes** `healthexps-www`. A chat started only on `igor-config` cannot push the site — `cursor[bot]` will 403 even though the same bot pushed `healthexps-www` the day before from a website-repo agent.

Do not dump the article into `igor-config` and call it live.

---

## When Yahoska says “post it” / “put it live”

1. Work in `healthexps-www`, branch `cursor/<slug>-5214` (or the run’s branch suffix).
2. Add the post (below).
3. `npm test && npx @11ty/eleventy`
4. Commit, push, open a PR into `main`. Merge/deploy is what makes it live.
5. After Netlify finishes: open the live URL, then `/blog/` (and `/es/blog/` if there is a Spanish twin). Confirm the card and the article. Do not mark done on code inspection alone.

---

## New blog post (Eleventy `.md`)

**English**

- File: `blog/<slug>.md`
- Front matter must include:

```yaml
layout: layouts/blog-post.njk
category: "Medicare"
title: "SEO title (~50–60 chars)"
description: "155-char meta. No plan pick."
date: 2026-09-01T12:00:00.000Z
lang: en
permalink: /blog/<slug>/
```

Use noon UTC on the publish date so the byline is that calendar day in Eastern time (`date: YYYY-MM-DD` alone shifts back a day).

- `hreflang_es: /es/blog/<es-slug>/` when a Spanish twin exists.
- H1 in the body. Keep Yahoska’s wording when she supplied the piece.
- Mid-article `inline-cta` + bottom `bottom-cta` (see existing posts).
- Internal links (AEP, Advantage, Supplement, contact) — no plan recommendation.
- Source line when it is news.

**Spanish** (same facts, `layout: layouts/blog-post-es.njk`, `permalink: /es/blog/<es-slug>/`, `hreflang_en: <en-slug>`).

**Listing** — `/blog/` and `/es/blog/` are static HTML. Insert a `.blog-card` at the **top** of `#blogGrid`. `card-date` must be `YYYY-MM-DD`. Future dates are stripped at build; today’s date shows.

**Sitemap** — add both URLs plus `xhtml:link` hreflang pairs in `sitemap.xml`.

**Do not**

- Push placeholder copy (`Content unavailable`, lorem).
- Recommend a plan, carrier, or “best” option. Licensed agent walks it. We do not pick the plan.
- Ship without header/nav, footer, GA4 `G-SJSGF3E9MD`, canonical, scroll-to-top (the `.njk` layouts already have these).

---

## Queued: NCH Cigna / Wellcare 2027

Approved copy is ready. Apply from `igor-config` if it is not already on `healthexps-www`:

`site-publish/nch-medicare-advantage-2027/healthexps-www.patch`

Live URLs after merge to `healthexps-www` `main`:

- https://www.healthexps.com/blog/nch-drops-cigna-wellcare-medicare-advantage-2027/
- https://www.healthexps.com/es/blog/nch-deja-cigna-wellcare-medicare-advantage-2027/
