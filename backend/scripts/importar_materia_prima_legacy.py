"""Importa la materia prima del sistema viejo (el Sistema Integral) a SPMM (spec §4).

POR QUÉ

El 23/09 se decidió que la gestión de materias primas pasa a SPMM. El 24/09 Lucas avisó
que la semana del 28/09 hay prueba piloto EN PARALELO con el Integral, y que durante la
prueba el Integral sigue siendo el DUEÑO de todo, materia prima incluida: Carolina y Maxi
cargan allá y SPMM lo tiene que reflejar con las marcas reales (application/
materia_prima/dueno.py). Hasta ahora SPMM tenía una copia que escribía el sync, y estaba
mal (marcas inventadas, stock en 0, sin proveedores, sin cortes ni cañera). Esto trae lo
que hay en el viejo, bien.

SE PUEDE CORRER CUANTAS VECES SE QUIERA, Y GANA EL INTEGRAL. Cada corrida deja SPMM
igual al viejo en lo que toca (con el viejo igual, la segunda corrida no cambia nada).
Lo único que no pisa es lo cargado en SPMM (origen 'spmm' o 'historial'): se cuenta y se
avisa. Mientras el Integral sea el dueño, el sync corre esto mismo en cada pasada (el
ESPEJO, scripts/sync_db.py → importar()); a mano sirve para ver qué cambiaría (en seco),
para la primera carga con copias de seguridad y para re-traer unas OT puntuales (--ots).

PASOS (en este orden; --pasos elige cuáles)

  catalogos    material (Material.Descripcion + pieza.material) y material_calidad
               (Material.calidad + las calidades que se leen en las descripciones).
               Sin fusionar parecidos: PLASTICO y PLASTICOS quedan como en el viejo.
  proveedores  dbo.Proveedor, upsert por id_legacy.
  insumos      dbo.pieza por código normalizado: UPDATE de las que ya están (conservan
               el id: las apuntan líneas, consumos y avisos), INSERT de las que faltan,
               inactivo=1 a las que sólo están en SPMM (no se borran). Nunca el mínimo.
  precios      HistorialPieza limpio → pieza_precio (origen 'import').
  stock        MOVSTOCK → pieza_movimiento (origen 'legacy') y después el caché
               pieza.stockactual = Σ movimientos para TODAS las piezas. MOVSTOCK es lo
               que el viejo muestra en la solapa Stock y usa en Pendientes; el
               stockactual del viejo es suma de compras, no stock.
  recortes     dbo.recortes → pieza_recorte (cada fila es un recorte; las filas '0' o
               vacías no, son renglones vacíos de la grilla). Sólo agrega: un recorte que
               el viejo borró (se usó) queda acá; por eso el espejo del sync no lo corre.
  lineas       otrabajoMprimas → orden_trabajo_pieza de las OT que ya están en SPMM,
               emparejadas por (código, n° de aparición): UPDATE en su lugar, INSERT,
               DELETE (con copia) de las que ya no están salvo que tengan consumos. Con
               las marcas REALES. Una OT que en el viejo se quedó sin ninguna línea
               pierde también acá las que tenía. Y «no lleva materia prima» como está
               en el viejo (se pone y se saca). Sólo en las OT de SPMM que SON la del
               viejo con ese número: mismo artículo, cliente y fecha (ots_del_viejo). Una
               que no coincide (una OT dada de alta en SPMM que pisó un número del viejo)
               no se toca, ni sus cortes ni su cañera: se avisa.
               Antes de borrar vuelve a leer esas OT del viejo y borra sólo lo que falta
               en las dos lecturas (el viejo graba borrando y volviendo a insertar); con
               una lectura vacía no borra nada; y por encima de TOPE_BORRADO_LINEAS el
               espejo del sync no borra ninguna (a mano, avisa y sigue).
  cortes       otcortesmp → cortes de la primera línea de ese (OT, código).
  canera       caniera → canera_ocupacion (origen 'legacy').
  plan_semanal dbo.plansemanal → plan_semanal (origen 'legacy'): qué OT están programadas
               cada semana, lo que filtra «Semana del …» en Pendientes. Sólo la ventana
               de semanas alrededor de hoy (legado.ventana_plan_semanal) y, adentro,
               igual al Integral: se inserta, se corrige y se borra lo que cambió; fuera de
               la ventana no se toca nada. La fecha va al lunes de su semana, sin basura
               ni repetidos, y la OT se enlaza sólo si es la del Integral (ots_del_viejo).

Cada paso imprime cuánto tardó (el día del corte el viejo está congelado mientras corre).

Una lectura VACÍA del viejo (el catálogo, todas las líneas, todos los cortes, la cañera
entera) es una lectura que falló, no un viejo vacío: ese paso no borra, no apaga, no
inactiva ni libera nada, y lo avisa.

CÓMO SE CORRE (desde la raíz del repo)

    .venv/bin/python -m backend.scripts.importar_materia_prima_legacy              # en seco
    .venv/bin/python -m backend.scripts.importar_materia_prima_legacy --aplicar
    .venv/bin/python -m backend.scripts.importar_materia_prima_legacy --pasos insumos,stock
    .venv/bin/python -m backend.scripts.importar_materia_prima_legacy \
        --pasos lineas,cortes,canera --ots 15692,14534 --aplicar                  # unas OT
    .venv/bin/python -m backend.scripts.importar_materia_prima_legacy \
        --db-url postgresql://postgres@127.0.0.1:55432/spmm_import --aplicar       # base local

--ots (pedido de Lucas, para re-correr sobre las OT del plan de la prueba) limita los
pasos lineas, cortes, canera y plan_semanal a esas OT, por su número visible (el del
viejo). Los demás pasos corren igual, sobre todo el catálogo.

EN SECO (por defecto) sólo LEE el viejo y SPMM e imprime qué haría, con conteos y
ejemplos. No abre transacciones de escritura ni consume secuencias: los pasos que dependen
de uno anterior (las líneas necesitan las piezas nuevas) se simulan en memoria.

CON --aplicar
  · una conexión asyncpg por el pooler 6543 (el 5432 admite 15 clientes para todo el
    proyecto y la app usa la mayoría), statement_cache_size=0 (el pooler en modo
    transaction no conserva prepared statements);
  · UNA transacción para toda la corrida, con un candado (pg_try_advisory_xact_lock):
    si el sync está corriendo el espejo (o alguien más este script), no se pisan —el
    segundo no hace nada y avisa—. Dos corridas a la vez duplicarían movimientos de
    stock, líneas y piezas, porque cada una decide qué falta con lo que leyó antes;
  · adentro, un SAVEPOINT por paso, con lock_timeout: si la app tiene tomada una fila,
    ese paso se cae entero en vez de quedar a medias, y los anteriores quedan escritos;
  · antes de reescribir o borrar filas de pieza y orden_trabajo_pieza las copia a
    backup_20260923_pieza / backup_20260923_orden_trabajo_pieza (con respaldado_en). El
    espejo del sync no copia en cada pasada (se acumularía una copia por pasada): copia a
    cada tabla hasta que su backup_* existe (SI_NO_HAY_COPIA);
  · con tiempos (TOPE_RELECTURA_SEG, TOPE_OCIOSO_EN_TRANSACCION): un Integral colgado no
    deja tomados los locks ni el candado;
  · aborta sin tocar nada si la migración 2026-09-23_materia_prima no está aplicada.

VOLVER ATRÁS: las copias tienen la fila entera como estaba. Los INSERT de este script
llevan origen 'legacy' (o 'import' en precios) y se pueden identificar por ahí.

Lectura del viejo SÓLO con SELECT, con _leer de sync_db.py. Conversiones con
application/materia_prima/legado.py, las mismas del paso 7b del sync.
"""
from __future__ import annotations

import argparse
import asyncio
import math
import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal

from backend.application.materia_prima.legado import (
    CatalogoLegado,
    corte_desde_texto,
    emparejar_lineas,
    fecha_desde_texto,
    indice_proveedores,
    linea_desde_legacy,
    material_y_calidad_desde_descripcion,
    norm_codigo,
    ocupacion_desde_ubicacion,
    pieza_desde_legacy,
    plan_semanal_desde_legacy,
    recorte_desde_texto,
    texto_limpio,
    una_fila_por_codigo,
    ventana_plan_semanal,
)
from backend.infrastructure.auditoria_movimientos import ahora_ar

PASOS = ("catalogos", "proveedores", "insumos", "precios", "stock", "recortes", "lineas",
         "cortes", "canera", "plan_semanal")

# Los pasos del ESPEJO que corre el sync en cada pasada mientras el Integral es el dueño
# (application/materia_prima/dueno.py). Todos menos recortes: ese paso sólo AGREGA (un
# recorte que el viejo borra porque se usó quedaría acá como disponible para siempre), así
# que repetido cada pocos minutos no refleja al viejo, lo engorda. Queda la foto de la
# primera importación.
PASOS_ESPEJO = tuple(p for p in PASOS if p != "recortes")

# Lo que cuenta como CAMBIO en cada paso (los conteos que dicen qué se escribió). Con el
# viejo igual, una segunda corrida los deja todos en 0 (tests/test_materia_prima_
# importacion.py); el espejo del sync los suma para su renglón del log.
CAMBIOS = {
    "catalogos": ("materiales nuevos", "calidades nuevas"),
    "proveedores": ("proveedores nuevos", "proveedores actualizados"),
    "insumos": ("piezas en SPMM que cambian (UPDATE, conservan id)",
                "códigos que faltan en SPMM (INSERT)", "sólo en SPMM → inactivo=1 (no se borran)"),
    "precios": ("precios nuevos (origen import)",),
    "stock": ("movimientos nuevos (origen legacy)", "piezas cuyo stock cambia (caché = Σ movimientos)"),
    "recortes": ("recortes nuevos (origen legacy)",),
    "lineas": ("líneas que cambian (UPDATE, conservan id)", "líneas nuevas (INSERT)",
               "líneas que ya no están en el viejo (DELETE, con copia)",
               "  ídem pero con consumos o stock: usado=0 en vez de borrar",
               "piezas creadas inactivas (código de línea sin pieza)",
               "OT que pasan a «no lleva materia prima»",
               "OT que dejan de ser «no lleva materia prima»"),
    "cortes": ("líneas cuyos cortes cambian (se reemplazan)",),
    "canera": ("ocupaciones nuevas (origen legacy)",
               "ocupaciones del viejo que se cierran (hasta = ahora)"),
    "plan_semanal": ("OT de una semana que se agregan (INSERT)",
                     "OT de una semana que cambian (UPDATE)",
                     "OT de una semana que ya no están en el Integral (DELETE)"),
}

# El candado de la corrida (pg_try_advisory_xact_lock): el sync corre el espejo cada
# pocos minutos y alguien puede correr este script a mano al mismo tiempo. Es de
# TRANSACCIÓN y no de sesión porque se va por el pooler 6543 en modo transaction, que
# reparte las sesiones: un candado de sesión quedaría colgado de una conexión ajena.
CANDADO = 20260923

BACKUP_PIEZA = "backup_20260923_pieza"
BACKUP_LINEA = "backup_20260923_orden_trabajo_pieza"
COPIAS = (BACKUP_PIEZA, BACKUP_LINEA)

# `respaldar` de importar(): True copia a todas (el script a mano), False a ninguna, y
# SI_NO_HAY_COPIA (el espejo del sync) sólo a las backup_* que todavía no existen, tabla por
# tabla. El espejo antes decidía por «ninguna pieza con origen» (la primera pasada), y eso
# dejaba un hueco: si esa pasada escribía los insumos y fallaba en el paso lineas (una fila
# tomada por la app más de 10 s), la siguiente ya tenía piezas con origen y reescribía las
# líneas SIN copia (medido en local el 24/09: 1.211 líneas reescritas y la copia de líneas
# nunca creada). Por tabla, cada una se copia la primera vez que de verdad se reescribe.
# Se decide al empezar la corrida, con el candado tomado: dentro de una misma corrida los
# pasos que tocan la misma tabla (insumos y stock, las dos sobre pieza) copian todos.
SI_NO_HAY_COPIA = "si_no_hay_copia"

# Los tiempos de la corrida con --aplicar (y del espejo del sync), para que un Integral
# colgado no deje tomados los locks de Supabase ni el candado:
#   · la SEGUNDA lectura del Integral (releer_lineas_del_viejo) corre con la transacción de
#     Supabase abierta: tiene TOPE_RELECTURA_SEG en total (y cada consulta el mismo tope en
#     el driver, que la cancela del lado del SQL Server). Si no llega, el paso lineas falla
#     sin escribir nada, los anteriores quedan y la pasada siguiente lo vuelve a intentar;
#   · y por si igual algo deja la transacción quieta (el proceso colgado en otra cosa),
#     Postgres corta la sesión a los TOPE_OCIOSO_EN_TRANSACCION sin actividad y suelta los
#     locks y el candado (en producción idle_in_transaction_session_timeout vale 0: sin
#     esto, nunca). Va con margen sobre el tope de la relectura, que es la espera más larga
#     esperable entre dos sentencias de la corrida.
TOPE_RELECTURA_SEG = 30
TOPE_OCIOSO_EN_TRANSACCION = "60s"

# De a cuántas filas va cada INSERT/UPDATE con unnest: sentencias de tamaño razonable
# por el pooler, sin un viaje por fila.
TANDA = 2000

# Tope de líneas de OT que una corrida puede borrar (o apagar con usado=0, las que tienen
# consumos). Un número así no es una limpieza, es una lectura rota: el Integral devolvió
# la mitad, o una OT se leyó en medio de un «Grabar» (ver paso_lineas). En el ESPEJO del
# sync (frenar_en_tope) una corrida por encima del tope no borra ninguna y lo avisa en el
# log; a mano (el script) avisa y sigue: la primera importación sí puede borrar más, y ahí
# hay alguien mirando. Mismo número que el arreglo del sync para la prueba piloto (rama
# fix/sync-mp-marcas-reales, 24/09/2026), calibrado contra producción: su primera pasada
# borraba 261 líneas de las OT abiertas, y las pasadas siguientes, las pocas que Maxi
# cambia entre una y otra; las OT abiertas tienen ≈840 líneas, así que un borrado de todo
# o de la mitad queda afuera.
TOPE_BORRADO_LINEAS = 400

# ─────────────────────────── lecturas del viejo (T-SQL, sólo SELECT) ───────────────────────────

