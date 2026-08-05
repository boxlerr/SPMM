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

    return { nativas, cargando, fallo };
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
 * Solo van los overrides sobre procesos que HOY son nativos: mandar una prioridad
 * sobre un proceso que el rango ya no da hace que el backend corte el guardado con un
 * error, y es un resto que igual se limpia solo al reemplazar las filas.
 */
export function skillsPayloadDesdeEstados(
    estados: Record<number, EstadoSkill>,
    nativas: NativaItem[]
) {
    const idsNativos = new Set(nativas.map((n) => n.id));
    return Object.entries(estados)
        .map(([id, estado]) => ({
            id_proceso: Number(id),
            nivel: estado.nivel,
            habilitado: estado.habilitado,
            // La posición solo aplica dentro de SKILLS 1/2; en el pool no significa nada.
            orden: estado.nivel === 0 ? null : estado.orden ?? null,
        }))
        .filter((s) => idsNativos.has(s.id_proceso))
        .filter((s) => s.nivel !== 0 || !s.habilitado)
        .sort((a, b) => a.id_proceso - b.id_proceso);
}
