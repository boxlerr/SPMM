/**
 * Materia prima (sección nueva del 24/09/2026): los tipos de la API y lo que comparten
 * las pantallas.
 *
 * POR QUÉ EXISTE
 *
 * En la reunión del 23/09 con Lucas se decidió que la gestión de materias primas pasa
 * a SPMM: el catálogo de insumos, las materias primas de cada OT, la pantalla de
 * compras por semana de Maxi y la cañera. El sistema viejo queda sólo para facturas y
 * remitos. Son cuatro pantallas que escriben cuatro agentes a la vez (Pendientes,
 * Insumos, Cañera y la solapa de la OT), y las cuatro hablan con la misma API: si cada
 * una se escribía sus tipos y su `fetch`, a la semana había cuatro ideas distintas de
 * qué es una «línea» y cuatro maneras de tratar el 409.
 *
 * Acá vive, UNA vez:
 *  · los tipos de todo lo que manda y recibe `/materia-prima/...` (el contrato está en
 *    la especificación de la sección; si el backend cambia un campo, se cambia acá);
 *  · el `fetch` de la casa con su respuesta ya leída: ResponseDTO, el motivo del error,
 *    el 409 de «avisar, no bloquear» con su `?forzar=true` y el backend que todavía no
 *    tiene la sección (se deploya a mano, ver `sinServidor`);
 *  · el formateo como lo escribe el taller (coma decimal, dd/mm/aaaa) y las fechas sin
 *    zona;
 *  · las pulgadas: pasarlas a milímetros para mandarlas, y el espejo para mostrarlas;
 *  · la cañera (columnas A..O, filas 1..9) y los rótulos.
 *
 * Lo que NO vive acá, a propósito: la lógica de negocio. La descripción armada de un
 * insumo, el código sugerido, el stock libre, qué línea «falta» y el estado del material
 * los decide el backend y la pantalla los muestra. Dos implementaciones de la misma
 * regla terminan opinando distinto (ver lib/materialOT.ts, que nació de eso), y en una
 * factura del sistema viejo un código mal armado no se arregla después.
 *
 * Nada de React acá: es una biblioteca de funciones puras más el `fetch`.
 */

import { decodeJwt } from "@/lib/jwt";
import { parseApiError } from "@/lib/utils";
import type { EstadoMaterial } from "@/lib/materialOT";

// El import de arriba es sólo para que el tipo quede atado a un único lugar; se
// re-exporta para que las pantallas no tengan que saber de dónde sale.
export type { EstadoMaterial };

// ═══════════════════════════ tipos básicos ═══════════════════════════

/** Una fecha sola, tal como la manda el backend: "YYYY-MM-DD", sin hora ni zona. */
export type FechaISO = string;
/** Un momento, tal como lo manda el backend: "YYYY-MM-DDTHH:MM:SS", hora de Argentina y SIN zona. */
export type MomentoISO = string;

/**
 * Qué clase de insumo es. Viene del campo `insumo` del sistema viejo (0 → insumo,
 * 2 → insumo_desc, 1 → consumible).
 *
 *  · insumo      → material estructurado: formato + medidas + material + calidad, y la
 *                  descripción SE ARMA sola (la arma el backend: `previsualizar`).
 *  · insumo_desc → material con descripción libre (lo que no encaja en un formato).
 *  · consumible  → lo que se gasta y no es materia prima de la pieza (discos, electrodos).
 *
 * `null` = fila anterior a la importación, sin clasificar: se trata como insumo_desc.
 */
export type TipoInsumo = "insumo" | "insumo_desc" | "consumible";

/** En qué se cargaron las medidas. En la base van SIEMPRE en milímetros; esto sólo dice cómo se escriben. */
export type SistemaMedida = "mm" | "pulgada";

/** Los movimientos de la solapa Stock. `retiro_ot` lo genera solo el pasar a «Disponible» una línea reservada. */
export type TipoMovimiento = "ingreso" | "egreso" | "ajuste" | "retiro_ot";

/** Los movimientos que se cargan a mano (el retiro para una OT no: ver `TipoMovimiento`). */
export type TipoMovimientoManual = "ingreso" | "egreso" | "ajuste";

/** De dónde salió un precio: la factura del sistema viejo, una carga a mano o la importación. */
export type OrigenPrecio = "compra" | "manual" | "import";

export type EstadoRecorte = "disponible" | "usado" | "descartado";

/** De dónde vino una fila: el sistema viejo, SPMM, o (líneas de OT) «Traer historial». */
export type Origen = "legacy" | "spmm" | "historial";

/** El filtro de radio de Pendientes. */
export type FiltroPendientes = "pendientes" | "parciales" | "todas";

/** La respuesta paginada de la casa (la misma forma que `/piezas`). */
export interface Paginado<T> {
    data: T[];
    total_count: number;
    page: number;
    size: number;
    total_pages: number;
}

// ═══════════════════════════ catálogos ═══════════════════════════

export interface Calidad {
    id: number;
    nombre: string;
}

export interface Material {
    id: number;
    nombre: string;
    /** La letra del código (ACERO → A, BRONCE → B). Null = la primera del nombre. */
    letra_codigo: string | null;
    calidades: Calidad[];
}

export interface Formato {
    id: number;
    nombre: string;
    /** Las iniciales del código (BARRA CUADRADO → BC). Se repiten a propósito entre formatos, como en el viejo. */
    iniciales: string;
    /** Qué es cada medida, en orden («Ø exterior», «Espesor»). Cuántas hay = cuántas medidas pide el formato. */
    etiquetas: string[];
}

export interface OpcionTipo {
    valor: TipoInsumo;
    nombre: string;
}

/** `GET /materia-prima/catalogos`: todo lo que llena los desplegables, en un solo pedido. */
export interface Catalogos {
    materiales: Material[];
    formatos: Formato[];
    /** Unidades de la pieza, como en el viejo: "UN", "MTS", "KG", "LTS", "HS". */
    unidades: string[];
    /** Unidades de una línea de OT: "Un", "Mts", "Kg", "Lts". */
    unidades_linea: string[];
    tipos: OpcionTipo[];
    /** Lo que se come la sierra en cada corte. Lo manda el backend para no tenerlo escrito en dos lados. */
    espesor_sierra_mm: number;
    /**
     * Quién es el DUEÑO de las materias primas (ver `DuenoMP`). Un backend de antes de la
     * prueba piloto no lo manda: el almacén de catálogos (InsumoCatalogos.ts) lo
     * normaliza a «spmm», que es como andaba ese backend.
     */
    dueno: DuenoMP;
    /** El cartel que explica el modo espejo, escrito por el backend. Null = el texto de la pantalla. */
    aviso_dueno: string | null;
}

/**
 * Dónde se CARGAN las materias primas.
 *
 *  · `spmm`: acá (la sección Materia prima y la solapa de la OT editables). Es el
 *    destino, decidido con Lucas el 23/09.
 *  · `integral`: en el sistema viejo («Sistema Integral»). Es la prueba piloto de la
 *    semana del 28/09, con los dos sistemas en paralelo: Carolina y Maxi siguen
 *    cargando allá, el sync lo trae con sus marcas reales y SPMM es un ESPEJO de sólo
 *    lectura. Si acá se pudiera escribir, el sync lo pisaría en la pasada siguiente (o
 *    peor: habría dos verdades hasta entonces).
 *
 * Lo decide el backend y viaja en `GET /materia-prima/catalogos`: cambiar de uno a
 * otro no pide un deploy del front.
 */
