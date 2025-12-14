from typing import List, Optional

from backend.domain.Cliente import Cliente
from backend.dto.ClienteRequestDTO import ClienteRequestDTO
from backend.infrastructure.ClienteRepository import ClienteRepository
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.ApplicationException import ApplicationException
from backend.commons.exceptions.NotFoundException import NotFoundException
from fastapi.encoders import jsonable_encoder
from backend.commons.loggers.logger import logger

class ClienteService:
    def __init__(self, db_session):
        self.repository = ClienteRepository(db_session)

    async def crearCliente(self, cliente_dto: ClienteRequestDTO):
        try:
            logger.info("Service - Crear cliente.")

            # Validación de negocio
            nombre = (cliente_dto.nombre or "").strip()
            if not nombre:
                raise BusinessException("El nombre de Cliente es obligatorio.")

            cliente = Cliente(nombre=nombre)
            cliente_creado = await self.repository.save(cliente)

            return ResponseDTO(status=True, data=jsonable_encoder(cliente_creado))
        except InfrastructureException:
            raise  
        except BusinessException:
            raise
        except Exception as e:
            raise ApplicationException("Error inesperado al crear el Cliente.") from e

    async def listarClientes(self):
        logger.info("Service - Listar clientes.")
        clientes = await self.repository.find_all()
        
        if not clientes:
            logger.info("Service - No hay clientes registrados.")
        
        return ResponseDTO(status=True, data=jsonable_encoder(clientes))

    async def obtenerClientePorId(self, id: int):
        logger.info(f"Service - Obtener cliente ID: {id}")
        cliente = await self.repository.find_by_id(id)

        if not cliente:
            raise NotFoundException(f"No se encontró el cliente con ID {id}")

        return ResponseDTO(status=True, data=jsonable_encoder(cliente))
