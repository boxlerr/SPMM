"""Dos OT no pueden terminar con el mismo número.

El número se genera con `SELECT max(id_otvieja) + 1` adentro de la transacción. Si dos
personas crean una orden al mismo tiempo —Camilo y Lucas a la mañana, que es el caso
real— las dos leen el mismo máximo y las dos escriben el mismo número. Hasta el
15/09/2026 nada lo impedía: `id_otvieja` tenía índice pero no era único, así que
quedaban dos órdenes distintas con el mismo número, en un taller que identifica todo por
ese número, y en silencio.

Ahora hay índice único y el servicio reintenta recalculando: la segunda persona se lleva
el número siguiente y no se entera. Pero sólo cuando el número lo puso el sistema — si
alguien lo escribió a mano y ya existe, darle otro distinto en silencio sería peor que
el error.
"""
from pathlib import Path

from backend.application.OrdenTrabajoService import _es_numero_de_ot_repetido

MIGRACION = (Path(__file__).resolve().parent.parent
             / "scripts" / "migrations" / "2026-09-15_numero_de_ot_unico.sql")


def test_el_indice_unico_esta_en_la_migracion_y_deja_pasar_los_nulos():
    sql = MIGRACION.read_text().lower()
    assert "create unique index" in sql
    assert "ux_orden_trabajo_id_otvieja" in sql
    # Sin el WHERE, dos OT creadas acá sin número del sistema viejo chocarían entre sí:
    # en Postgres los NULL no son iguales entre sí para UNIQUE, pero el índice parcial
    # además lo deja escrito y mantiene el índice chico.
    assert "where id_otvieja is not null" in sql


def test_la_migracion_se_aplica_sola_al_arrancar():
    """El backend se deploya a mano y nadie corre el .sql: si no está acá, en producción
    el índice no existe y el bug sigue vivo con el código nuevo puesto."""
    from backend.infrastructure import migraciones
    nombres = [n for n, _ in migraciones.MIGRACIONES]
    assert "2026-09-15_numero_de_ot_unico" in nombres
    ddl = " ".join(s for n, ss in migraciones.MIGRACIONES if n == "2026-09-15_numero_de_ot_unico" for s in ss)
    assert "ux_orden_trabajo_id_otvieja" in ddl


def test_reconoce_el_choque_de_numero_entre_capas():
    """El error llega envuelto: asyncpg -> SQLAlchemy -> db_retry. Por eso se mira el
    nombre del índice, que viaja en el texto, y no el tipo de excepción."""
    crudo = ('duplicate key value violates unique constraint '
             '"ux_orden_trabajo_id_otvieja"')
    assert _es_numero_de_ot_repetido(Exception(crudo))
    assert _es_numero_de_ot_repetido(RuntimeError(f"(sqlalchemy) {crudo} DETAIL: ..."))

    # Y NO confunde cualquier otra violación de unicidad: reintentar ahí sería repetir
    # una operación que va a fallar igual.
    assert not _es_numero_de_ot_repetido(Exception(
        'duplicate key value violates unique constraint "ux_plano_storage_path"'))
    assert not _es_numero_de_ot_repetido(Exception("connection closed"))


def test_solo_se_reintenta_cuando_el_numero_lo_puso_el_sistema():
    """Si la persona escribió el número a mano y ya existe, darle otro en silencio le
    cambia el dato que pidió. Eso se le dice."""
    import inspect
    from backend.application import OrdenTrabajoService as mod
    fuente = inspect.getsource(mod.OrdenTrabajoService.crearOrdenTrabajo)
    assert "intentos = 3 if (not dto.id_otvieja or dto.id_otvieja == 0) else 1" in fuente
