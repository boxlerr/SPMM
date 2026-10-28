"use client";

/**
 * La solapa Proveedores de Recursos: quién hace los trabajos que se mandan afuera y
 * cuántos días tarda en devolverlos (reunión con Lucas del 28/10/2026: «una solapa
 * independiente de proveedores» para los tercerizados, las fechas de entrega y los plazos).
 *
 * Con esos días el plan hace esperar lo que sigue de la OT: si el paso no dice otra
 * cosa, vale lo del proveedor. Es la misma lista que se elige en la fila del paso
 * tercerizado de la vista previa; acá se ve entera y se le cargan los días de una vez.
 *
 * Sin buscar se ven los que ya hacen trabajos de afuera (con días cargados o elegidos en
 * algún paso). Buscando aparece cualquiera del catálogo del Integral: para sumarlo
 * alcanza con ponerle los días.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Factory, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { MarcaSoloLectura } from "@/components/permisos/SinAcceso";
import { toast } from "@/lib/toast";
import {
    crearProveedorDelPaso, editarProveedorDelPaso, eliminarProveedorDelPaso,
    listarProveedoresDeTercerizados, type ProveedorDeTercerizados,
} from "@/lib/proveedores";

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export function ProveedoresTercerizados({ soloLectura }: { soloLectura: boolean }) {
    const [buscar, setBuscar] = useState("");
    const [lista, setLista] = useState<ProveedorDeTercerizados[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [nuevo, setNuevo] = useState<{ nombre: string; dias: string } | null>(null);
    const [aEliminar, setAEliminar] = useState<ProveedorDeTercerizados | null>(null);
    const pedido = useRef(0);

    const traer = useCallback(async (texto: string) => {
        const este = ++pedido.current;
        setCargando(true);
        const r = await listarProveedoresDeTercerizados(texto);
        if (este !== pedido.current) return;           // llegó tarde: ya se buscó otra cosa
        setCargando(false);
        if (!r.ok) {
            setError("No se pudieron traer los proveedores. Probá de nuevo con «Actualizar».");
            return;
        }
        setError(null);
        setLista(r.data ?? []);
    }, []);

    // Buscar mientras se escribe, sin pedir con cada letra.
    useEffect(() => {
        const t = setTimeout(() => void traer(buscar), buscar ? 300 : 0);
        return () => clearTimeout(t);
    }, [buscar, traer]);

    /** Los días se ven cambiados al toque y se guardan de fondo; si falla, vuelven. */
    const guardarDias = async (p: ProveedorDeTercerizados, texto: string) => {
        const dias = texto.trim() === "" ? null : Math.max(0, Math.min(365, Math.round(Number(texto))));
        if (dias !== null && Number.isNaN(dias)) return;
        if (dias === p.demora_dias) return;
        setLista(prev => prev.map(x => (x.id === p.id ? { ...x, demora_dias: dias } : x)));
        const r = await editarProveedorDelPaso(p.id, { demora_dias: dias });
        if (!r.ok) {
            setLista(prev => prev.map(x => (x.id === p.id ? { ...x, demora_dias: p.demora_dias } : x)));
            toast.error(r.error ?? "No se pudieron guardar los días.");
            return;
        }
        toast.success(dias === null
            ? `${p.razon_social}: sin días (el plan no lo espera si el paso no dice cuántos)`
            : `${p.razon_social}: tarda ${plural(dias, "día", "días")}`);
    };

    const crear = async (forzar = false) => {
        if (!nuevo || !nuevo.nombre.trim()) return;
        const r = await crearProveedorDelPaso(nuevo.nombre.trim(), forzar);
        if (!r.ok) {
            if (r.requiereConfirmacion) {
                toast.warning(r.error ?? "Ya hay un proveedor con ese nombre.", {
                    action: { label: "Crearlo igual", onClick: () => void crear(true) },
                    duration: 10000,
                });
            } else {
                toast.error(r.error ?? "No se pudo dar de alta el proveedor.");
            }
            return;
        }
        const creado = r.data!;
        const dias = nuevo.dias.trim() === "" ? null : Math.max(0, Math.min(365, Math.round(Number(nuevo.dias))));
        if (dias !== null && !Number.isNaN(dias)) await editarProveedorDelPaso(creado.id, { demora_dias: dias });
        toast.success(`Se dio de alta ${creado.razon_social}`);
        setNuevo(null);
        setBuscar("");
        void traer("");
    };

    const eliminar = async (p: ProveedorDeTercerizados) => {
        setAEliminar(null);
        const r = await eliminarProveedorDelPaso(p.id);
        if (!r.ok) {
            toast.error(r.error ?? "No se pudo eliminar el proveedor.");
            return;
        }
        setLista(prev => prev.filter(x => x.id !== p.id));
        toast.success(r.data?.borrado === "del_todo"
            ? `Se eliminó ${p.razon_social}`
            : `${p.razon_social} ya no aparece en las listas. Lo que ya lo nombraba queda igual.`);
    };

    return (
        <div className="rounded-lg border bg-card">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4 md:p-6">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <Factory className="h-5 w-5 text-muted-foreground" />
                        <h2 className="text-lg font-semibold">Proveedores</h2>
                        {soloLectura && <MarcaSoloLectura />}
                    </div>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                        Quién hace los trabajos que se mandan afuera (pintura, vulcanizado, rectificado…)
                        y cuántos días tarda en devolverlos. El plan hace esperar lo que sigue de la OT
                        esos días, salvo que el paso diga otra cosa.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => void traer(buscar)} disabled={cargando}>
                        <RefreshCw className={`mr-1.5 h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
                        Actualizar
                    </Button>
                    {!soloLectura && (
                        <Button size="sm" className="bg-[#DC143C] text-white hover:bg-[#B01030]"
                            onClick={() => setNuevo({ nombre: buscar, dias: "" })}>
                            <Plus className="mr-1.5 h-4 w-4" />
                            Nuevo proveedor
                        </Button>
                    )}
                </div>
            </div>

            <div className="space-y-3 p-4 md:p-6">
                <div className="relative max-w-xl">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input
                        className="pl-9"
                        placeholder="Buscar en todos los proveedores (nombre, fantasía o CUIT) para sumarlo…"
                        value={buscar}
                        onChange={e => setBuscar(e.target.value)}
                    />
                </div>
                <p className="text-xs text-gray-500">
                    {buscar.trim()
                        ? "Buscando en todos los proveedores del Integral. Para sumar uno a los de trabajos de afuera, ponele los días."
                        : "Los que ya hacen trabajos de afuera: con días cargados o elegidos en algún paso tercerizado."}
                </p>

                {nuevo && (
                    <div className="flex flex-wrap items-end gap-2 rounded-md border border-red-200 bg-red-50/50 p-3">
                        <label className="min-w-[240px] flex-1 text-xs font-medium text-gray-700">
                            Razón social
                            <Input autoFocus value={nuevo.nombre} className="mt-1 bg-white"
                                onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })}
                                onKeyDown={e => { if (e.key === "Enter") void crear(); }} />
                        </label>
                        <label className="w-36 text-xs font-medium text-gray-700">
                            Días que tarda
                            <Input type="number" min={0} max={365} value={nuevo.dias} className="mt-1 bg-white"
                                onChange={e => setNuevo({ ...nuevo, dias: e.target.value })}
                                onKeyDown={e => { if (e.key === "Enter") void crear(); }} />
                        </label>
                        <Button size="sm" onClick={() => void crear()} disabled={!nuevo.nombre.trim()}>Dar de alta</Button>
                        <Button size="sm" variant="ghost" onClick={() => setNuevo(null)}>Cancelar</Button>
                    </div>
                )}

                {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

                <div className="overflow-x-auto rounded-md border">
                    <table className="w-full min-w-[720px] text-sm">
                        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
                            <tr>
                                <th className="px-3 py-2">Proveedor</th>
                                <th className="px-3 py-2">CUIT</th>
                                <th className="px-3 py-2">Teléfono</th>
                                <th className="px-3 py-2" title="Días de calendario que tarda en devolver el trabajo">Días que tarda</th>
                                <th className="px-3 py-2" title="En cuántos pasos tercerizados está elegido">En pasos</th>
                                {!soloLectura && <th className="w-12 px-3 py-2" />}
                            </tr>
                        </thead>
                        <tbody>
                            {lista.map(p => (
                                <tr key={p.id} className="border-t">
                                    <td className="px-3 py-2">
                                        <div className="font-medium text-gray-900">{p.razon_social}</div>
                                        {p.fantasia && p.fantasia !== p.razon_social && (
                                            <div className="text-xs text-gray-500">{p.fantasia}</div>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 tabular-nums text-gray-600">{p.cuit || "—"}</td>
                                    <td className="px-3 py-2 text-gray-600">{p.telefono || "—"}</td>
                                    <td className="px-3 py-2">
                                        {soloLectura ? (
                                            <span>{p.demora_dias == null ? "—" : plural(p.demora_dias, "día", "días")}</span>
                                        ) : (
                                            <div className="flex items-center gap-1.5">
                                                <Input
                                                    key={`${p.id}-${p.demora_dias}`}
                                                    type="number" min={0} max={365}
                                                    defaultValue={p.demora_dias ?? ""}
                                                    placeholder="—"
                                                    className="h-8 w-20 text-sm"
                                                    onBlur={e => void guardarDias(p, e.target.value)}
                                                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                                />
                                                <span className="text-xs text-gray-500">días</span>
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-gray-700">
                                        {p.pasos === 0 ? <span className="text-gray-400">—</span> : (
                                            <span title={`${plural(p.pendientes, "sin terminar", "sin terminar")} de ${p.pasos}`}>
                                                {plural(p.pasos, "paso", "pasos")}
                                                {p.pendientes > 0 && <span className="text-amber-700"> · {p.pendientes} sin terminar</span>}
                                            </span>
                                        )}
                                    </td>
                                    {!soloLectura && (
                                        <td className="px-3 py-2 text-right">
                                            <button type="button" className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                                title="Eliminar" onClick={() => setAEliminar(p)}>
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </td>
                                    )}
                                </tr>
                            ))}
                            {!cargando && lista.length === 0 && !error && (
                                <tr>
                                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-500">
                                        {buscar.trim()
                                            ? "Ningún proveedor coincide. Podés darlo de alta con «Nuevo proveedor»."
                                            : "Todavía no hay proveedores de trabajos de afuera. Buscá uno y ponele los días, o dalo de alta."}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <ConfirmationDialog
                isOpen={!!aEliminar}
                onClose={() => setAEliminar(null)}
                onConfirm={() => aEliminar && void eliminar(aEliminar)}
                title={`¿Eliminar ${aEliminar?.razon_social ?? ""}?`}
                description={aEliminar && aEliminar.pasos > 0
                    ? `Está elegido en ${plural(aEliminar.pasos, "paso", "pasos")}: esos pasos lo siguen nombrando, pero ya no va a aparecer para elegir.`
                    : "Deja de aparecer en las listas para elegir. Si nunca se usó y se dio de alta acá, se borra del todo."}
                confirmText="Eliminar igual"
                variant="destructive"
            />
        </div>
    );
}
