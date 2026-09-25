/**
 * Novedades del sistema — lo que fue cambiando, contado para quien usa las pantallas.
 *
 * Pedido de Julián (14/08/2026): tener en SPMM lo mismo que en Don Joaquín, una
 * sección donde el equipo de Longchamps ve qué cambió sin tener que enterarse
 * abriendo una pantalla que no reconoce.
 *
 * Es una lista escrita a mano y a propósito: los mensajes de commit hablan de
 * archivos y de causas, no de lo que ve Lucas cuando entra a Operaciones.
 *
 * Reglas para escribir una novedad:
 *  - Contala desde la pantalla y en segunda persona: "ya podés sacar una OT de la
 *    planificación", no "se agregó el endpoint quitar-ordenes".
 *  - Nada de nombres internos: ni tablas, ni componentes, ni "el endpoint". Si la
 *    palabra no está escrita en la pantalla, no va.
 *  - El título es UNA línea y dice qué se puede hacer ahora. El `detalle` cuenta
 *    cómo era antes o dónde está el botón.
 *  - `fecha` es el día que salió a producción, en ISO (YYYY-MM-DD).
 *  - `id` es un slug corto y ESTABLE.
 *  - Las más nuevas van arriba de todo.
 */

/**
 * Qué clase de cambio es. Define el ícono y el rótulo con el que se dibuja:
 *  - `nuevo`: algo que antes no se podía hacer.
 *  - `mejora`: se podía, pero ahora se hace mejor o más rápido.
 *  - `arreglo`: andaba mal y ya no.
 */
export type NovedadTipo = "nuevo" | "mejora" | "arreglo";

export type Novedad = {
    /** Slug corto y estable. */
    id: string;
    /** Día en que salió a producción (YYYY-MM-DD). */
    fecha: string;
    tipo: NovedadTipo;
    /** En qué pantalla se nota ("Operaciones", "Recursos", "Configuración"...). */
    seccion: string;
    /** Qué se puede hacer ahora, en una línea y sin nombres internos. */
    titulo: string;
    /** Cómo era antes o dónde está: lo que hace que se entienda sola. */
    detalle?: string;
    /** A dónde lleva si la tocan. */
    href?: string;
};

