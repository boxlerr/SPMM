"""La HUELLA del sync: ¿cambió algo desde la última pasada completa?

POR QUÉ EXISTE

Julián, el 25/09/2026: «hacelo cada 10 min al sync, y que funcione sólo si hay un cambio
en el Integral». Hasta ese día cada pasada (Cloud Scheduler, */30) corría todo: clientes,
artículos, el ESPEJO de la materia prima (importar() de importar_materia_prima_legacy,
unos 9 s en producción leyendo el Integral entero y SPMM entero) y el aviso de desfasaje,
aunque nadie hubiera tocado nada. Cada 10 minutos, eso son 144 lecturas completas por día
para, casi siempre, no cambiar ninguna fila.

Así que cada pasada arranca mirando DOS huellas, cada una en UNA consulta barata:

  · la del INTEGRAL: por cada tabla que leen el sync y el espejo, COUNT + CHECKSUM_AGG +
    SUM de un MD5 de cada fila, sobre las columnas que de verdad se leen (tablas_integral);
  · la de SPMM: por cada tabla que el sync y el espejo ESCRIBEN, count + sum de un hash de
    la fila (sólo las columnas que escriben; HUELLA_SPMM).

Y las compara con las que quedaron guardadas en `sync_estado` al final de la última pasada
completa que salió bien. Si las dos son iguales y esa pasada fue hace menos de
RED_DE_SEGURIDAD, no se hace nada más (decidir()).

POR QUÉ TAMBIÉN LA DE SPMM: para que el sync se CURE SOLO. Hay un backend viejo en Render
que, si se despierta, corre un sync de antes del 23/09 que inventa las marcas de la
materia prima (pedido = cantidad > 0, disponible = 1) y pone en 0 el stock. Sin nada que
cambie en el Integral, el espejo no se enteraría nunca: con la huella de SPMM se entera en
la pasada siguiente, corre entero, restituye lo del Integral y lo avisa con un WARNING.

LO QUE NO CUBRE, A PROPÓSITO

  · Columnas que el sync no lee (Integral) o no escribe (SPMM): un cambio ahí no cambia
    nada de lo que el sync haría, así que no es un cambio.
  · Una suma de hashes puede chocar (poco: son 64 bits por tabla). Para eso, y para lo
    que dependa del reloj (las conversiones del espejo miran «hoy» para descartar fechas
    absurdas), está RED_DE_SEGURIDAD: cada tanto se corre entera igual.
  · Con MATERIA_PRIMA_DUENO=spmm la materia prima la edita la GENTE en SPMM: la huella
    de SPMM se limita a cliente, artículo y orden_trabajo (TABLAS_APP). Si incluyera
    pieza o las líneas, cada edición dispararía una pasada completa, que en ese modo ni
    siquiera las toca (el espejo está apagado; el 7b sólo agrega códigos y precios).

Todo acá es LECTURA, salvo la fila de `sync_estado` (guardar_estado, marcar_visto): el
sync sigue escribiendo la materia prima sólo por el espejo (tests/test_sync_no_pisa_
procesos.py lo cuida sobre sync_db.py, y tests/test_sync_huella.py sobre este archivo).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import text

from backend.application.materia_prima.dueno import SPMM
from backend.application.materia_prima.legado import ventana_plan_semanal
from backend.scripts.importar_materia_prima_legacy import (
    COLS_LINEA,
    COLS_PIEZA,
    COLS_PROVEEDOR,
    limites_plan_semanal,
)

# La fila de sync_estado (hay una sola: el sync es uno).
CLAVE = "sync"

# Cada cuánto se corre una pasada COMPLETA aunque ninguna huella haya cambiado. Es la red
# por lo que las huellas no ven: dos filas cuyos hashes justo se compensan en la suma,
# una columna que alguien empiece a leer sin sumarla acá, o lo que dependa del día (el
# espejo descarta fechas «del futuro» mirando hoy). Con el Scheduler cada 10 minutos, son
# 8 pasadas completas por día en vez de 144; y lo peor que puede quedar desfasado, queda
# como mucho 3 horas.
RED_DE_SEGURIDAD = timedelta(hours=3)

# El tope de la lectura de la huella del Integral en el driver (sync_db._leer_sync): una
# tabla tomada por un «Grabar» a medias no puede colgar el sync. Si no llega, se corre la
# pasada completa, como con cualquier huella que falla.
TOPE_HUELLA_INTEGRAL_SEG = 20

# ─────────────────────────── la del Integral ───────────────────────────
#
# (tabla del Integral, columnas) — las columnas de CADA consulta que corren el sync
# (sync_db: Q_CLIENTES, Q_ARTICULOS, Q_CATALOGO_VIEJO, _Q_YA_ENTREGADAS) y el espejo
# (importar_materia_prima_legacy: Q_MATERIAL, Q_PROVEEDOR, Q_HISTORIAL, Q_MOVSTOCK,
# Q_LINEAS, Q_OTRABAJO, Q_CORTES, Q_CANERA, Q_PLAN_SEMANAL). test_sync_huella las compara
# con las consultas, así que una columna nueva en una consulta sin sumarla acá hace fallar
# el test.
#
# EL HASH DE CADA FILA (25/09/2026). La primera versión usaba BINARY_CHECKSUM, y la
# revisión encontró que no ve algunas ediciones COMBINADAS en la misma fila: en
# otrabajoMprimas, cantidad 20→21 junto con pendiente 0→1 da el mismo checksum en las
# 1.306 líneas con esa cantidad (con reserva en vez de pendiente, 134). No es azar: el
# checksum mezcla las columnas con rotaciones y XOR, y hay pares de cambios que se anulan.
# Ahora cada fila es un MD5 del texto de sus columnas (HASHBYTES, que lee el texto entero:
# también los nvarchar(max), que BINARY_CHECKSUM miraba sólo al principio), y de la tabla
# se guardan filas + XOR de 32 bits de esos MD5 + SUMA de otros 32 (dos filas iguales se
# cancelan en el XOR, no en la suma). MD5 no está por seguridad, está por mezclar bien.
#
# El texto de la fila tiene que ser SIEMPRE el mismo para los mismos datos, y distinto si
# cambia cualquier cosa (_fila):
#   · los float y real, por sus bits (CAST a binary, en hexadecimal con el estilo 2): sin
#     el estilo, SQL Server los escribe con 6 cifras y 1234567 → 1234568 no se vería;
#   · las fechas en ISO 8601 (estilo 126), con segundos y milésimas; sin estilo, sin
#     segundos;
#   · el resto (textos, enteros, bits) como viene;
#   · NULL no es '' ni 0: adelante va una marca por columna de cuáles son NULL (CONCAT_WS
#     saltea los NULL y, sin la marca, (NULL, 'a') y ('a', NULL) darían lo mismo);
#   · las columnas van separadas por NCHAR(31) (el separador de unidades de ASCII), que no
#     aparece en ningún texto que tipea la gente.
# Qué columnas son float, real o fecha: _TIPOS, sacado de sys.columns del Integral el
# 25/09/2026. Una columna de esos tipos que no esté ahí se escribe con el formato por
# defecto: la huella sigue siendo estable, pero puede no ver un cambio chico. Al sumar
# una columna así a una consulta, sumarla también acá.
#
# Costo medido el 25/09 contra el Integral (SQL Server 2019 Express, ~150 mil filas): unos
# 800 ms por lectura, contra 150 ms del checksum (Express no reparte la consulta en varios
# núcleos). Cada 10 minutos es poco, y en una pasada sin cambios es lo único que se lee.
#
# Otros cuidados:
#   · El ORDEN de las líneas y de los cortes importa: el espejo los lee sin ORDER BY, en el
#     orden físico de la tabla (no tienen clave), y ése es el «orden de carga» que guarda
#     en `orden`. Un hash por fila no ve el orden, así que en esas dos tablas entra la
#     dirección física de la fila (%%physloc%%): el Integral graba las líneas de una OT
#     borrando y volviendo a insertar, y eso las mueve aunque el texto quede igual.
#   · Del plan semanal sólo la ventana que lee el espejo (_DONDE): las semanas de afuera
#     no se reflejan, así que un cambio ahí no es un cambio. El lunes que la ventana se
#     corre, la huella cambia y la pasada corre entera: es justo cuando hay que hacerlo.
# Q_PENDIENTES y Q_OTS no están: desde el 2/9 el sync no trae OT (run_sync no las corre).
_INTEGRAL_COMUN = {
    "cliente": ("dbo.cliente",
                "idCliente, Descripcion, fantasia, abreviatura, direccion, localidad, cuit, "
                "telefono, celular, mail, web, obs"),
    "articulo": ("dbo.articulo", "Idarticulo, descripcion, abreviatura"),
    "pieza": ("dbo.pieza",
              "Idpieza, descripcion, unitario, unidad, fecha, insumo, material, formato, "
              "t1, t2, t3, t4, t5, medida, estante, letra, nro, proveedor, obs, inactivo"),
}
# La cabecera de la OT: el desfasaje (fechaentrega, fc) y, con el espejo, la identidad de
# la OT (ots_del_viejo: artículo, cliente, fecha) y «no lleva materia prima».
_OTRABAJO_DESFASAJE = ("dbo.otrabajo", "idot, fechaentrega, fc")
_OTRABAJO_ESPEJO = ("dbo.otrabajo", "idot, idarticulo, idcliente, fecha, NOLLEVAMP, fechaentrega, fc")
_INTEGRAL_ESPEJO = {
    "otrabajoMprimas": ("dbo.otrabajoMprimas",
                        "%%physloc%%, Idot, idpieza, descripcion, cantidad, un, proveedor, "
                        "observaciones, pendiente, reserva, creserva, disponible, pedido, "
                        "fechaprov, usado, fechaProvE"),
    "otcortesmp": ("dbo.otcortesmp", "%%physloc%%, idot, idpieza, cant, largo"),
    "HistorialPieza": ("dbo.HistorialPieza", "Idpieza, precio, fecha"),
    "MOVSTOCK": ("dbo.MOVSTOCK", "IdPIEZA, FECHA, COMENTARIO, DEBE, ot"),
    "caniera": ("dbo.caniera", "ubicacion, ot"),
    "Proveedor": ("dbo.Proveedor",
                  "idProveedor, Descripcion, fantasia, cuit, telefono, celular, mail, "
                  "direccion, localidad, obs, inactivo"),
    "Material": ("dbo.Material", "idMAterial, Descripcion, calidad"),
    "plansemanal": ("dbo.plansemanal", "fecha, ot, PRIORIDAD"),
}

# Las columnas float, real y datetime/smalldatetime de lo que se lee (sys.columns del
# Integral, 25/09/2026). pieza.fecha, HistorialPieza.fecha y fechaProvE son TEXTO allá.
_TIPOS = {
    "pieza": {"unitario": "float", "t1": "float", "t2": "float", "t3": "float", "t4": "float",
              "t5": "float"},
    "otrabajo": {"fecha": "fecha", "fechaentrega": "fecha"},
    "otrabajoMprimas": {"cantidad": "float", "creserva": "float", "fechaprov": "fecha"},
    "otcortesmp": {"cant": "real"},
    "HistorialPieza": {"precio": "float"},
    "MOVSTOCK": {"FECHA": "fecha", "DEBE": "float"},
    "plansemanal": {"fecha": "fecha"},
}

_FISICA = "%%physloc%%"


def tablas_integral(modo: str) -> dict[str, tuple[str, str]]:
    """Lo que lee el sync del Integral en ese modo. Con SPMM como dueño no corre el espejo:
    sólo clientes, artículos, el catálogo de piezas (7b) y el desfasaje."""
    if modo == SPMM:
        return {**_INTEGRAL_COMUN, "otrabajo": _OTRABAJO_DESFASAJE}
    return {**_INTEGRAL_COMUN, "otrabajo": _OTRABAJO_ESPEJO, **_INTEGRAL_ESPEJO}


def _columnas(columnas: str) -> list[str]:
    return [c.strip() for c in columnas.split(",")]


def _valor(columna: str, tipo: str | None) -> str:
    """Una columna como texto estable (ver arriba)."""
    if columna == _FISICA:
        return f"CONVERT(varchar(16), {_FISICA}, 2)"
    if tipo == "float":
        return f"CONVERT(varchar(16), CAST({columna} AS binary(8)), 2)"
    if tipo == "real":
        return f"CONVERT(varchar(8), CAST({columna} AS binary(4)), 2)"
    if tipo == "fecha":
        return f"CONVERT(varchar(23), {columna}, 126)"
    return columna


def _fila(nombre: str, columnas: str) -> str:
    """El MD5 de una fila: la marca de NULL de cada columna y después las columnas, en
    texto estable y separadas por NCHAR(31)."""
    tipos = _TIPOS.get(nombre, {})
    lista = _columnas(columnas)
    nulos = " + ".join(f"IIF({c} IS NULL, '1', '0')" for c in lista if c != _FISICA)
    valores = ", ".join(_valor(c, tipos.get(c)) for c in lista)
    return f"HASHBYTES('MD5', CONCAT_WS(NCHAR(31), {nulos}, {valores}))"


def _donde(nombre: str, hoy: date | None) -> str:
    """El WHERE de una tabla (sólo el plan semanal: su ventana, la misma que lee el espejo)."""
    if nombre != "plansemanal":
        return ""
    desde, hasta = limites_plan_semanal(ventana_plan_semanal(hoy))
    return f" WHERE fecha >= '{desde}' AND fecha < '{hasta}'"


def consulta_integral(modo: str, hoy: date | None = None) -> str:
    """UNA consulta T-SQL (sólo SELECT): una fila por tabla con filas, XOR y suma de los
    MD5 de sus filas (de cada MD5, los bytes 5 a 8 van al XOR y los 1 a 4 a la suma)."""
    partes = [
        f"SELECT '{nombre}' AS tabla, COUNT_BIG(*) AS filas, CHECKSUM_AGG(h2) AS xor_h, "
        f"SUM(CAST(h1 AS BIGINT)) AS suma FROM (SELECT CAST(SUBSTRING(b, 1, 4) AS INT) AS h1, "
        f"CAST(SUBSTRING(b, 5, 4) AS INT) AS h2 FROM (SELECT {_fila(nombre, columnas)} AS b "
        f"FROM {tabla}{_donde(nombre, hoy)}) AS x) AS t"
        for nombre, (tabla, columnas) in tablas_integral(modo).items()
    ]
    return "\nUNION ALL\n".join(partes)


async def leer_huella_integral(leer, modo: str, hoy: date | None = None) -> dict[str, str]:
    """La huella del Integral: {tabla: 'filas:xor:suma', '_modo': modo}. `leer` es
    sync_db._leer (se recibe para no importar sync_db, que importa este módulo). Levanta si
    falta una tabla en la respuesta: una huella incompleta no puede decir «no cambió»."""
    filas = await leer(consulta_integral(modo, hoy), tope_seg=TOPE_HUELLA_INTEGRAL_SEG)
    huella = {f["tabla"]: f"{f['filas']}:{f['xor_h']}:{f['suma']}" for f in filas}
    faltan = set(tablas_integral(modo)) - set(huella)
    if faltan:
        raise ValueError(f"la huella del Integral vino sin {', '.join(sorted(faltan))}")
    huella["_modo"] = modo
    return huella


# ─────────────────────────── la de SPMM ───────────────────────────
#
# Las tablas que en modo Integral escribe SÓLO el espejo (la gente no puede: las APIs de
# materia prima dan 422). Un cambio acá sin que haya cambiado el Integral es alguien que
# escribió por afuera, y se restituye (salvo lo que arrastra una OT dada de alta o de baja,
# ARRASTRA_LA_OT). Las columnas son las que escribe el espejo: pieza no lleva stock_minimo
# ni stock_bajo_avisado_en (los escribe SPMM, también en modo Integral). canera_ocupacion,
# sólo las vigentes: el historial no se toca. plan_semanal, entera (el espejo sólo escribe
# su ventana, pero afuera nadie más escribe: una baja de OT suelta su FK, y eso es de
# ARRASTRA_LA_OT).
TABLAS_APP = ("cliente", "articulo", "orden_trabajo")

# Las tablas del espejo que cambian SOLAS cuando en SPMM se da de alta o de baja una OT:
# borrar una OT (OrdenTrabajoRepository.delete) borra sus líneas y sus cortes, libera su
# cañera y suelta su plan semanal (ON DELETE SET NULL). Eso no es el backend viejo de
# Render pisando nada: con orden_trabajo cambiando de filas en la misma pasada, un cambio
# SÓLO en estas tablas no da la alarma (decidir). Antes daba el WARNING «¿Render?» y, al
# terminar, «siguen distintas» (las líneas de una OT borrada no vuelven). Lo que queda
# afuera (pieza, precios, proveedores…) una baja de OT no lo toca: sigue dando la alarma.
ARRASTRA_LA_OT = ("orden_trabajo_pieza", "orden_trabajo_pieza_corte", "canera_ocupacion",
                  "plan_semanal")


def _columnas_spmm(modo: str) -> dict[str, tuple[str, str]]:
    """{tabla: (columnas, WHERE)} de la huella de SPMM en ese modo."""
    from backend.scripts.sync_db import COLS_CLIENTE  # sync_db importa este módulo

    app = {
        # Clientes y artículos los escribe el sync (gana el Integral) y también se cargan
        # acá. De orden_trabajo, lo que mira el sync: la identidad de la OT para el espejo
        # (ots_del_viejo) y lo que decide el desfasaje.
        "cliente": ("id, id_viejo, " + ", ".join(COLS_CLIENTE), ""),
        "articulo": ("id, cod_articulo, descripcion, abreviatura", ""),
        "orden_trabajo": ("id, id_otvieja, id_articulo, id_cliente, fecha_orden, finalizadototal, "
                          "suspendida, no_lleva_materia_prima, fecha_entrega", ""),
    }
    if modo == SPMM:
        return app
    return {
        "pieza": ("id, cod_pieza, stockactual, " + ", ".join(COLS_PIEZA), ""),
        "orden_trabajo_pieza": ("id, id_orden_trabajo, id_pieza, " + ", ".join(COLS_LINEA), ""),
        "orden_trabajo_pieza_corte": ("id, id_orden_trabajo_pieza, cantidad, largo_mm, ancho_mm, "
                                      "texto_original, orden", ""),
        "canera_ocupacion": ("id, columna, fila, id_orden_trabajo, ot_texto, origen, desde",
                             " WHERE hasta IS NULL"),
        "pieza_movimiento": ("id, id_pieza, fecha, tipo, cantidad, comentario, id_orden_trabajo, "
                             "id_orden_trabajo_pieza, origen, anulado", ""),
        "pieza_precio": ("id, id_pieza, fecha, precio, origen, id_proveedor", ""),
        "proveedor": ("id, id_legacy, " + ", ".join(COLS_PROVEEDOR), ""),
        "material": ("id, nombre, letra_codigo", ""),
        "material_calidad": ("id, id_material, nombre", ""),
        "plan_semanal": ("id, semana, fecha_original, numero_ot, id_orden_trabajo, prioridad, "
                         "origen", ""),
        **app,
    }


def consulta_spmm(modo: str) -> str:
    """UNA consulta Postgres (sólo SELECT): una fila por tabla con count y la suma de un
    hash de 64 bits de cada fila (las columnas de arriba). Con id en la fila, no hay dos
    filas iguales que se cancelen; la suma no depende del orden."""
    partes = [
        f"SELECT '{tabla}' AS tabla, count(*) AS filas, "
        f"COALESCE(sum(hashtextextended(ROW({columnas})::text, 0)), 0)::text AS suma "
        f"FROM {tabla}{donde}"
        for tabla, (columnas, donde) in _columnas_spmm(modo).items()
    ]
    return "\nUNION ALL\n".join(partes)


async def leer_huella_spmm(session, modo: str) -> dict[str, str]:
    """La huella de SPMM: {tabla: 'filas:suma'}. Levanta si falta una tabla."""
    filas = (await session.execute(text(consulta_spmm(modo)))).mappings().all()
    huella = {f["tabla"]: f"{f['filas']}:{f['suma']}" for f in filas}
    faltan = set(_columnas_spmm(modo)) - set(huella)
    if faltan:
        raise ValueError(f"la huella de SPMM vino sin {', '.join(sorted(faltan))}")
    return huella


# ─────────────────────────── sync_estado ───────────────────────────


@dataclass
class Guardado:
    huella_integral: dict[str, str] | None
    huella_spmm: dict[str, str] | None
    ultima_completa: datetime | None


def _cargar(texto) -> dict[str, str] | None:
    try:
        valor = json.loads(texto) if texto else None
    except (TypeError, ValueError):
        return None
    return valor if isinstance(valor, dict) else None


def _a_texto(huella: dict[str, str]) -> str:
    return json.dumps(huella, sort_keys=True, ensure_ascii=False)


def _fecha(v) -> datetime | None:
    """SQLite (los tests) devuelve el timestamp como texto en una consulta cruda."""
    if v is None or isinstance(v, datetime):
        return v
    try:
        return datetime.fromisoformat(str(v))
    except ValueError:
        return None


async def leer_estado(session) -> Guardado | None:
    fila = (await session.execute(text(
        "SELECT huella_integral, huella_spmm, ultima_completa FROM sync_estado WHERE clave = :c"),
        {"c": CLAVE})).mappings().first()
    if fila is None:
        return None
    return Guardado(_cargar(fila["huella_integral"]), _cargar(fila["huella_spmm"]),
                    _fecha(fila["ultima_completa"]))


async def guardar_estado(session, huella_integral: dict, huella_spmm: dict,
                         ultima_completa: datetime, ahora: datetime) -> None:
    """Las huellas de una pasada completa que salió bien: la del Integral leída al EMPEZAR
    (si el Integral cambió mientras corría, la próxima pasada lo ve distinto y corre) y la
    de SPMM leída al TERMINAR (lo que quedó escrito; con lo de al empezar en las tablas de
    la app que cambiaron mientras corría, ver a_guardar). Hace commit."""
    await session.execute(text(
        "INSERT INTO sync_estado (clave, huella_integral, huella_spmm, ultima_completa, actualizado_en) "
        "VALUES (:c, :hi, :hs, :u, :a) "
        "ON CONFLICT (clave) DO UPDATE SET huella_integral = EXCLUDED.huella_integral, "
        "huella_spmm = EXCLUDED.huella_spmm, ultima_completa = EXCLUDED.ultima_completa, "
        "actualizado_en = EXCLUDED.actualizado_en"),
        {"c": CLAVE, "hi": _a_texto(huella_integral), "hs": _a_texto(huella_spmm),
         "u": ultima_completa, "a": ahora})
    await session.commit()


async def marcar_visto(session, ahora: datetime) -> None:
    """En una pasada que no hace nada, sólo `actualizado_en`: que se vea en la base que el
    sync sigue mirando (si el Scheduler se para, esa hora se queda quieta)."""
    await session.execute(text("UPDATE sync_estado SET actualizado_en = :a WHERE clave = :c"),
                          {"a": ahora, "c": CLAVE})
    await session.commit()


# ─────────────────────────── la decisión ───────────────────────────


@dataclass
class Decision:
    completa: bool
    motivo: str = ""
    # Alguien escribió en las tablas del espejo sin que cambiara el Integral: WARNING.
    alerta: bool = False
    # Las tablas del espejo que cambiaron (para ver, al final, si quedaron restituidas).
    tablas_espejo: list[str] = field(default_factory=list)


def _distintas(antes: dict | None, ahora: dict) -> list[str]:
    """Las claves cuyo valor cambió (o que aparecieron o desaparecieron)."""
    antes = antes or {}
    return sorted(k for k in set(antes) | set(ahora) if antes.get(k) != ahora.get(k))


def _filas(huella: dict | None, tabla: str) -> str | None:
    """Las filas de una tabla en una huella («3808» de «3808:…»), o None si no está."""
    valor = (huella or {}).get(tabla)
    return valor.split(":")[0] if valor else None


def _con_filas(tablas, antes: dict, ahora: dict) -> str:
    """«orden_trabajo_pieza (3808 → 3809 filas), pieza» para el log."""
    salida = []
    for t in tablas:
        if t not in antes or t not in ahora:
            salida.append(f"{t} ({'nueva en la huella' if t not in antes else 'ya no se mira'})")
            continue
        a, d = antes[t].split(":")[0], ahora[t].split(":")[0]
        salida.append(f"{t} ({a} → {d} filas)" if a != d else t)
    return ", ".join(salida)


def decidir(guardado: Guardado | None, huella_integral: dict | None, huella_spmm: dict | None,
            ahora: datetime, forzar: bool = False) -> Decision:
    """¿Pasada completa o nada? Ante cualquier duda, completa: saltear por error es lo único
    que no puede pasar."""
    if forzar:
        return Decision(True, "pedida a mano (forzar=true)")
    if huella_integral is None:
        return Decision(True, "no se pudo leer la huella del Integral")
    if huella_spmm is None:
        return Decision(True, "no se pudo leer la huella de SPMM")
    if guardado is None or guardado.huella_integral is None or guardado.huella_spmm is None:
        return Decision(True, "no hay huellas guardadas de una pasada completa")
    if guardado.ultima_completa is None or not (
            timedelta(0) <= ahora - guardado.ultima_completa < RED_DE_SEGURIDAD):
        return Decision(True, "la última pasada completa fue hace más de "
                              f"{RED_DE_SEGURIDAD.total_seconds() / 3600:g} h (red de seguridad)")
    antes_modo, modo = guardado.huella_integral.get("_modo"), huella_integral.get("_modo")
    if antes_modo != modo:
        # Otro dueño de la materia prima: otras tablas en las dos huellas.
        return Decision(True, f"cambió el dueño de la materia prima ({antes_modo} → {modo})")
    integral = _distintas(guardado.huella_integral, huella_integral)
    spmm = _distintas(guardado.huella_spmm, huella_spmm)
    espejo = [t for t in spmm if t not in TABLAS_APP]
    if not integral and not spmm:
        return Decision(False)
    if integral:
        motivo = f"cambió el Integral: {_con_filas(integral, guardado.huella_integral, huella_integral)}"
        if spmm:
            motivo += f"; y en SPMM: {_con_filas(spmm, guardado.huella_spmm, huella_spmm)}"
        return Decision(True, motivo, tablas_espejo=espejo)
    if espejo:
        # Se dieron de alta o de baja OT en SPMM: lo que arrastra una OT no es una pisada
        # (ARRASTRA_LA_OT). Por las filas y no por cualquier cambio de orden_trabajo: una OT
        # que se edita (se finaliza, cambia la entrega) no toca nada del espejo, y así un
        # cambio del espejo junto con una edición sigue dando la alarma.
        altas_o_bajas = _filas(guardado.huella_spmm, "orden_trabajo") != _filas(huella_spmm, "orden_trabajo")
        sueltas = [t for t in espejo if not (altas_o_bajas and t in ARRASTRA_LA_OT)]
        if sueltas:
            return Decision(
                True, "SPMM cambió sin cambio en el Integral: alguien escribió en tablas del espejo "
                      "(¿el backend viejo de Render?) — se restituye. Tablas: "
                      + _con_filas(spmm, guardado.huella_spmm, huella_spmm),
                alerta=True, tablas_espejo=sueltas)
        return Decision(True, "se dieron de alta o de baja OT en SPMM y con ellas cambió lo que "
                              "cuelga de la OT (no es una pisada): "
                              + _con_filas(spmm, guardado.huella_spmm, huella_spmm),
                        tablas_espejo=espejo)
    # Sólo OT, clientes o artículos de SPMM: lo carga la gente acá, no es una alarma. Pero
    # cambia lo que decide el desfasaje y a qué OT se le cuelga la materia prima.
    return Decision(True, "cambiaron OT, clientes o artículos en SPMM: "
                          + _con_filas(spmm, guardado.huella_spmm, huella_spmm))


def a_guardar(al_empezar: dict | None, al_terminar: dict) -> tuple[dict, list[str]]:
    """(la huella de SPMM que se guarda al final de una pasada completa, las tablas de la
    app que cambiaron MIENTRAS corría).

    POR QUÉ. La huella de SPMM se lee al TERMINAR (lo que quedó escrito), pero el espejo
    leyó las OT de SPMM bastante antes: cada paso carga su Estado al empezar. Una OT que
    entra a SPMM en ese rato (importar_ot_legacy --igualar, migrar_ot_faltantes) no recibió
    su materia prima en esta pasada, y si la huella guardada ya la incluye, la siguiente
    dice «sin cambios» y la OT queda sin sus líneas hasta RED_DE_SEGURIDAD. Medido el 25/09
    en local contra el Integral real: la 15924 entró a mitad de una pasada y siguió con 0
    de sus 2 líneas en las dos pasadas siguientes; recién una forzada se las colgó.

    Así que de las tablas de la app que cambiaron entre el principio y el final de la
    pasada se guarda lo que había al EMPEZAR: la pasada siguiente las ve distintas y corre
    entera una vez más (por el camino de INFO, sin la alarma de Render). Si el cambio fue de
    la misma pasada (un cliente o un artículo nuevo del Integral, «no lleva materia prima»
    del espejo), cuesta una pasada completa de más que no cambia nada.

    Sólo las de la app: en las del espejo, que cambien durante la pasada es lo normal (las
    escribe ella) y marcarlas daría la alarma de Render en la siguiente."""
    if not al_empezar:
        return dict(al_terminar), []
    cambiaron = [t for t in TABLAS_APP
                 if t in al_empezar and t in al_terminar and al_empezar[t] != al_terminar[t]]
    return {**al_terminar, **{t: al_empezar[t] for t in cambiaron}}, cambiaron


def restituidas(guardado: Guardado | None, tablas: list[str], huella_spmm: dict) -> list[str]:
    """De las tablas del espejo que alguien había tocado, las que quedaron DISTINTAS de la
    última pasada completa después de restituir (vacío = quedaron como estaban)."""
    antes = (guardado.huella_spmm if guardado else None) or {}
    return [t for t in tablas if antes.get(t) != huella_spmm.get(t)]