Q_MATERIAL = "SELECT idMAterial, Descripcion, calidad FROM dbo.Material"
Q_PROVEEDOR = """
SELECT idProveedor, Descripcion, fantasia, cuit, telefono, celular, mail, direccion,
       localidad, obs, inactivo
FROM dbo.Proveedor
"""
Q_HISTORIAL = "SELECT Idpieza, precio, fecha FROM dbo.HistorialPieza"
Q_MOVSTOCK = "SELECT IdPIEZA, FECHA, COMENTARIO, DEBE, ot FROM dbo.MOVSTOCK"
Q_RECORTES = "SELECT idpieza, recorte FROM dbo.recortes"
# SIN ORDER BY a propósito: las tablas del viejo no tienen índice ni clave, así que se
# leen en el orden físico, que es el mismo en que las muestra su pantalla. Ese es el
# «orden de carga» de las líneas (y de los cortes) dentro de cada OT.
Q_LINEAS = """
SELECT Idot, idpieza, descripcion, cantidad, un, proveedor, observaciones, pendiente,
       reserva, creserva, disponible, pedido, fechaprov, usado, fechaProvE
FROM dbo.otrabajoMprimas
"""
# La relectura de las líneas antes de borrar (ver paso_lineas): las mismas columnas, sólo
# de unas OT. Los números los pone el script (enteros de SPMM), no un usuario.
Q_LINEAS_DE_ESTAS_OT = Q_LINEAS.rstrip() + "\nWHERE Idot IN ({ids})\n"
# La cabecera de las OT del viejo: la marca «no lleva materia prima», y artículo, cliente
# y fecha para saber si una OT de SPMM ES la del viejo con ese número y no otra (una OT
# dada de alta en SPMM toma max+1, que el viejo puede estar usando): ots_del_viejo.
Q_OTRABAJO = ("SELECT idot, LTRIM(RTRIM(idarticulo)) AS idarticulo, idcliente, fecha, NOLLEVAMP "
              "FROM dbo.otrabajo")
Q_CORTES = "SELECT idot, idpieza, cant, largo FROM dbo.otcortesmp"
Q_CANERA = "SELECT ubicacion, ot FROM dbo.caniera"
# El plan semanal, sólo la ventana (leer_viejo pone las fechas: el primer lunes y el lunes
# siguiente al último, en 'yyyymmdd', el único formato que este SQL Server lee sin
# confundir día y mes). Un día que no es lunes cae en la semana de su lunes, así que se
# pide hasta el domingo de la última semana.
Q_PLAN_SEMANAL = """
SELECT fecha, ot, PRIORIDAD
FROM dbo.plansemanal
WHERE fecha >= '{desde}' AND fecha < '{hasta}'
"""


def _q_piezas():
    # La misma consulta que el paso 7b del sync: las dos conversiones leen lo mismo.
    from backend.scripts.sync_db import Q_CATALOGO_VIEJO
    return Q_CATALOGO_VIEJO


LECTURAS = {
    "material": (Q_MATERIAL, ("catalogos",)),
    "proveedor": (Q_PROVEEDOR, ("proveedores",)),
    "pieza": (None, ("catalogos", "insumos")),
    "historial": (Q_HISTORIAL, ("precios",)),
    "movstock": (Q_MOVSTOCK, ("stock",)),
    "recortes": (Q_RECORTES, ("recortes",)),
    "lineas": (Q_LINEAS, ("lineas", "cortes")),
    # stock y canera también: el número de OT que nombran se cuelga de la OT de SPMM sólo
    # si ES la del viejo (ots_del_viejo).
    "otrabajo": (Q_OTRABAJO, ("stock", "lineas", "cortes", "canera", "plan_semanal")),
    "cortes": (Q_CORTES, ("cortes",)),
    "canera": (Q_CANERA, ("canera",)),
    "plansemanal": (Q_PLAN_SEMANAL, ("plan_semanal",)),
}


def limites_plan_semanal(ventana) -> tuple[str, str]:
    """('yyyymmdd' del primer lunes, 'yyyymmdd' del lunes siguiente al último) de la
    ventana: el rango [desde, hasta) de fechas del Integral que la forman. Lo usan la
    lectura de acá y la huella del sync (scripts/sync_huella.py), que mira lo mismo."""
    desde, hasta = ventana
    return f"{desde:%Y%m%d}", f"{hasta + timedelta(days=7):%Y%m%d}"


def q_plan_semanal(ventana) -> str:
    """Q_PLAN_SEMANAL con las fechas de la ventana (primer lunes, último lunes)."""
    desde, hasta = limites_plan_semanal(ventana)
    return Q_PLAN_SEMANAL.format(desde=desde, hasta=hasta)


async def leer_viejo(pasos, silencioso: bool = False, ventana=None) -> dict[str, list[dict]]:
    """Lo que leen esos pasos del viejo. `ventana` es la del plan semanal (la misma que
    usa después el paso: importar() la calcula una vez); None = la de hoy."""
    from backend.scripts.sync_db import _leer

    viejo = {}
    for nombre, (consulta, usan) in LECTURAS.items():
        if not set(usan) & set(pasos):
            continue
        if nombre == "plansemanal":
            consulta = q_plan_semanal(ventana or ventana_plan_semanal())
        viejo[nombre] = await _leer(consulta or _q_piezas())
        if not silencioso:
            print(f"  viejo: {nombre:<10} {len(viejo[nombre]):>6} filas", flush=True)
    return viejo


# Por qué columna dice cada lectura del viejo de qué OT es (su número visible).
_COLUMNA_OT = {"lineas": "Idot", "cortes": "idot", "otrabajo": "idot", "canera": "ot",
               "plansemanal": "ot"}


def filtrar_ots(viejo: dict[str, list[dict]], ots) -> dict[str, list[dict]]:
    """Lo leído del viejo con las lecturas de OT (líneas, cortes, cabecera, cañera y plan
    semanal) limitadas a esas OT (--ots). El catálogo, los precios, el stock y los
    recortes no son de ninguna OT: quedan enteros. La cabecera entera queda además en
    «otrabajo_todas»: el stock cuelga cada movimiento de su OT, y eso no depende de --ots."""
    if not ots:
        return viejo
    ots = set(ots)
    salida = {nombre: ([f for f in filas if f.get(_COLUMNA_OT[nombre]) in ots]
                       if nombre in _COLUMNA_OT else filas)
              for nombre, filas in viejo.items()}
    if "otrabajo" in viejo:
        salida["otrabajo_todas"] = viejo["otrabajo"]
    return salida


# ─────────────────────────── columnas y tipos ───────────────────────────

# Lo que la importación escribe de una pieza (y compara para saber si cambió). NO están
# stock_minimo ni stock_bajo_avisado_en (son de SPMM) ni stockactual (lo escribe sólo
# el paso stock, como caché de los movimientos).
COLS_PIEZA = {
    "descripcion": "text", "unitario": "float8", "unidad": "text", "tipo": "text",
    "id_material": "int4", "id_calidad": "int4", "id_formato": "int4",
    "sistema_medida": "text", "medida1": "float8", "medida2": "float8", "medida3": "float8",
    "medida4": "float8", "medida5": "float8", "inactivo": "int4",
    "fecha_ultimo_precio": "date", "estante": "text", "letra": "text", "nro": "text",
    "proveedor": "text", "id_proveedor": "int4", "material": "text", "formato": "text",
    "observaciones": "text", "origen": "text",
}
COLS_LINEA = {
    "descripcion": "text", "cantidad": "float8", "unidad": "text", "proveedor": "text",
    "id_proveedor": "int4", "observaciones": "text", "pedido": "int4", "disponible": "int4",
    "reserva": "int4", "cantidad_reservada": "float8", "en_produccion": "int4",
    "usado": "int4", "fecha_proveedor": "date", "fecha_entrega": "date", "orden": "int4",
    "origen": "text",
}
COLS_PROVEEDOR = {
    "razon_social": ("text", 200), "fantasia": ("text", 200), "cuit": ("text", 20),
    "telefono": ("text", 60), "celular": ("text", 60), "mail": ("text", 120),
    "direccion": ("text", 200), "localidad": ("text", 100), "observaciones": ("text", None),
    "inactivo": ("int4", None),
}

# Lo que tiene que existir para que esto tenga dónde escribir.
REQUERIDO = {
    "material": ("id", "nombre", "letra_codigo"),
    "material_calidad": ("id", "id_material", "nombre"),
    "formato": ("id", "nombre", "iniciales"),
    "proveedor": ("id", "id_legacy", "razon_social"),
    "pieza_movimiento": ("id_pieza", "origen", "anulado"),
    "pieza_precio": ("id_pieza", "origen"),
    "pieza_recorte": ("id_pieza", "texto_original", "origen"),
    "orden_trabajo_pieza_corte": ("id_orden_trabajo_pieza", "texto_original"),
    "canera_ocupacion": ("columna", "fila", "ot_texto", "origen"),
    "pieza": tuple(COLS_PIEZA) + ("creado_en",),
    "orden_trabajo_pieza": tuple(COLS_LINEA) + ("id_movimiento_retiro", "creado_en"),
    "orden_trabajo": ("no_lleva_materia_prima",),
}


def _comparable(v):
    if v is None:
        return None
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, str):
        return v.strip() or None
    if isinstance(v, datetime) and (v.hour, v.minute, v.second, v.microsecond) == (0, 0, 0, 0):
        return v
    return v


def _igual(a, b) -> bool:
    """¿Es el mismo dato? Números con tolerancia (la base devuelve Decimal, el viejo
    float), textos sin las puntas y vacío = NULL (el viejo guarda ' ' en miles de celdas
    vacías: reescribirlas sería cambiar nada)."""
    a, b = _comparable(a), _comparable(b)
    numeros = (int, float)
    if isinstance(a, numeros) and isinstance(b, numeros):
        return math.isclose(float(a), float(b), rel_tol=1e-9, abs_tol=1e-6)
    return a == b


def _diferencias(actual: dict, nuevo: dict, columnas) -> list[str]:
    return [c for c in columnas if not _igual(actual.get(c), nuevo.get(c))]


def _corto(v, n=None):
    t = texto_limpio(v)
    return t[:n] if t and n else t


def _flag(v) -> bool:
    """Una tilde del viejo (bit, int o NULL) como bool: sólo 1 es sí."""
    try:
        return int(v) == 1
    except (TypeError, ValueError):
        return False


# ─────────────────────────── informe ───────────────────────────


class Paso:
    """Lo que hizo (o haría) un paso: conteos, ejemplos y advertencias para el resumen."""

    def __init__(self, nombre: str, ejemplos: int):
        self.nombre = nombre
        self.conteos: Counter = Counter()
        self.ejemplos: list[str] = []
        self.advertencias: list[str] = []
        self.alertas: list[str] = []
        self._max = ejemplos
        # Cuánto tardó (lo pone main): el día del corte el viejo está congelado mientras
        # corre esto, y hay que saber de antemano cuánto va a estar parado el taller.
        self.segundos: float | None = None

    def contar(self, clave: str, n: int = 1):
        self.conteos[clave] += n

    def ejemplo(self, texto: str):
        if len(self.ejemplos) < self._max:
            self.ejemplos.append(texto)

    def advertir(self, texto: str):
        self.advertencias.append(texto)

    def alertar(self, texto: str):
        """Una advertencia que tiene que llegar al log del sync como WARNING (el espejo
        manda las demás a DEBUG): algo que no se hizo a propósito y alguien tiene que
        mirar (el tope de borrado, una lectura vacía, una OT de SPMM que no es la del
        Integral)."""
        self.advertencias.append(texto)
        self.alertas.append(texto)

    def imprimir(self):
        tiempo = f" ({self.segundos:.1f} s)" if self.segundos is not None else ""
        print(f"\n── {self.nombre}{tiempo} " + "─" * max(4, 60 - len(self.nombre) - len(tiempo)))
        for clave, n in self.conteos.items():
            print(f"   {clave:<58} {n:>7}")
        if self.ejemplos:
            print("   ejemplos:")
            for e in self.ejemplos:
                print(f"     · {e}")
        for a in self.advertencias:
            print(f"   ⚠ {a}")


# ─────────────────────────── estado de SPMM ───────────────────────────


class Estado:
    """Lo que hay en SPMM, leído una vez por paso. En seco, los pasos lo modifican en
    memoria (con ids negativos para lo nuevo) para que el paso siguiente vea lo que
    habría quedado."""

    async def cargar(self, conn):
        f = conn.fetch
        self.materiales = [dict(r) for r in await f("SELECT id, nombre, letra_codigo FROM material")]
        self.calidades = [dict(r) for r in await f("SELECT id, id_material, nombre FROM material_calidad")]
        self.formatos = [dict(r) for r in await f("SELECT id, nombre FROM formato")]
        self.proveedores = [dict(r) for r in await f(
            "SELECT id, id_legacy, " + ", ".join(COLS_PROVEEDOR) + " FROM proveedor")]
        self.piezas = [dict(r) for r in await f(
            "SELECT id, cod_pieza, stockactual, " + ", ".join(COLS_PIEZA) + " FROM pieza ORDER BY id")]
        # Por número visible (id_otvieja). Artículo, cliente (su número en el viejo) y
        # fecha son para ots_del_viejo. Un número que SPMM tiene en más de una OT queda en
        # numeros_repetidos: no se sabe cuál es la del viejo y no se toca ninguna.
        ots = [dict(r) for r in await f(
            "SELECT o.id, o.id_otvieja, o.no_lleva_materia_prima, a.cod_articulo, "
            "       c.id_viejo AS cliente_viejo, o.fecha_orden "
            "FROM orden_trabajo o LEFT JOIN articulo a ON a.id = o.id_articulo "
            "LEFT JOIN cliente c ON c.id = o.id_cliente "
            "WHERE o.id_otvieja IS NOT NULL ORDER BY o.id")]
        self.ots = {r["id_otvieja"]: r for r in ots}
        veces = Counter(r["id_otvieja"] for r in ots)
        self.numeros_repetidos = {n for n, v in veces.items() if v > 1}
        self.lineas = [dict(r) for r in await f(
            "SELECT id, id_orden_trabajo, id_pieza, id_movimiento_retiro, " + ", ".join(COLS_LINEA)
            + " FROM orden_trabajo_pieza")]
        self.lineas_con_consumo = {r[0] for r in await f(
            "SELECT DISTINCT id_orden_trabajo_pieza FROM consumo_material "
            "WHERE id_orden_trabajo_pieza IS NOT NULL")}
        self.lineas_con_movimiento = {r[0] for r in await f(
            "SELECT DISTINCT id_orden_trabajo_pieza FROM pieza_movimiento "
            "WHERE id_orden_trabajo_pieza IS NOT NULL")}
        self.movimientos_legacy = [dict(r) for r in await f(
            "SELECT id_pieza, fecha, cantidad FROM pieza_movimiento WHERE origen = 'legacy'")]
        self.saldos = {r["id_pieza"]: float(r["saldo"]) for r in await f(
            "SELECT id_pieza, SUM(cantidad) AS saldo FROM pieza_movimiento "
            "WHERE anulado = 0 GROUP BY id_pieza")}
        self.precios = {(r["id_pieza"], r["fecha"], round(float(r["precio"]), 4)) for r in await f(
            "SELECT id_pieza, fecha, precio FROM pieza_precio")}
        self.recortes_legacy = [dict(r) for r in await f(
            "SELECT id_pieza, texto_original FROM pieza_recorte WHERE origen = 'legacy'")]
        self.cortes = defaultdict(list)
        for r in await f("SELECT id, id_orden_trabajo_pieza, cantidad, largo_mm, ancho_mm, "
                         "texto_original, orden FROM orden_trabajo_pieza_corte ORDER BY orden, id"):
            self.cortes[r["id_orden_trabajo_pieza"]].append(dict(r))
        self.canera = [dict(r) for r in await f(
            "SELECT id, columna, fila, id_orden_trabajo, ot_texto, origen FROM canera_ocupacion "
            "WHERE hasta IS NULL")]
        return self

    # ── consultas ──

    def piezas_por_codigo(self) -> dict[str, list[dict]]:
        por = defaultdict(list)
        for p in self.piezas:
            por[norm_codigo(p["cod_pieza"])].append(p)
        return por

    def id_por_codigo(self) -> dict[str, int]:
        """Código normalizado → id. Con el código repetido (50%004) va el id más bajo:
        es la misma pieza física y el duplicado es herencia."""
        por = {}
        for p in sorted(self.piezas, key=lambda x: (x["id"] < 0, abs(x["id"]))):
            por.setdefault(norm_codigo(p["cod_pieza"]), p["id"])
        return por

    def catalogo(self) -> CatalogoLegado:
        return CatalogoLegado(
            materiales={m["nombre"]: m["id"] for m in self.materiales},
            calidades={(c["id_material"], c["nombre"]): c["id"] for c in self.calidades},
            formatos={f["nombre"]: f["id"] for f in self.formatos},
            proveedores=self.proveedores,
        )


