"""No se puede crear dos veces el mismo proceso con otro espaciado.

El catálogo tiene 415 procesos y 14 pares que sólo se distinguen por un espacio de
más: «CORTE CON  AMOLADORA» contra «CORTE CON AMOLADORA», usados 31 veces entre los
dos y con CATEGORÍAS DISTINTAS — o sea que el mismo trabajo se planificaba distinto
según cuál de los dos le tocara al que cargó la orden. En un desplegable de 415
opciones los dos se ven idénticos.

Nacieron porque `crearProceso` guardaba el nombre tal cual y no miraba si ya existía.
Y crear procesos desde la OT es algo que se agregó a propósito el 2/9, así que el
catálogo se ensucia justo donde más se usa.
"""
import pytest

from backend.application.ProcesoService import _limpiar_nombre
from backend.infrastructure.ProcesoRepository import _sin_espacios_de_mas


@pytest.mark.parametrize("entra, sale", [
    ("CORTE CON  AMOLADORA", "CORTE CON AMOLADORA"),
    ("  Torno CNC  ", "Torno CNC"),
    ("ENSAMBLAJE, PUNTEADO  Y ESCUADRADO", "ENSAMBLAJE, PUNTEADO Y ESCUADRADO"),
    ("SOLDADURA\tCON\tTIG", "SOLDADURA CON TIG"),
    ("PULIDO", "PULIDO"),
])
def test_el_nombre_se_guarda_sin_espacios_de_mas(entra, sale):
    assert _limpiar_nombre(entra) == sale
    # Las dos puntas usan la misma cuenta: si se separan, el service limpia una cosa
    # y el repositorio busca otra, y el duplicado entra igual.
    assert _sin_espacios_de_mas(entra) == sale


def test_no_toca_mayusculas_ni_acentos():
    """Cómo se escribe lo decide el taller. Lo único que se normaliza son los espacios:
    bajar todo a minúscula le cambiaría el nombre a los 415 que ya están."""
    assert _limpiar_nombre("Preparación de Soldadora TIG") == "Preparación de Soldadora TIG"


@pytest.mark.asyncio
async def test_crear_uno_que_ya_existe_devuelve_el_que_hay(session):
    """Y lo devuelve en vez de fallar: la pantalla usa lo que contesta esta llamada
    para dejar el proceso elegido en la fila, así que para el que carga el resultado es
    el mismo —queda puesto— y el catálogo no crece."""
    from backend.application.ProcesoService import ProcesoService
    from backend.domain.Proceso import Proceso
    from backend.dto.ProcesoRequestDTO import ProcesoRequestDTO

    session.add(Proceso(id=222, nombre="CORTE CON AMOLADORA"))
    await session.commit()

    svc = ProcesoService(session)
    r = await svc.crearProceso(ProcesoRequestDTO(nombre="CORTE CON  AMOLADORA"))

    assert r.status is True
    assert r.data["id"] == 222, "tendría que devolver el que ya existe, no crear otro"

    total = len((await session.execute(__import__("sqlalchemy").select(Proceso))).scalars().all())
    assert total == 1, "se creó un duplicado"


@pytest.mark.asyncio
async def test_uno_nuevo_se_crea_limpio(session):
    from backend.application.ProcesoService import ProcesoService
    from backend.domain.Proceso import Proceso
    from backend.dto.ProcesoRequestDTO import ProcesoRequestDTO

    r = await ProcesoService(session).crearProceso(
        ProcesoRequestDTO(nombre="  PREPARACION  DE   PRENSA  "))
    assert r.status is True
    assert r.data["nombre"] == "PREPARACION DE PRENSA"
    assert await session.get(Proceso, r.data["id"]) is not None


# ─────────────────── un proceso sin nombre no entra ───────────────────

def test_un_alta_sin_nombre_no_pasa():
    """`POST /procesos` con el cuerpo vacío devolvía 200 y creaba un proceso en blanco.

    Todos los controles del validador arrancaban con `if dto.nombre`, y `""` y `None`
    son falsos: no chocaba con ninguno. En un desplegable de 415 opciones un renglón
    vacío es peor que un error — alguien lo elige sin querer y queda enganchado a una
    OT. Salió a la luz el 15/09 mandando el cuerpo vacío contra producción.
    """
    from backend.application.validators.ProcesoValidator import procesoValidator
    from backend.dto.ProcesoRequestDTO import ProcesoRequestDTO

    assert procesoValidator(ProcesoRequestDTO(), creando=True) == ["Ponele un nombre al proceso."]
    assert procesoValidator(ProcesoRequestDTO(nombre="   "), creando=True) == [
        "Ponele un nombre al proceso."]
    assert procesoValidator(ProcesoRequestDTO(nombre="TORNEADO"), creando=True) == []


def test_editando_se_puede_no_mandar_el_nombre_pero_no_mandarlo_en_blanco():
    """En una edición no mandar el campo significa «dejalo como está»; mandarlo vacío
    significa «borrámelo», y eso sí es un error. El DTO representa a los dos como
    None, así que la diferencia la sabe pydantic y no el valor."""
    from backend.application.validators.ProcesoValidator import procesoValidator
    from backend.dto.ProcesoRequestDTO import ProcesoRequestDTO

    assert procesoValidator(ProcesoRequestDTO(descripcion="otra cosa")) == []
    assert procesoValidator(ProcesoRequestDTO(nombre="")) == ["El nombre no puede quedar vacío."]
