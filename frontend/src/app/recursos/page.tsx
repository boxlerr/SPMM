"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Eye, Pencil, Trash2, User, RefreshCw, Plus, Factory, Phone, Layers, Search, Target, MapPin, AlertTriangle } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import OperarioForm from "./_components/OperarioForm";
import MaquinaForm from "./_components/MaquinaForm";
import ProcesoForm from "./_components/ProcesoForm";
import CatalogoSimple from "./_components/CatalogoSimple";
import RangoComposicion from "./_components/RangoComposicion";
import DetalleOperario from "./_components/DetalleOperario";
import DetalleMaquina from "./_components/DetalleMaquina";
import CambiarEstado from "./_components/CambiarEstado";
import { Operario, Maquina, Proceso } from "./_types";
import { useNotifications } from "@/contexts/NotificationContext";
import { useToast } from "@/components/ui/toast";
import { PlanificacionItem } from "@/lib/types";
import { API_URL } from "@/config"
import { SharedOperatorsList } from "@/components/resources/SharedOperatorsList";
import { useCoberturaRangos, problemaDelProceso } from "@/hooks/useCoberturaRangos";
import EditorRangosDe from "./_components/EditorRangosDe";

const getAuthHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('access_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};;

export default function RecursosPage() {
  const { addNotification } = useNotifications();
  const { showToast } = useToast();

  // Qué rangos tiene cada máquina y qué máquinas habilita cada rango. Los huecos
  // (máquina sin rango, rango sin máquinas o sin gente) no se veían en ninguna
  // pantalla y salían a la luz recién cuando el plan quedaba raro.
  const {
    listo: coberturaListo, rangosPorMaquina, porRango, porProceso,
    catalogoRangos, recargar: recargarCobertura,
  } = useCoberturaRangos();

  // Fila desplegada para editar rangos (una por vez, como en la pestaña Rangos).
  const [maquinaAbierta, setMaquinaAbierta] = useState<number | null>(null);
  const [procesoAbierto, setProcesoAbierto] = useState<number | null>(null);
  // Filtro de la pestaña Procesos: el catálogo tiene 414 y los que traen problema son
  // unas decenas. Sin esto hay que buscarlos a ojo entre todos.
  const [soloProblemas, setSoloProblemas] = useState(false);

  const [tabActiva, setTabActiva] = useState<"operarios" | "maquinas" | "procesos" | "rangos" | "sectores">("operarios");
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

  /**
   * `?tab=procesos&foco=123&q=plegado` — entrar directo a lo que hay que tocar.
   *
   * Los avisos del planificador terminan en "Recursos › Procesos", y hasta ahora
   * eso era un cartelito: había que salir del plan, encontrar esta pantalla,
   * elegir la pestaña, buscar el proceso entre 414 (paginados de a 20) y recién
   * ahí desplegar la fila. El link del aviso ahora deja todo eso hecho.
   *
   * `q` precarga el buscador para que la fila caiga en la primera página; sin eso
   * el proceso podía estar en la página 12 y el `foco` no se veía por ningún lado.
   */
  const focoAplicado = useRef(false);
  /** Operario del `?foco=`: se guarda acá y se abre recién cuando la lista cargó. */
  const [operarioAFocalizar, setOperarioAFocalizar] = useState<number | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || focoAplicado.current) return;
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (!tab) return;
    if (!["operarios", "maquinas", "procesos", "rangos", "sectores"].includes(tab)) return;
    focoAplicado.current = true;

    setTabActiva(tab as typeof tabActiva);
    const q = params.get("q");
    if (q && tab === "procesos") setBusquedaProceso(q);

    const foco = Number(params.get("foco"));
    if (Number.isFinite(foco) && foco > 0) {
      if (tab === "procesos") setProcesoAbierto(foco);
      if (tab === "maquinas") setMaquinaAbierta(foco);
      if (tab === "operarios") setOperarioAFocalizar(foco);
    }

    // El query param se limpia para que un F5 no vuelva a arrastrar el foco de un
    // aviso que quizás ya se resolvió.
    const url = new URL(window.location.href);
    ["tab", "foco", "q"].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState({}, "", url.toString());
  }, []);

  useEffect(() => {
    if (operarioAFocalizar === null || operarios.length === 0) return;
    const op = operarios.find((o) => o.id === operarioAFocalizar);
    setOperarioAFocalizar(null);
    if (op) void handleVerOperario(op);
  }, [operarioAFocalizar, operarios]);

  /**
   * Lleva a la vista la fila desplegada por el `?foco=`, que puede estar abajo.
   *
   * Depende también del largo de las listas: cuando el link entra directo a una
   * pestaña, la fila todavía no existe —el fetch está en curso— y buscarla por id
   * no encuentra nada. Al llegar los datos, el efecto corre de nuevo y ahí sí.
   */
  useEffect(() => {
    const id = procesoAbierto ? `proceso-${procesoAbierto}` : maquinaAbierta ? `maquina-${maquinaAbierta}` : null;
    if (!id) return;
    // Un tick: la fila se despliega en este mismo render y todavía no está en el DOM.
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    return () => window.clearTimeout(t);
  }, [procesoAbierto, maquinaAbierta, procesos.length, maquinas.length, currentProcesosPage]);

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
    } else {
      showToast("No se pudo eliminar. Puede que la base de datos se haya desconectado; esperá unos segundos e intentá de nuevo.", 'error');
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

  const procesosFiltrados = procesos
    .filter(p => p.nombre.toLowerCase().includes(busquedaProceso.toLowerCase()))
    // "Problema" es no tener rango (se lo lleva cualquiera) o tener rangos que no
    // habilitan a nadie disponible (no lo hace nadie). Son los dos casos que el
    // planificador después reporta como bloqueo.
    .filter(p => {
      if (!soloProblemas) return true;
      const c = porProceso.get(p.id);
      return !!c && c.lineas_abiertas > 0 && !!problemaDelProceso(c);
    });

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
          {(tabActiva === "operarios" || tabActiva === "maquinas" || tabActiva === "procesos") && (
            <>
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
            </>
          )}
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
          <User className="h-4 w-4 mr-2" />
          <span>Recurso humano</span>
        </Button>
        <Button
          variant={tabActiva === "maquinas" ? "default" : "outline"}
          onClick={() => setTabActiva("maquinas")}
          className={`flex-1 ${tabActiva === "maquinas" ? "bg-[#DC143C] hover:bg-[#B01030] text-white" : ""}`}
        >
          <Factory className="h-4 w-4 mr-2" />
          <span>Recurso maquinaria</span>
        </Button>
        <Button
          variant={tabActiva === "procesos" ? "default" : "outline"}
          onClick={() => setTabActiva("procesos")}
          className={`flex-1 ${tabActiva === "procesos" ? "bg-[#DC143C] hover:bg-[#B01030] text-white" : ""}`}
        >
          <Layers className="h-4 w-4 mr-2" />
          <span>Procesos</span>
        </Button>
        <Button
          variant={tabActiva === "rangos" ? "default" : "outline"}
          onClick={() => setTabActiva("rangos")}
          className={`flex-1 ${tabActiva === "rangos" ? "bg-[#DC143C] hover:bg-[#B01030] text-white" : ""}`}
        >
          <Target className="h-4 w-4 mr-2" />
          <span>Rangos</span>
        </Button>
        <Button
          variant={tabActiva === "sectores" ? "default" : "outline"}
          onClick={() => setTabActiva("sectores")}
          className={`flex-1 ${tabActiva === "sectores" ? "bg-[#DC143C] hover:bg-[#B01030] text-white" : ""}`}
        >
          <MapPin className="h-4 w-4 mr-2" />
          <span>Sectores</span>
        </Button>
      </div>

      {/* TABLA DE OPERARIOS */}
      {tabActiva === "operarios" && (
        <div className="rounded-lg border bg-card">
          <div className="p-4 md:p-6 border-b">
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Recurso humano</h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Gestión del recurso humano</p>
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

            {/* Aviso de las que no puede usar nadie. Va acá arriba porque es el tipo de
                hueco que no se nota mirando la lista: la máquina existe, está bien
                cargada, y aun así el planificador nunca se la asigna a nadie. */}
            {(() => {
              if (!coberturaListo) return null;
              const sinRango = maquinas.filter((m) => (rangosPorMaquina.get(m.id)?.length ?? 0) === 0);
              if (sinRango.length === 0) return null;
              return (
                <Alert className="mt-3 border-amber-200 bg-amber-50">
                  <AlertDescription className="text-amber-900 text-sm">
                    <span>
                      Hay <strong>{sinRango.length} de {maquinas.length} máquinas sin rango cargado</strong>: el
                      planificador no se las asigna a nadie y el trabajo sale “sin máquina”. Son{" "}
                      {sinRango.map((m) => m.nombre).join(", ")}. Tocá el aviso de cada una en la
                      columna Rangos para cargarlo acá mismo.
                    </span>
                  </AlertDescription>
                </Alert>
              );
            })()}
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
                      <th className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground">Nombre</th>
                      <th className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground">Código</th>
                      <th
                        className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground"
                        title="Quién puede usar la máquina. Sin rango, el planificador no se la asigna a nadie."
                      >
                        Rangos
                      </th>
                      <th className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground">Limitación</th>
                      <th className="px-4 py-2.5 text-right text-sm font-medium text-muted-foreground">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {maquinas.map((maquina) => (
                      <React.Fragment key={maquina.id}>
                      <tr
                        id={`maquina-${maquina.id}`}
                        className={`hover:bg-muted/50 transition-colors ${coberturaListo && (rangosPorMaquina.get(maquina.id)?.length ?? 0) === 0 ? "bg-amber-50/40" : ""}`}
                      >
                        <td className="px-4 py-2 text-sm font-medium">{maquina.nombre}</td>
                        <td className="px-4 py-2 text-sm">{maquina.cod_maquina || "-"}</td>
                        {/* Rangos que habilitan la máquina. Sin ninguno, el planificador
                            no puede asignarla: queda fuera del dominio de todo proceso
                            que exija rangos y el trabajo sale "sin máquina". */}
                        <td className="px-4 py-2 text-sm">
                          {!coberturaListo ? (
                            <span className="text-muted-foreground text-xs">—</span>
                          ) : (rangosPorMaquina.get(maquina.id)?.length ?? 0) > 0 ? (
                            <button
                              type="button"
                              onClick={() => setMaquinaAbierta(maquinaAbierta === maquina.id ? null : maquina.id)}
                              className="flex flex-wrap gap-1 hover:opacity-70 transition-opacity"
                              title="Clic para editar qué rangos pueden usarla"
                            >
                              {rangosPorMaquina.get(maquina.id)!.map((r) => (
                                <Badge key={r.id} variant="outline" className="text-xs font-normal">
                                  {r.nombre}
                                </Badge>
                              ))}
                            </button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setMaquinaAbierta(maquinaAbierta === maquina.id ? null : maquina.id)}
                              className="h-6 bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100 text-xs font-semibold"
                              title="Sin rango cargado: el planificador no se la asigna a nadie. Clic para cargarlo acá mismo."
                            >
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Sin rango — asignar
                            </Button>
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm">
                          {maquina.limitacion ? (
                            maquina.limitacion
                          ) : (
                            <span className="text-muted-foreground text-xs italic">Sin limitación</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
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
                      {maquinaAbierta === maquina.id && coberturaListo && (
                        <tr>
                          <td colSpan={5} className="p-0">
                            <EditorRangosDe
                              tipo="maquinaria"
                              id={maquina.id}
                              nombre={maquina.nombre}
                              actuales={rangosPorMaquina.get(maquina.id) ?? []}
                              catalogo={catalogoRangos}
                              onGuardado={() => { setMaquinaAbierta(null); recargarCobertura(); }}
                            />
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
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
                        <span className="text-muted-foreground">Rangos:</span>
                        {!coberturaListo ? (
                          <span className="ml-2 text-muted-foreground text-xs">—</span>
                        ) : (rangosPorMaquina.get(maquina.id)?.length ?? 0) > 0 ? (
                          <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                            {rangosPorMaquina.get(maquina.id)!.map((r) => (
                              <Badge key={r.id} variant="outline" className="text-xs font-normal">
                                {r.nombre}
                              </Badge>
                            ))}
                          </span>
                        ) : (
                          <Badge variant="outline" className="ml-2 bg-amber-50 text-amber-700 border-amber-200 text-xs font-semibold">
                            Sin rango
                          </Badge>
                        )}
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
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative max-w-sm flex-1 min-w-[220px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar proceso..."
                  value={busquedaProceso}
                  onChange={(e) => setBusquedaProceso(e.target.value)}
                  className="pl-8"
                />
              </div>

              {/* El catálogo tiene cientos de procesos y los que traen problema son unas
                  decenas. Sin este filtro hay que encontrarlos a ojo, uno por uno. */}
              {coberturaListo && (() => {
                // Solo se cuentan los que están EN USO. El catálogo arrastra cientos de
                // procesos del legacy sin rango que no usa nadie: contarlos daba 272
                // "problemas" y el que de verdad frena un plan se perdía entre ellos.
                const conProblema = procesos.filter((p) => {
                  const c = porProceso.get(p.id);
                  return c && c.lineas_abiertas > 0 && !!problemaDelProceso(c);
                }).length;
                if (conProblema === 0) return null;
                return (
                  <Button
                    variant={soloProblemas ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSoloProblemas((v) => !v)}
                    className={soloProblemas ? "bg-amber-600 hover:bg-amber-700" : "border-amber-300 text-amber-800 hover:bg-amber-50"}
                    title="Procesos usados en OTs abiertas que no puede hacer nadie o que no tienen rango cargado"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
                    {soloProblemas
                      ? "Viendo solo los que frenan un plan"
                      : `Ver los ${conProblema} que frenan un plan`}
                  </Button>
                );
              })()}
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
                      <th className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground">Nombre</th>
                      <th
                        className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground"
                        title="Quién puede hacerlo. Sin rango se lo lleva cualquiera; con rangos que no tiene nadie, no lo hace nadie."
                      >
                        Quién puede hacerlo
                      </th>
                      <th className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground">Descripción</th>
                      <th className="px-4 py-2.5 text-right text-sm font-medium text-muted-foreground">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {paginatedProcesos.map((proceso) => {
                      const cob = porProceso.get(proceso.id);
                      const problema = coberturaListo && cob ? problemaDelProceso(cob) : null;
                      // Un problema en un proceso que no se usa no frena nada: se marca
                      // igual, pero sin gritar. Lo urgente es lo que está en una OT abierta.
                      const enUso = (cob?.lineas_abiertas ?? 0) > 0;
                      const sinRango = problema === "sin_rango";
                      const sinNadie = problema === "nadie";
                      return (
                      <React.Fragment key={proceso.id}>
                      <tr id={`proceso-${proceso.id}`} className={`hover:bg-muted/50 transition-colors ${enUso && sinNadie ? "bg-rose-50/50" : enUso && sinRango ? "bg-amber-50/40" : ""}`}>
                        <td className="px-4 py-2 text-sm font-medium">{proceso.nombre}</td>
                        {/* La pregunta que importa de un proceso no es qué rangos tiene
                            cargados sino si hay alguien que pueda hacerlo. Se puede tener
                            tres rangos y que no los tenga ninguna persona disponible. */}
                        <td className="px-4 py-2 text-sm">
                          {/* `!cob` además de `!coberturaListo`: la cobertura se cachea a
                              nivel módulo, así que un proceso creado después de esa consulta
                              no está en el mapa. Sin este chequeo, la rama de abajo hacía
                              `cob!.rangos.map(...)` sobre undefined y la pestaña Procesos se
                              caía entera con un TypeError. */}
                          {!coberturaListo || !cob ? (
                            <span className="text-muted-foreground text-xs">—</span>
                          ) : sinNadie ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setProcesoAbierto(procesoAbierto === proceso.id ? null : proceso.id)}
                              className={`h-6 text-xs font-semibold ${enUso ? "bg-rose-50 text-rose-800 border-rose-300 hover:bg-rose-100" : "text-muted-foreground hover:bg-muted"}`}
                              title={`Pide ${cob!.rangos.map(r => r.nombre).join(" o ")}, y ningún operario disponible lo tiene.${enUso ? ` Se usa en ${cob!.lineas_abiertas} línea(s) de OTs abiertas.` : " Hoy no se usa en ninguna OT abierta."} Clic para resolverlo acá mismo.`}
                            >
                              {enUso && <AlertTriangle className="h-3 w-3 mr-1" />}
                              No lo puede hacer nadie
                            </Button>
                          ) : sinRango ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setProcesoAbierto(procesoAbierto === proceso.id ? null : proceso.id)}
                              className={`h-6 text-xs font-semibold ${enUso ? "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100" : "text-muted-foreground hover:bg-muted"}`}
                              title={`Sin rango cargado: el planificador se lo puede asignar a cualquiera, sepa hacerlo o no.${enUso ? ` Se usa en ${cob!.lineas_abiertas} línea(s) de OTs abiertas.` : " Hoy no se usa en ninguna OT abierta."} Clic para cargarlo acá mismo.`}
                            >
                              {enUso && <AlertTriangle className="h-3 w-3 mr-1" />}
                              Sin rango — asignar
                            </Button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setProcesoAbierto(procesoAbierto === proceso.id ? null : proceso.id)}
                              className="flex flex-wrap items-center gap-1 hover:opacity-70 transition-opacity"
                              title="Clic para editar qué rangos lo habilitan"
                            >
                              {cob!.rangos.map((r) => (
                                <Badge key={r.id} variant="outline" className="text-xs font-normal">{r.nombre}</Badge>
                              ))}
                              <span className="text-xs text-muted-foreground ml-1">
                                {cob!.habilitados} {cob!.habilitados === 1 ? "operario" : "operarios"}
                                {cob!.por_habilidad_manual > 0 && ` (${cob!.por_habilidad_manual} a mano)`}
                              </span>
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm">{proceso.descripcion || "-"}</td>
                        <td className="px-4 py-2">
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
                      {procesoAbierto === proceso.id && coberturaListo && (
                        <tr>
                          <td colSpan={4} className="p-0">
                            <EditorRangosDe
                              tipo="proceso"
                              id={proceso.id}
                              nombre={proceso.nombre}
                              actuales={cob?.rangos ?? []}
                              catalogo={catalogoRangos}
                              onGuardado={() => { setProcesoAbierto(null); recargarCobertura(); }}
                            />
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                      );
                    })}
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

      {/* TABLA DE RANGOS */}
      {tabActiva === "rangos" && (
        <CatalogoSimple
          resource="rangos"
          singular="Rango"
          titulo="Rangos"
          descripcion="Clic en un rango para ver y editar qué procesos y máquinas habilita."
          icon={<Target className="h-5 w-5 text-muted-foreground" />}
          renderBadge={(rango) => {
            const cob = porRango.get(rango.id);
            if (!cob) return null;
            return (
              <span className="flex items-center gap-1.5">
                {cob.maquinas.length > 0 ? (
                  <Badge
                    variant="outline"
                    className="text-xs font-normal"
                    title={cob.maquinas.map((m) => m.nombre).join(", ")}
                  >
                    {cob.maquinas.length} {cob.maquinas.length === 1 ? "máquina" : "máquinas"}
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="bg-amber-50 text-amber-700 border-amber-200 text-xs font-semibold"
                    title="Este rango no habilita ninguna máquina. Quien lo tenga solo puede tomar procesos manuales."
                  >
                    Sin máquinas
                  </Badge>
                )}
                {cob.operarios === 0 && (
                  <Badge
                    variant="outline"
                    className="bg-amber-50 text-amber-700 border-amber-200 text-xs font-semibold"
                    title="Nadie tiene este rango: los procesos y máquinas que solo él habilita quedan sin candidatos."
                  >
                    Sin operarios
                  </Badge>
                )}
              </span>
            );
          }}
          renderExpanded={(rango) => (
            <RangoComposicion idRango={rango.id} nombreRango={rango.nombre} />
          )}
        />
      )}

      {/* TABLA DE SECTORES */}
      {tabActiva === "sectores" && (
        <CatalogoSimple
          resource="sectores"
          singular="Sector"
          titulo="Sectores"
          descripcion="Gestión de sectores del taller (donde se asignan las OTs)."
          icon={<MapPin className="h-5 w-5 text-muted-foreground" />}
        />
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
