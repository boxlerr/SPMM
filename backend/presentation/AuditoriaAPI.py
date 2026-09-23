"""Lo que muestra la pantalla de Auditoría.

El historial de planificación vive en PlanificacionAPI (`/auditoria/planificacion`)
porque lo escribe el propio endpoint de planificar. Esto es lo otro: TODO lo demás
que alguien creó, editó o eliminó, que lo escribe el middleware de main.py.

RF-25 (23/09): la búsqueda se hace ACÁ, no en el navegador. Hasta ese día la pantalla
traía los últimos 300 movimientos y filtraba sobre ellos: lo que alguien hizo hace un
mes no aparecía aunque estuviera guardado, y no había filtro de fechas. Ahora cada
filtro (persona, acción, qué, texto, fechas) viaja al servidor, la respuesta dice
cuántos hay en total y se pide de a páginas: se llega a cualquier movimiento guardado.
"""
import json
from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import defer

from backend.core.security import get_current_user, get_permisos_actuales
from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento
from backend.domain.AuditoriaProcesoOT import AuditoriaProcesoOT
from backend.infrastructure.auditoria_movimientos import (
    ACCION_FALLIDO,
    ACCION_INGRESO,
    ACCIONES_DE_ACCESO,
    ACCIONES_DE_SESION,
    ENTIDAD_CLAVE,
    ENTIDAD_SESION,
    ENTIDADES_DE_ACCESO,
    ahora_ar,
)
from backend.infrastructure.db import SessionLocal

router = APIRouter()


async def get_db():
    async with SessionLocal() as session:
        yield session


# Lo máximo que se trae de una vez. Es el tope del Exportar: la pantalla pide de a 100,
# pero «Exportar» baja TODO lo filtrado, y sin tope un «desde siempre» de un año
# armaría un archivo de cientos de miles de renglones en el navegador. Con más que esto
# el Exportar avisa y pide acotar las fechas. El mismo número está en
# frontend/src/lib/auditoria.ts (TOPE_EXPORTAR).
TOPE_EXPORTAR = 10_000

M = AuditoriaMovimiento


# ─────────────────────────── lo que cada uno puede ver del registro ───────────────────────────
#
# Revisión del 23/09 (ver core/permisos_rutas.py, «Auditoría»):
#   · Ingresos y Actividad por persona son de la sección CONFIDENCIAL «Ingresos y
#     actividad por persona» (auditoria_ingresos). Sin ella, ninguna lista de este
#     archivo manda las filas de entrar, salir y claves (entidad «sesión» o «contraseña»:
#     IP, navegador, intentos contra cada cuenta). El bloqueo y el desbloqueo de una
#     cuenta (entidad «usuario», RF-26) ya estaban en «Todo lo que se hizo» y siguen ahí.
#   · La lista de CUENTAS (usuario, si tiene acceso, último login, y las cuentas que
#     nunca hicieron nada) es de «Usuarios y permisos» (configuracion_usuarios),
#     confidencial y del admin. Sin esa sección, cada persona va con el nombre con que
#     firmó en el registro y nada más: son los nombres que alguien necesita para probar
#     claves, y la pantalla que los cuida es ésa.

ENTIDADES_DE_INGRESO = (ENTIDAD_SESION, ENTIDAD_CLAVE)


def _puede(permisos, seccion: str) -> bool:
    try:
        return bool(permisos and permisos.tiene_seccion(seccion, "read"))
    except Exception:
        return False


def _prohibido(seccion: str) -> HTTPException:
    from backend.core.permisos_rutas import rechazo, seccion as requisito
    return HTTPException(status_code=403,
                         detail={"message": rechazo((requisito(seccion),)), "campo": "permiso"})


def _sin_ingresos():
    """Lo que no es entrar, salir ni una clave (para quien no tiene auditoria_ingresos)."""
    return M.entidad.notin_(ENTIDADES_DE_INGRESO)


