"""One-shot asset prep: reads brand/ logo bytes, derives palette, resized logos, favicon, tokens.css.
Run: python -I tools/prepare-assets.py   (outputs committed under src/assets and src/tokens.css)"""
import json, os, sys
import numpy as np
from PIL import Image
from sklearn.cluster import KMeans

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'brand', 'LOGO EMO PNG...png')   # RGBA, colourtype 6, true alpha
OUT = os.path.join(ROOT, 'src', 'assets')
os.makedirs(OUT, exist_ok=True)

im = Image.open(SRC).convert('RGBA')
a = np.array(im)
alpha = a[..., 3]
opaque = alpha == 255
zero = alpha == 0
pure_black_transparent = bool((a[..., :3][zero].sum(axis=1) == 0).all())
print('transparent px', int(zero.sum()), 'pure-black rgb in transparent region:', pure_black_transparent)

# k-means on opaque pixels, snapped to a real pixel coordinate
ys, xs = np.where(opaque)
px = a[ys, xs, :3].astype(float)
rng = np.random.default_rng(7)
idx = rng.choice(len(px), 60000, replace=False)
km = KMeans(n_clusters=9, n_init=8, random_state=7).fit(px[idx])
palette = []
for c in km.cluster_centers_:
    d = ((px - c) ** 2).sum(axis=1)
    j = int(d.argmin())
    r, g, b = px[j].astype(int)
    share = float((km.predict(px[idx]) == len(palette)).mean())
    palette.append({'hex': '#%02x%02x%02x' % (r, g, b), 'x': int(xs[j]), 'y': int(ys[j]), 'share': round(share, 4)})
palette.sort(key=lambda p: -p['share'])
palette = [p for p in palette if p['share'] >= 0.01]   # drop antialias-blend cluster
for p in palette: print(p)
json.dump(palette, open(os.path.join(OUT, 'palette.json'), 'w'), indent=1)

# crop to square around alpha bbox, premultiplied resize (avoids black fringes)
yy, xx = np.where(alpha > 0)
x0, x1, y0, y1 = xx.min(), xx.max() + 1, yy.min(), yy.max() + 1
side = max(x1 - x0, y1 - y0) + 24
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
box = (cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)
sq = im.crop(box)

def pm_resize(img, n):
    pm = img.convert('RGBa')                      # premultiplied
    pm = pm.resize((n, n), Image.LANCZOS)
    return pm.convert('RGBA')

for n in (512, 192):
    pm_resize(sq, n).save(os.path.join(OUT, 'logo-%d.png' % n), optimize=True)
fav = pm_resize(sq, 32)
fa = np.array(fav)

# favicon: 32x32 real pixel grid, colours snapped to palette + white
pal = [tuple(int(p['hex'][i:i + 2], 16) for i in (1, 3, 5)) for p in palette] + [(255, 255, 255)]
palhex = [p['hex'] for p in palette] + ['#ffffff']
rows = []
for y in range(32):
    x = 0
    while x < 32:
        al = fa[y, x, 3]
        if al < 24: x += 1; continue
        rgb = fa[y, x, :3].astype(int)
        k = int(np.argmin([((rgb - np.array(p)) ** 2).sum() for p in pal]))
        op = round(float(al) / 255, 2)
        x2 = x + 1
        while x2 < 32:
            al2 = fa[y, x2, 3]
            if al2 < 24: break
            rgb2 = fa[y, x2, :3].astype(int)
            k2 = int(np.argmin([((rgb2 - np.array(p)) ** 2).sum() for p in pal]))
            if k2 != k or round(float(al2) / 255, 2) != op: break
            x2 += 1
        o = '' if op >= 0.98 else ' fill-opacity="%s"' % op
        rows.append('<rect x="%d" y="%d" width="%d" height="1" fill="%s"%s/>' % (x, y, x2 - x, palhex[k], o))
        x = x2
svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" shape-rendering="crispEdges">' + ''.join(rows) + '</svg>'
assert '--' not in svg
open(os.path.join(OUT, 'favicon.svg'), 'w').write(svg)
print('favicon rects', len(rows), 'bytes', len(svg))
print('logo-512 corner alpha', np.array(Image.open(os.path.join(OUT, 'logo-512.png')))[0, 0])

# tokens.css: the only file allowed to hold colour literals
names = ['navy', 'sun-light', 'sun', 'azure', 'sun-deep', 'sky', 'white', 'cobalt']
lines = ['/* PALETTE PROVENANCE: k-means (k=9, seed 7) over opaque pixels of brand/LOGO EMO PNG...png (RGBA, colourtype 6),',
         '   each centroid snapped to the nearest real pixel; x,y are source pixel coordinates. The ninth cluster',
         '   (antialias blend, share < 1%) was discarded. No other colour literal exists in the project. */',
         ':root {']
for n, p in zip(names, palette):
    lines.append('  --%s: %s; /* px(%d,%d) share %.1f%% */' % (n, p['hex'], p['x'], p['y'], p['share'] * 100))
lines.append('}')
open(os.path.join(ROOT, 'src', 'tokens.css'), 'w').write(chr(10).join(lines) + chr(10))
