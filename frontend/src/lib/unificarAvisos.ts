/**
 * Un proceso y su preparación trabados por lo mismo son UN aviso, no dos.
 *
 * Julián, 25/09/2026, mirando la vista previa: salían «Prensa: sus 3 máquinas no
 * aceptan el rango que pide» y «Preparación de prensa: …» como dos tarjetas con la
 * misma causa y el mismo arreglo. Arregló una, se fueron las dos, y la tira verde
 * mostró dos «Se arregló», la segunda con un motivo inventado.
 *
 * Por qué son la misma traba: el solver empareja cada preparación con la producción
 * de su familia y le PISA la familia y los rangos con los de esa producción
 * (`_partir_y_heredar` en PlanificacionService). Las máquinas candidatas, lo que
 * tienen y lo que se les pide son idénticos, y el arreglo sobre la producción destraba
 * las dos. Peor: los botones «ponele X al proceso» de la tarjeta de la preparación
 * escriben en la ficha de la preparación, que el solver ignora por esa misma herencia.
 *
 * El backend agrupa por proceso del catálogo y no sabe de esto, así que se une acá.
 * Se une SOLO el caso probado —«pidió máquina y ninguna acepta el rango», causa
 * `rango_maquina`— y solo cuando no hay duda: misma severidad, mismo tiene/pide, la
 * misma acción sobre las máquinas, las OT de la preparación dentro de las de la
 * producción y UNA sola producción candidata. Si hay dos candidatas no se adivina: el
 * aviso queda como venía. Si se une mal, lo peor que pasa es que después de arreglar
 * la producción la preparación vuelve a aparecer sola, con su propio id.
 *
 * Arreglo de fondo, para después del piloto: que el backend los empareje con
 * `_pares_setup_produccion` al armar el aviso. Entonces esto deja de encontrar pares
 * y no hace nada.
 */
import type { Diagnostico, PasoDelAviso } from "@/components/planning/DiagnosticosPlan";
import { claveDeAjuste } from "@/lib/ajustesPlan";
import { MIN_LABORAL_DIA } from "@/lib/plan-fechas";

/** Mayúsculas, sin tildes y con un solo espacio: el `_norm` del backend. */
const normalizar = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim().replace(/\s+/g, " ");

/**
 * Si el proceso es una preparación. Espejo de `_get_tipo_proceso` (SETUP) del
 * backend: si allá cambia la regla, acá tiene que cambiar igual.
 */
export function esPreparacion(nombre: string): boolean {
    const n = normalizar(nombre);
    return n.startsWith("PREPARACION") || n.startsWith("CAMBIO DE") || n.includes("SETUP") || n.includes("PROGRAM");
}

/** «Prensa» de «Prensa: sus 3 máquinas no aceptan el rango que pide». */
const sujeto = (d: Diagnostico) => {
    const i = d.titulo.indexOf(":");
    return (i >= 0 ? d.titulo.slice(0, i) : d.titulo).trim();
};
const restoDelTitulo = (d: Diagnostico) => {
    const i = d.titulo.indexOf(":");
    return i >= 0 ? d.titulo.slice(i + 1).trim() : "";
};

/**
 * La traba de rango de máquina. `causa` la manda el backend desde el 17/09; un
 * borrador anterior no la trae, y ahí se reconoce por el título, que es fijo.
 */
const esTrabaDeRango = (d: Diagnostico) =>
    d.tipo === "maquina_incompatible" &&
    (d.causa ? d.causa === "rango_maquina" : /no aceptan? el rango que pide$/.test(d.titulo.trim()));

/** Qué les hace a las máquinas el arreglo del aviso: mismas máquinas y mismos rangos. */
const claveDeMaquinas = (d: Diagnostico) => {
    const s = d.soluciones.find((x) => x.accion?.tipo === "maquinaria");
    return s?.accion ? claveDeAjuste(s.accion) : "";
};