export type DuenoMP = "integral" | "spmm";

/**
 * El cartel del modo espejo cuando el backend no manda el suyo (`aviso_dueno`, que es el
 * que vale: lo escribe quien sabe cada cuánto corre el sync).
 *
 * Tiene que decir cada cuánto llega lo del Integral: el sync lo trae cada 10 minutos
 * (antes del 25/09 eran 30), y un «se actualizan solas» a secas se lee como «al instante». Carolina carga allá, mira
 * acá, no lo ve y lo carga de nuevo; o Maxi compra algo que ya se había pedido.
 */
export const AVISO_ESPEJO =
    "Prueba piloto: las materias primas se siguen cargando en el Sistema Integral. " +
    "SPMM las trae de allá cada 10 minutos, con sus marcas reales: lo que se carga allá " +
    "puede tardar hasta 10 minutos en verse acá.";

/** `POST /materia-prima/materiales`. */
export interface MaterialIn {
    nombre: string;
    letra_codigo?: string | null;
}

/** `POST /materia-prima/materiales/{id}/calidades`. */
export interface CalidadIn {
    nombre: string;
}

export interface Proveedor {
    id: number;
    razon_social: string;
    fantasia: string | null;
    cuit: string | null;
    telefono: string | null;
    mail: string | null;
    inactivo: boolean;
}

/** `POST /materia-prima/proveedores` (alta rápida: alcanza con la razón social). */
export interface ProveedorIn {
    razon_social: string;
    fantasia?: string | null;
    cuit?: string | null;
    telefono?: string | null;
    mail?: string | null;
}

/** Lo que eligió la persona en el selector de proveedor: uno del catálogo o, si se permite, un texto suelto. */
export interface ProveedorElegido {
    /** Null = texto libre, o nada. */
    id: number | null;
    /** El nombre que se muestra (la razón social, o el texto que escribió). Null = nada. */
    nombre: string | null;
}

// ═══════════════════════════ insumos ═══════════════════════════

/**
 * Una fila de la lista de insumos (`GET /materia-prima/insumos`).
 *
 * El stock lo calcula el backend: `stock` es el físico (la suma de los movimientos),
 * `reservado` lo que tienen apartado las OT y `libre` la resta. Una pieza sin
 * movimientos viene con 0, no con null.
 */
export interface InsumoFila {
    id: number;
    codigo: string;
    descripcion: string;
    tipo: TipoInsumo | null;
    material: string | null;
    calidad: string | null;
    formato: string | null;
    unidad: string | null;
    /** El último precio de compra. */
    unitario: number | null;
    fecha_ultimo_precio: FechaISO | null;
    stock: number;
    reservado: number;
    libre: number;
    /** El «Pto. crítico» del viejo (RF-14). Null = no se vigila. */
    stock_minimo: number | null;
    bajo_minimo: boolean;
    estante: string | null;
    letra: string | null;
    nro: string | null;
    /** El nombre del proveedor preferido o, si no hay, el texto que traía el sistema viejo. */
    proveedor: string | null;
    inactivo: boolean;
    recortes_disponibles: number;
}

/** La ficha entera de un insumo (`GET /materia-prima/insumos/{id}`). */
export interface InsumoFicha extends InsumoFila {
    id_material: number | null;
    id_calidad: number | null;
    id_formato: number | null;
    sistema_medida: SistemaMedida;
    /** Siempre cinco, en milímetros; las que el formato no pide vienen en null. */
    medidas: (number | null)[];
    id_proveedor: number | null;
    proveedor_preferido: { id: number; razon_social: string } | null;
    /** El texto de proveedor que traía el viejo. Sólo lectura: se muestra en gris debajo del preferido. */
    proveedor_heredado: string | null;
    observaciones: string | null;
    origen: Origen | null;
    creado_en: MomentoISO | null;
    creado_por: string | null;
    modificado_en: MomentoISO | null;
    modificado_por: string | null;
    /** En cuántas OT se usó (decide si se puede borrar o sólo marcar inactivo). */
    usos_en_ot: number;
}

/**
 * Alta de un insumo (`POST /materia-prima/insumos`).
 *
 * `codigo` es opcional: sin él, el backend arma el siguiente con la regla del viejo
 * (prefijo + número). Las `medidas` van en MILÍMETROS aunque se hayan escrito en
 * pulgadas (`pulgadasAMm`). `unitario` > 0 deja además la primera fila de precios.
 */
export interface InsumoIn {
    tipo: TipoInsumo;
    codigo?: string | null;
    descripcion?: string | null;
    id_material?: number | null;
    id_calidad?: number | null;
    id_formato?: number | null;
    sistema_medida?: SistemaMedida;
    medidas?: (number | null)[];
    unidad: string;
    unitario?: number | null;
    id_proveedor?: number | null;
    stock_minimo?: number | null;
    estante?: string | null;
    letra?: string | null;
    nro?: string | null;
    observaciones?: string | null;
}

/**
 * Edición de un insumo (`PUT /materia-prima/insumos/{id}`): lo mismo que el alta, todo
 * opcional, más `inactivo`. Sin `codigo` (no se edita: lo usan las facturas del viejo)
 * ni `unitario` (va por la solapa Precios): el backend los rechaza si vienen distintos.
 */
export type InsumoCambios = Partial<Omit<InsumoIn, "codigo" | "unitario">> & { inactivo?: boolean };

/** `POST /materia-prima/insumos/previsualizar`: no escribe nada. */
export interface PrevisualizarIn {
    tipo: TipoInsumo;
    id_material?: number | null;
    id_calidad?: number | null;
    id_formato?: number | null;
    sistema_medida: SistemaMedida;
    /** Cinco, en milímetros; null las vacías. */
    medidas: (number | null)[];
    descripcion?: string | null;
    /** En la edición, el propio insumo: que no se avise a sí mismo como duplicado. */
    excluir_id?: number | null;
}

export interface InsumoResumido {
    id: number;
    codigo: string;
    descripcion: string;
}

/** Lo que contesta `previsualizar`: la descripción armada, el código que tocaría y qué falta. */
export interface Previsualizacion {
    /** Null si todavía falta algo para armarla (ver `faltan`). */
    descripcion: string | null;
    codigo_sugerido: string | null;
    /** Qué datos faltan para armar la descripción («Espesor», «Material»). */
    faltan: string[];
    /** Insumos activos con la misma descripción: el aviso de duplicado antes de guardar. */
    duplicados: InsumoResumido[];
}

// ─────────────── stock (solapa Stock de la ficha) ───────────────

export interface Movimiento {
    id: number;
    fecha: MomentoISO;
    tipo: TipoMovimiento;
    comentario: string | null;
    /** Positivo, o null si el movimiento es de salida. */
    ingreso: number | null;
    /** Positivo (el backend ya le sacó el signo), o null si es de entrada. */
    egreso: number | null;
    /** El saldo acumulado hasta este movimiento, sin contar los anulados. Null en un anulado. */
    saldo: number | null;
    id_orden_trabajo: number | null;
    numero_ot: number | null;
    usuario: string | null;
    anulado: boolean;
    motivo_anulacion: string | null;
    origen: Origen | null;
}

