"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Maquina } from "../_types";
import { useToast } from "@/components/ui/toast"
import { parseApiError } from "@/lib/utils";
import { ESTADOS_OPERATIVOS, ESTADO_POR_DEFECTO, TIPOS_MAQUINA } from "../_maquinaOpciones";

const getAuthHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('access_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};;

// El Select de Radix no admite una opción con valor "": «sin cargar» necesita un valor
// propio, que al armar el payload vuelve a ser null.
const SIN_TIPO = "__sin_tipo__";
const FRECUENCIA_MAXIMA_DIAS = 3650;

interface MaquinaFormProps {
  open: boolean;
  editing: boolean;
  data: Maquina | null;
  onClose: () => void;
  /** Recibe la máquina como quedó guardada, para ponerla en la lista sin recargarla. */
  onSuccess: (guardada?: Maquina) => void;
  cleanUrl: string;
  /**
   * El backend ya sabe de tipo, estado y frecuencia (RF-08). Con uno viejo esos campos
   * no se muestran: los ignoraría y el «guardado» sería mentira.
   */
  conoceEstado: boolean;
}

const vacio = {
  nombre: "",
  cod_maquina: "",
  limitacion: "",
  capacidad: "",
  especialidad: "",
  tipo: SIN_TIPO,
  estado_operativo: ESTADO_POR_DEFECTO as string,
  frecuencia: "",
};

/** "" = no se lleva; si no, un entero de 1 a 3650. Devuelve el motivo si está mal. */
function problemaFrecuencia(texto: string): string | null {
  const t = texto.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1 || n > FRECUENCIA_MAXIMA_DIAS) {
    return `Tiene que ser un número entero de días, de 1 a ${FRECUENCIA_MAXIMA_DIAS}.`;
  }
  return null;
}

