"use client";

/**
 * Editor de lo que habilita un rango: sus procesos y sus maquinarias.
 *
 * Hasta ahora esto venía fijo desde el Excel de la migración y no había forma de
 * tocarlo desde la app; era el pedido concreto de Valentín ("que podamos editar qué
 * puede hacer el oficial, el operario calificado, etc.").
 *
 * Dos decisiones que importan:
 *
 * 1. Guardado explícito, no automático. Cambiar los procesos de un rango cambia qué
 *    puede hacer TODA la gente que lo tiene. Que eso salga de un click accidental en
 *    una X sería demasiado barato para lo que cuesta, así que se arma en local y se
 *    confirma. Por eso también se muestra a cuántos operarios alcanza.
 *
 * 2. El PUT manda el conjunto completo, no un delta. La tabla es un par de enteros sin
 *    payload y el backend reemplaza; mandar el estado final es lo que hace que dos
 *    pestañas abiertas no terminen en un merge raro.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { X, Loader2, AlertTriangle, Layers, Factory } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { API_URL } from "@/config";
import AgregarHabilidad, { ProcesoItem } from "./AgregarHabilidad";

interface ItemRef {
    id: number;
    nombre: string;
}

interface MaquinaRef extends ItemRef {
    cod_maquina?: string | null;
}

interface Props {
    idRango: number;
    nombreRango: string;
}

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return { "Content-Type": "application/json" };
    const token = localStorage.getItem("access_token");
    return token
        ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
        : { "Content-Type": "application/json" };
};

const mismosIds = (a: { id: number }[], b: { id: number }[]) => {
    if (a.length !== b.length) return false;
    const sa = [...a.map((x) => x.id)].sort((x, y) => x - y);
    const sb = [...b.map((x) => x.id)].sort((x, y) => x - y);
    return sa.every((v, i) => v === sb[i]);
};

const porNombre = (a: ItemRef, b: ItemRef) => a.nombre.localeCompare(b.nombre);

export default function RangoComposicion({ idRango, nombreRango }: Props) {
    const cleanUrl = API_URL.replace(/\/$/, "");
    const { showToast } = useToast();

    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);
    const [alcance, setAlcance] = useState(0);

    // `original` es lo que hay en la base; `procesos`/`maquinarias` es lo que se está
    // editando. La diferencia entre ambos es lo que habilita el botón de guardar.
    const [original, setOriginal] = useState<{ procesos: ItemRef[]; maquinarias: MaquinaRef[] }>({
        procesos: [],
        maquinarias: [],
    });
    const [procesos, setProcesos] = useState<ItemRef[]>([]);
    const [maquinarias, setMaquinarias] = useState<MaquinaRef[]>([]);

    const [catProcesos, setCatProcesos] = useState<ItemRef[]>([]);
    const [catMaquinarias, setCatMaquinarias] = useState<MaquinaRef[]>([]);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError(null);
        try {
            const [detRes, procRes, maqRes] = await Promise.all([
                fetch(`${cleanUrl}/rangos/${idRango}/detalle`, { headers: getAuthHeaders() }),
                fetch(`${cleanUrl}/procesos`, { headers: getAuthHeaders() }),
                fetch(`${cleanUrl}/maquinarias`, { headers: getAuthHeaders() }),
            ]);

            if (!detRes.ok) throw new Error("detalle");
            const det = await detRes.json();
            const data = det?.data ?? det;

            const procs: ItemRef[] = (data.procesos ?? []).slice().sort(porNombre);
            const maqs: MaquinaRef[] = (data.maquinarias ?? []).slice().sort(porNombre);

            setOriginal({ procesos: procs, maquinarias: maqs });
            setProcesos(procs);
            setMaquinarias(maqs);
            setAlcance(data.operarios_count ?? 0);

            const procJson = await procRes.json().catch(() => null);
            setCatProcesos(procJson?.data ?? procJson ?? []);
            const maqJson = await maqRes.json().catch(() => null);
            setCatMaquinarias(maqJson?.data ?? maqJson ?? []);
        } catch {
            setError("No se pudo cargar la composición del rango.");
        } finally {
            setCargando(false);
        }
    }, [cleanUrl, idRango]);

    useEffect(() => {
        cargar();
    }, [cargar]);

    const sucio =
        !mismosIds(procesos, original.procesos) || !mismosIds(maquinarias, original.maquinarias);

    const idsProcesos = useMemo(() => new Set(procesos.map((p) => p.id)), [procesos]);
    const idsMaquinarias = useMemo(() => new Set(maquinarias.map((m) => m.id)), [maquinarias]);

    // El buscador muestra el código junto al nombre: en el taller las máquinas se
    // nombran por código ("TORY-1") tanto como por nombre.
    const catalogoMaquinasParaBuscar: ProcesoItem[] = useMemo(
        () =>
            catMaquinarias.map((m) => ({
                id: m.id,
                nombre: m.cod_maquina ? `${m.nombre} (${m.cod_maquina})` : m.nombre,
            })),
        [catMaquinarias]
    );

    const guardar = async () => {
        setGuardando(true);
        try {
            const peticiones: Promise<Response>[] = [];
            if (!mismosIds(procesos, original.procesos)) {
                peticiones.push(
                    fetch(`${cleanUrl}/rangos/${idRango}/procesos`, {
                        method: "PUT",
                        headers: getAuthHeaders(),
                        body: JSON.stringify({ procesos: procesos.map((p) => p.id) }),
                    })
                );
            }
            if (!mismosIds(maquinarias, original.maquinarias)) {
                peticiones.push(
                    fetch(`${cleanUrl}/rangos/${idRango}/maquinarias`, {
                        method: "PUT",
                        headers: getAuthHeaders(),
                        body: JSON.stringify({ maquinarias: maquinarias.map((m) => m.id) }),
                    })
                );
            }

            const respuestas = await Promise.all(peticiones);
            const fallo = respuestas.find((r) => !r.ok);
            if (fallo) {
                const err = await fallo.json().catch(() => ({}));
                showToast(
                    err?.errorDescription || err?.detail || "No se pudo guardar el rango.",
                    "error"
                );
                // Se recarga igual: si una de las dos pasó, el estado local quedó a medias.
                await cargar();
                return;
            }

            showToast(
                alcance > 0
                    ? `${nombreRango} actualizado. Alcanza a ${alcance} operario${alcance === 1 ? "" : "s"}.`
                    : `${nombreRango} actualizado.`,
                "success"
            );
            setOriginal({ procesos, maquinarias });
        } catch {
            showToast("Error de conexión al guardar el rango.", "error");
        } finally {
            setGuardando(false);
        }
    };

    const descartar = () => {
        setProcesos(original.procesos);
        setMaquinarias(original.maquinarias);
    };

    if (cargando) {
        return (
            <div className="flex items-center gap-3 px-6 py-6 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" />
                Cargando la composición de {nombreRango}...
            </div>
        );
    }

    if (error) {
        return (
            <div className="px-6 py-5">
                <p className="text-sm text-destructive">{error}</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={cargar}>
                    Reintentar
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-5 bg-muted/30 px-6 py-5">
            {alcance > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                        Lo que cambies acá aplica a los{" "}
                        <strong>
                            {alcance} operario{alcance === 1 ? "" : "s"}
                        </strong>{" "}
                        que tienen este rango, no a uno solo. Para habilitar a una sola persona
                        usá una habilidad manual desde su ficha.
                    </span>
                </div>
            )}

            {/* PROCESOS */}
            <section>
                <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Layers className="h-4 w-4 text-muted-foreground" />
                        <h4 className="text-sm font-semibold">Procesos que habilita</h4>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {procesos.length}
                        </span>
                    </div>
                    <AgregarHabilidad
                        catalogo={catProcesos}
                        yaTiene={idsProcesos}
                        etiqueta="Agregar proceso"
                        sustantivo="proceso"
                        nota="Se lo habilita a todos los operarios con este rango."
                        onAgregar={(p) => setProcesos((prev) => [...prev, p].sort(porNombre))}
                    />
                </div>
                {procesos.length === 0 ? (
                    <p className="rounded-md border border-dashed px-3 py-3 text-[13px] text-muted-foreground">
                        Este rango no habilita ningún proceso. Nadie va a ser elegible por tenerlo.
                    </p>
                ) : (
                    <div className="flex flex-wrap gap-1.5">
                        {procesos.map((p) => (
                            <span
                                key={p.id}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white py-1 pl-2.5 pr-1 text-[12px] text-slate-700"
                            >
                                {p.nombre}
                                <button
                                    type="button"
                                    aria-label={`Quitar ${p.nombre}`}
                                    onClick={() =>
                                        setProcesos((prev) => prev.filter((x) => x.id !== p.id))
                                    }
                                    className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                )}
            </section>

            {/* MAQUINARIAS */}
            <section>
                <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Factory className="h-4 w-4 text-muted-foreground" />
                        <h4 className="text-sm font-semibold">Maquinarias asociadas</h4>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {maquinarias.length}
                        </span>
                    </div>
                    <AgregarHabilidad
                        catalogo={catalogoMaquinasParaBuscar}
                        yaTiene={idsMaquinarias}
                        etiqueta="Agregar maquinaria"
                        sustantivo="maquinaria"
                        nota="Queda asociada al rango, no a un operario."
                        onAgregar={(m) => {
                            // Se busca el original para no guardar el nombre con el código pegado.
                            const real = catMaquinarias.find((x) => x.id === m.id);
                            if (real) setMaquinarias((prev) => [...prev, real].sort(porNombre));
                        }}
                    />
                </div>
                {maquinarias.length === 0 ? (
                    <p className="rounded-md border border-dashed px-3 py-3 text-[13px] text-muted-foreground">
                        Sin maquinarias asociadas.
                    </p>
                ) : (
                    <div className="flex flex-wrap gap-1.5">
                        {maquinarias.map((m) => (
                            <span
                                key={m.id}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white py-1 pl-2.5 pr-1 text-[12px] text-slate-700"
                            >
                                {m.nombre}
                                {m.cod_maquina && (
                                    <span className="font-mono text-[11px] text-slate-400">
                                        {m.cod_maquina}
                                    </span>
                                )}
                                <button
                                    type="button"
                                    aria-label={`Quitar ${m.nombre}`}
                                    onClick={() =>
                                        setMaquinarias((prev) => prev.filter((x) => x.id !== m.id))
                                    }
                                    className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                )}
            </section>

            {sucio && (
                <div className="flex items-center justify-end gap-2 border-t pt-3">
                    <Button variant="ghost" size="sm" onClick={descartar} disabled={guardando}>
                        Descartar
                    </Button>
                    <Button
                        size="sm"
                        onClick={guardar}
                        disabled={guardando}
                        className="bg-[#DC143C] text-white hover:bg-[#B01030]"
                    >
                        {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Guardar cambios
                    </Button>
                </div>
            )}
        </div>
    );
}
