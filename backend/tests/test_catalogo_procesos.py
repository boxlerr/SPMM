"""
El catálogo de procesos limpio y el importador del Integral (reunión con Lucas, 29/9/2026).

Dos cosas que no se pueden separar: la limpieza renombró y fusionó procesos en la base
(TORNO T1..T6 → TORNEADO, FRESADORA F6..F9 → FRESADO CONVENCIONAL, ...), y el Integral
sigue cargando OT con los nombres viejos. Si el importador no traduce, la próxima OT con
«TORNO T1» frena la importación («proceso que no está en el catálogo») y la recarga borra
pasadas con avance porque ve distinto un TORNEADO de SPMM y un «TORNO T1» del viejo.
"""
import pytest

from backend.application.catalogo_procesos import RENOMBRES_DEL_VIEJO, nombre_en_spmm
from backend.application.PlanificacionService import _get_tipo_proceso, familia_requerida_from_proceso
from backend.scripts.importar_ot_legacy import (
    cambios_de_procesos,
    clave_proceso,
    elegir_id_por_nombre,
    lista_del_viejo,
)
from backend.scripts.limpiar_catalogo_procesos import (
    FUSIONES,
    es_basura,
    filas_por_proceso_a_fusionar,
    mapa_de_fusiones,
    nombres_finales,
    normalizar,
    reescribir_json,
    skills_a_fusionar,
)

# Los dos que se fusionan y NO vienen del Integral: son errores de tipeo que sólo existían
# en SPMM, así que el importador nunca los ve.
SOLO_EN_SPMM = {141, 335}


# ── El importador ────────────────────────────────────────────────────────────
@pytest.mark.parametrize("viejo, nuevo", [
    ("TORNO T1", "TORNEADO"), ("Torno  t6", "TORNEADO"), ("FRESADORA F6", "FRESADO CONVENCIONAL"),
    ("fresadora f9", "FRESADO CONVENCIONAL"), ("TORNO CNC", "TORNEADO CNC"), ("FRESADORA CNC", "FRESADO CNC"),
    ("AGUSTE PARA BUJE", "AJUSTE PARA BUJE"), ("VICELADO PARA SOLDADURA", "BICELADO PARA SOLDADURA"),
    ("CORTE CON  AMOLADORA", "CORTE CON AMOLADORA"), ("PREPARACION DE TORNO", "PREPARACION DE TORNO"),
])
def test_el_importador_habla_con_los_nombres_de_spmm(viejo, nuevo):
    assert clave_proceso(viejo) == nuevo


def test_la_lista_del_viejo_sale_con_los_nombres_de_spmm():
    filas = [
        {"orden": 1, "id": 1, "proceso": 10, "nombre": "PREPARACION DE TORNO", "minutos": 40},
        {"orden": 2, "id": 2, "proceso": 11, "nombre": "TORNO T1", "minutos": 120},
        {"orden": 3, "id": 3, "proceso": 12, "nombre": "FRESADORA F6", "minutos": 60},
    ]
    assert lista_del_viejo(filas) == [(1, "PREPARACION DE TORNO", 40), (2, "TORNEADO", 120),
                                      (3, "FRESADO CONVENCIONAL", 60)]


def test_con_el_catalogo_limpio_cada_nombre_viejo_tiene_su_proceso():
    catalogo = [{"id": 151, "nombre": "TORNEADO"}, {"id": 68, "nombre": "FRESADO CONVENCIONAL"},
                {"id": 105, "nombre": "PREPARACION DE TORNO"}]
    ids = elegir_id_por_nombre(catalogo)
    assert ids[clave_proceso("TORNO T4")] == 151
    assert ids[clave_proceso("FRESADORA F8")] == 68


def test_con_el_catalogo_sin_limpiar_tambien_anda():
    """Entre el deploy del backend y la limpieza, el catálogo todavía tiene TORNO T1..T6:
    todos caen en el mismo proceso, el configurado y más usado, como con los gemelos."""
    catalogo = [{"id": 151, "nombre": "TORNO T1", "configurado": 7, "usos": 355},
                {"id": 152, "nombre": "TORNO T2", "configurado": 7, "usos": 165}]
    assert elegir_id_por_nombre(catalogo) == {"TORNEADO": 151}


def test_la_recarga_no_borra_un_torneado_porque_el_viejo_diga_torno_t1():
    """La pasada ya está en SPMM como TORNEADO (con su avance): es la misma."""
    spmm = [{"id": 900, "orden": 1, "clave": clave_proceso("TORNEADO"), "minutos": 120, "con_datos": True}]
    viejo = lista_del_viejo([{"orden": 1, "id": 1, "proceso": 11, "nombre": "TORNO T1", "minutos": 120}])
    assert cambios_de_procesos(spmm, viejo) == ([], [], [])


# ── La tabla de fusiones y la del importador dicen lo mismo ─────────────────
def test_cada_nombre_fusionado_lo_traduce_el_importador_al_que_queda():
    for f in FUSIONES:
        final = normalizar(f.nombre_nuevo or f.nombre_actual)
        assert nombre_en_spmm(normalizar(f.nombre_actual)) == final, f.nombre_actual
        for vid, vnom in f.absorbe.items():
            if vid in SOLO_EN_SPMM:
                continue
            assert nombre_en_spmm(normalizar(vnom)) == final, vnom


def test_toda_traduccion_del_importador_apunta_a_un_nombre_que_queda():
    finales = {normalizar(f.nombre_nuevo or f.nombre_actual) for f in FUSIONES}
    for viejo, nuevo in RENOMBRES_DEL_VIEJO.items():
        assert nuevo in finales, f"{viejo} → {nuevo}: ninguna fusión deja ese proceso"


