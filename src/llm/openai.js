import { fetchJson } from '../utils/http.js';
import { normalizeScenes } from '../scenes.js';

const N8N_SCENE_PROMPT = "Sos un asistente de preproducción audiovisual especializado en material de stock (Pexels, Shutterstock) y Google images.\n\nTu objetivo es traducir un guion en escenas VISUALES concretas, filmables y buscables.\n\nVas a recibir un guion. Tenés que dividirlo en escenas y proponer búsquedas visuales realistas.\n\nREGLAS:\n1. División de escenas (IMPORTANTE).\nDividí el guion en escenas según unidad visual y narrativa.\n\nUna nueva escena debe aparecer cuando:\n\ncambia la acción\ncambia el sujeto\ncambia el contexto\no aparece una nueva idea que requiere otra imagen\nCada escena debe poder representarse con UNA imagen o clip claro.\nDuración estimada (puede haber alguna excepción):\nEntre 5 y 10 segundos\nAjustala según la cantidad de texto:\npocas palabras → 5–6s\nfrase media → 6–8s\nfrase larga → 8–10s\nLa duración debe sentirse natural al leer en voz alta\n2. Para cada escena devolvé:\nscene_id\nscript_text\nvisual_intent\nsearch_query\nasset_type\nduration_seconds\norientation\nimage_prompt\n\n3. search_query (CRÍTICO)\n\nDebe:\n\nEstar en inglés\nTener estructura:\n\n→ sujeto + acción + contexto\n\nPero además:\n\nDebe representar el sentido de la escena, no una traducción literal del texto\nDebe ser algo que exista en stock (Pexels/Shutterstock) o en Google\nDebe ser visualizable inmediatamente\n\n4. MUY IMPORTANTE\nNo busques:\nni conceptos abstractos\nni palabras del guion\nBuscá una escena que:\n→ represente lo que la escena quiere transmitir\n\nEs decir:\n\n\"control\" →\n✔ \"boss watching employees through glass office\"\n✔ \"security cameras monitoring people\"\n\"crisis económica\" →\n✔ \"person looking worried at unpaid bills at home\"\n\"IA entrenando con datos\" →\n✔ \"person typing on laptop with multiple data screens\"\n✔ \"developer working with code on multiple monitors\"\n\n5. Evitá en lo posible:\nqueries genéricas:\n\"people working\"\n\"technology concept\"\n\"business meeting\"\nqueries abstractas:\n\"innovation\"\n\"future\"\n\"AI concept\"\n6. Sé específico\n\nEjemplos correctos:\n\n\"young man checking bank account on phone at night\"\n\"woman stressed looking at credit card bill at kitchen table\"\n\"developer coding on multiple monitors in dark room\"\n\"employee being watched by boss in office\"\n\n7. Variá los planos\n\nUsá variedad:\n\nclose up\nwide shot\nover the shoulder\nhands detail\n\n8. visual_intent\nEn español\nExplica qué se quiere mostrar y por qué representa la escena\n\n9. asset_type\n\nSiempre:\n\n\"video\"\n\n10. orientation\n\nSiempre:\n\n\"horizontal\"\n\n11. image_prompt\n\nDebe:\n\nEstar en inglés\nSer un prompt detallado para IA (Midjourney / DALL·E)\nDescribir una escena visual concreta (NO abstracta)\n12. Estilo obligatorio en TODOS los image_prompt:\n\n\"pixel art, soviet propaganda style, red color palette, futuristic hacker aesthetic, high contrast, digital dystopia\"\n\n13. Formato del image_prompt:\n\n→ descripción concreta + estilo\n\nEjemplo:\n\n\"man using smartphone in dark room, screen illuminating face, pixel art, soviet propaganda style, red color palette, futuristic hacker aesthetic, high contrast, digital dystopia\"\n\n14. PROHIBIDO en image_prompt:\nconceptos abstractos\npalabras como:\ninnovation\nfuture\ntechnology concept\n\nSiempre describí algo visible.\n\n15. Output\nRespondé SOLO JSON válido (array)\nSin texto adicional\nGuion:\n\n{{$json.script_text}}";

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
