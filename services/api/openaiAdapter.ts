import { randomUUID } from 'crypto'

type FetchLike = typeof globalThis.fetch

type OpenAIClientOptions = {
  apiKey?: string
  baseURL?: string
  defaultHeaders?: Record<string, string>
  fetch: FetchLike
}

type OpenAICreateParams = {
  model: string
  messages: Array<{ role: string; content: unknown }>
  system?: Array<{ text?: string }>
  tools?: Array<{
    name?: string
    description?: string
    input_schema?: Record<string, unknown>
  }>
  tool_choice?: { type?: string; name?: string } | string
  max_tokens?: number
  temperature?: number
  stream?: boolean
}

type OpenAIRequestOptions = {
  signal?: AbortSignal
  timeout?: number
  headers?: Record<string, string>
}

type OpenAIUsage = {
  prompt_tokens?: number
  completion_tokens?: number
}

type OpenAIChatCompletion = {
  id?: string
  model?: string
  usage?: OpenAIUsage
  choices?: Array<{
    finish_reason?: string | null
    message?: {
      content?: string | null
      tool_calls?: Array<{
        id?: string
        type?: 'function'
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
  }>
}

type OpenAIChatCompletionChunk = {
  id?: string
  model?: string
  usage?: OpenAIUsage
  choices?: Array<{
    index?: number
    finish_reason?: string | null
    delta?: {
      content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
  }>
}

type OpenAIResponseWithData<T> = {
  data: T
  request_id: string | null
  response: Response
}

class OpenAIRequest<T> implements PromiseLike<T> {
  constructor(
    private readonly execute: () => Promise<T>,
    private readonly executeWithResponse: () => Promise<OpenAIResponseWithData<T>>,
  ) {}

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | null
      | undefined,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null
      | undefined,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected)
  }

  withResponse(): Promise<OpenAIResponseWithData<T>> {
    return this.executeWithResponse()
  }
}

class OpenAIAnthropicStream implements AsyncIterable<unknown> {
  constructor(
    readonly controller: AbortController,
    private readonly iteratorFactory: () => AsyncGenerator<unknown>,
  ) {}

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return this.iteratorFactory()
  }
}

class OpenAIHTTPError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestID: string | null,
    readonly error?: unknown,
  ) {
    super(message)
    this.name = 'OpenAIHTTPError'
  }
}

export function createOpenAIAnthropicAdapter(options: OpenAIClientOptions) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is required when CLAUDE_CODE_USE_OPENAI is enabled',
    )
  }

  const baseURL = (options.baseURL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(
    /\/$/,
    '',
  )

  return {
    beta: {
      messages: {
        create: (params: OpenAICreateParams, requestOptions?: OpenAIRequestOptions) => {
          const executeWithResponse = async (): Promise<
            OpenAIResponseWithData<unknown>
          > => {
            const response = await postChatCompletions({
              apiKey,
              baseURL,
              params,
              requestOptions,
              defaultHeaders: options.defaultHeaders,
              fetchImpl: options.fetch,
            })

            if (params.stream) {
              const controller = response.controller
              const stream = new OpenAIAnthropicStream(controller, () =>
                streamAsAnthropicEvents({
                  response: response.response,
                  controller,
                  model: params.model,
                }),
              )
              return {
                data: stream,
                request_id: response.requestId,
                response: response.response,
              }
            }

            const json = (await response.response.json()) as OpenAIChatCompletion
            return {
              data: toAnthropicMessage(json, params.model),
              request_id: response.requestId,
              response: response.response,
            }
          }

          return new OpenAIRequest(
            async () => (await executeWithResponse()).data,
            executeWithResponse,
          )
        },
      },
    },
    models: {
      async *list() {
        return
      },
    },
  }
}

