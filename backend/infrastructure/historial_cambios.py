"""Qué cambió de una OT o de una persona al guardarla: la foto de antes y la de después.

POR QUÉ (RF-17, 23/09)

El SRS pide «repositorio centralizado de documentos históricos y registros de auditoría
de cada orden y cada operario», y Julián lo pidió dentro de Auditoría: una línea de
tiempo por OT y por persona. Para los PASOS eso ya existía (auditoria_proceso_ot guarda
el cambio campo por campo). Para la CABECERA de la OT —fechas, cliente, prioridad,
cantidades— y para la FICHA de la persona, no: el registro central guarda el PEDIDO que
mandó el navegador, y el modal manda la cabecera entera en cada guardado. Con eso se sabe
qué quedó, pero no qué había antes, y «¿quién le cambió la fecha prometida?» no tenía
respuesta.

Esto lo arregla desde ahora: el endpoint saca una foto legible antes y otra después del
guardado, y deja en `request.state.auditoria` sólo lo que cambió (`antes` y `despues`,
por nombre de campo en castellano) y una frase que lo dice. El middleware lo guarda en
la misma fila de siempre (auditoria_movimientos.armar_fila). Para las filas anteriores,
la línea de tiempo lo deduce comparando cada guardado con el anterior
(application/HistorialService.py) y lo dice así.

REGLAS

  · Nunca rompe el guardado. La foto se lee en un SAVEPOINT: si falla, en Postgres la
    transacción no queda abortada y el UPDATE del usuario sigue; se pierde la foto, no
    el cambio. Cualquier error acá se loguea y listo.
  · Valores legibles, no ids: «Alta», «ACME S.A.», «15/09/2026». El catálogo puede
    cambiar de nombre mañana; el registro dice cómo se llamaba cuando se cambió.
  · Los datos personales de la ficha (DNI, teléfono, celular, email, nacimiento) no se
    copian: se dice que cambiaron, no a qué.
"""
from __future__ import annotations

from datetime import date, datetime, time

from sqlalchemy import select

from backend.commons.loggers.logger import logger

# ─────────────────────────── cómo se lee cada campo ───────────────────────────

# La cabecera de la OT, en el orden en que se lee (lo más preguntado primero).
ETIQUETAS_OT: dict[str, str] = {
    "id_otvieja": "número de OT",
    "fecha_prometida": "fecha prometida",
    "fecha_entrega": "fecha de entrega",
    "id_prioridad": "prioridad",
    "id_cliente": "cliente",
    "unidades": "unidades",
    "cantidad_entregada": "unidades entregadas",
    "id_articulo": "artículo",
    "id_sector": "sector",
    "fecha_orden": "fecha de la orden",
    "fecha_entrada": "fecha de entrada",
    "f_disp_material": "material disponible",
    "suspendida": "suspendida",
    "finalizadototal": "terminada",
    "finalizadoparcial": "terminada en parte",
    "detalle": "detalle",
    "observaciones": "observaciones",
    "n_pedido": "n.º de pedido",
    "n_ped_l": "n.º de pedido L",
    "subsector": "subsector",
    "requerido_por": "requerido por",
    "aprobado_por": "aprobado por",
    "remitos_salida": "remitos de salida",
    "fabricacion": "fabricación",
    "reparacion": "reparación",
    "sin_cargo": "sin cargo",
    "stock": "para stock",
    "interno": "interno",
    "revisada": "revisada",
    "reclamo": "reclamo",
    "tercerizado_total": "tercerizada",
    "tercerizado_parcial": "tercerizada en parte",
    "no_lleva_plano": "no lleva plano",
    "no_lleva_materia_prima": "no lleva materia prima",
    "tiene_plano": "tiene plano",
    "programada": "programada",
    "en_proceso": "en proceso",
    "email": "aviso por mail",
}

# Las marcas sí / no de la OT (en la base, 0/1 o NULL).
MARCAS_OT = frozenset({
    "suspendida", "finalizadototal", "finalizadoparcial", "fabricacion", "reparacion",
    "sin_cargo", "stock", "interno", "revisada", "reclamo", "tercerizado_total",
    "tercerizado_parcial", "no_lleva_plano", "no_lleva_materia_prima", "tiene_plano",
    "programada", "en_proceso", "email",
})

# Los que en la base son un id y se leen por el nombre del catálogo.
CATALOGOS_OT = ("id_cliente", "id_prioridad", "id_sector", "id_articulo")

