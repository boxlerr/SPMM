"use client";

/**
 * El filtro de fechas de Auditoría (RF-25): atajos (Todo, Hoy, 7 días, 30 días) y un
 * rango a mano. Hasta el 23/09 no había ninguno: la pantalla mostraba los últimos 300
 * movimientos y lo de hace un mes no se podía ver.
 *
 * Botones y no un desplegable: son pocos, se tocan seguido y en un teléfono un botón
 * se acierta mejor que una lista. El rango se aplica recién cuando las dos fechas
 * están bien (mientras se tipea una no se pide nada al servidor).
 */

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { isoLocal } from "@/lib/asistencia";
import {
    ATAJOS_DE_PERIODO,
    problemaDelRango,
    rangoDelPeriodo,
    type ClavePeriodoAuditoria,
    type PeriodoAuditoria,
} from "@/lib/auditoria";

export function FiltroDeFechas({ periodo, onCambiar, className }: {
    periodo: PeriodoAuditoria;
    onCambiar: (p: PeriodoAuditoria) => void;
    className?: string;
}) {
    // Lo tipeado del rango: se aplica cuando las dos fechas están bien.
    const [desde, setDesde] = useState(periodo.desde ?? "");
    const [hasta, setHasta] = useState(periodo.hasta ?? "");
    useEffect(() => {
        if (periodo.clave === "rango") {
            setDesde(periodo.desde ?? "");
            setHasta(periodo.hasta ?? "");
        }
    }, [periodo]);
    const problema = periodo.clave === "rango" ? problemaDelRango(desde, hasta) : null;

    const elegir = (clave: ClavePeriodoAuditoria) => {
        if (clave !== "rango") {
            onCambiar({ clave });
            return;
        }
        // El rango arranca en lo que se estaba mirando (o en los últimos 7 días), sin saltar.
        const actual = rangoDelPeriodo(periodo);
        const h = actual.hasta ?? isoLocal(new Date());
        const d = actual.desde ?? h;
        setDesde(d);
        setHasta(h);
        onCambiar({ clave: "rango", desde: d, hasta: h });
    };

    const aplicar = (d: string, h: string) => {
        setDesde(d);
        setHasta(h);
        if (!problemaDelRango(d, h)) onCambiar({ clave: "rango", desde: d, hasta: h });
    };

    return (
        <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground mr-0.5" aria-hidden />
            {ATAJOS_DE_PERIODO.map(({ clave, texto }) => (
                <button
                    key={clave}
                    type="button"
                    onClick={() => elegir(clave)}
                    aria-pressed={periodo.clave === clave}
                    className={cn(
                        "text-xs px-2 py-1 rounded-full border transition-colors",
                        periodo.clave === clave
                            ? "bg-primary text-primary-foreground border-primary"
                            : "hover:bg-muted text-muted-foreground"
                    )}
                >
                    {texto}
                </button>
            ))}
            {periodo.clave === "rango" && (
                <span className="flex items-center gap-1.5">
                    <input
                        type="date"
                        value={desde}
                        max={hasta || undefined}
                        onChange={(e) => aplicar(e.target.value, hasta)}
                        aria-label="Desde"
                        className="h-7 w-[128px] rounded-md border border-gray-200 bg-white px-2 text-xs"
                    />
                    <span className="text-[11px] text-gray-400">al</span>
                    <input
                        type="date"
                        value={hasta}
                        min={desde || undefined}
                        onChange={(e) => aplicar(desde, e.target.value)}
                        aria-label="Hasta"
                        className="h-7 w-[128px] rounded-md border border-gray-200 bg-white px-2 text-xs"
                    />
                </span>
            )}
            {problema && <span className="text-[11px] text-red-600">{problema}</span>}
        </div>
    );
}
