/**
 * La foto de los datos de Recursos de los que dependen los diagnósticos del plan.
 *
 * El caso que esto resuelve, dicho por Julián: "fui a las alertas que te genera
 * planificar, fui a Recursos, arreglé las que decía, y al volver al borrador sigue
 * apareciendo". Los diagnósticos son la foto del momento del cálculo, y la única
 * forma de refrescarlos es recalcular — se construyen con lo que el solver
 * REALMENTE hizo (qué máquina quedó sin reservar, con qué rangos filtró), no con
 * una consulta a la base.
 *
 * Pero recalcular a lo bruto cada vez que alguien vuelve a la pestaña es caro: el
 * solver tarda minutos con un lote de 35 OTs, y la mayoría de las veces la persona
 * volvió sin haber tocado nada. Entonces primero se pregunta lo barato: ¿cambió
 * algo de lo que los avisos miran? Son tres GET chicos. Si la huella es la misma,
 * no hay nada que revisar y no se molesta a nadie. Si cambió, ahí sí vale el
 * recálculo, y se dispara solo.
 *
 * Qué entra en la huella: exactamente lo que puede hacer desaparecer un aviso.
 *
 *   - rango ↔ proceso y rango ↔ máquina, que es lo que tocan los botones
 *     "Aplicar y recalcular" de los propios avisos y las pantallas de Recursos;
 *   - del operario: sus rangos, sus habilidades (nivel y si están apagadas), si
 *     interpreta planos —que es filtro duro—, si está disponible y su horario.
 *
 * Qué NO entra, a propósito: las OTs. Editar una orden cualquiera dispararía un
 * recálculo que no tiene nada que ver con el aviso que se está mirando, y en un
 * taller donde alguien carga OTs todo el día eso sería un recálculo por minuto.
 */

import { API_URL } from "@/config";

const cabeceras = (): Record<string, string> => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

/** Desenvuelve el ResponseDTO del backend, que a veces viene crudo y a veces no. */
const datos = (json: any) => (json && typeof json === "object" && "data" in json ? json.data : json);

async function traer(ruta: string, signal?: AbortSignal): Promise<any | null> {
    try {
        const res = await fetch(`${API_URL.replace(/\/$/, "")}${ruta}`, { headers: cabeceras(), signal });
        if (!res.ok) return null;
        return datos(await res.json());
    } catch {
        return null;
    }
}

/** `{id_rango: [ids]}` → "1:[3,7];2:[4]" — estable, sin depender del orden que mande el server. */
function mapaAtexto(mapa: any): string {
    if (!mapa || typeof mapa !== "object") return "";
    return Object.keys(mapa)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => {
            const lista = Array.isArray(mapa[k]) ? mapa[k].map(Number).sort((a: number, b: number) => a - b) : [];
            return `${k}:${lista.join(",")}`;
        })
        .join(";");
}

function operariosAtexto(operarios: any): string {
    if (!Array.isArray(operarios)) return "";
    return operarios
        .map((o) => {
            const rangos = Array.isArray(o?.rangos)
                ? o.rangos.map((r: any) => (typeof r === "object" && r !== null ? r.id ?? r.id_rango : r)).map(Number).sort((a: number, b: number) => a - b)
                : [];
            // Del skill solo importa lo que el planificador mira: qué proceso, con
            // qué prioridad y si está apagado. El resto (orden, nativa/manual) cambia
            // solo al guardar y dispararía recálculos por nada.
            const skills = Array.isArray(o?.skills)
                ? o.skills
                    .map((s: any) => `${s?.id_proceso}:${s?.nivel ?? 0}:${s?.habilitado === false ? 0 : 1}`)
                    .sort()
                : [];
            return [
                o?.id,
                rangos.join(","),
                skills.join("|"),
                o?.interpreta_planos ? 1 : 0,
                o?.disponible === false ? 0 : 1,
                o?.hora_inicio ?? "",
                o?.hora_fin ?? "",
                o?.dias_trabajo ?? "",
            ].join("~");
        })
        .sort()
        .join("\n");
}

