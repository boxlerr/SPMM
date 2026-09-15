from backend.dto.ProcesoRequestDTO import ProcesoRequestDTO


def _fue_enviado(dto: ProcesoRequestDTO, campo: str) -> bool:
    """Si el que llamó MANDÓ ese campo, aunque sea vacío.

    No es lo mismo «no lo mandé» (en una edición: dejalo como está) que «lo mandé en
    blanco» (borrame el nombre). El DTO los representa a los dos como None, así que la
    diferencia hay que preguntársela a pydantic.
    """
    puestos = getattr(dto, "model_fields_set", None) or getattr(dto, "__fields_set__", set())
    return campo in puestos


def procesoValidator(dto: ProcesoRequestDTO, creando: bool = False):
    """Lo que un proceso tiene que cumplir, dicho como se lee en pantalla.

    OJO CON EL NOMBRE VACÍO. Hasta el 15/09 todos los controles de acá arrancaban con
    `if dto.nombre`, y `""` y `None` son falsos: un alta sin nombre no chocaba con
    NINGUNO y el proceso se creaba igual, con el nombre en blanco. Un proceso sin
    nombre es peor que un error — en un desplegable de 415 es un renglón vacío que
    alguien puede elegir sin querer, y desde ese momento queda enganchado a una OT.
    Encontrado mandando `POST /procesos` con el cuerpo vacío: devolvía 200.
    """
    errores = []

    nombre = (dto.nombre or "").strip()

    if creando:
        if not nombre:
            errores.append("Ponele un nombre al proceso.")
    elif _fue_enviado(dto, "nombre") and not nombre:
        # En una edición, mandar el nombre en blanco es pedir que se borre.
        errores.append("El nombre no puede quedar vacío.")

    if len(dto.nombre or "") > 255:
        errores.append("El nombre no puede superar los 255 caracteres.")

    if _fue_enviado(dto, "descripcion") and dto.descripcion is not None \
            and not dto.descripcion.strip():
        errores.append("La descripción no puede quedar vacía.")

    return errores
