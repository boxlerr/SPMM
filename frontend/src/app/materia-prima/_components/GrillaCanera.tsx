"use client";

/**
 * La cañera: el mueble de estantes (columnas A..O × filas 1..9) donde se deja el
 * material ya cortado de cada OT, esperando que la OT arranque.
 *
 * En el sistema viejo era una grilla que se llenaba a mano y se grababa entera con
 * «Grabar cañera»; la ubicación vivía además en otros tres lados que no coincidían
 * (el prefijo «E4 - …» de las observaciones, un campo de la OT y otro de la línea).
 * Acá es una sola cosa: cada casillero se ocupa, se mueve o se libera al toque, y queda
 * el historial (liberar no borra: cierra).
 *
 * DOS TAMAÑOS
 *
 *  · grande (solapa Cañera): cada casillero muestra sus OT; tocarlo abre un cartelito
 *    con la OT (cliente, artículo, estado del material, desde cuándo y quién) y las
 *    acciones: Abrir OT · Ver en Pendientes · Mover a… · Liberar. Si está libre: N° de
 *    OT + «Ubicar».
 *  · compacta (arriba de Pendientes, como en el viejo): baja y sin cartel de edición.
 *    Tocar una OT filtra Pendientes por esa OT (`onElegirOT`), que es lo que Maxi hace
 *    con ella: «¿qué le falta a la del E4?».
 *
 * COLORES (la leyenda, ver `TONOS`): verde = todo el material listo; ámbar = falta
 * material; gris rayado = la OT terminó y el casillero se puede liberar; blanco =
 * libre. En el viejo el verde quería decir «está en el plan semanal»; acá dice algo que
 * sirve para decidir: si la OT ya puede arrancar con lo que tiene.
 *
 * Las columnas M..O casi no se usan: la grande las abre con «ver M–O» (con un aviso si
 * hay algo ahí) y la compacta las muestra sola cuando hay alguna ocupada, para que
 * ninguna OT quede escondida.
 */

import { forwardRef, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRightLeft, ExternalLink, ListFilter, Loader2, LogOut, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MaterialChip } from "@/components/common/MaterialChip";
import { cn } from "@/lib/utils";
import {
    COLUMNAS_CANERA,
    COLUMNAS_CANERA_VISIBLES,
    FILAS_CANERA,
    armarCelda,
    fmtFechaHora,
    numeroDeOcupacion,
    type Ocupacion,
} from "@/lib/materiaPrima";
import { TONOS, ocupacionesPorCelda, tonoDe, useCanera, type EstadoCanera, type TonoCelda } from "./CaneraDatos";
import { CaneraElegirCelda } from "./CaneraElegirCelda";
import { useConfirmarForzar } from "./PendientesForzar";

export interface GrillaCaneraProps {
    edita: boolean;
    compacta?: boolean;
    /**
     * Tocar la OT de un casillero. En la compacta es el toque mismo (Pendientes filtra
     * por esa OT); en la grande, el «Ver en Pendientes» del cartel.
     */
    onElegirOT?: (numero_ot: number) => void;
    /**
     * Los datos y las acciones, cuando los maneja la pantalla (Pendientes y la solapa
     * los comparten con sus filas y sus botones). Sin esto, la grilla pide los suyos.
     */
    estado?: EstadoCanera;
    /** Una OT a resaltar: la que filtra Pendientes, o la que se buscó en la solapa. */
    resaltarOT?: number | string | null;
}

const esMO = (col: string) => !COLUMNAS_CANERA_VISIBLES.includes(col);

