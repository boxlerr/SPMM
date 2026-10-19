/**
 * Las habilidades de TODO el equipo, de una (reunión con Lucas del 17/10/2026).
 *
 * Para entender por qué el plan del lunes 19 le dio la fresadora a Gustavo y no a Alejandro
 * había que abrir la ficha de cada persona. Julián: «un botón para exportar todas las skills
 * de una», para comparar con la planificación y para pasárselo a Claude.
 *
 * Sale de GET /planificacion/equipo, que arma lo mismo que mira el planificador: quién PUEDE
 * hacer cada proceso (su rango, o cargado a mano, salvo que se lo hayan apagado) y a quién
 * PREFIERE (SKILL 1, SKILL 2 y la posición en la lista). Sólo la gente disponible.
 */
import { API_URL } from "@/config";
import type { ColumnaExport, SeccionExport } from "@/lib/exportar";

export interface HabilidadDelEquipo {
    id_proceso: number;
    proceso: string;
    nivel: 1 | 2 | null;
    /** Posición dentro de su lista (0 = la primera). null = sin posición. */
    orden: number | null;
    /** «rango»: la da su rango. «a_mano»: cargada a mano en su ficha. */
    origen: "rango" | "a_mano";
    apagada: boolean;
    /** «SKILL 1», «SKILL 2», «Sabe (sin marcar)» o «Apagada (no la hace)». */
    prioridad: string;
}

export interface PersonaDelEquipo {
    id: number;
    nombre: string;
    categoria: string;
    rangos: string[];
    interpreta_planos: boolean;
    horario: string;
    habilidades: HabilidadDelEquipo[];
}

export interface MaquinaDelEquipo {
    id: number;
    nombre: string;
    tipo: string | null;
    familia: string | null;
    estado: string | null;
    rangos: string[];
    procesos: string[];
}

export interface Equipo {
    operarios: PersonaDelEquipo[];
    maquinas: MaquinaDelEquipo[];
}

/** Un error con un texto que se puede mostrar tal cual (ExportarMenu lo muestra así). */
function errorParaMostrar(texto: string): Error {
    return Object.assign(new Error(texto), { paraMostrar: true });
}

export async function pedirEquipo(): Promise<Equipo> {
    const token = typeof window === "undefined" ? null : localStorage.getItem("access_token");
    let res: Response;
    try {
        res = await fetch(`${API_URL}/planificacion/equipo`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
    } catch {
        throw errorParaMostrar("No se pudo hablar con el servidor para traer las habilidades. Probá de nuevo en unos segundos.");
    }
    if (res.status === 404) {
        // El servidor se actualiza a mano y la pantalla sale sola: puede llegar antes.
        throw errorParaMostrar("El servidor todavía no tiene esta exportación: falta actualizarlo.");
    }
    if (!res.ok) {
        throw errorParaMostrar("No se pudieron traer las habilidades del equipo. Probá de nuevo en unos segundos.");
    }
    const json = await res.json();
    const data = json?.data ?? json;
    return {
        operarios: Array.isArray(data?.operarios) ? data.operarios : [],
        maquinas: Array.isArray(data?.maquinas) ? data.maquinas : [],
    };
}

/** «Fresado convencional» en vez de «FRESADO CONVENCIONAL»: así se lee en los archivos. */
export function lindo(texto: string | null | undefined): string {
    const t = (texto ?? "").trim().toLowerCase();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

/** Una fila por persona y proceso. */
interface FilaPersona {
    persona: PersonaDelEquipo;
    habilidad: HabilidadDelEquipo;
}

/** Una fila por proceso: quién lo hace, por orden de preferencia. */
interface FilaProceso {
    proceso: string;
    skill1: string[];
    skill2: string[];
    sabe: string[];
    apagado: string[];
}

/** Los nombres de una lista de SKILL 1/2 en el orden de su posición. */
function enOrden(lista: { nombre: string; orden: number | null }[]): string[] {
    return lista
        .slice()
        .sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999) || a.nombre.localeCompare(b.nombre))
        .map((x) => x.nombre);
}

