"use client";

import { useEffect, useMemo, useState } from "react";
import type { EstadoSkill, NativaItem, NivelSkill } from "./_components/SkillsEditor";
import type { ProcesoSkill } from "./_types";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Deriva las SKILLS NATIVAS de los rangos seleccionados, en vivo.
 *
 * No se puede leer de `operario.skills` y listo: al cambiar los rangos en el mismo
 * formulario las nativas cambian al toque, y el alta ni siquiera tiene operario todavía.
 * Por eso se resuelve del lado del cliente con el mapa rango -> procesos.
 */
export function useNativas(cleanUrl: string, rangosSeleccionados: number[]) {
    const [mapaRangoProcesos, setMapaRangoProcesos] = useState<Record<string, number[]>>({});
    const [procesos, setProcesos] = useState<{ id: number; nombre: string }[]>([]);
    const [cargando, setCargando] = useState(true);
    // Si el mapa rango -> procesos no cargó, NO sabemos cuáles son las nativas. El
    // form tiene que omitir las skills del guardado en vez de mandar una lista vacía:
    // el PUT reemplaza los overrides por completo, así que un payload vacío le borra
    // al operario todas las prioridades y las nativas apagadas. Pasa con el backend
    // sin desplegar (404 en /rangos/procesos) y con cualquier corte transitorio.
    const [fallo, setFallo] = useState(false);

    useEffect(() => {
        let vigente = true;
        const cargar = async () => {
            setCargando(true);
            try {
                const [rangosRes, procRes] = await Promise.all([
                    fetch(`${cleanUrl}/rangos/procesos`, { headers: getAuthHeaders() }),
                    fetch(`${cleanUrl}/procesos`, { headers: getAuthHeaders() }),
                ]);
                if (!vigente) return;

                if (rangosRes.ok) {
                    const payload = await rangosRes.json();
                    setMapaRangoProcesos(payload?.data || {});
                    setFallo(false);
                } else {
                    console.error("No se pudo cargar rango -> procesos:", rangosRes.status);
                    setFallo(true);
                }
                if (procRes.ok) {
                    const payload = await procRes.json();
                    const lista = payload?.data || [];
                    setProcesos(Array.isArray(lista) ? lista : []);
                }
            } catch (error) {
                console.error("Error al cargar las skills nativas:", error);
                if (vigente) setFallo(true);
            } finally {
                if (vigente) setCargando(false);
            }
        };
        cargar();
        return () => {
            vigente = false;
        };
    }, [cleanUrl]);

    const nombrePorId = useMemo(() => {
        const m = new Map<number, string>();
        for (const p of procesos) m.set(p.id, p.nombre);
        return m;
    }, [procesos]);

    const nativas: NativaItem[] = useMemo(() => {
        const ids = new Set<number>();
        for (const idRango of rangosSeleccionados) {
            for (const idProceso of mapaRangoProcesos[String(idRango)] || []) {
                ids.add(idProceso);
            }
        }
        return Array.from(ids).map((id) => ({
            id,
            nombre: nombrePorId.get(id) || `Proceso #${id}`,
        }));
    }, [rangosSeleccionados, mapaRangoProcesos, nombrePorId]);

    // `catalogo` son TODOS los procesos: es de donde se eligen las habilidades manuales
    // (justamente las que el rango no contempla, así que no salen de `nativas`).
    const catalogo: NativaItem[] = useMemo(
        () => procesos.map((p) => ({ id: p.id, nombre: p.nombre })),
        [procesos]
    );

    return { nativas, catalogo, cargando, fallo };
}

/** Ids de las habilidades cargadas a mano que ya tiene el operario. */
export function manualesDesdeSkills(skills: ProcesoSkill[] | undefined): number[] {
    return (skills || []).filter((s) => s.manual === true).map((s) => s.id_proceso);
}

/**
 * Da de alta un proceso en el catálogo y lo devuelve listo para agregar como manual.
 *
 * Es para la habilidad que no existe en ningún lado: el buscador no la encuentra
 * porque nunca se cargó. El proceso queda disponible para todos (es un catálogo
 * global), pero la habilidad la tiene solo el operario al que se la agreguen.
 */
export async function crearProceso(cleanUrl: string, nombre: string): Promise<NativaItem | null> {
    const res = await fetch(`${cleanUrl}/procesos`, {
        method: "POST",
        headers: { ...(getAuthHeaders() as Record<string, string>), "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombre.trim() }),
    });
    if (!res.ok) return null;
    const payload = await res.json();
    const creado = payload?.data;
    if (!creado?.id) return null;
    return { id: creado.id, nombre: creado.nombre || nombre.trim() };
}

/** Convierte las skills que devuelve la API al estado que maneja el editor. */
export function estadosDesdeSkills(skills: ProcesoSkill[] | undefined): Record<number, EstadoSkill> {
    const estados: Record<number, EstadoSkill> = {};
    for (const s of skills || []) {
        const nivel = (s.nivel ?? 0) as NivelSkill;
        const habilitado = s.habilitado !== false;
        // Las que están en su estado por defecto no hace falta guardarlas: así el
        // diff de "¿hubo cambios?" no se ensucia con entradas que no dicen nada.
        if (nivel === 0 && habilitado) continue;
        estados[s.id_proceso] = { nivel, habilitado, orden: s.orden ?? null };
    }
    return estados;
}

/**
 * Arma el payload de skills para la API.
 *
 * Solo van filas sobre procesos que el operario tiene HOY: nativos de sus rangos o
 * cargados a mano. Mandar una prioridad sobre un proceso que no tiene hace que el
 * backend corte el guardado con un error, y es un resto que igual se limpia solo al
 * reemplazar las filas.
 *
 * Diferencia clave entre las dos: de una nativa solo se manda lo que dice algo
 * (priorizada o apagada), porque el default se deriva del rango. De una MANUAL se
 * manda siempre la fila, aunque esté sin priorizar y encendida: ahí no hay nada
 * derivado atrás, la fila es la habilidad. Si no se manda, se borra.
 */
export function skillsPayloadDesdeEstados(
    estados: Record<number, EstadoSkill>,
    nativas: NativaItem[],
    manuales: number[] = []
) {
    const idsNativos = new Set(nativas.map((n) => n.id));
    // Ser nativa manda: si el rango terminó dando un proceso que estaba cargado a mano,
    // deja de ser manual. El backend hace la misma resolución.
    const idsManuales = new Set(manuales.filter((id) => !idsNativos.has(id)));

    const fila = (id: number, estado: EstadoSkill) => ({
        id_proceso: id,
        nivel: estado.nivel,
        habilitado: estado.habilitado,
        // La posición solo aplica dentro de SKILLS 1/2; en el pool no significa nada.
        orden: estado.nivel === 0 ? null : estado.orden ?? null,
        manual: idsManuales.has(id),
    });
    const filas = new Map<number, ReturnType<typeof fila>>();

    for (const [clave, estado] of Object.entries(estados)) {
        const id = Number(clave);
        if (!idsNativos.has(id) && !idsManuales.has(id)) continue;
        if (!idsManuales.has(id) && estado.nivel === 0 && estado.habilitado) continue;
        filas.set(id, fila(id, estado));
    }
    // Las manuales sin estado propio (recién agregadas, sin prioridad) igual viajan.
    for (const id of idsManuales) {
        if (!filas.has(id)) filas.set(id, fila(id, { nivel: 0, habilitado: true, orden: null }));
    }

    return Array.from(filas.values()).sort((a, b) => a.id_proceso - b.id_proceso);
}
