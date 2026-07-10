"""
Auditoría de skills operario × proceso.

Objetivo: detectar skills mal cargadas (ej. gente de Pañol con skills de
mecanizado) y ver cómo queda cada proceso de cara al planificador:

  - "modo estricto": el proceso tiene al menos 1 skill EXPLÍCITA (nivel 1/2
    habilitada). El planner SOLO deja a esos operarios. Ver PlanificacionService
    (_crear_variables_y_dominios, rama `if op_skill_levels`).
  - "modo rango/abierto": el proceso no tiene ninguna explícita → el planner cae
    al camino por rango (y las tareas básicas quedan abiertas a cualquiera).

Genera:
  - resumen por consola
  - <out>/auditoria_skills.html  (para abrir y revisar / mandar a Lucas)
  - <out>/auditoria_skills_detalle.csv  (operario × proceso, para Excel)

Uso:
  cd backend
  venv/bin/python scripts/auditoria_skills.py [directorio_salida]

Las funciones de familia/tipo son copia fiel de PlanificacionService para que el
reporte coincida con lo que realmente hace el planner (mantener en sync si cambian).
"""
import os
import re
import sys
import csv
import html
import time
import unicodedata
from collections import defaultdict
from pathlib import Path

import pyodbc
from dotenv import load_dotenv

# --- Config / conexión (misma cadena que infrastructure/db.py, pero sync) ---
# .env está en la raíz del repo (un nivel arriba de backend/)
ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

DB_SERVER = os.getenv("DB_SERVER")
DB_NAME = os.getenv("DB_NAME")
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
TRUSTED = (os.getenv("TRUSTED_CONNECTION") or "").lower() == "yes"
DRIVER = "ODBC Driver 17 for SQL Server"

if TRUSTED:
    CONN_STR = (
        f"DRIVER={{{DRIVER}}};SERVER={DB_SERVER};DATABASE={DB_NAME};"
        f"Trusted_Connection=yes;TrustServerCertificate=yes;"
    )
else:
    CONN_STR = (
        f"DRIVER={{{DRIVER}}};SERVER={DB_SERVER};DATABASE={DB_NAME};"
        f"UID={DB_USER};PWD={DB_PASSWORD};TrustServerCertificate=yes;"
    )


def conectar(reintentos=4):
    """La DB se corta seguido: reintenta con backoff."""
    ultimo = None
    for i in range(reintentos):
        try:
            return pyodbc.connect(CONN_STR, timeout=15)
        except pyodbc.Error as e:
            ultimo = e
            print(f"  ...intento {i+1}/{reintentos} falló: {e.args[0] if e.args else e}")
            time.sleep(2 * (i + 1))
    raise SystemExit(f"No se pudo conectar a la DB tras {reintentos} intentos: {ultimo}")