def _fila(m: AuditoriaMovimiento, con_detalle: bool = True) -> dict:
    return {
        "id": m.id,
        "cuando": m.creado_en.isoformat() if m.creado_en else None,
        "usuario": m.usuario,
        "id_usuario": m.id_usuario,
        "accion": m.accion,
        "entidad": m.entidad,
        "id_entidad": m.id_entidad,
        "descripcion": m.descripcion,
        "metodo": m.metodo,
        "ruta": m.ruta,
        "estado": m.estado,
        "salio_bien": (m.estado or 0) < 400,
        "duracion_ms": m.duracion_ms,
        # Sin detalle en el Exportar: no va al archivo y es lo más pesado de la fila.
        "detalle": m.detalle if con_detalle else None,
    }


def _escapar_like(texto: str) -> str:
    """Que «%» y «_» se busquen como letras y no como comodines."""
    return texto.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _rango_de_fechas(desde: date | None, hasta: date | None) -> list:
    """Días del taller, las dos puntas incluidas. `creado_en` está en hora local sin
    zona, así que un día es [00:00, 00:00 del siguiente)."""
    if desde and hasta and desde > hasta:
        raise HTTPException(status_code=400,
                            detail="La fecha «desde» es posterior a la fecha «hasta».")
    condiciones = []
    if desde:
        condiciones.append(M.creado_en >= datetime.combine(desde, datetime.min.time()))
    if hasta:
        condiciones.append(
            M.creado_en < datetime.combine(hasta + timedelta(days=1), datetime.min.time()))
    return condiciones


def _de_la_persona(id_usuario: int):
    """Lo que hizo esa persona Y lo que le pasó a su cuenta en el ingreso.

    Un intento fallido, un bloqueo o un «restableció clave» no tienen autor (no se sabe
    quién tipeó: ver auditoria_movimientos, «INGRESOS Y SALIDAS»): la cuenta va en
    `id_entidad`. Sin la segunda mitad, filtrar por Lucas no mostraría los intentos
    fallidos contra su cuenta — que es justo lo que se busca cuando dice «no puedo
    entrar»."""
    return or_(
        M.id_usuario == id_usuario,
        and_(M.accion.in_(ACCIONES_DE_ACCESO), M.entidad.in_(ENTIDADES_DE_ACCESO),
             M.id_entidad == str(id_usuario)),
    )


def _condiciones(*, entidad, accion, usuario, id_usuario, buscar, solo_fallidos, tipo,
                 desde, hasta) -> list:
    condiciones = _rango_de_fechas(desde, hasta)
    if entidad:
        condiciones.append(M.entidad.like(f"{_escapar_like(entidad)}%", escape="\\"))
    if accion:
        # Varias separadas por coma: la vista Ingresos pide «bloqueó,desbloqueó» juntas.
        acciones = [a.strip() for a in accion.split(",") if a.strip()]
        if len(acciones) == 1:
            condiciones.append(M.accion == acciones[0])
        elif acciones:
            condiciones.append(M.accion.in_(acciones))
    if usuario:
        condiciones.append(M.usuario == usuario)
    if id_usuario is not None:
        condiciones.append(_de_la_persona(id_usuario))
    if solo_fallidos:
        condiciones.append(M.estado >= 400)
    if tipo == "ingresos":
        condiciones.append(M.accion.in_(ACCIONES_DE_ACCESO))
    if buscar and buscar.strip():
        # Por la frase y por quién: quien escribe «Leonardo» busca a una persona, y un
        # intento fallido no tiene autor pero lo nombra en la frase.
        termino = buscar.strip()
        patron = f"%{_escapar_like(termino)}%"
        opciones = [M.descripcion.ilike(patron, escape="\\"),
                    M.usuario.ilike(patron, escape="\\")]
        if termino.isdigit():
            opciones.append(M.id_entidad == termino)
        condiciones.append(or_(*opciones))
    return condiciones


