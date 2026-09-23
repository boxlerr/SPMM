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

export interface MateriaDeOT {
    codigo: string;
    descripcion: string;
    proveedor: string;
    cantidad: string;
    unidad: string;
    disponible: string;
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
    { titulo: "Disponible", tipo: "numero", valor: (m) => m.disponible },
];

/** Las tres tablas del Excel y del CSV. */
export function seccionesDeOT(d: DatosDeOT): SeccionExport[] {
    return [
        { titulo: "Orden", filas: [d], columnas: COLUMNAS_ORDEN },
        { titulo: "Procesos", filas: d.procesos, columnas: COLUMNAS_PROCESOS_OT },
        { titulo: "Materias primas", filas: d.materias, columnas: COLUMNAS_MATERIAS_OT },
    ];
}