/** Las más nuevas arriba. Al agregar una, va al principio de la lista. */
export const NOVEDADES: Novedad[] = [
    {
        id: "pendientes-como-en-el-integral",
        fecha: "2026-09-25",
        tipo: "mejora",
        seccion: "Materia prima",
        titulo: "En Pendientes ves los cortes de cada material y la semana sale del plan semanal del Sistema Integral",
        detalle:
            "En Materia prima, solapa «Pendientes», cada material tiene la columna «Cortes (mm)» con las piezas que se cortan de él (por ejemplo «34 × 63») y, abajo, los metros que suman contando la sierra; si pasás el mouse o la tocás, se ven todos los cortes con la cuenta. Los metros salen sólo cuando sirven para comprar: si el material va en metros o son cortes de barra. En una chapa que va en Kg no se muestran, y lo mismo en la solapa Materias Primas de cada orden. La semana sale del plan semanal del Sistema Integral, la misma que ve Maxi allá: debajo de la fecha dice de dónde sale, y si esa semana todavía no tiene órdenes en el plan te lo avisa y te muestra todas las abiertas. Al imprimir la lista para pedir agrupada por proveedor, queda afuera lo que ya llegó, así no se vuelve a encargar. Y cuando marcás «Disponible», te pregunta en qué casillero de la cañera quedó el material de esa orden; si la orden ya tiene casillero, o su material ya estaba disponible, no pregunta.",
        href: "/materia-prima",
    },
    {
        id: "avisos-se-vuelven-a-abrir",
        fecha: "2026-09-25",
        tipo: "mejora",
        seccion: "Todo el sistema",
        titulo: "El aviso que sale al entrar se vuelve a abrir desde el menú, aunque lo hayas cerrado",
        detalle:
            "Abajo en el menú de la izquierda, al lado de tu nombre, hay un megáfono: lo tocás y se abre de nuevo el último aviso, con su botón para ir a Novedades. Mientras tenga un puntito rojo es que hay un aviso que todavía no leíste. El puntito se apaga cuando tocás «Entendido» o «Ver todas las novedades», o cuando lo tuviste abierto un rato; si lo cerrás enseguida, sigue prendido. Con el menú achicado, el megáfono está arriba de tu inicial, y en el teléfono el puntito se ve también en el botón redondo del menú. Antes el aviso salía una sola vez: si lo cerrabas sin leerlo, no había cómo volver a verlo.",
    },
    {
        id: "materia-prima-seccion-nueva",
        fecha: "2026-09-24",
        tipo: "nuevo",
        seccion: "Materia prima",
        titulo: "Pantalla nueva «Materia prima»: lo que falta comprar en la semana, cada insumo con su stock y la cañera",
        detalle:
            "Durante la prueba piloto las materias primas se siguen cargando en el Sistema Integral, como siempre: esta pantalla y la solapa Materias Primas de cada orden las muestran con las marcas de allá (pedido, reservado, disponible, en producción) y se actualizan solas cada 10 minutos. Por ahora son de sólo lectura, así nadie las carga dos veces. En el menú de la izquierda, debajo de Operaciones, está «Materia prima», con tres solapas. En «Pendientes» está lo que falta para las órdenes de la semana (las que el plan pone a trabajar, o todas las abiertas), con el proveedor y la fecha que prometió. En «Insumos» está el catálogo, con los mismos códigos del Sistema Integral: cada insumo con su stock, sus recortes, en qué órdenes se usó y sus precios, y el punto crítico que antes estaba en la solapa Materia Prima de Operaciones. En «Cañera», en qué estante quedó el material cortado de cada orden. Y la columna Material de las listas dice «Falta pedir» donde decía «Sin stock», y «Pedido / reservado» cuando ya está encargado o apartado; la línea «TRABAJO SIN MATERIAL» (TRA011) cuenta como lista aunque nadie la tilde.",
        href: "/materia-prima",
    },
    {
        id: "ot-procesos-como-el-viejo",
        fecha: "2026-09-23",
        tipo: "arreglo",
        seccion: "Operaciones",
        titulo: "Cada orden tiene los mismos procesos que ves en el sistema viejo, sin pasos repetidos de más",
        detalle:
            "Volvimos a traer del sistema viejo todas las órdenes. Había órdenes con procesos de más: la 15243 tenía 13 pasos y en el viejo tiene 7, la 15556 tenía 18 y en el viejo 9. En otras faltaban pasos que se agregaron en el viejo después, o los minutos estaban en 0. Ahora las 214 órdenes abiertas tienen la misma lista que el viejo: los mismos pasos, en el mismo orden y con los mismos minutos. Y son las mismas 214 que el viejo tiene pendientes. Si una orden repite un proceso (por ejemplo TORNO CNC dos veces), es porque así está cargada en el viejo: para dejarlo en uno solo hay que corregirlo allá. Si habías cambiado los procesos de alguna orden acá, se reemplazaron por los del viejo; avisá cuál y la volvemos a como estaba. Las órdenes nuevas que se carguen en el viejo se van a sumar sin tocar las que ya están.",
        href: "/operaciones",
    },
    {
        id: "planificar-dias-reales",
        fecha: "2026-09-23",
        tipo: "arreglo",
        seccion: "Operaciones",
        titulo: "Al planificar ves las horas, los días de trabajo y los días hábiles reales que lleva lo que tildaste",
        detalle:
            "Arriba de «Planificar órdenes» ahora hay tres números: las horas de trabajo, esas horas pasadas a jornadas (sube con cada OT que sumás) y cuántos días hábiles lleva de verdad («entre 7 y 9 días hábiles, hasta el lun 6/10»). Antes decía «≈ 4,9 días con 12 operarios» y no se movía, porque repartía todo entre todos como si cualquiera hiciera cualquier cosa. La cuenta nueva mira quién sabe hacer cada paso, el orden de los pasos y que una máquina hace una cosa a la vez; si pasás el mouse te dice quién marca el ritmo (por ejemplo, el único que sabe plegar). Si elegís un rango de fechas, te avisa cuántas OT entran («Entran 26 de 39 OT hasta el 30/9»): las que no entran quedan afuera del plan y en la vista previa podés forzarlas. Al lado de «Limpiar filtros» está «Ver solo las tildadas». Y en la vista previa, los días hábiles ya no cuentan los sábados si nadie los trabaja, y la carga de cada persona se compara contra lo que trabaja en esos días, no contra 44 horas fijas.",
        href: "/operaciones",
    },
    {
        id: "ir-a-arreglarlo-lleva-a-la-fila",
        fecha: "2026-09-23",
        tipo: "arreglo",
        seccion: "Operaciones",
        titulo: "«Ir a arreglarlo» te lleva justo a lo que hay que tocar, y Recursos ya no queda en blanco",
        detalle:
            "Cuando tocás «Ir a arreglarlo» en un aviso del plan, Recursos se abre mostrando solo lo que nombra el aviso (el proceso, o las tres fresadoras), resaltado y desplegado, con el aviso y qué hacer arriba. Antes el de «Preparación de pintura» llevaba a una pantalla que decía «No se encontraron procesos», porque el nombre venía con tilde y en la lista está sin tilde. Si el aviso nombra varias máquinas, al guardar una se abre la siguiente con el rango propuesto ya tildado. Si un filtro deja la lista vacía, te dice qué filtro está puesto y te deja sacarlo con un toque. Y el buscador de procesos encuentra el nombre con o sin tildes.",
        href: "/recursos",
    },
    {
        id: "planos-del-drive-22-09",
        fecha: "2026-09-23",
        tipo: "mejora",
        seccion: "Planos",
        titulo: "Entraron los planos que se subieron al Drive el 22/9",
        detalle:
            "Se trajeron los 91 planos y fotos de las 46 carpetas nuevas del Drive. Con eso, de las 214 órdenes abiertas 196 tienen plano para mirar (antes 180). Las que siguen «Sin plano» son las que no tienen carpeta, o la carpeta está vacía, o solo tiene archivos DXF: para que se vean hace falta el PDF o una foto. Ojo: una carpeta nueva en el Drive todavía no entra sola; hay que avisar para que se traiga.",
        href: "/planos",
    },
    {
        id: "listas-de-ordenes-abren-al-toque",
        fecha: "2026-09-23",
        tipo: "mejora",
        seccion: "Operaciones",
        titulo: "El Historial y las demás listas de órdenes abren al instante, tengan las órdenes que tengan",
        detalle:
            "Antes, al tocar Historial se armaban las más de mil órdenes de una sola vez y en algunas computadoras la pantalla se quedaba trabada unos segundos, y lo mismo con cada letra que escribías en el buscador. Ahora se muestran las primeras y, a medida que bajás, aparecen las siguientes solas: no hay páginas ni botones. El buscador, los filtros, el orden y Exportar siguen mirando todas las órdenes, así que una OT vieja se encuentra igual aunque todavía no esté a la vista. Vale para No Planificadas, Historial y Todas. Además, en No Planificadas e Historial, si vas a otra solapa y volvés, la lista aparece al instante con la búsqueda y los filtros que tenías.",
        href: "/operaciones",
    },
    {
        id: "mover-pasos-y-minutos-desde-la-lista",
        fecha: "2026-09-17",
        tipo: "mejora",
        seccion: "Operaciones",
        titulo: "Los pasos de una orden se mueven desde el número, y los minutos se cambian donde están",
        detalle:
            "En el número de la izquierda de cada paso: escribís otro número y el paso se va a ese lugar, o usás las flechitas para moverlo de a uno. Antes había que arrastrar o buscar dos flechas al final del renglón. Los minutos se cambian tocando el número en la columna «Min. Est.»: hasta ahora se editaban desde un lápiz que estaba en la otra punta de la fila y abría una cajita lejos de los minutos, que no se entendía qué era. Vale en las dos pantallas: en Órdenes no planificadas y adentro de la vista previa del planificador. En el planificador, además, lo que tocaste queda marcado en rojo y hay un «Deshacer» para volver atrás el último cambio.",
        href: "/operaciones",
    },
    {
        id: "editar-los-procesos-desde-la-planificacion",
        fecha: "2026-09-17",
        tipo: "nuevo",
        seccion: "Operaciones",
        titulo: "Los procesos se editan en la misma planificación: cambiás el paso por otro, lo movés, lo sacás o agregás uno nuevo",
        detalle:
            "Cuando desplegás una OT en la vista previa del plan, cada paso se puede tocar ahí mismo. Al lado del nombre hay un lápiz para cambiarlo por otro proceso, y a la derecha de cada renglón están las flechitas para subirlo o bajarlo y el tacho para sacarlo. Abajo de la lista, «Agregar proceso a la OT» suma uno nuevo. Antes todo esto era salir del plan, abrir la orden y volver a empezar. Dos cosas para tener en cuenta: los cambios se guardan en la ORDEN, no sólo en este plan, así que quedan aunque descartes el borrador; y el plan no se rehace solo. El paso que tocaste y su hora quedan marcados en naranja y arriba aparece el cartel con el botón «Recalcular el plan» para cuando quieras que el motor lo acomode. Si guardás sin recalcular, se guarda el plan tal como lo estás viendo, y te lo avisa antes. Los minutos de cada paso siguen sin tocarse desde acá: se cargan en la orden.",
        href: "/operaciones",
    },
    {
        id: "destrabar-un-aviso-solo-para-esta-planificacion",
        fecha: "2026-09-17",
        tipo: "nuevo",
        seccion: "Operaciones",
        titulo: "Podés destrabar un aviso solo para esta planificación, sin que cambie nada en Recursos",
        detalle:
            "Cuando el planificador te avisaba que algo trababa el plan, el botón que lo resolvía de una guardaba el cambio en Recursos: le sumabas un rango a una máquina para que este plan saliera, y ese rango le quedaba puesto para siempre, también para todas las OTs que vinieran después. Si lo único que querías era ver cómo quedaba el plan suponiendo que esta vez esa máquina también hace el trabajo, no había manera: o lo cargabas en serio, o te quedabas con la traba. Ahora el de siempre se llama «Guardar en Recursos» y al lado apareció otro, «Solo en este plan»: el plan se calcula de nuevo como si el dato estuviera cargado, pero no se escribe nada en ningún lado. El botón del aviso te queda diciendo «Puesto en este plan», y arriba de la lista de avisos se abre «Ajustes solo para este plan», con todos los que pusiste y un «Deshacer» en cada uno. Ojo: valen para este cálculo y nada más. En Recursos queda todo como estaba, y si descartás el borrador se pierden. Aunque pliegues los avisos, arriba te queda el contador de los que tenés puestos. Si deshacés uno puede llevarse los que aplicaste después sobre esa misma máquina o ese mismo proceso —se calcularon encima del primero—, y te dice cuántos se fueron; y si al final lo cargás en serio con «Guardar en Recursos», el ajuste temporal sobre eso se da de baja solo, para que el próximo cálculo no te pise lo que guardaste. Al guardar el plan, si quedó alguno puesto te lo avisa antes de escribir: podés guardar igual o volver y cargarlos.",
        href: "/operaciones",
    },
    {
        id: "cambiar-horarios-sin-que-se-recargue-todo",
        fecha: "2026-09-17",
        tipo: "mejora",
        seccion: "Operaciones",
        titulo: "Cambiás un horario o una fecha y la pantalla se queda donde está",
        detalle:
            "Cada vez que le cambiabas el horario a un paso, la pantalla se recargaba entera: volvías al principio, con la OT cerrada y la solapa donde no estabas, y para corregir el paso de abajo había que desplegar todo de nuevo. Corregir cinco horarios eran cinco vueltas. Ahora el horario nuevo aparece en el renglón al toque, el cuadrito se cierra solo y seguís con el que sigue. Lo mismo con las fechas de la fila —entrada, prometida, entrega— y con el número de pedido o la cantidad: antes la lista desaparecía atrás del cartel de carga y volvía unos segundos después. Si algo no se llega a guardar, el dato vuelve como estaba y te avisa: lo que ves en pantalla es lo que quedó guardado.",
        href: "/operaciones",
    },
    {
        id: "estimado-del-planificador-en-horas-reales",
        fecha: "2026-09-17",
        tipo: "arreglo",
        seccion: "Operaciones",
        titulo: "Arriba del planificador ahora hay dos números: las horas de trabajo que estás metiendo y los días que eso lleva",
        detalle:
            "Tildabas una sola OT de 40 horas de trabajo y el cartel decía «0.1 días (1.1 hs)». Lo que hacía era repartir esas horas entre todos los operarios disponibles, como si un torneado de 600 minutos lo pudieran hacer 37 personas a la vez: los pasos de una OT van uno atrás del otro, así que esa cuenta no podía dar. Y mezclados en un solo número no se entendía cuál era cuál. Ahora son dos carteles separados: «40.8 hs de trabajo», que es la suma de lo que tildaste y no depende de cuánta gente haya, y «≈ 4.9 días con 37 operarios», que es lo que eso tarda con la gente que está disponible. Pasando el mouse por cada uno te cuenta de dónde sale: si el número lo manda la OT más larga (que no se acorta con más gente) o la capacidad del taller, si hay pasos sin minutos cargados que no están sumando, y que la cuenta da por libres a todos los operarios — lo que ya tienen encima no se descuenta.",
        href: "/operaciones",
    },
    {
        id: "historial-de-los-pasos-de-la-orden",
        fecha: "2026-09-17",
        tipo: "nuevo",
        seccion: "Auditoría",
        titulo: "Cada paso que se agrega, se cambia o se saca de una orden queda con nombre y hora",
        detalle:
            "La orden tiene una solapa nueva, «5. Historial», con todo lo que se hizo con sus pasos: «Julián agregó el paso 4 — TORNO CNC», «Lucas cambió el paso 2 — SOLDADURA: minutos 60 → 2700». Dice quién fue, qué cambió de cada campo y el día y la hora con segundos, porque dos pasos agregados en el mismo guardado caen en el mismo minuto y a veces lo que se quiere saber es cuál vino primero. Al costado dice también por dónde entró el cambio: si fue el planificador, un deshacer, una acción sobre varias OT o el borrado de un proceso del catálogo. Lo mismo, pero de todas las órdenes juntas, está en Auditoría › Pasos de las OT, y ahí se puede buscar por persona, por proceso o por número de OT. Sirve para cuando un proceso aparece dos veces y hay que saber si lo cargó alguien o si vino así: hasta ahora lo único que quedaba era que «alguien editó la orden #1081», sin decir qué paso, y en una orden de doce pasos eso no alcanzaba para nada. Ojo: empieza hoy. Lo de antes no aparece porque nunca se guardó — esos pasos vinieron del sistema viejo.",
        href: "/auditoria",
    },
    {
        id: "cerrar-una-ot-sin-cambios-no-pregunta",
        fecha: "2026-09-16",
        tipo: "arreglo",
        seccion: "Operaciones",
        titulo: "Si abrís una OT, no tocás nada y la cerrás, ya no te pregunta si querés descartar",
        detalle:
            "Abrías una orden sólo para mirarla, la cerrabas y te saltaba «Descartar los cambios, perderás los cambios que hiciste». No había ningún cambio: el sistema preguntaba «¿tiene datos?» en vez de «¿cambió algo?», y una OT que se edita siempre tiene cliente y procesos, así que el cartel salía siempre. Ahora se compara contra cómo estaba al abrirla. Si cambiaste algo —aunque sea un número, un archivo o el orden de un paso— el cartel sigue saliendo, que para eso está.",
        href: "/operaciones",
    },
    {
        id: "el-horario-se-lee-y-se-cambia-mejor",
        fecha: "2026-09-16",
        tipo: "mejora",
        seccion: "Operaciones",
        titulo: "En Diaria se ve cuál paso sigue en curso, y el horario se cambia en un cuadrito aparte",
        detalle:
            "Si mirabas un miércoles y te aparecía una OT con horarios del viernes, parecía un error: era un paso largo —soldar 2700 minutos son más de cinco jornadas— que arrancó el viernes y todavía está en curso. Ahora ese paso se ve en azul y dice «sigue en curso este día», y el que arranca ese día queda resaltado. Además el día y la hora dejaron de verse despintados, el lapicito está siempre a la vista, y al tocar el horario se abre un cuadrito con lugar de sobra y botones de Guardar y Cancelar: antes el campo no entraba en la celda y se guardaba solo con hacer click en cualquier otro lado.",
        href: "/operaciones",
    },
    {
        id: "salir-del-planificador-con-la-x",
        fecha: "2026-09-16",
        tipo: "mejora",
        seccion: "Operaciones",
        titulo: "El planificador se cierra con una X, y desde la vista previa se vuelve atrás sin buscar",
        detalle:
            "Salir estaba, pero perdido al final de una fila de controles, del mismo tamaño y color que el zoom y los filtros. Ahora hay una X arriba a la derecha, separada del resto, en los dos pasos y también al re-planificar. Y en la vista previa apareció «Volver a elegir OTs» arriba: antes ese botón sólo estaba abajo de todo y decía «Volver» a secas, así que no se sabía si volvía al paso anterior o se iba del planificador.",
        href: "/operaciones",
    },
    {
        id: "acciones-sobre-las-ot-tildadas",
        fecha: "2026-09-16",
        tipo: "nuevo",
        seccion: "Operaciones",
        titulo: "Al tildar órdenes aparece una barra con lo que podés hacer con ellas",
        detalle:
            "Antes tildar OTs no se notaba: lo único que cambiaba era que el botón rojo de arriba pasaba de decir «Eliminar plan» a «Quitar 5 OTs», en el mismo lugar y del mismo color. Ahora aparece una barra que te dice cuántas tenés tildadas y qué podés hacer: darlas por terminadas todas juntas, volverlas a pendientes o sacarlas de la planificación. Marcar como terminadas hace de una lo que antes era tildar paso por paso, y te avisa antes cuántas órdenes va a tocar.",
        href: "/operaciones",
    },
    {
        id: "la-hora-de-arranque-se-lee-mejor",
        fecha: "2026-09-16",
        tipo: "mejora",
        seccion: "Operaciones",
        titulo: "El horario de cada paso se lee de un vistazo y la lista dejó de tener huecos",
        detalle:
            "La hora de arranque ahora resalta sobre el día, que es lo que uno busca cuando mira la lista. Y se acomodaron las columnas: había un espacio en blanco enorme entre el nombre del proceso y el horario, y arriba el nombre de la planificación se cortaba a la mitad. Ahora entra entero y el aire quedó del lado derecho, donde están los recursos.",
        href: "/operaciones",
    },
    {
        id: "planificacion-vive-adentro-de-planificadas",
        fecha: "2026-09-16",
        tipo: "mejora",
        seccion: "Operaciones",
        titulo: "La planificación pasó a vivir adentro de «Planificadas»: una sola pantalla",
        detalle:
            "Había dos lugares que decían «planificadas» y mostraban lo mismo de dos maneras: uno con los horarios de cada paso y otro sin ellos, cada uno con su propia idea de qué está planificado y qué no. Ahora hay uno solo: entrás a Órdenes de Trabajo → Planificadas y ahí adentro está todo — qué planificación estás mirando, la semana o el día, el horario de cada paso, lo entregado, lo terminado y la carga de cada persona. Se fue la solapa «Planificación» de arriba, y los cortes de adentro quedaron más chicos para que no se peleen con las solapas principales.",
        href: "/operaciones",
    },
    {
        id: "la-pantalla-abre-en-el-plan-que-esta-corriendo",
        fecha: "2026-09-16",
        tipo: "mejora",
        seccion: "Operaciones",
        titulo: "Planificación abre en la planificación que está corriendo y en el día de hoy",
        detalle:
            "Antes abría en «Todas las Planificaciones» y se quedaba clavada donde la habías dejado la última vez: podías estar mirando la de mayo sin darte cuenta. Y peor, elegir una planificación te movía también el día: Semanal y Diaria se iban a la semana en que la habías armado, no a la semana en que se hace el trabajo. Ahora son dos cosas separadas: arriba elegís QUÉ planificación mirar (arranca en la más nueva, que dice «la que está corriendo») y el calendario elige QUÉ DÍA, que arranca en hoy.",
        href: "/operaciones",
    },
    {
        id: "cuando-el-dia-esta-vacio-la-pantalla-lo-explica",
        fecha: "2026-09-16",
        tipo: "mejora",
        seccion: "Operaciones",
        titulo: "Si el día está vacío, la pantalla te dice cuándo arranca el trabajo",
        detalle:
            "Si planificás con la jornada ya empezada, el trabajo es para el día siguiente, así que la vista Diaria de hoy queda vacía: eso está bien, pero antes parecía que algo había fallado. Ahora aparece «Esta planificación arranca el jue 17/09 — ir a ese día» y con un click estás ahí. Y cada lista vacía explica por qué está vacía, en vez de decir siempre lo mismo.",
        href: "/operaciones",
    },
    {
        id: "la-agenda-ya-no-muestra-ot-entregadas",
        fecha: "2026-09-16",
        tipo: "arreglo",
        seccion: "Operaciones",
        titulo: "Semanal y Diaria ya no muestran OTs que ya se entregaron",
        detalle:
            "Una OT entregada, con el cartel verde y la fecha de entrega puesta, se caía de Planificadas pero seguía apareciendo en la semana y en el día. Así podías ver «No hay órdenes activas» en una solapa y una lista de trabajo en la de al lado, mirando la misma planificación. Ahora las tres listas usan el mismo criterio. La solapa Carga también dejó de sumar trabajo ya terminado o entregado: los minutos y los días ocupados de cada persona son lo que le falta hacer.",
        href: "/operaciones",
    },
    {
        id: "completadas-y-finalizadas-ahora-se-entienden",
        fecha: "2026-09-16",
        tipo: "mejora",
        seccion: "Operaciones",
        titulo: "«Completadas» y «Finalizadas» ahora dicen de qué hablan",
        detalle:
            "Eran dos solapas que mostraban casi lo mismo y nadie sabía en qué se diferenciaban. Pasaron a llamarse «Entregadas al cliente» (el cliente ya las recibió) y «Terminadas en el taller» (todos los pasos hechos y TODAVÍA SIN ENTREGAR, o sea lo que hay para despachar). Ahora no se repiten entre sí, y las seis solapas muestran cuántas OTs tiene cada una.",
        href: "/operaciones",
    },
    {
        id: "entrar-a-una-ot-y-borrar-un-plan-mas-rapido",
        fecha: "2026-09-16",
        tipo: "mejora",
        seccion: "Operaciones",
        titulo: "Entrás a la OT desde cualquier lista, y borrar planificaciones cuesta menos",
        detalle:
            "En Semanal, Diaria y Terminadas el doble clic en una fila no hacía nada, aunque el globito dijera que sí: ahora abre la OT, igual que en las otras listas, y también aparecen las casillas para tildar y sacar una OT desde donde la ves. El botón del tacho dice qué va a hacer antes de apretarlo («Quitar 2 OTs» o «Eliminar plan») y el cartel de confirmación nombra la planificación y te dice cuántas OTs y cuántos renglones se lleva. Y abajo del desplegable hay «Limpiar planificaciones viejas», que borra todas las anteriores de una sola vez sin tocar la que está corriendo.",
        href: "/operaciones",
    },
    {
        id: "los-horarios-del-plan-ya-no-arrancan-en-el-pasado",
        fecha: "2026-09-16",
        tipo: "arreglo",
        seccion: "Operaciones",
        titulo: "Los horarios del plan ya no arrancan en un día que ya pasó",
        detalle:
            "Si planificabas un miércoles a las 11 de la mañana, la lista te ponía el primer proceso ese mismo miércoles a las 9 —dos horas antes de que apretaras el botón— y horarios como las 9:06 o las 16:20, que no existen porque a esa hora el taller está desayunando o ya cerró. El plan siempre estuvo bien armado: lo que estaba mal era la pantalla, que se hacía la cuenta por su lado con una jornada de 9 a 18 en vez de la de 7 a 16. Ahora los horarios que ves son los del plan, y arrancan después de haberlo hecho: si planificás con la jornada empezada, el trabajo es para el día siguiente a las 7.",
        href: "/operaciones",
    },
    {
        id: "no-se-puede-crear-un-proceso-sin-nombre",
        fecha: "2026-09-15",
        tipo: "arreglo",
        seccion: "Recursos",
        titulo: "Ya no se puede crear un proceso sin nombre",
        detalle:
            "Si guardabas un proceso con el nombre vacío, se creaba igual y quedaba en el listado como un renglón en blanco, entre los otros 415. Cualquiera lo podía elegir sin querer al cargar una orden y ahí ya quedaba enganchado. Ahora te avisa que le pongas un nombre.",
        href: "/procesos",
    },
    {
        id: "auditoria-de-todo",
        fecha: "2026-09-15",
        tipo: "nuevo",
        seccion: "Auditoría",
        titulo: "Ahora queda registrado todo lo que se carga, se cambia y se borra",
        detalle:
            "En Auditoría hay una pestaña nueva, «Todo lo que se hizo», con un renglón por cada cosa que alguien hace en el sistema: «Lucas eliminó persona #5», «Julián editó orden de trabajo #1081». Se puede filtrar por quién lo hizo, por qué tipo de cosa tocó, o buscar un nombre o un número de OT. Antes esto sólo existía para las planificaciones: si alguien borraba una máquina o le cambiaba los minutos a un proceso, no quedaba rastro en ninguna parte. Lo que alguien intentó y no se pudo también queda — es lo primero que se busca cuando «le di a guardar y no pasó nada».",
        href: "/auditoria",
    },
    {
        id: "un-proceso-puede-ir-a-mano",
        fecha: "2026-09-15",
        tipo: "nuevo",
        seccion: "Operaciones",
        titulo: "Un paso puede ir «a mano»: ahora se puede decir que no lleva máquina",
        detalle:
            "En la columna de recurso maquinaria apareció la opción «No lleva máquina (a mano)». No es lo mismo que dejarlo vacío: vacío significa que lo decide el planificador, y le buscaba una máquina igual — por eso el enderezado o el oxicorte aparecían siempre como trabajos a los que les faltaba una máquina. Ya quedaron marcados así los 16 pasos de las órdenes abiertas donde el taller había contestado que van a mano.",
        href: "/operaciones",
    },
    {
        id: "el-orden-de-los-procesos-queda-como-lo-dejaste",
        fecha: "2026-09-15",
        tipo: "arreglo",
        seccion: "Operaciones",
        titulo: "El orden de los procesos queda como lo dejaste",
        detalle:
            "Cargabas los pasos 1, 2, 3 de una orden, guardabas, y al volver a abrirla aparecían en cualquier orden. Los datos nunca se perdieron —el orden que pusiste siempre estuvo guardado—, pero la pantalla los mostraba mal y te hacía dudar de todo lo demás. Ya se ven en el orden correcto en las 152 órdenes que tienen procesos.",
        href: "/operaciones",
    },
    {
        id: "escribir-el-numero-de-paso",
        fecha: "2026-09-15",
        tipo: "nuevo",
        seccion: "Operaciones",
        titulo: "Podés escribir el número de paso para mover un proceso",
        detalle:
            "En la columna «#» de los procesos ahora se escribe el número: ponés 3 y ese proceso se va al paso 3, y los demás se corren solos. Antes la única forma era arrastrar la fila de a una, que con ocho pasos es un rato largo. La manija de arrastrar sigue estando.",
        href: "/operaciones",
    },
    {
        id: "la-ot-dice-si-es-fabricacion-reparacion-o-sin-cargo",
        fecha: "2026-09-15",
        tipo: "nuevo",
        seccion: "Operaciones",
        titulo: "Al abrir una orden ya dice si es Fabricación, Reparación o Sin Cargo",
        detalle:
            "Está arriba de todo, al lado del número de OT. Faltaba la opción «Sin Cargo», y además el dato no venía del sistema viejo: las órdenes se veían todas en blanco. Se trajo el tipo de las 1.246 órdenes que vinieron de allá — quedaron 850 de fabricación, 368 de reparación y 28 sin cargo.",
        href: "/operaciones",
    },
    {
        id: "cambiar-el-proceso-de-una-fila-se-guarda",
        fecha: "2026-09-15",
        tipo: "arreglo",
        seccion: "Operaciones",
        titulo: "Cambiar el proceso de una fila ya se guarda",
        detalle:
            "Si en una orden ya cargada le cambiabas el proceso a una fila y guardabas, quedaba el proceso viejo con los minutos nuevos, sin avisar nada.",
        href: "/operaciones",
    },
    {
        id: "el-plan-ya-no-arranca-en-horas-que-ya-pasaron",
        fecha: "2026-09-11",
        tipo: "arreglo",
        seccion: "Planificación",
        titulo: "El plan ya no empieza en horas que ya pasaron",
        detalle:
            "Si planificabas un jueves a las cuatro de la tarde, el plan te ponía trabajos a las diez de la mañana de ESE jueves: media jornada del plan ya había pasado antes de imprimirlo. Ahora, si la jornada ya arrancó, el plan es para el día siguiente — y sólo se planifica para hoy si todavía no abrieron. El viernes a la tarde salta el fin de semana y arranca el lunes.",
        href: "/operaciones",
    },
    {
        id: "guardar-la-planificacion-es-instantaneo",
        fecha: "2026-09-11",
        tipo: "mejora",
        seccion: "Planificación",
        titulo: "Confirmar la planificación es instantáneo",
        detalle:
            "Al confirmar quedabas varios segundos frente al cartel de «guardando» cuando el plan ya estaba guardado: lo que faltaba era volver a traer las órdenes y los recursos para refrescar las listas. Ahora el cartel se va apenas el plan queda escrito y las listas se actualizan solas, sin taparte la pantalla ni hacerte esperar.",
        href: "/operaciones",
    },
    {
        id: "hoja-del-panol-el-plan-en-papel-dia-por-dia",
        fecha: "2026-09-11",
        tipo: "nuevo",
        seccion: "Planificación",
        titulo: "Podés imprimir el plan para el pañol, día por día",
        detalle:
            "En la vista previa del plan hay un botón nuevo, «Hoja del pañol». Saca el plan en papel agrupado por día: qué órdenes salen cada jornada, qué trabajo, en qué máquina, quién lo hace y cuántos minutos, con una columna para tildar «Preparado» cuando el material y las herramientas ya están listos. Es distinta de la hoja de la orden, que sirve para seguir UNA orden de principio a fin: el pañol no trabaja por orden, trabaja por día. Se imprime el plan que estás mirando, con los cambios que hiciste a mano, sin necesidad de confirmarlo primero.",
        href: "/operaciones",
    },
    {
        id: "las-barras-para-scrollear-de-costado-se-ven-siempre",
        fecha: "2026-09-11",
        tipo: "mejora",
        seccion: "Todo el sistema",
        titulo: "Las barras para correr las tablas hacia el costado ahora se ven siempre",
        detalle:
            "Cuando una tabla sigue para la derecha, ahora se ve la barra abajo con sus flechitas en las puntas, y no aparece sólo mientras scrolleás. Antes, en una computadora con mouse no había ninguna señal de que la fila continuaba, así que las columnas de la derecha —la fecha prometida, quién aprobó, el pedido— era como si no existieran. Vale en todas las pantallas, no sólo en las listas de órdenes.",
    },
    {
        id: "materias-primas-se-mira-y-se-puede-marcar-que-no-lleva",
        fecha: "2026-09-11",
        tipo: "arreglo",
        seccion: "Órdenes de Trabajo",
        titulo: "La solapa de Materias Primas dejó de perder lo que cargabas, y podés marcar que una orden no lleva",
        detalle:
            "Tenía un formulario para agregar materiales que no guardaba en ningún lado: los juntaba en pantalla, salían en la hoja de pañol y se perdían al cerrar. Las materias primas las maneja el sistema viejo y vienen solas cada pocos minutos, así que cargarlas acá nunca iba a funcionar: el formulario se fue y la pantalla ahora dice dónde se cargan. Lo mismo con «Utilizado» y «Cortes», que se tildaban y no quedaban. Y la casilla «no lleva materias primas» ahora sí se guarda: marcala y la columna Material deja de decir «Sin cargar» y pasa a decir «No lleva», que es otra cosa — una hay que ir a cargarla y la otra hay que saltearla. Es lo mismo que ya se hizo con «no lleva plano».",
        href: "/operaciones",
    },
    {
        id: "la-descripcion-del-producto-ya-no-pisa-la-observacion",
        fecha: "2026-09-11",
        tipo: "arreglo",
        seccion: "Operaciones",
        titulo: "Editar el producto de una orden ya no te borra la observación",
        detalle:
            "La columna Producto se dejaba editar en cualquier orden, pero lo que escribías no iba a parar ahí: la celda volvía sola al texto anterior —como si no hubieras guardado— y encima te reemplazaba la observación de la orden sin decirte nada. Ahora se edita sólo en las órdenes que no tienen producto cargado y en las heredadas, que son justamente las que muestran ahí el texto de la orden: en esas, lo que escribís es lo que queda. Y si la orden todavía no tiene nada escrito, el campo abre vacío en lugar de traer el texto del producto, así lo que queda es lo que escribiste vos. En el resto la celda es de lectura, porque ese texto es el nombre del producto y lo comparten todas las órdenes que fabrican esa pieza.",
        href: "/operaciones",
    },
    {
        id: "se-ve-que-celdas-de-la-lista-se-pueden-editar",
        fecha: "2026-09-11",
        tipo: "mejora",
        seccion: "Operaciones",
        titulo: "Ahora se ve cuáles celdas de la lista se pueden editar con un click",
        detalle:
            "Ocho columnas de la lista de órdenes se editan haciendo click encima —las tres fechas, la cantidad, el N° de pedido, quién aprobó, quién pidió, y el producto en las órdenes donde se puede— y nada lo avisaba: aparecía un campo con un tilde y una cruz sin que uno supiera que esa celda se podía tocar. Ahora, al pasar el mouse por una celda editable asoma un lápiz y el cartelito dice qué vas a editar. En el detalle de la orden, además: el inicio estimado ya se cancela con Escape, y la cruz de los minutos cancela de verdad — antes guardaba justo lo que querías descartar. El campo de los minutos ahora se abre en un recuadro propio por encima de la fila: sigue tapando lo que tiene al lado mientras lo estás usando, pero ya no corre las columnas ni deja el campo a medias.",
        href: "/operaciones",
    },
    {
        id: "el-detalle-abre-en-procesos-en-todas-las-listas",
        fecha: "2026-09-11",
        tipo: "mejora",
        seccion: "Operaciones",
        titulo: "Al desplegar una orden ves los procesos primero, también al planificar",
        detalle:
            "Arriba aparecía la galería de archivos —casi siempre vacía— que se llevaba media pantalla y dejaba los procesos abajo de todo, que es para lo que uno despliega la fila. Ahora los procesos van primeros y los archivos quedan en un renglón plegado abajo, que se abre cuando hace falta. La barra de entrega no se pliega: sigue a la vista, porque es con la que se registra una entrega. Esto ya pasaba en la lista de órdenes sin planificar: ahora también en las solapas de Operaciones y en la pantalla donde elegís qué planificar. En Historial sigue como estaba.",
        href: "/operaciones",
    },
    {
        id: "el-plan-guardado-conserva-lo-que-agregaste-a-mano",
        fecha: "2026-09-11",
        tipo: "arreglo",
        seccion: "Planificación",
        titulo: "Cuando retomás un plan sin confirmar, sigue lo que habías agregado a mano",
        detalle:
            "Si agregabas órdenes al plan —o elegías sólo dos procesos de una orden que tiene trece— y después salías, al retomarlo se abría como si no hubieras agregado nada: no estaba el contador de «a mano», ni el botón para deshacerlo, y en cuanto el plan se volvía a calcular la orden regresaba con sus trece procesos sin avisarte. Ahora eso viaja con el plan guardado y vuelve tal cual lo dejaste. Los planes guardados antes de hoy se siguen abriendo igual que siempre.",
        href: "/operaciones",
    },
    {
        id: "las-tandas-grandes-ya-no-se-cortan-a-los-tres-minutos",
        fecha: "2026-09-11",
        tipo: "arreglo",
        seccion: "Planificación",
        titulo: "Planificar muchas órdenes de una ya no se corta a mitad de camino",
        detalle:
            "Con una tanda grande —60 órdenes tardan unos cuatro minutos— el cálculo se cortaba solo a los tres y te dejaba sin plan, aunque del otro lado hubiera terminado bien. Ahora espera hasta siete minutos. Y la barra de progreso dejó de prometer un tiempo que no daba: calculaba menos de la mitad de lo que iba a tardar, así que se arrastraba en el ochenta y pico mientras el reloj seguía corriendo — que es justo lo que hace pensar que se colgó.",
        href: "/operaciones",
    },
    {
        id: "material-sin-cargar-ya-no-frena-la-planificacion",
        fecha: "2026-09-11",
        tipo: "arreglo",
        seccion: "Planificación",
        titulo: "Ya no te frena para planificar una orden que no tiene cargada la lista de material",
        detalle:
            "Si tildabas una orden sin material, el botón Planificar no avanzaba: el único camino era «Sacarlas y planificar», que las dejaba afuera. Y casi nunca era falta de material de verdad — la columna decía «Sin Stock» en rojo tanto para la que no tiene material como para la que simplemente no tiene cargada la lista, que son cosas opuestas. Hoy son 17 órdenes sin cargar y ninguna sin material, así que todo ese freno era por un dato que falta, no por una pieza que falta. Ahora la columna las distingue: «Sin stock» en rojo es falta real y «Sin cargar» en gris es que nadie cargó la lista. Sólo la primera te avisa al planificar, y ese aviso ya no frena nada: si querés dejarlas afuera, el cartel trae el botón para sacarlas.",
        href: "/operaciones",
    },
    {
        id: "el-formulario-de-la-orden-usa-la-pantalla",
        fecha: "2026-09-11",
        tipo: "arreglo",
        seccion: "Órdenes de Trabajo",
        titulo: "El formulario de la orden ya usa la pantalla entera",
        detalle:
            "Se abría angosto, con cuatro campos apretados en media pantalla: el cliente aparecía cortado («INDUSTRIAS CERAM…»), los rótulos de las solapas también, y había que scrollear para ver la ficha completa. Ahora ocupa el ancho de la pantalla y en la solapa de datos entran seis campos por fila en vez de cuatro. Los mismos campos y los mismos datos: lo que cambió es que se ven.",
        href: "/operaciones",
    },
    {
        id: "acordeon-en-el-listado-de-ot",
        fecha: "2026-09-11",
        tipo: "mejora",
        seccion: "Órdenes de Trabajo",
        titulo: "Al abrir una orden se cierra la anterior",
        detalle:
            "El detalle de una orden mide media pantalla, así que con dos o tres abiertas la lista dejaba de ser una lista y había que scrollear a ciegas para encontrar la siguiente. Ahora se mantiene una sola abierta por vez. Si necesitás comparar varias órdenes, la solapa Todas las muestra de a una fila.",
        href: "/operaciones",
    },
    {
        id: "vocabulario-parejo-en-todas-las-pantallas",
        fecha: "2026-09-11",
        tipo: "mejora",
        seccion: "Todo el sistema",
        titulo: "Ahora todas las pantallas le dicen igual a las mismas cosas",
        detalle:
            "En una pantalla decía «Operario», en otra «Empleado», en otra «Persona»; y «Máquina», «Maquinaria» o «Máquinas y Equipos» según dónde estuvieras. Se unificó en todo el sistema: Recurso humano, Cantidad de recurso humano, Recurso maquinaria y Proceso. Son 145 textos entre encabezados de tabla, formularios de Recursos, avisos del planificador, el tablero y la hoja impresa de la OT. Sólo cambiaron los carteles: ningún dato, ningún filtro y ninguna orden se tocaron.",
    },
    {
        id: "deshacer-todo-lo-agregado-a-mano",
        fecha: "2026-09-11",
        tipo: "mejora",
        seccion: "Operaciones",
        titulo: "Deshacer puede volver al plan original de una sola vez",
        detalle:
            "Al lado de «Deshacer» aparece «todo» cuando agregaste cosas a mano en más de una tanda: saca todas juntas y vuelve al plan que salió del cálculo original, en vez de tener que apretar Deshacer una vez por cada cosa que agregaste. Con una sola tanda no aparece, porque haría exactamente lo mismo que el botón de al lado.",
        href: "/operaciones",
    },
    {
        id: "detalle-de-ot-muestra-produccion",
        fecha: "2026-09-11",
        tipo: "mejora",
        seccion: "Órdenes de Trabajo",
        titulo: "Al desplegar una orden, lo primero que se ve son los procesos",
        detalle:
            "Antes aparecían arriba dos cajas casi vacías —Observaciones y Archivos— que se llevaban media pantalla y empujaban Producción hasta abajo, que es justamente para lo que uno abre la fila. Ahora Producción va primera, y Observaciones y archivos quedan en un renglón plegado abajo que se abre si hace falta; si la orden tiene observaciones cargadas, el renglón lo avisa. El detalle además usa todo el ancho de la tabla en vez de cortarse a la mitad.",
        href: "/operaciones",
    },
    {
        id: "edicion-de-minutos-se-entiende",
        fecha: "2026-09-11",
        tipo: "arreglo",
        seccion: "Órdenes de Trabajo",
        titulo: "Editar los minutos de un proceso ya se entiende",
        detalle:
            "El lápiz y el tacho de cada proceso estaban invisibles hasta pasarles el mouse por encima, así que no había forma de saber que la fila se podía editar salvo tropezársela. Ahora se ven siempre, apenas marcados. Y al editar, la cajita dice «Min.» — antes era un número suelto que aparecía lejos de la columna de minutos y no se entendía qué era. Además salir del campo ahora guarda: antes había que acertarle al tilde y hacer click en otro lado tiraba lo escrito sin avisar.",
        href: "/operaciones",
    },
    {
        id: "todas-las-ordenes-es-una-solapa",
        fecha: "2026-09-11",
        tipo: "mejora",
        seccion: "Operaciones",
        titulo: "«Todas» es una solapa más, al lado de No Planificadas y Planificadas",
        detalle:
            "La lista con todas las órdenes juntas estaba como una sección aparte del menú, y quedaban dos cosas llamadas «Órdenes de Trabajo» en lugares distintos. Ahora es la cuarta solapa, donde uno la busca: No Planificadas · Planificadas · Historial · Todas. Sirve para lo mismo de siempre — que una orden no desaparezca de la vista al planificarla y se pueda comprobar dónde quedó — con los contadores arriba haciendo de filtro.",
        href: "/operaciones",
    },
    {
        id: "modal-ot-entra-mas",
        fecha: "2026-09-11",
        tipo: "mejora",
        seccion: "Órdenes de Trabajo",
        titulo: "En la orden entran más procesos sin scrollear",
        detalle:
            "El modal era más chico que la pantalla: quedaban cientos de píxeles muertos a los costados mientras la lista de procesos scrolleaba a las cuatro filas. Ahora ocupa hasta el 95% del ancho y casi todo el alto. Además la cabecera se achicó y se sacó un título que estaba repetido dos veces seguidas —«Procesos de la Orden» y abajo «Procesos de la orden (7 activos de 7)»—, que eran dos renglones enteros justo arriba de lo que uno quiere mirar.",
        href: "/operaciones",
    },
    {
        id: "modal-ot-mas-prolijo",
        fecha: "2026-09-11",
        tipo: "arreglo",
        seccion: "Órdenes de Trabajo",
        titulo: "El modal de la orden quedó más prolijo y dice la verdad sobre las materias primas",
        detalle:
            "Tres arreglos. El texto de ayuda del pie de Procesos se veía partido en pedazos con huecos raros: ya se lee como una frase. Los desplegables de la solapa General eran cuatro píxeles más altos que los campos de al lado, así que las filas quedaban desparejas; ahora miden lo mismo. Y la solapa Materias Primas ahora avisa que todavía no guarda: lo que se carga ahí sirve para imprimir la hoja de pañol, pero el dueño de ese dato sigue siendo el sistema viejo, así que si falta un material hay que cargarlo allá. Antes no lo decía y se perdía en silencio.",
        href: "/operaciones",
    },
    {
        id: "ver-lo-planificado-en-los-procesos",
        fecha: "2026-09-11",
        tipo: "arreglo",
        seccion: "Órdenes de Trabajo",
        titulo: "Abrir una orden ya planificada muestra quién y en qué máquina quedó cada paso",
        detalle:
            "Hasta ahora, abrir una orden que ya estaba planificada mostraba «Sin máquina» y «Sin asignar» en todos sus procesos, como si se hubiera perdido el plan. No se perdía nada: esas dos casillas son para FORZAR a mano —decir «este paso lo hace sí o sí Fulano»— y normalmente están vacías, porque de eso justamente se encarga el planificador. Ahora, debajo de cada una, aparece en verde lo que el planificador asignó de verdad, y en ámbar si quedó sin nadie o sin máquina reservada. Arriba se elige, abajo se ve lo que salió.",
        href: "/operaciones",
    },
    {
        id: "el-plano-se-puede-sacar-de-los-procesos",
        fecha: "2026-09-11",
        tipo: "arreglo",
        seccion: "Órdenes de Trabajo",
        titulo: "El plano ya no te tapa el nombre del proceso",
        detalle:
            "Al cargar los procesos de una OT, el cuadro del plano de la derecha se comía el ancho y la columna con el NOMBRE del proceso quedaba en unos pocos píxeles: había que imprimir la orden para saber qué paso era cada uno. Ahora el nombre del proceso tiene su espacio garantizado y, si querés más lugar todavía, el botón «Ocultar» del cuadro lo saca — y se acuerda de tu decisión, así que no hay que cerrarlo en cada orden. El plano sigue entero en la solapa Planos.",
        href: "/operaciones",
    },
    {
        id: "un-click-despliega-dos-clicks-abren",
        fecha: "2026-09-11",
        tipo: "arreglo",
        seccion: "Órdenes de Trabajo",
        titulo: "Errarle a la flechita ya no te abre la orden entera",
        detalle:
            "En los listados, un click ahora despliega el detalle y hacen falta dos para abrir la orden. Antes el mismo click hacía las dos cosas, así que errarle a la flechita por unos píxeles te tiraba la orden completa encima, y al cerrarla quedabas con la fila desplegada sin haberlo pedido. Además la flechita pasó a ocupar toda su columna, así que es mucho más difícil errarle, y ahora también cierra las filas que se abrieron solas al buscar un proceso — antes ahí no respondía.",
        href: "/operaciones",
    },
    {
        id: "deshacer-cambio-de-procesos",
        fecha: "2026-09-10",
        tipo: "nuevo",
        seccion: "Operaciones",
        titulo: "Si te equivocás editando los procesos de una OT, ahora se puede deshacer",
        detalle:
            "Antes, guardar los procesos de una orden era definitivo: la lista que mandabas pisaba lo que había y lo que no estaba se borraba, sin forma de volver. Ahora, antes de cada cambio se guarda una copia, y en el editor hay un botón «Deshacer el último cambio» que deja la orden como estaba — con el avance incluido, así que un proceso que ya estaba terminado no vuelve en Pendiente. El deshacer también deja su copia, o sea que se puede deshacer el deshacer. El botón dice quién hizo el cambio y cuándo.",
        href: "/operaciones",
    },
    {
        id: "reparacion-fabricacion-y-sin-plano",
        fecha: "2026-09-10",
        tipo: "nuevo",
        seccion: "Órdenes de Trabajo",
        titulo: "Cada OT dice si es reparación o fabricación, y cuáles no llevan plano",
        detalle:
            "En la orden ahora se elige Fabricación o Reparación con un clic —es una sola elección, no dos casillas— y el listado tiene su columna, así que se filtra de un vistazo. Y al lado de «Tiene plano» apareció «No lleva plano»: hasta ahora una pieza sin plano cargado y una que no necesita ninguno se veían iguales, y son lo contrario. Con eso marcado, el que revisa planos se la saltea en vez de ir a buscarla al Drive. Arriba del listado están los tres contadores de lo que falta completar —sin procesos, sin tipo y falta plano— y cada uno filtra.",
        href: "/ordenes",
    },
    {
        id: "guardar-plan-muestra-progreso",
        fecha: "2026-09-10",
        tipo: "arreglo",
        seccion: "Operaciones",
        titulo: "Guardar la planificación es instantáneo y guarda lo que ves",
        detalle:
            "Antes, al apretar Guardar, el sistema volvía a calcular el plan entero: hasta un minuto de pantalla muda, y con una trampa escondida — como el cálculo no da siempre el mismo reparto, podías mirar un plan y guardar otro distinto sin enterarte. Ahora se guarda exactamente lo que está en pantalla, que es lo que aprobaste, y tarda segundos. No hace falta recalcular: cada cosa que tocás acá (forzar una OT, sacarla, editarle los procesos) ya recalcula en el momento, y si cambiás algo en Recursos el plan se revisa solo al volver.",
        href: "/operaciones",
    },
    {
        id: "auditoria-dice-quien",
        fecha: "2026-09-10",
        tipo: "mejora",
        seccion: "Auditoría",
        titulo: "La auditoría ahora dice quién planificó y quién borró",
        detalle:
            "Antes cada movimiento quedaba anotado con qué pasó y cuándo, pero no con quién lo hizo, y esa es la primera pregunta cuando un plan aparece cambiado. Ahora cada intento de planificación y cada borrado llevan el nombre de la persona. Los movimientos anteriores al 10 de septiembre dicen «sin registrar», porque en ese momento el dato no se guardaba: es distinto de no saberlo.",
        href: "/auditoria",
    },
    {
        id: "todas-las-ordenes-en-una-lista",
        fecha: "2026-09-10",
        tipo: "nuevo",
        seccion: "Órdenes de Trabajo",
        titulo: "Una pantalla con TODAS las órdenes, las que están en el plan y las que no",
        detalle:
            "Es la primera del menú. Arriba están los cuatro números —el total, cuántas entraron al plan, cuántas quedaron afuera y cuántas ya se entregaron— y cada uno es un filtro: lo tocás y la lista queda con esas nomás. Cada orden dice su cliente, el artículo, para cuándo está prometida, cuántos procesos tiene y si hay plano; las atrasadas van en rojo y las que no tienen ningún proceso cargado avisan, porque esas no se pueden planificar. Se busca por número de OT, cliente, artículo o código, y con un clic en la fila se abre la orden. Hasta ahora el trabajo se veía repartido en las solapas de Operaciones y el total no estaba en ninguna.",
        href: "/ordenes",
    },
    {
        id: "editar-procesos-desde-el-plan",
        fecha: "2026-09-10",
        tipo: "nuevo",
        seccion: "Operaciones",
        titulo: "Podés arreglar los procesos de una OT sin salir de la planificación",
        detalle:
            "En la vista previa, cada OT tiene ahora un botón al lado de la cruz que abre sus procesos: agregás, sacás, cambiás los minutos, arrastrás para reordenar y elegís la máquina y la persona de cada paso. Se guarda en la orden —no sólo en este plan— y al cerrar el plan se recalcula solo. Ojo con la diferencia: la cruz saca la OT del plan y no toca la orden, así que al recalcular vuelve igual; esto arregla la orden de verdad, que es lo que hace falta cuando el historial trajo un proceso que no va o falta una preparación.",
        href: "/operaciones",
    },
    {
        id: "trabas-de-una-frase",
        fecha: "2026-09-10",
        tipo: "mejora",
        seccion: "Operaciones",
        titulo: "Las trabas del plan se entienden de una leída",
        detalle:
            "Cada aviso arranca ahora con una sola frase que dice de qué se trata: «La máquina solo la puede usar un operario calificado. “Prensa” lo tiene que hacer un ayudante». Antes lo primero que se leía eran las dos primeras líneas de la explicación larga, o sea un párrafo cortado por la mitad, y para saber cuál era el problema había que abrirlo igual. La explicación completa sigue estando: aparece al desplegar el aviso.",
        href: "/operaciones",
    },
    {
        id: "biblioteca-de-planos-completa",
        fecha: "2026-09-09",
        tipo: "mejora",
        seccion: "Planos",
        titulo: "Ahora está el plano de casi todos los productos, no de unos pocos",
        detalle:
            "La biblioteca pasó de 811 productos con plano a 5066, así que de las órdenes abiertas hoy tienen dibujo 171 de 194 en vez de 31. Lo que faltaba no era el sistema: la carpeta de planos del taller se estaba viendo por la mitad y quedaron afuera más de cuatro mil carpetas de producto. Ya están todas cargadas, con sus fotos y sus PDF. Si una orden todavía dice «Sin plano» es porque ese producto no tiene carpeta en el Drive. Ojo: una carpeta nueva en el Drive todavía no entra sola, hay que avisar para que se traiga; si no, se puede cargar el archivo desde esta misma pantalla. (Corregido el 23/09: antes esta nota decía que aparecía sola, y no es así.)",
        href: "/planos",
    },
    {
        id: "biblioteca-de-planos",
        fecha: "2026-09-06",
        tipo: "nuevo",
        seccion: "Planos",
        titulo: "Los planos ahora son del producto y los tenés en la sección Planos",
        detalle:
            "Hay una sección nueva en el menú, Planos —y la misma lista está en Recursos—: buscás por el código, por la descripción del producto o por el nombre del archivo, y tocando cualquiera lo abrís grande, pasás al siguiente con las flechas, lo imprimís o lo bajás. Desde ahí también podés subir uno nuevo eligiendo a qué producto va, o borrarlo. Lo que subís queda pegado al PRODUCTO, así que lo ven todas las órdenes que lo fabrican, las de hoy y las que se carguen mañana: antes había que subir el mismo archivo orden por orden y casi ninguna lo tenía. Y cuando cargás los procesos de una orden, ahora te aparece al costado el plano del producto que esa orden fabrica, sin tener que cerrar lo que estás cargando para ir a buscarlo.",
        href: "/planos",
    },
    {
        id: "editar-y-sacar-procesos-desde-la-lista",
        fecha: "2026-09-03",
        tipo: "nuevo",
        seccion: "Operaciones › Órdenes de Trabajo",
        titulo: "Cambiá los minutos o sacá un paso desde la misma lista",
        detalle:
            "Abriendo una orden, cada paso tiene ahora un lápiz y un tacho al pasar el mouse: el lápiz te deja corregir los minutos ahí mismo y el tacho saca ese paso de la orden, avisándote antes que se pierde el avance que tenga cargado. Antes había que abrir la orden entera, ir hasta la tercera solapa y guardar todo para cambiar un número. Y si sacás todos los pasos, ahora podés guardar igual: antes te lo impedía y la orden quedaba trabada.",
        href: "/operaciones",
    },
    {
        id: "buscar-ot-sin-resultados",
        fecha: "2026-09-03",
        tipo: "arreglo",
        seccion: "Operaciones › Órdenes de Trabajo",
        titulo: "Si buscás una OT y no aparece, ahora te dice por qué",
        detalle:
            "Buscabas una orden por número, no estaba en la solapa donde estabas parado, y la pantalla te decía «Todas las órdenes de trabajo ya han sido planificadas»: cualquiera entendía que esa OT no existía en el sistema. Ahora dice que no hubo resultados para lo que buscaste y te avisa que puede estar en otra solapa o tapada por un filtro. Ojo que la búsqueda mira sólo la solapa abierta: si no la encontrás en No Planificadas, fijate en Planificadas e Historial.",
        href: "/operaciones",
    },
    {
        id: "guardar-ot-editada",
        fecha: "2026-09-03",
        tipo: "arreglo",
        seccion: "Operaciones › Órdenes de Trabajo",
        titulo: "Ya se pueden guardar los cambios de una orden: antes no guardaba nada",
        detalle:
            "Abrías una orden, le cambiabas los procesos o una fecha, apretabas el botón y sólo aparecía «Error al actualizar la Orden de Trabajo»: no se guardaba nada, ni lo que habías tocado ni el resto. Eran dos problemas distintos que se veían iguales, y los dos están arreglados. Además el botón ahora dice «Guardar cambios» cuando estás editando —decía «Crear Orden» siempre, y confundía— y si algo llega a fallar, el aviso te dice el motivo en vez de un cartel suelto: así se puede arreglar sin tener que adivinar.",
        href: "/operaciones",
    },
    {
        id: "imprimir-el-plano",
        fecha: "2026-09-03",
        tipo: "nuevo",
        seccion: "Operaciones › Órdenes de Trabajo",
        titulo: "El plano se puede imprimir y bajar desde la orden",
        detalle:
            "Al abrir un plano para verlo ahora tiene un botón «Imprimir» al lado de «Descargar», así sale en papel junto con la hoja de taller. Y el botón de bajar el archivo — el de la lupa y el nombre del plano — antes no hacía nada: ya baja.",
        href: "/operaciones",
    },
    {
        id: "operaciones-pantalla-completa",
        fecha: "2026-09-02",
        tipo: "mejora",
        seccion: "Operaciones",
        titulo: "Operaciones usa toda la pantalla: se ven más órdenes de un vistazo",
        detalle:
            "La sección estaba metida adentro de dos recuadros, uno arriba del otro, con mucho aire alrededor: entraban seis órdenes antes de tener que scrollear. Ahora la lista arranca casi arriba de todo y se ven la mitad más, las columnas ganaron ancho de los dos lados, y el título con las solapas quedan fijos mientras bajás — no perdés de vista en qué solapa estás ni el botón de Planificar.",
        href: "/operaciones",
    },
    {
        id: "primer-ingreso-cambiar-contrasena",
        fecha: "2026-09-02",
        tipo: "nuevo",
        seccion: "General",
        titulo: "La primera vez que entrás, elegís tu propia contraseña",
        detalle:
            "A quien recién le dan de alta le pasan la contraseña por chat, así que hasta que la cambie está escrita en algún lado. Ahora, la primera vez que entra, el sistema le pide una suya antes de dejarlo pasar — una sola vez. Y en Configuración › Mi cuenta cualquiera la puede cambiar cuando quiera: el sistema tenía cómo hacerlo pero no había pantalla, así que en los hechos nadie podía.",
        href: "/configuracion?tab=mi-cuenta",
    },
    {
        id: "quien-puede-hacer-cada-trabajo",
        fecha: "2026-09-02",
        tipo: "mejora",
        seccion: "Operaciones › Nueva OT",
        titulo: "Al elegir quién hace un proceso, ves quién puede y quién no",
        detalle:
            "El desplegable mostraba a todos por igual, así que se podía asignar a alguien que no tiene ese trabajo habilitado y el problema recién aparecía al planificar. Ahora los que pueden hacerlo van primero, y los que no quedan abajo con un «no lo tiene habilitado» al lado. No bloquea nada: si el que sabe no está, lo elegís igual — el sistema avisa, no decide.",
        href: "/operaciones",
    },
    {
        id: "hoja-de-taller-columna-dia",
        fecha: "2026-09-02",
        tipo: "mejora",
        seccion: "Operaciones › Órdenes de Trabajo",
        titulo: "La hoja impresa trae columna «Día», así no hay que cargar el proceso dos veces",
        detalle:
            "Cuando un trabajo llevaba dos días, se cargaba el proceso dos veces en la orden para tener dos renglones donde anotar. Eso rompía el orden de los pasos y el planificador veía dos trabajos donde hay uno. Ahora cada proceso sale impreso con tres renglones numerados Día 1, 2 y 3, cada uno con su fecha, hora de inicio y de fin: se carga una sola vez y se anota día por día.",
        href: "/operaciones",
    },
    {
        id: "borrar-proceso-del-catalogo",
        fecha: "2026-09-02",
        tipo: "nuevo",
        seccion: "Operaciones › Nueva OT",
        titulo: "Podés borrar del catálogo los procesos mal escritos, desde el mismo desplegable",
        detalle:
            "El catálogo se llenó de basura que el sistema viejo daba de alta sola: «PLEGADORA0», «AGUJEREADo y ROSCADO», «TORNO T1 trBAJO 3 dias 24h». Ahora, buscando el proceso, cada uno de la lista tiene un tacho al pasar el mouse. Si no lo usa ninguna orden, se borra y listo. Si está en alguna, te dice en cuáles y te avisa que ese paso se va de esas órdenes y se pierde el trabajo que tenga cargado — y ahí decidís. Las órdenes que estaban planificadas hay que volver a planificarlas.",
        href: "/operaciones",
    },
    {
        id: "las-ot-se-crean-todas-aca",
        fecha: "2026-09-02",
        tipo: "nuevo",
        seccion: "Operaciones › Órdenes de Trabajo",
        titulo: "Las órdenes ya no vienen del sistema viejo: se crean todas acá",
        detalle:
            "Cada cinco minutos el sistema traía las órdenes del sistema viejo y le devolvía a cada una lo que decía allá: fechas, cantidades, prioridad, sector. Por eso una orden importada tenía casi todo bloqueado — si te dejaba corregirla, la corrección se perdía sola al rato. Se hizo la última migración y se apagó: ahora las órdenes son de acá. Podés editar cualquiera, agregarle procesos, cambiarle lo que haga falta, y no se pisa más.",
        href: "/operaciones",
    },
    {
        id: "crear-proceso-desde-la-ot",
        fecha: "2026-09-02",
        tipo: "nuevo",
        seccion: "Operaciones › Nueva OT",
        titulo: "Si el proceso no está en la lista, lo creás ahí mismo",
        detalle:
            "Cuando el trabajo que había que cargar no existía como proceso, había que salir de la orden, ir a Recursos, crearlo y volver a empezar la carga. Ahora escribís el nombre en el buscador del proceso y, si no aparece, te ofrece crearlo: queda guardado y se puede usar en cualquier otra orden. Ojo que nace sin categoría ni máquina, así que conviene completarlo en Recursos para que el planificador lo sepa ubicar — el aviso te lo recuerda al crearlo.",
        href: "/operaciones",
    },
    {
        id: "hoja-de-taller-con-renglones-por-dia",
        fecha: "2026-09-02",
        tipo: "mejora",
        seccion: "Operaciones › Órdenes de Trabajo",
        titulo: "La hoja impresa tiene fecha y tres renglones por proceso",
        detalle:
            "Un trabajo de siete horas no se hace en un día, y la hoja tenía un solo renglón por proceso: terminabas escribiendo dos fechas apretadas en la misma celda. Ahora cada proceso trae tres renglones con columna de Fecha, para anotar día por día. Además la hoja se rediseñó para que se pueda llenar con birome y sobreviva a una fotocopia: encabezados oscuros, casilleros más altos, el logo arriba y firmas al pie.",
        href: "/operaciones",
    },
    {
        id: "toda-la-ot-la-hace-una-persona",
        fecha: "2026-09-02",
        tipo: "mejora",
        seccion: "Operaciones › Nueva OT",
        titulo: "Podés decir que toda la orden la haga una sola persona",
        detalle:
            "Pasa que uno tornea, hace la camisa y suelda el rodillo. El sistema siempre lo permitió, pero pedirlo era elegir a la misma persona proceso por proceso. Ahora arriba de la lista de procesos hay un «La hace»: elegís a alguien y queda en todos los procesos tildados de una. Si después querés sacarlo de uno solo, lo cambiás en esa fila como siempre. Y «La reparte el planificador» los deja a todos libres de nuevo.",
        href: "/operaciones",
    },
    {
        id: "elegir-en-que-maquina-se-hace-el-proceso",
        fecha: "2026-09-02",
        tipo: "nuevo",
        seccion: "Recursos › Procesos",
        titulo: "Ahora elegís en qué máquina se hace cada proceso",
        detalle:
            "El sistema adivinaba la máquina por el nombre del proceso. Con «Torno T1» acertaba, pero «reparación de rosca» no dice torno en ningún lado, así que se planificaba sin reservar ninguno y otra orden podía llevarse el mismo torno a la misma hora. Ahora, desplegando un proceso en Recursos, elegís las máquinas donde se hace: el planificador reserva una de esas. Si no cargás ninguna, sigue funcionando como hasta ahora. Ya quedaron cargadas las que contestaste en la planilla: reparación de rosca en los seis tornos convencionales, enderezar de bases en las prensas y la plegadora, y la rectificadora solo en la tangencial.",
        href: "/recursos",
    },
    {
        id: "preparacion-y-uso-misma-persona-con-algo-en-el-medio",
        fecha: "2026-09-02",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "El que prepara la máquina es el que la usa, aunque haya otro trabajo en el medio",
        detalle:
            "Preparaba la soldadora uno y soldaba otro, cada uno en una soldadora distinta. En la misma orden el torno salía bien, y la diferencia era que ahí la preparación y el uso iban pegados: si en el medio había otro trabajo —un ensamblado, un punteado— el sistema perdía de vista que eran el mismo par. Ahora los junta aunque estén separados. Si la orden repite el mismo trabajo varias veces, cada preparación se lleva la suya. Y si al cargar la orden elegiste vos quién lo hace, esa elección sigue mandando.",
        href: "/operaciones",
    },
    {
        id: "aviso-de-ot-sin-material",
        fecha: "2026-09-02",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Si elegiste órdenes sin material, te avisa y las saca de un click",
        detalle:
            "El sistema te frenaba: si tildabas una orden sin material, el botón de planificar no te dejaba avanzar y te mandaba a mirar la columna Material. Sacarlas quedaba para vos, de a una. Ahora aparece arriba un cartel rojo apenas tildás alguna —dice cuántas son y pasando el mouse ves cuáles— y de un click salen todas juntas. Y si igual apretás planificar, el aviso trae el botón «Sacarlas y planificar» y sigue de largo con el resto. Las que tienen el material pedido siguen planificándose como siempre.",
        href: "/operaciones",
    },
    {
        id: "procesos-tercerizados-por-rango",
        fecha: "2026-09-02",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Los trabajos que se mandan afuera ya no dependen de cómo se llame el proceso",
        detalle:
            "Para que el sistema entendiera que un trabajo se hace afuera, alguien tenía que haber escrito «tercerizado» en el nombre del proceso. Si no, le buscaba una máquina del taller para reservar y no la encontraba nunca. Ahora sale del rango que le pongas en Recursos, que es donde lo podés ver y cambiar. Cilindrado de chapa y repujado en torno ya quedaron así.",
        href: "/recursos",
    },
    {
        id: "aviso-dice-quien-lo-toma-primero",
        fecha: "2026-09-01",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "«Se las abrís a 9 personas» ya no se lee como que el trabajo se reparte entre las 9",
        detalle:
            "Cuando una solución avisaba que sumarle un rango a una máquina se la abría a varias personas, parecía que el trabajo iba a caer partido entre todas. No es así: el sistema prefiere a quien lo tiene cargado como habilidad principal. Ahora el aviso lo dice y lo nombra: «Quedan habilitadas, pero el trabajo no se reparte: le cae primero a LEONARDO C., que lo tiene cargado como habilidad principal». Si nadie lo tiene cargado así, el aviso se queda en que el trabajo no se reparte y no inventa un nombre.",
        href: "/operaciones",
    },
    {
        id: "ver-que-cambia-antes-de-aplicar",
        fecha: "2026-09-01",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Antes de aplicar una solución ves exactamente qué va a cambiar",
        detalle:
            "«Aplicar y recalcular» pedía confirmar sin haber dicho nunca qué tocaba, y daba miedo apretar. Ahora, al tocarlo, se abre un cartel con la lista completa: a qué máquina, qué rango le agrega y cuáles tenía hasta ahora, una línea por cada cosa que toca. Recién ahí aparece «Sí, aplicalo», y al lado «Cancelar». Lo que hace el botón es lo mismo de antes: lo único nuevo es que se ve primero.",
        href: "/operaciones",
    },
    {
        id: "aviso-resuelto-se-puede-abrir",
        fecha: "2026-09-01",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Un aviso resuelto se puede volver a abrir para ver qué era y qué se cambió",
        detalle:
            "Al resolver un aviso bajaba a la tira verde tachado y ahí moría: no se podía clickear ni saber qué se había hecho. Ahora se abre como cualquier otro y muestra qué pasaba, cuál de las soluciones se aplicó y un botón para ir a Recursos a ver cómo quedó. Si desapareció porque lo arreglaste en Recursos por tu cuenta, también lo dice.",
        href: "/operaciones",
    },
    {
        id: "preparacion-y-uso-respetan-a-quien-elegiste",
        fecha: "2026-09-01",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "Si elegiste a alguien para un proceso, el plan ya no se lo cambia",
        detalle:
            "La preparación de una máquina y el trabajo que la usa los hace la misma persona, y esa regla sigue igual. Lo que faltaba era la excepción: el torno CNC lo puede preparar uno y ejecutarlo un operario calificado. Ahora, si al cargar el proceso en la OT elegiste a alguien, esa elección manda y el sistema no la pisa para emparejarla con la preparación. La máquina se sigue reservando para las dos.",
        href: "/operaciones",
    },
    {
        id: "salida-del-planificador-arriba",
        fecha: "2026-09-01",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "«Salir» está arriba en los dos pasos del planificador",
        detalle:
            "En la pantalla de elegir OT la salida estaba abajo del todo y en la vista previa arriba, así que había que buscarla en cada paso. Ahora está arriba a la derecha en las dos, en el mismo lugar.",
        href: "/operaciones",
    },
    {
        id: "nueva-orden-en-ordenes-de-trabajo",
        fecha: "2026-09-01",
        tipo: "mejora",
        seccion: "Operaciones › Órdenes de Trabajo",
        titulo: "«Nueva orden» está dentro de Órdenes de Trabajo",
        detalle:
            "Para cargar una OT había que usar el botón de la barra de arriba, que se va con el scroll y se lee como parte del planificador. Ahora hay un «Nueva orden» adentro de la pantalla de Órdenes de Trabajo, visible en las tres solapas y también cuando la lista está vacía. Abre la misma pantalla de carga de siempre.",
        href: "/operaciones",
    },
    {
        id: "ver-lo-que-agregaste-a-mano",
        fecha: "2026-09-01",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Podés ver la lista de todo lo que agregaste a mano al plan",
        detalle:
            "Después de sumar varias cosas al borrador no había forma de repasar qué habías puesto sin recorrer la tabla entera. Ahora el número de al lado de «Deshacer» es un botón: se abre la lista de lo agregado, de lo último a lo primero, con la OT, el cliente, cada proceso, a quién le quedó y cuántas horas suma. Desde ahí mismo podés sacar una OT o un proceso suelto.",
        href: "/operaciones",
    },
    {
        id: "salto-de-carga-a-la-vista",
        fecha: "2026-09-01",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Cuando le agregás trabajo a alguien, ves cuánto le saltaron las horas",
        detalle:
            "Se le podían sumar seis horas a una persona sin enterarse, porque el total del panel cambiaba en silencio. Ahora, al agregar procesos, el panel de carga se abre solo, resalta a quien más subió y le muestra el antes y el después: «8,9 → 15,0 h recién agregadas». El aviso dura unos segundos y se va.",
        href: "/operaciones",
    },
    {
        id: "criterio-de-alta-y-media-escrito",
        fecha: "2026-09-01",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Alta y Media dicen qué significan",
        detalle:
            "Pasando el mouse por el chip de cada aviso ahora dice el criterio completo: Alta es que sin ese dato el trabajo queda sin persona o la máquina no queda reservada; Media es una recomendación para afinar, el plan sale igual. Es lo mismo que ya hacía el sistema, pero hasta ahora había que deducirlo del color.",
        href: "/operaciones",
    },
    {
        id: "mismas-columnas-en-todas-las-tablas",
        fecha: "2026-09-01",
        tipo: "mejora",
        seccion: "Operaciones › Órdenes de Trabajo",
        titulo: "El Historial se lee igual que las otras dos listas de órdenes",
        detalle:
            "El Historial mostraba menos columnas que las otras dos y con el Estado al final, así que había que volver a buscar dónde estaba cada dato al cambiar de solapa. Ahora suma Prioridad, Material y F. Prometida, el Estado quedó al lado de Plano, y «Entregado» pasó a llamarse «Entrega» como en el resto. Cada lista sigue mostrando las columnas que le sirven —una orden sin planificar no tiene fecha de entrega—, pero las que comparte están con el mismo nombre y en el mismo lugar. En la pantalla de planificar, «F. Prom.» ahora dice «F. Prometida».",
        href: "/operaciones",
    },
    {
        id: "ordenes-de-trabajo-abre-primero",
        fecha: "2026-09-01",
        tipo: "mejora",
        seccion: "Operaciones › Órdenes de Trabajo",
        titulo: "Operaciones abre en Órdenes de Trabajo, con las que faltan planificar adelante",
        detalle:
            "Entrar a Operaciones te dejaba en Planificación y había que ir hasta la última solapa para ver las órdenes. Ahora «Órdenes de Trabajo» es la primera y es la que abre, y adentro «No Planificadas» pasó a estar primera: lo que todavía hay que resolver se ve al entrar, sin un clic de por medio.",
        href: "/operaciones",
    },
    {
        id: "planificadas-misma-tabla",
        fecha: "2026-09-01",
        tipo: "arreglo",
        seccion: "Operaciones › Órdenes de Trabajo",
        titulo: "«Planificadas» se ve y se filtra igual que «No Planificadas», y el número de arriba es el de verdad",
        detalle:
            "«Planificadas» era una pantalla aparte, de tarjetas que se abrían y cerraban, sin los filtros de cliente, sector, material, entrega ni fecha que tiene el resto. Y no cerraba: arriba decía «Planificadas (0)» y abajo aparecían 24 órdenes. Eran órdenes ya entregadas, que seguían colgadas de una planificación vieja. Ahora es la misma tabla, con las mismas columnas, los mismos filtros y el mismo buscador que «No Planificadas», el número de la solapa es el de la lista que ves, y una orden entregada desaparece de ahí y pasa al Historial. Cada orden está en una sola solapa.",
        href: "/operaciones",
    },
    {
        id: "borrar-rango-dice-el-motivo",
        fecha: "2026-09-01",
        tipo: "arreglo",
        seccion: "Recursos › Rangos",
        titulo: "Borrar un rango te dice qué se pierde y te deja decidir",
        detalle:
            "Al eliminar un rango salía «Error de conexión», como si se hubiera caído internet, y no había forma de seguir. No era un error: el sistema se estaba negando porque hay gente que tiene ese rango puesto. Ahora te lo dice y te deja resolverlo en el momento: «RECTIFICADOR lo tienen 2 operarios: Leonardo Argañaraz, Vacante Rectificador A Cubrir. Si lo eliminás pierden los 19 procesos que este rango habilita y quedan sin esa categoría». Si lo leés y aun así querés borrarlo, el botón dice «Eliminar igual» y lo borra. Las habilidades cargadas a mano en cada ficha no se tocan, y a quien le quede otro rango, ese pasa a ser su categoría. De paso, el resto de los avisos de Recursos también se leen: si un nombre falta o está repetido, lo ves en vez de un error de conexión.",
        href: "/recursos",
    },
    {
        id: "confirmar-no-borra-otros-borradores",
        fecha: "2026-09-01",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "Confirmar un plan ya no se lleva puestos los demás planes sin confirmar",
        detalle:
            "Al confirmar una tanda grande desaparecía media lista de «Planes sin confirmar». Se borraba todo plan guardado cuyas OT estuvieran dentro de la tanda que estabas confirmando, aunque fuera de otro día, de otra tanda o de otra persona; con 176 OT eso era casi toda la lista. Ahora confirmar saca de ahí únicamente el plan que confirmaste y el resto queda donde estaba. Lo que ya se borró no vuelve, pero en Auditoría ves qué OT tenía cada tanda para volver a calcularla.",
        href: "/operaciones",
    },
    {
        id: "aviso-llega-con-la-solucion-tildada",
        fecha: "2026-09-01",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "«Ir a arreglarlo» te deja la solución tildada: solo confirmás",
        detalle:
            "Antes el botón te dejaba parado en la fila correcta de Recursos, pero con la lista de rangos vacía: había que acordarse de cuál era y buscarlo entre treinta. Ahora el aviso viaja con la propuesta: llegás y ya está tildada, en celeste, con el botón de guardar encendido — mirás y guardás. Además el aviso ahora DICE cuáles son («Cargale OFICIAL o MEDIO OFICIAL: son los que ya aceptan las máquinas donde se hace»), así que se entiende antes de tocar nada. No se guarda nada solo: si la propuesta no va, la sacás con la cruz.",
        href: "/operaciones",
    },
    {
        id: "responsive-tablet-y-telefono",
        fecha: "2026-09-01",
        tipo: "arreglo",
        seccion: "Todo el sistema",
        titulo: "El sistema se puede usar en tablet y en teléfono",
        detalle:
            "En pantallas de menos de 1024 el menú de la izquierda se quedaba fijo y opaco tapando los primeros 256px: en una tablet no se veía ni el título ni la columna de los tildes. Ahora se corre del todo y se abre con el botón, como en el teléfono. De paso: en el planificador ya se puede tildar una OT desde el teléfono (a la tarjeta le faltaba la casilla), los filtros de prioridad se arrastran de costado en vez de cortarse, las cinco pestañas de Recursos se acomodan en varias filas, la barra de «cambios sin guardar» dejó de taparle el botón de planificar, y el panel de carga de operarios arranca plegado cuando la pantalla es angosta para no comerse la tabla.",
        href: "/operaciones",
    },
    {
        id: "borrador-no-se-pisa",
        fecha: "2026-09-01",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "Planificar de nuevo ya no se come el borrador anterior",
        detalle:
            "Cada plan sin confirmar se guarda solo para que lo puedas retomar. El problema era que el sistema seguía escribiendo SIEMPRE sobre el mismo renglón: calculabas un plan nuevo y el borrador de antes quedaba reemplazado por el nuevo, con el nombre y la fecha del viejo. Así un borrador de 8 OT apareció un día con 1 sola. Ahora cada cálculo nuevo deja su propio borrador y los anteriores quedan enteros; retomar uno y recalcularlo sí sigue actualizando ese mismo, que es lo que uno espera. Ojo: lo que ya se pisó no se puede recuperar.",
        href: "/operaciones",
    },
    {
        id: "planificar-abre-sin-tildar",
        fecha: "2026-09-01",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Planificar abre sin nada tildado: elegís vos qué entra",
        detalle:
            "Antes abrías y ya estaban las 176 OT marcadas, así que planificar de más era un click y elegir de verdad era destildar 170. Ahora arranca en cero. Para tildar de a montones está el casillero de la cabecera de la lista, que suma o saca solo las filas que estás viendo: filtrás urgentes, tildás todas, cambiás a retrasadas, tildás todas, y se van sumando. «Volver» desde la vista previa te devuelve la tanda intacta; salir del planificador sí empieza de nuevo.",
        href: "/operaciones",
    },
    {
        id: "ver-solo-las-tildadas",
        fecha: "2026-09-01",
        tipo: "nuevo",
        seccion: "Operaciones › Planificación",
        titulo: "Tocá «N seleccionadas» y ves solo las OT que elegiste",
        detalle:
            "Con 176 renglones, encontrar las 3 que tildaste era scrollear a ojo. Ahora el contador es un botón: lo tocás y la lista queda con esas nada más, para repasarlas antes de calcular. Podés destildar ahí mismo sin que la fila desaparezca de golpe, y volvés a la lista completa tocándolo de nuevo.",
        href: "/operaciones",
    },
    {
        id: "carga-operarios-scrollea",
        fecha: "2026-09-01",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "El panel de carga de operarios volvió a scrollear",
        detalle:
            "En la vista previa, la lista de la derecha se cortaba donde terminaba el panel y no había manera de llegar a los operarios de abajo: con el taller entero solo se veían los tres o cuatro primeros. Ahora scrollea normal.",
        href: "/operaciones",
    },
    {
        id: "avisos-sin-numerito-ni-barra",
        fecha: "2026-09-01",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Los avisos perdieron el numerito y la barra de color de la izquierda",
        detalle:
            "Cada aviso arrastraba dos adornos pegados al borde izquierdo —un número en un círculo gris y una barra de color— que no decían nada y le comían lugar al título, que es lo único que hay que poder leer de un saque. Se fueron los dos. Si era Alta o Media se sigue viendo igual: lo dice con todas las letras el cartelito rojo o ámbar del principio.",
        href: "/operaciones",
    },
    {
        id: "avisos-titulos-uniformes",
        fecha: "2026-09-01",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Todos los avisos se titulan igual: primero de quién habla, después qué le pasa",
        detalle:
            "Quedaban dos avisos que arrancaban sin los dos puntos y uno que enumeraba las ocho máquinas en el título y se iba de renglón. Ahora los siete tienen la misma forma —«Soldadura con MIG: su máquina no acepta el rango que pide»— y el nombre del trabajo va escrito como se escribe, con las siglas en mayúscula. Si abrís un borrador viejo vas a ver los textos de cuando se calculó: tocá «Volver a revisar» y salen con el formato nuevo.",
        href: "/operaciones",
    },
    {
        id: "filtros-suman-seleccion",
        fecha: "2026-08-31",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Cambiar de filtro ya no te borra las OT que habías elegido",
        detalle:
            "En el paso de elegir qué OT entran al plan, cada vez que tocabas un filtro la selección se rehacía con lo que quedaba a la vista: marcabas las urgentes, pasabas a retrasadas y las urgentes se perdían sin avisar —el contador caía de 18 a 6 y los días estimados con él—. Ahora la selección se suma: elegís por urgentes, después por retrasadas, después por cliente, y vas viendo cómo crecen los días acumulados. Lo que destildás a mano queda destildado aunque vuelvas a pasar por su filtro, y el tilde de la cabecera agrega o saca sólo las que estás viendo. Para arrancar de cero está «Deseleccionar todas».",
        href: "/operaciones",
    },
    {
        id: "filtro-cierra-ot-desplegadas",
        fecha: "2026-08-31",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Al cambiar de filtro, las OT que dejaste abiertas se cierran",
        detalle:
            "En esa misma lista podés desplegar una OT para ver sus procesos. Antes las abiertas quedaban abiertas al filtrar, así que después de mirar tres o cuatro la pantalla aparecía llena de bandas desplegadas de OT que ya no estabas mirando y no se entendía qué tenías adelante. Ahora cada cambio de filtro deja la lista plegada y se lee de un vistazo; la OT que quieras seguir mirando la volvés a abrir con la flecha.",
        href: "/operaciones",
    },
    {
        id: "vista-previa-procesos-a-mano",
        fecha: "2026-08-31",
        tipo: "nuevo",
        seccion: "Operaciones › Planificación",
        titulo: "Lo que agregás a mano al plan se ve, se corrige y se puede deshacer",
        detalle:
            "En la vista previa, todo lo que sumás con «Agregar OTs» queda marcado en violeta —la OT con el cartelito «A mano» y cada proceso suelto con el suyo— así se distingue de lo que armó el planificador solo. Si te equivocaste, la X del proceso lo saca sin tocar el resto de la OT, y el botón «Deshacer» de arriba devuelve toda la última tanda. Al elegir procesos sueltos ahora sólo se pueden tildar los del paso 1 o 2: un proceso posterior necesita que la pieza haya pasado por los anteriores, y si el orden de la OT está mal, hay que corregirlo en la OT. Antes lo agregado se mezclaba con el resto y la única forma de arrepentirse era tirar la OT entera.",
        href: "/operaciones",
    },
    {
        id: "avisos-abren-la-ot",
        fecha: "2026-08-31",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Desde el aviso llegás a la OT de un click",
        detalle:
            "Cada aviso muestra el número de las OT que toca y, al tocarlo, la tabla se abre en esa fila con los procesos desplegados y la deja resaltada: ahí mismo le elegís la persona y la máquina. Antes el número estaba en chico y había que bajar a buscar la OT entre todas las demás; si algún filtro la tapaba, ahora se limpian solos y te avisa.",
        href: "/operaciones",
    },
    {
        id: "avisos-recurso-maquina-recurso-humano",
        fecha: "2026-08-31",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Cada aviso empieza diciendo de qué recurso habla",
        detalle:
            "Antes el aviso arrancaba por el nombre del proceso y el motivo aparecía a mitad del texto, escrito distinto cada vez: mirando la pantalla no se podía contestar «¿cuál es la traba acá?». Ahora todos empiezan igual y con las mismas cuatro palabras posibles: Recurso máquina · Rango, Recurso máquina · Capacidad, Recurso humano · Rango o Recurso humano · Skill. Al lado se lee qué tiene hoy y qué le piden —«Medio oficial → Oficial»—, que es el resumen del problema en dos palabras. Los rótulos viejos («Sin gente», «Cuello», «Terceros») no decían a qué pantalla ir a arreglarlo.",
        href: "/operaciones",
    },
    {
        id: "marcar-avisos-como-resueltos",
        fecha: "2026-08-31",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Podés dar un aviso por resuelto y sacarlo de la lista",
        detalle:
            "Los avisos naranjas (Media) no traban nada y se quedan siempre en pantalla, porque son recomendaciones: con un lote grande de OT terminaban tapando las trabas rojas de verdad. Ahora cada aviso tiene un tilde para darlo por resuelto y hay un «Marcar todo listo» arriba: bajan a la tira verde con el nombre de lo que resolviste y la cifra de «Trabas sin resolver» los descuenta. No cambia el plan ni toca ningún dato, y se deshace uno por uno o entero. Ojo: el que manda es el recálculo — si el problema sigue, el aviso vuelve a la lista.",
        href: "/operaciones",
    },
    {
        id: "avisos-media-boton-ir-a-arreglarlo",
        fecha: "2026-08-31",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Los avisos naranjas también te llevan a arreglarlos",
        detalle:
            "Los avisos que no traen botón de «Aplicar y recalcular» —porque qué rango va lo sabe el taller, no el sistema— ahora tienen «Ir a arreglarlo»: abre Recursos en otra pestaña, parado en la máquina, el proceso o la persona que hay que tocar, sin perder el borrador. Cuando volvés a la pestaña de la planificación, el sistema se fija solo si cambió algo en Recursos y recalcula para mostrarte qué quedó resuelto.",
        href: "/operaciones",
    },
    {
        id: "recurso-humano-en-todas-las-pantallas",
        fecha: "2026-08-31",
        tipo: "mejora",
        seccion: "General",
        titulo: "Se dice «recurso humano» en todos lados, no operario ni persona",
        detalle:
            "El mismo dato se llamaba Operario en una pantalla, Persona en otra y Cantidad de empleados en una tercera. Ahora es «Recurso humano» y «Cantidad de recurso humano» en todas: en la carga de procesos de la OT, en la lista de planificación, en la vista previa, en el cronograma, en el tablero y en Recursos. Las máquinas, igual: «Recurso maquinaria». Es solo cómo se lee — no cambió ningún dato ni ninguna cuenta.",
    },
    {
        id: "un-proceso-varias-veces-en-la-ot",
        fecha: "2026-08-28",
        tipo: "arreglo",
        seccion: "Operaciones",
        titulo: "Un proceso puede repetirse en la misma OT, como está cargado en el sistema viejo",
        detalle:
            "Si una OT pasa tres veces por el torno CNC, en el sistema viejo son tres renglones. Acá entraba uno solo: los demás se perdían o se sumaban dentro del primero, así que veías un bloque enorme en un paso en lugar de las pasadas repartidas entre los otros procesos. Ahora entran todas y cada una lleva su paso, su tiempo y su estado por separado: podés marcar terminada la primera pasada y dejar pendiente la tercera. Al agregar procesos sueltos al plan también las elegís de a una. Ojo: si una OT tiene un proceso repetido y no debería, eso viene así del sistema viejo — se copia tal cual y lo corregís vos.",
        href: "/operaciones",
    },
    {
        id: "maquinas-muestran-su-limitacion",
        fecha: "2026-08-28",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Al elegir la máquina ves su limitación, no solo el nombre",
        detalle:
            "La limitación que cargás en Recursos —«Falla en avance automático», «No entra material de más de 3 metros»— ahora aparece en el desplegable, en un renglón chico debajo del nombre de cada máquina. Antes solo estaba en Recursos: para saberlo había que salir de la planificación, buscar la máquina y volver, así que en la práctica se elegía a ciegas. Cuando la máquina elegida tiene una limitación, el casillero queda en ámbar y el texto completo se lee apoyando el mouse encima. Se ve igual en la vista previa, en la lista de planificación y en el detalle de una tarea del cronograma. Ojo: es un dato para vos, el planificador automático no lo tiene en cuenta al repartir el trabajo.",
        href: "/operaciones",
    },
    {
        id: "avisos-dicen-quien-puede-y-que-pasa",
        fecha: "2026-08-26",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Los avisos ahora separan quién puede hacer el trabajo de qué pasa con la máquina",
        detalle:
            "Antes un mismo aviso mezclaba las dos cosas y no se entendía: decía que la máquina no se reservaba y más abajo que el rango «hoy lo tienen 3 personas», así que no quedaba claro si había gente o no había nadie. Ahora el aviso arranca contestando lo primero —«Quién lo hace no es el problema: lo pueden hacer 6 personas y se hace igual»— y recién después explica lo de la máquina y qué se pierde: que queda figurando libre y otra OT puede tomarla a la misma hora. El título dice el proceso y qué le pasa, en un renglón. Y donde un arreglo NO sirve, ahora te lo dice: cargar la habilidad a mano no destraba cuando lo que no coincide es lo que pide el trabajo con lo que pide la máquina. Además cada aviso es ahora una tarjeta con el problema a la izquierda y qué hacer a la derecha, con el botón para aplicarlo a la vista sin tener que abrir nada: entran seis donde antes entraban cuatro.",
        href: "/operaciones",
    },
    {
        id: "planificador-entra-mas-en-pantalla",
        fecha: "2026-08-26",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Entran muchas más OTs en pantalla, en los dos pasos",
        detalle:
            "Al elegir las OTs entraban 4 y ahora entran unas 7: los chips de arriba subieron al lado del título, se fue una banda blanca que sobraba arriba de la tabla y las filas ocupan lo que tienen que ocupar. En la vista previa el período del plan pasó a ser la primera cifra de arriba, del mismo tamaño que las demás y no un cartelito perdido; las cifras dejaron de flotar sueltas; la tira de avisos arranca plegada cuando no quedó ninguna traba sin resolver (si quedó alguna, se abre igual que siempre); y el panel de Carga de operarios se pliega a un costado cuando querés que la tabla respire, y vuelve donde estaba.",
        href: "/operaciones",
    },
    {
        id: "persona-en-el-proceso-de-la-ot",
        fecha: "2026-08-26",
        tipo: "nuevo",
        seccion: "Operaciones › Nueva OT",
        titulo: "Al cargar una OT ya podés decir quién hace cada proceso",
        detalle:
            "En el paso Procesos apareció la columna Persona, al lado de Máquina. Si elegís a alguien, el plan lo respeta aunque el rango no se lo habilite: es tu decisión, no la del sistema. Dejalo en «Sin asignar» y el planificador elige como hasta ahora. El candado amarillo te marca las filas donde forzaste máquina o persona, y «Traer historial» ahora también te repone quién lo hizo la vez pasada.",
        href: "/operaciones",
    },
    {
        id: "avisos-del-plan-mas-claros",
        fecha: "2026-08-26",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Los avisos del plan dicen qué pasa, con los nombres bien escritos",
        detalle:
            "Los procesos salían en minúscula y sin siglas —«soldadura con mig», «torno t1»— y costaba reconocerlos. Ahora se leen como se escriben: «Soldadura con MIG», «Torno T1», «Preparación de soldadora MIG». Y el título dice qué pasa en vez de cómo lo llama el sistema: donde antes decía «se hace sin reservar la máquina» ahora dice «la máquina queda libre y otra OT puede tomarla», y cada aviso distingue si no hay máquina cargada, si el trabajo va a mano, o si el rango del proceso no coincide con el de la máquina. La explicación quedó en frases cortas y se aclara cuándo cargar la habilidad a mano destraba y cuándo no.",
        href: "/operaciones",
    },
    {
        id: "avisos-formato-unico",
        fecha: "2026-08-26",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Las trabas y los avisos se leen de un vistazo: todos con el mismo formato",
        detalle:
            "Cada aviso arrancaba a su manera —uno con el nombre de un proceso, otro con una cifra, otro con «Hay trabajo asignado a…»— y había que leerlos enteros para saber de qué hablaba cada uno. Ahora todos empiezan por la cosa que tiene el problema y siguen con lo que le pasa, y a la izquierda hay una columna fija que dice de qué se trata: CUELLO, SIN MÁQUINA, SIN RANGO, SIN GENTE, VACANTE o TERCEROS. Además se bajó la negrita: resalta los nombres de máquinas, procesos, rangos y personas, y las cifras — nada más.",
        href: "/operaciones",
    },
    {
        id: "planificador-pantalla-completa",
        fecha: "2026-08-26",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Planificar ocupa la pantalla entera: se terminaron las ventanas flotantes",
        detalle:
            "Antes elegir las OTs y revisar el plan eran dos ventanas grises flotando arriba de Operaciones, que se cerraban con un click al costado y no dejaban ver el menú. Ahora es una pantalla, con el menú de la izquierda a la vista y el mismo recorrido de siempre: Paso 1 elegís las OTs, Paso 2 revisás el plan y confirmás. Arriba del plan quedan las cuatro cifras que importan —OTs, procesos, carga total y trabas sin resolver— en grande y sin tener que buscarlas, con el período del plan al lado de la bajada en vez de colgando solo abajo. Y las dos pantallas usan el ancho completo: se sacó un margen de más que dejaba cinco centímetros en blanco a cada lado, y se le quitó aire a los filtros para que entren varias filas más de la lista sin tener que scrollear.",
        href: "/operaciones",
    },
    {
        id: "avisos-se-revisan-solos",
        fecha: "2026-08-26",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Si arreglás un aviso en Recursos, al volver aparece resuelto y el plan se rehace solo",
        detalle:
            "Antes había que acordarse de tocar «Volver a revisar»: ibas a Recursos, cargabas el rango que el aviso te pedía, volvías al borrador y el aviso seguía igual de rojo aunque el problema ya no existiera. Ahora, al volver a la pantalla, el sistema se fija solo si cambió algo en Recursos; si cambió, recalcula y lo que se arregló queda tachado en verde como «Resuelto». Si no tocaste nada, no te hace esperar. El botón sigue estando por si querés forzarlo, y cuando tenés cambios hechos a mano en el plan te avisa en vez de pisártelos.",
        href: "/operaciones",
    },
    {
        id: "avisos-llevan-al-dato",
        fecha: "2026-08-26",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "El «Recursos › Procesos» de cada aviso ahora es un link que te deja parado en el dato",
        detalle:
            "Era un cartelito gris que no hacía nada: había que salir del plan, buscar la pantalla, elegir la pestaña y encontrar el proceso entre 414. Ahora lo tocás y se abre en otra pestaña, ya en la pestaña correcta, con el buscador cargado y la fila abierta lista para editar. Además el detalle de cada aviso se lee de entrada, sin tener que desplegarlo.",
        href: "/operaciones",
    },
    {
        id: "plan-filtros-y-columnas",
        fecha: "2026-08-26",
        tipo: "nuevo",
        seccion: "Operaciones › Planificación",
        titulo: "La tabla del plan tiene Filtros y Columnas",
        detalle:
            "Con 40 OTs la tabla no entra en la pantalla. «Filtros» te deja ver solo las que llegan tarde, las que quedaron sin operario o sin máquina, las forzadas, o buscar por cliente, código o proceso. «Columnas» apaga las que no mirás, y se acuerda de tu elección. Ojo: filtran lo que ves, no lo que se guarda — al confirmar se guarda el plan completo, y te lo avisa arriba de la tabla.",
        href: "/operaciones",
    },
    {
        id: "borrador-conserva-retoques",
        fecha: "2026-08-26",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "Retomar un borrador ya no pierde los cambios que hiciste a mano",
        detalle:
            "Al retomar un plan sin confirmar volvían las asignaciones del planificador y se perdía cada máquina, operario y horario que habías acomodado vos. Ahora vuelven tal cual los dejaste, junto con las OTs que habías forzado.",
        href: "/operaciones",
    },
    {
        id: "recursos-procesos-no-se-cae",
        fecha: "2026-08-26",
        tipo: "arreglo",
        seccion: "Recursos › Procesos",
        titulo: "La pestaña Procesos ya no se cae con un proceso recién creado",
        detalle:
            "Si creabas un proceso y entrabas a la pestaña sin recargar la página, la pantalla quedaba en blanco con un error. Ahora ese proceso muestra un guion en la columna «Quién puede hacerlo» hasta que se actualizan los datos, y el resto de la lista se ve igual.",
        href: "/recursos",
    },
    {
        id: "botones-en-todos-los-avisos",
        fecha: "2026-08-19",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Casi todos los avisos se resuelven con el botón, y ya no te ofrece arreglos que no sirven",
        detalle:
            "El botón «Aplicar y recalcular» aparecía solo cuando el cambio era sobre una única máquina; si eran varias había que ir a Recursos y hacer el mismo cambio a mano, una por una. Ahora las toca a todas de una, y sigue diciéndote a cuánta gente le abrís la máquina antes de que la toques. También tiene botón el arreglo de «volvé a encenderle esta tarea a fulano», que es el más común y el más seguro. Y se sacó un consejo que no servía: cuando la máquina pide un rango que no tiene ninguna persona —como las soldadoras MIG, que piden MEDIO OFICIAL y hoy nadie lo tiene—, el aviso te ofrecía cargarle ese rango al proceso y eso no cambiaba nada. Ahora te dice la verdad: que esas máquinas hoy no las puede reservar nadie, para ningún trabajo.",
        href: "/operaciones",
    },
    {
        id: "borradores-de-planificacion",
        fecha: "2026-08-19",
        tipo: "nuevo",
        seccion: "Operaciones › Planificación",
        titulo: "El plan que calculaste ya no se pierde: queda como borrador",
        detalle:
            "Antes, si cerrabas la vista previa sin confirmar, se perdía todo: el cálculo de varios minutos y cada cambio que hubieras hecho a mano. Ahora se guarda solo, apenas termina de calcular y cada vez que cambiás una máquina, un operario o un horario. En Planificar Órdenes tenés arriba el botón «Retomar borrador»: lo abrís y aparece tal cual lo dejaste, sin volver a calcular. Se guarda en dos lados a la vez — en tu computadora, así sobrevive a un corte de luz o a cerrar la ventana sin querer, y en el sistema, así lo abre cualquiera desde cualquier máquina. Si el borrador tiene más de una hora te avisa que los datos pudieron cambiar, y podés recalcular con un botón. Cuando confirmás el plan, el borrador se borra solo.",
        href: "/operaciones",
    },
    {
        id: "barra-de-avance-y-lote-de-la-semana",
        fecha: "2026-08-19",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Ves cómo avanza el cálculo, y ya no te avisa por planificar la semana entera",
        detalle:
            "Mientras planifica ahora hay una barra con el avance, la etapa en la que va y los segundos que lleva, en vez de un cartelito que decía «Calculando planificación...» sin moverse. Y el aviso de «lote grande» dejó de saltar a las 30 órdenes: aparece recién pasadas las 50, porque 35 o 40 juntas es la semana normal. Además ya no te recomienda partir el lote, que era justo lo que no había que hacer: si planificás en dos tandas, la segunda no ve las máquinas que reservó la primera y los dos planes se pisan.",
        href: "/operaciones",
    },
    {
        id: "soldadura-reserva-la-soldadora",
        fecha: "2026-08-19",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "La soldadura ya reserva la soldadora, y el pulido dejó de ocuparla",
        detalle:
            "Hasta ahora la soldadura salía con «No necesita» en la columna Maquinaria: las cuatro soldadoras del taller no quedaban tomadas por nadie. Y al revés, trabajos de banco como el pulido se quedaban una máquina que no usan —en el armario de LKM, el pulido reservaba la soldadora TIG y se la bloqueaba a la OT que sí la necesitaba—. Ahora la soldadura con TIG y la soldadura con MIG toman cada una su máquina, que no se sustituyen entre sí, y el trabajo que no se hace en una máquina determinada se planifica sin reservar ninguna y te lo dice.",
        href: "/operaciones",
    },
    {
        id: "avisos-dicen-la-causa-real",
        fecha: "2026-08-19",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Los avisos dicen los nombres completos y la causa real",
        detalle:
            "Ya no aparece «y 1 más»: cuando un aviso nombra gente, máquinas o rangos, los lista a todos, porque son justo los que hay que ir a tocar. Si un proceso lo puede hacer alguien pero lo tiene apagado en su ficha, el aviso ahora lo dice con nombre y apellido en vez de «ningún operario disponible lo tiene» —y el primer arreglo que ofrece es volver a encenderlo, que es un click—. Cuando un aviso pide un rango, aclara que alcanza con uno de la lista y no con todos. Y si el mismo nombre de proceso aparece dos veces en el catálogo, te avisa por qué se repite el aviso.",
        href: "/operaciones",
    },
    {
        id: "resolver-desde-el-aviso",
        fecha: "2026-08-18",
        tipo: "nuevo",
        seccion: "Operaciones › Planificación",
        titulo: "Los avisos ahora se resuelven con un botón, sin salir de la vista previa",
        detalle:
            "Cuando un aviso se arregla cargando un rango, al lado de la solución hay un botón «Aplicar y recalcular»: lo tocás, se guarda el cambio y el plan se vuelve a calcular solo, con las fechas actualizadas. El aviso desaparece únicamente si de verdad se resolvió. El botón aparece solo cuando el cambio es uno y claro (un proceso o una máquina); si hay varias máquinas en juego te manda a Recursos para que elijas vos. Y cada opción dice a cuánta gente le abre la máquina antes de que la toques.",
        href: "/operaciones",
    },
    {
        id: "maquinas-en-cola-y-fechas-visibles",
        fecha: "2026-08-18",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "Si la máquina está ocupada, ahora hace cola en vez de quedarse sin máquina",
        detalle:
            "Cuando había más trabajo que máquinas, el sistema dejaba procesos «Sin asignar» en la columna Maquinaria en lugar de correr la fecha. Ahora hace lo lógico: espera su turno en la máquina y la fecha se corre al día siguiente. Además, arriba de la vista previa ves el período real del plan (de cuándo a cuándo y cuántos días), cada OT tiene una columna «Trabajo» que dice cuándo arranca y cuándo termina, y si algo no entró aparece un botón para ampliar el rango dos semanas y recalcular. Los avisos ahora resaltan en negrita la máquina, el rango o la persona que hay que tocar, y cuentan hasta qué fecha llega el trabajo.",
        href: "/operaciones",
    },
    {
        id: "buscador-varias-ots-y-avisos-claros",
        fecha: "2026-08-16",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Podés buscar varias OTs juntas y los avisos se leen mejor",
        detalle:
            "En el buscador de Planificar Órdenes ahora podés pegar varias OTs juntas — «13345 13343» o «#13345, #13343» — y aparecen todas; el # y los espacios ya no molestan, y también busca por N° de pedido. Las OTs que tildás suben primeras en la lista. Y los avisos de la vista previa se rediseñaron: letra más grande, cada uno dice si es traba o aviso, podés abrir varios a la vez, y solo aparece en rojo lo que de verdad quedó sin resolver. Si un proceso sale sin máquina porque el rango de la máquina no coincide con el del proceso, ahora hay un aviso que te dice exactamente qué cargar y dónde.",
        href: "/operaciones",
    },
    {
        id: "auditoria",
        fecha: "2026-08-15",
        tipo: "nuevo",
        seccion: "Auditoría",
        titulo: "Nueva sección Auditoría: queda registro de cada planificación",
        detalle:
            "En el menú de la izquierda hay una sección nueva. Cada vez que alguien calcula una vista previa o confirma un plan queda registrado: qué OTs, cuánto tardó, cuántos procesos salieron y — si falló — el error exacto. También se ven los borrados. Antes un intento que fallaba no dejaba rastro y no había forma de saber qué pasó.",
        href: "/auditoria",
    },
    {
        id: "planificador-mas-rapido-y-avisos-cortos",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "El cálculo ya no se muere y los avisos son cortos",
        detalle:
            "Hoy un cálculo se murió a mitad de camino porque el servidor se quedó sin memoria, y otro tardó un minuto entero. Se le dio más memoria y se ajustó el cálculo a la máquina real. Además: los avisos de la vista previa ahora son una línea por problema (tocás para ver el detalle y cómo se arregla), los avisos repetidos se unieron en uno, y si un cálculo falla te lo dice con el motivo en vez de quedarse en «Calculando planificación...» para siempre. Los toasts de «sin stock» y «sin procesos» ahora nombran la OT por el número que ves en la lista.",
        href: "/operaciones",
    },
    {
        id: "rangos-desde-maquina-y-proceso",
        fecha: "2026-08-15",
        tipo: "nuevo",
        seccion: "Recursos",
        titulo: "Ahora ves y arreglás los rangos desde la máquina y desde el proceso",
        detalle:
            "En Maquinarias, la columna Rangos te dice quién puede usar cada una y las que no tienen ninguna salen marcadas: tocás el aviso y las cargás ahí mismo, sin ir a Rangos. En Procesos hay una columna “Quién puede hacerlo” con la misma idea, y avisa los dos casos que después frenan un plan: el que no tiene rango (se lo lleva cualquiera) y el que tiene rangos que no tiene ningún operario (no lo hace nadie). El botón “Ver los que frenan un plan” filtra solo los que están en OTs abiertas, para no perderte entre los cientos del catálogo viejo.",
        href: "/recursos",
    },
    {
        id: "fechas-dentro-del-turno",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "Las fechas del plan ya no se pasan del horario del taller",
        detalle:
            "El plan calculaba días de 555 minutos y mostraba trabajos terminando 17:30 o 18:00, cuando el turno cierra 16:00. Ahora usa la jornada real (07:00 a 16:00 con desayuno y almuerzo), así que las fechas que ves —y las que le prometés al cliente— son las que se pueden cumplir. Como consecuencia el mismo trabajo ocupa más días que antes: no es que haya más trabajo, es que antes la cuenta estaba mal.",
        href: "/operaciones",
    },
    {
        id: "horarios-por-operario",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "El plan respeta el horario de cada uno y no planifica sábados",
        detalle:
            "El horario que cargás en la ficha del operario ahora se usa: a quien entra 09:00 no se le pone trabajo a las 07:00. Y como hoy nadie tiene el sábado marcado como día de trabajo, el plan dejó de usarlo — antes contaba 5 horas por persona por semana que en realidad no existen.",
        href: "/operaciones",
    },
    {
        id: "tercerizados-marcados",
        fecha: "2026-08-15",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Los trabajos tercerizados se ven como tercerizados",
        detalle:
            "Aparecían en rojo como “sin operario asignado”, igual que un proceso al que le falta cargar un rango. Ahora llevan la etiqueta Tercerizado: siguen en el plan porque ocupan lugar en la secuencia de la OT y hay que esperarlos, pero no los hace nadie del taller y no hay nada que corregir.",
        href: "/operaciones",
    },
    {
        id: "vacantes-fuera-del-plan",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "Los puestos “VACANTE — A CUBRIR” dejaron de recibir trabajo",
        detalle:
            "El plan les cargaba horas como si fueran personas, así que ese trabajo figuraba hecho y en realidad no lo hacía nadie. Ahora quedan fuera del plan y, cuando un proceso solo lo podía hacer un puesto vacante, el aviso te dice qué rango hace falta cubrir. Los puestos siguen en Recursos, marcados como no disponibles.",
        href: "/recursos",
    },
    {
        id: "feriados-no-se-pierden",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Operaciones › Disponibilidad",
        titulo: "Los feriados que cargás ya no se borran solos",
        detalle:
            "Los días no laborables se guardaban en un archivo del servidor y se perdían cada vez que se actualizaba el sistema: cargabas un feriado, andaba un rato, y después el día volvía a aparecer como laborable. Ahora se guardan como el resto de los datos. Los que ya tenías cargados se pasaron solos.",
        href: "/operaciones",
    },
    {
        id: "por-que-no-entra",
        fecha: "2026-08-15",
        tipo: "nuevo",
        seccion: "Operaciones › Planificación",
        titulo: "La vista previa te dice qué traba el plan y cómo se arregla",
        detalle:
            "Arriba de la vista previa aparece un panel con lo que está frenando la planificación: un proceso que no puede hacer nadie porque nadie tiene el rango, una máquina sola para más trabajo del que entra, o trabajo asignado a un puesto vacante. Cada aviso dice a cuántas OTs y cuántas horas afecta, y abajo las formas de resolverlo con la pantalla donde se hace. Antes esto salía como “sin asignar” o “sin máquina” y no había forma de saber por qué.",
        href: "/operaciones",
    },
    {
        id: "planificacion-vuelve-a-guardar",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "Confirmar una planificación vuelve a guardarla",
        detalle:
            "Al confirmar, la planificación fallaba con un error que hablaba de intentar con menos órdenes, y no era el volumen: no se guardaba ninguna, ni siquiera con una sola OT. Ya se guarda normal. Y cuando borrás una planificación queda registrado qué se borró y cuándo.",
        href: "/operaciones",
    },
    {
        id: "procesos-largos-entran",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "Los procesos de muchas horas ya entran en el plan",
        detalle:
            "Un proceso que duraba más que un tramo de trabajo no entraba en ninguna parte y se llevaba puesto todo lo que venía después en esa OT: la OT aparecía casi entera como 'sin lugar' aunque hubiera gente libre. Ahora se reparte en varios tramos, siempre con la misma persona y la misma máquina, y la OT entra completa.",
        href: "/operaciones",
    },
    {
        id: "plan-con-maquina",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "El plan ahora dice en qué máquina va cada trabajo",
        detalle:
            "Los procesos de producción salían siempre 'sin máquina', y como nadie tenía máquina asignada, dos OTs podían quedar agendadas en el mismo torno a la misma hora. Ahora cada trabajo sale con su máquina y no se pisan entre sí.",
        href: "/operaciones",
    },
    {
        id: "plano-sin-archivo",
        fecha: "2026-08-15",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "La columna Plano distingue la OT que no tiene el archivo cargado",
        detalle:
            "Antes decía Sí en casi todas porque venía marcado del sistema viejo. Ahora dice Sí solo si el plano está cargado de verdad, y 'Sin archivo' cuando figura con plano pero no hay nada adjunto. Importa porque solo el plano real limita el trabajo a quienes saben leer planos: con la marca vieja quedaban afuera del plan los pasantes y los ayudantes.",
        href: "/operaciones",
    },
    {
        id: "reparto-por-rango",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Operaciones › Planificación",
        titulo: "Embalado y pintura dejan de caer en los oficiales",
        detalle:
            "Las tareas que admiten ayudante o ingresante se le podían asignar a cualquiera, así que terminaban en oficiales. Ahora cada tarea va solo a quien tiene el rango que la habilita. También se arregló que la preparación de una máquina quedara pegada al proceso siguiente aunque no tuvieran nada que ver: la preparación de la soldadora se la llevaba el tornero.",
        href: "/operaciones",
    },
    {
        id: "recursos-maquinas-sin-rango",
        fecha: "2026-08-15",
        tipo: "nuevo",
        seccion: "Recursos",
        titulo: "Se ve qué máquinas no tienen rango y qué rangos no tienen máquina",
        detalle:
            "En Maquinarias hay una columna Rangos y un aviso arriba con las máquinas que no tienen ninguno: esas el planificador no se las asigna a nadie. En Rangos, al lado de cada nombre dice cuántas máquinas habilita, y avisa si no habilita ninguna o si no lo tiene ningún operario.",
        href: "/recursos",
    },
    {
        id: "operario-no-disponible",
        fecha: "2026-08-15",
        tipo: "arreglo",
        seccion: "Recursos",
        titulo: "Marcar a alguien como no disponible ahora saca su trabajo del plan",
        detalle:
            "El estado estaba en el perfil pero el planificador lo ignoraba y le seguía cargando tareas. Sirve para vacaciones y licencias, y también para los puestos 'VACANTE — A CUBRIR', que no son personas y hasta ahora recibían trabajo.",
        href: "/recursos",
    },
    {
        id: "ot-planificadas-filtros",
        fecha: "2026-08-14",
        tipo: "nuevo",
        seccion: "Operaciones › Órdenes de Trabajo",
        titulo: "Filtros a la vista en Órdenes de Trabajo Planificadas",
        detalle:
            "Arriba de la lista tenés filtros por estado (pendientes, en producción, terminadas, pendientes de entrega), por prioridad, por entrega, y combos de cliente y operario. Antes solo había un buscador y para encontrar algo tenías que scrollear. Además cada OT se puede contraer, así entran muchas más en pantalla.",
        href: "/operaciones",
    },
    {
        id: "planificadas-completadas",
        fecha: "2026-08-14",
        tipo: "nuevo",
        seccion: "Operaciones › Planificación",
        titulo: "Las OTs ya entregadas se mueven solas a la pestaña Completadas",
        detalle:
            "En Planificadas quedaban OTs que decían 'Entrega completa' y ensuciaban la lista de lo que falta hacer. Ahora se van a la pestaña Completadas, al lado de Diaria, y siguen estando ahí para consultarlas.",
        href: "/operaciones",
    },
    {
        id: "quitar-ot-planificacion",
        fecha: "2026-08-14",
        tipo: "nuevo",
        seccion: "Operaciones › Planificación",
        titulo: "Ya podés sacar una OT de la planificación sin borrar todo el lote",
        detalle:
            "Si planificaste una OT por error, tildala en la lista y tocá el tachito de arriba a la derecha: sale de la planificación y vuelve a estar disponible para planificar. El resto del lote no se toca. Sin nada tildado, el tachito sigue eliminando la planificación entera como antes.",
        href: "/operaciones",
    },
    {
        id: "orden-todas-las-columnas",
        fecha: "2026-08-14",
        tipo: "mejora",
        seccion: "Operaciones › Planificación",
        titulo: "Se puede ordenar por cualquier columna de la lista de planificadas",
        detalle:
            "Antes solo ordenaban algunas. Ahora también N° Pedido, Material, Proceso, Plano, Entrega, Aprobado x y Pedido x. Cada columna arranca para el lado que sirve: las cantidades (Cant., Prioridad, Proceso, OT) de mayor a menor, y Material, Plano y Entrega mostrando primero lo que falta. Proceso ordena por cantidad de procesos de la OT y abajo del 'Sí' te dice cuántos están terminados sobre el total.",
        href: "/operaciones",
    },
    {
        id: "novedades-seccion",
        fecha: "2026-08-14",
        tipo: "nuevo",
        seccion: "Novedades",
        titulo: "Hay una sección de Novedades en el menú",
        detalle:
            "Cada vez que se sube algo que se nota, queda anotado acá con la fecha, de lo más nuevo a lo más viejo.",
        href: "/novedades",
    },
    {
        id: "rangos-quien-lo-tiene",
        fecha: "2026-08-13",
        tipo: "mejora",
        seccion: "Configuración › Rangos",
        titulo: "Cada rango muestra quiénes lo tienen y la fila entera es clickeable",
        detalle:
            "Las filas son más compactas y se ve de una qué operarios están en cada rango, sin tener que abrir uno por uno.",
        href: "/configuracion",
    },
    {
        id: "rangos-editar-procesos",
        fecha: "2026-08-13",
        tipo: "nuevo",
        seccion: "Configuración › Rangos",
        titulo: "Se pueden editar los procesos y las máquinas que habilita cada rango",
        detalle:
            "Además, ya se puede borrar un rango que tenga procesos asignados: antes tiraba error y no dejaba.",
        href: "/configuracion",
    },
];

