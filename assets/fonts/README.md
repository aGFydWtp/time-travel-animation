# Bundled fonts

The renderer only ever draws with these files (registered via `FontFace` under unique `DCS …`
family names; no platform font fallback). The registry is `src/lib/renderer/fonts.ts`.

All fonts are licensed under the SIL Open Font License 1.1. Each license file is the one shipped
by the source repository, with its first (copyright) line set to the font's own copyright notice
(name ID 0); google/fonts' `ofl/notoserifjp/OFL.txt` carries a stale "2012 Google Inc." line.

## Credits

| Font id | File | Font | Author | License | Source |
| --- | --- | --- | --- | --- | --- |
| `bundled-mono` | `JetBrainsMono-Regular.woff2` | JetBrains Mono Regular | The JetBrains Mono Project Authors | OFL 1.1 (`OFL.txt`) | https://github.com/JetBrains/JetBrainsMono |
| `noto-sans-jp` (+ 年月日 for `bundled-mono`, `digital`) | `NotoSansJP-DateGlyphs.woff2` | Noto Sans JP (wght 400) | Adobe (Reserved Font Name "Source") | OFL 1.1 (`OFL-NotoSansJP.txt`) | https://github.com/google/fonts/tree/main/ofl/notosansjp |
| `noto-serif-jp` | `NotoSerifJP-DateGlyphs.woff2` | Noto Serif JP (wght 400) | Adobe | OFL 1.1 (`OFL-NotoSerifJP.txt`) | https://github.com/google/fonts/tree/main/ofl/notoserifjp |
| `zen-maru-gothic` | `ZenMaruGothic-DateGlyphs.woff2` | Zen Maru Gothic Regular | The Zen Maru Gothic Authors | OFL 1.1 (`OFL-ZenMaruGothic.txt`) | https://github.com/google/fonts/tree/main/ofl/zenmarugothic |
| `klee-one` | `KleeOne-DateGlyphs.woff2` | Klee One Regular | The Klee Project Authors (Fontworks) | OFL 1.1 (`OFL-KleeOne.txt`) | https://github.com/google/fonts/tree/main/ofl/kleeone |
| `dela-gothic-one` | `DelaGothicOne-DateGlyphs.woff2` | Dela Gothic One Regular | The Dela Gothic Project Authors | OFL 1.1 (`OFL-DelaGothicOne.txt`) | https://github.com/google/fonts/tree/main/ofl/delagothicone |
| `dotgothic16` | `DotGothic16-DateGlyphs.woff2` | DotGothic16 Regular | The DotGothic16 Project Authors (Fontworks) | OFL 1.1 (`OFL-DotGothic16.txt`) | https://github.com/google/fonts/tree/main/ofl/dotgothic16 |
| `digital` | `DCSDigital-DateGlyphs.woff2` | "DCS Digital", a subset of Orbitron (wght 400) | The Orbitron Project Authors (The League of Moveable Type) | OFL 1.1 (`OFL-Orbitron.txt`) | https://github.com/google/fonts/tree/main/ofl/orbitron |

"Orbitron" is a Reserved Font Name, so the modified (subset) version is renamed "DCS Digital" in
its name table, CSS family and UI label.

## How the `*-DateGlyphs.woff2` subsets were made

Downloaded from google/fonts `main` (2026-11-08). Variable fonts were instanced at `wght=400`,
then subset to exactly the characters any date format can draw — digits `0-9`, `.`, `/`, space,
`年`, `月`, `日` — without layout features or hinting (fonttools 4.x, in a scratch venv; not a
project dependency):

```sh
fonttools varLib.instancer --update-name-table NotoSansJP[wght].ttf wght=400 -o NotoSansJP-400.ttf
pyftsubset NotoSansJP-400.ttf --text="0123456789./年月日 " --flavor=woff2 \
  --layout-features='' --no-hinting --desubroutinize --name-IDs='*' \
  --output-file=NotoSansJP-DateGlyphs.woff2
```

The Orbitron subset additionally had name IDs 1/3/4/6 rewritten to "DCS Digital".
Supporting a new character in a date format requires re-subsetting these files.
