/**
 * Exportar UNA orden de trabajo (RF-22): la del modal de la OT.
 *
 * Sale lo que está en el formulario en ese momento —igual que el botón Imprimir—, así
 * sirve para una OT guardada y para un borrador que todavía no se guardó.
 *
 *   · Excel / CSV → tres tablas: la orden (una fila), sus procesos y sus materias
 *                   primas. En el Excel son tres hojas; en el CSV, tres bloques.
 *   · PDF         → la hoja impresa de siempre (procesos para el recurso humano y
 *                   materias primas para el pañol), armada como PDF: ver `otPdf.ts`,
 *                   que se carga recién al tocar «PDF».
 */

import type { ColumnaExport, SeccionExport } from "@/lib/exportar";
import { ESTADOS_LINEA, estadoLinea, type Linea, type LineaLocal } from "@/lib/materiaPrima";

export interface ProcesoDeOT {
    paso: number;
    proceso: string;
    /** La preselección, o lo que asignó el planificador. Vacío = sin recurso maquinaria. */
    maquina: string;
    recursoHumano: string;
    minutos: number | null;
    enSimultaneo: number | null;
    estado: string;
}

/**
 * Una materia prima de la OT como sale en el archivo y en la hoja del pañol.
 *
 * Desde el 24/09 sale de la API de Materia prima (`GET /materia-prima/ot/{id}/lineas`,
 * o las líneas en memoria de una OT nueva): ver `materiasDeOT`. Antes era lo que traía
 * el sync del viejo, con un «Disponible» 0/1 crudo.
 */
export interface MateriaDeOT {
    codigo: string;
    descripcion: string;
    proveedor: string;
    /** El número como texto con punto («6.5»): cada salida lo escribe a su manera. */
    cantidad: string;
    unidad: string;
    /** «Utilizado»: false = no va o está a confirmar. La hoja del pañol no la lista. */
    utilizada: boolean;
    /** Lista / Esperando / Falta pedir / No se usa (el mismo corte que Pendientes). Vacío en una OT sin guardar. */
    estado: string;
    observaciones: string;
    /** «2 × 1093 mm; 1 × 1220 × 2440 mm»: lo que hay que cortar. */
    cortes: string;
}

const numeroCorte = (v: number) => String(Number(v.toFixed(1))).replace(".", ",");

function textoDeCortes(cortes: { cantidad: number; largo_mm?: number | null; ancho_mm?: number | null; texto_original?: string | null }[] | undefined): string {
    return (cortes ?? [])
        .map((c) =>
            c.largo_mm === null || c.largo_mm === undefined
                ? `${c.cantidad} × ${c.texto_original ?? "?"}`
                : `${c.cantidad} × ${numeroCorte(c.largo_mm)}${c.ancho_mm ? ` × ${numeroCorte(c.ancho_mm)}` : ""} mm`,
        )
        .join("; ");
}

/**
 * Las líneas de la solapa Materias primas (guardadas o, en una OT nueva, en memoria)
 * como las piden el archivo y la hoja del pañol.
 */
export function materiasDeOT(lineas: (Linea | LineaLocal)[]): MateriaDeOT[] {
    return lineas.map((l) => {
        if ("clave" in l) {
            // Línea local: todavía no existe, no tiene marcas ni estado.
            return {
                codigo: l.codigo,
                descripcion: l.descripcion_mostrada,
                proveedor: l.proveedor ?? "",
                cantidad: String(l.cantidad),
                unidad: l.unidad ?? "",
                utilizada: true,
                estado: "",
                observaciones: l.observaciones ?? "",
                cortes: textoDeCortes(l.cortes),
            };
        }
        return {
            codigo: l.codigo,
            descripcion: l.descripcion,
            proveedor: l.proveedor ?? "",
            cantidad: String(l.cantidad),
            unidad: l.unidad ?? "",
            utilizada: l.usado,
            estado: ESTADOS_LINEA[estadoLinea(l)].rotulo,
            observaciones: l.observaciones ?? "",
            cortes: textoDeCortes(l.cortes),
        };
    });
}

