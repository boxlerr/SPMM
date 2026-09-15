"""Aplica las respuestas del taller que la planilla no podía cargar.

POR QUÉ EXISTE

El 15/09 se cargaron las 41 respuestas de la planilla del 11/9 y quedaron 25 preguntas
abiertas. De esas 25, la mayoría YA estaban contestadas: lo que pasaba es que la respuesta
no entraba en ninguna tabla. Decisión de Julián ese mismo día: no volver a preguntar, y
resolverlas acá con el mejor criterio disponible.

Lo que se decidió, y por qué cada una es segura:

1. LOS SEIS TRABAJOS QUE NO LLEVAN MÁQUINA FIJA → se marcan «a mano».
   El taller contestó, para cada uno, algo que no era una máquina del taller:
     · ENDEREZADO                     «prensa 1/prensa 2/plegadora/A MANO SIN MAQUINA —
                                       depende el trabajo, se especifica en cada OT»
     · OXICORTE                       «tubo de oxígeno y soplete»  (no es una máquina)
     · PREPARACION DE EQUIPO OXICORTE  ídem
     · PREPARACION DE PINTURA         «compresor y pistola de pintura» (ídem)
     · FABRICACION DE DISPISITIVO     «no tiene máquina específica»
     · PREPARACION DISPOSITIVO         ídem
   Hasta hoy eso no se podía decir: la máquina vacía significa «que elija el planificador»
   y el planificador salía a buscarle una igual. Con la columna nueva
   (`orden_trabajo_proceso.no_lleva_maquina`) se dice y listo.
   NO CAMBIA EL PLAN: esos pasos ya entraban con máquina «dummy» porque no se les
   encontraba ninguna. Lo único que cambia es que dejan de figurar como pregunta abierta,
   y que el que carga una OT puede elegir otra cosa cuando ese trabajo sí va en máquina.

2. TORNO 5 y TORNO 6 CINDELMET → pasan a aceptar OFICIAL.
   El taller contestó «también la puede usar un MEDIO OFICIAL», pero las dos YA piden
   MEDIO OFICIAL: la respuesta no cambiaba nada porque la lista de opciones que se les dio
   no excluía la categoría que la máquina ya tenía. Medido: de los 135 trabajos de torno de
   las OT abiertas, TODOS piden OFICIAL y NINGUNO pide MEDIO OFICIAL, así que esas dos
   máquinas hoy entran en CERO trabajos — están muertas en el plan. Y con MEDIO OFICIAL hay
   una sola persona (Nahuel Baez, de Soldadura). Agregarles OFICIAL es lo que el taller
   quiso decir («no es a propósito») y pone dos tornos a disposición del plan.

3. SOLDADURA 2 → se borra esa pasada de la OT 15755.
   El taller pidió eliminarlo dos veces (2/9 y 11/9): «ELIMINAR PROCESOS (SERIA
   SOLDADURA)». Es una sola pasada, con CERO minutos, en una OT que ya tiene sus tres
   soldaduras de verdad (con aluminio, con MIG ×2, aporte duro). Sacarla no cambia un
   minuto del plan y deja el proceso del catálogo sin uso, que es lo que hacía falta para
   poder borrarlo desde la pantalla. Queda deshacible: `update_processes_full` saca una
   foto de los procesos antes de tocar nada.

4. LOS SEIS OFICIALES → se los prefiere en lo suyo, sin prohibirle nada a nadie.
   Contestaron su especialidad (fresador, plegador, tornero, programador de torno CNC,
   fresador CNC, torno CNC) y no hay dónde guardarla: la persona tiene CATEGORÍA, no
   especialidad. Crear categorías nuevas le cambia el plan a todos los que hoy son OFICIAL,
   y apagar habilidades puede dejar trabajos sin nadie (ya casi pasa con Leonardo).
   Lo que sí existe es el NIVEL de habilidad, que el planificador usa como PREFERENCIA y
   no como permiso (PlanificacionService: «Mapa de PRIORIDAD… No define quién»). Así que se
   le pone nivel 1 a cada uno en los trabajos de SU familia de máquina.
   Resultado: el plan le da la fresadora al fresador y el torno al tornero, pero si el
   tornero no está, el trabajo igual sale. Nadie queda bloqueado.
   EL CANDADO: sólo se marcan los trabajos que esa persona YA PUEDE hacer hoy por su
   categoría — el mismo cruce categoría-de-la-persona × categorías-del-trabajo que mira el
   planificador para decidir elegibilidad. Si ya podía, marcarlo preferido no le da ningún
   permiso nuevo; y a quien no podía, no se le agrega nada. Así esto no puede cambiar quién
   hace qué, sólo a quién se le da primero.

   Limitación, dicha para que no sorprenda: el planificador mete TORNO y TORNO CNC en la
   misma familia, así que entre el tornero y el de torno CNC no los distingue. Para eso
   hace falta separar las familias, que es otra tarea.

CÓMO SE CORRE

    .venv/bin/python -m backend.scripts.resolver_trabas_20260915
    .venv/bin/python -m backend.scripts.resolver_trabas_20260915 --aplicar

Sin `--aplicar` no escribe nada.
"""
import asyncio
import os
import sys

