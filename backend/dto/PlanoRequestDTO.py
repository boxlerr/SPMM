from pydantic import BaseModel, model_validator
from typing import Optional

from backend.dto.fechas import FechaSinZona


class PlanoRequestDTO(BaseModel):
    nombre: str
    descripcion: Optional[str] = None
    tipo_archivo: str
    archivo: bytes

    # Los dos destinos posibles. Van los dos opcionales porque un plano de producto no
    # tiene OT y uno de OT puntual no tiene artículo; el validador de abajo se ocupa
    # de que venga al menos uno.
    id_orden_trabajo: Optional[int] = None
    id_articulo: Optional[int] = None

    drive_file_id: Optional[str] = None
    drive_md5: Optional[str] = None
    drive_modificado: Optional[FechaSinZona] = None

    @model_validator(mode="after")
    def validar_destino(self):
        """Un plano sin destino no lo encuentra nadie.

        Es el mismo CHECK que tiene la base (ck_plano_destino), pero acá el error sale
        en castellano y con un 400; si lo dejáramos llegar a Postgres, el usuario vería
        un «Error inesperado» del handler genérico.
        """
        if self.id_orden_trabajo is None and self.id_articulo is None:
            raise ValueError(
                "El plano tiene que ir a una orden de trabajo o a un artículo."
            )
        return self


class PlanoUpdateDTO(BaseModel):
    """Lo único que se edita de un plano ya cargado.

    Va aparte de PlanoRequestDTO porque el destino no se edita: un plano no se muda de
    una OT a un artículo. Mientras la edición usaba el DTO de alta había que inventarle
    un `id_orden_trabajo` cualquiera para pasar el validador, y ese número mentiroso
    viajaba hasta el service esperando que alguien no lo guardara.
    """

    nombre: str
    descripcion: Optional[str] = None
    tipo_archivo: str
    archivo: bytes
