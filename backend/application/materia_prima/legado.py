"""Cómo se lee el sistema viejo: funciones PURAS de conversión (spec §1.6).

Las usan dos lugares que tienen que decir exactamente lo mismo:

  · la importación (scripts/importar_materia_prima_legacy.py), que trae una vez el
    catálogo, los precios, el stock, los recortes, las líneas de las OT, los cortes y
    la cañera;
  · el paso 7b del sync (scripts/sync_db.py), que después de la importación sigue
    trayendo en cada pasada los códigos nuevos que el viejo crea al facturar y el
    último precio de compra.

Si cada uno convirtiera a su manera, una pieza dada de alta por el sync diría otra cosa
que la misma pieza traída por la importación. Por eso las dos llaman acá.

Nada de esto toca la base ni lee la hora por su cuenta: lo que depende de «hoy» lo
recibe como parámetro (`hoy`), y si no viene usa la hora del taller. Se prueba con
números sueltos (tests/test_materia_prima_legado.py), calibrado contra el viejo real
del 24/09/2026 (los casos raros de los tests son filas de verdad).

LO QUE HAY QUE SABER DEL VIEJO (medido; ver los informes del relevamiento)

  · Los códigos se comparan sin mayúsculas ni espacios de las puntas: la collation de
    SQL Server es case-insensitive y hay códigos con espacio adelante (' CO002').
  · pieza.insumo NO sigue el orden de los radios de la pantalla: 0 = Insumo,
    2 = Insumo c/ descripción, 1 = Consumible.
  · t1..t5 son Val() de lo tipeado: «3,2» quedó 3, «3/16» quedó 3, «1 1/4» quedó 11.
    En mm sirven casi siempre; en pulgadas la única verdad es la descripción.
  · La calidad del material no tiene columna: vive en la descripción, después del
    nombre del material.
  · Las fechas son texto (dd/mm/yyyy, dd/mm/yy, años truncados, algún mm/dd) o
    datetime con centinelas (1900-01-01, 1950-01-01) y años imposibles (8202).
"""
from __future__ import annotations

import math
import re
from collections import Counter, defaultdict, deque
from datetime import date, datetime, timedelta

from backend.application.materia_prima import catalogo_texto
from backend.application.materia_prima.reglas import (
    MAX_MEDIDAS,
    pulgadas_a_mm,
    tipo_efectivo,
    unidad_linea_desde_pieza,
)
from backend.application.materia_prima.semilla import FORMATOS_SEMILLA
from backend.domain.CaneraOcupacion import COLUMNAS_CANERA, FILAS_CANERA

__all__ = [
    "norm_codigo", "texto_limpio", "tipo_desde_legacy", "fecha_desde_texto",
    "fecha_desde_datetime", "ubicacion_desde_legacy", "material_y_calidad_desde_descripcion",
    "medidas_desde_legacy", "ocupacion_desde_ubicacion", "recorte_desde_texto",
    "corte_desde_texto", "norm_proveedor", "indice_proveedores", "proveedor_por_texto",
    "CatalogoLegado", "una_fila_por_codigo", "pieza_desde_legacy", "linea_desde_legacy",
    "emparejar_lineas", "RAZON_ESPESOR_TUBO", "lunes_de", "ventana_plan_semanal",
    "plan_semanal_desde_legacy", "SEMANAS_ATRAS", "SEMANAS_ADELANTE",
]


def _hoy(hoy: date | None) -> date:
    if hoy is not None:
        return hoy
    # Import tardío: auditoria_movimientos arrastra el modelo de auditoría y esto se
    # importa desde el sync; sólo hace falta cuando nadie dijo qué día es.
    from backend.infrastructure.auditoria_movimientos import ahora_ar
    return ahora_ar().date()


# ─────────────────────────── texto y códigos ───────────────────────────


def norm_codigo(s) -> str:
    """upper(trim()): así compara códigos el viejo (collation case-insensitive) y hay
    códigos con espacios adelante. Misma regla que reglas._norm_codigo."""
    return str(s or "").strip().upper()


def texto_limpio(s) -> str | None:
    """Sin espacios en las puntas; vacío → None. El viejo guarda ' ' (un espacio) en
    miles de celdas que en realidad están vacías."""
    if s is None:
        return None
    t = str(s).strip()
    return t or None


def _espacios(s) -> str:
    """Espacios simples, sin bordes."""
    return " ".join(str(s or "").split())


def tipo_desde_legacy(insumo) -> str:
    """pieza.insumo del viejo → tipo de SPMM: 0 insumo, 1 consumible, 2 insumo_desc.

    El índice NO sigue el orden visual de los radios (la prueba es ' CO002', insumo=2 y
    en la pantalla «Insumo c/ descripcion»). Cualquier otro valor (NULL incluido) va a
    'insumo_desc': descripción libre, que no inventa medidas que no hay.
    """
    try:
        valor = int(insumo)
    except (TypeError, ValueError):
        return "insumo_desc"
    return {0: "insumo", 1: "consumible", 2: "insumo_desc"}.get(valor, "insumo_desc")


# ─────────────────────────── fechas ───────────────────────────

_FECHA_TEXTO = re.compile(r"^(\d{1,2})\s*/\s*(\d{1,2})\s*/\s*(\d{2,4})$")
_ANIO_MINIMO = 2000


