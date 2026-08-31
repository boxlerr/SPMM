"use client";

/**
 * Editor de "qué rangos habilitan esto", usado desde una máquina o desde un proceso.
 *
 * El vínculo rango ↔ máquina y rango ↔ proceso ya se podía editar desde la pestaña
 * Rangos. El problema es dónde se descubre el hueco: uno se entera de que a una
 * máquina no la puede usar nadie mirando la máquina, y de que un proceso no lo puede
 * hacer nadie mirando el proceso. Para arreglarlo había que irse a Rangos, acordarse
 * de cuál era el rango correcto y agregarlo desde allá — tres pantallas para un dato
 * que ya tenías delante.
 *
 * Se guarda con un botón y no al tocar una X, por lo mismo que RangoComposicion: lo
 * que se cambia acá alcanza a todos los que tienen ese rango, y eso es demasiado caro
 * para que salga de un click accidental.
 */

import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Plus, Users, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { API_URL } from "@/config";

export interface RangoRef {
    id: number;
    nombre: string;
}

interface Props {
    /** Qué se está editando: define el endpoint y los textos. */
    tipo: "maquinaria" | "proceso";
    id: number;
    nombre: string;
    /** Rangos que habilita hoy. */
    actuales: RangoRef[];
    /** Catálogo completo de rangos, con cuánta gente tiene cada uno. */
    catalogo: { id: number; nombre: string; operarios: number }[];
    onGuardado: () => void;
}

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return { "Content-Type": "application/json" };
    const token = localStorage.getItem("access_token");
    return token
        ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
        : { "Content-Type": "application/json" };
};

const mismos = (a: RangoRef[], b: RangoRef[]) => {
    if (a.length !== b.length) return false;
    const sa = a.map((x) => x.id).sort((x, y) => x - y);
    const sb = b.map((x) => x.id).sort((x, y) => x - y);
    return sa.every((v, i) => v === sb[i]);
};

export default function EditorRangosDe({ tipo, id, nombre, actuales, catalogo, onGuardado }: Props) {
    const { showToast } = useToast();
    const [seleccion, setSeleccion] = useState<RangoRef[]>(actuales);
    const [guardando, setGuardando] = useState(false);
    const [busqueda, setBusqueda] = useState("");
    const [abriendo, setAbriendo] = useState(false);

    useEffect(() => setSeleccion(actuales), [actuales]);

    const hayCambios = !mismos(seleccion, actuales);
    const elegidos = new Set(seleccion.map((r) => r.id));

    const disponibles = useMemo(
        () =>
            catalogo
                .filter((r) => !elegidos.has(r.id))
                .filter((r) => r.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()))
                .sort((a, b) => b.operarios - a.operarios || a.nombre.localeCompare(b.nombre)),
        [catalogo, seleccion, busqueda]
    );

    // Cuánta gente queda habilitada con la selección actual. Es el número que importa:
    // se pueden cargar tres rangos y seguir sin nadie que pueda hacerlo.
    const gente = seleccion.reduce((acc, r) => {
        const c = catalogo.find((x) => x.id === r.id);
        return acc + (c?.operarios ?? 0);
    }, 0);

    const guardar = async () => {
        setGuardando(true);
        try {
            const url = `${API_URL.replace(/\/$/, "")}/${tipo === "maquinaria" ? "maquinarias" : "procesos"}/${id}/rangos`;
            const res = await fetch(url, {
                method: "PUT",
                headers: getAuthHeaders(),
                body: JSON.stringify({ rangos: seleccion.map((r) => r.id) }),
            });
            if (!res.ok) throw new Error(String(res.status));
            showToast(`Rangos de ${nombre} actualizados`, "success");
            onGuardado();
        } catch {
            showToast("No se pudieron guardar los rangos", "error");
        } finally {
            setGuardando(false);
        }
    };

    return (
        <div className="p-4 bg-muted/20 border-t">
            <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                    <p className="text-sm font-semibold">
                        Rangos que {tipo === "maquinaria" ? "pueden usar esta máquina" : "habilitan este proceso"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {tipo === "maquinaria"
                            ? "Sin ningún rango, el planificador no se la asigna a nadie."
                            : "Sin ningún rango, el planificador se lo puede asignar a cualquiera."}
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

            <div className="flex flex-wrap items-center gap-1.5">
                {seleccion.map((r) => {
                    const c = catalogo.find((x) => x.id === r.id);
                    const sinGente = (c?.operarios ?? 0) === 0;
                    return (
                        <Badge
                            key={r.id}
                            variant="outline"
                            className={
                                sinGente
                                    ? "bg-amber-50 text-amber-800 border-amber-200 gap-1 pr-1"
                                    : "bg-white gap-1 pr-1"
                            }
                            title={
                                sinGente
                                    ? "Ningún operario disponible tiene este rango, así que por sí solo no habilita a nadie."
                                    : `${c?.operarios} operario(s) lo tienen`
                            }
                        >
                            {r.nombre}
                            <span className="text-[10px] opacity-70">{c?.operarios ?? 0}</span>
                            <button
                                type="button"
                                onClick={() => setSeleccion((s) => s.filter((x) => x.id !== r.id))}
                                className="ml-0.5 rounded hover:bg-black/10 p-0.5"
                                aria-label={`Quitar ${r.nombre}`}
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </Badge>
                    );
                })}

                {seleccion.length === 0 && (
                    <span className="text-xs text-muted-foreground italic">Sin rangos asignados.</span>
                )}

                <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => setAbriendo((v) => !v)}>
                    <Plus className="h-3 w-3 mr-1" />
                    Agregar rango
                </Button>
            </div>

            {/* El aviso importante no es "no tiene rangos" sino "no lo puede hacer nadie":
                se pueden tener rangos cargados y aun así no habilitar a ninguna persona. */}
            {seleccion.length > 0 && gente === 0 && (
                <div className="mt-3 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                        Ninguno de estos rangos lo tiene un operario disponible, así que con esto
                        {tipo === "maquinaria" ? " la máquina sigue sin poder usarla nadie" : " el proceso sigue sin poder hacerlo nadie"}.
                        Agregá un rango que sí tenga gente, o asignale uno de estos a quien corresponda en Operarios.
                    </span>
                </div>
            )}

            {abriendo && (
                <div className="mt-3 border rounded-md bg-white p-2">
                    <Input
                        autoFocus
                        placeholder="Buscar rango..."
                        value={busqueda}
                        onChange={(e) => setBusqueda(e.target.value)}
                        className="h-8 text-xs mb-2"
                    />
                    <div className="max-h-48 overflow-auto divide-y">
                        {disponibles.map((r) => (
                            <button
                                key={r.id}
                                type="button"
                                onClick={() => {
                                    setSeleccion((s) => [...s, { id: r.id, nombre: r.nombre }]);
                                    setBusqueda("");
                                }}
                                className="w-full flex items-center justify-between px-2 py-1.5 text-xs hover:bg-muted/60 text-left"
                            >
                                <span>{r.nombre}</span>
                                <span
                                    className={`flex items-center gap-1 ${r.operarios === 0 ? "text-amber-700" : "text-muted-foreground"}`}
                                    title={r.operarios === 0 ? "Nadie tiene este rango" : "Recurso humano con este rango"}
                                >
                                    <Users className="h-3 w-3" />
                                    {r.operarios}
                                </span>
                            </button>
                        ))}
                        {disponibles.length === 0 && (
                            <p className="text-xs text-muted-foreground italic px-2 py-3">
                                No quedan rangos para agregar.
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
