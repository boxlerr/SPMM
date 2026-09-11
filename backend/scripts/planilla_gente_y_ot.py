"""La planilla de la gente y las OT viejas, para que el taller la conteste eligiendo.

POR QUÉ ESTA Y NO OTRA TANDA DE TRABAS

La planilla de trabas (`planilla_trabas.py`) pregunta por PROCESOS: en qué máquina se
hace cada uno y quién puede. Ésta pregunta por lo otro que quedó abierto y que ninguna
pantalla puede contestar sola, porque es conocimiento del taller:

  1. LOS PASANTES. El cuello más grande que tiene el taller hoy, y no estaba anotado en
     ningún lado: 225 de las 1123 pasadas de OT abiertas —el 20%— dependen de Pasante 1
     y Pasante 2 y de NADIE MÁS. Sólo EMBALADO son 144. En el acta del 1/9 figura que ya
     no están, pero en el sistema siguen disponibles y el plan confirmado les asignó 22
     líneas. Si se fueron, ese 20% no tiene quién lo haga y el planificador no lo va a
     decir: se lo va a seguir dando a ellos.

  2. LAS OT VIEJAS. Cinco de 2025 que siguen abiertas, entregadas a medias. El sistema
     viejo tiene datos que SPMM no —remitos, fechas prometidas movidas, una solicitud de
     cambio de modelo— así que la foto va puesta en la planilla.

  3. LOS RANGOS POR ESPECIALIDAD. Lo que se pidió el 28/8: que un oficial soldador no
     sea lo mismo que un oficial tornero. La grilla va PRECARGADA con lo que el sistema
     cree hoy, sacado de las habilidades de cada uno, para que Lucas corrija en vez de
     escribir.

  4. LOS CUELLOS DE UNA SOLA PERSONA. Nueve trabajos que hoy los puede hacer una sola
     persona. No es un error: es un riesgo, y él es el único que sabe si está bien.

  5. LAS MÁQUINAS RESERVADAS. TORNO 5 y TORNO 6 sólo aceptan MEDIO OFICIAL. Puede ser a
     propósito —como la PLEGADORA, que se preguntó y era deliberado— o puede ser un dato
     que quedó a medias.

CÓMO ESTÁ ARMADA

Igual que la que ya contestó: colores iguales (amarillo = te toca, verde = ya está),
todo con listas desplegables y NINGUNA celda de texto libre. Las opciones no llevan coma
adentro, porque una lista con comas se rompe en Excel — así fracasó la primera planilla.

    .venv/bin/python -m backend.scripts.planilla_gente_y_ot
    .venv/bin/python -m backend.scripts.planilla_gente_y_ot --salida /ruta/archivo.xlsx
"""
import asyncio
import os
import re
import sys
from datetime import date

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

SALIDA = None
if "--salida" in sys.argv:
    SALIDA = sys.argv[sys.argv.index("--salida") + 1]
SALIDA = SALIDA or os.path.join(
    "tmp", f"La gente y las OT viejas - Metlo - {date.today():%Y-%m-%d}.xlsx")

# La paleta de la planilla que ya contestó. No es decoración: la contestó una vez con
# estos colores y cambiarlos ahora es volver a explicarle la planilla.
AZUL, VERDE, AMARILLO, ROSA, VERDE_CLARO = "FF2E5C8A", "FF217346", "FFFFF2CC", "FFFFC7CE", "FFE2EFDA"
AZUL_OSCURO = "FF1F3864"
BORDE = Border(*[Side(style="thin", color="FFD0D0D0")] * 4)


def _url() -> str:
    u = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or ""
    if not u:
        sys.exit("No hay SUPABASE_DB_URL en el .env")
    u = re.sub(r"\?.*$", "", u)
    if u.startswith("postgresql://"):
        u = u.replace("postgresql://", "postgresql+asyncpg://", 1)
    return u.replace(":5432/", ":6543/")


def _titulo(ws, celda, txt, fondo, tam=12, color="FFFFFFFF"):
    ws[celda] = txt
    ws[celda].fill = PatternFill("solid", fgColor=fondo)
    ws[celda].font = Font(bold=True, size=tam, color=color)


