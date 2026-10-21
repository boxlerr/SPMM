/**
 * Los recursos del taller —personas y máquinas— para organizar la producción con una IA.
 *
 * Lucas, 21/10/2026: «un reporte de recursos de la empresa, sencillo y exportable a Excel»:
 * las personas disponibles con sus habilidades, sus horas por día y sus días por semana; las
 * máquinas, qué procesos hace cada una y cuándo están. Va junto con el reporte «OT pendientes
 * con sus procesos»: la IA cruza los dos y propone un cronograma.
 *
 * Sale de GET /planificacion/recursos (backend/application/RecursosService.py), que dice lo
 * mismo que mira el planificador: las horas con el horario de cada uno, efectivas; los
 * procesos de cada máquina cargados o deducidos de su tipo; quién la puede usar por su rango.
 *
 * Se importa recién al tocar el botón (components/reportes/ExportarRecursos): nada de esto
 * viaja al abrir el Dashboard ni Recursos.
 */
import { API_URL } from "@/config";
import { lindo, seccionesDelEquipo, type PersonaDelEquipo } from "@/lib/equipo";
import type { ColumnaExport, SeccionExport } from "@/lib/exportar";
import { COMO_DECIDE, diaCorto } from "@/lib/paraClaude";

export interface AusenciaCargada {
    desde: string;
    /** El último día que falta. null = sigue ausente. */
    hasta: string | null;
    motivo: string | null;
}

export interface PersonaRecurso extends PersonaDelEquipo {
    dias: string[];
    dias_por_semana: number;
    /** De lunes a viernes, efectivas: sin desayuno ni almuerzo. */
    horas_por_dia: number;
    /** null = no trabaja los sábados. */
    horas_sabado: number | null;
    horas_por_semana: number;
    ausencias: AusenciaCargada[];
}

export interface MaquinaRecurso {
    id: number;
    nombre: string;
    tipo: string | null;
    estado: string | null;
    disponible: boolean;
    procesos: string[];
    rangos: string[];
    personas: string[];
}

export interface FeriadoRecurso {
    fecha: string;
    nombre: string;
    tipo: string;
    se_trabaja: boolean;
    texto: string;
}

export interface Recursos {
    generado: string;
    /** Hasta qué día se miraron las ausencias y los feriados. */
    hasta: string;
    jornada: { texto: string; horas_por_dia: number; horas_sabado: number; sabado_con_gente: boolean };
    personas: PersonaRecurso[];
    maquinas: MaquinaRecurso[];
    feriados: FeriadoRecurso[];
    resumen: { personas: number; horas_por_semana: number; maquinas: number; maquinas_disponibles: number };
}

/** Un error con un texto que se puede mostrar tal cual (ExportarMenu lo muestra así). */
function errorParaMostrar(texto: string): Error {
    return Object.assign(new Error(texto), { paraMostrar: true });
}