async def _personas(db, *, ve_cuentas: bool, ve_ingresos: bool) -> list[dict]:
    """Para el desplegable «Persona»: cada autor del registro y, con «Usuarios y
    permisos», también cada cuenta (las que sólo tienen intentos fallidos, o ninguno),
    con el nombre de hoy, su usuario y si tiene acceso.

    Sin «Usuarios y permisos» no se lee `usuario`: sólo los que firmaron algo, con el
    nombre con que firmaron (y sin «Ingresos», sólo los que hicieron algo más que entrar).

    Las cuentas salen de la tabla `usuario`, y se leen AL FINAL: si no se pudiera (una
    base de prueba sin la tabla), el rollback no se lleva nada y quedan las del registro.
    """
    ultimo = (
        select(M.id_usuario, func.max(M.id).label("ultimo"))
        .where(M.id_usuario.isnot(None), M.usuario.isnot(None),
               *([] if ve_ingresos else [_sin_ingresos()]))
        .group_by(M.id_usuario)
        .subquery()
    )
    firmas = (await db.execute(
        select(M.id_usuario, M.usuario).join(ultimo, M.id == ultimo.c.ultimo)
    )).all()
    personas = {i: {"id_usuario": i, "nombre": n, "username": None, "activo": None}
                for i, n in firmas}
    if not ve_cuentas:
        return sorted(personas.values(), key=lambda p: (p["nombre"] or "").lower())
    for c in await _cuentas(db):
        personas[c["id_usuario"]] = {k: c[k] for k in ("id_usuario", "nombre", "username", "activo")}
    return sorted(personas.values(), key=lambda p: (p["nombre"] or "").lower())


async def _cuentas(db) -> list[dict]:
    """Las cuentas de la tabla `usuario`, o [] si no se pueden leer. Columnas nombradas
    una por una: las diferidas de RF-24/26 pueden no existir todavía en la base."""
    from backend.domain.Usuario import Usuario

    try:
        filas = (await db.execute(select(
            Usuario.id_usuario, Usuario.username, Usuario.nombre, Usuario.apellido,
            Usuario.activo, Usuario.ultimo_login,
        ))).all()
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass
        return []
    return [{
        "id_usuario": f.id_usuario,
        "username": f.username,
        "nombre": " ".join(x for x in (f.nombre, f.apellido) if x).strip() or f.username,
        "activo": bool(f.activo),
        "ultimo_login": f.ultimo_login,
    } for f in filas]


