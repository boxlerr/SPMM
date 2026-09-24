"""La importación de OT desde el sistema viejo (backend/scripts/importar_ot_legacy.py).

El 23/09/2026 se encontró por qué los procesos de las OT se multiplicaban cada vez que
se traían del viejo: todas las migraciones leían `dbo.otrabajoProceso`, que es la HOJA
DE RUTA (líneas del plan + partes de trabajo), y no `dbo.ZoTProcesos`, que es la lista
que el taller carga y ve. En 20 OT la hoja tiene la lista 2 o 3 veces; la 15243 tenía
13 filas contra los 7 procesos que Lucas ve en el viejo.

Estos tests cuidan tres cosas: que se lea la tabla correcta, que la recarga deje cada
OT exactamente como el viejo sin perder lo que coincide, y que el modo de todas las
semanas sólo AGREGUE. No tocan ninguna base.
"""
import inspect
import re
from datetime import datetime

from backend.scripts import importar_ot_legacy as imp


def _z(orden, proceso, nombre, minutos, id_=None):
    return {"orden": orden, "id": id_ if id_ is not None else orden, "proceso": proceso,
            "nombre": nombre, "minutos": minutos}


# ---------------------------------------------------------------------------
# La tabla correcta
# ---------------------------------------------------------------------------
def test_lee_la_lista_y_no_la_hoja_de_ruta():
    """Si alguien vuelve a leer otrabajoProceso, vuelven los procesos multiplicados."""
    assert "ZoTProcesos" in imp.Q_LISTA
    codigo = inspect.getsource(imp)
    # Se nombra en el docstring para explicar el porqué; lo que no puede haber es una
    # consulta contra ella.
    assert not re.search(r"FROM\s+dbo\.otrabajoProceso", codigo, re.IGNORECASE)


def test_lista_del_viejo_ordena_renumera_y_saltea_lo_que_no_es_proceso():
    filas = [
        _z(3, 34, "EMBALADO", 10),
        _z(1, 36, "PROGRAMACION  TORNO CNC", 40),  # doble espacio: mismo proceso
        _z(2, 6, "TORNO CNC", 420, id_=20),
        _z(2, 6, "TORNO CNC", 420, id_=21),        # mismo paso repetido: van los dos
        _z(5, 0, None, 0),                          # fila vacía del viejo
    ]
    assert imp.lista_del_viejo(filas) == [
        (1, "PROGRAMACION TORNO CNC", 40),
        (2, "TORNO CNC", 420),
        (3, "TORNO CNC", 420),
        (4, "EMBALADO", 10),
    ]


# ---------------------------------------------------------------------------
# La recarga: dejar la OT como el viejo sin perder lo que coincide
# ---------------------------------------------------------------------------
def _spmm(*pasos):
    """[(id, paso, nombre, minutos)] -> filas como las arma el script."""
    return [{"id": i, "orden": o, "clave": n, "minutos": m} for i, o, n, m in pasos]


def test_la_15243_pierde_el_bloque_duplicado_y_nada_mas():
    """El caso que mostró Lucas: 13 filas en SPMM (el bloque de 6 dos veces + embalado)
    contra los 7 procesos del viejo."""
    bloque = [("PROGRAMACION TORNO CNC", 40), ("TORNO CNC", 420), ("TORNO CNC", 420),
              ("FRESADORA CNC", 40), ("FRESADORA CNC", 420), ("FRESADORA CNC", 420)]
    en_spmm = _spmm(*[(100 + i, i + 1, n, m)
                      for i, (n, m) in enumerate(bloque + bloque + [("EMBALADO", 10)])])
    viejo = [(i + 1, n, m) for i, (n, m) in enumerate(bloque + [("EMBALADO", 10)])]

    actualizar, borrar, insertar = imp.cambios_de_procesos(en_spmm, viejo)

    assert insertar == []
    assert borrar == [106, 107, 108, 109, 110, 111]      # la segunda copia del bloque
    assert actualizar == [(112, 7, 10)]                  # el embalado pasa al paso 7
    # Las seis primeras se quedan con su id: su avance y su lugar en el plan no se tocan.


