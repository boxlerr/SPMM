"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Eye, Pencil, Trash2, User, RefreshCw, Plus, Factory, Phone, Layers, Search } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import OperarioForm from "./_components/OperarioForm";
import MaquinaForm from "./_components/MaquinaForm";
import ProcesoForm from "./_components/ProcesoForm";
import DetalleOperario from "./_components/DetalleOperario";
import DetalleMaquina from "./_components/DetalleMaquina";
import CambiarEstado from "./_components/CambiarEstado";
import { Operario, Maquina, Proceso } from "./_types";
import { useNotifications } from "@/contexts/NotificationContext";
import { useToast } from "@/components/ui/toast";
import { PlanificacionItem } from "@/lib/types";
import { API_URL } from "@/config"
import { SharedOperatorsList } from "@/components/resources/SharedOperatorsList";

const getAuthHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('access_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};;

export default function RecursosPage() {
  const { addNotification } = useNotifications();
  const { showToast } = useToast();

  const [tabActiva, setTabActiva] = useState<"operarios" | "maquinas" | "procesos">("operarios");
  const [operarios, setOperarios] = useState<Operario[]>([]);
  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  const [procesos, setProcesos] = useState<Proceso[]>([]);

  const [busquedaProceso, setBusquedaProceso] = useState("");

  // Pagination for Processes
  const ITEMS_PER_PAGE = 20;
  const [currentProcesosPage, setCurrentProcesosPage] = useState(1);

  // Reset page on search
  useEffect(() => {
    setCurrentProcesosPage(1);
  }, [busquedaProceso]);
  const [operarioSeleccionado, setOperarioSeleccionado] = useState<Operario | null>(null);
  const [maquinaSeleccionada, setMaquinaSeleccionada] = useState<Maquina | null>(null);
  const [mostrarDialogo, setMostrarDialogo] = useState({
    eliminar: false,
    crear: false,
    editar: false,
    cambiarEstado: false,
  });
  const [itemAEliminar, setItemAEliminar] = useState<{ tipo: "operario" | "maquina" | "proceso"; id: number; nombre: string } | null>(null);
  const [itemAEditar, setItemAEditar] = useState<Operario | Maquina | Proceso | null>(null);
  const [operarioCambiarEstado, setOperarioCambiarEstado] = useState<Operario | null>(null);

  // State for assigned tasks
  const [tasks, setTasks] = useState<PlanificacionItem[]>([]);
  const [operatorTasks, setOperatorTasks] = useState<PlanificacionItem[]>([]);

  const apiUrl = API_URL;
  const cleanUrl = apiUrl.replace(/\/$/, "");
  const api = useApi<any>();

  useEffect(() => {
    if (tabActiva === "operarios") {
      fetchOperarios();
    } else if (tabActiva === "maquinas") {
      fetchMaquinas();
    } else {
      fetchProcesos();
    }
  }, [tabActiva]);

  const fetchOperarios = async () => {
    const data = await api.fetchData(`${cleanUrl}/operarios`);
    const filtered = data.filter((op: Operario) => op.sector?.toUpperCase() !== "PRUEBAS");
    setOperarios(filtered);
  };

  const fetchMaquinas = async () => {
    const data = await api.fetchData(`${cleanUrl}/maquinarias`);
    setMaquinas(data);
  };

  const fetchProcesos = async () => {
    const data = await api.fetchData(`${cleanUrl}/procesos`);
    setProcesos(data);
  };

  const handleVerOperario = async (operario: Operario) => {
    try {
      // Optimistic / Cache: Show existing tasks immediately or clear stale data
      if (tasks.length > 0) {
        setOperatorTasks(tasks.filter(t => t.id_operario === operario.id));
      } else {
        setOperatorTasks([]);
      }

      // 1. Fetch Operario Details
      const response = await fetch(`${cleanUrl}/operarios/${operario.id}`, { headers: getAuthHeaders() });
      if (response.ok) {
        const data = await response.json();
        setOperarioSeleccionado(data.data || operario);
      } else {
        setOperarioSeleccionado(operario);
      }

      // 2. Fetch Assigned Tasks (Background refresh)
      const planResponse = await fetch(`${cleanUrl}/planificacion`, { headers: getAuthHeaders() });
      if (planResponse.ok) {
        const planData: PlanificacionItem[] = await planResponse.json();
        setTasks(planData);
        // Filter for this operator
        const assigned = planData.filter(t => t.id_operario === operario.id);
        setOperatorTasks(assigned);
      }

    } catch (e) {
      console.error("Error loading operator details:", e);
      setOperarioSeleccionado(operario);
    }
  };

  const handleVerMaquina = async (maquina: Maquina) => {
    try {
      const response = await fetch(`${cleanUrl}/maquinarias/${maquina.id}`, { headers: getAuthHeaders() });
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

  const handleEditar = async (tipo: "operario" | "maquina" | "proceso", item: Operario | Maquina | Proceso) => {
    setItemAEditar(item);
    setMostrarDialogo({ ...mostrarDialogo, editar: true });
  };

  const handleEliminar = async () => {
    if (!itemAEliminar) return;

    const url = itemAEliminar.tipo === "operario"
      ? `${cleanUrl}/operarios/${itemAEliminar.id}`
      : itemAEliminar.tipo === "maquina"
        ? `${cleanUrl}/maquinarias/${itemAEliminar.id}`
        : `${cleanUrl}/procesos/${itemAEliminar.id}`;

    const success = await api.executeOperation(url, "DELETE");
    if (success) {
      if (itemAEliminar.tipo === "operario") {
        addNotification(
          `Operario ${itemAEliminar.nombre} ha sido eliminado`,
          "operario_deleted"
        );
        showToast(`Operario ${itemAEliminar.nombre} eliminado correctamente`, 'success');
        await fetchOperarios();
      } else if (itemAEliminar.tipo === "maquina") {
        showToast(`Máquina ${itemAEliminar.nombre} eliminada correctamente`, 'success');
        await fetchMaquinas();
      } else {
        showToast(`Proceso ${itemAEliminar.nombre} eliminado correctamente`, 'success');
        await fetchProcesos();
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

  const procesosFiltrados = procesos.filter(p =>
    p.nombre.toLowerCase().includes(busquedaProceso.toLowerCase())
  );

  const totalProcesosPages = Math.ceil(procesosFiltrados.length / ITEMS_PER_PAGE);
  const paginatedProcesos = procesosFiltrados.slice(
    (currentProcesosPage - 1) * ITEMS_PER_PAGE,
    currentProcesosPage * ITEMS_PER_PAGE
  );

  const handleProcesosPrevious = () => {
    if (currentProcesosPage > 1) setCurrentProcesosPage(p => p - 1);
  };

  const handleProcesosNext = () => {
    if (currentProcesosPage < totalProcesosPages) setCurrentProcesosPage(p => p + 1);
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mb-4 md:mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-3 md:mb-4">
          Administración de Recursos
        </h1>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button onClick={handleAbrirCrear} size="sm" className="w-full sm:w-auto bg-[#DC143C] hover:bg-[#B01030] text-white">
            <Plus className="h-4 w-4 mr-2" />
            {tabActiva === "operarios" ? "Nuevo Operario" : tabActiva === "maquinas" ? "Nueva Maquinaria" : "Nuevo Proceso"}
          </Button>
          <Button
            onClick={tabActiva === "operarios" ? fetchOperarios : tabActiva === "maquinas" ? fetchMaquinas : fetchProcesos}
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

      <div className="mb-4 md:mb-6 flex gap-2">
        <Button
          variant={tabActiva === "operarios" ? "default" : "outline"}
          onClick={() => setTabActiva("operarios")}
          className={`flex-1 ${tabActiva === "operarios" ? "bg-[#DC143C] hover:bg-[#B01030] text-white" : ""}`}
        >
          <User className="h-4 w-4 sm:mr-2" />
          <span className="hidden xs:inline">Operarios</span>
        </Button>
        <Button
          variant={tabActiva === "maquinas" ? "default" : "outline"}
          onClick={() => setTabActiva("maquinas")}
          className={`flex-1 ${tabActiva === "maquinas" ? "bg-[#DC143C] hover:bg-[#B01030] text-white" : ""}`}
        >
          <Factory className="h-4 w-4 sm:mr-2" />
          <span className="hidden xs:inline">Máquinas</span>
        </Button>
        <Button
          variant={tabActiva === "procesos" ? "default" : "outline"}
          onClick={() => setTabActiva("procesos")}
          className={`flex-1 ${tabActiva === "procesos" ? "bg-[#DC143C] hover:bg-[#B01030] text-white" : ""}`}
        >
          <Layers className="h-4 w-4 sm:mr-2" />
          <span className="hidden xs:inline">Procesos</span>
        </Button>
      </div>

      {/* TABLA DE OPERARIOS */}
      {tabActiva === "operarios" && (
        <div className="rounded-lg border bg-card">
          <div className="p-4 md:p-6 border-b">
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Operarios</h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Gestión de personal operativo</p>
          </div>

          <SharedOperatorsList
            operarios={operarios}
            isLoading={api.loading}
            onView={handleVerOperario}
            onDelete={(op) => {
              setItemAEliminar({ tipo: "operario", id: op.id, nombre: `${op.nombre} ${op.apellido}` });
              setMostrarDialogo({ ...mostrarDialogo, eliminar: true });
            }}
          />
        </div>
      )}

      {/* TABLA DE MAQUINAS */}
      {tabActiva === "maquinas" && (
        <div className="rounded-lg border bg-card">
          <div className="p-4 md:p-6 border-b">
            <div className="flex items-center gap-2">
              <Factory className="h-5 w-5 text-muted-foreground" />
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
            <>
              {/* Vista Desktop - Tabla */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">Nombre</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">Código</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">Limitación</th>
                      <th className="px-6 py-3 text-right text-sm font-medium text-muted-foreground">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {maquinas.map((maquina) => (
                      <tr key={maquina.id} className="hover:bg-muted/50 transition-colors">
                        <td className="px-6 py-4 text-sm font-medium">{maquina.nombre}</td>
                        <td className="px-6 py-4 text-sm">{maquina.cod_maquina || "-"}</td>
                        <td className="px-6 py-4 text-sm">
                          {maquina.limitacion ? (
                            maquina.limitacion
                          ) : (
                            <span className="text-muted-foreground text-xs italic">Sin limitación</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex justify-end gap-2">
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

              {/* Vista Mobile - Tarjetas */}
              <div className="md:hidden divide-y">
                {maquinas.map((maquina) => (
                  <div key={maquina.id} className="p-4 hover:bg-muted/50 transition-colors">
                    <div className="mb-3">
                      <h3 className="font-semibold text-base mb-2">{maquina.nombre}</h3>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Código:</span>
                          <span className="ml-2 font-medium">{maquina.cod_maquina || "-"}</span>
                        </div>
                      </div>
                      <div className="mt-2 text-sm">
                        <span className="text-muted-foreground">Limitación:</span>
                        <span className="ml-2 font-medium">
                          {maquina.limitacion || <span className="text-muted-foreground text-xs italic">Sin limitación</span>}
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-2">

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEditar("maquina", maquina)}
                        className="flex-1"
                      >
                        <Pencil className="h-4 w-4 mr-1" />
                        Editar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setItemAEliminar({ tipo: "maquina", id: maquina.id, nombre: maquina.nombre });
                          setMostrarDialogo({ ...mostrarDialogo, eliminar: true });
                        }}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* TABLA DE PROCESOS */}
      {tabActiva === "procesos" && (
        <div className="rounded-lg border bg-card">
          <div className="p-4 md:p-6 border-b">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Procesos</h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Gestión de procesos productivos</p>
          </div>

          <div className="p-4 md:p-6 border-b bg-muted/20">
            <div className="relative max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar proceso..."
                value={busquedaProceso}
                onChange={(e) => setBusquedaProceso(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>

          {api.loading && (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-8 w-8" />
              <span className="ml-3 text-muted-foreground">Cargando procesos...</span>
            </div>
          )}

          {!api.loading && procesosFiltrados.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-lg">No se encontraron procesos</p>
            </div>
          )}

          {!api.loading && procesosFiltrados.length > 0 && (
            <>
              {/* Vista Desktop - Tabla */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">Nombre</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-muted-foreground">Descripción</th>
                      <th className="px-6 py-3 text-right text-sm font-medium text-muted-foreground">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {paginatedProcesos.map((proceso) => (
                      <tr key={proceso.id} className="hover:bg-muted/50 transition-colors">
                        <td className="px-6 py-4 text-sm font-medium">{proceso.nombre}</td>
                        <td className="px-6 py-4 text-sm">{proceso.descripcion || "-"}</td>
                        <td className="px-6 py-4">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="icon" onClick={() => handleEditar("proceso", proceso)} className="h-8 w-8">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setItemAEliminar({ tipo: "proceso", id: proceso.id, nombre: proceso.nombre });
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

              {/* Vista Mobile - Tarjetas */}
              <div className="md:hidden divide-y">
                {paginatedProcesos.map((proceso) => (
                  <div key={proceso.id} className="p-4 hover:bg-muted/50 transition-colors">
                    <div className="mb-3">
                      <h3 className="font-semibold text-base mb-2">{proceso.nombre}</h3>
                      {proceso.descripcion && (
                        <div className="text-sm text-muted-foreground">
                          {proceso.descripcion}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEditar("proceso", proceso)}
                        className="flex-1"
                      >
                        <Pencil className="h-4 w-4 mr-1" />
                        Editar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setItemAEliminar({ tipo: "proceso", id: proceso.id, nombre: proceso.nombre });
                          setMostrarDialogo({ ...mostrarDialogo, eliminar: true });
                        }}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {/* Pagination Controls */}
          {!api.loading && totalProcesosPages > 1 && (
            <div className="flex items-center justify-center gap-4 py-4 border-t">
              <Button
                onClick={handleProcesosPrevious}
                disabled={currentProcesosPage === 1}
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-full border-gray-300 hover:text-red-600 hover:border-red-300 disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
              </Button>
              <span className="text-sm font-medium text-gray-600">
                Página {currentProcesosPage} de {totalProcesosPages}
              </span>
              <Button
                onClick={handleProcesosNext}
                disabled={currentProcesosPage === totalProcesosPages}
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-full border-gray-300 hover:text-red-600 hover:border-red-300 disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
              </Button>
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

      <ProcesoForm
        open={(mostrarDialogo.crear || mostrarDialogo.editar) && tabActiva === "procesos"}
        editing={!!mostrarDialogo.editar}
        data={itemAEditar as Proceso}
        onClose={() => setMostrarDialogo({ ...mostrarDialogo, crear: false, editar: false })}
        onSuccess={async () => {
          await fetchProcesos();
          setMostrarDialogo({ ...mostrarDialogo, crear: false, editar: false });
        }}
        cleanUrl={cleanUrl}
      />

      <DetalleOperario
        key={operarioSeleccionado?.id}
        operario={operarioSeleccionado}
        tasks={operatorTasks}
        onClose={() => setOperarioSeleccionado(null)}
        onCambiarEstado={(operario: Operario) => handleCambiarEstado(operario)}
        onOperatorUpdated={() => {
          fetchOperarios();
          if (operarioSeleccionado) handleVerOperario(operarioSeleccionado);
        }}
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
