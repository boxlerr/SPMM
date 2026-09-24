"""La conversión del sistema viejo (application/materia_prima/legado.py).

La usan la importación y el paso 7b del sync, así que un error acá entra dos veces. Los
casos raros son filas de verdad del viejo (el código entre paréntesis), medidos el
24/09/2026: las funciones se calibraron contra las 17.774 piezas, las 19.504 líneas de
OT, los 3.724 cortes, los 271 recortes y los 110 casilleros de la cañera.

Resultado de esa calibración, para comparar si alguien cambia las reglas:
  · medidas de las 1.501 piezas tipo insumo: 98,9% (mm 1.345/1.358 = 99,0%, pulgadas
    140/143 = 97,9%);
  · material encontrado en la descripción: 99,3%, con calidad en 1.310 (87,3%);
  · proveedor de la lista por el texto libre: 5.381 de 13.154 piezas (40,9%) y 8.199 de
    15.599 líneas (52,6%); el resto no está en la lista con ese nombre (DIMAR, ROSSI,
    TELLO…) o nombra a dos (DEELS);
  · cañera: 110 de 110 ubicaciones; recortes con largo 261 de 271; cortes con largo
    3.712 de 3.724;
  · fechas descartadas: 2 de 17.775 en pieza.fecha, 12 de 64.587 en el historial de
    precios y 28 fechaprov imposibles (2029..7202), además de 5.277 centinelas 1900/1950.
"""
from datetime import date, datetime

import pytest

from backend.application.materia_prima import legado as L
from backend.application.materia_prima.reglas import descripcion_insumo
from backend.application.materia_prima.semilla import FORMATOS_SEMILLA

HOY = date(2026, 9, 24)
ETIQUETAS = {nombre: etiquetas for nombre, _, etiquetas in FORMATOS_SEMILLA}
MATERIALES = ["ACERO", "ALUMINIO", "BRONCE", "PLASTICO", "PLASTICOS", "ACERO TREFILADO",
              "CORTE POR PANTOGRAFO", "DISCO", "PLANCHUELA", "POLIURETANO", "GOMA"]


def _medidas(formato, descripcion, t=(0, 0, 0, None, None), medida=0):
    return L.medidas_desde_legacy(formato, *t, medida, descripcion)


# ─────────────────────────── códigos, tipo, texto ───────────────────────────

def test_codigo_se_compara_como_el_viejo():
    assert L.norm_codigo(" co002 ") == "CO002"
    assert L.norm_codigo(None) == ""


@pytest.mark.parametrize("insumo, tipo", [
    (0, "insumo"), (1, "consumible"), (2, "insumo_desc"), (None, "insumo_desc"), (7, "insumo_desc"),
])
def test_tipo_no_sigue_el_orden_de_los_radios(insumo, tipo):
    """' CO002' tiene insumo=2 y en la pantalla del viejo es «Insumo c/ descripcion»."""
    assert L.tipo_desde_legacy(insumo) == tipo


def test_un_espacio_es_vacio():
    assert L.texto_limpio(" ") is None
    assert L.texto_limpio(" TELLO ") == "TELLO"


# ─────────────────────────── fechas ───────────────────────────

@pytest.mark.parametrize("texto, esperada", [
    ("11/03/2026", date(2026, 3, 11)),
    ("25/11/20  ", date(2020, 11, 25)),       # dd/mm/yy con relleno
    ("9/4/19", date(2019, 4, 9)),
    ("02/02/018 ", date(2018, 2, 2)),        # año de 3 dígitos con cero adelante
    ("08/20/22  ", date(2022, 8, 20)),       # mm/dd: sólo se da vuelta si no hay otra
    ("13/10/201 ", None),                    # truncada: no se adivina la década
    ("05/09/218 ", None),
    ("01/01/0201", None),                    # años basura del historial de precios
    ("01/01/2202", None),
    ("31/02/2024", None),
    ("  /  /    ", None),                    # fechaProvE: nunca se llenó
    ("", None), (None, None),
])
def test_fecha_desde_texto(texto, esperada):
    assert L.fecha_desde_texto(texto, HOY) == esperada


def test_fecha_texto_hasta_el_anio_que_viene():
    assert L.fecha_desde_texto("01/01/2027", HOY) == date(2027, 1, 1)
    assert L.fecha_desde_texto("01/01/2028", HOY) is None


