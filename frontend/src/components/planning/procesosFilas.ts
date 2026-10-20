/**
 * Las filas del editor de procesos (ProcesosEditor.tsx) y las reglas chicas sobre ellas,
 * en un archivo SIN la parte visual.
 *
 * Están separadas a propósito (20/10/2026): la fila «agregar proceso» de las listas de
 * Operaciones necesita `tieneMinutos` y `makeEmptyRow` desde el arranque, pero el editor
 * —con la librería de arrastrar y soltar— recién cuando se toca «agregar». Mientras
 * vivían en el mismo archivo, importar una función chica traía el editor entero al
 * JavaScript inicial de la pantalla. ProcesosEditor.tsx las reexporta: los que ya las
 * importaban de ahí siguen andando.
 */

/**
 * El valor del desplegable de máquina que significa «va a mano».
 *
 * Es un centinela y no un booleano aparte a propósito: en la pantalla es UNA elección
 * —o una máquina, o que elija el planificador, o ninguna—, así que tiene que ser un
 * solo control. Al guardar se traduce a `no_lleva_maquina`.
 */
export const SIN_MAQUINA = "no_lleva";

export interface ProcesoRow {
    /** id temporal de UI (no es el id de proceso) */
    id: string;
    /** id de la PASADA en la base (orden_trabajo_proceso.id) si la fila ya existe.
     *  Vacío = línea nueva. Sin esto, al editar una OT con el mismo proceso repetido
     *  no se sabe cuál fila es cuál y se pierde el estado/avance de las pasadas. */
    id_otp?: number;
    /** id del proceso del catálogo (string para los selects) */
    proceso_id: string;
    /** tiempo estimado en minutos */
    tiempo: string;
    /** operarios que requiere el proceso en simultáneo */
    cant_operarios: string;
    /** máquina preseleccionada; '' = sin preselección (planificador libre) */
    maquina_id: string;
    /** persona preseleccionada; '' = sin preselección (planificador libre) */
    operario_id: string;
    /** tilde incluir/excluir: sólo se guardan los tildados */
    incluido: boolean;
}

/**
 * Lo que el PLANIFICADOR asignó para una pasada. Informativo: no se guarda ni se edita.
 *
 * Es OTRA cosa que la preselección (`maquina_id` / `operario_id` de la fila): la
 * preselección es lo que alguien fuerza a mano, y una OT planificada normalmente la
 * tiene vacía. Abrir una OT ya planificada mostraba "Sin máquina" y "Sin asignar" en
 * todas las filas y parecía que se habían perdido los datos — estaba mirando el campo
 * equivocado (Julián, 10/09: "si abro una planificada quiero ver lo que está
 * planificado ya asignado, así no duplico ni hubo errores").
 */
export interface PlanificadoDeLinea {
    operario: string | null;
    maquinaria: string | null;
    sin_asignar: boolean;
    sin_maquinaria: boolean;
    forzado: boolean;
    lote: string | null;
}

export interface ProcesoCatalogoItem { id: number; nombre: string; }
export interface MaquinaCatalogoItem { id: number; nombre: string; cod_maquina?: string; }
export interface OperarioCatalogoItem { id: number; nombre: string; apellido?: string; }

/**
 * ¿Este paso tiene minutos cargados de verdad?
 *
 * Existe porque las tres pantallas que guardan procesos hacían el control con
 * `if (!fila.tiempo)`, y en JavaScript **el string "0" es verdadero**: un paso con
 * cero minutos pasaba el control y se guardaba. Medido en producción el 15/09: 82
 * pasos de las órdenes abiertas quedaron en 0, nueve de ellos en una sola OT.
 *
 * Y no es inofensivo: el planificador hace `dur_min = tiempo_proceso or 1`, así que
 * un paso en cero entra al plan como UN MINUTO de trabajo. Ocupa a una persona y una
 * máquina por un minuto, sale impreso en la hoja del pañol sin tiempo, y el plan
 * queda más corto de lo que el taller va a tardar de verdad — sin que nada avise.
 *
 * Vive acá, al lado de ProcesoRow, para que las tres pantallas usen la misma regla.
 */
export const tieneMinutos = (tiempo: string): boolean => {
    const n = Number(String(tiempo ?? "").trim());
    return Number.isFinite(n) && n > 0;
};

/** Los pasos que van a guardarse y NO tienen minutos. Vacío = está todo bien. */
export const pasosSinMinutos = (rows: ProcesoRow[]): ProcesoRow[] =>
    rows.filter((r) => r.incluido && r.proceso_id && !tieneMinutos(r.tiempo));

export function makeEmptyRow(): ProcesoRow {
    return {
        id: Math.random().toString(36).slice(2),
        proceso_id: "",
        tiempo: "",
        cant_operarios: "1",
        maquina_id: "",
        operario_id: "",
        incluido: true,
    };
}
