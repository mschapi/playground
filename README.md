# n8n script media pipeline

Reemplazo en Node del workflow de n8n `file creator`.

El pipeline replica la logica principal observada en el JSON exportado:

- Lee un guion desde Google Docs o desde `inputs/script.txt`.
- Usa `gpt-5-mini` para partir el guion en escenas visuales.
- Mantiene escenas con formato `scene_01`, `scene_02`, etc.
- Genera `run_YYYYMMDDHHMMSS` para nombrar todos los assets.
- Genera 1 imagen IA por escena con `gpt-image-1` en `1536x1024`.
- Busca 5 imagenes en Pexels y descarga las primeras 3 validas por escena.
- Busca 10 videos en Pexels y descarga el primer video usable por escena.
- Busca Google Images via Bright Data SERP API con `hl=es-419`, `gl=ar` y `x-unblock-data-format=parsed_light`.
- Genera XMLs XMEML version 5 para Premiere.
- Genera un video con imagenes IA y subtitulos: fondo rojo, letra blanca, Chakra Petch.
- Sube toda la corrida a Drive.

## Outputs

Cada corrida queda en `outputs/jobs/<run_id>-<titulo>/`:

- `script.txt`
- `scenes.txt`
- `scenes.json`
- `01-ai-images/`
- `02-pexels-images/`
- `03-pexels-videos/`
- `04-brightdata-google-images/`
- `05-imported-assets/`, si importas assets manuales
- `06-selected-video/selected-video.mp4`, cuando renderizas desde la UI
- `premiere-xml/premiere_ai_timeline.xml`
- `premiere-xml/premiere_pexels_images_timeline.xml`
- `premiere-xml/premiere_pexels_videos_timeline.xml`
- `premiere-xml/premiere_google_images_timeline.xml`
- `premiere-xml/premiere_combined_timeline.xml`
- `asset-manifest.json`
- `run-summary.json`


## Uso web simple

La manera simple de usarlo es con la app web local:

```bash
node src/server.js
```

Abrir:

```
http://localhost:8787
```

Flujo:

1. Pegas el guion en el cuadro `Guion`.
2. Tocas `Ejecutar`. Esa accion parte el guion en escenas, pero no genera assets todavia.
3. Editas texto, duracion, busqueda Pexels, busqueda Google o prompt IA por escena.
4. Tocas `Guardar escenas` si cambiaste algo.
5. Tocas `Generar assets` para crear/descargar imagenes IA, Pexels, videos Pexels, Google y XMLs.
6. En `Assets` podes importar una imagen o video manual por escena.
7. Tocas `Crear video`.
8. Elegis una opcion por escena con un click. En modo `Multiple`, podes elegir mas de un asset por escena y el tiempo se reparte automaticamente.
9. Si elegis un video, podes definir desde que segundo empieza el recorte.
10. Subis un audio opcional.
11. Tocas `Renderizar video`.
12. Previsualizas y descargas el video terminado.

Si faltan API keys, la app se abre en `Prueba`, que genera placeholders sin gastar APIs. Para una corrida real desactiva `Prueba` y completa `keys.txt` o `.env`.

## Debug y preflight

La pestana `Debug` tiene dos usos:

- `Preflight`: revisa si estan configurados OpenAI/GPT, generacion de imagenes, Pexels, Bright Data, Google Drive y FFmpeg. No muestra secretos, solo dice si estan presentes.
- `Actualizar`: recarga el estado del job y muestra el `debug-log.json`.

Cada corrida guarda trazas en `outputs/jobs/<job>/debug/`:

- `debug-log.json`, con todos los eventos ordenados.
- Un JSON por etapa, por ejemplo `scenes`, `ai_images`, `pexels_images`, `pexels_videos`, `brightdata_google_images`, `xml`, `render` y `drive_upload`.

Ahi quedan las queries usadas, prompts de imagen, conteos, archivos escritos, assets importados/elegidos y errores redactados si algo falla. Si una API de assets falla, el job sigue con las otras fuentes y el error queda registrado en debug. La generacion IA guarda errores por escena en `01-ai-images/openai-image-errors.json`; Google/Bright Data hace lo mismo en `04-brightdata-google-images/brightdata-google-image-errors.json`.

### Bright Data / Google Images

Si Google Images queda en 0, revisa `Debug > brightdata_google_images` y el archivo `04-brightdata-google-images/brightdata-google-image-errors.json`. Dos errores tipicos son:

- `status_code 407 Invalid authentication`: la key existe, pero Bright Data no acepta esas credenciales para esa zona SERP.
- `Inactive customer`: la cuenta o la zona SERP no esta activa para ejecutar requests.

En esos casos el codigo ya llego a Bright Data. Hay que activar billing/SERP en Bright Data o cambiar `BRIGHTDATA_API_KEY`/`BRIGHTDATA_ZONE` por una combinacion habilitada.

## Publicar en GitHub Pages

