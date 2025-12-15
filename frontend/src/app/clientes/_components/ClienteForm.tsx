import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/toast";
import { Cliente } from "../_types";

const formSchema = z.object({
    nombre: z.string().min(1, "El nombre es obligatorio").max(100, "El nombre no puede exceder los 100 caracteres"),
    direccion: z.string().optional(),
    cuit: z.string().optional(),
    telefono: z.string().optional(),
    celular: z.string().optional(),
    localidad: z.string().optional(),
    mail: z.string().email("Email inválido").optional().or(z.literal("")),
    web: z.string().optional(),
    obs: z.string().optional(),
    fantasia: z.string().optional(),
    abreviatura: z.string().optional(),
});

interface ClienteFormProps {
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
    cliente?: Cliente | null;
}

export default function ClienteForm({ open, onClose, onSuccess, cliente }: ClienteFormProps) {
    const { showToast } = useToast();
    const api = useApi();
    const isEditing = !!cliente;

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            nombre: "",
            direccion: "",
            cuit: "",
            telefono: "",
            celular: "",
            localidad: "",
            mail: "",
            web: "",
            obs: "",
            fantasia: "",
            abreviatura: "",
        },
    });

    useEffect(() => {
        if (cliente) {
            form.reset({
                nombre: cliente.nombre,
                direccion: cliente.direccion || "",
                cuit: cliente.cuit || "",
                telefono: cliente.telefono || "",
                celular: cliente.celular || "",
                localidad: cliente.localidad || "",
                mail: cliente.mail || "",
                web: cliente.web || "",
                obs: cliente.obs || "",
                fantasia: cliente.fantasia || "",
                abreviatura: cliente.abreviatura || "",
            });
        } else {
            form.reset({
                nombre: "",
                direccion: "",
                cuit: "",
                telefono: "",
                celular: "",
                localidad: "",
                mail: "",
                web: "",
                obs: "",
                fantasia: "",
                abreviatura: "",
            });
        }
    }, [cliente, form, open]);

    const onSubmit = async (values: z.infer<typeof formSchema>) => {
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
            const cleanUrl = apiUrl.replace(/\/$/, "");

            const url = cliente
                ? `${cleanUrl}/clientes/${cliente.id}`
                : `${cleanUrl}/clientes`;

            const method = cliente ? "PUT" : "POST";

            const success = await api.executeOperation(url, method, values);

            if (success) {
                showToast(
                    isEditing ? "Cliente actualizado correctamente" : "Cliente creado correctamente",
                    "success"
                );
                onSuccess();
            }
        } catch (error) {
            console.error("Error saving cliente:", error);
            showToast("Error al guardar el cliente", "error");
        }
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[700px] bg-white max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isEditing ? "Editar Cliente" : "Nuevo Cliente"}</DialogTitle>
                    <DialogDescription>
                        {isEditing ? "Actualiza los datos del cliente aquí." : "Ingresa los datos del nuevo cliente."}
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="nombre"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Razón Social / Nombre</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Nombre del cliente" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="fantasia"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Nombre Fantasía</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Nombre fantasía" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="cuit"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>CUIT</FormLabel>
                                        <FormControl>
                                            <Input placeholder="CUIT" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="abreviatura"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Abreviatura</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Abreviatura" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="direccion"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Dirección</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Dirección completa" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="localidad"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Localidad</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Localidad" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="mail"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Email</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Email de contacto" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="telefono"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Teléfono</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Teléfono fijo" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="celular"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Celular</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Celular / WhatsApp" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="web"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Sitio Web</FormLabel>
                                    <FormControl>
                                        <Input placeholder="https://..." {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="obs"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Observaciones</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Notas adicionales..." {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={onClose} disabled={api.loading}>
                                Cancelar
                            </Button>
                            <Button type="submit" className="bg-[#DC143C] hover:bg-[#B01030] text-white" disabled={api.loading}>
                                {api.loading ? "Guardando..." : isEditing ? "Actualizar" : "Crear"}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