@router.get("/auditoria/movimientos")
async def movimientos(
    limite: int = Query(300, ge=1, le=TOPE_EXPORTAR),
    desplazamiento: int = Query(0, ge=0),
    entidad: str | None = None,
    accion: str | None = None,
    usuario: str | None = None,
    id_usuario: int | None = None,
    buscar: str | None = None,
    solo_fallidos: bool = False,
    tipo: Literal["ingresos"] | None = None,
    desde: date | None = None,
    hasta: date | None = None,
    opciones: bool = True,
    con_detalle: bool = True,
    db=Depends(get_db),
    _u=Depends(get_current_user),
    permisos=Depends(get_permisos_actuales),
):
    """Lo último primero, filtrado EN EL SERVIDOR y de a páginas (RF-25).

    - `desde` / `hasta`: días (AAAA-MM-DD), incluidos. Sin ellos, desde siempre.
    - `id_usuario`: lo que hizo esa persona y los ingresos de su cuenta (_de_la_persona).
      `usuario` (el nombre exacto) sigue andando para la pantalla de antes.
    - `tipo=ingresos`: sólo entradas, salidas, intentos fallidos, bloqueos y claves.
    - `accion`: una o varias separadas por coma.
    - `desplazamiento` + `limite`: la página. `total` dice cuántos hay con esos filtros.
    - `opciones=false`: sin los desplegables (al pasar de página no cambian).
    - `con_detalle=false`: sin el JSON crudo (el Exportar no lo usa y es lo que más pesa).

    Sin parámetros contesta lo mismo que antes —los últimos 300 y los desplegables—:
    la pantalla vieja sigue andando contra este backend.

    Permisos (revisión del 23/09): `tipo=ingresos` pide «Ingresos y actividad por
    persona»; sin tipo, «Todo lo que se hizo», y sin la de Ingresos no van las filas de
    entrar, salir y claves. `personas` lleva usuario y acceso sólo con «Usuarios y
    permisos». Ver arriba, «lo que cada uno puede ver del registro».
    """
    ve_ingresos = _puede(permisos, "auditoria_ingresos")
    ve_cuentas = _puede(permisos, "configuracion_usuarios")
    if tipo == "ingresos" and not ve_ingresos:
        raise _prohibido("auditoria_ingresos")
    if tipo != "ingresos" and not _puede(permisos, "auditoria_movimientos"):
        raise _prohibido("auditoria_movimientos")

    condiciones = _condiciones(
        entidad=entidad, accion=accion, usuario=usuario, id_usuario=id_usuario,
        buscar=buscar, solo_fallidos=solo_fallidos, tipo=tipo, desde=desde, hasta=hasta,
    )
    if not ve_ingresos:
        condiciones.append(_sin_ingresos())

    q = select(M).where(*condiciones).order_by(M.creado_en.desc(), M.id.desc())
    if not con_detalle:
        q = q.options(defer(M.detalle))
    filas = (await db.execute(q.offset(desplazamiento).limit(limite))).scalars().all()

    # El total con los mismos filtros. Si la página vino incompleta, ya se sabe sin contar.
    if desplazamiento == 0 and len(filas) < limite:
        total = len(filas)
    else:
        total = (await db.execute(
            select(func.count()).select_from(M).where(*condiciones)
        )).scalar() or 0

    salida = {
        "movimientos": [_fila(m, con_detalle) for m in filas],
        "total": total,
        "desplazamiento": desplazamiento,
        "limite": limite,
        "hay_mas": desplazamiento + len(filas) < total,
        "tope": limite,
        "tope_exportar": TOPE_EXPORTAR,
        "acciones_de_acceso": list(ACCIONES_DE_ACCESO),
    }

    if opciones:
        # Para armar los desplegables de filtro sin que el front tenga que adivinar qué
        # hay. Salen de los datos, así que una entidad nueva aparece sola.
        visibles = [] if ve_ingresos else [_sin_ingresos()]
        entidades = (await db.execute(
            select(M.entidad, func.count().label("cuantos"))
            .where(*visibles)
            .group_by(M.entidad)
            .order_by(func.count().desc())
        )).all()
        usuarios = (await db.execute(
            select(M.usuario)
            .where(M.usuario.isnot(None), *visibles)
            .group_by(M.usuario)
            .order_by(M.usuario)
        )).scalars().all()
        salida["entidades"] = [{"entidad": e, "cuantos": c} for e, c in entidades]
        salida["usuarios"] = list(usuarios)
        salida["personas"] = await _personas(db, ve_cuentas=ve_cuentas, ve_ingresos=ve_ingresos)

    return salida


