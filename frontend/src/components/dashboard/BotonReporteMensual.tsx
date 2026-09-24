"use client";

/**
 * El botón «Reporte mensual» del Dashboard (RF-21): se elige el mes (por defecto el
 * anterior, que es el último que cerró) y abre la pantalla del reporte.
 *
 * No pide nada al abrirse: la pantalla del reporte es la que lo pide. Con un backend de
 * antes (sin la ruta) la pantalla lo dice con un aviso chico; el Dashboard queda igual.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  conMayuscula,
  mesesElegibles,
  mesPorDefecto,
  nombreDelMes,
  rutaDelReporte,
  type MesElegible,
} from "@/lib/reporteMensual";

const valorDe = (m: MesElegible) => `${m.anio}-${m.mes}`;

export default function BotonReporteMensual() {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const opciones = useMemo(() => mesesElegibles(), []);
  const [elegido, setElegido] = useState<MesElegible>(() => mesPorDefecto());

  const abrir = () => {
    setAbierto(false);
    router.push(rutaDelReporte(elegido));
  };

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/10 px-5 py-3 text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:bg-white/20"
        >
          <CalendarRange className="h-4 w-4 text-[#ff8da1]" />
          <span>Reporte mensual</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(18rem,calc(100vw-2rem))] p-4">
        <p className="text-sm font-semibold text-gray-900">Reporte mensual</p>
        <p className="mt-0.5 text-xs leading-snug text-gray-500">
          Órdenes, producción, personas, calidad, materiales y máquinas de un mes, comparado con el anterior.
          Se exporta a PDF, Excel y CSV.
        </p>
        <label htmlFor="mes-del-reporte" className="mt-3 block text-xs font-medium text-gray-600">
          ¿De qué mes?
        </label>
        <select
          id="mes-del-reporte"
          value={valorDe(elegido)}
          onChange={(e) => {
            const [a, m] = e.target.value.split("-").map(Number);
            setElegido({ anio: a, mes: m });
          }}
          className="mt-1 h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#DC143C]/30"
        >
          {opciones.map((m) => (
            <option key={valorDe(m)} value={valorDe(m)}>
              {conMayuscula(nombreDelMes(m.anio, m.mes))}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={abrir}
          className="mt-3 w-full rounded-lg bg-gradient-to-r from-[#DC143C] to-[#B8112E] py-2 text-sm font-medium text-white transition-shadow hover:shadow-md"
        >
          Abrir el reporte
        </button>
        <p className="mt-2 text-[11px] leading-snug text-gray-400">
          Por defecto, el último mes que cerró. El mes en curso sale hasta hoy.
        </p>
      </PopoverContent>
    </Popover>
  );
}
