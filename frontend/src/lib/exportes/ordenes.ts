/**
 * Las columnas de las listas de órdenes de trabajo, para exportar (RF-22).
 *
 * No Planificadas, Planificadas, Historial y las solapas del plan muestran la misma
 * tabla de OT: las columnas se definen UNA vez acá para que los cuatro archivos digan
 * lo mismo con las mismas palabras que la pantalla (Material «Sin cargar», Plano «Del
 * producto», la prioridad por su nombre y no por su número).
 */

import type { PlanificacionItem, WorkOrder } from "@/lib/types";
import { resumirMaterial } from "@/lib/materialOT";
import type { EstadoPlano } from "@/hooks/useOrdenesConPlano";
import { fechaDeFiltro, filtroBusqueda, type ColumnaExport } from "@/lib/exportar";
import type { WorkOrderFilterState } from "@/components/common/WorkOrderFilters";
import { finDeLaFila, inicioDeLaFila } from "@/lib/plan-fechas";
import { ROTULO_FILTRO_CONTROL, columnasEstadoYControl } from "@/lib/estadoControlOT";

/** Lo mismo que muestran las listas: la descripción del artículo, o las observaciones
 *  cuando el artículo es el genérico que dejó la migración (NO-DEF / «heredado»). */
export function productoDeLaOrden(o: WorkOrder): string {
    const generico = o.articulo?.cod_articulo === "NO-DEF" || o.articulo?.descripcion?.toLowerCase().includes("heredado");
    if (generico && o.observaciones) return o.observaciones;
    return o.articulo?.descripcion ?? "";
}

/** La prioridad por su nombre, con el mismo respaldo que usan las tablas. */
export function prioridadDeLaOrden(o: WorkOrder): string {
    if (o.prioridad?.descripcion) return o.prioridad.descripcion;
    switch (o.id_prioridad) {
        case 3: return "Crítica";
        case 2: return "Urgente";
        default: return "Normal";
    }
}

/** El estado que la tabla del plan deduce de los pasos. */
export function estadoDeLaOrden(o: WorkOrder): string {
    const procesos = o.procesos ?? [];
    if (procesos.length === 0) return "Pendiente";
    if (procesos.every((p) => p.estado_proceso?.id === 3)) return "Finalizado";
    if (procesos.some((p) => p.estado_proceso?.id === 2 || p.estado_proceso?.id === 3)) return "En Proceso";
    return "Pendiente";
}

const ROTULO_PLANO: Record<EstadoPlano, string> = {
    adjunto: "Sí",
    del_producto: "Del producto",
    marcado_sin_archivo: "Sin plano",
    sin_plano: "Sin plano",
};

export interface OpcionesColumnasOT {
    /** Cómo sale la columna Plano. Sin esto la columna no va (no se sabe qué decir). */
    plano?: (o: WorkOrder) => EstadoPlano;
    /** Agrega «F. Entrega» (Historial). */
    conEntrega?: boolean;
    /** Agrega «Estado» con lo que dice la pantalla (fijo, o deducido de los pasos). */
    estado?: string | ((o: WorkOrder) => string);
    /** RF-11: agrega al final las columnas de «Estado y control» (Controlado, quién,
     *  cuándo, las etapas de pintura y tercerización y la cantidad del parcial). */
    conControl?: boolean;
}