def _anio(texto: str) -> int | None:
    """El año de una fecha del viejo. 4 dígitos, tal cual; 2 dígitos, 20yy; 3 dígitos
    que empiezan con 0 ('018' en '02/02/018'), 20yy. Lo demás ('201' truncado, '218')
    no se adivina."""
    if len(texto) == 4:
        return int(texto)
    if len(texto) == 2:
        return 2000 + int(texto)
    if len(texto) == 3 and texto.startswith("0"):
        return 2000 + int(texto[1:])
    return None


def fecha_desde_texto(s, hoy: date | None = None) -> date | None:
    """Una fecha escrita a mano en el viejo (pieza.fecha, HistorialPieza.fecha,
    fechaProvE): dd/mm/yyyy o dd/mm/yy, con días y meses de uno o dos dígitos.

    Tolera la basura que hay: espacios de relleno, años de 3 dígitos ('13/10/201' se
    descarta, '02/02/018' es 2018) y el formato mm/dd de algunas filas ('08/20/22' es
    20/08/2022: sólo se da vuelta cuando no hay otra lectura posible). Un año fuera de
    2000..hoy+1 (0201, 1016, 2202) es basura → None. También None para '  /  /'.
    """
    if s is None:
        return None
    if isinstance(s, datetime):
        return fecha_desde_datetime(s, hoy)
    if isinstance(s, date):
        return fecha_desde_datetime(s, hoy)
    m = _FECHA_TEXTO.match(str(s).strip())
    if not m:
        return None
    dia, mes = int(m.group(1)), int(m.group(2))
    anio = _anio(m.group(3))
    if anio is None or not (_ANIO_MINIMO <= anio <= _hoy(hoy).year + 1):
        return None
    if mes > 12 and dia <= 12:
        dia, mes = mes, dia
    try:
        return date(anio, mes, dia)
    except ValueError:
        return None


# Los «sin fecha» del viejo: 1900-01-01 lo escribe la versión nueva del programa y
# 1950-01-01 la vieja. Ninguno es una fecha.
_CENTINELAS = (date(1900, 1, 1), date(1950, 1, 1))
_ANIO_MINIMO_DATETIME = 1990


def fecha_desde_datetime(d, hoy: date | None = None) -> date | None:
    """Una fecha datetime del viejo (fechaprov, MOVSTOCK.FECHA) como día sin hora.

    None para los centinelas (1900-01-01, 1950-01-01), para años de más de hoy+2 (hay
    fechaprov en 2027..8202: dedos) y para años anteriores a 1990, que no existen en
    ningún dato real del viejo. Acepta también el texto dd/mm/yyyy.
    """
    if d is None:
        return None
    if isinstance(d, str):
        return fecha_desde_texto(d, hoy)
    if isinstance(d, datetime):
        d = d.date()
    if not isinstance(d, date):
        return None
    if d in _CENTINELAS or d.year < _ANIO_MINIMO_DATETIME or d.year > _hoy(hoy).year + 2:
        return None
    return d


# ─────────────────────────── ubicación y cañera ───────────────────────────


def ubicacion_desde_legacy(estante, letra, nro) -> tuple[str | None, str | None, str | None]:
    """estante / letra / nro del viejo (los 3 combos de «Coordenada»).

    'A' / 'A' / '1' es el valor POR DEFECTO de los combos (12.145 piezas, el 68%), no un
    lugar del depósito: se importa como vacío. Igual los vacíos y los espacios. Una
    ubicación real (C1 / D / 6) queda tal cual; si sólo falta una parte, las otras se
    conservan.
    """
    partes = tuple(texto_limpio(x) for x in (estante, letra, nro))
    if all(p is None for p in partes):
        return None, None, None
    if tuple(p.upper() if p else p for p in partes) == ("A", "A", "1"):
        return None, None, None
    return partes


def ocupacion_desde_ubicacion(ubicacion) -> tuple[str, int] | None:
    """caniera.ubicacion del viejo → (columna, fila).

    Es el número de columna (1..15 = A..O) pegado al dígito de la fila (1..9): '11' A1,
    '71' G1, '101' J1, '155' O5. Lo que no entra en la grilla → None.
    """
    t = str(ubicacion or "").strip()
    if not t.isdigit() or len(t) < 2:
        return None
    columna, fila = int(t[:-1]), int(t[-1])
    if not (1 <= columna <= len(COLUMNAS_CANERA)) or fila not in FILAS_CANERA:
        return None
    return COLUMNAS_CANERA[columna - 1], fila


# ─────────────────────────── recortes y cortes ───────────────────────────

_NUMERO = r"\d+(?:[.,]\d+)?"
# Un recorte o un corte de más de 20 m no existe (las barras vienen de 6 m, las chapas
# de 3): es un error de tipeo ('2.20159e+006', '66000'). Y menos de 1 mm tampoco.
_LARGO_MAXIMO_MM = 20000
_LARGO_MINIMO_MM = 1
# En «largo x N» de los recortes, N es cantidad cuando es chico ('1525x3', '670x8'):
# ningún recorte de chapa tiene 20 mm de ancho.
_CANTIDAD_MAXIMA_EN_RECORTE = 20


def _num(texto) -> float | None:
    try:
        return float(str(texto).replace(",", "."))
    except (TypeError, ValueError):
        return None


