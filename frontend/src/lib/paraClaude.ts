/**
 * El archivo para pegarle a Claude (reunión con Lucas del 17/10/2026).
 *
 * Lucas trabaja con proyectos de Claude y propuso usarlo de dos formas:
 *
 *   1. ANTES de planificar: «que yo se lo pueda pasar y me organice» qué OT conviene meter
 *      en la semana, según lo urgente y quién puede hacer cada cosa. Claude devuelve una
 *      lista de números de OT y esa lista se pega en el buscador del Paso 1 (ver
 *      lib/busqueda): con el tilde de arriba se tildan todas.
 *   2. CON el plan armado: «exporto este PDF, le paso el PDF y un botón para exportar todas
 *      las skills de una», para que explique asignaciones como la del 19/10 —por qué la
 *      fresadora fue a Gustavo y no a Alejandro— y proponga cambios.
 *
 * Es TEXTO (Markdown) y no un PDF a propósito: una tabla de PDF Claude la lee peor que
 * renglones, y acá van juntos el pedido, las reglas con las que decide el planificador, los
 * datos y las habilidades del equipo, en un solo archivo para subir al proyecto.
 *
 * Nada de esto escribe ni manda nada a ningún lado: arma el archivo y lo baja.
 */
import { lindo, type Equipo } from "@/lib/equipo";
import { nombreDeArchivo } from "@/lib/exportar";

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** «lun 19/10». Las fechas del plan vienen sin zona (hora del taller): se leen tal cual. */
export function diaCorto(iso: string | null | undefined): string {
    if (!iso) return "—";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return iso;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return `${DIAS[d.getDay()]} ${m[3]}/${m[2]}`;
}

/** «07:00». */
export function hora(iso: string | null | undefined): string {
    const m = /T(\d{2}):(\d{2})/.exec(iso ?? "");
    return m ? `${m[1]}:${m[2]}` : "";
}

/** «Jorge  Lopez» → «Jorge Lopez»: los nombres de la base traen espacios de más. */
function nombreDe(s: string | null | undefined): string {
    return (s ?? "").replace(/\s+/g, " ").trim();
}

/** «lun 19/10 07:00». */
export function diaHora(iso: string | null | undefined): string {
    if (!iso) return "—";
    const h = hora(iso);
    return h ? `${diaCorto(iso)} ${h}` : diaCorto(iso);
}

function horas(minutos: number | null | undefined): string {
    const m = Math.max(0, Math.round(Number(minutos) || 0));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
}

// ─────────────────────────── Lo que se sabe del taller ───────────────────────────

/**
 * Cómo decide el planificador, en palabras del taller. Es la jerarquía de
 * backend/application/PlanificacionService.py (W_FUERA … W_FIN_OT) y sus reglas; si eso
 * cambia, cambia acá.
 */
export const COMO_DECIDE = `## Cómo decide el planificador de Metlosys

- **Jornada**: de 07:00 a 16:00, con desayuno de 09:00 a 09:15 y almuerzo de 12:00 a 12:30 (495 minutos de trabajo). Los sábados sólo si alguien los trabaja. Los feriados no, salvo que se haya elegido trabajarlos.
- **Qué pesa más, en este orden**: 1) que ningún paso quede afuera del plan; 2) que cada paso tenga persona y máquina; 3) que cada OT vaya de corrido: se empieza y se termina, sin dejarla esperando entre pasos; 4) llegar a la fecha prometida (lo urgente pesa más); 5) terminar todo lo antes posible.
- **Quién puede hacer cada proceso**: el que lo tiene por su rango o cargado a mano en su ficha, salvo que se lo hayan apagado. Entre los que pueden, prefiere al de **SKILL 1**, después al de **SKILL 2**, después al que sabe sin estar marcado; la posición en la lista desempata. El plan se arma en dos vueltas: primero por fechas, y después, sin atrasar ninguna entrega, se reacomoda para que cada trabajo lo haga el de SKILL 1, contando los minutos (puede cambiar horarios y máquinas). Si esperar al de SKILL 1 atrasaría una entrega, lo hace el que sigue.
- **Preparación y trabajo**: la preparación de una máquina y el trabajo que sigue los hace la misma persona, en la misma máquina y seguidos.
- **Máquinas**: cada proceso va en las máquinas cargadas para él (o las de su tipo), y sólo las puede usar alguien cuyo rango la habilita.
- **Planos**: si la OT tiene un plano cargado en la orden, sus pasos sólo los hace alguien que sabe leer planos.
- **Tercerizado**: no lo hace nadie del taller ni ocupa máquina. Si tiene proveedor con días, lo que sigue de la OT espera a que vuelva (días de calendario). Si vuelve después del último día del plan, lo que sigue queda afuera de este plan, y la pieza sale a tiempo para volver y terminarse antes de la fecha prometida.
- **Lo elegido a mano en la OT** (la persona o la máquina de un paso) se respeta siempre.
- **Un trabajo largo** se parte en tramos que hace la misma persona en la misma máquina.`;