async def releer_lineas_del_viejo(numeros) -> list[dict]:
    """La segunda lectura de paso_lineas: las líneas de esas OT, otra vez, del viejo (sólo
    SELECT, con _leer de sync_db.py). Con TOPE_RELECTURA_SEG en total: corre con la
    transacción de Supabase abierta (ver ahí); si no llega, levanta TimeoutError y el paso
    lineas falla sin escribir."""
    from backend.scripts.sync_db import _leer

    numeros = sorted({int(n) for n in numeros})

    async def _todas():
        filas = []
        for i in range(0, len(numeros), 1000):
            filas += await _leer(Q_LINEAS_DE_ESTAS_OT.format(
                ids=",".join(str(n) for n in numeros[i:i + 1000])), tope_seg=TOPE_RELECTURA_SEG)
        return filas

    try:
        return await asyncio.wait_for(_todas(), TOPE_RELECTURA_SEG)
    except asyncio.TimeoutError:
        # Con mensaje: un TimeoutError pelado deja «falló el paso lineas (TimeoutError: )».
        raise asyncio.TimeoutError(
            f"la segunda lectura del Integral no contestó en {TOPE_RELECTURA_SEG} s") from None


class Contexto:
    def __init__(self, conn, viejo, aplicar, ejemplos, respaldar=True, ots=None, releer=None,
                 tope_borrado=TOPE_BORRADO_LINEAS, frenar_en_tope=False, ventana=None):
        self.conn = conn
        self.viejo = viejo
        self.aplicar = aplicar
        self.ejemplos = ejemplos
        # A qué backup_* se copia lo que se reescribe o borra (ver COPIAS y SI_NO_HAY_COPIA):
        # True = a todas, False = a ninguna, o el conjunto que ya decidió importar(). El
        # espejo del sync no copia en cada pasada: se acumularía una copia por pasada.
        if isinstance(respaldar, str):
            raise ValueError("importar() resuelve SI_NO_HAY_COPIA antes de armar el Contexto")
        self.respaldar: set[str] = (set(COPIAS) if respaldar is True
                                    else set(respaldar) if respaldar else set())
        # Las OT a las que se limitan lineas, cortes y canera (--ots), o None = todas.
        self.ots: set[int] | None = set(ots) if ots else None
        # La segunda lectura del viejo antes de borrar líneas: async (números de OT) →
        # filas como las de Q_LINEAS. Los tests la reemplazan.
        self.releer_lineas = releer or releer_lineas_del_viejo
        # TOPE_BORRADO_LINEAS; con frenar_en_tope (el espejo del sync) una corrida por
        # encima no borra ninguna, sin él (a mano) avisa y sigue.
        self.tope_borrado = tope_borrado
        self.frenar_en_tope = frenar_en_tope
        self.ahora = ahora_ar()
        self.hoy = self.ahora.date()
        # La ventana del plan semanal (primer lunes, último lunes): la MISMA con que se leyó
        # dbo.plansemanal (importar() la pasa). None = la de `hoy`, al correr el paso.
        self.ventana = ventana
        self.estado: Estado | None = None
        self.pasos: list[Paso] = []
        self._falso = 0

    def id_falso(self) -> int:
        """Id de una fila que en seco «se habría insertado»."""
        self._falso -= 1
        return self._falso

    def paso(self, nombre) -> Paso:
        p = Paso(nombre, self.ejemplos)
        self.pasos.append(p)
        return p


# ─────────────────────────── escritura (sólo con --aplicar) ───────────────────────────


async def _respaldar(conn, tabla: str, backup: str, ids, ahora) -> int:
    """Copia las filas `ids` de `tabla` a `backup` tal como están, con la hora de la
    copia. La tabla de copia se crea la primera vez con las columnas de ese momento; las
    siguientes corridas agregan filas (cada corrida es una foto, se distinguen por
    respaldado_en)."""
    ids = sorted({int(i) for i in ids})
    if not ids:
        return 0
    await conn.execute(
        f"CREATE TABLE IF NOT EXISTS {backup} AS "
        f"SELECT *, NULL::timestamp AS respaldado_en FROM {tabla} WHERE false")
    # En Supabase una tabla nueva del esquema public queda publicada por su API REST
    # (los roles anon/authenticated reciben permisos por defecto) si no tiene RLS. La
    # copia tiene precios de compra: con RLS y sin políticas sólo la ve el dueño (el
    # usuario con que corre esto y la app), que la saltea. En un Postgres común no
    # cambia nada. Idempotente.
    await conn.execute(f"ALTER TABLE {backup} ENABLE ROW LEVEL SECURITY")
    columnas =[r["column_name"] for r in await conn.fetch(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() "
        "AND table_name = $1 AND column_name <> 'respaldado_en' ORDER BY ordinal_position", backup)]
    lista = ", ".join(columnas)
    await conn.execute(
        f"INSERT INTO {backup} ({lista}, respaldado_en) "
        f"SELECT {lista}, $1::timestamp FROM {tabla} WHERE id = ANY($2::int[])", ahora, ids)
    return len(ids)


async def copias_a_hacer(conn, respaldar) -> set[str]:
    """A qué backup_* copia esta corrida (ver SI_NO_HAY_COPIA). Con SI_NO_HAY_COPIA mira, tabla
    por tabla, si la copia ya existe; es sólo lectura del catálogo."""
    if respaldar == SI_NO_HAY_COPIA:
        return {b for b in COPIAS if await conn.fetchval("SELECT to_regclass($1::text) IS NULL", b)}
    return set(COPIAS) if respaldar else set()


async def _copiar(ctx, paso, tabla: str, backup: str, ids) -> None:
    """_respaldar, si esta corrida copia a esa tabla (ctx.respaldar), y contarlo en el paso."""
    if backup in ctx.respaldar:
        paso.contar("filas copiadas a " + backup, await _respaldar(ctx.conn, tabla, backup, ids, ctx.ahora))


def _tandas(filas):
    for i in range(0, len(filas), TANDA):
        yield filas[i:i + TANDA]


async def _actualizar(conn, tabla: str, filas: list[dict], tipos: dict[str, str]):
    """UPDATE de muchas filas por id en pocas sentencias (unnest). Cada fila trae «id»
    y las columnas de `tipos`; se escriben todas las de `tipos` (las que no cambiaron
    quedan igual)."""
    columnas = list(tipos)
    sets = ", ".join(f"{c} = v.{c}" for c in columnas)
    args = ", ".join(f"${i + 2}::{tipos[c]}[]" for i, c in enumerate(columnas))
    sql = (f"UPDATE {tabla} t SET {sets} FROM unnest($1::int[], {args}) "
           f"AS v(id, {', '.join(columnas)}) WHERE t.id = v.id")
    for tanda in _tandas(filas):
        await conn.execute(sql, [f["id"] for f in tanda], *[[f.get(c) for f in tanda] for c in columnas])


async def _insertar(conn, tabla: str, filas: list[dict], tipos: dict[str, str], devolver=None):
    columnas = list(tipos)
    args = ", ".join(f"${i + 1}::{tipos[c]}[]" for i, c in enumerate(columnas))
    sql = (f"INSERT INTO {tabla} ({', '.join(columnas)}) "
           f"SELECT * FROM unnest({args})")
    if devolver:
        sql += f" RETURNING {devolver}"
    salida = []
    for tanda in _tandas(filas):
        valores = [[f.get(c) for f in tanda] for c in columnas]
        if devolver:
            salida.extend(dict(r) for r in await conn.fetch(sql, *valores))
        else:
            await conn.execute(sql, *valores)
    return salida


class _Escrituras:
    """La conexión asyncpg, contando las sentencias que escriben. Sirve para no volver a
    leer todo SPMM después de un paso que no cambió nada: en el espejo del sync (cada
    pocos minutos) casi ningún paso cambia algo, y releer las 17 mil piezas y los 37 mil
    precios nueve veces por pasada sería tráfico a Supabase por nada."""

    _VERBOS = ("INSERT", "UPDATE", "DELETE", "CREATE", "ALTER")

    def __init__(self, conn):
        self._conn = conn
        self.escrituras = 0

    def __getattr__(self, nombre):
        return getattr(self._conn, nombre)

    def _contar(self, sql: str):
        if sql.lstrip().upper().startswith(self._VERBOS):
            self.escrituras += 1

    async def execute(self, sql, *args, **kw):
        self._contar(sql)
        return await self._conn.execute(sql, *args, **kw)

    async def fetch(self, sql, *args, **kw):
        self._contar(sql)  # un INSERT ... RETURNING va por fetch
        return await self._conn.fetch(sql, *args, **kw)


class _Transaccion:
    """El SAVEPOINT de un paso, con lock_timeout: dentro de la transacción de la corrida
    (importar() la abre, con el candado), así el paso que falla no deja nada escrito y
    los anteriores quedan. En seco no abre nada."""

    def __init__(self, ctx, recargar: bool = True):
        self.ctx = ctx
        self.tx = None
        self.antes = None
        # False en un paso cuyas escrituras no cambian nada de lo que tiene el Estado (el
        # plan semanal): releer las 17 mil piezas para nada.
        self.recargar = recargar

    async def __aenter__(self):
        if self.ctx.aplicar:
            self.antes = getattr(self.ctx.conn, "escrituras", None)
            self.tx = self.ctx.conn.transaction()
            await self.tx.start()
            await self.ctx.conn.execute("SET LOCAL lock_timeout = '10s'")
        return self

    async def __aexit__(self, tipo, exc, tb):
        if self.tx is None:
            return False
        if exc is None:
            await self.tx.commit()
            # Con --aplicar los pasos no tocan el estado en memoria: lo vuelven a leer de
            # la base (ids nuevos incluidos). Si el paso no escribió nada, no cambió.
            if self.recargar and (self.antes is None or self.ctx.conn.escrituras != self.antes):
                await self.ctx.estado.cargar(self.ctx.conn)
        else:
            await self.tx.rollback()
        return False


# ─────────────────────────── pasos ───────────────────────────


def _espacios(s) -> str:
    return " ".join(str(s or "").split())


async def paso_catalogos(ctx: Contexto):
    paso = ctx.paso("catalogos")
    est = ctx.estado
    piezas = ctx.viejo["pieza"]

    # Materiales: los de dbo.Material y los que usan las piezas. Por nombre sin mirar
    # mayúsculas (el índice único es sobre upper(nombre)).
    nombres = {}
    for m in ctx.viejo["material"]:
        n = _espacios(m.get("Descripcion"))
        if n:
            nombres.setdefault(n.upper(), n)
    for p in piezas:
        n = _espacios(p.get("material"))
        if n:
            nombres.setdefault(n.upper(), n)
    existentes = {m["nombre"].upper(): m for m in est.materiales}
    nuevos = [n for clave, n in sorted(nombres.items()) if clave not in existentes]
    paso.contar("materiales en el viejo", len(nombres))
    paso.contar("materiales nuevos", len(nuevos))
    for n in nuevos[:ctx.ejemplos]:
        paso.ejemplo(f"material {n} (letra {n[0].upper()})")

    # Calidades: las de dbo.Material (su spelling manda) y las que se leen en las
    # descripciones de las piezas tipo insumo, cada una colgada de su material.
    todos_materiales = list(nombres.values())
    calidades: dict[tuple[str, str], str] = {}
    lecturas: dict[tuple[str, str], Counter] = defaultdict(Counter)
    for m in ctx.viejo["material"]:
        mat, cal = _espacios(m.get("Descripcion")), _espacios(m.get("calidad"))
        if mat and cal:
            calidades.setdefault((mat.upper(), cal.upper()), cal)
    for p in piezas:
        if p.get("insumo") != 0:
            continue
        mat, cal = material_y_calidad_desde_descripcion(
            p.get("descripcion"), p.get("material"), todos_materiales, p.get("formato"))
        if mat and cal:
            lecturas[(mat.upper(), cal.upper())][cal] += 1
    for clave, variantes in lecturas.items():
        calidades.setdefault(clave, variantes.most_common(1)[0][0])

    async with _Transaccion(ctx):
        ids_material = {m["nombre"].upper(): m["id"] for m in est.materiales}
        if nuevos:
            filas = [{"nombre": n[:80], "letra_codigo": n[0].upper()} for n in nuevos]
            if ctx.aplicar:
                for r in await _insertar(ctx.conn, "material", filas,
                                         {"nombre": "text", "letra_codigo": "text"}, "id, nombre"):
                    ids_material[r["nombre"].upper()] = r["id"]
            else:
                for f in filas:
                    f["id"] = ctx.id_falso()
                    est.materiales.append(f)
                    ids_material[f["nombre"].upper()] = f["id"]

        ya = {(c["id_material"], c["nombre"].upper()) for c in est.calidades}
        nuevas = []
        for (mat, _), cal in sorted(calidades.items()):
            id_material = ids_material.get(mat)
            if id_material is None or (id_material, cal.upper()) in ya:
                continue
            ya.add((id_material, cal.upper()))
            nuevas.append({"id_material": id_material, "nombre": cal[:80], "_material": mat})
        paso.contar("calidades en el viejo (tabla + descripciones)", len(calidades))
        paso.contar("calidades nuevas", len(nuevas))
        for c in nuevas[:ctx.ejemplos]:
            paso.ejemplo(f"calidad {c['_material']} / {c['nombre']}")
        if nuevas:
            if ctx.aplicar:
                await _insertar(ctx.conn, "material_calidad", nuevas,
                                {"id_material": "int4", "nombre": "text"})
            else:
                for c in nuevas:
                    est.calidades.append({"id": ctx.id_falso(), **c})


