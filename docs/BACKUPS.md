# Backups de la base (RF-18 y RF-20)

**Decisión:** los backups de producción los hace **Supabase, la plataforma donde corre la base**, y no un
sistema propio adentro de la app. Este documento dice qué cubre eso, qué no, cómo se
comprueba y cómo se restaura.

**Estado al 22/09/2026:** documentado. **Desde el repo no se puede probar en qué plan de
Supabase está el proyecto.** La sección 4 dice cómo verificarlo en el panel. Hasta que alguien lo
verifique y lo anote en la sección 8, RF-18 y RF-20 quedan **cubiertos solo si el plan es Pro o
superior**.

---

## 1. Qué pide el SRS

Del SRS de la v1 (sección 3.2.7, «Respaldo y Recuperación»):

| RF | Texto | ¿Lo cubre la plataforma? |
|---|---|---|
| **RF-18** | «El sistema deberá generar backups automáticos diarios de toda la información crítica del sistema (órdenes, usuarios, inventario, reportes).» | **Sí, en Pro o superior.** En Free, no. |
| **RF-19** | «El sistema deberá permitir al administrador recuperar un backup desde una interfaz gráfica segura.» | **No, pero lo cubre la app** (desde el 23/09/2026): *Configuración → Copias de seguridad*, solo admin. Ver sección 3, punto 2. |
| **RF-20** | «El sistema deberá mantener un historial de al menos 7 versiones anteriores de los backups.» | **Sí, en Pro o superior** (Pro: 7 días = 7 versiones, justo el mínimo). En Free, no. |

Con Pro no sobra ninguna versión. Si el cliente lee «7 anteriores» como siete **además** del
backup de hoy, le falta una y hace falta Team (14 días). Conviene cerrarlo con él por escrito.

El SRS también tiene una sección **no funcional** (3.3.9) que pide más que RF-18 y RF-20. Pide
guardar los backups **30 días**, almacenamiento **externo**, **backups manuales bajo demanda**
por el administrador, **validación con hash** y un **registro de backups visible desde el panel
de administración**. El plan Pro **no llega a esto**. Está en la sección 7 por si el cliente lo
reclama.

### Qué entra en «toda la información crítica»

Todo lo que la app guarda vive en **una sola base Postgres** en Supabase: órdenes de trabajo
y sus procesos, planificación, usuarios de la app (la app tiene su propia tabla `usuario`, no
usa Supabase Auth), operarios, máquinas, materias primas y stock (`pieza`), consumos,
no conformidades, auditoría y notificaciones. No hay una tabla de reportes: los tableros y
reportes se calculan en el momento con esos datos. Por eso **un backup de la base cubre
órdenes, usuarios, inventario y reportes**, que son los cuatro que nombra RF-18.

Hay una excepción, **los archivos de los planos**. Ver sección 3.

---

## 2. Qué hace Supabase según el plan

Datos de la documentación oficial, consultada el 22/09/2026 (las fuentes están al final).

| Plan | Precio | Backup diario automático | Cuántos días guarda | PITR (add-on) | Se pausa por inactividad |
|---|---|---|---|---|---|
| **Free** | US$0 | **No** | — | No disponible | Sí, tras 1 semana sin actividad |
| **Pro** | US$25/mes | **Sí** | **7 días** | Sí, se paga aparte | No |
| **Team** | US$599/mes | Sí | 14 días | Sí, se paga aparte | No |
| **Enterprise** | a medida | Sí | hasta 30 días | Sí, se paga aparte | No |

Lo que dice la documentación, textual:

- *«We automatically back up all Pro, Team, and Enterprise Plan projects on a daily basis.»*
- *«Pro Plan projects can access the last 7 days of daily backups. Team Plan projects can access
  the last 14 days of daily backups, while Enterprise Plan projects can access up to 30 days of
  daily backups.»*
- Para Free: *«We recommend that free tier plan projects regularly export their data using the
  Supabase CLI `db dump` command and maintain off-site backups.»* O sea, **en Free no hay
  backups automáticos**. La guía de producción agrega: *«Database backups are not available for
  download for Free Plan projects.»*