/** El equipo, persona por persona: lo que más sirve para revisar quién hace qué. */
export function textoDelEquipo(equipo: Equipo): string {
    const renglones: string[] = ["## El equipo y sus habilidades", ""];
    for (const p of equipo.operarios) {
        const datos = [p.rangos.join(", "), p.interpreta_planos ? "lee planos" : "no lee planos", p.horario]
            .filter(Boolean).join(" · ");
        renglones.push(`### ${p.nombre}`, `${datos}`);
        const grupo = (titulo: string, filtro: (h: (typeof p.habilidades)[number]) => boolean) => {
            const lista = p.habilidades.filter(filtro).map((h) => lindo(h.proceso) + (h.origen === "a_mano" ? " (a mano)" : ""));
            if (lista.length) renglones.push(`- ${titulo}: ${lista.join(", ")}`);
        };
        grupo("SKILL 1", (h) => !h.apagada && h.nivel === 1);
        grupo("SKILL 2", (h) => !h.apagada && h.nivel === 2);
        grupo("Sabe, sin marcar", (h) => !h.apagada && h.nivel == null);
        grupo("Apagadas (no las hace)", (h) => h.apagada);
        renglones.push("");
    }
    renglones.push("## Máquinas", "");
    for (const m of equipo.maquinas) {
        const tipo = m.tipo ?? m.familia;
        const partes = [
            tipo ? `tipo ${tipo}` : null,
            m.rangos.length ? `la usan: ${m.rangos.join(", ")}` : "sin rango cargado (nadie la usa)",
            m.procesos.length ? `procesos: ${m.procesos.map(lindo).join(", ")}` : null,
            m.estado && m.estado !== "operativa" ? `estado: ${m.estado.replace(/_/g, " ")}` : null,
        ].filter(Boolean);
        renglones.push(`- **${m.nombre}** — ${partes.join(" · ")}`);
    }
    return renglones.join("\n");
}

/** Sólo el equipo, para subirlo al proyecto de Claude como referencia (Recursos). */
export function textoDelEquipoParaClaude(equipo: Equipo): string {
    return [
        "# El equipo de Metalúrgica Longchamps: quién sabe hacer qué",
        "",
        "Es la referencia para revisar planes de producción de Metlosys: qué procesos puede hacer cada persona, a quién prefiere el planificador para cada uno (SKILL 1, después SKILL 2) y qué máquinas hay. Usalo junto con el plan que te pasen.",
        "",
        COMO_DECIDE,
        "",
        textoDelEquipo(equipo),
    ].join("\n");
}