export interface DatosDeOT {
    /** El número que se lee en la OT (el del sistema viejo si lo tiene), o «Nueva». */
    numero: string;
    cliente: string;
    codigo: string;
    articulo: string;
    prioridad: string;
    sector: string;
    cantidad: string;
    nPedido: string;
    fechaEntrada: string;
    fechaPrometida: string;
    fechaEntrega: string;
    pedidoPor: string;
    aprobadoPor: string;
    notaDeTaller: string;
    descripcion: string;
    /** RF-11: las casillas de «Estado y control» marcadas, en el orden de la ficha vieja
     *  («Programada, Finalizado parcial (3), Controlado»). Vacío = ninguna. */
    estadoYControl?: string;
    /** Quién marcó Controlado y cuándo (lo que dice la OT guardada). */
    controladoPor?: string;
    controladoEl?: string;
    procesos: ProcesoDeOT[];
    materias: MateriaDeOT[];
}

/** «15810» → `ot_15810`; una OT sin guardar → `ot_nueva`. */
export const archivoDeOT = (d: Pick<DatosDeOT, "numero">) =>
    `ot_${String(d.numero || "nueva").toLowerCase()}`;

const COLUMNAS_ORDEN: ColumnaExport<DatosDeOT>[] = [
    { titulo: "OT", tipo: "id", valor: (d) => (/^\d+$/.test(d.numero) ? Number(d.numero) : d.numero) },
    { titulo: "Cliente", valor: (d) => d.cliente },
    { titulo: "Código", valor: (d) => d.codigo },
    { titulo: "Producto", valor: (d) => d.articulo },
    { titulo: "Cantidad", tipo: "entero", valor: (d) => d.cantidad },
    { titulo: "Prioridad", valor: (d) => d.prioridad },
    { titulo: "Sector", valor: (d) => d.sector },
    { titulo: "N° Pedido", valor: (d) => d.nPedido },
    { titulo: "F. Entrada", tipo: "fecha", valor: (d) => d.fechaEntrada },
    { titulo: "F. Prometida", tipo: "fecha", valor: (d) => d.fechaPrometida },
    { titulo: "F. Entrega", tipo: "fecha", valor: (d) => d.fechaEntrega },
    { titulo: "Pedido por", valor: (d) => d.pedidoPor },
    { titulo: "Aprobado por", valor: (d) => d.aprobadoPor },
    { titulo: "Nota de taller", valor: (d) => d.notaDeTaller },
    { titulo: "Descripción", valor: (d) => d.descripcion },
    // RF-11: al final, para no correr las columnas de antes.
    { titulo: "Estado y control", valor: (d) => d.estadoYControl ?? "" },
    { titulo: "Controlado por", valor: (d) => d.controladoPor ?? "" },
    { titulo: "Controlado el", tipo: "fechaHora", valor: (d) => d.controladoEl || null },
];

export const COLUMNAS_PROCESOS_OT: ColumnaExport<ProcesoDeOT>[] = [
    { titulo: "#", tipo: "entero", valor: (p) => p.paso },
    { titulo: "Proceso", valor: (p) => p.proceso },
    { titulo: "Recurso maquinaria", valor: (p) => p.maquina },
    { titulo: "Recurso humano", valor: (p) => p.recursoHumano },
    { titulo: "Min. plan.", tipo: "entero", valor: (p) => p.minutos },
    { titulo: "En simultáneo", tipo: "entero", valor: (p) => p.enSimultaneo },
    { titulo: "Estado", valor: (p) => p.estado },
];

export const COLUMNAS_MATERIAS_OT: ColumnaExport<MateriaDeOT>[] = [
    { titulo: "Código", valor: (m) => m.codigo },
    { titulo: "Descripción", valor: (m) => m.descripcion },
    { titulo: "Proveedor", valor: (m) => m.proveedor },
    { titulo: "Cantidad", tipo: "numero", valor: (m) => m.cantidad },
    { titulo: "Unidad", valor: (m) => m.unidad },
    { titulo: "Estado", valor: (m) => m.estado },
    { titulo: "Utilizada", valor: (m) => (m.utilizada ? "Sí" : "No") },
    { titulo: "Cortes", valor: (m) => m.cortes },
    { titulo: "Observaciones", valor: (m) => m.observaciones },
];

/** Las tres tablas del Excel y del CSV. */
export function seccionesDeOT(d: DatosDeOT): SeccionExport[] {
    return [
        { titulo: "Orden", filas: [d], columnas: COLUMNAS_ORDEN },
        { titulo: "Procesos", filas: d.procesos, columnas: COLUMNAS_PROCESOS_OT },
        { titulo: "Materias primas", filas: d.materias, columnas: COLUMNAS_MATERIAS_OT },
    ];
}
