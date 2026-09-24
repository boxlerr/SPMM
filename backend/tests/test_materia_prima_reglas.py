"""Las reglas PURAS de la materia prima (application/materia_prima/reglas.py y
estado.estado_material): sin base, con números sueltos.

Lo que persigue este archivo son las formas en que estas reglas dejan de servir en el
taller, no la cobertura:

  1. **Que la descripción salga distinta para el mismo insumo.** Es la clave del aviso
     de duplicado: si la misma barra se escribe de dos formas, el aviso no la encuentra.
  2. **Que las pulgadas se lean mal.** En el viejo «1 1/4» quedaba 11 (Val() cortaba en
     el espacio); acá tiene que ser 31,75 mm, y volver a escribirse 1 1/4".
  3. **Que el código nuevo rompa la serie** (o repita el bug XXX001001 del viejo). El
     código lo usan las facturas del viejo.
  4. **Que la sugerencia de metros quede corta.** Redondear para abajo deja un corte sin
     material.
  5. **Que el estado del material diga «ok» con algo sin pedir**, que es justo el bug
     que motivó todo esto.
"""
import re
from pathlib import Path

import pytest

from backend.application.materia_prima import reglas
from backend.application.materia_prima.estado import estado_material
from backend.application.materia_prima.reglas import (
    ESPESOR_SIERRA_MM,
    descripcion_insumo,
    escalar_cantidad,
    factor_historial,
    fmt_mm,
    mm_a_pulgadas_texto,
    norm_desc,
    prefijo_codigo,
    pulgadas_a_mm,
    siguiente_codigo,
    sugerido_m,
    tipo_efectivo,
    unidad_linea_desde_pieza,
)
from backend.application.materia_prima.semilla import FORMATOS_SEMILLA

MIGRACION = (Path(__file__).resolve().parent.parent / "scripts" / "migrations"
             / "2026-09-23_materia_prima.sql")


# ─────────────────────── medidas ───────────────────────

@pytest.mark.parametrize("valor,texto", [
    (38.1, "38.1"), (20, "20"), (20.0, "20"), (4.75, "4.75"), (1000, "1000"),
    (31.750, "31.75"), (0.0004, "0"), (-0.0, "0"), (12.3456, "12.346"),
])
def test_los_mm_se_escriben_sin_ceros_de_mas(valor, texto):
    assert fmt_mm(valor) == texto


@pytest.mark.parametrize("mm,texto", [
    (31.75, '1 1/4"'), (6.35, '1/4"'), (25.4, '1"'), (63.5, '2 1/2"'),
    (9.525, '3/8"'), (0.396875, '1/64"'), (50.8, '2"'),
    # Lo que trae el viejo, con los mm redondeados a uno o dos decimales.
    (9.52, '3/8"'), (6.4, '1/4"'), (4.7, '3/16"'),
    # Lo que no es una fracción de hasta 64avos va en pulgadas con decimales (y en 32avos
    # y 64avos la fracción tiene que ser exacta: 10 mm no es 25/64").
    (10, '0.394"'), (9.92, '0.391"'), (9.922, '25/64"'),
])
def test_los_mm_se_escriben_en_pulgadas_como_en_el_taller(mm, texto):
    assert mm_a_pulgadas_texto(mm) == texto


@pytest.mark.parametrize("texto,mm", [
    ("1 1/4", 31.75), ("1-1/4", 31.75), ("1 - 1/4", 31.75), ("3/8", 9.525),
    ("2 1/2", 63.5), ('1 1/4"', 31.75), ("1,5", 38.1), ("1.5", 38.1), ("1", 25.4),
    (" 1/2 ", 12.7), (2, 50.8),
])
def test_las_pulgadas_tipeadas_se_leen_en_mm(texto, mm):
    assert pulgadas_a_mm(texto) == pytest.approx(mm)


@pytest.mark.parametrize("texto", ["", None, "abc", "1/0", "1 1/", "3/8mm", True])
def test_lo_que_no_se_entiende_no_se_inventa(texto):
    assert pulgadas_a_mm(texto) is None


