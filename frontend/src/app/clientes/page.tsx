"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Pencil, Trash2, Users, Plus, RefreshCw, Search, MapPin, Mail, Phone, Smartphone, Building2, CreditCard } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useApi } from "@/hooks/useApi";
import { useToast } from "@/components/ui/toast";
import { Cliente } from "./_types";
import ClienteForm from "./_components/ClienteForm";

export default function ClientesPage() {
    const { showToast } = useToast();
    const api = useApi<any>();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const cleanUrl = apiUrl.replace(/\/$/, "");

    const [clientes, setClientes] = useState<Cliente[]>([]);
    const [busqueda, setBusqueda] = useState("");

    // States for modals
    const [mostrarCrearEditar, setMostrarCrearEditar] = useState(false);
    const [mostrarEliminar, setMostrarEliminar] = useState(false);

    const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null);

    useEffect(() => {
        fetchClientes();
    }, []);

    const fetchClientes = async () => {
        const data = await api.fetchData(`${cleanUrl}/clientes`);
        setClientes(data || []);
    };

    const handleCrear = () => {
        setClienteSeleccionado(null);
        setMostrarCrearEditar(true);
    };

    const handleEditar = (cliente: Cliente) => {
        setClienteSeleccionado(cliente);
        setMostrarCrearEditar(true);
    };

    const handleEliminar = (cliente: Cliente) => {
        setClienteSeleccionado(cliente);
        setMostrarEliminar(true);
    };

    const confirmarEliminar = async () => {
        if (!clienteSeleccionado) return;

        const success = await api.executeOperation(`${cleanUrl}/clientes/${clienteSeleccionado.id}`, "DELETE");
        if (success) {
            showToast(`Cliente ${clienteSeleccionado.nombre} eliminado correctamente`, 'success');
            setMostrarEliminar(false);
            setClienteSeleccionado(null);
            fetchClientes();
        }
    };

    const clientesFiltrados = clientes.filter(c =>
        c.nombre.toLowerCase().includes(busqueda.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-background p-4 md:p-6">
            <div className="mb-4 md:mb-6">
                <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-3 md:mb-4">
                    Administración de Clientes
                </h1>
                <div className="flex flex-col sm:flex-row gap-2">
                    <Button onClick={handleCrear} size="sm" className="w-full sm:w-auto bg-[#DC143C] hover:bg-[#B01030] text-white">
                        <Plus className="h-4 w-4 mr-2" />
                        Nuevo Cliente
                    </Button>
                    <Button
                        onClick={fetchClientes}
                        disabled={api.loading}
                        variant="outline"
                        size="sm"
                        className="w-full sm:w-auto"
                    >
                        <RefreshCw className={`h-4 w-4 mr-2 ${api.loading ? "animate-spin" : ""}`} />
                        Actualizar
                    </Button>
                </div>
            </div>

            {api.error && (
                <Alert variant="destructive" className="mb-4 md:mb-6">
                    <AlertDescription>{api.error}</AlertDescription>
                </Alert>
            )}

            <div className="rounded-lg border bg-card">
                <div className="p-4 md:p-6 border-b">
                    <div className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-muted-foreground" />
                        <h2 className="text-lg font-semibold">Listado de Clientes</h2>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">Gestión de cartera de clientes</p>
                </div>

                <div className="p-4 md:p-6 border-b bg-muted/20">
                    <div className="relative max-w-sm">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar cliente..."
                            value={busqueda}
                            onChange={(e) => setBusqueda(e.target.value)}
                            className="pl-8"
                        />
                    </div>
                </div>

                {api.loading && clientes.length === 0 && (
                    <div className="flex items-center justify-center py-12">
                        <Spinner className="h-8 w-8" />
                        <span className="ml-3 text-muted-foreground">Cargando clientes...</span>
                    </div>
                )}

                {!api.loading && clientesFiltrados.length === 0 && (
                    <div className="py-12 text-center text-muted-foreground">
                        <p className="text-lg">No se encontraron clientes</p>
                    </div>
                )}

                {!api.loading && clientesFiltrados.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="border-b bg-muted/50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">Cliente</th>
                                    <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground hidden md:table-cell">Identificación</th>
                                    <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground hidden lg:table-cell">Ubicación</th>
                                    <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground hidden xl:table-cell">Contacto</th>
                                    <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground hidden 2xl:table-cell">Observaciones</th>
                                    <th className="px-6 py-3 text-right text-sm font-medium text-muted-foreground">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {clientesFiltrados.map((cliente) => (
                                    <tr key={cliente.id} className="hover:bg-muted/50 transition-colors group">
                                        <td className="px-6 py-4 text-sm font-medium">
                                            <div className="flex flex-col">
                                                <span className="font-semibold text-base">{cliente.nombre}</span>
                                                {cliente.fantasia && (
                                                    <span className="text-xs text-muted-foreground mt-0.5">
                                                        {cliente.fantasia}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm hidden md:table-cell">
                                            <div className="flex flex-col gap-1.5 item-start">
                                                {cliente.cuit && (
                                                    <div className="flex items-center gap-1.5 bg-muted px-2 py-1 rounded text-xs font-mono text-foreground/80 w-fit">
                                                        <CreditCard className="h-3 w-3 text-muted-foreground" />
                                                        {cliente.cuit}
                                                    </div>
                                                )}
                                                {cliente.abreviatura && (
                                                    <span className="text-xs font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full w-fit">
                                                        {cliente.abreviatura}
                                                    </span>
                                                )}
                                                {!cliente.cuit && !cliente.abreviatura && <span className="text-xs text-muted-foreground">-</span>}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm hidden lg:table-cell">
                                            <div className="flex items-start gap-2 max-w-[250px]">
                                                {(cliente.direccion || cliente.localidad) ? (
                                                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                                ) : <span className="text-xs text-muted-foreground ml-1">-</span>}

                                                <div className="flex flex-col">
                                                    {cliente.direccion && <span className="text-sm">{cliente.direccion}</span>}
                                                    {cliente.localidad && <span className="text-xs text-muted-foreground">{cliente.localidad}</span>}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm hidden xl:table-cell">
                                            <div className="flex flex-col gap-1.5">
                                                {cliente.mail && (
                                                    <div className="flex items-center gap-2 text-xs">
                                                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                                                        <a href={`mailto:${cliente.mail}`} className="hover:underline hover:text-primary transition-colors">
                                                            {cliente.mail}
                                                        </a>
                                                    </div>
                                                )}
                                                {(cliente.celular) && (
                                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                        <Smartphone className="h-3.5 w-3.5" />
                                                        <span>{cliente.celular}</span>
                                                    </div>
                                                )}
                                                {(cliente.telefono) && (
                                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                        <Phone className="h-3.5 w-3.5" />
                                                        <span>{cliente.telefono}</span>
                                                    </div>
                                                )}

                                                {!cliente.mail && !cliente.celular && !cliente.telefono && <span className="text-xs text-muted-foreground ml-1">-</span>}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm hidden 2xl:table-cell max-w-[200px]">
                                            {cliente.obs ? (
                                                <p className="text-xs text-muted-foreground line-clamp-2" title={cliente.obs}>
                                                    {cliente.obs}
                                                </p>
                                            ) : (
                                                <span className="text-xs text-muted-foreground">-</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex justify-end gap-2">
                                                <Button variant="ghost" size="icon" onClick={() => handleEditar(cliente)} className="h-8 w-8">
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleEliminar(cliente)}
                                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal Crear/Editar */}
            <ClienteForm
                open={mostrarCrearEditar}
                onClose={() => setMostrarCrearEditar(false)}
                onSuccess={() => {
                    setMostrarCrearEditar(false);
                    fetchClientes();
                }}
                cliente={clienteSeleccionado}
            />

            {/* Dialogo Eliminar */}
            <Dialog open={mostrarEliminar} onOpenChange={setMostrarEliminar}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Confirmar Eliminación</DialogTitle>
                        <DialogDescription>
                            ¿Estás seguro de que deseas eliminar al cliente <strong>{clienteSeleccionado?.nombre}</strong>? Esta acción no se puede deshacer.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setMostrarEliminar(false)}>Cancelar</Button>
                        <Button variant="destructive" onClick={confirmarEliminar}>Eliminar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
