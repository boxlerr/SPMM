"""
El catálogo de procesos y los nombres del sistema viejo (el Integral).

Reunión con Lucas, 29/9/2026: los procesos llevan nombre GENÉRICO y la máquina se elige
aparte. En el Integral el proceso decía en qué máquina se hacía («TORNO T1» es el torno 1,
«FRESADORA F6» una fresadora de su numeración vieja); en SPMM las máquinas son las de
Recursos y el planificador elige una de la familia. Por eso «TORNO T1» a «TORNO T6» son
un solo TORNEADO y «FRESADORA F6» a «F9» un solo FRESADO CONVENCIONAL. Sin «CNC» en el
nombre, el trabajo va a las máquinas convencionales (familia_requerida_from_proceso).

El Integral sigue cargando OT con sus nombres de siempre (la prueba piloto va en
paralelo), así que el importador los traduce con `nombre_en_spmm`: la usan
`importar_ot_legacy.lista_del_viejo` —y con ella la auditoría contra el viejo— y la
limpieza del catálogo (`scripts/limpiar_catalogo_procesos.py`), que es la que renombró y
fusionó en la base. Una fusión nueva se agrega acá y el importador la toma sola.
"""

# Nombre del Integral, ya normalizado (mayúsculas y espacios colapsados, como
# importar_ot_legacy.clave_proceso) → nombre del proceso que lo reemplaza en SPMM.
RENOMBRES_DEL_VIEJO: dict[str, str] = {
    **{f"TORNO T{i}": "TORNEADO" for i in range(1, 7)},
    **{f"FRESADORA F{i}": "FRESADO CONVENCIONAL" for i in range(6, 10)},
    "TORNO CNC": "TORNEADO CNC",
    "FRESADORA CNC": "FRESADO CNC",
    # Errores de tipeo del Integral. En SPMM ya estaban corregidos, y el rango y las
    # skills se habían cargado en la versión corregida; la mal escrita era la que usaba
    # el importador, sin nada cargado.
    "AGUSTE PARA BUJE": "AJUSTE PARA BUJE",
    "VICELADO PARA SOLDADURA": "BICELADO PARA SOLDADURA",
}


def nombre_en_spmm(clave: str) -> str:
    """El nombre del proceso de SPMM que corresponde a un nombre del Integral."""
    return RENOMBRES_DEL_VIEJO.get(clave, clave)