La carpeta `web/` puede publicarse como GitHub Pages, pero el backend con APIs debe correr en tu maquina o en un server. En GitHub Pages la UI apunta por defecto a `http://localhost:8787`; por eso antes de usar `https://mschapi.github.io/playground/` tenes que ejecutar localmente:

```bash
node src/server.js
```

Si el backend corre en otro dominio, abri la consola del navegador y defini:

```js
localStorage.setItem('playgroundApiBase', 'https://tu-backend.com')
```

## Uso local

1. Copiar `keys.example.txt` a `keys.txt` o `.env.example` a `.env`.
2. Completar las keys y credenciales. Si existen ambos archivos, `keys.txt` gana sobre `.env` para que puedas rotar keys rapido.
3. Pegar el guion en `inputs/script.txt` o configurar `SOURCE_GDOC_ID`.
4. Ejecutar:

```bash
node src/index.js --script-file inputs/script.txt
```

Con Google Docs:

```bash
node src/index.js --gdoc-id "DOC_ID"
```

Prueba sin APIs externas:

```bash
node src/index.js --script-file examples/sample-script.txt --dry-run
```

## FFmpeg

Para que los subtitulos usen Chakra Petch aunque la maquina no tenga esa fuente instalada:

```bash
npm run setup:fonts
```

En GitHub Actions FFmpeg se instala automaticamente en Ubuntu. En Windows local, instalalo portable dentro del repo con:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-windows-ffmpeg.ps1
```

El script descarga el build essentials de gyan.dev, valida SHA-256, lo extrae en `tools/ffmpeg/` y actualiza `FFMPEG_PATH` en `.env`. La carpeta `tools/ffmpeg/` esta ignorada por Git.

## Drive

Para subir resultados a Google Drive desde local o GitHub Actions hace falta:

- `DRIVE_UPLOAD=true`
- `DRIVE_PARENT_FOLDER_ID`, el ID de la carpeta destino
- `GOOGLE_SERVICE_ACCOUNT_JSON` como secret de GitHub o `GOOGLE_SERVICE_ACCOUNT_FILE` local

La carpeta de Drive debe estar compartida con el email `client_email` del service account. Sin esa credencial, el pipeline puede generar assets/XML/video, pero no puede subirlos a Drive.

## Keys locales

Para rotar keys sin tocar codigo, edita `keys.txt` en la raiz del repo:

```txt
openai_key=xx_openai_key
pexels_key=xx_pexels_key
bright_data_key=xx_bright_data_key
bright_data_zone=serp_api1
```

Tambien se aceptan los nombres tecnicos de entorno, por ejemplo `OPENAI_API_KEY`, `PEXELS_API_KEY` y `BRIGHTDATA_API_KEY`. `keys.txt` esta ignorado por Git.

## Variables principales

- `OPENAI_API_KEY`
- `PEXELS_API_KEY`
- `BRIGHTDATA_API_KEY`
- `BRIGHTDATA_ZONE=serp_api1`
- `GOOGLE_SERVICE_ACCOUNT_JSON` o `GOOGLE_SERVICE_ACCOUNT_FILE`
- `SOURCE_GDOC_ID`, opcional
- `DRIVE_ID`, util para Shared Drive
- `DRIVE_PARENT_FOLDER_ID`, carpeta destino especifica
- `XML_PATH_MODE=tmp-filename`, replica n8n con `file://localhost//tmp/nombre.ext`
- `XML_PATH_MODE=local-full-path`, usa rutas reales del disco local

## GitHub Pages

El workflow `.github/workflows/deploy-pages.yml` publica la UI estatica de `web/` en GitHub Pages. Esa UI no contiene secrets. Para usar APIs sin exponer keys necesita conectarse a un backend Node con `src/server.js` corriendo en una maquina o servidor.

En local:

```bash
node src/server.js
```

En una pagina publicada, la UI intenta usar `http://localhost:8787` por defecto. Para un backend real:

```js
localStorage.setItem('playgroundApiBase', 'https://tu-backend.com')
```

## GitHub Actions

El workflow `.github/workflows/run-pipeline.yml` corre al cambiar `inputs/script.txt` o manualmente.

Secrets recomendados:

- `OPENAI_API_KEY`
- `PEXELS_API_KEY`
- `BRIGHTDATA_API_KEY`
- `BRIGHTDATA_ZONE`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `SOURCE_GDOC_ID`, opcional
- `DRIVE_ID`, opcional
- `DRIVE_PARENT_FOLDER_ID`

El service account debe tener acceso al Google Doc de origen y a la carpeta o Shared Drive destino.

## Seguridad

El export de n8n puede contener API keys, proxies o tokens embebidos en nodos HTTP. Este repo no copia esos valores al codigo. Cargalos como `keys.txt` o `.env` local, o como GitHub Secrets. Si el JSON circulo fuera de tu maquina, conviene rotar las keys expuestas.