/** Una OT que tiene stock reservado de esta pieza (todavía no lo retiró). */
export interface Reserva {
    id_linea: number;
    id_orden_trabajo: number;
    numero_ot: number | null;
    cantidad_reservada: number;
}

/** `GET /materia-prima/insumos/{id}/movimientos` — y lo que devuelven cargar y anular, ya recalculado. */
export interface Movimientos {
    fisico: number;
    reservado: number;
    libre: number;
    stock_minimo: number | null;
    /** Del más viejo al más nuevo. */
    movimientos: Movimiento[];
    reservas: Reserva[];
}

/**
 * `POST /materia-prima/insumos/{id}/movimientos`.
 *
 * Ingreso y egreso llevan `cantidad` > 0 (el backend guarda el egreso en negativo); el
 * ajuste lleva `saldo_nuevo` y el backend guarda la diferencia.
 */
export interface MovimientoIn {
    tipo: TipoMovimientoManual;
    cantidad?: number | null;
    saldo_nuevo?: number | null;
    comentario?: string | null;
    numero_ot?: number | null;
}

/** `PUT /materia-prima/movimientos/{id}/anular`. */
export interface AnularIn {
    motivo?: string | null;
}

// ─────────────── recortes ───────────────

export interface Recorte {
    id: number;
    largo_mm: number | null;
    ancho_mm: number | null;
    cantidad: number;
    observaciones: string | null;
    /** Lo que decía el sistema viejo («1525x3», «3440 (pintado amarillo 1212)»). */
    texto_original: string | null;
    estado: EstadoRecorte;
    id_orden_trabajo_uso: number | null;
    numero_ot_uso: number | null;
    creado_en: MomentoISO | null;
    creado_por: string | null;
    usado_en: MomentoISO | null;
    usado_por: string | null;
}

/** `POST /materia-prima/insumos/{id}/recortes`. */
export interface RecorteIn {
    largo_mm: number;
    ancho_mm?: number | null;
    cantidad?: number;
    observaciones?: string | null;
}

/** `PUT /materia-prima/recortes/{id}`. `numero_ot_uso` es el número que ve la gente; el backend lo pasa a id. */
export interface RecorteCambios {
    largo_mm?: number | null;
    ancho_mm?: number | null;
    cantidad?: number;
    observaciones?: string | null;
    estado?: EstadoRecorte;
    numero_ot_uso?: number | null;
}

// ─────────────── OT donde se usó y precios ───────────────

/** `GET /materia-prima/insumos/{id}/ots`: una OT donde se usó el insumo (las más nuevas primero). */
export interface UsoEnOT {
    id_linea: number;
    id_orden_trabajo: number;
    numero_ot: number | null;
    fecha_ot: FechaISO | null;
    cliente: string | null;
    articulo: string | null;
    cantidad: number;
    unidad: string | null;
    pedido: boolean;
    disponible: boolean;
    usado: boolean;
    finalizada: boolean;
    /** Apartada del stock (sin esto, una línea reservada se leería «Falta pedir»). */
    reserva: boolean;
    /** Cuánto se reservó. Null = reservada sin cantidad (las heredadas del viejo). */
    cantidad_reservada: number | null;
}

/** `GET /materia-prima/insumos/{id}/precios` (el más nuevo primero). */
export interface Precio {
    id: number;
    fecha: FechaISO;
    precio: number;
    origen: OrigenPrecio;
    proveedor: string | null;
    usuario: string | null;
}

/** `POST /materia-prima/insumos/{id}/precios`. Sin fecha = hoy. */
export interface PrecioIn {
    precio: number;
    fecha?: FechaISO | null;
    id_proveedor?: number | null;
}

// ═══════════════════════════ materias primas de la OT ═══════════════════════════

/** Un corte de una línea (botón «Cortes»): cuántas piezas de qué largo. */
export interface Corte {
    id: number;
    cantidad: number;
    largo_mm: number | null;
    ancho_mm: number | null;
    /** Lo que decía el viejo cuando no se pudo leer como medida («80x200x20mm»). */
    texto_original: string | null;
}

/** Lo que se manda de un corte (`PUT /materia-prima/lineas/{id}/cortes` y el alta de líneas). */
export interface CorteIn {
    cantidad: number;
    largo_mm?: number | null;
    ancho_mm?: number | null;
}

/**
 * Una materia prima de una OT.
 *
 * Las marcas son las del viejo: `usado` («Utilizado»: 0 = no se usa o está a
 * confirmar, no entra en Pendientes), `pedido`, `reserva` (con cuánto se apartó del
 * stock), `disponible` y `en_produccion` («PRODUC»). Quién y cuándo marcó cada una lo
 * estampa el backend con el usuario del token.
 */
export interface Linea {
    id: number;
    id_orden_trabajo: number;
    orden: number | null;
    id_pieza: number;
    codigo: string;
    /** La de la línea (congelada al cargarla) o, si no tiene, la de la pieza. */
    descripcion: string;
    /** El tipo de la pieza: si es «insumo», la descripción no se edita en la línea. */
    tipo_pieza: TipoInsumo | null;
    cantidad: number;
    unidad: string | null;
    id_proveedor: number | null;
    /** El proveedor de ESTA compra (nombre del catálogo o texto suelto). */
    proveedor: string | null;
    observaciones: string | null;
    usado: boolean;
    pedido: boolean;
    pedido_en: MomentoISO | null;
    pedido_por: string | null;
    reserva: boolean;
    cantidad_reservada: number | null;
    disponible: boolean;
    disponible_en: MomentoISO | null;
    disponible_por: string | null;
    en_produccion: boolean;
    /** «Fecha prov.»: la que prometió el proveedor. */
    fecha_proveedor: FechaISO | null;
    /** «F. entrega»: cuándo llegó o quedó disponible. */
    fecha_entrega: FechaISO | null;
    /** El precio de la pieza hoy (no se congela en la línea). */
    precio: number | null;
    /** Lo que se registró como consumido (RF-15), sin los anulados. */
    consumido: number;
    cortes: Corte[];
    /**
     * Cuántos metros harían falta según los cortes (con el espesor de la sierra),
     * redondeado para arriba. Null si algún corte no tiene largo. No cambia la cantidad
     * solo: la pantalla ofrece «Usar sugerencia».
     */
    sugerido_m: number | null;
    stock_libre: number;
    recortes_disponibles: number;
    origen: Origen | null;
    modificado_en: MomentoISO | null;
    modificado_por: string | null;
}

/** `GET /materia-prima/ot/{id}/lineas`: la solapa Materias primas de una OT. */
export interface LineasDeOT {
    id_orden_trabajo: number;
    /** El número que ve la gente (id_otvieja). */
    numero_ot: number | null;
    no_lleva_materia_prima: boolean;
    /**
     * Algún proceso de la OT ya arrancó (en curso, completado o con inicio real). La
     * pantalla muestra «Prod» tildado y bloqueado: se marca solo.
     */
    ot_en_curso: boolean;
    estado_material: EstadoMaterial;
    /** Los casilleros de la cañera que ocupa la OT («E4»). */
    celdas: string[];
    lineas: Linea[];
}

