const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export type JsonProvider = "gemini" | "openai";

export type JsonGenerationResult = {
  json: any;
  model: string;
  provider: JsonProvider;
};

export async function generateGeminiJson({
  apiKey,
  models,
  prompt,
  schema
}: {
  apiKey: string;
  models: string[];
  prompt: string;
  schema?: any;
}): Promise<JsonGenerationResult> {
  const errors: string[] = [];
  for (const model of models) {
    const structured = await tryGeminiJsonRequest({ apiKey, model, prompt, schema });
    if (structured.result) return structured.result;
    if (structured.error) errors.push(structured.error);

    if (schema) {
      const jsonOnly = await tryGeminiJsonRequest({ apiKey, model, prompt });
      if (jsonOnly.result) return jsonOnly.result;
      if (jsonOnly.error) errors.push(jsonOnly.error);
    }
  }
  throw new Error(errors.join(" | ") || "Gemini JSON generation failed.");
}

async function tryGeminiJsonRequest({
  apiKey,
  model,
  prompt,
  schema
}: {
  apiKey: string;
  model: string;
  prompt: string;
  schema?: any;
}): Promise<{ error?: string; result?: JsonGenerationResult }> {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: schema
          ? {
              responseMimeType: "application/json",
              responseSchema: schema
            }
          : {
              responseMimeType: "application/json"
            }
      })
    });
    if (!response.ok) {
      return { error: `${model}${schema ? " schema" : " json"}: ${response.status} ${await response.text()}` };
    }
    const payload = await response.json();
    const text = extractGeminiText(payload);
    if (!text) {
      return { error: `${model}${schema ? " schema" : " json"} returned no text.` };
    }
    return { result: { json: parseJsonObject(text), model, provider: "gemini" } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Gemini JSON generation failed." };
  }
}

export async function generateOpenAIJson({
  apiKey,
  input,
  model,
  schema,
  schemaName,
  system
}: {
  apiKey: string;
  input: string;
  model: string;
  schema?: any;
  schemaName?: string;
  system: string;
}): Promise<JsonGenerationResult> {
  const errors: string[] = [];
  if (schema && schemaName) {
    const structured = await tryOpenAIJsonRequest({ apiKey, input, model, schema, schemaName, system });
    if (structured.result) return structured.result;
    if (structured.error) errors.push(structured.error);
  }

  const jsonOnly = await tryOpenAIJsonRequest({ apiKey, input, model, system });
  if (jsonOnly.result) return jsonOnly.result;
  if (jsonOnly.error) errors.push(jsonOnly.error);

  throw new Error(errors.join(" | ") || "OpenAI JSON generation failed.");
}

async function tryOpenAIJsonRequest({
  apiKey,
  input,
  model,
  schema,
  schemaName,
  system
}: {
  apiKey: string;
  input: string;
  model: string;
  schema?: any;
  schemaName?: string;
  system: string;
}): Promise<{ error?: string; result?: JsonGenerationResult }> {
  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: schema ? system : `${system}\n\nReturn only a valid JSON object.` },
          { role: "user", content: input }
        ],
        text: schema && schemaName
          ? {
              format: {
                type: "json_schema",
                name: schemaName,
                strict: true,
                schema
              }
            }
          : undefined
      })
    });
    if (!response.ok) return { error: `${model}${schema ? " schema" : " json"}: ${response.status} ${await response.text()}` };
    const payload = await response.json();
    const text = extractOpenAIText(payload);
    if (!text) return { error: `${model}${schema ? " schema" : " json"} returned no text.` };
    return { result: { json: parseJsonObject(text), model, provider: "openai" } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "OpenAI JSON generation failed." };
  }
}

export function geminiCandidateModels(configured?: string | null) {
  const defaults = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-001",
    "gemini-flash-latest",
    "gemini-1.5-flash-latest"
  ];
  return Array.from(new Set([configured?.trim(), ...defaults].filter(Boolean) as string[]));
}

export function parseJsonObject(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("LLM response did not contain valid JSON.");
  }
}

function extractGeminiText(payload: any) {
  return payload.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? "").join("").trim();
}

function extractOpenAIText(payload: any) {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const output of payload.output ?? []) {
    for (const content of output.content ?? []) {
      if (typeof content.text === "string") return content.text;
    }
  }
  return undefined;
}