# ── Las consultas ────────────────────────────────────────────────────────────
#
# La elegibilidad se arma igual que en el solver: rango ∩ rango_proceso (nativas) más
# las manuales, menos las apagadas, y sólo con gente que existe de verdad
# (`disponible`, que es lo que filtra el planificador para dejar afuera los puestos
# VACANTE). Escribirla acá y no importarla del servicio es a propósito: esto es una
# foto para una planilla, no una decisión del motor, y tiene que poder correr sola.
ELEGIBLES = """
WITH reales AS (SELECT id FROM operario WHERE disponible),
nativas AS (
  SELECT DISTINCT orr.id_operario, rp.id_proceso
  FROM operario_rango orr JOIN rango_proceso rp ON rp.id_rango = orr.id_rango
  WHERE orr.id_operario IN (SELECT id FROM reales)),
manuales AS (
  SELECT id_operario, id_proceso FROM operario_proceso_skill
  WHERE manual AND habilitado AND id_operario IN (SELECT id FROM reales)),
apagadas AS (
  SELECT id_operario, id_proceso FROM operario_proceso_skill WHERE NOT habilitado),
elegibles AS (
  SELECT id_operario, id_proceso FROM (SELECT * FROM nativas UNION SELECT * FROM manuales) u
  WHERE NOT EXISTS (SELECT 1 FROM apagadas a
                    WHERE a.id_operario = u.id_operario AND a.id_proceso = u.id_proceso)),
demanda AS (
  SELECT otp.id_proceso, COUNT(*) AS pasadas
  FROM orden_trabajo_proceso otp JOIN orden_trabajo ot ON ot.id = otp.id_orden_trabajo
  WHERE COALESCE(ot.finalizadototal, 0) = 0 GROUP BY 1)
SELECT p.id, p.nombre, d.pasadas,
       (SELECT COUNT(*) FROM elegibles el WHERE el.id_proceso = p.id) AS cuantos,
       (SELECT string_agg(o.nombre || ' ' || COALESCE(o.apellido, ''), ' y ' ORDER BY o.nombre)
          FROM elegibles el JOIN operario o ON o.id = el.id_operario
         WHERE el.id_proceso = p.id) AS quienes
FROM demanda d JOIN proceso p ON p.id = d.id_proceso
ORDER BY d.pasadas DESC
"""

OT_VIEJAS = """
SELECT ot.id_otvieja, c.nombre AS cliente, COALESCE(a.descripcion, ot.observaciones) AS que_es,
       ot.fecha_entrada::date, ot.unidades, ot.cantidad_entregada,
       (SELECT COUNT(*) FROM orden_trabajo_proceso p WHERE p.id_orden_trabajo = ot.id) AS procesos
FROM orden_trabajo ot
LEFT JOIN cliente c ON c.id = ot.id_cliente
LEFT JOIN articulo a ON a.id = ot.id_articulo
WHERE COALESCE(ot.finalizadototal, 0) = 0 AND ot.fecha_entrada < '2026-01-01'
ORDER BY ot.id_otvieja
"""


async def traer():
    eng = create_async_engine(_url(), connect_args={
        "statement_cache_size": 0, "prepared_statement_cache_size": 0})
    async with eng.connect() as cx:
        elegibles = (await cx.execute(sa.text(ELEGIBLES))).fetchall()
        ot_viejas = (await cx.execute(sa.text(OT_VIEJAS))).fetchall()
        gente = (await cx.execute(sa.text(
            "SELECT o.id, o.nombre || ' ' || COALESCE(o.apellido,'') AS quien, o.sector, "
            "  (SELECT string_agg(rg.nombre, ' + ' ORDER BY rg.nombre) FROM operario_rango orr "
            "     JOIN rango rg ON rg.id = orr.id_rango WHERE orr.id_operario = o.id) AS rangos "
            "FROM operario o WHERE o.disponible ORDER BY 2"))).fetchall()
        maquinas_medio = (await cx.execute(sa.text(
            "SELECT m.nombre, string_agg(rg.nombre, ' + ' ORDER BY rg.nombre) "
            "FROM maquinaria m JOIN rango_maquinaria rm ON rm.id_maquinaria = m.id "
            "JOIN rango rg ON rg.id = rm.id_rango GROUP BY m.id, m.nombre "
            "HAVING string_agg(rg.nombre, ' + ' ORDER BY rg.nombre) = 'MEDIO OFICIAL' "
            "ORDER BY m.nombre"))).fetchall()
    await eng.dispose()
    return elegibles, ot_viejas, gente, maquinas_medio


