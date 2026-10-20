"""Resume los logs de pedidos de Cloud Run: por ruta (con los ids como {id}), cantidad,
latencia p50/p95/max y tamaño de respuesta. Es la medición de PRODUCCIÓN (lo que Sentry
daría como 'transacciones lentas')."""
import json, re, sys, statistics
from collections import defaultdict
from urllib.parse import urlsplit
filas = json.load(open(sys.argv[1]))
g = defaultdict(list)
for f in filas:
    h = f.get("httpRequest") or {}
    url = h.get("requestUrl") or ""
    p = urlsplit(url).path
    p = re.sub(r"/\d+(?=/|$)", "/{id}", p)
    lat = h.get("latency")
    if not lat:
        continue
    ms = float(lat.rstrip("s")) * 1000
    g[(h.get("requestMethod"), p)].append((ms, int(h.get("responseSize") or 0), h.get("status")))
def pct(xs, q):
    xs = sorted(xs); i = min(len(xs) - 1, int(round(q * (len(xs) - 1)))); return xs[i]
print(f"{len(filas)} pedidos. Por tiempo total consumido (n × p50):")
print(f"{'metodo':6} {'ruta':52} {'n':>5} {'p50':>7} {'p95':>7} {'max':>7} {'KB p50':>7}")
filas_r = []
for (m, p), xs in g.items():
    lat = [x[0] for x in xs]; kb = [x[1] / 1024 for x in xs]
    filas_r.append((sum(lat), m, p, len(xs), statistics.median(lat), pct(lat, .95), max(lat), statistics.median(kb)))
for tot, m, p, n, p50, p95, mx, kb in sorted(filas_r, reverse=True)[:40]:
    print(f"{m:6} {p[:52]:52} {n:5d} {p50:7.0f} {p95:7.0f} {mx:7.0f} {kb:7.0f}")
