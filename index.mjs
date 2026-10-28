// OpenCode v2 server plugin. No external dependencies or downloaded models.
const ENDPOINT = 'https://opencode.ai/inference/openai/v1';
const PRIORITY = ['deepseek-v4.1-flash-free', 'glm-5.3-flash-free', 'beam-free', 'mimo-v2.6-flash-free'];
const RETRYABLE = new Set([404, 408, 429, 500, 502, 503, 504]);

export function isFree(model) {
  return model.providerID === 'opencode' && model.enabled && model.status !== 'deprecated'
    && (!model.type || model.type === 'chat') && model.capabilities?.tools
    && (!model.package || model.package === '@opencode/ai/providers/openai-compatible')
    && model.cost?.length > 0 && model.cost.every(t =>
      t.input === 0 && t.output === 0 && t.cache?.read === 0 && t.cache?.write === 0);
}

function rank(model) {
  const i = PRIORITY.indexOf(model.id);
  return i < 0 ? PRIORITY.length : i;
}

export function createRouter({ fetcher = fetch, now = Date.now, log = console.error } = {}) {
  let models = [];
  const cooldown = new Map();
  const pending = new Map();

  const report = (from, to, reason) => log(`[free-router] ${from} -> ${to} (${reason})`);
  function eligible(body, source) {
    const text = JSON.stringify(body.messages ?? []);
    const image = /"type"\s*:\s*"(?:image_url|input_image)"/.test(text);
    const audio = /"type"\s*:\s*"(?:input_audio|audio)"/.test(text);
    const video = /"type"\s*:\s*"(?:video_url|input_video)"/.test(text);
    return models.filter(m =>
      (!image || m.capabilities.input.includes('image'))
      && (!audio || m.capabilities.input.includes('audio'))
      && (!video || m.capabilities.input.includes('video'))
      && (m.limit.input ?? m.limit.context) >= (source.limit.input ?? source.limit.context)
      && m.compatibility?.reasoningField === source.compatibility?.reasoningField);
  }

  function bodyFor(body, model) {
    const next = { ...body, model: model.modelID };
    for (const field of ['max_tokens', 'max_completion_tokens']) {
      if (typeof next[field] === 'number') next[field] = Math.min(next[field], model.limit.output);
    }
    // Variants are model-specific; never carry unsupported reasoning settings across models.
    if (body.model !== model.modelID) {
      delete next.reasoning_effort;
      delete next.reasoning;
      delete next.thinking;
    }
    return JSON.stringify(next);
  }

  function fail(model, response) {
    const seconds = Number(response?.headers.get('retry-after'));
    const date = Date.parse(response?.headers.get('retry-after') ?? '');
    const delay = seconds > 0 ? seconds * 1000 : Number.isFinite(date) ? date - now() : 60_000;
    cooldown.set(model.id, now() + Math.max(1000, delay));
  }

  return {
    transform(editor) {
      models = editor.list().filter(m => m.id !== 'free-auto' && isFree(m)).map(m => ({...m, modelID: m.modelID ?? m.id})).sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
      const allowed = new Set(models.map(m => `${m.providerID}/${m.id}`));
      for (const m of editor.list()) {
        if (!allowed.has(`${m.providerID}/${m.id}`)) editor.remove(m.providerID, m.id);
        else editor.update(m.providerID, m.id, draft => {
          draft.settings = { ...draft.settings, encoding: 'none', transport: 'http' };
        });
      }
      if (models[0]) {
        // A stable session reference survives removal of individual free models from the catalog.
        editor.update('opencode', 'free-auto', draft => Object.assign(draft, structuredClone({
          ...models[0], id: 'free-auto', name: 'Gratis automático',
          settings: { ...models[0].settings, encoding: 'none', transport: 'http' },
        })));
        editor.default.set('opencode', 'free-auto');
      }
    },
    async request(event) {
      const url = new URL(event.request.url);
      if (event.model.providerID !== 'opencode' || url.href !== `${ENDPOINT}/chat/completions`) {
        throw new Error('free-router: solo se permiten los modelos gratuitos oficiales de OpenCode.');
      }
      const body = await event.request.clone().json();
      const source = models.find(m => m.modelID === body.model);
      if (!source) throw new Error('free-router: modelo no disponible o sin precio cero verificado.');
      const pool = eligible(body, source);
      const preferred = pool.find(m => m.id === source.id && (cooldown.get(m.id) ?? 0) <= now());
      const selected = preferred ?? pool.find(m => (cooldown.get(m.id) ?? 0) <= now());
      if (!selected) throw new Error('free-router: todos los modelos compatibles están temporalmente limitados. Espera y vuelve a intentar.');
      if (selected.id !== source.id) report(source.id, selected.id, 'modelo en pausa');
      // Requests are correlated individually, including parallel title/agent calls.
      const id = crypto.randomUUID();
      const headers = new Headers(event.request.headers);
      headers.delete('content-length');
      headers.set('x-local-free-router', id);
      event.request = new Request(event.request, { headers, body: bodyFor(body, selected) });
      pending.set(id, { body, source, selected, created: now() });
      for (const [old, item] of pending) if (now() - item.created > 600_000) pending.delete(old);
    },
    async response(event) {
      const id = event.request.headers.get('x-local-free-router');
      const state = pending.get(id);
      pending.delete(id);
      if (!state) return;
      if (!RETRYABLE.has(event.response.status)) return;
      let previous = state.selected;
      fail(previous, event.response);
      const pool = eligible(state.body, state.source).filter(m => m.id !== previous.id);
      for (const candidate of pool) {
        if ((cooldown.get(candidate.id) ?? 0) > now()) continue;
        if (event.request.signal.aborted) return;
        report(previous.id, candidate.id, `HTTP ${event.response.status}`);
        let response;
        try {
          const headers = new Headers(event.request.headers);
          headers.delete('content-length');
          headers.delete('x-local-free-router');
          response = await fetcher(event.request.url, {
            method: 'POST', headers, body: bodyFor(state.body, candidate),
            signal: AbortSignal.any([event.request.signal, AbortSignal.timeout(60_000)]),
            redirect: 'error',
          });
        } catch (error) {
          if (event.request.signal.aborted) throw error;
          fail(candidate);
          previous = candidate;
          continue;
        }
        await event.response.body?.cancel().catch(() => {});
        event.response = response;
        if (!RETRYABLE.has(response.status)) return;
        fail(candidate, response);
        previous = candidate;
      }
      log('[free-router] Sin alternativas gratuitas compatibles disponibles. No se utilizaron modelos de pago.');
    },
  };
}

export default {
  id: 'local.free-router',
  async setup(ctx) {
    const router = createRouter();
    await ctx.model.transform(editor => router.transform(editor));
    await ctx.websearch.transform(editor => editor.default.set(false));
    await ctx.session.hook('http.request', e => router.request(e));
    await ctx.session.hook('http.response', e => router.response(e));
  },
};
