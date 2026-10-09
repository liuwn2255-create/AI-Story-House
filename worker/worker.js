const CORS_HEADERS = {

  "Access-Control-Allow-Origin": "*",

  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",

  "Access-Control-Allow-Headers": "Content-Type",

  "Access-Control-Max-Age": "86400",

};



const MAX_BODY_BYTES = 8 * 1024;

const OPENAI_TIMEOUT_MS = 50_000;

const OPENAI_MODEL = "gpt-4o-mini";

const MAX_SCENES = 24;



class HttpError extends Error {

  constructor(status, code, message) {

    super(message);

    this.status = status;

    this.code = code;

  }

}



function jsonResponse(body, status = 200) {

  return new Response(JSON.stringify(body), {

    status,

    headers: {

      ...CORS_HEADERS,

      "Content-Type": "application/json; charset=utf-8",

      "Cache-Control": "no-store",

    },

  });

}



function errorResponse(status, code, message) {

  return jsonResponse({ ok: false, error: { code, message } }, status);

}



async function enforceRateLimit(request, env, bindingName, routeKey) {
  const limiter = env[bindingName];
  const clientIp = request.headers.get("CF-Connecting-IP");

  if (!limiter || typeof limiter.limit !== "function" || !clientIp) {
    throw new HttpError(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "服務目前無法安全處理請求，請稍後再試。"
    );
  }

  let result;
  try {
    result = await limiter.limit({ key: `ai-story-house:${routeKey}:${clientIp}` });
  } catch {
    throw new HttpError(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "服務目前無法安全處理請求，請稍後再試。"
    );
  }

  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    typeof result.success !== "boolean"
  ) {
    throw new HttpError(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "服務目前無法安全處理請求，請稍後再試。"
    );
  }

  if (result.success === false) {
    throw new HttpError(
      429,
      "RATE_LIMITED",
      "請求太頻繁，請稍後再試。"
    );
  }

  return;
}

function sceneRange(minutes) {

  if (minutes === 1) return { min: 3, max: 3 };

  if (minutes === 2) return { min: 4, max: 5 };

  if (minutes === 3) return { min: 5, max: 5 };

  if (minutes <= 5) return { min: 6, max: 8 };

  if (minutes <= 9) return { min: 8, max: 12 };

  if (minutes === 10) return { min: 10, max: 12 };

  if (minutes <= 15) return { min: 12, max: 15 };

  return { min: 15, max: 24 };

}



async function readJsonBody(request, dataLabel = "故事設定") {

  const declaredLength = Number(

    request.headers.get("Content-Length") || 0

  );



  if (declaredLength > MAX_BODY_BYTES) {

    throw new HttpError(

      413,

      "BODY_TOO_LARGE",

      `${dataLabel}資料太大，請縮短內容後重試。`

    );

  }



  if (!request.body) {

    throw new HttpError(

      400,

      "INVALID_JSON",

      `請提供 JSON 格式的${dataLabel}。`

    );

  }



  const reader = request.body.getReader();

  const chunks = [];

  let total = 0;



  while (true) {

    const { done, value } = await reader.read();



    if (done) break;



    total += value.byteLength;



    if (total > MAX_BODY_BYTES) {

      await reader.cancel();



      throw new HttpError(

        413,

        "BODY_TOO_LARGE",

        `${dataLabel}資料太大，請縮短內容後重試。`

      );

    }



    chunks.push(value);

  }



  const bytes = new Uint8Array(total);

  let offset = 0;



  for (const chunk of chunks) {

    bytes.set(chunk, offset);

    offset += chunk.byteLength;

  }



  try {

    return JSON.parse(new TextDecoder().decode(bytes));

  } catch {

    throw new HttpError(

      400,

      "INVALID_JSON",

      `${dataLabel}不是有效的 JSON。`

    );

  }

}



