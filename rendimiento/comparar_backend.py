"""Compara el backend viejo (:8011) y el nuevo (:8010) contra los MISMOS datos: pide cada
ruta a los dos casi a la vez, verifica que el JSON sea idéntico y cuenta consultas y tiempo
(del log de cada banco). Uso: python3 comparar_backend.py <log_viejo> <log_nuevo> [vueltas]"""
import json, sys, time, urllib.request, gzip
VIEJO, NUEVO = "http://127.0.0.1:8011", "http://127.0.0.1:8010"
RUTAS = ["/ordenes", "/ordenes-resumen", "/operarios", "/procesos", "/maquinarias", "/planificacion",
         "/planificacion/borradores", "/config/availability", "/config/feriados", "/notificaciones",
         "/auth/me", "/api/dashboard/reporte-mensual?anio=2026&mes=9", "/api/dashboard/reporte-mensual?anio=2026&mes=10",
         "/api/dashboard/estadisticas", "/rangos/cobertura", "/materia-prima/pendientes",
         "/planos/ordenes-con-plano-disponible", "/auditoria/planificacion", "/articulos"]
VUELTAS = int(sys.argv[3]) if len(sys.argv) > 3 else 3

def pedir(base, ruta):
    r = urllib.request.Request(base + ruta, headers={"Accept-Encoding": "gzip", "Authorization": "Bearer x"})
    t = time.perf_counter()
    with urllib.request.urlopen(r, timeout=300) as resp:
        cuerpo = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            cuerpo = gzip.decompress(cuerpo)
    return cuerpo, (time.perf_counter() - t) * 1000

def ultimas(log, n):
    return [json.loads(l) for l in open(log).read().splitlines()[-n:]]

for ruta in RUTAS:
    iguales, tv, tn = True, [], []
    for v in range(VUELTAS):
        a, ta = pedir(VIEJO, ruta)
        b, tb = pedir(NUEVO, ruta)
        tv.append(ta); tn.append(tb)
        if json.loads(a) != json.loads(b):
            iguales = False
    lv = ultimas(sys.argv[1], 1)[0]; ln = ultimas(sys.argv[2], 1)[0]
    print(f"{ruta:52} {'IGUAL   ' if iguales else 'DISTINTO'} consultas {lv['consultas']:>3} -> {ln['consultas']:>3}   "
          f"ms (mejor de {VUELTAS}) {min(tv):7.0f} -> {min(tn):7.0f}")