/** Una línea de la vista previa de «Traer historial», ya multiplicada por el factor. */
export interface LineaHistorial {
    id_pieza: number;
    codigo: string;
    descripcion: string;
    cantidad: number;
    unidad: string | null;
    id_proveedor: number | null;
    proveedor: string | null;
    cortes: CorteIn[];
}

/** `GET /materia-prima/ot/{id}/historial`: de qué OT se copiaría y con qué factor. */
export interface HistorialOT {
    /** La OT más reciente del mismo artículo con materias primas. Null = no hay de dónde copiar. */
    origen: { id: number; numero_ot: number | null; fecha_ot: FechaISO | null; unidades: number | null } | null;
    /** Unidades de esta OT / unidades de la de origen (1 si falta alguna). */
    factor: number;
    lineas: LineaHistorial[];
}

/** Alta de una línea (`POST /materia-prima/ot/{id}/lineas`, y cada una del lote). */
export interface LineaIn {
    id_pieza: number;
    cantidad: number;
    /** Sin unidad, el backend usa la de la pieza (UN → Un, MTS → Mts…). */
    unidad?: string | null;
    /** Sólo si la pieza no es tipo «insumo»; sin ella se congela la de la pieza. */
    descripcion?: string | null;
    observaciones?: string | null;
    id_proveedor?: number | null;
    proveedor?: string | null;
    cortes?: CorteIn[];
    origen?: Origen | null;
}

/** `POST /materia-prima/ot/{id}/lineas/lote`: todas o ninguna. */
export interface LoteLineasIn {
    lineas: LineaIn[];
}

/**
 * Una línea de una OT que TODAVÍA NO EXISTE (el alta de la OT no volvió con su id).
 *
 * Es un `LineaIn` —así el modal la manda tal cual con el lote apenas tiene el id— más
 * lo que hace falta para dibujarla. Lo de más no se manda: ver `aLineaIn`.
 */
export interface LineaLocal extends LineaIn {
    /** La llave de React: la línea no tiene id todavía. */
    clave: string;
    codigo: string;
    /** Lo que se muestra: la descripción de la línea o, si no tiene, la de la pieza. */
    descripcion_mostrada: string;
    tipo_pieza: TipoInsumo | null;
    /** El precio de la pieza al elegirla, para el total estimado. */
    precio: number | null;
}

/** Lo que se manda de una línea local: sin lo que es sólo para dibujarla. */
export function aLineaIn(l: LineaLocal): LineaIn {
    return {
        id_pieza: l.id_pieza,
        cantidad: l.cantidad,
        unidad: l.unidad ?? null,
        descripcion: l.descripcion ?? null,
        observaciones: l.observaciones ?? null,
        id_proveedor: l.id_proveedor ?? null,
        proveedor: l.proveedor ?? null,
        cortes: l.cortes ?? [],
        origen: l.origen ?? null,
    };
}

/** `PUT /materia-prima/ot/{id}/no-lleva`. */
export interface NoLlevaIn {
    no_lleva: boolean;
}

export interface NoLleva {
    no_lleva_materia_prima: boolean;
}

/**
 * `PUT /materia-prima/lineas/{id}`: sólo lo que cambia.
 *
 * Una fecha en `null` explícito la BORRA; ausente, no la toca. Por eso son opcionales
 * y nulables a la vez: `{fecha_entrega: null}` y `{}` no son lo mismo.
 */
export interface CambiosLinea {
    cantidad?: number;
    unidad?: string | null;
    descripcion?: string | null;
    observaciones?: string | null;
    usado?: boolean;
    pedido?: boolean;
    reserva?: boolean;
    cantidad_reservada?: number | null;
    disponible?: boolean;
    en_produccion?: boolean;
    fecha_proveedor?: FechaISO | null;
    fecha_entrega?: FechaISO | null;
    id_proveedor?: number | null;
    proveedor?: string | null;
    orden?: number | null;
}

/** Lo que se puede cambiar a muchas líneas de una vez (la barra de acciones de Pendientes). */
export type CambiosDeLote = Pick<
    CambiosLinea,
    "pedido" | "disponible" | "reserva" | "en_produccion" | "id_proveedor" | "proveedor" | "fecha_proveedor" | "fecha_entrega"
>;

/** `PUT /materia-prima/lineas/lote`: todas o ninguna, con las mismas reglas que una sola. */
export interface CambiosLoteIn {
    ids: number[];
    cambios: CambiosDeLote;
}

/** `PUT /materia-prima/lineas/{id}/cortes`: reemplaza TODOS los cortes de la línea. */
export interface CortesIn {
    cortes: CorteIn[];
}

// ═══════════════════════════ pendientes (la pantalla de Maxi) ═══════════════════════════

/** Una OT del universo de Pendientes. */
export interface OTPendiente {
    id: number;
    numero_ot: number | null;
    cliente: string | null;
    articulo: string | null;
    unidades: number | null;
    /** La fecha de la OT: la columna «T» del viejo. */
    fecha_ot: FechaISO | null;
    fecha_prometida: FechaISO | null;
    /** El inicio estimado más temprano según el plan: cuándo se necesita el material. Null = sin planificar. */
    fecha_requerida: FechaISO | null;
    /** El nombre de la prioridad de la OT. */
    prioridad: string | null;
    celdas: string[];
    ot_en_curso: boolean;
    lineas_total: number;
    lineas_listas: number;
}

/** Una línea de Pendientes: la línea de la OT más lo de su OT que se muestra en la fila. */
export interface LineaPendiente extends Linea {
    numero_ot: number | null;
    fecha_ot: FechaISO | null;
    fecha_requerida: FechaISO | null;
    /** Lo que queda por conseguir: 0 si ya está disponible, pedida o cubierta por la reserva. */
    falta: number;
    celdas: string[];
    ot_en_curso: boolean;
}

/** Las tarjetas de arriba de Pendientes. Se cuentan sobre la semana entera, antes del filtro de radio. */
export interface ResumenPendientes {
    ot_count: number;
    /** Ni disponibles, ni pedidas, ni reservadas. */
    lineas_a_pedir: number;
    /** No disponibles, pero pedidas o reservadas. */
    lineas_esperando: number;
    lineas_listas: number;
}

/**
 * De dónde sale «la semana» de Pendientes:
 *  · `integral`: del plan semanal del Sistema Integral, el que arma Maxi (mientras el
 *    dueño de las materias primas es el Integral: la prueba piloto);
 *  · `spmm`: del planificador de Metlosys (las OT abiertas con algún proceso que arranca
 *    antes del domingo).
 */
export type FuenteSemana = "integral" | "spmm";

/** `GET /materia-prima/pendientes`. */
export interface Pendientes {
    /** La semana que se miró (lunes a domingo). Null con «Todas las OT abiertas» o con una OT sola. */
    semana: { desde: FechaISO; hasta: FechaISO } | null;
    /**
     * De dónde sale la semana (ver `FuenteSemana`). Opcional: un backend de antes no lo
     * manda, y entonces es la de siempre, el planificador de Metlosys.
     */
    fuente_semana?: FuenteSemana | null;
    resumen: ResumenPendientes;
    ots: OTPendiente[];
    lineas: LineaPendiente[];
}

// ═══════════════════════════ cañera ═══════════════════════════

