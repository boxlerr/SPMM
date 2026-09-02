"""
Carga las respuestas de la planilla de trabas que contestó Lucas el 2/9/2026.

Es la tarea #1 del acta del 28/08: en vez de corregir traba por traba en cada
planificación, Lucas completó de una las 45 preguntas y acá se vuelcan.

Cada cambio dice de qué respuesta sale. Corre con `--aplicar`; sin eso solo muestra
qué haría, que es como conviene mirarlo la primera vez.

Lo que NO está acá:
  · «Tubo oxígeno» para oxicorte → no existe como maquinaria en el taller.
  · «Soldadura 2» → él mismo lo rotuló «(eliminar)».
  · «Preparación dispositivo: puede ser para cualquier máquina» y «fabricación de
    dispositivo: hay que especificar en la OT» → sin restricción que cargar.
  · Los siete cuellos de capacidad → contestó «hay que verlo en la planificación».
"""
import argparse, asyncio, os, re, sys

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine

URL = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
if URL and URL.startswith("postgresql://"):
    URL = URL.replace("postgresql://", "postgresql+asyncpg://", 1)
URL = re.sub(r"\?.*$", "", URL or "")

# ── Rangos y gente, por id. Los ids se verifican contra la base antes de escribir.
TERCERIZADO, OFICIAL, OFICIAL_PLEGADOR, OPERARIO_CALIF, MEDIO_OFICIAL = 13, 6, 9, 10, 4
TORNOS_CONVENCIONALES = [1, 2, 3, 4, 18, 19]   # TORNO 1..4, TORNO 5, TORNO 6 CINDELMET
PRENSAS_Y_PLEGADORA = [21, 22, 15]             # PRENSA 1, PRENSA 2, PLEGADORA
RECTIFICADORA_TANGENCIAL = 27
LEONARDO_A, GUILLERMO_C, NAHUEL_B, JORGE_L = 29, 31, 49, 50

# ── (proceso_id, [rangos que quedan], por qué)
RANGOS_DE_PROCESO = [
    (22,  [TERCERIZADO],      "P9: «cilindrado de chapa no se hace en torno (TERCERIZADO si no se especifica)»"),
    (129, [TERCERIZADO],      "P13/14: «repujado en torno se manda a hacer afuera»"),
    (109, [OFICIAL_PLEGADOR], "P4: «preparación plegadora → OFICIAL PLEGADOR»"),
    (99,  [OPERARIO_CALIF],   "P11/20: «preparación de pintura la hace Leonardo A.» (tenía OFICIAL PLEGADOR, que él no tiene)"),
    (134, [OPERARIO_CALIF],   "P12/21: «soldadura con aluminio → Leonardo Argañaraz» (tenía NO CLASIFICADO, que no tiene nadie)"),
    (179, [OPERARIO_CALIF],   "P19/24: «afilado → Jorge López» (no tenía ningún rango)"),
    (256, [MEDIO_OFICIAL],    "P22/23: «ensamblaje, punteado y escuadrado → soldador nuevo»"),
    (11,  [MEDIO_OFICIAL, OPERARIO_CALIF, OFICIAL],
          "P2: «avellanado: de operario calificado para arriba». Se suma OFICIAL y no los oficiales "
          "especializados, porque en la reunión del 1/9 insistió en que la especialidad se respeta."),
    (92,  [MEDIO_OFICIAL, OPERARIO_CALIF, OFICIAL],
          "P6: «preparación de agujereadora: de operario calificado para arriba», igual que avellanado"),
]

# ── (proceso_id, [maquinaria_id], por qué). En qué máquinas se hace, como dato.
#    Antes esto no se podía cargar: el planificador deducía la máquina del NOMBRE del
#    proceso, así que estas cuatro respuestas de Lucas no tenían dónde ir.
MAQUINAS_DE_PROCESO = [
    (128, TORNOS_CONVENCIONALES,
     "P31: «reparación de rosca → tornos convencionales». Los CNC quedan afuera a propósito."),
    (49, PRENSAS_Y_PLEGADORA, "P34: «enderezar de bases → prensas/plegadora»"),
    (121, [RECTIFICADORA_TANGENCIAL],
     "P1: «rectificadora → Oficial, solo rectificadora tangencial». El rango ya estaba "
     "bien; lo que faltaba era poder decir en qué máquina."),
    (101, [RECTIFICADORA_TANGENCIAL], "P3: idem para la preparación de rectificadora"),
]