def _largo_valido(valor) -> float | None:
    if valor is None or not math.isfinite(valor):
        return None
    if not (_LARGO_MINIMO_MM <= valor <= _LARGO_MAXIMO_MM):
        return None
    return round(valor, 1)


_RECORTE = re.compile(
    rf"^(?P<largo>{_NUMERO})\s*(?:mm)?"
    rf"(?:\s*[xX×]\s*(?P<segundo>{_NUMERO})\s*(?:mm)?)?"
    rf"(?:\s*\((?P<obs>[^)]*)\))?\s*$"
)


def recorte_desde_texto(s) -> tuple[float | None, float | None, int, str | None]:
    """recortes.recorte del viejo → (largo_mm, ancho_mm, cantidad, observaciones).

    '2777' → (2777, None, 1, None); '1525x3' → (1525, None, 3, None) (el viejo anotaba
    así tres tramos iguales); '1200x400' → (1200, 400, 1, None) (un recorte de chapa);
    '3440 (pintado amarillo 1212)' → (3440, None, 1, 'pintado amarillo 1212').
    Lo que no se entiende queda sin medida: (None, None, 1, None) — la importación
    guarda igual el texto original.
    """
    t = _espacios(s)
    m = _RECORTE.match(t)
    if not m:
        return None, None, 1, None
    largo = _largo_valido(_num(m.group("largo")))
    ancho, cantidad = None, 1
    segundo = _num(m.group("segundo")) if m.group("segundo") else None
    if segundo is not None:
        if segundo == int(segundo) and 0 < segundo <= _CANTIDAD_MAXIMA_EN_RECORTE:
            cantidad = int(segundo)
        else:
            ancho = _largo_valido(segundo)
    obs = texto_limpio(m.group("obs"))
    return largo, ancho, cantidad, obs


_CORTE = re.compile(
    rf"^(?P<largo>{_NUMERO})\s*(?:mm)?(?:\s*[xX×]\s*(?P<ancho>{_NUMERO})\s*(?:mm)?)?$"
)


def corte_desde_texto(cant, largo_txt) -> tuple[int | None, float | None, float | None, str | None]:
    """otcortesmp (cant, largo) → (cantidad, largo_mm, ancho_mm, texto_original).

    '1093' → largo 1093; '1220x2440' → largo 1220, ancho 2440 (chapa); lo que no es una
    medida ('80x200x20mm', 'CONFIRMAR', '25mm x 3/4" x 115mm', un largo imposible)
    queda sólo como texto_original, sin inventar números. La cantidad es de piezas: se
    redondea hacia arriba (nunca menos piezas) y None si no es positiva.
    """
    cantidad = None
    valor = _num(cant) if cant is not None else None
    if valor is not None and math.isfinite(valor) and valor > 0:
        cantidad = int(math.ceil(round(valor, 6)))
    original = texto_limpio(largo_txt)
    if original is None:
        return cantidad, None, None, None
    m = _CORTE.match(_espacios(original))
    if m:
        largo = _largo_valido(_num(m.group("largo")))
        ancho = _largo_valido(_num(m.group("ancho"))) if m.group("ancho") else None
        if largo is not None and (m.group("ancho") is None or ancho is not None):
            return cantidad, largo, ancho, None
    return cantidad, None, None, original[:60]


# ─────────────────────────── proveedores ───────────────────────────

# UNA sola normalización de nombres de proveedor para todo SPMM: la del catálogo
# (catalogo_texto.norm_proveedor: sin acentos, mayúsculas, espacios simples y sin
# « SA», « S.A.», « SRL», « S.R.L.» al final). La usa el aviso de «ya existe ese
# proveedor» del alta; si la importación normalizara a su manera, un texto del viejo
# podría emparejarse con un proveedor que el alta considera distinto (o al revés), y
# el mismo proveedor quedaría con dos criterios según por dónde entró.
# Nada más que eso: parecidos ('METARLURGICA JR') no se emparejan, sería adivinar.
norm_proveedor = catalogo_texto.norm_proveedor


def indice_proveedores(proveedores) -> dict[str, set[int]]:
    """{nombre normalizado: {ids}} por razón social y por fantasía. Se arma una vez
    para miles de piezas (normalizar 900 proveedores por pieza sería lento)."""
    indice: dict[str, set[int]] = defaultdict(set)
    for p in proveedores or ():
        pid = _campo(p, "id")
        for columna in ("razon_social", "fantasia"):
            clave = norm_proveedor(_campo(p, columna))
            if clave:
                indice[clave].add(pid)
    return dict(indice)


def proveedor_por_texto(texto, proveedores) -> int | None:
    """El proveedor de la lista que nombra un texto libre del viejo, o None.

    Coincidencia EXACTA normalizada (norm_proveedor) contra razón social o fantasía. Si
    más de un proveedor se llama así, None: elegir uno sería adivinar y la compra
    quedaría a nombre de otro. `proveedores` es la lista (dicts u objetos con id,
    razon_social, fantasia) o el índice ya armado con `indice_proveedores`.
    """
    clave = norm_proveedor(texto)
    if not clave:
        return None
    indice = proveedores if isinstance(proveedores, dict) else indice_proveedores(proveedores)
    candidatos = indice.get(clave) or set()
    return next(iter(candidatos)) if len(candidatos) == 1 else None