async function postChatCompletions({
  apiKey,
  baseURL,
  params,
  requestOptions,
  defaultHeaders,
  fetchImpl,
}: {
  apiKey: string
  baseURL: string
  params: OpenAICreateParams
  requestOptions?: OpenAIRequestOptions
  defaultHeaders?: Record<string, string>
  fetchImpl: FetchLike
}): Promise<{
  response: Response
  requestId: string | null
  controller: AbortController
}> {
  const controller = createAbortController(
    requestOptions?.signal,
    requestOptions?.timeout,
  )
  const body = buildOpenAIRequestBody(params)
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
    ...defaultHeaders,
    ...requestOptions?.headers,
  }

  const response = await fetchImpl(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: controller.signal,
  })

  const requestId = response.headers.get('x-request-id')
  if (!response.ok) {
    let errorBody: unknown = undefined
    let message = `${response.status} ${response.statusText}`
    try {
      errorBody = await response.json()
      const apiMessage =
        typeof errorBody === 'object' &&
        errorBody !== null &&
        'error' in errorBody &&
        typeof errorBody.error === 'object' &&
        errorBody.error !== null &&
        'message' in errorBody.error &&
        typeof errorBody.error.message === 'string'
          ? errorBody.error.message
          : undefined
      if (apiMessage) {
        message = apiMessage
      }
    } catch {
      // ignore JSON parse failures for error bodies
    }
    throw new OpenAIHTTPError(message, response.status, requestId, errorBody)
  }

  return { response, requestId, controller }
}

function buildOpenAIRequestBody(params: OpenAICreateParams): Record<string, unknown> {
  const tools = (params.tools || [])
    .map(tool => toOpenAITool(tool))
    .filter(Boolean)
  return {
    model: params.model,
    messages: toOpenAIMessages(params.messages, params.system),
    ...(tools.length > 0
      ? {
          tools,
          tool_choice: toOpenAIToolChoice(params.tool_choice),
        }
      : {}),
    ...(params.max_tokens !== undefined ? { max_tokens: params.max_tokens } : {}),
    ...(params.temperature !== undefined
      ? { temperature: params.temperature }
      : {}),
    ...(params.stream
      ? { stream: true, stream_options: { include_usage: true } }
      : {}),
  }
}

function toOpenAIMessages(
  messages: OpenAICreateParams['messages'],
  systemBlocks: OpenAICreateParams['system'],
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const systemText = (systemBlocks || [])
    .map(block => block?.text ?? '')
    .filter(Boolean)
    .join('\n\n')
  if (systemText) {
    out.push({ role: 'system', content: systemText })
  }

  for (const message of messages) {
    if (message.role === 'user') {
      out.push(...convertUserMessage(message.content))
      continue
    }
    if (message.role === 'assistant') {
      out.push(convertAssistantMessage(message.content))
      continue
    }
  }
  return out
}

function convertUserMessage(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return [{ role: 'user', content }]
  }

  if (!Array.isArray(content)) {
    return [{ role: 'user', content: stringifyUnknown(content) }]
  }

  const out: Array<Record<string, unknown>> = []
  let pendingText: string[] = []

  const flushPendingText = () => {
    const text = pendingText.join('\n').trim()
    if (text) {
      out.push({ role: 'user', content: text })
    }
    pendingText = []
  }

  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue
    }
    if ('type' in block && block.type === 'tool_result') {
      flushPendingText()
      out.push({
        role: 'tool',
        tool_call_id:
          'tool_use_id' in block && typeof block.tool_use_id === 'string'
            ? block.tool_use_id
            : randomUUID(),
        content: extractToolResultContent(block),
      })
      continue
    }
    const text = extractTextFromBlock(block)
    if (text) {
      pendingText.push(text)
    }
  }

  flushPendingText()
  if (out.length === 0) {
    out.push({ role: 'user', content: '' })
  }
  return out
}

function convertAssistantMessage(content: unknown): Record<string, unknown> {
  if (typeof content === 'string') {
    return { role: 'assistant', content }
  }

  if (!Array.isArray(content)) {
    return { role: 'assistant', content: stringifyUnknown(content) }
  }

  const textParts: string[] = []
  const toolCalls: Array<Record<string, unknown>> = []

  for (const block of content) {
    if (!block || typeof block !== 'object' || !('type' in block)) {
      continue
    }
    if (block.type === 'tool_use') {
      toolCalls.push({
        id: 'id' in block && typeof block.id === 'string' ? block.id : randomUUID(),
        type: 'function',
        function: {
          name:
            'name' in block && typeof block.name === 'string'
              ? block.name
              : 'tool',
          arguments: JSON.stringify(
            'input' in block ? normalizeToolInput(block.input) : {},
          ),
        },
      })
      continue
    }
    const text = extractTextFromBlock(block)
    if (text) {
      textParts.push(text)
    }
  }

  return {
    role: 'assistant',
    content: textParts.join('\n').trim(),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  }
}