# ── (operario_id, rango_id, por qué)
RANGOS_DE_OPERARIO = [
    (JORGE_L, OPERARIO_CALIF,
     "P19: Lucas lo dio de alta pero quedó sin ninguna categoría, así que no podía recibir trabajo. "
     "Se le pone la del proceso que él mismo dice que hace (afilado)."),
]

# ── (operario_id, proceso_id, nivel, por qué). `manual` = habilita a la persona sin
#    tocarle el rango a nadie más, que es lo más chico que hace verdad la respuesta.
HABILIDADES = [
    (NAHUEL_B, 133, 1, "P17: «soldadura aporte duro → soldador nuevo»"),
    (NAHUEL_B, 136, 1, "P18: «soldadura con electrodo de fundición → soldador nuevo»"),
    (NAHUEL_B, 31,  1, "P25: «corte con amoladora → soldador nuevo/guillermo celiz»"),
    (NAHUEL_B, 103, 1, "P26: «preparación de soldadora → soldador nuevo/guillermo celiz» (MIG)"),
    (NAHUEL_B, 104, 1, "P26: idem, TIG"),
    (NAHUEL_B, 256, 1, "P22/23: «ensamblaje, punteado y escuadrado → soldador nuevo»"),
    (GUILLERMO_C, 136, 1, "P8: «solo guillermo» hace soldadura con electrodo de fundición"),
    (GUILLERMO_C, 31,  1, "P25: corte con amoladora"),
    (GUILLERMO_C, 103, 1, "P26: preparación de soldadora MIG"),
    (GUILLERMO_C, 104, 1, "P26: preparación de soldadora TIG"),
    (JORGE_L, 179, 1, "P19/24: «afilado → Jorge Lopez»"),
    (LEONARDO_A, 134, 1, "P12/21: «soldadura con aluminio → Leonardo Argañaraz»"),
    (LEONARDO_A, 99,  1, "P11/20: «preparación de pintura → Leonardo Argañaraz»"),
    # Bicelado: «SÍ, lo hacen (pero tiene que ser de skill 2 al final)» — el nivel 2 existe
    # en la ficha y el motor lo usa para preferir al de nivel 1, así que se respeta.
    (GUILLERMO_C, 12, 2, "P10: «bicelado: sí, pero de skill 2»"),
    (LEONARDO_A,  12, 2, "P10: idem"),
]

# ── (operario_id, proceso_id, por qué) — apagar, no encender.
APAGAR = [
    (op, 133, "P7: «NO, no lo hacen» soldadura aporte duro")
    for op in (34, 31, 35, 30, 37, 38)   # Gutiérrez, Celiz, Romero, Balmaceda, Vega, Zanotti
] + [
    (op, 136, "P8: «solo guillermo» hace soldadura con electrodo de fundición")
    for op in (34, 35, 30, 37, 38)
]