export default function MaquinaForm({ open, editing, data, onClose, onSuccess, cleanUrl, conoceEstado }: MaquinaFormProps) {
  const { showToast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState(vacio);

  useEffect(() => {
    if (data) {
      setFormData({
        nombre: data.nombre || "",
        cod_maquina: data.cod_maquina || "",
        limitacion: data.limitacion || "",
        capacidad: data.capacidad || "",
        especialidad: data.especialidad || "",
        tipo: data.tipo || SIN_TIPO,
        estado_operativo: data.estado_operativo || ESTADO_POR_DEFECTO,
        frecuencia:
          data.frecuencia_mantenimiento_dias != null ? String(data.frecuencia_mantenimiento_dias) : "",
      });
    } else {
      setFormData(vacio);
    }
  }, [data, open]);

  const errorFrecuencia = conoceEstado ? problemaFrecuencia(formData.frecuencia) : null;

  const handleSubmit = async () => {
    const payload: Record<string, unknown> = {
      nombre: formData.nombre,
      cod_maquina: formData.cod_maquina || null,
      limitacion: formData.limitacion || null,
      capacidad: formData.capacidad || null,
      especialidad: formData.especialidad || null,
    };
    if (conoceEstado) {
      payload.tipo = formData.tipo === SIN_TIPO ? null : formData.tipo;
      payload.estado_operativo = formData.estado_operativo;
      payload.frecuencia_mantenimiento_dias =
        formData.frecuencia.trim() === "" ? null : Number(formData.frecuencia.trim());
    }

    setIsSaving(true);
    let guardada: Maquina | undefined;
    try {
      const url = editing && data ? `${cleanUrl}/maquinarias/${data.id}` : `${cleanUrl}/maquinarias`;
      const method = editing && data ? "PUT" : "POST";
      const response = await fetch(url, {
        method,
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        // No cerramos el form: el usuario no pierde lo que cargó y puede reintentar.
        const bodyText = await response.text().catch(() => "");
        console.error("Error al guardar maquinaria:", response.status, bodyText);
        showToast(parseApiError(bodyText) || "No se pudo guardar el recurso maquinaria. Puede que la base de datos se haya desconectado; esperá unos segundos e intentá de nuevo.", 'error');
        return;
      }
      // El backend nuevo devuelve la máquina como quedó (con el tipo ya normalizado).
      // El viejo devuelve sólo el id en la edición: ahí se arma con lo que se mandó.
      const cuerpo = await response.json().catch(() => null);
      const devuelta = cuerpo?.data;
      if (devuelta && typeof devuelta.id === "number" && typeof devuelta.nombre === "string") {
        guardada = devuelta as Maquina;
      } else if (editing && data) {
        guardada = { ...data, ...(payload as Partial<Maquina>) } as Maquina;
      }
      showToast(
        editing && data
          ? `Recurso maquinaria '${payload.nombre}' modificado correctamente`
          : `Recurso maquinaria '${payload.nombre}' creado correctamente`,
        'success'
      );
    } catch (error) {
      console.error("Error de red al guardar maquinaria:", error);
      showToast("No se pudo conectar con el servidor. Revisá la conexión e intentá de nuevo.", 'error');
      return;
    } finally {
      setIsSaving(false);
    }
    onSuccess(guardada);
  };

  const estadoElegido = ESTADOS_OPERATIVOS.find((e) => e.valor === formData.estado_operativo);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      {/* Alto tope y scroll propio: con los campos del RF-08 el formulario ya no entra
          entero en un teléfono, y sin esto el botón de guardar quedaba fuera de pantalla. */}
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar" : "Crear"} recurso maquinaria</DialogTitle>
          <DialogDescription>{editing ? "Modifica" : "Completa"} los datos del recurso maquinaria</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="maq-nombre">Nombre *</Label>
            <Input id="maq-nombre" value={formData.nombre} onChange={(e) => setFormData({ ...formData, nombre: e.target.value })} placeholder="Torno CNC Haas VF2" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="maq-codigo">Código</Label>
            <Input id="maq-codigo" value={formData.cod_maquina} onChange={(e) => setFormData({ ...formData, cod_maquina: e.target.value })} placeholder="TORNO-01" />
          </div>

          {conoceEstado && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="maq-tipo">Tipo</Label>
                <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
                  <SelectTrigger id="maq-tipo" className="w-full">
                    <SelectValue placeholder="Sin cargar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SIN_TIPO}>Sin cargar</SelectItem>
                    {TIPOS_MAQUINA.map((t) => (
                      <SelectItem key={t.valor} value={t.valor}>{t.etiqueta}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="maq-estado">Estado operativo</Label>
                <Select value={formData.estado_operativo} onValueChange={(v) => setFormData({ ...formData, estado_operativo: v })}>
                  <SelectTrigger id="maq-estado" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ESTADOS_OPERATIVOS.map((e) => (
                      <SelectItem key={e.valor} value={e.valor}>{e.etiqueta}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {estadoElegido && estadoElegido.valor !== ESTADO_POR_DEFECTO && (
                // Sin esto «fuera de servicio» se lee como «no la planifiquen», y el
                // planificador todavía no mira el estado.
                <p className="sm:col-span-2 -mt-2 text-xs text-muted-foreground">
                  Por ahora es un registro: el planificador la sigue teniendo en cuenta.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="maq-capacidad">Capacidad</Label>
            <Input id="maq-capacidad" value={formData.capacidad} onChange={(e) => setFormData({ ...formData, capacidad: e.target.value })} placeholder="Volteo 400 mm, entre puntas 1000 mm" />
          </div>

          {conoceEstado && (
            <div className="space-y-2">
              <Label htmlFor="maq-frecuencia">Frecuencia de mantenimiento</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="maq-frecuencia"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={FRECUENCIA_MAXIMA_DIAS}
                  step={1}
                  value={formData.frecuencia}
                  onChange={(e) => setFormData({ ...formData, frecuencia: e.target.value })}
                  placeholder="90"
                  className="w-28"
                  aria-invalid={!!errorFrecuencia}
                  aria-describedby="maq-frecuencia-ayuda"
                />
                <span className="text-sm text-muted-foreground">días</span>
              </div>
              <p id="maq-frecuencia-ayuda" className={`text-xs ${errorFrecuencia ? "text-destructive" : "text-muted-foreground"}`}>
                {errorFrecuencia ?? "Cada cuántos días le toca. Vacío = no se le lleva mantenimiento programado."}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="maq-limitacion">Limitación</Label>
            <Input id="maq-limitacion" value={formData.limitacion} onChange={(e) => setFormData({ ...formData, limitacion: e.target.value })} placeholder="Falla en avance automático" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!formData.nombre || isSaving || !!errorFrecuencia}>{isSaving ? "Guardando..." : (editing ? "Guardar Cambios" : "Crear recurso maquinaria")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