function validateInput(input) {

  if (

    !input ||

    typeof input !== "object" ||

    Array.isArray(input)

  ) {

    throw new HttpError(

      400,

      "INVALID_INPUT",

      "請提供有效的故事設定。"

    );

  }



  const fields = {

    theme: {

      required: true,

      max: 120,

      label: "故事主題",

    },

    characters: {

      required: true,

      max: 200,

      label: "故事角色",

    },

    setting: {

      required: true,

      max: 160,

      label: "故事場景",

    },

    style: {

      required: true,

      max: 80,

      label: "故事風格",

    },

    age: {

      required: true,

      max: 40,

      label: "適讀年齡",

    },

  };



  for (const [key, rule] of Object.entries(fields)) {

    const value = input[key];



    if (typeof value !== "string") {

      throw new HttpError(

        400,

        "INVALID_INPUT",

        `${rule.label}格式不正確。`

      );

    }



    if (rule.required && !value.trim()) {

      throw new HttpError(

        400,

        "MISSING_FIELD",

        `請填寫${rule.label}。`

      );

    }



    if (value.length > rule.max) {

      throw new HttpError(

        400,

        "FIELD_TOO_LONG",

        `${rule.label}內容太長。`

      );

    }

  }



  if (

    !Number.isInteger(input.storyDuration) ||

    input.storyDuration < 1 ||

    input.storyDuration > 30

  ) {

    throw new HttpError(

      400,

      "INVALID_DURATION",

      "故事時間需設定為 1 到 30 分鐘。"

    );

  }



  return {

    theme: input.theme.trim(),

    characters: input.characters.trim(),

    setting: input.setting.trim(),

    style: input.style.trim(),

    age: input.age.trim(),

    storyDuration: input.storyDuration,

  };

}



function validateImageInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "INVALID_INPUT", "請提供有效的圖片設定。");
  }

  const fields = {
    title: { max: 120, label: "故事標題" },
    characters: { max: 200, label: "故事角色" },
    setting: { max: 160, label: "故事場景" },
    theme: { max: 120, label: "故事主題" },
    style: { max: 80, label: "故事風格" },
    age: { max: 40, label: "適讀年齡" },
  };

  if (Object.keys(input).some((key) => !Object.prototype.hasOwnProperty.call(fields, key))) {
    throw new HttpError(
      400,
      "INVALID_INPUT",
      "圖片設定只接受標題、角色、場景、主題、風格與適讀年齡。"
    );
  }

  for (const [key, rule] of Object.entries(fields)) {
    const value = input[key];

    if (typeof value !== "string") {
      throw new HttpError(400, "INVALID_INPUT", `${rule.label}格式不正確。`);
    }

    if (!value.trim()) {
      throw new HttpError(400, "INVALID_INPUT", `請填寫${rule.label}。`);
    }

    if (value.length > rule.max) {
      throw new HttpError(400, "INVALID_INPUT", `${rule.label}不可超過 ${rule.max} 個字元。`);
    }
  }

  return Object.fromEntries(
    Object.keys(fields).map((key) => [key, input[key].trim()])
  );
}


