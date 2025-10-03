from backend.dto.ArticuloRequestDTO import ArticuloRequestDTO

def articuloValidator(articulo_dto: ArticuloRequestDTO):
    errores = []

    if not articulo_dto.cod_articulo or len(articulo_dto.cod_articulo.strip()) == 0:
        errores.append("El código del artículo no puede estar vacío")

    if not articulo_dto.descripcion or len(articulo_dto.descripcion.strip()) == 0:
        errores.append("La descripción no puede estar vacía")

    if not articulo_dto.abreviatura or len(articulo_dto.abreviatura.strip()) == 0:
        errores.append("La abreviatura no puede estar vacía")

    return errores
