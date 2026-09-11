"""El aviso de desfasaje con el sistema viejo.

El 11/9 se midió lo que cuesta no tenerlo: el plan confirmado de la noche anterior
tenía 4.815 de sus 13.535 minutos —el 36%— reservados para trabajo que ya había salido
por la puerta, y una de esas órdenes se había entregado ESE MISMO DÍA. El dato estaba en
la otra base y en SPMM no se veía por ningún lado.

Estos tests cuidan las dos propiedades que hacen que el aviso sea seguro de tener
prendido: que NO escriba en las órdenes, y que no tape la sincronización si falla.
"""
import inspect
import re

from backend.scripts import sync_db


def _cuerpo():
    return inspect.getsource(sync_db._avisar_desfasaje)


def test_no_toca_las_ordenes():
    """Avisa, no arregla.

    El 2/9 se decidió que SPMM es el dueño de las órdenes y el sync dejó de tocarlas.
    Este paso vive DENTRO del sync, así que si algún día alguien le agrega un UPDATE a
    orden_trabajo, revierte esa decisión sin que nadie lo note. Cerrar una orden sigue
    siendo de una persona, con el script que ya existe.
    """
    cuerpo = _cuerpo().lower()
    for prohibido in ("update orden_trabajo", "insert into orden_trabajo",
                      "delete from orden_trabajo", "finalizadototal ="):
        assert prohibido not in cuerpo, (
            f"el aviso pasó a ESCRIBIR en las órdenes ({prohibido}): eso revierte la "
            "decisión del 2/9 de que SPMM es el dueño"
        )


def test_no_puede_tumbar_la_sincronizacion():
    """Un aviso que falla no puede dejar sin sincronizar el resto."""
    cuerpo = _cuerpo()
    assert "try:" in cuerpo and "except Exception" in cuerpo, (
        "sin el try, un sistema viejo que no contesta se lleva puesta la sincronización"
    )
    assert "logger.warning" in cuerpo, "si falla tiene que quedar dicho en algún lado"


def test_no_apila_un_aviso_por_corrida():
    """Corre cada pocos minutos: un aviso repetido deja de leerse."""
    cuerpo = _cuerpo().lower()
    assert "not leida" in cuerpo and "update notificacion" in cuerpo, (
        "tiene que actualizar el aviso que ya está sin leer en vez de crear otro"
    )


def test_la_fecha_va_sin_zona_y_en_hora_argentina():
    """Regla #1 del repo. Cloud Run corre en UTC y el Dockerfile no fija TZ."""
    fuente = inspect.getsource(sync_db)
    assert "_ahora_ar()" in _cuerpo(), "el aviso tiene que estampar con _ahora_ar()"
    assert not re.search(r"datetime\.utcnow\(\)", fuente), "quedó un utcnow en el sync"
    ahora = sync_db._ahora_ar()
    assert ahora.tzinfo is None, "la fecha tiene que ir sin zona"