/** Baja el texto como .md, con la fecha de hoy en el nombre. Devuelve el nombre. */
export function bajarTexto(texto: string, base: string): string {
    const nombre = nombreDeArchivo(base, "csv").replace(/\.csv$/, ".md");
    const blob = new Blob([texto], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement("a");
        a.href = url;
        a.download = nombre;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
    return nombre;
}

// ─────────────────────────── 2. Con el plan armado ───────────────────────────

export interface PasoDelPlanParaClaude {
    /** Número de OT que ve el taller. */
    ot: number | string;
    cliente?: string | null;
    articulo?: string | null;
    codigo?: string | null;
    prioridad?: string | null;
    prometida?: string | null;
    /** Paso dentro de la OT (1, 2, …). */
    paso?: number | null;
    proceso: string;
    persona?: string | null;
    maquina?: string | null;
    /** false = no usa máquina (a mano). */
    usaMaquina?: boolean;
    inicio?: string | null;
    fin?: string | null;
    minutos?: number | null;
    tercerizado?: boolean;
    proveedor?: string | null;
    demoraDias?: number | null;
    vuelveEl?: string | null;
    /** Quedó afuera del plan (no entra en las fechas). */
    afuera?: boolean;
}

export interface DatosDelPlanParaClaude {
    pasos: PasoDelPlanParaClaude[];
    equipo: Equipo;
    /** «lun 19/10 → vie 23/10» o lo que diga la pantalla. */
    periodo?: string | null;
    /** Los títulos de los avisos del plan que siguen abiertos. */
    avisos?: string[];
}

const PEDIDO_PLAN = `# Revisión del plan de producción — Metalúrgica Longchamps

## Qué te pido

Sos quien ayuda a Lucas (jefe de taller) a revisar un plan de producción que armó el planificador de Metlosys. Todavía no está confirmado. Abajo están: cómo decide el planificador, el plan paso por paso, lo que hace cada persona día por día y las habilidades de cada uno.

1. Para cada persona, cuántas horas del plan hace en lo suyo (SKILL 1) y cuántas en otra cosa.
2. Las asignaciones que no respetan la especialidad (por ejemplo, un fresador torneando mientras un tornero está en la fresadora). Para cada una, por qué el planificador pudo haberla elegido: la persona estaba ocupada en otra OT, su horario, la máquina, el plano, una OT más atrasada que iba primero.
3. Cambios concretos (quién, qué paso, qué máquina, a qué hora) que pongan a cada uno en lo suyo sin atrasar ninguna entrega ni pisar dos trabajos de la misma persona o la misma máquina.

Respondé en castellano, corto y en palabras del taller. Si un dato falta o no cierra, decilo en vez de suponer.`;

export function textoDelPlanParaClaude({ pasos, equipo, periodo, avisos }: DatosDelPlanParaClaude): string {
    const partes: string[] = [PEDIDO_PLAN, "", COMO_DECIDE, ""];

    const enPlan = pasos.filter((p) => !p.afuera);
    const afuera = pasos.filter((p) => p.afuera);
    const ots = new Map<string, PasoDelPlanParaClaude[]>();
    for (const p of pasos) {
        const k = String(p.ot);
        ots.set(k, [...(ots.get(k) ?? []), p]);
    }

    partes.push("## El plan, OT por OT", "");
    if (periodo) partes.push(`Período del plan: ${periodo}.`, "");
    partes.push(`${ots.size} OT, ${enPlan.length} pasos en el plan${afuera.length ? ` y ${afuera.length} que no entran` : ""}.`, "");
    for (const [ot, lista] of ots) {
        const p0 = lista[0];
        const cabeza = [
            `### OT ${ot}`,
            [p0.cliente, p0.articulo && `${p0.codigo ? `${p0.codigo} · ` : ""}${lindo(p0.articulo)}`,
             p0.prioridad && `prioridad ${p0.prioridad}`,
             p0.prometida && `prometida ${diaCorto(p0.prometida)}`].filter(Boolean).join(" · "),
        ];
        partes.push(...cabeza);
        for (const p of lista.slice().sort((a, b) => (a.paso ?? 0) - (b.paso ?? 0))) {
            const quien = p.tercerizado
                ? `lo hace afuera ${p.proveedor ?? "(proveedor sin elegir)"}${p.demoraDias ? `, tarda ${p.demoraDias} días` : ""}`
                : `${nombreDe(p.persona) || "SIN PERSONA"} · ${p.maquina ?? (p.usaMaquina === false ? "a mano" : "SIN MÁQUINA")}`;
            const cuando = p.afuera
                ? "NO ENTRA en el plan"
                : p.tercerizado && p.vuelveEl
                    ? `sale ${diaHora(p.inicio)}, vuelve ${diaCorto(p.vuelveEl)}`
                    : `${diaHora(p.inicio)} → ${diaHora(p.fin)}`;
            partes.push(`${p.paso ?? "-"}. ${lindo(p.proceso)} (${horas(p.minutos)}) — ${quien} — ${cuando}`);
        }
        partes.push("");
    }

    // Persona por persona y día por día: es donde se ve quién está ocupado cuando.
    partes.push("## Lo que hace cada persona, día por día", "");
    const porPersona = new Map<string, PasoDelPlanParaClaude[]>();
    for (const p of enPlan) {
        const quien = nombreDe(p.persona);
        if (p.tercerizado || !quien) continue;
        porPersona.set(quien, [...(porPersona.get(quien) ?? []), p]);
    }
    for (const [persona, lista] of Array.from(porPersona.entries()).sort(([a], [b]) => a.localeCompare(b))) {
        const total = lista.reduce((s, p) => s + (Number(p.minutos) || 0), 0);
        partes.push(`### ${persona} — ${horas(total)} en el plan`);
        const porDia = new Map<string, PasoDelPlanParaClaude[]>();
        for (const p of lista.slice().sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)))) {
            const dia = diaCorto(p.inicio);
            porDia.set(dia, [...(porDia.get(dia) ?? []), p]);
        }
        for (const [dia, delDia] of porDia) {
            // Un trabajo que sigue al otro día dice hasta qué día: «15:56 → mar 20/10 10:11».
            const hasta = (p: PasoDelPlanParaClaude) =>
                diaCorto(p.fin) === diaCorto(p.inicio) ? `–${hora(p.fin)}` : ` → ${diaHora(p.fin)}`;
            const trabajos = delDia.map((p) =>
                `${hora(p.inicio)}${hasta(p)} OT ${p.ot} ${lindo(p.proceso)}${p.maquina ? ` (${p.maquina})` : ""}`);
            partes.push(`- ${dia}: ${trabajos.join("; ")}`);
        }
        partes.push("");
    }
    const sinPersona = enPlan.filter((p) => !p.tercerizado && !p.persona);
    if (sinPersona.length) {
        partes.push("### Sin persona", ...sinPersona.map((p) => `- OT ${p.ot} ${lindo(p.proceso)} ${diaHora(p.inicio)}`), "");
    }

    if (avisos && avisos.length) {
        partes.push("## Avisos del plan", "", ...avisos.map((a) => `- ${a}`), "");
    }

    partes.push(textoDelEquipo(equipo));
    return partes.join("\n");
}

