"""Lo que entra por la API del catálogo de insumos (spec §2.1, /materia-prima/...).

Ninguno trae fecha de registro ni usuario: los pone el servidor (hora del taller y
usuario del token). Si los mandara el navegador, el registro diría lo que el navegador
quisiera.

Los tipos y las marcas se validan en el servicio y no con Literal/Field: así el error
sale como 422 con el motivo en castellano («El tipo tiene que ser…»), que la pantalla
muestra tal cual, y no como el 400 genérico de Pydantic.
"""
from datetime import date
from typing import Optional

from pydantic import BaseModel


# ─────────────────────────── catálogos chicos ───────────────────────────

class MaterialIn(BaseModel):
    """Alta de un material (ACERO, BRONCE…). `letra_codigo`: con qué letra empiezan los
    códigos de sus insumos; sin ella, la primera del nombre."""
    nombre: str
    letra_codigo: Optional[str] = None


class CalidadIn(BaseModel):
    """Alta de una calidad de un material (SAE 1045 del ACERO)."""
    nombre: str


class ProveedorIn(BaseModel):
    """Alta rápida de un proveedor: alcanza con la razón social."""
    razon_social: str
    fantasia: Optional[str] = None
    cuit: Optional[str] = None
    telefono: Optional[str] = None
    mail: Optional[str] = None


# ─────────────────────────── insumos ───────────────────────────

class PrevisualizarIn(BaseModel):
    """La vista previa del alta: qué descripción y qué código saldrían. No escribe nada.

    `medidas` en MILÍMETROS aunque se hayan escrito en pulgadas (la pantalla convierte);
    `sistema_medida` sólo decide cómo se escriben en la descripción.
    `excluir_id`: en la edición, el propio insumo (que no se avise a sí mismo como
    duplicado).
    """
    tipo: str
    id_material: Optional[int] = None
    id_calidad: Optional[int] = None
    id_formato: Optional[int] = None
    sistema_medida: Optional[str] = "mm"
    medidas: Optional[list[Optional[float]]] = None
    descripcion: Optional[str] = None
    excluir_id: Optional[int] = None


class InsumoIn(BaseModel):
    """Alta de un insumo.

    Sin `codigo` el servidor arma el siguiente con la regla del viejo (prefijo + número).
    Tipo 'insumo': la descripción la arma el servidor con formato, medidas y material
    (lo que venga en `descripcion` no se usa). Los otros tipos: descripción libre,
    obligatoria. `unitario` > 0 deja además la primera fila del historial de precios.
    """
    tipo: str
    codigo: Optional[str] = None
    descripcion: Optional[str] = None
    id_material: Optional[int] = None
    id_calidad: Optional[int] = None
    id_formato: Optional[int] = None
    sistema_medida: Optional[str] = None
    medidas: Optional[list[Optional[float]]] = None
    unidad: str
    unitario: Optional[float] = None
    id_proveedor: Optional[int] = None
    stock_minimo: Optional[float] = None
    estante: Optional[str] = None
    letra: Optional[str] = None
    nro: Optional[str] = None
    observaciones: Optional[str] = None


class InsumoCambiosIn(BaseModel):
    """Edición parcial de un insumo: sólo lo que viene se toca (exclude_unset), y un null
    explícito borra (id_proveedor, stock_minimo, ubicación, observaciones).

    `codigo` y `unitario` están para poder RECHAZARLOS con un motivo: el código no se
    edita (lo usan las facturas del viejo) y el precio va por la solapa Precios, que
    deja historial. Si vienen iguales a lo que hay, no molestan.
    """
    tipo: Optional[str] = None
    codigo: Optional[str] = None
    descripcion: Optional[str] = None
    id_material: Optional[int] = None
    id_calidad: Optional[int] = None
    id_formato: Optional[int] = None
    sistema_medida: Optional[str] = None
    medidas: Optional[list[Optional[float]]] = None
    unidad: Optional[str] = None
    unitario: Optional[float] = None
    id_proveedor: Optional[int] = None
    stock_minimo: Optional[float] = None
    estante: Optional[str] = None
    letra: Optional[str] = None
    nro: Optional[str] = None
    observaciones: Optional[str] = None
    inactivo: Optional[bool] = None


# ─────────────────────────── stock ───────────────────────────

class MovimientoIn(BaseModel):
    """Un movimiento de stock cargado a mano.

    · ingreso / egreso: `cantidad` > 0 (el egreso se guarda en negativo).
    · ajuste: `saldo_nuevo` = lo que se contó; se guarda la diferencia.
    `numero_ot` es el número que ve la gente (id_otvieja), no el id.
    Los `retiro_ot` no entran por acá: los crea marcar Disponible una línea reservada.
    """
    tipo: str
    cantidad: Optional[float] = None
    saldo_nuevo: Optional[float] = None
    comentario: Optional[str] = None
    numero_ot: Optional[int] = None


class AnularMovimientoIn(BaseModel):
    """Anular un movimiento: deja de sumar, pero el renglón queda a la vista."""
    motivo: Optional[str] = None


# ─────────────────────────── recortes y precios ───────────────────────────

class RecorteIn(BaseModel):
    """Alta rápida de un recorte. `largo_mm` es obligatorio (se valida en el servicio,
    para que el motivo salga en castellano); 6000 mm es una barra entera."""
    largo_mm: Optional[float] = None
    ancho_mm: Optional[float] = None
    cantidad: Optional[int] = 1
    observaciones: Optional[str] = None


class RecorteCambiosIn(BaseModel):
    """Edición parcial de un recorte. `estado` 'usado' deja quién y cuándo;
    `numero_ot_uso` es el número de OT que ve la gente (el servidor lo pasa a id)."""
    largo_mm: Optional[float] = None
    ancho_mm: Optional[float] = None
    cantidad: Optional[int] = None
    observaciones: Optional[str] = None
    estado: Optional[str] = None
    numero_ot_uso: Optional[int] = None


class PrecioIn(BaseModel):
    """Cargar un precio a mano. Sin fecha = hoy. Si es el más nuevo, pasa a ser el
    precio vigente del insumo (unitario + fecha_ultimo_precio)."""
    precio: float
    fecha: Optional[date] = None
    id_proveedor: Optional[int] = None
