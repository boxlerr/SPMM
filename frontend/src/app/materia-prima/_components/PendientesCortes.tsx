"use client";

/**
 * Los cortes de una línea en Pendientes: «para que sea más sencillo comprar».
 *
 * Lo pidió Lucas el 23/09 (00:13:11): en «Materias Primas Pendientes» del viejo no se ven
 * los cortes, y para comprar una barra hay que saber qué se va a cortar de ella. Acá cada
 * fila muestra los cortes que se cargaron en la OT (botón «Cortes» de la solapa Materias
 * primas) y cuántos metros hacen falta para cortarlos: el `sugerido_m` que calcula el
 * backend (cada corte + el ancho de la sierra, redondeado para arriba; null si algún corte
 * no tiene largo). No cambia la cantidad: si la línea pide menos que eso, se marca en rojo
 * («compra corta») y la persona decide.
 *
 * Los metros se muestran sólo cuando dicen algo: si la línea va en metros, o si los
 * cortes son de barra (sin ancho). Una chapa en Kg cortada en 1.220 × 600 no se compra
 * por metro: el backend igual suma los largos («≈ 2,45 m») y eso, al lado de una chapa,
 * confunde (ver `metrosQueSeMuestran`, en lib/materiaPrima.ts: la misma regla que usa
 * la solapa Materias primas de la OT).
 *
 * En la prueba piloto (modo espejo) los cortes vienen del viejo con el resto de la línea;
 * allá sólo 1 de cada 4 líneas en metros los tiene cargados, así que la columna va a estar
 * vacía muchas veces, y el detalle dice que se cargan en el Sistema Integral (no con el
 * botón «Cortes», que en la prueba no se puede tocar). En modo edición, «Editar cortes»
 * abre el mismo diálogo de la OT (MateriasPrimasOTDialogos), sin ir a la OT.
 *
 * Lo de texto (imprimir, exportar) también sale de acá, para que la fila, el papel y la
 * planilla digan lo mismo.
 */

import { useRef, useState } from "react";
import { AlertTriangle, Pencil, Plus, Scissors } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { compraCorta, enMetros, fmtCantidad, metrosQueSeMuestran, type Corte, type LineaPendiente } from "@/lib/materiaPrima";
import { useCatalogosMP } from "./InsumoCatalogos";

/** Cuántos cortes entran en la celda antes del «+N más». */
const EN_LA_CELDA = 2;

/** Un largo como se lee en el taller: «1.093», «63», «12,5». */
const mm = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: 1 });

/**
 * Un corte, corto: «34 × 63», «3 × 1.093», «2 × 1.220×2.440» (chapa). Sin «mm»: la
 * columna ya lo dice. Si el viejo lo tenía escrito de una forma que no se pudo leer, lo
 * que decía («1 × 80x200x20mm»).
 */
export function textoCorteCorto(c: Pick<Corte, "cantidad" | "largo_mm" | "ancho_mm" | "texto_original">): string {
    if (c.largo_mm === null || c.largo_mm === undefined) return `${c.cantidad} × ${c.texto_original?.trim() || "?"}`;
    return `${c.cantidad} × ${mm(c.largo_mm)}${c.ancho_mm ? `×${mm(c.ancho_mm)}` : ""}`;
}

/** Todos los cortes en un renglón, para el papel y la planilla: «34 × 63 · 3 × 1.093 mm». */
export function textoCortes(cortes: readonly Corte[] | null | undefined): string {
    if (!cortes?.length) return "";
    const todos = cortes.map(textoCorteCorto).join(" · ");
    // «mm» una vez al final, salvo que el último sea un texto del viejo (ya trae lo suyo).
    const ultimo = cortes[cortes.length - 1];
    return ultimo.largo_mm === null || ultimo.largo_mm === undefined ? todos : `${todos} mm`;
}

/** El corte más largo (mm): para saber qué recortes del depósito sirven. Null si no hay largos. */
export function corteMasLargo(cortes: readonly Corte[] | null | undefined): number | null {
    let max: number | null = null;
    for (const c of cortes ?? []) {
        if (c.largo_mm !== null && c.largo_mm !== undefined && (max === null || c.largo_mm > max)) max = c.largo_mm;
    }
    return max;
}

