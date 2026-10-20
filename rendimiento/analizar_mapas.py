"""Atribuye los bytes minificados de cada chunk a su archivo fuente (como source-map-explorer).

Uso: python3 analizar_mapas.py <dir .next> <ruta, ej /operaciones/page> [top]
Lee static/chunks/*.js.map (build con productionBrowserSourceMaps) y suma, por fuente,
los bytes del JS generado que le corresponden según los mappings.
"""
import json, os, re, sys
from collections import Counter

B64 = {c: i for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")}

def vlq(seg):
    vals, shift, val = [], 0, 0
    for ch in seg:
        d = B64[ch]
        val += (d & 31) << shift
        if d & 32:
            shift += 5
        else:
            neg = val & 1
            val >>= 1
            vals.append(-val if neg else val)
            val, shift = 0, 0
    return vals

def atribuir(js_path):
    cola = open(js_path, encoding="utf-8", errors="replace").read()[-300:]
    mm = re.search(r"sourceMappingURL=(\S+)", cola)
    mp = os.path.join(os.path.dirname(js_path), mm.group(1)) if mm else js_path + ".map"
    if not os.path.exists(mp):
        return None
    m = json.load(open(mp))
    secciones = m.get("sections")
    lineas = open(js_path, encoding="utf-8", errors="replace").read().split("\n")
    tot = Counter()
    def una(mapa, off_line=0, off_col=0):
        sources = mapa["sources"]
        src = 0
        for li, linea in enumerate(mapa["mappings"].split(";")):
            gl = li + off_line
            if gl >= len(lineas):
                break
            texto = lineas[gl]
            col = off_col if li == 0 else 0
            segs = [vlq(s) for s in linea.split(",") if s]
            prev = None
            for s in segs:
                col += s[0]
                if len(s) > 1:
                    src += s[1]
                if prev is not None:
                    tot[prev[1]] += max(0, col - prev[0])
                prev = (col, sources[src] if len(s) > 1 else "<sin fuente>")
            if prev is not None:
                tot[prev[1]] += max(0, len(texto) - prev[0])
    if secciones:
        for sec in secciones:
            una(sec["map"], sec["offset"]["line"], sec["offset"]["column"])
    else:
        una(m)
    return tot

def agrupar(fuente):
    f = fuente.replace("turbopack:///", "").replace("[project]/", "")
    mm = re.search(r"node_modules/((?:@[^/]+/)?[^/]+)", f)
    if mm:
        return "npm:" + mm.group(1)
    return f

NEXT, RUTA = sys.argv[1], sys.argv[2]
TOP = int(sys.argv[3]) if len(sys.argv) > 3 else 25
man = json.load(open(os.path.join(NEXT, "app-build-manifest.json")))["pages"]
chunks = [c for c in man[RUTA] if c.endswith(".js")]
por_grupo = Counter()
for c in chunks:
    t = atribuir(os.path.join(NEXT, c))
    if t is None:
        continue
    for fuente, n in t.items():
        por_grupo[agrupar(fuente)] += n
total = sum(por_grupo.values())
print(f"{RUTA}: {total/1024:.0f}K atribuidos en {len(chunks)} chunks iniciales")
for g, n in por_grupo.most_common(TOP):
    print(f"  {n/1024:7.1f}K  {g}")
