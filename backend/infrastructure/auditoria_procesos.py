"""Quién agregó, cambió o sacó cada paso de cada OT.

POR QUÉ NO ESTÁ ESCRITO EN CADA ENDPOINT

Pedido de Julián (17/09): «auditoría de quién agregue, elimine o modifique cada
proceso en cada OT, siempre, en cualquier pantalla, con su usuario, hora y día bien
completo, por si hay dudas de que se duplican cosas y si lo agregó un usuario».

Hay CATORCE caminos en el backend que escriben `orden_trabajo_proceso`: el alta de la
OT, el guardado completo, el alta suelta, la edición de una línea, el borrado de una
pasada, el reordenar, el estado, las observaciones, el estado masivo, el deshacer,
borrar la OT entera, borrar un proceso del catálogo, borrar una persona y borrar una
máquina. Poner la llamada en cada uno es garantizar que el decimoquinto no la tenga —
que es exactamente cómo la auditoría de planificación quedó sola durante un año.

Así que esto no se engancha a los endpoints: se engancha al ORM. Toda escritura que
pase por SQLAlchemy dispara `after_flush`, y ahí se compara lo que había contra lo que
quedó. Una pantalla nueva, un endpoint nuevo o un servicio nuevo quedan auditados sin
escribir una línea.

LO QUE EL ORM NO VE

Seis caminos escribían con SQL crudo (`DELETE FROM …`, `UPDATE … SET id_operario =
NULL`), que no pasa por el ORM y por lo tanto no dispara nada. Cuatro se pasaron al
ORM —era una línea y además son más claros así—; los dos masivos de verdad (el estado
de varias OT, y el blanqueo al borrar una persona o una máquina) se quedaron en SQL
porque cargar miles de objetos para tocarles un campo sería cambiarles el costo, y
esos llaman a `anotar()` a mano, leyendo antes lo que van a pisar.

Lo que sigue sin verse son los scripts de `backend/scripts/`: van directo a la base
con asyncpg, sin ORM y sin HTTP. Es a propósito —una migración no tiene usuario— y se
nota al leer: esas filas no existen, y la pantalla dice desde cuándo hay registro.

POR QUÉ EN LA MISMA TRANSACCIÓN

`auditoria_movimiento` (el middleware) guarda el INTENTO, y lo hace en una sesión
aparte para que también queden los que fallaron. Acá es al revés: se guarda lo que
QUEDÓ. Si el guardado se va al rollback, el registro se va con él — un renglón que
diga que alguien agregó un paso que no existe es peor que no tener el renglón.

Pero eso no puede voltear un guardado: el INSERT va adentro de un SAVEPOINT propio, así
que si la auditoría falla se pierde el renglón y la OT se guarda igual. La regla de
siempre: la auditoría no rompe la operación.
"""
import json
from contextvars import ContextVar
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import event, insert, inspect as sa_inspect, select, text
from sqlalchemy.orm import Session

from backend.commons.loggers.logger import logger
from backend.domain.AuditoriaProcesoOT import AuditoriaProcesoOT
from backend.domain.EstadoProceso import EstadoProceso
from backend.domain.Maquinaria import Maquinaria
from backend.domain.Operario import Operario
from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso
from backend.domain.PausaOrden import (
    PausaOrden,
    duracion_corta,
    minutos_entre,
    texto_del_motivo,
)
from backend.domain.Proceso import Proceso

_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")


def ahora_ar() -> datetime:
    """Hora del taller, naive: las columnas son timestamp sin zona."""
    return datetime.now(_TZ_AR).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Quién está haciendo el cambio.
#
# El actor no llega hasta acá por parámetro: la mitad de los caminos no lo reciben
# (borrar una OT, borrar un proceso del catálogo) aunque el endpoint sí pida token.
# Un ContextVar lo deja disponible en cualquier punto de la llamada sin tocar catorce
# firmas, y se propaga solo a las tareas hijas de la request.
#
# Vacío = no se registró. Nunca un autor inventado: sin contexto la fila queda sin
# usuario y la pantalla la muestra como «el sistema», que es la respuesta correcta a
# «¿esto lo tocó alguien?» cuando lo hizo un script.
# ---------------------------------------------------------------------------
_CONTEXTO: ContextVar[dict | None] = ContextVar("auditoria_procesos_contexto", default=None)