export interface CeldaCortesProps {
    linea: LineaPendiente;
    edita: boolean;
    /** Abrir el diálogo de cortes de la línea (sólo en modo edición). */
    onEditar: (idLinea: number) => void;
}

/**
 * La celda «Cortes» de la fila: hasta dos cortes y «+N más», y debajo los metros que
 * hacen falta. Al pasar el mouse (o tocarla, en el teléfono) muestra todos, con la cuenta.
 */
export function CeldaCortes({ linea: l, edita, onEditar }: CeldaCortesProps) {
    const [abierto, setAbierto] = useState(false);
    // Con el mouse, el cartel ya se abrió al pasar: el clic no lo cierra (se va al salir).
    // En el teléfono o con el teclado, el toque abre y cierra.
    const puntero = useRef("");
    const cortes = l.cortes ?? [];

    if (!cortes.length) {
        if (!edita) return <span className="text-gray-300">—</span>;
        return (
            <button
                type="button"
                onClick={() => onEditar(l.id)}
                className={cn(
                    "inline-flex items-center gap-0.5 rounded border border-dashed border-gray-300 px-1.5 py-px text-[10px] font-medium text-gray-400 transition-opacity hover:border-violet-400 hover:text-violet-700",
                    // Con mouse aparece al pasar por la fila (una columna llena de «+ Cortes»
                    // tapa lo que importa). Sin mouse (teléfono, tableta) no hay «pasar»: ahí
                    // y en pantalla angosta se ve siempre, o no se podría cargar un corte.
                    "opacity-0 focus:opacity-100 group-hover:opacity-100 max-sm:opacity-100 [@media(hover:none)]:opacity-100",
                )}
                title={`Cargar los cortes de ${l.codigo} (piezas × largo)`}
            >
                <Plus className="h-3 w-3" /> Cortes
            </button>
        );
    }

    const corta = compraCorta(l);
    const resto = cortes.length - EN_LA_CELDA;
    const sugerido = metrosQueSeMuestran(l);

    return (
        <HoverCard open={abierto} onOpenChange={setAbierto} openDelay={200} closeDelay={150}>
            <HoverCardTrigger asChild>
                <button
                    type="button"
                    onPointerDown={(e) => {
                        puntero.current = e.pointerType;
                    }}
                    onClick={() => {
                        const conMouse = puntero.current === "mouse";
                        puntero.current = "";
                        setAbierto((a) => (conMouse ? true : !a));
                    }}
                    className="-mx-1 block w-[calc(100%+0.5rem)] rounded px-1 py-px text-left hover:bg-violet-50"
                    aria-label={`Cortes de ${l.codigo}: ${textoCortes(cortes)}${sugerido !== null ? `, hacen falta ${fmtCantidad(sugerido)} m` : ""}`}
                >
                    <span className="flex items-start gap-1">
                        <Scissors className="mt-0.5 h-3 w-3 shrink-0 text-violet-500" />
                        <span className="min-w-0 leading-tight tabular-nums text-gray-800">
                            {cortes.slice(0, EN_LA_CELDA).map((c) => (
                                <span key={c.id} className="block truncate">
                                    {textoCorteCorto(c)}
                                </span>
                            ))}
                            {resto > 0 && <span className="block text-[10px] text-gray-500">+{resto} más</span>}
                        </span>
                    </span>
                    {sugerido !== null && (
                        <span
                            className={cn(
                                "mt-0.5 flex items-center gap-0.5 pl-4 text-[10px] tabular-nums",
                                corta ? "font-semibold text-red-600" : "text-gray-500",
                            )}
                        >
                            {corta && <AlertTriangle className="h-3 w-3 shrink-0" />}≈ {fmtCantidad(sugerido)} m
                        </span>
                    )}
                </button>
            </HoverCardTrigger>
            <HoverCardContent className="w-72 p-3" align="start">
                <DetalleCortes
                    linea={l}
                    edita={edita}
                    onEditar={() => {
                        setAbierto(false);
                        onEditar(l.id);
                    }}
                />
            </HoverCardContent>
        </HoverCard>
    );
}

