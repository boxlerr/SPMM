"""El catálogo de insumos de la sección Materia prima (spec §2.1): materiales y calidades,
proveedores, insumos (alta, ficha, edición, baja), su stock por movimientos, recortes,
precios y las OT donde se usaron.

Desde la reunión del 23/09/2026 el catálogo se gestiona en SPMM; el viejo queda para
facturas y remitos. Por eso hay reglas que existen sólo por el viejo:

  · El CÓDIGO no se edita después del alta y sigue la regla del viejo (prefijo +
    número): lo usan las facturas de allá.
  · La DESCRIPCIÓN de un insumo tipo 'insumo' la arma el backend (reglas.py) y la
    pantalla la pide con /previsualizar: una sola implementación, así el aviso de
    duplicado encuentra la misma barra aunque la haya cargado otra persona.
  · El PRECIO vigente (`unitario`) sólo cambia por la solapa Precios, que deja
    historial: el sync trae además el último precio de compra del viejo (paso 7b).
  · El STOCK es la suma de movimientos (stock.py): nadie escribe `stockactual` a mano.

«AVISAR, NO BLOQUEAR»

Lo que se puede hacer pero conviene saber antes (una descripción que ya existe, un
egreso que deja el stock negativo, un proveedor con el mismo nombre) es 409 con el
motivo y se repite con `forzar`. Lo que no se puede (un código repetido, editar el
código, borrar algo que se usó) es 422 con qué hacer en su lugar.

TRANSACCIONES

Cada operación que escribe es una sola transacción (`_escritura`): o queda entera o no
queda nada. El núcleo (stock.registrar_movimiento, anular_movimiento) no hace commit;
lo hace acá.

Quién y cuándo: el usuario del token (`nombre_de`) y la hora del taller (`ahora_ar`),
nunca lo que mande el navegador.
"""
from __future__ import annotations

import math
from contextlib import asynccontextmanager
from datetime import date, datetime

from fastapi import HTTPException

from backend.application.materia_prima import stock
from backend.application.materia_prima.catalogo_texto import (
    limpio,
    norm_nombre,
    norm_proveedor,
    solo_digitos,
    texto_o_none,
)
from backend.application.materia_prima.reglas import (
    ESPESOR_SIERRA_MM,
    MAX_MEDIDAS,
    SISTEMAS_MEDIDA,
    TIPOS_CATALOGO,
    TIPOS_INSUMO,
    UNIDADES,
    UNIDADES_LINEA,
    descripcion_insumo,
    fmt_mm,
    norm_desc,
    prefijo_codigo,
    siguiente_codigo,
    tipo_efectivo,
)
from backend.application.materia_prima.usuario import nombre_de
from backend.application.validators.PiezaValidator import stockMinimoValidator
from backend.commons.ResponseDTO import ResponseDTO
from backend.commons.exceptions.BusinessException import BusinessException
from backend.commons.exceptions.ConfirmacionRequeridaException import ConfirmacionRequeridaException
from backend.commons.exceptions.InfrastructureException import InfrastructureException
from backend.commons.exceptions.NotFoundException import NotFoundException
from backend.commons.loggers.logger import logger
from backend.domain.Material import Material
from backend.domain.MaterialCalidad import MaterialCalidad
from backend.domain.Pieza import Pieza, esta_bajo_minimo
from backend.domain.PiezaPrecio import PiezaPrecio
from backend.domain.PiezaRecorte import ESTADOS_RECORTE, PiezaRecorte
from backend.domain.Proveedor import Proveedor
from backend.dto.MateriaPrimaCatalogoDTO import (
    AnularMovimientoIn,
    CalidadIn,
    InsumoCambiosIn,
    InsumoIn,
    MaterialIn,
    MovimientoIn,
    PrecioIn,
    PrevisualizarIn,
    ProveedorIn,
    RecorteCambiosIn,
    RecorteIn,
)
from backend.infrastructure.MateriaPrimaCatalogoRepository import MateriaPrimaCatalogoRepository
from backend.infrastructure.auditoria_movimientos import ahora_ar

# ─────────────────────────── límites ───────────────────────────

# El código del viejo es nvarchar(10) (dbo.pieza.Idpieza) y las facturas se hacen allá:
# un código más largo no se podría escribir en una factura.
LARGO_CODIGO = 10
# Lo que entra en orden_trabajo_pieza.descripcion, donde la línea congela la
# descripción del insumo al cargarlo: una más larga rompería el alta de la línea.
LARGO_DESCRIPCION = 255
LARGO_UBICACION = 20
LARGO_OBSERVACIONES = 2000
LARGO_NOMBRE_MATERIAL = 80
# Más que esto no es una medida ni un precio, es un número pegado en el campo equivocado.
MEDIDA_TOPE_MM = 1_000_000
PRECIO_TOPE = 1_000_000_000
CANTIDAD_TOPE = 1_000_000
# Un recorte de más de 100 m no existe (una barra entera son 6000 mm).
RECORTE_TOPE_MM = 100_000
PAGINA_MAXIMA = 200
LIMITE_OTS_MAXIMO = 1000

_LARGOS_PROVEEDOR = {"razon_social": 200, "fantasia": 200, "cuit": 20, "telefono": 60, "mail": 120}
_TIPOS_MOVIMIENTO_MANUAL = ("ingreso", "egreso", "ajuste")


# ─────────────────────────── cómo sale cada cosa ───────────────────────────

def _momento(valor: datetime | None) -> str | None:
    """«YYYY-MM-DDTHH:MM:SS», sin zona y sin microsegundos (spec §2)."""
    return valor.replace(microsecond=0).isoformat() if valor else None


def _dia(valor) -> str | None:
    if valor is None:
        return None
    if isinstance(valor, datetime):
        valor = valor.date()
    return valor.isoformat()


def _num(valor) -> float | None:
    return None if valor is None else round(float(valor), 4) + 0.0


def _bool(valor) -> bool:
    return bool(valor)


def _numero_valido(valor, que: str, *, minimo_excluido: float | None = None,
                   minimo: float | None = None, tope: float | None = None) -> float | None:
    """Un número que llegó por la API, validado. None pasa como None."""
    if valor is None:
        return None
    try:
        numero = float(valor)
    except (TypeError, ValueError):
        raise BusinessException(f"{que} tiene que ser un número.")
    if not math.isfinite(numero):
        raise BusinessException(f"{que} tiene que ser un número.")
    if minimo_excluido is not None and numero <= minimo_excluido:
        raise BusinessException(f"{que} tiene que ser mayor a {fmt_mm(minimo_excluido)}.")
    if minimo is not None and numero < minimo:
        raise BusinessException(f"{que} no puede ser negativo." if minimo == 0
                                else f"{que} no puede ser menor a {fmt_mm(minimo)}.")
    if tope is not None and numero > tope:
        raise BusinessException(f"{que} no puede pasar de {fmt_mm(tope)}.")
    return numero


def _texto_con_largo(valor, largo: int, que: str) -> str | None:
    texto = texto_o_none(valor)
    if texto is not None and len(texto) > largo:
        raise BusinessException(f"{que} puede tener hasta {largo} caracteres.")
    return texto


def _observaciones(valor) -> str | None:
    """Las observaciones conservan los renglones (no se colapsan espacios como en un
    nombre): sólo se recortan los bordes."""
    if valor is None:
        return None
    texto = str(valor).strip()
    if len(texto) > LARGO_OBSERVACIONES:
        raise BusinessException(f"Las observaciones pueden tener hasta {LARGO_OBSERVACIONES} caracteres.")
    return texto or None