def _campo(obj, nombre):
    if isinstance(obj, dict):
        return obj.get(nombre)
    return getattr(obj, nombre, None)


# ─────────────────────────── medidas en la descripción ───────────────────────────

_FRACCIONES_UNICODE = {"¼": " 1/4", "½": " 1/2", "¾": " 3/4", "⅛": " 1/8", "⅜": " 3/8",
                       "⅝": " 5/8", "⅞": " 7/8"}
_FRAC = r"\d+\s*/\s*\d+"
_MIXTA = r"\d+(?:\s+|\s*-\s*)\d+\s*/\s*\d+"
_VALOR_PULGADA = rf"(?:{_MIXTA}|{_FRAC}|{_NUMERO})"
# Una medida en pulgadas: '1 1/4" (31,75mm)', '3/8"', '2"mm' (así lo dejaba el viejo
# cuando se tipeaba la comilla en un campo de mm). El paréntesis tolera lo que se ve en
# el viejo: '(76.2m)', '(33,4mm SCH 40)', '(19mm)mm'.
_MEDIDA_PULGADA = re.compile(
    rf'(?P<pul>{_VALOR_PULGADA})\s*"\s*(?:mm)?'
    rf'(?:\s*\(\s*(?P<pmm>{_NUMERO})\s*mm?\b[^)]*\)\s*(?:mm)?)?'
)
# Una fracción con «mm» ('3/8mm', '1 1/4mm'): nadie mide 3/8 de milímetro, es una
# pulgada tipeada en el campo de mm (41 piezas).
_MEDIDA_FRACCION = re.compile(rf"(?P<frac>{_MIXTA}|{_FRAC})\s*(?:mm)?")
_MEDIDA_MM = re.compile(rf"(?P<mm>{_NUMERO})\s*(?:mm)?")
_SEPARADOR = re.compile(r"\s*[xX×]\s*")


def _preparar(descripcion) -> str:
    t = str(descripcion or "")
    for k, v in _FRACCIONES_UNICODE.items():
        t = t.replace(k, v)
    t = t.replace("”", '"').replace("″", '"').replace("''", '"')
    t = re.sub(r"(?i)mm(?:m)+", "mm", t)            # '2mmmm' → '2mm'
    t = re.sub(r'(\d)"\s*(\d+\s*/\s*\d+)', r'\1 \2"', t)  # '1"1/4' → '1 1/4"'
    return _espacios(t)


def _una_medida(texto: str, pos: int):
    """(mm, es_pulgada, fin) de la medida que empieza en `pos`, o None."""
    m = _MEDIDA_PULGADA.match(texto, pos)
    if m:
        mm = _num(m.group("pmm")) if m.group("pmm") else None
        if mm is None:
            mm = pulgadas_a_mm(m.group("pul"))
        return (mm, True, m.end()) if mm else None
    m = _MEDIDA_FRACCION.match(texto, pos)
    if m:
        mm = pulgadas_a_mm(m.group("frac"))
        return (mm, True, m.end()) if mm else None
    m = _MEDIDA_MM.match(texto, pos)
    if m:
        return _num(m.group("mm")), False, m.end()
    return None


def _partir_descripcion(descripcion, formato) -> tuple[list[tuple[float, bool]], str]:
    """Separa la descripción de un insumo del viejo en (medidas, lo que sigue).

    El viejo la armaba FORMATO + medidas unidas por « x » + MATERIAL + CALIDAD. Se salta
    el nombre del formato si está (30 PLACA dicen «CHAPA …»: se arranca en el primer
    número), se leen medidas mientras haya « x » entre ellas, y lo que queda es el
    material con su calidad. Cada medida es (mm, si estaba en pulgadas).
    """
    t = _preparar(descripcion)
    formato = _espacios(formato).upper()
    inicio = len(formato) if formato and t.upper().startswith(formato) else 0
    m = re.search(r"\d", t[inicio:])
    if not m:
        return [], t[inicio:].strip()
    pos = inicio + m.start()
    medidas = []
    while True:
        leida = _una_medida(t, pos)
        if leida is None:
            break
        mm, es_pulgada, pos = leida
        medidas.append((mm, es_pulgada))
        sep = _SEPARADOR.match(t, pos)
        if not sep or _una_medida(t, sep.end()) is None:
            break
        pos = sep.end()
    return medidas, t[pos:].strip()