def test_una_ot_igual_al_viejo_no_se_toca():
    en_spmm = _spmm((1, 1, "TORNO T1", 60), (2, 2, "EMBALADO", 10))
    assert imp.cambios_de_procesos(en_spmm, [(1, "TORNO T1", 60), (2, "EMBALADO", 10)]) == ([], [], [])


def test_un_proceso_repetido_en_la_lista_del_viejo_es_dato_valido():
    """La 7497 lleva TORNO CNC varias veces: si el viejo lo tiene dos veces, van dos."""
    en_spmm = _spmm((1, 1, "TORNO CNC", 420))
    _, borrar, insertar = imp.cambios_de_procesos(
        en_spmm, [(1, "TORNO CNC", 420), (2, "TORNO CNC", 420)])
    assert borrar == []
    assert insertar == [(2, "TORNO CNC", 420)]


def test_corrige_minutos_y_agrega_lo_que_se_cargo_despues_en_el_viejo():
    en_spmm = _spmm((1, 1, "PLEGADO", 0), (2, 2, "PINTURA", 30))
    actualizar, borrar, insertar = imp.cambios_de_procesos(
        en_spmm, [(1, "PLEGADO", 180), (2, "SOLDADURA CON MIG", 60), (3, "PINTURA", 30)])
    assert borrar == []
    assert actualizar == [(1, 1, 180), (2, 3, 30)]
    assert insertar == [(2, "SOLDADURA CON MIG", 60)]


def test_nombre_repetido_en_el_catalogo_cae_en_el_que_esta_configurado():
    """CORTE CON AMOLADORA existe dos veces (31 y 222). Una pasada nueva tiene que ir al
    que tiene rango y skills, o el planificador se la da a cualquiera."""
    catalogo = [
        {"id": 31, "nombre": "CORTE CON  AMOLADORA", "configurado": 5, "usos": 17},
        {"id": 222, "nombre": "CORTE CON AMOLADORA", "configurado": 1, "usos": 15},
        {"id": 7, "nombre": "EMBALADO", "configurado": 0, "usos": 0},
    ]
    assert imp.elegir_id_por_nombre(catalogo) == {"CORTE CON AMOLADORA": 31, "EMBALADO": 7}


# ---------------------------------------------------------------------------
# Cabecera
# ---------------------------------------------------------------------------
def test_abierta_en_spmm_si_y_solo_si_pendiente_en_el_viejo():
    assert imp.finalizada_segun_el_viejo(15243, {15243, 15244}) == 0
    # Suspendida, ttt1 o entregada allá: no está en Q_PENDIENTES y acá queda cerrada.
    assert imp.finalizada_segun_el_viejo(11721, {15243}) == 1


def test_no_pisa_con_vacio_lo_que_el_viejo_no_resolvio():
    actual = {c: None for c in imp.COLS_OT}
    actual.update(id_cliente=5, id_articulo=9, fecha_prometida=datetime(2026, 10, 2),
                  observaciones="vieja")
    nueva = dict(actual, id_cliente=None, id_articulo=None, fecha_prometida=None,
                 observaciones="nueva")
    assert imp.columnas_que_cambian(actual, nueva) == {"observaciones": "nueva"}


# ---------------------------------------------------------------------------
# El modo de todas las semanas: sólo agrega
# ---------------------------------------------------------------------------
def test_trae_solo_las_que_faltan():
    assert imp.ot_a_dar_de_alta({15916, 15917, 15918}, {15916: {}}) == [15917, 15918]
    # Pedida a mano aunque el viejo no la liste como pendiente.
    assert imp.ot_a_dar_de_alta({15917}, {15917: {}}, pedidas=[15820]) == [15820]
    # Correrlo de nuevo, con todo ya traído, no trae nada.
    assert imp.ot_a_dar_de_alta({15917}, {15917: {}}) == []


