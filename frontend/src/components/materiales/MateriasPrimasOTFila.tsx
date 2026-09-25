"use client";

/**
 * Una fila de la solapa «Materias primas» de la OT, y sus celdas.
 *
 * Hecha para cargar y corregir sin mirar dos veces:
 *  · las casillas son `<input type="checkbox">` nativos: Tab las recorre, Espacio las
 *    tilda y cada tilde se guarda sola (no hay botón Grabar);
 *  · los textos (cantidad, descripción, observaciones) se guardan al salir del campo o
 *    con Enter; Escape vuelve a lo que había (y NO cierra la OT: ver `data-escape-local`);
 *  · al guardar no se redibuja la tabla ni se mueve nada: la fila es la misma.
 *
 * TODO ADENTRO DEL <form> DE LA OT
 *
 * La solapa vive dentro del formulario del modal: un Enter suelto en un campo lo
 * mandaría («¿Guardamos los cambios?»). Cada campo ataja su Enter y todos los botones
 * son `type="button"`.
 */

import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { AlertTriangle, ExternalLink, Loader2, MoreHorizontal, Scissors, Trash2 } from "lucide-react";
import { PopoverContent } from "@/components/ui/popover";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
    enMetros,
    estadoLinea,
    fmtCantidad,
    fmtFechaHora,
    fmtPrecio,
    leerCantidad,
    metrosQueSeMuestran,
} from "@/lib/materiaPrima";
import { SelectorProveedor } from "@/app/materia-prima/_components/SelectorProveedor";
import { useEnvioSinRepetir } from "@/app/materia-prima/_components/PendientesForzar";
import { CeldaConsumido, type LineaDeMaterial } from "@/components/materiales/ConsumoDeMaterial";
import { textoCorte, type CambiosFila, type FilaMP } from "./MateriasPrimasOTDatos";

/** Lo que una fila le pide a la solapa. Un solo objeto que no cambia, para que `memo` sirva. */
export interface AccionesFilaMP {
    /** Una línea guardada devuelve el guardado (409 incluido): sólo la reserva lo espera. */
    cambiar: (fila: FilaMP, cambios: CambiosFila) => Promise<unknown> | void;
    borrar: (fila: FilaMP) => void;
    abrirCortes: (fila: FilaMP) => void;
    alternarConsumo: (idLinea: number) => void;
}

export interface FilaMPProps {
    fila: FilaMP;
    /** El número de renglón (1, 2, 3…): el orden de carga. */
    numero: number;
    edita: boolean;
    /** Algún proceso de la OT ya arrancó: «Prod» se marca solo. */
    otEnCurso: boolean;
    unidades: readonly string[];
    /** Hay columna Consumido (el backend tiene los consumos). */
    conConsumo: boolean;
    /** Lo consumido de la línea, con lo cargado recién (el total del hook de consumos). */
    consumido: number;
    consumoAbierto: boolean;
    acciones: AccionesFilaMP;
}

/** Las columnas de la tabla, para el `colSpan` de las filas que se abren debajo. */
export const columnasDeLaTabla = (conConsumo: boolean) => (conConsumo ? 15 : 14);

/** El número como se edita: coma decimal y sin puntos de miles («2,5»). */
export const aEditable = (n: number | null | undefined) =>
    n === null || n === undefined ? "" : String(Number(n.toFixed(3))).replace(".", ",");

/** Fondo sólido (las celdas fijas a la izquierda tapan a las otras al deslizar). */
function fondoDeFila(fila: FilaMP): string {
    if (fila.local) return "bg-white";
    const e = estadoLinea(fila);
    if (e === "lista") return "bg-green-50";
    if (e === "esperando") return "bg-amber-50";
    return "bg-white";
}

const quienYCuando = (por: string | null | undefined, en: string | null | undefined) =>
    [por ? `por ${por}` : null, en ? `el ${fmtFechaHora(en)}` : null].filter(Boolean).join(" ");

/** En una línea local las marcas no existen todavía: se ponen con la OT ya creada. */
const SOLO_CON_OT = "Se marca cuando la OT ya existe (acá mismo o desde Pendientes).";