/** Las columnas de la tabla de OT, en el orden en que se ven. */
export function columnasOrdenes(op: OpcionesColumnasOT = {}): ColumnaExport<WorkOrder>[] {
    const cols: ColumnaExport<WorkOrder>[] = [
        { titulo: "OT", tipo: "id", valor: (o) => o.id_otvieja || o.id },
        { titulo: "F. Entrada", tipo: "fecha", valor: (o) => o.fecha_entrada },
        { titulo: "Cliente", valor: (o) => o.cliente?.nombre ?? "" },
        { titulo: "Código", valor: (o) => o.articulo?.cod_articulo ?? "" },
        { titulo: "Producto", valor: productoDeLaOrden },
        { titulo: "N° Pedido", valor: (o) => o.n_pedido || o.n_ped_l || "" },
        { titulo: "Cant.", tipo: "entero", valor: (o) => o.unidades },
        { titulo: "Prioridad", valor: prioridadDeLaOrden },
        { titulo: "Sector", valor: (o) => o.sector?.nombre ?? "" },
        { titulo: "Material", valor: (o) => resumirMaterial(o.estado_material, o.no_lleva_materia_prima).rotulo },
        { titulo: "Procesos", tipo: "entero", valor: (o) => o.procesos?.length ?? 0 },
        {
            titulo: "Terminados",
            tipo: "entero",
            valor: (o) => (o.procesos ?? []).filter((p) => p.estado_proceso?.id === 3).length,
        },
    ];
    if (op.plano) {
        const plano = op.plano;
        cols.push({ titulo: "Plano", valor: (o) => ROTULO_PLANO[plano(o)] });
    }
    if (op.estado) {
        const estado = op.estado;
        cols.push({ titulo: "Estado", valor: (o) => (typeof estado === "function" ? estado(o) : estado) });
    }
    cols.push(
        { titulo: "Entregado", tipo: "entero", valor: (o) => o.cantidad_entregada ?? 0 },
        { titulo: "F. Prometida", tipo: "fecha", valor: (o) => o.fecha_prometida },
    );
    if (op.conEntrega) cols.push({ titulo: "F. Entrega", tipo: "fecha", valor: (o) => o.fecha_entrega });
    cols.push(
        { titulo: "Aprobado por", valor: (o) => o.aprobado_por ?? "" },
        { titulo: "Pedido por", valor: (o) => o.requerido_por ?? "" },
    );
    if (op.conControl) cols.push(...columnasEstadoYControl<WorkOrder>());
    return cols;
}

// ---------------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------------

const MATERIAL: Record<string, string> = {
    OK: "Disponible", PEDIDO: "Pedido", SIN_STOCK: "Sin stock", SIN_DATOS: "Sin cargar", NO_LLEVA: "No lleva",
};
const ENTREGA: Record<string, string> = {
    THIS_WEEK: "Esta semana", NEXT_2_WEEKS: "Próximas 2 semanas", THIS_MONTH: "Este mes",
};
const LOTE: Record<string, string> = { SMALL: "Pequeño (≤10)", MEDIUM: "Mediano (11-50)", LARGE: "Grande (>50)" };

/** Los filtros de la barra de filtros de OT, dichos como se leen en la pantalla. */
export function resumenFiltrosOT(f: WorkOrderFilterState, busqueda?: string): string[] {
    const r: string[] = [...filtroBusqueda(busqueda)];
    if (f.priority.length) r.push(`Prioridad: ${f.priority.join(", ")}`);
    if (f.client.length) r.push(`Cliente: ${f.client.join(", ")}`);
    if (f.sector !== "ALL") r.push(`Sector: ${f.sector}`);
    if (f.material !== "ALL") r.push(`Material: ${MATERIAL[f.material] ?? f.material}`);
    if (f.promisedDate !== "ALL") r.push(`Entrega: ${ENTREGA[f.promisedDate] ?? f.promisedDate}`);
    if (f.batchSize !== "ALL") r.push(`Lote: ${LOTE[f.batchSize] ?? f.batchSize}`);
    if (f.dateFrom || f.dateTo) {
        const desde = f.dateFrom ? `desde ${fechaDeFiltro(f.dateFrom)}` : "";
        const hasta = f.dateTo ? `hasta ${fechaDeFiltro(f.dateTo)}` : "";
        r.push(`Fecha de entrada o prometida: ${[desde, hasta].filter(Boolean).join(" ")}`);
    }
    if (f.showWithProcessesOnly) r.push("Sólo con procesos");
    if (f.showDelayedOnly) r.push("Sólo retrasadas");
    if (f.showClaimsOnly) r.push("Sólo con reclamos");
    if (f.control && f.control !== "ALL") r.push(`Control: ${ROTULO_FILTRO_CONTROL[f.control]}`);
    return r;
}

/** «Ordenado por Cliente (A → Z)» cuando la persona tocó una columna. */
export function filtroOrden(rotulo: string | null | undefined, direccion: "asc" | "desc" | null | undefined): string[] {
    if (!rotulo || !direccion) return [];
    return [`Ordenado por ${rotulo} (${direccion === "asc" ? "ascendente" : "descendente"})`];
}

// ---------------------------------------------------------------------------------
// Pasos del plan
// ---------------------------------------------------------------------------------

