"""El historial de UNA orden y de UNA persona, dentro de Auditoría (RF-17, 23/09).

QUÉ PIDE EL SRS Y CÓMO LO PIDIÓ JULIÁN

RF-17: «repositorio centralizado de documentos históricos y registros de auditoría de
cada orden y cada operario». Había una auditoría general (todo lo que se hizo, de a un
renglón) y, en la ficha de la OT, sólo los cambios de los pasos. Julián: «¿esto
podríamos mostrarlo en la sección de Auditoría? No meterlo dentro de planificación».
Así que vive ACÁ, detrás de la sección Auditoría, y ni la ficha de la OT, ni la de la
persona, ni Operaciones, ni el planificador suman nada.

UNA SOLA FUENTE, ARMADA EN EL SERVIDOR

La línea de tiempo se arma acá, no en el navegador juntando listas sueltas. La base es
el registro central (`auditoria_movimiento`) buscado por entidad y número: todo pedido
que tocó a esa OT o a esa persona, o a algo que cuelga de ella (sus consumos, sus no
conformidades, sus planos, su materia prima, sus filas del plan). Lo que ese registro no
alcanza a contar se completa con las tablas que ya guardan el hecho con su autor:

  · los PASOS, de `auditoria_proceso_ot` (el cambio campo por campo);
  · las PAUSAS, de `orden_trabajo_pausa` (también las que se cierran solas al terminar
    un paso, que no son un pedido);
  · los CONSUMOS, de `consumo_material`; las NO CONFORMIDADES, de `incidencia_proceso`;
  · los PLANOS, de `plano`; el PLAN, de `planificacion` (+ quién lo confirmó, de
    `planificacion_intento`, y quién lo borró, de `planificacion_borrada`);
  · las AUSENCIAS, de `operario_ausencia`; lo que TRABAJÓ cada persona, con la misma
    atribución que su ficha (TiemposOperarioService.pasos_atribuidos, RF-06).

Cuando un mismo hecho está en las dos (el pedido «pausó» y la fila de la pausa), va UNA
vez: gana la tabla del hecho, que sabe más (el motivo, cuánto duró, si se cerró sola), y
del registro central quedan los intentos que no se pudieron —que no están en ningún otro
lado—. Un pedido que guardó pasos y la fila de esos pasos se juntan en un solo renglón.

LO QUE SE DEDUCE, SE DICE

El registro central guarda el PEDIDO. Hasta el 23/09 el guardado de una OT no decía qué
había antes, así que «le cambió la fecha prometida» se deduce comparando cada guardado
con el anterior de la misma OT, y el renglón lo aclara. Desde el 23/09 el endpoint deja
el antes y el después (infrastructure/historial_cambios.py) y no hay nada que deducir.
Lo que no tiene autor registrado se muestra sin autor: nunca uno inventado.

ALTA, CAMBIO DE NOMBRE Y BAJA DE UNA PERSONA

Julián lo pidió en la reunión con Lucas: el historial registra las tres. Una persona dada
de baja ya no tiene fila en `operario`, pero se la sigue pudiendo elegir (después de las
cargadas) y su línea de tiempo sale entera: el nombre es el último que quedó en el
registro (su alta, su último guardado o la baja, que desde el 23/09 deja dicho quién era)
y lo demás —el plan, lo trabajado, los pasos que se le soltaron— sigue en sus tablas.
Un guardado que le cambió el nombre se lee «cambió el nombre de Juan Perez a Juan Pérez».

Revisión del 23/09. Una baja es un DELETE que PRUEBA que había a quién borrar (dejó dicho
quién era, o vino después de algo que prueba que estaba cargada): un DELETE a un número
que no existe también contesta 200. Y el historial de pasos, que guardaba el nombre de la
persona elegida y no su número, mezclaba a dos que se llaman igual: desde ese día guarda
también el número; en las filas viejas no se le cuenta a nadie lo de antes de su alta ni
lo de después de su baja, y si en ese momento otra se llamaba igual, el renglón va como
deducido.

PERMISOS

Todo cuelga de la sección «Todo lo que se hizo» de Auditoría (core/permisos_rutas.py).
Lo que tiene sección propia la respeta: los pasos (sección «Pasos de las OT»), el plan
(«Planificaciones») y el rendimiento de la persona («Rendimiento por persona», la
confidencial del Dashboard y de su ficha). Sin la sección, eso no se lee ni se manda, y
la respuesta dice qué quedó afuera.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from itertools import count

from sqlalchemy import and_, func, or_, select, text

from backend.commons.loggers.logger import logger
from backend.infrastructure import historial_cambios as hc

# ─────────────────────────── los tipos de renglón ───────────────────────────

TIPOS_OT: dict[str, str] = {
    "alta": "Alta",
    "cabecera": "Datos de la OT",
    "estado": "Estado",
    "pasos": "Pasos",
    "plan": "Planificación",
    "pausas": "Pausas",
    "consumos": "Consumos",
    "materia_prima": "Materia prima",
    "no_conformidades": "No conformidades",
    "planos": "Planos",
    "entregas": "Entregas",
    "otros": "Otros",
}

TIPOS_PERSONA: dict[str, str] = {
    "alta": "Alta",
    "baja": "Baja",
    "ficha": "Ficha",
    "habilidades": "Rangos y habilidades",
    "ausencias": "Ausencias",
    "asignaciones": "Asignaciones",
    "plan": "Planificación",
    "trabajo": "Trabajo",
    "pausas": "Pausas",
    "no_conformidades": "No conformidades",
    "otros": "Otros",
}

# Más que esto no se lee en una línea de tiempo; se avisa y se pide acotar las fechas.
TOPE_EVENTOS = 2000
# Líneas de detalle por renglón (un guardado de 40 pasos no se lee entero en la lista).
TOPE_LINEAS = 25

# Un pedido y lo que dejó en otra tabla se escriben en momentos distintos: la tabla del
# hecho, DURANTE el pedido; el registro central, al terminar (con lo que tardó). Este es
# el margen para decir «es el mismo».
VENTANA_MISMO_HECHO = timedelta(seconds=120)

# Las no conformidades se guardaban en UTC hasta el 22/09 (ver domain/IncidenciaProceso).
# No se reescriben (dato del cliente): se avisa en el renglón.
NC_EN_HORA_LOCAL_DESDE = datetime(2026, 9, 22)

# Desde el 23/09 el guardado de una persona que existe deja su antes/después
# (historial_cambios.dejar_dicho_cambios_de_persona), aunque no haya cambiado nada. Uno
# que no lo deja es de antes o fue a un número que no estaba cargado (contesta 200 igual).
GUARDADO_CON_ANTES_DESDE = datetime(2026, 9, 23)

ESTADO_PASO = {1: "Pendiente", 2: "En proceso", 3: "Terminado"}

TIPOS_NC = {
    "INTERPRETACION_PLANOS": "Interpretación de planos",
    "MEDIDA_FUERA_DE_TOLERANCIA": "Medida fuera de tolerancia",
    "MATERIAL_NO_CONFORME": "Material no conforme",
    "TERMINACION": "Terminación / superficie",
    "DOCUMENTACION": "Documentación",
    "OTRO": "Otro",
}
GRAVEDAD_NC = {"LEVE": "leve", "MEDIA": "media", "GRAVE": "grave"}

AUSENCIA_MOTIVO = {
    "VACACIONES": "Vacaciones", "ENFERMEDAD": "Enfermedad", "LICENCIA": "Licencia",
    "PERSONAL": "Motivo personal", "OTRO": "Otro",
}

# Rutas del registro central cuyo número está en el CUERPO y no en la dirección.
RUTAS_CON_OT_EN_EL_CUERPO = ("/ordenes/estado-masivo", "/consumos-material",
                             "/ordenes-trabajo-piezas", "/incidencias")


# ─────────────────────────── piezas sueltas ───────────────────────────

_secuencia = count()


def evento(*, id: str, cuando: datetime | None, tipo: str, titulo: str,
           quien: str | None = None, id_usuario: int | None = None, lineas=(),
           salio_bien: bool = True, fuente: str = "Registro", nota: str | None = None,
           deducido: bool = False, ot: dict | None = None, **interno) -> dict:
    """Un renglón de la línea de tiempo. Lo que empieza con `_` es de uso interno (para
    juntar hechos repetidos) y no sale en la respuesta."""
    e = {
        "id": id,
        "cuando": cuando.isoformat() if cuando else None,
        "tipo": tipo,
        "titulo": (titulo or "").strip(),
        "quien": quien or None,
        "id_usuario": id_usuario,
        "lineas": [l for l in lineas if l],
        "salio_bien": bool(salio_bien),
        "fuente": fuente,
        "nota": nota,
        "deducido": bool(deducido),
        "ot": ot,
        "_cuando": cuando,
        "_n": next(_secuencia),
    }
    for k, v in interno.items():
        e[f"_{k}"] = v
    return e


def leer_detalle(texto) -> dict:
    """El JSON del detalle de una fila del registro, o {}.

    El detalle se corta a 4000 caracteres (auditoria_movimientos.TOPE_DETALLE) y un JSON
    cortado no se puede leer entero. `antes` y `despues` van primero desde el 23/09: si
    el resto se cortó, se rescatan ellos solos."""
    if not texto:
        return {}
    try:
        valor = json.loads(texto)
        return valor if isinstance(valor, dict) else {}
    except (ValueError, TypeError):
        pass
    rescatado = {"_recortado": True}
    decodificador = json.JSONDecoder()
    for clave in ("antes", "despues"):
        marca = f'"{clave}": '
        i = texto.find(marca)
        if i < 0:
            continue
        try:
            valor, _ = decodificador.raw_decode(texto, i + len(marca))
            if isinstance(valor, dict):
                rescatado[clave] = valor
        except ValueError:
            continue
    return rescatado


def sin_autor(frase: str | None, usuario: str | None) -> str:
    """«Lucas Longchamps editó la OT…» -> «editó la OT…»: el quién va aparte."""
    f = (frase or "").strip()
    for prefijo in ([usuario] if usuario else []) + ["alguien"]:
        if prefijo and f.startswith(prefijo + " "):
            return f[len(prefijo) + 1:]
    return f


def cantidad_legible(valor) -> str:
    """3.0 -> «3», 2.5 -> «2,5»."""
    if valor is None:
        return ""
    try:
        numero = float(valor)
    except (TypeError, ValueError):
        return str(valor)
    if numero.is_integer():
        return str(int(numero))
    return f"{numero:.3f}".rstrip("0").rstrip(".").replace(".", ",")


def fecha_legible(d) -> str:
    if isinstance(d, datetime):
        return d.strftime("%d/%m/%Y %H:%M")
    if isinstance(d, date):
        return d.strftime("%d/%m/%Y")
    return str(d or "")


def duracion_legible(minutos) -> str:
    minutos = max(0, int(minutos or 0))
    if minutos < 60:
        return f"{minutos} min"
    h, m = divmod(minutos, 60)
    return f"{h} h {m} min" if m else f"{h} h"


def segun_autor(quien, con_autor: str, sin_autor_: str) -> str:
    """La frase va detrás del nombre de quien lo hizo («Lucas pausó la OT»). Sin autor
    registrado se dice impersonal («se pausó la OT»): nunca un verbo colgando sin sujeto
    ni un autor inventado."""
    return con_autor if quien else sin_autor_


def _plural(n: int, uno: str, varios: str) -> str:
    return f"{n} {uno if n == 1 else varios}"


def _recortar_lineas(lineas: list[str]) -> list[str]:
    if len(lineas) <= TOPE_LINEAS:
        return lineas
    return lineas[:TOPE_LINEAS] + [f"… y {len(lineas) - TOPE_LINEAS} más"]


def lineas_de_cambios(antes: dict, despues: dict) -> list[str]:
    """Las líneas «campo: antes → después» de un detalle con antes y después."""
    salida = []
    for campo in list(dict.fromkeys(list(antes) + list(despues))):
        a, d = antes.get(campo), despues.get(campo)
        if a == hc.OCULTO or d == hc.OCULTO:
            salida.append(f"{campo}: cambió (el dato no se copia al registro)")
        else:
            salida.append(f"{campo}: {a if a not in (None, '') else '—'} → {d if d not in (None, '') else '—'}")
    return salida


# ─────────────────────────── deducir qué cambió (filas viejas) ───────────────────────────

FECHAS_OT = frozenset({"fecha_orden", "fecha_entrada", "fecha_prometida", "fecha_entrega",
                       "f_disp_material"})
ENTEROS_OT = frozenset({"id_otvieja", "unidades", "cantidad_entregada", "id_cliente",
                        "id_prioridad", "id_sector", "id_articulo",
                        "cantidad_finalizada_parcial"})


def _normalizar_fecha(v) -> str | None:
    if v in (None, ""):
        return None
    s = str(v).replace("T", " ").strip()
    dia, _, hora = s.partition(" ")
    hora = hora[:5]
    return dia if not hora or hora == "00:00" else f"{dia} {hora}"


def _normalizar_ot(campo: str, v):
    if campo in hc.MARCAS_OT:
        return 1 if hc.marca(v) == "sí" else 0
    if campo in FECHAS_OT:
        return _normalizar_fecha(v)
    if campo in ENTEROS_OT:
        try:
            return int(v) if v not in (None, "") else None
        except (TypeError, ValueError):
            return None
    return (str(v).strip() or None) if v is not None else None


def _legible_ot(campo: str, v, nombres: dict) -> str:
    if v is None:
        return "—"
    if campo in hc.MARCAS_OT:
        return "sí" if v else "no"
    if campo in hc.CATALOGOS_OT:
        return nombres.get((campo, v)) or f"#{v}"
    if campo in FECHAS_OT:
        dia, _, hora = str(v).partition(" ")
        try:
            d = date.fromisoformat(dia)
            return d.strftime("%d/%m/%Y") + (f" {hora}" if hora else "")
        except ValueError:
            return str(v)
    return hc.texto_de(v) or "—"


PERSONA_CAMPOS_SIMPLES = ("nombre", "apellido", "disponible", "categoria", "sector",
                          "interpreta_planos", "hora_inicio", "hora_fin", "dias_trabajo",
                          "min_desayuno", "min_almuerzo", "fecha_ingreso")


def _normalizar_persona(campo: str, v, nombres: dict):
    """El valor del cuerpo de un PUT /operarios, ya legible (los rangos y las
    habilidades, por nombre). None = vacío."""
    if campo == "disponible":
        return None if v is None else ("Activo" if v else "Ausente")
    if campo == "interpreta_planos":
        return None if v is None else hc.marca(v)
    if campo in ("hora_inicio", "hora_fin"):
        return str(v)[:5] if v else None
    if campo == "dias_trabajo":
        return hc.dias_de_trabajo(v)
    if campo == "rangos":
        if not isinstance(v, list):
            return None
        return ", ".join(sorted(nombres.get(("rango", i)) or f"#{i}" for i in v if i is not None)) or None
    return hc.texto_de(v)


def _habilidades_del_cuerpo(skills, nombres: dict) -> dict:
    """skill1 / skill2 / manuales / deshabilitadas de la lista `skills` de un PUT."""
    if not isinstance(skills, list):
        return {}
    items = [s for s in skills if isinstance(s, dict) and s.get("id_proceso") is not None]

    def nombre(s):
        return nombres.get(("proceso", s.get("id_proceso"))) or f"#{s.get('id_proceso')}"

    def lista(filtradas, por_posicion):
        if por_posicion:
            filtradas = sorted(filtradas, key=lambda s: (s.get("orden") if s.get("orden") is not None else 10**6, nombre(s)))
        else:
            filtradas = sorted(filtradas, key=nombre)
        return ", ".join(nombre(s) for s in filtradas) or None

    return {
        "skill1": lista([s for s in items if s.get("nivel") == 1], True),
        "skill2": lista([s for s in items if s.get("nivel") == 2], True),
        "manuales": lista([s for s in items if s.get("manual")], False),
        "deshabilitadas": lista([s for s in items if s.get("habilitado") is False], False),
    }


def deducir_cambios(filas: list[dict], *, normalizar, legible, etiquetas: dict,
                    privados=frozenset()) -> dict:
    """Para los guardados sin `antes`/`despues` (anteriores al 23/09): qué cambió,
    comparando cada guardado con lo último que se había mandado de cada campo.

    `filas`: [{id, salio_bien, cuerpo (dict | None), recortado, antes, despues}] en orden
    de fecha. Devuelve {id: (lineas, nota)} sólo para las filas viejas.

    Lo que nunca se había mandado antes no se puede comparar: el primer guardado
    registrado no dice qué había, y la nota lo aclara."""
    conocido: dict = {}
    salida: dict = {}
    for f in filas:
        cuerpo = f.get("cuerpo")
        nueva = f.get("antes") is not None and f.get("despues") is not None
        valores = {}
        if isinstance(cuerpo, dict) and f.get("salio_bien"):
            valores = normalizar(cuerpo)
        if nueva:
            conocido.update(valores)
            continue
        if not f.get("salio_bien"):
            continue
        if not isinstance(cuerpo, dict):
            salida[f["id"]] = ([], "El registro de este guardado quedó recortado: no se puede "
                                   "leer qué cambió.")
            continue
        cambios, nuevos = [], 0
        for campo in etiquetas:
            if campo not in valores:
                continue
            v = valores[campo]
            if campo in conocido:
                if conocido[campo] != v:
                    cambios.append((campo, conocido[campo], v))
            else:
                nuevos += 1
            conocido[campo] = v
        if cambios:
            lineas = []
            for campo, a, d in cambios:
                if campo in privados:
                    lineas.append(f"{etiquetas[campo]}: cambió (el dato no se copia al registro)")
                else:
                    lineas.append(f"{etiquetas[campo]}: {legible(campo, a)} → {legible(campo, d)}")
            nota = ("Deducido comparando con el guardado anterior: hasta el 23/09 el registro "
                    "guardaba lo que se mandó, no lo que había.")
        elif nuevos:
            lineas, nota = [], ("Es el primer guardado registrado: no se puede saber qué "
                                "había antes.")
        else:
            lineas, nota = [], "Los datos quedaron igual que en el guardado anterior."
        salida[f["id"]] = (lineas, nota)
    return salida


# ─────────────────────────── el registro central -> renglones ───────────────────────────

_RE_OT_PASOS = re.compile(r"^/ordenes/\d+/procesos")
_RE_OT_ID = re.compile(r"^/ordenes/(\d+)/?$")
_RE_ENTREGA = re.compile(r"^/ordenes/\d+/entrega/?$")
_RE_SKILL = re.compile(r"^/operarios/\d+/skills(?:-nativas)?(?:/(\d+))?")


def tipo_de_ruta_ot(metodo: str, ruta: str) -> str:
    ruta = ruta or ""
    if metodo == "POST" and ruta.rstrip("/") == "/ordenes":
        return "alta"
    if _RE_OT_ID.match(ruta):
        return "otros" if metodo == "DELETE" else "cabecera"
    if _RE_ENTREGA.match(ruta):
        return "entregas"
    if ruta.startswith("/ordenes/estado-masivo"):
        return "estado"
    if _RE_OT_PASOS.match(ruta):
        return "estado" if ("/estado" in ruta or "/status" in ruta) else "pasos"
    if ruta.endswith("/pausar") or ruta.endswith("/reanudar"):
        return "pausas"
    if ruta.startswith("/consumos-material"):
        return "consumos"
    if ruta.startswith("/ordenes-trabajo-piezas"):
        return "materia_prima"
    if ruta.startswith("/incidencias"):
        return "no_conformidades"
    if ruta.startswith("/planos"):
        return "planos"
    if ruta.startswith("/planificar") or ruta.startswith("/planificacion"):
        return "plan"
    return "otros"


_RE_PERSONA_ID = re.compile(r"^/operarios/\d+/?$")


def tipo_de_ruta_persona(metodo: str, ruta: str) -> str:
    ruta = ruta or ""
    if metodo == "POST" and ruta.rstrip("/") == "/operarios":
        return "alta"
    if "/skills" in ruta:
        return "habilidades"
    if "/ausencias" in ruta:
        return "ausencias"
    if _RE_PERSONA_ID.match(ruta):
        return "baja" if metodo == "DELETE" else "ficha"
    return "otros"


# ─────────────────────────── quién era: alta, cambios de nombre y baja ───────────────────────────
#
# RF-17 (23/09, Julián en la reunión con Lucas): el historial de una persona tiene que
# contar el ALTA, cada CAMBIO DE NOMBRE y la BAJA. Una persona dada de baja ya no tiene
# fila en `operario`, así que cómo se llamaba sale del registro central: el cuerpo de su
# alta y de cada guardado (lo que se mandó), el `antes`/`despues` de los guardados desde
# el 23/09 y el `antes` de la baja (historial_cambios.dejar_dicho_baja).

# campo del cuerpo -> cómo lo nombra el antes/después (historial_cambios.ETIQUETAS_PERSONA).
CAMPOS_IDENTIDAD = {"nombre": "nombre", "apellido": "apellido", "categoria": "categoría",
                    "sector": "sector"}

_RE_ALTA_CON_NOMBRE = re.compile(r"(?:— |(?:^|\s)dio de alta a )(.+?)\s*$")


def _salio_bien(m: dict) -> bool:
    return m.get("estado") is None or m["estado"] < 400


def es_alta_de_persona(m: dict) -> bool:
    return m.get("metodo") == "POST" and (m.get("ruta") or "").rstrip("/") == "/operarios"


def es_ficha_de_persona(m: dict) -> bool:
    return m.get("metodo") == "PUT" and bool(_RE_PERSONA_ID.match(m.get("ruta") or ""))


def es_baja_de_persona(m: dict) -> bool:
    return m.get("metodo") == "DELETE" and bool(_RE_PERSONA_ID.match(m.get("ruta") or ""))


def dejo_dicho_quien_era(m: dict) -> bool:
    """Si la baja dejó dicho quién era (`antes`). DELETE /operarios/{id} sólo lo escribe
    si el borrado salió (OperarioAPI.eliminar_operario): es la prueba de que se borró a
    alguien. Un DELETE a un número que no está también contesta 200 («Operario no
    encontrado», status false) y el registro lo guarda igual, pero sin `antes`."""
    return isinstance(leer_detalle(m.get("detalle")).get("antes"), dict)


def prueba_que_existio(m: dict) -> bool:
    """Si este pedido prueba que la persona ESTABA cargada con ese número (revisión del
    23/09: un DELETE a un número inventado armaba una baja de alguien que nunca existió).

    Lo prueban: el alta que salió bien (quedó atada al número que se creó); la baja que
    dejó dicho quién era; el 409 de la baja (el sistema la encontró y pidió confirmar); y
    un guardado que dejó su antes/después. Un guardado de antes del 23/09 no lo dejaba:
    ése cuenta como rastro, porque es lo único que hay de esas fechas."""
    if es_baja_de_persona(m):
        if m.get("estado") == 409:
            return True
        return _salio_bien(m) and dejo_dicho_quien_era(m)
    if not _salio_bien(m):
        return False
    if es_alta_de_persona(m):
        return True
    if es_ficha_de_persona(m):
        det = leer_detalle(m.get("detalle"))
        if isinstance(det.get("antes"), dict) and isinstance(det.get("despues"), dict):
            return True
        cuando = m.get("creado_en")
        return isinstance(cuando, datetime) and cuando < GUARDADO_CON_ANTES_DESDE
    return False


def nombre_completo_de(identidad: dict) -> str | None:
    """«Nombre Apellido», o el nombre entero que dijo la frase del alta, o None."""
    partes = [identidad.get("nombre"), identidad.get("apellido")]
    if any(partes):
        return " ".join(p for p in partes if p).strip() or None
    return identidad.get("completo") or None


def identidad_de_movimiento(m: dict) -> dict:
    """Lo que un pedido que salió bien dice de quién es la persona: {nombre, apellido,
    categoria, sector} (sólo lo que dice). De la baja, su `antes`; del alta y de cada
    guardado, el cuerpo y, si se recortó, el `despues`. Un alta anterior al 23/09 sin
    cuerpo legible: el nombre entero de su frase («creó persona — Juan Perez»), en
    `completo`."""
    if not _salio_bien(m):
        return {}
    det = leer_detalle(m.get("detalle"))
    salida: dict = {}
    if es_baja_de_persona(m):
        antes = det.get("antes") if isinstance(det.get("antes"), dict) else {}
        for campo, etiqueta in CAMPOS_IDENTIDAD.items():
            if etiqueta in antes:
                salida[campo] = hc.texto_de(antes[etiqueta])
        return salida
    datos = det.get("datos") if isinstance(det.get("datos"), dict) else {}
    for campo in CAMPOS_IDENTIDAD:
        if campo in datos:
            salida[campo] = hc.texto_de(datos[campo])
    despues = det.get("despues") if isinstance(det.get("despues"), dict) else {}
    for campo, etiqueta in CAMPOS_IDENTIDAD.items():
        if campo not in salida and etiqueta in despues:
            salida[campo] = hc.texto_de(despues[etiqueta])
    if es_alta_de_persona(m) and not (salida.get("nombre") or salida.get("apellido")):
        coincide = _RE_ALTA_CON_NOMBRE.search(sin_autor(m.get("descripcion"), m.get("usuario")))
        if coincide:
            salida["completo"] = coincide.group(1)
    return salida


def _cambio_de_nombre(m: dict, conocido: dict, ahora: dict) -> tuple[str, str, bool] | None:
    """(cómo se llamaba, cómo quedó, deducido) si el guardado `m` le cambió el nombre o el
    apellido. `conocido` es lo que se sabía antes de este guardado y `ahora`, después.

    Desde el 23/09 lo dice el antes/después de la fila. Antes, se deduce comparando con
    lo último conocido (el alta o el guardado anterior), y se aclara."""
    det = leer_detalle(m.get("detalle"))
    antes, despues = det.get("antes"), det.get("despues")
    if isinstance(antes, dict) and isinstance(despues, dict):
        if not ({"nombre", "apellido"} & (set(antes) | set(despues))):
            return None
        n_despues = despues["nombre"] if "nombre" in despues else ahora.get("nombre")
        a_despues = despues["apellido"] if "apellido" in despues else ahora.get("apellido")
        n_antes = antes["nombre"] if "nombre" in antes else n_despues
        a_antes = antes["apellido"] if "apellido" in antes else a_despues
        era = nombre_completo_de({"nombre": n_antes, "apellido": a_antes})
        es = nombre_completo_de({"nombre": n_despues, "apellido": a_despues})
        return (era, es, False) if era and es and era != es else None
    era, es = nombre_completo_de(conocido), nombre_completo_de(ahora)
    return (era, es, True) if era and es and era != es else None


def historia_de_la_persona(movs: list[dict]) -> dict:
    """Recorre, en orden, el alta, los guardados y la baja de UNA persona.

    Devuelve:
      · identidad: lo último que se sabe de ella (nombre, apellido, categoria, sector);
      · nombre: su último nombre conocido («Nombre Apellido») o None;
      · nombres: todos los nombres que tuvo, en orden (así la nombra el historial de pasos);
      · al_momento: {id del pedido: cómo se llamaba después de ese pedido};
      · renombres: {id del guardado: (cómo se llamaba, cómo quedó, deducido)};
      · alta: el alta que salió bien, o None;
      · baja: el DELETE que la borró, o None. Es el primero que salió bien Y que lo
        prueba: dejó dicho quién era o, en filas de antes del 23/09 (que no lo dejaban),
        vino después de algo que prueba que estaba cargada (prueba_que_existio). Un
        DELETE a un número que no está contesta 200 igual: sin eso no es una baja;
      · existio: si algo del registro prueba que esa persona estuvo cargada."""
    identidad: dict = {}
    nombres: list[str] = []
    al_momento: dict = {}
    renombres: dict = {}
    alta = baja = None
    existio = False
    for m in sorted(movs, key=lambda x: (x["creado_en"] or datetime.min, x["id"])):
        prueba = prueba_que_existio(m)
        estaba = existio
        existio = existio or prueba
        if not _salio_bien(m):
            continue
        if not (es_alta_de_persona(m) or es_ficha_de_persona(m) or es_baja_de_persona(m)):
            continue
        if es_alta_de_persona(m) and alta is None:
            alta = m
        if es_baja_de_persona(m) and baja is None and (prueba or estaba):
            baja = m
        conocido = dict(identidad)
        nuevo = identidad_de_movimiento(m)
        identidad.update(nuevo)
        if "nombre" in nuevo or "apellido" in nuevo:
            identidad.pop("completo", None)
        if es_ficha_de_persona(m):
            cambio = _cambio_de_nombre(m, conocido, identidad)
            if cambio:
                renombres[m["id"]] = cambio
        nombre = nombre_completo_de(identidad)
        al_momento[m["id"]] = nombre
        if nombre and nombre not in nombres:
            nombres.append(nombre)
    return {"identidad": identidad, "nombre": nombre_completo_de(identidad), "nombres": nombres,
            "al_momento": al_momento, "renombres": renombres, "alta": alta, "baja": baja,
            "existio": existio}


def persona_dada_de_baja(id_operario: int, historia: dict) -> dict:
    """La persona que ya no está en `operario`, armada con lo que quedó en el registro:
    para la lista de Auditoría › «Por persona» y el encabezado de su línea de tiempo."""
    identidad, baja = historia["identidad"], historia["baja"]
    return {
        "id": id_operario,
        "nombre": historia["nombre"] or f"Persona #{id_operario}",
        "categoria": identidad.get("categoria"),
        "sector": identidad.get("sector"),
        "activo": False,
        "dada_de_baja": True,
        "baja": ({"cuando": baja["creado_en"].isoformat() if baja.get("creado_en") else None,
                  "quien": baja.get("usuario")} if baja else None),
    }


def fila_de_movimiento(m) -> dict:
    """La fila del ORM (o un dict) como dict plano."""
    if isinstance(m, dict):
        return m
    return {
        "id": m.id, "creado_en": m.creado_en, "usuario": m.usuario, "id_usuario": m.id_usuario,
        "accion": m.accion, "entidad": m.entidad, "id_entidad": m.id_entidad,
        "descripcion": m.descripcion, "metodo": m.metodo, "ruta": m.ruta, "estado": m.estado,
        "duracion_ms": m.duracion_ms, "detalle": m.detalle,
    }


def evento_de_movimiento(m: dict, tipo: str, *, titulo: str | None = None,
                         lineas=(), nota: str | None = None, deducido: bool = False,
                         igual: bool = False) -> dict:
    """Un renglón del registro central. `titulo` es la frase armada acá (si no, la del
    registro sin el autor); `igual` = un guardado que se sabe que no cambió los datos."""
    bien = m.get("estado") is None or m["estado"] < 400
    texto = titulo or sin_autor(m.get("descripcion"), m.get("usuario"))
    if not m.get("usuario") and not texto.startswith("alguien"):
        # Filas sin usuario (anteriores al 10/09 o del sistema): como las escribe el
        # registro, «alguien editó…».
        texto = f"alguien {texto}"
    return evento(
        id=f"mov-{m['id']}",
        cuando=m["creado_en"],
        tipo=tipo,
        titulo=texto,
        quien=m.get("usuario"),
        id_usuario=m.get("id_usuario"),
        lineas=lineas,
        salio_bien=bien,
        fuente="Registro",
        nota=nota,
        deducido=deducido,
        mov=m,
        ruta=m.get("ruta"),
        metodo=m.get("metodo"),
        duracion=m.get("duracion_ms") or 0,
        propio=titulo is not None,
        igual=igual,
    )


def lineas_y_nota_de_guardado(m: dict, deducidos: dict) -> tuple[list[str], str | None, bool, bool]:
    """(líneas, nota, deducido, igual) de un guardado de la cabecera (OT o ficha).
    `igual` = se sabe que los datos no cambiaron (no «no se sabe»)."""
    det = leer_detalle(m.get("detalle"))
    antes, despues = det.get("antes"), det.get("despues")
    if isinstance(antes, dict) and isinstance(despues, dict):
        lineas = lineas_de_cambios(antes, despues)
        return lineas, (None if lineas else "Los datos quedaron igual."), False, not lineas
    if m["id"] in deducidos:
        lineas, nota = deducidos[m["id"]]
        igual = not lineas and bool(nota) and nota.startswith("Los datos quedaron igual")
        return lineas, nota, bool(lineas), igual
    return [], None, False, False


def cuerpo_de(m: dict):
    det = leer_detalle(m.get("detalle"))
    datos = det.get("datos")
    return datos if isinstance(datos, dict) else None


# ─────────────────────────── los pasos (auditoria_proceso_ot) ───────────────────────────

CAMPOS_DE_ESTADO = frozenset({"estado", "arranque real", "fin real"})
# Cómo empiezan las frases de auditoria_proceso_ot (y la del alta de acá).
VERBOS_DE_PASOS = ("agregó ", "sacó ", "cambió ", "cargó ")


def _es_solo_estado(fila: dict) -> bool:
    if fila["accion"] != "edicion":
        return False
    try:
        cambios = json.loads(fila.get("cambios") or "[]")
    except ValueError:
        return False
    return bool(cambios) and all(c.get("campo") in CAMPOS_DE_ESTADO for c in cambios)


def grupos_de_pasos(filas: list[dict], *, numero_ot=None) -> list[dict]:
    """Un renglón por guardado: las filas de pasos del mismo pedido (mismo autor, mismo
    camino, segundos de diferencia) van juntas. Las pausas no: vienen de su tabla."""
    filas = [f for f in filas if f["accion"] in ("alta", "baja", "edicion")]
    filas.sort(key=lambda f: (f["creado_en"], f["id"]))
    grupos: list[list[dict]] = []
    for f in filas:
        if grupos:
            g = grupos[-1]
            primero = g[0]
            if ((f.get("usuario"), f.get("origen"), f.get("ruta"), f.get("metodo"))
                    == (primero.get("usuario"), primero.get("origen"), primero.get("ruta"),
                        primero.get("metodo"))
                    and f["creado_en"] - primero["creado_en"] <= timedelta(seconds=5)):
                g.append(f)
                continue
        grupos.append([f])

    eventos = []
    for g in grupos:
        primero = g[0]
        es_alta = primero.get("metodo") == "POST" and (primero.get("ruta") or "").rstrip("/") == "/ordenes"
        solo_estado = all(_es_solo_estado(f) for f in g)
        tipo = "alta" if es_alta else ("estado" if solo_estado else "pasos")
        frases = [f["descripcion"] for f in g]
        if es_alta:
            n = len([f for f in g if f["accion"] == "alta"])
            titulo = f"cargó la OT con {_plural(n, 'paso', 'pasos')}"
            lineas = frases
        elif len(g) == 1:
            titulo, lineas = frases[0], []
        elif solo_estado:
            titulo, lineas = f"cambió el estado de {_plural(len(g), 'paso', 'pasos')}", frases
        else:
            titulo, lineas = f"{_plural(len(g), 'cambio', 'cambios')} en los pasos", frases
        if not primero.get("usuario") and titulo.startswith(VERBOS_DE_PASOS):
            # Sin autor (lo hizo el sistema, o es de antes de que se guardara quién):
            # «se agregó el paso 2», no «Agregó el paso 2».
            titulo = f"se {titulo}"
        eventos.append(evento(
            id=f"pasos-{primero['id']}",
            cuando=primero["creado_en"],
            tipo=tipo,
            titulo=titulo,
            quien=primero.get("usuario"),
            id_usuario=primero.get("id_usuario"),
            lineas=_recortar_lineas(lineas),
            fuente="Pasos",
            nota=f"Desde: {primero['origen']}" if primero.get("origen") else None,
            ruta=primero.get("ruta"),
            metodo=primero.get("metodo"),
            frases=frases,
        ))
    return eventos


def _mismo_autor(a: dict, b: dict) -> bool:
    if a.get("id_usuario") is not None and b.get("id_usuario") is not None:
        return a["id_usuario"] == b["id_usuario"]
    return (a.get("quien") or None) == (b.get("quien") or None)


def juntar_pasos_con_pedidos(eventos_mov: list[dict], eventos_pasos: list[dict]) -> list[dict]:
    """El pedido que guardó pasos y las filas de esos pasos son UN hecho: van en un solo
    renglón, con la hora y el autor del pedido. Devuelve los grupos de pasos que no
    encontraron su pedido (se muestran solos)."""
    libres = []
    usados = set()
    for g in eventos_pasos:
        mejor, distancia = None, None
        for m in eventos_mov:
            if m["id"] in usados or not m["salio_bien"]:
                continue
            if (m.get("_ruta"), m.get("_metodo")) != (g.get("_ruta"), g.get("_metodo")):
                continue
            if not _mismo_autor(m, g):
                continue
            # La fila de pasos se escribe durante el pedido; la del registro, al final.
            margen = timedelta(milliseconds=m.get("_duracion") or 0) + VENTANA_MISMO_HECHO
            delta = m["_cuando"] - g["_cuando"]
            if timedelta(seconds=-2) <= delta <= margen:
                if distancia is None or abs(delta) < distancia:
                    mejor, distancia = m, abs(delta)
        if mejor is None:
            libres.append(g)
            continue
        usados.add(mejor["id"])
        frases_pasos = g["_frases"]
        if mejor["tipo"] in ("cabecera", "ficha") and not mejor.get("_igual"):
            # Cambió (o no se sabe si cambió) la cabecera, Y los pasos: las dos cosas en el
            # mismo renglón.
            mejor["lineas"] = _recortar_lineas(mejor["lineas"] + [f"Pasos — {f}" for f in frases_pasos])
        elif mejor.get("_propio") and mejor["tipo"] not in ("cabecera", "ficha"):
            # Una frase armada acá («marcó todos los pasos como Terminado, junto con 3 OT
            # más») dice más que la de los pasos: se queda, y los pasos van de detalle.
            mejor["tipo"] = g["tipo"]
            mejor["lineas"] = _recortar_lineas(frases_pasos)
        else:
            mejor["tipo"] = g["tipo"]
            mejor["titulo"] = g["titulo"]
            mejor["lineas"] = g["lineas"]
            mejor["nota"] = g["nota"]
            mejor["deducido"] = False
        mejor["fuente"] = "Registro y pasos"
    return libres


def absorber(hecho_quien_cuando: datetime, candidatos: list[dict], filtro) -> dict | None:
    """El renglón del registro que es el mismo hecho que uno de otra tabla: el que
    cumple `filtro`, salió bien y cae dentro de la ventana (después del hecho, o apenas
    antes). El más cercano. None si no hay."""
    mejor, distancia = None, None
    for m in candidatos:
        if not m["salio_bien"] or m.get("_absorbido") or not filtro(m):
            continue
        margen = timedelta(milliseconds=m.get("_duracion") or 0) + VENTANA_MISMO_HECHO
        delta = m["_cuando"] - hecho_quien_cuando
        if timedelta(seconds=-5) <= delta <= margen:
            if distancia is None or abs(delta) < distancia:
                mejor, distancia = m, abs(delta)
    if mejor is not None:
        mejor["_absorbido"] = True
    return mejor


# ─────────────────────────── las tablas del hecho -> renglones ───────────────────────────

def que_se_pauso(p, numero_ot=None) -> str:
    ot = f"la OT {numero_ot}" if numero_ot else "la OT"
    if p.get("id_otp") is None:
        return ot
    paso = f"el paso {p['paso']}" if p.get("paso") else "un paso"
    nombre = f" ({p['nombre_proceso']})" if p.get("nombre_proceso") else ""
    return f"{paso}{nombre}" + (f" de {ot}" if numero_ot else "")


def de(que: str) -> str:
    """«de» + lo que sigue, con la contracción: «del paso 3», «de la OT»."""
    return f"del {que[3:]}" if que.startswith("el ") else f"de {que}"


def texto_motivo_pausa(p: dict) -> str:
    from backend.domain.PausaOrden import MOTIVO_TEXTO
    if p.get("motivo") == "OTRO" and p.get("observacion"):
        return p["observacion"]
    return MOTIVO_TEXTO.get(p.get("motivo"), p.get("motivo") or "")


def eventos_de_pausas(pausas: list[dict], *, numero_de=None, ot_de=None) -> list[dict]:
    """Cada pausa: cuándo y quién la puso, y cuándo y cómo se cerró (a mano o sola al
    terminar el paso). `numero_de(id_ot)` pone el número de OT en la frase (en la
    línea de tiempo de una persona, donde hay muchas)."""
    salida = []
    for p in pausas:
        numero = numero_de(p["id_orden_trabajo"]) if numero_de else None
        que = que_se_pauso(p, numero)
        ot = ot_de(p["id_orden_trabajo"]) if ot_de else None
        lineas = [f"Motivo: {texto_motivo_pausa(p)}"]
        if p.get("observacion") and p.get("motivo") != "OTRO":
            lineas.append(f"Observación: {p['observacion']}")
        salida.append(evento(
            id=f"pausa-{p['id']}", cuando=p["desde"], tipo="pausas",
            titulo=segun_autor(p.get("usuario_pausa"), f"pausó {que}", f"se pausó {que}"),
            quien=p.get("usuario_pausa"), id_usuario=p.get("id_usuario_pausa"),
            lineas=lineas, fuente="Pausas", ot=ot,
            nota="Sigue pausada." if p.get("hasta") is None else None,
        ))
        if p.get("hasta") is not None:
            minutos = max(0, int((p["hasta"] - p["desde"]).total_seconds() // 60))
            cierre = p.get("cierre")
            if cierre == "PASO_TERMINADO":
                titulo = f"se cerró sola la pausa {de(que)} al terminar el paso"
            elif cierre == "PASO_EN_PROCESO":
                titulo = f"se cerró sola la pausa {de(que)} al poner el paso en proceso"
            elif cierre == "OT_TERMINADA":
                titulo = f"se cerró sola la pausa {de(que)} al terminar la OT"
            else:
                titulo = segun_autor(p.get("usuario_reanuda"), f"reanudó {que}", f"se reanudó {que}")
            salida.append(evento(
                id=f"reanuda-{p['id']}", cuando=p["hasta"], tipo="pausas", titulo=titulo,
                quien=p.get("usuario_reanuda"), id_usuario=p.get("id_usuario_reanuda"),
                lineas=[f"Estuvo en pausa {duracion_legible(minutos)}"], fuente="Pausas", ot=ot,
            ))
    return salida


def eventos_de_consumos(consumos: list[dict]) -> list[dict]:
    salida = []
    for c in consumos:
        que = " ".join(x for x in (cantidad_legible(c.get("cantidad")), c.get("unidad") or "") if x)
        material = c.get("pieza") or f"material #{c.get('id_pieza')}"
        salida.append(evento(
            id=f"consumo-{c['id']}", cuando=c["fecha"], tipo="consumos",
            titulo=segun_autor(c.get("usuario"), "registró", "se registró")
            + f" un consumo de {que} de {material}".replace("  ", " "),
            quien=c.get("usuario"), id_usuario=c.get("id_usuario"),
            lineas=[f"Observaciones: {c['observaciones']}"] if c.get("observaciones") else [],
            fuente="Consumos", nota="Después se anuló." if c.get("anulado") else None,
        ))
        if c.get("anulado") and c.get("anulado_en"):
            salida.append(evento(
                id=f"anulacion-{c['id']}", cuando=c["anulado_en"], tipo="consumos",
                titulo=segun_autor(c.get("anulado_por"), "anuló", "se anuló")
                + f" el consumo de {que} de {material}".replace("  ", " "),
                quien=c.get("anulado_por"),
                lineas=[f"Motivo: {c['motivo_anulacion']}"] if c.get("motivo_anulacion") else [],
                fuente="Consumos",
            ))
    return salida


def _nota_hora_nc(cuando: datetime | None) -> str | None:
    if cuando is not None and cuando < NC_EN_HORA_LOCAL_DESDE:
        return "Hasta el 22/09 la hora de las no conformidades se guardaba 3 h adelantada."
    return None


def eventos_de_incidencias(incidencias: list[dict], movs: list[dict], *, numero_de=None,
                           ot_de=None, en_la_persona=False) -> list[dict]:
    """El alta de cada no conformidad y su cierre. El cierre sin autor (la tabla no lo
    guarda) toma el del pedido que la cerró, si está en el registro."""
    salida = []
    for i in incidencias:
        numero = numero_de(i["id_orden_trabajo"]) if numero_de else None
        tipo_nc = TIPOS_NC.get(i.get("tipo"), i.get("tipo") or "sin tipo")
        grav = GRAVEDAD_NC.get(i.get("gravedad"))
        donde = f" de la OT {numero}" if numero else ""
        verbo = segun_autor(i.get("usuario"), "registró", "se registró")
        titulo = (f"{verbo} una no conformidad{donde} en la que figura: {tipo_nc}"
                  if en_la_persona else f"{verbo} la no conformidad #{i['id']}{donde}: {tipo_nc}")
        if grav:
            titulo += f" ({grav})"
        lineas = []
        if i.get("descripcion"):
            lineas.append(i["descripcion"])
        if i.get("proceso"):
            lineas.append(f"Proceso: {i['proceso']}")
        if i.get("operario") and not en_la_persona:
            lineas.append(f"Persona: {i['operario']}")
        if i.get("minutos_perdidos"):
            lineas.append(f"Tiempo perdido: {duracion_legible(i['minutos_perdidos'])}")
        if i.get("piezas_afectadas"):
            lineas.append(f"Piezas afectadas: {i['piezas_afectadas']}")
        ot = ot_de(i["id_orden_trabajo"]) if ot_de else None
        salida.append(evento(
            id=f"nc-{i['id']}", cuando=i["fecha_registro"], tipo="no_conformidades",
            titulo=titulo, quien=i.get("usuario"), id_usuario=i.get("id_usuario"),
            lineas=lineas, fuente="No conformidades", ot=ot,
            nota=_nota_hora_nc(i.get("fecha_registro")),
        ))
        if i.get("fecha_cierre"):
            pedido = absorber(
                i["fecha_cierre"], movs,
                lambda m, id_=str(i["id"]): (m.get("_mov") or {}).get("id_entidad") == id_
                and (m.get("_mov") or {}).get("entidad", "").startswith("incidencia"),
            )
            lineas_cierre = ([f"Acción correctiva: {i['accion_correctiva']}"]
                             if i.get("accion_correctiva") else [])
            if pedido is not None:
                pedido["tipo"] = "no_conformidades"
                pedido["titulo"] = (segun_autor(pedido.get("quien"), "cerró", "alguien cerró")
                                    + f" la no conformidad #{i['id']}{donde}")
                pedido["lineas"] = lineas_cierre
                pedido["ot"] = ot
            else:
                salida.append(evento(
                    id=f"nc-cierre-{i['id']}", cuando=i["fecha_cierre"], tipo="no_conformidades",
                    titulo=f"se cerró la no conformidad #{i['id']}{donde}", lineas=lineas_cierre,
                    fuente="No conformidades", ot=ot, nota=_nota_hora_nc(i.get("fecha_cierre")),
                ))
    return salida


def hora_de_subida_del_plano(p: dict) -> datetime | None:
    """`plano.fecha_subida` se estampa con utcnow (3 h adelantada) cuando lo sube la app;
    el importador de Drive la estampa en hora local. Se lleva a hora del taller para que
    quede en su lugar de la línea de tiempo. No se reescribe la fila (dato del cliente)."""
    cuando = p.get("fecha_subida")
    if cuando is None:
        return None
    return cuando if p.get("drive_file_id") else cuando - timedelta(hours=3)


def eventos_de_planos(planos: list[dict], movs: list[dict], id_orden: int) -> list[dict]:
    salida = []
    for p in planos:
        cuando = hora_de_subida_del_plano(p)
        del_articulo = p.get("id_orden_trabajo") != id_orden
        # El alta con su número (desde el 23/09): el autor y la hora de verdad.
        alta = next((m for m in movs if not m.get("_absorbido") and m["salio_bien"]
                     and (m.get("_mov") or {}).get("accion") == "creó"
                     and (m.get("_mov") or {}).get("entidad", "").startswith("plano")
                     and (m.get("_mov") or {}).get("id_entidad") == str(p["id"])), None)
        if alta is not None:
            alta["_absorbido"] = True
        titulo = (segun_autor(alta and alta["quien"], "subió", "se subió")
                  + f" el plano «{p.get('nombre') or 'sin nombre'}»" + (" del artículo" if del_articulo else ""))
        lineas = [p["descripcion"]] if p.get("descripcion") else []
        if del_articulo:
            lineas.append("Es del artículo: se ve en todas sus OT.")
        salida.append(evento(
            id=f"plano-{p['id']}", cuando=alta["_cuando"] if alta else cuando, tipo="planos",
            titulo=titulo, quien=alta["quien"] if alta else None,
            id_usuario=alta["id_usuario"] if alta else None,
            lineas=lineas, fuente="Planos",
        ))
    return salida


def eventos_del_plan(filas: list[dict], intentos: dict, *, nombre_de_operario=None,
                     numero_de=None, para_la_persona=False) -> list[dict]:
    """Un renglón por lote de plan confirmado que incluye a la OT (o que le dio pasos a
    la persona). Quién lo confirmó sale del intento de planificación de ese lote."""
    por_lote: dict = defaultdict(list)
    for f in filas:
        por_lote[str(f.get("id_planificacion_lote") or "sin-lote")].append(f)
    salida = []
    for lote, del_lote in por_lote.items():
        primero = min(del_lote, key=lambda f: (f.get("creado_en") or datetime.max))
        desc = primero.get("descripcion_lote") or "sin nombre"
        intento = intentos.get(lote) or {}
        n = len(del_lote)
        confirmo = intento.get("usuario")
        if para_la_persona:
            ots = {f["orden_id"] for f in del_lote}
            cuanto = f"{_plural(n, 'paso', 'pasos')} en {_plural(len(ots), 'OT', 'OT')}"
            titulo = segun_autor(confirmo, f"confirmó el plan «{desc}», que le dio {cuanto}",
                                 f"el plan «{desc}» le dio {cuanto}")
            lineas = [f"OT {numero_de(f['orden_id']) if numero_de else f['orden_id']}: "
                      f"{f.get('nombre_proceso') or 'paso'}" for f in sorted(del_lote, key=lambda f: (f['orden_id'], f.get('inicio_min') or 0))]
        else:
            titulo = segun_autor(confirmo, f"confirmó el plan «{desc}», con {_plural(n, 'paso', 'pasos')} de esta OT",
                                 f"la OT entró en el plan «{desc}» con {_plural(n, 'paso', 'pasos')}")
            lineas = []
            for f in sorted(del_lote, key=lambda f: f.get("inicio_min") or 0):
                quien_hace = (nombre_de_operario(f.get("id_operario")) if nombre_de_operario else None)
                lineas.append(f"{f.get('nombre_proceso') or 'paso'} — {quien_hace or 'sin persona'}")
        salida.append(evento(
            id=f"plan-{lote}", cuando=primero.get("creado_en"), tipo="plan", titulo=titulo,
            quien=intento.get("usuario"), id_usuario=intento.get("id_usuario"),
            lineas=_recortar_lineas(lineas), fuente="Plan",
        ))
    return salida


def eventos_de_borrados_del_plan(borrados: list[dict], id_orden: int, intentos: dict) -> list[dict]:
    """Cuándo y quién sacó la OT del plan (o borró un plan entero que la incluía)."""
    salida = []
    for b in borrados:
        ids = _ids_de_texto(b.get("orden_ids"))
        desc = b.get("descripcion_lote") or "sin nombre"
        if b.get("alcance") == "lote":
            intento = intentos.get(str(b.get("id_planificacion_lote"))) or {}
            if id_orden not in _ids_de_texto(intento.get("ordenes_ids")):
                continue
            titulo = segun_autor(b.get("usuario"), "borró", "se borró") + f" el plan «{desc}» entero (incluía esta OT)"
        elif id_orden in ids:
            titulo = segun_autor(b.get("usuario"), "sacó", "se sacó") + f" la OT del plan «{desc}»"
        else:
            continue
        salida.append(evento(
            id=f"plan-borrado-{b['id']}", cuando=b.get("borrado_en"), tipo="plan", titulo=titulo,
            quien=b.get("usuario"), id_usuario=b.get("id_usuario"), fuente="Plan",
        ))
    return salida


def _ids_de_texto(texto) -> set[int]:
    """«[1, 2]» o «1,2» -> {1, 2}."""
    return {int(x) for x in re.findall(r"\d+", str(texto or ""))}


def dias_de_ausencia(a: dict) -> str:
    desde, vuelve = a.get("desde"), a.get("vuelve")
    if vuelve is None:
        return f"desde el {fecha_legible(desde)}"
    ultimo = vuelve - timedelta(days=1)
    if ultimo < desde:
        return f"el {fecha_legible(desde)} (volvió ese mismo día)"
    if ultimo == desde:
        return f"el {fecha_legible(desde)}"
    return f"del {fecha_legible(desde)} al {fecha_legible(ultimo)}"


def eventos_de_ausencias(ausencias: list[dict], movs: list[dict], nombre: str = "la persona") -> list[dict]:
    """Cada ausencia: quién la cargó (o quién pasó a la persona a Ausente) y, si era por
    estado, quién la volvió a Activo. Si el pedido que la cargó está en el registro, van
    en un solo renglón. `nombre` va en la frase: «pasó a Juan Perez a Ausente»."""
    salida = []
    for a in ausencias:
        motivo = AUSENCIA_MOTIVO.get(a.get("motivo"))
        lineas = []
        if motivo:
            lineas.append(f"Motivo: {motivo}")
        if a.get("observacion"):
            lineas.append(f"Observación: {a['observacion']}")
        por_estado = a.get("origen") == "ESTADO"
        if por_estado:
            titulo = segun_autor(a.get("usuario_carga"), f"pasó a {nombre} a Ausente",
                                 f"{nombre} pasó a Ausente") + (f" ({motivo.lower()})" if motivo else "")
            filtro = lambda m: m["tipo"] in ("ficha", "habilidades") and any(
                l.startswith("estado:") for l in m["lineas"])
        else:
            titulo = (segun_autor(a.get("usuario_carga"), "cargó", "se cargó")
                      + f" una ausencia {dias_de_ausencia(a)}")
            filtro = lambda m: m["tipo"] == "ausencias" and (m.get("_metodo") == "POST")
        pedido = absorber(a["cargada_en"], movs, filtro)
        if pedido is not None:
            pedido["lineas"] = _recortar_lineas(pedido["lineas"] + [l for l in lineas if l not in pedido["lineas"]])
            if por_estado:
                pedido["lineas"].append(f"Quedó registrada la ausencia {dias_de_ausencia(a)}")
            pedido["fuente"] = "Registro y ausencias"
        else:
            salida.append(evento(
                id=f"ausencia-{a['id']}", cuando=a["cargada_en"], tipo="ausencias", titulo=titulo,
                quien=a.get("usuario_carga"), id_usuario=a.get("id_usuario_carga"),
                lineas=lineas + ([f"Días: {dias_de_ausencia(a)}"] if por_estado else []),
                fuente="Ausencias",
            ))
        if por_estado and a.get("cerrada_en"):
            pedido = absorber(a["cerrada_en"], movs, lambda m: m["tipo"] in ("ficha", "habilidades")
                              and any(l.startswith("estado:") for l in m["lineas"]))
            if pedido is not None:
                pedido["lineas"].append(f"Se cerró la ausencia: {dias_de_ausencia(a)}")
            else:
                salida.append(evento(
                    id=f"ausencia-fin-{a['id']}", cuando=a["cerrada_en"], tipo="ausencias",
                    titulo=segun_autor(a.get("usuario_cierre"), f"volvió a poner a {nombre} como Activo",
                                       f"{nombre} volvió a Activo"),
                    quien=a.get("usuario_cierre"),
                    id_usuario=a.get("id_usuario_cierre"),
                    lineas=[f"Faltó {dias_de_ausencia(a)}"], fuente="Ausencias",
                ))
    return salida


def eventos_de_trabajo(pasos: list[dict], *, ot_de, tiempos: dict | None = None) -> list[dict]:
    """Lo que trabajó la persona: cuándo arrancó y cuándo terminó cada paso que le toca
    (la misma atribución que su ficha, RF-06: la elegida a mano en la OT, o la que le dio
    el último plan). No hay autor: el avance lo marca el supervisor, no la persona.

    `tiempos` (sólo con la sección «Rendimiento por persona»): {id_otp: (estimado,
    efectivo)} para decir en el renglón del fin cuánto se estimó y cuánto llevó."""
    salida = []
    for p in pasos:
        numero = p.get("id_otvieja") or p["id_orden_trabajo"]
        que = f"el paso {p.get('paso') or '?'} — {p.get('proceso') or 'sin nombre'} de la OT {numero}"
        origen = "según la OT (elegida a mano)" if p.get("origen") == "ot" else "según el plan"
        ot = ot_de(p["id_orden_trabajo"])
        if p.get("inicio_real"):
            salida.append(evento(
                id=f"arranco-{p['id_otp']}", cuando=p["inicio_real"], tipo="trabajo",
                titulo=f"arrancó {que}", lineas=[f"Le toca {origen}"],
                fuente="Pasos de la OT", ot=ot,
                nota=("Sigue en proceso." if p.get("id_estado") == 2 else None),
            ))
        fin = p.get("fin_real")
        if p.get("id_estado") == 3 and isinstance(fin, datetime) and fin.year > 1950:
            lineas = []
            if tiempos and p["id_otp"] in tiempos:
                estimado, efectivo = tiempos[p["id_otp"]]
                if estimado:
                    lineas.append(f"Estimado: {duracion_legible(estimado)}")
                if efectivo is not None:
                    lineas.append(f"Efectivo: {duracion_legible(efectivo)}")
            salida.append(evento(
                id=f"termino-{p['id_otp']}", cuando=fin, tipo="trabajo", titulo=f"terminó {que}",
                lineas=lineas, fuente="Pasos de la OT", ot=ot,
            ))
    return salida


def _en_el_periodo(cuando, desde, hasta) -> bool:
    """`cuando` cae entre `desde` y `hasta` (una punta en None = abierta)."""
    if not isinstance(cuando, datetime):
        return True
    return (desde is None or cuando >= desde) and (hasta is None or cuando <= hasta)


def eventos_de_asignaciones(filas: list[dict], nombre_completo, *, numero_de, ot_de,
                            altas_sin_cambio: list[dict], id_operario: int | None = None,
                            desde: datetime | None = None, hasta: datetime | None = None,
                            homonimos: list[dict] = ()) -> list[dict]:
    """Cuándo y quién le eligió (o le sacó) un paso a mano a la persona, del historial de
    pasos.

    Desde el 23/09 cada cambio de «persona elegida» guarda también el NÚMERO de la
    persona (`id_antes` / `id_despues`, auditoria_procesos.CON_NUMERO), y con eso se
    reconoce a la persona sin mirar el nombre. Las filas anteriores sólo tienen el
    nombre: `nombre_completo` es como lo guarda ese historial («Nombre Apellido»), uno o
    todos los que tuvo si le cambiaron el nombre (el historial dice el de ese momento).

    Por el nombre, dos personas que se llaman igual se mezclaban (revisión del 23/09: la
    dada de baja mostraba lo de la que entró después, y al revés). Por eso:
      · nada antes de su alta (`desde`) ni después de su baja (`hasta`): no se le pudo
        elegir un paso a alguien que todavía no estaba o que ya no estaba;
      · si en ese momento otra persona se llamaba igual (`homonimos`: {id, nombres,
        desde, hasta}), el renglón va marcado como deducido: puede ser de cualquiera."""
    nombres = {nombre_completo} if isinstance(nombre_completo, str) else set(nombre_completo or ())
    nombres.discard("")
    nombres.discard(None)
    salida = []
    for f in filas:
        try:
            cambios = json.loads(f.get("cambios") or "[]")
        except ValueError:
            continue
        if not _en_el_periodo(f.get("creado_en"), desde, hasta):
            continue
        for c in cambios:
            if c.get("campo") != "persona elegida":
                continue
            con_numero = id_operario is not None and ("id_antes" in c or "id_despues" in c)
            if con_numero:
                asigno, saco = c.get("id_despues") == id_operario, c.get("id_antes") == id_operario
            else:
                asigno, saco = c.get("despues") in nombres, c.get("antes") in nombres
            numero = numero_de(f["id_orden_trabajo"])
            que = f"el paso {f.get('paso') or '?'} — {f.get('nombre_proceso') or 'sin nombre'} de la OT {numero}"
            if asigno:
                titulo = segun_autor(f.get("usuario"), "le asignó", "se le asignó") + f" {que}"
                lineas = [f"Antes lo tenía: {c['antes']}"] if c.get("antes") else []
            elif saco:
                titulo = segun_autor(f.get("usuario"), "le sacó", "se le sacó") + f" {que}"
                lineas = [f"Pasó a: {c.get('despues') or 'nadie (lo decide el plan)'}"]
            else:
                continue
            nota = f"Desde: {f['origen']}" if f.get("origen") else None
            deducido = False
            if not con_numero:
                nombre = c.get("despues") if asigno else c.get("antes")
                otros = [h for h in homonimos if nombre in h["nombres"]
                         and _en_el_periodo(f.get("creado_en"), h.get("desde"), h.get("hasta"))]
                if otros:
                    deducido = True
                    cuales = ", ".join(f"#{h['id']}" for h in otros)
                    quien = (f"la persona {cuales}. Puede ser de ella." if len(otros) == 1
                             else f"las personas {cuales}. Puede ser de alguna de ellas.")
                    nota = (f"Deducido por el nombre: hasta el 23/09 el historial de pasos guardaba "
                            f"el nombre y no el número, y en ese momento también se llamaba "
                            f"{nombre} {quien}" + (f" {nota}." if nota else ""))
            salida.append(evento(
                id=f"asig-{f['id']}", cuando=f["creado_en"], tipo="asignaciones", titulo=titulo,
                quien=f.get("usuario"), id_usuario=f.get("id_usuario"), lineas=lineas,
                fuente="Pasos", ot=ot_de(f["id_orden_trabajo"]), nota=nota, deducido=deducido,
            ))
    for f in altas_sin_cambio:
        if not _en_el_periodo(f.get("creado_en"), desde, hasta):
            continue
        numero = numero_de(f["id_orden_trabajo"])
        salida.append(evento(
            id=f"asig-alta-{f['id']}", cuando=f["creado_en"], tipo="asignaciones",
            titulo=(segun_autor(f.get("usuario"), "le asignó", "se le asignó")
                    + f" el paso {f.get('paso') or '?'} — {f.get('nombre_proceso') or 'sin nombre'} "
                    f"de la OT {numero} al cargarlo"),
            quien=f.get("usuario"), id_usuario=f.get("id_usuario"), fuente="Pasos",
            ot=ot_de(f["id_orden_trabajo"]),
            nota=f"Desde: {f['origen']}" if f.get("origen") else None,
        ))
    return salida


# ─────────────────────────── el final: ordenar, filtrar, contar ───────────────────────────

def cerrar(eventos: list[dict], desde: date | None, hasta: date | None,
           catalogo: dict[str, str], tope: int = TOPE_EVENTOS) -> dict:
    """Lo último primero, sólo lo del período, sin lo interno. Con el total y cuántos
    hay de cada tipo (para los botones de la pantalla)."""
    ini = datetime.combine(desde, time()) if desde else None
    fin = datetime.combine(hasta + timedelta(days=1), time()) if hasta else None

    def en_periodo(e):
        c = e["_cuando"]
        if c is None:
            return ini is None and fin is None
        return (ini is None or c >= ini) and (fin is None or c < fin)

    elegidos = [e for e in eventos if en_periodo(e)]
    elegidos.sort(key=lambda e: (e["_cuando"] or datetime.min, e["_n"]), reverse=True)
    total = len(elegidos)
    cuantos = defaultdict(int)
    for e in elegidos:
        cuantos[e["tipo"]] += 1
    recortado = total > tope
    salida = [{k: v for k, v in e.items() if not k.startswith("_")} for e in elegidos[:tope]]
    return {
        "eventos": salida,
        "total": total,
        "recortado": recortado,
        "tope": tope,
        "tipos": [{"tipo": t, "texto": texto, "cuantos": cuantos.get(t, 0)}
                  for t, texto in catalogo.items() if cuantos.get(t)],
    }


# ─────────────────────────── las consultas ───────────────────────────

async def _sin_romper(db, leer, por_defecto=None, avisos: list | None = None, que: str = ""):
    """Una lectura en un SAVEPOINT: si la tabla todavía no existe (una migración que no
    corrió), la línea de tiempo sale igual, sin eso, y lo dice."""
    try:
        async with db.begin_nested():
            return await leer()
    except Exception as e:
        logger.warning(f"Historial: no se pudo leer {que}: {e}")
        if avisos is not None and que:
            avisos.append(f"No se pudo leer {que}: la línea de tiempo sale sin eso.")
        return por_defecto


def patrones_del_numero(n: int) -> list[str]:
    """Los LIKE que encuentran el número `n` entero en el JSON del detalle, sin tomar un
    pedazo de otro («15» no es «1500»): después de un espacio o de «[», antes de «,», «]»
    o «}» (así escribe json.dumps). Ni «%» ni «_» pueden aparecer: `n` es un entero."""
    n = int(n)
    return [f"% {n},%", f"% {n}]%", f"% {n}}}%", f"%[{n},%", f"%[{n}]%"]


def _como_fecha(valor):
    """Las tablas que se leen con SQL a mano (planificacion_borrada, sin modelo) traen la
    fecha como datetime en Postgres pero como texto en SQLite: siempre datetime."""
    if isinstance(valor, str):
        try:
            return datetime.fromisoformat(valor)
        except ValueError:
            return None
    return valor


def _escapar_like(texto: str) -> str:
    return texto.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _de_la_entidad(M, prefijo: str):
    """`entidad` es esa cosa o una parte de ella («orden de trabajo › estado»), sin
    confundir «materia prima» con «materia prima de la OT»."""
    return or_(M.entidad == prefijo, M.entidad.like(f"{_escapar_like(prefijo)} ›%", escape="\\"))


class HistorialService:
    def __init__(self, db):
        self.db = db

    # ── los buscadores ──

    async def buscar_ordenes(self, buscar: str | None, limite: int = 30) -> list[dict]:
        """Las OT que coinciden con el número, el cliente o el artículo. Sin texto, las
        últimas cargadas."""
        from backend.domain.Articulo import Articulo
        from backend.domain.Cliente import Cliente
        from backend.domain.OrdenTrabajo import OrdenTrabajo as OT

        q = (select(OT.id, OT.id_otvieja, OT.fecha_prometida, OT.finalizadototal,
                    Cliente.nombre.label("cliente"), Articulo.descripcion.label("articulo"))
             .outerjoin(Cliente, Cliente.id == OT.id_cliente)
             .outerjoin(Articulo, Articulo.id == OT.id_articulo))
        termino = (buscar or "").strip()
        if termino:
            patron = f"%{_escapar_like(termino)}%"
            condiciones = [Cliente.nombre.ilike(patron, escape="\\"),
                           Articulo.descripcion.ilike(patron, escape="\\"),
                           Articulo.cod_articulo.ilike(patron, escape="\\")]
            if termino.isdigit():
                condiciones += [OT.id_otvieja == int(termino), OT.id == int(termino)]
            q = q.where(or_(*condiciones))
            # Primero el número exacto: quien tipea «15300» busca ésa.
            if termino.isdigit():
                exacto = func.coalesce(OT.id_otvieja, -1) == int(termino)
                q = q.order_by(exacto.desc(), OT.id.desc())
            else:
                q = q.order_by(OT.id.desc())
        else:
            q = q.order_by(OT.id.desc())
        filas = (await self.db.execute(q.limit(limite))).all()
        return [{
            "id": f.id,
            "numero": f.id_otvieja or f.id,
            "cliente": f.cliente,
            "articulo": f.articulo,
            "fecha_prometida": f.fecha_prometida.isoformat() if f.fecha_prometida else None,
            "terminada": bool(f.finalizadototal),
        } for f in filas]

    async def buscar_personas(self, buscar: str | None) -> list[dict]:
        """Las personas cargadas y, después, las dadas de baja (RF-17): ésas ya no están
        en `operario` y se arman con lo que quedó en el registro. La última baja, primero."""
        from backend.domain.Operario import Operario

        q = select(Operario.id, Operario.nombre, Operario.apellido, Operario.categoria,
                   Operario.sector, Operario.disponible)
        termino = (buscar or "").strip()
        if termino:
            patron = f"%{_escapar_like(termino)}%"
            q = q.where(or_(Operario.nombre.ilike(patron, escape="\\"),
                            Operario.apellido.ilike(patron, escape="\\")))
        filas = (await self.db.execute(q.order_by(Operario.apellido, Operario.nombre))).all()
        cargadas = [{
            "id": f.id,
            "nombre": " ".join(x for x in (f.nombre, f.apellido) if x).strip(),
            "categoria": f.categoria,
            "sector": f.sector,
            "activo": bool(f.disponible),
            "dada_de_baja": False,
            "baja": None,
        } for f in filas]
        # En un SAVEPOINT: sin el registro (una base sin la migración) la lista sale igual.
        bajas = list((await _sin_romper(self.db, self.dadas_de_baja, {}, None,
                                        "las personas dadas de baja") or {}).values())
        if termino:
            bajas = [p for p in bajas if termino.casefold() in p["nombre"].casefold()]
        bajas.sort(key=lambda p: ((p["baja"] or {}).get("cuando") or "", p["id"]), reverse=True)
        return cargadas + bajas

    async def _pedidos_de_la_ficha(self, ids) -> dict[int, list[dict]]:
        """{id: [su alta, sus guardados y su baja]} del registro central. Sólo la entidad
        `persona` (sin «persona › capacidades» ni «persona › ausencias»: no dicen cómo se
        llama)."""
        from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento as M
        claves = sorted({str(i) for i in ids})
        if not claves:
            return {}
        salida: dict[int, list[dict]] = defaultdict(list)
        for m in (await self.db.execute(
                select(M).where(M.entidad == "persona", M.id_entidad.in_(claves))
                .order_by(M.creado_en, M.id))).scalars().all():
            salida[int(m.id_entidad)].append(fila_de_movimiento(m))
        return salida

    async def dadas_de_baja(self, ids=None) -> dict[int, dict]:
        """{id: persona} de las que se borraron (un DELETE /operarios/{id} que salió bien y
        que prueba que había a quién borrar: ver historia_de_la_persona) y ya no están en
        `operario`, con su último nombre conocido y quién y cuándo la dio de baja. `ids`
        acota a esas."""
        from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento as M
        from backend.domain.Operario import Operario

        q = select(M.id_entidad, M.ruta).where(
            M.entidad == "persona", M.metodo == "DELETE", M.id_entidad.isnot(None),
            or_(M.estado.is_(None), M.estado < 400))
        if ids is not None:
            q = q.where(M.id_entidad.in_(sorted({str(i) for i in ids})))
        candidatos = {int(f.id_entidad) for f in (await self.db.execute(q)).all()
                      if str(f.id_entidad).isdigit() and _RE_PERSONA_ID.match(f.ruta or "")}
        if not candidatos:
            return {}
        siguen = set(await self._ids(Operario.id, Operario.id.in_(sorted(candidatos))))
        idas = candidatos - siguen
        pedidos = await self._pedidos_de_la_ficha(idas)
        salida = {}
        for i in idas:
            historia = historia_de_la_persona(pedidos.get(i, []))
            # Un DELETE a un número que nunca estuvo cargado contesta 200 igual: sin algo
            # que pruebe que se borró a alguien, no es una baja (revisión del 23/09).
            if historia["baja"] is not None:
                salida[i] = persona_dada_de_baja(i, historia)
        return salida

    async def _alta_por_nombre(self, id_operario: int, nombre_actual: str | None,
                               historia: dict) -> list[dict]:
        """El alta anterior al 23/09 no guardaba el número de la persona: se la reconoce
        por el nombre (alguno de los que tuvo, el más viejo primero), y sólo si nadie más
        se llama igual —ni entre las cargadas ni entre las dadas de baja—."""
        from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento as M
        from backend.domain.Operario import Operario

        candidatos = list(dict.fromkeys(n for n in historia["nombres"] + [nombre_actual] if n))
        if not candidatos:
            return []
        de_otros: dict[str, int] = defaultdict(int)
        for f in (await self.db.execute(select(Operario.id, Operario.nombre, Operario.apellido))).all():
            if f.id != id_operario:
                de_otros[nombre_completo_de({"nombre": f.nombre, "apellido": f.apellido}) or ""] += 1
        bajas = await _sin_romper(self.db, self.dadas_de_baja, {}, None, "las personas dadas de baja")
        for i, p in (bajas or {}).items():
            if i != id_operario:
                de_otros[p["nombre"]] += 1
        for nombre in candidatos:
            if de_otros.get(nombre):
                continue
            filas = [fila_de_movimiento(m) for m in (await self.db.execute(
                select(M).where(M.entidad == "persona", M.accion == "creó", M.id_entidad.is_(None),
                                M.descripcion.like(f"%— {_escapar_like(nombre[:60])}", escape="\\"))
                .order_by(M.creado_en, M.id).limit(1))).scalars().all()]
            if filas:
                return filas
        return []

    async def _homonimos(self, id_operario: int, nombres: list[str]) -> list[dict]:
        """Las OTRAS personas —cargadas o dadas de baja— que alguna vez se llamaron como
        ella (alguno de `nombres`), con desde y hasta cuándo estuvieron: [{id, nombres,
        desde, hasta}] (una punta en None = no se sabe, o sigue cargada).

        El historial de pasos anterior al 23/09 guarda el nombre y no el número: un
        renglón con ese nombre, de un momento en que las dos estaban, puede ser de
        cualquiera, y eventos_de_asignaciones lo marca como deducido. Se las busca por el
        nombre de hoy (`operario`) y por el registro, donde el alta y cada guardado dicen
        el nombre en la frase («dio de alta a Juan Perez», «editó a Juan Perez: …»,
        «editó persona #9 — Juan Perez»)."""
        from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento as M
        from backend.domain.Operario import Operario

        buscados = {n for n in nombres if n}
        if not buscados:
            return []
        hoy: dict[int, str | None] = {}
        candidatos: set[int] = set()
        for f in (await self.db.execute(select(Operario.id, Operario.nombre, Operario.apellido))).all():
            if f.id == id_operario:
                continue
            hoy[f.id] = nombre_completo_de({"nombre": f.nombre, "apellido": f.apellido})
            if hoy[f.id] in buscados:
                candidatos.add(f.id)
        for (id_entidad,) in (await self.db.execute(
                select(M.id_entidad).where(
                    M.entidad == "persona", M.id_entidad.isnot(None), M.id_entidad != str(id_operario),
                    or_(*[M.descripcion.like(f"%{_escapar_like(n)}%", escape="\\") for n in buscados]))
                .distinct())).all():
            if str(id_entidad).isdigit():
                candidatos.add(int(id_entidad))
        if not candidatos:
            return []
        pedidos = await self._pedidos_de_la_ficha(candidatos)
        salida = []
        for i in sorted(candidatos):
            historia = historia_de_la_persona(pedidos.get(i, []))
            sigue = i in hoy
            if not sigue and not historia["existio"]:
                continue  # un número que nunca estuvo cargado
            suyos = set(historia["nombres"]) | ({hoy[i]} if sigue and hoy[i] else set())
            comunes = suyos & buscados
            if not comunes:
                continue
            salida.append({
                "id": i,
                "nombres": comunes,
                "desde": historia["alta"]["creado_en"] if historia["alta"] else None,
                "hasta": None if sigue else (historia["baja"]["creado_en"] if historia["baja"] else None),
            })
        return salida

    # ── lo común ──

    async def desde_cuando(self) -> dict:
        """Desde cuándo hay registro: lo anterior no está, y la pantalla lo dice."""
        from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento as M
        from backend.domain.AuditoriaProcesoOT import AuditoriaProcesoOT as P

        async def leer():
            reg = (await self.db.execute(select(func.min(M.creado_en)))).scalar()
            pasos = (await self.db.execute(select(func.min(P.creado_en)))).scalar()
            return {"registro": reg.isoformat() if reg else None,
                    "pasos": pasos.isoformat() if pasos else None}
        return await _sin_romper(self.db, leer, {"registro": None, "pasos": None})

    async def _intentos_por_lote(self, avisos) -> dict:
        async def leer():
            filas = (await self.db.execute(text(
                "SELECT id_planificacion_lote, usuario, id_usuario, ordenes_ids "
                "FROM planificacion_intento WHERE id_planificacion_lote IS NOT NULL "
                "ORDER BY creado_en"))).all()
            return {str(f.id_planificacion_lote): {"usuario": f.usuario, "id_usuario": f.id_usuario,
                                                   "ordenes_ids": f.ordenes_ids} for f in filas}
        return await _sin_romper(self.db, leer, {}, avisos, "quién confirmó cada plan")

    async def _nombres_de(self, modelo, columna, ids) -> dict:
        ids = sorted({i for i in ids if i is not None})
        if not ids:
            return {}
        filas = (await self.db.execute(select(modelo.id, columna).where(modelo.id.in_(ids)))).all()
        return {f[0]: f[1] for f in filas}

    async def _nombres_de_personas(self, ids) -> dict:
        """{id: «Nombre Apellido»}. El nombre se arma acá y no con CONCAT: la función no
        es igual en todas las bases."""
        from backend.domain.Operario import Operario
        ids = sorted({i for i in ids if i is not None})
        if not ids:
            return {}
        filas = (await self.db.execute(select(Operario.id, Operario.nombre, Operario.apellido)
                                       .where(Operario.id.in_(ids)))).all()
        return {f.id: " ".join(x for x in (f.nombre, f.apellido) if x).strip() for f in filas}

    async def _numeros_de_ot(self, ids) -> dict:
        from backend.domain.OrdenTrabajo import OrdenTrabajo as OT
        return {k: (v or k) for k, v in (await self._nombres_de(OT, OT.id_otvieja, ids)).items()}

    # ── la línea de tiempo de una OT ──

    async def de_orden(self, id_orden: int, desde: date | None = None, hasta: date | None = None,
                       *, ve_pasos: bool = True, ve_plan: bool = True) -> dict | None:
        from backend.domain.Articulo import Articulo
        from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento as M
        from backend.domain.AuditoriaProcesoOT import AuditoriaProcesoOT as P
        from backend.domain.Cliente import Cliente
        from backend.domain.ConsumoMaterial import ConsumoMaterial
        from backend.domain.IncidenciaProceso import IncidenciaProceso
        from backend.domain.Operario import Operario
        from backend.domain.OrdenTrabajo import OrdenTrabajo as OT
        from backend.domain.OrdenTrabajoPieza import OrdenTrabajoPieza
        from backend.domain.PausaOrden import PausaOrden
        from backend.domain.Pieza import Pieza
        from backend.domain.Planificacion import Planificacion
        from backend.domain.Plano import Plano
        from backend.domain.Proceso import Proceso

        db = self.db
        fila = (await db.execute(
            select(OT.id, OT.id_otvieja, OT.id_articulo, OT.unidades, OT.cantidad_entregada,
                   OT.fecha_orden, OT.fecha_entrada, OT.fecha_prometida, OT.fecha_entrega,
                   OT.finalizadototal, Cliente.nombre.label("cliente"),
                   Articulo.descripcion.label("articulo"))
            .outerjoin(Cliente, Cliente.id == OT.id_cliente)
            .outerjoin(Articulo, Articulo.id == OT.id_articulo)
            .where(OT.id == id_orden)
        )).first()
        if fila is None:
            return None
        numero = fila.id_otvieja or fila.id
        avisos: list[str] = []
        ocultos: list[dict] = []

        # 1. Lo que cuelga de la OT y tiene número propio (para buscarlo en el registro).
        consumos = await _sin_romper(db, lambda: self._consumos(ConsumoMaterial, Pieza, id_orden),
                                     [], avisos, "los consumos")
        incidencias = await _sin_romper(db, lambda: self._incidencias_de(
            IncidenciaProceso, Proceso, Operario, IncidenciaProceso.id_orden_trabajo == id_orden),
            [], avisos, "las no conformidades")
        planos = await _sin_romper(db, lambda: self._planos(Plano, id_orden, fila.id_articulo),
                                   [], avisos, "los planos")
        materia = await _sin_romper(db, lambda: self._ids(
            OrdenTrabajoPieza.id, OrdenTrabajoPieza.id_orden_trabajo == id_orden), [], avisos,
            "la materia prima")
        filas_plan = []
        if ve_plan:
            filas_plan = await _sin_romper(db, lambda: self._filas_del_plan(
                Planificacion, Planificacion.orden_id == id_orden), [], avisos, "el plan")

        # 2. El registro central: lo de la OT y lo de todo eso, por entidad y número.
        condiciones = [and_(M.id_entidad == str(id_orden), _de_la_entidad(M, "orden de trabajo"))]
        for prefijo, ids in (("consumo de material", [c["id"] for c in consumos]),
                             ("incidencia", [i["id"] for i in incidencias]),
                             ("plano", [p["id"] for p in planos]),
                             ("materia prima de la OT", materia),
                             ("planificación", [f["id"] for f in filas_plan])):
            if ids:
                condiciones.append(and_(M.id_entidad.in_([str(i) for i in ids]),
                                        _de_la_entidad(M, prefijo)))
        movs = [fila_de_movimiento(m) for m in (await db.execute(
            select(M).where(or_(*condiciones)).order_by(M.creado_en, M.id))).scalars().all()]

        # Los que no tienen el número en la dirección sino en el cuerpo. El detalle es el
        # JSON de json.dumps («"id_orden_trabajo": 1500,» / «"orden_ids": [3, 1500]»): el
        # número va siempre después de un espacio o de «[» y antes de «,», «]» o «}». Así
        # la OT 15 no trae las filas de la 1500 (con «%15%» traía casi todo el registro y
        # lo tiraba en Python). Lo que igual coincida por casualidad se descarta abajo,
        # leyendo el cuerpo.
        por_cuerpo = [fila_de_movimiento(m) for m in (await db.execute(
            select(M).where(M.id_entidad.is_(None), M.ruta.in_(RUTAS_CON_OT_EN_EL_CUERPO),
                            or_(*[M.detalle.like(p) for p in patrones_del_numero(id_orden)]))
            .order_by(M.creado_en, M.id)
        )).scalars().all()]
        eventos: list[dict] = []
        piezas_por_id = await self._nombres_de(Pieza, Pieza.descripcion, [
            (cuerpo_de(m) or {}).get("id_pieza") for m in por_cuerpo
            if m["ruta"].startswith("/ordenes-trabajo-piezas")])
        for m in por_cuerpo:
            cuerpo = cuerpo_de(m) or {}
            bien = m.get("estado") is None or m["estado"] < 400
            if m["ruta"].startswith("/ordenes/estado-masivo"):
                ids = cuerpo.get("orden_ids") if isinstance(cuerpo.get("orden_ids"), list) else []
                if id_orden not in ids:
                    continue
                otras = len(ids) - 1
                estado = ESTADO_PASO.get(cuerpo.get("id_estado"), "otro estado")
                titulo = f"marcó todos los pasos como {estado}" + (
                    f" (junto con {_plural(otras, 'OT más', 'OT más')})" if otras > 0 else "")
                if not bien:
                    titulo += f" (no se pudo: error {m['estado']})"
                eventos.append(evento_de_movimiento(m, "estado", titulo=titulo))
                continue
            if cuerpo.get("id_orden_trabajo") != id_orden:
                continue
            if m["ruta"].startswith("/ordenes-trabajo-piezas"):
                material = piezas_por_id.get(cuerpo.get("id_pieza")) or f"material #{cuerpo.get('id_pieza')}"
                cant = " ".join(x for x in (cantidad_legible(cuerpo.get("cantidad")), cuerpo.get("unidad") or "") if x)
                titulo = f"agregó a la lista de materia prima: {material}" + (f" ({cant})" if cant else "")
                if not bien:
                    titulo += f" (no se pudo: error {m['estado']})"
                eventos.append(evento_de_movimiento(m, "materia_prima", titulo=titulo))
            elif not bien:
                # Los consumos y las no conformidades que SÍ se guardaron salen de su tabla;
                # del registro quedan los intentos que no se pudieron.
                eventos.append(evento_de_movimiento(m, tipo_de_ruta_ot(m["metodo"], m["ruta"])))

        # 3. El registro central -> renglones. Los guardados de la cabecera dicen qué
        #    cambió (desde el 23/09) o se deduce comparando con el anterior.
        guardados = [m for m in movs if m["metodo"] == "PUT" and _RE_OT_ID.match(m["ruta"] or "")]
        deducidos = await self._deducir_ot(guardados)
        ids_consumo = {str(c["id"]) for c in consumos}
        for m in movs:
            tipo = tipo_de_ruta_ot(m["metodo"], m["ruta"])
            bien = m.get("estado") is None or m["estado"] < 400
            # Mismo hecho que su tabla: va una vez, la de la tabla (ver arriba).
            if bien and m["accion"] in ("pausó", "reanudó"):
                continue
            if bien and tipo == "consumos" and m.get("id_entidad") in ids_consumo:
                continue
            if tipo == "cabecera":
                lineas, nota, deducido, igual = lineas_y_nota_de_guardado(m, deducidos)
                titulo = None
                if bien:
                    titulo = f"editó los datos de la OT {numero}" if lineas else f"guardó la OT {numero}"
                    # RF-11: marcar (o desmarcar) Controlada es EL hecho del guardado; lo
                    # demás que cambió sigue en las líneas de abajo. Estamos adentro de
                    # la línea de tiempo de ESTA OT: sin el número, «marcó la OT como
                    # Controlada».
                    det = leer_detalle(m.get("detalle"))
                    control = hc.cambio_de_control(det.get("antes"), det.get("despues"))
                    if control:
                        titulo = hc.frase_de_control(control)
                eventos.append(evento_de_movimiento(m, tipo, titulo=titulo, lineas=lineas,
                                                    nota=nota, deducido=deducido, igual=igual))
            elif tipo == "entregas":
                cant = (cuerpo_de(m) or {}).get("cantidad_agregar")
                titulo = None
                if bien and isinstance(cant, (int, float)) and cant:
                    n = cantidad_legible(abs(cant))
                    titulo = (f"registró una entrega de {n} {'unidad' if abs(cant) == 1 else 'unidades'}"
                              if cant > 0 else f"corrigió la entrega: restó {n} unidades")
                eventos.append(evento_de_movimiento(m, tipo, titulo=titulo))
            elif tipo == "alta":
                eventos.append(evento_de_movimiento(m, "alta"))
            elif tipo == "otros" and m["metodo"] == "DELETE" and _RE_OT_ID.match(m["ruta"] or ""):
                eventos.append(evento_de_movimiento(m, "otros", titulo=(
                    f"eliminó la OT {numero}" if bien else None)))
            elif tipo == "plan" and m["metodo"] == "PUT":
                eventos.append(evento_de_movimiento(m, "plan", titulo=(
                    "movió un paso del plan" if bien else None)))
            else:
                eventos.append(evento_de_movimiento(m, tipo))

        # 4. Las tablas del hecho.
        pausas = await _sin_romper(db, lambda: self._pausas(PausaOrden, PausaOrden.id_orden_trabajo == id_orden),
                                   [], avisos, "las pausas")
        eventos += eventos_de_pausas(pausas)
        eventos += eventos_de_consumos(consumos)
        eventos += eventos_de_incidencias(incidencias, eventos)
        eventos += eventos_de_planos(planos, eventos, id_orden)
        # Las altas de planos que se absorbieron ya no se muestran solas.
        eventos = [e for e in eventos if not (e.get("_absorbido") and e["tipo"] == "planos"
                                             and (e.get("_mov") or {}).get("accion") == "creó")]

        if ve_pasos:
            filas_pasos = await _sin_romper(db, lambda: self._filas_de_pasos(P, P.id_orden_trabajo == id_orden),
                                            [], avisos, "el historial de los pasos")
            grupos = grupos_de_pasos(filas_pasos)
            eventos += juntar_pasos_con_pedidos([e for e in eventos if e["id"].startswith("mov-")], grupos)
        else:
            ocultos.append({"que": "pasos", "texto": "Los cambios de los pasos (agregar, sacar, "
                            "cambiar el estado o la persona) no se muestran: son de la sección "
                            "«Pasos de las OT» de Auditoría, que no tenés."})

        if ve_plan:
            intentos = await self._intentos_por_lote(avisos)
            nombres_op = await self._nombres_de_personas([f.get("id_operario") for f in filas_plan])
            eventos += eventos_del_plan(filas_plan, intentos, nombre_de_operario=nombres_op.get)
            borrados = await self._borrados_del_plan(id_orden, avisos)
            eventos += eventos_de_borrados_del_plan(borrados, id_orden, intentos)
        else:
            ocultos.append({"que": "plan", "texto": "Los planes que incluyeron a la OT no se "
                            "muestran: son de la sección «Planificaciones» de Auditoría, que no tenés."})
            eventos = [e for e in eventos if e["tipo"] != "plan"]

        # 5. Si no hay registro del alta, lo que dice la propia OT (sin autor).
        if not any(e["tipo"] == "alta" for e in eventos) and fila.fecha_orden:
            eventos.append(evento(
                id="ot-fecha-orden", cuando=fila.fecha_orden, tipo="alta",
                titulo=f"la OT {numero} tiene fecha de orden {fila.fecha_orden.strftime('%d/%m/%Y')}",
                lineas=["No hay registro de quién la cargó: es anterior al registro (15/09), "
                        "vino del sistema viejo o se cargó sin pasos."],
                fuente="Datos de la OT",
            ))

        cerrado = cerrar(eventos, desde, hasta, TIPOS_OT)
        return {
            "orden": {
                "id": fila.id,
                "numero": numero,
                "cliente": fila.cliente,
                "articulo": fila.articulo,
                "unidades": fila.unidades,
                "cantidad_entregada": fila.cantidad_entregada,
                "fecha_orden": fila.fecha_orden.isoformat() if fila.fecha_orden else None,
                "fecha_prometida": fila.fecha_prometida.isoformat() if fila.fecha_prometida else None,
                "fecha_entrega": fila.fecha_entrega.isoformat() if fila.fecha_entrega else None,
                "terminada": bool(fila.finalizadototal),
            },
            "desde": desde.isoformat() if desde else None,
            "hasta": hasta.isoformat() if hasta else None,
            **cerrado,
            "ocultos": ocultos,
            "avisos": avisos,
            "desde_cuando": await self.desde_cuando(),
        }

    async def _consumos(self, ConsumoMaterial, Pieza, id_orden):
        filas = (await self.db.execute(
            select(ConsumoMaterial.id, ConsumoMaterial.id_pieza, ConsumoMaterial.cantidad,
                   ConsumoMaterial.unidad, ConsumoMaterial.fecha, ConsumoMaterial.id_usuario,
                   ConsumoMaterial.usuario, ConsumoMaterial.observaciones, ConsumoMaterial.anulado,
                   ConsumoMaterial.anulado_en, ConsumoMaterial.anulado_por,
                   ConsumoMaterial.motivo_anulacion, Pieza.descripcion.label("pieza"))
            .outerjoin(Pieza, Pieza.id == ConsumoMaterial.id_pieza)
            .where(ConsumoMaterial.id_orden_trabajo == id_orden)
        )).all()
        return [dict(f._mapping) for f in filas]

    async def _incidencias_de(self, IncidenciaProceso, Proceso, Operario, condicion):
        I = IncidenciaProceso
        filas = (await self.db.execute(
            select(I.id, I.id_orden_trabajo, I.tipo, I.gravedad, I.descripcion, I.minutos_perdidos,
                   I.piezas_afectadas, I.accion_correctiva, I.id_usuario, I.usuario,
                   I.fecha_registro, I.fecha_cierre, Proceso.nombre.label("proceso"),
                   Operario.nombre.label("op_nombre"), Operario.apellido.label("op_apellido"))
            .outerjoin(Proceso, Proceso.id == I.id_proceso)
            .outerjoin(Operario, Operario.id == I.id_operario)
            .where(condicion)
        )).all()
        salida = []
        for f in filas:
            d = dict(f._mapping)
            d["operario"] = " ".join(x for x in (d.pop("op_nombre"), d.pop("op_apellido")) if x).strip() or None
            salida.append(d)
        return salida

    async def _planos(self, Plano, id_orden, id_articulo):
        condicion = Plano.id_orden_trabajo == id_orden
        if id_articulo is not None:
            condicion = or_(condicion, Plano.id_articulo == id_articulo)
        # Nunca el archivo (`archivo` es el binario): sólo lo que se muestra.
        filas = (await self.db.execute(
            select(Plano.id, Plano.nombre, Plano.descripcion, Plano.fecha_subida,
                   Plano.id_orden_trabajo, Plano.id_articulo, Plano.drive_file_id).where(condicion)
        )).all()
        return [dict(f._mapping) for f in filas]

    async def _ids(self, columna, condicion):
        return list((await self.db.execute(select(columna).where(condicion))).scalars().all())

    async def _filas_del_plan(self, Planificacion, condicion):
        Pl = Planificacion
        filas = (await self.db.execute(
            select(Pl.id, Pl.orden_id, Pl.id_operario, Pl.nombre_proceso, Pl.inicio_min,
                   Pl.id_planificacion_lote, Pl.descripcion_lote, Pl.creado_en).where(condicion)
        )).all()
        return [dict(f._mapping) for f in filas]

    async def _pausas(self, PausaOrden, condicion):
        Pa = PausaOrden
        filas = (await self.db.execute(
            select(Pa.id, Pa.id_orden_trabajo, Pa.id_otp, Pa.paso, Pa.nombre_proceso, Pa.motivo,
                   Pa.observacion, Pa.desde, Pa.hasta, Pa.cierre, Pa.id_usuario_pausa,
                   Pa.usuario_pausa, Pa.id_usuario_reanuda, Pa.usuario_reanuda).where(condicion)
        )).all()
        return [dict(f._mapping) for f in filas]

    async def _filas_de_pasos(self, P, condicion):
        filas = (await self.db.execute(
            select(P.id, P.creado_en, P.id_usuario, P.usuario, P.origen, P.id_orden_trabajo,
                   P.id_otp, P.id_proceso, P.nombre_proceso, P.accion, P.paso, P.cambios,
                   P.descripcion, P.metodo, P.ruta).where(condicion).order_by(P.creado_en, P.id)
        )).all()
        return [dict(f._mapping) for f in filas]

    async def _borrados_del_plan(self, id_orden, avisos):
        async def leer():
            filas = (await self.db.execute(text(
                "SELECT id, id_planificacion_lote, descripcion_lote, alcance, orden_ids, "
                "borrado_en, id_usuario, usuario FROM planificacion_borrada "
                "WHERE alcance = 'lote' OR orden_ids LIKE :patron"
            ), {"patron": f"%{id_orden}%"})).all()
            salida = []
            for f in filas:
                d = dict(f._mapping)
                d["borrado_en"] = _como_fecha(d.get("borrado_en"))
                salida.append(d)
            return salida
        return await _sin_romper(self.db, leer, [], avisos, "los planes borrados")

    async def _deducir_ot(self, guardados: list[dict]) -> dict:
        """Qué cambió en los guardados de la cabecera anteriores al 23/09."""
        filas, ids = [], defaultdict(set)
        for m in guardados:
            det = leer_detalle(m.get("detalle"))
            cuerpo = det.get("datos") if isinstance(det.get("datos"), dict) else None
            filas.append({"id": m["id"], "salio_bien": m.get("estado") is None or m["estado"] < 400,
                          "cuerpo": cuerpo, "antes": det.get("antes"), "despues": det.get("despues")})
            for campo in hc.CATALOGOS_OT:
                if cuerpo and cuerpo.get(campo) not in (None, ""):
                    try:
                        ids[campo].add(int(cuerpo[campo]))
                    except (TypeError, ValueError):
                        pass
        if not any(f["antes"] is None for f in filas):
            return {}
        nombres = await self._nombres_de_catalogos_ot(ids)

        def normalizar(cuerpo):
            return {c: _normalizar_ot(c, cuerpo[c]) for c in hc.ETIQUETAS_OT if c in cuerpo}

        return deducir_cambios(filas, normalizar=normalizar,
                               legible=lambda c, v: _legible_ot(c, v, nombres),
                               etiquetas=hc.ETIQUETAS_OT)

    async def _nombres_de_catalogos_ot(self, ids: dict) -> dict:
        from backend.domain.Articulo import Articulo
        from backend.domain.Cliente import Cliente
        from backend.domain.Prioridad import Prioridad
        from backend.domain.Sector import Sector

        nombres = {}
        for campo, modelo, columna in (("id_cliente", Cliente, Cliente.nombre),
                                       ("id_prioridad", Prioridad, Prioridad.descripcion),
                                       ("id_sector", Sector, Sector.nombre),
                                       ("id_articulo", Articulo, Articulo.descripcion)):
            for k, v in (await self._nombres_de(modelo, columna, ids.get(campo, ()))).items():
                nombres[(campo, k)] = v
        return nombres

    # ── la línea de tiempo de una persona ──

    async def de_persona(self, id_operario: int, desde: date | None = None, hasta: date | None = None,
                         *, ve_pasos: bool = True, ve_plan: bool = True,
                         ve_rendimiento: bool = False, ve_ausencias: bool = True) -> dict | None:
        from backend.application.TiemposOperarioService import TiemposOperarioService
        from backend.domain.AuditoriaMovimiento import AuditoriaMovimiento as M
        from backend.domain.AuditoriaProcesoOT import AuditoriaProcesoOT as P
        from backend.domain.AusenciaOperario import AusenciaOperario as A
        from backend.domain.IncidenciaProceso import IncidenciaProceso
        from backend.domain.Operario import Operario
        from backend.domain.OrdenTrabajoProceso import OrdenTrabajoProceso as OTP
        from backend.domain.PausaOrden import PausaOrden
        from backend.domain.Planificacion import Planificacion
        from backend.domain.Proceso import Proceso
        from backend.domain.Rango import Rango

        db = self.db
        op = (await db.execute(
            select(Operario.id, Operario.nombre, Operario.apellido, Operario.categoria,
                   Operario.sector, Operario.disponible).where(Operario.id == id_operario)
        )).first()
        avisos: list[str] = []
        ocultos: list[dict] = []

        # 1. El registro central: lo de su ficha (alta, datos, habilidades, ausencias, baja).
        movs = [fila_de_movimiento(m) for m in (await db.execute(
            select(M).where(M.id_entidad == str(id_operario), _de_la_entidad(M, "persona"))
            .order_by(M.creado_en, M.id))).scalars().all()]
        historia = historia_de_la_persona(movs)
        if op is None and not historia["existio"]:
            # Ni está cargada ni hay nada en el registro que pruebe que lo estuvo: no existe
            # (o es de otra base). Un DELETE o un guardado a un número inventado contestan
            # 200 igual («Operario no encontrado»): eso solo no alcanza (revisión del 23/09).
            return None
        if op is not None:
            nombre_completo = " ".join(x for x in (op.nombre, op.apellido) if x).strip()
        else:
            # Dada de baja (RF-17): la fila de `operario` ya no está. Cómo se llamaba sale
            # del registro (su alta, su último guardado o su baja), y el resto de la línea
            # de tiempo —el plan, lo que trabajó, sus pausas— sigue en sus tablas con ese
            # número. Sus ausencias no: se borran con ella (ON DELETE CASCADE).
            nombre_completo = historia["nombre"] or ""
        # El alta anterior al 23/09 no tiene número: se la reconoce por el nombre.
        alta_por_nombre = []
        if not any(es_alta_de_persona(m) for m in movs):
            alta_por_nombre = await self._alta_por_nombre(id_operario, nombre_completo or None, historia)
            if alta_por_nombre:
                historia = historia_de_la_persona(movs + alta_por_nombre)
        persona = ({"id": op.id, "nombre": nombre_completo, "categoria": op.categoria,
                    "sector": op.sector, "activo": bool(op.disponible), "dada_de_baja": False,
                    "baja": None}
                   if op is not None else persona_dada_de_baja(id_operario, historia))
        en_frases = nombre_completo or f"la persona #{id_operario}"
        # Todos los nombres que tuvo: el historial de pasos la nombra como se llamaba entonces.
        nombres = list(dict.fromkeys(n for n in [nombre_completo] + historia["nombres"] if n))
        id_baja = historia["baja"]["id"] if historia["baja"] else None
        cuando_baja = (historia["baja"]["creado_en"], id_baja) if historia["baja"] else None
        # Desde cuándo y hasta cuándo estuvo: del alta atada a su número (la reconocida por
        # el nombre no: si fuera de otra, correría la punta) y de su baja.
        alta_propia = next((m for m in movs if es_alta_de_persona(m) and _salio_bien(m)), None)
        estuvo_desde = alta_propia["creado_en"] if alta_propia else None
        estuvo_hasta = historia["baja"]["creado_en"] if (op is None and historia["baja"]) else None

        nombres_proceso = await self._nombres_para_habilidades(movs, Proceso, Rango)

        eventos: list[dict] = []
        guardados = [m for m in movs if es_ficha_de_persona(m)]
        deducidos = self._deducir_persona(guardados, nombres_proceso)
        if not ve_ausencias:
            # Revisión del 23/09: sin permiso para leer ausencias (política 'asistencia':
            # Recursos u Operaciones) tampoco van los pedidos que las cargaron, cerraron o
            # borraron: su frase y su cuerpo dicen el motivo y la observación.
            movs = [m for m in movs if tipo_de_ruta_persona(m["metodo"], m["ruta"]) != "ausencias"]
        etiquetas_hab = {hc.ETIQUETAS_PERSONA[c] for c in hc.HABILIDADES_PERSONA}
        for m in movs + alta_por_nombre:
            tipo = tipo_de_ruta_persona(m["metodo"], m["ruta"])
            bien = _salio_bien(m)
            # Cómo se llamaba después de ese pedido (el alta dice el nombre con el que entró).
            en_ese_momento = historia["al_momento"].get(m["id"]) or en_frases
            if tipo == "ficha":
                lineas, nota, deducido, igual = lineas_y_nota_de_guardado(m, deducidos)
                campos = {l.split(":", 1)[0] for l in lineas}
                if lineas and campos <= etiquetas_hab:
                    tipo = "habilidades"
                titulo = None
                renombre = historia["renombres"].get(m["id"]) if bien else None
                if renombre:
                    # «cambió el nombre de Juan Perez a Juan Pérez»: el nombre va en la
                    # frase, y abajo lo demás que cambió en el mismo guardado.
                    era, es, dedujo = renombre
                    titulo = f"cambió el nombre de {era} a {es}"
                    lineas = [l for l in lineas if l.split(":", 1)[0] not in ("nombre", "apellido")]
                    igual = False
                    if dedujo and not deducido:
                        deducido = True
                        nota = ("Deducido comparando con el alta o el guardado anterior: hasta el "
                                "23/09 el registro guardaba lo que se mandó, no lo que había.")
                elif bien:
                    titulo = (f"editó la ficha de {en_ese_momento}" if lineas
                              else f"guardó la ficha de {en_ese_momento}")
                eventos.append(evento_de_movimiento(m, tipo, titulo=titulo, lineas=lineas,
                                                    nota=nota, deducido=deducido, igual=igual))
            elif tipo == "habilidades":
                titulo, lineas = self._frase_de_habilidad(m, nombres_proceso)
                eventos.append(evento_de_movimiento(m, tipo, titulo=titulo if bien else None,
                                                    lineas=lineas))
            elif tipo == "alta":
                aproximada = m in alta_por_nombre
                eventos.append(evento_de_movimiento(
                    m, "alta", titulo=(f"dio de alta a {en_ese_momento}" if bien else None),
                    nota=("Se la reconoce por el nombre: hasta el 23/09 el alta no guardaba "
                          "el número de la persona.") if aproximada else None,
                    deducido=aproximada))
            elif tipo == "baja":
                nota = None
                if not bien:
                    titulo = f"intentó dar de baja a {en_frases} (no se pudo: error {m.get('estado')})"
                    if m.get("estado") == 409:
                        nota = ("Tenía categorías, habilidades, pasos elegidos a mano o ausencias: "
                                "el sistema avisó qué se perdía y pidió confirmar.")
                elif m["id"] == id_baja:
                    titulo = f"dio de baja a {en_ese_momento}"
                elif cuando_baja and (m["creado_en"], m["id"]) > cuando_baja:
                    # Un segundo DELETE (dos clics): contesta bien, pero ya no había a quién.
                    titulo = f"volvió a pedir la baja de {en_ese_momento}, que ya no estaba"
                else:
                    # Contestó 200 sin borrar a nadie («Operario no encontrado»).
                    titulo = f"pidió dar de baja a {en_frases}, pero no estaba cargada: no se borró nada"
                eventos.append(evento_de_movimiento(m, "baja", titulo=titulo, nota=nota))
            else:
                eventos.append(evento_de_movimiento(m, tipo))

        # 2. Sus ausencias (RF-06): la tabla del hecho, junto con el pedido que la cargó.
        if ve_ausencias:
            ausencias = await _sin_romper(db, lambda: self._ausencias(A, id_operario), [], avisos,
                                          "las ausencias")
            eventos += eventos_de_ausencias(ausencias, [e for e in eventos if e["id"].startswith("mov-")],
                                            nombre=en_frases)
        else:
            ocultos.append({"que": "ausencias", "texto": "Sus ausencias (y el motivo) no se muestran: "
                            "se ven con «Recursos» u «Operaciones», que no tenés."})

        # 3. Lo que trabajó (la misma atribución que su ficha) y las pausas de esos pasos.
        tiempos_svc = TiemposOperarioService(db)
        pasos = await _sin_romper(db, lambda: tiempos_svc.pasos_atribuidos(id_operario), [], avisos,
                                  "los pasos que trabajó")
        elegidos = await self._ids(OTP.id, OTP.id_operario == id_operario)
        ids_ot = {p["id_orden_trabajo"] for p in pasos}
        otp_de_ot = {}
        if elegidos:
            for id_otp, id_ot in (await db.execute(
                    select(OTP.id, OTP.id_orden_trabajo).where(OTP.id.in_(elegidos)))).all():
                otp_de_ot[id_otp] = id_ot
                ids_ot.add(id_ot)
        filas_plan = []
        if ve_plan:
            filas_plan = await _sin_romper(db, lambda: self._filas_del_plan(
                Planificacion, Planificacion.id_operario == id_operario), [], avisos, "el plan")
            ids_ot |= {f["orden_id"] for f in filas_plan}
        incidencias = await _sin_romper(db, lambda: self._incidencias_de(
            IncidenciaProceso, Proceso, Operario, IncidenciaProceso.id_operario == id_operario),
            [], avisos, "las no conformidades")
        ids_ot |= {i["id_orden_trabajo"] for i in incidencias}

        filas_asig, altas_sin_cambio, homonimos = [], [], []
        if ve_pasos:
            filas_asig, altas_sin_cambio = await _sin_romper(
                db, lambda: self._asignaciones(P, nombres, elegidos, id_operario), ([], []), avisos,
                "las asignaciones de pasos")
            # Quién más se llamó igual (y cuándo estuvo): las filas viejas sólo tienen el
            # nombre. Si no se puede leer, los renglones salen sin la marca de deducido, y
            # la pantalla avisa.
            homonimos = await _sin_romper(db, lambda: self._homonimos(id_operario, nombres), [], avisos,
                                          "si otra persona se llamaba igual")
            ids_ot |= {f["id_orden_trabajo"] for f in filas_asig + altas_sin_cambio}
        else:
            ocultos.append({"que": "pasos", "texto": "Cuándo y quién le eligió o le sacó un paso a "
                            "mano no se muestra: es de la sección «Pasos de las OT» de Auditoría, "
                            "que no tenés."})

        numeros = await self._numeros_de_ot(ids_ot)

        def numero_de(id_ot):
            return numeros.get(id_ot, id_ot)

        def ot_de(id_ot):
            return {"id": id_ot, "numero": numero_de(id_ot)} if id_ot is not None else None

        tiempos = None
        if ve_rendimiento and pasos:
            tiempos = await _sin_romper(db, lambda: self._tiempos(tiempos_svc, pasos), None, avisos,
                                        "los tiempos de cada paso")
        elif not ve_rendimiento:
            ocultos.append({"que": "rendimiento", "texto": "Lo estimado contra lo que llevó cada paso "
                            "no se muestra: es de la sección «Rendimiento por persona», que no tenés."})
        eventos += eventos_de_trabajo(pasos, ot_de=ot_de, tiempos=tiempos)

        mis_pasos = {p["id_otp"] for p in pasos} | set(elegidos)
        if mis_pasos:
            ots_de_mis_pasos = sorted({p["id_orden_trabajo"] for p in pasos} | set(otp_de_ot.values()))
            pausas = await _sin_romper(db, lambda: self._pausas(
                PausaOrden, PausaOrden.id_orden_trabajo.in_(ots_de_mis_pasos)), [], avisos, "las pausas")
            pausas = [p for p in pausas if p.get("id_otp") in mis_pasos]
            eventos += eventos_de_pausas(pausas, numero_de=numero_de, ot_de=ot_de)

        # Quién cerró cada no conformidad: el pedido que la cerró, en el registro central.
        movs_nc = []
        if incidencias:
            movs_nc = [evento_de_movimiento(fila_de_movimiento(m), "no_conformidades") for m in (await db.execute(
                select(M).where(M.id_entidad.in_([str(i["id"]) for i in incidencias]),
                                _de_la_entidad(M, "incidencia")).order_by(M.creado_en, M.id)
            )).scalars().all()]
        eventos += eventos_de_incidencias(incidencias, movs_nc, numero_de=numero_de, ot_de=ot_de,
                                          en_la_persona=True)
        # Sólo los que cerraron una de sus no conformidades: el resto (editar la
        # descripción, por ejemplo) es de la OT, no de la persona.
        eventos += [m for m in movs_nc if m.get("_absorbido")]
        eventos += eventos_de_asignaciones(filas_asig, nombres, numero_de=numero_de,
                                           ot_de=ot_de, altas_sin_cambio=altas_sin_cambio,
                                           id_operario=id_operario, desde=estuvo_desde,
                                           hasta=estuvo_hasta, homonimos=homonimos or [])

        if ve_plan:
            intentos = await self._intentos_por_lote(avisos)
            eventos += eventos_del_plan(filas_plan, intentos, numero_de=numero_de, para_la_persona=True)
        else:
            ocultos.append({"que": "plan", "texto": "Los planes que le dieron pasos no se muestran: "
                            "son de la sección «Planificaciones» de Auditoría, que no tenés."})

        cerrado = cerrar(eventos, desde, hasta, TIPOS_PERSONA)
        return {
            "persona": persona,
            "desde": desde.isoformat() if desde else None,
            "hasta": hasta.isoformat() if hasta else None,
            **cerrado,
            "ocultos": ocultos,
            "avisos": avisos,
            "desde_cuando": await self.desde_cuando(),
        }

    async def _ausencias(self, A, id_operario):
        filas = (await self.db.execute(
            select(A.id, A.desde, A.vuelve, A.motivo, A.observacion, A.origen, A.cargada_en,
                   A.id_usuario_carga, A.usuario_carga, A.cerrada_en, A.id_usuario_cierre,
                   A.usuario_cierre).where(A.id_operario == id_operario)
        )).all()
        return [dict(f._mapping) for f in filas]

    async def _asignaciones(self, P, nombres: list[str], elegidos: list[int], id_operario: int):
        """(cambios de «persona elegida» que la nombran —con cualquiera de los nombres que
        tuvo, o con su número desde el 23/09—, altas de pasos que hoy la tienen elegida y
        nunca cambiaron de persona). Lo que es de otra que se llama igual lo separa
        eventos_de_asignaciones."""
        # Así escribe json.dumps el número (auditoria_procesos.cambio_de_campo): seguido
        # de «,» o de «}». «7» no encuentra «70».
        por_numero = ["%" + _escapar_like('"%s": %d' % (clave, int(id_operario))) + fin + "%"
                      for clave in ("id_antes", "id_despues") for fin in (",", "}")]
        filas = await self._filas_de_pasos(P, and_(
            P.accion == "edicion", P.cambios.like("%persona elegida%"),
            or_(*[P.cambios.like(n, escape="\\") for n in por_numero],
                *[P.cambios.like(f"%{_escapar_like(n)}%", escape="\\") for n in nombres])))
        altas = []
        if elegidos:
            con_cambio = set(await self._ids(P.id_otp, and_(
                P.id_otp.in_(elegidos), P.accion == "edicion", P.cambios.like("%persona elegida%"))))
            altas = [f for f in await self._filas_de_pasos(P, and_(P.id_otp.in_(elegidos), P.accion == "alta"))
                     if f["id_otp"] not in con_cambio]
        return filas, altas

    async def _tiempos(self, svc, pasos) -> dict:
        """{id_otp: (estimado, efectivo)} con la MISMA medición de la ficha (RF-06/07)."""
        from backend.application.PausaService import ahora_ar
        pausas_por_ot, _, feriados = await svc.pausas_y_feriados(pasos)
        cerrados = await svc.cerrados(pasos)
        ahora = ahora_ar()
        salida = {}
        for p in pasos:
            t, _, _ = svc.medir(p, pausas_por_ot, cerrados, ahora=ahora, feriados=feriados)
            salida[p["id_otp"]] = (p.get("tiempo_proceso"), t.efectivo if t else None)
        return salida

    async def _nombres_para_habilidades(self, movs, Proceso, Rango) -> dict:
        """Los nombres de procesos y rangos que aparecen en las rutas y en los cuerpos."""
        procesos, rangos = set(), set()
        for m in movs:
            ruta = m.get("ruta") or ""
            coincide = _RE_SKILL.match(ruta)
            if coincide and coincide.group(1):
                procesos.add(int(coincide.group(1)))
            cuerpo = cuerpo_de(m) or {}
            if isinstance(cuerpo.get("id_proceso"), int):
                procesos.add(cuerpo["id_proceso"])
            for s in cuerpo.get("skills") or []:
                if isinstance(s, dict) and isinstance(s.get("id_proceso"), int):
                    procesos.add(s["id_proceso"])
            for r in cuerpo.get("rangos") or []:
                if isinstance(r, int):
                    rangos.add(r)
        nombres = {}
        for k, v in (await self._nombres_de(Proceso, Proceso.nombre, procesos)).items():
            nombres[("proceso", k)] = v
        for k, v in (await self._nombres_de(Rango, Rango.nombre, rangos)).items():
            nombres[("rango", k)] = v
        return nombres

    @staticmethod
    def _frase_de_habilidad(m: dict, nombres: dict) -> tuple[str | None, list[str]]:
        """«deshabilitó la habilidad TORNO CNC», «marcó FRESA como SKILL 1»."""
        ruta = m.get("ruta") or ""
        cuerpo = cuerpo_de(m) or {}
        coincide = _RE_SKILL.match(ruta)
        id_proceso = int(coincide.group(1)) if coincide and coincide.group(1) else cuerpo.get("id_proceso")
        proceso = nombres.get(("proceso", id_proceso)) or (f"#{id_proceso}" if id_proceso is not None else "")
        nativa = "skills-nativas" in ruta
        if m["metodo"] == "PUT" and "habilitado" in cuerpo:
            verbo = "habilitó" if cuerpo["habilitado"] else "deshabilitó"
            return f"{verbo} la habilidad {proceso}" + (" (nativa)" if nativa else ""), []
        if m["metodo"] == "POST" and "nivel" in cuerpo:
            nivel = cuerpo.get("nivel")
            if nivel in (1, 2):
                return f"marcó {proceso} como SKILL {nivel}", []
            return f"le sacó la prioridad a {proceso}", []
        if m["metodo"] == "DELETE":
            return f"sacó la habilidad {proceso}", []
        return None, []

    def _deducir_persona(self, guardados: list[dict], nombres: dict) -> dict:
        filas = []
        for m in guardados:
            det = leer_detalle(m.get("detalle"))
            cuerpo = det.get("datos") if isinstance(det.get("datos"), dict) else None
            filas.append({"id": m["id"], "salio_bien": m.get("estado") is None or m["estado"] < 400,
                          "cuerpo": cuerpo, "antes": det.get("antes"), "despues": det.get("despues")})
        if not any(f["antes"] is None for f in filas):
            return {}

        def normalizar(cuerpo):
            valores = {}
            for campo in PERSONA_CAMPOS_SIMPLES + ("rangos",):
                if campo in cuerpo:
                    valores[campo] = _normalizar_persona(campo, cuerpo[campo], nombres)
            for campo in hc.PRIVADOS_PERSONA:
                # Desde el 23/09 el cuerpo guardado los trae tapados (auditoria_movimientos
                # ._sin_datos_personales): tapado no es un valor, no se compara.
                if campo in cuerpo and cuerpo[campo] != hc.OCULTO:
                    valores[campo] = hc.texto_de(cuerpo[campo])
            if "skills" in cuerpo:
                valores.update(_habilidades_del_cuerpo(cuerpo["skills"], nombres))
            return valores

        return deducir_cambios(filas, normalizar=normalizar,
                               legible=lambda c, v: v if v not in (None, "") else "—",
                               etiquetas=hc.ETIQUETAS_PERSONA, privados=hc.PRIVADOS_PERSONA)
