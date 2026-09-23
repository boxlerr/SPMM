"use client";

/**
 * El botón «Exportar» (RF-22): PDF, Excel o CSV de lo que la persona está mirando.
 *
 * Es el MISMO botón en todas las pantallas a propósito. Cada una le pasa sus filas ya
 * filtradas y ordenadas —las que dibujó— y la lista de columnas; el botón no sabe nada
 * de órdenes ni de clientes. Así, «exportar» se comporta igual en todos lados y un
 * arreglo acá (una fecha mal formateada, una celda peligrosa) llega a todas juntas.
 *
 * Qué hace cada formato y por qué, en `lib/exportar.ts`.
 *
 * En el teléfono queda sólo el ícono: las barras de herramientas ya van justas y un
 * botón más con texto las hacía saltar de renglón.
 */

import { useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText, FileType2, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
    bajarArchivo,
    exportarReporte,
    nombreDeArchivo,
    type ColumnaExport,
    type FormatoExport,
    type ReporteExport,
    type SeccionExport,
} from "@/lib/exportar";

export interface ExportarMenuProps<T> {
    /** Título del reporte: arriba del PDF y en la hoja «Datos del reporte» del Excel. */
    titulo: string;
    /** Nombre del archivo sin fecha ni extensión (`ordenes_no_planificadas`). */
    archivo: string;
    /** Las filas tal como se ven: con los filtros y el orden aplicados. */
    filas?: T[];
    columnas?: ColumnaExport<T>[];
    /**
     * En vez de `filas` + `columnas`, varias tablas: una hoja del Excel por cada una.
     * Puede ser una función, para no armarlas en cada dibujo de la pantalla sino recién
     * al exportar.
     */
    secciones?: SeccionExport[] | (() => SeccionExport[]);
    /** Cuántas filas se van a exportar, cuando se pasan `secciones` (para el menú). */
    cantidad?: number;
    /** Resumen de los filtros puestos, un renglón por filtro. `null` = no aplica (una OT). */
    filtros?: string[] | (() => string[]) | null;
    /** Una aclaración que sale en el menú (p. ej. «sale la página que estás viendo»). */
    aviso?: string;
    /** Lo que dice arriba del menú, si no es una lista («Exportar esta orden»). */
    rotulo?: string;
    orientacion?: ReporteExport["orientacion"];
    /** Reemplaza el PDF genérico. La OT tiene su propia hoja, parecida a la impresa. */
    pdf?: () => Promise<Blob>;
    /** Sólo el ícono, también en la computadora (tarjetas chicas del tablero). */
    soloIcono?: boolean;
    disabled?: boolean;
    align?: "start" | "end";
    className?: string;
}

const OPCIONES: { formato: FormatoExport; rotulo: string; ayuda: string; Icono: typeof FileText }[] = [
    { formato: "pdf", rotulo: "PDF", ayuda: "Para leer, imprimir o mandar", Icono: FileText },
    { formato: "xlsx", rotulo: "Excel (.xlsx)", ayuda: "Para sumar, ordenar y filtrar", Icono: FileSpreadsheet },
    { formato: "csv", rotulo: "CSV", ayuda: "Para cargar en otro sistema", Icono: FileType2 },
];

export function ExportarMenu<T>({
    titulo,
    archivo,
    filas,
    columnas,
    secciones,
    cantidad,
    filtros,
    aviso,
    rotulo,
    orientacion,
    pdf,
    soloIcono = false,
    disabled = false,
    align = "end",
    className,
}: ExportarMenuProps<T>) {
    const [ocupado, setOcupado] = useState<FormatoExport | null>(null);

    const total = filas ? filas.length : cantidad;
    const vacio = total === 0;

    const armarReporte = (): ReporteExport => {
        const secs: SeccionExport[] = typeof secciones === "function"
            ? secciones()
            : secciones ?? [{ titulo, filas: filas ?? [], columnas: (columnas ?? []) as ColumnaExport<any>[] }];
        return {
            titulo,
            archivo,
            filtros: typeof filtros === "function" ? filtros() : filtros === null ? null : (filtros ?? []),
            secciones: secs,
            orientacion,
        };
    };

    const exportar = async (formato: FormatoExport) => {
        if (ocupado) return;
        setOcupado(formato);
        try {
            let nombre: string;
            if (formato === "pdf" && pdf) {
                nombre = nombreDeArchivo(archivo, "pdf");
                bajarArchivo(await pdf(), nombre, "pdf");
            } else {
                nombre = await exportarReporte(formato, armarReporte());
            }
            toast.success(`Listo: se bajó ${nombre}`);
        } catch (e) {
            console.error("No se pudo exportar:", e);
            toast.error("No se pudo armar el archivo. Probá de nuevo en unos segundos.");
        } finally {
            setOcupado(null);
        }
    };

    /** Al abrir el menú se van pidiendo las librerías: el click que sigue ya no espera. */
    const precargar = (abierto: boolean) => {
        if (!abierto) return;
        void import("@/lib/exportarPdf").catch(() => undefined);
        void import("@/lib/exportarXlsx").catch(() => undefined);
    };

    return (
        <DropdownMenu onOpenChange={precargar}>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled || !!ocupado}
                    className={cn("h-8 shrink-0 gap-1.5 bg-white", soloIcono ? "w-8 px-0" : "px-2 sm:px-2.5", className)}
                    title="Exportar lo que estás viendo a PDF, Excel o CSV"
                    aria-label="Exportar"
                >
                    {ocupado
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Download className="h-3.5 w-3.5" />}
                    {!soloIcono && (
                        <>
                            <span className="hidden sm:inline text-xs font-medium">
                                {ocupado ? "Armando…" : "Exportar"}
                            </span>
                            <ChevronDown className="hidden sm:inline h-3 w-3 opacity-60" />
                        </>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={align} className="z-[100] w-64">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    {rotulo
                        ? rotulo
                        : vacio
                        ? "No hay filas para exportar con lo que tenés puesto."
                        : total === undefined
                            ? "Exportar lo que estás viendo"
                            : `Exportar ${total.toLocaleString("es-AR")} ${total === 1 ? "fila" : "filas"}, como las estás viendo`}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {OPCIONES.map(({ formato, rotulo, ayuda, Icono }) => (
                    <DropdownMenuItem
                        key={formato}
                        disabled={vacio || !!ocupado}
                        onSelect={() => void exportar(formato)}
                        className="gap-2.5 py-2"
                    >
                        <Icono className="h-4 w-4 shrink-0 text-gray-500" />
                        <span className="flex flex-col">
                            <span className="text-sm font-medium">{rotulo}</span>
                            <span className="text-[11px] text-muted-foreground">{ayuda}</span>
                        </span>
                    </DropdownMenuItem>
                ))}
                {aviso && !vacio && (
                    <>
                        <DropdownMenuSeparator />
                        <p className="px-2 py-1.5 text-[11px] leading-snug text-amber-700">{aviso}</p>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export default ExportarMenu;