# --- Clasificación (copia fiel de PlanificacionService) ---
def _norm(s: str) -> str:
    s = (s or "").upper().strip()
    s = "".join(ch for ch in unicodedata.normalize("NFD", s) if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", s)


def familia_requerida_from_proceso(nombre_proc: str) -> str:
    n = _norm(nombre_proc)
    if "EN FRESADORA" in n or "FRESADORA" in n or "TALLADO" in n or "AGUJEREADO EN FRESADORA" in n:
        return "FRESADORA"
    if "AGUJEREADORA" in n or "RADIAL" in n or "TALADR" in n or "AVELLANAD" in n:
        return "AGUJEREADORA"
    if "TORNO" in n or "CILINDRADO" in n or "ROSCADO" in n or "REPUJADO" in n:
        return "TORNO"
    if "LIMADORA" in n:
        return "LIMADORA"
    if "GUILLOTINA" in n:
        return "GUILLOTINA"
    if "PRENSA" in n or "PUNZONADO" in n or "PRENSADO" in n or "CONFORMAD" in n:
        return "PRENSA"
    if "PLEGADO" in n or "PLEGADORA" in n or "DOBLADO" in n or "DOBLADORA" in n:
        return "PLEGADORA"
    if "SIERRA" in n or "SENSITIVA" in n:
        return "SIERRA_CIRCULAR"
    if "RECTIFICAD" in n:
        return "RECTIFICADORA"
    if "OXICORTE" in n or "SOPLETE" in n:
        return "OXICORTE"
    return ""


def _get_tipo_proceso(nombre_proceso: str) -> str:
    n = _norm(nombre_proceso)
    if n.startswith("PREPARACION") or n.startswith("CAMBIO DE") or "SETUP" in n or "PROGRAM" in n:
        return "SETUP"
    keywords_manual = [
        "EMBALAD", "DESARM", "ENSAMBL", "LAVADO", "LIMPIEZA", "REBABA", "REBARB",
        "AMOLAD", "BICELAD", "BISELAD", "ENDEREZ", "PINTU", "ARMADO", "AJUSTE",
        "CONTROL", "REVISION", "DISENO", "PLANIFICACION", "CUBICACION",
        "CONSULTAR", "SOLICITAR", "TRABAJO DE FORMA", "MANUAL", "SOLDA",
    ]
    if any(k in n for k in keywords_manual):
        return "MANUAL"
    if "TERCERIZ" in n or "EXTERNO" in n:
        return "ADMIN"
    return "PRODUCCION_MAQUINA"


FAMILIAS_MAQUINA = {
    "FRESADORA", "TORNO", "GUILLOTINA", "PLEGADORA", "AGUJEREADORA",
    "RECTIFICADORA", "LIMADORA", "PRENSA", "SIERRA_CIRCULAR", "OXICORTE",
}
# Sectores donde una skill de MÁQUINA es sospechosa (no son puestos de mecanizado).
SECTORES_NO_MAQUINA = {"PAÑOL", "PANOL", "PRUEBAS", "DEPOSITO", "DEPÓSITO", "CALIDAD", "ADMINISTRACION"}
UMBRAL_MUCHAS_SKILLS = 40  # carga masiva sospechosa


def main():
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else (ROOT / "backend" / "scripts" / "out")
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Conectando a {DB_SERVER}/{DB_NAME} ...")
    cn = conectar()
    cur = cn.cursor()

    operarios = {
        r.id: {
            "nombre": f"{(r.nombre or '').strip()} {(r.apellido or '').strip()}".strip(),
            "sector": (r.sector or "").strip(),
            "categoria": (r.categoria or "").strip(),
            "disponible": bool(r.disponible),
        }
        for r in cur.execute(
            "SELECT id, nombre, apellido, sector, categoria, disponible FROM operario"
        ).fetchall()
    }
    procesos = {
        r.id: (r.nombre or "").strip()
        for r in cur.execute("SELECT id, nombre FROM proceso").fetchall()
    }
    skills = cur.execute(
        "SELECT id_operario, id_proceso, nivel, habilitado FROM operario_proceso_skill"
    ).fetchall()
    cn.close()

    # Clasificar procesos una sola vez
    proc_familia = {pid: familia_requerida_from_proceso(nom) for pid, nom in procesos.items()}
    proc_tipo = {pid: _get_tipo_proceso(nom) for pid, nom in procesos.items()}

    # Agregados
    por_operario = defaultdict(lambda: {"n0": 0, "n1": 0, "n2": 0, "fam_maq": set(), "detalle": []})
    proc_explicitas = defaultdict(int)      # proceso -> #operarios con skill explícita habilitada
    proc_operarios_expl = defaultdict(list)
    detalle_rows = []

    for s in skills:
        op = operarios.get(s.id_operario)
        nom_proc = procesos.get(s.id_proceso, f"?({s.id_proceso})")
        fam = proc_familia.get(s.id_proceso, "")
        tipo = proc_tipo.get(s.id_proceso, "")
        nivel = int(s.nivel)
        hab = bool(s.habilitado)

        agg = por_operario[s.id_operario]
        if nivel == 0:
            agg["n0"] += 1
        elif nivel == 1:
            agg["n1"] += 1
        elif nivel == 2:
            agg["n2"] += 1
        if nivel in (1, 2) and hab and fam in FAMILIAS_MAQUINA:
            agg["fam_maq"].add(fam)
        agg["detalle"].append((s.id_proceso, nom_proc, fam, tipo, nivel, hab))

        if nivel in (1, 2) and hab:
            proc_explicitas[s.id_proceso] += 1
            proc_operarios_expl[s.id_proceso].append(s.id_operario)

        # Flag por fila
        sector_up = _norm(op["sector"]) if op else ""
        flag = ""
        if op is None:
            flag = "operario inexistente"
        elif nivel in (1, 2) and hab and fam in FAMILIAS_MAQUINA and sector_up in {_norm(x) for x in SECTORES_NO_MAQUINA}:
            flag = f"sector '{op['sector']}' con skill de MÁQUINA ({fam})"
        elif nivel not in (0, 1, 2):
            flag = f"nivel inválido ({nivel})"
        detalle_rows.append({
            "id_operario": s.id_operario,
            "operario": op["nombre"] if op else "?",
            "sector": op["sector"] if op else "",
            "categoria": op["categoria"] if op else "",
            "id_proceso": s.id_proceso,
            "proceso": nom_proc,
            "familia": fam,
            "tipo": tipo,
            "nivel": nivel,
            "habilitado": int(hab),
            "flag": flag,
        })

    # ---- Flags a nivel operario ----
    sospechosos = []
    for oid, agg in por_operario.items():
        op = operarios.get(oid, {"nombre": "?", "sector": "", "categoria": ""})
        total_expl = agg["n1"] + agg["n2"]
        motivos = []
        sector_up = _norm(op["sector"])
        if sector_up in {_norm(x) for x in SECTORES_NO_MAQUINA} and agg["fam_maq"]:
            motivos.append(f"{op['sector']} con skills de máquina: {', '.join(sorted(agg['fam_maq']))}")
        if op["nombre"].upper().startswith("VACANTE") and total_expl > 0:
            motivos.append(f"VACANTE con {total_expl} skills cargadas")
        if len(agg["fam_maq"]) >= 4:
            motivos.append(f"skills en {len(agg['fam_maq'])} familias de máquina distintas: {', '.join(sorted(agg['fam_maq']))}")
        if total_expl >= UMBRAL_MUCHAS_SKILLS:
            motivos.append(f"{total_expl} skills explícitas (posible carga masiva)")
        if motivos:
            sospechosos.append((oid, op, agg, motivos))

    # Procesos de máquina "abiertos" (sin explícitas) o con un único operario
    proc_maq = [pid for pid, fam in proc_familia.items() if fam in FAMILIAS_MAQUINA]
    maq_sin_expl = [pid for pid in proc_maq if proc_explicitas.get(pid, 0) == 0]
    maq_un_operario = [pid for pid in proc_maq if proc_explicitas.get(pid, 0) == 1]

    # ---- Consola ----
    print("\n" + "=" * 70)
    print("AUDITORÍA DE SKILLS — resumen")
    print("=" * 70)
    print(f"Operarios: {len(operarios)}  |  Procesos: {len(procesos)}  |  Filas de skill: {len(skills)}")
    print(f"Procesos de familia MÁQUINA: {len(proc_maq)}")
    print(f"  - en modo ESTRICTO (>=1 skill explícita): {len(proc_maq) - len(maq_sin_expl)}")
    print(f"  - ABIERTOS por rango (0 explícitas): {len(maq_sin_expl)}  <- acá el planner puede mal-asignar")
    print(f"  - con UN SOLO operario habilitado (cuello de botella): {len(maq_un_operario)}")
    print(f"\nOperarios sospechosos: {len(sospechosos)}")
    for oid, op, agg, motivos in sorted(sospechosos, key=lambda x: -(x[2]['n1'] + x[2]['n2'])):
        print(f"  [{oid}] {op['nombre']:<28} ({op['sector']}/{op['categoria']})  n1={agg['n1']} n2={agg['n2']} n0={agg['n0']}")
        for m in motivos:
            print(f"        ⚠ {m}")

    # ---- CSV detalle ----
    csv_path = out_dir / "auditoria_skills_detalle.csv"
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(detalle_rows[0].keys()))
        w.writeheader()
        w.writerows(sorted(detalle_rows, key=lambda r: (bool(r["flag"]) is False, r["id_operario"], r["id_proceso"])))

    # ---- HTML ----
    html_path = out_dir / "auditoria_skills.html"
    _escribir_html(html_path, operarios, procesos, por_operario, sospechosos,
                   proc_familia, proc_explicitas, proc_operarios_expl,
                   maq_sin_expl, maq_un_operario, len(skills))

    print(f"\nCSV:  {csv_path}")
    print(f"HTML: {html_path}")