def material_y_calidad_desde_descripcion(desc, material_legacy, materiales_conocidos=(),
                                         formato=None) -> tuple[str | None, str | None]:
    """(material, calidad) de un insumo del viejo.

    La calidad no tiene columna en el viejo: es lo que sigue al nombre del material en
    la descripción ('BARRA REDONDO 19mm    ACERO SAE 1010' → ('ACERO', 'SAE 1010')). Se
    busca DESPUÉS de las medidas, así un material que se llama como el formato
    (PLANCHUELA) no se confunde con el principio de la descripción.

    · Si el material del viejo (pieza.material) está ahí, manda él.
    · Si no, el material conocido más largo con que empieza ese resto (ACERO TREFILADO
      antes que ACERO, PLASTICOS antes que PLASTICO): hay piezas con el combo de
      material en PLANCHUELA y la descripción diciendo ACERO SAE 1010, y lo que el taller
      ve es la descripción.
    · Si no aparece ninguno: el material del viejo y la calidad None (no se inventa).

    Respeta mayúsculas y minúsculas de lo escrito ('PU 90 shoreA') con espacios simples.
    La calidad vacía es None ('ALUMINIO' sin calidad es legítimo).
    """
    material = _espacios(material_legacy) or None
    _, resto = _partir_descripcion(desc, formato)
    resto = _espacios(resto)
    resto_up = resto.upper()

    def _despues(nombre: str) -> str | None:
        n = _espacios(nombre).upper()
        if not n:
            return None
        for m in re.finditer(re.escape(n), resto_up):
            fin = m.end()
            antes_ok = m.start() == 0 or resto_up[m.start() - 1] == " "
            despues_ok = fin == len(resto_up) or resto_up[fin] == " "
            if antes_ok and despues_ok:
                return resto[fin:]
        return None

    if material:
        cola = _despues(material)
        if cola is not None:
            return material, _calidad(cola)
    for candidato in sorted({_espacios(c) for c in materiales_conocidos or () if _espacios(c)},
                            key=len, reverse=True):
        c = candidato.upper()
        if resto_up == c or resto_up.startswith(c + " "):
            return candidato, _calidad(resto[len(c):])
    return material, None


def _calidad(cola: str) -> str | None:
    t = _espacios(cola).strip(" -–")
    return t or None


# Formato → cuántas medidas pide (sus etiquetas, en orden). La misma lista que siembra
# la migración: los formatos del viejo se llaman igual.
_ETIQUETAS = {nombre: etiquetas for nombre, _, etiquetas in FORMATOS_SEMILLA}

# TUBO REDONDO: t2 es Ø interior (246 piezas) o espesor (70), según quién lo cargó.
# Medido sobre las 308 del viejo: los espesores dan t2/t1 ≤ 0,18 (tubos de acero de
# 2 a 8 mm de pared) y los Ø interiores ≥ 0,20 (bujes de plástico y bronce). Por
# debajo de este corte, t2 es espesor y el Ø interior es Ø ext − 2 × espesor.
RAZON_ESPESOR_TUBO = 0.2


def _canonicas(formato: str, medidas: list[float]) -> list[float] | None:
    """Las medidas en el orden de las etiquetas del formato, o None si no cuadran.

    El viejo no siempre guardaba en el mismo orden: PLACA tiene 38 filas con
    ancho/largo/espesor en vez de espesor/ancho/largo, PLANCHUELA mezcla ancho×espesor
    con espesor×ancho, BARRA RECTANGULAR no tiene orden fijo. Como un espesor nunca es
    mayor que un ancho, alcanza con ubicarlo por tamaño. Lo que no puede ser (un tubo
    cuadrado de 30 × 30 sin espesor, un perfil U con «espesor» de 3000) → None: mejor
    sin medidas que con medidas falsas (la descripción del viejo queda igual).
    """
    m = list(medidas)
    if formato in ("BARRA RECTANGULAR", "PLANCHUELA", "ANGULOS IGUALES"):
        return [max(m), min(m)]
    if formato == "TUBO CUADRADO":
        lado, espesor = max(m), min(m)
        return [lado, espesor] if espesor < lado / 2 else None
    if formato == "TUBO REDONDO":
        exterior, otro = max(m), min(m)
        if otro / exterior < RAZON_ESPESOR_TUBO:
            interior = exterior - 2 * otro
            return [exterior, round(interior, 3)] if interior > 0 else None
        return [exterior, otro] if otro < exterior else None
    if formato in ("PLACA", "TUBO RECTANGULAR", "ANGULOS DESIGUALES"):
        i = m.index(min(m))
        espesor = m.pop(i)
        if formato == "PLACA":
            return [espesor] + m
        return m + [espesor] if espesor < min(m) / 2 or formato == "ANGULOS DESIGUALES" else None
    if formato in ("PERFIL U", "PERFIL T"):
        return m if m[-1] <= min(m) else None
    return m


def medidas_desde_legacy(formato, t1=None, t2=None, t3=None, t4=None, t5=None, medida=None,
                         descripcion=None) -> tuple[str, list[float | None] | None]:
    """(sistema_medida, [medida1..5 en mm]) de un insumo estructurado del viejo, o
    (sistema, None) si no se puede saber sin inventar.

    · Sistema: 'pulgada' si TODAS las medidas de la descripción están en pulgadas
      (llevan " o son fracciones); si mezcla ('900mm x 1/8mm') o no tiene, 'mm'. La
      columna `medida` del viejo casi no se usó (9 filas) y no alcanza para decidir.
    · Medidas: las de la descripción, que es lo que el taller ve. En mm, si la
      descripción no se puede leer, t1..t5 (son Val() del texto, pero en mm cuadran en
      casi todas). En pulgadas t1..t5 son basura (3/16 → 3), así que sólo la descripción;
      si trae el mm entre paréntesis ('1 1/4" (31,75mm)') se usa ese.
    · Cantidad: la que pide el formato (sus etiquetas). Si sobran o faltan, None.
    · Orden: el de las etiquetas del formato (ver _canonicas).

    Formato desconocido (REDONDO, vacío) → ('mm', None).
    """
    nombre = _espacios(formato).upper()
    etiquetas = _ETIQUETAS.get(nombre)
    leidas, _ = _partir_descripcion(descripcion, nombre)
    pulgada = bool(leidas) and all(es_pulgada for _, es_pulgada in leidas)
    sistema = "pulgada" if pulgada else "mm"
    if not etiquetas:
        return sistema, None
    n = len(etiquetas)

    medidas = [mm for mm, _ in leidas]
    if len(medidas) != n and not pulgada:
        ts = [_num(t) if t is not None else None for t in (t1, t2, t3, t4, t5)][:n]
        if all(t is not None and t > 0 for t in ts):
            medidas = ts
    if len(medidas) != n or any(mm is None or not math.isfinite(mm) or mm <= 0 for mm in medidas):
        return sistema, None
    canonicas = _canonicas(nombre, [round(float(mm), 3) for mm in medidas])
    if canonicas is None:
        return sistema, None
    return sistema, canonicas + [None] * (MAX_MEDIDAS - n)