@pytest.mark.parametrize("valor, esperada", [
    (datetime(2026, 9, 22), date(2026, 9, 22)),
    (datetime(1900, 1, 1), None),            # «sin fecha» de la versión nueva del viejo
    (datetime(1950, 1, 1), None),            # «sin fecha» de la vieja
    (datetime(8202, 5, 9), None),            # fechaprov de la OT 11953
    (datetime(2029, 7, 30), None),           # más de hoy + 2
    (datetime(2028, 1, 5), date(2028, 1, 5)),
    (date(2002, 5, 1), date(2002, 5, 1)),
    ("22/09/2026", date(2026, 9, 22)),
    (None, None),
])
def test_fecha_desde_datetime(valor, esperada):
    assert L.fecha_desde_datetime(valor, HOY) == esperada


# ─────────────────────────── ubicación y cañera ───────────────────────────

@pytest.mark.parametrize("terna, esperada", [
    (("A", "A", "1"), (None, None, None)),   # el valor por defecto de los combos
    ((" a", "a ", "1"), (None, None, None)),
    ((None, None, None), (None, None, None)),
    (("", " ", ""), (None, None, None)),
    (("C1", "D", "6"), ("C1", "D", "6")),    # ABC040, un rack de barras
    (("A", "A", "6"), ("A", "A", "6")),      # A-A-6 sí es un lugar
    (("M2", "", ""), ("M2", None, None)),
])
def test_ubicacion_desde_legacy(terna, esperada):
    assert L.ubicacion_desde_legacy(*terna) == esperada


@pytest.mark.parametrize("ubicacion, esperada", [
    ("11", ("A", 1)), ("71", ("G", 1)), ("81", ("H", 1)),
    ("101", ("J", 1)), ("139", ("M", 9)), ("155", ("O", 5)),
    ("10", None),      # fila 0
    ("161", None),     # columna 16: la grilla llega a la O
    ("", None), (None, None), ("E4", None), ("1", None),
])
def test_ocupacion_desde_ubicacion(ubicacion, esperada):
    assert L.ocupacion_desde_ubicacion(ubicacion) == esperada


# ─────────────────────────── recortes y cortes ───────────────────────────

@pytest.mark.parametrize("texto, esperado", [
    ("2777", (2777, None, 1, None)),
    ("6000", (6000, None, 1, None)),                          # una barra entera
    ("1525x3", (1525, None, 3, None)),                        # tres tramos iguales
    ("670x8", (670, None, 8, None)),
    ("1200x400", (1200, 400, 1, None)),                       # un recorte de chapa
    ("3440 (pintado amarillo 1212)", (3440, None, 1, "pintado amarillo 1212")),
    ("0", (None, None, 1, None)),
    ("66000", (None, None, 1, None)),                         # 66 m: dedo
    ("PEDAZO", (None, None, 1, None)),
])
def test_recorte_desde_texto(texto, esperado):
    assert L.recorte_desde_texto(texto) == esperado


@pytest.mark.parametrize("cant, largo, esperado", [
    (3.0, "1093", (3, 1093, None, None)),                     # ATR007 de la OT 15692
    (1.0, "1220x2440", (1, 1220, 2440, None)),
    (2.0, "236mm X 1430mm", (2, 236, 1430, None)),
    (1.0, "206,5", (1, 206.5, None, None)),
    (1.0, "80x200x20mm", (1, None, None, "80x200x20mm")),
    (1.0, "25mm x 3/4\" x 115mm", (1, None, None, "25mm x 3/4\" x 115mm")),
    (1.0, "CONFIRMAR", (1, None, None, "CONFIRMAR")),
    (1.0, "2.20159e+006", (1, None, None, "2.20159e+006")),
    (1.0, "0.75", (1, None, None, "0.75")),                   # ¿metros? no se adivina
    (2.0, "", (2, None, None, None)),
    (0.0, "100", (None, 100, None, None)),
    (1.5, "100", (2, 100, None, None)),                       # piezas: hacia arriba
])
def test_corte_desde_texto(cant, largo, esperado):
    assert L.corte_desde_texto(cant, largo) == esperado


# ─────────────────────────── proveedores ───────────────────────────