def test_ida_y_vuelta_de_las_pulgadas():
    """Lo que se tipea en pulgadas vuelve a escribirse igual en la descripción."""
    for fraccion in ("1/64", "3/16", "1/2", "7/8", "1 1/4", "2 3/8", "5"):
        esperado = fraccion + '"'
        assert mm_a_pulgadas_texto(pulgadas_a_mm(fraccion)) == esperado


# ─────────────────────── descripción ───────────────────────

def test_la_descripcion_de_un_insumo_en_mm():
    assert descripcion_insumo("BARRA CUADRADO", ["Lado"], [38.1], "mm", "ACERO", "SAE 1045") == (
        "BARRA CUADRADO 38.1mm ACERO SAE 1045", [])
    assert descripcion_insumo(
        "TUBO RECTANGULAR", ["Lado A", "Lado B", "Espesor"], [70, 30, 2, None, None], "mm",
        "ACERO", "SAE 1010",
    ) == ("TUBO RECTANGULAR 70mm x 30mm x 2mm ACERO SAE 1010", [])


def test_la_descripcion_de_un_insumo_en_pulgadas_lleva_los_mm_entre_parentesis():
    desc, faltan = descripcion_insumo(
        "PLANCHUELA", ["Ancho", "Espesor"], [25.4, 6.35], "pulgada", "ACERO", "SAE 1010")
    assert desc == 'PLANCHUELA 1" (25.4mm) x 1/4" (6.35mm) ACERO SAE 1010'
    assert faltan == []


def test_sin_calidad_la_descripcion_termina_en_el_material():
    assert descripcion_insumo("BARRA REDONDO", ["Ø"], [19], "mm", "ALUMINIO", None)[0] == (
        "BARRA REDONDO 19mm ALUMINIO")


def test_espacios_simples_siempre():
    """El viejo dejaba 2, 3 o 4 espacios según las medidas: acá la misma barra se escribe
    siempre igual, que es lo que hace que el aviso de duplicado la encuentre."""
    desc, _ = descripcion_insumo("  BARRA   REDONDO ", ["Ø"], [19], "mm", " ACERO ", "SAE  1010")
    assert desc == "BARRA REDONDO 19mm ACERO SAE 1010"


def test_si_falta_algo_dice_que_y_no_arma_nada():
    """Todas las medidas que pide el formato son obligatorias y positivas: sin una, la
    descripción diría otra cosa que el insumo."""
    assert descripcion_insumo("TUBO REDONDO", ["Ø exterior", "Ø interior"], [38.1], "mm",
                              "ACERO", None) == (None, ["Ø interior"])
    assert descripcion_insumo("PLACA", ["Espesor", "Ancho", "Largo"], [10, 0, -3], "mm",
                              None, None) == (None, ["Ancho", "Largo", "Material"])
    assert descripcion_insumo(None, [], [], "mm", None, None) == (None, ["Formato", "Material"])


def test_la_descripcion_se_compara_normalizada():
    assert norm_desc("barra  redondo 19mm   acero ") == "BARRA REDONDO 19MM ACERO"
    assert norm_desc(None) == ""


# ─────────────────────── código ───────────────────────

def test_el_prefijo_de_un_insumo_es_material_mas_formato():
    assert prefijo_codigo("insumo", None, "ACERO", "BC", None) == "ABC"
    # La letra propia del material manda sobre la inicial del nombre.
    assert prefijo_codigo("insumo", "P", "POLIURETANO", "TR", None) == "PTR"
    assert prefijo_codigo("insumo", None, None, "BC", None) is None
    assert prefijo_codigo("insumo", None, "ACERO", None, None) is None


def test_el_prefijo_de_lo_demas_son_las_tres_primeras_letras_de_la_descripcion():
    assert prefijo_codigo("consumible", None, None, None, "Codo 90° galvanizado") == "COD"
    assert prefijo_codigo("insumo_desc", None, None, None, " 3M-cinta") == "3MC"
    assert prefijo_codigo(None, None, None, None, "Ñandú") == "ÑAN"
    assert prefijo_codigo("consumible", None, None, None, "AB") == "AB"
    assert prefijo_codigo("consumible", None, None, None, "  ") is None