function FilaMPBase({ fila: f, numero, edita, otEnCurso, unidades, conConsumo, consumido, consumoAbierto, acciones }: FilaMPProps) {
    const estado = f.local ? null : estadoLinea(f);
    // Una fila en viaje (alta sin id) o borrándose no se toca: el cambio no tendría a qué línea ir.
    const tocable = edita && !f.enVuelo && !f.borrando;
    const marcas = tocable && !f.local;
    const cambiar = (c: CambiosFila) => acciones.cambiar(f, c);
    const l = f.linea;

    const lineaConsumo: LineaDeMaterial | null =
        conConsumo && f.id !== null && f.id > 0
            ? { idLinea: f.id, codigo: f.codigo, descripcion: f.descripcion, pedido: f.cantidad, unidad: f.unidad ?? "" }
            : null;

    return (
        <tr
            data-linea={f.id ?? f.clave}
            className={cn(
                "group text-xs text-gray-800 [&>td]:border-b [&>td]:border-gray-100 [&>td]:px-1.5 [&>td]:py-1 [&>td]:align-middle",
                fondoDeFila(f),
                estado === "no_usada" && "text-gray-400",
                f.borrando && "opacity-50 [&>td]:line-through",
                f.enVuelo && "opacity-70",
                consumoAbierto && "bg-blue-50/60",
            )}
        >
            {/* # y código juntos, fijos a la izquierda: al deslizar para ver las marcas
                no se pierde de qué insumo es la fila. */}
            <td
                className={cn(
                    "sticky left-0 z-10 w-[118px] min-w-[118px] bg-inherit",
                    // «Falta pedir»: la marca roja (ver ESTADOS_LINEA). Sombra y no borde:
                    // el borde de una celda fija se va con el scroll.
                    estado === "falta_pedir" && "shadow-[inset_4px_0_0_#ef4444]",
                )}
            >
                <div className="flex items-center gap-1.5 pl-1">
                    <span className="w-5 shrink-0 text-right text-[10px] tabular-nums text-gray-400">{numero}</span>
                    <span className="truncate font-mono text-[11px] font-bold text-gray-900" title={f.codigo}>
                        {f.codigo}
                    </span>
                    {f.enVuelo && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-gray-400" aria-label="Guardando" />}
                    {f.origen === "historial" && (
                        <span className="rounded bg-violet-50 px-1 text-[9px] font-semibold uppercase text-violet-600" title="Traída del historial de otra OT del mismo producto">
                            hist.
                        </span>
                    )}
                </div>
            </td>

            {/* `max-w-0` + `w-full`: la descripción se lleva el ancho que sobra y se corta
                con «…»; sin eso, un texto largo sin cortes estiraba la columna y la tabla
                entera se salía del modal. */}
            <td className="w-full min-w-[180px] max-w-0">
                <CeldaTexto
                    valor={f.descripcion}
                    // La de un insumo tipo «insumo» sale de sus medidas: se corrige en el
                    // catálogo, no en la línea (el backend lo rechaza). Y en una línea traída
                    // del historial a una OT nueva no se sabe el tipo (la vista previa no lo
                    // manda): mejor no dejarla tocar que perder el lote entero por un 422 al
                    // crear la OT.
                    disabled={!tocable || f.tipo_pieza === "insumo" || (f.local && f.origen === "historial")}
                    titulo={
                        f.tipo_pieza === "insumo"
                            ? `${f.descripcion}\n(La descripción sale de las medidas del insumo: se corrige en el catálogo.)`
                            : f.descripcion
                    }
                    onGuardar={(t) => cambiar({ descripcion: t })}
                    etiqueta={`Descripción de ${f.codigo}`}
                    placeholder="(la del insumo)"
                    vaciaVuelve
                />
            </td>

            <td className="w-[76px] min-w-[76px]">
                <CeldaCantidad
                    valor={f.cantidad}
                    disabled={!tocable}
                    onGuardar={(n) => cambiar({ cantidad: n })}
                    etiqueta={`Cantidad de ${f.codigo}`}
                />
            </td>

            <td className="w-[62px] min-w-[62px]">
                {tocable ? (
                    <select
                        value={f.unidad ?? ""}
                        onChange={(e) => cambiar({ unidad: e.target.value })}
                        aria-label={`Unidad de ${f.codigo}`}
                        className="h-7 w-full rounded border border-transparent bg-transparent px-0.5 text-xs outline-none hover:border-gray-200 focus:border-blue-400 focus:bg-white"
                    >
                        {/* Una unidad heredada del viejo que no está en la lista se muestra igual:
                            si no, el desplegable diría otra cosa que la base. */}
                        {f.unidad && !unidades.includes(f.unidad) && <option value={f.unidad}>{f.unidad}</option>}
                        {!f.unidad && <option value="">—</option>}
                        {unidades.map((u) => (
                            <option key={u} value={u}>{u}</option>
                        ))}
                    </select>
                ) : (
                    <span className="px-1">{f.unidad ?? "—"}</span>
                )}
            </td>

            <td className="w-[140px] min-w-[140px] max-w-[140px]">
                {tocable ? (
                    <SelectorProveedor
                        valor={{ id: f.id_proveedor, nombre: f.proveedor }}
                        onCambiar={(v) => {
                            if (v.id === f.id_proveedor && (v.nombre ?? null) === (f.proveedor ?? null)) return;
                            cambiar({ id_proveedor: v.id, proveedor: v.nombre });
                        }}
                        permitirTextoLibre
                        placeholder="—"
                        triggerClassName="h-7 px-1.5 text-xs border-transparent bg-transparent hover:border-gray-200"
                    />
                ) : (
                    <span className="block truncate px-1" title={f.proveedor ?? ""}>{f.proveedor ?? "—"}</span>
                )}
            </td>

            <td className="w-[110px] min-w-[110px]">
                <CeldaTexto
                    valor={f.observaciones}
                    disabled={!tocable}
                    onGuardar={(t) => cambiar({ observaciones: t })}
                    etiqueta={`Observaciones de ${f.codigo}`}
                    placeholder="—"
                />
            </td>

            {/* Utilizado: 0 = no se usa (o a confirmar). No entra en Pendientes ni en el
                estado del material; soltarla libera la reserva. */}
            <td className="w-[40px] min-w-[40px] text-center">
                <Casilla
                    marcada={f.usado}
                    disabled={!marcas}
                    tono="accent-slate-600"
                    titulo={f.local ? SOLO_CON_OT : f.usado
                        ? "Utilizada: entra en Pendientes y en el estado del material. Destildar si no se usa o está a confirmar."
                        : "No se usa (o está a confirmar): no entra en Pendientes. Tildar para usarla."}
                    onCambiar={(v) => cambiar({ usado: v })}
                />
            </td>
            <td className="w-[40px] min-w-[40px] text-center">
                <Casilla
                    marcada={f.pedido}
                    disabled={!marcas || !f.usado}
                    tono="accent-amber-600"
                    titulo={f.local ? SOLO_CON_OT : f.pedido
                        ? `Pedido ${quienYCuando(l?.pedido_por, l?.pedido_en)}`.trim()
                        : "Marcar que se pidió al proveedor"}
                    onCambiar={(v) => cambiar({ pedido: v })}
                />
            </td>
            <td className="w-[78px] min-w-[78px]">
                <CasillaReserva fila={f} edita={marcas && f.usado && !f.disponible} onGuardar={cambiar} />
            </td>
            <td className="w-[40px] min-w-[40px] text-center">
                <Casilla
                    marcada={f.disponible}
                    disabled={!marcas || !f.usado}
                    tono="accent-green-600"
                    titulo={f.local ? SOLO_CON_OT : f.disponible
                        ? `Disponible ${quienYCuando(l?.disponible_por, l?.disponible_en)}`.trim() +
                          (f.reserva ? ". Lo reservado ya se retiró del stock." : "")
                        : f.reserva
                            ? "Marcar disponible: retira del stock lo reservado"
                            : "Marcar que el material ya está disponible para producción"}
                    onCambiar={(v) => cambiar({ disponible: v })}
                />
            </td>
            <td className="w-[40px] min-w-[40px] text-center">
                {/* PRODUC: con la OT arrancada se ve tildado y no se toca («se marca solo»). */}
                <Casilla
                    marcada={f.en_produccion || (otEnCurso && !f.local)}
                    disabled={!marcas || otEnCurso}
                    tono="accent-blue-600"
                    titulo={f.local ? SOLO_CON_OT : otEnCurso
                        ? "La OT ya arrancó en el taller: se marca sola."
                        : "En producción (material en fabricación o tercerizado)"}
                    onCambiar={(v) => cambiar({ en_produccion: v })}
                />
            </td>

            <td className="w-[84px] min-w-[84px] text-right tabular-nums text-gray-600" title={f.precio ? `Último precio de compra del insumo: ${fmtPrecio(f.precio)}` : "El insumo no tiene precio cargado"}>
                {f.precio ? fmtPrecio(f.precio) : <span className="text-gray-300">—</span>}
            </td>

            {conConsumo && (
                <td className="w-[72px] min-w-[72px]">
                    {lineaConsumo ? (
                        <CeldaConsumido
                            linea={lineaConsumo}
                            total={consumido}
                            abierto={consumoAbierto}
                            onAlternar={() => acciones.alternarConsumo(lineaConsumo.idLinea)}
                        />
                    ) : (
                        <span className="px-2 text-gray-300" title={f.local ? SOLO_CON_OT : undefined}>—</span>
                    )}
                </td>
            )}

            <td className="w-[100px] min-w-[100px] max-w-[100px]">
                <BotonCortes fila={f} disabled={f.enVuelo || f.borrando} onAbrir={() => acciones.abrirCortes(f)} />
            </td>

            <td className="w-[34px] min-w-[34px] text-right">
                <MenuFila fila={f} edita={tocable} onBorrar={() => acciones.borrar(f)} />
            </td>
        </tr>
    );
}

export const FilaMPOT = memo(FilaMPBase);

// ═══════════════════════════ celdas ═══════════════════════════

/** Una casilla nativa: la más liviana, y Tab + Espacio sin sorpresas. */
function Casilla({ marcada, disabled, onCambiar, titulo, tono }: {
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
            className={cn("h-4 w-4 align-middle", tono, disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer")}
        />
    );
}

const CLASE_CAMPO =
    "h-7 w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 text-xs outline-none placeholder:text-gray-300 hover:border-gray-200 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100";

/**
 * Un texto que se edita en el lugar: se guarda al salir o con Enter; Escape vuelve a lo
 * que había. Mientras se escribe, lo que llega del servidor no lo pisa.
 */
export function CeldaTexto({ valor, onGuardar, disabled, placeholder, etiqueta, titulo, vaciaVuelve }: {
    valor: string | null;
    onGuardar: (t: string | null) => void;
    disabled?: boolean;
    placeholder?: string;
    etiqueta: string;
    titulo?: string;
    /** Vaciarla no la deja vacía: vuelve a la del insumo (la descripción). */
    vaciaVuelve?: boolean;
}) {
    const [texto, setTexto] = useState(valor ?? "");
    const [editando, setEditando] = useState(false);
    const cancelado = useRef(false);

    useEffect(() => {
        if (!editando) setTexto(valor ?? "");
    }, [valor, editando]);

    if (disabled) {
        return (
            <span className="block truncate px-1.5" title={titulo ?? valor ?? ""}>
                {valor || <span className="text-gray-300">—</span>}
            </span>
        );
    }

    return (
        <input
            data-escape-local
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
                if (t === (valor ?? "").trim()) return;
                if (!t && vaciaVuelve) {
                    // Se manda vacía (el backend vuelve a la del insumo) y, mientras, se ve la de antes.
                    setTexto(valor ?? "");
                }
                onGuardar(t || null);
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelado.current = true;
                    setTexto(valor ?? "");
                    e.currentTarget.blur();
                }
            }}
            placeholder={placeholder}
            title={titulo ?? valor ?? ""}
            aria-label={etiqueta}
            className={CLASE_CAMPO}
        />
    );
}

