# Archived Vercel runtime

These files are historical reference and regression fixtures only. Production is
`cloudflare/src/worker.js`; do not deploy this directory or restore `/api` routes.
The shared public-data parser now lives in `cloudflare/src/permit-open-data.js`.
The Google Node authentication library is a development-only dependency for
archived-handler regression checks; the Worker validates Google tokens directly.

No Vercel account, project, Google sheet, or external backup was deleted.