def test_el_numero_sigue_la_serie_del_prefijo():
    existentes = ["ABC077", "abc078 ", "ABC2", "ABCD001", "ABC07X", " ABC010"]
    assert siguiente_codigo("ABC", existentes) == "ABC079"
    assert siguiente_codigo("COR", ["COR2550", "COR2551"]) == "COR2552"


def test_un_prefijo_nuevo_arranca_en_001_y_no_en_001001():
    """El bug del viejo: el primer código de un prefijo salía XXX001001 (63 casos)."""
    assert siguiente_codigo("DUL", []) == "DUL001"
    assert siguiente_codigo("XYZ", ["XY001", "XYZA01"]) == "XYZ001"


def test_los_codigos_del_bug_se_cuentan_por_lo_que_dicen():
    """DUL001001 ya está en facturas: no se reinterpreta, se cuenta como 1001."""
    assert siguiente_codigo("DUL", ["DUL001001"]) == "DUL1002"


def test_sin_prefijo_no_hay_codigo():
    assert siguiente_codigo("", ["A001"]) is None
    assert siguiente_codigo(None, []) is None


def test_tipo_sin_clasificar_se_trata_como_descripcion_libre():
    assert tipo_efectivo(None) == "insumo_desc"
    assert tipo_efectivo("raro") == "insumo_desc"
    assert tipo_efectivo("insumo") == "insumo"


# ─────────────────────── cortes e historial ───────────────────────

def test_la_sugerencia_suma_la_sierra_y_redondea_para_arriba():
    assert ESPESOR_SIERRA_MM == 3
    # 3 × (1093 + 3) = 3288 mm → 3,288 m → 3,29 (nunca 3,28: faltaría material).
    assert sugerido_m([{"cantidad": 3, "largo_mm": 1093}]) == 3.29
    assert sugerido_m([{"cantidad": 2, "largo_mm": 997}, {"cantidad": 1, "largo_mm": 497}]) == 2.5
    # Exacto no sube: 1 × (997 + 3) = 1000 mm = 1 m.
    assert sugerido_m([{"cantidad": 1, "largo_mm": 997}]) == 1.0


def test_sin_largo_en_algun_corte_no_hay_sugerencia():
    assert sugerido_m([{"cantidad": 3, "largo_mm": 1093}, {"cantidad": 1, "largo_mm": None}]) is None
    assert sugerido_m([]) is None
    assert sugerido_m(None) is None


def test_la_sugerencia_lee_objetos_tambien():
    class Corte:
        cantidad = 4
        largo_mm = 247.0
    assert sugerido_m([Corte()]) == 1.0


def test_el_factor_del_historial():
    assert factor_historial(10, 5) == 2
    assert factor_historial(3, 4) == 0.75
    for actual, origen in ((None, 5), (10, None), (0, 5), (10, 0), ("x", 2)):
        assert factor_historial(actual, origen) == 1.0


def test_escalar_redondea_las_unidades_para_arriba():
    assert escalar_cantidad(3, 0.8, "Un") == 3        # 2,4 bulones son 3
    assert escalar_cantidad(3, 0.8, "UN") == 3
    assert escalar_cantidad(0.1, 30, "Un") == 3        # sin el 3,0000000000000004 → 4
    assert escalar_cantidad(2.5, 1.5, "Mts") == 3.75
    assert escalar_cantidad(1, 1 / 3, "Kg") == 0.333


@pytest.mark.parametrize("pieza,linea", [
    ("UN", "Un"), ("MTS", "Mts"), ("KG", "Kg"), ("LTS", "Lts"),
    ("Mts", "Mts"), (" kg ", "Kg"), ("HS", "Un"), (None, "Un"), ("SIN UNIDAD", "Un"),
])
def test_la_unidad_de_la_linea_sale_de_la_del_insumo(pieza, linea):
    assert unidad_linea_desde_pieza(pieza) == linea


# ─────────────────────── estado del material ───────────────────────

def _l(usado=1, pedido=0, reserva=0, disponible=0):
    return {"usado": usado, "pedido": pedido, "reserva": reserva, "disponible": disponible}