from dotenv import load_dotenv
from sqlalchemy import text

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

from backend.application.PlanificacionService import familia_requerida_from_proceso  # noqa: E402
from backend.infrastructure.db import SessionLocal                                   # noqa: E402

APLICAR = "--aplicar" in sys.argv

# Sólo las OT que siguen abiertas: no se toca historia ya entregada.
ABIERTA = ("COALESCE(ot.finalizadototal, 0) = 0 "
           "AND (ot.fecha_entrega IS NULL OR EXTRACT(YEAR FROM ot.fecha_entrega) <= 1950)")

SIN_MAQUINA_FIJA = {
    50: "ENDEREZADO — prensa/plegadora/a mano según el trabajo",
    82: "OXICORTE — tubo de oxígeno y soplete, no es una máquina del taller",
    95: "PREPARACION DE EQUIPO OXICORTE — ídem",
    99: "PREPARACION DE PINTURA — compresor y pistola, no es una máquina del taller",
    66: "FABRICACION DE DISPISITIVO — depende del dispositivo",
    106: "PREPARACION DISPOSITIVO — depende del dispositivo",
}

MAQUINAS_A_ABRIR = ["TORNO 5", "TORNO 6 CINDELMET"]
RANGO_A_AGREGAR = "OFICIAL"

# La pasada a sacar: proceso SOLDADURA 2 dentro de la OT 15755.
PROCESO_A_SACAR, OT_DEL_PROCESO = 132, 15755

ESPECIALIDAD = {
    34: ("ALEJANDRO GUTIERREZ", "FRESADORA"),
    31: ("GUILLERMO CELIZ", "PLEGADORA"),
    35: ("GUSTAVO ROMERO", "TORNO"),
    30: ("IVAN BALMACEDA", "TORNO"),
    37: ("MATIAS VEGA", "FRESADORA"),
    38: ("PABLO ZANOTTI", "TORNO"),
}