/** Tiempo en lenguaje de taller. Espejo de `_corto` del backend, para rearmar el resumen. */
function corto(minutos: number): string {
    if (minutos < 60) return `${minutos} min`;
    if (minutos < MIN_LABORAL_DIA) {
        const h = Math.floor(minutos / 60);
        const m = minutos % 60;
        return m ? `${h}h ${String(m).padStart(2, "0")}m` : `${h}h`;
    }
    const j = minutos / MIN_LABORAL_DIA;
    return `${Math.round(j)} jornada${j >= 1.5 ? "s" : ""}`;
}

/** Si la preparación `s` es la misma traba que la producción `p`. */
function mismaTraba(s: Diagnostico, p: Diagnostico): boolean {
    if (!esTrabaDeRango(p) || esPreparacion(sujeto(p))) return false;
    if (s.severidad !== p.severidad) return false;
    if ((s.tiene ?? "") !== (p.tiene ?? "") || (s.pide ?? "") !== (p.pide ?? "")) return false;
    if (claveDeMaquinas(s) !== claveDeMaquinas(p)) return false;
    // El emparejamiento del solver es dentro de la OT: una preparación de una OT
    // donde no está esa producción no hereda nada de ella.
    const otsP = new Set(p.impacto.ots);
    return s.impacto.ots.every((ot) => otsP.has(ot));
}

const paso = (d: Diagnostico): PasoDelAviso => ({
    nombre: sujeto(d),
    procesos: d.impacto.procesos,
    ots: d.impacto.ots,
    minutos: d.impacto.minutos,
});

/**
 * La producción con sus preparaciones adentro.
 *
 * Se queda con TODO lo de la producción —id, soluciones en el mismo orden, detalle,
 * tiene/pide—: las claves de «Guardar en Recursos» son `${id}-${índice}` y los
 * ajustes de este plan se reconocen por lo que tocan, así que nada de eso se corre.
 * Las soluciones de la preparación se tiran: la de máquina es la misma y la de
 * proceso es consejo muerto.
 */
function fusionar(p: Diagnostico, preps: Diagnostico[]): Diagnostico {
    const todos = [p, ...preps];
    const procesos = todos.reduce((n, d) => n + d.impacto.procesos, 0);
    const minutos = todos.reduce((n, d) => n + d.impacto.minutos, 0);
    const ots = Array.from(new Set(todos.flatMap((d) => d.impacto.ots))).sort((a, b) => a - b);
    const resto = restoDelTitulo(p);
    const cabeza = `${sujeto(p)} y ${preps.length === 1 ? "su preparación" : "sus preparaciones"}`;
    return {
        ...p,
        titulo: resto ? `${cabeza}: ${resto}` : cabeza,
        impacto: {
            procesos,
            ots,
            minutos,
            resumen: `${procesos} ${procesos === 1 ? "proceso" : "procesos"} · ${ots.length} OT · ${corto(minutos)}`,
        },
        pasos: todos.map(paso),
        absorbidos: preps.map((d) => d.id),
        tituloPropio: p.titulo,
    };
}

/**
 * La lista con cada preparación adentro del aviso de su producción, cuando son la
 * misma traba sin lugar a dudas. El resto queda igual y en el mismo orden.
 *
 * Pura y barata: la pantalla la llama dentro de un `useMemo`, y eso importa porque
 * el panel limpia la confirmación de «Guardar en Recursos» cada vez que cambia la
 * identidad de la lista.
 */
export function unificarPreparaciones(lista: Diagnostico[]): Diagnostico[] {
    const candidatas = lista.filter(esTrabaDeRango);
    if (candidatas.length < 2) return lista;

    // preparación → la única producción con la que es la misma traba.
    const dueno = new Map<string, string>();
    for (const s of candidatas) {
        if (!esPreparacion(sujeto(s))) continue;
        const ps = candidatas.filter((p) => p !== s && mismaTraba(s, p));
        if (ps.length === 1) dueno.set(s.id, ps[0].id);
    }
    if (dueno.size === 0) return lista;

    const prepsDe = new Map<string, Diagnostico[]>();
    for (const d of lista) {
        const p = dueno.get(d.id);
        if (p) prepsDe.set(p, [...(prepsDe.get(p) ?? []), d]);
    }
    return lista
        .filter((d) => !dueno.has(d.id))
        .map((d) => (prepsDe.has(d.id) ? fusionar(d, prepsDe.get(d.id)!) : d));
}