/** Un casillero ocupado de la cañera, con lo que se muestra de su OT. */
export interface Ocupacion {
    id: number;
    /** «E4». */
    celda: string;
    columna: string;
    fila: number;
    /** Null cuando el número no es una OT de SPMM (se anotó como texto: `ot_texto`). */
    id_orden_trabajo: number | null;
    numero_ot: number | null;
    ot_texto: string | null;
    cliente: string | null;
    articulo: string | null;
    estado_material: EstadoMaterial | null;
    /** La OT ya terminó: el casillero se puede liberar. */
    finalizada: boolean;
    desde: MomentoISO;
    asignado_por: string | null;
}

/** `GET /materia-prima/canera` (y lo que devuelven asignar, mover y liberar). */
export interface Canera {
    columnas: string[];
    filas: number[];
    /** Sólo las vigentes. Un casillero puede tener más de una (lo compartían en el viejo). */
    ocupaciones: Ocupacion[];
}

/** `POST /materia-prima/canera`. El número es el que ve la gente; si no es de SPMM, con `forzar` queda como texto. */
export interface AsignarCeldaIn {
    celda: string;
    numero_ot: number | string;
}

/** `PUT /materia-prima/canera/{id}/mover`. */
export interface MoverCeldaIn {
    celda: string;
}

/** `POST /materia-prima/canera/liberar-terminadas`. */
export interface LiberarTerminadas {
    liberadas: number;
    canera: Canera;
}

// ═══════════════════════════ el fetch de la casa ═══════════════════════════

/**
 * El token para el backend. Copia de la que tiene cada pantalla (no hay cliente
 * central, ver ConsumoDeMaterial y las pantallas de Operaciones): acá, una vez para toda la sección.
 */
export function authHeaders(json = false): Record<string, string> {
    const h: Record<string, string> = {};
    if (json) h["Content-Type"] = "application/json";
    if (typeof window === "undefined") return h;
    try {
        const token = localStorage.getItem("access_token");
        if (token) h["Authorization"] = `Bearer ${token}`;
    } catch {
        // Sin acceso al almacenamiento no hay sesión: el backend contesta 401 y el
        // interceptor de AuthContext hace lo suyo.
    }
    return h;
}

/**
 * La respuesta de la API ya leída. Nunca tira: un error de red también vuelve acá.
 *
 *  · `ok`                   → 2xx; `data` es el `data` del ResponseDTO.
 *  · `requiereConfirmacion` → 409 de «avisar, no bloquear»: no falló nada, falta que
 *                             la persona diga que sí. `error` trae el motivo (qué se
 *                             pierde) y se repite el pedido con `{forzar: true}`.
 *  · `sinServidor`          → el backend todavía no tiene la sección (ver abajo).
 *  · `abortado`             → se canceló con la señal (una búsqueda pisada por otra):
 *                             no hay nada que avisar.
 *  · el resto               → `error` es el motivo que dio el backend, listo para un toast.
 */
export interface MpRespuesta<T> {
    ok: boolean;
    /** 0 = no llegó a haber respuesta (red caída o pedido cancelado). */
    status: number;
    data: T | null;
    error: string | null;
    requiereConfirmacion: boolean;
    sinServidor: boolean;
    abortado: boolean;
}

export interface MpOpciones {
    /** Repetir con `?forzar=true`: la persona ya vio el aviso del 409 y dijo «Hacerlo igual». */
    forzar?: boolean;
    /** Para cancelar una búsqueda que quedó vieja. */
    signal?: AbortSignal;
}

/**
 * ¿Este status dice que el backend no tiene la ruta?
 *
 * El backend se deploya A MANO y el front sale solo con cada push: durante un rato (o
 * días) la pantalla nueva convive con un backend que no la conoce, y un 404/405 en
 * cada pedido se leería como «no hay nada» o como un error rojo en cada toque. Con
 * esto la pantalla muestra un cartel ámbar que dice lo que pasa (el patrón de
 * no-conformidades).
 *
 * Ojo: un 404 también puede ser «ese insumo no existe» (NotFoundException). Por eso la
 * respuesta de `mpFetch` trae `sinServidor` ya distinguido mirando el cuerpo; esto es
 * para quien sólo tiene el status en la mano.
 */
export const esSinServidor = (status: number): boolean => status === 404 || status === 405;

/**
 * Le agrega `forzar=true` a la dirección, tenga o no otros parámetros.
 *
 * Se agrega en la dirección y no en el cuerpo porque así lo lee el backend en todas
 * las rutas de la casa que avisan antes de hacer (`?forzar=true`, ver CatalogoSimple).
 */
