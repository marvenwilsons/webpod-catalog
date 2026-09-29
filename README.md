# WebPod catalog

Ready-made content for WebPod's Pod Designer: page and section **templates**,
reusable **components** (widgets and data building blocks) and, soon,
**documents**. A fresh WebPod ships without any of it. It reads this catalog
when someone opens the template picker or builds an app, and it saves only
what they pick.

## How WebPods read it

Each WebPod reads `catalog.json` from a pinned version of this repository
through jsDelivr's free CDN:

```
https://cdn.jsdelivr.net/gh/marvenwilsons/webpod-catalog@v1/catalog.json
```

`catalog.json` lists every item with its size and sha256. A WebPod downloads
an item's file only when someone picks it. It checks the hash, validates the
content and refuses items that need features it does not support (see
`requires`).

## Layout

```
catalog.json            index: every item, its file, size, sha256, preview or props
templates/<id>.json     finished pages and sections (fill an empty layout)
components/<id>.json    components (placed with props; each copy keeps its own state)
documents/<id>.json     page-sized documents (coming)
scripts/validate.mjs    the check CI runs on every push
```

Every item file has the same shape:

```json
{
  "schema": "webpod-catalog-item/1",
  "id": "hero-photo",
  "kind": "template",
  "title": "Hero — photo with overlay",
  "description": "…",
  "tags": ["hero"],
  "requires": ["pod-designer-snapshot/1"],
  "content": { "blocks": { … } }
}
```

`content` is an ordinary Pod Designer snapshot, so anything here can be opened
and restyled in Pod Designer after it is installed.

## Updating the catalog

Most items come from the WebPod repository. From your `webpod.io` checkout:

```
node scripts/export-catalog.cjs ../webpod-catalog
cd ../webpod-catalog
node scripts/validate.mjs
git add -A
git commit -m "Update catalog"
git push
```

Never edit an item file by hand without re-running the export. The size and
hash in `catalog.json` must match the file byte for byte, and the check fails
if they don't.

## Publishing a version

WebPods read a **tag**, not the main branch, so pushing to `main` changes
nothing until you tag it:

1. Raise `version` in `catalog.json` (and `package.json`): `1.0.0` → `1.1.0`
   for new items, `2.0.0` for changes older WebPods can't read.
2. Commit and push.
3. Tag and push the tag:
   ```
   git tag v1.1.0
   git push origin v1.1.0
   ```

WebPods pinned to `@v1` pick up any `v1.x.x` tag within about a day (jsDelivr
caches). A new major version (`v2`) is used only by WebPods configured for it.

## Safety

The check refuses script tags and `javascript:` links, and it warns about
network calls and plain-http links. It lists every external host the content
references (today only `images.unsplash.com`, for sample photos). WebPod runs
its own checks again before installing anything.