PROVEEDORES = [
    {"id": 4, "razon_social": "ACEROS LAVALLE ", "fantasia": "ACEROS LAVALLE"},
    {"id": 340, "razon_social": "ACEROS CAS SA.", "fantasia": "ACEROS"},
    {"id": 394, "razon_social": "METALURGICA JR ", "fantasia": ""},
    {"id": 19, "razon_social": "HIERROS MORELLI S.R.L", "fantasia": "HIERROS MORELLI S.R.L"},
    {"id": 63, "razon_social": "TELLO DE MENESES MARCELO JAVIER", "fantasia": "TELLÒ"},
    # Dos proveedores con la misma fantasía (así está en el viejo).
    {"id": 17, "razon_social": "SZWARC MARIO JUAN", "fantasia": "DEELS "},
    {"id": 799, "razon_social": "DEELS METALES Y PLASTICOS S.R.L.", "fantasia": "DEELS"},
]


# « SA.» (con el punto al final y sin el del medio) es justo el de ACEROS CAS (id 340 del
# viejo): 89 piezas y 564 líneas dicen «ACEROS CAS». Está entre los sufijos del catálogo
# (catalogo_texto._SUFIJOS_SOCIETARIOS) desde el 24/09; antes no se emparejaban.


@pytest.mark.parametrize("texto, esperado", [
    ("ACEROS LAVALLE", 4),
    ("aceros  lavalle", 4),
    ("ACEROS CAS SA.", 340),             # tal cual está en la lista
    ("ACEROS CAS", 340),                 # sin el «SA.»
    ("ACEROS CAS S.A.", 340),
    ("METALÚRGICA JR", 394),             # con acento
    ("HIERROS MORELLI", 19),             # sin el «S.R.L»
    ("tello", 63),                       # fantasía 'TELLÒ'
    ("DEELS", None),                     # dos candidatos: no se elige
    ("METARLURGICA JR", None),           # parecido no es igual
    ("LAVALLE", None),
    ("", None), (None, None),
])
def test_proveedor_por_texto(texto, esperado):
    assert L.proveedor_por_texto(texto, PROVEEDORES) == esperado
    assert L.proveedor_por_texto(texto, L.indice_proveedores(PROVEEDORES)) == esperado


def test_una_sola_normalizacion_de_proveedores():
    """La importación empareja proveedores con la MISMA regla que el aviso de «ya existe
    ese proveedor» del catálogo. Si cada uno normalizara a su manera, el mismo texto
    sería un proveedor conocido para uno y uno nuevo para el otro."""
    from backend.application.materia_prima import catalogo_texto

    assert L.norm_proveedor is catalogo_texto.norm_proveedor


def test_el_sufijo_se_saca_solo_al_final():
    assert L.norm_proveedor("LOSA") == "LOSA"
    assert L.norm_proveedor("SANTA ROSA SA") == "SANTA ROSA"
    assert L.norm_proveedor("Bulon Tools SRL ") == "BULON TOOLS"


# ─────────────────────────── material y calidad ───────────────────────────

@pytest.mark.parametrize("desc, material, formato, esperado", [
    ("BARRA REDONDO 19mm    ACERO SAE 1010", "ACERO", "BARRA REDONDO", ("ACERO", "SAE 1010")),
    ("BARRA HEXAGONAL 12mm    ACERO 12 L14", "ACERO", "BARRA HEXAGONAL", ("ACERO", "12 L14")),
    ("PLACA 8mm  x 497mm  x 897mm  ALUMINIO  ", "ALUMINIO", "PLACA", ("ALUMINIO", None)),
    ("PLANCHUELA 50mm  x 20mm   PLASTICOS PU 90 shore", "PLASTICOS", "PLANCHUELA",
     ("PLASTICOS", "PU 90 shore")),                       # respeta minúsculas
    ("TUBO REDONDO 80mm  x 25mm   PLASTICO DELRIN", "PLASTICO", "TUBO REDONDO",
     ("PLASTICO", "DELRIN")),                             # PLASTICO no es PLASTICOS
    ("CORTE PANTOGRAFO 266mm  x 1/4mm   DISCO  1045", "DISCO ", "CORTE PANTOGRAFO", ("DISCO", "1045")),
    # PP058: el combo de material dice PLANCHUELA (como el formato) y la descripción
    # dice ACERO SAE 1010. Lo que el taller ve es la descripción.
    ('PLANCHUELA 3" (76,2mm)  x 5/16" (7,9mm)   ACERO SAE 1010  ', "PLANCHUELA", "PLANCHUELA",
     ("ACERO", "SAE 1010")),
    # Sin el material en ningún lado: no se inventa la calidad.
    ("BARRA SAE 4140 DIAM 10", "ACERO", "REDONDO", ("ACERO", None)),
    ("ALGO", "", "", (None, None)),
])
def test_material_y_calidad(desc, material, formato, esperado):
    assert L.material_y_calidad_desde_descripcion(desc, material, MATERIALES, formato) == esperado