def armar(elegibles, ot_viejas, gente, maquinas_medio):
    total_pasadas = sum(e[2] for e in elegibles)
    pasantes = [e for e in elegibles
                if e[4] and all("pasante" in x.strip().lower() for x in e[4].split(" y "))]
    de_uno = [e for e in elegibles if e[3] == 1]

    preguntas = []

    # ── 1. Los pasantes ──────────────────────────────────────────────────────
    n_pas = sum(p[2] for p in pasantes)
    detalle = " · ".join(f"{p[1].strip()} ({p[2]})" for p in pasantes[:6])
    preguntas.append({
        "grupo": "LA GENTE",
        "trabajo": "Pasante 1 y Pasante 2",
        "pregunta": "¿Los dos pasantes siguen trabajando en el taller?",
        "lista": "siguen",
        "porque": (f"Es la pregunta más importante de toda la planilla. Hoy {n_pas} de las "
                   f"{total_pasadas} pasadas de trabajo abierto —el {round(100*n_pas/total_pasadas)}%— "
                   f"las puede hacer SOLO uno de ellos dos y nadie más: {detalle}. "
                   f"Si ya no están, ese trabajo no tiene quién lo haga y el sistema no lo va a "
                   f"avisar: se lo va a seguir asignando a ellos."),
    })
    if pasantes:
        preguntas.append({
            "grupo": "LA GENTE",
            "trabajo": pasantes[0][1].strip(),
            "pregunta": f"Si los pasantes no están: ¿quién hace ahora «{pasantes[0][1].strip()}»?",
            "lista": "gente",
            "porque": (f"Es el trabajo más repetido del taller: {pasantes[0][2]} pasadas en las OT "
                       f"abiertas. Hoy figura que lo hacen sólo los pasantes."),
        })

    # ── 2. Los cuellos de una sola persona ──────────────────────────────────
    for _id, nombre, pasadas, _c, quien in de_uno[:8]:
        preguntas.append({
            "grupo": "UNA SOLA PERSONA",
            "trabajo": nombre.strip(),
            "pregunta": f"«{nombre.strip()}» hoy lo puede hacer sólo {quien.strip()}. ¿Está bien así?",
            "lista": "cuello",
            "porque": (f"{pasadas} pasadas en OT abiertas dependen de una sola persona. Si se toma "
                       f"vacaciones o falta, esas {pasadas} se quedan sin asignar y el sistema no "
                       f"va a explicar por qué."),
        })

    # ── 3. Las OT viejas ────────────────────────────────────────────────────
    for ot, cliente, que_es, entrada, unidades, entregado, procesos in ot_viejas:
        preguntas.append({
            "grupo": "LAS OT VIEJAS",
            "trabajo": f"OT {ot}",
            "pregunta": f"La OT {ot} sigue abierta desde {entrada:%d/%m/%Y}. ¿Qué hacemos?",
            "lista": "ot",
            "porque": (f"{(cliente or 'sin cliente')[:38]} · {(que_es or '')[:60]} · "
                       f"entregadas {entregado or 0} de {unidades or 0} · {procesos} procesos cargados. "
                       f"El avance real está en el sistema viejo, acá no."),
        })

    # ── 4. Las máquinas reservadas ──────────────────────────────────────────
    for nombre, rangos in maquinas_medio:
        preguntas.append({
            "grupo": "LAS MÁQUINAS",
            "trabajo": nombre.strip(),
            "pregunta": f"A «{nombre.strip()}» hoy sólo la puede usar un MEDIO OFICIAL. ¿Un oficial también?",
            "lista": "maquina",
            "porque": ("Si es a propósito, no se toca — pasa lo mismo con la plegadora. Si no, "
                       "habilitando al oficial se destraba sin cambiar nada más."),
        })

    opciones = {
        "siguen": ["Siguen los dos", "Se fue uno", "Se fueron los dos", "No sé"],
        "gente": [g[1].strip() for g in gente] + ["Nadie por ahora", "No sé"],
        "cuello": ["Está bien: lo hace sólo esa persona", "Tendría que poder hacerlo alguien más", "No sé"],
        "ot": ["Ya se entregó: cerrarla", "Falta trabajo de verdad", "Se cancela", "No sé"],
        "maquina": ["Sí: un oficial también puede", "No: es a propósito", "No sé"],
    }
    return preguntas, opciones


