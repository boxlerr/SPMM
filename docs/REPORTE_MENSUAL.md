# Reporte mensual (RF-21)

**Qué pide el SRS:** «El sistema deberá generar reportes mensuales de producción, eficiencia por
operario, consumo de materiales y uso de maquinaria».

**Qué pidió Julián (23/09/2026):** que se genere desde el Dashboard, y que el envío por mail se
configure al final del proyecto, junto con el de RF-04. Por eso:

- **Hecho:** el botón **«Reporte mensual»** del Dashboard, la pantalla del reporte
  (`/dashboard/reporte-mensual?anio=2026&mes=8`) y su exportación a PDF, Excel y CSV.
- **Preparado, NO activado:** la función que arma el mail. No manda nada, no hay ningún cron
  creado y no hay ninguna ruta interna registrada. La sección 4 dice qué falta para activarlo.

---

## 1. Qué trae

Un mes del taller **comparado con el mes anterior**. Cada parte sale de la cuenta que ya existe
para esa pantalla; no hay una segunda cuenta de nada.

| Parte | Qué muestra | De dónde sale |
|---|---|---|
| Órdenes | ingresadas, entregadas, a tiempo / con atraso (y días de atraso promedio), abiertas y atrasadas al cierre, ranking de clientes | las fechas de la OT (`infrastructure/estado_ordenes.py`); «atrasada» es la regla del aviso de RF-04 |
| Producción | horas efectivas por proceso y por OT, estimado vs. real (desvío %) de los pasos terminados en el mes, pausas y motivos | los tiempos efectivos de RF-06 (`TiempoEfectivo`, `TiemposOperarioService.medir`) y las pausas de RF-03 |
| Personas | horas trabajadas, tareas completadas, promedio por tarea, eficiencia y ausencias de cada persona | el reporte de rendimiento de RF-07 (`RendimientoOperarioService.reporte`) con el mes como período |
| Calidad | no conformidades del mes, piezas rechazadas de cuántas controladas (% de rechazo), minutos perdidos; por tipo, por gravedad y —con la sección «Rendimiento por persona»— por persona | RF-12 (`IncidenciaProcesoRepository.buscar/resumen`) |
| Materiales | consumo del mes por material y por OT (sin los anulados; no se suman unidades distintas) | RF-15 (`consumo_material`) |
| Máquinas | horas de uso efectivas por máquina y mantenimientos hechos en el mes: ver sección 5 | RF-10 (`UsoMaquinaService.horas_por_maquina`, `maquina_mantenimiento_hecho`) |

El código: `backend/application/ReporteMensualService.py` (la cuenta, el CSV y el mail) y
`GET /api/dashboard/reporte-mensual?anio=AAAA&mes=M` en `backend/presentation/DashboardAPI.py`.
La pantalla: `frontend/src/app/dashboard/reporte-mensual/page.tsx` y `frontend/src/lib/reporteMensual.ts`.

### El mes

`[día 1 00:00, día 1 del mes siguiente 00:00)` en hora del taller, sin zona, como todas las
fechas de la base. **Una OT entregada el 31 a las 23:30 es de ese mes.** No se usa el reloj de
la base (Supabase corre en UTC). Un mes que todavía no terminó se corta en «ahora» y el reporte
lo dice. Un mes que no empezó no se arma (422).

### Lo que el reporte avisa

- Las OT **finalizadas sin fecha de entrega** no se sabe en qué mes salieron: no cuentan en
  ningún mes y el reporte dice cuántas son.
- Las no conformidades cargadas **antes del 22/09/2026** quedaron en UTC (3 horas adelante): las
  de las últimas horas de un mes pueden figurar en el siguiente. No se corrigen: es dato del
  cliente.
- Las horas **por persona** no tienen por qué sumar lo mismo que las horas **por proceso**: un
  paso se le cuenta a quien lo tiene elegido o a quien le dio el último plan (atribución, no
  registro), y un paso de dos personas son dos personas trabajando.

## 2. Quién ve qué