async def main(aplicar: bool):
    eng = create_async_engine(URL)
    cambios = []
    async with eng.begin() as c:
        nombre_p = {r[0]: r[1] for r in (await c.execute(sa.text("select id, nombre from proceso"))).all()}
        nombre_r = {r[0]: r[1] for r in (await c.execute(sa.text("select id, nombre from rango"))).all()}
        nombre_m = {r[0]: r[1] for r in (await c.execute(sa.text("select id, nombre from maquinaria"))).all()}
        nombre_o = {r[0]: f"{r[1]} {r[2]}".strip()
                    for r in (await c.execute(sa.text("select id, nombre, apellido from operario"))).all()}

        for proc, rangos, motivo in RANGOS_DE_PROCESO:
            if proc not in nombre_p:
                cambios.append(("⚠️  NO EXISTE", f"proceso {proc}", motivo)); continue
            antes = [r[0] for r in (await c.execute(
                sa.text("select id_rango from rango_proceso where id_proceso=:p"), {"p": proc})).all()]
            if sorted(antes) == sorted(rangos):
                cambios.append(("=  ya estaba", f"{nombre_p[proc]}", motivo)); continue
            cambios.append(("→  rangos", f"{nombre_p[proc]}: "
                            f"{', '.join(nombre_r.get(r, str(r)) for r in antes) or '—'}"
                            f"  ⇒  {', '.join(nombre_r[r] for r in rangos)}", motivo))
            if aplicar:
                await c.execute(sa.text("delete from rango_proceso where id_proceso=:p"), {"p": proc})
                for r in rangos:
                    await c.execute(sa.text(
                        "insert into rango_proceso (id_rango, id_proceso) values (:r, :p)"), {"r": r, "p": proc})

        for proc, maquinas, motivo in MAQUINAS_DE_PROCESO:
            if proc not in nombre_p:
                cambios.append(("⚠️  NO EXISTE", f"proceso {proc}", motivo)); continue
            antes = [r[0] for r in (await c.execute(
                sa.text("select id_maquinaria from proceso_maquinaria where id_proceso=:p"),
                {"p": proc})).all()]
            if sorted(antes) == sorted(maquinas):
                cambios.append(("=  ya estaba", f"{nombre_p[proc]} · máquinas", motivo)); continue
            cambios.append(("→  máquinas", f"{nombre_p[proc]}: "
                            f"{', '.join(nombre_m.get(m, str(m)) for m in antes) or '—'}"
                            f"  ⇒  {', '.join(nombre_m.get(m, str(m)) for m in maquinas)}", motivo))
            if aplicar:
                await c.execute(sa.text("delete from proceso_maquinaria where id_proceso=:p"), {"p": proc})
                for m in maquinas:
                    await c.execute(sa.text(
                        "insert into proceso_maquinaria (id_proceso, id_maquinaria) values (:p, :m)"),
                        {"p": proc, "m": m})

        for op, rango, motivo in RANGOS_DE_OPERARIO:
            ya = (await c.execute(sa.text(
                "select 1 from operario_rango where id_operario=:o and id_rango=:r"),
                {"o": op, "r": rango})).first()
            if ya:
                cambios.append(("=  ya estaba", f"{nombre_o[op]} · {nombre_r[rango]}", motivo)); continue
            cambios.append(("→  rango a persona", f"{nombre_o[op]}  ⇒  {nombre_r[rango]}", motivo))
            if aplicar:
                await c.execute(sa.text(
                    "insert into operario_rango (id_operario, id_rango) values (:o, :r)"), {"o": op, "r": rango})

        for op, proc, nivel, motivo in HABILIDADES:
            if proc not in nombre_p:
                cambios.append(("⚠️  NO EXISTE", f"proceso {proc}", motivo)); continue
            fila = (await c.execute(sa.text(
                "select nivel, habilitado from operario_proceso_skill where id_operario=:o and id_proceso=:p"),
                {"o": op, "p": proc})).first()
            if fila and fila[1] and fila[0] == nivel:
                cambios.append(("=  ya estaba", f"{nombre_o[op]} · {nombre_p[proc]} (nivel {nivel})", motivo)); continue
            cambios.append(("→  habilidad", f"{nombre_o[op]} · {nombre_p[proc]}  ⇒  nivel {nivel}, encendida", motivo))
            if aplicar:
                await c.execute(sa.text("""
                    insert into operario_proceso_skill (id_operario, id_proceso, nivel, habilitado, orden, manual)
                    values (:o, :p, :n, true, 0, true)
                    on conflict (id_operario, id_proceso)
                    do update set nivel = :n, habilitado = true, manual = true
                """), {"o": op, "p": proc, "n": nivel})

        for op, proc, motivo in APAGAR:
            fila = (await c.execute(sa.text(
                "select habilitado from operario_proceso_skill where id_operario=:o and id_proceso=:p"),
                {"o": op, "p": proc})).first()
            if fila is None or fila[0] is False:
                cambios.append(("=  ya estaba", f"{nombre_o[op]} · {nombre_p[proc]} apagada", motivo)); continue
            cambios.append(("→  apagar", f"{nombre_o[op]} · {nombre_p[proc]}", motivo))
            if aplicar:
                await c.execute(sa.text("""
                    update operario_proceso_skill set habilitado = false
                    where id_operario=:o and id_proceso=:p"""), {"o": op, "p": proc})

        if not aplicar:
            raise SystemExit_(cambios)
    await eng.dispose()
    return cambios


class SystemExit_(Exception):
    def __init__(self, cambios): self.cambios = cambios


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true", help="escribe de verdad; sin esto solo muestra")
    args = ap.parse_args()
    try:
        cambios = asyncio.run(main(args.aplicar))
    except SystemExit_ as e:
        cambios = e.cambios
    for tipo, que, motivo in cambios:
        print(f"{tipo:22} {que}")
        print(f"{'':22} └ {motivo}")
    tocados = sum(1 for t, _, _ in cambios if t.startswith("→"))
    print(f"\n{tocados} cambios {'APLICADOS' if args.aplicar else 'a aplicar'}, "
          f"{len(cambios) - tocados} sin novedad.")
    if not args.aplicar:
        print("Corré con --aplicar para escribirlos.")
