"""Las reglas de la materia prima que no necesitan base: funciones PURAS.

El backend es la fuente de verdad (spec §1.7): la descripción de un insumo, su código
sugerido, la conversión de pulgadas, la sugerencia de metros a partir de los cortes y el
escalado del «Traer historial» se calculan UNA vez, acá. La pantalla pide la vista previa
al backend en vez de repetir la cuenta en TypeScript: dos implementaciones de la misma
descripción tarde o temprano escriben distinto el mismo insumo, y entonces el aviso de
duplicado deja de encontrarlo.

Nada de esto toca la sesión ni lee la hora: se prueba con números sueltos
(tests/test_materia_prima_reglas.py).
"""
from __future__ import annotations

import math
import re
from decimal import ROUND_CEILING, Decimal

from backend.domain.PiezaMovimiento import TIPOS_MOVIMIENTO
from backend.domain.PiezaRecorte import ESTADOS_RECORTE

# ─────────────────────────── constantes que devuelve la API ───────────────────────────

# El ancho de la hoja de la sierra: cada corte se come esto además de su largo. Lo usa
# la sugerencia de metros (sugerido_m) y la API lo devuelve para que la pantalla lo diga.
ESPESOR_SIERRA_MM = 3

MM_POR_PULGADA = 25.4

# Las fracciones de pulgada que se escriben como fracción: 1/2, 1/4 … 1/64, como las
# tiene el taller. Una medida que no cae en ninguna va en pulgadas con decimales.
DENOMINADOR_MAXIMO = 64

# Cuánto puede diferir una medida en mm de la fracción para escribirla como fracción.
#
# Hasta los dieciseisavos se tolera 0,1 mm porque el viejo escribía los mm redondeados a
# uno o dos decimales (3/8" = «9,52mm», 1/4" = «6,4mm», 3/16" = «4,7mm») y esos números
# vuelven con la importación. En 32avos y 64avos se pide la fracción exacta (a los 3
# decimales que guarda la base): con 0,1 mm de margen sobre pasos de 0,4 mm, media recta
# numérica caería en algún 64avo y 10 mm se escribiría 25/64".
TOLERANCIA_FRACCION_MM = 0.1
TOLERANCIA_FRACCION_FINA_MM = 0.001
_DENOMINADOR_TOLERANTE = 16

TIPOS_INSUMO = ("insumo", "insumo_desc", "consumible")
# Cómo se nombran en la pantalla (GET /materia-prima/catalogos).
TIPOS_CATALOGO = (
    {"valor": "insumo", "nombre": "Insumo"},
    {"valor": "insumo_desc", "nombre": "Insumo c/ descripción"},
    {"valor": "consumible", "nombre": "Consumible"},
)
SISTEMAS_MEDIDA = ("mm", "pulgada")
# Unidades del catálogo (pieza.unidad, como las escribe el viejo) y de las líneas de la
# OT (orden_trabajo_pieza.unidad, que el viejo escribe con otra capitalización).
UNIDADES = ("UN", "MTS", "KG", "LTS", "HS")
UNIDADES_LINEA = ("Un", "Mts", "Kg", "Lts")
_UNIDAD_LINEA = {"UN": "Un", "MTS": "Mts", "KG": "Kg", "LTS": "Lts"}
MAX_MEDIDAS = 5

__all__ = [
    "ESPESOR_SIERRA_MM", "MM_POR_PULGADA", "DENOMINADOR_MAXIMO", "TOLERANCIA_FRACCION_MM",
    "TOLERANCIA_FRACCION_FINA_MM",
    "TIPOS_INSUMO", "TIPOS_CATALOGO", "SISTEMAS_MEDIDA", "UNIDADES", "UNIDADES_LINEA",
    "MAX_MEDIDAS", "TIPOS_MOVIMIENTO", "ESTADOS_RECORTE",
    "tipo_efectivo", "fmt_mm", "mm_a_pulgadas_texto", "pulgadas_a_mm", "texto_medida",
    "descripcion_insumo", "norm_desc", "prefijo_codigo", "siguiente_codigo", "sugerido_m",
    "factor_historial", "escalar_cantidad", "unidad_linea_desde_pieza",
]


def _campo(obj, nombre):
    """Lee `nombre` de un dict o de un objeto (fila ORM, DTO): las reglas no eligen."""
    if isinstance(obj, dict):
        return obj.get(nombre)
    return getattr(obj, nombre, None)


