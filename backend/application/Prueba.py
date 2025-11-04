"""import pandas as pd
import plotly.express as px

# 🔹 Ejemplo de resultados devueltos por tu API (puede ser tu JSON real)
resultados = [
    {
        "orden_id": 1,
        "proceso_id": 1,
        "posicion_planificada": 5,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-04"
    },
    {
        "orden_id": 1,
        "proceso_id": 46,
        "posicion_planificada": 7,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-04"
    },
    {
        "orden_id": 1,
        "proceso_id": 74,
        "posicion_planificada": 4,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-04"
    },
    {
        "orden_id": 1,
        "proceso_id": 105,
        "posicion_planificada": 1,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-04"
    },
    {
        "orden_id": 1,
        "proceso_id": 108,
        "posicion_planificada": 3,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-04"
    },
    {
        "orden_id": 1,
        "proceso_id": 131,
        "posicion_planificada": 6,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-04"
    },
    {
        "orden_id": 1,
        "proceso_id": 151,
        "posicion_planificada": 2,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-04"
    },
    {
        "orden_id": 2,
        "proceso_id": 150,
        "posicion_planificada": 1,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-04"
    },
    {
        "orden_id": 3,
        "proceso_id": 46,
        "posicion_planificada": 1,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-19"
    },
    {
        "orden_id": 4,
        "proceso_id": 46,
        "posicion_planificada": 1,
        "prioridad": "normal",
        "fecha_prometida": "2022-01-04"
    },
    {
        "orden_id": 5,
        "proceso_id": 46,
        "posicion_planificada": 1,
        "prioridad": "normal",
        "fecha_prometida": "2022-03-25"
    },
    {
        "orden_id": 6,
        "proceso_id": 46,
        "posicion_planificada": 1,
        "prioridad": "normal",
        "fecha_prometida": "2022-01-07"
    },
    {
        "orden_id": 7,
        "proceso_id": 82,
        "posicion_planificada": 3,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 7,
        "proceso_id": 138,
        "posicion_planificada": 2,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    }
]

# --- DataFrame ---
df = pd.DataFrame(resultados)

# Ordenar
df = df.sort_values(by=["orden_id", "posicion_planificada"])

# Crear inicio y fin ficticios
df["inicio"] = df["posicion_planificada"] - 1
df["fin"] = df["posicion_planificada"]

# Forzar tipo numérico
df["inicio"] = df["inicio"].astype(float)
df["fin"] = df["fin"].astype(float)

# Etiquetas
df["proceso_label"] = "Proceso " + df["proceso_id"].astype(str)

# --- Crear el Gantt ---
fig = px.timeline(
    df,
    x_start="inicio",
    x_end="fin",
    y="orden_id",
    color="prioridad",         # 👈 usa la prioridad para colorear
    text="proceso_label",      # 👈 muestra el proceso dentro de la barra
    title="Planificación de Procesos por Orden de Trabajo",
    hover_data=["proceso_id", "prioridad", "fecha_prometida"]
)

# --- Ajustes visuales ---
fig.update_yaxes(autorange="reversed")  # para que la orden 1 esté arriba
fig.update_xaxes(
    title="Secuencia (posición planificada)",
    type="linear",
    tickmode="linear",
    dtick=1                             # 👈 cada unidad representa un paso
)
fig.update_layout(
    yaxis_title="Órdenes de trabajo",
    legend_title="Prioridad",
    title_x=0.5,
    height=800,
    width=1200,
    bargap=0.2
)
fig.update_traces(textposition="inside", insidetextanchor="middle")

fig.show()

"""

import pandas as pd
import plotly.express as px

