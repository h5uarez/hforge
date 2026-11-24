# Hforge Nutrition

## Primera prueba en el móvil

Desde `frontend`, ejecuta `npm run preview:nutrition` y abre la dirección que aparece como **Network** con el móvil conectado a la misma Wi-Fi. Si el ordenador tiene varias interfaces, puedes elegir la de Wi-Fi con `npm run preview:nutrition -- <IPv4>`. Mantén la terminal abierta durante la prueba. Esta compilación usa el modo demo de Hforge, con perfil de ejemplo y almacenamiento propio de esa dirección.

1. Abre **Inicio → Ajustes → Módulos** y activa **Nutrición**. Vuelve a Inicio y pulsa **Nutrición** en el selector.
2. Con una etiqueta de 46 kcal y 3,2 g de proteína por 100 ml, introduce una ración de 250 ml. El resultado debe ser 115 kcal y 8 g de proteína. Los nutrientes sin valor quedan en blanco con un guion.
3. Recarga la página. La preferencia debe seguir activa. Los campos de la calculadora son temporales y se vacían al salir.
4. Vuelve a **Entrenamiento**, desactiva la opción y abre `/#/nutrition`. Debe llevarte a Inicio. Puedes repetir el recorrido con un entrenamiento de ejemplo en curso y reanudarlo.

## Decisiones de integración

| Pieza | Implementación inicial | Evolución prevista |
|---|---|---|
| Acceso | Preferencia booleana `nutritionEnabled` en el estado habitual. Un perfil anterior comienza con la opción apagada. La ruta espera a que termine el arranque para comprobarla. | Mantener el selector exclusivamente en las portadas. Desactivar la visibilidad debe conservar los futuros registros de comidas. |
| Navegación | Ruta propia `/#/nutrition`, cargada al abrirla. Comparte el selector con Inicio y ofrece acceso a Ajustes. La barra inferior de entrenamiento pertenece a sus pantallas. | Introducir navegación propia cuando haya dos destinos funcionales. El diario será la portada. |
| Diseño | Mismos controles de Hforge, paleta, idioma, cabecera y tarjetas. La calculadora acepta coma decimal y cantidades por 100 g o por 100 ml. | Reutilizar las hojas de selección para elegir alimentos y raciones. Mantener el foco y el teclado numérico en móvil. |
| Datos | Solo se guarda la preferencia. Calcular una ración usa memoria de la pantalla. | Antes de guardar la primera comida, definir almacenamiento, exportación y restauración específicos de nutrición en web y móvil. |

## Entregas y prueba de aceptación

| Orden | Qué implementar | Cuándo darlo por bueno |
|---|---|---|
| 1 · Diario manual | Alimento privado con nombre, unidad base y nutrientes opcionales. Registrar fecha local, tipo de comida y cantidad. Editar, borrar y repetir desde recientes. Guardar en cada consumo una copia de la composición usada. | Registrar un yogur de 125 g, corregir la ración y recuperarlo tras cerrar la aplicación. Cambiar la etiqueta después debe conservar el histórico. Una entrada con proteína desconocida deja el total de proteína marcado como parcial. |
| 2 · Escanear un envase | Empezar por EAN-8 y EAN-13, con entrada por teclado. Guardar el código como texto, validar el dígito de control y buscar primero las correcciones privadas. Para el catálogo remoto, usar un adaptador de Open Food Facts con caché y procedencia. Mostrar marca, variante y base para confirmar. | Contrastar envases actuales de Mercadona y Lidl con sus etiquetas. Anotar por separado lectura del código, coincidencia de producto, macros completos y unidad correcta. Probar sin red, con permiso de cámara denegado y con código desconocido. |
| 3 · Platos y recetas | Añadir ingredientes en g o ml, indicar raciones o peso final cocinado y guardar versiones. Permitir registrar una porción de la receta en el diario. | Una receta de 800 g cocinados repartida en porciones de 200 y 600 g distribuye el 25 % y el 75 % de los nutrientes. Editar la receta mañana conserva las dos entradas de hoy. |
| 4 · Menú semanal | Asignar alimentos y recetas al calendario de lunes a domingo. Duplicar una comida, ajustar comensales y registrar desde el plan la cantidad realmente consumida. | Planificar dos cenas con la misma receta y registrar solo una. El diario debe reflejar exclusivamente la cena confirmada. |
| 5 · Lista de la compra | Agregar ingredientes compatibles, descontar despensa o sobras y conservar la cantidad necesaria. Redondear a envases únicamente si se conoce el formato. | Dos comidas que suman 750 g de yogur requieren seis vasitos de 125 g. Con un pack de ocho, la lista propone un pack y conserva el cálculo de 750 g. |

## Almacenamiento y catálogo

La aplicación autoalojada sincroniza el estado de entrenamientos, mientras que el cliente móvil también lo copia a un fichero privado. Para el diario propongo un repositorio de nutrición por perfil, con claves y versión propias, adaptador local para invitado/móvil y rutas autenticadas para la edición autoalojada. Así una sincronización de comidas puede resolverse sin reescribir todo el historial del gimnasio. Antes de abrir el diario a usuarios reales, probar cambio de perfil, exportación y restauración, edición sin conexión y reintento de la misma alta con un identificador estable.

El primer catálogo puede evaluarse por código exacto. Open Food Facts ofrece consulta de producto y selección de campos. La tabla de AESAN describe alimentos comercializados en España en 2022 y sirve como contraste fechado. Para el piloto mediría el porcentaje de envases actuales cuya **identidad, unidad y etiqueta** coinciden. Incluiría un multipack, un lácteo líquido, una mozzarella con peso escurrido y una referencia ausente. El alta manual debe resolver ese último caso en la misma compra. Antes de distribuir ficheros de terceros, documentar por fuente versión, atribución, campos utilizados y condiciones de reutilización. [API de Open Food Facts](https://openfoodfacts.github.io/documentation/docs/Product-Opener/v3/products/get-api-v3-product-code/) · [Datos de AESAN](https://aesan.gob.es/datos-abiertos/alimentos-y-bebidas)

La prueba local por Wi-Fi cubre navegación y cálculo. Para la futura cámara web, usar HTTPS y detectar los formatos disponibles en el dispositivo. Verificar en Safari de iPhone y Android con envases reales antes de elegir lector. Mantener la entrada de dígitos en ambos. [Compatibilidad de BarcodeDetector](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector)