export async function pedirRecursos(): Promise<Recursos> {
    const token = typeof window === "undefined" ? null : localStorage.getItem("access_token");
    let res: Response;
    try {
        res = await fetch(`${API_URL}/planificacion/recursos`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
    } catch {
        throw errorParaMostrar("No se pudo hablar con el servidor para traer los recursos. Probá de nuevo en unos segundos.");
    }
    if (res.status === 404) {
        // El servidor se actualiza a mano y la pantalla sale sola: puede llegar antes.
        throw errorParaMostrar("El servidor todavía no tiene esta exportación: falta actualizarlo.");
    }
    if (res.status === 403) {
        throw errorParaMostrar("Para bajar los recursos hace falta poder ver Operaciones o Recursos.");
    }
    if (!res.ok) {
        throw errorParaMostrar("No se pudieron traer los recursos del taller. Probá de nuevo en unos segundos.");
    }
    const json = await res.json();
    const d = json?.data ?? json;
    return {
        ...d,
        personas: Array.isArray(d?.personas) ? d.personas : [],
        maquinas: Array.isArray(d?.maquinas) ? d.maquinas : [],
        feriados: Array.isArray(d?.feriados) ? d.feriados : [],
    };
}

// ─────────────────────────── cómo se dice cada cosa ───────────────────────────

/** «lun a vie» / «lun a sáb» / «lun, mié, vie». */
export function diasEnPalabras(dias: string[]): string {
    const lista = dias.join(",");
    if (lista === "lun,mar,mié,jue,vie") return "lun a vie";
    if (lista === "lun,mar,mié,jue,vie,sáb") return "lun a sáb";
    return dias.join(", ");
}

/** «2026-10-26» → «26/10/2026». */
export function fechaLarga(iso: string | null | undefined): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
    return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** «del 26/10/2026 al 30/10/2026 (Vacaciones)» / «desde el 21/10/2026, sin fecha de vuelta». */
export function ausenciaEnPalabras(a: AusenciaCargada): string {
    const cuando = a.hasta
        ? (a.hasta === a.desde ? `el ${fechaLarga(a.desde)}` : `del ${fechaLarga(a.desde)} al ${fechaLarga(a.hasta)}`)
        : `desde el ${fechaLarga(a.desde)}, sin fecha de vuelta`;
    return a.motivo ? `${cuando} (${a.motivo})` : cuando;
}

/** Las habilidades de una persona, de un nivel, en el orden en que la prefiere el planificador. */
export function habilidadesDe(p: PersonaDelEquipo, que: "skill1" | "skill2" | "sabe" | "no"): string[] {
    return p.habilidades
        .filter((h) => {
            if (que === "no") return h.apagada;
            if (h.apagada) return false;
            if (que === "skill1") return h.nivel === 1;
            if (que === "skill2") return h.nivel === 2;
            return h.nivel == null;
        })
        .map((h) => lindo(h.proceso));
}

/** Lo que dice la máquina sobre su horario: no tiene uno propio. */
export const HORARIO_DE_MAQUINA = "Sin horario propio: trabaja en la jornada de quien la usa";

// ─────────────────────────── el archivo ───────────────────────────

const COLUMNAS_PERSONA: ColumnaExport<PersonaRecurso>[] = [
    { titulo: "Persona", valor: (p) => p.nombre },
    { titulo: "Categoría", valor: (p) => p.categoria },
    { titulo: "Rangos", valor: (p) => p.rangos.join(", ") },
    { titulo: "Lee planos", valor: (p) => (p.interpreta_planos ? "Sí" : "No") },
    { titulo: "Días que trabaja", valor: (p) => diasEnPalabras(p.dias) },
    { titulo: "Horario", valor: (p) => p.horario },
    { titulo: "Horas por día", tipo: "numero", decimales: 2, valor: (p) => p.horas_por_dia },
    { titulo: "Horas el sábado", tipo: "numero", decimales: 2, valor: (p) => p.horas_sabado },
    { titulo: "Horas por semana", tipo: "numero", decimales: 2, valor: (p) => p.horas_por_semana },
    { titulo: "SKILL 1 (en orden)", valor: (p) => habilidadesDe(p, "skill1").join(", ") },
    { titulo: "SKILL 2 (en orden)", valor: (p) => habilidadesDe(p, "skill2").join(", ") },
    { titulo: "También sabe", valor: (p) => habilidadesDe(p, "sabe").join(", ") },
    { titulo: "No hace", valor: (p) => habilidadesDe(p, "no").join(", ") },
    { titulo: "Ausencias cargadas", valor: (p) => p.ausencias.map(ausenciaEnPalabras).join("; ") },
];

const COLUMNAS_MAQUINA: ColumnaExport<MaquinaRecurso>[] = [
    { titulo: "Máquina", valor: (m) => m.nombre },
    { titulo: "Tipo", valor: (m) => m.tipo },
    { titulo: "Estado", valor: (m) => m.estado },
    { titulo: "Disponible", valor: (m) => (m.disponible ? "Sí" : "No") },
    { titulo: "Procesos que hace", valor: (m) => m.procesos.map(lindo).join(", ") },
    { titulo: "La pueden usar", valor: (m) => m.personas.join(", ") },
    { titulo: "Rangos que la habilitan", valor: (m) => m.rangos.join(", "), formatos: ["xlsx", "csv"] },
    { titulo: "Horario", valor: () => HORARIO_DE_MAQUINA, formatos: ["xlsx", "csv"] },
];

const COLUMNAS_FERIADO: ColumnaExport<FeriadoRecurso>[] = [
    { titulo: "Fecha", tipo: "fecha", valor: (f) => f.fecha },
    { titulo: "Feriado", valor: (f) => f.nombre },
    { titulo: "¿Se trabaja?", valor: (f) => f.texto },
];

/** Las tablas del archivo «Recursos del taller». */
export function seccionesDeRecursos(r: Recursos): SeccionExport[] {
    // Las dos tablas de habilidades son las de «Habilidades del equipo» (lib/equipo): una
    // fila por persona y proceso, y quién hace cada proceso en orden de preferencia.
    const [porPersona, porProceso] = seccionesDelEquipo({ operarios: r.personas, maquinas: [] });
    return [
        { titulo: "Personas", filas: r.personas, columnas: COLUMNAS_PERSONA },
        { titulo: "Máquinas", filas: r.maquinas, columnas: COLUMNAS_MAQUINA },
        { ...porPersona, titulo: "Habilidades" },
        { ...porProceso, titulo: "Quién hace cada proceso" },
        { titulo: "Feriados", filas: r.feriados, columnas: COLUMNAS_FERIADO },
    ];
}

const horas = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });

