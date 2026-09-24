"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Pencil, Timer, Wrench } from "lucide-react";
import { Maquina } from "../_types";
import { etiquetaTipo } from "../_maquinaOpciones";
import { EstadoBadge } from "./EstadoMaquina";
import UsoMaquina, { useUsoMaquina } from "./UsoMaquina";
import MantenimientoMaquina, { useMantenimiento } from "./MantenimientoMaquina";
import { mostrarSolapa } from "@/lib/asistencia";
import type { PeriodoRendimiento } from "@/lib/rendimiento";
import type { MantenimientoDeMaquina } from "@/lib/usoMaquina";

interface DetalleMaquinaProps {
  maquina: Maquina | null;
  onClose: () => void;
  /** Si viene, el pie ofrece «Editar» y abre el formulario con esta máquina. */
  onEditar?: (maquina: Maquina) => void;
  /** Puede editar Recurso maquinaria: configurar el mantenimiento y registrar uno hecho. */
  edita?: boolean;
  /** El mantenimiento cambió (la frecuencia es un dato de la máquina y la tabla muestra su
   *  estado): quien abrió el detalle lo refleja sin volver a pedir la lista. */
  onMantenimiento?: (d: MantenimientoDeMaquina) => void;
}

const SOLAPA =
  "h-7 rounded-lg px-2 sm:px-3 text-xs data-[state=active]:bg-white data-[state=active]:text-[#445EF2] data-[state=active]:shadow-sm";

/** Un dato del detalle. Lo que no está cargado se dice, no se esconde. */
function Dato({ titulo, children, vacio }: { titulo: string; children?: ReactNode; vacio?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{titulo}</p>
      {vacio ? (
        <p className="text-sm italic text-muted-foreground">Sin cargar</p>
      ) : (
        <div className="text-sm break-words">{children}</div>
      )}
    </div>
  );
}