def poner_contexto(*, usuario: dict | None, metodo: str = "", ruta: str = "",
                   parametros: dict | None = None):
    """Deja anotado quién está pidiendo. Devuelve el token para restaurarlo."""
    return _CONTEXTO.set({
        "usuario": usuario,
        "metodo": metodo,
        "ruta": ruta,
        "origen": origen_de(ruta, parametros),
    })


def limpiar_contexto(token) -> None:
    try:
        _CONTEXTO.reset(token)
    except Exception:
        # Un reset desde otra tarea que la que seteó: no importa, el contexto muere
        # con la request igual.
        pass


def origen_de(ruta: str, parametros: dict | None = None) -> str:
    """Por dónde entró el cambio, dicho como lo diría alguien del taller.

    Importa más de lo que parece: un paso que desaparece porque alguien lo sacó de la
    orden y uno que desaparece porque borraron ese proceso del catálogo se ven igual en
    la OT, y son dos problemas distintos.

    OJO: esto nombra LA ACCIÓN, no la pantalla, y es a propósito. El backend no sabe
    desde qué pantalla le pegaron: varias mandan exactamente la misma llamada —marcar
    un paso como terminado sale igual desde Operaciones que desde la ficha de la
    persona en Recursos— así que decir «Ficha de la orden» sería inventar un dato que
    después alguien va a usar para buscar en el lugar equivocado. Sólo se nombra la
    pantalla cuando la llamada la identifica sin ambigüedad: el planificador manda su
    motivo, y el catálogo y los recursos tienen dirección propia.
    """
    motivo = (parametros or {}).get("motivo") or ""
    if motivo == "planificacion":
        return "Planificador"
    if motivo == "restaurar" or "/restaurar/" in ruta:
        return "Deshacer"
    if "/estado-masivo" in ruta:
        return "Varias OT a la vez"
    if ruta.startswith("/procesos"):
        return "Al tocar el catálogo de procesos"
    if ruta.startswith("/operarios"):
        return "Al tocar una persona"
    if ruta.startswith("/maquinarias"):
        return "Al tocar una máquina"
    if ruta.startswith("/ordenes"):
        # RF-03. Van antes que el resto: «/ordenes/1081/pausar» caería en «Guardado de
        # la orden», que es justo lo que no pasó.
        if ruta.rstrip("/").endswith("/pausar"):
            return "Pausar"
        if ruta.rstrip("/").endswith("/reanudar"):
            return "Reanudar"
        if "/reorder" in ruta:
            return "Reordenar los pasos"
        if "/estado" in ruta or "/status" in ruta:
            return "Cambio de estado"
        if "/observaciones" in ruta:
            return "Observaciones del paso"
        if "/linea/" in ruta:
            return "Edición de un paso"
        if ruta.rstrip("/").endswith("/procesos"):
            return "Alta de un paso"
        return "Guardado de la orden"
    return ruta[:60] or "Sistema"


# ---------------------------------------------------------------------------
# Qué se mira de cada pasada.
#
# El orden importa: es el que se usa para armar la frase, así que lo que más se
# pregunta va primero.
# ---------------------------------------------------------------------------
CAMPOS = {
    "id_proceso": "proceso",
    "orden": "paso",
    "tiempo_proceso": "minutos",
    "cant_operarios": "cantidad de personas",
    "no_lleva_maquina": "va a mano",
    "id_maquinaria": "máquina elegida",
    "id_operario": "persona elegida",
    "id_estado": "estado",
    "observaciones": "observaciones",
    "inicio_real": "arranque real",
    "fin_real": "fin real",
}

# De qué catálogo sale el nombre de cada id, para que el registro diga «TORNO T1» y no
# «id_maquinaria: 4 → 7», que no le contesta nada a nadie.
CATALOGOS = {
    "id_proceso": Proceso,
    "id_maquinaria": Maquinaria,
    "id_operario": Operario,
    "id_estado": EstadoProceso,
}


def _nombre_de_fila(modelo, fila) -> str:
    if modelo is Operario:
        return " ".join(p for p in (fila.nombre, fila.apellido) if p).strip()
    if modelo is EstadoProceso:
        return fila.descripcion or ""
    return fila.nombre or ""


def _legible(campo: str, valor, nombres: dict) -> str | None:
    """El valor como se lee en la pantalla."""
    if valor is None or valor == "":
        return None
    if campo == "no_lleva_maquina":
        return "sí" if valor else "no"
    if campo in CATALOGOS:
        return nombres.get((campo, valor)) or f"#{valor}"
    if isinstance(valor, datetime):
        return valor.strftime("%d/%m/%Y %H:%M")
    return str(valor)


