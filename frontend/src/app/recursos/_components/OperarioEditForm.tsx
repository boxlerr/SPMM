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
import { User, Briefcase, Phone, Wrench, Clock } from "lucide-react";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('access_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

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
        hora_inicio: "07:00",
        hora_fin: "16:00",
        dias_trabajo: "MON,TUE,WED,THU,FRI",
        min_desayuno: 15,
        min_almuerzo: 30,
    });

    const [sectores, setSectores] = useState<string[]>([]);
    const [categorias, setCategorias] = useState<string[]>([]);
    const [procesos, setProcesos] = useState<{ id: number, nombre: string }[]>([]);
    const [primarySkills, setPrimarySkills] = useState<string[]>([]);
    const [secondarySkills, setSecondarySkills] = useState<string[]>([]);
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
                hora_inicio: (data as any)?.hora_inicio || "07:00",
                hora_fin: (data as any)?.hora_fin || "16:00",
                dias_trabajo: (data as any)?.dias_trabajo || "MON,TUE,WED,THU,FRI",
                min_desayuno: (data as any)?.min_desayuno ?? 15,
                min_almuerzo: (data as any)?.min_almuerzo ?? 30,
            });
            setPrimarySkills(data.skills?.filter(s => s.nivel === 1).map(s => s.id_proceso.toString()) || []);
            setSecondarySkills(data.skills?.filter(s => s.nivel === 2).map(s => s.id_proceso.toString()) || []);
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
                hora_inicio: "07:00",
                hora_fin: "16:00",
                dias_trabajo: "MON,TUE,WED,THU,FRI",
                min_desayuno: 15,
                min_almuerzo: 30,
            });
            setPrimarySkills([]);
            setSecondarySkills([]);
        }
    }, [data, isCreating]);

    useEffect(() => {
        const loadOptions = async () => {
            try {
                const sectRes = await fetch(`${cleanUrl}/sectores`, { headers: getAuthHeaders() });
                if (sectRes.ok) {
                    const payload = await sectRes.json();
                    const listData = Array.isArray(payload) ? payload : (payload?.data || []);
                    const lista = listData.map((s: any) => s.nombre || s).filter(Boolean);

                    if (data?.sector) {
                        lista.push(data.sector);
                    }

                    setSectores(Array.from(new Set(lista)));
                }
            } catch (error) {
                console.error("Error al obtener sectores:", error);
                if (data?.sector) setSectores([data.sector]);
            }

            try {
                const opRes = await fetch(`${cleanUrl}/operarios`, { headers: getAuthHeaders() });
                if (opRes.ok) {
                    const payload = await opRes.json();
                    const listData = Array.isArray(payload) ? payload : (payload?.data || []);
                    const cats = listData.map((o: any) => o.categoria).filter(Boolean);

                    if (data?.categoria) {
                        cats.push(data.categoria);
                    }

                    setCategorias(Array.from(new Set(cats)));
                }
            } catch (error) {
                console.error("Error al obtener categorías:", error);
                if (data?.categoria) setCategorias([data.categoria]);
            }

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
        loadOptions();
    }, [cleanUrl, data]);

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

        const skillsPayload: any[] = [];
        primarySkills.forEach(skillId => {
            if (skillId && skillId !== "none") {
                skillsPayload.push({ id_proceso: parseInt(skillId), nivel: 1, habilitado: true });
            }
        });
        secondarySkills.forEach(skillId => {
            if (skillId && skillId !== "none") {
                // Remove duplicates by preferring primary if user messed up and selected the same thing
                if (!skillsPayload.find(s => s.id_proceso === parseInt(skillId))) {
                    skillsPayload.push({ id_proceso: parseInt(skillId), nivel: 2, habilitado: true });
                }
            }
        });
        const uniqueSkills = skillsPayload.filter((value, index, self) =>
            index === self.findIndex((t) => (t.id_proceso === value.id_proceso))
        );
        payload.skills = uniqueSkills;

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
                (originalDni || "") !== (payload.dni || "") ||
                ((data as any).hora_inicio || "07:00") !== (payload.hora_inicio || "07:00") ||
                ((data as any).hora_fin || "16:00") !== (payload.hora_fin || "16:00") ||
                ((data as any).dias_trabajo || "MON,TUE,WED,THU,FRI") !== (payload.dias_trabajo || "MON,TUE,WED,THU,FRI") ||
                (((data as any).min_desayuno ?? 15)) !== (payload.min_desayuno ?? 15) ||
                (((data as any).min_almuerzo ?? 30)) !== (payload.min_almuerzo ?? 30) ||
                JSON.stringify(data.skills?.map(s => ({ id_proceso: s.id_proceso, nivel: s.nivel })).sort((a, b) => a.id_proceso - b.id_proceso)) !== JSON.stringify(uniqueSkills.map(s => ({ id_proceso: s.id_proceso, nivel: s.nivel })).sort((a, b) => a.id_proceso - b.id_proceso));

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

    const baseDisabled = !formData.nombre || !formData.apellido || !formData.sector || !formData.categoria;
    const disabled = isCreating
        ? baseDisabled || !formData.fecha_nacimiento || !formData.fecha_ingreso
        : baseDisabled;

    const handlePrimaryChange = (index: number, val: string) => {
        const newSkills = [...primarySkills];
        newSkills[index] = val === "none" ? "" : val;
        setPrimarySkills(newSkills); // don't filter out empties immediately so deleting works
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
        <div className="flex flex-col w-full">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Personal Info */}
                <div className="bg-white rounded-lg border shadow-sm p-4">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="h-8 w-8 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                            <User className="h-4 w-4 text-blue-600" />
                        </div>
                        <h3 className="text-base font-semibold text-gray-900">Información Personal</h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label className="text-gray-700">Nombre *</Label>
                            <Input value={formData.nombre} onChange={(e) => setFormData({ ...formData, nombre: e.target.value })} placeholder="Ej.: Juan" className="bg-gray-50/50" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-gray-700">Apellido *</Label>
                            <Input value={formData.apellido} onChange={(e) => setFormData({ ...formData, apellido: e.target.value })} placeholder="Ej.: Pérez" className="bg-gray-50/50" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-gray-700">DNI / CUIL / CUIT</Label>
                            <Input value={formData.dni} onChange={(e) => setFormData({ ...formData, dni: e.target.value })} placeholder="Ej.: 20123456789" className="bg-gray-50/50" />
                            {errors.dni && <p className="text-xs text-destructive">{errors.dni}</p>}
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-gray-700">Fecha de Nacimiento *</Label>
                            <Input type="date" value={formData.fecha_nacimiento} onChange={(e) => setFormData({ ...formData, fecha_nacimiento: e.target.value })} required className="bg-gray-50/50" />
                            {errors.fecha_nacimiento && <p className="text-xs text-destructive">{errors.fecha_nacimiento}</p>}
                        </div>
                    </div>
                </div>

                {/* Labor Info */}
                <div className="bg-white rounded-lg border shadow-sm p-4">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="h-8 w-8 rounded-full bg-orange-50 flex items-center justify-center shrink-0">
                            <Briefcase className="h-4 w-4 text-orange-600" />
                        </div>
                        <h3 className="text-base font-semibold text-gray-900">Información Laboral</h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
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
                        <div className="space-y-1.5">
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
                        <div className="space-y-1.5 sm:col-span-2">
                            <Label className="text-gray-700">Fecha de Ingreso *</Label>
                            <Input type="date" value={formData.fecha_ingreso} onChange={(e) => setFormData({ ...formData, fecha_ingreso: e.target.value })} required className="bg-gray-50/50" />
                            {errors.fecha_ingreso && <p className="text-xs text-destructive">{errors.fecha_ingreso}</p>}
                        </div>
                    </div>
                </div>

                {/* Contact Info */}
                <div className="bg-white rounded-lg border shadow-sm p-4">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="h-8 w-8 rounded-full bg-green-50 flex items-center justify-center shrink-0">
                            <Phone className="h-4 w-4 text-green-600" />
                        </div>
                        <h3 className="text-base font-semibold text-gray-900">Información de Contacto</h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label className="text-gray-700">Teléfono</Label>
                            <Input value={formData.telefono} onChange={(e) => setFormData({ ...formData, telefono: e.target.value })} placeholder="Ej.: 42332492" className="bg-gray-50/50" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-gray-700">Celular</Label>
                            <Input value={formData.celular} onChange={(e) => setFormData({ ...formData, celular: e.target.value })} placeholder="Ej.: 1127486366" className="bg-gray-50/50" />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                            <Label className="text-gray-700">Email (opcional)</Label>
                            <Input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="Ej.: persona@empresa.com" className="bg-gray-50/50" />
                            {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
                        </div>
                    </div>
                </div>

                {/* Schedule Info */}
                <div className="bg-white rounded-lg border shadow-sm p-4">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="h-8 w-8 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
                            <Clock className="h-4 w-4 text-amber-600" />
                        </div>
                        <h3 className="text-base font-semibold text-gray-900">Horario de Trabajo</h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label className="text-gray-700">Hora de Inicio</Label>
                            <Input type="time" value={formData.hora_inicio} onChange={(e) => setFormData({ ...formData, hora_inicio: e.target.value })} className="bg-gray-50/50" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-gray-700">Hora de Fin</Label>
                            <Input type="time" value={formData.hora_fin} onChange={(e) => setFormData({ ...formData, hora_fin: e.target.value })} className="bg-gray-50/50" />
                        </div>

                        <div className="space-y-1.5 sm:col-span-2">
                            <Label className="text-gray-700">Días de Trabajo</Label>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { code: "MON", label: "Lun" },
                                    { code: "TUE", label: "Mar" },
                                    { code: "WED", label: "Mié" },
                                    { code: "THU", label: "Jue" },
                                    { code: "FRI", label: "Vie" },
                                    { code: "SAT", label: "Sáb" },
                                    { code: "SUN", label: "Dom" },
                                ].map(({ code, label }) => {
                                    const dias = formData.dias_trabajo.split(",").filter(Boolean);
                                    const activo = dias.includes(code);
                                    return (
                                        <button
                                            key={code}
                                            type="button"
                                            onClick={() => {
                                                const orden = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
                                                const next = activo
                                                    ? dias.filter((d) => d !== code)
                                                    : [...dias, code];
                                                const ordenado = orden.filter((d) => next.includes(d));
                                                setFormData({ ...formData, dias_trabajo: ordenado.join(",") });
                                            }}
                                            className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${activo
                                                ? "bg-amber-100 border-amber-300 text-amber-900"
                                                : "bg-gray-50/50 border-gray-200 text-gray-600 hover:bg-gray-100"
                                                }`}
                                        >
                                            {label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-gray-700">Desayuno (min)</Label>
                            <Input
                                type="number"
                                min={0}
                                max={240}
                                value={formData.min_desayuno}
                                onChange={(e) => setFormData({ ...formData, min_desayuno: Number(e.target.value || 0) })}
                                className="bg-gray-50/50"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-gray-700">Almuerzo (min)</Label>
                            <Input
                                type="number"
                                min={0}
                                max={240}
                                value={formData.min_almuerzo}
                                onChange={(e) => setFormData({ ...formData, min_almuerzo: Number(e.target.value || 0) })}
                                className="bg-gray-50/50"
                            />
                        </div>

                        {(() => {
                            const toMin = (h: string) => {
                                if (!h) return null;
                                const [hh, mm] = h.split(":").map(Number);
                                if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
                                return hh * 60 + mm;
                            };
                            const ini = toMin(formData.hora_inicio);
                            const fin = toMin(formData.hora_fin);
                            const dias = formData.dias_trabajo.split(",").filter(Boolean).length;
                            if (ini === null || fin === null || fin <= ini) {
                                return (
                                    <p className="text-xs text-destructive sm:col-span-2">
                                        Configurá una hora de inicio menor a la hora de fin.
                                    </p>
                                );
                            }
                            const reales = Math.max(
                                0,
                                fin - ini - (formData.min_desayuno || 0) - (formData.min_almuerzo || 0)
                            );
                            const hh = Math.floor(reales / 60);
                            const mm = reales % 60;
                            const semana = reales * dias;
                            const semHh = Math.floor(semana / 60);
                            const semMm = semana % 60;
                            return (
                                <p className="text-xs text-muted-foreground sm:col-span-2">
                                    Horas reales por día: <span className="font-semibold text-gray-800">{hh}h {mm.toString().padStart(2, "0")}min</span>
                                    {" · "}
                                    Total semanal: <span className="font-semibold text-gray-800">{semHh}h {semMm.toString().padStart(2, "0")}min</span>
                                    {" "}({dias} {dias === 1 ? "día" : "días"})
                                </p>
                            );
                        })()}

                        <p className="text-xs text-muted-foreground sm:col-span-2">
                            El planificador usará estos datos a partir de la próxima fase.
                        </p>
                    </div>
                </div>

                {/* Skills Info */}
                <div className="bg-white rounded-lg border shadow-sm p-4 md:col-span-2">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="h-8 w-8 rounded-full bg-purple-50 flex items-center justify-center shrink-0">
                            <Wrench className="h-4 w-4 text-purple-600" />
                        </div>
                        <h3 className="text-base font-semibold text-gray-900">Habilidades</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <Label className="text-gray-700">SKILLS 1</Label>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-7 text-xs"
                                        onClick={() => setPrimarySkills([...primarySkills, ""])}
                                    >
                                        + Añadir SKILLS 1
                                    </Button>
                                </div>
                                <div className="flex flex-col gap-3">
                                    {primarySkills.length === 0 && <p className="text-sm text-gray-500 italic">No hay SKILLS 1</p>}
                                    {primarySkills.map((skillId, idx) => (
                                        <div key={`param-${idx}`} className="flex gap-2 items-center">
                                            <Select value={skillId || "none"} onValueChange={(val) => handlePrimaryChange(idx, val)}>
                                                <SelectTrigger className="bg-gray-50/50 flex-1">
                                                    <SelectValue placeholder="Seleccionar" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">Seleccionar proceso</SelectItem>
                                                    {procesos.map(p => (
                                                        <SelectItem key={p.id} value={p.id.toString()}>{p.nombre}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-10 w-10 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                                                onClick={() => removePrimarySkill(idx)}
                                            >
                                                X
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                        </div>

                        <div>
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <Label className="text-gray-700">SKILLS 2</Label>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-7 text-xs"
                                        onClick={() => setSecondarySkills([...secondarySkills, ""])}
                                    >
                                        + Añadir SKILLS 2
                                    </Button>
                                </div>
                                <div className="flex flex-col gap-3">
                                    {secondarySkills.length === 0 && <p className="text-sm text-gray-500 italic">No hay SKILLS 2</p>}
                                    {secondarySkills.map((skillId, idx) => (
                                        <div key={`sec-${idx}`} className="flex gap-2 items-center">
                                            <Select value={skillId || "none"} onValueChange={(val) => handleSecondaryChange(idx, val)}>
                                                <SelectTrigger className="bg-gray-50/50 flex-1">
                                                    <SelectValue placeholder="Seleccionar habilidad" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">Seleccionar proceso</SelectItem>
                                                    {procesos.map(p => (
                                                        <SelectItem key={p.id} value={p.id.toString()}>{p.nombre}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-10 w-10 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                                                onClick={() => removeSecondarySkill(idx)}
                                            >
                                                X
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
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