def _escribir_html(path, operarios, procesos, por_operario, sospechosos,
                   proc_familia, proc_explicitas, proc_operarios_expl,
                   maq_sin_expl, maq_un_operario, n_skills):
    def esc(x):
        return html.escape(str(x))

    filas_sosp = ""
    for oid, op, agg, motivos in sorted(sospechosos, key=lambda x: -(x[2]['n1'] + x[2]['n2'])):
        filas_sosp += (
            f"<tr><td>{oid}</td><td>{esc(op['nombre'])}</td><td>{esc(op['sector'])}</td>"
            f"<td>{esc(op['categoria'])}</td><td class=n>{agg['n1']}</td><td class=n>{agg['n2']}</td>"
            f"<td class=n>{agg['n0']}</td><td class=warn>{'<br>'.join(esc(m) for m in motivos)}</td></tr>"
        )

    filas_op = ""
    for oid, agg in sorted(por_operario.items(), key=lambda x: -(x[1]['n1'] + x[1]['n2'])):
        op = operarios.get(oid, {"nombre": "?", "sector": "", "categoria": ""})
        fam = ", ".join(sorted(agg["fam_maq"])) or "—"
        filas_op += (
            f"<tr><td>{oid}</td><td>{esc(op['nombre'])}</td><td>{esc(op['sector'])}</td>"
            f"<td>{esc(op['categoria'])}</td><td class=n>{agg['n1']}</td><td class=n>{agg['n2']}</td>"
            f"<td class=n>{agg['n0']}</td><td>{esc(fam)}</td></tr>"
        )

    def fila_proc(pid):
        return (f"<tr><td>{pid}</td><td>{esc(procesos.get(pid,'?'))}</td>"
                f"<td>{esc(proc_familia.get(pid,''))}</td>"
                f"<td class=n>{proc_explicitas.get(pid,0)}</td></tr>")

    filas_abiertos = "".join(fila_proc(p) for p in sorted(maq_sin_expl, key=lambda p: procesos.get(p, "")))
    filas_un_op = "".join(fila_proc(p) for p in sorted(maq_un_operario, key=lambda p: procesos.get(p, "")))

    doc = f"""<!doctype html><html lang=es><head><meta charset=utf-8>
<title>Auditoría de skills — Metlo</title>
<style>
 body{{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:24px;color:#1a1a1a;background:#fafafa}}
 h1{{font-size:22px}} h2{{font-size:17px;margin-top:28px;border-bottom:2px solid #ddd;padding-bottom:4px}}
 table{{border-collapse:collapse;width:100%;background:#fff;font-size:13px;margin-top:8px}}
 th,td{{border:1px solid #e2e2e2;padding:5px 8px;text-align:left;vertical-align:top}}
 th{{background:#f0f0f0;position:sticky;top:0}} td.n{{text-align:right}}
 td.warn{{color:#b00}} .muted{{color:#777}} .pill{{background:#eef;padding:2px 6px;border-radius:4px}}
</style></head><body>
<h1>🧰 Auditoría de skills operario × proceso — Metlo</h1>
<p class=muted>Operarios: {len(operarios)} · Procesos: {len(procesos)} · Filas de skill: {n_skills}.
Modo del planner: un proceso con ≥1 skill explícita (nivel 1/2 habilitada) queda en
<b>modo estricto</b> (solo esos operarios); sin ninguna, cae al <b>camino por rango</b>.</p>

<h2>⚠️ Operarios sospechosos ({len(sospechosos)})</h2>
<table><tr><th>id</th><th>operario</th><th>sector</th><th>categoría</th><th>n1</th><th>n2</th><th>n0</th><th>motivo</th></tr>{filas_sosp or '<tr><td colspan=8 class=muted>Ninguno</td></tr>'}</table>

<h2>🏭 Procesos de máquina ABIERTOS por rango (0 skills explícitas) — {len(maq_sin_expl)}</h2>
<p class=muted>Estos procesos de máquina no tienen a nadie con skill explícita, así que el planner los abre por rango y puede mal-asignar. Cargar skills acá.</p>
<table><tr><th>id</th><th>proceso</th><th>familia</th><th>#operarios expl.</th></tr>{filas_abiertos or '<tr><td colspan=4 class=muted>Ninguno</td></tr>'}</table>

<h2>🔒 Procesos de máquina con UN SOLO operario habilitado — {len(maq_un_operario)}</h2>
<p class=muted>Cuello de botella: si ese operario no está, el proceso queda sin asignar.</p>
<table><tr><th>id</th><th>proceso</th><th>familia</th><th>#operarios expl.</th></tr>{filas_un_op or '<tr><td colspan=4 class=muted>Ninguno</td></tr>'}</table>

<h2>👥 Resumen por operario</h2>
<p class=muted>n1/n2 = skills explícitas nivel 1/2 · n0 = nativas · "familias máquina" = familias de máquina en las que tiene skill explícita.</p>
<table><tr><th>id</th><th>operario</th><th>sector</th><th>categoría</th><th>n1</th><th>n2</th><th>n0</th><th>familias máquina</th></tr>{filas_op}</table>
</body></html>"""
    path.write_text(doc, encoding="utf-8")


if __name__ == "__main__":
    main()