def test_un_numero_de_otra_orden_se_detecta():
    """Crear una OT en SPMM toma max(id_otvieja)+1, que es el próximo número del viejo."""
    spmm = {"cliente_viejo": 4, "fecha_orden": datetime(2026, 9, 23)}
    assert not imp.es_otra_ot(spmm, {"_cliente_viejo": 4, "fecha_orden": datetime(2026, 9, 23)})
    assert imp.es_otra_ot(spmm, {"_cliente_viejo": 69, "fecha_orden": datetime(2026, 9, 23)})
    assert imp.es_otra_ot(spmm, {"_cliente_viejo": 4, "fecha_orden": datetime(2026, 9, 24)})


def test_el_modo_semanal_no_actualiza_ni_borra():
    """«Que cuando corramos la migración no se sobreescriban» (Julián, 23/09): el camino
    por defecto sólo inserta. Todo UPDATE/DELETE vive en _escribir_recarga, que corre
    únicamente con --recargar."""
    for funcion in (imp._altas, imp._insertar_procesos, imp.main):
        codigo = inspect.getsource(funcion).lower()
        for prohibido in ("update orden_trabajo", "delete from"):
            assert prohibido not in codigo, f"{funcion.__name__} tiene «{prohibido}»"
    llamada = re.search(r"if RECARGAR:\s*\n\s*await _escribir_recarga", inspect.getsource(imp.main))
    assert llamada, "_escribir_recarga tiene que correr sólo detrás de --recargar"


# ---------------------------------------------------------------------------
# Prueba piloto del 28/9: recargar SÓLO las OT del plan, y cerrar lo que el viejo cerró
# ---------------------------------------------------------------------------
def test_recargar_con_ot_toca_solo_las_pedidas():
    """«--recargar --ot» es para las OT del plan: no puede tocar ninguna otra ni traer
    otras nuevas, aunque el viejo tenga pendientes que SPMM no tiene."""
    en_spmm = {15243: {}, 15556: {}, 15670: {}}
    pendientes = {15243, 15556, 15670, 15917}
    assert imp.alcance(True, [15243, 15918], pendientes, en_spmm) == ([15243], [15918])


def test_recargar_sin_ot_sigue_siendo_todas():
    en_spmm = {15243: {}, 15556: {}}
    assert imp.alcance(True, [], {15243, 15917}, en_spmm) == ([15243, 15556], [15917])


def test_el_modo_semanal_no_recarga_nada():
    assert imp.alcance(False, [15820], {15917}, {15243: {}}) == ([], [15820, 15917])


def test_cierra_las_abiertas_que_el_viejo_ya_no_tiene_pendientes():
    spmm = {15902: {"abierta": True}, 15243: {"abierta": True}, 13813: {"abierta": False}}
    # 15243 sigue pendiente: queda. 13813 ya está cerrada: no se toca.
    assert imp.ot_a_cerrar(spmm, {15243, 13813}) == [15902]


def test_el_motivo_de_cierre_se_lee_del_viejo():
    assert imp.motivo_de_cierre({"fecha_entrega": datetime(2026, 9, 24)}) == "entregada el 24/09/2026"
    assert imp.motivo_de_cierre({"fecha_entrega": None, "fc": 0, "ttt1": 1}) == "marca ttt1"
    assert imp.motivo_de_cierre({"fecha_entrega": None, "cantidad_entregada": 10,
                                 "unidades": 10}) == "todo entregado"


def test_los_cierres_corren_solo_con_cerrar():
    """Cerrar es un UPDATE: vive en su función y sólo se llama detrás de --cerrar."""
    assert re.search(r"if CERRAR and a_cerrar:\s*\n\s*await _escribir_cierres", inspect.getsource(imp.main))
