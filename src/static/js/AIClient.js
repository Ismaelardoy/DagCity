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

const DAGCITY_SYSTEM_PROMPT = 'Eres DagCity AI, un asistente de ingeniería de datos. Siempre debes responder usando un bloque JSON estricto con este formato: { "message": "tu respuesta hablada", "action": "NONE | FOCUS_NODE", "target": "nombre_del_nodo_si_aplica" }. Si detectas nodos con problemas en el contexto que te paso, prioriza hablar de ellos y ofrece usar la acción FOCUS_NODE para mostrarlos.';

function sanitizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function prepareAIContext() {
  const nodes = State.raw?.nodes || [];
  const overSla = [];
  const deadEnds = [];
  const heavyNodes = [];

  nodes.forEach((n) => {
    const threshold = State.slaNodes?.[n.id] ?? State.slaZones?.[n.layer] ?? State.userDefinedSLA;
    if ((n.execution_time || 0) >= threshold) overSla.push(n.name || n.id);
    if (n.is_dead_end) deadEnds.push(n.name || n.id);
    
    // Collect heavy nodes if Data Swell is active
    if (State.dataVolumeMode) {
      const metric = State.dataSwellMetric || 'execution_time';
      let value = 0;
      if (metric === 'rows') value = n.rows || 0;
      else if (metric === 'code_length') value = n.code_length || n.sql_length || 0;
      else if (metric === 'connections') value = (n.upstream?.length || 0) + (n.downstream?.length || 0);
      else value = n.execution_time || 0;
      heavyNodes.push({ name: n.name || n.id, value });
    }
  });

  // Sort heavy nodes and get top 3
  heavyNodes.sort((a, b) => b.value - a.value);
  const topHeavyNodes = heavyNodes.slice(0, 3).map(n => `${n.name} (${Math.round(n.value)})`);

  // Calculate structure info
  const uniqueGroups = [...new Set(nodes.map(n => n.group || 'default'))];
  const islandsCount = uniqueGroups.length;
  const totalModels = nodes.length;

  return {
    nodesOverSLA: overSla.slice(0, 10).map(n => `${n} (${Math.round(nodes.find(x => (x.name || x.id) === n)?.execution_time || 0)}s)`),
    heavyNodes: topHeavyNodes,
    structure: `${islandsCount} islas, ${totalModels} modelos`,
    activeFilters: State.perfMode ? 'SLA Mode' : State.dataVolumeMode ? `Data Swell (${State.dataSwellMetric})` : 'None',
    selectedNode: State.selectedNode?.name || null,
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
    const context = prepareAIContext();
    
    // Format context as readable text for AI
    const contextParts = [];
    if (context.nodesOverSLA.length > 0) {
      contextParts.push(`[Nodos con error: ${context.nodesOverSLA.join(', ')}]`);
    }
    if (context.heavyNodes.length > 0) {
      contextParts.push(`[Nodos pesados: ${context.heavyNodes.join(', ')}]`);
    }
    contextParts.push(`[Estructura: ${context.structure}]`);
    contextParts.push(`[Filtros activos: ${context.activeFilters}]`);
    if (context.selectedNode) {
      contextParts.push(`[Nodo seleccionado: ${context.selectedNode}]`);
    }
    
    const contextPrompt = 'Contexto de DagCity: ' + contextParts.join(' ');

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