# La ficha de la persona. Las habilidades van al final: son listas y se leen aparte.
ETIQUETAS_PERSONA: dict[str, str] = {
    "nombre": "nombre",
    "apellido": "apellido",
    "disponible": "estado",
    "categoria": "categoría",
    "sector": "sector",
    "rangos": "rangos",
    "interpreta_planos": "interpreta planos",
    "hora_inicio": "entra",
    "hora_fin": "sale",
    "dias_trabajo": "días de trabajo",
    "min_desayuno": "minutos de desayuno",
    "min_almuerzo": "minutos de almuerzo",
    "fecha_ingreso": "fecha de ingreso",
    "skill1": "SKILL 1",
    "skill2": "SKILL 2",
    "manuales": "habilidades agregadas a mano",
    "deshabilitadas": "habilidades deshabilitadas",
    "dni": "DNI",
    "fecha_nacimiento": "fecha de nacimiento",
    "telefono": "teléfono",
    "celular": "celular",
    "email": "email",
}

# Datos personales: el registro dice que cambiaron, no a qué. Un registro de auditoría
# que cualquiera con la sección puede exportar no es lugar para el DNI de nadie.
PRIVADOS_PERSONA = frozenset({"dni", "fecha_nacimiento", "telefono", "celular", "email"})
OCULTO = "(no se copia al registro)"

# Qué cuenta como «habilidades» y no como «ficha» (para el tipo de evento).
HABILIDADES_PERSONA = frozenset({"rangos", "skill1", "skill2", "manuales", "deshabilitadas"})

DIAS = {"MON": "lun", "TUE": "mar", "WED": "mié", "THU": "jue", "FRI": "vie",
        "SAT": "sáb", "SUN": "dom"}

TOPE_TEXTO = 120


def texto_de(valor) -> str | None:
    """Un valor como se lee en la pantalla. None = vacío."""
    if valor is None:
        return None
    if isinstance(valor, bool):
        return "sí" if valor else "no"
    if isinstance(valor, datetime):
        if valor.hour or valor.minute:
            return valor.strftime("%d/%m/%Y %H:%M")
        return valor.strftime("%d/%m/%Y")
    if isinstance(valor, date):
        return valor.strftime("%d/%m/%Y")
    if isinstance(valor, time):
        return valor.strftime("%H:%M")
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    texto = str(valor).strip()
    if not texto:
        return None
    if len(texto) > TOPE_TEXTO:
        return texto[:TOPE_TEXTO - 1] + "…"
    return texto


def marca(valor) -> str:
    """0/1/NULL/bool -> «sí» / «no». NULL es «no»: así lo lee toda la app."""
    if isinstance(valor, str):
        return "sí" if valor.strip().lower() in ("1", "true", "sí", "si") else "no"
    return "sí" if valor else "no"


def dias_de_trabajo(valor) -> str | None:
    """«MON,TUE,WED» -> «lun, mar, mié»."""
    if not valor:
        return None
    return ", ".join(DIAS.get(d.strip().upper(), d.strip()) for d in str(valor).split(",") if d.strip())


def diferencias(antes: dict | None, despues: dict | None, etiquetas: dict[str, str],
                privados: frozenset = frozenset()) -> list[dict]:
    """[{campo, antes, despues}] de lo que cambió, en el orden de `etiquetas`.

    Sin foto de antes (o de después) no hay comparación posible: [] — decir «cambió» sin
    saber de qué a qué sería inventar."""
    if antes is None or despues is None:
        return []
    salida = []
    for campo, etiqueta in etiquetas.items():
        a, d = antes.get(campo), despues.get(campo)
        if a == d:
            continue
        if campo in privados:
            salida.append({"campo": etiqueta, "antes": OCULTO, "despues": OCULTO})
        else:
            salida.append({"campo": etiqueta, "antes": a, "despues": d})
    return salida


def frase_de_cambios(cambios: list[dict], tope: int = 4) -> str:
    """«fecha prometida: 10/09/2026 → 15/09/2026; prioridad: Normal → Alta (y 2 más)»."""
    partes = []
    for c in cambios[:tope]:
        if c["antes"] == OCULTO:
            partes.append(f"{c['campo']} (cambió)")
        else:
            partes.append(f"{c['campo']}: {c['antes'] or '—'} → {c['despues'] or '—'}")
    texto = "; ".join(partes)
    if len(cambios) > tope:
        resto = len(cambios) - tope
        texto += f" (y {resto} {'cambio' if resto == 1 else 'cambios'} más)"
    return texto