function toOpenAITool(tool: {
  name?: string
  description?: string
  input_schema?: Record<string, unknown>
}) {
  if (!tool.name) {
    return null
  }
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema || {
        type: 'object',
        properties: {},
      },
    },
  }
}

function toOpenAIToolChoice(toolChoice: OpenAICreateParams['tool_choice']) {
  if (!toolChoice) {
    return 'auto'
  }
  if (typeof toolChoice === 'string') {
    return toolChoice
  }
  if (toolChoice.type === 'tool' && toolChoice.name) {
    return {
      type: 'function',
      function: { name: toolChoice.name },
    }
  }
  if (toolChoice.type === 'any') {
    return 'required'
  }
  if (toolChoice.type === 'none') {
    return 'none'
  }
  return 'auto'
}

function createAbortController(
  signal?: AbortSignal,
  timeout?: number,
): AbortController {
  const controller = new AbortController()
  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason)
    } else {
      signal.addEventListener('abort', () => controller.abort(signal.reason), {
        once: true,
      })
    }
  }
  if (timeout && timeout > 0) {
    setTimeout(() => controller.abort(new Error('Request timed out')), timeout)
  }
  return controller
}

async function* streamAsAnthropicEvents({
  response,
  controller,
  model,
}: {
  response: Response
  controller: AbortController
  model: string
}): AsyncGenerator<unknown> {
  const messageId = randomUUID()
  const contentBlocks = new Map<
    number,
    { type: 'text' | 'tool_use'; index: number; id?: string; name?: string }
  >()
  let nextIndex = 0
  let textIndex: number | undefined
  let finishReason: string | null = null
  let usage: OpenAIUsage | undefined
  let started = false

  const ensureStarted = (chunk?: OpenAIChatCompletionChunk) => {
    if (started) {
      return
    }
    started = true
    return {
      type: 'message_start',
      message: {
        id: chunk?.id || messageId,
        type: 'message',
        role: 'assistant',
        model: chunk?.model || model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: mapUsage(undefined),
        container: null,
        context_management: null,
      },
    }
  }

  for await (const chunk of parseSSE<OpenAIChatCompletionChunk>(response)) {
    const startEvent = ensureStarted(chunk)
    if (startEvent) {
      yield startEvent
    }

    if (chunk.usage) {
      usage = chunk.usage
    }

    for (const choice of chunk.choices || []) {
      if (choice.finish_reason) {
        finishReason = choice.finish_reason
      }

      const delta = choice.delta
      if (!delta) {
        continue
      }

      if (delta.content) {
        if (textIndex === undefined) {
          textIndex = nextIndex++
          contentBlocks.set(textIndex, { type: 'text', index: textIndex })
          yield {
            type: 'content_block_start',
            index: textIndex,
            content_block: {
              type: 'text',
              text: '',
            },
          }
        }
        yield {
          type: 'content_block_delta',
          index: textIndex,
          delta: {
            type: 'text_delta',
            text: delta.content,
          },
        }
      }

      for (const toolCall of delta.tool_calls || []) {
        const openAIIndex = toolCall.index ?? 0
        let state = contentBlocks.get(openAIIndex + 10_000)
        if (!state) {
          const anthropicIndex = nextIndex++
          state = {
            type: 'tool_use',
            index: anthropicIndex,
            id: toolCall.id || randomUUID(),
            name: toolCall.function?.name || 'tool',
          }
          contentBlocks.set(openAIIndex + 10_000, state)
          yield {
            type: 'content_block_start',
            index: anthropicIndex,
            content_block: {
              type: 'tool_use',
              id: state.id,
              name: state.name,
              input: '',
            },
          }
        }

        if (toolCall.function?.arguments) {
          yield {
            type: 'content_block_delta',
            index: state.index,
            delta: {
              type: 'input_json_delta',
              partial_json: toolCall.function.arguments,
            },
          }
        }
      }
    }
  }

  if (!started) {
    const startEvent = ensureStarted()
    if (startEvent) {
      yield startEvent
    }
  }

  if (textIndex !== undefined) {
    yield {
      type: 'content_block_stop',
      index: textIndex,
    }
  }

  const toolStates = [...contentBlocks.values()]
    .filter(block => block.type === 'tool_use')
    .sort((a, b) => a.index - b.index)
  for (const block of toolStates) {
    yield {
      type: 'content_block_stop',
      index: block.index,
    }
  }

  yield {
    type: 'message_delta',
    delta: {
      stop_reason: mapFinishReason(finishReason),
    },
    usage: mapUsage(usage),
  }
  yield { type: 'message_stop' }

  if (!controller.signal.aborted) {
    controller.abort()
  }
}