def _norm_codigo(codigo) -> str:
    """upper(trim()): el viejo compara códigos sin mirar mayúsculas y hay códigos con
    espacios adelante. Misma regla que legado.norm_codigo (la importación)."""
    return str(codigo or "").strip().upper()


# ─────────────────────────── tipo ───────────────────────────


def tipo_efectivo(tipo: str | None) -> str:
    """El tipo con el que se trata un insumo. NULL (sin clasificar, lo que queda de antes
    de la importación) o algo desconocido se trata como 'insumo_desc': descripción libre,
    que es lo único que no inventa datos que no tiene."""
    return tipo if tipo in TIPOS_INSUMO else "insumo_desc"


# ─────────────────────────── medidas ───────────────────────────


def fmt_mm(valor) -> str:
    """Un número de mm como se escribe en la descripción: sin ceros de más.

    38.1 → «38.1», 20.0 → «20», 4.75 → «4.75». Hasta 3 decimales, que es lo que guarda
    la base (NUMERIC(12,3)). Con punto: es la descripción del insumo y el viejo la escribe
    con punto.
    """
    texto = f"{round(float(valor), 3):.3f}".rstrip("0").rstrip(".")
    return "0" if texto in ("", "-0") else texto


def mm_a_pulgadas_texto(mm) -> str:
    """Una medida en mm, escrita en pulgadas como las escribe el taller.

    31.75 → '1 1/4"', 6.35 → '1/4"', 25.4 → '1"'. Con fracción de denominador potencia
    de 2 hasta 64 (la más chica que encaje); si no encaja ninguna, pulgadas con hasta 3
    decimales (10 → '0.394"').
    """
    mm = float(mm)
    signo = "-" if mm < 0 else ""
    mm = abs(mm)
    pulgadas = mm / MM_POR_PULGADA
    entero = int(pulgadas)
    resto = pulgadas - entero
    d = 1
    while d <= DENOMINADOR_MAXIMO:
        n = round(resto * d)
        tolerancia = (TOLERANCIA_FRACCION_MM if d <= _DENOMINADOR_TOLERANTE
                      else TOLERANCIA_FRACCION_FINA_MM)
        if abs((entero + n / d) * MM_POR_PULGADA - mm) <= tolerancia:
            if n == d:
                entero, n = entero + 1, 0
            if n == 0:
                return f'{signo}{entero}"'
            if entero == 0:
                return f'{signo}{n}/{d}"'
            return f'{signo}{entero} {n}/{d}"'
        d *= 2
    return f'{signo}{fmt_mm(pulgadas)}"'


_FRACCION_MIXTA = re.compile(r"^(\d+)(?:\s+|\s*-\s*)(\d+)\s*/\s*(\d+)$")
_FRACCION = re.compile(r"^(\d+)\s*/\s*(\d+)$")
_DECIMAL = re.compile(r"^\d+(?:\.\d+)?$|^\.\d+$")


def pulgadas_a_mm(texto) -> float | None:
    """Lo que se tipea en pulgadas, en mm (redondeado a 3 decimales, como la base).

    Acepta «1 1/4», «1-1/4», «3/8», «2 1/2», «1.5», «1,5» (coma decimal), con o sin la
    comilla del final. Un número suelto (int/float) se toma como pulgadas.
    '1 1/4' → 31.75. Lo que no se entiende devuelve None: decidir qué hacer con un dato
    que no se pudo leer es de quien llama (la pantalla lo marca, la importación lo cuenta).
    """
    if texto is None or isinstance(texto, bool):
        return None
    if isinstance(texto, (int, float)):
        return round(float(texto) * MM_POR_PULGADA, 3)
    t = str(texto).strip().replace(",", ".")
    t = re.sub(r'(?:"|”|″|\'\'|pulgadas?|in)$', "", t, flags=re.I).strip()
    if not t:
        return None
    m = _FRACCION_MIXTA.match(t)
    if m:
        entero, n, d = (int(x) for x in m.groups())
        if d == 0:
            return None
        return round((entero + n / d) * MM_POR_PULGADA, 3)
    m = _FRACCION.match(t)
    if m:
        n, d = (int(x) for x in m.groups())
        if d == 0:
            return None
        return round(n / d * MM_POR_PULGADA, 3)
    if _DECIMAL.match(t):
        return round(float(t) * MM_POR_PULGADA, 3)
    return None


