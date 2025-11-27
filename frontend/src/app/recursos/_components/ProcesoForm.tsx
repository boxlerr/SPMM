import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/toast";
import { Proceso } from "../_types";

interface ProcesoFormProps {
    open: boolean;
    editing: boolean;
    data: Proceso | null;
    onClose: () => void;
    onSuccess: () => void;
    cleanUrl: string;
}

export default function ProcesoForm({
    open,
    editing,
    data,
    onClose,
    onSuccess,
    cleanUrl,
}: ProcesoFormProps) {
    const { showToast } = useToast();
    const api = useApi();
    const [formData, setFormData] = useState<Partial<Proceso>>({
        nombre: "",
        descripcion: "",
    });

    useEffect(() => {
        if (editing && data) {
            setFormData({
                nombre: data.nombre,
                descripcion: data.descripcion || "",
            });
        } else {
            setFormData({
                nombre: "",
                descripcion: "",
            });
        }
    }, [editing, data, open]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.nombre) {
            showToast("El nombre es obligatorio", "error");
            return;
        }

        const url = editing
            ? `${cleanUrl}/procesos/${data?.id}`
            : `${cleanUrl}/procesos`;

        const method = editing ? "PUT" : "POST";

        const success = await api.executeOperation(url, method, formData);

        if (success) {
            showToast(
                `Proceso ${editing ? "actualizado" : "creado"} correctamente`,
                "success"
            );
            onSuccess();
        }
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>
                        {editing ? "Editar Proceso" : "Nuevo Proceso"}
                    </DialogTitle>
                    <DialogDescription>
                        {editing
                            ? "Modifica los datos del proceso aquí."
                            : "Ingresa los datos del nuevo proceso."}
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit}>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="nombre">Nombre</Label>
                            <Input
                                id="nombre"
                                value={formData.nombre}
                                onChange={(e) =>
                                    setFormData({ ...formData, nombre: e.target.value })
                                }
                                placeholder="Ej. Corte, Soldadura"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="descripcion">Descripción</Label>
                            <Textarea
                                id="descripcion"
                                value={formData.descripcion}
                                onChange={(e) =>
                                    setFormData({ ...formData, descripcion: e.target.value })
                                }
                                placeholder="Descripción del proceso..."
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={api.loading}>
                            {api.loading
                                ? "Guardando..."
                                : editing
                                    ? "Guardar Cambios"
                                    : "Crear Proceso"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
