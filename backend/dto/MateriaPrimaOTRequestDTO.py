"""Lo que entra por la API de las materias primas de la OT (spec §2.2).

Sólo la FORMA: qué campos hay y de qué tipo. Las reglas (cantidad positiva, unidad
conocida, descripción editable según el tipo del insumo, reserva contra el stock libre)
las aplica el servicio (application/MateriaPrimaOTService.py), que es el que conoce la
línea y la pieza. Una regla escrita acá daría un 400 de Pydantic con otro formato que el
422 de negocio, y la pantalla tendría que leer los dos.

LO QUE NO VINO NO ES LO MISMO QUE UN NULL

Los cambios de una línea son PARCIALES: se aplica sólo lo que vino. Para las fechas eso
importa dos veces: `{"fecha_entrega": null}` la BORRA y `{}` no la toca. El servicio lo
distingue con `model_fields_set` (lo que el cuerpo trajo de verdad), no mirando si el
valor es None.

Las fechas del proveedor y de entrega son DÍAS (`date`, «YYYY-MM-DD»): no llevan hora ni
zona, así que no hace falta FechaSinZona.
"""
from datetime import date
from typing import List, Optional

from pydantic import BaseModel, Field


class CorteIn(BaseModel):
    """Un corte: cuántas piezas y de qué largo (y ancho, en chapa), en mm.

    `cantidad` entra como número cualquiera y el servicio exige que sea entero: así «1,5
    piezas» contesta un 422 que lo dice, y no el 400 genérico de Pydantic."""
    cantidad: float
    largo_mm: Optional[float] = None
    ancho_mm: Optional[float] = None


class LineaIn(BaseModel):
    """El alta de una materia prima en una OT (y cada una del lote).

    Sin `unidad`, se toma la del insumo (UN→Un, MTS→Mts…). Sin `descripcion`, se congela
    la del insumo. `origen` sólo puede ser 'spmm' (lo cargado a mano, el default) o
    'historial' (lo que trajo «Traer historial»): 'legacy' es de la importación.
    """
    id_pieza: int
    cantidad: float
    unidad: Optional[str] = None
    descripcion: Optional[str] = None
    observaciones: Optional[str] = None
    id_proveedor: Optional[int] = None
    proveedor: Optional[str] = None
    cortes: Optional[List[CorteIn]] = None
    origen: Optional[str] = None


class LoteLineasIn(BaseModel):
    """`POST /materia-prima/ot/{id}/lineas/lote`: todas o ninguna."""
    lineas: List[LineaIn] = Field(default_factory=list)


class CambiosLineaLote(BaseModel):
    """Lo que se puede cambiar a muchas líneas de una vez (la barra de acciones de
    Pendientes). Todo opcional: se aplica sólo lo que vino."""
    pedido: Optional[bool] = None
    disponible: Optional[bool] = None
    reserva: Optional[bool] = None
    en_produccion: Optional[bool] = None
    id_proveedor: Optional[int] = None
    proveedor: Optional[str] = None
    fecha_proveedor: Optional[date] = None
    fecha_entrega: Optional[date] = None


class CambiosLinea(CambiosLineaLote):
    """`PUT /materia-prima/lineas/{id}`: una línea, sólo lo que cambia.

    `id_pieza` está para poder CONTESTAR que no se cambia (se borra la línea y se agrega
    otra): sin declararlo, Pydantic lo ignoraría callado y el front creería que cambió.
    """
    id_pieza: Optional[int] = None
    cantidad: Optional[float] = None
    unidad: Optional[str] = None
    descripcion: Optional[str] = None
    observaciones: Optional[str] = None
    usado: Optional[bool] = None
    cantidad_reservada: Optional[float] = None
    orden: Optional[int] = None


class CambiosLoteIn(BaseModel):
    """`PUT /materia-prima/lineas/lote`: los mismos cambios a todas esas líneas, todas o
    ninguna."""
    ids: List[int] = Field(default_factory=list)
    cambios: CambiosLineaLote


class CortesIn(BaseModel):
    """`PUT /materia-prima/lineas/{id}/cortes`: REEMPLAZA todos los cortes de la línea
    (una lista vacía los borra)."""
    cortes: List[CorteIn] = Field(default_factory=list)