# ─────────────────────────── una pieza entera ───────────────────────────


class CatalogoLegado:
    """Los catálogos de SPMM contra los que se resuelve una pieza del viejo: materiales
    y calidades por nombre (sin mirar mayúsculas), formatos por nombre, proveedores por
    su índice. Lo arma quien llama con lo que leyó de la base (la importación, el sync);
    acá sólo se consulta.

    materiales:  {nombre: id}
    calidades:   {(id_material, nombre): id}
    formatos:    {nombre: id}
    proveedores: lista de proveedores o el índice de `indice_proveedores`
    """

    def __init__(self, materiales=None, calidades=None, formatos=None, proveedores=None):
        self.materiales = {_espacios(k).upper(): v for k, v in (materiales or {}).items()}
        self.nombres_materiales = [_espacios(k) for k in (materiales or {})]
        self.calidades = {(idm, _espacios(n).upper()): v for (idm, n), v in (calidades or {}).items()}
        self.formatos = {_espacios(k).upper(): v for k, v in (formatos or {}).items()}
        self.proveedores = (proveedores if isinstance(proveedores, dict)
                            else indice_proveedores(proveedores or ()))

    def id_material(self, nombre):
        return self.materiales.get(_espacios(nombre).upper()) if nombre else None

    def id_calidad(self, id_material, nombre):
        if id_material is None or not nombre:
            return None
        return self.calidades.get((id_material, _espacios(nombre).upper()))

    def id_formato(self, nombre):
        return self.formatos.get(_espacios(nombre).upper()) if nombre else None


def _flotante(valor) -> float | None:
    v = _num(valor) if valor is not None else None
    return v if v is not None and math.isfinite(v) else None


def una_fila_por_codigo(filas, hoy: date | None = None) -> dict[str, dict]:
    """dbo.pieza por código normalizado, una fila por código.

    El viejo repite '50%004' y '001' (su collation no distingue mayúsculas y nadie cuidó
    la clave). Queda la fila con la fecha del último precio más nueva, que es la que
    describe la última compra; a igual fecha, la última leída. Los códigos vacíos no son
    una pieza. Lo usan la importación y el paso 7b: si eligieran distinto, cada corrida
    del sync «corregiría» lo que trajo la importación.
    """
    por: dict[str, tuple[dict, date | None]] = {}
    for fila in filas:
        codigo = norm_codigo(fila.get("Idpieza"))
        if not codigo:
            continue
        fecha = fecha_desde_texto(fila.get("fecha"), hoy)
        previa = por.get(codigo)
        if previa is None or (fecha is not None and (previa[1] is None or fecha >= previa[1])):
            por[codigo] = (fila, fecha)
    return {codigo: fila for codigo, (fila, _) in por.items()}