async function* parseSSE<T>(response: Response): AsyncGenerator<T> {
  const reader = response.body?.getReader()
  if (!reader) {
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

    while (true) {
      const separatorMatch = buffer.match(/\r?\n\r?\n/)
      const separatorIndex = separatorMatch?.index ?? -1
      if (separatorIndex === -1) {
        break
      }
      const rawEvent = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(
        separatorIndex + (separatorMatch?.[0].length ?? 2),
      )
      const data = rawEvent
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')
      if (!data || data === '[DONE]') {
        continue
      }
      yield JSON.parse(data) as T
    }

    if (done) {
      break
    }
  }
}

function toAnthropicMessage(
  completion: OpenAIChatCompletion,
  fallbackModel: string,
) {
  const choice = completion.choices?.[0]
  const textContent = choice?.message?.content ?? ''
  const toolCalls = choice?.message?.tool_calls ?? []

  return {
    id: completion.id || randomUUID(),
    type: 'message',
    role: 'assistant',
    model: completion.model || fallbackModel,
    stop_reason: mapFinishReason(choice?.finish_reason),
    stop_sequence: null,
    usage: mapUsage(completion.usage),
    content: [
      ...(textContent
        ? [
            {
              type: 'text',
              text: textContent,
            },
          ]
        : []),
      ...toolCalls.map(toolCall => ({
        type: 'tool_use',
        id: toolCall.id || randomUUID(),
        name: toolCall.function?.name || 'tool',
        input: normalizeToolInput(toolCall.function?.arguments || '{}'),
      })),
    ],
    container: null,
    context_management: null,
  }
}

function mapUsage(usage: OpenAIUsage | undefined) {
  return {
    input_tokens: usage?.prompt_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: usage?.completion_tokens ?? 0,
    server_tool_use: {
      web_search_requests: 0,
      web_fetch_requests: 0,
    },
    service_tier: 'standard',
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
    inference_geo: '',
    iterations: [],
    speed: 'standard',
  }
}

function mapFinishReason(reason: string | null | undefined) {
  switch (reason) {
    case 'tool_calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'stop':
    case 'content_filter':
    default:
      return 'end_turn'
  }
}

function extractTextFromBlock(block: unknown): string {
  if (!block || typeof block !== 'object' || !('type' in block)) {
    return ''
  }
  switch (block.type) {
    case 'text':
      return 'text' in block && typeof block.text === 'string' ? block.text : ''
    case 'image':
      if (
        'source' in block &&
        block.source &&
        typeof block.source === 'object' &&
        'media_type' in block.source
      ) {
        return `[image:${String(block.source.media_type)}]`
      }
      return '[image]'
    case 'document':
      return '[document]'
    case 'thinking':
    case 'redacted_thinking':
      return ''
    default:
      return ''
  }
}

function extractToolResultContent(block: Record<string, unknown>): string {
  const content = block.content
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content.map(item => extractTextFromBlock(item)).filter(Boolean).join('\n')
  }
  return stringifyUnknown(content)
}

function normalizeToolInput(input: unknown): unknown {
  if (typeof input === 'string') {
    try {
      return JSON.parse(input)
    } catch {
      return {}
    }
  }
  return input ?? {}
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