async def main():
    async with SessionLocal() as s:
        plan = []   # (sql, params, texto)

        # ── 1. los que van a mano ────────────────────────────────────────────
        print("1. TRABAJOS QUE NO LLEVAN MÁQUINA FIJA")
        total_marcar = 0
        for pid, porque in SIN_MAQUINA_FIJA.items():
            filas = (await s.execute(text(f"""
                SELECT otp.id FROM orden_trabajo_proceso otp
                JOIN orden_trabajo ot ON ot.id = otp.id_orden_trabajo
                WHERE otp.id_proceso = :p AND COALESCE(otp.no_lleva_maquina, 0) = 0
                  AND {ABIERTA}"""), {"p": pid})).scalars().all()
            print(f"   {porque}\n      -> {len(filas)} pasadas abiertas a marcar")
            total_marcar += len(filas)
            if filas:
                plan.append(("UPDATE orden_trabajo_proceso SET no_lleva_maquina = 1 "
                             "WHERE id = ANY(:ids)", {"ids": list(filas)},
                             f"marcar a mano {len(filas)} pasadas de {porque.split(' — ')[0]}"))

        # ── 2. abrir los dos tornos ──────────────────────────────────────────
        print(f"\n2. MÁQUINAS QUE PASAN A ACEPTAR {RANGO_A_AGREGAR}")
        id_rango = (await s.execute(text("SELECT id FROM rango WHERE nombre = :n"),
                                    {"n": RANGO_A_AGREGAR})).scalar()
        for nombre in MAQUINAS_A_ABRIR:
            fila = (await s.execute(text("SELECT id FROM maquinaria WHERE nombre = :n"),
                                    {"n": nombre})).scalar()
            if not fila:
                print(f"   {nombre}: no está en el taller, se saltea"); continue
            ya = (await s.execute(text("SELECT 1 FROM rango_maquinaria "
                                       "WHERE id_maquinaria = :m AND id_rango = :r"),
                                  {"m": fila, "r": id_rango})).scalar()
            acepta = [x for x in (await s.execute(text(
                "SELECT g.nombre FROM rango_maquinaria rm JOIN rango g ON g.id = rm.id_rango "
                "WHERE rm.id_maquinaria = :m"), {"m": fila})).scalars().all()]
            print(f"   {nombre}: hoy acepta {acepta} -> {'ya estaba' if ya else 'se agrega ' + RANGO_A_AGREGAR}")
            if not ya:
                plan.append(("INSERT INTO rango_maquinaria (id_maquinaria, id_rango) "
                             "VALUES (:m, :r) ON CONFLICT DO NOTHING",
                             {"m": fila, "r": id_rango},
                             f"{nombre} pasa a aceptar {RANGO_A_AGREGAR}"))

        # ── 3. sacar la pasada de SOLDADURA 2 ────────────────────────────────
        print("\n3. LA PASADA QUE EL TALLER PIDIÓ ELIMINAR")
        fila = (await s.execute(text(f"""
            SELECT otp.id, otp.tiempo_proceso FROM orden_trabajo_proceso otp
            JOIN orden_trabajo ot ON ot.id = otp.id_orden_trabajo
            WHERE otp.id_proceso = :p AND ot.id_otvieja = :ot AND {ABIERTA}"""),
            {"p": PROCESO_A_SACAR, "ot": OT_DEL_PROCESO})).first()
        if not fila:
            print("   SOLDADURA 2 ya no está en la OT 15755, no hay nada que sacar")
        elif (fila[1] or 0) != 0:
            # Si alguien le cargó minutos desde que se decidió, ya no es el caso inerte
            # que se aprobó: se frena y se avisa, no se borra trabajo real.
            print(f"   ⚠ SOLDADURA 2 ahora tiene {fila[1]} minutos cargados: NO se toca, hay que mirarlo")
        else:
            print(f"   SOLDADURA 2 en la OT {OT_DEL_PROCESO}: 0 minutos -> se saca (pasada {fila[0]})")
            plan.append(("DELETE FROM orden_trabajo_proceso WHERE id = :id", {"id": fila[0]},
                         f"sacar SOLDADURA 2 de la OT {OT_DEL_PROCESO}"))

        # ── 4. preferir a cada oficial en lo suyo ────────────────────────────
        print("\n4. A CADA OFICIAL SE LO PREFIERE EN SU FAMILIA (preferencia, no permiso)")
        procesos = (await s.execute(text(f"""
            SELECT DISTINCT p.id, p.nombre FROM proceso p
            JOIN orden_trabajo_proceso otp ON otp.id_proceso = p.id
            JOIN orden_trabajo ot ON ot.id = otp.id_orden_trabajo
            WHERE {ABIERTA}"""))).all()
        por_familia = {}
        for pid, nombre in procesos:
            fam = familia_requerida_from_proceso(nombre or "")
            if fam:
                por_familia.setdefault(fam, []).append(pid)

        for id_op, (nombre, familia) in ESPECIALIDAD.items():
            suyos = por_familia.get(familia, [])
            if not suyos:
                print(f"   {nombre} ({familia}): no hay trabajos de esa familia en OT abiertas")
                continue
            # SÓLO los trabajos que esa persona YA PUEDE hacer hoy por su categoría.
            #
            # Éste es el candado que hace que esto no cambie quién hace qué: se filtra
            # por el cruce categoría-de-la-persona × categorías-del-trabajo, que es lo
            # mismo que mira el planificador para decidir si alguien es elegible. Si ya
            # podía, marcarlo preferido no le da permiso nuevo; y a quien no podía, no
            # se le agrega nada. La primera versión de esto sólo actualizaba filas que
            # ya existieran y era casi un no-op: cinco de los seis no tienen ninguna
            # habilidad cargada porque son elegibles por su categoría, sin fila propia.
            puede = (await s.execute(text("""
                SELECT p.id FROM proceso p
                WHERE p.id = ANY(:ps) AND EXISTS (
                    SELECT 1 FROM rango_proceso rp
                    JOIN operario_rango orr ON orr.id_rango = rp.id_rango
                    WHERE rp.id_proceso = p.id AND orr.id_operario = :o)"""),
                {"o": id_op, "ps": suyos})).scalars().all()
            print(f"   {nombre} ({familia}): {len(suyos)} trabajos de su familia, "
                  f"{len(puede)} que ya puede hacer -> pasan a preferencia 1")
            if puede:
                plan.append(("""
                    INSERT INTO operario_proceso_skill (id_operario, id_proceso, nivel, habilitado, manual)
                    SELECT :o, x, 1, TRUE, FALSE FROM UNNEST(CAST(:ps AS int[])) AS x
                    ON CONFLICT (id_operario, id_proceso)
                    DO UPDATE SET nivel = 1, habilitado = TRUE""",
                             {"o": id_op, "ps": list(puede)},
                             f"{nombre} pasa a ser el preferido en {familia} "
                             f"({len(puede)} trabajos)"))

        print(f"\n{'='*70}\nCambios a aplicar: {len(plan)}")
        for _, _, txt in plan:
            print(f"   · {txt}")
        if not plan:
            print("Nada que hacer."); return
        if not APLICAR:
            print("\nEsto fue una prueba en seco. Para escribir de verdad: --aplicar")
            return

        for sql, params, _ in plan:
            await s.execute(text(sql), params)
        await s.commit()
        print(f"\nListo: {len(plan)} cambios aplicados.")


if __name__ == "__main__":
    asyncio.run(main())