@router.get("/auditoria/actividad")
async def actividad(
    desde: date | None = None,
    hasta: date | None = None,
    db=Depends(get_db),
    _u=Depends(get_current_user),
    permisos=Depends(get_permisos_actuales),
):
    """«Actividad por persona» (RF-25): cada usuario con su último ingreso y, en el
    período, cuántas veces entró, cuántas acciones hizo y cuántos intentos fallidos
    tuvo su cuenta. Tocar un renglón en la pantalla filtra el registro por esa persona.

    - Acciones = todo lo que firmó menos entrar y salir (crear, editar, borrar, cambiar
      su clave, desbloquear a alguien). `acciones_fallidas`: las que no se pudieron.
    - Intentos fallidos = contraseña mala, cuenta bloqueada o desactivada, contra SU
      cuenta. Los errores del sistema (5xx) no cuentan: no son culpa de nadie.
    - Último ingreso: el del registro. Si todavía no entró desde que se registran los
      ingresos, el de la ficha (`usuario.ultimo_login`), marcado: ese dato se guardaba
      en UTC (utcnow) y acá se pasa a hora del taller (-3 h).
    - Sin fechas = desde siempre. Los que no tienen acceso (desactivados) aparecen sólo
      si hicieron algo en el período.

    Pide «Ingresos y actividad por persona» (confidencial; la política lo exige y acá se
    vuelve a mirar por si alguien monta el router sin ella). Las CUENTAS —usuario, si
    tiene acceso, el último login de la ficha y los que no hicieron nada— sólo con
    «Usuarios y permisos»: sin ella, cada uno con el nombre con que firmó, y aparecen
    sólo los que tienen algo en el registro.
    """
    if not _puede(permisos, "auditoria_ingresos"):
        raise _prohibido("auditoria_ingresos")
    ve_cuentas = _puede(permisos, "configuracion_usuarios")
    rango = _rango_de_fechas(desde, hasta)

    ingresos = func.sum(case((M.accion == ACCION_INGRESO, 1), else_=0))
    es_accion = M.accion.notin_(ACCIONES_DE_SESION)
    acciones = func.sum(case((es_accion, 1), else_=0))
    fallidas = func.sum(case((and_(es_accion, M.estado >= 400), 1), else_=0))
    por_autor = (await db.execute(
        select(M.id_usuario, ingresos, acciones, fallidas)
        .where(M.id_usuario.isnot(None), *rango)
        .group_by(M.id_usuario)
    )).all()

    no_es_del_sistema = or_(M.estado.is_(None), M.estado < 500)
    fallidos_q = func.sum(case((and_(M.accion == ACCION_FALLIDO, no_es_del_sistema), 1), else_=0))
    bloqueos_q = func.sum(case((M.accion == "bloqueó", 1), else_=0))
    por_cuenta = (await db.execute(
        select(M.id_entidad, fallidos_q, bloqueos_q)
        .where(M.accion.in_((ACCION_FALLIDO, "bloqueó")),
               M.entidad.in_((ENTIDAD_SESION, "usuario")),
               M.id_entidad.isnot(None), *rango)
        .group_by(M.id_entidad)
    )).all()

    sin_cuenta = (await db.execute(
        select(func.count()).select_from(M)
        .where(M.accion == ACCION_FALLIDO, M.id_entidad.is_(None), no_es_del_sistema, *rango)
    )).scalar() or 0
    sin_autor = (await db.execute(
        select(func.count()).select_from(M)
        .where(M.id_usuario.is_(None), M.accion.notin_(ACCIONES_DE_ACCESO), *rango)
    )).scalar() or 0

    # De siempre, no del período: «¿cuándo entró por última vez?» no depende del filtro.
    ultimos_ingresos = dict((await db.execute(
        select(M.id_usuario, func.max(M.creado_en))
        .where(M.accion == ACCION_INGRESO, M.id_usuario.isnot(None))
        .group_by(M.id_usuario)
    )).all())
    ultimas_acciones = dict((await db.execute(
        select(M.id_usuario, func.max(M.creado_en))
        .where(M.id_usuario.isnot(None), M.accion.notin_(ACCIONES_DE_SESION))
        .group_by(M.id_usuario)
    )).all())
    # El nombre con que firmó por última vez, para quien ya no está en `usuario`.
    ultimo = (
        select(M.id_usuario, func.max(M.id).label("ultimo"))
        .where(M.id_usuario.isnot(None), M.usuario.isnot(None))
        .group_by(M.id_usuario).subquery()
    )
    firmas = dict((await db.execute(
        select(M.id_usuario, M.usuario).join(ultimo, M.id == ultimo.c.ultimo)
    )).all())

    personas: dict[int, dict] = {}

    def persona(id_usuario: int) -> dict:
        if id_usuario not in personas:
            personas[id_usuario] = {
                "id_usuario": id_usuario,
                "nombre": firmas.get(id_usuario) or f"Usuario #{id_usuario}",
                "username": None,
                "activo": None,
                "ultimo_ingreso": None,
                "ultimo_ingreso_de_la_ficha": False,
                "ultima_accion": None,
                "ingresos": 0,
                "acciones": 0,
                "acciones_fallidas": 0,
                "intentos_fallidos": 0,
                "bloqueos": 0,
            }
        return personas[id_usuario]

    # Al final: si falla, hace rollback (ver _cuentas). Sin «Usuarios y permisos», ni se lee.
    cuentas = await _cuentas(db) if ve_cuentas else []
    ultimo_login = {}
    for c in cuentas:
        if c["activo"]:
            persona(c["id_usuario"])
        ultimo_login[c["id_usuario"]] = c["ultimo_login"]
    for id_usuario, n_ingresos, n_acciones, n_fallidas in por_autor:
        p = persona(id_usuario)
        p["ingresos"] = int(n_ingresos or 0)
        p["acciones"] = int(n_acciones or 0)
        p["acciones_fallidas"] = int(n_fallidas or 0)
    for id_entidad, n_fallidos, n_bloqueos in por_cuenta:
        try:
            id_usuario = int(id_entidad)
        except (TypeError, ValueError):
            continue
        if not (n_fallidos or n_bloqueos):
            continue
        p = persona(id_usuario)
        p["intentos_fallidos"] = int(n_fallidos or 0)
        p["bloqueos"] = int(n_bloqueos or 0)

    por_id = {c["id_usuario"]: c for c in cuentas}
    for id_usuario, p in personas.items():
        c = por_id.get(id_usuario)
        if c:
            p["nombre"], p["username"], p["activo"] = c["nombre"], c["username"], c["activo"]
        ingreso = ultimos_ingresos.get(id_usuario)
        if ingreso is None and ultimo_login.get(id_usuario):
            ingreso = ultimo_login[id_usuario] - timedelta(hours=3)
            p["ultimo_ingreso_de_la_ficha"] = True
        p["ultimo_ingreso"] = ingreso.isoformat() if ingreso else None
        accion = ultimas_acciones.get(id_usuario)
        p["ultima_accion"] = accion.isoformat() if accion else None

    lista = sorted(personas.values(),
                   key=lambda p: (-p["acciones"], -p["intentos_fallidos"], (p["nombre"] or "").lower()))
    return {
        "desde": desde.isoformat() if desde else None,
        "hasta": hasta.isoformat() if hasta else None,
        "personas": lista,
        "intentos_sin_cuenta": int(sin_cuenta),
        "acciones_sin_persona": int(sin_autor),
        "generado": ahora_ar().isoformat(),
    }