export function conForzar(url: string): string {
    const sinForzar = url.replace(/([?&])forzar=[^&#]*(&)?/, (_m, antes: string, despues?: string) =>
        despues ? antes : "",
    );
    return sinForzar + (sinForzar.includes("?") ? "&" : "?") + "forzar=true";
}

/**
 * Los parámetros de una consulta, sin los vacíos: `consulta({search: "", page: 2})` →
 * `"page=2"`. Los `false` sí van (son un filtro apagado a propósito); `null`,
 * `undefined` y el texto vacío no.
 *
 * Se escribe con el `?` A MANO en la dirección:
 *
 *     mpGet(`${API_URL}/materia-prima/insumos?${consulta({ search, size: 15 })}`)
 *
 * y no dentro de esta función, porque backend/tests/test_rutas_que_llama_el_front.py
 * lee las direcciones del código fuente cortando en el `?`: con el `?` a la vista ve la
 * ruta exacta y puede avisar si el backend no la tiene. Por lo mismo, los helpers de
 * abajo reciben la dirección ENTERA y no un pedazo.
 */
export function consulta(params: Record<string, string | number | boolean | null | undefined>): string {
    const q = new URLSearchParams();
    for (const [clave, valor] of Object.entries(params)) {
        if (valor === null || valor === undefined) continue;
        const texto = String(valor);
        if (texto.trim() === "") continue;
        q.set(clave, texto);
    }
    return q.toString();
}

/**
 * El candado del modo espejo (ver `DuenoMP`), a nivel de los pedidos.
 *
 * Las pantallas ya se dibujan en sólo lectura cuando el dueño es el Integral (no hay
 * casillas, ni barra de carga, ni botones). Esto es la red de abajo: si algún camino
 * quedó sin tapar (un atajo de teclado, un guardado automático que arrancó justo antes
 * de enterarse), el pedido de escritura NO sale y vuelve como un error con el motivo,
 * que el que lo pidió ya sabe mostrar y revertir. Lo prende el almacén de catálogos
 * (InsumoCatalogos.ts) cuando llega `dueno`; mientras no se sepa, no traba nada.
 */
let avisoEspejo: string | null = null;

/** Prende (con el texto a mostrar) o apaga el candado del modo espejo. */
export function fijarModoEspejoMP(aviso: string | null): void {
    avisoEspejo = aviso;
}

/** POST que no escribe: armar la descripción de un insumo en vivo. */
const esConsultaPorPost = (url: string) => /\/previsualizar(?:[?#]|$)/.test(url);

/** ¿El cuerpo es un ResponseDTO? El 404 de «esa ruta no existe» de FastAPI no lo es (`{"detail":"Not Found"}`). */
function esResponseDTO(cuerpo: unknown): cuerpo is { status?: unknown; data?: unknown; errors?: unknown } {
    return !!cuerpo && typeof cuerpo === "object" && ("status" in cuerpo || "errors" in cuerpo);
}

/**
 * El pedido, con todo lo de arriba resuelto.
 *
 * `url` es la dirección ENTERA, con `${API_URL}` (ver `consulta` para el porqué).
 */
export async function mpFetch<T>(
    url: string,
    metodo: "GET" | "POST" | "PUT" | "DELETE",
    cuerpo?: unknown,
    opciones: MpOpciones = {},
): Promise<MpRespuesta<T>> {
    const base: MpRespuesta<T> = {
        ok: false, status: 0, data: null, error: null,
        requiereConfirmacion: false, sinServidor: false, abortado: false,
    };
    if (avisoEspejo && metodo !== "GET" && !esConsultaPorPost(url)) {
        // 423 (Locked): no es un 409 (no hay «hacerlo igual») ni un 403 (el permiso lo tiene).
        return { ...base, status: 423, error: avisoEspejo };
    }
    const direccion = opciones.forzar ? conForzar(url) : url;
    let res: Response;
    try {
        res = await fetch(direccion, {
            method: metodo,
            headers: authHeaders(cuerpo !== undefined),
            body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
            signal: opciones.signal,
        });
    } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return { ...base, abortado: true };
        return { ...base, error: "No se pudo conectar con el servidor. Revisá la conexión y probá de nuevo." };
    }

    // El cuerpo no siempre es JSON: un 502/504 de Cloud Run devuelve HTML. Se lee como
    // texto y se intenta después, así un HTML no se come el status (ver el alta de OT).
    const texto = await res.text().catch(() => "");
    let json: unknown = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { json = null; }

    if (res.ok) {
        const data = esResponseDTO(json) ? ((json as { data?: T }).data ?? null) : (json as T | null);
        return { ...base, ok: true, status: res.status, data };
    }

    const sinServidor = res.status === 405 || (res.status === 404 && !esResponseDTO(json));
    const motivo = parseApiError(texto);
    return {
        ...base,
        status: res.status,
        requiereConfirmacion: res.status === 409,
        sinServidor,
        error: sinServidor
            ? "El servidor todavía no tiene la sección Materia prima."
            : motivo || (res.status === 403 ? "No tenés permiso para esto." : `El servidor contestó con un error (${res.status}).`),
    };
}

export const mpGet = <T>(url: string, opciones?: MpOpciones) => mpFetch<T>(url, "GET", undefined, opciones);
export const mpPost = <T>(url: string, cuerpo?: unknown, opciones?: MpOpciones) =>
    mpFetch<T>(url, "POST", cuerpo ?? {}, opciones);
export const mpPut = <T>(url: string, cuerpo?: unknown, opciones?: MpOpciones) =>
    mpFetch<T>(url, "PUT", cuerpo ?? {}, opciones);
export const mpDelete = <T = unknown>(url: string, opciones?: MpOpciones) =>
    mpFetch<T>(url, "DELETE", undefined, opciones);

/**
 * Quién soy, del token: para estampar al instante el «pedido por» de una marca
 * optimista antes de que el backend conteste con el suyo (que es el que vale).
 */
export function usuarioActual(): string | null {
    if (typeof window === "undefined") return null;
    try {
        const token = localStorage.getItem("access_token");
        const p = token ? decodeJwt(token) : null;
        const nombre = [p?.nombre, p?.apellido].filter(Boolean).join(" ").trim() || p?.sub || null;
        return nombre ? String(nombre) : null;
    } catch {
        return null;
    }
}

// ═══════════════════════════ números ═══════════════════════════

/**
 * Una cantidad como la escribe el taller: coma decimal, punto de miles y sin ceros de
 * más (2,5 y no 2,500; 20 y no 20,0). Hasta tres decimales, que es lo que guarda la base.
 */
export function fmtCantidad(valor: number | null | undefined, vacio = "—"): string {
    if (valor === null || valor === undefined || !Number.isFinite(valor)) return vacio;
    return Number(valor.toFixed(3)).toLocaleString("es-AR", { maximumFractionDigits: 3 });
}

/** Un precio: dos decimales siempre, con coma. */
export function fmtPrecio(valor: number | null | undefined, vacio = "—"): string {
    if (valor === null || valor === undefined || !Number.isFinite(valor)) return vacio;
    return "$ " + valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Un largo en milímetros, para recortes y cortes: «2.777 mm». */
export const fmtMm = (valor: number | null | undefined, vacio = "—"): string =>
    valor === null || valor === undefined ? vacio : `${fmtCantidad(valor)} mm`;

/**
 * Lo que escribió la persona, como número. `null` = vacío o no es un número.
 *
 * «2,5» y «2.5» son lo mismo para el que carga, y «1.234,5» también se entiende (con
 * coma, los puntos son de miles). Es la misma lectura que la de los consumos
 * (ConsumoDeMaterial) y la del stock mínimo.
 */
export function leerCantidad(texto: string | null | undefined): number | null {
    const t = (texto ?? "").trim().replace(/\s/g, "");
    if (!t) return null;
    const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
    const n = Number(normal);
    return Number.isFinite(n) ? n : null;
}

const redondear3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Una medida en pulgadas, escrita como en el taller, a milímetros:
 *
 *     "1 1/4"  → 31.75      "3/8"   → 9.525     "1-1/4" → 31.75
 *     "2 1/2"  → 63.5       "1,5"   → 38.1      "2"     → 50.8
 *
 * Acepta la comilla de pulgada al final («1 1/4"»), espacios de más y la coma decimal.
 * `null` si no se entiende: mejor un campo en rojo que una medida inventada. Se
 * redondea a milésimas, que es lo que guarda la base (NUMERIC(12,3)).
 *
 * Existe porque en el viejo, en pulgadas, «la única verdad es la descripción»: sus
 * medidas numéricas eran el Val() del texto y «1 1/4» quedaba como 11. Acá la medida
 * se guarda en mm desde el vamos y la pulgada es sólo cómo se escribe.
 */
export function pulgadasAMm(texto: string | null | undefined): number | null {
    let t = (texto ?? "").trim().replace(/[″”"]+$/, "").trim().replace(",", ".");
    if (!t) return null;
    // «1-1/4» y «1 1/4» son lo mismo: el guion sólo separa el entero de la fracción.
    t = t.replace(/^(\d+)\s*-\s*(\d+\s*\/\s*\d+)$/, "$1 $2");
    let pulgadas: number | null = null;
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/))) {
        const den = Number(m[3]);
        if (den > 0) pulgadas = Number(m[1]) + Number(m[2]) / den;
    } else if ((m = t.match(/^(\d+)\s*\/\s*(\d+)$/))) {
        const den = Number(m[2]);
        if (den > 0) pulgadas = Number(m[1]) / den;
    } else if (/^\d+(\.\d+)?$/.test(t) || /^\.\d+$/.test(t)) {
        pulgadas = Number(t);
    }
    if (pulgadas === null || !Number.isFinite(pulgadas) || pulgadas <= 0) return null;
    return redondear3(pulgadas * 25.4);
}

/**
 * Milímetros a pulgadas escritas como en el taller: 31.75 → «1 1/4"», 9.525 → «3/8"».
 *
 * ESPEJO del backend y SÓLO PARA MOSTRAR: la descripción del insumo la arma el backend
 * (`previsualizar`) y ésa es la que vale. Esto sirve para escribir en el campo, al
 * abrir una ficha en pulgadas, lo que la persona había tipeado.
 *
 * Fracción con denominador potencia de 2 hasta 64; si no da exacta, el decimal en
 * pulgadas. «Exacta» con tolerancia de milésima de milímetro: la base guarda tres
 * decimales, así que 1/64" (0,396875 mm) vuelve como 0,397.
 */
export function mmAPulgadasTexto(mm: number | null | undefined): string {
    if (mm === null || mm === undefined || !Number.isFinite(mm) || mm <= 0) return "";
    const sesentaCuatroavos = Math.round((mm / 25.4) * 64);
    if (sesentaCuatroavos > 0 && Math.abs(mm - (sesentaCuatroavos * 25.4) / 64) < 0.001) {
        const entero = Math.floor(sesentaCuatroavos / 64);
        let num = sesentaCuatroavos % 64;
        let den = 64;
        while (num > 0 && num % 2 === 0) {
            num /= 2;
            den /= 2;
        }
        if (num === 0) return `${entero}"`;
        return entero > 0 ? `${entero} ${num}/${den}"` : `${num}/${den}"`;
    }
    return `${Number((mm / 25.4).toFixed(3))}"`;
}

// ═══════════════════════════ fechas (sin zona) ═══════════════════════════
//
// Las fechas de esta sección son DÍAS («YYYY-MM-DD») y viajan así. Nada de
// `toISOString()`: devuelve la hora UTC, y a las 21:00 de Argentina ya es mañana (el
// «F. Disp Mat» de la OT se corría un día por eso). Y nada de `new Date("2026-09-21")`
// para mostrar: ese texto se lee como medianoche UTC y en Argentina es el 20 a las 21.
// Todo se hace con los números del texto o con `new Date(año, mes, día)`, que es local.

const dos = (n: number) => String(n).padStart(2, "0");

/** Un `Date` local como «YYYY-MM-DD», con los números de acá (no los de UTC). */
export function aFechaISO(d: Date): FechaISO {
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** «YYYY-MM-DD» (o un momento «YYYY-MM-DDTHH:MM:SS») → `Date` a la medianoche LOCAL de ese día. Null si no se entiende. */
export function deFechaISO(iso: string | null | undefined): Date | null {
    const m = (iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Hoy, acá. */
export const hoyISO = (): FechaISO => aFechaISO(new Date());

/** Ahora, acá y sin zona, escrito como los momentos de la base (para estampas optimistas). */
export function ahoraISO(): MomentoISO {
    const d = new Date();
    return `${aFechaISO(d)}T${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
}

/** Un día más o menos: `sumarDias("2026-09-28", -7)` → "2026-09-21". Pasa bien los fines de mes. */
export function sumarDias(iso: FechaISO, dias: number): FechaISO {
    const d = deFechaISO(iso);
    if (!d) return iso;
    return aFechaISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() + dias));
}

/**
 * El lunes de la semana de esa fecha. La semana de Pendientes va de lunes a domingo,
 * como la del planificador (y como la normaliza el backend).
 */
export function lunesDe(fecha: FechaISO | Date = new Date()): FechaISO {
    const d = typeof fecha === "string" ? deFechaISO(fecha) : fecha;
    if (!d) return aFechaISO(new Date());
    // getDay: domingo = 0. El domingo es el ÚLTIMO día de la semana, no el primero.
    const desdeElLunes = (d.getDay() + 6) % 7;
    return aFechaISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() - desdeElLunes));
}

/** «21/09/2026». Acepta también un momento («2026-09-21T10:15:00»): toma el día. */
export function fmtFecha(iso: string | null | undefined, vacio = "—"): string {
    const m = (iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : vacio;
}

/** «21/09»: para lo que se lee dentro de la semana («se necesita 23/09»). */
export function fmtFechaCorta(iso: string | null | undefined, vacio = "—"): string {
    const m = (iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}` : vacio;
}

/**
 * «21/09/2026 10:15», reloj de 24 horas (con el de 12 el es-AR escribe «10:15 a. m.»
 * y parte el renglón). Se lee del texto: el momento viene sin zona y es hora de acá.
 */
export function fmtFechaHora(iso: string | null | undefined, vacio = "—"): string {
    const m = (iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!m) return vacio;
    const dia = `${m[3]}/${m[2]}/${m[1]}`;
    return m[4] ? `${dia} ${m[4]}:${m[5]}` : dia;
}

/** «Semana del 21/09 al 27/09», a partir de cualquier día de la semana. */
export function rotuloSemana(fecha: FechaISO): string {
    const lunes = lunesDe(fecha);
    return `Semana del ${fmtFechaCorta(lunes)} al ${fmtFechaCorta(sumarDias(lunes, 6))}`;
}

// ═══════════════════════════ cañera ═══════════════════════════

/** Las columnas de la cañera, A..O. */
export const COLUMNAS_CANERA: readonly string[] = "ABCDEFGHIJKLMNO".split("");
/** Las que se ven sin tocar nada (A..L): M..O casi no se usan y se abren con «ver M–O». */
export const COLUMNAS_CANERA_VISIBLES: readonly string[] = COLUMNAS_CANERA.slice(0, 12);
/** Las filas, 1..9. */
export const FILAS_CANERA: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** «E4» con cualquier cosa que haya escrito la persona («e4», « E 4 »). Null si no es un casillero. */
export function normalizarCelda(texto: string | null | undefined): string | null {
    const t = (texto ?? "").replace(/\s+/g, "").toUpperCase();
    return /^[A-O][1-9]$/.test(t) ? t : null;
}

/** ¿Es un casillero de la cañera? (A..O y 1..9). */
export const celdaValida = (texto: string | null | undefined): boolean => normalizarCelda(texto) !== null;

/** «E4» → {columna: "E", fila: 4}. */
export function partirCelda(texto: string | null | undefined): { columna: string; fila: number } | null {
    const c = normalizarCelda(texto);
    return c ? { columna: c[0], fila: Number(c[1]) } : null;
}

export const armarCelda = (columna: string, fila: number): string => `${columna.toUpperCase()}${fila}`;

// ═══════════════════════════ rótulos ═══════════════════════════

export const TIPOS_INSUMO: readonly OpcionTipo[] = [
    { valor: "insumo", nombre: "Insumo" },
    { valor: "insumo_desc", nombre: "Insumo c/ descripción" },
    { valor: "consumible", nombre: "Consumible" },
];

/** El nombre del tipo. Null = fila sin clasificar (anterior a la importación). */
export function rotuloTipo(tipo: TipoInsumo | null | undefined): string {
    if (!tipo) return "Sin clasificar";
    return TIPOS_INSUMO.find((t) => t.valor === tipo)?.nombre ?? tipo;
}

/** Unidades de la pieza (como en el viejo). Las manda también `catalogos`; ésta es la lista para dibujar sin esperar. */
export const UNIDADES_PIEZA: readonly string[] = ["UN", "MTS", "KG", "LTS", "HS"];
/** Unidades de una línea de OT. */
export const UNIDADES_LINEA: readonly string[] = ["Un", "Mts", "Kg", "Lts"];

/**
 * La unidad de la línea que toca por la de la pieza (UN → Un, MTS → Mts…), para dejar
 * elegido el desplegable al cargar. Si no se manda, el backend hace lo mismo: esto es
 * sólo para que la persona vea antes de agregar qué unidad va a quedar.
 */
export function unidadLineaDePieza(unidad: string | null | undefined): string {
    const u = (unidad ?? "").trim().toUpperCase();
    return UNIDADES_LINEA.find((l) => l.toUpperCase() === u) ?? "Un";
}

export const ROTULO_MOVIMIENTO: Record<TipoMovimiento, string> = {
    ingreso: "Ingreso",
    egreso: "Egreso",
    ajuste: "Ajuste",
    retiro_ot: "Retiro para OT",
};

export const ROTULO_ORIGEN_PRECIO: Record<OrigenPrecio, string> = {
    compra: "Factura",
    manual: "Manual",
    import: "Importado",
};

export const ROTULO_ESTADO_RECORTE: Record<EstadoRecorte, string> = {
    disponible: "Disponible",
    usado: "Usado",
    descartado: "Descartado",
};

// ═══════════════════════════ cortes: los metros que se muestran ═══════════════════════════

/**
 * La línea va en metros: la unidad es «Mts», con cualquier mayúscula (también «M», «Mt» o
 * «Metros», si vinieron así del viejo). Sólo ahí se compara la cantidad con los metros
 * que piden los cortes.
 */
export const enMetros = (l: { unidad?: string | null }): boolean =>
    /^(MTS?|M|METROS?)\.?$/.test((l.unidad ?? "").trim().toUpperCase());

/**
 * Los metros que piden los cortes (`sugerido_m`), si tiene sentido mostrarlos; si no,
 * null. Tienen sentido cuando la línea va en metros, o cuando ningún corte tiene ancho
 * (barras, tubos: aunque la línea vaya en unidades, saber que hacen falta 3,3 m sirve
 * para comprar). Un corte con ancho es de chapa: si la línea no va en metros, la suma de
 * los largos no es nada que se compre (una chapa en Kg cortada en 1.220 × 600 no
 * «lleva 2,45 m»).
 *
 * La MISMA regla en Pendientes (la celda, el papel y la planilla) y en la solapa
 * Materias primas de la OT (el botón de los cortes y su diálogo).
 */
export function metrosQueSeMuestran(l: {
    unidad?: string | null;
    sugerido_m?: number | null;
    cortes?: readonly { ancho_mm?: number | null }[] | null;
}): number | null {
    if (l.sugerido_m === null || l.sugerido_m === undefined) return null;
    if (enMetros(l)) return l.sugerido_m;
    return (l.cortes ?? []).some((c) => !!c.ancho_mm) ? null : l.sugerido_m;
}

/**
 * «Compra corta»: la línea va en metros y pide menos de lo que hace falta para sus
 * cortes. Pasa cuando alguien cambió los cortes y no la cantidad (o al revés).
 */
export function compraCorta(l: { unidad?: string | null; cantidad: number; sugerido_m?: number | null }): boolean {
    return enMetros(l) && l.sugerido_m !== null && l.sugerido_m !== undefined && l.cantidad + 1e-9 < l.sugerido_m;
}

/**
 * Lo que queda por conseguir de una línea: la columna «Falta» de Pendientes. Nada si ya
 * está disponible o pedida; si no, la cantidad menos lo que cubre su reserva.
 *
 * ESPEJO de `falta_de` del backend (MateriaPrimaOTService). Pendientes la recibe hecha
 * en cada línea, pero el guardado de una línea vuelve sin ella, y la solapa de la OT no
 * la trae: por eso se calcula también acá, con la misma regla.
 */
export function faltaDeLinea(l: Pick<Linea, "disponible" | "pedido" | "reserva" | "cantidad" | "cantidad_reservada">): number {
    if (l.disponible || l.pedido) return 0;
    const cubierto = l.reserva ? (l.cantidad_reservada ?? 0) : 0;
    return Math.max(0, Math.round(((l.cantidad ?? 0) - cubierto) * 1000) / 1000);
}

/**
 * Dónde está una línea, para pintarla, contarla en las tarjetas de Pendientes y ordenarla:
 *  · lista = disponible (cortada y en la cañera);
 *  · esperando = pedida, o reservada del stock ENTERA, y todavía no disponible: no hay
 *    nada que comprar;
 *  · falta pedir = todo lo demás: ni pedida ni reservada, o con una reserva que no
 *    alcanza (reserva parcial: `faltaDeLinea` > 0; lo que falta hay que encargarlo).
 * Una línea no utilizada no está en ninguna: no entra en Pendientes ni en el estado del
 * material.
 *
 * Ojo: el `resumen` que manda el backend en Pendientes cuenta una reserva parcial como
 * «esperando». La pantalla no lo usa (cuenta las tarjetas con esto, sobre las líneas).
 */
export type EstadoLinea = "lista" | "esperando" | "falta_pedir" | "no_usada";

export function estadoLinea(
    l: Pick<Linea, "usado" | "disponible" | "pedido" | "reserva" | "cantidad" | "cantidad_reservada">,
): EstadoLinea {
    if (!l.usado) return "no_usada";
    if (l.disponible) return "lista";
    if (l.pedido) return "esperando";
    if (l.reserva) return faltaDeLinea(l) > 0 ? "falta_pedir" : "esperando";
    return "falta_pedir";
}

export const ESTADOS_LINEA: Record<EstadoLinea, {
    rotulo: string;
    /** La frase entera, para el `title`. */
    titulo: string;
    /** El fondo (o el borde) de la fila. */
    fila: string;
    /** Las clases del chip. */
    chip: string;
}> = {
    lista: {
        rotulo: "Lista",
        titulo: "Cortado y en la cañera: el operario lo puede retirar.",
        fila: "bg-green-50/70",
        chip: "bg-green-50 text-green-700 border-green-200",
    },
    esperando: {
        rotulo: "Esperando",
        titulo: "Está pedido al proveedor o reservado entero del stock, y todavía no está disponible.",
        fila: "bg-amber-50/70",
        chip: "bg-amber-50 text-amber-700 border-amber-200",
    },
    falta_pedir: {
        rotulo: "Falta pedir",
        titulo: "No está disponible ni pedido, y lo reservado del stock (si hay) no alcanza: hay que encargarlo.",
        // Borde y no fondo: es la mayoría de las filas de Pendientes, y una grilla
        // entera en rojo no deja ver nada. El borde marca sin gritar.
        fila: "border-l-4 border-l-red-500",
        chip: "bg-red-100 text-red-700 border-red-200",
    },
    no_usada: {
        rotulo: "No se usa",
        titulo: "Marcada como no utilizada (o a confirmar): no entra en Pendientes ni en el estado del material.",
        fila: "opacity-60",
        chip: "bg-gray-100 text-gray-500 border-gray-200",
    },
};

/** El texto que se lee de una ocupación de la cañera: el número de SPMM o, si no es de SPMM, lo que se anotó. */
export const numeroDeOcupacion = (o: Pick<Ocupacion, "numero_ot" | "ot_texto">): string =>
    o.numero_ot !== null && o.numero_ot !== undefined ? String(o.numero_ot) : (o.ot_texto ?? "?");

/** El mensaje de siempre cuando el backend todavía no tiene la sección (el cartel ámbar). */
export const AVISO_SIN_SERVIDOR =
    "El servidor todavía no tiene la sección Materia prima. Aparece sola cuando se actualice; mientras tanto no se puede ver ni cargar nada acá.";