/** La cantidad: acepta coma, tiene que ser mayor que cero (si no, vuelve a la de antes y lo dice). */
function CeldaCantidad({ valor, onGuardar, disabled, etiqueta }: {
    valor: number;
    onGuardar: (n: number) => void;
    disabled?: boolean;
    etiqueta: string;
}) {
    const [texto, setTexto] = useState(aEditable(valor));
    const [editando, setEditando] = useState(false);
    const [mal, setMal] = useState(false);
    const cancelado = useRef(false);

    useEffect(() => {
        if (!editando) setTexto(aEditable(valor));
    }, [valor, editando]);

    if (disabled) {
        return <span className="block px-1.5 text-right font-semibold tabular-nums">{fmtCantidad(valor)}</span>;
    }

    return (
        <input
            data-escape-local
            inputMode="decimal"
            value={texto}
            onFocus={(e) => {
                cancelado.current = false;
                setEditando(true);
                e.currentTarget.select();
            }}
            onChange={(e) => {
                setTexto(e.target.value);
                setMal(false);
            }}
            onBlur={() => {
                setEditando(false);
                if (cancelado.current) return;
                const n = leerCantidad(texto);
                if (n === null || Math.round(n * 1000) <= 0) {
                    // Vacía o cero no es una cantidad: se vuelve a la que había, sin mandar nada.
                    setMal(true);
                    setTexto(aEditable(valor));
                    setTimeout(() => setMal(false), 1800);
                    return;
                }
                const redondeada = Math.round(n * 1000) / 1000;
                if (redondeada !== valor) onGuardar(redondeada);
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelado.current = true;
                    setTexto(aEditable(valor));
                    e.currentTarget.blur();
                }
            }}
            title={mal ? "La cantidad tiene que ser un número mayor que cero" : etiqueta}
            aria-label={etiqueta}
            aria-invalid={mal}
            className={cn(CLASE_CAMPO, "text-right font-semibold tabular-nums", mal && "border-rose-300 bg-rose-50")}
        />
    );
}

