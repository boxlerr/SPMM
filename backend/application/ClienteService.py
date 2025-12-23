from backend.domain.Cliente import Cliente
from backend.dto.ClienteRequestDTO import ClienteRequestDTO
from backend.infrastructure.ClienteRepository import ClienteRepository
from fastapi.encoders import jsonable_encoder

# Excepciones, ResponseDTO y Loggers
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.ApplicationException import ApplicationException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.loggers.logger import logger
from backend.commons.ResponseDTO import ResponseDTO

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

            cliente = Cliente(
                nombre=nombre,
                direccion=cliente_dto.direccion,
                cuit=cliente_dto.cuit,
                telefono=cliente_dto.telefono,
                celular=cliente_dto.celular,
                localidad=cliente_dto.localidad,
                mail=cliente_dto.mail,
                web=cliente_dto.web,
                obs=cliente_dto.obs,
                fantasia=cliente_dto.fantasia,
                abreviatura=cliente_dto.abreviatura
            )
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

    async def actualizarCliente(self, id: int, cliente_dto: ClienteRequestDTO):
        try:
            logger.info(f"Service - Actualizar cliente ID: {id}")
            
            cliente = await self.repository.find_by_id(id)
            if not cliente:
                raise NotFoundException(f"No se encontró el cliente con ID {id}")

            nombre = (cliente_dto.nombre or "").strip()
            if not nombre:
                raise BusinessException("El nombre de Cliente es obligatorio.")

            cliente.nombre = nombre
            cliente.direccion = cliente_dto.direccion
            cliente.cuit = cliente_dto.cuit
            cliente.telefono = cliente_dto.telefono
            cliente.celular = cliente_dto.celular
            cliente.localidad = cliente_dto.localidad
            cliente.mail = cliente_dto.mail
            cliente.web = cliente_dto.web
            cliente.obs = cliente_dto.obs
            cliente.fantasia = cliente_dto.fantasia
            cliente.abreviatura = cliente_dto.abreviatura
            
            cliente_actualizado = await self.repository.update(cliente)
            return ResponseDTO(status=True, data=jsonable_encoder(cliente_actualizado))

        except (InfrastructureException, BusinessException, NotFoundException):
            raise
        except Exception as e:
            raise ApplicationException("Error inesperado al actualizar el Cliente.") from e

    async def eliminarCliente(self, id: int):
        try:
            logger.info(f"Service - Eliminar cliente ID: {id}")
            
            cliente = await self.repository.find_by_id(id)
            if not cliente:
                raise NotFoundException(f"No se encontró el cliente con ID {id}")

            await self.repository.delete(cliente)
            return ResponseDTO(status=True, message="Cliente eliminado correctamente.")

        except (InfrastructureException, NotFoundException):
            raise
        except Exception as e:
            raise ApplicationException("Error inesperado al eliminar el Cliente.") from e