/** Un renglón por paso de cada OT, con lo que asignó el planificador. */
export interface PasoDelPlan {
    ot: number;
    cliente: string;
    producto: string;
    paso: number;
    proceso: string;
    estado: string;
    minutos: number | null;
    inicio: Date | null;
    fin: Date | null;
    recursoHumano: string;
    recursoMaquinaria: string;
}

const titulo = (s?: string | null) =>
    (s ?? "").trim().split(/\s+/).filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");

/**
 * Los pasos de las OT que se están viendo, con el horario del plan.
 *
 * La fila del plan se busca como la busca la tabla: primero por la pasada (id de
 * orden_trabajo_proceso) y, en los planes viejos que no la guardaban, por orden y
 * proceso. La fecha es la que calculó el backend (`inicioDeLaFila`), no una cuenta propia.
 */
export function pasosDelPlan(ordenes: WorkOrder[], planificacion: PlanificacionItem[], feriados: string[] = []): PasoDelPlan[] {
    const porPasada = new Map<number, PlanificacionItem>();
    const porOrdenYProceso = new Map<string, PlanificacionItem>();
    for (const p of planificacion) {
        if (p.id_orden_trabajo_proceso) porPasada.set(p.id_orden_trabajo_proceso, p);
        const clave = `${p.orden_id}-${p.proceso_id}`;
        if (!porOrdenYProceso.has(clave)) porOrdenYProceso.set(clave, p);
    }
    const salida: PasoDelPlan[] = [];
    for (const o of ordenes) {
        const pasos = [...(o.procesos ?? [])].sort((a, b) => a.orden - b.orden);
        for (const proc of pasos) {
            const plan = (proc.id ? porPasada.get(proc.id) : undefined) ?? porOrdenYProceso.get(`${o.id}-${proc.proceso?.id}`) ?? null;
            salida.push({
                ot: o.id_otvieja || o.id,
                cliente: o.cliente?.nombre ?? "",
                producto: productoDeLaOrden(o),
                paso: proc.orden,
                proceso: proc.proceso?.nombre ?? "",
                estado: proc.estado_proceso?.id === 3 ? "Finalizado" : proc.estado_proceso?.id === 2 ? "En Proceso" : "Pendiente",
                minutos: proc.tiempo_proceso ?? null,
                inicio: plan ? inicioDeLaFila(plan, feriados) : null,
                fin: plan ? finDeLaFila(plan, feriados) : null,
                recursoHumano: titulo(proc.operario_nombre) || (plan ? titulo(`${plan.nombre_operario ?? ""} ${plan.apellido_operario ?? ""}`) : ""),
                recursoMaquinaria: plan?.nombre_maquinaria ?? "",
            });
        }
    }
    return salida;
}

/** Los pasos de OT que todavía no tienen plan: sin horario ni maquinaria asignada. */
export const columnasPasos: ColumnaExport<PasoDelPlan>[] = [
    { titulo: "OT", tipo: "id", valor: (p) => p.ot },
    { titulo: "Cliente", valor: (p) => p.cliente },
    { titulo: "Paso", tipo: "entero", valor: (p) => p.paso },
    { titulo: "Proceso", valor: (p) => p.proceso },
    { titulo: "Estado", valor: (p) => p.estado },
    { titulo: "Min. est.", tipo: "entero", valor: (p) => p.minutos },
    { titulo: "Recurso humano", valor: (p) => p.recursoHumano },
];

export const columnasPasosDelPlan: ColumnaExport<PasoDelPlan>[] = [
    { titulo: "OT", tipo: "id", valor: (p) => p.ot },
    { titulo: "Cliente", valor: (p) => p.cliente },
    { titulo: "Paso", tipo: "entero", valor: (p) => p.paso },
    { titulo: "Proceso", valor: (p) => p.proceso },
    { titulo: "Estado", valor: (p) => p.estado },
    { titulo: "Inicio estimado", tipo: "fechaHora", valor: (p) => p.inicio },
    { titulo: "Fin estimado", tipo: "fechaHora", valor: (p) => p.fin },
    { titulo: "Min. est.", tipo: "entero", valor: (p) => p.minutos },
    { titulo: "Recurso humano", valor: (p) => p.recursoHumano },
    { titulo: "Recurso maquinaria", valor: (p) => p.recursoMaquinaria },
];