/** Lo que se ve al abrir la celda: todos los cortes, cuántas piezas y la cuenta de los metros. */
function DetalleCortes({ linea: l, edita, onEditar }: { linea: LineaPendiente; edita: boolean; onEditar: () => void }) {
    // El ancho de la sierra sale de los catálogos (lo que usa el backend), no escrito acá.
    const { catalogos } = useCatalogosMP();
    const sierra = catalogos?.espesor_sierra_mm ?? null;
    // Prueba piloto (ver ModoEspejo.tsx): los cortes se cargan en el Sistema Integral.
    const espejo = catalogos?.dueno === "integral";
    const cortes = l.cortes ?? [];
    const piezas = cortes.reduce((s, c) => s + (c.cantidad || 0), 0);
    const sinLargo = cortes.some((c) => c.largo_mm === null || c.largo_mm === undefined);
    const corta = compraCorta(l);
    const metros = metrosQueSeMuestran(l);

    return (
        <div className="text-xs">
            <p className="font-semibold text-gray-800">
                Cortes de {l.codigo}
                {l.numero_ot ? <span className="font-normal text-gray-500"> · OT {l.numero_ot}</span> : null}
            </p>
            <ul className="mt-1.5 max-h-48 space-y-0.5 overflow-y-auto tabular-nums">
                {cortes.map((c) => (
                    <li key={c.id} className="flex items-baseline justify-between gap-2">
                        <span className="text-gray-800">
                            <b>{c.cantidad}</b> {c.cantidad === 1 ? "pieza" : "piezas"} de{" "}
                            {c.largo_mm !== null && c.largo_mm !== undefined ? (
                                <b>
                                    {mm(c.largo_mm)}
                                    {c.ancho_mm ? ` × ${mm(c.ancho_mm)}` : ""} mm
                                </b>
                            ) : (
                                <span className="italic text-gray-600" title="Así venía escrito del sistema viejo">
                                    {c.texto_original?.trim() || "(sin medida)"}
                                </span>
                            )}
                        </span>
                    </li>
                ))}
            </ul>
            {cortes.length > 1 && (
                <p className="mt-1 text-[11px] text-gray-500">
                    {piezas} pieza{piezas === 1 ? "" : "s"} en {cortes.length} medidas
                </p>
            )}

            <div className={cn("mt-2 rounded-md border px-2 py-1.5", corta ? "border-red-200 bg-red-50" : "border-gray-200 bg-gray-50")}>
                {metros !== null ? (
                    <>
                        <p className="text-gray-800">
                            Hacen falta <b className="tabular-nums">{fmtCantidad(metros)} m</b>
                        </p>
                        <p className="text-[10px] text-gray-500">
                            Cada corte + {sierra !== null ? `${fmtCantidad(sierra)} mm de` : "el ancho de la"} sierra, redondeado para arriba.
                        </p>
                        <p className={cn("mt-1 text-[11px]", corta ? "font-semibold text-red-700" : "text-gray-600")}>
                            La línea pide {fmtCantidad(l.cantidad)} {l.unidad ?? ""}
                            {corta ? ": no alcanza para todos los cortes." : enMetros(l) ? "." : " (no va en metros: no se compara)."}
                        </p>
                    </>
                ) : (
                    <p className="text-[11px] text-gray-500">
                        {sinLargo
                            ? "Sin cuenta de metros: algún corte no tiene largo (vino escrito del viejo)."
                            : l.sugerido_m !== null && l.sugerido_m !== undefined
                                ? `Sin cuenta de metros: son cortes de chapa (con ancho) y la línea va en ${l.unidad?.trim() || "unidades"}, no en metros.`
                                : "Sin cuenta de metros."}
                    </p>
                )}
            </div>

            {edita ? (
                <button
                    type="button"
                    onClick={onEditar}
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline"
                >
                    <Pencil className="h-3 w-3" /> Editar cortes
                </button>
            ) : (
                <p className="mt-2 text-[10px] text-gray-400">
                    {espejo
                        ? "Durante la prueba piloto los cortes se cargan en el Sistema Integral, con las materias primas de la OT."
                        : "Se cargan con las materias primas de la OT (botón «Cortes»)."}
                </p>
            )}
        </div>
    );
}