# ─────────────────────────── medidas ───────────────────────────

@pytest.mark.parametrize("formato, desc, t, esperado", [
    # mm: la descripción manda, t1..t5 son Val() y truncan la coma (3,2 → 3).
    ("BARRA REDONDO", "BARRA REDONDO 19mm    ACERO SAE 1010", (19, 0, 0, None, None), [19]),
    ("BARRA CUADRADO", "BARRA CUADRADO 38.1mm    ACERO SAE 1045", (38.1, 0, 0, 0, 0), [38.1]),
    ("TUBO CUADRADO", "TUBO CUADRADO 100mm  x 3,2mm   ACERO SAE 1010", (100, 3, 0, 0, 0), [100, 3.2]),
    ("TUBO RECTANGULAR", "TUBO RECTANGULAR 70mm  x 30mm  x 2mm   ACERO SAE 1010",
     (70, 30, 2, 0, 0), [70, 30, 2]),
    # PLACA: 38 filas nuevas guardan ancho/largo/espesor (PP084); la descripción no.
    ("PLACA", "PLACA 12mm x 300mm  x 300mm  PLASTICOS DELRIN", (300, 300, 12, 0, 0), [12, 300, 300]),
    ("PLACA", "PLACA 10mm  x 60mm  x 230mm  ALUMINIO  ", (10, 60, 230, None, None), [10, 60, 230]),
    # 30 PLACA se llaman CHAPA en la descripción.
    ("PLACA", "CHAPA 1.5mm  x 560mm  x 1200mm  ACERO  SAE 1010", (1.5, 560, 1200, 0, 0), [1.5, 560, 1200]),
    # PLANCHUELA y BARRA RECTANGULAR: ancho y espesor sin orden fijo (PP017, PBR017).
    ("PLANCHUELA", "PLANCHUELA 50mm  x 20mm   PLASTICOS PU 90 shore", (20, 50, 0, 0, 0), [50, 20]),
    ("BARRA RECTANGULAR", "BARRA RECTANGULAR 40mm  x 75mm   PLASTICOS APM", (40, 75, 0, None, None), [75, 40]),
    # TUBO REDONDO: t2 es Ø interior (ATR007) o espesor (ATR042), según quién lo cargó.
    ("TUBO REDONDO", "TUBO REDONDO 38.1mm  x 34mm  ACERO SAE 1010", (38.1, 34, 0, 0, 0), [38.1, 34]),
    ("TUBO REDONDO", "TUBO REDONDO 63mm  x 5mm   ACERO SAE 1010", (63, 5, 0, 0, 0), [63, 53]),
    ("TUBO REDONDO", "TUBO REDONDO 75mm  x 15mm   PLASTICOS UHMW", (75, 15, 0, 0, 0), [75, 15]),
    ("TUBO REDONDO", "TUBO REDONDO 60.3mm  x 2mmmm   ACERO INOXIDABLE AISI304", (60.3, 2, 0, 0, 0),
     [60.3, 56.3]),
    # Si la descripción no se entiende, en mm valen t1..t5.
    ("BARRA HEXAGONAL", "BARRA HEXAGONAL ACERO", (15.8, 0, 0, None, None), [15.8]),
])
def test_medidas_en_mm(formato, desc, t, esperado):
    sistema, medidas = _medidas(formato, desc, t)
    assert sistema == "mm"
    assert medidas[:len(esperado)] == pytest.approx(esperado)
    assert medidas[len(esperado):] == [None] * (5 - len(esperado))


