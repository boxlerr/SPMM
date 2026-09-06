# Importar los planos de Drive

El taller tiene los planos en Drive: una carpeta con cientos de subcarpetas, una por
**código de artículo** (`AD00B004`, `CL00P202`, `CA0003`…), y adentro de cada una el PDF
del plano. Este script las recorre y carga cada PDF en la base **contra el artículo**, no
contra la orden de trabajo.

Se cuelga del artículo porque el plano es del producto: cargado una vez, aparece solo en
todas las OT que fabrican ese producto, incluidas las que todavía no se dieron de alta.

> Antes de correrlo tiene que estar aplicada la migración que le agrega a `plano` las
> columnas `id_articulo` y `drive_*`:
> `backend/scripts/migrations/2026-09-06_planos_por_articulo.sql`. Si falta, el script
> frena de entrada y lo dice.

---

## 1. Instalar las librerías (una sola vez)

```bash
cd /Users/julianboxler/Documents/GitHub/SPMM
.venv/bin/pip install -r requirements-dev.txt
```

## 2. Darle permiso de Drive a tu cuenta (una sola vez, y cada tanto se vence)

```bash
gcloud auth application-default login --scopes=openid,https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/cloud-platform
```

Se abre el navegador y hay que entrar **con la cuenta de Google que tiene compartida la
carpeta del taller**. El script no usa una service account ni un `client_secret.json`: la
carpeta es de `lsantacruz@metlongchamps.com` y el acceso sale de que esté compartida con
vos.

Si el login se hizo sin el permiso de Drive, el script te devuelve este mismo comando
para que lo copies y lo corras de nuevo.

## 3. Probar sin escribir nada

```bash
.venv/bin/python -m backend.scripts.planos.importar_planos --desde-drive --dry-run
```

Recorre todo, no toca la base y deja el reporte en `tmp/planos-<fecha>-simulacro.csv`.
**Esta es la corrida que hay que mirar primero**, y el CSV es el que se le manda al
taller.

Para probar más rápido, con las primeras 20 carpetas:

```bash
.venv/bin/python -m backend.scripts.planos.importar_planos --desde-drive --dry-run --limite 20
```

## 4. El import de verdad

```bash
.venv/bin/python -m backend.scripts.planos.importar_planos --desde-drive
```

Va contando carpeta por carpeta y hace commit cada 25 archivos. **Se puede cortar con
Ctrl-C**: guarda lo que ya bajó y, si volvés a correr el mismo comando, retoma donde
quedó sin cargar nada dos veces.

---

## Los flags

| Flag | Qué hace |
|---|---|
| `--desde-drive [FOLDER_ID]` | Baja los planos de Drive. Sin valor usa la carpeta del taller (`12vIaihvmPX-uSx5jw7ny7QYxwOAY3NMG`). |
| `--desde-carpeta RUTA` | Lee un directorio del disco con la misma estructura (una subcarpeta por código). |
| `--dry-run` | No escribe nada en la base: solo revisa y arma el CSV. |
| `--limite N` | Procesa solo las primeras N subcarpetas. Para probar. |
| `--csv RUTA` | Dónde dejar el reporte. Por defecto `tmp/planos-<fecha>.csv`. |

`--desde-drive` y `--desde-carpeta` son excluyentes: hay que elegir una.

### El plan B: `--desde-carpeta`

Si la API de Drive no está disponible (permisos, la API apagada en el proyecto de GCP,
Lucas prefiere mandar un ZIP), se baja la carpeta de Drive a mano, se descomprime y:

```bash
.venv/bin/python -m backend.scripts.planos.importar_planos --desde-carpeta ~/Downloads/O --dry-run
```

Hace exactamente lo mismo. La única diferencia es que esas filas quedan sin el id de
Drive; si más adelante se corre `--desde-drive`, ese import las **reconoce y les anota el
id** en lugar de duplicarlas.

---