def como_detalle(cambios: list[dict]) -> tuple[dict, dict]:
    """(antes, despues) por nombre de campo, para el detalle de la fila de auditoría."""
    return ({c["campo"]: c["antes"] for c in cambios},
            {c["campo"]: c["despues"] for c in cambios})


# ─────────────────────────── las fotos ───────────────────────────

async def _en_savepoint(db, leer):
    """Corre `leer()` en un SAVEPOINT y devuelve lo que devuelva, o None si falla. En
    Postgres un SELECT que falla deja la transacción abortada: sin el savepoint, el
    guardado que viene después reventaría por culpa de la foto."""
    try:
        async with db.begin_nested():
            return await leer()
    except Exception as e:
        logger.warning(f"Historial: no se pudo sacar la foto: {e}")
        return None


async def foto_de_ot(db, id_orden: int) -> dict | None:
    """La cabecera de la OT, legible (ver ETIQUETAS_OT). None si no existe."""
    from backend.domain.Articulo import Articulo
    from backend.domain.Cliente import Cliente
    from backend.domain.OrdenTrabajo import OrdenTrabajo
    from backend.domain.Prioridad import Prioridad
    from backend.domain.Sector import Sector

    columnas = [getattr(OrdenTrabajo, c) for c in ETIQUETAS_OT]
    fila = (await db.execute(
        select(*columnas,
               Cliente.nombre.label("_cliente"),
               Prioridad.descripcion.label("_prioridad"),
               Sector.nombre.label("_sector"),
               Articulo.descripcion.label("_articulo"))
        .select_from(OrdenTrabajo)
        .outerjoin(Cliente, Cliente.id == OrdenTrabajo.id_cliente)
        .outerjoin(Prioridad, Prioridad.id == OrdenTrabajo.id_prioridad)
        .outerjoin(Sector, Sector.id == OrdenTrabajo.id_sector)
        .outerjoin(Articulo, Articulo.id == OrdenTrabajo.id_articulo)
        .where(OrdenTrabajo.id == id_orden)
    )).first()
    if fila is None:
        return None
    m = dict(fila._mapping)
    nombres = {"id_cliente": m["_cliente"], "id_prioridad": m["_prioridad"],
               "id_sector": m["_sector"], "id_articulo": m["_articulo"]}
    foto = {}
    for campo in ETIQUETAS_OT:
        valor = m.get(campo)
        if campo in MARCAS_OT:
            foto[campo] = marca(valor)
        elif campo in CATALOGOS_OT:
            foto[campo] = texto_de(nombres[campo]) or (f"#{valor}" if valor is not None else None)
        else:
            foto[campo] = texto_de(valor)
    return foto


async def foto_de_persona(db, id_operario: int) -> dict | None:
    """La ficha de la persona, legible (ver ETIQUETAS_PERSONA), con sus rangos y sus
    habilidades priorizadas. None si no existe."""
    from backend.domain.Operario import Operario
    from backend.domain.OperarioProcesoSkill import OperarioProcesoSkill
    from backend.domain.OperarioRango import OperarioRango
    from backend.domain.Proceso import Proceso
    from backend.domain.Rango import Rango

    campos = [c for c in ETIQUETAS_PERSONA if c not in HABILIDADES_PERSONA]
    fila = (await db.execute(
        select(*[getattr(Operario, c) for c in campos]).where(Operario.id == id_operario)
    )).first()
    if fila is None:
        return None
    m = dict(fila._mapping)
    foto = {}
    for campo in campos:
        valor = m.get(campo)
        if campo == "disponible":
            foto[campo] = "Activo" if valor else "Ausente"
        elif campo == "interpreta_planos":
            foto[campo] = marca(valor)
        elif campo == "dias_trabajo":
            foto[campo] = dias_de_trabajo(valor)
        else:
            foto[campo] = texto_de(valor)

    rangos = (await db.execute(
        select(Rango.nombre).join(OperarioRango, OperarioRango.id_rango == Rango.id)
        .where(OperarioRango.id_operario == id_operario)
    )).scalars().all()
    foto["rangos"] = ", ".join(sorted(r for r in rangos if r)) or None

    skills = (await db.execute(
        select(OperarioProcesoSkill.nivel, OperarioProcesoSkill.orden,
               OperarioProcesoSkill.habilitado, OperarioProcesoSkill.manual, Proceso.nombre)
        .join(Proceso, Proceso.id == OperarioProcesoSkill.id_proceso)
        .where(OperarioProcesoSkill.id_operario == id_operario)
    )).all()

    def lista(filas, ordenar_por_posicion: bool) -> str | None:
        if ordenar_por_posicion:
            filas = sorted(filas, key=lambda s: (s.orden if s.orden is not None else 10**6, s.nombre or ""))
        else:
            filas = sorted(filas, key=lambda s: s.nombre or "")
        return ", ".join(s.nombre for s in filas if s.nombre) or None

    foto["skill1"] = lista([s for s in skills if s.nivel == 1], True)
    foto["skill2"] = lista([s for s in skills if s.nivel == 2], True)
    foto["manuales"] = lista([s for s in skills if s.manual], False)
    foto["deshabilitadas"] = lista([s for s in skills if s.habilitado is False], False)
    return foto


