# Station URLs

Ready-to-paste URLs for Music Assistant, Sonos, VLC, Home Assistant.

Every station accepts a **friendly name** instead of the full Hebrew path, so
the URLs stay short. Names are matched loosely — case, spaces, quotes,
gershayim and Hebrew final-letter forms are all ignored, and each station has
many spellings (`sfirah`, `sefira`, `ספירה`, `vocal`, `וואקאלן`, `vochn` … all reach the
same folder). `?station=` and `?folder=` are interchangeable.

Add `&shuffle=0` to play alphabetically. Swap `/radio` for `/playlist.m3u` to get a
skippable playlist instead of a continuous station.

Add `&gain=4.5` to play louder — see [Turning it up](#turning-it-up) below. It is
what the telephone hotline URLs want; speakers generally don't need it.

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

## Turning it up

The library sits around **-18 dBFS RMS**. That is comfortable on speakers and
noticeably quiet on a telephone hotline, which expects a hotter signal and then
attenuates and band-limits it further. `&gain=<dB>` on a `/radio` URL raises it:

```
https://stream-api.oitzerhanigunim.org/radio?station=lebedik&gain=4.5
```

| `gain` | Effect | Measured on five library tracks |
| --- | --- | --- |
| `3` | Safe everywhere | no clipping on 4 of 5; 0.004% of samples on the hottest |
| `4.5` | **Recommended for the hotline** | worst case 0.03% of samples reach full scale |
| `6` | Loud; audible on transients | worst case 0.15% of samples |
| `9`+ | Too much | 1%+ of samples clipped — don't |

Notes:

- Values are rounded to **1.5 dB steps** (the MP3 gain field's granularity) and
  capped at **±12 dB**. The response header `x-gain-db` says what was actually
  applied, so `?gain=99` reports `12`.
- Negative values work too — `&gain=-3` for a quieter feed.
- It is **lossless**: nothing is decoded or re-encoded, so there is no quality
  cost. The one risk is clipping, since the tracks' own peaks run from -0.6 to
  -7.8 dBFS. That is why it is per-URL rather than on for everyone.
- `/playlist.m3u` ignores `gain` — it hands out direct R2 file URLs, which the
  worker never touches.

## Notes

- A station is one fixed folder. The website switches folders by day/time in
  the browser (`TIME_BASED_FOLDERS`); that does not apply here, so add the
  weekday and שבת folders as two stations if you need both.
- Unrecognised values are treated as a literal R2 path, so older
  `?folder=<full path>` URLs keep working unchanged.
- `folder` matches recursively, so `?folder=מועדים וזמנים` (URL-encoded) is a
  single station covering every occasion at once.
- The stream reconnects roughly every 3 hours, between tracks. See README.