@pytest.mark.parametrize("formato, desc, t, esperado", [
    # En pulgadas t1..t5 son basura (1 1/4 → 11, 3/16 → 3): sólo la descripción. Si trae
    # el mm entre paréntesis, ese.
    ("ANGULOS IGUALES", 'ANGULOS IGUALES 1 1/2" (38,1mm) x 1/8" (3,2mm)   ACERO SAE 1010',
     (11, 1, 0, 0, 0), [38.1, 3.2]),
    ("PLANCHUELA", 'PLANCHUELA 2 1/2" (63.5mm)  x 3/8" (9.52mm)   ACERO INOXIDABLE AISI304',
     (63.5, 9.52, 0, 0, 0), [63.5, 9.52]),
    ("PLANCHUELA", 'PLANCHUELA 2" (50,8mm) x  3/16" (4,7mm)   ACERO SAE 1010', (3, 2, 0, 0, 0), [50.8, 4.7]),
    ("BARRA CUADRADO", 'BARRA CUADRADO 1/2" (12,7mm)    ACERO SAE 1045', (1, 0, 0, 0, 0), [12.7]),
    # Sin paréntesis, la fracción.
    ("BARRA REDONDO", 'BARRA REDONDO 1 1/4"    ACERO SAE 1045', (11, 0, 0, 0, 0), [31.75]),
    # '2"mm' y '3/16mm': pulgadas tipeadas en el campo de mm (APT001).
    ("PERFIL T", 'PERFIL T 2"mm  x 2"mm  x 3/16mm  ACERO  ', (2, 2, 3, None, None), [50.8, 50.8, 4.7625]),
    # Paréntesis con basura: '(76.2m)' (AP169), '(19mm)mm' (AAI030).
    ("PLANCHUELA", 'PLANCHUELA 3" (76.2m) x 3/8" (9,5mm)  ACERO SAE 1010', (3, 3, 0, 0, 0), [76.2, 9.5]),
    ("ANGULOS IGUALES", 'ANGULOS IGUALES 3/4" (19mm)mm  x 1/8" (3,2mm)mm   ACERO INOXIDABLE AISI304',
     (3, 1, 0, 0, 0), [19, 3.2]),
    ("BARRA REDONDO", "BARRA REDONDO 3¼ (82.55mm)\"  ACERO SAE 1045", (3, 0, 0, 0, 0), [82.55]),
])
def test_medidas_en_pulgadas(formato, desc, t, esperado):
    sistema, medidas = _medidas(formato, desc, t)
    assert sistema == "pulgada"
    assert medidas[:len(esperado)] == pytest.approx(esperado, abs=0.001)


def test_mezcla_de_mm_y_pulgadas_queda_en_mm():
    """CORTE PANTOGRAFO guarda la medida en mm y el espesor en pulgadas ('3/8mm')."""
    sistema, medidas = _medidas("CORTE PANTOGRAFO", "CORTE PANTOGRAFO 215mm  x 3/8mm   DISCO  1045",
                                (215, 3, 0, None, None))
    assert sistema == "mm"
    assert medidas[:2] == pytest.approx([215, 9.525])
    # ATR232: el SCH dentro del paréntesis; el espesor en mm pasa a Ø interior.
    sistema, medidas = _medidas("TUBO REDONDO", 'TUBO REDONDO 1" (33,4mm SCH 40)  x 3,3mm   ACERO SAE 1010')
    assert sistema == "mm" and medidas[:2] == pytest.approx([33.4, 26.8])


@pytest.mark.parametrize("formato, desc, t", [
    ("TUBO CUADRADO", "TUBO CUADRADO 30mm  x 30mm   ACERO INOXIDABLE AISI304", (30, 30, 0, 0, 0)),
    ("TUBO CUADRADO", "TUBO CUADRADO 20mm  x 10mm   ACERO  ", (20, 10, 0, None, None)),
    ("PERFIL U", "PERFIL U 35mm  x 20mm  x 3000mm  PLASTICOS APM", (35, 20, 3000, None, None)),
    ("TUBO REDONDO", "TUBO REDONDO 1/2mm    ACERO  ", (1, 0, 0, None, None)),       # falta una
    ("PLACA", "PLACA  x 1100mm  x 1100mm  ACERO SAE 1010", (0, 1100, 1100, 0, 0)),    # falta el espesor
    ("REDONDO", "BARRA SAE 4140 DIAM 10", (10, 0, 0, 0, 0)),                        # formato basura
    ("", "CUALQUIER COSA", (0, 0, 0, 0, 0)),
])
def test_sin_medidas_antes_que_medidas_falsas(formato, desc, t):
    """Mejor sin medidas que con medidas inventadas: la descripción del viejo queda igual."""
    assert _medidas(formato, desc, t)[1] is None