def pieza_desde_legacy(fila: dict, catalogo: CatalogoLegado, hoy: date | None = None) -> dict:
    """Una fila de dbo.pieza como columnas de `pieza` en SPMM (sin id ni cod_pieza).

    La usan la importación (UPDATE de las que ya están, INSERT de las que faltan) y el
    paso 7b del sync (INSERT de los códigos nuevos): así las dos traen una pieza igual.

    No devuelve lo que es de SPMM y la importación no pisa: stock_minimo (el «Pto.
    crítico» nunca se usó en el viejo: CRITICO = 0 en todas), stock_bajo_avisado_en ni
    stockactual (el stock es la suma de movimientos, ver materia_prima/stock.py).

    Material, calidad, formato y medidas sólo para el tipo 'insumo': en los otros tipos
    son restos de haber cambiado el radio (74 piezas «c/ descripción» con material
    cargado) y la descripción libre es lo único que vale. Si el material o la calidad no
    están en el catálogo, quedan en NULL (la importación los crea antes; el sync no).
    """
    tipo = tipo_desde_legacy(fila.get("insumo"))
    # Tal cual (sólo sin espacios en las puntas): es el texto que ya está en las facturas
    # y en SPMM. Colapsar los espacios dobles del viejo reescribiría 17 mil filas para
    # nada; el aviso de duplicado ya compara normalizado (reglas.norm_desc).
    descripcion = texto_limpio(fila.get("descripcion")) or norm_codigo(fila.get("Idpieza")) or "-"
    estante, letra, nro = ubicacion_desde_legacy(fila.get("estante"), fila.get("letra"), fila.get("nro"))
    proveedor = texto_limpio(fila.get("proveedor"))
    inactivo = 1 if _flotante(fila.get("inactivo")) == 1 else 0
    # Un precio en 0 (2.849 piezas del viejo: nunca se compraron) o negativo (32: notas de
    # crédito) no es un precio. Queda «sin precio» y SIN fecha, igual que un alta de SPMM
    # sin precio (MateriaPrimaCatalogoService): si no, la ficha diría «$ 0 al 06/02/2026»
    # y el paso 7b sólo traería una compra posterior a esa fecha, que no es de ningún precio.
    unitario = _flotante(fila.get("unitario"))
    if unitario is not None and unitario <= 0:
        unitario = None

    datos = {
        "descripcion": descripcion[:255],
        "unitario": unitario,
        "unidad": texto_limpio(fila.get("unidad")),
        "tipo": tipo,
        "id_material": None,
        "id_calidad": None,
        "id_formato": None,
        "sistema_medida": "mm",
        "medida1": None, "medida2": None, "medida3": None, "medida4": None, "medida5": None,
        "inactivo": inactivo,
        "fecha_ultimo_precio": fecha_desde_texto(fila.get("fecha"), hoy) if unitario else None,
        "estante": estante, "letra": letra, "nro": nro,
        "proveedor": proveedor,
        "id_proveedor": proveedor_por_texto(proveedor, catalogo.proveedores),
        "material": texto_limpio(fila.get("material")),
        "formato": texto_limpio(fila.get("formato")),
        "observaciones": texto_limpio(fila.get("obs")),
        "origen": "legacy",
    }
    if tipo_efectivo(tipo) == "insumo":
        formato = texto_limpio(fila.get("formato"))
        material, calidad = material_y_calidad_desde_descripcion(
            fila.get("descripcion"), fila.get("material"), catalogo.nombres_materiales, formato)
        datos["id_material"] = catalogo.id_material(material)
        datos["id_calidad"] = catalogo.id_calidad(datos["id_material"], calidad)
        datos["id_formato"] = catalogo.id_formato(formato)
        sistema, medidas = medidas_desde_legacy(
            formato, fila.get("t1"), fila.get("t2"), fila.get("t3"), fila.get("t4"),
            fila.get("t5"), fila.get("medida"), fila.get("descripcion"))
        datos["sistema_medida"] = sistema
        if medidas:
            for i, valor in enumerate(medidas, start=1):
                datos[f"medida{i}"] = valor
    return datos


def linea_desde_legacy(fila: dict, orden: int, unidad_pieza=None, proveedores=None,
                       hoy: date | None = None) -> dict:
    """Una fila de dbo.otrabajoMprimas como columnas de `orden_trabajo_pieza` (sin id,
    OT ni pieza, que resuelve quien llama).

    Las marcas son las REALES del viejo (pedido, disponible, reserva, usado, PRODUC =
    pendiente), no las que inventaba el sync (pedido = cantidad > 0, disponible = 1).
    creserva es 0 en todas las filas: la cantidad reservada queda NULL salvo que haya
    un número. fechaProvE nunca se llenó ('  /  /'), pero se lee por las dudas.
    La unidad vacía (28 filas) sale de la pieza, con la capitalización de las líneas.
    """
    cantidad = _flotante(fila.get("cantidad")) or 0.0
    creserva = _flotante(fila.get("creserva"))
    descripcion = texto_limpio(fila.get("descripcion"))
    unidad = texto_limpio(fila.get("un")) or unidad_linea_desde_pieza(unidad_pieza)
    proveedor = texto_limpio(fila.get("proveedor"))
    return {
        "descripcion": descripcion[:255] if descripcion else None,
        "cantidad": cantidad,
        "unidad": unidad,
        "proveedor": proveedor[:200] if proveedor else None,
        "id_proveedor": proveedor_por_texto(proveedor, proveedores) if proveedores is not None else None,
        "observaciones": texto_limpio(fila.get("observaciones")),
        "pedido": 1 if _flotante(fila.get("pedido")) == 1 else 0,
        "disponible": 1 if _flotante(fila.get("disponible")) == 1 else 0,
        "reserva": 1 if _flotante(fila.get("reserva")) == 1 else 0,
        "cantidad_reservada": round(creserva, 3) if creserva and creserva > 0 else None,
        "en_produccion": 1 if _flotante(fila.get("pendiente")) == 1 else 0,
        "usado": 0 if _flotante(fila.get("usado")) == 0 else 1,
        "fecha_proveedor": fecha_desde_datetime(fila.get("fechaprov"), hoy),
        "fecha_entrega": fecha_desde_texto(fila.get("fechaProvE"), hoy),
        "orden": orden,
        "origen": "legacy",
    }


