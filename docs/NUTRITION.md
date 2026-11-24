# Hforge Nutrition

Activa **Ajustes → Módulos → Nutrición** y utiliza el selector de Inicio. La cabecera comparte saludo, fecha, descarga y ajustes con Entrenamiento. Desde Nutrición, la descarga incluye los datos de alimentación y los pesajes. Se puede restaurar en Ajustes mediante la importación de copias JSON.

## Uso diario

1. **Productos**. Crea una ficha desde su etiqueta o busca su código de barras. Escanear con foto utiliza la cámara o una imagen elegida por el dispositivo. Para EAN-8 y EAN-13 hay un lector local de respaldo. La consulta en línea envía el código a Open Food Facts. Revisa nombre, nutrientes y referencia de 100 g o 100 ml antes de guardar. La introducción manual funciona sin conexión.
2. **Platos**. Combina ingredientes e indica las raciones que salen. Por ejemplo, 250 g de yogur repartidos en dos raciones consumen 125 g por ración.
3. **Menú semanal**. Elige un día de lunes a domingo, una franja y una cantidad. «Registrar en el diario» confirma el consumo una sola vez. Después puedes corregir la cantidad que comiste en el diario.
4. **Compra**. La lista agrupa ingredientes del menú por producto y unidad. Puedes marcar lo comprado y añadir artículos a mano. Si cambia la cantidad prevista de un producto, toca revisarlo de nuevo.
5. **Diario**. Registra alimentos en gramos o mililitros y platos por raciones. Edita o elimina entradas, cambia de fecha y consulta energía y macros. Los nutrientes desconocidos quedan identificados. El peso usa el mismo historial y objetivo de peso de Entrenamiento.

## Objetivo calórico

El icono de diana del diario abre el perfil. Mifflin–St Jeor estima el gasto en reposo a partir de peso, talla, edad y sexo. El peso en libras se convierte a kilogramos para la ecuación. La actividad habitual aplica un factor explícito de 1,4, 1,6, 1,8 o 2,0. Mantenimiento conserva la estimación y las opciones de bajar y subir aplican un ajuste inicial del −10 % o +10 %. Son estimaciones que conviene contrastar con el historial. La complexión se conserva como dato descriptivo. La herramienta se dirige a adultos y excluye embarazo y lactancia. [Estudio original](https://pubmed.ncbi.nlm.nih.gov/2305711/) · [NIDDK](https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner)

## Persistencia y sincronización

| Tabla SQLite | Contenido |
|---|---|
| `nutrition_products` | Producto privado, código único por cuenta, unidad de etiqueta y nutrientes |
| `nutrition_meals` | Plato y número de raciones |
| `nutrition_ingredients` | Ingredientes ordenados y cantidades del plato, con clave foránea y borrado en cascada |
| `nutrition_diary` | Consumo fechado, franja, cantidad y composición en el momento del registro |
| `nutrition_plan` | Comida prevista por día, cantidad e ingredientes para la compra |
| `nutrition_shopping` | Estado de compra semanal y artículos manuales |
| `nutrition_profiles` | Altura, edad, sexo, complexión, actividad y objetivo energético |

La migración 002 crea las tablas en el SQLite existente. Los pesajes siguen en el estado habitual de Hforge. El servidor obtiene la cuenta de la sesión autenticada. Cada alta, edición o eliminación de nutrición se identifica por colección e identificador. Se aplica en una transacción con la actualización del estado. Una escritura antigua de entrenamiento sin operaciones nutricionales conserva las filas de alimentación. La copia local mantiene los cambios pendientes para el siguiente envío. Si dos dispositivos editan la misma fila, prevalece la última escritura recibida. Invitados y compilaciones móviles sin servidor conservan la copia en el dispositivo.

Cada entrada de diario conserva la ficha usada y su ración. Reformular un producto o editar un plato deja intacto el registro histórico. La lista de compra puede reunir recetas y alimentos sueltos. Mantiene gramos y mililitros separados, y muestra cantidades necesarias para cocinar.

El catálogo es colaborativo. La coincidencia exacta de código identifica una ficha candidata que el usuario puede corregir. En un multipack hay que verificar los gramos o mililitros que se consumen. En el producto importado se muestra la fuente. [API de Open Food Facts](https://openfoodfacts.github.io/documentation/docs/Product-Opener/v3/products/get-api-v3-product-code/) · [Condiciones de reutilización](https://world.openfoodfacts.org/terms-of-use) · [Soporte del lector nativo](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector)

## Demo local opcional

Desde `frontend`, `npm run preview:nutrition` compila una demo aislada y muestra una dirección de la red local. En producción basta con abrir Hforge desde el navegador del móvil.