/** Los renglones de «Para tener en cuenta» del archivo: la jornada, el total y el alcance. */
export function renglonesDeRecursos(r: Recursos): string[] {
    const j = r.jornada;
    return [
        `Jornada del taller: ${j.texto}. Son ${horas(j.horas_por_dia)} h efectivas por día (sin desayuno ni almuerzo)` +
            `; el sábado, ${horas(j.horas_sabado)} h, sólo para quien lo tiene en su horario` +
            (j.sabado_con_gente ? "." : " (hoy nadie)."),
        `Personas disponibles: ${r.resumen.personas}, ${horas(r.resumen.horas_por_semana)} h por semana entre todas. Las horas son las de su horario, como las cuenta el planificador.`,
        `Máquinas: ${r.resumen.maquinas} (${r.resumen.maquinas_disponibles} operativas). ${HORARIO_DE_MAQUINA}, y sólo la usa quien tiene un rango que la habilita.`,
        `Procesos de cada máquina: los cargados en Recursos y, si no hay, los que el planificador deduce de su tipo.`,
        `Ausencias y feriados: hasta el ${fechaLarga(r.hasta)}.`,
    ];
}

// ─────────────────────────── el texto para la IA ───────────────────────────

/**
 * Lo mismo en Markdown, para subirlo a Claude (o a otra IA) junto con el reporte «OT
 * pendientes con sus procesos». Como el resto de lib/paraClaude: renglones y no una tabla,
 * porque así la IA lo lee mejor, con las reglas del planificador al final.
 */
export function textoDeRecursosParaClaude(r: Recursos): string {
    const renglones: string[] = [
        "# Recursos de Metalúrgica Longchamps: personas y máquinas",
        "",
        "Para organizar la producción. Va junto con el archivo de las OT pendientes y sus procesos (Metlosys › Dashboard › Reportes › «OT pendientes, un proceso por fila» o «OT pendientes con sus procesos»): con los dos se puede ver la capacidad, repartir los trabajos, asignar personas y máquinas y proponer un cronograma. Los minutos de cada proceso están en el de las OT.",
        "",
        "## Para tener en cuenta",
        "",
        ...renglonesDeRecursos(r).map((x) => `- ${x}`),
        "",
        `## Personas (${r.resumen.personas})`,
        "",
    ];
    for (const p of r.personas) {
        const rangos = p.rangos.join(", ");
        const datos = [
            // La categoría suele ser el mismo rango («OFICIAL · OFICIAL»): una vez alcanza.
            p.categoria !== rangos ? p.categoria : null, rangos, p.interpreta_planos ? "lee planos" : "no lee planos",
            `${p.horario} (${horas(p.horas_por_dia)} h efectivas por día` +
                (p.horas_sabado != null ? `, ${horas(p.horas_sabado)} h el sábado` : "") +
                `, ${horas(p.horas_por_semana)} h por semana)`,
        ].filter(Boolean).join(" · ");
        renglones.push(`### ${p.nombre}`, datos);
        const lista = (titulo: string, que: Parameters<typeof habilidadesDe>[1]) => {
            const h = habilidadesDe(p, que);
            if (h.length) renglones.push(`- ${titulo}: ${h.join(", ")}`);
        };
        lista("SKILL 1 (la prefiere, en orden)", "skill1");
        lista("SKILL 2 (en orden)", "skill2");
        lista("También sabe", "sabe");
        lista("No hace", "no");
        if (p.ausencias.length) renglones.push(`- Ausencias cargadas: ${p.ausencias.map(ausenciaEnPalabras).join("; ")}`);
        renglones.push("");
    }
    renglones.push(`## Máquinas (${r.resumen.maquinas}, ${r.resumen.maquinas_disponibles} operativas)`, "",
        `${HORARIO_DE_MAQUINA}. Cada una la puede usar sólo quien tiene un rango que la habilita.`, "");
    for (const m of r.maquinas) {
        const partes = [
            m.tipo, m.estado,
            m.procesos.length ? `procesos: ${m.procesos.map(lindo).join(", ")}` : "sin procesos asignados",
            m.personas.length ? `la pueden usar: ${m.personas.join(", ")}` : "no la puede usar nadie del equipo disponible",
        ].filter(Boolean);
        renglones.push(`- **${m.nombre}** — ${partes.join(" · ")}`);
    }
    renglones.push("", "## Feriados", "");
    if (r.feriados.length) {
        for (const f of r.feriados) renglones.push(`- ${diaCorto(f.fecha)} (${fechaLarga(f.fecha)}): ${f.nombre} — ${f.texto}`);
    } else {
        renglones.push(`- Ninguno hasta el ${fechaLarga(r.hasta)}.`);
    }
    renglones.push("", COMO_DECIDE);
    return renglones.join("\n");
}
