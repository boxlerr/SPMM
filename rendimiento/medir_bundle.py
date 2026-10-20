"""Mide el JS inicial de cada ruta a partir de .next/app-build-manifest.json.

Uso: python3 medir_bundle.py <dir .next> [salida.json]
Imprime por ruta: JS crudo / gzip (sólo lo que baja al abrir la pantalla, sin los
import() diferidos) y qué librerías pesadas viajan en ese JS inicial.
"""
import gzip, json, os, re, sys

NEXT = sys.argv[1]
FIRMAS = {
    "exceljs": [b"xl/workbook.xml", b"ExcelJS"],
    "jspdf": [b"jsPDF"],
    "jspdf-autotable": [b"autoTable"],
    "pdfjs-dist": [b"GlobalWorkerOptions"],
    "html2canvas": [b"html2canvas"],
    "dompurify": [b"DOMPurify"],
    "canvg": [b"canvg"],
    "framer-motion": [b"layoutDependency", b"transformTemplate"],
    "@hello-pangea/dnd": [b"data-rfd-draggable-id"],
    "date-fns": [b"Invalid time value"],
    "cmdk": [b"cmdk-item"],
    "react-day-picker": [b"rdp-"],
    "zod": [b"ZodError"],
    "react-hook-form": [b"useFormContext"],
}

man = json.load(open(os.path.join(NEXT, "app-build-manifest.json")))["pages"]
cache = {}
def info(rel):
    if rel not in cache:
        data = open(os.path.join(NEXT, rel), "rb").read()
        libs = sorted(k for k, fs in FIRMAS.items() if any(f in data for f in fs))
        cache[rel] = (len(data), len(gzip.compress(data, 9)), libs)
    return cache[rel]

res = {}
for page, chunks in sorted(man.items()):
    js = [c for c in chunks if c.endswith(".js")]
    raw = sum(info(c)[0] for c in js)
    gz = sum(info(c)[1] for c in js)
    libs = sorted({l for c in js for l in info(c)[2]})
    res[page] = {"js_raw": raw, "js_gz": gz, "libs": libs, "chunks": len(js)}

ancho = max(len(p) for p in res)
print(f"{'ruta'.ljust(ancho)}  {'JS crudo':>9}  {'JS gzip':>8}  librerías pesadas en el JS inicial")
for p, r in res.items():
    print(f"{p.ljust(ancho)}  {r['js_raw']/1024:8.0f}K  {r['js_gz']/1024:7.0f}K  {', '.join(r['libs'])}")

# Todo el JS que existe (incluye los import() diferidos), para ver qué quedó afuera.
todos = [f for f in os.listdir(os.path.join(NEXT, "static/chunks")) if f.endswith(".js")]
tot_raw = sum(info("static/chunks/" + f)[0] for f in todos)
tot_gz = sum(info("static/chunks/" + f)[1] for f in todos)
print(f"\nTodo el JS generado: {tot_raw/1024:.0f}K crudo / {tot_gz/1024:.0f}K gzip en {len(todos)} archivos")
print("\nChunks más grandes y qué llevan:")
for f in sorted(todos, key=lambda f: -info("static/chunks/" + f)[0])[:15]:
    r, g, libs = info("static/chunks/" + f)
    rutas = [p.replace('/page','') or '/' for p, cs in man.items() if "static/chunks/" + f in cs]
    print(f"  {r/1024:6.0f}K {g/1024:5.0f}K gz  {f}  libs={libs}  inicial_en={len(rutas)} rutas {rutas[:4]}")
if len(sys.argv) > 2:
    json.dump(res, open(sys.argv[2], "w"), indent=1)
