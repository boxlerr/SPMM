"use client";

import { useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pencil } from "lucide-react";
import { Maquina } from "../_types";
import { etiquetaTipo } from "../_maquinaOpciones";
import { EstadoBadge } from "./EstadoMaquina";

interface DetalleMaquinaProps {
  maquina: Maquina | null;
  onClose: () => void;
  /** Si viene, el pie ofrece «Editar» y abre el formulario con esta máquina. */
  onEditar?: (maquina: Maquina) => void;
}

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

export default function DetalleMaquina({ maquina, onClose, onEditar }: DetalleMaquinaProps) {
  // «Editar» cierra este diálogo y abre el formulario en el mismo clic. Al terminar de
  // cerrarse, Radix le devuelve el foco al ojito de la fila, que queda FUERA del
  // formulario recién abierto, y el formulario lo toma como un clic afuera y se cierra
  // solo. Por eso, cuando se sale a editar, el foco no se devuelve.
  const yendoAEditar = useRef(false);
  if (!maquina) return null;

  // `undefined` = el backend todavía no sabe de estos campos (no está deployado): no se
  // muestran, en vez de decir «Sin cargar» de algo que no se puede cargar.
  const conoceEstado = maquina.estado_operativo !== undefined;
  const frecuencia = maquina.frecuencia_mantenimiento_dias;

  return (
    <Dialog open={!!maquina} onOpenChange={onClose}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto"
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
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-xl font-semibold break-words">{maquina.nombre}</h3>
              <p className="text-muted-foreground">{maquina.cod_maquina || "Sin código"}</p>
            </div>
            {conoceEstado && <EstadoBadge valor={maquina.estado_operativo} className="mt-1" />}
          </div>

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
            </p>
          )}
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
