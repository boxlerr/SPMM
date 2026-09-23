/**
 * El viaje de un aviso del plan hasta la fila de Recursos que hay que tocar.
 *
 * «Ir a arreglarlo» arma un link (`enlaceARecursos`) y Recursos lo lee del otro lado
 * (`leerRangosDelLink`, `siguientePendiente`, `comoSeHace`). El formato del link es un
 * contrato entre dos pantallas que no se importan una a la otra, y por eso las dos
 * mitades viven juntas acá: con cada una escribiendo la suya, un parámetro nuevo de un
 * lado quedaba sin leer del otro. Y acá se pueden probar sin navegador:
 * `backend/tests/test_aviso_en_recursos_front.py` compila este archivo y lo corre.
 *
 * Lo que viaja:
 *  - `tab`: la solapa. `foco`: los ids de las filas del aviso, separados por coma.
 *  - `rangos`: los rangos que el aviso le SUMA a esas filas, para que el editor llegue
 *    con eso ya tildado. `rangos.<id>` cuando no a todas les suma lo mismo.
 *  - `aviso` y `hacer`: el título del aviso y la solución, para el cartel de arriba.
 *  - `cambio`: qué clase de cambio es (ver `CambioDelAviso`), para que el cartel diga
 *    dónde se hace ESE cambio y si el usuario tiene permiso para hacerlo.
 */
import type { AccionDeSolucion, ObjetivoDeAccion } from "./ajustesPlan";

export type SolapaDelAviso = "maquinas" | "procesos" | "operarios";

/**
 * Qué se vino a cambiar. No alcanza con la solapa: a Recurso humano se llega para
 * darle un rango a alguien, para volver a encenderle una habilidad, para cargarle una
 * a mano o para marcarlo ausente, y cada cosa se hace en otro lado de la ficha. Y en
 * Procesos, los rangos y las máquinas piden permisos distintos.
 */
export type CambioDelAviso = "rangos" | "maquinas" | "skill_nativa" | "habilidad" | "disponibilidad";

const CAMBIOS: CambioDelAviso[] = ["rangos", "maquinas", "skill_nativa", "habilidad", "disponibilidad"];

/** Lo que el link necesita de una solución. Es la forma de `DiagnosticoSolucion`. */
export interface SolucionConDestino {
    texto: string;
    donde: string;
    accion?: AccionDeSolucion | null;
    objetivo?: {
        tipo: "proceso" | "maquinaria" | "operario";
        id: number;
        nombre: string;
        rangos?: number[];
    } | null;
}

/**
 * A qué solapa de Recursos apunta un "dónde", o null si la solución no se hace en
 * Recursos ("Al elegir las OTs", "Operaciones › abrí la OT…", o vacío).
 *
 * "operario" sigue estando porque el backend se despliega a mano y a destiempo del
 * frontend: hasta que salga el deploy, los avisos llegan con el nombre viejo y el
 * link tiene que andar igual.
 */
export function pestaniaDe(donde: string): SolapaDelAviso | null {
    const d = (donde || "").toLowerCase();
    if (!d.startsWith("recursos")) return null;
    return d.includes("maquinaria") ? "maquinas"
        : d.includes("proceso") ? "procesos"
            : (d.includes("humano") || d.includes("operario")) ? "operarios"
                : null;
}

/**
 * El texto de la solución para leerlo suelto, arriba de Recursos.
 *
 * Sin los ** del resaltado (allá es texto plano) y sin el «O » con que el backend
 * encadena la segunda opción en adelante (`_como_alternativa`): en el aviso se lee
 * debajo de la primera, pero en el cartel de Recursos va sola, y «Qué hacer: O dale
 * OFICIAL a alguien más» era una alternativa a nada.
 */
export function sinAlternativa(texto?: string | null): string {
    const t = (texto || "").replace(/\*\*/g, "").trim();
    const sinO = t.replace(/^O\s+/, "");
    return sinO === t ? t : sinO.charAt(0).toUpperCase() + sinO.slice(1);
}