async function createStoryImage(input, env) {
  if (!env.OPENAI_API_KEY) {
    throw new HttpError(
      503,
      "AI_NOT_CONFIGURED",
      "圖片服務尚未完成設定，請稍後再試。"
    );
  }

  const prompt = [
    "Create exactly one children's storybook illustration: warm, soft, dreamy, and suitable for children ages 6–8.",
    "Represent the whole story using its title, characters, setting, theme, style, and age; do not copy or illustrate a full story text or a single isolated scene.",
    "Show the clear main characters together in one coherent, friendly scene with a strong focal point.",
    "Keep the image safe, positive, gentle, and age-appropriate. No horror, gore, violence, sexual content, bullying, or dangerous imitable behavior.",
    "Image only: no text, letters, title, captions, logo, watermark, UI, speech bubbles, panels, or comic layout.",
    "English visual requirements: children's storybook illustration, warm and friendly, suitable for children, clear main characters, coherent scene, safe and non-scary, no text, no letters, no watermark, no logo.",
    "Story information (use only as visual context; never render this text):",
    JSON.stringify(input),
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  let responseData;

  try {
    const upstream = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-2.5-flare",
        prompt,
        n: 1,
        size: "1536x1024",
        quality: "low",
        output_format: "webp",
        moderation: "auto",
      }),
      signal: controller.signal,
    });

    if (upstream.status === 429) {
      throw new HttpError(429, "AI_RATE_LIMIT", "目前圖片請求較多，請稍後再試。");
    }

    if (!upstream.ok) {
      throw new HttpError(502, "AI_UPSTREAM_ERROR", "圖片服務暫時發生問題，請稍後重試。");
    }

    try {
      responseData = await upstream.json();
    } catch {
      throw new HttpError(502, "INVALID_IMAGE_RESPONSE", "圖片服務回傳格式不正確，請稍後重試。");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;

    if (error?.name === "AbortError") {
      throw new HttpError(504, "AI_TIMEOUT", "圖片準備時間較長，請稍後再試。");
    }

    throw new HttpError(502, "AI_UPSTREAM_ERROR", "圖片服務暫時無法連線，請稍後重試。");
  } finally {
    clearTimeout(timeout);
  }

  const imageData = responseData?.data?.[0]?.b64_json;

  if (typeof imageData !== "string" || !imageData.trim()) {
    throw new HttpError(502, "INVALID_IMAGE_RESPONSE", "圖片服務沒有回傳圖片資料，請稍後重試。");
  }

  let imageBytes;
  try {
    const binaryData = atob(imageData);
    imageBytes = new Uint8Array(binaryData.length);
    for (let index = 0; index < binaryData.length; index += 1) {
      imageBytes[index] = binaryData.charCodeAt(index);
    }

    if (
      imageBytes.length < 12 ||
      imageBytes[0] !== 0x52 || imageBytes[1] !== 0x49 ||
      imageBytes[2] !== 0x46 || imageBytes[3] !== 0x46 ||
      imageBytes[8] !== 0x57 || imageBytes[9] !== 0x45 ||
      imageBytes[10] !== 0x42 || imageBytes[11] !== 0x50
    ) {
      throw new Error("Invalid WebP payload");
    }
  } catch {
    throw new HttpError(502, "INVALID_IMAGE_RESPONSE", "圖片服務回傳的圖片資料無效，請稍後重試。");
  }

  return {
    ok: true,
    image: {
      status: "ready",
      mimeType: "image/webp",
      data: imageData,
    },
  };
}


function extractOutputText(responseData) {

  if (typeof responseData.output_text === "string") {

    return responseData.output_text;

  }



  for (const item of responseData.output || []) {

    if (item.type !== "message") continue;



    for (const part of item.content || []) {

      if (part.type === "refusal") {

        throw new HttpError(

          502,

          "AI_REFUSAL",

          "故事服務目前無法完成這個請求，請調整設定後重試。"

        );

      }



      if (

        part.type === "output_text" &&

        typeof part.text === "string"

      ) {

        return part.text;

      }

    }

  }



  throw new HttpError(

    502,

    "INVALID_AI_RESPONSE",

    "故事服務回傳格式不完整，請稍後重試。"

  );

}



function validateGeneratedStory(value, range) {

  if (

    !value ||

    typeof value !== "object" ||

    Array.isArray(value) ||

    typeof value.title !== "string" ||

    !value.title.trim() ||

    value.title.length > 120 ||

    !Array.isArray(value.scenes) ||

    value.scenes.length < range.min ||

    value.scenes.length > range.max ||

    value.scenes.length > MAX_SCENES

  ) {

    throw new HttpError(

      502,

      "INVALID_STORY",

      "故事服務回傳的故事格式不正確，請重試。"

    );

  }



  const scenes = value.scenes.map((scene) => {

    if (

      !scene ||

      typeof scene !== "object" ||

      Array.isArray(scene) ||

      typeof scene.title !== "string" ||

      !scene.title.trim() ||

      scene.title.length > 120 ||

      typeof scene.text !== "string" ||

      !scene.text.trim() ||

      scene.text.length > 5000

    ) {

      throw new HttpError(

        502,

        "INVALID_SCENE",

        "故事場景內容不完整，請重新創作。"

      );

    }



    return {

      title: scene.title.trim(),

      text: scene.text.trim(),

    };

  });



  return {

    title: value.title.trim(),

    scenes,

  };

}



