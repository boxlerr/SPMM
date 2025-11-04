"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Eye, Pencil, Trash2, User, RefreshCw, Plus, Activity, Phone } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import OperarioForm from "./_components/OperarioForm";
import MaquinaForm from "./_components/MaquinaForm";
import DetalleOperario from "./_components/DetalleOperario";
import DetalleMaquina from "./_components/DetalleMaquina";
import CambiarEstado from "./_components/CambiarEstado";
import { Operario, Maquina } from "./_types";

export default function RecursosPage() {
  const [tabActiva, setTabActiva] = useState<"operarios" | "maquinas">("operarios");
  const [operarios, setOperarios] = useState<Operario[]>([]);
  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  const [operarioSeleccionado, setOperarioSeleccionado] = useState<Operario | null>(null);
  const [maquinaSeleccionada, setMaquinaSeleccionada] = useState<Maquina | null>(null);
  const [mostrarDialogo, setMostrarDialogo] = useState({
    eliminar: false,
    crear: false,
    editar: false,
    cambiarEstado: false,
  });
  const [itemAEliminar, setItemAEliminar] = useState<{ tipo: "operario" | "maquina"; id: number; nombre: string } | null>(null);
  const [itemAEditar, setItemAEditar] = useState<Operario | Maquina | null>(null);
  const [operarioCambiarEstado, setOperarioCambiarEstado] = useState<Operario | null>(null);

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const cleanUrl = apiUrl.replace(/\/$/, "");
  const api = useApi<any>();

  useEffect(() => {
    if (tabActiva === "operarios") {
      fetchOperarios();
      } else {
      fetchMaquinas();
    }
  }, [tabActiva]);

  const fetchOperarios = async () => {
    const data = await api.fetchData(`${cleanUrl}/operarios`);
    setOperarios(data);
  };

  const fetchMaquinas = async () => {
    const data = await api.fetchData(`${cleanUrl}/maquinarias`);
    setMaquinas(data);
  };

  const handleVerOperario = async (operario: Operario) => {
    try {
      const response = await fetch(`${cleanUrl}/operarios/${operario.id}`);
      if (response.ok) {
        const data = await response.json();
        setOperarioSeleccionado(data.data || operario);
        } else {
        setOperarioSeleccionado(operario);
      }
    } catch {
      setOperarioSeleccionado(operario);
    }
  };

  const handleVerMaquina = async (maquina: Maquina) => {
    try {
      const response = await fetch(`${cleanUrl}/maquinarias/${maquina.id}`);
      if (response.ok) {
        const data = await response.json();
        setMaquinaSeleccionada(data.data || maquina);
      } else {
        setMaquinaSeleccionada(maquina);
      }
    } catch {
      setMaquinaSeleccionada(maquina);
    }
  };

  const handleEditar = async (tipo: "operario" | "maquina", item: Operario | Maquina) => {
    setItemAEditar(item);
    setMostrarDialogo({ ...mostrarDialogo, editar: true });
  };

  const handleEliminar = async () => {
    if (!itemAEliminar) return;

    const url = itemAEliminar.tipo === "operario"
      ? `${cleanUrl}/operarios/${itemAEliminar.id}`
      : `${cleanUrl}/maquinarias/${itemAEliminar.id}`;

    const success = await api.executeOperation(url, "DELETE");
    if (success) {
      if (itemAEliminar.tipo === "operario") {
        await fetchOperarios();
      } else {
        await fetchMaquinas();
      }
    }
    setMostrarDialogo({ ...mostrarDialogo, eliminar: false });
    setItemAEliminar(null);
  };

  const handleAbrirCrear = () => {
    setItemAEditar(null);
    setMostrarDialogo({ ...mostrarDialogo, crear: true });
  };

  const handleCambiarEstado = (operario: Operario) => {
    setOperarioCambiarEstado(operario);
    setMostrarDialogo({ ...mostrarDialogo, cambiarEstado: true });
  };

  const getEstadoColor = (disponible?: boolean) => {
    return disponible
      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
  };

  const formatPhone = (value?: string) => {
    if (!value) return "";
    return value.replace(/\D/g, "");
  };

  const capitalizeName = (text?: string) => {
    if (!text) return "";
    return text
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold text-foreground">Administración de Recursos</h1>
        <div className="flex gap-2">
            <Button onClick={handleAbrirCrear} size="sm">
              <Plus className="h-4 w-4 mr-2" />
            {tabActiva === "operarios" ? "Nuevo Operario" : "Nueva Maquinaria"}
            </Button>
          <Button
            onClick={tabActiva === "operarios" ? fetchOperarios : fetchMaquinas}
            disabled={api.loading}
            variant="outline"
            size="sm"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${api.loading ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>
      </div>

      {api.error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{api.error}</AlertDescription>
        </Alert>
      )}

      <div className="mb-6 flex gap-2">
        <Button
          variant={tabActiva === "operarios" ? "default" : "outline"}
          onClick={() => setTabActiva("operarios")}
          className="flex-1"
        >
          Operarios
        </Button>
        <Button
          variant={tabActiva === "maquinas" ? "default" : "outline"}
          onClick={() => setTabActiva("maquinas")}
          className="flex-1"
        >
          Máquinas
        </Button>
      </div>

      {/* TABLA DE OPERARIOS */}
      {tabActiva === "operarios" && (
        <div className="rounded-lg border bg-card">
          <div className="p-6 border-b">
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Operarios</h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Gestión de personal operativo</p>
          </div>

          {api.loading && (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-8 w-8" />
              <span className="ml-3 text-muted-foreground">Cargando operarios...</span>
            </div>
          )}

          {!api.loading && operarios.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-lg">No hay operarios disponibles</p>
            </div>
          )}

          {!api.loading && operarios.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">Nombre</th>
                    <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">Rango</th>
                    <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">Sector</th>
                    <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">Teléfono</th>
                    <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">Estado</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-muted-foreground">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {operarios.map((operario) => (
                    <tr key={operario.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium">
                        {capitalizeName(operario.nombre)} {capitalizeName(operario.apellido)}
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant="secondary" className="text-xs">{operario.categoria}</Badge>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant="secondary" className="text-xs">{operario.sector}</Badge>
                      </td>
                      <td className="px-6 py-4 text-sm">{formatPhone(operario.celular) || formatPhone(operario.telefono) || "-"}</td>
                      <td className="px-6 py-4">
                        <Badge className={getEstadoColor(operario.disponible)}>
                          {operario.disponible ? "Activo" : "Ausente"}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleVerOperario(operario)} className="h-8 w-8">
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleEditar("operario", operario)} className="h-8 w-8">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setItemAEliminar({ tipo: "operario", id: operario.id, nombre: `${capitalizeName(operario.nombre)} ${capitalizeName(operario.apellido)}` });
                              setMostrarDialogo({ ...mostrarDialogo, eliminar: true });
                            }}
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
      )}

      {/* TABLA DE MAQUINAS */}
      {tabActiva === "maquinas" && (
        <div className="rounded-lg border bg-card">
          <div className="p-6 border-b">
            <div className="flex items-center gap-2">
              <svg className="h-5 w-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <h2 className="text-lg font-semibold">Máquinas y Equipos</h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Gestión de maquinaria industrial</p>
          </div>

          {api.loading && (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-8 w-8" />
              <span className="ml-3 text-muted-foreground">Cargando maquinarias...</span>
            </div>
          )}

          {!api.loading && maquinas.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-lg">No hay maquinarias disponibles</p>
            </div>
          )}

          {!api.loading && maquinas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b bg-muted/50">
                <tr>
                    <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">Nombre</th>
                    <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">Código</th>
                    <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">Especialidad</th>
                    <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">Capacidad</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-muted-foreground">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {maquinas.map((maquina) => (
                    <tr key={maquina.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium">{maquina.nombre}</td>
                      <td className="px-6 py-4 text-sm">{maquina.cod_maquina || "-"}</td>
                      <td className="px-6 py-4 text-sm">{maquina.especialidad || "-"}</td>
                      <td className="px-6 py-4 text-sm">{maquina.capacidad || "-"}</td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleVerMaquina(maquina)} className="h-8 w-8">
                          <Eye className="h-4 w-4" />
                        </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleEditar("maquina", maquina)} className="h-8 w-8">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                            onClick={() => {
                              setItemAEliminar({ tipo: "maquina", id: maquina.id, nombre: maquina.nombre });
                              setMostrarDialogo({ ...mostrarDialogo, eliminar: true });
                            }}
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
      )}

      {/* DIÁLOGOS */}
      <Dialog open={mostrarDialogo.eliminar} onOpenChange={(open) => setMostrarDialogo({ ...mostrarDialogo, eliminar: open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Eliminación</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas eliminar <strong>{itemAEliminar?.nombre}</strong>? Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMostrarDialogo({ ...mostrarDialogo, eliminar: false })}>Cancelar</Button>
            <Button variant="destructive" onClick={handleEliminar}>Eliminar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OperarioForm
        open={(mostrarDialogo.crear || mostrarDialogo.editar) && tabActiva === "operarios"}
        editing={!!mostrarDialogo.editar}
        data={itemAEditar as Operario}
        onClose={() => setMostrarDialogo({ ...mostrarDialogo, crear: false, editar: false })}
        onSuccess={async () => {
          await fetchOperarios();
          setMostrarDialogo({ ...mostrarDialogo, crear: false, editar: false });
        }}
        cleanUrl={cleanUrl}
      />

      <MaquinaForm
        open={(mostrarDialogo.crear || mostrarDialogo.editar) && tabActiva === "maquinas"}
        editing={!!mostrarDialogo.editar}
        data={itemAEditar as Maquina}
        onClose={() => setMostrarDialogo({ ...mostrarDialogo, crear: false, editar: false })}
        onSuccess={async () => {
          await fetchMaquinas();
          setMostrarDialogo({ ...mostrarDialogo, crear: false, editar: false });
        }}
        cleanUrl={cleanUrl}
      />

      <DetalleOperario
        operario={operarioSeleccionado}
        onClose={() => setOperarioSeleccionado(null)}
        onCambiarEstado={(operario: Operario) => handleCambiarEstado(operario)}
      />

      <DetalleMaquina maquina={maquinaSeleccionada} onClose={() => setMaquinaSeleccionada(null)} />

      <CambiarEstado
        operario={operarioCambiarEstado as Operario}
        open={mostrarDialogo.cambiarEstado}
        onClose={() => setMostrarDialogo({ ...mostrarDialogo, cambiarEstado: false })}
        onSuccess={async () => {
          await fetchOperarios();
          setMostrarDialogo({ ...mostrarDialogo, cambiarEstado: false });
        }}
        cleanUrl={cleanUrl}
      />
    </div>
  );
}
