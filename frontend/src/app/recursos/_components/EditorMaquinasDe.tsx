"use client";

/**
 * Editor de "en qué máquinas se hace este proceso".
 *
 * Hasta el 2/9 esto no era un dato: el planificador adivinaba la máquina a partir del
 * NOMBRE del proceso. Andaba para "TORNO T1", pero "reparación de rosca" no dice torno
 * en ningún lado, así que se planificaba sin reservar ninguno y otra OT podía llevarse
 * el mismo torno a la misma hora. Cuando Lucas contestó la planilla de trabas —"en
 * tornos convencionales", "en prensas o plegadora", "solo en la tangencial"— no había
 * dónde guardar la respuesta.
 *
 * Vacío NO significa "va a mano": significa "todavía no lo cargaron", y ahí el
 * planificador sigue deduciendo por el nombre exactamente como antes. Es lo que hace
 * que cargar esto en cinco procesos no le cambie el plan a los otros cuatrocientos.
 *
 * Se guarda con un botón, igual que los rangos: cambia a qué máquina va a parar el
 * trabajo, y eso es demasiado caro para que salga de un click accidental.
 */

import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Plus, Cog, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { API_URL } from "@/config";

export interface MaquinaRef {
    id: number;
    nombre: string;
}

interface Props {
    id: number;
    nombre: string;
    /** En qué máquinas se hace hoy. Vacío = no cargado. */
    actuales: MaquinaRef[];
    /** Catálogo completo de maquinaria del taller. */
    catalogo: { id: number; nombre: string; cod_maquina?: string | null }[];
    /**
     * Las que el sistema venía deduciendo del nombre. Llegan tildadas para que cargar
     * el dato sea confirmar y no escribir de cero: son 415 procesos y a mano no lo hace
     * nadie. Lo que queda guardado es lo que confirmó el taller, no lo que adivinamos.
     */
    sugeridas?: number[];
    onGuardado: () => void;
}

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return { "Content-Type": "application/json" };
    const token = localStorage.getItem("access_token");
    return token
        ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
        : { "Content-Type": "application/json" };
};

const mismas = (a: MaquinaRef[], b: MaquinaRef[]) => {
    if (a.length !== b.length) return false;
    const sa = a.map((x) => x.id).sort((x, y) => x - y);
    const sb = b.map((x) => x.id).sort((x, y) => x - y);
    return sa.every((v, i) => v === sb[i]);
};