async function createStory(input, env) {

  if (!env.OPENAI_API_KEY) {

    throw new HttpError(

      503,

      "AI_NOT_CONFIGURED",

      "故事服務尚未完成設定，請稍後再試。"

    );

  }



  const range = sceneRange(input.storyDuration);



  const systemPrompt = [

    "你是 AI 故事小屋的兒童故事創作者。",

    "創作內容必須適合兒童與家庭共讀，溫暖、安全、正向。",

    "不得包含暴力、色情、恐怖、血腥、霸凌美化或危險模仿行為。",

    "故事須有清楚的開頭、發展與結尾，語言自然易懂。",

    "每個 scene 都必須推進明確劇情，不得只寫摘要或重複標題。",

    "scene.text 不要重複該幕標題。",

    "依照使用者提供的故事長度，創作足夠完整的內容。",

    "只輸出符合指定 JSON Schema 的資料，不要 Markdown 或額外說明。",

  ].join("\n");



  const userPrompt = [

    "請依照以下條件創作一則繁體中文兒童故事：",



    JSON.stringify({

      theme: input.theme,

      characters: input.characters,

      setting: input.setting,

      style: input.style,

      age: input.age,

      storyDurationMinutes: input.storyDuration,

      requiredSceneCount: range,

      approximateLength: `約 ${input.storyDuration} 分鐘的朗讀故事`,

    }),



    `scenes 數量必須介於 ${range.min} 到 ${range.max} 幕。`,

    "每一幕都要有具體事件，並讓情節自然銜接。",

  ].join("\n");



  const schema = {

    type: "object",

    additionalProperties: false,



    properties: {

      title: {

        type: "string",

      },



      scenes: {

        type: "array",



        items: {

          type: "object",

          additionalProperties: false,



          properties: {

            title: {

              type: "string",

            },



            text: {

              type: "string",

            },

          },



          required: [

            "title",

            "text",

          ],

        },

      },

    },



    required: [

      "title",

      "scenes",

    ],

  };



  const controller = new AbortController();



  const timeout = setTimeout(

    () => controller.abort(),

    OPENAI_TIMEOUT_MS

  );



  let upstream;
  let responseData;



  try {

    upstream = await fetch(

      "https://api.openai.com/v1/responses",

      {

        method: "POST",



        headers: {

          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,

          "Content-Type": "application/json",

        },



        body: JSON.stringify({

          model: OPENAI_MODEL,



          input: [

            {

              role: "system",

              content: systemPrompt,

            },

            {

              role: "user",

              content: userPrompt,

            },

          ],



          text: {

            format: {

              type: "json_schema",

              name: "ai_story",

              strict: true,

              schema,

            },

          },



          max_output_tokens: 10000,

        }),



        signal: controller.signal,

      }

    );

  } catch (error) {
    clearTimeout(timeout);

    if (error?.name === "AbortError" || controller.signal.aborted) {

      throw new HttpError(

        504,

        "AI_TIMEOUT",

        "故事創作時間較長，請稍後再試。"

      );

    }



    throw new HttpError(

      502,

      "AI_UPSTREAM_ERROR",

      "故事服務暫時無法連線，請稍後重試。"

    );

  } 



  try {
    if (upstream.status === 429) {
      throw new HttpError(
        429,
        "AI_RATE_LIMIT",
        "目前故事請求較多，請稍後再試。"
      );
    }

    if (!upstream.ok) {
      throw new HttpError(
        502,
        "AI_UPSTREAM_ERROR",
        "故事服務暫時發生問題，請稍後重試。"
      );
    }

    responseData = await upstream.json();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error?.name === "AbortError" || controller.signal.aborted) {
      throw new HttpError(
        504,
        "AI_TIMEOUT",
        "故事創作時間較長，請稍後再試。"
      );
    }
    throw new HttpError(
      502,
      "INVALID_AI_RESPONSE",
      "故事服務回傳格式不正確，請稍後再試。"
    );
  } finally {
    clearTimeout(timeout);
  }

  if (

    responseData.status &&

    responseData.status !== "completed"

  ) {

    throw new HttpError(

      502,

      "INCOMPLETE_AI_RESPONSE",

      "故事尚未完整生成，請稍後重試。"

    );

  }



  const outputText = extractOutputText(responseData);



  let generated;



  try {

    generated = JSON.parse(outputText);

  } catch {

    throw new HttpError(

      502,

      "INVALID_AI_JSON",

      "故事服務回傳的內容無法解析，請稍後重試。"

    );

  }



  const storyContent = validateGeneratedStory(

    generated,

    range

  );



  const now = new Date().toISOString();



  return {

    id: crypto.randomUUID(),



    title: storyContent.title,



    type: "ai",



    characters: input.characters,



    setting: input.setting,



    theme: input.theme,



    age: input.age,



    style: input.style,



    storyDuration: input.storyDuration,



    scenes: storyContent.scenes.map(

      (scene, index) => ({

        id: `scene-${index + 1}`,



        title: scene.title,



        text: scene.text,



        image: "",



        audio: "",

      })

    ),



    createdAt: now,



    favorite: false,

  };

}



