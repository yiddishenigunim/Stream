# Open work

Last checked 2026-11-04. Remove an item when it is done.

- **Hotline URLs with `&gain=4.5`?** (since 2026-08-19) Claude asked whether to
  append `&gain=4.5` to the station URLs in the Tel Tech portal; no answer in
  the chat. Ask the owner whether it was done, and whether the hotline still
  sounds quiet now that even volume is live.
- **Bot Fight Mode** (since 2026-07-06) — unknown whether it was turned off /
  a WAF Skip rule added for `stream-api.oitzerhanigunim.org`. Only matters if
  big uploads in `/manage` fail again.
- **`/manage` is not really protected.** The PIN is in the page source and the
  write API is open. Optional `ADMIN_TOKEN` (worker secret, name only) exists in
  the code but is not wired into the page. Not requested by the owner.
- **Live broadcast for the hotline** — only if the partner wants every caller
  to hear the same track (Icecast/AzuraCast). Not requested.
- **Music on hold for satmarsem.org** (since 2026-11-04) — an office
  (mail@satmarsem.org) asked the partner how to use the music on their office
  hold line; the owner asked whether there is a way. Answer given: stream URL
  if their phone system takes one, otherwise uploaded files. Unknown: which
  phone system they use, and whether the partner wants to allow it. If many
  need upload-only, offer a route that hands out one ready ~10–15 min MP3.