def _frase(accion: str, paso, nombre_proceso: str | None, cambios: list[dict]) -> str:
    """La frase que se lee en la pantalla. El quién lo pone el que la muestra."""
    cual = f"el paso {paso}" if paso else "un paso"
    que = f" — {nombre_proceso}" if nombre_proceso else ""
    if accion == "alta":
        return f"agregó {cual}{que}"
    if accion == "baja":
        return f"sacó {cual}{que}"
    detalle = "; ".join(
        f"{c['campo']}: {c['antes'] or '—'} → {c['despues'] or '—'}" for c in cambios
    )
    return f"cambió {cual}{que}: {detalle}"


# ---------------------------------------------------------------------------
# El enganche al ORM.
# ---------------------------------------------------------------------------

def _pasadas_del_flush(session) -> tuple[list, list, list]:
    """Las pasadas que se están por guardar, por tipo de cambio.

    Las altas se filtran por «ya tiene id»: `session.new` es lo pendiente de la SESIÓN,
    no lo que ESTE flush escribió. Con un flush parcial —`session.flush([una_fila])`,
    que hoy no usa nadie pero es SQLAlchemy legítimo— las otras filas pendientes
    entrarían acá sin id (`id_otp` en NULL, justo la columna con la que se sigue el
    rastro) y volverían a entrar en el flush siguiente: dos renglones de alta para una
    sola pasada. En una tabla que existe para contestar «¿este proceso duplicado lo
    agregó alguien?», un alta duplicada es el peor falso positivo posible.
    """
    es = lambda o: isinstance(o, OrdenTrabajoProceso)
    return (
        [o for o in session.new if es(o) and o.id is not None],
        [o for o in session.dirty if es(o)],
        [o for o in session.deleted if es(o)],
    )


def _cambios_de(obj) -> list[tuple[str, object, object]]:
    """(campo, antes, después) de lo que realmente cambió.

    Se compara antes contra después a propósito: el guardado completo le reasigna el
    paso a TODAS las filas (`orden = index + 1`), así que SQLAlchemy las marca como
    tocadas aunque el número sea el mismo. Sin esta comparación, guardar una OT sin
    cambiarle nada dejaría una fila por proceso diciendo «paso 3 → 3».
    """
    estado = sa_inspect(obj)
    salida = []
    for campo in CAMPOS:
        historial = estado.attrs[campo].history
        if not historial.has_changes():
            continue
        antes = historial.deleted[0] if historial.deleted else None
        despues = historial.added[0] if historial.added else None
        if antes == despues:
            continue
        salida.append((campo, antes, despues))
    return salida


def _resolver_nombres(session, pedidos: set[tuple[str, int]]) -> dict:
    """Los nombres de los ids que aparecen en el registro, en una consulta por catálogo.

    Se guarda el nombre y no sólo el id porque el catálogo se puede borrar: cuando
    alguien saca un proceso con `?forzar=true` se lo lleva de todas las OT donde
    estaba, y ese es justo el caso donde después se pregunta qué era.

    Si una consulta falla NO se atrapa acá: se deja subir para que el savepoint del
    llamador deshaga todo el trabajo de la auditoría de una. Atraparlo y seguir sería
    peor que inútil — en Postgres el primer error deja la transacción abortada, así
    que las consultas siguientes fallan igual y el COMMIT del usuario se convierte en
    un ROLLBACK silencioso: la pantalla diría que guardó y no guardó nada.
    """
    nombres = {}
    por_catalogo = {}
    for campo, valor in pedidos:
        if campo in CATALOGOS and isinstance(valor, int):
            por_catalogo.setdefault(campo, set()).add(valor)

    for campo, ids in por_catalogo.items():
        modelo = CATALOGOS[campo]
        # no_autoflush: estamos adentro de un flush; disparar otro acá sería reentrar
        # en este mismo listener.
        with session.no_autoflush:
            filas = session.execute(
                select(modelo).where(modelo.id.in_(list(ids)))
            ).scalars().all()
        for fila in filas:
            nombres[(campo, fila.id)] = _nombre_de_fila(modelo, fila)
    return nombres


