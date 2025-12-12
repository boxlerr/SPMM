"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Operario } from "../_types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNotifications } from "@/contexts/NotificationContext";
import { useToast } from "@/components/ui/toast";
import { capitalizeName } from "@/lib/utils";
import { User, Briefcase, Phone } from "lucide-react";

interface OperarioEditFormProps {
    data: Operario | null;
    onCancel: () => void;
    onSuccess: () => void;
    cleanUrl: string;
    isCreating?: boolean;
}

export default function OperarioEditForm({ data, onCancel, onSuccess, cleanUrl, isCreating = false }: OperarioEditFormProps) {
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
        dni: "",
        email: "",
    });

    const [sectores, setSectores] = useState<string[]>([]);
    const [categorias, setCategorias] = useState<string[]>([]);
    const [errors, setErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        if (data && !isCreating) {
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
    }, [data, isCreating]);

    useEffect(() => {
        const loadOptions = async () => {
            try {
                const sectRes = await fetch(`${cleanUrl}/sectores`);
                if (sectRes.ok) {
                    const payload = await sectRes.json();
                    const data = payload?.data || [];
                    const lista = Array.isArray(data)
                        ? data.map((s: any) => s.nombre || s).filter(Boolean)
                        : [];
                    setSectores(Array.from(new Set(lista)));
                }
            } catch (error) {
                console.error("Error al obtener sectores:", error);
            }

            try {
                const opRes = await fetch(`${cleanUrl}/operarios`);
                if (opRes.ok) {
                    const payload = await opRes.json();
                    const data = payload?.data || [];
                    const arr = Array.isArray(data) ? data : [];
                    const cats = arr.map((o: any) => o.categoria).filter(Boolean);
                    setCategorias(Array.from(new Set(cats)));
                }
            } catch (error) {
                console.error("Error al obtener categorías:", error);
            }
        };
        loadOptions();
    }, [cleanUrl]);

    const onlyDigits = (v: string) => v.replace(/\D/g, "");
    const isValidEmail = (v: string) => !v || /.+@.+\..+/.test(v);
    const isValidDate = (v: string) => !!v && !Number.isNaN(Date.parse(v));
    const validate = () => {
        const newErrors: Record<string, string> = {};
        if (!formData.nombre.trim()) newErrors.nombre = "Requerido";
        if (!formData.apellido.trim()) newErrors.apellido = "Requerido";
        if (!formData.sector.trim()) newErrors.sector = "Requerido";
        if (!formData.categoria.trim()) newErrors.categoria = "Requerido";
        if (!isValidDate(formData.fecha_nacimiento)) newErrors.fecha_nacimiento = "Fecha inválida";
        if (!isValidDate(formData.fecha_ingreso)) newErrors.fecha_ingreso = "Fecha inválida";
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
            telefono: formData.telefono ? onlyDigits(formData.telefono) : null,
            celular: formData.celular ? onlyDigits(formData.celular) : null,
            dni: formData.dni ? onlyDigits(formData.dni) : null,
        } as any;

        if (!isCreating && data) {
            const originalTelefono = data.telefono ? onlyDigits(data.telefono) : null;
            const originalCelular = data.celular ? onlyDigits(data.celular) : null;
            const originalDni = data.dni ? onlyDigits(data.dni) : null;

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

    const disabled = !formData.nombre || !formData.apellido || !formData.sector || !formData.categoria || !formData.fecha_nacimiento || !formData.fecha_ingreso;

    return (
        <div className="flex flex-col w-full">
            <div className="border-b pb-4 mb-6 shrink-0">
                <h2 className="text-2xl font-bold tracking-tight text-gray-900">Modificar Datos</h2>
                <p className="text-sm text-muted-foreground mt-1">Actualiza la información personal y laboral del operario.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {/* Personal Info */}
                <div className="bg-white rounded-lg border shadow-sm p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center">
                            <User className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-gray-900">Información Personal</h3>
                            <p className="text-sm text-gray-500">Datos de identificación básica</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label className="text-gray-700">Nombre *</Label>
                            <Input value={formData.nombre} onChange={(e) => setFormData({ ...formData, nombre: e.target.value })} placeholder="Juan" className="bg-gray-50/50" />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-gray-700">Apellido *</Label>
                            <Input value={formData.apellido} onChange={(e) => setFormData({ ...formData, apellido: e.target.value })} placeholder="Pérez" className="bg-gray-50/50" />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-gray-700">DNI / CUIL / CUIT</Label>
                            <Input value={formData.dni} onChange={(e) => setFormData({ ...formData, dni: e.target.value })} placeholder="20123456789" className="bg-gray-50/50" />
                            {errors.dni && <p className="text-xs text-destructive">{errors.dni}</p>}
                        </div>
                        <div className="space-y-2">
                            <Label className="text-gray-700">Fecha de Nacimiento *</Label>
                            <Input type="date" value={formData.fecha_nacimiento} onChange={(e) => setFormData({ ...formData, fecha_nacimiento: e.target.value })} required className="bg-gray-50/50" />
                            {errors.fecha_nacimiento && <p className="text-xs text-destructive">{errors.fecha_nacimiento}</p>}
                        </div>
                    </div>
                </div>

                {/* Labor Info */}
                <div className="bg-white rounded-lg border shadow-sm p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-10 w-10 rounded-full bg-orange-50 flex items-center justify-center">
                            <Briefcase className="h-5 w-5 text-orange-600" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-gray-900">Información Laboral</h3>
                            <p className="text-sm text-gray-500">Detalles del puesto y asignación</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label className="text-gray-700">Sector *</Label>
                            <Select value={formData.sector} onValueChange={(v) => setFormData({ ...formData, sector: v })}>
                                <SelectTrigger className="bg-gray-50/50">
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
                            <Label className="text-gray-700">Categoría (Rango) *</Label>
                            <Select value={formData.categoria} onValueChange={(v) => setFormData({ ...formData, categoria: v })}>
                                <SelectTrigger className="bg-gray-50/50">
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
                        <div className="space-y-2">
                            <Label className="text-gray-700">Fecha de Ingreso *</Label>
                            <Input type="date" value={formData.fecha_ingreso} onChange={(e) => setFormData({ ...formData, fecha_ingreso: e.target.value })} required className="bg-gray-50/50" />
                            {errors.fecha_ingreso && <p className="text-xs text-destructive">{errors.fecha_ingreso}</p>}
                        </div>
                    </div>
                </div>

                {/* Contact Info */}
                <div className="bg-white rounded-lg border shadow-sm p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-10 w-10 rounded-full bg-green-50 flex items-center justify-center">
                            <Phone className="h-5 w-5 text-green-600" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-gray-900">Información de Contacto</h3>
                            <p className="text-sm text-gray-500">Canales de comunicación</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label className="text-gray-700">Teléfono</Label>
                            <Input value={formData.telefono} onChange={(e) => setFormData({ ...formData, telefono: e.target.value })} placeholder="42332492" className="bg-gray-50/50" />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-gray-700">Celular</Label>
                            <Input value={formData.celular} onChange={(e) => setFormData({ ...formData, celular: e.target.value })} placeholder="1127486366" className="bg-gray-50/50" />
                        </div>
                        <div className="space-y-2 col-span-1 md:col-span-2">
                            <Label className="text-gray-700">Email (opcional)</Label>
                            <Input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="persona@empresa.com" className="bg-gray-50/50" />
                            {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex justify-end gap-2 mt-8 pt-4 border-t">
                <Button variant="outline" onClick={onCancel}>Cancelar</Button>
                <Button onClick={handleSubmit} disabled={disabled} className="bg-slate-900 text-white hover:bg-slate-800 px-8">
                    {!isCreating ? "Guardar Cambios" : "Crear Operario"}
                </Button>
            </div>
        </div>
    );
}