def _fila_proceso(a: AuditoriaProcesoOT) -> dict:
    return {
        "id": a.id,
        # Completa y con segundos: dos pasadas agregadas en el mismo guardado caen en
        # el mismo minuto, y el orden entre ellas es lo que se viene a mirar.
        "cuando": a.creado_en.isoformat() if a.creado_en else None,
        "usuario": a.usuario,
        "id_usuario": a.id_usuario,
        "origen": a.origen,
        "id_orden_trabajo": a.id_orden_trabajo,
        "id_otp": a.id_otp,
        "id_proceso": a.id_proceso,
        "nombre_proceso": a.nombre_proceso,
        "accion": a.accion,
        "paso": a.paso,
        "cambios": json.loads(a.cambios) if a.cambios else [],
        "descripcion": a.descripcion,
        "ruta": a.ruta,
    }


@router.get("/auditoria/procesos")
async def procesos(
    id_orden: int | None = None,
    limite: int = Query(300, ge=1, le=2000),
    usuario: str | None = None,
    accion: str | None = None,
    buscar: str | None = None,
    db=Depends(get_db),
    _u=Depends(get_current_user),
):
    """Quién agregó, cambió o sacó cada paso de cada OT.

    Con `id_orden` es el historial de UNA orden —la pregunta que motivó esto, «este
    proceso está dos veces, ¿quién lo puso?»— y sin él, lo último de todo el taller.

    `desde` dice a partir de cuándo hay registro: los pasos anteriores a eso no
    aparecen porque nunca se guardó quién los cargó, y eso hay que decirlo en vez de
    dejar pensar que aparecieron solos.
    """
    q = select(AuditoriaProcesoOT).order_by(
        AuditoriaProcesoOT.creado_en.desc(), AuditoriaProcesoOT.id.desc()
    )
    # `is not None` y no `if id_orden`: con ?id_orden= alcanza con ver Operaciones
    # (core/permisos_rutas.py), y un ?id_orden=0 que se tomara como «sin filtro» le
    # daría a cualquiera con Operaciones el historial de todo el taller.
    if id_orden is not None:
        q = q.where(AuditoriaProcesoOT.id_orden_trabajo == id_orden)
    if usuario:
        q = q.where(AuditoriaProcesoOT.usuario == usuario)
    if accion:
        q = q.where(AuditoriaProcesoOT.accion == accion)
    if buscar:
        # Se busca por todo lo que la pantalla muestra, no sólo por la frase: quien
        # escribe «Leonardo» está buscando a una persona y quien escribe «1081» una
        # orden. Mirando sólo `descripcion` —que no lleva el nombre del autor— las dos
        # búsquedas contestaban que no hay nada.
        termino = buscar.strip()
        patron = f"%{termino}%"
        condiciones = [
            AuditoriaProcesoOT.descripcion.ilike(patron),
            AuditoriaProcesoOT.usuario.ilike(patron),
            AuditoriaProcesoOT.nombre_proceso.ilike(patron),
        ]
        if termino.isdigit():
            condiciones.append(AuditoriaProcesoOT.id_orden_trabajo == int(termino))
        q = q.where(or_(*condiciones))

    filas = (await db.execute(q.limit(limite))).scalars().all()
    desde = (await db.execute(select(func.min(AuditoriaProcesoOT.creado_en)))).scalar()

    return {
        "cambios": [_fila_proceso(a) for a in filas],
        "desde": desde.isoformat() if desde else None,
        "tope": limite,
    }


