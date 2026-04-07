# Database Schema — SPMM
> Microsoft SQL Server 2019 · Schema: `dbo` · Base de datos: `METLO`

---

## Índice de tablas

| Tabla | Descripción |
|---|---|
| [articulo](#articulo) | Catálogo de artículos/productos |
| [cliente](#cliente) | Clientes de la empresa |
| [estado_proceso](#estado_proceso) | Estados posibles de un proceso |
| [maquinaria](#maquinaria) | Máquinas disponibles en planta |
| [notificacion](#notificacion) | Notificaciones del sistema |
| [operario](#operario) | Personal de planta |
| [operario_proceso_skill](#operario_proceso_skill) | Habilidades de operarios por proceso |
| [operario_rango](#operario_rango) | Rangos asignados a operarios |
| [orden_trabajo](#orden_trabajo) | Órdenes de trabajo (OT) — tabla central |
| [orden_trabajo_pieza](#orden_trabajo_pieza) | Piezas/materiales requeridos por OT |
| [orden_trabajo_proceso](#orden_trabajo_proceso) | Procesos asignados a cada OT |
| [ots_validas](#ots_validas) | Vista/tabla de OTs válidas para sincronización |
| [pieza](#pieza) | Catálogo de piezas y materiales con stock |
| [planificacion](#planificacion) | Planificación de procesos (scheduling) |
| [plano](#plano) | Archivos de planos vinculados a OTs |
| [prioridad](#prioridad) | Niveles de prioridad |
| [proceso](#proceso) | Catálogo de procesos productivos |
| [rango](#rango) | Rangos/categorías de operarios |
| [rango_maquinaria](#rango_maquinaria) | Relación rangos ↔ maquinaria habilitada |
| [rango_proceso](#rango_proceso) | Relación rangos ↔ procesos habilitados |
| [sector](#sector) | Sectores de la planta |
| [usuario](#usuario) | Usuarios del sistema |

---

## articulo

Catálogo de artículos que se fabrican o reparan.

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | int | NO | — | PK |
| `cod_articulo` | varchar(255) | NO | — | Código único del artículo |
| `descripcion` | varchar(MAX) | NO | — | Descripción completa |
| `abreviatura` | varchar(100) | NO | — | Nombre corto |

---

## cliente

Clientes para quienes se ejecutan las órdenes de trabajo.

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | int | NO | — | PK |
| `nombre` | varchar(150) | YES | — | Razón social |
| `fantasia` | varchar(150) | YES | — | Nombre de fantasía |
| `abreviatura` | varchar(50) | YES | — | Nombre corto |
| `direccion` | varchar(200) | YES | — | |
| `localidad` | varchar(100) | YES | — | |
| `cuit` | varchar(20) | YES | — | |
| `telefono` | varchar(50) | YES | — | |
| `celular` | varchar(50) | YES | — | |
| `mail` | varchar(150) | YES | — | |
| `web` | varchar(150) | YES | — | |
| `obs` | varchar(500) | YES | — | Observaciones |
| `id_viejo` | int | YES | — | ID del sistema legado |

---

## estado_proceso

Lookup de estados posibles para un proceso dentro de una OT.

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | int | NO | — | PK |
| `descripcion` | varchar(50) | NO | — | Ej: Pendiente, En proceso, Finalizado |

---

## maquinaria

Máquinas disponibles en planta, con capacidades y limitaciones.

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | int | NO | — | PK |
| `nombre` | varchar(100) | NO | — | |
| `cod_maquina` | nvarchar(50) | YES | — | Código interno |
| `limitacion` | nvarchar(255) | YES | — | Restricciones operativas |
| `capacidad` | nvarchar(255) | YES | — | Capacidad máxima |
| `especialidad` | nvarchar(255) | YES | — | Tipo de trabajo que realiza |

---

## notificacion

Notificaciones generadas por el sistema hacia los usuarios.

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id_notificacion` | int | NO | — | PK |
| `mensaje` | nvarchar(500) | NO | — | Texto de la notificación |
| `tipo` | nvarchar(50) | NO | — | Categoría/tipo |
| `leida` | bit | NO | `0` | Si fue leída |
| `motivo` | nvarchar(MAX) | YES | — | Detalle adicional |
| `fecha_creacion` | datetime | NO | `getutcdate()` | |
| `id_usuario_creador` | int | YES | — | FK → usuario.id_usuario |

---

## operario

Personal de planta que ejecuta los procesos.

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | int | NO | — | PK |
| `nombre` | varchar(100) | NO | — | |
| `apellido` | varchar(100) | NO | — | |
| `dni` | varchar(150) | YES | — | |
| `fecha_nacimiento` | date | YES | — | |
| `fecha_ingreso` | date | YES | — | |
| `sector` | varchar(30) | YES | — | Sector al que pertenece (texto libre) |
| `categoria` | varchar(100) | NO | — | |
| `disponible` | bit | NO | — | Si está disponible para asignación |
| `telefono` | nvarchar(150) | YES | — | |
| `celular` | nvarchar(150) | YES | — | |
| `email` | nvarchar(150) | YES | — | |

---

## operario_proceso_skill

Habilidades de cada operario en procesos específicos, con nivel de competencia.

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id_operario` | int | NO | — | FK → operario.id |
| `id_proceso` | int | NO | — | FK → proceso.id |
| `nivel` | smallint | NO | `0` | Nivel de habilidad (0–N) |
| `habilitado` | bit | NO | `1` | Si está habilitado para ese proceso |

**PK compuesta:** (`id_operario`, `id_proceso`)

---

## operario_rango

Rangos/categorías asignados a cada operario (relación N:M).

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id_operario` | int | NO | — | FK → operario.id |
| `id_rango` | int | NO | — | FK → rango.id |

**PK compuesta:** (`id_operario`, `id_rango`)

---

## orden_trabajo

**Tabla central del sistema.** Cada fila es una Orden de Trabajo (OT).

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | int | NO | — | PK |
| `id_otvieja` | int | NO | — | ID en el sistema legado |
| `observaciones` | nvarchar(MAX) | NO | — | Descripción principal de la OT |
| `detalle` | varchar(MAX) | YES | — | Detalle adicional |
| `obspaniol` | nvarchar(500) | YES | — | Observaciones del panel/pañol |
| `id_prioridad` | int | NO | — | FK → prioridad.id |
| `id_sector` | int | NO | — | FK → sector.id |
| `id_articulo` | int | NO | — | FK → articulo.id |
| `id_cliente` | int | YES | — | FK → cliente.id |
| `fecha_orden` | date | NO | — | Fecha de creación |
| `fecha_entrada` | date | NO | — | Fecha de ingreso a planta |
| `fecha_prometida` | date | NO | — | Fecha comprometida de entrega |
| `fecha_entrega` | date | YES | — | Fecha real de entrega |
| `unidades` | int | NO | `0` | Cantidad solicitada |
| `cantidad_entregada` | decimal(18,2) | NO | `0` | Cantidad ya entregada |
| `requerido` | nvarchar(50) | YES | — | Quién lo requirió |
| `requerido_por` | nvarchar(100) | YES | — | Nombre del requirente |
| `aprobado` | nvarchar(50) | YES | — | Estado de aprobación |
| `aprobado_por` | nvarchar(100) | YES | — | Quien aprobó |
| `n_pedido` | nvarchar(100) | YES | — | Número de pedido externo |
| `n_ped_l` | nvarchar(100) | YES | — | Número de pedido local |
| `subsector` | nvarchar(100) | YES | — | Subsector de la OT |
| `remitos_salida` | nvarchar(200) | YES | — | Remitos de salida asociados |
| `f_disp_material` | datetime2 | YES | — | Fecha disponibilidad de material |
| **Flags de estado** | | | | |
| `reclamo` | bit | NO | `0` | Si tiene reclamo |
| `revisada` | bit | NO | `0` | Si fue revisada |
| `finalizadoparcial` | bit | NO | `0` | Finalización parcial |
| `finalizadototal` | bit | NO | `0` | Finalización total |
| `programada` | bit | YES | `0` | Si fue programada |
| `en_proceso` | bit | YES | `0` | Si está en proceso |
| `suspendida` | bit | YES | `0` | Si está suspendida |
| `email` | bit | YES | `0` | Si se envió email al cliente |
| `tiene_plano` | bit | YES | `0` | Si tiene plano adjunto |
| **Flags de tipo** | | | | |
| `fabricacion` | bit | YES | `0` | OT de fabricación |
| `reparacion` | bit | YES | `0` | OT de reparación |
| `sin_cargo` | bit | YES | `0` | Sin cargo al cliente |
| `stock` | bit | YES | `0` | Para stock interno |
| `interno` | bit | YES | `0` | Uso interno |
| `tercerizado_total` | bit | YES | `0` | Completamente tercerizado |
| `tercerizado_parcial` | bit | YES | `0` | Parcialmente tercerizado |

---

## orden_trabajo_pieza

Piezas y materiales requeridos para cada OT.

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | int | NO | — | PK |
| `id_orden_trabajo` | int | NO | — | FK → orden_trabajo.id |
| `id_pieza` | int | NO | — | FK → pieza.id |
| `cantidad` | decimal(18,2) | NO | `0` | Cantidad requerida |
| `cantusada` | decimal(18,2) | NO | `0` | Cantidad efectivamente usada |
| `unidad` | nvarchar(25) | NO | — | Unidad de medida |
| `pedido` | bit | NO | `0` | Si fue pedida al proveedor |
| `disponible` | bit | NO | `0` | Si está disponible en stock |

---

## orden_trabajo_proceso

Procesos productivos asignados a cada OT, con tracking de ejecución.

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id_orden_trabajo` | int | NO | — | FK → orden_trabajo.id |
| `id_proceso` | int | NO | — | FK → proceso.id |
| `orden` | int | NO | — | Secuencia de ejecución |
| `id_estado` | int | NO | — | FK → estado_proceso.id |
| `tiempo_proceso` | int | YES | — | Tiempo estimado (minutos) |
| `observaciones` | varchar(MAX) | YES | — | |
| `inicio_real` | datetime | YES | — | Inicio real de ejecución |
| `fin_real` | datetime | YES | — | Fin real de ejecución |
| `cant_operarios` | int | NO | `1` | Operarios asignados |

**PK compuesta:** (`id_orden_trabajo`, `id_proceso`)

---

## ots_validas

Tabla/vista auxiliar con las OTs que son válidas para sincronización.

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id_ot` | int | NO | — | FK → orden_trabajo.id |

---

## pieza

Catálogo de piezas y materiales con control de stock.

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | int | NO | — | PK |
| `cod_pieza` | nvarchar(20) | NO | — | Código único |
| `descripcion` | nvarchar(255) | NO | — | |
| `unitario` | decimal(18,2) | NO | — | Precio unitario |
| `unidad` | nvarchar(10) | NO | — | Unidad de medida |
| `stockactual` | decimal(18,2) | NO | `0` | Stock disponible |
| `observaciones` | nvarchar(500) | YES | — | |
| `proveedor` | nvarchar(100) | YES | — | |
| `material` | nvarchar(100) | YES | — | Tipo de material |
| `formato` | nvarchar(100) | YES | — | Formato/presentación |
| `estante` | nvarchar(20) | YES | — | Ubicación física |
| `letra` | nvarchar(5) | YES | — | Letra de ubicación |
| `nro` | int | YES | — | Número de ubicación |
| `id_otvieja` | int | YES | — | Referencia al sistema legado |

---

## planificacion

Scheduling de procesos: asigna cada proceso de una OT a un operario/máquina en una franja horaria.

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | int | NO | — | PK |
| `id_planificacion_lote` | uniqueidentifier | NO | `newid()` | Agrupa planificaciones del mismo lote |
| `descripcion_lote` | nvarchar(255) | YES | — | Descripción del lote |
| `orden_id` | int | NO | — | FK → orden_trabajo.id |
| `proceso_id` | int | NO | — | FK → proceso.id |
| `id_operario` | int | YES | — | FK → operario.id (puede ser nulo si sin_asignar) |
| `id_rango_operario` | int | YES | — | FK → rango.id |
| `id_maquinaria` | int | YES | — | FK → maquinaria.id |
| `sin_maquinaria` | bit | YES | `0` | Si no requiere máquina |
| `sin_asignar` | bit | YES | `0` | Si aún no tiene operario asignado |
| `inicio_min` | int | NO | — | Inicio en minutos desde epoch de planificación |
| `fin_min` | int | NO | — | Fin en minutos |
| `duracion_min` | int | NO | — | Duración en minutos |
| `prioridad_peso` | int | NO | — | Peso de prioridad para el scheduler |
| `fecha_prometida` | date | YES | — | Fecha límite del proceso |
| `nombre_proceso` | nvarchar(255) | YES | — | Copia desnormalizada del nombre |
| `rangos_permitidos` | nvarchar(MAX) | YES | — | JSON/texto con rangos habilitados |
| `creado_en` | datetime2 | YES | `sysdatetime()` | |

---

## plano

Archivos de planos técnicos vinculados a órdenes de trabajo.

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | int | NO | — | PK |
| `id_orden_trabajo` | int | NO | — | FK → orden_trabajo.id |
| `nombre` | varchar(255) | NO | — | Nombre del archivo |
| `descripcion` | varchar(500) | YES | — | |
| `tipo_archivo` | varchar(20) | YES | — | Extensión (pdf, dwg, etc.) |
| `archivo` | varbinary(MAX) | NO | — | Contenido binario del archivo |
| `fecha_subida` | datetime | YES | `getdate()` | |

---

## prioridad

Lookup de niveles de prioridad para las OTs.

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | int | NO | — | PK |
| `descripcion` | varchar(100) | NO | — | Ej: Urgente, Normal, Baja |
| `detalle` | varchar(255) | YES | — | Descripción ampliada |

---

## proceso

Catálogo de procesos productivos disponibles en planta.

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | int | NO | — | PK |
| `nombre` | varchar(255) | YES | — | Nombre del proceso |
| `descripcion` | text | YES | — | Descripción detallada |

---

## rango

Rangos/categorías que agrupan operarios y definen qué procesos y máquinas pueden usar.

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | int | NO | — | PK |
| `nombre` | nvarchar(50) | NO | — | Ej: Tornero, Soldador, etc. |

---

## rango_maquinaria

Qué rangos pueden operar cada máquina (relación N:M).

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id_rango` | int | NO | — | FK → rango.id |
| `id_maquinaria` | int | NO | — | FK → maquinaria.id |

---

## rango_proceso

Qué rangos pueden ejecutar cada proceso (relación N:M).

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id_rango` | int | NO | — | FK → rango.id |
| `id_proceso` | int | NO | — | FK → proceso.id |

---

## sector

Sectores de la planta a los que se asignan las OTs.

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | int | NO | — | PK |
| `nombre` | varchar(100) | NO | — | Nombre del sector |

---

## usuario

Usuarios del sistema con autenticación y roles.

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id_usuario` | int | NO | — | PK |
| `username` | nvarchar(50) | NO | — | Nombre de usuario único |
| `email` | nvarchar(100) | NO | — | |
| `password_hash` | nvarchar(255) | NO | — | Hash de contraseña |
| `nombre` | nvarchar(100) | NO | — | |
| `apellido` | nvarchar(100) | NO | — | |
| `rol` | nvarchar(20) | NO | `'admin'` | Ej: admin, operador, etc. |
| `activo` | bit | NO | `1` | Si la cuenta está activa |
| `reset_token` | nvarchar(255) | YES | — | Token para reset de contraseña |
| `reset_token_expiry` | datetime | YES | — | Expiración del token |
| `fecha_creacion` | datetime | NO | `getdate()` | |
| `fecha_actualizacion` | datetime | YES | — | |
| `ultimo_login` | datetime | YES | — | |
| `creado_por` | int | YES | — | FK → usuario.id_usuario |
| `actualizado_por` | int | YES | — | FK → usuario.id_usuario |

---

## Relaciones principales (FK inferidas del schema)

```
orden_trabajo
  ├── id_prioridad       → prioridad.id
  ├── id_sector          → sector.id
  ├── id_articulo        → articulo.id
  └── id_cliente         → cliente.id (nullable)

orden_trabajo_proceso
  ├── id_orden_trabajo   → orden_trabajo.id
  ├── id_proceso         → proceso.id
  └── id_estado          → estado_proceso.id

orden_trabajo_pieza
  ├── id_orden_trabajo   → orden_trabajo.id
  └── id_pieza           → pieza.id

planificacion
  ├── orden_id           → orden_trabajo.id
  ├── proceso_id         → proceso.id
  ├── id_operario        → operario.id
  ├── id_rango_operario  → rango.id
  └── id_maquinaria      → maquinaria.id

plano
  └── id_orden_trabajo   → orden_trabajo.id

operario_proceso_skill
  ├── id_operario        → operario.id
  └── id_proceso         → proceso.id

operario_rango
  ├── id_operario        → operario.id
  └── id_rango           → rango.id

rango_proceso
  ├── id_rango           → rango.id
  └── id_proceso         → proceso.id

rango_maquinaria
  ├── id_rango           → rango.id
  └── id_maquinaria      → maquinaria.id

notificacion
  └── id_usuario_creador → usuario.id_usuario

ots_validas
  └── id_ot              → orden_trabajo.id
```

---

## Notas para el agente

- **`orden_trabajo`** es la entidad central. Casi todo se relaciona con ella.
- Los flags booleanos (`fabricacion`, `reparacion`, `stock`, `interno`, etc.) son mutuamente excluyentes por convención pero no hay constraint en DB — verificar lógica de negocio al escribir.
- `id_otvieja` en `orden_trabajo` y `pieza` referencia el sistema legado; no tiene FK definida.
- `planificacion.inicio_min` / `fin_min` son offsets en minutos relativo al inicio del lote de planificación, no timestamps absolutos.
- `planificacion.id_planificacion_lote` (uniqueidentifier) agrupa todas las filas generadas en una misma corrida del scheduler.
- `plano.archivo` almacena el binario del archivo directamente en la DB (varbinary MAX).
- `sysdiagrams` es una tabla de sistema de SQL Server, ignorar para lógica de negocio.