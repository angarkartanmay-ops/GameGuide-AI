"""Trim Archivo for the web: narrow its variable axes to what the site uses and
subset the glyphs, taking the Latin file from Google Fonts (87 kB) to 47 kB.

  pip install fonttools brotli
  python scripts/fonts/trim-archivo.py Archivo-latin-from-google.woff2 public/fonts/archivo-latin.woff2

Weight 500-800 and width 100-125 are every value src/styles/site.css uses
(font-weight 500...800, font-variation-settings 'wdth' 108 / 112 / 125). If the
CSS starts using more, widen the ranges here and in src/styles/fonts.css.
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

src, dst = sys.argv[1], sys.argv[2]
font = TTFont(src)
print('axes in:', [(a.axisTag, a.minValue, a.defaultValue, a.maxValue) for a in font['fvar'].axes])
font = instancer.instantiateVariableFont(font, {'wght': (500, 800), 'wdth': (100, 125)})
print('axes out:', [(a.axisTag, a.minValue, a.defaultValue, a.maxValue) for a in font['fvar'].axes])

opts = subset.Options()
opts.flavor = 'woff2'
opts.layout_features = ['kern', 'liga', 'calt', 'ccmp', 'locl', 'mark', 'mkmk', 'tnum', 'case', 'lnum']
opts.name_IDs = [1, 2, 3, 4, 6]
opts.notdef_outline = True
opts.hinting = False
opts.desubroutinize = True
sub = subset.Subsetter(opts)
# Basic Latin, Latin-1 (accents in game names), the typographic punctuation the site uses.
unicodes = list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) + [0x131, 0x152, 0x153, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x20AC, 0x2122, 0x2212]
sub.populate(unicodes=unicodes)
sub.subset(font)
font.flavor = 'woff2'
font.save(dst)
import os
print(os.path.basename(src), os.path.getsize(src) // 1024, 'kB ->', os.path.getsize(dst) // 1024, 'kB')