def _pausas_del_flush(session) -> tuple[list, list]:
    """Las pausas (RF-03) que este flush abrió y las que cerró.

    Una pausa no es un cambio de un paso, pero es lo primero que se pregunta al mirar
    el historial de una OT que se atrasó: «¿quién la paró, cuándo y por qué?». Va en la
    misma tabla, con acción `pausa` / `reanuda`, así se lee en orden junto con el resto
    y no hay que cruzar dos pantallas. Y va por el mismo enganche al ORM: la pausa se
    abre desde un botón, pero se cierra también sola al terminar el paso, y el que sólo
    mirara el botón se perdería ésas.

    Mismo filtro de «ya tiene id» que las altas de pasos (ver `_pasadas_del_flush`).
    """
    abiertas = [o for o in session.new if isinstance(o, PausaOrden) and o.id is not None]
    cerradas = []
    for o in session.dirty:
        if not isinstance(o, PausaOrden):
            continue
        historial = sa_inspect(o).attrs["hasta"].history
        antes = historial.deleted[0] if historial.deleted else None
        despues = historial.added[0] if historial.added else None
        if historial.has_changes() and antes is None and despues is not None:
            cerradas.append(o)
    return abiertas, cerradas


def _frase_de_pausa(pausa, accion: str) -> str:
    """«pausó la OT: Falta material», «reanudó el paso 3 — TORNO CNC (estuvo parado 2 h)».
    El quién lo pone el que la muestra, como en las demás frases de esta tabla."""
    if pausa.id_otp is None:
        que, parada = "la OT", "parada"
    else:
        que = f"el paso {pausa.paso}" if pausa.paso else "un paso"
        if pausa.nombre_proceso:
            que += f" — {pausa.nombre_proceso}"
        parada = "parado"
    if accion == "pausa":
        return f"pausó {que}: {texto_del_motivo(pausa)}"
    cuanto = duracion_corta(minutos_entre(pausa.desde, pausa.hasta))
    if pausa.cierre == "PASO_TERMINADO":
        return f"terminó {que}, que estaba pausado: se cerró la pausa ({cuanto})"
    if pausa.cierre == "PASO_EN_PROCESO":
        return f"puso en proceso {que}, que estaba pausado: se cerró la pausa ({cuanto})"
    if pausa.cierre == "OT_TERMINADA":
        return f"terminó todos los pasos de la OT, que estaba pausada: se cerró la pausa ({cuanto})"
    return f"reanudó {que} (estuvo {parada} {cuanto})"


def _filas_de_pausas(abiertas, cerradas, comun: dict) -> list[dict]:
    filas = []
    for accion, pausas in (("pausa", abiertas), ("reanuda", cerradas)):
        for p in pausas:
            filas.append({
                **comun,
                "id_orden_trabajo": p.id_orden_trabajo,
                "id_otp": p.id_otp,
                "id_proceso": None,
                "nombre_proceso": p.nombre_proceso,
                "accion": accion,
                "paso": p.paso,
                "cambios": None,
                "descripcion": _frase_de_pausa(p, accion),
            })
    return filas


def _contexto_comun() -> dict:
    ctx = _CONTEXTO.get() or {}
    usuario = ctx.get("usuario") or {}
    return {
        "creado_en": ahora_ar(),
        "id_usuario": usuario.get("id_usuario"),
        "usuario": _nombre_usuario(usuario),
        "origen": ctx.get("origen") or "Sistema",
        "metodo": (ctx.get("metodo") or "")[:10] or None,
        "ruta": (ctx.get("ruta") or "")[:300] or None,
    }


