# Backend general

La web de GitHub Pages es estatica. Para que cualquiera pueda usar GPT, Pexels, Bright Data, Drive y FFmpeg, cada instalacion necesita un backend Node publico con sus propias keys.

## Local

```bash
cp .env.example .env
npm install
npm run setup:fonts
npm start
```

Despues abrir `http://localhost:8787`.

## Docker

```bash
docker build -t playground-backend .
docker run --rm -p 8787:8787 --env-file .env -v playground_jobs:/data/jobs playground-backend
```

## Variables importantes

- `OPENAI_API_KEY`, `PEXELS_API_KEY`, `BRIGHTDATA_API_KEY`: APIs principales.
- `PIPELINE_ACCESS_TOKEN`: token opcional para proteger jobs y gasto de APIs.
- `PUBLIC_BASE_URL`: URL publica del backend, por ejemplo `https://playground-backend.example.com`.
- `CORS_ORIGIN`: origen permitido para la web. Para tu Pages: `https://mschapi.github.io`.
- `OUTPUT_ROOT`: carpeta persistente para jobs. En Docker conviene `/data/jobs`.
- `FFMPEG_PATH`: en Docker queda `ffmpeg`; en Windows local puede apuntar a `tools/ffmpeg/.../ffmpeg.exe`.
- `DRIVE_UPLOAD`: para backends publicos compartidos conviene empezar con `false` y activarlo cuando Drive este configurado.

## Usar desde GitHub Pages

En la pagina, tocar `Servidor` y completar:

- Backend: la URL HTTPS publica del backend.
- Token: el valor de `PIPELINE_ACCESS_TOKEN`, si lo configuraste.

Tambien se puede abrir con query string:

```txt
https://mschapi.github.io/playground/?apiBase=https://tu-backend.com&apiToken=tu_token
```

El token se guarda solo en el navegador de esa persona. No se sube al repo.
