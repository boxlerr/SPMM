"use client";

/**
 * Solapa Cañera: la grilla grande de los estantes A..O × 1..9 y lo que se hace con ella.
 *
 * Arriba, los números que importan para ordenarla (cuántos casilleros están ocupados,
 * cuántos tienen una OT que ya terminó y cuántos un número que no es de SPMM) y un
 * buscador «¿dónde está la OT…?» que resalta sus casilleros. «Liberar las terminadas»
 * vacía de una vez los casilleros de OT finalizadas: en el viejo la liberación era a
 * mano y el día del relevamiento había 11 OT terminadas ocupando lugar.
 *
 * La grilla y el botón comparten los mismos datos (`useCanera` acá arriba): liberar
 * las terminadas vacía los casilleros al toque, sin esperar a recargar.
 *
 * Contrato con la página: export con NOMBRE `CaneraTab`; «Ver en Pendientes» lleva a
 * `/materia-prima?tab=pendientes&ot=N` (la página cambia de solapa y monta Pendientes
 * filtrado por esa OT); «Abrir OT» a `/operaciones?edit_ot=ID`.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Eraser, Loader2, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { COLUMNAS_CANERA, FILAS_CANERA, numeroDeOcupacion } from "@/lib/materiaPrima";
import { compararCeldas, useCanera } from "./CaneraDatos";
import { GrillaCanera } from "./GrillaCanera";
import { CartelitoPractica, useRefrescoEspejo } from "./ModoEspejo";
import { useAlCargarMP } from "./NuevoAvisos";
import { useConfirmarForzar } from "./PendientesForzar";

export interface CaneraTabProps {
    edita: boolean;
    /** Prueba piloto: el dueño es el Sistema Integral y la cañera se refresca sola (ver ModoEspejo.tsx). */
    espejo?: boolean;
    /** La solapa está a la vista. Por defecto, true. */
    activo?: boolean;
}

const CAPACIDAD = COLUMNAS_CANERA.length * FILAS_CANERA.length;

export function CaneraTab({ edita, espejo = false, activo = true }: CaneraTabProps) {
    const router = useRouter();
    const { confirmar, dialogo } = useConfirmarForzar();
    const estado = useCanera({ confirmar });
    useRefrescoEspejo(espejo && activo, estado.recargar);
    // Materia prima cargada desde el botón «Nuevo» (una OT que pasa a tener lo suyo):
    // los casilleros se piden de nuevo en silencio (ver NuevoAvisos.ts).
    useAlCargarMP("canera", estado.recargar);
    const [buscar, setBuscar] = useState("");

    const ocupaciones = estado.canera?.ocupaciones ?? [];
    const cuentas = useMemo(() => {
        const celdas = new Set(ocupaciones.map((o) => o.celda));
        const terminadas = ocupaciones.filter((o) => o.finalizada);
        const externas = ocupaciones.filter((o) => o.id_orden_trabajo === null && !o.finalizada);
        return {
            ocupadas: celdas.size,
            terminadas,
            externas: externas.length,
        };
    }, [ocupaciones]);

    const buscada = buscar.trim();
    const encontradas = useMemo(
        () => (buscada ? ocupaciones.filter((o) => numeroDeOcupacion(o) === buscada).map((o) => o.celda).sort(compararCeldas) : []),
        [ocupaciones, buscada],
    );

    const liberarTerminadas = async () => {
        const lista = [...cuentas.terminadas].sort((a, b) => compararCeldas(a.celda, b.celda));
        if (!lista.length) return;
        const detalle = lista
            .slice(0, 12)
            .map((o) => `${o.celda} (OT ${numeroDeOcupacion(o)})`)
            .join(", ");
        const si = await confirmar({
            titulo: `Liberar ${lista.length} casillero${lista.length === 1 ? "" : "s"} de OT terminadas`,
            motivo:
                `${detalle}${lista.length > 12 ? ` y ${lista.length - 12} más` : ""}.\n\n` +
                "Quedan libres para otra OT. No se borra nada: el historial de quién estuvo en cada casillero se guarda.",
            boton: "Liberar",
        });
        if (!si) return;
        const n = await estado.liberarTerminadas();
        if (n !== null) toast.success(n === 1 ? "Se liberó 1 casillero" : `Se liberaron ${n} casilleros`);
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <div className="mr-auto min-w-0">
                    <h2 className="text-base font-semibold text-gray-900">Cañera</h2>
                    <p className="text-xs text-gray-500">
                        {estado.canera
                            ? `${cuentas.ocupadas} de ${CAPACIDAD} casilleros ocupados` +
                              (cuentas.terminadas.length ? ` · ${cuentas.terminadas.length} con OT terminada` : "") +
                              (cuentas.externas ? ` · ${cuentas.externas} con un número que no es de SPMM` : "")
                            : "Dónde está el material cortado de cada OT."}
                    </p>
                </div>

                <div className="relative w-44">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                        value={buscar}
                        onChange={(e) => setBuscar(e.target.value.replace(/\s/g, ""))}
                        placeholder="¿Dónde está la OT…?"
                        inputMode="numeric"
                        className="h-9 w-full rounded-md border border-gray-200 pl-8 pr-7 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                        aria-label="Buscar una OT en la cañera"
                    />
                    {buscar && (
                        <button
                            type="button"
                            onClick={() => setBuscar("")}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-gray-400 hover:bg-gray-100"
                            aria-label="Borrar la búsqueda"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>

                {edita && (
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-9"
                        disabled={!cuentas.terminadas.length || !estado.canera}
                        onClick={() => void liberarTerminadas()}
                        title="Deja libres los casilleros de las OT que ya terminaron"
                    >
                        <Eraser className="mr-1.5 h-4 w-4" />
                        Liberar las terminadas ({cuentas.terminadas.length})
                    </Button>
                )}
                <Button
                    variant="outline"
                    size="sm"
                    className="h-9"
                    onClick={() => void estado.recargar()}
                    disabled={estado.cargando}
                    title="Volver a traer la cañera"
                >
                    {estado.cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    <span className="ml-1.5 hidden sm:inline">Actualizar</span>
                </Button>
            </div>

            {buscada && estado.canera && (
                <p
                    className={cn(
                        "rounded-md border px-3 py-1.5 text-xs",
                        encontradas.length ? "border-blue-200 bg-blue-50 text-blue-800" : "border-gray-200 bg-gray-50 text-gray-600",
                    )}
                >
                    {encontradas.length
                        ? `La OT ${buscada} está en ${encontradas.join(", ")}.`
                        : `La OT ${buscada} no está en la cañera.`}
                </p>
            )}

            {estado.canera && estado.error && (
                <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    No se pudo actualizar: {estado.error} Se muestra la última que llegó.
                </div>
            )}

            <div className="rounded-xl border border-gray-200 bg-white p-2 sm:p-3">
                <GrillaCanera
                    edita={edita}
                    estado={estado}
                    resaltarOT={buscada || null}
                    onElegirOT={(n) => router.push(`/materia-prima?tab=pendientes&ot=${n}`)}
                />
            </div>

            {edita && estado.canera && (
                <p className="text-xs text-gray-400">
                    Tocá un casillero para ver su OT, moverla o liberarlo; si está libre, para ubicar una OT.
                </p>
            )}

            {dialogo}
            {/* El «Esto no se guarda» del modo práctica (uno solo aunque se monte en cada solapa). */}
            <CartelitoPractica />
        </div>
    );
}

export default CaneraTab;