- El plan es **de la organización**, no del proyecto. Todos los proyectos de una organización
  están en el mismo plan (*«Different plans cannot be mixed within a single organization»*).

### PITR (Point-in-Time Recovery)

Es un **add-on** para Pro, Team y Enterprise. En lugar de una foto por día, guarda cada cambio
(archivos WAL cada 2 minutos) y permite **volver a cualquier segundo** dentro del período
contratado. En el peor caso se pierden 2 minutos de datos. Con backup diario se puede perder
hasta un día.

| Retención de PITR | Precio por hora | Precio por mes |
|---|---|---|
| 7 días | US$0,137 | ~US$100 |
| 14 días | US$0,274 | ~US$200 |
| 28 días | US$0,55 | ~US$400 |

Condiciones que importan:
- Exige **compute Small o mayor** (*«must also use at least a Small compute add-on»*). En el
  ejemplo de facturación de Supabase, Pro + Small + PITR 7 días da **US$130/mes**.
- **Reemplaza** al backup diario, no se suma: *«If you enable PITR, we will no longer take Daily
  Backups.»*
- El **tope de gasto (Spend Cap) no lo cubre**: se cobra aunque el tope esté activo.

**Para RF-18 y RF-20 no hace falta PITR.** El backup diario de Pro alcanza. PITR solo tiene
sentido si el cliente pide perder menos de un día de datos.

---

## 3. Qué NO cubre el backup de la plataforma

1. **Los archivos de los planos.** Desde el 9/9/2026 los PDF e imágenes de los planos viven en
   el bucket `planos` de Supabase Storage. La base solo guarda la ruta
   (`plano.storage_path`, ver `backend/infrastructure/storage_planos.py`). Y Supabase lo dice
   explícito: *«Database backups do not include objects you store via the Storage API, as the
   database only includes metadata about these objects. Restoring an old backup does not
   restore objects you deleted after that backup.»* Encima, Storage **no tiene versionado**:
   *«Deleted objects are permanently removed and cannot be restored.»*
   - Si se **borra** un plano desde la app, el archivo se borra de Storage en el momento
     (`PlanoService.eliminarPlano`). Si después se restaura la base, **la fila vuelve y el
     archivo no**: el plano aparece en la lista y no abre.
   - Si se **reemplaza** un plano, el archivo viejo queda en el bucket como huérfano. Por eso
     una restauración anterior al reemplazo todavía lo encuentra.
   - Los planos que se importaron del Drive del taller tienen el original allá. **Los que se
     suben directo desde la app no tienen otra copia.**
2. **RF-19, restaurar desde la app.** El backup **de la plataforma** no se restaura desde
   MetloSys: se restaura desde el panel de Supabase, y solo puede hacerlo alguien que sea
   **miembro de la organización de Supabase** con rol Owner, Administrator o Developer (el rol
   Read-Only no puede). Un usuario administrador de la app **no tiene** ese acceso.

   Para RF-19 la app tiene **su propia copia**, aparte (23/09/2026): *Configuración → Copias de
   seguridad*, solo para el admin (`backend/infrastructure/copias_de_seguridad.py`, el porqué
   completo está ahí). El admin baja un `spmm_backup_<fecha>.zip` con todas las tablas y lo puede
   volver a cargar. Al cargarlo, el archivo se revisa entero antes de tocar nada (versión, hash
   por tabla, tipos, tamaño, y la **firma** del servidor: un HMAC sobre el manifiesto con una
   clave que sale de `SECRET_KEY`) y se muestra qué cambia; se confirma escribiendo RESTAURAR;
   antes de pisar nada se guarda sola una copia de lo que había en el bucket `planos`, carpeta
   `copias-de-seguridad/` (que la pantalla de planos no sirve ni borra); y se restaura en
   **una** transacción (si algo falla, no cambia nada).
   Lo que **no** hace: no trae los archivos de los planos (mismo problema que el punto 1), no
   trae contraseñas ni tokens de recuperación, y por defecto no toca usuarios, roles, permisos
   ni la auditoría. Una copia sin firma válida (editada, o de otra instalación o de otra
   `SECRET_KEY`) se puede restaurar sólo confirmándolo aparte y **nunca** con los usuarios.
   Cada descarga (anotada antes del primer byte, aunque se corte), cada intento rechazado y
   cada restauración quedan en la Auditoría. **Si cambia `SECRET_KEY`, las copias anteriores
   dejan de estar firmadas** para el servidor nuevo.
