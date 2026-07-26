# Station URLs

Ready-to-paste URLs for Music Assistant, Sonos, VLC, Home Assistant.

Every station accepts a **friendly name** instead of the full Hebrew path, so
the URLs stay short. Names are matched loosely — case, spaces, quotes,
gershayim and Hebrew final-letter forms are all ignored, and each station has
many spellings (`sfirah`, `sefira`, `ספירה`, `vocal`, `וואקאלן`, `vochn` … all reach the
same folder). `?station=` and `?folder=` are interchangeable.

Add `&shuffle=0` to play alphabetically. Swap `/radio` for `/playlist.m3u` to get a
skippable playlist instead of a continuous station.

| Station | Stream URL | Also answers to |
| --- | --- | --- |
| שיינע מארשן | `https://stream-api.oitzerhanigunim.org/radio?station=marshn` | `marshen`, `marshin`, `marshim`, `marsh`, `march` … |
| לעבעדיג | `https://stream-api.oitzerhanigunim.org/radio?station=lebedik` | `lebedig`, `lebedick`, `lebbedik`, `lebbedig`, `levedik` … |
| שטייטע | `https://stream-api.oitzerhanigunim.org/radio?station=shteyt` | `shteyte`, `shteyteh`, `shteyta`, `shteytig`, `shteytige` … |
| בלויז מוזיק | `https://stream-api.oitzerhanigunim.org/radio?station=music` | `muzik`, `musik`, `muzic`, `miuzik`, `musics` … |
| ספירה / וואכן | `https://stream-api.oitzerhanigunim.org/radio?station=sfirah` | `sfira`, `sfirat`, `sfiras`, `sefirah`, `sefira` … |
| בין המצרים | `https://stream-api.oitzerhanigunim.org/radio?station=beinhametzarim` | `beinhametzorim`, `beinhametzurim`, `beinhamitzarim`, `beinhamitzorim`, `benhametzarim` … |
| ניגוני שב״ק | `https://stream-api.oitzerhanigunim.org/radio?station=shabbos` | `shabos`, `shabbas`, `shabas`, `shabbes`, `shabbess` … |
| מוצאי שב״ק | `https://stream-api.oitzerhanigunim.org/radio?station=motzeishabbos` | `motzeishabos`, `motzeishabbes`, `motzeishabbat`, `motzeishabat`, `motzaishabbos` … |
| ראש חודש | `https://stream-api.oitzerhanigunim.org/radio?station=roshchodesh` | `roshchoidesh`, `roshchoydesh`, `roshchodsh`, `roschodesch`, `roshchodash` … |
| ימים נוראים | `https://stream-api.oitzerhanigunim.org/radio?station=yomimnoroim` | `yomimnoraim`, `yomimnorayim`, `yomimnoroyim`, `yomimnaroim`, `yomimnoraiim` … |
| סוכות | `https://stream-api.oitzerhanigunim.org/radio?station=sukkos` | `sukkot`, `sukos`, `sukot`, `succos`, `succot` … |
| חנוכה | `https://stream-api.oitzerhanigunim.org/radio?station=chanukah` | `chanuka`, `chanukka`, `chanukkah`, `chanike`, `chanuke` … |
| פורים | `https://stream-api.oitzerhanigunim.org/radio?station=purim` | `purem`, `purym`, `poorim`, `pourim`, `purin` … |
| פסח | `https://stream-api.oitzerhanigunim.org/radio?station=pesach` | `pesah`, `pesakh`, `peysach`, `peisach`, `paysach` … |
| ל״ג בעומר | `https://stream-api.oitzerhanigunim.org/radio?station=lagbomer` | `lagbaomer`, `lagbeomer`, `lagbomeer`, `lagboymer`, `lagboimer` … |
| שבועות | `https://stream-api.oitzerhanigunim.org/radio?station=shavuos` | `shavuot`, `shavuoth`, `shavous`, `shavuois`, `shvuos` … |

Full alias list for any station: `GET /stations` returns them all as JSON.

## Notes

- A station is one fixed folder. The website switches folders by day/time in
  the browser (`TIME_BASED_FOLDERS`); that does not apply here, so add the
  weekday and שבת folders as two stations if you need both.
- Unrecognised values are treated as a literal R2 path, so older
  `?folder=<full path>` URLs keep working unchanged.
- `folder` matches recursively, so `?folder=מועדים וזמנים` (URL-encoded) is a
  single station covering every occasion at once.
- The stream reconnects roughly every 3 hours, between tracks. See README.
