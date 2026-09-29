/**
 * En qué máquina se hace un proceso, contado para la pantalla y para el Excel.
 *
 * Pedido de Julián (29/9/2026, en la reunión con Lucas): la fila de «FRESADORA F6» en
 * Recursos › Procesos decía quién puede hacerla y no en qué máquina.
 *
 * El dato casi no existe: de 415 procesos, 8 tienen la máquina cargada. El resto el
 * planificador lo resuelve deduciendo del nombre, y el backend (`MaquinasDelProceso.py`)
 * ahora manda esa resolución junto con cada proceso de la cobertura. Este archivo sólo
 * la traduce a lo que se dibuja; NO la recalcula: qué máquina le toca a qué proceso lo
 * decide el mismo código que planifica, en un solo lugar.
 *
 * Los campos nuevos son opcionales: con un backend sin deployar la fila se ve como antes
 * (las cargadas, o nada).
 */

export interface RefMaquina {
    id: number;
    nombre: string;
}

/** De dónde sale la lista. `sin_dato` = el backend todavía no manda la resolución. */
export type OrigenMaquinas = "cargada" | "nombre" | "a_mano" | "ninguna";
export type OrigenResumen = OrigenMaquinas | "sin_dato";

/** Por qué un proceso que usa máquina se queda sin ninguna. */
export type MotivoSinMaquina = "sin_familia" | "sin_maquina" | "rango";

/** Lo que la fila de la cobertura trae de máquinas (un subconjunto de `ProcesoCobertura`). */
export interface CoberturaDeMaquinas {
    maquinas?: RefMaquina[];
    maquinas_origen?: OrigenMaquinas;
    maquinas_efectivas?: RefMaquina[];
    maquinas_sin_rango?: RefMaquina[];
    maquinas_motivo?: MotivoSinMaquina | null;
}

export interface ResumenDeMaquinasDelProceso {
    origen: OrigenResumen;
    /** Las que se dibujan: las cargadas, o las que el planificador deduce del nombre. */
    maquinas: RefMaquina[];
    /** Entre las dibujadas, las que el rango del proceso NO acepta: el planificador no las usa. */
    sinRango: RefMaquina[];
    motivo: MotivoSinMaquina | null;
    /** Un proceso que va a mano pero tiene máquinas cargadas: el planificador las ignora. */
    cargadasSinUso: RefMaquina[];
}

export function resumenDeMaquinas(cob: CoberturaDeMaquinas): ResumenDeMaquinasDelProceso {
    const cargadas = cob.maquinas ?? [];
    const base = { maquinas: [], sinRango: [], motivo: null, cargadasSinUso: [] };
    switch (cob.maquinas_origen) {
        case "cargada":
            return { ...base, origen: "cargada", maquinas: cargadas, sinRango: cob.maquinas_sin_rango ?? [] };
        case "nombre":
            return { ...base, origen: "nombre", maquinas: cob.maquinas_efectivas ?? [] };
        case "a_mano":
            return { ...base, origen: "a_mano", cargadasSinUso: cargadas };
        case "ninguna":
            return { ...base, origen: "ninguna", motivo: cob.maquinas_motivo ?? null };
        default:
            // Backend sin los campos nuevos: lo único que se sabe son las cargadas.
            return cargadas.length > 0
                ? { ...base, origen: "cargada", maquinas: cargadas }
                : { ...base, origen: "sin_dato" };
    }
}

/** Una línea que dice de dónde sale la máquina de este proceso. Va en el Excel y el PDF. */
export function origenEnPalabras(r: ResumenDeMaquinasDelProceso): string {
    switch (r.origen) {
        case "cargada":
            return "Cargada en Recursos";
        case "nombre":
            return "Deducida del nombre del proceso";
        case "a_mano":
            return "No usa máquina";
        case "ninguna":
            return r.motivo === "rango"
                ? "Sin máquina: ninguna acepta el rango del proceso"
                : r.motivo === "sin_maquina"
                    ? "Sin máquina: el taller no tiene una de ese tipo"
                    : "Sin máquina: el nombre no dice en cuál se hace";
        default:
            return "";
    }
}

/** Las máquinas como texto corrido. Las que el rango no acepta van avisadas. */
export function maquinasEnPalabras(r: ResumenDeMaquinasDelProceso): string {
    const sinRango = new Set(r.sinRango.map((m) => m.id));
    return r.maquinas
        .map((m) => (sinRango.has(m.id) ? `${m.nombre} (su rango no la acepta)` : m.nombre))
        .join(", ");
}