/**
 * «Reserva»: tildarla pregunta cuánto se aparta del stock, con lo que alcanza sugerido
 * (lo libre, hasta la cantidad de la línea) y ya seleccionado: Enter y listo. Si supera
 * lo libre, avisa antes; el backend igual pregunta (409) y se puede hacer igual.
 * Destildarla la saca sin preguntar. Con la reserva puesta, tocar el número la cambia.
 *
 * Mientras se guarda (y mientras está la pregunta del 409) no acepta otro toque: el
 * cartelito queda con «Guardando…» hasta que termina. Es el mismo arreglo que la
 * reserva de Pendientes (un doble clic mandaba dos guardados o cerraba el aviso del 409
 * como «Cancelar»; ver `useEnvioSinRepetir`). Para que el segundo clic caiga en el
 * cartelito y no en la tabla de abajo, el cartelito no se mueve mientras tanto: lo que
 * muestra queda congelado (la fila ya cambió: con la reserva puesta decía «Cambiar la
 * reserva», se iba el aviso de «Hay 0 libres» y los botones subían un renglón) y se
 * ancla a la casilla sola (el número de la reserva aparece al lado y lo corría).
 */
function CasillaReserva({ fila: f, edita, onGuardar }: {
    fila: FilaMP;
    /** Se puede tocar: línea guardada, utilizada y todavía no disponible (lo reservado ya se retiró). */
    edita: boolean;
    onGuardar: (c: CambiosFila) => Promise<unknown> | void;
}) {
    const [abierto, setAbierto] = useState(false);
    const [texto, setTexto] = useState("");
    const envio = useEnvioSinRepetir();
    const campoRef = useRef<HTMLInputElement>(null);
    const libre = Math.max(0, f.stock_libre ?? 0);
    // Lo libre no cuenta lo que ya reservó esta misma línea: al cambiar una reserva, lo
    // suyo vuelve a estar disponible para ella.
    const libreParaEsta = libre + (f.reserva ? (f.cantidad_reservada ?? 0) : 0);
    const sugerida = Math.min(f.cantidad, libreParaEsta) > 0 ? Math.min(f.cantidad, libreParaEsta) : f.cantidad;
    const cantidad = leerCantidad(texto);
    const valida = cantidad !== null && cantidad > 0 && cantidad <= f.cantidad + 1e-9;
    // Lo que muestra el cartelito: lo de ahora o, desde que se tocó «Reservar» (mientras
    // se guarda y mientras se va), lo que se veía en ese momento.
    const [congelado, setCongelado] = useState<{ reserva: boolean; libre: number } | null>(null);
    const vista = congelado ?? { reserva: f.reserva, libre: libreParaEsta };

    const abrir = (inicial: number) => {
        if (envio.ocupado()) return;
        setCongelado(null);
        setTexto(aEditable(inicial));
        setAbierto(true);
    };
    const reservar = () => {
        if (!valida || envio.ocupado()) return;
        const cambios: CambiosFila = f.reserva ? { cantidad_reservada: cantidad } : { reserva: true, cantidad_reservada: cantidad };
        setCongelado({ reserva: f.reserva, libre: libreParaEsta });
        envio.enviar(() => onGuardar(cambios), () => setAbierto(false));
    };

    const titulo = f.local
        ? SOLO_CON_OT
        : f.reserva
            ? `Reservado del stock: ${fmtCantidad(f.cantidad_reservada)} ${f.unidad ?? ""}.${f.disponible ? " Ya se retiró (está disponible)." : " Destildar para soltarlo."}`
            : `Reservar del stock (hay ${fmtCantidad(f.stock_libre, "0")} libres)`;

    return (
        <PopoverPrimitive.Root open={abierto} onOpenChange={setAbierto}>
            <div className="flex items-center gap-1.5">
                <PopoverPrimitive.Anchor asChild>
                    <input
                        type="checkbox"
                        checked={f.reserva}
                        disabled={!edita}
                        onChange={() => {
                            if (envio.ocupado()) return;
                            if (f.reserva) {
                                onGuardar({ reserva: false });
                                return;
                            }
                            abrir(sugerida);
                        }}
                        title={titulo}
                        aria-label={titulo}
                        className={cn("h-4 w-4 accent-amber-600", edita ? "cursor-pointer" : "cursor-not-allowed opacity-50")}
                    />
                </PopoverPrimitive.Anchor>
                {f.reserva && (
                    <button
                        type="button"
                        disabled={!edita}
                        onClick={() => abrir(f.cantidad_reservada ?? sugerida)}
                        title={edita ? "Cambiar cuánto se reserva" : titulo}
                        className={cn(
                            "rounded px-1 text-[11px] font-semibold tabular-nums text-amber-800",
                            edita ? "hover:bg-amber-100" : "cursor-default",
                        )}
                    >
                        {fmtCantidad(f.cantidad_reservada)}
                    </button>
                )}
            </div>
            <PopoverContent
                className="w-64 p-3"
                align="center"
                // El foco va a la cantidad, ya seleccionada: Enter y listo. A mano y no con
                // `autoFocus`: adentro del diálogo de la OT, el `autoFocus` del campo se
                // pierde (el foco se queda en la casilla que abrió esto).
                onOpenAutoFocus={(e) => {
                    e.preventDefault();
                    campoRef.current?.focus();
                    campoRef.current?.select();
                }}
            >
                <p className="text-xs font-semibold text-gray-800">
                    {vista.reserva ? "Cambiar la reserva de" : "Reservar"} {f.codigo} del stock
                </p>
                <p className="mt-0.5 text-[11px] text-gray-500">
                    Libre: <b className="tabular-nums">{fmtCantidad(vista.libre)}</b> {f.unidad ?? ""} · la línea lleva{" "}
                    <b className="tabular-nums">{fmtCantidad(f.cantidad)}</b>
                </p>
                <div className="mt-2 flex items-center gap-2">
                    <input
                        ref={campoRef}
                        data-escape-local
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
                    <span className="text-xs text-gray-500">{f.unidad ?? ""}</span>
                </div>
                {cantidad !== null && cantidad > f.cantidad + 1e-9 && (
                    <p className="mt-1.5 text-[11px] text-rose-700">No se puede reservar más de lo que lleva la línea.</p>
                )}
                {valida && cantidad! > vista.libre + 1e-9 && (
                    <p className="mt-1.5 flex items-start gap-1 text-[11px] text-amber-700">
                        <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                        Hay {fmtCantidad(vista.libre)} libres: la reserva deja el stock en negativo (te va a preguntar).
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
                        {envio.enviando ? "Guardando…" : vista.reserva ? "Cambiar" : "Reservar"}
                    </button>
                </div>
            </PopoverContent>
        </PopoverPrimitive.Root>
    );
}

/**
 * El botón de los cortes: cuántos hay y cuántos metros harían falta, sólo si esos metros
 * dicen algo: la línea va en metros, o los cortes son de barra (sin ancho). Una chapa en
 * Kg cortada en 1.220 × 600 no «lleva 2,45 m» (la misma regla que Pendientes:
 * `metrosQueSeMuestran`).
 */
function BotonCortes({ fila: f, disabled, onAbrir }: { fila: FilaMP; disabled?: boolean; onAbrir: () => void }) {
    const n = f.cortes.reduce((s, c) => s + (c.cantidad || 0), 0);
    const detalle = f.cortes.length ? f.cortes.map(textoCorte).join("\n") : "Sin cortes cargados";
    const metros = f.cortes.length ? metrosQueSeMuestran(f) : null;
    const difiere = metros !== null && enMetros(f) && Math.abs(metros - f.cantidad) > 0.0005;
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onAbrir}
            title={`${detalle}${metros !== null ? `\nSugerido: ${fmtCantidad(metros)} m` : ""}\n(tocá para ver o cargar los cortes)`}
            className={cn(
                "inline-flex w-full items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] transition-colors disabled:opacity-50",
                f.cortes.length
                    ? "border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100"
                    : "border-transparent text-gray-400 hover:border-gray-200 hover:bg-gray-50 hover:text-gray-600",
            )}
        >
            <Scissors className="h-3 w-3 shrink-0" />
            <span className="truncate tabular-nums">
                {f.cortes.length ? `${n}` : "Cortes"}
                {metros !== null ? ` · ${fmtCantidad(metros)} m` : ""}
            </span>
            {difiere && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-label="La cantidad no es la sugerida" />}
        </button>
    );
}