def _proveedor_desde_legacy(fila: dict) -> dict:
    datos = {
        "razon_social": _corto(fila.get("Descripcion"), 200) or _corto(fila.get("fantasia"), 200)
                        or f"PROVEEDOR {fila.get('idProveedor')}",
        "fantasia": _corto(fila.get("fantasia"), 200),
        "cuit": _corto(fila.get("cuit"), 20),
        "telefono": _corto(fila.get("telefono"), 60),
        "celular": _corto(fila.get("celular"), 60),
        "mail": _corto(fila.get("mail"), 120),
        "direccion": _corto(fila.get("direccion"), 200),
        "localidad": _corto(fila.get("localidad"), 100),
        "observaciones": _corto(fila.get("obs")),
        "inactivo": 1 if _flag(fila.get("inactivo")) else 0,
    }
    return datos


async def paso_proveedores(ctx: Contexto):
    paso = ctx.paso("proveedores")
    est = ctx.estado
    por_legacy = {p["id_legacy"]: p for p in est.proveedores if p["id_legacy"] is not None}
    nuevos, cambiados = [], []
    for fila in ctx.viejo["proveedor"]:
        datos = _proveedor_desde_legacy(fila)
        actual = por_legacy.get(fila["idProveedor"])
        if actual is None:
            nuevos.append({"id_legacy": fila["idProveedor"], **datos})
        else:
            dif = _diferencias(actual, datos, COLS_PROVEEDOR)
            if dif:
                cambiados.append({"id": actual["id"], **datos})
                paso.ejemplo(f"{datos['razon_social']}: cambia {', '.join(dif)}")
    paso.contar("proveedores en el viejo", len(ctx.viejo["proveedor"]))
    paso.contar("proveedores nuevos", len(nuevos))
    paso.contar("  inactivos (de los nuevos)", sum(p["inactivo"] for p in nuevos))
    paso.contar("proveedores actualizados", len(cambiados))
    paso.contar("proveedores dados de alta en SPMM (no se tocan)",
                sum(1 for p in est.proveedores if p["id_legacy"] is None))
    for p in nuevos[:max(0, ctx.ejemplos - len(paso.ejemplos))]:
        paso.ejemplo(f"alta {p['id_legacy']} {p['razon_social']} / {p['fantasia'] or '-'}")

    tipos = {c: t for c, (t, _) in COLS_PROVEEDOR.items()}
    async with _Transaccion(ctx):
        if ctx.aplicar:
            if nuevos:
                for p in nuevos:
                    p["creado_en"] = ctx.ahora
                await _insertar(ctx.conn, "proveedor", nuevos,
                                {"id_legacy": "int4", **tipos, "creado_en": "timestamp"})
            if cambiados:
                await _actualizar(ctx.conn, "proveedor", cambiados, tipos)
        else:
            for p in nuevos:
                est.proveedores.append({"id": ctx.id_falso(), **p})
            for c in cambiados:
                next(p for p in est.proveedores if p["id"] == c["id"]).update(c)


async def paso_insumos(ctx: Contexto):
    paso = ctx.paso("insumos")
    est = ctx.estado
    if not ctx.viejo["pieza"]:
        # Sin esto, un catálogo que vino vacío dejaría inactivas las 17 mil piezas («sólo
        # en SPMM»). Una lectura vacía es una lectura que falló, no un viejo sin insumos.
        paso.alertar("el Integral no devolvió ningún insumo (dbo.pieza): no se toca el catálogo")
        return
    catalogo = est.catalogo()
    viejo = una_fila_por_codigo(ctx.viejo["pieza"], ctx.hoy)
    spmm = est.piezas_por_codigo()

    cambios, altas, bajas = [], [], []
    por_columna = Counter()
    de_spmm = 0
    for codigo, fila in viejo.items():
        datos = pieza_desde_legacy(fila, catalogo, ctx.hoy)
        if datos["tipo"] == "insumo":
            paso.contar("tipo insumo: con medidas" if datos["medida1"] is not None
                        else "tipo insumo: SIN medidas (queda la descripción)")
        actuales = spmm.get(codigo)
        if not actuales:
            altas.append({"cod_pieza": str(fila.get("Idpieza")).strip(), **datos})
            continue
        for actual in actuales:
            if actual.get("origen") == "spmm":
                de_spmm += 1  # la dio de alta SPMM con un código que el viejo también tiene
                continue
            nuevo = dict(datos)
            # El proveedor preferido sólo se pone cuando el texto del viejo nombra a uno
            # de la lista sin dudas; si no, queda el que ya tenga (alguien lo pudo elegir
            # en la ficha entre dos corridas).
            if nuevo["id_proveedor"] is None:
                nuevo["id_proveedor"] = actual.get("id_proveedor")
            dif = _diferencias(actual, nuevo, COLS_PIEZA)
            if dif:
                cambios.append({"id": actual["id"], **nuevo})
                por_columna.update(dif)
                if len(paso.ejemplos) < ctx.ejemplos and set(dif) - {"origen", "tipo"}:
                    detalle = ", ".join(f"{c}: {actual.get(c)!r} → {nuevo.get(c)!r}"
                                        for c in dif if c not in ("origen",))[:220]
                    paso.ejemplo(f"{codigo} {detalle}")
    for codigo, actuales in spmm.items():
        if codigo in viejo:
            continue
        for actual in actuales:
            if actual.get("origen") == "spmm" or actual.get("inactivo") == 1:
                continue
            bajas.append({"id": actual["id"], "codigo": actual["cod_pieza"]})

    paso.contar("códigos en el viejo (normalizados)", len(viejo))
    paso.contar("piezas en SPMM que cambian (UPDATE, conservan id)", len(cambios))
    for col, n in por_columna.most_common():
        paso.contar(f"  cambia {col}", n)
    paso.contar("códigos que faltan en SPMM (INSERT)", len(altas))
    paso.contar("sólo en SPMM → inactivo=1 (no se borran)", len(bajas))
    if de_spmm:
        paso.contar("dados de alta en SPMM y también en el viejo (no se tocan)", de_spmm)
    for a in altas[:3]:
        paso.ejemplo(f"alta {a['cod_pieza']} {a['descripcion'][:60]} ({a['tipo']})")
    if bajas:
        paso.ejemplo("inactivas: " + ", ".join(repr(b["codigo"]) for b in bajas[:12])
                     + (" …" if len(bajas) > 12 else ""))

    async with _Transaccion(ctx):
        if ctx.aplicar:
            await _copiar(ctx, paso, "pieza", BACKUP_PIEZA,
                          [c["id"] for c in cambios] + [b["id"] for b in bajas])
            if cambios:
                await _actualizar(ctx.conn, "pieza", cambios, COLS_PIEZA)
            if bajas:
                await ctx.conn.execute("UPDATE pieza SET inactivo = 1 WHERE id = ANY($1::int[])",
                                       [b["id"] for b in bajas])
            if altas:
                for a in altas:
                    a["stockactual"] = 0.0
                    a["creado_en"] = ctx.ahora
                await _insertar(ctx.conn, "pieza", altas,
                                {"cod_pieza": "text", **COLS_PIEZA, "stockactual": "float8",
                                 "creado_en": "timestamp"})
        else:
            por_id = {p["id"]: p for p in est.piezas}
            for c in cambios:
                por_id[c["id"]].update(c)
            for b in bajas:
                por_id[b["id"]]["inactivo"] = 1
            for a in altas:
                est.piezas.append({"id": ctx.id_falso(), "stockactual": 0.0, **a})


async def paso_precios(ctx: Contexto):
    paso = ctx.paso("precios")
    est = ctx.estado
    ids = est.id_por_codigo()
    ya = set(est.precios)
    nuevos = []
    for fila in ctx.viejo["historial"]:
        codigo = norm_codigo(fila.get("Idpieza"))
        if codigo in ("", "0"):
            paso.contar("descartadas: compra sin código ('0' o vacío)")
            continue
        id_pieza = ids.get(codigo)
        if id_pieza is None:
            paso.contar("descartadas: código que no existe")
            continue
        try:
            precio = float(fila.get("precio"))
        except (TypeError, ValueError):
            precio = 0.0
        if not math.isfinite(precio) or precio <= 0:
            paso.contar("descartadas: precio 0 o negativo")
            continue
        fecha = fecha_desde_texto(fila.get("fecha"), ctx.hoy)
        if fecha is None:
            paso.contar("descartadas: fecha ilegible")
            continue
        clave = (id_pieza, fecha, round(precio, 4))
        if clave in ya:
            paso.contar("ya estaban (o repetidas en el viejo)")
            continue
        ya.add(clave)
        nuevos.append({"id_pieza": id_pieza, "fecha": fecha, "precio": round(precio, 4),
                       "origen": "import", "creado_en": ctx.ahora})
    paso.contar("filas en HistorialPieza", len(ctx.viejo["historial"]))
    paso.contar("precios nuevos (origen import)", len(nuevos))
    paso.contar("piezas con algún precio nuevo", len({n["id_pieza"] for n in nuevos}))
    codigos = {p["id"]: p["cod_pieza"] for p in est.piezas}
    for n in nuevos[:ctx.ejemplos]:
        paso.ejemplo(f"{codigos.get(n['id_pieza'])} {n['fecha']} ${n['precio']}")

    async with _Transaccion(ctx):
        if ctx.aplicar and nuevos:
            await _insertar(ctx.conn, "pieza_precio", nuevos,
                            {"id_pieza": "int4", "fecha": "date", "precio": "float8",
                             "origen": "text", "creado_en": "timestamp"})
        elif not ctx.aplicar:
            est.precios |= {(n["id_pieza"], n["fecha"], n["precio"]) for n in nuevos}


async def paso_stock(ctx: Contexto):
    paso = ctx.paso("stock")
    est = ctx.estado
    ids = est.id_por_codigo()
    # El movimiento se cuelga de la OT de SPMM sólo si ES la del viejo (ots_del_viejo); si
    # no, el número queda en el comentario, como el de una OT que SPMM no tiene.
    iguales, _ = ots_del_viejo(ctx)
    id_ot = {k: est.ots[k]["id"] for k in iguales}
    # Los que ya se importaron (anulados incluidos: si alguien anuló uno en SPMM, re-correr
    # no lo tiene que volver a sumar). Clave + n° de aparición: dos filas iguales del viejo
    # son dos movimientos.
    ya = Counter((m["id_pieza"], m["fecha"], round(float(m["cantidad"]), 3)) for m in est.movimientos_legacy)
    vistos = Counter()
    nuevos = []
    for fila in ctx.viejo["movstock"]:
        debe = fila.get("DEBE")
        try:
            debe = round(float(debe), 3)
        except (TypeError, ValueError):
            debe = 0.0
        if debe == 0:
            paso.contar("descartadas: DEBE = 0")
            continue
        codigo = norm_codigo(fila.get("IdPIEZA"))
        id_pieza = ids.get(codigo)
        if id_pieza is None:
            paso.contar("descartadas: código que no existe")
            paso.advertir(f"MOVSTOCK de {codigo!r} ({debe}): el código no existe en SPMM")
            continue
        fecha = fila.get("FECHA")
        if isinstance(fecha, date) and not isinstance(fecha, datetime):
            fecha = datetime(fecha.year, fecha.month, fecha.day)
        if fecha is None:
            paso.contar("descartadas: sin fecha")
            continue
        clave = (id_pieza, fecha, debe)
        vistos[clave] += 1
        if vistos[clave] <= ya[clave]:
            paso.contar("ya estaban")
            continue
        ot = fila.get("ot")
        comentario = texto_limpio(fila.get("COMENTARIO"))
        if ot and ot not in id_ot:
            comentario = ((comentario + " — ") if comentario else "") + f"OT {ot} del sistema viejo"
        nuevos.append({"id_pieza": id_pieza, "fecha": fecha,
                       "tipo": "ingreso" if debe > 0 else "egreso", "cantidad": debe,
                       "comentario": comentario, "id_orden_trabajo": id_ot.get(ot) if ot else None,
                       "origen": "legacy", "anulado": 0})
    paso.contar("filas en MOVSTOCK", len(ctx.viejo["movstock"]))
    paso.contar("movimientos nuevos (origen legacy)", len(nuevos))
    paso.contar("  ingresos", sum(1 for n in nuevos if n["tipo"] == "ingreso"))
    paso.contar("  egresos", sum(1 for n in nuevos if n["tipo"] == "egreso"))

    # El caché: stockactual = Σ movimientos no anulados, para TODAS las piezas (las que
    # no tienen movimientos quedan en 0: el stockactual del viejo no era stock).
    saldos = defaultdict(float, est.saldos)
    for n in nuevos:
        saldos[n["id_pieza"]] += n["cantidad"]
    cambian = []
    for p in est.piezas:
        nuevo = round(saldos.get(p["id"], 0.0), 3) + 0.0
        if not _igual(p.get("stockactual"), nuevo):
            cambian.append({"id": p["id"], "stockactual": nuevo, "_antes": p.get("stockactual"),
                            "_codigo": p["cod_pieza"]})
    paso.contar("piezas cuyo stock cambia (caché = Σ movimientos)", len(cambian))
    paso.contar("  quedan con stock > 0", sum(1 for p in est.piezas if round(saldos.get(p["id"], 0), 3) > 0))
    paso.contar("  quedan con stock < 0", sum(1 for p in est.piezas if round(saldos.get(p["id"], 0), 3) < 0))
    # Ejemplos de los dos casos: piezas con movimientos del viejo y piezas que quedan en 0.
    con_mov = [c for c in cambian if c["stockactual"] != 0]
    sin_mov = [c for c in cambian if c["stockactual"] == 0]
    mitad = ctx.ejemplos // 2
    for c in con_mov[:mitad] + sin_mov[:ctx.ejemplos - min(mitad, len(con_mov))]:
        paso.ejemplo(f"{c['_codigo'].strip()} {c['_antes']} → {c['stockactual']}")

    async with _Transaccion(ctx):
        if ctx.aplicar:
            if nuevos:
                await _insertar(ctx.conn, "pieza_movimiento", nuevos,
                                {"id_pieza": "int4", "fecha": "timestamp", "tipo": "text",
                                 "cantidad": "float8", "comentario": "text",
                                 "id_orden_trabajo": "int4", "origen": "text", "anulado": "int4"})
            if cambian:
                await _copiar(ctx, paso, "pieza", BACKUP_PIEZA, [c["id"] for c in cambian])
                # Se recalcula en la base (no con los números de arriba): si alguien cargó
                # un movimiento entre la lectura y esto, el caché igual queda bien.
                await ctx.conn.execute("""
                    UPDATE pieza p SET stockactual = COALESCE(s.saldo, 0)
                    FROM pieza q LEFT JOIN (
                        SELECT id_pieza, SUM(cantidad)::float8 AS saldo FROM pieza_movimiento
                        WHERE anulado = 0 GROUP BY id_pieza) s ON s.id_pieza = q.id
                    WHERE p.id = q.id AND p.stockactual IS DISTINCT FROM COALESCE(s.saldo, 0)
                """)
        else:
            est.movimientos_legacy += [dict(n) for n in nuevos]
            est.saldos = dict(saldos)
            por_id = {p["id"]: p for p in est.piezas}
            for c in cambian:
                por_id[c["id"]]["stockactual"] = c["stockactual"]


