Datum type — subset WOFF2 faces shipped beside every card (cards/fonts/).

Families and weights (handoff/README.md):
  Spectral        400, 600, 400 italic   display: company names, section heads, refusal headline, wordmark
  Archivo         400, 500               text: labels, prose, refusal reasons, legend labels
  JetBrains Mono  400, 500, 700          figures: every number, date, ticker; 700 only on the A4 sheet

Source: the static TTF instances served by Google Fonts on 2026-09-05
  https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,400;0,600;1,400&family=Archivo:wght@400;500&family=JetBrains+Mono:wght@400;500;700
  (Archivo v25, JetBrains Mono v24, Spectral v15 as named in the served URLs)

Subset with fonttools 4.59.2 (pyftsubset --flavor=woff2), unicode ranges:
  U+0000-00FF (Basic Latin + Latin-1 Supplement, incl. U+00B7 middle dot), U+0131, U+0152-0153,
  U+02C6, U+02DA, U+02DC, U+2013-2014 (dashes), U+2018-201D, U+2022, U+2026, U+2030, U+2039-203A,
  U+2044, U+2122, U+2190-2199 (arrows incl. U+2191 U+2197), U+2212 (minus), U+2318, U+2339,
  U+2399 (print glyph), U+25AE-25AF (model marks), U+25BE, U+25CB (hollow circle), U+2713, U+27F2
  layout features kept: defaults plus tnum, lnum, pnum, onum, zero, ss01
Glyphs a family lacks (none of the three carries U+25AE/U+25AF; only Spectral carries U+25CB)
fall through to the system fallback in the font stack; the marks are forms, not hues, so they
survive the substitution.

Licence: all three families are under the SIL Open Font License 1.1 — see OFL-Spectral.txt,
OFL-Archivo.txt, OFL-JetBrainsMono.txt beside the files. build_company_cards.py copies this
directory to <cards>/fonts/ so the @font-face urls in _card.css resolve over file://.