3. **Restaurar una sola OT o una sola tabla.** El backup se restaura **entero**: vuelve toda la
   base al momento del backup y se pierde todo lo cargado después. Para recuperar solo unas
   filas está «Restore to a new project» (sección 5.B).
4. **Borrar el proyecto borra los backups.** *«When you delete a project, we permanently remove
   all associated data, including any backups stored in S3.»* Los backups no son una copia
   fuera de Supabase.
5. **El sistema viejo (SQL Server del taller).** Queda fuera de todo esto. Sus backups son
   aparte.

---

## 4. Cómo verificar el plan y la retención (lo tiene que hacer Julián)

Hacen falta unos 5 minutos con la cuenta dueña de la organización de Supabase. Los links con
`_` abren la organización o el proyecto que esté elegido en el panel.

1. Entrar a <https://supabase.com/dashboard> y elegir la **organización** donde está el proyecto
   de producción (región São Paulo). Si hay varias organizaciones, el proyecto correcto es el
   que aparece en `SUPABASE_DB_URL`: con el pooler, el usuario de esa URL es `postgres.<ref>` y
   `<ref>` es el identificador del proyecto. **Esa URL tiene la contraseña: no copiarla a
   ningún lado.**
2. **Plan:** ir a *Organization settings → Billing*
   (<https://supabase.com/dashboard/org/_/billing>) y mirar la sección **Subscription Plan**.
   Tiene que decir **Pro** (o Team/Enterprise). Si dice **Free**, ir a la sección 6.
3. **Backups diarios:** entrar al proyecto e ir a *Database → Backups → Scheduled backups*
   (<https://supabase.com/dashboard/project/_/database/backups/scheduled>). Tiene que haber
   **un backup por día**: 7 en Pro, 14 en Team. Revisar que **el más nuevo sea de hoy o de
   ayer**. Si el último tiene varios días, los backups se cortaron y hay que abrir un ticket a
   Supabase.
4. **PITR y compute:** ir a *Project Settings → Add-ons*
   (<https://supabase.com/dashboard/project/_/settings/addons>). Si PITR está activo, no va a
   haber lista de backups diarios. En su lugar está la pestaña *Point in time*, que muestra el
   punto más viejo y el más nuevo al que se puede volver.
5. **Quién puede restaurar:** en *Organization settings → Team* ver quiénes son miembros y con
   qué rol. Owner, Administrator y Developer pueden restaurar la base entera. Conviene que sean
   pocos.
6. **Anotarlo** en la tabla de la sección 8: fecha, plan, cuántos backups había, el más viejo y
   el más nuevo. Esa tabla es la evidencia para el cliente de que RF-18 y RF-20 se cumplen.

Hay una alternativa sin panel. La Management API lista los backups:
`GET https://api.supabase.com/v1/projects/<ref>/database/backups`, con un token personal de
<https://supabase.com/dashboard/account/tokens>. **Ese token da acceso a toda la cuenta:
no va al repo, ni al `.env`, ni a Cloud Run.**

---

## 5. Cómo se restaura hoy

### A. Volver toda la base a un backup (en el mismo proyecto)

*Database → Backups → Scheduled backups*, elegir el backup y confirmar. Si hay PITR, *Point in
time → Start a restore* y elegir fecha y hora.

Qué pasa (según Supabase):
- **El proyecto queda inaccesible mientras dura** (*«The project is inaccessible during this
  process, so plan for downtime beforehand»*). MetloSys está caída durante ese rato. Cuánto
  tarda depende del tamaño de la base.
- **Se pierde todo lo cargado después del backup.** Supabase recomienda elegir *«the closest
  available backup made before your desired restore point»*.
- El panel avisa cuando terminó.

Antes de restaurar:
1. Avisar al taller que la app va a estar caída y que se pierde lo cargado desde la hora del
   backup. Si lo cargado después importa, anotarlo aparte para volver a cargarlo.
2. Si el problema son unas pocas filas borradas o pisadas, **no hacer esto**: usar la opción B.

Después de restaurar:
1. **Reiniciar el backend** (una revisión nueva en Cloud Run, o un redeploy). Si el backup es
   anterior a una columna que agregó `backend/infrastructure/migraciones.py`, la base vuelve sin
   esa columna y **se rompe la lectura de todas las OT**. Las migraciones se aplican solas
   **al arrancar** el backend, así que un arranque nuevo las vuelve a poner. Sin reinicio, las
   instancias que ya estaban andando no las aplican.
2. **Revisar los planos:** abrir algunos de los últimos días. Los que se borraron después del
   backup vuelven en la lista y no abren (sección 3.1).
3. **No correr `migrar_planos_a_storage --huerfanos --aplicar` después de restaurar.** Los
   archivos subidos después del backup quedan en el bucket sin fila que los use y ese comando
   los borraría. Muchas veces son la única copia.
4. Si el backend se conecta con un **rol de Postgres propio**, hay que resetearle la contraseña.
   Los backups diarios no guardan contraseñas de roles propios. Con el usuario `postgres` del
   proyecto (el `postgres.<ref>` del pooler) esto no aplica.

### B. Recuperar datos sin tocar producción: «Restore to a new project»

*Database → Backups → Restore to a New Project*
(<https://supabase.com/dashboard/project/_/database/backups/restore-to-new-project>). Crea **un
proyecto nuevo** con la base tal como estaba en ese backup y deja producción intacta. Sirve
para mirar cómo estaba una OT y copiar a mano las filas que hagan falta.

- Solo en planes pagos y con backups físicos. El proyecto nuevo **se cobra aparte** mientras
  exista, y el panel muestra el costo antes de confirmar. Borrarlo cuando se termine.
- **No copia Storage:** el proyecto nuevo no tiene los archivos de los planos.
- Supabase lo marca como beta.

### Lo que NO hay que hacer

- **No resetear la contraseña de la base** aunque una guía de Supabase lo pida para
  `db dump`. El backend de producción se conecta con esa contraseña. Si se cambia, se cae
  hasta que se actualice la variable en Cloud Run y se redeploye.
- **No restaurar un backup con la idea de «deshacer» algo de hace más de 7 días** (en Pro):
  ese backup ya no existe.

---

## 6. Si el proyecto está en Free

En Free **no hay backups automáticos**. RF-18 y RF-20 **no se cumplen**. Además, Supabase puede
pausar un proyecto Free con poca actividad durante 7 días.

**Qué contratar:** pasar la **organización** a **Pro (US$25/mes)**. Es el plan más barato con
backup diario, y sus 7 días son justo lo que pide RF-20.
1. *Organization settings → Billing → Subscription Plan → Change subscription plan* → Pro. El
   cambio es inmediato y el panel muestra el costo antes de confirmar.
2. Al día siguiente, confirmar que apareció el primer backup en *Scheduled backups*
   (sección 4, paso 3).
3. **A los 7 días**, confirmar que hay 7 backups y recién ahí dar RF-20 por cumplido.
   Anotarlo en la sección 8.

Igual hay un indicio en contra de que esté en Free, aunque **no es una prueba**. El código se
escribió suponiendo Pro: los comentarios de `storage_planos.py` y de la migración
`2026-09-09_planos_en_storage.sql` hacen las cuentas con lo que incluye el plan Pro, y
`backend/scripts/planos/importar_planos.py` habla de «los 8 GB de disco que el plan Pro le da
a ESTE proyecto». Además, los ~600 MB de planos que llegaron a estar dentro de la base no
entran en los 500 MB de base que da Free. Con eso alcanza para sospechar que no es Free, no
para afirmarlo: son comentarios, nadie los comprobó contra el panel. El panel es lo que decide.

**Alternativa mínima sin pagar (no recomendada):** es lo que la propia Supabase sugiere para
Free. Un `supabase db dump` todas las noches, desde una máquina o un CI, guardando las últimas
7 copias fuera de Supabase. Los comandos están en la guía oficial *Backup and Restore using the
CLI* (roles, esquema y datos por separado). Tiene estos problemas:
- Las credenciales de la base de producción tienen que vivir en esa máquina o en ese CI. Este
  repo es público: **nunca en un workflow del repo con la URL a la vista**.
- Ocupa una de las **15 conexiones** del session pooler, que el backend puede usar enteras.
  Tiene que correr de noche, cuando el taller no trabaja.
- Si falla, nadie se entera hasta el día que hace falta.
- No copia los planos de Storage.
- Restaurar es manual, con `psql`, en un proyecto nuevo.

Por US$25/mes, Pro resuelve todo eso y además saca el riesgo de pausa.

---

## 7. Si el cliente pide más que RF-18 y RF-20

| Si pide… | Opción de plataforma | Qué supone |
|---|---|---|
| Guardar **14 días** | Plan Team | US$599/mes |
| Guardar **30 días** (RNF 3.3.9) | Enterprise (hasta 30) o PITR de 28 días | Enterprise a medida; PITR ~US$400/mes + compute Small |
| **Perder menos de un día** de datos | PITR 7 días | ~US$100/mes + compute Small |
| **Restaurar desde la app** (RF-19) | Ninguna: la plataforma no lo ofrece | **Hecho en la app** (23/09/2026, sección 3 punto 2): copia propia, no la de la plataforma |
| **Backups manuales**, **registro en el panel de admin**, **hash** (RNF 3.3.9) | Ninguna desde la app | Manuales bajo demanda y hash por tabla: **hechos en la app** (RF-19); el registro es la Auditoría (quién bajó o restauró qué). Guardarlos 30 días fuera de Supabase sigue siendo aparte |
| **Planos incluidos** en el backup | Ninguna: Storage no se respalda y no tiene versionado | Copia periódica del bucket a otro lugar (Supabase expone Storage por S3, sirve `rclone`). Desarrollo o tarea aparte |

Cualquier fila de esta tabla es una decisión del cliente con costo. Este documento no la da
por tomada.

---

## 8. Registro de verificaciones

La completa quien revise el panel (sección 4). Una fila por verificación.

| Fecha | Quién | Plan de la organización | PITR | Backups listados | Más viejo | Más nuevo | Notas |
|---|---|---|---|---|---|---|---|
| _pendiente_ | | | | | | | |

---

## Fuentes

Documentación oficial de Supabase, consultada el 22/09/2026:

- Database Backups (retención por plan, PITR, restauración, qué no incluye): <https://supabase.com/docs/guides/platform/backups>
- Precios y comparación de planes: <https://supabase.com/pricing>
- Costo de PITR y ejemplos de facturación: <https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery>
- Restore to a new project: <https://supabase.com/docs/guides/platform/clone-project>
- Roles y quién puede restaurar: <https://supabase.com/docs/guides/platform/access-control>
- Production checklist (Free: sin descarga de backups, pausa por inactividad): <https://supabase.com/docs/guides/deployment/going-into-prod>
- Storage sin versionado: <https://supabase.com/docs/guides/storage/s3/compatibility>
- Descarga masiva de Storage (S3, rclone): <https://supabase.com/docs/guides/storage/management/download-objects>
- Backup y restore con la CLI (`db dump`): <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>
- Cambiar de plan: <https://supabase.com/docs/guides/platform/manage-your-subscription>
- Facturación por organización: <https://supabase.com/docs/guides/platform/billing-on-supabase>
- Management API, listar backups: <https://supabase.com/docs/reference/api/v1-list-all-backups>

### Verificación del 23/09/2026

Verificado desde el conector de Supabase, en solo lectura: la organización «metlo» está en **plan Pro** y el proyecto de producción (sa-east-1) está activo y sano. Con Pro hay backup diario con 7 días de retención, así que RF-18 y RF-20 quedan cubiertos. Julián también lo confirmó.