@router.get("/auditoria/movimientos/de/{entidad}/{id_entidad}")
async def movimientos_de(
    entidad: str,
    id_entidad: str,
    db=Depends(get_db),
    _u=Depends(get_current_user),
    permisos=Depends(get_permisos_actuales),
):
    """Todo lo que le pasó a UNA cosa: «mostrame el historial de la OT 1081».

    Es la pregunta que motivó todo esto, así que tiene su propia dirección en vez de
    depender de que alguien acierte el filtro. Sin «Ingresos y actividad por persona»
    no manda las filas de entrar, salir y claves (/de/sesión/5 era otra puerta a eso)."""
    q = (
        select(AuditoriaMovimiento)
        .where(AuditoriaMovimiento.entidad.like(f"{entidad}%"))
        .where(AuditoriaMovimiento.id_entidad == str(id_entidad))
        .order_by(AuditoriaMovimiento.creado_en.desc())
        .limit(500)
    )
    if not _puede(permisos, "auditoria_ingresos"):
        q = q.where(_sin_ingresos())
    filas = (await db.execute(q)).scalars().all()
    return {"movimientos": [_fila(m) for m in filas]}


# ─────────────────────────── RF-17: el historial de una OT y de una persona ───────────────────────────
#
# El SRS pide «repositorio centralizado de documentos históricos y registros de auditoría
# de cada orden y cada operario», y Julián lo quiso ACÁ, en Auditoría, y no adentro de la
# planificación. La línea de tiempo la arma el servidor (application/HistorialService.py)
# con el registro central buscado por entidad y número, completado con las tablas que
# guardan cada hecho (pasos, pausas, consumos, no conformidades, planos, plan, ausencias).
#
# Permisos: el router pide la sección «Todo lo que se hizo» (core/permisos_rutas.py), que
# NO es confidencial. Lo que tiene sección o política propia se respeta adentro: los
# pasos («Pasos de las OT»), el plan («Planificaciones»), lo estimado contra lo que llevó
# cada paso de una persona («Rendimiento por persona», confidencial) y sus ausencias (la
# política 'asistencia': Recursos u Operaciones). Sin eso, no se lee ni se manda.