def _armar_filas(session) -> list[dict]:
    pausas_abiertas, pausas_cerradas = _pausas_del_flush(session)
    filas_pausas = (_filas_de_pausas(pausas_abiertas, pausas_cerradas, _contexto_comun())
                    if (pausas_abiertas or pausas_cerradas) else [])

    altas, editadas, bajas = _pasadas_del_flush(session)
    if not (altas or editadas or bajas):
        return filas_pausas

    cambios_por_obj = {}
    for obj in editadas:
        cambios = _cambios_de(obj)
        if cambios:
            cambios_por_obj[obj] = cambios
    if not (altas or bajas or cambios_por_obj):
        return filas_pausas

    # Todos los ids que van a aparecer, para pedir los nombres de una.
    pedidos = set()
    for obj in altas + bajas:
        for campo in CATALOGOS:
            valor = getattr(obj, campo, None)
            if valor is not None:
                pedidos.add((campo, valor))
    for obj, cambios in cambios_por_obj.items():
        pedidos.add(("id_proceso", obj.id_proceso))
        for campo, antes, despues in cambios:
            if campo in CATALOGOS:
                for v in (antes, despues):
                    if v is not None:
                        pedidos.add((campo, v))
    nombres = _resolver_nombres(session, pedidos)

    comun = _contexto_comun()

    filas = list(filas_pausas)

    def _fila(obj, accion, cambios=None):
        nombre_proceso = nombres.get(("id_proceso", obj.id_proceso))
        detalle = [
            {
                "campo": CAMPOS[c],
                "antes": _legible(c, a, nombres),
                "despues": _legible(c, d, nombres),
            }
            for c, a, d in (cambios or [])
        ]
        return {
            **comun,
            "id_orden_trabajo": obj.id_orden_trabajo,
            "id_otp": obj.id,
            "id_proceso": obj.id_proceso,
            "nombre_proceso": (nombre_proceso or None) and nombre_proceso[:200],
            "accion": accion,
            "paso": obj.orden,
            "cambios": json.dumps(detalle, ensure_ascii=False) if detalle else None,
            "descripcion": _frase(accion, obj.orden, nombre_proceso, detalle),
        }

    for obj in altas:
        filas.append(_fila(obj, "alta"))
    for obj, cambios in cambios_por_obj.items():
        filas.append(_fila(obj, "edicion", cambios))
    for obj in bajas:
        filas.append(_fila(obj, "baja"))
    return filas


def _nombre_usuario(usuario: dict | None) -> str | None:
    if not usuario:
        return None
    partes = [usuario.get("nombre") or "", usuario.get("apellido") or ""]
    nombre = " ".join(p for p in partes if p).strip() or usuario.get("username")
    return str(nombre)[:120] if nombre else None


def _despues_del_flush(session, contexto_flush) -> None:
    """Se escribe en `after_flush` y no en `before_flush` por una sola razón: acá los
    ids de las filas nuevas YA están asignados, y `id_otp` es lo que después permite
    seguir el rastro de una pasada. En `before_flush` un alta se registraría sin id,
    que es justo el caso que motivó todo esto.

    Las colecciones (`new`/`dirty`/`deleted`) y el historial de cada atributo siguen
    disponibles en este punto: se limpian recién en `after_flush_postexec`.

    TODO el trabajo —las consultas a los catálogos y el INSERT— va adentro de UN
    savepoint, no sólo el INSERT. Es la única forma de cumplir la regla del módulo:
    en Postgres, el primer statement que falla deja la transacción abortada, así que
    atrapar el error y seguir no salva nada —lo que viene después falla igual— y el
    COMMIT del usuario se convierte en un ROLLBACK que no avisa: la pantalla diría
    que guardó la OT y la OT no se guardó. Con el savepoint, si la auditoría falla se
    pierde el renglón y el cambio del usuario queda intacto, que es el trato.
    """
    try:
        conexion = session.connection()
        with conexion.begin_nested():
            filas = _armar_filas(session)
            if filas:
                conexion.execute(insert(AuditoriaProcesoOT), filas)
    except Exception as e:
        logger.warning("Auditoría de procesos: no se pudo registrar el cambio: %s", e)


_ENGANCHADO = False


def activar() -> None:
    """Engancha el listener. Idempotente: se llama al importar este módulo."""
    global _ENGANCHADO
    if _ENGANCHADO:
        return
    event.listen(Session, "after_flush", _despues_del_flush)
    _ENGANCHADO = True


# Se activa al importar a propósito: quien importa este módulo (el repositorio de OT,
# main.py) ya está en un contexto donde tocar procesos tiene que quedar registrado.
activar()


# ---------------------------------------------------------------------------
# Para lo que no pasa por el ORM.
# ---------------------------------------------------------------------------

COLUMNAS_PASADA = ("id, id_orden_trabajo, id_proceso, orden, tiempo_proceso, id_estado, "
                   "id_maquinaria, id_operario, no_lleva_maquina, inicio_real, fin_real")


async def leer_pasadas(db, condicion: str, params: dict) -> list[dict]:
    """Las pasadas que un UPDATE o un DELETE masivo está por tocar.

    Se lee ANTES de pisarlas: después ya no hay a quién preguntarle qué decían.

    `condicion` es SQL escrito acá al lado del que ejecuta el cambio —la misma
    condición, para que no se separen— y NUNCA texto que venga de afuera: los valores
    van por `params`.

    Va en un SAVEPOINT por lo mismo que el listener: esto corre sobre la sesión del
    endpoint, justo antes de un borrado del usuario. Si la consulta falla sin
    savepoint, en Postgres la transacción queda abortada y el DELETE que viene después
    revienta — o sea que la auditoría le impediría al usuario borrar. Con el savepoint
    se pierde el renglón y la operación sigue.
    """
    try:
        async with db.begin_nested():
            filas = await db.execute(
                text(f"SELECT {COLUMNAS_PASADA} FROM orden_trabajo_proceso WHERE {condicion}"),
                params,
            )
            return [dict(f._mapping) for f in filas]
    except Exception as e:
        logger.warning("Auditoría de procesos: no se pudieron leer las pasadas: %s", e)
        return []


