import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { User, Phone, Activity, Calendar, FileText, Clock, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, Pencil, Wrench, Trash2, Plus, Briefcase } from "lucide-react";
import { Operario, ProcesoSkill } from "../_types";
import { PlanificacionItem } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useToast } from "@/components/ui/toast";
import { useNotifications } from "@/contexts/NotificationContext";
import OperarioEditForm from "./OperarioEditForm";
import { parseApiError } from "@/lib/utils";
import { API_URL } from "@/config"

const getAuthHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('access_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};;

interface DetalleOperarioProps {
  operario: Operario | null;
  tasks?: PlanificacionItem[];
  onClose: () => void;
  onCambiarEstado: (operario: Operario) => void;
  onOperatorUpdated?: () => void;
}

/**
 * Vistas del MISMO conjunto de skills nativas, agrupadas por prioridad.
 *
 * No son listas independientes: una nativa marcada como SKILL 1 sigue siendo nativa,
 * solo que el planificador la prefiere. Por eso se filtra por `nivel` sobre la lista
 * completa en vez de mantener tres colecciones separadas.
 */
const GRUPOS_SKILL = [
  {
    value: "skill1",
    titulo: "SKILLS 1",
    barra: "bg-emerald-500",
    vacio: "Ninguna marcada como SKILL 1",
    filtro: (s: ProcesoSkill) => s.habilitado && s.nivel === 1,
  },
  {
    value: "skill2",
    titulo: "SKILLS 2",
    barra: "bg-sky-500",
    vacio: "Ninguna marcada como SKILL 2",
    filtro: (s: ProcesoSkill) => s.habilitado && s.nivel === 2,
  },
  {
    value: "sin-prioridad",
    titulo: "SIN PRIORIDAD",
    barra: "bg-slate-400",
    vacio: "Ninguna sin prioridad",
    filtro: (s: ProcesoSkill) => s.habilitado && (s.nivel ?? 0) === 0,
  },
  {
    value: "apagadas",
    titulo: "DESACTIVADAS",
    barra: "bg-gray-300",
    vacio: "Ninguna desactivada",
    filtro: (s: ProcesoSkill) => !s.habilitado,
  },
];

export default function DetalleOperario({ operario, tasks: initialTasks = [], onClose, onCambiarEstado, onOperatorUpdated }: DetalleOperarioProps) {
  const { showToast } = useToast();
  const { addNotification } = useNotifications();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [procesosMap, setProcesosMap] = useState<Record<number, string>>({});
  const [updatingSkills, setUpdatingSkills] = useState<Set<number>>(new Set());
  const [renderTrigger, setRenderTrigger] = useState(0); // For optimistic UI updates

  // Local state for tasks to allow optimistic updates
  const [tasks, setTasks] = useState<PlanificacionItem[]>(initialTasks);
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());

  // Sync props to state if props change (re-opening modal)
  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  useEffect(() => {
    const fetchProcesos = async () => {
      try {
        const cleanUrl = API_URL.replace(/\/$/, "");
        const res = await fetch(`${cleanUrl}/procesos`, { headers: getAuthHeaders() as Record<string, string> });
        if (res.ok) {
          const payload = await res.json();
          const pdata = payload?.data || [];
          const map: Record<number, string> = {};
          pdata.forEach((p: any) => { map[p.id] = p.nombre; });
          setProcesosMap(map);
        }
      } catch (e) { }
    };
    fetchProcesos();
  }, []);

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

  // Abrir/cerrar todas de una: el uso real es mirar varias OT juntas, no una por vez.
  const todasExpandidas = groupedTasks.length > 0 && expandedOrders.size === groupedTasks.length;
  const toggleTodasLasOrdenes = () => {
    setExpandedOrders(todasExpandidas ? new Set() : new Set(groupedTasks.map(g => g.orderId)));
  };

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
      const cleanUrl = API_URL.replace(/\/$/, "");

      // Corrected fetch syntax
      const response = await fetch(`${cleanUrl}/operarios/${operario.id}`, {
        method: "PUT",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
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

  const handleSkillToggle = async (id_proceso: number, currentState: boolean) => {
    if (updatingSkills.has(id_proceso)) return;

    setUpdatingSkills(prev => new Set(prev).add(id_proceso));
    const newHabilitado = !currentState;

    // Optimistic Update
    const skillList = operario.skills || [];
    const skillToUpdate = skillList.find(x => x.id_proceso === id_proceso);
    if (skillToUpdate) {
      skillToUpdate.habilitado = newHabilitado;
      setRenderTrigger(r => r + 1);
    }

    try {
      const cleanUrl = API_URL.replace(/\/$/, "");
      const response = await fetch(`${cleanUrl}/operarios/${operario.id}/skills/${id_proceso}/estado`, {
        method: "PUT",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        body: JSON.stringify({ habilitado: newHabilitado }),
      });

      if (response.ok) {
        showToast(`Habilidad ${newHabilitado ? 'activada' : 'desactivada'}`, 'success');
        onOperatorUpdated?.();
      } else {
        // Revert
        if (skillToUpdate) skillToUpdate.habilitado = currentState;
        setRenderTrigger(r => r + 1);
        showToast("Error al actualizar la habilidad (Error del servidor)", 'error');
      }
    } catch (error) {
      // Revert
      if (skillToUpdate) skillToUpdate.habilitado = currentState;
      setRenderTrigger(r => r + 1);
      showToast("Error de conexión al actualizar la habilidad", 'error');
    } finally {
      setUpdatingSkills(prev => {
        const next = new Set(prev);
        next.delete(id_proceso);
        return next;
      });
    }
  };

  const handleNativeSkillToggle = async (id_proceso: number, currentState: boolean) => {
    if (updatingSkills.has(id_proceso)) return;

    setUpdatingSkills(prev => new Set(prev).add(id_proceso));
    const newHabilitado = !currentState;

    // Optimistic Update
    const skillList = operario.skills || [];
    const skillToUpdate = skillList.find(x => x.id_proceso === id_proceso && x.nivel === 0);
    if (skillToUpdate) {
      skillToUpdate.habilitado = newHabilitado;
      setRenderTrigger(r => r + 1);
    }

    try {
      const cleanUrl = API_URL.replace(/\/$/, "");
      const response = await fetch(`${cleanUrl}/operarios/${operario.id}/skills-nativas/${id_proceso}/estado`, {
        method: "PUT",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        body: JSON.stringify({ habilitado: newHabilitado }),
      });

      if (response.ok) {
        showToast(`Habilidad nativa ${newHabilitado ? 'activada' : 'desactivada'}`, 'success');
        onOperatorUpdated?.();
      } else {
        // Revert
        if (skillToUpdate) skillToUpdate.habilitado = currentState;
        setRenderTrigger(r => r + 1);
        showToast("Error al actualizar la habilidad nativa (Error del servidor)", 'error');
      }
    } catch (error) {
      // Revert
      if (skillToUpdate) skillToUpdate.habilitado = currentState;
      setRenderTrigger(r => r + 1);
      showToast("Error de conexión al actualizar la habilidad nativa", 'error');
    } finally {
      setUpdatingSkills(prev => {
        const next = new Set(prev);
        next.delete(id_proceso);
        return next;
      });
    }
  };

  /**
   * Cambia la PRIORIDAD de una skill nativa (0 = sin marcar, 1 = SKILL 1, 2 = SKILL 2).
   *
   * No existe "eliminar habilidad": el conjunto de lo que el operario sabe hacer lo
   * fijan sus rangos. Para que no se la asignen se apaga la nativa (el toggle).
   */
  const handleCambiarNivel = async (id_proceso: number, nivel: number) => {
    if (updatingSkills.has(id_proceso)) return;
    setUpdatingSkills(prev => new Set(prev).add(id_proceso));

    const skill = (operario.skills || []).find(x => x.id_proceso === id_proceso);
    const nivelPrevio = skill?.nivel ?? 0;
    const habilitadoPrevio = skill?.habilitado ?? true;
    if (skill) {
      skill.nivel = nivel;
      if (nivel !== 0) skill.habilitado = true;
      setRenderTrigger(r => r + 1);
    }

    try {
      const cleanUrl = API_URL.replace(/\/$/, "");
      const response = await fetch(`${cleanUrl}/operarios/${operario.id}/skills`, {
        method: "POST",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
        body: JSON.stringify({ id_proceso, nivel, habilitado: true }),
      });

      if (response.ok) {
        showToast(
          nivel === 0 ? "Prioridad quitada" : `Marcada como SKILL ${nivel}`,
          'success'
        );
        onOperatorUpdated?.();
      } else {
        if (skill) { skill.nivel = nivelPrevio; skill.habilitado = habilitadoPrevio; }
        setRenderTrigger(r => r + 1);
        const bodyText = await response.text().catch(() => "");
        showToast(parseApiError(bodyText) || "Error al cambiar la prioridad", 'error');
      }
    } catch (error) {
      if (skill) { skill.nivel = nivelPrevio; skill.habilitado = habilitadoPrevio; }
      setRenderTrigger(r => r + 1);
      showToast("Error de conexión al cambiar la prioridad", 'error');
    } finally {
      setUpdatingSkills(prev => {
        const next = new Set(prev);
        next.delete(id_proceso);
        return next;
      });
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
      const cleanUrl = API_URL.replace(/\/$/, "");

      // Corrected fetch syntax
      const response = await fetch(`${cleanUrl}/ordenes/${task.orden_id}/procesos/${task.proceso_id}/estado`, {
        method: "PUT",
        headers: { ...getAuthHeaders() as Record<string, string>, "Content-Type": "application/json" },
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
        <DialogHeader className="px-5 py-2.5 border-b bg-gray-50/50 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-base">{isEditing ? "Editar Operario" : "Perfil del Operario"}</DialogTitle>
              <DialogDescription className="text-xs">{isEditing ? "Modifica los datos del operario" : "Detalle de actividad y asignaciones"}</DialogDescription>
            </div>
            {/* Button moved to sidebar */}
          </div>
        </DialogHeader>

        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {isEditing ? (
            <div className="flex-1 flex flex-col p-4 md:p-6 overflow-y-auto bg-white items-stretch justify-start">
              <OperarioEditForm
                data={operario}
                cleanUrl={API_URL.replace(/\/$/, "")}
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
              <div className="w-full md:w-80 lg:w-[360px] md:border-r border-b md:border-b-0 bg-gray-50/30 p-3 md:p-4 flex flex-col gap-3 overflow-y-auto shrink-0 z-10 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)] md:shadow-none">
                <div className="text-center">
                  <div className="h-12 w-12 mx-auto rounded-full bg-slate-200 flex items-center justify-center mb-1.5 shadow-inner">
                    <User className="h-6 w-6 text-slate-500" />
                  </div>
                  <h3 className="text-base font-bold text-gray-900 break-words leading-tight">
                    {capitalizeName(operario.nombre)} {capitalizeName(operario.apellido)}
                  </h3>
                  <p className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">
                    {operario.categoria} · ID {operario.id}
                  </p>

                  <div className="mt-2 flex gap-2 items-center justify-center">
                    <Select
                      disabled={isUpdating}
                      value={operario.disponible ? "Activo" : "Ausente"}
                      onValueChange={handleOperatorStatusChange}
                    >
                      <SelectTrigger className={`w-[118px] border-none shadow-sm font-medium h-7 text-xs ${getEstadoColor(operario.disponible)}`}>
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
                      className="w-[118px] h-7 text-xs"
                    >
                      <Pencil className="h-3 w-3 mr-1.5" />
                      {isEditing ? "Cancelar" : "Editar"}
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-2 text-gray-700">
                    <Activity className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                    <span className="font-medium">Sector:</span>
                    <span className="ml-auto text-gray-900">
                      {operario.sector || <span className="text-muted-foreground italic">Sin sector</span>}
                    </span>
                  </div>
                  {operario.dni && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <FileText className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                      <span className="font-medium">DNI:</span>
                      <span className="ml-auto text-gray-900">{(operario.dni || "").replace(/\./g, "")}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-gray-700">
                    <Phone className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                    <span className="font-medium">Contacto:</span>
                    <span className="ml-auto text-gray-900">
                      {(operario.celular || operario.telefono) ?
                        (operario.celular || operario.telefono || "").replace(/\D/g, "") :
                        <span className="text-muted-foreground italic">Sin teléfono</span>
                      }
                    </span>
                  </div>
                  {operario.fecha_nacimiento && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <Calendar className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                      <span className="font-medium">Nacimiento:</span>
                      <span className="ml-auto text-gray-900">{formatDate(operario.fecha_nacimiento)}</span>
                    </div>
                  )}
                  {operario.fecha_ingreso && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <Calendar className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                      <span className="font-medium">Ingreso:</span>
                      <span className="ml-auto text-gray-900">{formatDate(operario.fecha_ingreso)}</span>
                    </div>
                  )}
                  {operario.email && (
                    <div className="flex items-center gap-2 text-gray-700">
                      <Activity className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                      <span className="font-medium">Email:</span>
                      <span className="ml-auto text-gray-900">{operario.email}</span>
                    </div>
                  )}
                  <div className="flex items-start gap-2 text-gray-700">
                    <Briefcase className="h-3.5 w-3.5 text-gray-400 shrink-0 mt-0.5 shrink-0" />
                    <span className="font-medium shrink-0">Rango:</span>
                    <span className="ml-auto text-right text-gray-900 font-semibold break-words min-w-0">{operario.categoria}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-700">
                    <Clock className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                    <span className="font-medium">Horario:</span>
                    <span className="ml-auto text-gray-900">
                      {operario.hora_inicio || "07:00"} - {operario.hora_fin || "16:00"}
                    </span>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2 text-xs mt-1">
                  <div className="flex items-center gap-2 mb-1 px-1">
                    <Wrench className="h-4 w-4 text-purple-500" />
                    <h4 className="font-semibold text-gray-800">Habilidades</h4>
                  </div>
                  <p className="text-[11px] text-muted-foreground px-1 mb-1.5">
                    Todas salen de los rangos del operario. SKILLS 1 y 2 solo le dicen al
                    planificador a quién preferir; el toggle apaga la habilidad.
                  </p>
                  {/* El editor con arrastrar no entra en esta columna: vive en el modal de
                      edición, que tiene ancho para las dos listas. Sin este aviso no se
                      encuentra y parece que la pantalla no cambió. */}
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="w-full mb-2 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-purple-300 bg-purple-50/50 px-2 py-1.5 text-[11px] font-medium text-purple-700 hover:bg-purple-100/60"
                  >
                    <Pencil className="h-3 w-3" />
                    Arrastrar para priorizar (en Editar)
                  </button>
                  {(operario.skills || []).length === 0 ? (
                    <p className="text-muted-foreground italic text-xs px-2 mb-2">
                      Sin habilidades: el operario no tiene rangos asignados.
                    </p>
                  ) : (
                    <Accordion type="multiple" className="w-full" defaultValue={GRUPOS_SKILL.map(g => g.value)}>
                      {GRUPOS_SKILL.map(grupo => {
                        const items = (operario.skills || [])
                          .filter(grupo.filtro)
                          .sort((a, b) => (a.nombre_proceso || procesosMap[a.id_proceso] || "")
                            .localeCompare(b.nombre_proceso || procesosMap[b.id_proceso] || ""));
                        return (
                          <AccordionItem
                            key={grupo.value}
                            value={grupo.value}
                            className="border-b-0 mb-1.5 bg-white rounded-lg border shadow-sm px-2.5 relative overflow-hidden"
                          >
                            <div className={`absolute top-0 left-0 w-1 h-full ${grupo.barra}`}></div>
                            <AccordionTrigger className="py-2 hover:no-underline text-[13px] font-semibold text-gray-800 ml-1">
                              <div className="flex flex-1 items-center justify-between mr-2 min-w-0">
                                <span className="truncate pr-2">{grupo.titulo}</span>
                                <span className="text-[10px] font-normal uppercase tracking-wide text-gray-500 shrink-0 pr-1">
                                  {items.length}
                                </span>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="pt-0 pb-2 ml-1">
                              {items.length === 0 ? (
                                <p className="text-xs text-gray-500 italic py-1 text-center">{grupo.vacio}</p>
                              ) : (
                                <div className="flex flex-col gap-1">
                                  {items.map(skill => {
                                    const nombre = skill.nombre_proceso || procesosMap[skill.id_proceso] || `Proceso #${skill.id_proceso}`;
                                    const ocupado = updatingSkills.has(skill.id_proceso);
                                    return (
                                      <div key={skill.id_proceso} className="flex justify-between items-center py-0.5 gap-2">
                                        <span
                                          className={`font-medium text-xs truncate flex-1 min-w-0 ${skill.habilitado ? 'text-gray-900' : 'text-gray-400 line-through'}`}
                                          title={nombre}
                                        >
                                          {nombre}
                                        </span>
                                        <div className="flex items-center gap-1 shrink-0">
                                          {/* Los botones "1 / 2 / –" sueltos no decían nada. Como las
                                              filas YA están agrupadas por prioridad, repetir el nivel
                                              actual sobra y solo come ancho al nombre: el control ofrece
                                              el movimiento. El arrastrar vive en el modal de edición,
                                              que tiene lugar para las dos columnas. */}
                                          <select
                                            disabled={ocupado || !skill.habilitado}
                                            value=""
                                            onChange={(e) => handleCambiarNivel(skill.id_proceso, parseInt(e.target.value, 10))}
                                            aria-label={`Mover ${nombre} a otra prioridad`}
                                            title="Mover a otra prioridad"
                                            className="h-6 text-[11px] rounded-md border border-gray-200 bg-white pl-1.5 text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed hover:border-gray-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                                          >
                                            <option value="" disabled>Mover</option>
                                            {[1, 2, 0]
                                              .filter(n => n !== (skill.nivel ?? 0))
                                              .map(n => (
                                                <option key={n} value={n}>
                                                  {n === 0 ? "Sin prioridad" : `SKILL ${n}`}
                                                </option>
                                              ))}
                                          </select>
                                          <button
                                            disabled={ocupado}
                                            onClick={() => handleNativeSkillToggle(skill.id_proceso, skill.habilitado)}
                                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-50 ${skill.habilitado ? 'bg-emerald-500' : 'bg-slate-300'}`}
                                            title={skill.habilitado ? "Desactivar habilidad" : "Activar habilidad"}
                                          >
                                            <span className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${skill.habilitado ? 'translate-x-[8px]' : '-translate-x-[8px]'}`} />
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </AccordionContent>
                          </AccordionItem>
                        );
                      })}
                    </Accordion>
                  )}
                </div>
              </div>

              {/* Main Content Right: Stats & Tasks */}
              <div className="flex-1 flex flex-col bg-white overflow-hidden">
                {/* Stats Overview */}
                {/* Stats en una sola línea: los números no necesitan tres tarjetas,
                    y cada píxel que se ahorra acá es una OT más visible abajo. */}
                <div className="flex items-center gap-5 px-4 py-1.5 border-b bg-white shrink-0">
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                    <span className="text-[13px] font-bold text-slate-800">{totalHours.toFixed(1)}h</span>
                    <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Horas</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                    <span className="text-[13px] font-bold text-slate-800">{totalTasks}</span>
                    <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Tareas</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5 text-orange-600 shrink-0" />
                    <span className="text-[13px] font-bold text-slate-800">{inProgressTasks}</span>
                    <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">En Proceso</span>
                  </span>
                </div>

                {/* Tasks List (Grouped by OT) */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="px-4 py-2 border-b flex items-center justify-between bg-white sticky top-0 z-10">
                    <h4 className="font-semibold text-sm text-gray-800 flex items-center gap-2">
                      <Calendar className="h-3.5 w-3.5 text-gray-500" />
                      Órdenes Asignadas
                    </h4>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[11px] bg-gray-100">
                        {groupedTasks.length} Órdenes ({tasks.length} procesos)
                      </Badge>
                      {groupedTasks.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[11px] px-2"
                          onClick={toggleTodasLasOrdenes}
                        >
                          {todasExpandidas ? "Contraer todas" : "Desplegar todas"}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 px-3 py-2 bg-gray-50/30 overflow-y-auto">
                    {groupedTasks.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
                        <FileText className="h-12 w-12 mb-3 stroke-1" />
                        <p>No hay órdenes asignadas para este operario.</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
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
                                {/* Cabecera de la OT en UN renglón: código, artículo, procesos y
                                    entrega juntos, para que entren varias OT desplegadas a la vez. */}
                                <div className="px-2.5 py-1.5 flex gap-2 items-center">
                                  <Badge variant="outline" className="font-mono text-[11px] font-bold text-slate-700 border-slate-300 bg-slate-50 px-1.5 py-0 shrink-0">
                                    OT #{group.orderId}
                                  </Badge>
                                  <span className="text-[13px] font-semibold text-gray-900 truncate flex-1 min-w-0">
                                    {group.article || "Sin Artículo"}
                                  </span>
                                  <span className="text-[11px] text-gray-500 whitespace-nowrap shrink-0 hidden sm:inline">
                                    {group.tasks.length} proc · {formatDate(group.date)}
                                  </span>
                                  <Badge className={`${groupStatusColor} whitespace-nowrap text-[11px] px-2 py-0 shrink-0`}>
                                    {groupStatus}
                                  </Badge>
                                  {isExpanded
                                    ? <ChevronUp className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                                    : <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0" />}
                                </div>

                                {/* Expanded Processes List */}
                                {isExpanded && (
                                  <div className="bg-gray-50/50 border-t border-gray-100 animate-in slide-in-from-top-2 duration-200" onClick={(e) => e.stopPropagation()}>
                                    <div className="px-3 py-2 space-y-1">
                                      <h5 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5 mb-1">
                                        <Activity className="h-2.5 w-2.5" /> Procesos Asignados
                                      </h5>
                                      {group.tasks.map((task, idx) => (
                                        <div key={`${task.id}-${idx}`} className="bg-white px-2.5 py-1 rounded-md border border-gray-200 shadow-sm flex items-center justify-between gap-3">
                                          <div className="flex items-center gap-2 flex-1 min-w-0">
                                            <div className={`w-2 h-2 rounded-full shrink-0 ${task.id_estado === 3 ? "bg-green-500" : task.id_estado === 2 ? "bg-blue-500" : "bg-gray-300"
                                              }`} />
                                            <p className="text-[13px] text-gray-900 truncate">
                                              <span className="font-medium">{task.nombre_proceso}</span>
                                              <span className="text-gray-500"> · {((task.fin_min - task.inicio_min) / 60).toFixed(1)}h</span>
                                            </p>
                                          </div>

                                          <Select
                                            value={(task.id_estado ?? 1).toString()}
                                            onValueChange={(val) => handleTaskStatusChange(task, val)}
                                          >
                                            <SelectTrigger className="w-[120px] h-7 text-xs bg-slate-50 shrink-0">
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
          <DialogFooter className="px-5 py-2.5 border-t bg-white flex-shrink-0">
            <Button onClick={onClose} className="w-full sm:w-auto">Cerrar</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog >
  );
}
