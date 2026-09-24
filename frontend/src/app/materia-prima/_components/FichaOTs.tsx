"use client";

/**
 * Solapa OT de la ficha: en qué órdenes se usó este insumo (las más nuevas primero).
 *
 * Sirve para dos preguntas del día a día: «¿con qué se hizo la última vez esta pieza?»
 * y «¿a quién le afecta si este material no llega?». Cada número abre la OT en
 * Operaciones. El estado es el de la línea de esa OT: si está lista, esperando (pedida)
 * o si todavía falta pedirla; una OT terminada se ve apagada.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { API_URL } from "@/config";
import { cn } from "@/lib/utils";
import { consulta, fmtCantidad, fmtFecha, mpGet, type InsumoFicha, type UsoEnOT } from "@/lib/materiaPrima";
import { CartelError, CartelSinServidor, Esqueleto, Vacio, enlaceOT } from "./InsumoComun";

/** Hasta cuántas se piden. Un insumo de todos los días puede estar en cientos: las más nuevas alcanzan. */
const TOPE = 200;

/**
 * El estado de la línea, con los mismos rótulos y colores que en Pendientes. `reserva`
 * cuenta: sin ella, una línea apartada del stock se leería «Falta pedir».
 */
function estadoDe(u: UsoEnOT): { rotulo: string; clase: string; titulo: string } {
    if (!u.usado) return { rotulo: "No se usa", clase: "bg-gray-100 text-gray-500 border-gray-200", titulo: "La línea está marcada como no utilizada (o a confirmar)." };
    if (u.disponible) return { rotulo: "Lista", clase: "bg-green-50 text-green-700 border-green-200", titulo: "El material está disponible para producción." };
    if (u.pedido) return { rotulo: "Pedida", clase: "bg-amber-50 text-amber-700 border-amber-200", titulo: "Está pedida al proveedor y todavía no llegó." };
    if (u.reserva) {
        const cuanto = u.cantidad_reservada ? ` (${fmtCantidad(u.cantidad_reservada)}${u.unidad ? ` ${u.unidad}` : ""})` : "";
        return { rotulo: "Reservada", clase: "bg-amber-50 text-amber-700 border-amber-200", titulo: `Está apartada del stock${cuanto} y todavía no se retiró.` };
    }
    return {
        rotulo: "Falta pedir",
        clase: "bg-red-100 text-red-700 border-red-200",
        titulo: "No está disponible, ni pedida, ni reservada: hay que encargarla.",
    };
}

export function FichaOTs({ ficha }: { ficha: InsumoFicha }) {
    const [lista, setLista] = useState<UsoEnOT[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sinServidor, setSinServidor] = useState(false);

    const cargar = useCallback(async (signal?: AbortSignal) => {
        const r = await mpGet<UsoEnOT[]>(`${API_URL}/materia-prima/insumos/${ficha.id}/ots?${consulta({ limit: TOPE })}`, { signal });
        if (r.abortado) return;
        setSinServidor(r.sinServidor);
        if (!r.ok) {
            setError(r.error ?? "No se pudieron traer las OT.");
            return;
        }
        setError(null);
        setLista(Array.isArray(r.data) ? r.data : []);
    }, [ficha.id]);

    useEffect(() => {
        const c = new AbortController();
        void cargar(c.signal);
        return () => c.abort();
    }, [cargar]);

    if (sinServidor) return <CartelSinServidor className="m-4" />;
    if (error && !lista) return <CartelError className="m-4" mensaje={error} onReintentar={() => void cargar()} />;
    if (!lista) return <Esqueleto filas={5} className="p-4" />;
    if (!lista.length) {
        return (
            <div className="p-4">
                <Vacio icono={<ClipboardList className="h-6 w-6" />} titulo="Todavía no se usó en ninguna OT">
                    Aparece acá cuando se cargue como materia prima de una orden.
                </Vacio>
            </div>
        );
    }

    return (
        <div className="space-y-2 px-4 py-4">
            <p className="text-xs text-gray-500">
                {lista.length >= TOPE ? `Las ${TOPE} más nuevas.` : `${lista.length} línea${lista.length === 1 ? "" : "s"} en OT, las más nuevas primero.`}
            </p>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full min-w-[500px] text-xs">
                    <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                        <tr>
                            <th className="px-2 py-1.5 text-left font-semibold">OT</th>
                            <th className="px-2 py-1.5 text-left font-semibold">Fecha</th>
                            <th className="px-2 py-1.5 text-left font-semibold">Cliente / artículo</th>
                            <th className="px-2 py-1.5 text-right font-semibold">Cantidad</th>
                            <th className="px-2 py-1.5 text-left font-semibold">Estado</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {lista.map((u) => {
                            const e = estadoDe(u);
                            return (
                                <tr key={u.id_linea} className={cn(u.finalizada && "text-gray-400")}>
                                    <td className="whitespace-nowrap px-2 py-1.5">
                                        <Link
                                            href={enlaceOT(u.id_orden_trabajo)}
                                            className={cn("font-semibold hover:underline", u.finalizada ? "text-gray-500" : "text-blue-700")}
                                            title="Abrir la OT"
                                        >
                                            {u.numero_ot ?? `#${u.id_orden_trabajo}`}
                                        </Link>
                                    </td>
                                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{fmtFecha(u.fecha_ot)}</td>
                                    <td className="max-w-[14rem] px-2 py-1.5">
                                        <span className={cn("block truncate", !u.finalizada && "text-gray-800")} title={u.cliente ?? undefined}>{u.cliente ?? "—"}</span>
                                        {u.articulo && <span className="block truncate text-[11px] text-gray-500" title={u.articulo}>{u.articulo}</span>}
                                    </td>
                                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                                        {fmtCantidad(u.cantidad)} <span className="text-gray-400">{u.unidad ?? ""}</span>
                                    </td>
                                    <td className="whitespace-nowrap px-2 py-1.5">
                                        {u.finalizada ? (
                                            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500" title="La OT está terminada.">
                                                Terminada
                                            </span>
                                        ) : (
                                            <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", e.clase)} title={e.titulo}>
                                                {e.rotulo}
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default FichaOTs;
