"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Operario } from "../_types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNotifications } from "@/contexts/NotificationContext";
import { useToast } from "@/components/ui/toast";
import { capitalizeName } from "@/lib/utils";

interface OperarioFormProps {
  open: boolean;
  editing: boolean;
  data: Operario | null;
  onClose: () => void;
  onSuccess: () => void;
  cleanUrl: string;
}

export default function OperarioForm({ open, editing, data, onClose, onSuccess, cleanUrl }: OperarioFormProps) {
  const { addNotification } = useNotifications();
  const { showToast } = useToast();
  const [formData, setFormData] = useState({
    nombre: "",
    apellido: "",
    sector: "",
    categoria: "",
    fecha_nacimiento: "",
    fecha_ingreso: "",
    telefono: "",
    celular: "",
    dni: "", // usaremos este campo para enviar CUIL/CUIT al backend
    email: "",
  });

  const [sectores, setSectores] = useState<string[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data) {
      setFormData({
        nombre: data.nombre || "",
        apellido: data.apellido || "",
        sector: data.sector || "",
        categoria: data.categoria || "",
        fecha_nacimiento: data.fecha_nacimiento || "",
        fecha_ingreso: data.fecha_ingreso || "",
        telefono: data.telefono || "",
        celular: data.celular || "",
        dni: data.dni || "",
        email: (data as any)?.email || "",
      });
    } else {
      setFormData({
        nombre: "",
        apellido: "",
        sector: "",
        categoria: "",
        fecha_nacimiento: "",
        fecha_ingreso: "",
        telefono: "",
        celular: "",
        dni: "",
        email: "",
      });
    }
  }, [data, open]);

  // Cargar sectores desde el backend y categorías desde operarios existentes
  useEffect(() => {
    const loadOptions = async () => {
      // Cargar sectores
      try {
        const sectRes = await fetch(`${cleanUrl}/sectores`);
        if (sectRes.ok) {
          const payload = await sectRes.json();
          // El backend retorna ResponseDTO: {status: true, data: [...]}
          const data = payload?.data || [];
          const lista = Array.isArray(data)
            ? data.map((s: any) => s.nombre || s).filter(Boolean)
            : [];
          setSectores(Array.from(new Set(lista)));
          console.log("Sectores cargados:", lista);
        } else {
          console.error("Error al cargar sectores:", sectRes.status, sectRes.statusText);
        }
      } catch (error) {
        console.error("Error al obtener sectores:", error);
      }

      // Cargar categorías desde operarios existentes
      try {
        const opRes = await fetch(`${cleanUrl}/operarios`);
        if (opRes.ok) {
          const payload = await opRes.json();
          // El backend retorna ResponseDTO: {status: true, data: [...]}
          const data = payload?.data || [];
          const arr = Array.isArray(data) ? data : [];
          const cats = arr.map((o: any) => o.categoria).filter(Boolean);
          setCategorias(Array.from(new Set(cats)));
          console.log("Categorías cargadas:", cats);
        } else {
          console.error("Error al cargar operarios:", opRes.status, opRes.statusText);
        }
      } catch (error) {
        console.error("Error al obtener categorías:", error);
      }
    };
    if (open) loadOptions();
  }, [open, cleanUrl]);

  const onlyDigits = (v: string) => v.replace(/\D/g, "");
  const isValidEmail = (v: string) => !v || /.+@.+\..+/.test(v);
  const isValidDate = (v: string) => !!v && !Number.isNaN(Date.parse(v));
  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.nombre.trim()) newErrors.nombre = "Requerido";
    if (!formData.apellido.trim()) newErrors.apellido = "Requerido";
    if (!formData.categoria.trim()) newErrors.categoria = "Requerido";
    // Check dates only if present
    if (formData.fecha_nacimiento && !isValidDate(formData.fecha_nacimiento)) newErrors.fecha_nacimiento = "Fecha inválida";
    if (formData.fecha_ingreso && !isValidDate(formData.fecha_ingreso)) newErrors.fecha_ingreso = "Fecha inválida";
    const cuil = onlyDigits(formData.dni);
    if (cuil && (cuil.length < 7 || cuil.length > 11)) newErrors.dni = "Debe tener entre 7 y 11 dígitos";
    if (!isValidEmail(formData.email)) newErrors.email = "Email inválido";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    const payload = {
      ...formData,
      sector: formData.sector || null,
      fecha_nacimiento: formData.fecha_nacimiento || null,
      fecha_ingreso: formData.fecha_ingreso || null,
      // Enviar sólo dígitos en teléfonos y CUIL/CUIT (usando campo 'dni' para compatibilidad backend)
      telefono: formData.telefono ? onlyDigits(formData.telefono) : null,
      celular: formData.celular ? onlyDigits(formData.celular) : null,
      dni: formData.dni ? onlyDigits(formData.dni) : null,
    } as any;
    // No enviar email al backend hasta que el DTO lo soporte
    // delete payload.email; // Email is now supported by backend

    if (editing && data) {
      // Normalizar datos originales para comparación (teléfonos y DNI solo dígitos)
      const originalTelefono = data.telefono ? onlyDigits(data.telefono) : null;
      const originalCelular = data.celular ? onlyDigits(data.celular) : null;
      const originalDni = data.dni ? onlyDigits(data.dni) : null;

      // Comparar datos originales con los nuevos para detectar cambios
      const hasChanges =
        (data.nombre || "") !== (payload.nombre || "") ||
        (data.apellido || "") !== (payload.apellido || "") ||
        (data.sector || "") !== (payload.sector || "") ||
        (data.categoria || "") !== (payload.categoria || "") ||
        (data.fecha_nacimiento || "") !== (payload.fecha_nacimiento || "") ||
        (data.fecha_ingreso || "") !== (payload.fecha_ingreso || "") ||
        (originalTelefono || "") !== (payload.telefono || "") ||
        (originalCelular || "") !== (payload.celular || "") ||
        (originalDni || "") !== (payload.dni || "");

      const response = await fetch(`${cleanUrl}/operarios/${data.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          disponible: data.disponible ?? true,
        }),
      });

      if (response.ok && hasChanges) {
        addNotification(
          `Operario ${payload.nombre} ${payload.apellido} ha sido modificado`,
          "operario_updated"
        );
        showToast(`Operario ${capitalizeName(payload.nombre)} ${capitalizeName(payload.apellido)} modificado correctamente`, 'success');
      }
    } else {
      const response = await fetch(`${cleanUrl}/operarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          disponible: true,
        }),
      });
      if (response.ok) {
        addNotification(
          `Operario ${payload.nombre} ${payload.apellido} ha sido creado`,
          "operario_created"
        );
        showToast(`Operario ${capitalizeName(payload.nombre)} ${capitalizeName(payload.apellido)} creado correctamente`, 'success');
      }
    }
    onSuccess();
  };

  const disabled = !formData.nombre || !formData.apellido || !formData.categoria;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar" : "Crear"} Operario</DialogTitle>
          <DialogDescription>{editing ? "Modifica" : "Completa"} los datos del operario</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Información Personal</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nombre *</Label>
                <Input value={formData.nombre} onChange={(e) => setFormData({ ...formData, nombre: e.target.value })} placeholder="Juan" />
              </div>
              <div className="space-y-2">
                <Label>Apellido *</Label>
                <Input value={formData.apellido} onChange={(e) => setFormData({ ...formData, apellido: e.target.value })} placeholder="Pérez" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>DNI / CUIL / CUIT</Label>
                <Input value={formData.dni} onChange={(e) => setFormData({ ...formData, dni: e.target.value })} placeholder="20123456789" />
                {errors.dni && <p className="text-xs text-destructive">{errors.dni}</p>}
              </div>
              <div className="space-y-2">
                <Label>Fecha de Nacimiento</Label>
                <Input type="date" value={formData.fecha_nacimiento} onChange={(e) => setFormData({ ...formData, fecha_nacimiento: e.target.value })} />
                {errors.fecha_nacimiento && <p className="text-xs text-destructive">{errors.fecha_nacimiento}</p>}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Información Laboral</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Sector</Label>
                <Select value={formData.sector} onValueChange={(v) => setFormData({ ...formData, sector: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder={sectores.length > 0 ? "Selecciona un sector" : "No hay sectores disponibles"} />
                  </SelectTrigger>
                  <SelectContent>
                    {sectores.length > 0 ? (
                      sectores.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))
                    ) : (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">No hay sectores disponibles</div>
                    )}
                  </SelectContent>
                </Select>
                {errors.sector && <p className="text-xs text-destructive">{errors.sector}</p>}
              </div>
              <div className="space-y-2">
                <Label>Categoría (Rango) *</Label>
                <Select value={formData.categoria} onValueChange={(v) => setFormData({ ...formData, categoria: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder={categorias.length > 0 ? "Selecciona un rango" : "No hay rangos disponibles"} />
                  </SelectTrigger>
                  <SelectContent>
                    {categorias.length > 0 ? (
                      categorias.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))
                    ) : (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">No hay rangos disponibles</div>
                    )}
                  </SelectContent>
                </Select>
                {errors.categoria && <p className="text-xs text-destructive">{errors.categoria}</p>}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Fecha de Ingreso</Label>
              <Input type="date" value={formData.fecha_ingreso} onChange={(e) => setFormData({ ...formData, fecha_ingreso: e.target.value })} />
              {errors.fecha_ingreso && <p className="text-xs text-destructive">{errors.fecha_ingreso}</p>}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Información de Contacto</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Teléfono</Label>
                <Input value={formData.telefono} onChange={(e) => setFormData({ ...formData, telefono: e.target.value })} placeholder="42332492" />
              </div>
              <div className="space-y-2">
                <Label>Celular</Label>
                <Input value={formData.celular} onChange={(e) => setFormData({ ...formData, celular: e.target.value })} placeholder="1127486366" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email (opcional)</Label>
              <Input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="persona@empresa.com" />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={disabled}>{editing ? "Guardar Cambios" : "Crear Operario"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

