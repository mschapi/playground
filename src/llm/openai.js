import { fetchJson } from '../utils/http.js';
import { normalizeScenes } from '../scenes.js';

const N8N_SCENE_PROMPT = `Sos un asistente de preproduccion audiovisual especializado en material de stock (Pexels, Shutterstock) y Google Images.

Tu objetivo es traducir un guion en escenas visuales concretas, filmables y buscables.

REGLAS:
1. Dividi el guion segun unidad visual y narrativa.
Una nueva escena aparece cuando cambia la accion, el sujeto, el contexto o aparece una idea que requiere otra imagen o clip.
Cada escena debe poder representarse con una imagen o clip claro.

2. Duracion:
Calcula duration_seconds segun el texto exacto de cada escena.
Formula obligatoria: duration_seconds = cantidad_de_palabras_de_script_text * 0.41.
Redondea al medio segundo mas cercano.
Usa minimo 1.5 segundos para micro escenas y maximo 18 segundos para escenas largas.
No uses duraciones fijas de 5 a 10 segundos si el texto es corto.
Ejemplos:
- "Abre una libreta." tiene 3 palabras, duration_seconds 1.5.
- 10 palabras duran aproximadamente 4 segundos.
- 25 palabras duran aproximadamente 10.5 segundos.

3. Para cada escena devolve:
scene_id
script_text
visual_intent
search_query
asset_type
duration_seconds
orientation
image_prompt

4. search_query:
Debe estar en ingles, con estructura sujeto + accion + contexto.
Debe representar el sentido de la escena, no una traduccion literal.
Debe ser algo que exista como material de stock o en Google Images.
Evita queries genericas o abstractas como "innovation", "future", "technology concept", "people working".

Ejemplos correctos:
"young man checking bank account on phone at night"
"woman stressed looking at credit card bill at kitchen table"
"developer coding on multiple monitors in dark room"
"employee being watched by boss in office"

5. Varia los planos cuando tenga sentido:
close up, wide shot, over the shoulder, hands detail.

6. visual_intent:
En espanol. Explica que se quiere mostrar y por que representa la escena.

7. asset_type:
Siempre "video".

8. orientation:
Siempre "horizontal".

9. image_prompt:
Debe estar en ingles, ser detallado para IA, y describir una escena visible concreta.
Debe terminar con este estilo obligatorio:
"pixel art, soviet propaganda style, red color palette, futuristic hacker aesthetic, high contrast, digital dystopia"
No uses conceptos abstractos en image_prompt.

10. Output:
Responde solo JSON valido. El JSON debe ser un array. Sin texto adicional.

Guion:

{{$json.script_text}}`;

export async function splitScenesWithOpenAI(script, config) {
  if (!config.openai.apiKey) {
    throw new Error('Falta OPENAI_API_KEY para partir escenas con LLM');
  }

  const response = await fetchJson(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + config.openai.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.openai.textModel,
        input: [
{
  role: 'user',
  content: [
    {
      type: 'input_text',
      text: buildPrompt(script)
    }
  ]
}
        ]
      })
    },
    'OpenAI Responses scene split'
  );

  const text = extractOutputText(response);
  const parsed = JSON.parse(extractJson(text));
  const rawScenes = Array.isArray(parsed) ? parsed : parsed.scenes;
  if (!Array.isArray(rawScenes)) {
    throw new Error('La respuesta del LLM no contiene un array de escenas');
  }
  return normalizeScenes(rawScenes, config);
}

function buildPrompt(script) {
  return N8N_SCENE_PROMPT.replace('{{$json.script_text}}', script);
}

function extractOutputText(response) {
  if (response.output_text) return response.output_text;
  const parts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.text) parts.push(content.text);
    }
  }
  if (!parts.length) {
    throw new Error('OpenAI no devolvio output_text parseable');
  }
  return parts.join('\n');
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return trimmed;

  const arrayStart = trimmed.indexOf('[');
  const objectStart = trimmed.indexOf('{');
  const starts = [arrayStart, objectStart].filter((index) => index >= 0);
  if (!starts.length) throw new Error('La respuesta del LLM no contiene JSON');

  const start = Math.min(...starts);
  const opener = trimmed[start];
  const closer = opener === '[' ? ']' : '}';
  const end = trimmed.lastIndexOf(closer);
  if (end <= start) throw new Error('La respuesta del LLM contiene JSON incompleto');

  return trimmed.slice(start, end + 1);
}