def texto_medida(mm, sistema: str | None) -> str:
    """Una medida dentro de la descripción: «38.1mm» o «1 1/4" (31.75mm)»."""
    if sistema == "pulgada":
        return f"{mm_a_pulgadas_texto(mm)} ({fmt_mm(mm)}mm)"
    return f"{fmt_mm(mm)}mm"


# ─────────────────────────── descripción ───────────────────────────


def _limpio(texto) -> str:
    """Espacios simples, sin bordes. El viejo dejaba 2, 3 o 4 espacios según cuántas
    medidas tenía el insumo; acá la descripción se escribe siempre igual."""
    return " ".join(str(texto or "").split())


def descripcion_insumo(formato_nombre, etiquetas, medidas_mm, sistema, material_nombre,
                       calidad_nombre) -> tuple[str | None, list[str]]:
    """La descripción de un insumo tipo 'insumo', y qué falta para armarla.

    FORMATO + medidas unidas por « x » + MATERIAL (+ CALIDAD si hay), espacios simples:
      BARRA CUADRADO 38.1mm ACERO SAE 1045
      TUBO RECTANGULAR 70mm x 30mm x 2mm ACERO SAE 1010
      PLANCHUELA 1" (25.4mm) x 1/4" (6.35mm) ACERO SAE 1010

    Todas las medidas que pide el formato (una por etiqueta) son obligatorias y
    positivas: sin una, la descripción diría otra cosa que el insumo. La calidad es
    opcional (hay ALUMINIO sin calidad en el viejo).

    Devuelve (descripcion, []) o (None, faltan): `faltan` nombra lo que falta como lo
    nombra la pantalla («Formato», «Material», y la etiqueta de cada medida: «Ø»,
    «Espesor»…), para que el formulario diga qué completar.
    """
    faltan: list[str] = []
    formato = _limpio(formato_nombre)
    material = _limpio(material_nombre)
    calidad = _limpio(calidad_nombre)
    etiquetas = [e for e in (etiquetas or []) if e]
    medidas = list(medidas_mm or [])

    if not formato:
        faltan.append("Formato")
    textos = []
    for i, etiqueta in enumerate(etiquetas):
        valor = medidas[i] if i < len(medidas) else None
        try:
            numero = float(valor) if valor is not None else None
        except (TypeError, ValueError):
            numero = None
        if numero is None or not math.isfinite(numero) or numero <= 0:
            faltan.append(etiqueta)
            continue
        textos.append(texto_medida(numero, sistema))
    if not material:
        faltan.append("Material")
    if faltan:
        return None, faltan

    partes = [formato]
    if textos:
        partes.append(" x ".join(textos))
    partes.append(material)
    if calidad:
        partes.append(calidad)
    return " ".join(partes), []


def norm_desc(texto) -> str:
    """Una descripción comparable: mayúsculas y espacios simples. Es la clave del aviso
    de duplicado («Ya existe COD – DESC»): el viejo tiene la misma barra escrita con 2 y
    con 4 espacios, y eso no la hace otra barra."""
    return _limpio(texto).upper()


# ─────────────────────────── código ───────────────────────────


def prefijo_codigo(tipo, letra_codigo, material_nombre, iniciales_formato,
                   descripcion) -> str | None:
    """Las letras con las que empieza el código de un insumo nuevo.

    · tipo 'insumo': letra del material + iniciales del formato (ACERO + BARRA CUADRADO
      = ABC). La letra es `material.letra_codigo`, o la primera del nombre si no tiene.
    · los otros: las 3 primeras letras o números de la descripción, en mayúsculas y sin
      espacios ni signos («CODO 90°» = COD). Si hay menos de 3, las que haya.
      El viejo tomaba los 3 primeros caracteres TAL CUAL, espacios y barras incluidos
      (' CO002', '3/8001'): esos códigos siguen existiendo, pero no se fabrican más.

    None = no se puede armar (falta el material, el formato o la descripción).
    """
    if tipo_efectivo(tipo) == "insumo":
        letra = _limpio(letra_codigo) or _limpio(material_nombre)[:1]
        iniciales = _limpio(iniciales_formato)
        if not letra or not iniciales:
            return None
        return (letra + iniciales).replace(" ", "").upper()
    alfanumericos = [c for c in str(descripcion or "") if c.isalnum()]
    prefijo = "".join(alfanumericos[:3]).upper()
    return prefijo or None