_RECORTE_CERO = re.compile(r"^0+(?:[.,]0*)?\s*(?:mm)?$", re.I)


async def paso_recortes(ctx: Contexto):
    paso = ctx.paso("recortes")
    est = ctx.estado
    ids = est.id_por_codigo()
    ya = Counter((r["id_pieza"], r["texto_original"]) for r in est.recortes_legacy)
    vistos = Counter()
    nuevos, huerfanos = [], Counter()
    for fila in ctx.viejo["recortes"]:
        codigo = norm_codigo(fila.get("idpieza"))
        texto = (texto_limpio(fila.get("recorte")) or "")[:60] or None
        if texto is None or _RECORTE_CERO.match(texto):
            # Un recorte de 0 mm no es un tramo sobrante: es una fila vacía de la grilla
            # «Grabar Recortes» (PLA367 tiene 8). Importarla sumaría 8 recortes
            # «disponibles» que no existen al contador de Pendientes y de la ficha.
            paso.contar("descartados: vacíos o '0' (no son un tramo)")
            continue
        id_pieza = ids.get(codigo)
        if id_pieza is None:
            huerfanos[codigo or "(vacío)"] += 1
            continue
        clave = (id_pieza, texto)
        vistos[clave] += 1
        if vistos[clave] <= ya[clave]:
            paso.contar("ya estaban")
            continue
        largo, ancho, cantidad, obs = recorte_desde_texto(texto)
        if largo is None:
            paso.contar("sin medida legible (queda el texto)")
        nuevos.append({"id_pieza": id_pieza, "largo_mm": largo, "ancho_mm": ancho,
                       "cantidad": cantidad, "observaciones": obs, "texto_original": texto,
                       "estado": "disponible", "origen": "legacy", "creado_en": ctx.ahora})
    paso.contar("filas en recortes", len(ctx.viejo["recortes"]))
    paso.contar("recortes nuevos (origen legacy)", len(nuevos))
    paso.contar("huérfanos (el código no existe)", sum(huerfanos.values()))
    if huerfanos:
        paso.advertir("recortes de códigos que no existen: "
                      + ", ".join(f"{c} ×{n}" for c, n in huerfanos.most_common()))
    codigos = {p["id"]: p["cod_pieza"] for p in est.piezas}
    for n in nuevos[:ctx.ejemplos]:
        paso.ejemplo(f"{codigos.get(n['id_pieza'])} '{n['texto_original']}' → largo {n['largo_mm']}"
                     f" ancho {n['ancho_mm']} ×{n['cantidad']}" + (f" ({n['observaciones']})" if n["observaciones"] else ""))

    async with _Transaccion(ctx):
        if ctx.aplicar and nuevos:
            await _insertar(ctx.conn, "pieza_recorte", nuevos,
                            {"id_pieza": "int4", "largo_mm": "float8", "ancho_mm": "float8",
                             "cantidad": "int4", "observaciones": "text", "texto_original": "text",
                             "estado": "text", "origen": "text", "creado_en": "timestamp"})
        elif not ctx.aplicar:
            est.recortes_legacy += [{"id_pieza": n["id_pieza"], "texto_original": n["texto_original"]}
                                    for n in nuevos]


def _es_de_spmm(linea) -> bool:
    """Una línea cargada en SPMM (a mano o con Traer historial): la importación no la
    toca nunca."""
    return linea.get("origen") in ("spmm", "historial")


