"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Operario, SECTORES_OPERARIO } from "../_types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useNotifications } from "@/contexts/NotificationContext";
import { useToast } from "@/components/ui/toast";
import { capitalizeName } from "@/lib/utils"

const getAuthHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('access_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};;

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
    hora_inicio: "07:00",
    hora_fin: "16:00",
    interpreta_planos: false,
  });

  const [sectores, setSectores] = useState<string[]>([...SECTORES_OPERARIO]);
  const [rangosCatalog, setRangosCatalog] = useState<{ id: number; nombre: string }[]>([]);
  const [selectedRangos, setSelectedRangos] = useState<number[]>([]);
  const [principalRango, setPrincipalRango] = useState<number | null>(null);
  const [procesos, setProcesos] = useState<{ id: number, nombre: string }[]>([]);
  const [primarySkills, setPrimarySkills] = useState<string[]>([]);
  const [secondarySkills, setSecondarySkills] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    // Conservar el sector actual aunque no esté en la lista canónica de Met Long
    // (evita perder valores legacy al editar un operario con un sector viejo).
    setSectores(Array.from(new Set([...SECTORES_OPERARIO, ...(data?.sector ? [data.sector] : [])])));
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
        hora_inicio: (data as any)?.hora_inicio || "07:00",
        hora_fin: (data as any)?.hora_fin || "16:00",
        interpreta_planos: (data as any)?.interpreta_planos ?? false,
      });
      setPrimarySkills(data.skills?.filter(s => s.nivel === 1).map(s => s.id_proceso.toString()) || []);
      setSecondarySkills(data.skills?.filter(s => s.nivel === 2).map(s => s.id_proceso.toString()) || []);
      setSelectedRangos(data.rangos || []);
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
        hora_inicio: "09:00",
        hora_fin: "18:00",
        interpreta_planos: false,
      });
      setPrimarySkills([]);
      setSecondarySkills([]);
      setSelectedRangos([]);
    }
  }, [data, open]);

  // Mantener el rango principal valido: si el actual sigue elegido se conserva;
  // si no, se elige el que coincide con la categoria cargada o el primero.
  useEffect(() => {
    if (selectedRangos.length === 0) {
      setPrincipalRango(null);
      return;
    }
    setPrincipalRango((prev) => {
      if (prev && selectedRangos.includes(prev)) return prev;
      const porNombre = rangosCatalog.find(
        (r) => r.nombre === (data?.categoria || "") && selectedRangos.includes(r.id)
      )?.id;
      return porNombre ?? selectedRangos[0];
    });
  }, [selectedRangos, rangosCatalog, data]);

  // Sectores de operario: lista fija de Met Long (ver SECTORES_OPERARIO en _types),
  // ya seteada arriba. Acá solo cargamos rangos y procesos desde el backend.
  useEffect(() => {
    const loadOptions = async () => {
      // Cargar catálogo de Rangos (id + nombre) para el multi-select
      try {
        const rangRes = await fetch(`${cleanUrl}/rangos`, { headers: getAuthHeaders() });
        if (rangRes.ok) {
          const payload = await rangRes.json();
          const data = payload?.data || [];
          const lista = Array.isArray(data)
            ? data
                .map((r: any) => ({ id: r.id, nombre: r.nombre }))
                .filter((r: any) => r.id != null && r.nombre)
            : [];
          setRangosCatalog(lista);
        } else {
          console.error("Error al cargar rangos:", rangRes.status, rangRes.statusText);
        }
      } catch (error) {
        console.error("Error al obtener rangos:", error);
      }

      // Cargar procesos
      try {
        const procRes = await fetch(`${cleanUrl}/procesos`, { headers: getAuthHeaders() });
        if (procRes.ok) {
          const payload = await procRes.json();
          const pdata = payload?.data || [];
          setProcesos(Array.isArray(pdata) ? pdata : []);
        }
      } catch (error) {
        console.error("Error al obtener procesos:", error);
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
    if (selectedRangos.length === 0) newErrors.categoria = "Seleccioná al menos un rango";
    // Check dates only if present
    if (formData.fecha_nacimiento && !isValidDate(formData.fecha_nacimiento)) newErrors.fecha_nacimiento = "Fecha inválida";
    if (formData.fecha_ingreso && !isValidDate(formData.fecha_ingreso)) newErrors.fecha_ingreso = "Fecha inválida";
    const cuil = onlyDigits(formData.dni);
    if (cuil && (cuil.length < 7 || cuil.length > 11)) newErrors.dni = "Debe tener entre 7 y 11 dígitos";
    if (!isValidEmail(formData.email)) newErrors.email = "Email inválido";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const toggleRango = (id: number) => {
    setSelectedRangos((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    // La categoría (string) se deriva del rango principal elegido.
    const categoriaPrincipal =
      rangosCatalog.find((r) => r.id === (principalRango ?? selectedRangos[0]))?.nombre || "";
    const payload = {
      ...formData,
      categoria: categoriaPrincipal,
      rangos: selectedRangos,
      sector: formData.sector || null,
      fecha_nacimiento: formData.fecha_nacimiento || null,
      fecha_ingreso: formData.fecha_ingreso || null,
      // Enviar sólo dígitos en teléfonos y CUIL/CUIT (usando campo 'dni' para compatibilidad backend)
      telefono: formData.telefono ? onlyDigits(formData.telefono) : null,
      celular: formData.celular ? onlyDigits(formData.celular) : null,
      dni: formData.dni ? onlyDigits(formData.dni) : null,
    } as any;

    // Preparar skills (N primarios + N secundarios). Las nativas se derivan del rango.
    const skillsPayload: { id_proceso: number; nivel: number; habilitado: boolean }[] = [];
    primarySkills.forEach(skillId => {
      if (skillId && skillId !== "none") {
        skillsPayload.push({ id_proceso: parseInt(skillId), nivel: 1, habilitado: true });
      }
    });
    secondarySkills.forEach(skillId => {
      if (skillId && skillId !== "none" && !primarySkills.includes(skillId)) {
        skillsPayload.push({ id_proceso: parseInt(skillId), nivel: 2, habilitado: true });
      }
    });

    // Deduplicar por id_proceso (la primera ocurrencia gana, manteniendo nivel 1 sobre 2)
    const uniqueSkills = skillsPayload.filter((value, index, self) =>
      index === self.findIndex((t) => t.id_proceso === value.id_proceso)
    );
    payload.skills = uniqueSkills;

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
        (originalDni || "") !== (payload.dni || "") ||
        ((data as any).hora_inicio || "07:00") !== (payload.hora_inicio || "07:00") ||
        ((data as any).hora_fin || "16:00") !== (payload.hora_fin || "16:00") ||
        JSON.stringify([...(data.rangos || [])].sort((a, b) => a - b)) !== JSON.stringify([...selectedRangos].sort((a, b) => a - b));

      const response = await fetch(`${cleanUrl}/operarios/${data.id}`, {
        method: "PUT",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
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
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
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

  const disabled = !formData.nombre || !formData.apellido || selectedRangos.length === 0;

  const handlePrimaryChange = (index: number, val: string) => {
    const newSkills = [...primarySkills];
    newSkills[index] = val === "none" ? "" : val;
    setPrimarySkills(newSkills);
  };

  const handleSecondaryChange = (index: number, val: string) => {
    const newSkills = [...secondarySkills];
    newSkills[index] = val === "none" ? "" : val;
    setSecondarySkills(newSkills);
  };

  const removePrimarySkill = (index: number) => {
    const newSkills = [...primarySkills];
    newSkills.splice(index, 1);
    setPrimarySkills(newSkills);
  };

  const removeSecondarySkill = (index: number) => {
    const newSkills = [...secondarySkills];
    newSkills.splice(index, 1);
    setSecondarySkills(newSkills);
  };

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
                <Label>Fecha de Ingreso</Label>
                <Input type="date" value={formData.fecha_ingreso} onChange={(e) => setFormData({ ...formData, fecha_ingreso: e.target.value })} />
                {errors.fecha_ingreso && <p className="text-xs text-destructive">{errors.fecha_ingreso}</p>}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Rango(s) * <span className="text-xs font-normal text-muted-foreground">— otorgan las habilidades nativas</span></Label>
              <div className="flex flex-wrap gap-2">
                {rangosCatalog.length === 0 && (
                  <p className="text-xs text-muted-foreground">No hay rangos disponibles</p>
                )}
                {rangosCatalog.map((r) => {
                  const sel = selectedRangos.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggleRango(r.id)}
                      className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${sel
                        ? "bg-blue-100 border-blue-300 text-blue-900"
                        : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"}`}
                    >
                      {r.nombre}
                    </button>
                  );
                })}
              </div>
              {selectedRangos.length > 1 && (
                <div className="space-y-1 pt-1">
                  <Label className="text-xs">Rango principal (define la categoría)</Label>
                  <Select value={principalRango ? principalRango.toString() : ""} onValueChange={(v) => setPrincipalRango(parseInt(v))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Elegí el rango principal" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedRangos.map((id) => {
                        const r = rangosCatalog.find((x) => x.id === id);
                        return <SelectItem key={id} value={id.toString()}>{r?.nombre ?? id}</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {errors.categoria && <p className="text-xs text-destructive">{errors.categoria}</p>}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Habilidades del Operario</h3>
            <p className="text-xs text-muted-foreground">Las SKILLS NATIVAS se derivan automáticamente de los rangos seleccionados arriba.</p>
            <label className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50/50 px-3 py-2 cursor-pointer w-fit">
              <Checkbox
                checked={formData.interpreta_planos}
                onCheckedChange={(v) => setFormData({ ...formData, interpreta_planos: v === true })}
              />
              <span className="text-sm font-medium">Interpretación de planos</span>
              <span className="text-xs text-muted-foreground">(sabe leer planos)</span>
            </label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>SKILLS 1</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setPrimarySkills([...primarySkills, ""])}
                  >
                    + Añadir
                  </Button>
                </div>
                {primarySkills.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">Ninguna</p>
                )}
                {primarySkills.map((skillId, idx) => (
                  <div key={`p-${idx}`} className="flex items-center gap-2">
                    <Select
                      value={skillId || "none"}
                      onValueChange={(val) => handlePrimaryChange(idx, val)}
                    >
                      <SelectTrigger className="flex-1 min-w-0">
                        <SelectValue placeholder="Seleccionar habilidad" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Ninguna</SelectItem>
                        {procesos.map(p => (
                          <SelectItem key={p.id} value={p.id.toString()}>{p.nombre}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0"
                      onClick={() => removePrimarySkill(idx)}
                    >
                      X
                    </Button>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>SKILLS 2</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setSecondarySkills([...secondarySkills, ""])}
                  >
                    + Añadir
                  </Button>
                </div>
                {secondarySkills.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">Ninguna</p>
                )}
                {secondarySkills.map((skillId, idx) => (
                  <div key={`s-${idx}`} className="flex items-center gap-2">
                    <Select
                      value={skillId || "none"}
                      onValueChange={(val) => handleSecondaryChange(idx, val)}
                    >
                      <SelectTrigger className="flex-1 min-w-0">
                        <SelectValue placeholder="Seleccionar habilidad" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Ninguna</SelectItem>
                        {procesos.map(p => (
                          <SelectItem key={p.id} value={p.id.toString()}>{p.nombre}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0"
                      onClick={() => removeSecondarySkill(idx)}
                    >
                      X
                    </Button>
                  </div>
                ))}
              </div>
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

          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Horario de Trabajo</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Hora de Inicio</Label>
                <Input type="time" value={formData.hora_inicio} onChange={(e) => setFormData({ ...formData, hora_inicio: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Hora de Fin</Label>
                <Input type="time" value={formData.hora_fin} onChange={(e) => setFormData({ ...formData, hora_fin: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">El planificador utilizará estas horas para organizar las tareas de este operario.</p>
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

