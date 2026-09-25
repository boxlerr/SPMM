"use client";

/**
 * Una fila de Pendientes: una materia prima de una OT, con todo lo que Maxi marca al
 * comprar.
 *
 * Está hecha para marcar muchas seguidas sin mirar la pantalla dos veces:
 *  · las casillas son `<input type="checkbox">` nativos: Tab las recorre y Espacio las
 *    tilda, y cada tilde se guarda sola (no hay botón Grabar);
 *  · los textos (observaciones) y las fechas se guardan al salir del campo o con Enter;
 *    Escape vuelve a lo que había;
 *  · al guardar NO se redibuja la tabla ni se mueve nada: la fila es la misma (misma
 *    `key`, mismo elemento), así que el foco y el scroll se quedan donde estaban.
 *
 * `React.memo`: con cientos de filas, tildar una no puede redibujar las demás. Por eso
 * las acciones llegan juntas en un objeto que no cambia (`AccionesFila`) y cada fila
 * recibe su línea ya armada.
 */

import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { AlertTriangle, Loader2, MapPin, Plus, Scissors } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { API_URL } from "@/config";
import { cn } from "@/lib/utils";
import {
    estadoLinea,
    fmtCantidad,
    fmtFecha,
    fmtFechaCorta,
    fmtFechaHora,
    fmtMm,
    hoyISO,
    leerCantidad,
    mpGet,
    type CambiosLinea,
    type LineaPendiente,
    type OTPendiente,
    type Recorte,
} from "@/lib/materiaPrima";
import { useCaneraDePantalla } from "./CaneraDatos";
import { CaneraElegirCelda } from "./CaneraElegirCelda";
import { SelectorProveedor } from "./SelectorProveedor";
import { useEnvioSinRepetir } from "./PendientesForzar";
import { CeldaCortes, corteMasLargo } from "./PendientesCortes";

/** Lo que una fila le pide a la pantalla. Un solo objeto que no cambia, para que `memo` sirva. */
export interface AccionesFila {
    /**
     * Se cumple cuando terminó (409 incluido), con `true` si quedó guardado. La esperan la
     * reserva (para no aceptar otro clic) y «Disponible» (pregunta el casillero sólo si quedó).
     */
    guardar: (id: number, cambios: CambiosLinea) => Promise<boolean>;
    /** Tildar/destildar la fila; con Shift, todo el tramo desde la última tocada. */
    seleccionar: (id: number, conShift: boolean) => void;
    abrirOT: (idOrden: number) => void;
    verInsumo: (idPieza: number) => void;
    ubicar: (linea: LineaPendiente, celda: string) => void;
    /** Abrir el diálogo de cortes de la línea (sólo en modo edición). */
    editarCortes: (idLinea: number) => void;
}

export interface FilaPendienteProps {
    linea: LineaPendiente;
    ot: OTPendiente | undefined;
    edita: boolean;
    seleccionada: boolean;
    /** Primera fila de un tramo de la misma OT: lleva el número grande, el cliente y las fechas. */
    primera: boolean;
    /** Tramos alternados de OT (el «cebra»): se lee dónde empieza y termina cada una. */
    zebra: boolean;
    /**
     * Los casilleros que dicen las observaciones de las líneas de la OT («E4 - soporte…»,
     * como se anotaba en el viejo), separados por espacio. Sólo se muestran si la cañera
     * no tiene a la OT. Texto y no lista: así `memo` compara por valor.
     */
    coordObs?: string;
    acciones: AccionesFila;
}

