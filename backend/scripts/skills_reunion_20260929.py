"""
Quién hace torno y fresado, como lo dijo Lucas en la reunión del 29/9/2026.

    .venv/bin/python -m backend.scripts.skills_reunion_20260929            # en seco
    .venv/bin/python -m backend.scripts.skills_reunion_20260929 --aplicar  # escribe

POR QUÉ. En el plan de las 48 OT del piloto, Guillermo Celiz tenía torneados y fresados y
Alejandro Gutiérrez torneados. Lucas: «Celiz no es fresador, es oficial plegador»; «la
skill uno de Gustavo es el torno; Alejandro, del fresado». Lo mismo había contestado el
taller en la planilla del 15/9 (resolver_trabas_20260915.ESPECIALIDAD).

Por qué pasaba, medido el 29/9:
  · Celiz tiene la categoría OFICIAL en SPMM (en el Excel «Rangos y Procesos METLO» figura
    sólo como OFICIAL PLEGADOR y OPERARIO CALIFICADO), y con eso puede hacer cualquier
    trabajo de oficial; encima tenía SKILL 1 en preparación de torno y SKILL 2 en torneado y
    fresado.
  · Alejandro tenía SKILL 1 en torneado, igual que Gustavo: para el planificador eran lo
    mismo y el torno se lo llevaba el que estuviera libre.

QUÉ HACE (sólo filas de operario_proceso_skill, con respaldo):
  · Celiz: se le APAGAN el torneado, el fresado, sus preparaciones y el agujereado en
    fresadora. Es el mecanismo de Recursos para que alguien no haga algo que su categoría le
    da; no se le toca la categoría, que le da también la soldadura (su SKILL 2 en el Excel).
    El cilindrado de chapa y de planchuela sí los hace (Excel): no se tocan.
  · Alejandro: el torneado y la preparación de torno pasan de SKILL 1 a SKILL 2. Los puede
    seguir haciendo si Gustavo está ocupado, pero Gustavo va primero.

Se deshace desde Recursos (la ficha de cada persona) o con el respaldo
backup_<fecha>_skills_reunion.
"""
import asyncio
import os
import re
import sys
from datetime import datetime, timedelta, timezone

APLICAR = "--aplicar" in sys.argv
_TZ_AR = timezone(timedelta(hours=-3))

CELIZ = (31, "GUILLERMO CELIZ")
ALEJANDRO = (34, "ALEJANDRO GUTIERREZ")

# {id de proceso: nombre} — los nombres se controlan antes de escribir.
APAGAR_A_CELIZ = {
    151: "TORNEADO",
    105: "PREPARACION DE TORNO",
    292: "PREPARACION DE TORNO CNC",
    102: "PREPARACION DE ROSCADOR",
    68: "FRESADO CONVENCIONAL",
    96: "PREPARACION DE FRESADORA",
    290: "PREPARACION DE FRESADORA CNC",
    1: "AGUJEREADO EN FRESADORA",
}
A_SKILL_2_DE_ALEJANDRO = {
    151: "TORNEADO",
    105: "PREPARACION DE TORNO",
}


def _url():
    from dotenv import find_dotenv, load_dotenv
    load_dotenv(find_dotenv(usecwd=True))
    u = re.sub(r"^postgresql\+\w+://", "postgresql://", os.getenv("SUPABASE_DB_URL")).split("?")[0]
    return u.replace(":5432/", ":6543/")


async def main():
    import asyncpg

    sello = datetime.now(_TZ_AR).strftime("%Y%m%d_%H%M%S")
    c = await asyncpg.connect(_url(), statement_cache_size=0)
    try:
        tr = c.transaction()
        await tr.start()
        terminada = False
        try:
            nombres = {r["id"]: r["nombre"] for r in await c.fetch(
                "SELECT id, nombre FROM proceso WHERE id = ANY($1::int[])",
                list(APAGAR_A_CELIZ) + list(A_SKILL_2_DE_ALEJANDRO))}
            personas = {r["id"]: f"{r['nombre']} {r['apellido'] or ''}".strip() for r in await c.fetch(
                "SELECT id, nombre, apellido FROM operario WHERE id = ANY($1::int[])",
                [CELIZ[0], ALEJANDRO[0]])}
            errores = [f"proceso {p} no es {n!r}" for p, n in {**APAGAR_A_CELIZ, **A_SKILL_2_DE_ALEJANDRO}.items()
                       if nombres.get(p) != n]
            errores += [f"operario {i} no es {n!r}" for i, n in (CELIZ, ALEJANDRO) if personas.get(i) != n]
            if errores:
                print("!! Los datos cambiaron; no se toca nada:", errores)
                terminada = True
                await tr.rollback()
                return 2

            await c.execute(
                f"CREATE TABLE backup_{sello}_skills_reunion AS SELECT * FROM operario_proceso_skill "
                f"WHERE id_operario IN ({CELIZ[0]}, {ALEJANDRO[0]})")
            await c.execute(f"ALTER TABLE backup_{sello}_skills_reunion ENABLE ROW LEVEL SECURITY")

            print(f"== {CELIZ[1]}: no hace torno ni fresado")
            for pid, nom in APAGAR_A_CELIZ.items():
                antes = await c.fetchrow(
                    "SELECT nivel, habilitado, manual FROM operario_proceso_skill "
                    "WHERE id_operario = $1 AND id_proceso = $2", CELIZ[0], pid)
                await c.execute("""
                    INSERT INTO operario_proceso_skill (id_operario, id_proceso, nivel, habilitado, manual)
                    VALUES ($1, $2, 0, FALSE, FALSE)
                    ON CONFLICT (id_operario, id_proceso) DO UPDATE SET habilitado = FALSE""", CELIZ[0], pid)
                print(f"   {nom:32} {('nivel %s, %s' % (antes['nivel'], 'encendida' if antes['habilitado'] else 'apagada')) if antes else 'sin fila'} → apagada")

            print(f"== {ALEJANDRO[1]}: el torno, de SKILL 1 a SKILL 2")
            for pid, nom in A_SKILL_2_DE_ALEJANDRO.items():
                antes = await c.fetchrow(
                    "SELECT nivel FROM operario_proceso_skill WHERE id_operario = $1 AND id_proceso = $2",
                    ALEJANDRO[0], pid)
                await c.execute("""
                    INSERT INTO operario_proceso_skill (id_operario, id_proceso, nivel, habilitado, manual)
                    VALUES ($1, $2, 2, TRUE, FALSE)
                    ON CONFLICT (id_operario, id_proceso) DO UPDATE SET nivel = 2""", ALEJANDRO[0], pid)
                print(f"   {nom:32} SKILL {antes['nivel'] if antes else '-'} → SKILL 2")

            terminada = True
            if APLICAR:
                await tr.commit()
                print(f"\n== HECHO. Respaldo: backup_{sello}_skills_reunion")
            else:
                await tr.rollback()
                print("\n== En seco: todo deshecho. Para escribir: --aplicar")
            return 0
        except BaseException:
            if not terminada:
                try:
                    await tr.rollback()
                except Exception:
                    pass
            raise
    finally:
        await c.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