def _norm_codigo(codigo) -> str:
    return str(codigo or "").strip().upper()


def _mismo_numero(a, b) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return round(float(a), 4) == round(float(b), 4)


def _medidas_de(pieza) -> list[float | None]:
    return [pieza.medida1, pieza.medida2, pieza.medida3, pieza.medida4, pieza.medida5]


def _proveedor_a_dict(p: Proveedor) -> dict:
    return {
        "id": p.id,
        "razon_social": p.razon_social,
        "fantasia": p.fantasia,
        "cuit": p.cuit,
        "telefono": p.telefono,
        "mail": p.mail,
        "inactivo": _bool(p.inactivo),
    }


def _fila_insumo(pieza: Pieza, material, calidad, formato, proveedor,
                 stock_pieza: dict | None, recortes: int) -> dict:
    """InsumoFila (spec §2.1). El stock lo calcula el núcleo; `bajo_minimo` es la misma
    regla que el filtro (Pieza.bajo_minimo, sobre el caché)."""
    s = stock_pieza or {"fisico": 0.0, "reservado": 0.0, "libre": 0.0}
    return {
        "id": pieza.id,
        "codigo": (pieza.cod_pieza or "").strip(),
        "descripcion": pieza.descripcion,
        "tipo": pieza.tipo,
        # Lo que tiene id manda; si no (filas de antes de la importación), el texto
        # heredado del viejo.
        "material": material or texto_o_none(pieza.material),
        "calidad": calidad,
        "formato": formato or texto_o_none(pieza.formato),
        "unidad": pieza.unidad,
        "unitario": _num(pieza.unitario),
        "fecha_ultimo_precio": _dia(pieza.fecha_ultimo_precio),
        "stock": s["fisico"],
        "reservado": s["reservado"],
        "libre": s["libre"],
        "stock_minimo": _num(pieza.stock_minimo),
        "bajo_minimo": esta_bajo_minimo(pieza.stockactual, pieza.stock_minimo),
        "estante": pieza.estante,
        "letra": pieza.letra,
        "nro": pieza.nro,
        "proveedor": proveedor or texto_o_none(pieza.proveedor),
        "inactivo": _bool(pieza.inactivo),
        "recortes_disponibles": int(recortes or 0),
    }


def _recorte_a_dict(r: PiezaRecorte, numero_ot_uso) -> dict:
    return {
        "id": r.id,
        "largo_mm": _num(r.largo_mm),
        "ancho_mm": _num(r.ancho_mm),
        "cantidad": r.cantidad,
        "observaciones": r.observaciones,
        "texto_original": r.texto_original,
        "estado": r.estado,
        "id_orden_trabajo_uso": r.id_orden_trabajo_uso,
        "numero_ot_uso": numero_ot_uso,
        "creado_en": _momento(r.creado_en),
        "creado_por": r.creado_por,
        "usado_en": _momento(r.usado_en),
        "usado_por": r.usado_por,
    }


def _cod(pieza) -> str:
    return (pieza.cod_pieza or "").strip()


def _cuantos(n: int, singular: str, plural: str) -> str:
    return f"{n} {singular if n == 1 else plural}"