const plano = (t: string) =>
    (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Qué clase de cambio pide la solución.
 *
 * Con botón se sabe por la acción. Sin botón, lo dice el texto —el backend no manda
 * otra cosa—, y se lee con palabras que usan todos los avisos de cada tipo. Si no se
 * reconoce, null: Recursos cae en la explicación general de la solapa.
 */
export function cambioDeLaSolucion(sol: SolucionConDestino): CambioDelAviso | null {
    if (sol.accion?.tipo === "skill_nativa") return "skill_nativa";
    // La acción de proceso y la de máquina hacen lo mismo: cargarle rangos.
    if (sol.accion) return "rangos";
    if (sol.objetivo?.rangos?.length) return "rangos";
    const t = plano(sinAlternativa(sol.texto));
    if (t.includes("no disponible")) return "disponibilidad";
    if (t.includes("habilidad a mano")) return "habilidad";
    if (t.includes("encende")) return "skill_nativa";
    if (t.includes("en que maquina")) return "maquinas";
    // «Dale OFICIAL a quien maneja…», «Sumale MEDIO OFICIAL al proceso…»: el nombre del
    // rango va en mayúsculas y la palabra «rango» no aparece.
    if (/\brango/.test(t) || /^(dale|sumale|ponele|agregale|cargale)\b/.test(t)) return "rangos";
    return null;
}

/**
 * Los rangos que el aviso le SUMA a un objetivo, en ids.
 *
 * `rangos` de la acción es el conjunto FINAL: lo que la máquina tenía al calcular el
 * plan más lo nuevo. Mandar eso hacía que Recursos tildara como «propuesto por el
 * aviso» un rango que alguien le sacó a la máquina a propósito después de calcular
 * (desde un borrador de ayer, por ejemplo): estaba en el final porque la máquina lo
 * tenía, no porque el aviso lo pidiera.
 *
 *  1. Si el backend manda `suma_ids`, es exactamente eso.
 *  2. Si manda `suma` en nombres (los avisos anteriores al 23/09/2026), del final
 *     quedan los que se llaman como algo de `suma`.
 *  3. Si no manda nada, el final. Recursos igual le saca lo que la máquina tiene hoy,
 *     así que no propone de más; lo que no puede saber es qué le sacaron después.
 */
export function rangosQueSuma(
    o: ObjetivoDeAccion,
    accion: AccionDeSolucion,
    nombreDeRango?: (id: number) => string,
): number[] {
    if (Array.isArray(o.suma_ids)) return [...o.suma_ids];
    const final = o.rangos ?? accion.rangos ?? [];
    if (Array.isArray(o.suma) && nombreDeRango) {
        const suma = new Set(o.suma.map((n) => (n || "").trim()));
        return final.filter((r) => suma.has((nombreDeRango(r) || "").trim()));
    }
    return [...final];
}

const lista = (ids: number[]) => ids.join(",");

/**
 * A dónde manda el "dónde" del aviso, o null si no se hace en Recursos.
 *
 * Antes esto era un `<span>` gris que decía "Recursos › Procesos" y no hacía nada:
 * había que salir, encontrar la pantalla, elegir la pestaña, buscar el proceso
 * entre 414 y recién ahí desplegar la fila. Ahora el link deja todo eso hecho.
 *
 * El `foco` va POR ID y nada más. Hasta el 23/09/2026 viajaba también el nombre
 * (`q`) para precargar el buscador de Recursos, y ese nombre es el del aviso, que el
 * backend escribe «bonito» (`_bonito`: «Preparación de pintura», con tilde) mientras
 * el catálogo lo tiene como vino del legacy («PREPARACION DE PINTURA»). El buscador
 * no encontraba nada y Lucas caía en una pantalla que decía «No se encontraron
 * procesos» y nada más. Ahora Recursos filtra por el id, que no se escribe de dos
 * maneras.
 *
 * Con VARIOS objetivos (las tres fresadoras) van todos: Recursos muestra esos y
 * nada más, con un botón para ver el resto. Antes se abría la pestaña entera y
 * había que encontrar las tres entre treinta máquinas.
 *
 * Los rangos van en `rangos` si a todos les suma lo mismo, y uno por fila
 * (`rangos.<id>`) si no: con una sola lista para todos, a una máquina se le proponía
 * lo que le faltaba a otra.
 */
export function enlaceARecursos(
    sol: SolucionConDestino,
    titulo?: string | null,
    nombreDeRango?: (id: number) => string,
): string | null {
    const pestania = pestaniaDe(sol.donde);
    if (!pestania) return null;

    const params = new URLSearchParams({ tab: pestania });
    const aviso = (titulo || "").replace(/\*\*/g, "").trim();
    const hacer = sinAlternativa(sol.texto);
    if (aviso) params.set("aviso", aviso);
    if (hacer) params.set("hacer", hacer);
    const cambio = cambioDeLaSolucion(sol);
    if (cambio) params.set("cambio", cambio);

    const { accion, objetivo } = sol;

    // Sin acción no había a dónde apuntar y el link caía en la lista entera. El
    // `objetivo` es lo mismo pero sin botón: dice a qué fila ir, no qué cambiar.
    if (!accion && objetivo) {
        const coincide =
            (objetivo.tipo === "maquinaria" && pestania === "maquinas") ||
            (objetivo.tipo === "proceso" && pestania === "procesos") ||
            (objetivo.tipo === "operario" && pestania === "operarios");
        if (coincide) {
            params.set("foco", String(objetivo.id));
            // Acá `rangos` ya son los PROPUESTOS (un proceso sin rango: todo es nuevo).
            if (objetivo.rangos?.length) params.set("rangos", lista(objetivo.rangos));
        }
        return `/recursos?${params.toString()}`;
    }

    if (!accion) return `/recursos?${params.toString()}`;

    // El objetivo de una skill_nativa es el operario; en los otros casos, el
    // proceso o la máquina que se va a tocar.
    const objetivos: ObjetivoDeAccion[] = accion.objetivos?.length
        ? accion.objetivos
        : [{ id: accion.id, nombre: accion.nombre, rangos: accion.rangos }];
    const clave = accion.tipo === "maquinaria" ? "maquinas"
        : accion.tipo === "skill_nativa" ? "operarios"
            : "procesos";
    // La pestaña del link manda sobre el tipo de la acción: hay soluciones de tipo
    // "proceso" cuyo "dónde" es Maquinarias, y ahí el id no aplica.
    if (clave !== pestania) return `/recursos?${params.toString()}`;

    params.set("foco", lista(objetivos.map((o) => o.id)));
    // La skill nativa no lleva rangos.
    if (clave !== "operarios") {
        const porObjetivo = objetivos.map((o) => ({ id: o.id, rangos: rangosQueSuma(o, accion, nombreDeRango) }));
        const iguales = porObjetivo.every((x) => lista([...x.rangos].sort((a, b) => a - b))
            === lista([...porObjetivo[0].rangos].sort((a, b) => a - b)));
        if (iguales) {
            if (porObjetivo[0].rangos.length) params.set("rangos", lista(porObjetivo[0].rangos));
        } else {
            porObjetivo.forEach((x) => {
                if (x.rangos.length) params.set(`rangos.${x.id}`, lista(x.rangos));
            });
        }
    }
    return `/recursos?${params.toString()}`;
}

/** Si un parámetro de la URL es de los que trae el link del aviso (para limpiarlos al entrar). */
export function esParamDelAviso(clave: string): boolean {
    return ["tab", "foco", "q", "rangos", "aviso", "hacer", "cambio"].includes(clave)
        || clave.startsWith("rangos.");
}

const ids = (texto: string | null) =>
    (texto || "")
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);