/** ⋯ de la fila: ver el insumo en el catálogo y borrar la línea (con el 409 que pregunta qué se pierde). */
function MenuFila({ fila: f, edita, onBorrar }: { fila: FilaMP; edita: boolean; onBorrar: () => void }) {
    return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    disabled={f.enVuelo}
                    aria-label={`Más acciones de ${f.codigo}`}
                    title="Más acciones"
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
                >
                    <MoreHorizontal className="h-4 w-4" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem asChild>
                    {/* En otra pestaña: la OT queda abierta con lo que se estaba cargando. */}
                    <a href={`/materia-prima?tab=insumos&pieza=${f.id_pieza}`} target="_blank" rel="noopener noreferrer" className="cursor-pointer text-xs">
                        <ExternalLink className="mr-2 h-3.5 w-3.5" />
                        Ver el insumo en el catálogo
                    </a>
                </DropdownMenuItem>
                {edita && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onSelect={onBorrar}
                            disabled={f.borrando}
                            className="cursor-pointer text-xs text-red-600 focus:bg-red-50 focus:text-red-700"
                        >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            {f.local ? "Sacar la línea" : "Borrar la línea"}
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/** Una cabecera de columna, chica y en mayúsculas como las del resto de la OT. */
export function Th({ children, className, title }: { children?: ReactNode; className?: string; title?: string }) {
    return (
        <th title={title} className={cn("whitespace-nowrap px-1.5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-500", className)}>
            {children}
        </th>
    );
}
