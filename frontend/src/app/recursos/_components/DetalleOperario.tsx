import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { User, Phone, Activity, Calendar, FileText, Clock, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { Operario } from "../_types";
import { PlanificacionItem } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useNotifications } from "@/contexts/NotificationContext";
import OperarioEditForm from "./OperarioEditForm";

interface DetalleOperarioProps {
  operario: Operario | null;
  tasks?: PlanificacionItem[];
  onClose: () => void;
  onCambiarEstado: (operario: Operario) => void;
  onOperatorUpdated?: () => void;
}

export default function DetalleOperario({ operario, tasks: initialTasks = [], onClose, onCambiarEstado, onOperatorUpdated }: DetalleOperarioProps) {
  const { showToast } = useToast();
  const { addNotification } = useNotifications();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // Local state for tasks to allow optimistic updates
  const [tasks, setTasks] = useState<PlanificacionItem[]>(initialTasks);
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());

  // Sync props to state if props change (re-opening modal)
  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  const capitalizeName = (text?: string) => {
    if (!text) return "";
    return text
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  };

  const getEstadoColor = (disponible?: boolean) => {
    return disponible
      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr || dateStr.startsWith('1950')) return "-";
    try {
      const date = new Date(dateStr);
      return new Intl.DateTimeFormat('es-AR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }).format(date);
    } catch (e) {
      return dateStr;
    }
  };

  // Group tasks by Order ID
  const groupedTasks = useMemo(() => {
    const groups: Record<number, { orderId: number, tasks: PlanificacionItem[], client?: string, article?: string, date?: string }> = {};

    tasks.forEach(task => {
      if (!task.orden_id) return;
      if (!groups[task.orden_id]) {
        groups[task.orden_id] = {
          orderId: task.orden_id,
          tasks: [],
          client: task.cliente,
          article: task.descripcion_articulo,
          date: task.fecha_prometida
        };
      }
      groups[task.orden_id].tasks.push(task);
    });

    return Object.values(groups).sort((a, b) => b.orderId - a.orderId);
  }, [tasks]);

  if (!operario) return null; // MOVED CHECK HERE

  const toggleOrder = (orderId: number) => {
    const newExpanded = new Set(expandedOrders);
    if (newExpanded.has(orderId)) {
      newExpanded.delete(orderId);
    } else {
      newExpanded.add(orderId);
    }
    setExpandedOrders(newExpanded);
  }

  // Logic for updating Operator Status (Availability)
  const handleOperatorStatusChange = async (newValue: string) => {
    setIsUpdating(true);
    const nuevoEstadoBoolean = newValue === "Activo";

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const cleanUrl = apiUrl.replace(/\/$/, "");

      // Corrected fetch syntax
      const response = await fetch(`${cleanUrl}/operarios/${operario.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: operario.nombre,
          apellido: operario.apellido,
          sector: operario.sector,
          categoria: operario.categoria,
          fecha_nacimiento: operario.fecha_nacimiento,
          fecha_ingreso: operario.fecha_ingreso,
          disponible: nuevoEstadoBoolean,
          telefono: operario.telefono || null,
          celular: operario.celular || null,
          dni: operario.dni || null,
        }),
      });

      if (response.ok) {
        showToast(`Estado actualizado a ${newValue}`, 'success');
        addNotification(`Operario ${operario.nombre} actualizado a ${newValue}`, 'operario_updated');
        operario.disponible = nuevoEstadoBoolean;
      } else {
        showToast("Error al actualizar estado del operario", 'error');
      }
    } catch (error) {
      showToast("Error de conexión", 'error');
    } finally {
      setIsUpdating(false);
    }
  };

  // Logic for updating Task Status
  const handleTaskStatusChange = async (task: PlanificacionItem, newStatusIdStr: string) => {
    const newStatusId = parseInt(newStatusIdStr);
    if (!task.orden_id || !task.proceso_id) return;

    // Optimistic Update
    const previousTasks = [...tasks];
    setTasks(prev => prev.map(t =>
      (t.orden_id === task.orden_id && t.proceso_id === task.proceso_id)
        ? { ...t, id_estado: newStatusId, estado: getStatusLabel(newStatusId) }
        : t
    ));

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const cleanUrl = apiUrl.replace(/\/$/, "");

      // Corrected fetch syntax
      const response = await fetch(`${cleanUrl}/ordenes/${task.orden_id}/procesos/${task.proceso_id}/estado`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_estado: newStatusId }),
      });

      if (response.ok) {
        showToast("Estado de tarea actualizado", 'success');
      } else {
        // Revert on failure
        setTasks(previousTasks);
        showToast("Error al actualizar la tarea", 'error');
      }
    } catch (error) {
      setTasks(previousTasks);
      showToast("Error de conexión", 'error');
    }
  };

  const getStatusLabel = (id: number) => {
    switch (id) {
      case 1: return "Pendiente";
      case 2: return "En Proceso";
      case 3: return "Finalizado";
      default: return "Pendiente";
    }
  }

  // Calculations
  const totalTasks = tasks.length;
  const totalHours = tasks.reduce((acc, task) => {
    const hours = (task.fin_min - task.inicio_min) / 60;
    return acc + (isNaN(hours) ? 0 : hours);
  }, 0);
  const completedTasks = tasks.filter(t => t.id_estado === 3).length;
  const inProgressTasks = tasks.filter(t => t.id_estado === 2).length;

  return (
    <Dialog open={!!operario} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] w-full h-[90vh] flex flex-col p-0 gap-0 overflow-hidden sm:max-w-[95vw]">
        <DialogHeader className="px-6 py-4 border-b bg-gray-50/50 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-xl">{isEditing ? "Editar Operario" : "Perfil del Operario"}</DialogTitle>
              <DialogDescription>{isEditing ? "Modifica los datos del operario" : "Detalle de actividad y asignaciones"}</DialogDescription>
            </div>
            {/* Button moved to sidebar */}
          </div>
        </DialogHeader>

        <div className="flex-1 flex overflow-hidden">
          {isEditing ? (
            <div className="flex-1 flex flex-col p-6 overflow-y-auto bg-white items-center justify-center">
              <OperarioEditForm
                data={operario}
                cleanUrl={process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:8000"}
                onCancel={() => setIsEditing(false)}
                onSuccess={() => {
                  setIsEditing(false);
                  onOperatorUpdated?.();
                }}
              />
            </div>
          ) : (
            <>
              {/* Sidebar Left: Profile Info */}
              <div className="w-80 border-r bg-gray-50/30 p-6 flex flex-col gap-6 overflow-y-auto shrink-0">
                <div className="text-center">
                  <div className="h-24 w-24 mx-auto rounded-full bg-slate-200 flex items-center justify-center mb-4 shadow-inner">
                    <User className="h-12 w-12 text-slate-500" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 break-words">
                    {capitalizeName(operario.nombre)} {capitalizeName(operario.apellido)}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1 uppercase tracking-wide font-medium">{operario.categoria}</p>
                  <Badge variant="outline" className="mt-2 text-xs bg-white text-gray-600 border-gray-300">
                    ID: {operario.id}
                  </Badge>

                  <div className="mt-4 flex flex-col gap-3 items-center">
                    <Select
                      disabled={isUpdating}
                      value={operario.disponible ? "Activo" : "Ausente"}
                      onValueChange={handleOperatorStatusChange}
                    >
                      <SelectTrigger className={`w-[140px] border-none shadow-sm font-medium h-8 ${getEstadoColor(operario.disponible)}`}>
                        <div className="flex items-center gap-2">
                          <Activity className="h-3 w-3" />
                          <SelectValue />
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Activo">Activo</SelectItem>
                        <SelectItem value="Ausente">Ausente</SelectItem>
                      </SelectContent>
                    </Select>

                    <Button
                      variant={isEditing ? "destructive" : "outline"}
                      size="sm"
                      onClick={() => setIsEditing(!isEditing)}
                      className="w-[140px] h-8 text-xs"
                    >
                      <Pencil className="h-3 w-3 mr-2" />
                      {isEditing ? "Cancelar" : "Editar Datos"}
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4 text-sm">
                  <div className="flex items-center gap-3 text-gray-700">
                    <Activity className="h-4 w-4 text-gray-400" />
                    <span className="font-medium">Sector:</span>
                    <span className="ml-auto text-gray-900">{operario.sector}</span>
                  </div>
                  {operario.dni && (
                    <div className="flex items-center gap-3 text-gray-700">
                      <FileText className="h-4 w-4 text-gray-400" />
                      <span className="font-medium">DNI:</span>
                      <span className="ml-auto text-gray-900">{(operario.dni || "").replace(/\./g, "")}</span>
                    </div>
                  )}
                  {(operario.telefono || operario.celular) && (
                    <div className="flex items-center gap-3 text-gray-700">
                      <Phone className="h-4 w-4 text-gray-400" />
                      <span className="font-medium">Contacto:</span>
                      <span className="ml-auto text-gray-900">{(operario.celular || operario.telefono || "").replace(/\D/g, "")}</span>
                    </div>
                  )}
                  {operario.fecha_nacimiento && (
                    <div className="flex items-center gap-3 text-gray-700">
                      <Calendar className="h-4 w-4 text-gray-400" />
                      <span className="font-medium">Nacimiento:</span>
                      <span className="ml-auto text-gray-900">{formatDate(operario.fecha_nacimiento)}</span>
                    </div>
                  )}
                  {operario.fecha_ingreso && (
                    <div className="flex items-center gap-3 text-gray-700">
                      <Calendar className="h-4 w-4 text-gray-400" />
                      <span className="font-medium">Ingreso:</span>
                      <span className="ml-auto text-gray-900">{formatDate(operario.fecha_ingreso)}</span>
                    </div>
                  )}
                  {operario.email && (
                    <div className="flex items-center gap-3 text-gray-700">
                      <Activity className="h-4 w-4 text-gray-400" />
                      <span className="font-medium">Email:</span>
                      <span className="ml-auto text-gray-900">{operario.email}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Main Content Right: Stats & Tasks */}
              <div className="flex-1 flex flex-col bg-white overflow-hidden">
                {/* Stats Overview */}
                <div className="grid grid-cols-3 gap-3 p-4 border-b bg-white shrink-0">
                  <Card className="shadow-sm border-slate-100 bg-slate-50">
                    <CardContent className="p-3 flex flex-col items-center justify-center text-center">
                      <div className="bg-white p-1.5 rounded-full shadow-sm mb-1">
                        <Clock className="h-4 w-4 text-blue-600" />
                      </div>
                      <span className="text-xl font-bold text-slate-800">{totalHours.toFixed(1)}h</span>
                      <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Horas</span>
                    </CardContent>
                  </Card>
                  <Card className="shadow-sm border-slate-100 bg-slate-50">
                    <CardContent className="p-3 flex flex-col items-center justify-center text-center">
                      <div className="bg-white p-1.5 rounded-full shadow-sm mb-1">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      </div>
                      <span className="text-xl font-bold text-slate-800">{totalTasks}</span>
                      <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Tareas</span>
                    </CardContent>
                  </Card>
                  <Card className="shadow-sm border-slate-100 bg-slate-50">
                    <CardContent className="p-3 flex flex-col items-center justify-center text-center">
                      <div className="bg-white p-1.5 rounded-full shadow-sm mb-1">
                        <Activity className="h-4 w-4 text-orange-600" />
                      </div>
                      <span className="text-xl font-bold text-slate-800">{inProgressTasks}</span>
                      <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">En Proceso</span>
                    </CardContent>
                  </Card>
                </div>

                {/* Tasks List (Grouped by OT) */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="px-6 py-3 border-b flex items-center justify-between bg-white sticky top-0 z-10">
                    <h4 className="font-semibold text-gray-800 flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-gray-500" />
                      Órdenes Asignadas
                    </h4>
                    <Badge variant="secondary" className="text-xs bg-gray-100">
                      {groupedTasks.length} Órdenes ({tasks.length} procesos)
                    </Badge>
                  </div>

                  <div className="flex-1 p-6 bg-gray-50/30 overflow-y-auto">
                    {groupedTasks.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
                        <FileText className="h-12 w-12 mb-3 stroke-1" />
                        <p>No hay órdenes asignadas para este operario.</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {groupedTasks.map((group) => {
                          const isExpanded = expandedOrders.has(group.orderId);
                          const groupStatus = group.tasks.some(t => t.id_estado === 2) ? "En Proceso" :
                            group.tasks.every(t => t.id_estado === 3) ? "Finalizado" : "Pendiente";
                          const groupStatusColor = groupStatus === "Finalizado" ? "bg-green-100 text-green-800" :
                            groupStatus === "En Proceso" ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-800";

                          return (
                            <Card
                              key={group.orderId}
                              className={`border-l-4 transition-all duration-200 border-slate-200 cursor-pointer ${isExpanded ? 'shadow-lg' : 'shadow-sm hover:shadow-md'
                                } ${groupStatus === "Finalizado" ? "border-l-green-500" :
                                  groupStatus === "En Proceso" ? "border-l-blue-500" :
                                    "border-l-gray-300"
                                }`}
                              onClick={() => toggleOrder(group.orderId)}
                            >
                              <CardContent className="p-0">
                                {/* Order Header */}
                                <div className="p-4 flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <Badge variant="outline" className="font-mono text-sm font-bold text-slate-700 border-slate-300 bg-slate-50">
                                        OT #{group.orderId}
                                      </Badge>
                                      <span className="text-base font-semibold text-gray-900 line-clamp-1">
                                        {group.article || "Sin Artículo"}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                                      <span className="flex items-center gap-1">
                                        <Activity className="h-3 w-3" /> {group.tasks.length} procesos
                                      </span>
                                      <span>
                                        Entrega: <span className="font-medium text-gray-700">{formatDate(group.date)}</span>
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-3">
                                    <Badge className={`${groupStatusColor} whitespace-nowrap`}>
                                      {groupStatus}
                                    </Badge>
                                    {isExpanded ? <ChevronUp className="h-5 w-5 text-gray-400" /> : <ChevronDown className="h-5 w-5 text-gray-400" />}
                                  </div>
                                </div>

                                {/* Expanded Processes List */}
                                {isExpanded && (
                                  <div className="bg-gray-50/50 border-t border-gray-100 animate-in slide-in-from-top-2 duration-200" onClick={(e) => e.stopPropagation()}>
                                    <div className="p-4 space-y-3">
                                      <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2 mb-3">
                                        <Activity className="h-3 w-3" /> Procesos Asignados
                                      </h5>
                                      {group.tasks.map((task, idx) => (
                                        <div key={`${task.id}-${idx}`} className="bg-white p-3 rounded-md border border-gray-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
                                          <div className="flex items-center gap-3 flex-1">
                                            <div className={`w-2 h-2 rounded-full ${task.id_estado === 3 ? "bg-green-500" : task.id_estado === 2 ? "bg-blue-500" : "bg-gray-300"
                                              }`} />
                                            <div>
                                              <p className="font-medium text-sm text-gray-900">{task.nombre_proceso}</p>
                                              <p className="text-xs text-gray-500">
                                                Duration: {((task.fin_min - task.inicio_min) / 60).toFixed(1)}h
                                              </p>
                                            </div>
                                          </div>

                                          <Select
                                            value={task.id_estado.toString()}
                                            onValueChange={(val) => handleTaskStatusChange(task, val)}
                                          >
                                            <SelectTrigger className="w-[140px] h-8 text-xs bg-slate-50">
                                              <SelectValue placeholder="Estado" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="1">Pendiente</SelectItem>
                                              <SelectItem value="2">En Proceso</SelectItem>
                                              <SelectItem value="3">Finalizado</SelectItem>
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                              </CardContent>
                            </Card>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {!isEditing && (
          <DialogFooter className="px-6 py-4 border-t bg-white flex-shrink-0">
            <Button onClick={onClose} className="w-full sm:w-auto">Cerrar</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog >
  );
}