async def foto_de_ot_sin_romper(db, id_orden: int) -> dict | None:
    return await _en_savepoint(db, lambda: foto_de_ot(db, id_orden))


async def foto_de_persona_sin_romper(db, id_operario: int) -> dict | None:
    return await _en_savepoint(db, lambda: foto_de_persona(db, id_operario))


# ─────────────────────────── lo que el endpoint deja dicho ───────────────────────────

def _dejar(request, resumen: dict) -> None:
    try:
        request.state.auditoria = resumen
    except Exception:
        pass


async def dejar_dicho_cambios_de_ot(request, db, id_orden: int, antes: dict | None) -> None:
    """Después de guardar la OT: qué cambió de la cabecera, para el registro. Si no se
    pudo sacar alguna de las dos fotos, no se dice nada (la fila queda como siempre)."""
    try:
        despues = await foto_de_ot_sin_romper(db, id_orden)
        if antes is None or despues is None:
            return
        cambios = diferencias(antes, despues, ETIQUETAS_OT)
        a, d = como_detalle(cambios)
        resumen = {"antes": a, "despues": d}
        if cambios:
            numero = despues.get("id_otvieja") or id_orden
            resumen["frase"] = f"editó la OT {numero}: {frase_de_cambios(cambios)}"
        # Sin cambios, `antes` y `despues` van vacíos: la línea de tiempo lee eso como
        # «la cabecera quedó igual» (el guardado pudo tocar sólo los pasos).
        _dejar(request, resumen)
    except Exception as e:
        logger.warning(f"Historial: no se pudo anotar el cambio de la OT {id_orden}: {e}")


async def dejar_dicho_cambios_de_persona(request, db, id_operario: int, antes: dict | None) -> None:
    """Después de guardar la ficha: qué cambió, para el registro."""
    try:
        despues = await foto_de_persona_sin_romper(db, id_operario)
        if antes is None or despues is None:
            return
        cambios = diferencias(antes, despues, ETIQUETAS_PERSONA, PRIVADOS_PERSONA)
        a, d = como_detalle(cambios)
        resumen = {"antes": a, "despues": d}
        if cambios:
            quien = " ".join(x for x in (despues.get("nombre"), despues.get("apellido")) if x)
            resumen["frase"] = f"editó a {quien or f'la persona #{id_operario}'}: {frase_de_cambios(cambios)}"
        _dejar(request, resumen)
    except Exception as e:
        logger.warning(f"Historial: no se pudo anotar el cambio de la persona {id_operario}: {e}")


def dejar_dicho_alta(request, *, id_entidad, frase: str | None) -> None:
    """En un alta el número todavía no está en la dirección (POST /ordenes): sin esto la
    fila del registro no se puede atar a la OT ni a la persona que creó."""
    if id_entidad is None:
        return
    resumen = {"id_entidad": str(id_entidad)}
    if frase:
        resumen["frase"] = frase
    _dejar(request, resumen)


def id_de_respuesta(resultado) -> int | None:
    """El id de lo recién creado, de la respuesta del servicio (ResponseDTO o dict)."""
    try:
        data = getattr(resultado, "data", None)
        if data is None and isinstance(resultado, dict):
            data = resultado.get("data", resultado)
        if isinstance(data, dict) and data.get("id") is not None:
            return int(data["id"])
    except Exception:
        pass
    return None


def dato_de_respuesta(resultado, clave: str):
    try:
        data = getattr(resultado, "data", None)
        if data is None and isinstance(resultado, dict):
            data = resultado.get("data", resultado)
        if isinstance(data, dict):
            return data.get(clave)
    except Exception:
        pass
    return None