La ruta pide el área **Dashboard** (`core/permisos_rutas.py`, excepción de la política
«dashboard»). Adentro, cada parte pide lo mismo que la pantalla o la tarjeta que la muestra
afuera (`ReporteMensualService.alcance_de`). **Lo que no se puede ver no se lee ni se manda.**

| Parte | Pide |
|---|---|
| Órdenes, producción | Operaciones |
| Ranking de clientes | además Clientes |
| Pausas | Operaciones (política «pausas») |
| Personas | la sección confidencial **«Rendimiento por persona»** |
| Ausencias de cada persona | además Recursos u Operaciones (el motivo puede ser una enfermedad) |
| Calidad | No conformidades |
| Materiales | Operaciones (política «consumos_material») |
| Máquinas | Operaciones o Recursos |

Hoy todos los usuarios son admin, así que todos ven todo.

## 3. Exportar

Desde la pantalla, con el botón **Exportar** de siempre (`ExportarMenu`, RF-22):

- **PDF**: portada con el logo, el mes y con qué se compara; después cada parte con sus
  indicadores y sus tablas con totales; al final, cómo se cuenta cada cosa.
- **Excel**: una hoja por tabla, con los números como números (se suman y se filtran), una hoja
  «Resumen» con este mes, el anterior y la diferencia, y la hoja «Datos del reporte».
- **CSV**: todo junto desde el botón de arriba, o **una parte sola** desde el botón de cada parte.

## 4. El mail (preparado, NO activado)

### Qué hay

```python
from backend.application.ReporteMensualService import (
    armar_mail_del_reporte, preparar_mails_del_mes,
)

mails = await preparar_mails_del_mes(db)          # el mes que cerró, para los admin
# [{"para": [...], "asunto": "SPMM · Reporte mensual de agosto de 2026",
#   "html": "...", "texto": "...", "link": ".../dashboard/reporte-mensual?anio=2026&mes=8",
#   "adjuntos": [{"nombre": "reporte_mensual_2026-08.csv", "tipo": "text/csv; charset=utf-8",
#                 "contenido": b"..."}],
#   "enviado": False}]
```

- **Asunto:** `SPMM · Reporte mensual de <mes> de <año>`.
- **Cuerpo:** HTML con el resumen de cada parte (este mes, el anterior y la diferencia), los
  avisos del reporte y un botón a la pantalla, donde están el PDF y el Excel. También va el texto
  plano.
- **Adjunto:** el CSV del reporte (`;` y BOM, para el Excel del taller). **El PDF y el Excel no
  se adjuntan:** se arman en el navegador. Adjuntarlos pide armarlos en el servidor (una librería
  más en la imagen de Cloud Run). Es una decisión que queda pendiente.
- **No manda nada:** no hay ninguna llamada a Resend ni a nadie. `enviado` es siempre `False`.

### Cómo se va a disparar (cuando se configure con RF-04)

Es el mismo patrón que `/internal/alertas` (RF-04 y RF-14): el contenedor de Cloud Run se apaga
sin tráfico, así que no sirve un reloj adentro del proceso.

1. **Cloud Scheduler**, el **1° de cada mes a las 07:00** (zona `America/Argentina/Buenos_Aires`),
   hace `POST https://<backend>/internal/reporte-mensual` con el header `x-sync-token: <SYNC_TOKEN>`.

   ```bash
   gcloud scheduler jobs create http spmm-reporte-mensual \
     --location=southamerica-east1 \
     --schedule="0 7 1 * *" --time-zone="America/Argentina/Buenos_Aires" \
     --uri="https://<backend>/internal/reporte-mensual" --http-method=POST \
     --headers="x-sync-token=<SYNC_TOKEN>"
   ```