/** Lo que tiene HOY cada máquina y cada proceso: `id → rangos`. Ver `rangosActuales`. */
export type RangosActuales = {
    maquinarias: Map<number, Set<number>>;
    procesos: Map<number, Set<number>>;
};

/** `{id_rango: [ids]}` → `id → Set de rangos`, o null si lo que llegó no es un mapa. */
function porCadaUno(mapa: any): Map<number, Set<number>> | null {
    if (!mapa || typeof mapa !== "object" || Array.isArray(mapa)) return null;
    const salida = new Map<number, Set<number>>();
    for (const rango of Object.keys(mapa)) {
        if (!Array.isArray(mapa[rango])) continue;
        for (const id of mapa[rango]) {
            const clave = Number(id);
            if (!salida.has(clave)) salida.set(clave, new Set());
            salida.get(clave)!.add(Number(rango));
        }
    }
    return salida;
}

/**
 * Los rangos que tiene HOY cada máquina y cada proceso en Recursos, o `null` si no se
 * pudo leer alguno de los dos.
 *
 * La usa el «Guardar en Recursos» del panel de avisos (26/09/2026). Los endpoints de
 * rangos REEMPLAZAN el conjunto, y el conjunto que trae una acción se armó cuando salió
 * su aviso —a veces en un borrador de ayer, y un ajuste «solo en este plan» lo guarda
 * tal cual hasta que se deshace, porque recalcular no se lo rearma—. Mandado así,
 * borraba en producción lo que alguien hubiera cargado después en esa máquina (desde
 * otra pestaña, otra persona) sin que ningún cartel dijera que algo se sacaba. Con
 * esto el guardado parte de lo que hay ahora y sólo le SUMA lo que propone el aviso.
 *
 * Son los mismos dos GET de la huella, dados vuelta: el backend contesta por rango y
 * acá hace falta por máquina. Lo que no aparece en ningún rango tiene el conjunto
 * vacío (el que lee usa `?? new Set()`). Con tope de 20 segundos, como los PUT que
 * vienen después: sin tope, un GET colgado dejaba el botón en «Guardando…» hasta
 * recargar. `null` si falla cualquiera de los dos: con la mitad no se sabe qué hay, y
 * adivinar es justo lo que esto viene a evitar —el que llama no guarda nada—.
 */
export async function rangosActuales(): Promise<RangosActuales | null> {
    // Nunca tira: el que llama espera `null` para decir «no pude leer», y con un error
    // suelto (un navegador viejo sin `AbortSignal.timeout`) el cartel de la tanda se
    // quedaría en «Fijándome…» para siempre.
    try {
        const tope = AbortSignal.timeout(20000);
        const [porMaquina, porProceso] = await Promise.all([
            traer("/rangos/maquinarias", tope),
            traer("/rangos/procesos", tope),
        ]);
        const maquinarias = porCadaUno(porMaquina);
        const procesos = porCadaUno(porProceso);
        if (!maquinarias || !procesos) return null;
        return { maquinarias, procesos };
    } catch {
        return null;
    }
}

/**
 * Devuelve la huella actual, o `null` si algo no se pudo leer.
 *
 * El `null` es importante y no es un detalle: si una de las tres consultas falla,
 * una huella "a medias" sería distinta de la anterior y dispararía un recálculo
 * fantasma. Ante la duda, no se hace nada — el botón "Volver a revisar" sigue ahí.
 */
export async function huellaRecursos(): Promise<string | null> {
    const [porProceso, porMaquina, operarios] = await Promise.all([
        traer("/rangos/procesos"),
        traer("/rangos/maquinarias"),
        traer("/operarios"),
    ]);
    if (porProceso === null || porMaquina === null || operarios === null) return null;

    return [
        `P|${mapaAtexto(porProceso)}`,
        `M|${mapaAtexto(porMaquina)}`,
        `O|${operariosAtexto(Array.isArray(operarios) ? operarios : operarios?.data)}`,
    ].join("\n");
}