@pytest.mark.parametrize("formato, desc, t, material", [
    ("BARRA CUADRADO", "BARRA CUADRADO 38.1mm    ACERO SAE 1045", (38.1, 0, 0, 0, 0), "ACERO"),
    ("TUBO RECTANGULAR", "TUBO RECTANGULAR 70mm  x 30mm  x 2mm   ACERO SAE 1010", (70, 30, 2, 0, 0), "ACERO"),
    ("PLANCHUELA", 'PLANCHUELA 1" (25,4mm) x 1/4" (6,4mm)  ACERO SAE 1010', (1, 1, 0, 0, 0), "ACERO"),
    ("PLACA", "PLACA 10mm  x 60mm  x 230mm  ALUMINIO  ", (10, 60, 230, None, None), "ALUMINIO"),
])
def test_lo_convertido_vuelve_a_escribir_la_misma_descripcion(formato, desc, t, material):
    """La prueba de que las medidas quedaron en el orden de las etiquetas: con ellas la
    regla de SPMM escribe lo mismo que decía el viejo (con espacios simples)."""
    sistema, medidas = _medidas(formato, desc, t)
    mat, calidad = L.material_y_calidad_desde_descripcion(desc, material, MATERIALES, formato)
    nueva, faltan = descripcion_insumo(formato, ETIQUETAS[formato], medidas, sistema, mat, calidad)
    assert faltan == []
    assert nueva == " ".join(desc.split()).replace(",", ".")


# ─────────────────────────── una pieza y una línea ───────────────────────────

def _catalogo():
    return L.CatalogoLegado(
        materiales={"ACERO": 1, "PLASTICOS": 2},
        calidades={(1, "SAE 1045"): 10, (1, "SAE 1010"): 11},
        formatos={"BARRA CUADRADO": 100, "PLACA": 101},
        proveedores=PROVEEDORES,
    )


def test_pieza_insumo_estructurada():
    fila = {"Idpieza": "ABC040", "descripcion": "BARRA CUADRADO 38.1mm    ACERO SAE 1045 ",
            "unitario": 61673.307, "unidad": "MTS", "fecha": "12/09/2026", "insumo": 0,
            "material": "ACERO", "formato": "BARRA CUADRADO", "t1": 38.1, "t2": 0, "t3": 0,
            "t4": 0, "t5": 0, "medida": 0, "estante": "C1", "letra": "D", "nro": "6",
            "proveedor": "ACEROS LAVALLE", "obs": "", "inactivo": 0, "stockactual": 11.5,
            "CRITICO": 0}
    datos = L.pieza_desde_legacy(fila, _catalogo(), HOY)
    assert datos["descripcion"] == "BARRA CUADRADO 38.1mm    ACERO SAE 1045"  # tal cual, sin puntas
    assert (datos["tipo"], datos["id_material"], datos["id_calidad"], datos["id_formato"]) == (
        "insumo", 1, 10, 100)
    assert (datos["sistema_medida"], datos["medida1"], datos["medida2"]) == ("mm", 38.1, None)
    assert datos["fecha_ultimo_precio"] == date(2026, 9, 12)
    assert (datos["estante"], datos["letra"], datos["nro"]) == ("C1", "D", "6")
    assert (datos["proveedor"], datos["id_proveedor"]) == ("ACEROS LAVALLE", 4)
    assert datos["observaciones"] is None and datos["inactivo"] == 0 and datos["origen"] == "legacy"
    # Lo que es de SPMM no viene: ni stock, ni mínimo (CRITICO = 0 en todo el viejo).
    assert not {"stockactual", "stock_minimo", "stock_bajo_avisado_en", "cod_pieza", "id"} & set(datos)


def test_pieza_con_descripcion_libre_no_lleva_medidas():
    """En las «c/ descripción» el material y el formato son restos de haber cambiado el
    radio (74 piezas): la descripción libre es lo único que vale."""
    fila = {"Idpieza": " CO002", "descripcion": "CODO 20 MM IPS", "unitario": 0, "unidad": "UN",
            "fecha": "", "insumo": 2, "material": "ACERO", "formato": "BARRA CUADRADO",
            "t1": 20, "estante": "A", "letra": "A", "nro": "1", "proveedor": " ", "inactivo": 1}
    datos = L.pieza_desde_legacy(fila, _catalogo(), HOY)
    assert datos["tipo"] == "insumo_desc"
    assert datos["id_material"] is None and datos["id_formato"] is None and datos["medida1"] is None
    assert (datos["estante"], datos["letra"], datos["nro"]) == (None, None, None)
    assert datos["proveedor"] is None and datos["id_proveedor"] is None
    assert datos["inactivo"] == 1 and datos["fecha_ultimo_precio"] is None