/** Ordenadas de lo más nuevo a lo más viejo. */
export const novedadesOrdenadas = (items: Novedad[] = NOVEDADES) =>
    [...items].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));

/** Fecha ISO -> "14 de agosto de 2026". */
export const formatFechaNovedad = (fecha: string) => {
    const [y, m, d] = fecha.split("-").map(Number);
    return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric" })
        .format(new Date(y, (m || 1) - 1, d || 1));
};

export const TIPO_META: Record<NovedadTipo, { label: string; cls: string; dot: string }> = {
    nuevo: { label: "Nuevo", cls: "bg-green-50 text-green-700 border-green-200", dot: "bg-green-500" },
    mejora: { label: "Mejora", cls: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
    arreglo: { label: "Arreglo", cls: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
};

/* ────────────────────────────────────────────────────────────────────────────
 * EL AVISO QUE SALE AL ENTRAR
 *
 * Un cartel que se abre solo la primera vez que alguien entra después de un
 * cambio grande, y no vuelve a salir solo. Desde el 25/09/2026 se lo puede volver a
 * abrir con el megáfono de abajo del menú, que lleva un puntito mientras no se leyó
 * (components/BotonAviso.tsx). Nace de la semana del 11 al 15/09/2026:
 * el taller frenó el uso del sistema porque los procesos se le veían
 * desordenados, y avisar eso por WhatsApp no alcanza — el que abre el sistema
 * un lunes a la mañana no leyó el grupo.
 *
 * Para cambiarlo: se edita el texto de acá y SE CAMBIA EL `id`. El id es lo que
 * decide si a alguien ya se le mostró y si ya lo leyó (se guarda en el navegador),
 * así que cambiar el texto sin cambiar el id no se lo muestra a nadie que ya lo
 * cerró ni le prende el puntito del megáfono.
 *
 * Para apagarlo: `export const AVISO_AL_ENTRAR = null;`
 * ──────────────────────────────────────────────────────────────────────────── */

export type AvisoBloque = {
    /** Título del bloque. */
    titulo: string;
    /** Una línea por cosa. Sin nombres internos, igual que las novedades. */
    puntos: string[];
    /** Aclaración al pie del bloque, cuando hace falta explicar el porqué. */
    nota?: string;
};

export type AvisoAlEntrar = {
    /** Cambiarlo hace que el cartel vuelva a salirle a todos. */
    id: string;
    fecha: string;
    titulo: string;
    bajada: string;
    bloques: AvisoBloque[];
    /** Texto del botón que cierra. */
    cerrar: string;
};

export const AVISO_AL_ENTRAR: AvisoAlEntrar | null = {
    // 24/09: sale la pantalla Materia prima en plena prueba piloto (semana del 28/09, SPMM
    // en paralelo con el Sistema Integral). El cartel dice lo contrario de lo que se
    // había escrito para cuando SPMM sea el dueño («ahora se cargan acá»): durante la
    // prueba se cargan ALLÁ, y si el que carga órdenes todo el día creyera otra cosa,
    // cargaría dos veces. Cuando SPMM pase a ser el dueño, va un cartel nuevo (con otro
    // `id`, así vuelve a salir) que diga que desde ese día se cargan acá.
    id: "2026-09-24-materia-prima-piloto",
    fecha: "2026-09-24",
    titulo: "Materias primas: se ven acá, se siguen cargando en el Sistema Integral",
    // Decía «Esto sale una sola vez»: desde el 25/09 también se abre a pedido, desde el
    // megáfono, y ahí esa frase no se entendía. Cambiar el texto sin cambiar el `id` no
    // se lo vuelve a mostrar a nadie (ver arriba), que es lo que se quiere.
    bajada:
        "Si lo cerrás, lo volvés a abrir con el megáfono de abajo del menú de la izquierda. Y todo queda en Novedades.",
    bloques: [
        {
            titulo: "Durante la prueba piloto",
            puntos: [
                "**Las materias primas se siguen cargando en el Sistema Integral**, como siempre: lo que lleva cada orden y lo que se pide.",
                "**Acá se ven con sus marcas reales** (pedido, reservado, disponible, en producción) **y se actualizan solas cada 10 minutos.** Son de sólo lectura, para que nada se cargue dos veces.",
                "**Hay una pantalla nueva, «Materia prima»**, en el menú de la izquierda, debajo de Operaciones. Y en cada orden, la solapa Materias Primas muestra lo mismo.",
            ],
        },
        {
            titulo: "La pantalla Materia prima",
            puntos: [
                "**Pendientes:** lo que falta comprar para las órdenes de la semana, con el proveedor y la fecha que prometió.",
                "**Insumos:** el catálogo, con los mismos códigos del Sistema Integral. Cada insumo tiene su stock, sus recortes, en qué órdenes se usó y sus precios.",
                "**Cañera:** en qué estante quedó el material cortado de cada orden.",
            ],
            nota:
                "Cuando termine la prueba, las materias primas se van a cargar acá y el Sistema Integral va a quedar para facturas y remitos. Ese día se avisa.",
        },
    ],
    cerrar: "Entendido",
};
