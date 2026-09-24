"""El registro de uso de cada máquina (RF-10): quién lo escribe y cómo se lee.

QUIÉN ESCRIBE

Nadie desde una pantalla: las filas se abren y se cierran solas cuando un paso de una OT
cambia de estado, en los dos caminos que lo hacen (OrdenTrabajoRepository):

  · update_proceso_status     el paso de a uno (la ficha, el Gantt, la ficha de la persona)
  · marcar_estado_de_ordenes  «marcar como terminadas / en proceso» varias OT de una

  Pendiente → En proceso      se abre un tramo con la máquina del paso
  Terminado → En proceso      se abre OTRO tramo (el paso se reabrió)
  En proceso → Terminado      se cierra el tramo abierto, con sus horas
  En proceso → Pendiente      se cierra y queda «no suma»: el paso volvió atrás, y para
                              los tiempos de RF-06 eso es que no se hizo

QUÉ MÁQUINA

La ELEGIDA A MANO en el paso (`orden_trabajo_proceso.id_maquinaria`) o, si no hay, la
del ÚLTIMO plan que incluyó ese paso (`planificacion.id_maquinaria`, el lote más nuevo).
Se guarda cuál de las dos fue (`origen_maquina`). Sin ninguna —o si el paso se hace a
mano— no hay fila: no hubo máquina.

Una máquina FUERA DE SERVICIO no suma uso nuevo: la fila se escribe igual, para que quede
dicho que se la puso a trabajar así, pero con `no_suma = FUERA_DE_SERVICIO` y un warning
en el log. Pasa porque el planificador todavía no mira el estado (RF-08) y la puede
seguir asignando.

TODO VA EN UN SAVEPOINT Y NUNCA LEVANTA: corre pegado al cambio de estado del paso, que
es lo más usado del sistema. Si la tabla no está (la migración todavía no corrió) o
cualquier cosa falla, se pierde el registro y el cambio de estado se guarda igual.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from sqlalchemy import select, text

from backend.commons.loggers.logger import logger
from backend.domain.Maquinaria import Maquinaria
from backend.domain.Operario import Operario
from backend.domain.OrdenTrabajo import OrdenTrabajo
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.Planificacion import Planificacion
from backend.domain.Proceso import Proceso
from backend.domain.UsoMaquina import (
    NO_SUMA_FUERA_DE_SERVICIO,
    NO_SUMA_VUELTA_A_PENDIENTE,
    ORIGEN_OT,
    ORIGEN_PLAN,
    UsoMaquina,
)

PENDIENTE, EN_PROCESO, TERMINADO = 1, 2, 3


def _nombre_persona(nombre, apellido) -> str:
    return " ".join(p.strip() for p in (nombre or "", apellido or "") if p and p.strip())


class UsoMaquinaRepository:
    def __init__(self, db):
        self.db = db

    # ------------------------------------------------------------------
    # El enganche con el cambio de estado de los pasos
    # ------------------------------------------------------------------

    async def anotar_cambios_sin_romper(self, cambios: list[dict], *, cuando: datetime,
                                        id_usuario: int | None, usuario: str | None) -> None:
        """Abre y cierra tramos de uso según lo que les pasó a los pasos. NUNCA levanta.

        Cada cambio es un dict con lo que había en el paso ANTES del cambio (el estado
        viejo en `antes`) y el estado nuevo en `despues`:
          id_otp, id_orden_trabajo, id_proceso, orden, id_maquinaria, id_operario,
          no_lleva_maquina, tiempo_proceso, antes, despues.
        `cuando` es la MISMA hora que se le estampó al paso (inicio_real / fin_real).
        """
        cambios = [c for c in cambios or () if c.get("antes") != c.get("despues")]
        if not cambios:
            return
        try:
            async with self.db.begin_nested():
                await self._anotar(cambios, cuando, id_usuario, usuario)
        except Exception as e:
            logger.warning(f"Uso de máquinas: no se pudo registrar el cambio de "
                           f"{len(cambios)} paso(s): {e}")

    async def _anotar(self, cambios, cuando, id_usuario, usuario) -> None:
        # 1. CERRAR lo que estaba abierto en los pasos que dejaron de estar en proceso.
        a_cerrar = {int(c["id_otp"]): c for c in cambios if c["despues"] in (PENDIENTE, TERMINADO)}
        if a_cerrar:
            abiertos = (await self.db.execute(
                select(UsoMaquina).where(UsoMaquina.id_otp.in_(list(a_cerrar)), UsoMaquina.fin.is_(None))
            )).scalars().all()
            if abiertos:
                from backend.application.UsoMaquinaService import medir_al_cerrar
                await medir_al_cerrar(self.db, abiertos, cuando)
                for uso in abiertos:
                    uso.fin = max(cuando, uso.inicio)
                    uso.id_usuario_fin = id_usuario
                    uso.usuario_fin = usuario
                    if a_cerrar[uso.id_otp]["despues"] == PENDIENTE and not uso.no_suma:
                        uso.no_suma = NO_SUMA_VUELTA_A_PENDIENTE

        # 2. ABRIR un tramo en los que pasaron a estar en proceso (arrancaron o se reabrieron).
        a_abrir = [c for c in cambios if c["despues"] == EN_PROCESO and not c.get("no_lleva_maquina")]
        if not a_abrir:
            return
        ids = [int(c["id_otp"]) for c in a_abrir]
        ya_abiertos = set((await self.db.execute(
            select(UsoMaquina.id_otp).where(UsoMaquina.id_otp.in_(ids), UsoMaquina.fin.is_(None))
        )).scalars().all())
        a_abrir = [c for c in a_abrir if int(c["id_otp"]) not in ya_abiertos]
        if not a_abrir:
            return

        del_plan = await self.plan_de_los_pasos(a_abrir)
        filas = []
        for c in a_abrir:
            otp = int(c["id_otp"])
            plan = del_plan.get(otp) or {}
            if c.get("id_maquinaria"):
                id_maquina, origen = int(c["id_maquinaria"]), ORIGEN_OT
            elif plan.get("id_maquinaria"):
                id_maquina, origen = int(plan["id_maquinaria"]), ORIGEN_PLAN
            else:
                continue  # sin máquina elegida ni planificada: no hay uso que registrar
            if c.get("id_operario"):
                personas = [int(c["id_operario"])]
            else:
                personas = [p for p in plan.get("operarios", []) if p is not None]
            filas.append((c, id_maquina, origen, personas))
        if not filas:
            return

        # Por ORM y no con SQL crudo: así las fechas y los booleanos llegan como tales
        # también en SQLite (los tests).
        maquinas = {
            m.id: m for m in (await self.db.execute(
                select(Maquinaria.id, Maquinaria.nombre, Maquinaria.estado_operativo)
                .where(Maquinaria.id.in_(sorted({f[1] for f in filas})))
            )).all()
        }
        todas_las_personas = sorted({p for f in filas for p in f[3]})
        nombres = {}
        if todas_las_personas:
            nombres = {
                r.id: _nombre_persona(r.nombre, r.apellido) for r in (await self.db.execute(
                    select(Operario.id, Operario.nombre, Operario.apellido)
                    .where(Operario.id.in_(todas_las_personas))
                )).all()
            }
        ots = sorted({int(f[0]["id_orden_trabajo"]) for f in filas})
        numeros = {
            r.id: (r.id_otvieja or r.id) for r in (await self.db.execute(
                select(OrdenTrabajo.id, OrdenTrabajo.id_otvieja).where(OrdenTrabajo.id.in_(ots))
            )).all()
        }
        procesos_ids = sorted({int(f[0]["id_proceso"]) for f in filas if f[0].get("id_proceso")})
        procesos = {}
        if procesos_ids:
            procesos = {
                r.id: r.nombre for r in (await self.db.execute(
                    select(Proceso.id, Proceso.nombre).where(Proceso.id.in_(procesos_ids))
                )).all()
            }

        for c, id_maquina, origen, personas in filas:
            maquina = maquinas.get(id_maquina)
            if maquina is None:
                continue  # la máquina ya no existe: nada a qué colgarle el uso
            no_suma = None
            if (maquina.estado_operativo or "") == "fuera_de_servicio":
                no_suma = NO_SUMA_FUERA_DE_SERVICIO
                logger.warning(
                    "Uso de máquinas: el paso %s de la OT %s arrancó en «%s», que está FUERA "
                    "DE SERVICIO (%s). Queda registrado y no suma horas.",
                    c.get("orden"), numeros.get(int(c["id_orden_trabajo"])), maquina.nombre,
                    "la eligieron a mano en el paso" if origen == ORIGEN_OT else "se la asignó el plan",
                )
            quienes = [nombres[p] for p in personas if nombres.get(p)]
            self.db.add(UsoMaquina(
                id_maquinaria=id_maquina,
                origen_maquina=origen,
                id_orden_trabajo=int(c["id_orden_trabajo"]),
                numero_ot=numeros.get(int(c["id_orden_trabajo"])),
                id_otp=int(c["id_otp"]),
                paso=c.get("orden"),
                id_proceso=c.get("id_proceso"),
                nombre_proceso=(procesos.get(c.get("id_proceso")) or "")[:200] or None,
                id_operario=personas[0] if personas else None,
                operario=(", ".join(quienes)[:200] or None),
                inicio=cuando,
                no_suma=no_suma,
                id_usuario_inicio=id_usuario,
                usuario_inicio=usuario,
            ))
        await self.db.flush()

    async def plan_de_los_pasos(self, pasos: list[dict]) -> dict[int, dict]:
        """{paso: {id_maquinaria, operarios}} según el ÚLTIMO lote de plan que lo incluyó.

        Mismo criterio que los tiempos de RF-06 (TiemposOperarioService): el plan se
        acumula por lotes y manda el más nuevo. Las filas de plan de antes del 28/08 no
        dicen de qué paso son: si la OT tiene UNA sola pasada de ese proceso es ésa; si
        tiene varias no se adivina.
        """
        from backend.application.TiemposOperarioService import resolver_pasada

        ots = sorted({int(p["id_orden_trabajo"]) for p in pasos})
        if not ots:
            return {}
        filas = [dict(r._mapping) for r in (await self.db.execute(
            select(
                Planificacion.id, Planificacion.orden_id, Planificacion.proceso_id,
                Planificacion.id_orden_trabajo_proceso, Planificacion.id_operario,
                Planificacion.id_maquinaria, Planificacion.sin_maquinaria,
                Planificacion.id_planificacion_lote, Planificacion.creado_en,
            ).where(Planificacion.orden_id.in_(ots))
        )).all()]
        if not filas:
            return {}
        pasos_por_ot_proceso: dict = defaultdict(list)
        for r in (await self.db.execute(
            select(OrdenTrabajoProceso.id, OrdenTrabajoProceso.id_orden_trabajo,
                   OrdenTrabajoProceso.id_proceso)
            .where(OrdenTrabajoProceso.id_orden_trabajo.in_(ots))
        )).all():
            pasos_por_ot_proceso[(r[1], r[2])].append(r[0])

        por_paso: dict[int, list[dict]] = defaultdict(list)
        for f in filas:
            pasada = resolver_pasada(f, pasos_por_ot_proceso)
            if pasada is not None:
                por_paso[pasada].append(f)
        salida = {}
        for pasada, del_paso in por_paso.items():
            ultima = max(del_paso, key=lambda f: (f.get("creado_en") or datetime.min, f.get("id") or 0))
            lote = [f for f in del_paso if f.get("id_planificacion_lote") == ultima.get("id_planificacion_lote")]
            lote.sort(key=lambda f: f.get("id") or 0)
            maquina = next((f["id_maquinaria"] for f in lote
                            if f.get("id_maquinaria") and not f.get("sin_maquinaria")), None)
            operarios = []
            for f in lote:
                if f.get("id_operario") is not None and f["id_operario"] not in operarios:
                    operarios.append(f["id_operario"])
            salida[pasada] = {"id_maquinaria": maquina, "operarios": operarios}
        return salida

    # ------------------------------------------------------------------
    # Lecturas de la pantalla
    # ------------------------------------------------------------------

    async def usos(self, *, ids_maquina: list[int] | None, desde: datetime | None,
                   hasta: datetime | None) -> list[UsoMaquina]:
        """Los tramos que TOCAN [desde, hasta): arrancaron antes de que termine y no
        terminaron antes de que empiece (los abiertos siguen hasta ahora)."""
        q = select(UsoMaquina)
        if ids_maquina is not None:
            q = q.where(UsoMaquina.id_maquinaria.in_(list(ids_maquina)))
        if hasta is not None:
            q = q.where(UsoMaquina.inicio < hasta)
        if desde is not None:
            q = q.where((UsoMaquina.fin.is_(None)) | (UsoMaquina.fin > desde))
        q = q.order_by(UsoMaquina.inicio.desc(), UsoMaquina.id.desc())
        return list((await self.db.execute(q)).scalars().all())

    async def pasos_de(self, ids_otp: list[int]) -> dict[int, dict]:
        """El estado de hoy y lo estimado de esos pasos (para los tramos abiertos)."""
        if not ids_otp:
            return {}
        filas = (await self.db.execute(
            select(OrdenTrabajoProceso.id, OrdenTrabajoProceso.id_estado,
                   OrdenTrabajoProceso.tiempo_proceso)
            .where(OrdenTrabajoProceso.id.in_(list(ids_otp)))
        )).all()
        return {int(f[0]): {"id_estado": f[1], "tiempo_proceso": f[2]} for f in filas}

    async def contar_de_la_maquina_sin_romper(self, id_maquinaria: int) -> tuple[int, int] | None:
        """(tramos de uso, mantenimientos hechos) de una máquina, para el aviso de borrado.
        None si las tablas no están."""
        try:
            async with self.db.begin_nested():
                usos = (await self.db.execute(text(
                    "SELECT COUNT(*) FROM uso_maquina WHERE id_maquinaria = :m"), {"m": id_maquinaria})).scalar() or 0
                hechos = (await self.db.execute(text(
                    "SELECT COUNT(*) FROM maquina_mantenimiento_hecho WHERE id_maquinaria = :m"),
                    {"m": id_maquinaria})).scalar() or 0
                return int(usos), int(hechos)
        except Exception as e:
            logger.warning(f"Uso de máquinas: no se pudo contar el uso de la máquina {id_maquinaria}: {e}")
            return None