export function porProceso(equipo: Equipo): FilaProceso[] {
    const mapa = new Map<string, { s1: { nombre: string; orden: number | null }[]; s2: { nombre: string; orden: number | null }[]; sabe: string[]; apagado: string[] }>();
    for (const p of equipo.operarios) {
        for (const h of p.habilidades) {
            const fila = mapa.get(h.proceso) ?? { s1: [], s2: [], sabe: [], apagado: [] };
            if (h.apagada) fila.apagado.push(p.nombre);
            else if (h.nivel === 1) fila.s1.push({ nombre: p.nombre, orden: h.orden });
            else if (h.nivel === 2) fila.s2.push({ nombre: p.nombre, orden: h.orden });
            else fila.sabe.push(p.nombre);
            mapa.set(h.proceso, fila);
        }
    }
    return Array.from(mapa.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([proceso, f]) => ({
            proceso,
            skill1: enOrden(f.s1),
            skill2: enOrden(f.s2),
            sabe: f.sabe.sort(),
            apagado: f.apagado.sort(),
        }));
}

const COLUMNAS_PERSONA: ColumnaExport<FilaPersona>[] = [
    { titulo: "Persona", valor: (f) => f.persona.nombre },
    { titulo: "Rangos", valor: (f) => f.persona.rangos.join(", "), formatos: ["xlsx", "csv"] },
    { titulo: "Proceso", valor: (f) => lindo(f.habilidad.proceso) },
    { titulo: "Prioridad", valor: (f) => f.habilidad.prioridad },
    {
        titulo: "Posición",
        tipo: "entero",
        // Se cuenta desde 1, como se ve en la ficha. Sólo SKILL 1 y 2 tienen posición.
        valor: (f) => (f.habilidad.orden != null && !f.habilidad.apagada ? f.habilidad.orden + 1 : null),
    },
    {
        titulo: "Por qué la puede hacer",
        valor: (f) => (f.habilidad.origen === "a_mano" ? "Cargada a mano" : "Por su rango"),
    },
];

const COLUMNAS_PROCESO: ColumnaExport<FilaProceso>[] = [
    { titulo: "Proceso", valor: (f) => lindo(f.proceso) },
    { titulo: "SKILL 1 (en orden)", valor: (f) => f.skill1.join(", ") },
    { titulo: "SKILL 2 (en orden)", valor: (f) => f.skill2.join(", ") },
    { titulo: "Sabe, sin marcar", valor: (f) => f.sabe.join(", ") },
    { titulo: "Apagado (no lo hace)", valor: (f) => f.apagado.join(", ") },
];

const COLUMNAS_MAQUINA: ColumnaExport<MaquinaDelEquipo>[] = [
    { titulo: "Máquina", valor: (m) => m.nombre },
    { titulo: "Tipo", valor: (m) => m.tipo ?? m.familia ?? "" },
    { titulo: "La usan los rangos", valor: (m) => m.rangos.join(", ") },
    { titulo: "Procesos que se hacen ahí", valor: (m) => m.procesos.map(lindo).join(", ") },
];

/** Las tres tablas del archivo «Habilidades del equipo»: por persona, por proceso y máquinas. */
export function seccionesDelEquipo(equipo: Equipo): SeccionExport[] {
    const filas: FilaPersona[] = equipo.operarios.flatMap((persona) =>
        persona.habilidades.map((habilidad) => ({ persona, habilidad })));
    return [
        { titulo: "Por persona", filas, columnas: COLUMNAS_PERSONA },
        { titulo: "Por proceso", filas: porProceso(equipo), columnas: COLUMNAS_PROCESO },
        { titulo: "Máquinas", filas: equipo.maquinas, columnas: COLUMNAS_MAQUINA },
    ];
}