## Qué va a pasar (y qué no)

- **No duplica.** Si el archivo ya está cargado y no cambió, lo saltea sin siquiera
  bajarlo.
- **Si el plano cambió en Drive**, reemplaza el archivo de la fila que ya existe. No crea
  una fila nueva, así los links que alguien haya guardado siguen abriendo el plano —
  ahora con la revisión nueva.
- **No toca** los planos que alguien haya subido a mano desde la app contra una OT.
- Solo carga **PDF e imágenes**. Cualquier otra cosa (un Excel, un DWG) queda listada en
  el CSV sin cargar.

---

## Cómo se lee el CSV

Se abre con Excel (tiene BOM, así que los acentos salen bien). Una fila por archivo y
una columna `resultado` para filtrar:

| `resultado` | Qué significa | Qué hacer |
|---|---|---|
| **Importado** | El plano se cargó por primera vez. | Nada. |
| **Actualizado** | Ya estaba, pero el PDF de Drive cambió y se reemplazó. | Nada. |
| **Sin cambios** | Ya estaba cargado, idéntico. | Nada. |
| **Carpeta vacía** | La subcarpeta del código no tiene ningún archivo. | Preguntarle al taller si falta subir el plano. |
| **El código no está en el sistema** | El nombre de la carpeta no coincide con ningún `cod_articulo`. | Es lo que hay que revisar con el taller: o el código está mal escrito en Drive, o el artículo no está dado de alta. |
| **Archivo no soportado** | No es PDF ni imagen. | Ver si hay que convertirlo o si no era un plano. |
| **Error** | Algo se rompió con ese archivo. | El detalle está en la columna `detalle`. |

Las otras columnas: `codigo_carpeta` es el nombre tal cual está en Drive;
`codigo_en_el_sistema` es el `cod_articulo` con el que macheó (pueden diferir en espacios
o mayúsculas); `descripcion_articulo` sirve para confirmar a ojo que el plano cayó en el
producto correcto.

### La columna `codigo_repetido`

Un `sí` ahí significa que ese código está cargado **más de una vez** en `articulo` (hay
20 casos, porque al ignorar espacios y mayúsculas quedan iguales). El script carga el
plano en el artículo de **id más bajo** y lo deja anotado en `detalle` con los ids de los
otros. No lo resuelve por su cuenta a propósito: decidir con cuál artículo se queda cada
código es una decisión del taller, no del script. La consola los lista todos juntos al
final.


---

## Qué pasa con las fotos

En la carpeta del taller no hay solo PDFs: hay 267 imágenes, y 80 de ellas son fotos de
celular que se llevan 248 MB (la más grande, 13 MB). El importador las **achica antes de
guardarlas**: las lleva a 2400 px de lado largo y las recomprime. En una foto de 4 MB eso
da alrededor de 140 KB — un 97% menos— y se sigue leyendo de sobra en pantalla y en una
hoja A4.

No es por lugar: los 634 MB de la carpeta entran cómodos en los 8 GB de disco que el plan
Pro le da a este proyecto (y el disco es la única cuota que Supabase **no** comparte entre
proyectos, así que esto no le saca lugar a ninguna otra base). Es por tiempo: cada vez que
alguien abre un plano hay que bajarlo entero, y arriba de 3 MB la app ni siquiera intenta
dibujar la miniatura, así que esas fotos se veían como un ícono gris.

Pasarlas a PDF, que es lo primero que uno piensa para "ahorrar espacio", **no ahorra
nada**: un PDF con una foto adentro es la misma foto más el envoltorio. Lo que ahorra es
reducir y recomprimir, que es lo que hace el importador.

Los PDF no se tocan nunca. Si una imagen está rota o Pillow no está instalado, se guarda
tal cual y queda anotado en el CSV.

Para desactivarlo:

```bash
.venv/bin/python -m backend.scripts.planos.importar_planos --desde-drive --sin-achicar
```
