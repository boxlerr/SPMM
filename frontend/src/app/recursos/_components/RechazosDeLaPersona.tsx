"use client";

/**
 * Los rechazos de una persona, en su ficha (RF-12): debajo del reporte de rendimiento
 * de RF-07, con el MISMO período.
 *
 * Lucas, 23/09: «¿quién la hizo? Tal empleado. Le tengo que llamar la atención». Acá se
 * ve de qué no conformidades hizo las piezas esta persona: cuántas piezas, en qué OT y
 * paso, cuándo y qué se hizo con lo rechazado. Exportable como el resto de la ficha.
 *
 * Es la sección confidencial «Rendimiento por persona», igual que el reporte de al lado:
 * la solapa sólo aparece con ella, y el servidor pide lo mismo (un 403 acá no dibuja
 * nada). Con un servidor de antes del 23/09 (404) tampoco: la solapa queda como estaba.
 */
import { useEffect, useRef, useState } from "react";
import { FileWarning } from "lucide-react";

import { ExportarMenu } from "@/components/common/ExportarMenu";
import { API_URL } from "@/config";
import type { ColumnaExport } from "@/lib/exportar";
import {
  type Lista,
  type NoConformidad,
  type ResumenNC,
  cabecerasCalidad,
  momentoNC,
  pasoTexto,
  piezasTexto,
  porcentajeTexto,
} from "@/lib/calidad";
import { type PeriodoRendimiento, rangoRendimiento, textoDelPeriodo } from "@/lib/rendimiento";
import { cn } from "@/lib/utils";

interface Datos {
  no_conformidades: NoConformidad[];
  resumen: ResumenNC;
  hay_mas: boolean;
  tipos: Lista;
  disposiciones: Lista;
  estados: Lista;
}

type Estado = "cargando" | "si" | "no" | "error";

