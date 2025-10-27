"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Maquina } from "../_types";

interface DetalleMaquinaProps {
  maquina: Maquina | null;
  onClose: () => void;
}

export default function DetalleMaquina({ maquina, onClose }: DetalleMaquinaProps) {
  if (!maquina) return null;

  return (
    <Dialog open={!!maquina} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Detalles de la Máquina</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-semibold">{maquina.nombre}</h3>
              <p className="text-muted-foreground">{maquina.cod_maquina}</p>
            </div>
          </div>

          <div className="space-y-2">
            {maquina.especialidad && (
              <div>
                <p className="font-medium">Especialidad:</p>
                <p className="text-muted-foreground">{maquina.especialidad}</p>
              </div>
            )}
            {maquina.capacidad && (
              <div>
                <p className="font-medium">Capacidad:</p>
                <p className="text-muted-foreground">{maquina.capacidad}</p>
              </div>
            )}
            {maquina.limitacion && (
              <div>
                <p className="font-medium">Limitación:</p>
                <p className="text-muted-foreground">{maquina.limitacion}</p>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

