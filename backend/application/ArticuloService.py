from backend.domain.Articulo import Articulo
from backend.dto.ArticuloRequestDTO import ArticuloRequestDTO
from backend.infrastructure.ArticuloRepository import ArticuloRepository
from backend.application.validators.ArticuloValitor import articuloValidator
from backend.commons.ResponseDTO import ResponseDTO
from fastapi.encoders import jsonable_encoder

from backend.commons.exceptions.InfrastructureException import InfrastructureException

class ArticuloService:
    def __init__(self):
        self.repository = ArticuloRepository()

    def crearArticulo(self, articulo_dto: ArticuloRequestDTO):
        try:
            errores = articuloValidator(articulo_dto)
            if errores:
                return ResponseDTO(status=False, data={}, errorDescription="; ".join(errores))

            articulo = Articulo(
                cod_articulo= articulo_dto.cod_articulo,
                descripcion=articulo_dto.descripcion,
                abreviatura = articulo_dto.abreviatura
            )

            articulo_guardado = self.repository.save(articulo)

            response = ResponseDTO()
            response.status = True
            response.data = jsonable_encoder(articulo_guardado)
            response.errorDescription = ''
            return response

        except Exception as e:
            print("❌ Error real:", str(e))  # 👈 Mostralo en consola
            raise InfrastructureException("Error al guardar el artículo.") from e

