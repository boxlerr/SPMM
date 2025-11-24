import { Task } from "gantt-task-react";
import { PlanificacionItem } from "../gantt-transform";

interface SetupBarListenersArgs {
    container: HTMLElement;
    tasks: Task[];
    planificacionItems: PlanificacionItem[];
    setSelectedItem: (item: PlanificacionItem | null) => void;
    setDetailsOpen: (open: boolean) => void;
    setSelectedTaskId: (id: string | null) => void;
    setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
    tasksRef: React.MutableRefObject<Task[]>;
    preventModalRef: React.MutableRefObject<boolean>;
    modalTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
    selectedItem: PlanificacionItem | null;
}

export const setupBarListeners = ({
    container,
    tasks,
    planificacionItems,
    setSelectedItem,
    setDetailsOpen,
    setSelectedTaskId,
    setTasks,
    tasksRef,
    preventModalRef,
    modalTimeoutRef,
    selectedItem,
}: SetupBarListenersArgs) => {
    // Buscar todos los <rect> que son barras de tareas (no proyectos)
    const svg = container.querySelector("svg");
    if (!svg) {
        return;
    }

    // Obtener todas las barras de tareas (task.type === 'task')
    const taskBars = tasks.filter((t) => t.type === "task");

    // Buscar todos los grupos de barras (gantt-task-react usa <g> para agrupar barras)
    // Buscar todos los <rect> dentro del SVG que tienen altura (son barras, no líneas)
    const allRects = svg.querySelectorAll("rect");
    const barRects: Array<{ rect: SVGRectElement; y: number; x: number }> = [];

    allRects.forEach((rect) => {
        const height = parseFloat(rect.getAttribute("height") || "0");
        const y = parseFloat(rect.getAttribute("y") || "0");
        const x = parseFloat(rect.getAttribute("x") || "0");
        // Las barras tienen altura > 20px, las líneas tienen altura muy pequeña
        if (height > 20 && x > 0) {
            barRects.push({ rect, y, x });
        }
    });

    // Ordenar por posición Y (de arriba hacia abajo) y luego por X (de izquierda a derecha)
    barRects.sort((a, b) => {
        if (Math.abs(a.y - b.y) < 5) {
            return a.x - b.x; // Misma fila, ordenar por X
        }
        return a.y - b.y; // Diferente fila, ordenar por Y
    });

    // Emparejar cada rect con su task usando el texto cercano
    barRects.forEach(({ rect }, index) => {
        if (index >= taskBars.length) return;

        const task = taskBars[index];
        if (!task) return;

        // Buscar el texto asociado a esta barra para identificar la tarea correcta
        const textElements = svg.querySelectorAll("text");
        let matchedTask = task;

        const rectY = parseFloat(rect.getAttribute("y") || "0");
        const rectHeight = parseFloat(rect.getAttribute("height") || "0");
        const rectCenterY = rectY + rectHeight / 2;
        const rectX = parseFloat(rect.getAttribute("x") || "0");
        const rectWidth = parseFloat(rect.getAttribute("width") || "0");

        // Buscar texto que esté dentro o cerca de esta barra
        for (const textEl of textElements) {
            const textY = parseFloat(textEl.getAttribute("y") || "0");
            const textX = parseFloat(textEl.getAttribute("x") || "0");
            const textContent = textEl.textContent || "";

            // Si el texto está dentro del área de la barra
            if (
                Math.abs(textY - rectCenterY) < 25 &&
                textX >= rectX - 10 &&
                textX <= rectX + rectWidth + 10 &&
                textContent.trim().length > 0
            ) {
                // Buscar la tarea que coincide con este texto
                const taskNamePart = task.name.split(" (OT:")[0].toLowerCase();
                if (textContent.toLowerCase().includes(taskNamePart)) {
                    matchedTask = task;
                    break;
                }

                // Intentar encontrar cualquier tarea que coincida con el texto
                const matchingTask = taskBars.find((t) => {
                    const tNamePart = t.name.split(" (OT:")[0].toLowerCase();
                    return textContent.toLowerCase().includes(tNamePart);
                });
                if (matchingTask) {
                    matchedTask = matchingTask;
                    break;
                }
            }
        }

        // Agregar data-task-id si no existe
        const taskIdToUse = matchedTask.id;
        if (
            !rect.getAttribute("data-task-id") ||
            rect.getAttribute("data-task-id") !== taskIdToUse
        ) {
            rect.setAttribute("data-task-id", taskIdToUse);
            rect.style.cursor = "pointer";
        }

        // Remover listeners previos si existen
        const existingListeners = (rect as any).__ganttListeners;
        if (existingListeners) {
            rect.removeEventListener("pointerdown", existingListeners.pointerdown);
            rect.removeEventListener("pointermove", existingListeners.pointermove);
            rect.removeEventListener("pointerup", existingListeners.pointerup);
        }

        // Estado local para este rect
        let pointerState = {
            isDown: false,
            startX: 0,
            startY: 0,
            hasMoved: false,
            startTime: 0,
            taskId: taskIdToUse,
        };

        const handlePointerDown = (e: PointerEvent) => {
            // NO usar stopPropagation aquí, solo prevenir el comportamiento por defecto si es necesario
            e.preventDefault(); // Prevenir selección de texto
            pointerState.isDown = true;
            pointerState.startX = e.clientX;
            pointerState.startY = e.clientY;
            pointerState.hasMoved = false;
            pointerState.startTime = Date.now();

            // Cancelar cualquier timeout del modal
            if (modalTimeoutRef.current) {
                clearTimeout(modalTimeoutRef.current);
                modalTimeoutRef.current = null;
            }

            // Cambiar cursor después de 200ms si se mantiene presionado
            const holdTimeout = setTimeout(() => {
                if (pointerState.isDown && !pointerState.hasMoved) {
                    rect.style.cursor = "move";
                }
            }, 200);

            (rect as any).__holdTimeout = holdTimeout;
        };

        const handlePointerMove = (e: PointerEvent) => {
            if (!pointerState.isDown) return;

            const deltaX = Math.abs(e.clientX - pointerState.startX);
            const deltaY = Math.abs(e.clientY - pointerState.startY);
            const threshold = 3; // 3px de movimiento = drag

            if (deltaX > threshold || deltaY > threshold) {
                pointerState.hasMoved = true;
                preventModalRef.current = true;

                // Cambiar cursor a move
                rect.style.cursor = "move";

                // Cancelar timeout de hold
                if ((rect as any).__holdTimeout) {
                    clearTimeout((rect as any).__holdTimeout);
                    (rect as any).__holdTimeout = null;
                }

                // Cancelar timeout del modal
                if (modalTimeoutRef.current) {
                    clearTimeout(modalTimeoutRef.current);
                    modalTimeoutRef.current = null;
                }
            }
        };

        const handlePointerUp = (e: PointerEvent) => {
            if (!pointerState.isDown) return;

            // Cancelar timeout de hold
            if ((rect as any).__holdTimeout) {
                clearTimeout((rect as any).__holdTimeout);
                (rect as any).__holdTimeout = null;
            }

            const deltaX = Math.abs(e.clientX - pointerState.startX);
            const deltaY = Math.abs(e.clientY - pointerState.startY);
            const threshold = 3;

            // Si NO hubo movimiento significativo, es un CLICK → abrir panel
            if (
                !pointerState.hasMoved &&
                deltaX < threshold &&
                deltaY < threshold
            ) {
                // Cancelar cualquier timeout previo
                if (modalTimeoutRef.current) {
                    clearTimeout(modalTimeoutRef.current);
                }

                // Abrir panel inmediatamente (sin delay para testing)
                const parts = pointerState.taskId.split("-");
                const dbIdStr = parts[4];
                if (dbIdStr) {
                    const dbId = parseInt(dbIdStr);
                    if (!Number.isNaN(dbId)) {
                        const item = planificacionItems.find((p) => p.id === dbId);
                        if (item) {
                            // Toggle: si es la misma tarea, cerrar el panel
                            if (selectedItem && selectedItem.id === item.id) {
                                setDetailsOpen(false);
                                setSelectedItem(null);
                            } else {
                                // Si es diferente, abrir con la nueva tarea
                                setSelectedItem(item);
                                setDetailsOpen(true);
                            }

                            setSelectedTaskId(pointerState.taskId);

                            // Deseleccionar la tarea
                            requestAnimationFrame(() => {
                                setTasks((prevTasks) => {
                                    const updated = prevTasks.map((t) => ({
                                        ...t,
                                        isSelected: false,
                                    }));
                                    tasksRef.current = updated;
                                    return updated;
                                });
                                setSelectedTaskId(null);
                            });
                        }
                    }
                }
            } else {
                // Hubo movimiento = drag, no abrir modal
                preventModalRef.current = true;
                setTimeout(() => {
                    preventModalRef.current = false;
                }, 500);
            }

            // Resetear estado
            pointerState.isDown = false;
            pointerState.hasMoved = false;
            rect.style.cursor = "pointer";
        };

        // Agregar listeners
        rect.addEventListener("pointerdown", handlePointerDown, {
            passive: false,
        });
        rect.addEventListener("pointermove", handlePointerMove, {
            passive: true,
        });
        rect.addEventListener("pointerup", handlePointerUp, { passive: true });

        // Guardar referencias para poder removerlos después
        (rect as any).__ganttListeners = {
            pointerdown: handlePointerDown,
            pointermove: handlePointerMove,
            pointerup: handlePointerUp,
        };
    });
};