class MateriaPrimaCatalogoService:
    def __init__(self, db_session):
        self.db = db_session
        self.repo = MateriaPrimaCatalogoRepository(db_session)
        # La frase para Auditoría › Todo lo que se hizo, sin el autor (lo pone el
        # middleware). La deja cada operación que escribe; la lee el endpoint.
        self.frase: str | None = None

    @asynccontextmanager
    async def _escritura(self, que: str):
        """Una operación = una transacción. Lo que la corta (un 409, un 422, un error de
        la base) deshace todo lo que ya había agregado a la sesión."""
        try:
            yield
            await self.db.commit()
        except (BusinessException, ConfirmacionRequeridaException, NotFoundException,
                HTTPException):
            await self.db.rollback()
            raise
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Service - Error al {que}: {e}")
            raise InfrastructureException(f"Error al {que}.") from e

    # ═══════════════════════════ catálogos ═══════════════════════════

    async def catalogos(self):
        """Lo que llena los desplegables del alta, en un solo pedido."""
        materiales = await self.repo.materiales_activos()
        calidades = await self.repo.calidades_activas()
        formatos = await self.repo.formatos_activos()
        por_material: dict[int, list[dict]] = {}
        for c in calidades:
            por_material.setdefault(c.id_material, []).append({"id": c.id, "nombre": c.nombre})
        return ResponseDTO(status=True, errorDescription="", data={
            "materiales": [
                {"id": m.id, "nombre": m.nombre, "letra_codigo": m.letra_codigo,
                 "calidades": por_material.get(m.id, [])}
                for m in materiales
            ],
            "formatos": [
                {"id": f.id, "nombre": f.nombre, "iniciales": f.iniciales, "etiquetas": f.etiquetas}
                for f in formatos
            ],
            "unidades": list(UNIDADES),
            "unidades_linea": list(UNIDADES_LINEA),
            "tipos": [dict(t) for t in TIPOS_CATALOGO],
            "espesor_sierra_mm": ESPESOR_SIERRA_MM,
        })

    async def crear_material(self, dto: MaterialIn):
        """Un material nuevo. El nombre es único sin mirar mayúsculas ni espacios, dados
        de baja incluidos (el índice de la base no mira `activo`): «Acero» y «ACERO»
        serían el mismo material con dos filas, y el código de sus insumos saldría de
        cualquiera de las dos."""
        nombre = _texto_con_largo(dto.nombre, LARGO_NOMBRE_MATERIAL, "El nombre del material")
        if not nombre:
            raise BusinessException("El nombre del material es obligatorio.")
        letra = texto_o_none(dto.letra_codigo)
        if letra is not None:
            letra = letra.replace(" ", "").upper()
            if len(letra) > 2 or not letra.isalnum():
                raise BusinessException(
                    "La letra del código son 1 o 2 letras o números (ACERO → A).")
        for m in await self.repo.materiales_todos():
            if norm_nombre(m.nombre) == norm_nombre(nombre):
                raise BusinessException(
                    f"Ya existe el material {m.nombre}"
                    + (" (dado de baja)." if not m.activo else "."))
        material = Material(nombre=nombre, letra_codigo=letra, activo=1)
        async with self._escritura("guardar el material"):
            self.db.add(material)
            await self.db.flush()
        self.frase = f"dio de alta el material {nombre}"
        return ResponseDTO(status=True, errorDescription="", data={
            "id": material.id, "nombre": material.nombre, "letra_codigo": material.letra_codigo,
            "calidades": [],
        })

    async def crear_calidad(self, id_material: int, dto: CalidadIn):
        material = await self.repo.material(id_material)
        if material is None:
            raise NotFoundException(f"No existe el material {id_material}.")
        nombre = _texto_con_largo(dto.nombre, LARGO_NOMBRE_MATERIAL, "El nombre de la calidad")
        if not nombre:
            raise BusinessException("El nombre de la calidad es obligatorio.")
        for c in await self.repo.calidades_de(id_material):
            if norm_nombre(c.nombre) == norm_nombre(nombre):
                raise BusinessException(f"{material.nombre} ya tiene la calidad {c.nombre}.")
        calidad = MaterialCalidad(id_material=id_material, nombre=nombre, activo=1)
        async with self._escritura("guardar la calidad"):
            self.db.add(calidad)
            await self.db.flush()
        self.frase = f"dio de alta la calidad {nombre} de {material.nombre}"
        return ResponseDTO(status=True, errorDescription="", data={
            "id": calidad.id, "nombre": calidad.nombre, "id_material": id_material,
        })

    # ═══════════════════════════ proveedores ═══════════════════════════

    async def listar_proveedores(self, search: str | None = None, limit: int = 30,
                                 incluir_inactivos: bool = False):
        limit = max(1, min(int(limit or 30), PAGINA_MAXIMA))
        filas = await self.repo.buscar_proveedores(search, limit, incluir_inactivos)
        return ResponseDTO(status=True, errorDescription="",
                           data=[_proveedor_a_dict(p) for p in filas])

    async def crear_proveedor(self, dto: ProveedorIn, usuario: dict | None = None,
                              forzar: bool = False):
        """Alta rápida (desde el selector de proveedor). 409 si ya hay uno que se llama
        igual (razón social o fantasía, sin acentos ni «S.A.») o con el mismo CUIT: dos
        filas del mismo proveedor parten en dos sus compras. Con `forzar` se crea igual
        (hay homónimos de verdad)."""
        datos = {c: _texto_con_largo(getattr(dto, c), largo, f"«{c.replace('_', ' ')}»")
                 for c, largo in _LARGOS_PROVEEDOR.items()}
        if not datos["razon_social"]:
            raise BusinessException("La razón social del proveedor es obligatoria.")

        if not forzar:
            nombres = {norm_proveedor(datos["razon_social"])}
            if datos["fantasia"]:
                nombres.add(norm_proveedor(datos["fantasia"]))
            cuit = solo_digitos(datos["cuit"])
            for id_p, razon, fantasia, cuit_p, inactivo in await self.repo.proveedores_para_comparar():
                mismo_nombre = bool(nombres & {norm_proveedor(razon), norm_proveedor(fantasia)} - {""})
                mismo_cuit = bool(cuit) and len(cuit) >= 8 and cuit == solo_digitos(cuit_p)
                if mismo_nombre or mismo_cuit:
                    cual = f"«{razon}»" + (f" ({fantasia})" if fantasia else "")
                    por = " con el mismo CUIT" if mismo_cuit and not mismo_nombre else ""
                    raise ConfirmacionRequeridaException(
                        f"Ya existe el proveedor {cual}{por}"
                        f"{' (inactivo)' if inactivo else ''}. ¿Crearlo igual?")

        _, nombre = nombre_de(usuario)
        proveedor = Proveedor(**datos, inactivo=0, creado_en=ahora_ar(), creado_por=nombre)
        async with self._escritura("guardar el proveedor"):
            self.db.add(proveedor)
            await self.db.flush()
        self.frase = f"dio de alta el proveedor {proveedor.razon_social}"
        return ResponseDTO(status=True, errorDescription="", data=_proveedor_a_dict(proveedor))

    # ═══════════════════════════ insumos: lista y ficha ═══════════════════════════

    async def listar_insumos(self, search: str | None = None, tipo: str | None = None,
                             id_material: int | None = None, id_formato: int | None = None,
                             con_stock: bool = False, bajo_minimo: bool = False,
                             con_minimo: bool = False, inactivos: bool = False,
                             page: int = 1, size: int = 50):
        if tipo is not None and tipo != "" and tipo not in TIPOS_INSUMO:
            raise BusinessException(f"El tipo tiene que ser {', '.join(TIPOS_INSUMO)}.")
        page = max(1, int(page or 1))
        size = max(1, min(int(size or 50), PAGINA_MAXIMA))
        filas, total = await self.repo.pagina_insumos(
            page, size, search=search, tipo=tipo or None, id_material=id_material,
            id_formato=id_formato, con_stock=con_stock, bajo_minimo=bajo_minimo,
            con_minimo=con_minimo, inactivos=inactivos,
        )
        ids = [f[0].id for f in filas]
        stocks = await stock.stock_de(self.db, ids)
        recortes = await stock.recortes_disponibles_de(self.db, ids)
        data = [_fila_insumo(p, mat, cal, fmt, prov, stocks.get(p.id), recortes.get(p.id, 0))
                for p, mat, cal, fmt, prov in filas]
        return ResponseDTO(status=True, errorDescription="", data={
            "data": data,
            "total_count": total,
            "page": page,
            "size": size,
            "total_pages": math.ceil(total / size) if size else 0,
        })

    async def _ficha_dict(self, id_pieza: int) -> dict:
        fila = await self.repo.insumo_con_nombres(id_pieza)
        if fila is None:
            raise NotFoundException(f"No existe el insumo {id_pieza}.")
        pieza, material, calidad, formato, proveedor = fila
        stocks = await stock.stock_de(self.db, [pieza.id])
        recortes = await stock.recortes_disponibles_de(self.db, [pieza.id])
        datos = _fila_insumo(pieza, material, calidad, formato, proveedor,
                             stocks.get(pieza.id), recortes.get(pieza.id, 0))
        datos.update({
            "id_material": pieza.id_material,
            "id_calidad": pieza.id_calidad,
            "id_formato": pieza.id_formato,
            "sistema_medida": pieza.sistema_medida or "mm",
            "medidas": [_num(m) for m in _medidas_de(pieza)],
            "id_proveedor": pieza.id_proveedor,
            "proveedor_preferido": ({"id": pieza.id_proveedor, "razon_social": proveedor}
                                    if pieza.id_proveedor is not None else None),
            "proveedor_heredado": texto_o_none(pieza.proveedor),
            "observaciones": pieza.observaciones,
            "origen": pieza.origen,
            "creado_en": _momento(pieza.creado_en),
            "creado_por": pieza.creado_por,
            "modificado_en": _momento(pieza.modificado_en),
            "modificado_por": pieza.modificado_por,
            "usos_en_ot": await self.repo.cantidad_de_ots(pieza.id),
        })
        return datos

    async def ficha(self, id_pieza: int):
        return ResponseDTO(status=True, errorDescription="", data=await self._ficha_dict(id_pieza))

    # ═══════════════════════════ insumos: descripción y código ═══════════════════════════

    @staticmethod
    def _tipo_valido(tipo) -> str:
        if tipo not in TIPOS_INSUMO:
            raise BusinessException(
                "El tipo tiene que ser Insumo, Insumo c/ descripción o Consumible "
                f"({', '.join(TIPOS_INSUMO)}).")
        return tipo

    @staticmethod
    def _sistema_valido(sistema) -> str:
        sistema = sistema or "mm"
        if sistema not in SISTEMAS_MEDIDA:
            raise BusinessException("El sistema de medida tiene que ser mm o pulgada.")
        return sistema

    @staticmethod
    def _medidas(valores, *, estricto: bool) -> list[float | None]:
        """Las cinco medidas en mm (las que faltan, None). Un 0 es «vacía».

        En la vista previa (`estricto=False`) una medida inválida cuenta como vacía y la
        descripción dice que falta; en el alta es un 422 con el motivo."""
        valores = list(valores or [])
        if len(valores) > MAX_MEDIDAS:
            raise BusinessException(f"Un insumo tiene hasta {MAX_MEDIDAS} medidas.")
        salida: list[float | None] = []
        for i in range(MAX_MEDIDAS):
            valor = valores[i] if i < len(valores) else None
            if valor is None:
                salida.append(None)
                continue
            try:
                numero = float(valor)
            except (TypeError, ValueError):
                numero = float("nan")
            if not math.isfinite(numero) or numero < 0 or numero > MEDIDA_TOPE_MM:
                if estricto:
                    raise BusinessException(
                        "Las medidas van en milímetros, positivas y de hasta "
                        f"{fmt_mm(MEDIDA_TOPE_MM)} mm.")
                salida.append(None)
                continue
            salida.append(round(numero, 3) if numero > 0 else None)
        return salida

    async def _armar(self, tipo, id_material, id_calidad, id_formato, sistema, medidas,
                     descripcion, *, estricto: bool) -> dict:
        """Lo que sale de los datos de un insumo: la descripción (armada o la libre), qué
        falta para armarla y el prefijo del código. Lo comparten la vista previa, el
        alta y la edición: los tres tienen que decir lo mismo.

        `estricto`: en el alta y la edición, un material, calidad o formato que no existe
        (o una calidad de otro material) es un 422. En la vista previa se ignora: la
        pantalla la pide mientras se tipea, y un error ahí sería ruido.
        """
        tipo = self._tipo_valido(tipo)
        sistema = self._sistema_valido(sistema)
        medidas = self._medidas(medidas, estricto=estricto)

        material = await self.repo.material(id_material)
        if id_material is not None and material is None and estricto:
            raise BusinessException(f"No existe el material {id_material}.")
        calidad = await self.repo.calidad(id_calidad)
        if id_calidad is not None and calidad is None and estricto:
            raise BusinessException(f"No existe la calidad {id_calidad}.")
        if calidad is not None and (material is None or calidad.id_material != material.id):
            if estricto:
                raise BusinessException(
                    f"La calidad {calidad.nombre} no es de "
                    f"{material.nombre if material else 'ningún material elegido'}.")
            calidad = None
        formato = await self.repo.formato(id_formato)
        if id_formato is not None and formato is None and estricto:
            raise BusinessException(f"No existe el formato {id_formato}.")

        if tipo == "insumo":
            desc, faltan = descripcion_insumo(
                formato.nombre if formato else None,
                formato.etiquetas if formato else [],
                medidas, sistema,
                material.nombre if material else None,
                calidad.nombre if calidad else None,
            )
            if formato is not None:
                # Sólo las medidas que pide el formato: una sexta cifra que quedó en un
                # campo oculto de la pantalla no es un dato del insumo.
                cuantas = len(formato.etiquetas)
                medidas = medidas[:cuantas] + [None] * (MAX_MEDIDAS - cuantas)
        else:
            desc = texto_o_none(descripcion)
            faltan = [] if desc else ["Descripción"]

        prefijo = prefijo_codigo(
            tipo,
            material.letra_codigo if material else None,
            material.nombre if material else None,
            formato.iniciales if formato else None,
            desc,
        )
        return {
            "tipo": tipo, "sistema": sistema, "medidas": medidas, "material": material,
            "calidad": calidad, "formato": formato, "descripcion": desc, "faltan": faltan,
            "prefijo": prefijo,
        }

    async def _codigo_sugerido(self, prefijo: str | None) -> str | None:
        if not prefijo:
            return None
        return siguiente_codigo(prefijo, await self.repo.codigos_con_prefijo(prefijo))

    async def _duplicados(self, descripcion, excluir_id=None) -> list[dict]:
        if not descripcion:
            return []
        return [{"id": i, "codigo": (c or "").strip(), "descripcion": d}
                for i, c, d in await self.repo.activas_con_descripcion(descripcion, excluir_id)]

    async def previsualizar(self, dto: PrevisualizarIn):
        """Qué descripción y qué código saldrían, qué falta y si ya existe. No escribe."""
        armado = await self._armar(dto.tipo, dto.id_material, dto.id_calidad, dto.id_formato,
                                   dto.sistema_medida, dto.medidas, dto.descripcion,
                                   estricto=False)
        return ResponseDTO(status=True, errorDescription="", data={
            "descripcion": armado["descripcion"],
            "codigo_sugerido": await self._codigo_sugerido(armado["prefijo"]),
            "faltan": armado["faltan"],
            "duplicados": await self._duplicados(armado["descripcion"], dto.excluir_id),
        })

    @staticmethod
    def _descripcion_lista(armado: dict) -> str:
        """La descripción ya validada, o 422 diciendo qué falta."""
        if armado["faltan"]:
            if armado["tipo"] == "insumo":
                raise BusinessException(
                    "Para armar la descripción falta: " + ", ".join(armado["faltan"]) + ".")
            raise BusinessException("La descripción es obligatoria.")
        desc = armado["descripcion"]
        if len(desc) > LARGO_DESCRIPCION:
            raise BusinessException(
                f"La descripción puede tener hasta {LARGO_DESCRIPCION} caracteres "
                f"(tiene {len(desc)}).")
        return desc

    @staticmethod
    def _unidad(valor, actual: str | None = None) -> str:
        """La unidad del catálogo (UN, MTS, KG, LTS, HS). La que ya tenía el insumo se
        acepta aunque no esté en la lista: el viejo tiene «Un», «Mts», «SIN UNIDAD», y
        editar la ubicación no puede obligar a cambiarla."""
        unidad = limpio(valor).upper()
        if actual is not None and unidad == limpio(actual).upper():
            return actual
        if unidad not in UNIDADES:
            raise BusinessException(f"La unidad tiene que ser {', '.join(UNIDADES)}.")
        return unidad

    async def _proveedor_existente(self, id_proveedor):
        if id_proveedor is None:
            return None
        proveedor = await self.repo.proveedor(id_proveedor)
        if proveedor is None:
            raise BusinessException(f"No existe el proveedor {id_proveedor}.")
        return proveedor

    # ═══════════════════════════ insumos: alta ═══════════════════════════

    async def crear_insumo(self, dto: InsumoIn, usuario: dict | None = None, forzar: bool = False):
        """Alta de un insumo (origen 'spmm').

        Código: el que manden (422 si ya existe, normalizado) o el siguiente del prefijo.
        OJO: la unicidad la cuida este servicio y no la base (hay un duplicado heredado,
        50%004, que no deja poner un índice único). Dos altas del mismo prefijo en el
        mismo segundo podrían sacar el mismo número; en un taller con una persona
        cargando insumos no pasa, y si pasara, el segundo se ve en la lista.
        """
        armado = await self._armar(dto.tipo, dto.id_material, dto.id_calidad, dto.id_formato,
                                   dto.sistema_medida, dto.medidas, dto.descripcion,
                                   estricto=True)
        descripcion = self._descripcion_lista(armado)
        unidad = self._unidad(dto.unidad)
        unitario = _numero_valido(dto.unitario, "El precio", minimo=0, tope=PRECIO_TOPE)
        errores = stockMinimoValidator(dto.stock_minimo)
        if errores:
            raise BusinessException("; ".join(errores))
        await self._proveedor_existente(dto.id_proveedor)
        ubicacion = {c: _texto_con_largo(getattr(dto, c), LARGO_UBICACION, f"«{c}»")
                     for c in ("estante", "letra", "nro")}
        observaciones = _observaciones(dto.observaciones)

        if texto_o_none(dto.codigo):
            codigo = _norm_codigo(dto.codigo)
            if len(codigo) > LARGO_CODIGO:
                raise BusinessException(
                    f"El código puede tener hasta {LARGO_CODIGO} caracteres (como en el sistema "
                    "viejo, donde se hacen las facturas).")
            existente = await self.repo.pieza_con_codigo(codigo)
            if existente is not None:
                raise BusinessException(
                    f"Ya existe el código {_cod(existente)} ({existente.descripcion}).")
        else:
            codigo = await self._codigo_sugerido(armado["prefijo"])
            if not codigo:
                raise BusinessException(
                    "No se puede armar el código: falta el material y el formato "
                    "(o la descripción). Escribí uno o completá esos datos.")

        if not forzar:
            duplicados = await self._duplicados(descripcion)
            if duplicados:
                d = duplicados[0]
                raise ConfirmacionRequeridaException(
                    f"Ya existe {d['codigo']} – {d['descripcion']}. ¿Crear el insumo igual?")

        ahora = ahora_ar()
        _, nombre = nombre_de(usuario)
        medidas = armado["medidas"]
        pieza = Pieza(
            cod_pieza=codigo,
            descripcion=descripcion,
            tipo=armado["tipo"],
            id_material=armado["material"].id if armado["material"] else None,
            id_calidad=armado["calidad"].id if armado["calidad"] else None,
            id_formato=armado["formato"].id if armado["formato"] else None,
            sistema_medida=armado["sistema"],
            medida1=medidas[0], medida2=medidas[1], medida3=medidas[2],
            medida4=medidas[3], medida5=medidas[4],
            unidad=unidad,
            # Un precio en 0 no es un precio: el insumo queda «sin precio».
            unitario=unitario if unitario else None,
            fecha_ultimo_precio=ahora.date() if unitario else None,
            # Sin movimientos, el stock es 0 (no «desconocido»): el caché dice la suma.
            stockactual=0.0,
            id_proveedor=dto.id_proveedor,
            stock_minimo=dto.stock_minimo,
            observaciones=observaciones,
            inactivo=0,
            origen="spmm",
            creado_en=ahora,
            creado_por=nombre,
            **ubicacion,
        )
        async with self._escritura("guardar el insumo"):
            self.db.add(pieza)
            await self.db.flush()
            if unitario:
                self.db.add(PiezaPrecio(
                    id_pieza=pieza.id, fecha=ahora.date(), precio=round(unitario, 4),
                    origen="manual", id_proveedor=dto.id_proveedor, usuario=nombre,
                    creado_en=ahora,
                ))
                await self.db.flush()
        self.frase = f"dio de alta el insumo {codigo} – {descripcion}"
        return ResponseDTO(status=True, errorDescription="", data=await self._ficha_dict(pieza.id))

    # ═══════════════════════════ insumos: edición ═══════════════════════════

    async def editar_insumo(self, id_pieza: int, dto: InsumoCambiosIn, usuario: dict | None = None,
                            forzar: bool = False):
        """Edición parcial: sólo lo que viene. El código no se cambia (422), el precio
        tampoco (va por Precios, 422). Si el insumo es (o pasa a ser) tipo 'insumo' y
        cambia algo de lo que arma su descripción, la descripción se REGENERA: si no,
        diría otra barra que la que es. Si sólo se toca la ubicación o el mínimo, la
        descripción queda como está (la del viejo, con sus espacios, incluida).

        Si la descripción nueva ya la tiene otro insumo activo, 409 como en el alta
        (`forzar` para guardar igual)."""
        pieza = await self.repo.pieza(id_pieza)
        if pieza is None:
            raise NotFoundException(f"No existe el insumo {id_pieza}.")
        cambios = dto.model_dump(exclude_unset=True)

        if cambios.get("codigo") is not None and _norm_codigo(cambios["codigo"]) != _norm_codigo(pieza.cod_pieza):
            raise BusinessException(
                "El código no se cambia: lo usan las facturas del sistema viejo. "
                "Si está mal, dá de alta otro insumo y marcá este como inactivo.")
        if "unitario" in cambios and not _mismo_numero(cambios["unitario"], pieza.unitario):
            raise BusinessException(
                "El precio no se cambia desde acá: cargalo en la solapa Precios "
                "(queda en el historial con su fecha).")
        if "tipo" in cambios and cambios["tipo"] is None:
            raise BusinessException("El tipo es obligatorio.")

        tipo_nuevo = cambios.get("tipo", pieza.tipo)
        if "tipo" in cambios:
            self._tipo_valido(tipo_nuevo)
        resultado = {
            "id_material": cambios.get("id_material", pieza.id_material),
            "id_calidad": cambios.get("id_calidad", pieza.id_calidad),
            "id_formato": cambios.get("id_formato", pieza.id_formato),
            "sistema_medida": cambios.get("sistema_medida", pieza.sistema_medida) or "mm",
            "medidas": (self._medidas(cambios["medidas"], estricto=True)
                        if "medidas" in cambios else _medidas_de(pieza)),
        }
        datos_cambiaron = (
            any(c in cambios and resultado[c] != getattr(pieza, c)
                for c in ("id_material", "id_calidad", "id_formato", "sistema_medida"))
            or ("medidas" in cambios and any(
                not _mismo_numero(a, b) for a, b in zip(resultado["medidas"], _medidas_de(pieza))))
        )
        paso_a_insumo = tipo_nuevo == "insumo" and tipo_efectivo(pieza.tipo) != "insumo"

        nueva_descripcion = None
        armado = None
        if tipo_efectivo(tipo_nuevo) == "insumo" and (paso_a_insumo or datos_cambiaron):
            armado = await self._armar(
                "insumo", resultado["id_material"], resultado["id_calidad"],
                resultado["id_formato"], resultado["sistema_medida"], resultado["medidas"],
                None, estricto=True)
            nueva_descripcion = self._descripcion_lista(armado)
        elif any(c in cambios for c in ("id_material", "id_calidad", "id_formato",
                                         "sistema_medida", "medidas", "tipo")):
            # Tipo libre (o insumo sin cambios de datos): igual se validan las
            # referencias, para no guardar una calidad de otro material.
            armado = await self._armar(
                tipo_efectivo(tipo_nuevo), resultado["id_material"], resultado["id_calidad"],
                resultado["id_formato"], resultado["sistema_medida"], resultado["medidas"],
                cambios.get("descripcion", pieza.descripcion), estricto=True)

        if "descripcion" in cambios:
            if tipo_efectivo(tipo_nuevo) == "insumo":
                enviada = limpio(cambios["descripcion"]).upper()
                vigente = limpio(nueva_descripcion or pieza.descripcion).upper()
                if enviada and enviada != vigente:
                    raise BusinessException(
                        "La descripción de un insumo tipo «Insumo» se arma sola: cambiá el "
                        "formato, las medidas o el material, o pasalo a «Insumo c/ descripción».")
            else:
                desc = texto_o_none(cambios["descripcion"])
                if not desc:
                    raise BusinessException("La descripción es obligatoria.")
                if len(desc) > LARGO_DESCRIPCION:
                    raise BusinessException(
                        f"La descripción puede tener hasta {LARGO_DESCRIPCION} caracteres.")
                nueva_descripcion = desc

        # Todo lo que puede rebotar, antes de tocar la pieza.
        unidad = self._unidad(cambios["unidad"], pieza.unidad) if "unidad" in cambios else None
        if "stock_minimo" in cambios:
            errores = stockMinimoValidator(cambios["stock_minimo"])
            if errores:
                raise BusinessException("; ".join(errores))
        if "id_proveedor" in cambios:
            await self._proveedor_existente(cambios["id_proveedor"])
        ubicacion = {c: _texto_con_largo(cambios[c], LARGO_UBICACION, f"«{c}»")
                     for c in ("estante", "letra", "nro") if c in cambios}
        observaciones = (_observaciones(cambios["observaciones"])
                         if "observaciones" in cambios else None)

        # El mismo aviso de duplicado que el alta, si la edición deja un insumo ACTIVO
        # con la descripción de otro: porque la descripción cambió, o porque se reactiva
        # uno que se había dado de baja justamente por repetido.
        queda_activo = (not cambios["inactivo"]) if cambios.get("inactivo") is not None \
            else not pieza.inactivo
        reactivado = cambios.get("inactivo") is False and bool(pieza.inactivo)
        descripcion_final = nueva_descripcion or pieza.descripcion
        cambio_descripcion = (nueva_descripcion is not None
                              and norm_desc(nueva_descripcion) != norm_desc(pieza.descripcion))
        if not forzar and queda_activo and (cambio_descripcion or reactivado):
            duplicados = await self._duplicados(descripcion_final, excluir_id=pieza.id)
            if duplicados:
                d = duplicados[0]
                raise ConfirmacionRequeridaException(
                    f"Ya existe {d['codigo']} – {d['descripcion']}. ¿Guardar el cambio igual?")

        async with self._escritura("guardar el insumo"):
            if "tipo" in cambios:
                pieza.tipo = tipo_nuevo
            if armado is not None:
                pieza.id_material = armado["material"].id if armado["material"] else None
                pieza.id_calidad = armado["calidad"].id if armado["calidad"] else None
                pieza.id_formato = armado["formato"].id if armado["formato"] else None
                pieza.sistema_medida = armado["sistema"]
                (pieza.medida1, pieza.medida2, pieza.medida3,
                 pieza.medida4, pieza.medida5) = armado["medidas"]
            if nueva_descripcion is not None:
                pieza.descripcion = nueva_descripcion
            if unidad is not None:
                pieza.unidad = unidad
            if "stock_minimo" in cambios:
                pieza.stock_minimo = cambios["stock_minimo"]
                # El anti-duplicado del aviso de stock bajo se rearma también acá, como
                # en PiezaService.definirStockMinimo: si con el mínimo nuevo ya no está
                # abajo, el aviso vigente deja de estarlo.
                if not esta_bajo_minimo(pieza.stockactual, pieza.stock_minimo):
                    pieza.stock_bajo_avisado_en = None
            if "id_proveedor" in cambios:
                pieza.id_proveedor = cambios["id_proveedor"]
            for c, valor in ubicacion.items():
                setattr(pieza, c, valor)
            if "observaciones" in cambios:
                pieza.observaciones = observaciones
            if cambios.get("inactivo") is not None:
                pieza.inactivo = 1 if cambios["inactivo"] else 0
            pieza.modificado_en = ahora_ar()
            pieza.modificado_por = nombre_de(usuario)[1]
            await self.db.flush()
        self.frase = f"editó el insumo {_cod(pieza)} – {pieza.descripcion}"
        return ResponseDTO(status=True, errorDescription="", data=await self._ficha_dict(id_pieza))

    # ═══════════════════════════ insumos: baja ═══════════════════════════

    async def eliminar_insumo(self, id_pieza: int):
        """Borra un insumo SÓLO si nunca se usó. Si no, 422 con dónde se usó y qué hacer:
        marcarlo inactivo (deja de ofrecerse y no se pierde nada).

        Tampoco se borra uno que vino del viejo: el sync de altas (paso 7b) trae los
        códigos del viejo que no están en SPMM, así que volvería solo en la próxima
        pasada."""
        pieza = await self.repo.pieza(id_pieza)
        if pieza is None:
            raise NotFoundException(f"No existe el insumo {id_pieza}.")
        usos = await self.repo.usos(id_pieza)
        motivos = []
        if usos["lineas"]:
            motivos.append(f"se usó en {usos['ots']} OT")
        if usos["consumos"]:
            motivos.append(f"tiene {_cuantos(usos['consumos'], 'consumo cargado', 'consumos cargados')}")
        if usos["movimientos"]:
            motivos.append(f"tiene {_cuantos(usos['movimientos'], 'movimiento de stock', 'movimientos de stock')}")
        if usos["recortes"]:
            motivos.append(f"tiene {_cuantos(usos['recortes'], 'recorte', 'recortes')}")
        if usos["precios"]:
            motivos.append("tiene precios de facturas")
        if motivos:
            texto = (", ".join(motivos[:-1]) + " y " + motivos[-1]) if len(motivos) > 1 else motivos[0]
            raise BusinessException(
                f"No se puede borrar {_cod(pieza)}: {texto}. "
                "Marcalo como inactivo: deja de ofrecerse y no se pierde nada.")
        if pieza.origen == "legacy":
            raise BusinessException(
                f"{_cod(pieza)} viene del sistema viejo: si se borra, la próxima "
                "sincronización lo vuelve a traer. Marcalo como inactivo.")
        codigo, descripcion = _cod(pieza), pieza.descripcion
        async with self._escritura("borrar el insumo"):
            await self.repo.borrar_pieza(pieza)
        self.frase = f"borró el insumo {codigo} – {descripcion}"
        return ResponseDTO(status=True, errorDescription="", data={"id": id_pieza})

    # ═══════════════════════════ stock ═══════════════════════════

    async def _movimientos_dict(self, id_pieza: int) -> dict:
        pieza = await self.repo.pieza(id_pieza)
        if pieza is None:
            raise NotFoundException(f"No existe el insumo {id_pieza}.")
        s = (await stock.stock_de(self.db, [id_pieza])).get(id_pieza) or {
            "fisico": 0.0, "reservado": 0.0, "libre": 0.0}
        movimientos = []
        saldo = 0.0
        for m, numero in await self.repo.movimientos_de(id_pieza):
            cantidad = float(m.cantidad)
            if not m.anulado:
                saldo = round(saldo + cantidad, 3) + 0.0
            movimientos.append({
                "id": m.id,
                "fecha": _momento(m.fecha),
                "tipo": m.tipo,
                "comentario": m.comentario,
                # Como en la solapa del viejo: dos columnas, las dos positivas.
                "ingreso": round(cantidad, 3) if cantidad > 0 else None,
                "egreso": round(-cantidad, 3) if cantidad < 0 else None,
                # Un anulado no suma: su saldo es null (la pantalla lo tacha).
                "saldo": None if m.anulado else saldo,
                "id_orden_trabajo": m.id_orden_trabajo,
                "numero_ot": numero,
                "usuario": m.usuario,
                "anulado": _bool(m.anulado),
                "anulado_en": _momento(m.anulado_en),
                "anulado_por": m.anulado_por,
                "motivo_anulacion": m.motivo_anulacion,
                "origen": m.origen,
            })
        return {
            "fisico": s["fisico"],
            "reservado": s["reservado"],
            "libre": s["libre"],
            "stock_minimo": _num(pieza.stock_minimo),
            "movimientos": movimientos,
            "reservas": [
                {"id_linea": id_linea, "id_orden_trabajo": id_ot, "numero_ot": numero,
                 "cantidad_reservada": _num(cantidad)}
                for id_linea, id_ot, numero, cantidad in await self.repo.reservas_de(id_pieza)
            ],
        }

    async def movimientos(self, id_pieza: int):
        return ResponseDTO(status=True, errorDescription="", data=await self._movimientos_dict(id_pieza))

    async def registrar_movimiento(self, id_pieza: int, dto: MovimientoIn,
                                   usuario: dict | None = None, forzar: bool = False):
        """Ingreso, egreso o ajuste cargado a mano.

        El ajuste recibe lo que se CONTÓ (`saldo_nuevo`) y guarda la diferencia contra la
        suma de movimientos: así la suma sigue siendo el stock sin tener que saber cuál
        fue el último ajuste. Un egreso que deja el físico negativo avisa (409): el viejo
        dejaba descontar de más y a veces es lo que pasó de verdad (se usó antes de
        cargar el ingreso).
        """
        if dto.tipo not in _TIPOS_MOVIMIENTO_MANUAL:
            if dto.tipo == "retiro_ot":
                raise BusinessException(
                    "Un retiro para una OT no se carga a mano: se genera al marcar "
                    "Disponible una línea reservada de la OT.")
            raise BusinessException("El movimiento tiene que ser ingreso, egreso o ajuste.")
        pieza = await self.repo.pieza(id_pieza)
        if pieza is None:
            raise NotFoundException(f"No existe el insumo {id_pieza}.")

        id_ot = None
        if dto.numero_ot is not None:
            ot = await self.repo.ot_por_numero(dto.numero_ot)
            if ot is None:
                raise BusinessException(f"No existe la OT N° {dto.numero_ot} en SPMM.")
            id_ot = ot.id
        comentario = _observaciones(dto.comentario)

        if dto.tipo == "ajuste":
            saldo_nuevo = _numero_valido(dto.saldo_nuevo, "El stock contado", minimo=0,
                                         tope=CANTIDAD_TOPE)
            if saldo_nuevo is None:
                raise BusinessException("Para un ajuste hace falta el stock contado (saldo nuevo).")
            saldo = await stock.saldo_de_movimientos(self.db, id_pieza)
            cantidad = round(saldo_nuevo - saldo, 3)
            if cantidad == 0:
                raise BusinessException(
                    f"El stock ya es {fmt_mm(saldo)}: el ajuste no cambiaría nada.")
            if comentario is None:
                # Sin comentario, que el renglón diga igual qué se contó: la diferencia
                # sola («-3») no dice de dónde salió.
                comentario = f"Ajuste de inventario: {fmt_mm(saldo)} → {fmt_mm(saldo_nuevo)}"
        else:
            cantidad = _numero_valido(dto.cantidad, "La cantidad", minimo_excluido=0,
                                      tope=CANTIDAD_TOPE)
            if cantidad is None:
                raise BusinessException("La cantidad es obligatoria.")
            cantidad = round(cantidad, 3)
            if cantidad == 0:
                raise BusinessException("La cantidad tiene que ser mayor a 0.")
            if dto.tipo == "egreso":
                cantidad = -cantidad

        async with self._escritura("registrar el movimiento de stock"):
            await stock.registrar_movimiento(
                self.db, id_pieza, dto.tipo, cantidad, comentario=comentario, usuario=usuario,
                id_orden_trabajo=id_ot, avisar_negativo=not forzar,
            )
        que = {"ingreso": "un ingreso", "egreso": "un egreso", "ajuste": "un ajuste"}[dto.tipo]
        self.frase = (f"registró {que} de {fmt_mm(abs(cantidad))} {pieza.unidad or ''}".rstrip()
                      + f" del insumo {_cod(pieza)}")
        return ResponseDTO(status=True, errorDescription="", data=await self._movimientos_dict(id_pieza))

    async def anular_movimiento(self, id_movimiento: int, dto: AnularMovimientoIn | None = None,
                                usuario: dict | None = None):
        """Anula un movimiento (deja de sumar, queda a la vista) y devuelve el stock de su
        pieza recalculado. Los retiros de una OT no: se anulan desmarcando Disponible en
        la línea (el núcleo da el 422 con el número de OT)."""
        movimiento = await self.repo.movimiento(id_movimiento)
        if movimiento is None:
            raise NotFoundException(f"No existe el movimiento de stock {id_movimiento}.")
        id_pieza = movimiento.id_pieza
        async with self._escritura("anular el movimiento de stock"):
            await stock.anular_movimiento(self.db, movimiento, usuario,
                                          dto.motivo if dto else None)
        pieza = await self.repo.pieza(id_pieza)
        self.frase = (f"anuló un {movimiento.tipo} de {fmt_mm(abs(float(movimiento.cantidad)))} "
                      f"del insumo {_cod(pieza) if pieza else id_pieza}")
        return ResponseDTO(status=True, errorDescription="", data=await self._movimientos_dict(id_pieza))

    # ═══════════════════════════ recortes ═══════════════════════════

    async def recortes(self, id_pieza: int):
        if await self.repo.pieza(id_pieza) is None:
            raise NotFoundException(f"No existe el insumo {id_pieza}.")
        filas = await self.repo.recortes_de(id_pieza)
        return ResponseDTO(status=True, errorDescription="",
                           data=[_recorte_a_dict(r, numero) for r, numero in filas])

    @staticmethod
    def _cantidad_recorte(valor) -> int:
        if valor is None:
            return 1
        if isinstance(valor, bool) or int(valor) != valor or valor < 1 or valor > 10_000:
            raise BusinessException("La cantidad de recortes es un número entero de 1 en adelante.")
        return int(valor)

    async def crear_recorte(self, id_pieza: int, dto: RecorteIn, usuario: dict | None = None):
        pieza = await self.repo.pieza(id_pieza)
        if pieza is None:
            raise NotFoundException(f"No existe el insumo {id_pieza}.")
        largo = _numero_valido(dto.largo_mm, "El largo", minimo_excluido=0, tope=RECORTE_TOPE_MM)
        if largo is None:
            raise BusinessException("El largo del recorte es obligatorio (en mm).")
        ancho = _numero_valido(dto.ancho_mm, "El ancho", minimo_excluido=0, tope=RECORTE_TOPE_MM)
        recorte = PiezaRecorte(
            id_pieza=id_pieza, largo_mm=round(largo, 1),
            ancho_mm=round(ancho, 1) if ancho is not None else None,
            cantidad=self._cantidad_recorte(dto.cantidad),
            observaciones=_observaciones(dto.observaciones),
            estado="disponible", origen="spmm",
            creado_en=ahora_ar(), creado_por=nombre_de(usuario)[1],
        )
        async with self._escritura("guardar el recorte"):
            self.db.add(recorte)
            await self.db.flush()
        self.frase = (f"cargó un recorte de {fmt_mm(recorte.largo_mm)} mm"
                      f" del insumo {_cod(pieza)}")
        return ResponseDTO(status=True, errorDescription="", data=_recorte_a_dict(recorte, None))

    async def editar_recorte(self, id_recorte: int, dto: RecorteCambiosIn, usuario: dict | None = None):
        """Edición parcial de un recorte.

        Pasar a 'usado' deja quién y cuándo (y la OT, si se dice). `numero_ot_uso` con un
        número sin decir el estado es «lo usé en esta OT»: pasa a usado. Volver a
        'disponible' (o descartarlo) limpia el uso: un recorte disponible no está en
        ninguna OT.
        """
        recorte = await self.repo.recorte(id_recorte)
        if recorte is None:
            raise NotFoundException(f"No existe el recorte {id_recorte}.")
        cambios = dto.model_dump(exclude_unset=True)

        if "largo_mm" in cambios:
            largo = _numero_valido(cambios["largo_mm"], "El largo", minimo_excluido=0,
                                   tope=RECORTE_TOPE_MM)
            if largo is None and not recorte.texto_original:
                raise BusinessException("El largo del recorte es obligatorio (en mm).")
            cambios["largo_mm"] = round(largo, 1) if largo is not None else None
        if "ancho_mm" in cambios:
            ancho = _numero_valido(cambios["ancho_mm"], "El ancho", minimo_excluido=0,
                                   tope=RECORTE_TOPE_MM)
            cambios["ancho_mm"] = round(ancho, 1) if ancho is not None else None
        if "cantidad" in cambios:
            if cambios["cantidad"] is None:
                raise BusinessException("La cantidad de recortes es obligatoria.")
            cambios["cantidad"] = self._cantidad_recorte(cambios["cantidad"])
        estado = cambios.get("estado") or recorte.estado
        if "estado" in cambios and cambios["estado"] not in ESTADOS_RECORTE:
            raise BusinessException(f"El estado tiene que ser {', '.join(ESTADOS_RECORTE)}.")

        id_ot_uso = recorte.id_orden_trabajo_uso
        if "numero_ot_uso" in cambios:
            if cambios["numero_ot_uso"] is None:
                id_ot_uso = None
            else:
                ot = await self.repo.ot_por_numero(cambios["numero_ot_uso"])
                if ot is None:
                    raise BusinessException(f"No existe la OT N° {cambios['numero_ot_uso']} en SPMM.")
                id_ot_uso = ot.id
                if "estado" not in cambios:
                    estado = "usado"

        async with self._escritura("guardar el recorte"):
            for campo in ("largo_mm", "ancho_mm", "cantidad"):
                if campo in cambios:
                    setattr(recorte, campo, cambios[campo])
            if "observaciones" in cambios:
                recorte.observaciones = _observaciones(cambios["observaciones"])
            if estado == "usado":
                if recorte.estado != "usado":
                    recorte.usado_en = ahora_ar()
                    recorte.usado_por = nombre_de(usuario)[1]
                recorte.id_orden_trabajo_uso = id_ot_uso
            else:
                recorte.usado_en = None
                recorte.usado_por = None
                recorte.id_orden_trabajo_uso = None
            recorte.estado = estado
            await self.db.flush()

        numero = await self.repo.numero_de_ot(recorte.id_orden_trabajo_uso)
        pieza = await self.repo.pieza(recorte.id_pieza)
        self.frase = (f"editó un recorte del insumo {_cod(pieza) if pieza else recorte.id_pieza}"
                      + (f" (usado en la OT N° {numero})" if estado == "usado" and numero else
                         f" ({estado})" if "estado" in cambios or "numero_ot_uso" in cambios else ""))
        return ResponseDTO(status=True, errorDescription="", data=_recorte_a_dict(recorte, numero))

    async def eliminar_recorte(self, id_recorte: int):
        recorte = await self.repo.recorte(id_recorte)
        if recorte is None:
            raise NotFoundException(f"No existe el recorte {id_recorte}.")
        pieza = await self.repo.pieza(recorte.id_pieza)
        largo = recorte.largo_mm
        async with self._escritura("borrar el recorte"):
            await self.db.delete(recorte)
            await self.db.flush()
        self.frase = (f"borró un recorte{f' de {fmt_mm(largo)} mm' if largo else ''}"
                      f" del insumo {_cod(pieza) if pieza else ''}".rstrip())
        return ResponseDTO(status=True, errorDescription="", data={"id": id_recorte})

    # ═══════════════════════════ OT donde se usó ═══════════════════════════

    async def ots(self, id_pieza: int, limit: int = 200):
        if await self.repo.pieza(id_pieza) is None:
            raise NotFoundException(f"No existe el insumo {id_pieza}.")
        limit = max(1, min(int(limit or 200), LIMITE_OTS_MAXIMO))
        return ResponseDTO(status=True, errorDescription="", data=[
            {
                "id_linea": f.id_linea,
                "id_orden_trabajo": f.id_orden_trabajo,
                "numero_ot": f.id_otvieja,
                "fecha_ot": _dia(f.fecha_orden),
                "cliente": f.cliente,
                "articulo": f.articulo,
                "cantidad": _num(f.cantidad),
                "unidad": f.unidad,
                "pedido": _bool(f.pedido),
                "disponible": _bool(f.disponible),
                # Sin la reserva, una línea apartada del stock se leería «Falta pedir».
                "reserva": _bool(f.reserva),
                "cantidad_reservada": _num(f.cantidad_reservada),
                # NULL es «se usa»: las líneas de antes de la migración cuentan.
                "usado": f.usado is None or _bool(f.usado),
                "finalizada": f.finalizadototal == 1,
            }
            for f in await self.repo.ots_de(id_pieza, limit)
        ])

    # ═══════════════════════════ precios ═══════════════════════════

    async def _precios_lista(self, id_pieza: int) -> list[dict]:
        return [
            {"id": p.id, "fecha": _dia(p.fecha), "precio": _num(p.precio), "origen": p.origen,
             "proveedor": proveedor, "usuario": p.usuario}
            for p, proveedor in await self.repo.precios_de(id_pieza)
        ]

    async def precios(self, id_pieza: int):
        if await self.repo.pieza(id_pieza) is None:
            raise NotFoundException(f"No existe el insumo {id_pieza}.")
        return ResponseDTO(status=True, errorDescription="", data=await self._precios_lista(id_pieza))

    async def cargar_precio(self, id_pieza: int, dto: PrecioIn, usuario: dict | None = None):
        """Un precio cargado a mano. Queda en el historial siempre; pasa a ser el precio
        vigente (`unitario` + `fecha_ultimo_precio`) sólo si es igual o más nuevo que el
        vigente: cargar hoy un precio de marzo que faltaba no pisa el de agosto."""
        pieza = await self.repo.pieza(id_pieza)
        if pieza is None:
            raise NotFoundException(f"No existe el insumo {id_pieza}.")
        precio = _numero_valido(dto.precio, "El precio", minimo_excluido=0, tope=PRECIO_TOPE)
        ahora = ahora_ar()
        fecha: date = dto.fecha or ahora.date()
        if fecha > ahora.date():
            raise BusinessException(
                "La fecha del precio no puede ser futura: quedaría como vigente hasta ese día.")
        await self._proveedor_existente(dto.id_proveedor)
        _, nombre = nombre_de(usuario)
        vigente = pieza.fecha_ultimo_precio is None or fecha >= pieza.fecha_ultimo_precio
        async with self._escritura("guardar el precio"):
            self.db.add(PiezaPrecio(
                id_pieza=id_pieza, fecha=fecha, precio=round(precio, 4), origen="manual",
                id_proveedor=dto.id_proveedor, usuario=nombre, creado_en=ahora,
            ))
            if vigente:
                pieza.unitario = round(precio, 4)
                pieza.fecha_ultimo_precio = fecha
                pieza.modificado_en = ahora
                pieza.modificado_por = nombre
            await self.db.flush()
        self.frase = (f"cargó el precio {fmt_mm(precio)} ({fecha.strftime('%d/%m/%Y')}) "
                      f"del insumo {_cod(pieza)}")
        return ResponseDTO(status=True, errorDescription="", data=await self._precios_lista(id_pieza))