/** «13/08/26»: la fecha de la OT puede ser de otro año, y en la columna entra justo. */
const fmtCortaConAnio = (iso: string | null | undefined) => {
    const m = (iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : "—";
};

/** El número como se edita: coma decimal y sin puntos de miles («2,5»). */
const aEditable = (n: number | null | undefined) =>
    n === null || n === undefined ? "" : String(Number(n.toFixed(3))).replace(".", ",");

/** Fondo de la fila: sólido (no transparente) porque las primeras columnas quedan fijas al deslizar y tapan a las otras. */
function fondoDeFila(estado: ReturnType<typeof estadoLinea>, zebra: boolean, seleccionada: boolean) {
    if (seleccionada) return "bg-blue-50";
    if (estado === "lista") return zebra ? "bg-[#e4f6e9]" : "bg-green-50";
    if (estado === "esperando") return zebra ? "bg-[#fdf1d3]" : "bg-amber-50";
    return zebra ? "bg-gray-50" : "bg-white";
}

function FilaPendienteBase({ linea: l, ot, edita, seleccionada, primera, zebra, coordObs, acciones }: FilaPendienteProps) {
    const estado = estadoLinea(l);
    const hoy = hoyISO();
    const vencida = !!l.fecha_requerida && l.fecha_requerida < hoy && !l.disponible;
    const quien = (por: string | null, en: string | null) =>
        [por ? `por ${por}` : null, en ? `el ${fmtFechaHora(en)}` : null].filter(Boolean).join(" ");

    const guardar = (c: CambiosLinea) => acciones.guardar(l.id, c);

    return (
        <tr
            data-linea={l.id}
            className={cn(
                "group text-xs text-gray-800 [&>td]:border-b [&>td]:border-gray-100 [&>td]:px-2 [&>td]:py-1.5 [&>td]:align-top",
                fondoDeFila(estado, zebra, seleccionada),
                primera && "[&>td]:border-t [&>td]:border-t-gray-300",
            )}
        >
            {/* La elección y la OT, en UNA celda fija a la izquierda: al deslizar para
                ver las fechas no se pierde de qué OT es la fila. Una sola celda y no dos:
                dos celdas fijas tienen que calzar al píxel (la segunda va a `left` = ancho
                de la primera) y el navegador redondea el ancho de las columnas; por la
                rendija se veía pasar el texto de abajo.
                En el teléfono va más angosta (sin el cliente, que queda en el título del
                número): con el cliente, un nombre largo estiraba la columna y en 375 px
                ocupaba 242 de los 313 que se ven (E2E del 24/09). Los anchos son los del
                encabezado (`Th` de la OT en PendientesTab). */}
            <td
                className={cn(
                    "sticky left-0 z-10 bg-inherit",
                    edita
                        ? "w-[148px] min-w-[148px] max-sm:w-[96px] max-sm:min-w-[96px]"
                        : "w-[116px] min-w-[116px] max-sm:w-[72px] max-sm:min-w-[72px]",
                    // «Falta pedir»: la marca roja a la izquierda (ver ESTADOS_LINEA). Sombra
                    // y no borde: el borde de una celda fija se va con el scroll.
                    estado === "falta_pedir" && "shadow-[inset_4px_0_0_#ef4444]",
                )}
            >
                <div className="flex items-start gap-2.5 max-sm:gap-1.5">
                    {edita && (
                        <input
                            type="checkbox"
                            checked={seleccionada}
                            onChange={() => undefined}
                            onClick={(e) => acciones.seleccionar(l.id, e.shiftKey)}
                            className="ml-1 mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-blue-600"
                            aria-label={`Elegir ${l.codigo} de la OT ${l.numero_ot ?? ""}`}
                        />
                    )}
                    <div className="min-w-0 flex-1">
                        <button
                            type="button"
                            onClick={() => acciones.abrirOT(l.id_orden_trabajo)}
                            className={cn(
                                "tabular-nums hover:underline",
                                primera ? "text-sm font-bold text-blue-700" : "text-[11px] font-medium text-gray-400",
                            )}
                            title={[
                                `Abrir la OT ${l.numero_ot ?? ""}`,
                                ot?.cliente,
                                ot?.articulo,
                                ot?.unidades ? `${fmtCantidad(ot.unidades)} unidades` : null,
                                ot?.fecha_prometida ? `prometida ${fmtFecha(ot.fecha_prometida)}` : null,
                                ot?.prioridad ? `prioridad ${ot.prioridad}` : null,
                            ]
                                .filter(Boolean)
                                .join(" · ")}
                        >
                            {l.numero_ot ?? "—"}
                        </button>
                        {primera && (
                            <div className="mt-0.5 space-y-px leading-tight">
                                {/* `max-w`: `truncate` solo no alcanza en una tabla; el ancho
                                    mínimo de la celda sería el del nombre entero. */}
                                {ot?.cliente && (
                                    <div className="max-w-[100px] truncate text-[10px] text-gray-500 max-sm:hidden" title={ot.cliente}>
                                        {ot.cliente}
                                    </div>
                                )}
                                <div className="text-[10px] text-gray-400" title="Fecha de la OT (la «T» del sistema viejo)">
                                    T {fmtCortaConAnio(l.fecha_ot)}
                                </div>
                                {l.fecha_requerida && (
                                    <div
                                        className={cn("text-[10px]", vencida ? "font-semibold text-red-600" : "text-amber-700")}
                                        title="Cuándo arranca la OT según el plan: para ese día tiene que estar el material."
                                    >
                                        <span className="max-sm:hidden">se necesita</span>
                                        <span className="sm:hidden">nec.</span> {fmtFechaCorta(l.fecha_requerida)}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </td>

            <td className="w-[92px] whitespace-nowrap">
                <button
                    type="button"
                    onClick={() => acciones.verInsumo(l.id_pieza)}
                    className="font-mono text-[11px] font-semibold text-gray-800 hover:text-blue-700 hover:underline"
                    title="Ver la ficha del insumo (stock, recortes, precios)"
                >
                    {l.codigo}
                </button>
            </td>

            <td className="min-w-[240px] max-w-[340px]">
                <div className="line-clamp-2" title={l.descripcion}>{l.descripcion}</div>
            </td>

            <td className="w-[64px] text-right font-semibold tabular-nums">{fmtCantidad(l.cantidad)}</td>
            <td className="w-[44px] text-gray-500">{l.unidad ?? ""}</td>

            <td className="w-[124px] min-w-[124px]">
                <CeldaCortes linea={l} edita={edita} onEditar={acciones.editarCortes} />
            </td>

            <td className="w-[170px] min-w-[170px]">
                {edita ? (
                    <SelectorProveedor
                        valor={{ id: l.id_proveedor, nombre: l.proveedor }}
                        onCambiar={(v) => {
                            if (v.id === l.id_proveedor && (v.nombre ?? null) === (l.proveedor ?? null)) return;
                            guardar({ id_proveedor: v.id, proveedor: v.nombre });
                        }}
                        permitirTextoLibre
                        placeholder="—"
                        triggerClassName="h-7 px-1.5 text-xs border-transparent bg-transparent hover:border-gray-200"
                    />
                ) : (
                    <span className="block truncate" title={l.proveedor ?? ""}>{l.proveedor ?? "—"}</span>
                )}
            </td>

            <td className="w-[190px] min-w-[190px]">
                <CeldaTexto
                    valor={l.observaciones}
                    disabled={!edita}
                    placeholder={edita ? "Obs." : ""}
                    onGuardar={(t) => guardar({ observaciones: t })}
                    etiqueta={`Observaciones de ${l.codigo}`}
                />
            </td>

            <td className="w-[52px] text-center">
                <Casilla
                    marcada={l.pedido}
                    disabled={!edita}
                    tono="accent-amber-600"
                    onCambiar={(v) => guardar({ pedido: v })}
                    titulo={l.pedido ? `Pedido ${quien(l.pedido_por, l.pedido_en)}` : "Marcar como pedido al proveedor"}
                />
            </td>
            <td className="w-[52px] text-center">
                <CasillaReserva linea={l} edita={edita} onGuardar={guardar} />
            </td>
            <td className="w-[52px] text-center">
                <CasillaDisponible
                    linea={l}
                    edita={edita}
                    onGuardar={guardar}
                    onUbicar={acciones.ubicar}
                    titulo={
                        l.disponible
                            ? `${`Disponible ${quien(l.disponible_por, l.disponible_en)}`.trim()}: cortado y en la cañera`
                            : l.reserva
                                ? "Marcar disponible (cortado y en la cañera): retira del stock lo reservado"
                                : "Marcar disponible: está cortado y en la cañera, el operario lo puede retirar"
                    }
                />
            </td>
            <td className="w-[52px] text-center">
                {l.ot_en_curso ? (
                    <Casilla
                        marcada
                        disabled
                        tono="accent-blue-600"
                        onCambiar={() => undefined}
                        titulo="Se marca solo: la OT ya arrancó en el taller."
                    />
                ) : (
                    <Casilla
                        marcada={l.en_produccion}
                        disabled={!edita}
                        tono="accent-blue-600"
                        onCambiar={(v) => guardar({ en_produccion: v })}
                        titulo="En producción (PRODUC): el material se está fabricando o está en un tercero"
                    />
                )}
            </td>

            <td className="w-[128px]">
                <CeldaFecha
                    valor={l.fecha_proveedor}
                    disabled={!edita}
                    onGuardar={(f) => guardar({ fecha_proveedor: f })}
                    etiqueta={`Fecha que prometió el proveedor para ${l.codigo}`}
                />
            </td>
            <td className="w-[128px]">
                <CeldaFecha
                    valor={l.fecha_entrega}
                    disabled={!edita}
                    onGuardar={(f) => guardar({ fecha_entrega: f })}
                    etiqueta={`Fecha en que llegó ${l.codigo}`}
                />
            </td>

            <td className={cn("w-[72px] text-right tabular-nums", l.stock_libre < 0 ? "font-semibold text-red-600" : l.stock_libre > 0 ? "text-gray-800" : "text-gray-400")}>
                {fmtCantidad(l.stock_libre)}
            </td>
            <td className="w-[72px] text-right tabular-nums text-gray-700">
                {l.reserva ? fmtCantidad(l.cantidad_reservada) : <span className="text-gray-300">—</span>}
            </td>
            <td className={cn("w-[64px] text-right tabular-nums", l.falta > 0 ? "font-bold text-red-600" : "text-gray-300")}>
                {l.falta > 0 ? fmtCantidad(l.falta) : "—"}
            </td>

            <td className="w-[110px] min-w-[110px]">
                <CeldaCanera linea={l} edita={edita} coordObs={coordObs} onUbicar={acciones.ubicar} />
            </td>

            <td className="w-[48px] text-center">
                {l.recortes_disponibles > 0 && (
                    <BotonRecortes
                        idPieza={l.id_pieza}
                        cantidad={l.recortes_disponibles}
                        codigo={l.codigo}
                        largoMaximo={corteMasLargo(l.cortes)}
                        onVerInsumo={acciones.verInsumo}
                    />
                )}
            </td>
        </tr>
    );
}

export const FilaPendiente = memo(FilaPendienteBase);

// ═══════════════════════════ celdas ═══════════════════════════

/** Una casilla nativa: la más liviana, y Tab + Espacio sin sorpresas. */
function Casilla({
    marcada,
    disabled,
    onCambiar,
    titulo,
    tono,
}: {
    marcada: boolean;
    disabled?: boolean;
    onCambiar: (v: boolean) => void;
    titulo: string;
    tono: string;
}) {
    return (
        <input
            type="checkbox"
            checked={marcada}
            disabled={disabled}
            onChange={(e) => onCambiar(e.target.checked)}
            title={titulo}
            aria-label={titulo}
            className={cn("mt-0.5 h-4 w-4", tono, disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer")}
        />
    );
}

/**
 * Un texto que se edita en el lugar. Se guarda al salir o con Enter; Escape vuelve a lo
 * que había. Mientras se escribe, lo que llega del servidor no lo pisa.
 */
function CeldaTexto({
    valor,
    onGuardar,
    disabled,
    placeholder,
    etiqueta,
}: {
    valor: string | null;
    onGuardar: (t: string | null) => void;
    disabled?: boolean;
    placeholder?: string;
    etiqueta: string;
}) {
    const [texto, setTexto] = useState(valor ?? "");
    const [editando, setEditando] = useState(false);
    const cancelado = useRef(false);

    useEffect(() => {
        if (!editando) setTexto(valor ?? "");
    }, [valor, editando]);

    if (disabled) {
        // Dos renglones y no uno: en sólo lectura (la prueba piloto) la observación es lo
        // que Maxi lee para pedir («Pedir a DANIEL», «Mercadolibre», el remito).
        return (
            <span className="line-clamp-2 break-words text-gray-700" title={valor ?? ""}>
                {valor || <span className="text-gray-300">—</span>}
            </span>
        );
    }

    return (
        <input
            value={texto}
            onFocus={() => {
                cancelado.current = false;
                setEditando(true);
            }}
            onChange={(e) => setTexto(e.target.value)}
            onBlur={() => {
                setEditando(false);
                if (cancelado.current) return;
                const t = texto.trim();
                if (t !== (valor ?? "").trim()) onGuardar(t || null);
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                } else if (e.key === "Escape") {
                    // preventDefault: que el Escape de la pantalla (soltar la selección) no lo tome.
                    e.preventDefault();
                    cancelado.current = true;
                    setTexto(valor ?? "");
                    e.currentTarget.blur();
                }
            }}
            placeholder={placeholder}
            title={valor ?? ""}
            aria-label={etiqueta}
            className="h-7 w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 text-xs outline-none placeholder:text-gray-300 hover:border-gray-200 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
        />
    );
}

/**
 * Una fecha que se edita en el lugar (`type="date"`, «YYYY-MM-DD», sin zona). Se guarda
 * al salir y no a cada cambio: al tipear el año, el campo pasa por 0002, 0020, 0202 y
 * cada uno es una fecha «válida» que se guardaría.
 */
function CeldaFecha({
    valor,
    onGuardar,
    disabled,
    etiqueta,
}: {
    valor: string | null;
    onGuardar: (f: string | null) => void;
    disabled?: boolean;
    etiqueta: string;
}) {
    const [texto, setTexto] = useState(valor ?? "");
    const [editando, setEditando] = useState(false);
    const cancelado = useRef(false);

    useEffect(() => {
        if (!editando) setTexto(valor ?? "");
    }, [valor, editando]);

    if (disabled) {
        return <span className="tabular-nums text-gray-700">{valor ? fmtFecha(valor) : <span className="text-gray-300">—</span>}</span>;
    }

    const confirmar = () => {
        setEditando(false);
        if (cancelado.current) return;
        const f = /^\d{4}-\d{2}-\d{2}$/.test(texto) && Number(texto.slice(0, 4)) >= 2000 ? texto : "";
        if (!f && texto) {
            // Quedó a medio escribir o con un año imposible: se vuelve a lo que había.
            setTexto(valor ?? "");
            return;
        }
        if ((f || null) !== (valor ?? null)) onGuardar(f || null);
    };

    return (
        <input
            type="date"
            value={texto}
            onFocus={() => {
                cancelado.current = false;
                setEditando(true);
            }}
            onChange={(e) => setTexto(e.target.value)}
            onBlur={confirmar}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                } else if (e.key === "Escape") {
                    // preventDefault: que el Escape de la pantalla (soltar la selección) no lo tome.
                    e.preventDefault();
                    cancelado.current = true;
                    setTexto(valor ?? "");
                    e.currentTarget.blur();
                }
            }}
            aria-label={etiqueta}
            title={etiqueta}
            className={cn(
                "h-7 w-full min-w-0 rounded border border-transparent bg-transparent px-1 text-xs tabular-nums outline-none hover:border-gray-200 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100",
                !texto && "text-gray-300 focus:text-gray-800",
            )}
        />
    );
}

/**
 * «Reserva»: tildarla pregunta cuánto se aparta del stock, con lo que alcanza sugerido
 * (lo libre, hasta la cantidad de la línea) y ya seleccionado: Enter y listo. Si lo que
 * se pide supera lo libre, avisa antes; el backend igual pregunta (409) y se puede
 * hacer igual. Destildarla la saca sin preguntar.
 *
 * Mientras la reserva se guarda (y mientras está abierta la pregunta del 409) no se
 * acepta otro toque ni en «Reservar» ni en la casilla: el cartelito queda abierto con
 * «Reservando…» hasta que termina. Un doble clic en «Reservar» mandaba dos guardados, o
 * el segundo clic caía en la tabla de abajo o cerraba el aviso del 409 como «Cancelar»
 * (E2E del 24/09; ver `useEnvioSinRepetir`). Lo libre que muestra queda congelado
 * mientras tanto: si la respuesta lo cambia, el aviso de «Hay 0 libres» aparece o se va
 * y los botones se corren un renglón justo debajo del cursor.
 */
function CasillaReserva({
    linea: l,
    edita,
    onGuardar,
}: {
    linea: LineaPendiente;
    edita: boolean;
    onGuardar: (c: CambiosLinea) => Promise<unknown> | void;
}) {
    const [abierto, setAbierto] = useState(false);
    const [texto, setTexto] = useState("");
    const envio = useEnvioSinRepetir();
    const libre = Math.max(0, l.stock_libre ?? 0);
    const sugerida = Math.min(l.cantidad, libre) > 0 ? Math.min(l.cantidad, libre) : l.cantidad;
    const cantidad = leerCantidad(texto);
    const valida = cantidad !== null && cantidad > 0;
    // Desde que se tocó «Reservar» (mientras se guarda y mientras se va), lo libre que se veía.
    const [libreCongelado, setLibreCongelado] = useState<number | null>(null);
    const libreVisto = libreCongelado ?? libre;
    const stockLibreVisto = libreCongelado ?? l.stock_libre;

    const reservar = () => {
        if (!valida || envio.ocupado()) return;
        setLibreCongelado(libre);
        envio.enviar(() => onGuardar({ reserva: true, cantidad_reservada: cantidad }), () => setAbierto(false));
    };

    const titulo = l.reserva
        ? `Reservado del stock: ${fmtCantidad(l.cantidad_reservada)} ${l.unidad ?? ""}. Destildar para soltarlo.`
        : `Reservar del stock (hay ${fmtCantidad(l.stock_libre)} libres)`;

    return (
        <PopoverPrimitive.Root open={abierto} onOpenChange={setAbierto}>
            <PopoverPrimitive.Anchor asChild>
                <input
                    type="checkbox"
                    checked={l.reserva}
                    disabled={!edita}
                    onChange={() => {
                        if (envio.ocupado()) return;
                        if (l.reserva) {
                            onGuardar({ reserva: false });
                            return;
                        }
                        setLibreCongelado(null);
                        setTexto(aEditable(sugerida));
                        setAbierto(true);
                    }}
                    title={titulo}
                    aria-label={titulo}
                    className={cn("mt-0.5 h-4 w-4 accent-amber-600", edita ? "cursor-pointer" : "cursor-not-allowed opacity-60")}
                />
            </PopoverPrimitive.Anchor>
            <PopoverContent className="w-64 p-3" align="center" onOpenAutoFocus={(e) => e.preventDefault()}>
                <p className="text-xs font-semibold text-gray-800">Reservar {l.codigo} del stock</p>
                <p className="mt-0.5 text-[11px] text-gray-500">
                    Libre: <b className="tabular-nums">{fmtCantidad(stockLibreVisto)}</b> {l.unidad ?? ""} · la línea pide{" "}
                    <b className="tabular-nums">{fmtCantidad(l.cantidad)}</b>
                </p>
                <div className="mt-2 flex items-center gap-2">
                    <input
                        autoFocus
                        onFocus={(e) => e.currentTarget.select()}
                        value={texto}
                        readOnly={envio.enviando}
                        onChange={(e) => setTexto(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                reservar();
                            }
                        }}
                        inputMode="decimal"
                        className={cn(
                            "h-8 w-full min-w-0 rounded-md border px-2 text-sm tabular-nums outline-none focus:ring-2",
                            texto && !valida ? "border-rose-300 focus:ring-rose-100" : "border-gray-200 focus:border-blue-400 focus:ring-blue-100",
                        )}
                        aria-label="Cantidad a reservar"
                    />
                    <span className="text-xs text-gray-500">{l.unidad ?? ""}</span>
                </div>
                {valida && cantidad! > libreVisto && (
                    <p className="mt-1.5 flex items-start gap-1 text-[11px] text-amber-700">
                        <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                        Hay {fmtCantidad(libreVisto)} libres: la reserva deja el stock en negativo (te va a preguntar).
                    </p>
                )}
                <div className="mt-2.5 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={() => setAbierto(false)}
                        className="rounded-md px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        disabled={!valida || envio.enviando}
                        onClick={reservar}
                        className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                        {envio.enviando && <Loader2 className="h-3 w-3 animate-spin" />}
                        {envio.enviando ? "Reservando…" : "Reservar"}
                    </button>
                </div>
            </PopoverContent>
        </PopoverPrimitive.Root>
    );
}

/**
 * Las OT a las que ya se les preguntó el casillero en esta pantalla: se pregunta una vez.
 * La usa también «Marcar disponible» en lote (PendientesTab), para no preguntar dos veces.
 */
export const casilleroPreguntado = new Set<number>();

/**
 * «Disp»: el material está cortado y en la cañera, el operario lo puede retirar (Lucas,
 * 23/09: «cuando está disponible quiere decir que está cortado… y después, una vez que
 * están, le pone coordenadas»).
 *
 * Por eso, al tildarla en una OT que todavía no tiene casillero, pregunta en cuál quedó,
 * con el mismo selector de «Ubicar». Pregunta cuando el guardado de «Disponible» salió
 * bien: si falla (o se cancela el aviso del 409), la marca vuelve atrás y no se pregunta
 * nada (preguntar en qué casillero quedó algo que no quedó disponible confunde). Sin
 * bloquear: se cierra con «Ahora no» (o tocando afuera) y no vuelve a salir para esa OT.
 */
function CasillaDisponible({
    linea: l,
    edita,
    titulo,
    onGuardar,
    onUbicar,
}: {
    linea: LineaPendiente;
    edita: boolean;
    titulo: string;
    onGuardar: (c: CambiosLinea) => Promise<boolean>;
    onUbicar: (linea: LineaPendiente, celda: string) => void;
}) {
    const ctx = useCaneraDePantalla();
    const [preguntar, setPreguntar] = useState(false);
    const casilla = useRef<HTMLInputElement>(null);
    const canera = ctx?.estado.canera ?? null;
    // La cañera de cuando contesta el guardado, no la del clic: en el medio pudo haber
    // llegado (o alguien pudo haber ubicado la OT desde otra fila).
    const ctxRef = useRef(ctx);
    ctxRef.current = ctx;

    const sinCasillero = () => {
        const c = ctxRef.current;
        return !!c?.estado.canera && !(c.celdasPorOT.get(l.id_orden_trabajo) ?? []).length;
    };

    const cambiar = async (v: boolean) => {
        const preguntaria =
            v && edita && l.numero_ot !== null && l.numero_ot !== undefined && !casilleroPreguntado.has(l.id_orden_trabajo) && sinCasillero();
        // Se aparta la OT ya: dos tildes seguidas en la misma OT no preguntan dos veces.
        if (preguntaria) casilleroPreguntado.add(l.id_orden_trabajo);
        const quedo = await onGuardar({ disponible: v });
        if (!preguntaria) return;
        if (!quedo) {
            // No quedó disponible: la próxima vez que se tilde, que pregunte.
            casilleroPreguntado.delete(l.id_orden_trabajo);
            return;
        }
        if (sinCasillero()) setPreguntar(true);
    };

    return (
        <PopoverPrimitive.Root open={preguntar} onOpenChange={setPreguntar}>
            <PopoverPrimitive.Anchor asChild>
                <input
                    ref={casilla}
                    type="checkbox"
                    checked={l.disponible}
                    disabled={!edita}
                    onChange={(e) => void cambiar(e.target.checked)}
                    title={titulo}
                    aria-label={titulo}
                    className={cn("mt-0.5 h-4 w-4 accent-green-600", edita ? "cursor-pointer" : "cursor-not-allowed opacity-60")}
                />
            </PopoverPrimitive.Anchor>
            <PopoverContent
                className="w-[26rem] max-w-[calc(100vw-1.5rem)] p-3"
                align="center"
                onCloseAutoFocus={(e) => {
                    // Que el foco vuelva a la casilla: se sigue marcando con Tab + Espacio.
                    e.preventDefault();
                    casilla.current?.focus();
                }}
            >
                {preguntar && (
                    <>
                        <p className="mb-2 text-[11px] text-gray-600">
                            <b className="text-green-700">{l.codigo} disponible.</b> La OT {l.numero_ot} no tiene casillero en la
                            cañera: ¿en cuál quedó el material cortado?
                        </p>
                        <CaneraElegirCelda
                            canera={canera}
                            titulo={`Ubicar la OT ${l.numero_ot} en la cañera`}
                            onElegir={(c) => {
                                setPreguntar(false);
                                onUbicar(l, c);
                            }}
                        />
                        <div className="mt-2 flex justify-end">
                            <button
                                type="button"
                                onClick={() => setPreguntar(false)}
                                className="rounded-md px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
                            >
                                Ahora no
                            </button>
                        </div>
                    </>
                )}
            </PopoverContent>
        </PopoverPrimitive.Root>
    );
}

/**
 * Los casilleros de la cañera de la OT de la fila, y «Ubicar» para darle uno. Lee la
 * cañera de la pantalla (contexto): ubicar desde una fila cambia al instante los chips
 * de todas las filas de esa OT y la grilla de arriba.
 */
function CeldaCanera({
    linea: l,
    edita,
    coordObs,
    onUbicar,
}: {
    linea: LineaPendiente;
    edita: boolean;
    coordObs?: string;
    onUbicar: (linea: LineaPendiente, celda: string) => void;
}) {
    const ctx = useCaneraDePantalla();
    const [abierto, setAbierto] = useState(false);
    const celdas = ctx?.estado.canera ? (ctx.celdasPorOT.get(l.id_orden_trabajo) ?? []) : (l.celdas ?? []);
    const puedeUbicar = edita && l.numero_ot !== null && l.numero_ot !== undefined;
    // En el viejo el casillero que de verdad se usa se escribe al principio de las
    // observaciones («E4 - …») y no siempre está en la cañera: si la cañera no tiene a la
    // OT, se muestra ése, tenue y aclarado, para que igual se encuentre el material.
    const deObs = !celdas.length && coordObs ? coordObs : "";

    return (
        <div className="flex flex-wrap items-center gap-1">
            {deObs && (
                <span
                    className="inline-flex items-center gap-1 rounded border border-dashed border-slate-300 px-1.5 py-px text-[10px] font-semibold tabular-nums text-slate-500"
                    title={`La cañera no tiene a la OT ${l.numero_ot ?? ""}, pero sus observaciones dicen ${deObs} (como se anotaba en el sistema viejo).`}
                >
                    {deObs}
                    <span className="text-[9px] font-normal text-slate-400">obs.</span>
                </span>
            )}
            {celdas.map((c) => (
                <span
                    key={c}
                    className="inline-flex items-center rounded border border-slate-300 bg-white px-1.5 py-px text-[10px] font-bold tabular-nums text-slate-700"
                    title={`La OT ${l.numero_ot ?? ""} está en el casillero ${c} de la cañera`}
                >
                    {c}
                </span>
            ))}
            {puedeUbicar && (
                <Popover open={abierto} onOpenChange={setAbierto}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className={cn(
                                "inline-flex items-center gap-0.5 rounded border border-dashed px-1.5 py-px text-[10px] font-medium transition-colors",
                                celdas.length
                                    ? // Aparece al pasar el mouse por la fila; sin mouse (teléfono,
                                      // tableta) o en pantalla angosta, siempre.
                                      "border-gray-300 text-gray-400 opacity-0 hover:text-gray-700 focus:opacity-100 group-hover:opacity-100 max-sm:opacity-100 [@media(hover:none)]:opacity-100"
                                    : "border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-700",
                            )}
                            title={celdas.length ? "Ubicar la OT en otro casillero más" : "Ubicar la OT en la cañera"}
                        >
                            {celdas.length ? <Plus className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                            {!celdas.length && "Ubicar"}
                        </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[26rem] max-w-[calc(100vw-1.5rem)] p-3" align="end">
                        {abierto && (
                            <CaneraElegirCelda
                                canera={ctx?.estado.canera ?? null}
                                titulo={`Ubicar la OT ${l.numero_ot} en la cañera`}
                                onElegir={(c) => {
                                    setAbierto(false);
                                    onUbicar(l, c);
                                }}
                            />
                        )}
                        {!ctx?.estado.canera && (
                            <p className="mt-2 text-[11px] text-amber-700">
                                {ctx?.estado.error ?? "La cañera todavía no cargó: no se sabe qué casilleros están libres."}
                            </p>
                        )}
                    </PopoverContent>
                </Popover>
            )}
        </div>
    );
}

/** Los recortes de la pieza, pedidos una vez por pieza mientras dure la pantalla. */
const recortesPorPieza = new Map<number, Recorte[]>();

/**
 * La tijera con cuántos recortes hay de la pieza. Al pasar el mouse (o tocarla, en el
 * teléfono) muestra la lista: antes de comprar una barra conviene saber que hay un
 * tramo de 2.777 mm tirado en el depósito.
 */
function BotonRecortes({
    idPieza,
    cantidad,
    codigo,
    largoMaximo,
    onVerInsumo,
}: {
    idPieza: number;
    cantidad: number;
    codigo: string;
    /** El corte más largo de la línea (mm): los recortes de al menos eso sirven. Null = sin cortes con largo. */
    largoMaximo: number | null;
    onVerInsumo: (idPieza: number) => void;
}) {
    const [abierto, setAbierto] = useState(false);
    const [lista, setLista] = useState<Recorte[] | null>(() => recortesPorPieza.get(idPieza) ?? null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!abierto || lista) return;
        let vivo = true;
        void mpGet<Recorte[]>(`${API_URL}/materia-prima/insumos/${idPieza}/recortes`).then((r) => {
            if (!vivo) return;
            if (r.ok && Array.isArray(r.data)) {
                recortesPorPieza.set(idPieza, r.data);
                setLista(r.data);
            } else {
                setError(r.error ?? "No se pudieron traer los recortes.");
            }
        });
        return () => {
            vivo = false;
        };
    }, [abierto, lista, idPieza]);

    const disponibles = (lista ?? []).filter((r) => r.estado === "disponible");
    const sirve = (r: Recorte) => largoMaximo !== null && r.largo_mm !== null && r.largo_mm !== undefined && r.largo_mm >= largoMaximo;
    const cuantosSirven = disponibles.filter(sirve).length;

    return (
        <HoverCard open={abierto} onOpenChange={setAbierto} openDelay={200} closeDelay={150}>
            <HoverCardTrigger asChild>
                <button
                    type="button"
                    onClick={() => setAbierto((a) => !a)}
                    className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
                    aria-label={`${cantidad} recortes disponibles de ${codigo}`}
                >
                    <Scissors className="h-3.5 w-3.5" />
                    {cantidad}
                </button>
            </HoverCardTrigger>
            <HoverCardContent className="w-72 p-3" align="end">
                <p className="text-xs font-semibold text-gray-800">Recortes de {codigo}</p>
                {largoMaximo !== null && lista && disponibles.length > 0 && (
                    <p className={cn("mt-0.5 text-[11px]", cuantosSirven ? "text-green-700" : "text-gray-500")}>
                        {cuantosSirven
                            ? `${cuantosSirven} ${cuantosSirven === 1 ? "sirve" : "sirven"} para el corte más largo (${fmtMm(largoMaximo)})`
                            : `Ninguno llega al corte más largo (${fmtMm(largoMaximo)})`}
                    </p>
                )}
                {error ? (
                    <p className="mt-1 text-[11px] text-rose-700">{error}</p>
                ) : !lista ? (
                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-400">
                        <Loader2 className="h-3 w-3 animate-spin" /> Buscando…
                    </p>
                ) : disponibles.length === 0 ? (
                    <p className="mt-1 text-[11px] text-gray-500">No quedan recortes disponibles.</p>
                ) : (
                    <ul className="mt-1.5 max-h-56 space-y-1 overflow-y-auto">
                        {disponibles.map((r) => (
                            <li
                                key={r.id}
                                className={cn(
                                    "flex items-baseline justify-between gap-2 text-[11px]",
                                    sirve(r) && "-mx-1 rounded bg-green-50 px-1",
                                )}
                            >
                                <span className="min-w-0">
                                    {sirve(r) && (
                                        <span className="mr-1 rounded bg-green-600 px-1 text-[9px] font-semibold uppercase text-white">sirve</span>
                                    )}
                                    <b className="tabular-nums text-gray-800">
                                        {fmtMm(r.largo_mm)}
                                        {r.ancho_mm ? ` × ${fmtMm(r.ancho_mm)}` : ""}
                                    </b>
                                    {(r.observaciones || (!r.largo_mm && r.texto_original)) && (
                                        <span className="block truncate text-gray-500" title={r.observaciones ?? r.texto_original ?? ""}>
                                            {r.observaciones ?? r.texto_original}
                                        </span>
                                    )}
                                </span>
                                <span className="shrink-0 tabular-nums text-gray-500">× {r.cantidad}</span>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
                    <span className="text-[10px] text-gray-400">6.000 mm = barra entera</span>
                    <button
                        type="button"
                        onClick={() => onVerInsumo(idPieza)}
                        className="text-[11px] font-medium text-blue-700 hover:underline"
                    >
                        Ver en Insumos
                    </button>
                </div>
            </HoverCardContent>
        </HoverCard>
    );
}

/** Una celda de encabezado (para que la tabla y su cabecera usen los mismos anchos). */
export function Th({ children, className, title }: { children?: ReactNode; className?: string; title?: string }) {
    return (
        <th
            title={title}
            className={cn(
                "sticky top-0 z-20 whitespace-nowrap border-b border-gray-200 bg-gray-50 px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-600",
                className,
            )}
        >
            {children}
        </th>
    );
}