def emparejar_lineas(lineas_spmm, lineas_viejo, codigo_spmm="codigo", codigo_viejo="idpieza"):
    """Empareja las líneas de materia prima de UNA OT entre SPMM y el viejo.

    Por (código normalizado, número de aparición): la 1ª línea de ABR117 de SPMM con la
    1ª de ABR117 del viejo, la 2ª con la 2ª… El par (OT, código) no es clave: el viejo
    repite el mismo insumo en dos tandas (15714 RUL002 4 + 6) y las dos valen.

    Ambas listas llegan EN SU ORDEN (SPMM por `orden` y id; el viejo en el orden en que
    se lee, que es el que muestra su pantalla). Devuelve:
      pares      [(linea_spmm, linea_viejo)]  → se actualizan en su lugar (conservan id:
                                               consumo_material apunta a la línea)
      nuevas     [linea_viejo]                → se insertan
      sobrantes  [linea_spmm]                 → están en SPMM y ya no en el viejo
    Las líneas son dicts u objetos; el código se lee de `codigo_spmm` / `codigo_viejo`.
    """
    pendientes: dict[str, deque] = defaultdict(deque)
    for linea in lineas_spmm:
        pendientes[norm_codigo(_campo(linea, codigo_spmm))].append(linea)
    pares, nuevas = [], []
    for linea in lineas_viejo:
        cola = pendientes.get(norm_codigo(_campo(linea, codigo_viejo)))
        if cola:
            pares.append((cola.popleft(), linea))
        else:
            nuevas.append(linea)
    usadas = {id(s) for s, _ in pares}
    sobrantes = [s for s in lineas_spmm if id(s) not in usadas]
    return pares, nuevas, sobrantes


# ─────────────────────────── el plan semanal (dbo.plansemanal) ───────────────────────────
#
# El plan semanal del Integral: una fila por (fecha, OT), cargado a mano por el taller. Es
# lo que filtra «Semana del …» en su pantalla de Pendientes. Medido el 25/09/2026 (sólo
# SELECT): 19.859 filas de 2019 a 2026-10-26; `fecha` es el lunes en 371 de 389 semanas y
# en las otras 18 un viernes, martes, miércoles o sábado (la 11/09/2026, viernes, con 5 OT);
# 73 filas con fecha 2000-01-01 (basura); 71 pares (fecha, ot) repetidos, siempre con la
# misma prioridad; y una OT se arrastra de semana en semana mientras no se termina.

# La ventana que refleja el espejo: desde el lunes de hace SEMANAS_ATRAS semanas hasta el
# lunes dentro de SEMANAS_ADELANTE semanas. Hacia atrás, 8 alcanzan para mirar el mes
# pasado en Pendientes (Maxi compra para esta semana y la que viene; el taller carga el
# plan como mucho 5 semanas adelante: el 25/09 la última era la del 26/10) y dejan quietas
# las semanas viejas: una corrección del Integral en una semana de hace medio año no
# cambia nada acá. Hacia adelante, 8 cubren con margen lo que el taller carga.
SEMANAS_ATRAS = 8
SEMANAS_ADELANTE = 8


def lunes_de(dia: date) -> date:
    """El lunes de la semana de ese día (la semana va de lunes a domingo)."""
    if isinstance(dia, datetime):
        dia = dia.date()
    return dia - timedelta(days=dia.weekday())


def ventana_plan_semanal(hoy: date | None = None) -> tuple[date, date]:
    """(primer lunes, último lunes) de la ventana del plan semanal alrededor de hoy."""
    lunes = lunes_de(_hoy(hoy))
    return lunes - timedelta(weeks=SEMANAS_ATRAS), lunes + timedelta(weeks=SEMANAS_ADELANTE)


def _dia_de(v) -> date | None:
    """La fecha sin la hora, venga como datetime, date o texto ISO."""
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


def _numero_de_ot(v) -> int | None:
    try:
        numero = int(v)
    except (TypeError, ValueError):
        return None
    return numero if numero > 0 else None


def plan_semanal_desde_legacy(filas, ventana: tuple[date, date]) -> tuple[dict, Counter]:
    """Las filas de dbo.plansemanal (fecha, ot, PRIORIDAD) → lo que tiene que haber en
    plan_semanal dentro de la ventana: ({(lunes, número de OT): {fecha_original,
    prioridad}}, descartes {motivo: filas}).

      · la fecha se lleva al LUNES de su semana (18 semanas del Integral dicen otro día);
      · fuera de la ventana no entra (ahí también cae la basura: 2000-01-01, fechas sin
        leer, años imposibles);
      · sin número de OT (o 0) no entra;
      · un (lunes, OT) repetido queda una vez: la fila que decía el lunes mismo y, si no,
        la del día más temprano (con la prioridad como desempate, para que dos lecturas
        del mismo Integral den siempre lo mismo aunque cambie el orden físico).
    """
    desde, hasta = ventana
    candidatas: dict[tuple[date, int], list[tuple]] = defaultdict(list)
    descartes: Counter = Counter()
    for fila in filas:
        dia = _dia_de(fila.get("fecha"))
        if dia is None or not (desde <= lunes_de(dia) <= hasta):
            descartes["fuera de la ventana o fecha imposible (2000-01-01, sin fecha)"] += 1
            continue
        numero = _numero_de_ot(fila.get("ot"))
        if numero is None:
            descartes["sin número de OT"] += 1
            continue
        semana = lunes_de(dia)
        prioridad = texto_limpio(fila.get("PRIORIDAD"))
        candidatas[(semana, numero)].append(
            (dia != semana, dia, prioridad or "", {"fecha_original": dia,
                                                    "prioridad": prioridad[:30] if prioridad else None}))
    deseadas = {}
    for clave, opciones in candidatas.items():
        if len(opciones) > 1:
            descartes["repetidas (misma semana y OT: queda una)"] += len(opciones) - 1
        deseadas[clave] = min(opciones, key=lambda o: o[:3])[3]
    return deseadas, descartes