export function GrillaCanera({ edita, compacta = false, onElegirOT, estado, resaltarOT }: GrillaCaneraProps) {
    const { confirmar, dialogo } = useConfirmarForzar();
    const propio = useCanera({ activo: !estado, confirmar });
    const c = estado ?? propio;
    const router = useRouter();

    const [verMO, setVerMO] = useState(false);
    const [abierta, setAbierta] = useState<string | null>(null);

    const porCelda = useMemo(() => ocupacionesPorCelda(c.canera), [c.canera]);
    const ocupadasMO = useMemo(
        () => [...porCelda.keys()].filter((celda) => esMO(celda[0])).length,
        [porCelda],
    );
    const columnas = (compacta ? ocupadasMO > 0 : verMO) ? COLUMNAS_CANERA : COLUMNAS_CANERA_VISIBLES;
    const resaltada = resaltarOT === null || resaltarOT === undefined || String(resaltarOT).trim() === ""
        ? null
        : String(resaltarOT).trim();

    const verEnPendientes = (numero: number) => {
        if (onElegirOT) onElegirOT(numero);
        else router.push(`/materia-prima?tab=pendientes&ot=${numero}`);
    };

    if (!c.canera) {
        return (
            <div className={cn("rounded-lg border border-gray-200 bg-white", compacta ? "p-3" : "p-6")}>
                {c.error ? (
                    <div
                        className={cn(
                            "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
                            c.sinServidor ? "border-amber-200 bg-amber-50 text-amber-900" : "border-rose-200 bg-rose-50 text-rose-800",
                        )}
                    >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1">{c.error}</span>
                        {!c.sinServidor && (
                            <button type="button" onClick={() => void c.recargar()} className="font-semibold underline">
                                Reintentar
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="flex items-center justify-center gap-2 py-4 text-xs text-gray-400">
                        <Loader2 className="h-4 w-4 animate-spin" /> Cargando la cañera…
                    </div>
                )}
                {!estado && dialogo}
            </div>
        );
    }

    return (
        <div className="min-w-0">
            <div className="overflow-x-auto pb-1">
                <div
                    className={cn("grid", compacta ? "gap-[2px]" : "gap-1.5")}
                    style={{
                        gridTemplateColumns: `${compacta ? "1rem" : "1.5rem"} repeat(${columnas.length}, minmax(${compacta ? "2.6rem" : "4.25rem"}, 1fr))`,
                    }}
                >
                    <div />
                    {columnas.map((col) => (
                        <div
                            key={col}
                            className={cn(
                                "text-center font-bold",
                                compacta ? "text-[10px]" : "text-xs",
                                esMO(col) ? "text-gray-400" : "text-gray-600",
                            )}
                        >
                            {col}
                        </div>
                    ))}
                    {FILAS_CANERA.map((f) => (
                        <FilaDeGrilla key={f} fila={f} compacta={compacta}>
                            {columnas.map((col) => {
                                const celda = armarCelda(col, f);
                                const ocs = porCelda.get(celda) ?? [];
                                const tono = tonoDe(ocs);
                                const esResaltada = !!resaltada && ocs.some((o) => numeroDeOcupacion(o) === resaltada);
                                const boton = (
                                    <Casillero
                                        celda={celda}
                                        ocupaciones={ocs}
                                        tono={tono}
                                        compacta={compacta}
                                        resaltada={esResaltada}
                                        onClick={
                                            compacta
                                                ? () => {
                                                    const deSPMM = ocs.find((o) => o.numero_ot !== null);
                                                    if (deSPMM?.numero_ot != null) verEnPendientes(deSPMM.numero_ot);
                                                }
                                                : undefined
                                        }
                                        tocable={compacta ? ocs.some((o) => o.numero_ot !== null) : edita || ocs.length > 0}
                                    />
                                );
                                if (compacta || (!edita && !ocs.length)) return <div key={celda}>{boton}</div>;
                                return (
                                    <Popover
                                        key={celda}
                                        open={abierta === celda}
                                        onOpenChange={(o) => setAbierta(o ? celda : null)}
                                    >
                                        <PopoverTrigger asChild>{boton}</PopoverTrigger>
                                        <PopoverContent className="w-[26rem] max-w-[calc(100vw-1.5rem)] p-0" align="center">
                                            <CartelCasillero
                                                celda={celda}
                                                ocupaciones={ocs}
                                                edita={edita}
                                                estado={c}
                                                onCerrar={() => setAbierta(null)}
                                                onAbrirOT={(id) => router.push(`/operaciones?edit_ot=${id}`)}
                                                onVerEnPendientes={(n) => {
                                                    setAbierta(null);
                                                    verEnPendientes(n);
                                                }}
                                            />
                                        </PopoverContent>
                                    </Popover>
                                );
                            })}
                        </FilaDeGrilla>
                    ))}
                </div>
            </div>

            <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", compacta ? "mt-1.5" : "mt-3")}>
                <Leyenda compacta={compacta} />
                {!compacta && (
                    <button
                        type="button"
                        onClick={() => setVerMO((v) => !v)}
                        className="ml-auto rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                    >
                        {verMO ? "Ocultar M–O" : "Ver M–O"}
                        {!verMO && ocupadasMO > 0 && (
                            <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">
                                {ocupadasMO} ocupado{ocupadasMO === 1 ? "" : "s"}
                            </span>
                        )}
                    </button>
                )}
                {c.guardando && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                        <Loader2 className="h-3 w-3 animate-spin" /> Guardando…
                    </span>
                )}
            </div>
            {!estado && dialogo}
        </div>
    );
}

export default GrillaCanera;

function FilaDeGrilla({ fila, compacta, children }: { fila: number; compacta: boolean; children: ReactNode }) {
    return (
        <>
            <div className={cn("flex items-center justify-center font-bold text-gray-500", compacta ? "text-[10px]" : "text-xs")}>
                {fila}
            </div>
            {children}
        </>
    );
}

/**
 * Un casillero. Con `forwardRef` y pasando el resto de las props al botón: en la grande
 * va adentro de `PopoverTrigger asChild`, y Radix le da por ahí el ref (para ubicar el
 * cartel) y su `onClick` (para abrirlo).
 */
type CasilleroProps = {
    celda: string;
    ocupaciones: Ocupacion[];
    tono: TonoCelda;
    compacta: boolean;
    resaltada: boolean;
    tocable: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>;

const Casillero = forwardRef<HTMLButtonElement, CasilleroProps>(function Casillero(
    { celda, ocupaciones, tono, compacta, resaltada, tocable, className, ...resto },
    ref,
) {
    const numeros = ocupaciones.map(numeroDeOcupacion);
    const titulo = ocupaciones.length
        ? ocupaciones
            .map((o) =>
                [
                    `${celda} · OT ${numeroDeOcupacion(o)}`,
                    o.cliente,
                    o.articulo,
                    o.finalizada ? "terminada: se puede liberar" : null,
                    o.id_orden_trabajo === null ? "no es una OT de SPMM" : null,
                ]
                    .filter(Boolean)
                    .join(" · "),
            )
            .join("\n")
        : `${celda}: libre`;
    const temporal = ocupaciones.some((o) => o.id < 0);
    return (
        <button
            ref={ref}
            type="button"
            title={titulo}
            aria-label={titulo}
            disabled={!tocable && !ocupaciones.length}
            {...resto}
            className={cn(
                "relative flex w-full flex-col items-center justify-center overflow-hidden rounded-md border font-semibold tabular-nums leading-tight transition-colors",
                compacta ? "h-6 px-0.5 text-[10px]" : "h-16 px-1 text-xs",
                TONOS[tono].celda,
                tocable ? "cursor-pointer" : "cursor-default",
                resaltada && "ring-2 ring-blue-600 ring-offset-1",
                temporal && "animate-pulse",
                className,
            )}
        >
            {ocupaciones.length === 0 ? (
                <span className={cn("font-medium", compacta ? "text-[9px] text-gray-200" : "text-[11px]")}>{celda}</span>
            ) : compacta ? (
                <span className="w-full truncate">
                    {numeros[0]}
                    {numeros.length > 1 && <span className="text-[9px] opacity-70"> +{numeros.length - 1}</span>}
                </span>
            ) : (
                <>
                    {numeros.slice(0, 2).map((n, i) => (
                        <span key={i} className="w-full truncate text-[13px] font-bold">{n}</span>
                    ))}
                    {numeros.length > 2 && <span className="text-[10px] opacity-70">+{numeros.length - 2}</span>}
                    {numeros.length === 1 && ocupaciones[0].cliente && (
                        <span className="w-full truncate text-[10px] font-normal opacity-75">{ocupaciones[0].cliente}</span>
                    )}
                    <span className="absolute left-1 top-0.5 text-[8px] font-medium opacity-50">{celda}</span>
                </>
            )}
        </button>
    );
});

/** El cartel de un casillero (grilla grande). */
function CartelCasillero({
    celda,
    ocupaciones,
    edita,
    estado,
    onCerrar,
    onAbrirOT,
    onVerEnPendientes,
}: {
    celda: string;
    ocupaciones: Ocupacion[];
    edita: boolean;
    estado: EstadoCanera;
    onCerrar: () => void;
    onAbrirOT: (id: number) => void;
    onVerEnPendientes: (numero: number) => void;
}) {
    const [numero, setNumero] = useState("");
    const [moviendo, setMoviendo] = useState<number | null>(null);
    const [ocupado, setOcupado] = useState(false);

    const ubicar = async () => {
        if (!numero.trim()) return;
        setOcupado(true);
        // Se cierra ya: el casillero se pinta solo (optimista) y el cartel no tapa nada.
        onCerrar();
        await estado.asignar(celda, numero.trim());
        setOcupado(false);
    };

    return (
        <div className="text-sm">
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
                <span className="text-base font-bold text-gray-900">{celda}</span>
                <button
                    type="button"
                    onClick={onCerrar}
                    className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    aria-label="Cerrar"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            {ocupaciones.length === 0 ? (
                <div className="space-y-2 px-3 py-3">
                    <p className="text-xs text-gray-500">Está libre. ¿Qué OT va acá?</p>
                    {edita && (
                        <div className="flex gap-2">
                            <input
                                autoFocus
                                value={numero}
                                onChange={(e) => setNumero(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        void ubicar();
                                    }
                                }}
                                inputMode="numeric"
                                placeholder="N° de OT"
                                className="h-8 w-full min-w-0 rounded-md border border-gray-200 px-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                aria-label="Número de OT"
                            />
                            <button
                                type="button"
                                disabled={!numero.trim() || ocupado}
                                onClick={() => void ubicar()}
                                className="h-8 shrink-0 rounded-md bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                            >
                                Ubicar
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <ul className="divide-y divide-gray-100">
                    {ocupaciones.map((o) => (
                        <li key={o.id} className="space-y-2 px-3 py-3">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="font-bold text-gray-900">OT {numeroDeOcupacion(o)}</p>
                                    {(o.cliente || o.articulo) && (
                                        <p className="text-xs text-gray-600">
                                            {[o.cliente, o.articulo].filter(Boolean).join(" · ")}
                                        </p>
                                    )}
                                </div>
                                {o.id_orden_trabajo !== null && o.estado_material && (
                                    <MaterialChip estado={o.estado_material} className="shrink-0 text-[10px]" />
                                )}
                            </div>
                            {o.id_orden_trabajo === null && (
                                <p className="rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                                    Este número no es una OT de SPMM: quedó anotado tal cual (venía así del sistema viejo, o se ubicó igual).
                                </p>
                            )}
                            {o.finalizada && (
                                <p className="rounded-md bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-700">
                                    La OT ya terminó: el casillero se puede liberar.
                                </p>
                            )}
                            <p className="text-[11px] text-gray-400">
                                Desde {fmtFechaHora(o.desde)}
                                {o.asignado_por ? ` · la ubicó ${o.asignado_por}` : ""}
                            </p>

                            <div className="flex flex-wrap gap-1.5">
                                {o.id_orden_trabajo !== null && (
                                    <AccionCartel onClick={() => onAbrirOT(o.id_orden_trabajo as number)} icono={<ExternalLink className="h-3.5 w-3.5" />}>
                                        Abrir OT
                                    </AccionCartel>
                                )}
                                {o.numero_ot !== null && (
                                    <AccionCartel onClick={() => onVerEnPendientes(o.numero_ot as number)} icono={<ListFilter className="h-3.5 w-3.5" />}>
                                        Ver en Pendientes
                                    </AccionCartel>
                                )}
                                {edita && (
                                    <AccionCartel
                                        activo={moviendo === o.id}
                                        onClick={() => setMoviendo(moviendo === o.id ? null : o.id)}
                                        icono={<ArrowRightLeft className="h-3.5 w-3.5" />}
                                    >
                                        Mover a…
                                    </AccionCartel>
                                )}
                                {edita && (
                                    <AccionCartel
                                        peligro
                                        onClick={() => {
                                            onCerrar();
                                            void estado.liberar(o.id);
                                        }}
                                        icono={<LogOut className="h-3.5 w-3.5" />}
                                    >
                                        Liberar
                                    </AccionCartel>
                                )}
                            </div>

                            {moviendo === o.id && (
                                <div className="rounded-md border border-gray-100 bg-gray-50/70 p-2">
                                    <CaneraElegirCelda
                                        canera={estado.canera}
                                        desde={celda}
                                        titulo={`Mover la OT ${numeroDeOcupacion(o)} a…`}
                                        onElegir={(destino) => {
                                            onCerrar();
                                            void estado.mover(o.id, destino);
                                        }}
                                    />
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function AccionCartel({
    children,
    icono,
    onClick,
    peligro = false,
    activo = false,
}: {
    children: ReactNode;
    icono: ReactNode;
    onClick: () => void;
    peligro?: boolean;
    activo?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                peligro
                    ? "border-rose-200 text-rose-700 hover:bg-rose-50"
                    : activo
                        ? "border-blue-300 bg-blue-50 text-blue-700"
                        : "border-gray-200 text-gray-700 hover:bg-gray-50",
            )}
        >
            {icono}
            {children}
        </button>
    );
}

/** La leyenda de colores. En la compacta, los mismos cuadraditos en una línea chica. */
export function Leyenda({ compacta = false }: { compacta?: boolean }) {
    const tonos: TonoCelda[] = ["lista", "falta", "terminada", "externa", "libre"];
    return (
        <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-gray-500", compacta ? "text-[10px]" : "text-xs")}>
            {tonos.map((t) => (
                <span key={t} className="inline-flex items-center gap-1">
                    <span className={cn("inline-block rounded-sm border", compacta ? "h-2.5 w-2.5" : "h-3 w-3", TONOS[t].muestra)} />
                    {TONOS[t].rotulo}
                </span>
            ))}
        </div>
    );
}