_DIGITOS = re.compile(r"[0-9]+")


def siguiente_codigo(prefijo, codigos_existentes) -> str | None:
    """El código que sigue para un prefijo: 1 + el mayor número final de TODOS los
    códigos con ese prefijo exacto seguido sólo de dígitos, con al menos 3 dígitos.

    ABC077 → ABC078; COR2550 → COR2551; prefijo nuevo → XXX001. Todo normalizado
    (upper/trim), como compara el viejo. El número se comparte entre tipos: ABR es a la
    vez ACERO BARRA REDONDO y ABRAZADERA, y así lo numera el viejo.

    Arregla el bug del viejo que al estrenar un prefijo daba XXX001001 (63 casos). Los
    que ya existen con ese número se cuentan por lo que dicen: después de DUL001001
    viene DUL1002. No se reinterpretan porque ese código ya está en facturas.

    None si no hay prefijo.
    """
    p = _norm_codigo(prefijo)
    if not p:
        return None
    maximo = 0
    for codigo in codigos_existentes or ():
        c = _norm_codigo(codigo)
        if not c.startswith(p):
            continue
        resto = c[len(p):]
        if _DIGITOS.fullmatch(resto):
            maximo = max(maximo, int(resto))
    return f"{p}{maximo + 1:03d}"


# ─────────────────────────── cortes e historial ───────────────────────────


def sugerido_m(cortes) -> float | None:
    """Cuántos metros pedir para esos cortes: Σ cantidad × (largo + sierra) / 1000,
    redondeado HACIA ARRIBA a 2 decimales (redondear para abajo deja un corte sin
    material).

    Cada corte se come además el espesor de la sierra (ESPESOR_SIERRA_MM). Sólo si
    TODOS los cortes tienen largo: con uno sin largo la cuenta sería menor que lo que
    hace falta, y una sugerencia corta es peor que ninguna. Sin cortes, None.
    La sugerencia no cambia la cantidad de la línea: la pantalla ofrece «Usar sugerencia».
    """
    if not cortes:
        return None
    total = Decimal(0)
    for corte in cortes:
        cantidad = _campo(corte, "cantidad")
        largo = _campo(corte, "largo_mm")
        if cantidad is None or largo is None:
            return None
        total += Decimal(str(cantidad)) * (Decimal(str(largo)) + ESPESOR_SIERRA_MM)
    metros = (total / 1000).quantize(Decimal("0.01"), rounding=ROUND_CEILING)
    return float(metros)


def factor_historial(unidades_actual, unidades_origen) -> float:
    """Por cuánto multiplicar las cantidades de la OT de origen al traer su historial:
    unidades de esta OT / unidades de la de origen. Si falta alguna o es 0, 1 (se copia
    tal cual: inventar una proporción sería peor)."""
    try:
        actual = float(unidades_actual)
        origen = float(unidades_origen)
    except (TypeError, ValueError):
        return 1.0
    if not (math.isfinite(actual) and math.isfinite(origen)) or actual <= 0 or origen <= 0:
        return 1.0
    return actual / origen


def escalar_cantidad(cantidad, factor, unidad):
    """Una cantidad del historial escalada por el factor.

    En unidades ('Un') se redondea HACIA ARRIBA a entero: 2,4 bulones son 3, no 2. El
    resto (metros, kilos, litros) a 3 decimales, como la base.
    """
    valor = float(cantidad) * float(factor)
    if _limpio(unidad).upper() == "UN":
        # El round(…, 6) primero: 0.1 × 30 da 3.0000000000000004 y no son 4 bulones.
        return int(math.ceil(round(valor, 6)))
    return round(valor, 3)


def unidad_linea_desde_pieza(unidad) -> str:
    """La unidad de una línea de OT a partir de la del insumo: UN→Un, MTS→Mts, KG→Kg,
    LTS→Lts; cualquier otra (HS, vacía, 'SIN UNIDAD') → Un. El viejo escribe la unidad
    de la línea con otra capitalización que la del catálogo, y las líneas existentes ya
    están así."""
    return _UNIDAD_LINEA.get(_limpio(unidad).upper(), "Un")