def escribir(preguntas, opciones, salida):
    wb = Workbook()
    wb.remove(wb.active)

    # ── EMPEZÁ ACÁ ──
    ws = wb.create_sheet("EMPEZÁ ACÁ")
    ws.sheet_view.showGridLines = False
    for c, w in (("A", 4), ("B", 26), ("C", 95)):
        ws.column_dimensions[c].width = w
    _titulo(ws, "B2", "La gente y las OT viejas", AZUL_OSCURO, 16)
    ws["B3"] = f"Metalúrgica Longchamps · {date.today():%d/%m/%Y}"
    ws["B3"].font = Font(size=11, color="FF666666")
    _titulo(ws, "B5", "Qué hay que hacer", AZUL, 12)
    for i, (n, txt) in enumerate([
        ("1", "Andá a la hoja de abajo que dice PREGUNTAS."),
        ("2", "Contestá la columna amarilla. Hacé clic en la celda y elegí de la lista: no hace falta escribir nada."),
        ("3", "Si no sabés, elegí «No sé». Es una respuesta válida y me sirve igual."),
        ("4", "Cuando termines, mandámela."),
    ], start=6):
        ws[f"B{i}"] = f"  {n}"
        ws[f"B{i}"].font = Font(bold=True, size=11)
        ws[f"C{i}"] = txt
        ws[f"C{i}"].alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[i].height = 30
    ws["B11"] = f"Son {len(preguntas)} preguntas. Cada una se contesta con un clic."
    ws["B11"].font = Font(bold=True, size=12)
    ws["B13"] = ("La primera es la más importante de todas: si los dos pasantes ya no están, "
                 "hay una quinta parte del trabajo abierto que hoy no tiene quién lo haga y "
                 "el sistema se lo sigue asignando a ellos.")
    ws["B13"].alignment = Alignment(wrap_text=True, vertical="top")
    ws["B13"].fill = PatternFill("solid", fgColor=AMARILLO)
    ws.merge_cells("B13:C14")
    ws.row_dimensions[13].height = 30

    # ── Listas (ocultas: una lista escrita adentro de la fórmula se rompe con las comas) ──
    wl = wb.create_sheet("Listas")
    wl.sheet_state = "hidden"
    for i, (clave, valores) in enumerate(opciones.items(), start=1):
        col = get_column_letter(i)
        wl[f"{col}1"] = clave
        for j, v in enumerate(valores, start=2):
            wl[f"{col}{j}"] = v

    # ── PREGUNTAS ──
    ws = wb.create_sheet("PREGUNTAS")
    ws.sheet_view.showGridLines = False
    for c, w in (("A", 5), ("B", 30), ("C", 62), ("D", 34), ("E", 72)):
        ws.column_dimensions[c].width = w
    ws.freeze_panes = "A4"
    _titulo(ws, "A1", "Contestá la columna amarilla eligiendo de la lista", AZUL_OSCURO, 16)
    ws["A2"] = f'=CONCATENATE("Contestadas: ",COUNTA(D5:D1000)," de {len(preguntas)}")'
    ws["A2"].fill = PatternFill("solid", fgColor=VERDE_CLARO)
    ws["A2"].font = Font(bold=True, size=12)
    for celda, txt, fondo in (("B3", "DE QUÉ SE TRATA", AZUL), ("C3", "LA PREGUNTA", AZUL),
                              ("D3", "TU RESPUESTA", VERDE), ("E3", "¿Por qué te pregunto esto?", AZUL)):
        _titulo(ws, celda, txt, fondo, 11)

    fila, n, grupo_actual, tramos = 4, 0, None, []
    for p in preguntas:
        if p["grupo"] != grupo_actual:
            grupo_actual = p["grupo"]
            ws.merge_cells(f"A{fila}:E{fila}")
            _titulo(ws, f"A{fila}", f"   {grupo_actual}", AZUL, 12)
            ws.row_dimensions[fila].height = 22
            fila += 1
        n += 1
        ws[f"A{fila}"] = n
        ws[f"A{fila}"].fill = PatternFill("solid", fgColor=ROSA)
        ws[f"A{fila}"].font = Font(bold=True, size=11)
        ws[f"A{fila}"].alignment = Alignment(horizontal="center")
        ws[f"B{fila}"] = p["trabajo"]
        ws[f"B{fila}"].font = Font(bold=True, size=11)
        ws[f"C{fila}"] = p["pregunta"]
        ws[f"D{fila}"].fill = PatternFill("solid", fgColor=AMARILLO)
        ws[f"D{fila}"].font = Font(bold=True, size=11)
        ws[f"E{fila}"] = p["porque"]
        ws[f"E{fila}"].font = Font(size=9, color="FF666666")
        for col in "BCDE":
            ws[f"{col}{fila}"].alignment = Alignment(wrap_text=True, vertical="top")
            ws[f"{col}{fila}"].border = BORDE
        ws.row_dimensions[fila].height = 52
        tramos.append((p["lista"], fila))
        fila += 1

    por_lista = {}
    for clave, f in tramos:
        por_lista.setdefault(clave, []).append(f)
    for clave, filas in por_lista.items():
        col = get_column_letter(list(opciones).index(clave) + 1)
        dv = DataValidation(type="list",
                            formula1=f"Listas!${col}$2:${col}${len(opciones[clave]) + 1}",
                            allow_blank=True, showDropDown=False)
        dv.error = "Elegí una opción de la lista."
        ws.add_data_validation(dv)
        for f in filas:
            dv.add(f"D{f}")

    os.makedirs(os.path.dirname(salida) or ".", exist_ok=True)
    wb.save(salida)
    return salida


async def main():
    elegibles, ot_viejas, gente, maquinas_medio = await traer()
    preguntas, opciones = armar(elegibles, ot_viejas, gente, maquinas_medio)
    ruta = escribir(preguntas, opciones, SALIDA)
    for g in dict.fromkeys(p["grupo"] for p in preguntas):
        print(f"  {sum(1 for p in preguntas if p['grupo'] == g):>3}  {g}")
    print(f"\n{len(preguntas)} preguntas → {ruta}")


if __name__ == "__main__":
    asyncio.run(main())
