# sample-cloud/

The web backend's **cloud storage** — one of the three real filesystem sources
the Add-context *Files / Photos / Folder* types are served from (see
[`contract/fs.ts`](../contract/fs.ts) and [`server/fs.ts`](../server/fs.ts)).

This is a **real directory the server reads** with `fs` and serves over
`/api/v1/fs/*?source=cloud` — not a fixture. It's committed so the demo is
deterministic and identical in every clone; point `CONTEXT_CLOUD_ROOT` at another
directory to serve real cloud/workspace storage instead.

Layout the scanner expects (one level): loose **files** (`.md` / `.csv` / `.json`
/ …) become the Files catalog, top-level **images** (`.svg` here — real bytes,
rendered as `<img>`) become Photos, and sub-**folders** become the Folder catalog
(each scans into its files as workspace artifacts).

Unlike a runner host or the UI host, cloud storage is available on **both**
backends — it's the only filesystem source a bare remote web server can offer.