df = pd.DataFrame([
    {
        "orden_id": 1,
        "proceso_id": 1,
        "posicion_planificada": 5,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-04"
    },
    {
        "orden_id": 1,
        "proceso_id": 46,
        "posicion_planificada": 7,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-04"
    },
    {
        "orden_id": 1,
        "proceso_id": 74,
        "posicion_planificada": 4,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-04"
    },
    {
        "orden_id": 1,
        "proceso_id": 105,
        "posicion_planificada": 1,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-04"
    },
    {
        "orden_id": 1,
        "proceso_id": 108,
        "posicion_planificada": 3,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-04"
    },
    {
        "orden_id": 1,
        "proceso_id": 131,
        "posicion_planificada": 6,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-04"
    },
    {
        "orden_id": 1,
        "proceso_id": 151,
        "posicion_planificada": 2,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-04"
    },
    {
        "orden_id": 2,
        "proceso_id": 150,
        "posicion_planificada": 1,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-04"
    },
    {
        "orden_id": 3,
        "proceso_id": 46,
        "posicion_planificada": 1,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-19"
    },
    {
        "orden_id": 4,
        "proceso_id": 46,
        "posicion_planificada": 1,
        "prioridad": "normal",
        "fecha_prometida": "2022-01-04"
    },
    {
        "orden_id": 5,
        "proceso_id": 46,
        "posicion_planificada": 1,
        "prioridad": "normal",
        "fecha_prometida": "2022-03-25"
    },
    {
        "orden_id": 6,
        "proceso_id": 46,
        "posicion_planificada": 1,
        "prioridad": "normal",
        "fecha_prometida": "2022-01-07"
    },
    {
        "orden_id": 7,
        "proceso_id": 82,
        "posicion_planificada": 3,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 7,
        "proceso_id": 138,
        "posicion_planificada": 2,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 7,
        "proceso_id": 152,
        "posicion_planificada": 1,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 8,
        "proceso_id": 68,
        "posicion_planificada": 2,
        "prioridad": "urgente 1",
        "fecha_prometida": "2022-01-11"
    },
    {
        "orden_id": 8,
        "proceso_id": 82,
        "posicion_planificada": 1,
        "prioridad": "urgente 1",
        "fecha_prometida": "2022-01-11"
    },
    {
        "orden_id": 8,
        "proceso_id": 138,
        "posicion_planificada": 3,
        "prioridad": "urgente 1",
        "fecha_prometida": "2022-01-11"
    },
    {
        "orden_id": 8,
        "proceso_id": 152,
        "posicion_planificada": 4,
        "prioridad": "urgente 1",
        "fecha_prometida": "2022-01-11"
    },
    {
        "orden_id": 9,
        "proceso_id": 36,
        "posicion_planificada": 1,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-14"
    },
    {
        "orden_id": 9,
        "proceso_id": 46,
        "posicion_planificada": 6,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-14"
    },
    {
        "orden_id": 9,
        "proceso_id": 57,
        "posicion_planificada": 5,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-14"
    },
    {
        "orden_id": 9,
        "proceso_id": 105,
        "posicion_planificada": 2,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-14"
    },
    {
        "orden_id": 9,
        "proceso_id": 131,
        "posicion_planificada": 4,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-14"
    },
    {
        "orden_id": 9,
        "proceso_id": 151,
        "posicion_planificada": 3,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-14"
    },
    {
        "orden_id": 10,
        "proceso_id": 46,
        "posicion_planificada": 2,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 10,
        "proceso_id": 103,
        "posicion_planificada": 1,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 11,
        "proceso_id": 151,
        "posicion_planificada": 1,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-11"
    },
    {
        "orden_id": 12,
        "proceso_id": 151,
        "posicion_planificada": 1,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-12"
    },
    {
        "orden_id": 13,
        "proceso_id": 69,
        "posicion_planificada": 4,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 13,
        "proceso_id": 96,
        "posicion_planificada": 1,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 13,
        "proceso_id": 105,
        "posicion_planificada": 2,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 13,
        "proceso_id": 152,
        "posicion_planificada": 3,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 14,
        "proceso_id": 40,
        "posicion_planificada": 1,
        "prioridad": "normal",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 14,
        "proceso_id": 57,
        "posicion_planificada": 8,
        "prioridad": "normal",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 14,
        "proceso_id": 96,
        "posicion_planificada": 5,
        "prioridad": "normal",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 14,
        "proceso_id": 103,
        "posicion_planificada": 4,
        "prioridad": "normal",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 14,
        "proceso_id": 105,
        "posicion_planificada": 3,
        "prioridad": "normal",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 14,
        "proceso_id": 126,
        "posicion_planificada": 2,
        "prioridad": "normal",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 14,
        "proceso_id": 138,
        "posicion_planificada": 9,
        "prioridad": "normal",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 14,
        "proceso_id": 152,
        "posicion_planificada": 6,
        "prioridad": "normal",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 14,
        "proceso_id": 154,
        "posicion_planificada": 7,
        "prioridad": "normal",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 15,
        "proceso_id": 2,
        "posicion_planificada": 12,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 15,
        "proceso_id": 31,
        "posicion_planificada": 13,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 15,
        "proceso_id": 46,
        "posicion_planificada": 3,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 15,
        "proceso_id": 50,
        "posicion_planificada": 2,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 15,
        "proceso_id": 57,
        "posicion_planificada": 9,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 15,
        "proceso_id": 68,
        "posicion_planificada": 10,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 15,
        "proceso_id": 86,
        "posicion_planificada": 14,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 15,
        "proceso_id": 96,
        "posicion_planificada": 4,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 15,
        "proceso_id": 103,
        "posicion_planificada": 6,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 15,
        "proceso_id": 104,
        "posicion_planificada": 7,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 15,
        "proceso_id": 105,
        "posicion_planificada": 1,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 15,
        "proceso_id": 113,
        "posicion_planificada": 11,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 15,
        "proceso_id": 117,
        "posicion_planificada": 8,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 15,
        "proceso_id": 126,
        "posicion_planificada": 15,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 15,
        "proceso_id": 140,
        "posicion_planificada": 16,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    },
    {
        "orden_id": 15,
        "proceso_id": 155,
        "posicion_planificada": 5,
        "prioridad": "urgente",
        "fecha_prometida": "2022-01-21"
    }
])

# Etiquetas más legibles
df["proceso_label"] = "Proc " + df["proceso_id"].astype(str)

fig = px.bar(
    df,
    x="posicion_planificada",
    y="orden_id",
    color="prioridad",
    text="proceso_label",
    orientation="h",
    title="Secuencia planificada por orden de trabajo",
    hover_data=["proceso_id", "prioridad"]
)

fig.update_yaxes(autorange="reversed")
fig.update_layout(
    xaxis_title="Secuencia (posición planificada)",
    yaxis_title="Órdenes de trabajo",
    height=800,
    width=1200,
    bargap=0.3,
    title_x=0.5
)
fig.update_traces(textposition="inside", insidetextanchor="middle")

fig.show()