async def anotar(db, filas: list[dict], accion: str, *, nuevos=None,
                 origen: str | None = None) -> None:
    """Registra a mano lo que el ORM no ve (los UPDATE masivos que quedaron en SQL).

    `filas` son las que devolvió `leer_pasadas` ANTES del cambio. `nuevos` dice con qué
    se las pisó: un dict {campo: valor} cuando es igual para todas, o una función
    fila -> {campo: valor} cuando depende de cada una (el estado masivo le blanquea las
    marcas de trabajo real según el estado que se pida).

    Va en un SAVEPOINT y no levanta nunca: esto corre pegado a un borrado del usuario y
    no puede impedirlo. Ver el mismo razonamiento en `leer_pasadas`.
    """
    if not filas:
        return
    try:
        ctx = _CONTEXTO.get() or {}
        usuario = ctx.get("usuario") or {}
        cuando = ahora_ar()
        de_la_fila = nuevos if callable(nuevos) else (lambda _f: nuevos or {})

        pedidos = {("id_proceso", f["id_proceso"]) for f in filas if f.get("id_proceso")}
        for f in filas:
            for campo, valor in de_la_fila(f).items():
                if campo in CATALOGOS:
                    for v in (f.get(campo), valor):
                        if v is not None:
                            pedidos.add((campo, v))
        nombres = await _resolver_nombres_async(db, pedidos)

        a_insertar = []
        for f in filas:
            cambios = []
            for campo, valor in de_la_fila(f).items():
                antes = _legible(campo, f.get(campo), nombres)
                despues = _legible(campo, valor, nombres)
                if antes == despues:
                    continue
                cambios.append({"campo": CAMPOS.get(campo, campo),
                                "antes": antes, "despues": despues})
            # Una edición que no cambió nada no deja renglón; una baja sí, siempre.
            if accion == "edicion" and not cambios:
                continue
            nombre_proceso = nombres.get(("id_proceso", f.get("id_proceso")))
            a_insertar.append({
                "creado_en": cuando,
                "id_usuario": usuario.get("id_usuario"),
                "usuario": _nombre_usuario(usuario),
                "origen": (origen or ctx.get("origen") or "Sistema")[:60],
                "metodo": (ctx.get("metodo") or "")[:10] or None,
                "ruta": (ctx.get("ruta") or "")[:300] or None,
                "id_orden_trabajo": f["id_orden_trabajo"],
                "id_otp": f["id"],
                "id_proceso": f.get("id_proceso"),
                "nombre_proceso": (nombre_proceso or None) and nombre_proceso[:200],
                "accion": accion,
                "paso": f.get("orden"),
                "cambios": json.dumps(cambios, ensure_ascii=False, default=str) if cambios else None,
                "descripcion": _frase(accion, f.get("orden"), nombre_proceso, cambios),
            })

        if a_insertar:
            async with db.begin_nested():
                await db.execute(insert(AuditoriaProcesoOT), a_insertar)
    except Exception as e:
        logger.warning("Auditoría de procesos: no se pudo anotar %s: %s", accion, e)


async def _resolver_nombres_async(db, pedidos: set[tuple[str, int]]) -> dict:
    """Igual que `_resolver_nombres`, del lado async. Sin try/except por fuera del
    savepoint del llamador: ver el porqué en ese docstring."""
    nombres = {}
    por_catalogo = {}
    for campo, valor in pedidos:
        if campo in CATALOGOS and isinstance(valor, int):
            por_catalogo.setdefault(campo, set()).add(valor)
    for campo, ids in por_catalogo.items():
        modelo = CATALOGOS[campo]
        async with db.begin_nested():
            filas = (await db.execute(
                select(modelo).where(modelo.id.in_(list(ids)))
            )).scalars().all()
        for fila in filas:
            nombres[(campo, fila.id)] = _nombre_de_fila(modelo, fila)
    return nombres
