FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN node scripts/setup-fonts.mjs || echo "Chakra Petch no se pudo descargar durante el build; el render usara la fuente disponible."

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV OUTPUT_ROOT=/data/jobs
ENV FFMPEG_PATH=ffmpeg
ENV VIDEO_FFMPEG_PRESET=ultrafast
ENV VIDEO_FFMPEG_CRF=24
ENV VIDEO_FFMPEG_TIMEOUT_SECONDS=600

VOLUME ["/data/jobs"]
EXPOSE 8787

CMD ["node", "src/server.js"]