export const handleWheelScroll = (
    e: WheelEvent,
    scrollContainer: HTMLElement
) => {
    if (!scrollContainer) return;

    // Si presiona Shift, scrolleamos horizontalmente
    if (e.shiftKey) {
        e.preventDefault();
        scrollContainer.scrollLeft += e.deltaY;
        return;
    }

    // FIX: Solo aplicar lógica de bloqueo vertical si el contenedor tiene scroll vertical
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;

    // Si el contenido entra perfectamente (o sobra espacio), no bloquear el scroll vertical
    // para que el evento burbujee a contenedores padres o al body
    if (scrollHeight <= clientHeight) return;

    // Lógica original de prevención de rebote vertical
    const deltaY = e.deltaY;

    if (deltaY === 0) return;

    const isAtTop = scrollTop <= 0;
    const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) <= 2;

    if ((isAtTop && deltaY < 0) || (isAtBottom && deltaY > 0)) {
        e.stopPropagation();
        e.preventDefault();
    }
};

export const setupDragToPan = (
    wrapper: HTMLElement,
    scrollContainer: HTMLElement
) => {
    let isMouseDown = false;
    let isDragging = false;
    let startX = 0;
    let startScrollLeft = 0;

    const handlePointerDown = (e: PointerEvent) => {
        // Solo botón izquierdo
        if (e.button !== 0) return;

        const target = e.target as HTMLElement;
        const tagName = target.tagName.toLowerCase();

        // FILTRO ESTRICTO:
        // Si el usuario hace click en algo que parece interactuable, NO iniciamos la lógica de drag
        // Esto permite que el evento siga su curso natural hacia la librería
        if (
            tagName === "rect" ||
            tagName === "text" ||
            tagName === "tspan" ||
            tagName === "circle" ||
            tagName === "path"
        ) {
            // Excepción: Si es el fondo SVG (a veces el click cae en el svg root o un g vacío)
            // Pero gantt-task-react llena todo con rects.
            // Si es una barra de tarea, definitivamente retornamos.
            if (
                target.closest(".bar-wrapper") ||
                target.getAttribute("class")?.includes("bar")
            ) {
                return;
            }
        }

        // Aún así, permitimos intentar el drag si es en el espacio vacío
        // Pero NO capturamos el puntero todavía. Esperamos a que se mueva.
        isMouseDown = true;
        isDragging = false;
        startX = e.clientX;
        startScrollLeft = scrollContainer.scrollLeft;

        // No llamamos a setPointerCapture aquí para no robar el click
    };

    const handlePointerMove = (e: PointerEvent) => {
        if (!isMouseDown || !scrollContainer) return;

        const x = e.clientX;
        const walk = x - startX;

        // Solo activamos el drag si se mueve más de 10px
        if (!isDragging && Math.abs(walk) > 10) {
            isDragging = true;
            // AHORA sí capturamos el puntero, porque el usuario claramente quiere arrastrar
            wrapper.setPointerCapture(e.pointerId);
            wrapper.style.cursor = "grabbing";
            document.body.style.userSelect = "none";
        }

        if (isDragging) {
            e.preventDefault(); // Evitar selección de texto nativa
            scrollContainer.scrollLeft = startScrollLeft - walk;
        }
    };

    const handlePointerUp = (e: PointerEvent) => {
        if (isMouseDown) {
            if (isDragging) {
                // Si estuvimos arrastrando, liberamos todo
                wrapper.releasePointerCapture(e.pointerId);
                wrapper.style.cursor = "default";
                document.body.style.userSelect = "";
            }

            isMouseDown = false;
            isDragging = false;
        }
    };

    wrapper.addEventListener("pointerdown", handlePointerDown);
    wrapper.addEventListener("pointermove", handlePointerMove);
    wrapper.addEventListener("pointerup", handlePointerUp);
    wrapper.addEventListener("pointerleave", handlePointerUp);

    return () => {
        wrapper.removeEventListener("pointerdown", handlePointerDown);
        wrapper.removeEventListener("pointermove", handlePointerMove);
        wrapper.removeEventListener("pointerup", handlePointerUp);
        wrapper.removeEventListener("pointerleave", handlePointerUp);
    };
};
