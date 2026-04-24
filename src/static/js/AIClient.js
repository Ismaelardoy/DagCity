import { State } from './State.js';

const PROVIDER_CONFIG = {
  openai: {
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
  },
};

const STORAGE_KEYS = {
  provider: 'dagcity_ai_provider',
  apiKey: 'dagcity_ai_api_key',
};

const DAGCITY_SYSTEM_PROMPT = 'Eres DagCity AI, un asistente de ingeniería de datos. Siempre debes responder usando un bloque JSON estricto con este formato: { "message": "tu respuesta hablada", "action": "NONE | FOCUS_NODE", "target": "nombre_del_nodo_si_aplica" }.';

function sanitizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function collectRuntimeContext() {
  const nodes = State.raw?.nodes || [];
  const overSla = [];
  const deadEnds = [];

  nodes.forEach((n) => {
    const threshold = State.slaNodes?.[n.id] ?? State.slaZones?.[n.layer] ?? State.userDefinedSLA;
    if ((n.execution_time || 0) >= threshold) overSla.push(n.name || n.id);
    if (n.is_dead_end) deadEnds.push(n.name || n.id);
  });

  return {
    selectedNode: State.selectedNode?.name || null,
    viewMode: State.viewMode || '3d',
    perfMode: !!State.perfMode,
    dataVolumeMode: !!State.dataVolumeMode,
    nodesOverSLA: overSla.slice(0, 30),
    deadEndNodes: deadEnds.slice(0, 30),
    totalNodes: nodes.length,
    totalEdges: (State.raw?.links || []).length,
  };
}

function parseAssistantPayload(rawContent) {
  const fallback = {
    message: sanitizeText(rawContent) || 'No response generated.',
    action: 'NONE',
    target: '',
  };
  if (!rawContent) return fallback;

  const tryParse = (txt) => {
    const parsed = JSON.parse(txt);
    return {
      message: sanitizeText(parsed.message),
      action: parsed.action === 'FOCUS_NODE' ? 'FOCUS_NODE' : 'NONE',
      target: sanitizeText(parsed.target || ''),
    };
  };

  try { return tryParse(rawContent); } catch (_) {}
  const match = rawContent.match(/\{[\s\S]*\}/);
  if (match) {
    try { return tryParse(match[0]); } catch (_) {}
  }
  return fallback;
}

export class AIClient {
  constructor() {
    this.provider = localStorage.getItem(STORAGE_KEYS.provider) || 'openai';
    this.apiKey = localStorage.getItem(STORAGE_KEYS.apiKey) || '';
  }

  getProvider() {
    return this.provider;
  }

  setProvider(providerId) {
    if (PROVIDER_CONFIG[providerId]) {
      this.provider = providerId;
      localStorage.setItem(STORAGE_KEYS.provider, providerId);
    }
  }

  getApiKey() {
    return this.apiKey;
  }

  setApiKey(value) {
    this.apiKey = sanitizeText(value);
    localStorage.setItem(STORAGE_KEYS.apiKey, this.apiKey);
  }

  hasApiKey() {
    return !!this.apiKey;
  }

  getConfig() {
    return PROVIDER_CONFIG[this.provider] || PROVIDER_CONFIG.openai;
  }

  async chat(userMessage, history = []) {
    const key = this.apiKey;
    if (!key) {
      throw new Error('Missing AI API key. Save it in Settings > AI Copilot.');
    }

    const config = this.getConfig();
    const runtimeContext = collectRuntimeContext();
    const contextPrompt = 'Datos actuales del entorno DagCity: ' + JSON.stringify(runtimeContext);

    const messages = [
      { role: 'system', content: DAGCITY_SYSTEM_PROMPT },
      { role: 'system', content: contextPrompt },
      ...history.slice(-8).map((h) => ({ role: h.role, content: String(h.content || '') })),
      { role: 'user', content: String(userMessage || '') },
    ];

    const response = await fetch(config.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages,
      }),
    });

    if (!response.ok) {
      const errTxt = await response.text();
      throw new Error('AI API error ' + response.status + ': ' + errTxt);
    }

    const data = await response.json();
    const rawContent = data?.choices?.[0]?.message?.content || '';
    return parseAssistantPayload(rawContent);
  }
}

export const aiClient = new AIClient();
