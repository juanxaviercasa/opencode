# OpenCode con modelos gratuitos y cambio automático

Configuración y plugin para OpenCode 2.2.0. Este repositorio no contiene el programa OpenCode ni los modelos: usa los modelos gratuitos en la nube ofrecidos dentro de OpenCode.

## Usar en otra PC

1. Instala OpenCode siguiendo https://opencode.ai/v2/docs (este plugin se probó con 2.2.0).
2. Clona y entra en este repositorio:

```sh
git clone https://github.com/juanxaviercasa/opencode.git
cd opencode
opencode
```

No necesitas npm install ni descargar modelos. La configuración del proyecto carga el plugin de `.` y selecciona **Gratis automático**. Necesitas internet. No necesitas crear una cuenta para los modelos gratuitos que se probaron; su disponibilidad puede cambiar.

Para abrir la interfaz gráfica en esta misma PC:

```sh
opencode pair
```

Abre en el navegador de esa PC el enlace que imprime el comando. El QR es opcional. Los enlaces caducan en cinco minutos y son privados. `127.0.0.1` siempre representa el dispositivo donde abres la dirección; no sirve para conectar otra máquina al servidor original.

Cada PC ejecuta su propia instalación y trabaja con sus archivos. GitHub guarda el código, no ejecuta el servidor. Este repositorio no publica dominios ni crea túneles.

## Usar el plugin con otros proyectos

Copia la carpeta del repositorio a una ubicación permanente y añade su ruta absoluta al arreglo `plugins` de tu configuración global `~/.config/opencode/opencode.json`. Conserva las opciones y plugins existentes:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode/free-auto",
  "plugins": ["/ruta/absoluta/opencode"]
}
```

Ejecuta `opencode reload`. Evita cargarlo a la vez desde la configuración global y la del proyecto. Para desactivarlo, elimina esa entrada y recarga.

## Qué hace

- Publica un alias estable `opencode/free-auto` («Gratis automático»).
- Filtra el catálogo a modelos de chat de OpenCode con herramientas y precio explícitamente cero para entrada, salida y caché. Oculta otros modelos mientras está activo.
- Prefiere DeepSeek V4.1 Flash Free, GLM 5.3 Flash Free, Beam Free y MiMo V2.6 Flash Free; después considera las demás alternativas compatibles. Es una preferencia, no una clasificación de calidad.
- Ante HTTP 404, 408, 429, 500, 502, 503 o 504, prueba otra alternativa gratuita compatible, conservando mensajes, herramientas y streaming.
- Respeta Retry-After o pausa el modelo fallido durante 60 segundos. Conserva requisitos multimedia y no cambia a un modelo con menor límite de contexto.
- Desactiva la búsqueda web integrada para evitar llamadas adicionales a ese servicio.

Los cambios se registran con `[free-router]`. La interfaz puede mostrar el modelo seleccionado originalmente.

## Límites

Las cuotas siguen aplicándose. Si todos los modelos fallan o se agotan, hay que esperar. No rota cuentas ni direcciones IP y no incluye modelos de pago como alternativa. Tampoco conecta automáticamente Kaggle, OpenRouter u otros proveedores.

Los errores de red antes de recibir cabeceras y los cortes después de iniciar una respuesta usan el manejo nativo de OpenCode; no se garantiza cambio en esos casos. El plugin no repite acciones de herramientas ya ejecutadas. La calidad puede cambiar entre modelos.

Los precios se verifican contra el catálogo de OpenCode; no son garantía de gratuidad futura. Los mensajes y contexto se envían a proveedores en la nube, cuyas condiciones de privacidad varían. Los permisos de herramientas siguen siendo los de OpenCode.

## Pruebas

Con Node.js 20 o posterior:

```sh
node router.test.mjs
```

Se probaron filtros de precio, alias estable, cambio por 429, conservación de mensajes/herramientas, agotamiento de alternativas, autenticación y Retry-After. Además se simuló una falla HTTP 503 en una llamada real de OpenCode: pasó de DeepSeek a GLM y respondió OK.

## Documentación oficial

- https://opencode.ai/v2/docs
- https://opencode.ai/v2/docs/build/plugins/server
- https://opencode.ai/v2/docs/console/models/
- https://opencode.ai/v2/docs/cli/web
