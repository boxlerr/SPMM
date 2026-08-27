/**
 * Nombres del taller escritos como se escriben, y no A LOS GRITOS.
 *
 * El legacy guarda todo en mayúscula —"AGUJEREADORA DE BANCO BURANI", "GUSTAVO ROMERO",
 * "INDUSTRIAS CERAMICAS LOURDES S.A."— y así llegan a la pantalla. Julián, 27/08:
 * "normalizá todo, que arranque con mayúscula las palabras y luego minúsculas bien
 * escritas, no todo mayúsculas".
 *
 * Además de leerse mejor, ocupa menos: las minúsculas son más angostas que las
 * versalitas, así que un nombre largo pasa a entrar donde antes no entraba. Eso es lo
 * que permite mostrarlos COMPLETOS en vez de cortarlos con puntos suspensivos.
 *
 * Es el mismo criterio que ya usa el backend para los procesos (_bonito en
 * DiagnosticoPlanificacion.py): siglas y códigos quedan como están.
 */

/** Siglas del taller que NO son palabras: escritas como palabra dejan de reconocerse. */
const SIGLAS = new Set([
    "MIG", "MAG", "TIG", "CNC", "CNCC", "ELEC", "PU", "OT", "SA", "SRL", "SAIC", "CC",
]);

/**
 * Palabras de enlace: en castellano van en minúscula salvo que abran el nombre.
 * Sin esto quedaría "Agujereadora De Banco", que es title case en inglés y no se escribe así.
 */
const ENLACES = new Set(["de", "del", "la", "las", "el", "los", "y", "con", "en", "para", "por", "a"]);

function trozo(t: string, primero: boolean): string {
    const alto = t.toUpperCase();
    // Siglas y códigos de máquina (T1, F7CC, 450): tal cual.
    if (SIGLAS.has(alto.replace(/\./g, ""))) return alto;
    if (/\d/.test(t) && /[a-zA-Z]/.test(t)) return alto;
    const bajo = t.toLowerCase();
    if (!primero && ENLACES.has(bajo)) return bajo;
    return bajo.charAt(0).toUpperCase() + bajo.slice(1);
}

/** "AGUJEREADORA DE BANCO BURANI" → "Agujereadora de banco Burani" */
export function nombreLindo(texto?: string | null): string {
    if (!texto) return "";
    let primero = true;
    return texto
        .trim()
        .split(/\s+/)
        .map((palabra) =>
            palabra
                .split(/([/\-.])/)
                .map((t) => {
                    if (["/", "-", "."].includes(t)) return t;
                    if (!t) return t;
                    const r = trozo(t, primero);
                    primero = false;
                    return r;
                })
                .join("")
        )
        .join(" ");
}

/** "GUSTAVO" + "ROMERO" → "Gustavo Romero". Los apellidos no llevan enlaces en minúscula. */
export function nombrePersona(nombre?: string | null, apellido?: string | null): string {
    return [nombre, apellido]
        .filter(Boolean)
        .map((p) =>
            String(p)
                .trim()
                .split(/\s+/)
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                .join(" ")
        )
        .join(" ")
        .trim();
}