def _dia(v) -> date | None:
    """La fecha sin la hora, venga como datetime, date o texto (SQLite la devuelve como
    texto en una consulta cruda)."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v).strip()[:10])
    except ValueError:
        return None


def _entero(v) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _cabecera(ctx) -> list[dict]:
    """La cabecera de las OT del viejo, ENTERA aunque se haya pedido --ots (filtrar_ots)."""
    return ctx.viejo.get("otrabajo_todas", ctx.viejo.get("otrabajo")) or []


def ots_del_viejo(ctx) -> tuple[set[int], dict[int, str]]:
    """Qué OT de SPMM SON la del viejo con su mismo número: (iguales, distintas).

    iguales    {número} de las OT de SPMM que coinciden con la del viejo en número,
               artículo, cliente y fecha. Sólo a ésas se les reflejan líneas, cortes,
               «no lleva», cañera y la OT de los movimientos de stock.
    distintas  {número: por qué} de las que tienen el número de una OT del viejo pero
               son OTRA OT (o SPMM tiene ese número en más de una OT). No se tocan y se
               avisa, para revisarlas a mano.
    Las que el viejo no tiene no van en ninguna: no hay contra qué compararlas, y no se
    tocan.

    POR QUÉ NO ALCANZA CON EL NÚMERO. SPMM numera sus OT nuevas con max(id_otvieja)+1
    (OrdenTrabajoService) y el Integral sigue numerando por su lado (el sync de OT está
    apagado desde el 2/9): el 24/09 SPMM iba por la 15918 y el Integral ya había creado la
    15919 y la 15920. La próxima OT creada en SPMM iba a salir 15919 y el espejo le iba a
    colgar el material de la 15919 del Integral (y comprárselo Maxi dos veces). Con el
    artículo solo no alcanza: el mismo artículo se fabrica muchas veces. Mismo
    criterio que el arreglo del sync para la prueba piloto (rama fix/sync-mp-marcas-reales,
    _emparejar_ots): medido el 24/09/2026, las 1.327 OT de SPMM que están en el Integral
    coinciden en las tres cosas, así que hoy no deja afuera ninguna.

    El artículo se compara normalizado (sin mayúsculas ni espacios de las puntas), el
    cliente por su número en el viejo (cliente.id_viejo), la fecha por el día (la de SPMM
    es fecha_orden, que vino del viejo cuando el sync traía las OT). Dos vacíos son iguales.
    """
    cabecera = {f.get("idot"): f for f in _cabecera(ctx)}
    est = ctx.estado
    iguales, distintas = set(), {}
    for numero, ot in est.ots.items():
        leg = cabecera.get(numero)
        if leg is None:
            continue
        if numero in est.numeros_repetidos:
            distintas[numero] = "SPMM tiene ese número en más de una OT"
            continue
        motivos = []
        art_spmm, art_viejo = norm_codigo(ot.get("cod_articulo")), norm_codigo(leg.get("idarticulo"))
        if art_spmm != art_viejo:
            motivos.append(f"artículo {art_spmm or '(vacío)'} en SPMM y {art_viejo or '(vacío)'} en el Integral")
        cli_spmm, cli_viejo = _entero(ot.get("cliente_viejo")), _entero(leg.get("idcliente"))
        if cli_spmm != cli_viejo:
            motivos.append(f"cliente {cli_spmm} en SPMM y {cli_viejo} en el Integral")
        dia_spmm, dia_viejo = _dia(ot.get("fecha_orden")), _dia(leg.get("fecha"))
        if dia_spmm != dia_viejo:
            fecha = lambda d: f"{d:%d/%m/%Y}" if d else "(vacía)"
            motivos.append(f"fecha {fecha(dia_spmm)} en SPMM y {fecha(dia_viejo)} en el Integral")
        if motivos:
            distintas[numero] = "; ".join(motivos)
        else:
            iguales.add(numero)
    return iguales, distintas


def _lineas_por_ot(est, codigos) -> dict[int, list[dict]]:
    """Las líneas de SPMM que la importación puede tocar (origen legacy o anterior a la
    importación), por OT y en su orden (`orden`, después id), cada una con su código."""
    por = defaultdict(list)
    for l in est.lineas:
        if not _es_de_spmm(l):
            por[l["id_orden_trabajo"]].append(dict(l, codigo=codigos.get(l["id_pieza"], "")))
    for lineas in por.values():
        lineas.sort(key=lambda l: (l.get("orden") is None, l.get("orden") or 0, abs(l["id"])))
    return por


async def paso_lineas(ctx: Contexto):
    paso = ctx.paso("lineas")
    est = ctx.estado
    ids = est.id_por_codigo()
    unidades = {p["id"]: p.get("unidad") for p in est.piezas}
    codigos = {p["id"]: p["cod_pieza"] for p in est.piezas}
    proveedores = indice_proveedores(est.proveedores)

    por_ot = defaultdict(list)
    for fila in ctx.viejo["lineas"]:
        por_ot[fila.get("Idot")].append(fila)
    # Una lectura VACÍA de todas las líneas es una lectura que falló, no un Integral sin
    # materiales: con ella, cada OT de la cabecera quedaría «sin ninguna línea» y el
    # espejo borraría todo. No se borra ni se apaga nada. (Con --ots sí puede venir vacía:
    # la OT pedida se quedó sin líneas; ahí cuida la segunda lectura.)
    lectura_vacia = not ctx.viejo["lineas"] and ctx.ots is None
    if lectura_vacia:
        paso.alertar("el Integral no devolvió ninguna línea de materia prima: no se borra ni se "
                     "apaga ninguna línea en esta corrida")
    else:
        # Las OT que en el viejo no tienen NINGUNA línea también se miran, con la lista
        # vacía: si allá se sacó la última, acá se tienen que ir las que quedaban (gana el
        # Integral; sin esto el espejo mostraría para siempre una línea que Carolina borró).
        # Sólo las de la cabecera del viejo: una OT que el viejo no tiene no se toca.
        for fila in ctx.viejo["otrabajo"]:
            if fila.get("idot") not in por_ot:
                por_ot[fila.get("idot")] = []

    cambios, altas, borrar, apagar = [], [], [], []
    piezas_nuevas: dict[str, dict] = {}
    por_columna = Counter()
    ots_tocadas = 0
    ejemplos_ot = {15692, 14534, 15243}
    por_ot_spmm = _lineas_por_ot(est, codigos)
    de_spmm = Counter(l["id_orden_trabajo"] for l in est.lineas if _es_de_spmm(l))
    iguales, distintas = ots_del_viejo(ctx)
    numero_de = {ot["id"]: numero for numero, ot in est.ots.items()}
    for id_otvieja, filas in sorted(por_ot.items(), key=lambda x: x[0] or 0):
        ot = est.ots.get(id_otvieja)
        if ot is None:
            if filas:
                paso.contar("líneas del viejo de OT que no están en SPMM (no se traen)", len(filas))
            continue
        actuales = por_ot_spmm.get(ot["id"], [])
        if not filas and not actuales:
            continue  # nada acá y nada allá
        if id_otvieja not in iguales:
            # No es la OT del viejo con ese número (ots_del_viejo): ni se traen sus líneas
            # ni se borran las de acá.
            if id_otvieja in distintas:
                paso.contar("OT de SPMM que no son la del Integral (no se tocan)")
                paso.alertar(f"OT {id_otvieja}: la de SPMM no es la del Integral con ese número "
                             f"({distintas[id_otvieja]}); no se tocan sus líneas, cortes, «no lleva» "
                             f"ni cañera (revisar a mano)")
            else:
                paso.contar("OT sin cabecera en el Integral (no se tocan)")
            continue
        if filas:
            ots_tocadas += 1
        else:
            paso.contar("OT sin ninguna línea en el viejo (se van las de acá)")
        paso.contar("líneas cargadas en SPMM en estas OT (no se tocan)", de_spmm[ot["id"]])
        pares, nuevas, sobrantes = emparejar_lineas(actuales, filas, "codigo", "idpieza")
        orden_de = {id(f): i for i, f in enumerate(filas, start=1)}
        for actual, fila in pares:
            datos = linea_desde_legacy(fila, orden_de[id(fila)], unidades.get(actual["id_pieza"]),
                                       proveedores, ctx.hoy)
            dif = _diferencias(actual, datos, COLS_LINEA)
            if dif:
                cambios.append({"id": actual["id"], **datos})
                por_columna.update(dif)
                if id_otvieja in ejemplos_ot or len(paso.ejemplos) < ctx.ejemplos // 2:
                    paso.ejemplo(f"OT {id_otvieja} {actual['codigo'].strip()}: "
                                 + ", ".join(f"{c} {actual.get(c)!r}→{datos.get(c)!r}"
                                             for c in dif if c != "origen")[:200])
        for fila in nuevas:
            codigo = norm_codigo(fila.get("idpieza"))
            id_pieza = ids.get(codigo)
            if id_pieza is None:
                # El código no existe como pieza (104 líneas viejas, todas de OT cerradas):
                # se crea inactiva con la descripción de la línea, para no perder la línea.
                pieza = piezas_nuevas.get(codigo)
                if pieza is None:
                    pieza = piezas_nuevas[codigo] = {
                        "cod_pieza": str(fila.get("idpieza")).strip(),
                        "descripcion": (texto_limpio(fila.get("descripcion")) or codigo)[:255],
                        "unidad": None, "tipo": "insumo_desc", "inactivo": 1,
                        "origen": "legacy", "sistema_medida": "mm", "stockactual": 0.0,
                        "creado_en": ctx.ahora}
            datos = linea_desde_legacy(fila, orden_de[id(fila)], unidades.get(id_pieza),
                                       proveedores, ctx.hoy)
            altas.append({"id_orden_trabajo": ot["id"], "id_pieza": id_pieza, "_codigo": codigo,
                          "cantusada": 0.0, "creado_en": ctx.ahora, **datos})
            if id_otvieja in ejemplos_ot:
                paso.ejemplo(f"OT {id_otvieja} alta {codigo} {datos['cantidad']} {datos['unidad']} "
                             f"ped {datos['pedido']} disp {datos['disponible']} usado {datos['usado']}")
        if lectura_vacia:
            continue
        for actual in sobrantes:
            # Lo consumido y lo retirado de stock apuntan a la línea por id: esas no se
            # borran NUNCA, se apagan (usado=0) y se avisa.
            if (actual["id"] in est.lineas_con_consumo or actual["id"] in est.lineas_con_movimiento
                    or actual.get("id_movimiento_retiro")):
                if actual.get("usado") != 0:
                    apagar.append(actual)
                continue
            borrar.append(actual)

    # SEGUNDA LECTURA antes de borrar (o apagar): se va sólo lo que falta en LAS DOS. El
    # Integral graba la solapa de materiales de una OT borrando y volviendo a insertar sus
    # líneas, y su base no lee con snapshot (is_read_committed_snapshot_on = 0): una
    # lectura que cae en medio de un «Grabar» ve la OT sin líneas o con la mitad. Sin esto
    # esa OT perdía acá su material hasta la pasada siguiente, y volvía con otros ids (un
    # consumo cargado sobre el id viejo quedaba colgado). Lo que en la segunda lectura sí
    # está se deja: lo estaban grabando, y la pasada siguiente lo trae. Mismo criterio que
    # el arreglo del sync para la prueba piloto (fix/sync-mp-marcas-reales).
    if borrar or apagar:
        numeros = sorted({numero_de[l["id_orden_trabajo"]] for l in borrar + apagar})
        por_ot_2 = defaultdict(list)
        for fila in await ctx.releer_lineas(numeros):
            por_ot_2[fila.get("Idot")].append(fila)
        siguen_sobrando = set()
        for numero in numeros:
            _, _, sobrantes_2 = emparejar_lineas(por_ot_spmm.get(est.ots[numero]["id"], []),
                                                 por_ot_2.get(numero, []), "codigo", "idpieza")
            siguen_sobrando |= {l["id"] for l in sobrantes_2}
        volvieron = [l for l in borrar + apagar if l["id"] not in siguen_sobrando]
        if volvieron:
            paso.contar("líneas que no se borran: están en la segunda lectura del viejo", len(volvieron))
            paso.advertir(f"{len(volvieron)} líneas faltaban en la primera lectura del viejo y "
                          f"estaban en la segunda (lo estaban grabando): no se borran. "
                          + _describir_lineas(volvieron, numero_de))
            borrar = [l for l in borrar if l["id"] in siguen_sobrando]
            apagar = [l for l in apagar if l["id"] in siguen_sobrando]

    # El TOPE (TOPE_BORRADO_LINEAS): con más, es una lectura rota y no una limpieza.
    if len(borrar) + len(apagar) > ctx.tope_borrado:
        n = len(borrar) + len(apagar)
        if ctx.frenar_en_tope:
            paso.contar("líneas que no se borran por el tope de la pasada", n)
            paso.alertar(f"se iban a borrar (o apagar) {n} líneas, más que el tope de "
                         f"{ctx.tope_borrado} por pasada: no se borra ninguna. Revisar la lectura "
                         f"del Integral; si está bien (la primera importación), correr a mano "
                         f"importar_materia_prima_legacy --pasos lineas --aplicar")
            borrar, apagar = [], []
        else:
            paso.alertar(f"se borran (o apagan) {n} líneas, más que el tope de {ctx.tope_borrado} "
                         f"del espejo del sync; corrida a mano: se sigue")

    for actual in borrar:
        numero = numero_de[actual["id_orden_trabajo"]]
        if numero in ejemplos_ot:
            paso.ejemplo(f"OT {numero} se borra {actual['codigo'].strip()} (ya no está en el viejo)")
    paso.contar("OT de SPMM con líneas en el viejo", ots_tocadas)
    paso.contar("líneas que cambian (UPDATE, conservan id)", len(cambios))
    for col, n in por_columna.most_common():
        paso.contar(f"  cambia {col}", n)
    paso.contar("líneas nuevas (INSERT)", len(altas))
    paso.contar("líneas que ya no están en el viejo (DELETE, con copia)", len(borrar))
    paso.contar("  ídem pero con consumos o stock: usado=0 en vez de borrar", len(apagar))
    paso.contar("piezas creadas inactivas (código de línea sin pieza)", len(piezas_nuevas))
    for a in apagar:
        paso.advertir(f"línea {a['id']} ({a['codigo'].strip()}) ya no está en el viejo pero tiene "
                      f"consumos o movimientos: queda con usado=0")

    # «No lleva materia prima» como está en el viejo: se pone y se saca (gana el Integral;
    # con SPMM como dueño la marca se pone acá y este script ya no se corre). Sólo en las
    # OT que SON la del viejo (ots_del_viejo).
    marcadas = {f["idot"] for f in ctx.viejo["otrabajo"] if _flag(f.get("NOLLEVAMP"))}
    sin_marcar = {f["idot"] for f in ctx.viejo["otrabajo"]} - marcadas
    no_lleva = [est.ots[i]["id"] for i in sorted(marcadas, key=lambda x: x or 0)
                if i in iguales and not est.ots[i]["no_lleva_materia_prima"]]
    si_lleva = [est.ots[i]["id"] for i in sorted(sin_marcar, key=lambda x: x or 0)
                if i in iguales and est.ots[i]["no_lleva_materia_prima"]]
    paso.contar("OT que pasan a «no lleva materia prima»", len(no_lleva))
    paso.contar("OT que dejan de ser «no lleva materia prima»", len(si_lleva))

    async with _Transaccion(ctx):
        if ctx.aplicar:
            if piezas_nuevas:
                creadas = await _insertar(
                    ctx.conn, "pieza", list(piezas_nuevas.values()),
                    {"cod_pieza": "text", "descripcion": "text", "unidad": "text", "tipo": "text",
                     "inactivo": "int4", "origen": "text", "sistema_medida": "text",
                     "stockactual": "float8", "creado_en": "timestamp"}, "id, cod_pieza")
                nuevos_ids = {norm_codigo(r["cod_pieza"]): r["id"] for r in creadas}
                for a in altas:
                    if a["id_pieza"] is None:
                        a["id_pieza"] = nuevos_ids[a["_codigo"]]
            await _copiar(ctx, paso, "orden_trabajo_pieza", BACKUP_LINEA,
                          [c["id"] for c in cambios] + [b["id"] for b in borrar] + [a["id"] for a in apagar])
            if cambios:
                await _actualizar(ctx.conn, "orden_trabajo_pieza", cambios, COLS_LINEA)
            if apagar:
                await ctx.conn.execute("UPDATE orden_trabajo_pieza SET usado = 0 WHERE id = ANY($1::int[])",
                                       [a["id"] for a in apagar])
            if borrar:
                # Los cortes se van solos (ON DELETE CASCADE). El NOT EXISTS vuelve a mirar
                # consumos y movimientos EN el DELETE: alguien pudo cargar un consumo sobre la
                # línea después de que se leyó SPMM (la API de consumos no la frena el
                # dueño). Una línea con consumos no se borra nunca; la corrida siguiente la
                # apaga.
                resultado = await ctx.conn.execute(
                    "DELETE FROM orden_trabajo_pieza t WHERE t.id = ANY($1::int[]) "
                    "AND NOT EXISTS (SELECT 1 FROM consumo_material c WHERE c.id_orden_trabajo_pieza = t.id) "
                    "AND NOT EXISTS (SELECT 1 FROM pieza_movimiento m WHERE m.id_orden_trabajo_pieza = t.id)",
                    [b["id"] for b in borrar])
                borradas = _filas_afectadas(resultado)
                if borradas is not None and borradas < len(borrar):
                    paso.alertar(f"{len(borrar) - borradas} líneas no se borraron: les cargaron consumos "
                                 f"o movimientos mientras corría esto (la próxima corrida las apaga)")
            if altas:
                await _insertar(ctx.conn, "orden_trabajo_pieza", altas,
                                {"id_orden_trabajo": "int4", "id_pieza": "int4", **COLS_LINEA,
                                 "cantusada": "float8", "creado_en": "timestamp"})
            if no_lleva:
                await ctx.conn.execute(
                    "UPDATE orden_trabajo SET no_lleva_materia_prima = 1 "
                    "WHERE id = ANY($1::int[]) AND COALESCE(no_lleva_materia_prima, 0) = 0", no_lleva)
            if si_lleva:
                await ctx.conn.execute(
                    "UPDATE orden_trabajo SET no_lleva_materia_prima = 0 "
                    "WHERE id = ANY($1::int[]) AND no_lleva_materia_prima = 1", si_lleva)
        else:
            for codigo, pieza in piezas_nuevas.items():
                pieza["id"] = ctx.id_falso()
                est.piezas.append(pieza)
                for a in altas:
                    if a["id_pieza"] is None and a["_codigo"] == codigo:
                        a["id_pieza"] = pieza["id"]
            por_id = {l["id"]: l for l in est.lineas}
            for c in cambios:
                por_id[c["id"]].update(c)
            for a in apagar:
                por_id[a["id"]]["usado"] = 0
            quitar = {b["id"] for b in borrar}
            est.lineas = [l for l in est.lineas if l["id"] not in quitar]
            for a in altas:
                est.lineas.append({"id": ctx.id_falso(), "id_movimiento_retiro": None, **a})
            for i in no_lleva:
                next(o for o in est.ots.values() if o["id"] == i)["no_lleva_materia_prima"] = 1
            for i in si_lleva:
                next(o for o in est.ots.values() if o["id"] == i)["no_lleva_materia_prima"] = 0


def _describir_lineas(lineas, numero_de, maximo=12) -> str:
    """«OT 15895: ABC071, ABR362; OT 15714: RUL002» para el log (hasta `maximo` OT)."""
    por_ot = defaultdict(list)
    for l in lineas:
        por_ot[numero_de.get(l["id_orden_trabajo"])].append(str(l.get("codigo") or "?").strip())
    partes = [f"OT {n}: {', '.join(c)}" for n, c in sorted(por_ot.items(), key=lambda x: x[0] or 0)]
    return "; ".join(partes[:maximo]) + (f"; y {len(partes) - maximo} OT más" if len(partes) > maximo else "")


def _filas_afectadas(estado) -> int | None:
    """Cuántas filas tocó una sentencia, del texto que devuelve asyncpg («DELETE 3»)."""
    try:
        return int(str(estado).split()[-1])
    except (ValueError, IndexError):
        return None


def _cortes_iguales(actuales, deseados) -> bool:
    clave = lambda c: (c["cantidad"], _comparable(c["largo_mm"]), _comparable(c["ancho_mm"]),
                       _comparable(c["texto_original"]), c["orden"])
    if len(actuales) != len(deseados):
        return False
    return all(
        all(_igual(x, y) for x, y in zip(clave(a), clave(d)))
        for a, d in zip(actuales, deseados))


async def paso_cortes(ctx: Contexto):
    paso = ctx.paso("cortes")
    est = ctx.estado
    codigos = {p["id"]: p["cod_pieza"] for p in est.piezas}
    ots_con_lineas_viejas = {f.get("Idot") for f in ctx.viejo["lineas"]}

    grupos = defaultdict(list)
    for fila in ctx.viejo["cortes"]:
        grupos[(fila.get("idot"), norm_codigo(fila.get("idpieza")))].append(fila)

    deseados_por_linea: dict[int, list[dict]] = {}
    huerfanos = 0
    sin_cantidad = 0
    ejemplos_huerfanos = Counter()
    por_ot_spmm = _lineas_por_ot(est, codigos)
    iguales, distintas = ots_del_viejo(ctx)
    for (id_otvieja, codigo), filas in grupos.items():
        ot = est.ots.get(id_otvieja)
        if ot is None:
            paso.contar("cortes de OT que no están en SPMM", len(filas))
            continue
        if id_otvieja not in iguales:
            paso.contar("cortes de OT de SPMM que no son la del Integral (no se tocan)"
                        if id_otvieja in distintas else
                        "cortes de OT sin cabecera en el Integral (no se tocan)", len(filas))
            continue
        lineas = [l for l in por_ot_spmm.get(ot["id"], []) if norm_codigo(l["codigo"]) == codigo]
        if not lineas:
            # El viejo guarda los cortes por (OT, código) y no por línea: si la línea se
            # borró o se cambió de código, los cortes quedan sueltos (806 pares en todo
            # el viejo). No hay a qué colgarlos.
            huerfanos += len(filas)
            ejemplos_huerfanos[f"{id_otvieja}/{codigo}"] += len(filas)
            continue
        linea = lineas[0]
        cortes = []
        for fila in filas:
            cantidad, largo, ancho, texto = corte_desde_texto(fila.get("cant"), fila.get("largo"))
            if cantidad is None:
                sin_cantidad += 1
                continue
            cortes.append({"cantidad": cantidad, "largo_mm": largo, "ancho_mm": ancho,
                           "texto_original": texto, "orden": len(cortes) + 1})
        deseados_por_linea[linea["id"]] = cortes

    # Las líneas del viejo de las OT importadas que ya no tienen cortes allá, se quedan
    # sin cortes acá también (los cortes de una línea legacy son los del viejo). Salvo que
    # la lectura de TODOS los cortes haya venido vacía: es una lectura que falló (el viejo
    # tiene miles), y dejaría sin cortes a todas las líneas.
    numero_de = {v["id"]: k for k, v in est.ots.items()}
    if not ctx.viejo["cortes"] and ctx.ots is None:
        paso.alertar("el Integral no devolvió ningún corte (otcortesmp): no se le sacan los "
                     "cortes a ninguna línea en esta corrida")
    else:
        for l in est.lineas:
            if l["id"] in deseados_por_linea or l.get("origen") != "legacy" or not est.cortes.get(l["id"]):
                continue
            numero = numero_de.get(l["id_orden_trabajo"])
            if numero in ots_con_lineas_viejas and numero in iguales:
                deseados_por_linea[l["id"]] = []

    reemplazar = {i: c for i, c in deseados_por_linea.items()
                  if not _cortes_iguales(est.cortes.get(i, []), c)}
    paso.contar("filas en otcortesmp", len(ctx.viejo["cortes"]))
    paso.contar("líneas con cortes del viejo", sum(1 for c in deseados_por_linea.values() if c))
    paso.contar("líneas cuyos cortes cambian (se reemplazan)", len(reemplazar))
    paso.contar("  cortes que se escriben", sum(len(c) for c in reemplazar.values()))
    paso.contar("  cortes sólo con texto (no se pudo leer la medida)",
                sum(1 for c in reemplazar.values() for x in c if x["largo_mm"] is None))
    paso.contar("cortes huérfanos (su OT no tiene esa línea)", huerfanos)
    if ejemplos_huerfanos:
        paso.advertir(f"{huerfanos} cortes sin línea en {len(ejemplos_huerfanos)} pares OT/código, p. ej. "
                      + ", ".join(f"{k} ×{n}" for k, n in ejemplos_huerfanos.most_common(10)))
    if sin_cantidad:
        paso.contar("cortes descartados: cantidad 0", sin_cantidad)
    lineas_por_id = {l["id"]: l for l in est.lineas}
    for i, cortes in list(reemplazar.items())[:ctx.ejemplos]:
        l = lineas_por_id.get(i, {})
        paso.ejemplo(f"línea {i} {codigos.get(l.get('id_pieza'), '').strip()}: "
                     + ", ".join(f"{c['cantidad']}×{c['largo_mm'] or c['texto_original']}"
                                 + (f"x{c['ancho_mm']}" if c["ancho_mm"] else "") for c in cortes[:6]))

    async with _Transaccion(ctx):
        if ctx.aplicar and reemplazar:
            await ctx.conn.execute(
                "DELETE FROM orden_trabajo_pieza_corte WHERE id_orden_trabajo_pieza = ANY($1::int[])",
                list(reemplazar))
            filas = [{"id_orden_trabajo_pieza": i, **c} for i, cortes in reemplazar.items() for c in cortes]
            await _insertar(ctx.conn, "orden_trabajo_pieza_corte", filas,
                            {"id_orden_trabajo_pieza": "int4", "cantidad": "int4", "largo_mm": "float8",
                             "ancho_mm": "float8", "texto_original": "text", "orden": "int4"})
        elif not ctx.aplicar:
            for i, cortes in reemplazar.items():
                est.cortes[i] = cortes


async def paso_canera(ctx: Contexto):
    paso = ctx.paso("canera")
    est = ctx.estado
    # El casillero se cuelga de la OT de SPMM sólo si ES la del viejo (ots_del_viejo); si
    # no, el número queda como texto, igual que el de una OT que SPMM no tiene.
    iguales, distintas = ots_del_viejo(ctx)
    ids_ot = {k: est.ots[k]["id"] for k in iguales}
    deseadas = {}
    for fila in ctx.viejo["canera"]:
        celda = ocupacion_desde_ubicacion(fila.get("ubicacion"))
        if celda is None:
            paso.contar("ubicaciones que no se entienden")
            paso.advertir(f"cañera: ubicación {fila.get('ubicacion')!r} (OT {fila.get('ot')}) no es un casillero")
            continue
        ot = fila.get("ot")
        if not ot:
            # Un casillero sin número no es una ocupación (y la base exige OT o texto).
            paso.contar("casilleros sin número de OT (se saltean)")
            continue
        id_ot = ids_ot.get(ot)
        texto = None if id_ot else str(ot)
        if id_ot is None:
            # Los números de 6 cifras que son una OT con un 0 de más (158010 → 15801) no
            # se adivinan: van como texto y se avisa para que decida el taller.
            if ot and ot % 10 == 0 and ot // 10 in ids_ot:
                paso.advertir(f"cañera {celda[0]}{celda[1]}: {ot} no existe; ¿será la OT {ot // 10}? "
                              f"(queda como texto)")
                paso.contar("números ×10 (quedan como texto)")
            elif ot in distintas:
                paso.contar("OT de SPMM que no son la del Integral (quedan como texto)")
            elif ot in est.ots:
                paso.contar("OT sin cabecera en el Integral (quedan como texto)")
            else:
                paso.contar("OT que no están en SPMM (quedan como texto)")
        deseadas[celda] = {"columna": celda[0], "fila": celda[1], "id_orden_trabajo": id_ot,
                           "ot_texto": texto}

    vigentes_legacy = {(o["columna"], o["fila"]): o for o in est.canera if o["origen"] == "legacy"}
    ocupadas_spmm = {(o["columna"], o["fila"]): o for o in est.canera if o["origen"] != "legacy"}
    numero_de = {v["id"]: k for k, v in est.ots.items()}

    def _de_estas_ots(ocupacion) -> bool:
        """¿La ocupación es de una de las OT de --ots (o no hay --ots)? Con --ots se
        leyeron sólo los casilleros de esas OT: que un casillero de OTRA OT no esté en lo
        leído no dice que se haya liberado."""
        if ctx.ots is None:
            return True
        numero = numero_de.get(ocupacion["id_orden_trabajo"])
        if numero is None and str(ocupacion.get("ot_texto") or "").strip().isdigit():
            numero = int(str(ocupacion["ot_texto"]).strip())
        return numero in ctx.ots

    # Una lectura VACÍA de la cañera entera es una lectura que falló (el viejo tiene más de
    # cien casilleros ocupados): no se libera ninguno. Con --ots sí puede venir vacía.
    lectura_vacia = not ctx.viejo["canera"] and ctx.ots is None
    if lectura_vacia:
        paso.alertar("el Integral no devolvió ningún casillero de la cañera: no se libera ninguno "
                     "en esta corrida")
    cerrar, crear = [], []
    for celda, actual in vigentes_legacy.items():
        d = deseadas.get(celda)
        if d is None:
            if _de_estas_ots(actual) and not lectura_vacia:
                cerrar.append(actual)
        elif (actual["id_orden_trabajo"], actual["ot_texto"]) != (d["id_orden_trabajo"], d["ot_texto"]):
            # Otra OT en el casillero (aunque la de antes no sea de --ots): el viejo dice
            # que ahora es de ésta, y no puede haber dos vigentes en el mismo.
            cerrar.append(actual)
    for celda, d in sorted(deseadas.items()):
        actual = vigentes_legacy.get(celda)
        if actual is not None and (actual["id_orden_trabajo"], actual["ot_texto"]) == (d["id_orden_trabajo"], d["ot_texto"]):
            continue
        if celda in ocupadas_spmm:
            paso.advertir(f"cañera {celda[0]}{celda[1]}: en SPMM la ocupa otra asignación; no se pisa")
            continue
        crear.append(d)
    paso.contar("casilleros ocupados en el viejo", len(ctx.viejo["canera"]))
    paso.contar("ocupaciones nuevas (origen legacy)", len(crear))
    paso.contar("  con OT de SPMM", sum(1 for c in crear if c["id_orden_trabajo"]))
    paso.contar("ocupaciones del viejo que se cierran (hasta = ahora)", len(cerrar))
    numero = {v["id"]: k for k, v in est.ots.items()}
    for c in crear[:ctx.ejemplos]:
        paso.ejemplo(f"{c['columna']}{c['fila']} → OT {numero.get(c['id_orden_trabajo']) or c['ot_texto']}")

    async with _Transaccion(ctx):
        if ctx.aplicar:
            if cerrar:
                await ctx.conn.execute("UPDATE canera_ocupacion SET hasta = $1 WHERE id = ANY($2::bigint[])",
                                       ctx.ahora, [c["id"] for c in cerrar])
            if crear:
                for c in crear:
                    c.update(desde=ctx.ahora, origen="legacy")
                await _insertar(ctx.conn, "canera_ocupacion", crear,
                                {"columna": "text", "fila": "int4", "id_orden_trabajo": "int4",
                                 "ot_texto": "text", "desde": "timestamp", "origen": "text"})
        else:
            quitar = {id(c) for c in cerrar}
            est.canera = [o for o in est.canera if id(o) not in quitar]
            est.canera += [{"id": ctx.id_falso(), "origen": "legacy", **c} for c in crear]


_Q_PLAN_SEMANAL_SPMM = ("SELECT id, semana, fecha_original, numero_ot, id_orden_trabajo, prioridad, "
                        "origen FROM plan_semanal")


async def paso_plan_semanal(ctx: Contexto):
    """dbo.plansemanal → plan_semanal, en la ventana (ver legado.plan_semanal_desde_legacy
    y el modelo PlanSemanal). Dentro de la ventana, SPMM queda igual al Integral: lo que
    falta se inserta, lo que cambió (el día original, la prioridad, a qué OT de SPMM se
    enlaza) se corrige y lo que el Integral ya no tiene se borra. Fuera de la ventana y lo
    que tiene origen 'spmm' no se toca.

    La OT se enlaza con la identidad del resto del espejo (ots_del_viejo): número,
    artículo, cliente y fecha. Si no coincide, o SPMM no la tiene, la fila queda con el
    número y sin OT: cuando la OT llegue a SPMM (o se corrija), la pasada siguiente la
    enlaza.

    Una lectura VACÍA de toda la ventana es una lectura que falló (el taller carga de 55 a
    93 OT por semana): no se borra nada. Con --ots sí puede venir vacía.

    Lo que hay en SPMM se lee DENTRO del savepoint del paso: si falta la tabla (la
    migración 2026-09-25_plan_semanal no se aplicó), falla sólo este paso y los anteriores
    quedan escritos."""
    paso = ctx.paso("plan_semanal")
    est = ctx.estado
    desde, hasta = ctx.ventana or ventana_plan_semanal(ctx.hoy)
    filas = ctx.viejo["plansemanal"]
    deseadas, descartes = plan_semanal_desde_legacy(filas, (desde, hasta))
    iguales, distintas = ots_del_viejo(ctx)

    paso.contar("filas del Integral en la ventana", len(filas))
    for motivo, n in descartes.items():
        paso.contar(f"descartadas: {motivo}", n)
    sin_ot = Counter()
    for (_, numero), d in deseadas.items():
        if numero in iguales:
            d["id_orden_trabajo"] = est.ots[numero]["id"]
            continue
        d["id_orden_trabajo"] = None
        sin_ot["OT de SPMM que no son la del Integral (quedan sin enlazar)" if numero in distintas
               else "OT sin cabecera en el Integral (quedan sin enlazar)" if numero in est.ots
               else "OT que no están en SPMM (quedan sin enlazar)"] += 1
    for motivo, n in sin_ot.items():
        paso.contar(motivo, n)

    lectura_vacia = not filas and ctx.ots is None
    if lectura_vacia:
        paso.alertar(f"el Integral no devolvió ninguna fila del plan semanal entre el {desde:%d/%m} "
                     f"y la semana del {hasta:%d/%m/%Y}: no se borra nada en esta corrida")

    async with _Transaccion(ctx, recargar=False):
        if getattr(est, "plan_semanal", None) is None:
            est.plan_semanal = [dict(r) for r in await ctx.conn.fetch(_Q_PLAN_SEMANAL_SPMM)]
        actuales, de_spmm = {}, set()
        for r in est.plan_semanal:
            semana = _dia(r["semana"])
            if semana is None or not (desde <= semana <= hasta):
                continue
            clave = (semana, r["numero_ot"])
            if r.get("origen") != "legacy":
                de_spmm.add(clave)
            elif ctx.ots is None or r["numero_ot"] in ctx.ots:
                actuales[clave] = r

        crear, cambiar = [], []
        for clave, d in sorted(deseadas.items()):
            actual = actuales.get(clave)
            if actual is None:
                if clave in de_spmm:
                    paso.advertir(f"plan semanal {clave[0]:%d/%m}: la OT {clave[1]} ya la cargaron en "
                                  f"SPMM; no se pisa")
                    continue
                crear.append({"semana": clave[0], "numero_ot": clave[1], **d})
            elif (_dia(actual["fecha_original"]), actual["prioridad"], actual["id_orden_trabajo"]) != (
                    d["fecha_original"], d["prioridad"], d["id_orden_trabajo"]):
                cambiar.append({"id": actual["id"], **d})
        borrar = [] if lectura_vacia else [r for clave, r in actuales.items() if clave not in deseadas]

        paso.contar("OT-semana en la ventana del Integral", len(deseadas))
        paso.contar("OT de una semana que se agregan (INSERT)", len(crear))
        paso.contar("OT de una semana que cambian (UPDATE)", len(cambiar))
        paso.contar("OT de una semana que ya no están en el Integral (DELETE)", len(borrar))
        for c in crear[:ctx.ejemplos]:
            paso.ejemplo(f"semana del {c['semana']:%d/%m}: OT {c['numero_ot']}"
                         + ("" if c["id_orden_trabajo"] else " (sin OT en SPMM)"))

        if ctx.aplicar:
            if borrar:
                await ctx.conn.execute("DELETE FROM plan_semanal WHERE id = ANY($1::int[])",
                                       [r["id"] for r in borrar])
            if cambiar:
                await _actualizar(ctx.conn, "plan_semanal", cambiar,
                                  {"fecha_original": "date", "prioridad": "text", "id_orden_trabajo": "int4"})
            if crear:
                for c in crear:
                    c.update(origen="legacy", creado_en=ctx.ahora)
                await _insertar(ctx.conn, "plan_semanal", crear,
                                {"semana": "date", "fecha_original": "date", "numero_ot": "int4",
                                 "id_orden_trabajo": "int4", "prioridad": "text", "origen": "text",
                                 "creado_en": "timestamp"})
            if borrar or cambiar or crear:
                est.plan_semanal = None  # la próxima corrida sobre este Estado la relee
        else:
            quitar = {id(r) for r in borrar}
            por_id = {r["id"]: r for r in est.plan_semanal}
            for c in cambiar:
                por_id[c["id"]].update(c)
            est.plan_semanal = [r for r in est.plan_semanal if id(r) not in quitar]
            est.plan_semanal += [{"id": ctx.id_falso(), "origen": "legacy", **c} for c in crear]


FUNCIONES = {
    "catalogos": paso_catalogos, "proveedores": paso_proveedores, "insumos": paso_insumos,
    "precios": paso_precios, "stock": paso_stock, "recortes": paso_recortes,
    "lineas": paso_lineas, "cortes": paso_cortes, "canera": paso_canera,
    "plan_semanal": paso_plan_semanal,
}


# ─────────────────────────── arranque ───────────────────────────


async def verificar_migracion(conn) -> list[str]:
    """Qué le falta a la base para poder importar (vacío = nada). Sin la migración
    2026-09-23_materia_prima no hay dónde escribir: mejor frenar antes de leer nada."""
    faltan = []
    columnas = defaultdict(set)
    for r in await conn.fetch(
            "SELECT table_name, column_name FROM information_schema.columns "
            "WHERE table_schema = current_schema() AND table_name = ANY($1::text[])", list(REQUERIDO)):
        columnas[r["table_name"]].add(r["column_name"])
    for tabla, cols in REQUERIDO.items():
        if tabla not in columnas:
            faltan.append(f"falta la tabla {tabla}")
            continue
        faltan += [f"falta {tabla}.{c}" for c in cols if c not in columnas[tabla]]
    if not faltan and not await conn.fetchval("SELECT count(*) FROM formato"):
        faltan.append("la tabla formato está vacía (la semilla la pone la migración)")
    return faltan


def _para_asyncpg(url: str) -> str:
    """asyncpg no entiende el driver de SQLAlchemy (+asyncpg) ni los parámetros."""
    return re.sub(r"^postgres(?:ql)?(?:\+\w+)?://", "postgresql://", url).split("?")[0]


def por_el_pooler(url: str) -> str:
    """La URL de la base de la app (la de SUPABASE_DB_URL, por el 5432) pasada al pooler
    6543: el 5432 admite 15 clientes para TODO el proyecto y la app ocupa la mayoría. Es
    la regla del script sin --db-url y la del espejo del sync."""
    return _para_asyncpg(url.replace(":5432/", ":6543/"))


def _url(db_url: str | None) -> str:
    """La base destino. Con --db-url, esa (un Postgres local para probar). Si no, la de
    SUPABASE_DB_URL del .env pasada al pooler 6543 (por_el_pooler)."""
    if db_url:
        return _para_asyncpg(db_url)
    from dotenv import load_dotenv
    load_dotenv()
    url = os.getenv("SUPABASE_DB_URL") or ""
    if not url:
        sys.exit("No hay SUPABASE_DB_URL en el entorno ni --db-url.")
    return por_el_pooler(url)


def _lista_de_ots(texto: str) -> list[int]:
    """«15692, 14534,15243» → [15692, 14534, 15243]."""
    ots = []
    for parte in texto.replace(";", ",").split(","):
        parte = parte.strip().lstrip("#")
        if not parte:
            continue
        if not parte.isdigit():
            raise argparse.ArgumentTypeError(f"«{parte}» no es un número de OT")
        ots.append(int(parte))
    if not ots:
        raise argparse.ArgumentTypeError("--ots sin ningún número")
    return ots


def _args(argv=None):
    p = argparse.ArgumentParser(
        description="Importa la materia prima del sistema viejo (el Sistema Integral) a SPMM. "
                    "Se puede correr cuantas veces se quiera: cada corrida deja SPMM igual al "
                    "viejo en lo que toca (gana el Integral) y, con el viejo igual, la segunda "
                    "no cambia nada. Lo cargado en SPMM (origen spmm o historial) no se pisa. "
                    "Sin --aplicar es en seco: sólo muestra qué haría.")
    p.add_argument("--aplicar", action="store_true", help="escribe (sin esto, en seco)")
    p.add_argument("--pasos", default=",".join(PASOS),
                   help="pasos separados por coma (en este orden: " + ",".join(PASOS) + ")")
    p.add_argument("--ots", type=_lista_de_ots, default=None, metavar="15692,14534,...",
                   help="limita los pasos lineas, cortes, canera y plan_semanal a estas OT (su "
                        "número visible); los demás pasos corren igual")
    p.add_argument("--db-url", default=None, help="Postgres destino (por defecto SUPABASE_DB_URL por 6543)")
    p.add_argument("--ejemplos", type=int, default=10, help="ejemplos por paso")
    a = p.parse_args(argv)
    pedidos = [x.strip() for x in a.pasos.split(",") if x.strip()]
    malos = [x for x in pedidos if x not in PASOS]
    if malos:
        p.error(f"pasos desconocidos: {', '.join(malos)}")
    a.pasos = [x for x in PASOS if x in pedidos]  # siempre en el orden de la spec
    return a


class Resultado:
    """Lo que hizo una corrida de importar(). El main del script lo imprime y decide con
    qué código sale; el espejo del sync lo resume en un renglón del log."""

    def __init__(self, pasos, aplicar: bool):
        self.pasos_pedidos = list(pasos)
        self.aplicar = aplicar
        # La migración no está aplicada: no se leyó el viejo ni se tocó nada.
        self.faltan: list[str] = []
        # Otra corrida (el sync o alguien con el script) tenía el candado: no se tocó nada.
        self.ocupado = False
        # (paso, error): ese paso no escribió nada y los siguientes no corrieron; los
        # anteriores quedaron escritos.
        self.fallo: tuple[str, str] | None = None
        self.ctx: Contexto | None = None
        self.segundos = 0.0

    @property
    def pasos(self) -> list[Paso]:
        return self.ctx.pasos if self.ctx else []

    def cambios(self) -> dict[str, int]:
        """Paso → filas que cambió (la suma de sus conteos de CAMBIOS), sólo los que
        cambiaron algo. En seco, las que cambiaría."""
        salida = {}
        for paso in self.pasos:
            n = sum(paso.conteos.get(clave, 0) for clave in CAMBIOS.get(paso.nombre, ()))
            if n:
                salida[paso.nombre] = n
        return salida

    def copiadas(self) -> dict[str, int]:
        """backup_* → filas que esta corrida copió ahí (sólo las que copiaron algo). El
        espejo del sync lo dice en su renglón: es lo que se busca para volver atrás. Sin el
        paso que falló: su copia se deshizo con su savepoint."""
        salida: Counter = Counter()
        for paso in self.pasos:
            if self.fallo and paso.nombre == self.fallo[0]:
                continue
            for clave, n in paso.conteos.items():
                if clave.startswith("filas copiadas a ") and n:
                    salida[clave.removeprefix("filas copiadas a ")] += n
        return dict(salida)

    def avisos(self) -> list[str]:
        return [f"[{p.nombre}] {a}" for p in self.pasos for a in p.advertencias]

    def alertas(self) -> list[str]:
        """Las advertencias que el espejo del sync loguea como WARNING (Paso.alertar)."""
        return [f"[{p.nombre}] {a}" for p in self.pasos for a in p.alertas]

    def renglon(self) -> str:
        """Todo en un renglón (el log del sync, una vez por pasada)."""
        if self.faltan:
            return ("la migración 2026-09-23_materia_prima no está aplicada ("
                    + "; ".join(self.faltan[:3]) + "); no se hizo nada")
        if self.ocupado:
            return "otra corrida de la importación tiene el candado; no se hizo nada"
        cambios = ", ".join(f"{k} {v}" for k, v in self.cambios().items()) or "sin cambios"
        extra = []
        if self.fallo:
            extra.append(f"falló el paso {self.fallo[0]} ({self.fallo[1]}), los siguientes no corrieron")
        if self.avisos():
            extra.append(f"{len(self.avisos())} avisos")
        extra.append(f"{self.segundos:.1f} s")
        return f"{cambios} ({'; '.join(extra)})"


async def importar(pasos=PASOS, aplicar: bool = False, db_url: str | None = None,
                   respaldar: bool = True, ots=None, silencioso: bool = False,
                   ejemplos: int = 10, frenar_en_tope: bool = False) -> Resultado:
    """Una corrida de la importación: la usan el main de este script y el ESPEJO del sync
    (scripts/sync_db.py, en cada pasada mientras el Integral es el dueño).

    pasos       cuáles (se corren en el orden de PASOS, pida como pida).
    aplicar     escribe; si no, en seco.
    db_url      la base destino; None = SUPABASE_DB_URL del entorno por el pooler 6543.
                El sync pasa la de la app ya pasada al 6543 (por_el_pooler).
    respaldar   copia a backup_* lo que reescribe o borra: True a todas, False a ninguna,
                SI_NO_HAY_COPIA (el sync) sólo a las que todavía no existen, tabla por tabla.
    ots         números de OT a los que se limitan lineas, cortes, canera y plan_semanal;
                None = todas.
    silencioso  no imprime nada (el sync loguea el renglón del Resultado).
    frenar_en_tope  por encima de TOPE_BORRADO_LINEAS no borra ninguna línea (el espejo
                del sync); sin esto avisa y sigue (a mano, con alguien mirando).

    No termina el proceso (el main decide el código de salida), salvo que no haya base
    destino (sin db_url ni SUPABASE_DB_URL). Un paso que falla se anota en
    Resultado.fallo y corta la corrida; los anteriores quedan escritos. Lo que no sea de
    un paso (la base no contesta, el viejo no contesta) se levanta, sin nada escrito.
    """
    import asyncpg

    pedidos = set(pasos)
    pasos = [p for p in PASOS if p in pedidos]
    res = Resultado(pasos, aplicar)
    inicio_total = time.perf_counter()

    def decir(*partes):
        if not silencioso:
            print(*partes, flush=True)

    url = _url(db_url)
    decir(f"Importación de materia prima — {'APLICAR' if aplicar else 'EN SECO'} — destino "
          + re.sub(r"//[^@]*@", "//…@", url))
    decir(f"Pasos: {', '.join(pasos)}"
          + (f" (lineas, cortes, canera y plan_semanal sólo de las OT {', '.join(map(str, sorted(set(ots))))})"
             if ots else ""))

    # Primero la base destino, sólo para verificar la migración (y cerrar): no tiene
    # sentido leer 100 mil filas del viejo para frenar después.
    conn = await asyncpg.connect(url, statement_cache_size=0)
    try:
        res.faltan = await verificar_migracion(conn)
    finally:
        await conn.close()
    if res.faltan:
        decir("\nLa migración 2026-09-23_materia_prima no está aplicada en esa base:")
        for f in res.faltan[:20]:
            decir(f"  · {f}")
        decir("Se aplica sola al arrancar el backend (infrastructure/migraciones.py). No se tocó nada.")
        res.segundos = time.perf_counter() - inicio_total
        return res

    decir("Leyendo el sistema viejo (sólo SELECT)…")
    inicio = time.perf_counter()
    # La ventana del plan semanal, una vez: la lectura y el paso usan la misma aunque la
    # corrida cruce la medianoche del domingo.
    ventana = ventana_plan_semanal(ahora_ar().date())
    viejo = filtrar_ots(await leer_viejo(pasos, silencioso, ventana), ots)
    decir(f"  ({time.perf_counter() - inicio:.1f} s)")

    conn = _Escrituras(await asyncpg.connect(url, statement_cache_size=0))
    corrida = None
    try:
        if aplicar:
            # Toda la corrida en UNA transacción, con el candado: los pasos van cada uno
            # en su savepoint (_Transaccion). Ver la docstring del módulo.
            corrida = conn.transaction()
            await corrida.start()
            await conn.execute("SET LOCAL lock_timeout = '10s'")
            # Ver TOPE_OCIOSO_EN_TRANSACCION: que un cuelgue no deje los locks tomados.
            await conn.execute(
                f"SET LOCAL idle_in_transaction_session_timeout = '{TOPE_OCIOSO_EN_TRANSACCION}'")
            if not await conn.fetchval("SELECT pg_try_advisory_xact_lock($1)", CANDADO):
                res.ocupado = True
                decir("\nHay otra importación corriendo contra esa base (el espejo del sync o "
                      "alguien con este script). No se tocó nada; probá de nuevo en un minuto.")
                res.segundos = time.perf_counter() - inicio_total
                return res
        # Qué copias se hacen, con el candado ya tomado (SI_NO_HAY_COPIA mira la base).
        copias = await copias_a_hacer(conn, respaldar)
        ctx = res.ctx = Contexto(conn, viejo, aplicar, ejemplos, respaldar=copias, ots=ots,
                                 frenar_en_tope=frenar_en_tope, ventana=ventana)
        ctx.estado = await Estado().cargar(conn)
        for nombre in pasos:
            inicio = time.perf_counter()
            try:
                await FUNCIONES[nombre](ctx)
            except Exception as e:
                # Cada paso es su propio savepoint: el que falla no dejó nada escrito y los
                # anteriores quedan (se confirman abajo). Se puede volver a correr desde éste.
                res.fallo = (nombre, f"{type(e).__name__}: {e}")
                hechos = [p.nombre for p in ctx.pasos if p.nombre != nombre]
                decir(f"\n✗ El paso «{nombre}» falló y no escribió nada: {res.fallo[1]}")
                if aplicar and hechos:
                    decir(f"  Quedaron escritos los anteriores ({', '.join(hechos)}). Para seguir: "
                          f"--pasos {','.join(pasos[pasos.index(nombre):])} --aplicar")
                break
            ctx.pasos[-1].segundos = time.perf_counter() - inicio
            if not silencioso:
                ctx.pasos[-1].imprimir()
        if corrida is not None:
            await corrida.commit()
            corrida = None
    finally:
        if corrida is not None:
            try:
                await corrida.rollback()
            except Exception:
                pass  # la conexión ya no está: no hay nada que deshacer
        await conn.close()
    res.segundos = time.perf_counter() - inicio_total
    if not silencioso and not res.fallo:
        imprimir_resumen(res)
    return res


def imprimir_resumen(res: Resultado):
    ctx = res.ctx
    print("\n" + "═" * 72)
    print(f"RESUMEN — importación de materia prima del viejo ({'APLICADA' if ctx.aplicar else 'EN SECO'}),"
          f" {ctx.ahora:%d/%m/%Y %H:%M}" + (f" — OT {', '.join(map(str, sorted(ctx.ots)))}" if ctx.ots else ""))
    for paso in ctx.pasos:
        partes = [f"{k} {v}" for k, v in paso.conteos.items() if not k.startswith("  ")]
        tiempo = f" [{paso.segundos:.1f} s]" if paso.segundos is not None else ""
        print(f"· {paso.nombre}{tiempo}: " + "; ".join(partes))
    avisos = [(p.nombre, a) for p in ctx.pasos for a in p.advertencias]
    if avisos:
        print(f"\nAdvertencias ({len(avisos)}):")
        for nombre, a in avisos[:60]:
            print(f"  [{nombre}] {a}")
        if len(avisos) > 60:
            print(f"  … y {len(avisos) - 60} más")
    print(f"\nCambios: {', '.join(f'{k} {v}' for k, v in res.cambios().items()) or 'ninguno'}"
          f" ({res.segundos:.1f} s en total).")
    if not ctx.aplicar:
        print("(corrida en seco — no se escribió nada; usar --aplicar para escribir)")
    elif ctx.respaldar:
        print(f"Copias: {', '.join(b for b in COPIAS if b in ctx.respaldar)} "
              f"(columna respaldado_en = {ctx.ahora:%Y-%m-%d %H:%M:%S}).")


async def main(argv=None):
    args = _args(argv)
    res = await importar(args.pasos, args.aplicar, args.db_url, respaldar=True, ots=args.ots,
                         ejemplos=args.ejemplos)
    if res.faltan:
        sys.exit(2)
    if res.ocupado:
        sys.exit(3)
    if res.fallo:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