def test_el_estado_del_material():
    assert estado_material(1, [_l()]) == "no_lleva"
    assert estado_material(0, []) == "sin_datos"
    assert estado_material(0, [_l(usado=0)]) == "sin_datos"
    assert estado_material(0, [_l(disponible=1), _l(disponible=1, pedido=1)]) == "ok"
    assert estado_material(0, [_l(pedido=1), _l(reserva=1)]) == "pedido"
    assert estado_material(0, [_l(disponible=1), _l(pedido=1)]) == "pedido"


def test_con_algo_sin_pedir_falta_pedir_aunque_haya_lo_demas():
    """El bug de origen: SPMM decía «ok» en OT con líneas sin pedir."""
    assert estado_material(0, [_l(disponible=1), _l(pedido=1), _l()]) == "sin_stock"


def test_las_lineas_no_usadas_no_cuentan():
    assert estado_material(0, [_l(disponible=1), _l(usado=0)]) == "ok"


@pytest.mark.parametrize("codigo", ["TRA011", " tra011 "])
def test_trabajo_sin_material_cuenta_como_disponible(codigo):
    """TRA011 («TRABAJO SIN MATERIAL / SIN INSUMOS») casi nunca se tilda: sola, la OT está
    lista (15894 y 15916 salían «Falta pedir» por no haber pedido nada); con otra línea,
    manda la otra. Sin usar, no cuenta."""
    tra = {**_l(), "codigo": codigo}
    assert estado_material(0, [tra]) == "ok"
    assert estado_material(0, [tra, {**_l(pedido=1), "codigo": "ABR117"}]) == "pedido"
    assert estado_material(0, [tra, {**_l(), "codigo": "ABR117"}]) == "sin_stock"
    assert estado_material(0, [{**tra, "usado": 0}]) == "sin_datos"
    assert estado_material(1, [tra]) == "no_lleva"
    # Otro código, u otra línea sin código, no es «sin material».
    assert estado_material(0, [{**_l(), "codigo": "TRA012"}]) == "sin_stock"
    assert estado_material(0, [_l()]) == "sin_stock"


def test_las_marcas_vacias_valen_su_default():
    """Una línea de antes de la migración (usado NULL) se usa; pedido NULL es no pedido."""
    assert estado_material(0, [{"usado": None, "pedido": None, "disponible": None}]) == "sin_stock"
    assert estado_material(None, [{"disponible": True}]) == "ok"


# ─────────────────────── la semilla de formatos ───────────────────────

def test_la_semilla_de_formatos_es_la_misma_en_la_migracion_y_en_python():
    """La siembra la migración en Postgres; los tests la cargan con sembrar_formatos. Si
    se agrega un formato, va en los dos lados. (Desde el 24/09 el .sql la escribe como
    INSERT … SELECT … FROM (VALUES …) AS v WHERE NOT EXISTS, para no gastar la secuencia
    en cada arranque; el módulo que la aplica sola lo compara
    test_migraciones_al_arrancar.test_la_semilla_de_formato_es_la_de_semilla_py.)"""
    sql = MIGRACION.read_text()
    filas = []
    for columnas, valores in re.findall(
            r"INSERT INTO formato \(([^)]*)\)\s*SELECT .*? FROM \(VALUES(.*?)\) AS v ", sql, re.S):
        cols = [c.strip() for c in columnas.split(",")]
        for tupla in re.findall(r"\(([^()]*)\)", valores):
            datos = dict(zip(cols, [v.strip().strip("'") for v in tupla.split(",")]))
            etiquetas = tuple(datos[f"etiqueta{i}"] for i in range(1, 6) if f"etiqueta{i}" in datos)
            filas.append((int(datos["orden"]), datos["nombre"], datos["iniciales"], etiquetas))
    filas.sort()
    assert [(n, i, e) for _, n, i, e in filas] == list(FORMATOS_SEMILLA)
    assert [o for o, *_ in filas] == list(range(1, len(FORMATOS_SEMILLA) + 1))


def test_las_constantes_de_la_api():
    assert reglas.UNIDADES_LINEA == ("Un", "Mts", "Kg", "Lts")
    assert [t["valor"] for t in reglas.TIPOS_CATALOGO] == list(reglas.TIPOS_INSUMO)
