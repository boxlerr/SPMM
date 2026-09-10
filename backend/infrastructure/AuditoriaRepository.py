from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import text

from backend.commons.loggers.logger import logger

_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")


def nombre_de(usuario: dict | None) -> str | None:
    """"Nombre Apellido", o el usuario, o nada.

    Sin usuario devuelve None y no "sistema": un borrado que no sabemos quién hizo
    tiene que verse distinto de uno hecho por un proceso automático. Inventarle un
    autor es peor que dejarlo vacío.
    """
    if not usuario:
        return None
    completo = " ".join(x for x in [usuario.get("nombre"), usuario.get("apellido")] if x)
    return (completo or usuario.get("username") or None)


def _ahora_ar() -> datetime:
    return datetime.now(_TZ_AR).replace(tzinfo=None)


class AuditoriaRepository:
    """Registro de cada intento de planificación.

    Hasta ahora, si un intento fallaba no quedaba NADA: el error vivía en los logs
    de Cloud Run y desde la app era imposible saber qué se intentó planificar, con
    qué OTs, si salió o no y por qué. El 15/08 Lucas tuvo un intento muerto por
    memoria y otro de 61 segundos, y la única forma de enterarse fue ir a mirar
    los logs de Google a mano.

    Acá queda todo: preview o confirmación, qué OTs (con su número visible), cuánto
    tardó, qué dio, y el error textual si explotó. La tabla se crea sola, igual que
    planificacion_borrada.
    """

    def __init__(self, db):
        self.db = db

    async def _ensure_tabla(self):
        try:
            await self.db.execute(text("""
                CREATE TABLE IF NOT EXISTS planificacion_intento (
                    id SERIAL PRIMARY KEY,
                    creado_en TIMESTAMP NOT NULL,
                    tipo VARCHAR(20) NOT NULL,
                    ordenes_pedidas INTEGER NOT NULL DEFAULT 0,
                    ordenes_ids TEXT,
                    ordenes_visibles TEXT,
                    resultado VARCHAR(20) NOT NULL,
                    procesos_planificados INTEGER,
                    procesos_excedentes INTEGER,
                    sin_asignar INTEGER,
                    sin_maquina INTEGER,
                    diagnosticos_bloqueantes INTEGER,
                    diagnosticos_avisos INTEGER,
                    duracion_ms INTEGER,
                    error TEXT,
                    id_planificacion_lote UUID
                )
            """))
            # Quién lo hizo. Va como ALTER y no dentro del CREATE porque la tabla ya
            # existe en producción desde agosto. Julián, 10/09: "todo tiene que estar
            # auditado bien completo" — un intento sin nombre no contesta la única
            # pregunta que se hace cuando algo aparece cambiado: quién lo tocó.
            await self.db.execute(text(
                "ALTER TABLE planificacion_intento "
                "ADD COLUMN IF NOT EXISTS id_usuario INTEGER, "
                "ADD COLUMN IF NOT EXISTS usuario VARCHAR(120)"))
            await self.db.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_planificacion_intento_fecha "
                "ON planificacion_intento (creado_en DESC)"))
            await self.db.commit()
        except Exception as e:
            await self.db.rollback()
            logger.warning(f"Repository - No se pudo asegurar planificacion_intento: {e}")

    async def registrar_intento(
        self,
        tipo: str,
        ordenes_ids: list[int] | None,
        resultado: str,
        duracion_ms: int,
        salida: dict | None = None,
        error: str | None = None,
        usuario: dict | None = None,
    ):
        """Guarda el intento. Nunca levanta: que la auditoría falle no puede
        convertir una planificación buena en un error, ni tapar el error real
        de una que ya venía fallada."""
        try:
            # Si venimos de una excepción, la sesión puede haber quedado con una
            # transacción rota; sin este rollback el propio registro del error
            # fallaría con InFailedSQLTransaction y no quedaría nada.
            try:
                await self.db.rollback()
            except Exception:
                pass

            await self._ensure_tabla()

            ordenes_ids = list(ordenes_ids or [])

            # Número VISIBLE de cada OT (id_otvieja): es el que el taller conoce.
            # Guardar solo el id interno haría ilegible la auditoría, igual que
            # pasaba con los toasts de "sin stock".
            visibles = []
            if ordenes_ids:
                filas = await self.db.execute(text(
                    "SELECT id, id_otvieja FROM orden_trabajo WHERE id = ANY(:ids)"
                ), {"ids": ordenes_ids})
                mapa = {f.id: f.id_otvieja for f in filas}
                visibles = [str(mapa.get(i) or i) for i in ordenes_ids]

            plan = (salida or {}).get("planificados")
            exced = (salida or {}).get("excedentes") or []
            diags = (salida or {}).get("diagnosticos") or []
            lote = None
            if isinstance(plan, dict):  # confirmación: viene el resumen del repo
                lote = plan.get("id_planificacion_lote")
                plan_n, sin_asig, sin_maq = None, None, None
            else:
                plan = plan or []
                plan_n = len(plan)
                sin_asig = sum(1 for r in plan if r.get("sin_asignar"))
                sin_maq = sum(1 for r in plan if r.get("sin_maquinaria") and not r.get("tercerizado"))

            await self.db.execute(text("""
                INSERT INTO planificacion_intento (
                    creado_en, tipo, ordenes_pedidas, ordenes_ids, ordenes_visibles,
                    resultado, procesos_planificados, procesos_excedentes,
                    sin_asignar, sin_maquina, diagnosticos_bloqueantes,
                    diagnosticos_avisos, duracion_ms, error, id_planificacion_lote,
                    id_usuario, usuario
                ) VALUES (
                    :creado, :tipo, :pedidas, :ids, :visibles,
                    :resultado, :plan_n, :exced_n,
                    :sin_asig, :sin_maq, :d_bloq,
                    :d_avisos, :dur, :error, :lote,
                    :id_usuario, :usuario
                )
            """), {
                "creado": _ahora_ar(),
                "tipo": tipo,
                "pedidas": len(ordenes_ids),
                "ids": ",".join(str(i) for i in ordenes_ids) or None,
                "visibles": ",".join(visibles) or None,
                "resultado": resultado,
                "plan_n": plan_n,
                "exced_n": len(exced),
                "sin_asig": sin_asig,
                "sin_maq": sin_maq,
                "d_bloq": sum(1 for d in diags if d.get("severidad") == "bloqueante"),
                "d_avisos": sum(1 for d in diags if d.get("severidad") != "bloqueante"),
                "dur": duracion_ms,
                "error": (error or None) and str(error)[:2000],
                "lote": lote,
                "id_usuario": (usuario or {}).get("id_usuario"),
                "usuario": nombre_de(usuario),
            })
            await self.db.commit()
        except Exception as e:
            try:
                await self.db.rollback()
            except Exception:
                pass
            logger.warning(f"Repository - No se pudo registrar el intento de planificación: {e}")

    async def listar_intentos(self, limite: int = 100):
        await self._ensure_tabla()
        filas = await self.db.execute(text("""
            SELECT id, creado_en, tipo, ordenes_pedidas, ordenes_visibles,
                   resultado, procesos_planificados, procesos_excedentes,
                   sin_asignar, sin_maquina, diagnosticos_bloqueantes,
                   diagnosticos_avisos, duracion_ms, error, id_planificacion_lote,
                   usuario
            FROM planificacion_intento
            ORDER BY creado_en DESC
            LIMIT :lim
        """), {"lim": limite})
        return [dict(f._mapping) for f in filas]

    async def listar_borrados(self, limite: int = 100):
        """El historial de borrados existía en la base pero no tenía cómo verse."""
        try:
            filas = await self.db.execute(text("""
                SELECT id, id_planificacion_lote, descripcion_lote, alcance,
                       filas_borradas, ots_borradas, orden_ids, creado_en_lote, borrado_en,
                       usuario
                FROM planificacion_borrada
                ORDER BY borrado_en DESC
                LIMIT :lim
            """), {"lim": limite})
            return [dict(f._mapping) for f in filas]
        except Exception:
            return []  # la tabla se crea recién en el primer borrado