@pytest.mark.parametrize("unitario", [0, 0.0, -1500.0, None])
def test_precio_cero_o_negativo_no_es_un_precio(unitario):
    """2.849 piezas del viejo tienen 0 (nunca se compraron) y 32 un negativo: quedan «sin
    precio» y sin fecha, como un alta de SPMM sin precio. La fecha de un precio que no
    existe haría que el paso 7b descarte la primera compra de verdad si es anterior."""
    fila = {"Idpieza": "TOR999", "descripcion": "TORNILLO", "insumo": 2, "unitario": unitario,
            "fecha": "06/02/2026"}
    datos = L.pieza_desde_legacy(fila, _catalogo(), HOY)
    assert (datos["unitario"], datos["fecha_ultimo_precio"]) == (None, None)
    fila["unitario"] = 12.5
    datos = L.pieza_desde_legacy(fila, _catalogo(), HOY)
    assert (datos["unitario"], datos["fecha_ultimo_precio"]) == (12.5, date(2026, 2, 6))


def test_pieza_sin_descripcion_usa_el_codigo():
    """dbo.pieza tiene '001' dos veces con la descripción vacía; en SPMM no puede ir vacía."""
    assert L.pieza_desde_legacy({"Idpieza": "001", "descripcion": ""}, _catalogo(), HOY)["descripcion"] == "001"


def test_calidad_que_no_esta_en_el_catalogo_queda_en_null():
    """El sync no crea calidades: la que el viejo estrena al facturar se completa en la ficha."""
    fila = {"Idpieza": "ABC099", "descripcion": "BARRA CUADRADO 20mm ACERO SAE 4140 BONIFICADO",
            "insumo": 0, "material": "ACERO", "formato": "BARRA CUADRADO", "t1": 20}
    datos = L.pieza_desde_legacy(fila, _catalogo(), HOY)
    assert (datos["id_material"], datos["id_calidad"], datos["medida1"]) == (1, None, 20)


def test_linea_con_las_marcas_reales_del_viejo():
    """Las del viejo, no las que inventaba el sync (pedido = cantidad > 0, disponible = 1)."""
    fila = {"Idot": 15692, "idpieza": "COR2540", "descripcion": " CORTE LASER X ", "cantidad": 2.0,
            "un": "Un", "proveedor": "ACEROS CAS SA.", "observaciones": "E4 - soporte",
            "pendiente": 1, "reserva": 0, "creserva": 0.0, "disponible": 0, "pedido": 1,
            "fechaprov": datetime(2026, 9, 21), "usado": 1, "fechaProvE": "  /  /    "}
    datos = L.linea_desde_legacy(fila, 7, "UN", PROVEEDORES, HOY)
    assert datos == {
        "descripcion": "CORTE LASER X", "cantidad": 2.0, "unidad": "Un",
        "proveedor": "ACEROS CAS SA.", "id_proveedor": 340, "observaciones": "E4 - soporte",
        "pedido": 1, "disponible": 0, "reserva": 0, "cantidad_reservada": None,
        "en_produccion": 1, "usado": 1, "fecha_proveedor": date(2026, 9, 21),
        "fecha_entrega": None, "orden": 7, "origen": "legacy",
    }


def test_linea_sin_unidad_la_toma_de_la_pieza_y_usado_cero_se_respeta():
    fila = {"idpieza": "TRA011", "cantidad": 1, "un": "", "usado": 0, "pedido": 0, "disponible": 0,
            "fechaprov": datetime(1900, 1, 1), "creserva": 3.5, "reserva": 1}
    datos = L.linea_desde_legacy(fila, 1, "MTS", None, HOY)
    assert (datos["unidad"], datos["usado"], datos["fecha_proveedor"]) == ("Mts", 0, None)
    assert (datos["reserva"], datos["cantidad_reservada"]) == (1, 3.5)
    assert datos["id_proveedor"] is None
