# NCH Medicare Advantage 2027 — ready to publish

The article is written and verified locally. This Cursor environment **cannot push to `yperez-dot/healthexps-www`** (GitHub token is scoped to `igor-config` only). Apply the patch there to put it live on healthexps.com.

## Live URLs after merge to `healthexps-www` main

- English: https://www.healthexps.com/blog/nch-drops-cigna-wellcare-medicare-advantage-2027/
- Spanish: https://www.healthexps.com/es/blog/nch-deja-cigna-wellcare-medicare-advantage-2027/

## Apply (from a machine that can write to healthexps-www)

```bash
git clone https://github.com/yperez-dot/healthexps-www.git
cd healthexps-www
git checkout -b cursor/nch-medicare-advantage-2027-5214
git am /path/to/igor-config/site-publish/nch-medicare-advantage-2027/healthexps-www.patch
git push -u origin cursor/nch-medicare-advantage-2027-5214
```

Then open a PR into `main`. Netlify deploys on merge to `main`.

## What the patch contains

- EN post: `blog/nch-drops-cigna-wellcare-medicare-advantage-2027.md`
- ES post: `es/blog/nch-deja-cigna-wellcare-medicare-advantage-2027.md`
- Cards at the top of `/blog/` and `/es/blog/`
- Sitemap + hreflang entries

Copy keeps the approved piece: NCH drops Cigna and Wellcare MA on Jan 1, 2027; Original Medicare / Medigap / in-network MA still work; we do not pick the plan; AEP Oct 15–Dec 7, 2026; check the 2027 directory, not last year’s. Source: Gulf Coast News / NCH, Aug 26, 2026.