// ─────────────────────────── 1. Antes de planificar ───────────────────────────

export interface OtParaElegir {
    numero: number | string;
    cliente?: string | null;
    articulo?: string | null;
    codigo?: string | null;
    prioridad?: string | null;
    prometida?: string | null;
    entrada?: string | null;
    unidades?: number | null;
    /** «falta material», «material pedido», «ok»… como lo dice la lista. */
    material?: string | null;
    /** Ya está tildada en el Paso 1. */
    tildada?: boolean;
    procesos: { paso: number; nombre: string; minutos: number; personas?: number }[];
}

export interface DatosParaElegirOTs {
    ots: OtParaElegir[];
    equipo: Equipo;
    /** Para qué días es el plan, si ya se eligieron. */
    periodo?: string | null;
    /** Cuántos días hábiles tiene ese período. */
    diasHabiles?: number | null;
}

export function textoParaElegirOTs({ ots, equipo, periodo, diasHabiles }: DatosParaElegirOTs): string {
    const personas = equipo.operarios.length;
    const pedido = `# Qué OT planificar — Metalúrgica Longchamps

## Qué te pido

Sos quien ayuda a Lucas (jefe de taller) a elegir qué órdenes de trabajo (OT) meter en el próximo plan de producción${periodo ? `, para ${periodo}` : ""}${diasHabiles ? ` (${diasHabiles} días hábiles)` : ""}. Abajo están las OT pendientes con sus procesos y minutos, cómo decide el planificador de Metlosys y las habilidades de las ${personas} personas del taller.

1. Elegí las OT que conviene planificar: primero lo urgente y lo más atrasado contra la fecha prometida, y que el trabajo llene la semana sin pasarse de las horas que tiene cada uno. Ojo con los cuellos: si un proceso lo puede hacer una sola persona, no le cargues más horas de las que tiene.
2. Explicá en pocas líneas por qué esas y por qué dejaste afuera las urgentes que no entran.
3. Al final, en un renglón aparte, la lista de números de OT separados por coma, así: \`OT: 15922, 15842, 15866\`. Ese renglón se pega tal cual en el buscador del Paso 1 de Metlosys.

Respondé en castellano y en palabras del taller. Si un dato falta (una OT sin minutos, un proceso que nadie sabe hacer), decilo.`;

    const partes: string[] = [pedido, "", COMO_DECIDE, "", "## OT pendientes", ""];
    const tildadas = ots.filter((o) => o.tildada).length;
    partes.push(`${ots.length} OT${tildadas ? `, ${tildadas} ya tildadas en el Paso 1 (marcadas con ✓)` : ""}.`, "");
    for (const o of ots) {
        const total = o.procesos.reduce((s, p) => s + (Number(p.minutos) || 0) * Math.max(1, p.personas ?? 1), 0);
        const datos = [
            o.cliente,
            o.articulo && `${o.codigo ? `${o.codigo} · ` : ""}${lindo(o.articulo)}`,
            o.unidades ? `${o.unidades} u.` : null,
            o.prioridad && `prioridad ${o.prioridad}`,
            o.prometida && `prometida ${diaCorto(o.prometida)}`,
            o.entrada && `entró ${diaCorto(o.entrada)}`,
            o.material && `material: ${o.material}`,
            `${horas(total)} de trabajo`,
        ].filter(Boolean).join(" · ");
        partes.push(`### OT ${o.numero}${o.tildada ? " ✓" : ""}`, datos);
        if (o.procesos.length) {
            partes.push(o.procesos
                .slice().sort((a, b) => a.paso - b.paso)
                .map((p) => `${p.paso}. ${lindo(p.nombre)} ${p.minutos ? `${p.minutos} min` : "(sin minutos)"}${(p.personas ?? 1) > 1 ? ` × ${p.personas} personas` : ""}`)
                .join(" → "));
        } else {
            partes.push("(sin procesos cargados)");
        }
        partes.push("");
    }
    partes.push(textoDelEquipo(equipo));
    return partes.join("\n");
}

// ─────────────────────────── La vuelta: pegar la lista ───────────────────────────

/** «15922, 15842 y 15866». */
export function listarNumeros(numeros: (number | string)[]): string {
    const l = numeros.map(String);
    if (l.length <= 1) return l.join("");
    return `${l.slice(0, -1).join(", ")} y ${l[l.length - 1]}`;
}
