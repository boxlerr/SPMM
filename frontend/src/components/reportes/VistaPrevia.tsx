"use client";

/**
 * La vista previa del armador de reportes (RF-23): las primeras filas que contestó el
 * servidor, con los totales de TODO lo filtrado abajo.
 *
 * Mientras se pide la próxima, la anterior queda a la vista (atenuada y con «Actualizando»
 * arriba): nada de una ruedita que tape la tabla a cada cambio.
 */

import { AlertTriangle, Info, Loader2, SearchX, Sigma, TableProperties } from "lucide-react";
import { alineaDerecha, textoParaLeer } from "@/lib/exportar";
import { cn } from "@/lib/utils";
import {
    columnasParaExportar,
    type ResultadoReporte,
} from "@/lib/reportes";

const miles = (n: number) => n.toLocaleString("es-AR");

export function VistaPrevia({
    resultado,
    cargando,
    error,
    sinColumnas,
    className,
}: {
    resultado: ResultadoReporte | null;
    cargando: boolean;
    error: string | null;
    sinColumnas: boolean;
    className?: string;
}) {
    if (sinColumnas) {
        return (
            <Vacio
                icono={<TableProperties className="h-6 w-6 text-[#1e3a5f]" />}
                titulo="Elegí al menos una columna"
                texto="Tocá las columnas que querés ver en «Columnas» y la vista previa aparece acá."
            />
        );
    }
    if (!resultado) {
        if (error) return <ErrorDeReporte mensaje={error} />;
        return (
            <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-gray-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#DC143C]" /> Armando la vista previa…
            </div>
        );
    }

    const columnas = columnasParaExportar(resultado);
    const agrupado = resultado.modo === "grupos";
    const total = agrupado ? resultado.total_grupos ?? 0 : resultado.total_filas;
    const hayTotales = resultado.columnas.some((c) => resultado.totales[c.clave] !== undefined);
    const esCuenta = (clave: string) => /^m\d+$/.test(clave);
    const cantidadDeGrupos = agrupado ? resultado.columnas.filter((c) => !esCuenta(c.clave)).length : 0;
    const gruposDeDos = cantidadDeGrupos === 2;

    return (
        <div className={cn("flex h-full min-h-0 flex-col", className)}>
            {/* Resumen */}
            <div className="flex flex-wrap items-center gap-2 pb-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1e3a5f] px-3 py-1 text-xs font-semibold text-white">
                    <Sigma className="h-3.5 w-3.5" />
                    {agrupado
                        ? `${miles(total)} ${total === 1 ? "grupo" : "grupos"} · ${miles(resultado.total_filas)} ${resultado.total_filas === 1 ? "fila" : "filas"}`
                        : `${miles(total)} ${total === 1 ? "fila" : "filas"}`}
                </span>
                {resultado.criterios?.periodo && (
                    <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-600">
                        {resultado.criterios.periodo.replace(/^Período: /, "")}
                    </span>
                )}
                {cargando && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#DC143C]">
                        <Loader2 className="h-3 w-3 animate-spin" /> Actualizando…
                    </span>
                )}
            </div>

            {error && <div className="pb-3"><ErrorDeReporte mensaje={error} chico /></div>}

            {resultado.filas.length === 0 ? (
                <Vacio
                    icono={<SearchX className="h-6 w-6 text-[#1e3a5f]" />}
                    titulo="No hay nada con lo que tenés puesto"
                    texto="Probá con otro período o sacá algún filtro."
                />
            ) : (
                <div
                    className={cn(
                        "min-h-0 flex-1 overflow-auto rounded-xl border border-gray-200 bg-white shadow-sm transition-opacity",
                        cargando && "opacity-60",
                    )}
                >
                    <table className="w-full min-w-max text-sm">
                        <thead className="sticky top-0 z-10 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 shadow-[0_1px_0_0_#e5e7eb]">
                            <tr>
                                {columnas.map((c, i) => (
                                    <th
                                        key={i}
                                        className={cn(
                                            "whitespace-nowrap px-3 py-2 font-semibold",
                                            alineaDerecha(c.tipo) ? "text-right" : "text-left",
                                            agrupado && esCuenta(resultado.columnas[i].clave) && "text-[#1e3a5f]",
                                        )}
                                    >
                                        {c.titulo}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {resultado.filas.map((fila, i) => (
                                <tr key={i} className="hover:bg-[#DC143C]/[0.03]">
                                    {columnas.map((c, j) => {
                                        const texto = textoParaLeer(c, c.valor(fila, i));
                                        // Agrupado por dos: el primer grupo repetido va apagado, así
                                        // se lee «JUAN PEREZ» una vez con sus procesos abajo.
                                        const repetido = agrupado && j === 0 && i > 0 && gruposDeDos
                                            && textoParaLeer(c, c.valor(resultado.filas[i - 1], i - 1)) === texto;
                                        return (
                                            <td
                                                key={j}
                                                className={cn(
                                                    "max-w-[280px] truncate px-3 py-1.5 text-gray-800",
                                                    alineaDerecha(c.tipo) && "text-right tabular-nums",
                                                    agrupado && j < cantidadDeGrupos && "font-medium",
                                                    repetido && "text-gray-300",
                                                )}
                                                title={texto.length > 30 ? texto : undefined}
                                            >
                                                {texto === "" ? <span className="text-gray-300">—</span> : texto}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                        {hayTotales && (
                            <tfoot className="sticky bottom-0 bg-[#fdf2f4] text-[13px] font-semibold text-[#1e3a5f] shadow-[0_-1px_0_0_#f3c6cf]">
                                <tr>
                                    {resultado.columnas.map((c, j) => {
                                        const col = columnas[j];
                                        const valor = resultado.totales[c.clave];
                                        return (
                                            <td
                                                key={j}
                                                className={cn("whitespace-nowrap px-3 py-2", alineaDerecha(col.tipo) && "text-right tabular-nums")}
                                            >
                                                {j === 0 && valor === undefined
                                                    ? "Total"
                                                    : valor === undefined || valor === null
                                                        ? ""
                                                        : textoParaLeer(col, valor)}
                                            </td>
                                        );
                                    })}
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            )}

            <div className="flex flex-wrap items-start gap-x-4 gap-y-1 pt-2 text-[11px] text-gray-500">
                {resultado.recortado && resultado.vista_previa && (
                    <span className="inline-flex items-center gap-1">
                        <Info className="h-3 w-3" />
                        Ves {miles(resultado.filas.length)} de {miles(total)}. El archivo trae todo lo filtrado
                        {total > resultado.tope ? ` (hasta ${miles(resultado.tope)})` : ""}.
                    </span>
                )}
                {hayTotales && <span>Los totales son de todo lo filtrado, no sólo de lo que se ve.</span>}
            </div>
        </div>
    );
}

function Vacio({ icono, titulo, texto }: { icono: React.ReactNode; titulo: string; texto: string }) {
    return (
        <div className="flex h-full min-h-[240px] flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white/60 px-6 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#1e3a5f]/10">{icono}</div>
            <p className="font-semibold text-gray-900">{titulo}</p>
            <p className="mt-1 max-w-sm text-sm text-gray-500">{texto}</p>
        </div>
    );
}

export function ErrorDeReporte({ mensaje, chico = false }: { mensaje: string; chico?: boolean }) {
    return (
        <div
            className={cn(
                "flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-900",
                chico ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm",
            )}
            role="alert"
        >
            <AlertTriangle className={cn("mt-0.5 shrink-0 text-amber-600", chico ? "h-3.5 w-3.5" : "h-4 w-4")} />
            <span>{mensaje}</span>
        </div>
    );
}
