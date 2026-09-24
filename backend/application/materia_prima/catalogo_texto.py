"""Cómo se comparan los textos del catálogo de insumos: la búsqueda, los nombres de
material y calidad, y los proveedores. Funciones PURAS (tests/test_materia_prima_catalogo.py).

Viven aparte de reglas.py porque no son reglas del insumo sino de cómo se BUSCA y cómo
se decide que dos nombres son «el mismo»: las usa la API del catálogo y las puede usar
la importación del viejo (legado.proveedor_por_texto pide la misma normalización de
proveedores; si la escribe de nuevo, el aviso de duplicado del alta y el emparejado de
la importación terminan opinando distinto sobre si «ACME S.A.» y «Acme» son uno solo).
"""
from __future__ import annotations

import unicodedata

# Cuántas palabras de la búsqueda se usan. Cada una es un filtro más en la consulta: a
# partir de acá no achican nada y sólo alargan el SQL (alguien pegó una descripción).
MAX_TOKENS = 8

# Lo que no cambia de quién es un proveedor: «ACME S.A.», «ACME SA» y «ACME» son el
# mismo. De más largo a más corto, así « S.R.L.» no queda como « S.R» a medio sacar.
# « SA.» y « SRL.» (el punto sólo al final) son como está escrito ACEROS CAS en la
# lista de proveedores del viejo («ACEROS CAS SA.»): sin ellos, las 89 piezas y 564
# líneas que dicen «ACEROS CAS» no se emparejaban con su proveedor al importar.
_SUFIJOS_SOCIETARIOS = (" S.R.L.", " S.R.L", " SRL.", " SRL", " S.A.", " S.A", " SA.", " SA")


def limpio(texto) -> str:
    """Espacios simples y sin bordes. El viejo escribió la misma barra con 2 y con 4
    espacios; acá no se guarda ni se compara así."""
    return " ".join(str(texto or "").split())


def texto_o_none(valor) -> str | None:
    """Vacío es None, no ''. Así «sin dato» se guarda siempre igual."""
    t = limpio(valor)
    return t or None


def tokens(search) -> list[str]:
    """Las palabras de una búsqueda, sin repetir y en orden: «barra 19 acero» son tres
    filtros que se tienen que cumplir TODOS (en cualquier orden y con cualquier cantidad
    de espacios en el medio, que es lo que tiene el viejo)."""
    vistos: list[str] = []
    for t in limpio(search).split(" "):
        if t and t.upper() not in (v.upper() for v in vistos):
            vistos.append(t)
    return vistos[:MAX_TOKENS]


def norm_nombre(texto) -> str:
    """Un nombre de material o de calidad comparable: mayúsculas y espacios simples
    («Acero  sae 1045» = «ACERO SAE 1045»). Es lo que mira el índice único de la base
    (upper(nombre)), más los espacios."""
    return limpio(texto).upper()


def sin_acentos(texto) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", str(texto or ""))
                   if unicodedata.category(c) != "Mn")


def norm_proveedor(texto) -> str:
    """Un nombre de proveedor comparable: sin acentos, mayúsculas, espacios simples y sin
    el tipo de sociedad del final (« SA», « SA.», « S.A.», « SRL», « S.R.L.»). «Aceros Zapla S.A.»
    y «ACEROS ZAPLA» dan lo mismo; «ACEROS ZAPLA NORTE» no."""
    t = limpio(sin_acentos(texto)).upper()
    cambio = True
    while cambio and t:
        cambio = False
        for sufijo in _SUFIJOS_SOCIETARIOS:
            if t.endswith(sufijo) and len(t) > len(sufijo):
                t = t[: -len(sufijo)].rstrip(" ,.-")
                cambio = True
                break
    return t


def solo_digitos(texto) -> str:
    """El CUIT sin guiones ni espacios: 30-12345678-9 y 30123456789 son el mismo."""
    return "".join(c for c in str(texto or "") if c.isdigit())