export default function DetalleMaquina({ maquina, onClose, onEditar, edita = false, onMantenimiento }: DetalleMaquinaProps) {
  // «Editar» cierra este diálogo y abre el formulario en el mismo clic. Al terminar de
  // cerrarse, Radix le devuelve el foco al ojito de la fila, que queda FUERA del
  // formulario recién abierto, y el formulario lo toma como un clic afuera y se cierra
  // solo. Por eso, cuando se sale a editar, el foco no se devuelve.
  const yendoAEditar = useRef(false);

  // RF-10: las solapas Uso y Mantenimiento. Se piden al abrir el detalle para saber si
  // el backend las tiene: si no (se deploya a mano y puede ir atrás), ni aparecen.
  const [solapa, setSolapa] = useState<"datos" | "uso" | "mantenimiento">("datos");
  const [periodo, setPeriodo] = useState<PeriodoRendimiento>({ clave: "mes" });
  const uso = useUsoMaquina(maquina?.id, periodo);
  const mantenimiento = useMantenimiento(maquina?.id);
  const hayUso = mostrarSolapa("uso_maquina", uso.estado);
  const hayMantenimiento = mostrarSolapa("mantenimiento_maquina", mantenimiento.estado);
  const solapaVisible =
    (solapa === "uso" && !hayUso) || (solapa === "mantenimiento" && !hayMantenimiento) ? "datos" : solapa;

  if (!maquina) return null;

  // `undefined` = el backend todavía no sabe de estos campos (no está deployado): no se
  // muestran, en vez de decir «Sin cargar» de algo que no se puede cargar.
  const conoceEstado = maquina.estado_operativo !== undefined;
  const frecuencia = maquina.frecuencia_mantenimiento_dias;

  return (
    <Dialog open={!!maquina} onOpenChange={() => { setSolapa("datos"); onClose(); }}>
      <DialogContent
        className={`max-h-[90vh] overflow-y-auto ${hayUso || hayMantenimiento ? "sm:max-w-3xl" : ""}`}
        onCloseAutoFocus={(e) => {
          if (yendoAEditar.current) {
            e.preventDefault();
            yendoAEditar.current = false;
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Detalles del recurso maquinaria</DialogTitle>
          <DialogDescription>Información detallada del recurso maquinaria</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-xl font-semibold break-words">{maquina.nombre}</h3>
              <p className="text-muted-foreground">{maquina.cod_maquina || "Sin código"}</p>
            </div>
            {conoceEstado && <EstadoBadge valor={maquina.estado_operativo} className="mt-1" />}
          </div>

          <Tabs value={solapaVisible} onValueChange={(v) => setSolapa(v as typeof solapa)} className="min-w-0">
          {(hayUso || hayMantenimiento) && (
            <TabsList className="h-auto min-h-9 flex-wrap justify-start gap-1 rounded-xl bg-gray-100/60 p-1">
              <TabsTrigger value="datos" className={SOLAPA}>
                <FileText className="h-3.5 w-3.5 mr-1.5 hidden sm:block" /> Datos
              </TabsTrigger>
              {hayUso && (
                <TabsTrigger value="uso" className={SOLAPA}>
                  <Timer className="h-3.5 w-3.5 mr-1.5 hidden sm:block" /> Uso
                </TabsTrigger>
              )}
              {hayMantenimiento && (
                <TabsTrigger value="mantenimiento" className={SOLAPA}>
                  <Wrench className="h-3.5 w-3.5 mr-1.5 hidden sm:block" /> Mantenimiento
                  {mantenimiento.datos && ["proximo", "vencido"].includes(mantenimiento.datos.estado.estado) && (
                    <span className={`ml-1.5 h-1.5 w-1.5 rounded-full ${mantenimiento.datos.estado.estado === "vencido" ? "bg-red-500" : "bg-amber-500"}`}
                      aria-label={mantenimiento.datos.estado.estado_texto} />
                  )}
                </TabsTrigger>
              )}
            </TabsList>
          )}

          <TabsContent value="datos" className="mt-3 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {conoceEstado && (
              <Dato titulo="Tipo" vacio={!maquina.tipo}>
                {etiquetaTipo(maquina.tipo)}
              </Dato>
            )}
            <Dato titulo="Capacidad" vacio={!maquina.capacidad}>
              {maquina.capacidad}
            </Dato>
            {conoceEstado && (
              // Vacío dice «Sin cargar» y no «no se le lleva»: en las 31 máquinas que ya
              // estaban nadie lo decidió todavía, y las dos cosas se ven igual en la base.
              <Dato titulo="Frecuencia de mantenimiento" vacio={frecuencia == null}>
                {frecuencia != null && `Cada ${frecuencia} ${frecuencia === 1 ? "día" : "días"}`}
              </Dato>
            )}
            <Dato titulo="Limitación">
              {maquina.limitacion || <span className="italic text-muted-foreground">Sin limitación</span>}
            </Dato>
            {maquina.especialidad && (
              <Dato titulo="Especialidad">{maquina.especialidad}</Dato>
            )}
          </div>

          {conoceEstado && maquina.estado_operativo && maquina.estado_operativo !== "operativa" && (
            <p className="text-xs text-muted-foreground">
              Por ahora el estado es un registro: el planificador la sigue teniendo en cuenta.
              {maquina.estado_operativo === "fuera_de_servicio" && " Lo que se arranque en ella no suma horas de uso."}
            </p>
          )}
          </TabsContent>

          {hayUso && (
            <TabsContent value="uso" className="mt-3">
              <UsoMaquina uso={uso} periodo={periodo} onPeriodo={setPeriodo} nombreMaquina={maquina.nombre} />
            </TabsContent>
          )}
          {hayMantenimiento && (
            <TabsContent value="mantenimiento" className="mt-3">
              <MantenimientoMaquina idMaquina={maquina.id} mantenimiento={mantenimiento} edita={edita}
                onCambio={onMantenimiento} />
            </TabsContent>
          )}
          </Tabs>
        </div>
        <DialogFooter>
          {onEditar && (
            <Button
              variant="outline"
              onClick={() => {
                yendoAEditar.current = true;
                onEditar(maquina);
              }}
            >
              <Pencil className="h-4 w-4 mr-1" />
              Editar
            </Button>
          )}
          <Button onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