/** Los ids del `foco`, en el orden del aviso y sin repetidos. */
export function leerFocoDelLink(params: URLSearchParams): number[] {
    return Array.from(new Set(ids(params.get("foco"))));
}

/** El `cambio` del link, si es uno conocido. */
export function leerCambioDelLink(params: URLSearchParams): CambioDelAviso | null {
    const c = params.get("cambio");
    return c && (CAMBIOS as string[]).includes(c) ? (c as CambioDelAviso) : null;
}

/**
 * Qué rangos le propone el aviso a cada fila del foco, o null si no propone ninguno.
 *
 * `rangos.<id>` manda sobre `rangos`, que vale para todas (y es lo único que mandaban
 * los links de antes del 23/09/2026). Una fila sin nada queda afuera del mapa.
 */
export function leerRangosDelLink(params: URLSearchParams, foco: number[]): Record<number, number[]> | null {
    const comun = ids(params.get("rangos"));
    const salida: Record<number, number[]> = {};
    for (const id of foco) {
        const propios = params.has(`rangos.${id}`) ? ids(params.get(`rangos.${id}`)) : comun;
        if (propios.length) salida[id] = propios;
    }
    return Object.keys(salida).length ? salida : null;
}

/**
 * La próxima fila del aviso que falta, para abrirla al guardar la anterior; null si no
 * falta ninguna.
 *
 * Se busca a partir de la que se acaba de guardar y dando la vuelta: el aviso de la
 * FRESADORA CNC pide lo mismo en tres máquinas y nada obliga a hacerlas en orden. Con
 * «la que sigue en la lista», guardar la tercera primero no abría ninguna y se perdían
 * los rangos propuestos para las otras dos. `pendiente` decide qué falta (no guardada
 * y con algo para sumar).
 */