export default function EditorMaquinasDe({ id, nombre, actuales, catalogo, sugeridas, onGuardado }: Props) {
    const { showToast } = useToast();
    const [seleccion, setSeleccion] = useState<MaquinaRef[]>(actuales);
    const [guardando, setGuardando] = useState(false);
    const [busqueda, setBusqueda] = useState("");
    const [abriendo, setAbriendo] = useState(false);

    const propuestas = useMemo(() => {
        if (!sugeridas?.length) return [] as MaquinaRef[];
        const yaTiene = new Set(actuales.map((m) => m.id));
        return sugeridas
            .filter((mid) => !yaTiene.has(mid))
            .map((mid) => catalogo.find((c) => c.id === mid))
            .filter((c): c is { id: number; nombre: string } => !!c)
            .map((c) => ({ id: c.id, nombre: c.nombre }));
    }, [sugeridas, actuales, catalogo]);

    const idsPropuestas = new Set(propuestas.map((m) => m.id));

    useEffect(() => setSeleccion([...actuales, ...propuestas]), [actuales, propuestas]);

    const hayCambios = !mismas(seleccion, actuales);
    const elegidas = new Set(seleccion.map((m) => m.id));

    const disponibles = useMemo(
        () =>
            catalogo
                .filter((m) => !elegidas.has(m.id))
                .filter((m) => m.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()))
                .sort((a, b) => a.nombre.localeCompare(b.nombre)),
        [catalogo, seleccion, busqueda]
    );

    const guardar = async () => {
        setGuardando(true);
        try {
            const url = `${API_URL.replace(/\/$/, "")}/procesos/${id}/maquinarias`;
            const res = await fetch(url, {
                method: "PUT",
                headers: getAuthHeaders(),
                body: JSON.stringify({ maquinarias: seleccion.map((m) => m.id) }),
            });
            if (!res.ok) throw new Error(String(res.status));
            showToast(
                seleccion.length === 0
                    ? `${nombre} vuelve a resolverse por el nombre`
                    : `Máquinas de ${nombre} actualizadas`,
                "success"
            );
            onGuardado();
        } catch {
            showToast("No se pudieron guardar las máquinas", "error");
        } finally {
            setGuardando(false);
        }
    };

    return (
        <div className="p-4 bg-muted/20 border-t">
            <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                    <p className="text-sm font-semibold">En qué máquinas se hace este proceso</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        El planificador reserva una de estas. Si no cargás ninguna, la sigue
                        adivinando por el nombre del proceso, como hasta ahora.
                    </p>
                </div>
                {hayCambios && (
                    <div className="flex gap-2 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => setSeleccion(actuales)} disabled={guardando}>
                            Descartar
                        </Button>
                        <Button size="sm" onClick={guardar} disabled={guardando}>
                            {guardando && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                            Guardar cambios
                        </Button>
                    </div>
                )}
            </div>

            {propuestas.length > 0 && (
                <div className="mb-3 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                    <Sparkles className="h-3.5 w-3.5 shrink-0 mt-[1px]" />
                    <span>
                        Te dejamos tildado{" "}
                        <strong>{propuestas.map((m) => m.nombre).join(", ")}</strong>, que es lo que
                        el sistema viene usando por el nombre del proceso. Si es así, tocá{" "}
                        <strong>Guardar cambios</strong> y queda firme; si no, corregilo.
                    </span>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
                {seleccion.map((m) => (
                    <Badge
                        key={m.id}
                        variant="outline"
                        className={
                            idsPropuestas.has(m.id)
                                ? "bg-blue-50 text-blue-800 border-blue-300 gap-1 pr-1"
                                : "bg-white gap-1 pr-1"
                        }
                    >
                        {m.nombre}
                        <button
                            type="button"
                            onClick={() => setSeleccion((s) => s.filter((x) => x.id !== m.id))}
                            className="ml-0.5 rounded hover:bg-black/10 p-0.5"
                            aria-label={`Quitar ${m.nombre}`}
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </Badge>
                ))}

                {seleccion.length === 0 && (
                    <span className="text-xs text-muted-foreground italic">
                        Sin cargar: se resuelve por el nombre del proceso.
                    </span>
                )}

                <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => setAbriendo((v) => !v)}>
                    <Plus className="h-3 w-3 mr-1" />
                    Agregar máquina
                </Button>
            </div>

            {abriendo && (
                <div className="mt-3 border rounded-md bg-white p-2">
                    <Input
                        autoFocus
                        placeholder="Buscar máquina..."
                        value={busqueda}
                        onChange={(e) => setBusqueda(e.target.value)}
                        className="h-8 text-xs mb-2"
                    />
                    <div className="max-h-48 overflow-auto divide-y">
                        {disponibles.map((m) => (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => {
                                    setSeleccion((s) => [...s, { id: m.id, nombre: m.nombre }]);
                                    setBusqueda("");
                                }}
                                className="w-full flex items-center justify-between px-2 py-1.5 text-xs hover:bg-muted/60 text-left"
                            >
                                <span>{m.nombre}</span>
                                <span className="flex items-center gap-1 text-muted-foreground">
                                    <Cog className="h-3 w-3" />
                                    {m.cod_maquina || ""}
                                </span>
                            </button>
                        ))}
                        {disponibles.length === 0 && (
                            <p className="text-xs text-muted-foreground italic px-2 py-3">
                                No quedan máquinas para agregar.
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