def _secciones(permisos) -> dict:
    def tiene(seccion: str) -> bool:
        return _puede(permisos, seccion)

    def ve_ausencias() -> bool:
        # Las ausencias (con el motivo: ENFERMEDAD, y la observación) se leen afuera con
        # la política 'asistencia' (Recursos u Operaciones). Revisión del 23/09: acá
        # quedaban abiertas a quien sólo tiene Auditoría. Mismo requisito, del mapa.
        from backend.core.permisos_rutas import POLITICAS, permite
        try:
            return bool(permisos) and permite(POLITICAS["asistencia"].leer, permisos, {})
        except Exception:
            return False
    return {
        "ve_pasos": tiene("auditoria_procesos"),
        "ve_plan": tiene("auditoria_planificacion"),
        "ve_rendimiento": tiene("dashboard_rendimiento"),
        "ve_ausencias": ve_ausencias(),
    }


def _periodo(desde: date | None, hasta: date | None) -> None:
    if desde and hasta and desde > hasta:
        raise HTTPException(status_code=400,
                            detail="La fecha «desde» es posterior a la fecha «hasta».")


@router.get("/auditoria/historial/ordenes")
async def historial_buscar_ordenes(
    buscar: str | None = None,
    limite: int = Query(30, ge=1, le=100),
    db=Depends(get_db),
    _u=Depends(get_current_user),
):
    """Para elegir la OT: por número, cliente o artículo. Sin texto, las últimas."""
    from backend.application.HistorialService import HistorialService
    return {"ordenes": await HistorialService(db).buscar_ordenes(buscar, limite)}


@router.get("/auditoria/historial/ordenes/{id_orden}")
async def historial_de_orden(
    id_orden: int,
    desde: date | None = None,
    hasta: date | None = None,
    db=Depends(get_db),
    _u=Depends(get_current_user),
    permisos=Depends(get_permisos_actuales),
):
    """Todo lo que pasó con UNA OT, lo último primero (RF-17)."""
    from backend.application.HistorialService import HistorialService
    _periodo(desde, hasta)
    s = _secciones(permisos)
    datos = await HistorialService(db).de_orden(id_orden, desde, hasta,
                                               ve_pasos=s["ve_pasos"], ve_plan=s["ve_plan"])
    if datos is None:
        raise HTTPException(status_code=404, detail=f"No existe la orden de trabajo {id_orden}.")
    return datos


@router.get("/auditoria/historial/personas")
async def historial_buscar_personas(
    buscar: str | None = None,
    db=Depends(get_db),
    _u=Depends(get_current_user),
):
    """Para elegir a la persona (Recurso humano)."""
    from backend.application.HistorialService import HistorialService
    return {"personas": await HistorialService(db).buscar_personas(buscar)}


@router.get("/auditoria/historial/personas/{id_operario}")
async def historial_de_persona(
    id_operario: int,
    desde: date | None = None,
    hasta: date | None = None,
    db=Depends(get_db),
    _u=Depends(get_current_user),
    permisos=Depends(get_permisos_actuales),
):
    """Todo lo que pasó con UNA persona del taller, lo último primero (RF-17)."""
    from backend.application.HistorialService import HistorialService
    _periodo(desde, hasta)
    s = _secciones(permisos)
    datos = await HistorialService(db).de_persona(id_operario, desde, hasta, **s)
    if datos is None:
        raise HTTPException(status_code=404, detail=f"No existe la persona {id_operario}.")
    return datos