export function siguientePendiente(
    foco: number[],
    desde: number | null,
    pendiente: (id: number) => boolean,
): number | null {
    if (foco.length === 0) return null;
    const i = desde === null ? -1 : foco.indexOf(desde);
    for (let paso = 1; paso <= foco.length; paso++) {
        const id = foco[(i + paso + foco.length) % foco.length];
        if (id !== desde && pendiente(id)) return id;
    }
    return null;
}

/** Qué puede escribir quien mira, por solapa de Recursos (RF-24). */
export interface PermisosDeRecursos {
    personas: boolean;
    maquinas: boolean;
    procesos: boolean;
    /** Los rangos de una máquina o de un proceso: el backend pide la solapa Rangos. */
    rangos: boolean;
}

/**
 * Dónde se hace, en la solapa, lo que pide el aviso; o que con este usuario no se puede.
 *
 * Cada cambio se explica por separado y con el permiso que ESE cambio pide: los rangos
 * de una máquina o de un proceso son de la solapa Rangos, en qué máquina se hace un
 * proceso es de Procesos, y todo lo de una persona es de Recurso humano. Antes el texto
 * era uno por solapa: a quien venía a volver a encenderle una habilidad a alguien le
 * decía «Editar rangos», y a quien podía editar máquinas pero no rangos le decía que la
 * solapa era de solo lectura.
 */
export function comoSeHace(
    solapa: SolapaDelAviso,
    cambio: CambioDelAviso | null,
    puede: PermisosDeRecursos,
): string {
    const alguienCon = (seccion: string) => `lo tiene que hacer alguien con permiso para editar ${seccion}.`;

    if (solapa === "operarios") {
        if (!puede.personas) return `Con tu usuario no podés cambiar el recurso humano: ${alguienCon("Recurso humano")}`;
        switch (cambio) {
            case "skill_nativa":
                return "Tocá su fila para abrir la ficha y, en «Habilidades», volvé a encender el interruptor de ese proceso.";
            case "habilidad":
                return "Tocá la fila de quien lo vaya a hacer, después «Editar», y agregale el proceso en sus habilidades.";
            case "disponibilidad":
                return "Tocá su fila y, arriba de la ficha, pasalo de «Activo» a «Ausente».";
            case "rangos":
                return "Los rangos de una persona se cambian tocando su fila y después «Editar».";
            default:
                return "Todo lo de una persona se cambia en su ficha: tocá su fila, y «Editar» para los rangos y las habilidades a mano.";
        }
    }

    if (solapa === "maquinas") {
        // Lo único que un aviso pide de una máquina son rangos.
        if (puede.rangos) return "Los rangos de una máquina se cambian desde «Rangos», en su fila.";
        return puede.maquinas
            ? `Con tu usuario podés editar las máquinas pero no sus rangos: ${alguienCon("Rangos")}`
            : `Con tu usuario no podés cambiar los rangos de una máquina: ${alguienCon("Rangos")}`;
    }

    // Procesos: los rangos piden Rangos y las máquinas piden Procesos.
    const desplegando = "desplegando el proceso desde «Quién puede hacerlo», en su fila";
    if (cambio === "rangos") {
        if (puede.rangos) return `Los rangos se cambian ${desplegando}.`;
        return puede.procesos
            ? `Con tu usuario podés cargar en qué máquina se hace un proceso, pero no sus rangos: ${alguienCon("Rangos")}`
            : `Con tu usuario no podés cambiar los rangos de un proceso: ${alguienCon("Rangos")}`;
    }
    if (cambio === "maquinas") {
        if (puede.procesos) return `En qué máquina se hace se carga ${desplegando}.`;
        return `Con tu usuario no podés cargar en qué máquina se hace un proceso: ${alguienCon("Procesos")}`;
    }
    if (puede.rangos && puede.procesos) {
        return `Quién lo hace y en qué máquina se cambian ${desplegando}.`;
    }
    if (puede.rangos) return `Los rangos se cambian ${desplegando}. En qué máquina se hace no lo podés cambiar con tu usuario.`;
    if (puede.procesos) return `En qué máquina se hace se carga ${desplegando}. Los rangos no los podés cambiar con tu usuario.`;
    return "Con tu usuario esta solapa es de solo lectura: el cambio lo tiene que hacer alguien con permiso para editarla.";
}