def test_ninguna_fusion_cambia_la_familia_de_maquina():
    for f in FUSIONES:
        final = f.nombre_nuevo or f.nombre_actual
        for nombre in [f.nombre_actual, *f.absorbe.values()]:
            assert familia_requerida_from_proceso(nombre) == familia_requerida_from_proceso(final), nombre


def test_los_genericos_siguen_siendo_trabajo_de_maquina():
    for nombre in ("TORNEADO", "TORNEADO CNC", "FRESADO CONVENCIONAL", "FRESADO CNC"):
        assert _get_tipo_proceso(nombre) == "PRODUCCION_MAQUINA", nombre


def test_mapa_y_nombres_finales():
    mapa = mapa_de_fusiones(FUSIONES)
    assert mapa[152] == 151 and mapa[71] == 68 and 151 not in mapa
    nombres = nombres_finales(FUSIONES)
    assert nombres[152] == nombres[151] == "TORNEADO"
    assert nombres[150] == "TORNEADO CNC"


# ── Las reglas de la fusión ──────────────────────────────────────────────────
MAPA = {152: 151, 153: 151, 335: 138}


def test_la_skill_del_que_queda_manda():
    filas = [
        {"id_operario": 1, "id_proceso": 151, "nivel": 1, "orden": 3},
        {"id_operario": 1, "id_proceso": 152, "nivel": 2, "orden": 0},
    ]
    assert skills_a_fusionar(filas, MAPA) == ([], [(1, 152)])


def test_la_skill_del_que_se_va_completa_lo_que_falta():
    filas = [
        {"id_operario": 2, "id_proceso": 153, "nivel": 1, "orden": 5},
        {"id_operario": 2, "id_proceso": 152, "nivel": 1, "orden": 2},
    ]
    mover, borrar = skills_a_fusionar(filas, MAPA)
    assert mover == [(2, 152, 151)], "pasa la más preferida (menor orden)"
    assert borrar == [(2, 153)]


def test_los_rangos_del_que_queda_mandan_y_no_se_suman():
    """CORTE CON AMOLADORA: el que queda pide MEDIO OFICIAL y OPERARIO CALIFICADO (como el
    Excel); el INGRESANTE del gemelo no se suma, porque abriría el proceso a otra gente."""
    filas = [{"id_proceso": 31, "id_rango": 4}, {"id_proceso": 31, "id_rango": 12},
             {"id_proceso": 222, "id_rango": 11}]
    assert filas_por_proceso_a_fusionar(filas, {222: 31}, "id_rango") == ([], [(11, 222)])


def test_si_el_que_queda_no_tiene_rangos_toma_los_del_que_se_va():
    filas = [{"id_proceso": 3204, "id_rango": 6}]
    assert filas_por_proceso_a_fusionar(filas, {3204: 4}, "id_rango") == ([(6, 3204, 4)], [])


def test_basura_es_lo_que_no_es_del_integral_y_nadie_usa():
    viejo = {"TORNO T1", "CORTE CON AMOLADORA"}
    assert es_basura({"id": 1, "nombre": "TORNO T1 trBAJO 3 dias 24h", "referencias": 0}, viejo, set())
    assert not es_basura({"id": 2, "nombre": "Torno  t1", "referencias": 0}, viejo, set()), "es del Integral"
    assert not es_basura({"id": 3, "nombre": "CORTE Y SOLDADO", "referencias": 1}, viejo, set())
    assert not es_basura({"id": 4, "nombre": "X", "referencias": 0}, viejo, {4}), "protegido"


def test_el_borrador_pasa_al_proceso_que_queda():
    contenido = {
        "resultados": [
            {"proceso_id": 152, "nombre_proceso": "TORNO T2", "id_orden_trabajo_proceso": 5},
            {"proceso_id": 151, "nombre_proceso": "TORNO T1"},
            {"proceso_id": 96, "nombre_proceso": "PREPARACION DE FRESADORA"},
        ],
        "ediciones": {"12720-152-7": {"proceso_id": 152, "nombre_proceso": "TORNO T2"}},
        "carga": {"2026-09-30": 3, "1-152-3": "no es una edición"},
    }
    nuevo, n = reescribir_json(contenido, {152: 151}, {151: "TORNEADO", 152: "TORNEADO"})
    assert [r["proceso_id"] for r in nuevo["resultados"]] == [151, 151, 96]
    assert [r["nombre_proceso"] for r in nuevo["resultados"]] == ["TORNEADO", "TORNEADO", "PREPARACION DE FRESADORA"]
    assert nuevo["resultados"][0]["id_orden_trabajo_proceso"] == 5
    assert nuevo["ediciones"] == {"12720-151-7": {"proceso_id": 151, "nombre_proceso": "TORNEADO"}}
    assert nuevo["carga"] == contenido["carga"], "fuera de las ediciones las claves no se tocan"
    assert n == 6   # 2 en el primer resultado, el nombre del segundo, y clave+id+nombre de la edición


def test_la_foto_de_version_pasa_al_proceso_que_queda():
    foto = [{"id": 1, "orden": 1, "id_proceso": 153, "tiempo_proceso": 20},
            {"id": 2, "orden": 2, "id_proceso": 105, "tiempo_proceso": 40}]
    nuevo, n = reescribir_json(foto, {153: 151}, {})
    assert [p["id_proceso"] for p in nuevo] == [151, 105] and n == 1