2. **El endpoint** (a agregar en `backend/presentation/main.py`, al lado de `/internal/alertas`;
   `/internal/` ya está en `SIN_POLITICA`, así que no pasa por el mapa de permisos):

   ```python
   @app.post("/internal/reporte-mensual")
   async def internal_reporte_mensual(request: Request, db=Depends(get_db_interno)):
       esperado = os.getenv("SYNC_TOKEN")
       if not esperado:
           raise HTTPException(status_code=404, detail="Not Found")
       if request.headers.get("x-sync-token") != esperado:
           raise HTTPException(status_code=401, detail="No autorizado")
       mails = await preparar_mails_del_mes(db)
       for mail in mails:
           await enviar(mail)          # Resend: RESEND_API_KEY y FROM_EMAIL (core/config.py)
       return {"status": "ok", "mails": len(mails)}
   ```

   `enviar()` todavía no existe: es la misma integración con Resend que falta para RF-04 y para
   recuperar la contraseña (`AuthService`, el `TODO: Enviar email con Resend`). Se escribe una
   vez para las tres cosas.

3. **Probarlo antes de dejarlo solo:** correr el endpoint a mano una vez, con un solo
   destinatario (`preparar_mails_del_mes(db, para=["julian@..."])`), y mirar el mail.

### A quién le llega (PENDIENTE: lo decide Lucas)

Por defecto, `destinatarios_por_defecto()`: los **usuarios admin activos** con mail. Es lo más
cerrado que hay, porque el reporte trae la sección confidencial de personas. Hoy todos los
usuarios son admin, así que en la práctica le llega a todo el equipo. Hay que confirmarlo con
Lucas antes de activarlo.

A los destinatarios por defecto (admin) les va todo. Con una lista `para` puesta a mano el
reporte sale SIN lo de la sección confidencial «Rendimiento por persona» (personas, sus ausencias
y la calidad agrupada por persona), porque no se sabe qué permisos tiene cada dirección. Si
mañana le tiene que llegar a un supervisor con todo lo suyo, hay que armarle el reporte con
`alcance_de(sus permisos)`.

## 5. Máquinas (RF-10)

La sección lee el registro de uso de RF-10 (`uso_maquina`) con la misma cuenta que la solapa Uso
de cada máquina (`UsoMaquinaService.horas_por_maquina`): horas EFECTIVAS (jornada del taller
menos pausas), recortadas al mes, y una hora en que la máquina tuvo dos pasos abiertos cuenta una
vez. No suma lo que RF-10 dice que no suma (fuera de servicio, vuelta a Pendiente, abierto sin
cierre o abierto de más). Suma además los mantenimientos registrados con fecha del mes (la lista
va aparte) y cuántos avisos de mantenimiento salieron.

Pide lo mismo que la solapa de RF-10: la política «maquinas_uso» (Recursos › Recurso
maquinaria). Si las tablas de RF-10 no están (la migración no se aplicó), la sección sale vacía
con un aviso y el resto del reporte no se cae.

```python
{"disponible": True,
 "resumen": {"maquinas": n, "horas_min": total, "mantenimientos": n, "avisos": n},
 "anterior": {"maquinas": n, "horas_min": total, "mantenimientos": n},
 "filas": [{"id_maquinaria": 1, "maquina": "TORNO CNC 1", "horas_min": 1234,
            "tareas": 12, "horas_min_anterior": 1100, "mantenimientos": 1}, ...],
 "mantenimientos": [{"id", "id_maquinaria", "maquina", "fecha", "hecho_por", "nota"}, ...]}
```

## 6. Pruebas

`backend/tests/test_reporte_mensual.py`: dos meses con datos del taller (entregada el 31 a las
23:30, un paso que cruza el fin de mes y un sábado, un feriado, pausas, ausencias, no
conformidades, consumos anulados). Comprueba que los totales cierran, que el mes se corta en hora
local, los permisos y que el mail se arma sin mandarse. Corre en SQLite siempre, y en un
Postgres descartable con:

```bash
SPMM_PG_PRUEBAS=postgresql+asyncpg://usuario@127.0.0.1:PUERTO/base pytest backend/tests/test_reporte_mensual.py
```

(Esa base se borra entera: sólo se acepta localhost.)