export default function RechazosDeLaPersona({ idOperario, periodo, nombre }: {
  idOperario: number;
  /** El del reporte de rendimiento de al lado: los dos miran lo mismo. */
  periodo: PeriodoRendimiento;
  /** «Juan Pérez», para el título de los archivos. */
  nombre: string;
}) {
  const { desde, hasta } = rangoRendimiento(periodo);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [estado, setEstado] = useState<Estado>("cargando");
  const pedido = useRef(0);

  useEffect(() => {
    const este = ++pedido.current;
    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/operarios/${idOperario}/rechazos?desde=${desde}&hasta=${hasta}`,
          { headers: cabecerasCalidad() },
        );
        if (este !== pedido.current) return;
        // 404/405: servidor de antes. 401/403: sin la sección.
        if ([401, 403, 404, 405].includes(res.status)) {
          setEstado("no");
          return;
        }
        const body = res.ok ? await res.json().catch(() => null) : null;
        if (este !== pedido.current) return;
        if (!body?.status || !Array.isArray(body.data?.no_conformidades)) {
          setEstado((e) => (e === "si" ? e : "error"));
          return;
        }
        setDatos(body.data as Datos);
        setEstado("si");
      } catch {
        if (este === pedido.current) setEstado((e) => (e === "si" ? e : "error"));
      }
    })();
  }, [idOperario, desde, hasta]);

  if (estado === "no" || (estado === "cargando" && !datos)) return null;
  if (estado === "error" && !datos) {
    return (
      <p className="mx-4 mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        No se pudieron traer sus rechazos. Probá de nuevo en un rato.
      </p>
    );
  }
  if (!datos) return null;

  const r = datos.resumen;
  const filas = datos.no_conformidades;
  const textoPeriodo = textoDelPeriodo(periodo, desde, hasta);
  const tipo = (f: NoConformidad) => datos.tipos[f.tipo] ?? f.tipo;
  const disposicion = (f: NoConformidad) => (f.disposicion ? datos.disposiciones?.[f.disposicion] ?? f.disposicion : "");

  const columnas: ColumnaExport<NoConformidad>[] = [
    { titulo: "Fecha", tipo: "fechaHora", valor: (f) => f.fecha_registro },
    { titulo: "N° OT", tipo: "id", valor: (f) => f.nro_ot ?? f.id_orden_trabajo },
    { titulo: "Paso", valor: (f) => pasoTexto(f) },
    { titulo: "Tipo", valor: (f) => tipo(f) },
    { titulo: "Piezas rechazadas", tipo: "entero", valor: (f) => f.piezas_afectadas },
    { titulo: "Piezas controladas", tipo: "entero", valor: (f) => f.piezas_controladas ?? null },
    { titulo: "Qué se hace con lo rechazado", valor: (f) => disposicion(f) },
    { titulo: "Estado", valor: (f) => datos.estados?.[f.estado] ?? f.estado },
    { titulo: "Qué pasó", valor: (f) => f.descripcion ?? "" },
    { titulo: "Qué se hizo", valor: (f) => f.accion_correctiva ?? "" },
    { titulo: "Lo registró", valor: (f) => f.usuario ?? "" },
  ];

  return (
    <section className="mx-4 mb-4 flex flex-col gap-2 rounded-xl border border-gray-100 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-gray-800">
            <FileWarning className="h-3.5 w-3.5 text-amber-600" /> Rechazos y no conformidades
          </h4>
          <p className="text-[11px] text-gray-500">
            De las piezas que hizo · {textoPeriodo}
          </p>
        </div>
        <ExportarMenu
          titulo={`Rechazos · ${nombre}`}
          archivo={`rechazos_${nombre}`}
          filas={filas}
          columnas={columnas}
          filtros={() => [`Período: ${textoPeriodo}`, ...(datos.hay_mas ? [`Sólo las ${filas.length} más nuevas`] : [])]}
          disabled={!filas.length}
        />
      </div>

      {r.total === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50/50 px-3 py-4 text-center text-xs text-gray-500">
          No tiene rechazos registrados en este período.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Cifra titulo="Piezas rechazadas" valor={String(r.piezas_afectadas)} tono="text-rose-700"
                   detalle={r.porcentaje_rechazo != null ? `${porcentajeTexto(r.porcentaje_rechazo)} de las controladas` : "sin decir de cuántas"} />
            <Cifra titulo="No conformidades" valor={String(r.total)}
                   detalle={r.abiertas ? `${r.abiertas} ${r.abiertas === 1 ? "abierta" : "abiertas"}` : "todas cerradas"} />
            <Cifra titulo="Órdenes" valor={String(r.ordenes ?? new Set(filas.map((f) => f.id_orden_trabajo)).size)} detalle="con algún rechazo" />
          </div>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white px-3">
            {filas.map((f) => (
              <li key={f.id} className="py-2 text-xs">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-mono font-bold text-slate-700">OT {f.nro_ot ?? f.id_orden_trabajo}</span>
                  <span className="min-w-0 truncate font-medium text-gray-900">{pasoTexto(f)}</span>
                  <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-px text-[10px] text-gray-700">{tipo(f)}</span>
                  <span className={cn(
                    "rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide",
                    f.estado === "CERRADA" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800",
                  )}>
                    {datos.estados?.[f.estado] ?? f.estado}
                  </span>
                  <span className="ml-auto tabular-nums text-[11px] text-gray-400">{momentoNC(f.fecha_registro)}</span>
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-gray-600">
                  {f.piezas_afectadas != null && (
                    <span className="font-semibold text-rose-700 tabular-nums">
                      {piezasTexto(f.piezas_afectadas, f.piezas_controladas)} piezas
                    </span>
                  )}
                  {disposicion(f) && <span>{disposicion(f)}</span>}
                  {f.descripcion && <span className="min-w-0 truncate text-gray-500">{f.descripcion}</span>}
                </p>
              </li>
            ))}
          </ul>
          {datos.hay_mas && (
            <p className="text-[11px] text-amber-700">Son las más nuevas: hay más. Achicá el período para verlas todas.</p>
          )}
        </>
      )}
    </section>
  );
}

function Cifra({ titulo, valor, detalle, tono }: { titulo: string; valor: string; detalle: string; tono?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-gray-100 bg-gray-50 p-2.5">
      <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-gray-500">{titulo}</p>
      <p className={cn("mt-0.5 text-base sm:text-xl font-bold tabular-nums text-gray-800", tono)}>{valor}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-gray-500">{detalle}</p>
    </div>
  );
}