export default {

  async fetch(request, env) {

    const url = new URL(request.url);



    if (

      url.pathname === "/" &&

      request.method === "GET"

    ) {

      return jsonResponse({

        ok: true,

        service: "AI Story House",

        worker: "ai-story-house-worker",

      });

    }



        if (
      url.pathname === "/api/story-image" &&
      request.method === "OPTIONS"
    ) {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    if (
      url.pathname === "/api/story-image" &&
      request.method === "POST"
    ) {
      try {
        await enforceRateLimit(request, env, "STORY_IMAGE_LIMITER", "story-image");
        const contentType = request.headers.get("Content-Type") || "";
        if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
          throw new HttpError(
            400,
            "INVALID_CONTENT_TYPE",
            "請使用 application/json 傳送圖片設定。"
          );
        }

        const rawInput = await readJsonBody(request, "圖片設定");
        const input = validateImageInput(rawInput);
        const result = await createStoryImage(input, env);
        return jsonResponse(result);
      } catch (error) {
        if (error instanceof HttpError) {
          return errorResponse(error.status, error.code, error.message);
        }

        return errorResponse(
          502,
          "IMAGE_GENERATION_FAILED",
          "故事插圖暫時無法產生，請稍後重試。"
        );
      }
    }

    if (url.pathname === "/api/story-image") {
      return errorResponse(
        405,
        "METHOD_NOT_ALLOWED",
        "這個 API 不支援目前的請求方式。"
      );
    }
if (

      url.pathname === "/api/story" &&

      request.method === "OPTIONS"

    ) {

      return new Response(null, {

        status: 204,

        headers: CORS_HEADERS,

      });

    }



    if (

      url.pathname === "/api/story" &&

      request.method === "POST"

    ) {

      try {

        await enforceRateLimit(request, env, "STORY_LIMITER", "story");
        const contentType =

          request.headers.get("Content-Type") || "";



        if (

          !/^application\/json(?:\s*;|$)/i.test(

            contentType

          )

        ) {

          throw new HttpError(

            400,

            "INVALID_CONTENT_TYPE",

            "請使用 application/json 傳送故事設定。"

          );

        }



        const rawInput =

          await readJsonBody(request);



        const input =

          validateInput(rawInput);



        const story =

          await createStory(input, env);



        return jsonResponse(story);

      } catch (error) {

        if (error instanceof HttpError) {

          return errorResponse(

            error.status,

            error.code,

            error.message

          );

        }



        return errorResponse(

          502,

          "INTERNAL_ERROR",

          "故事服務暫時發生問題，請稍後重試。"

        );

      }

    }



    if (

      url.pathname === "/api/story"

    ) {

      return errorResponse(

        405,

        "METHOD_NOT_ALLOWED",

        "這個 API 不支援目前的請求方式。"

      );

    }



    return errorResponse(

      404,

      "NOT_FOUND",

      "找不到這個服務路徑。"

    );

  },

};
