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
  input_tokens?: number
  output_tokens?: number
  prompt_tokens?: number
  completion_tokens?: number
}

type OpenAIResponseOutputText = {
  type?: string
  text?: string
}

type OpenAIResponseOutputItem = {
  id?: string
  type?: string
  role?: string
  content?: Array<OpenAIResponseOutputText>
  call_id?: string
  name?: string
  arguments?: string
  status?: string
}

type OpenAIResponse = {
  id?: string
  model?: string
  usage?: OpenAIUsage
  output?: Array<OpenAIResponseOutputItem>
  status?: string
  incomplete_details?: {
    reason?: string
  }
}

type OpenAIResponseEvent = {
  type?: string
  response?: OpenAIResponse
  item?: OpenAIResponseOutputItem
  output_index?: number
  item_id?: string
  content_index?: number
  delta?: string
  part?: OpenAIResponseOutputText
  text?: string
  arguments?: string
}

type StreamFinishReason = 'tool_use' | 'max_tokens' | 'end_turn'

type TextBlockState = {
  index: number
  started: boolean
  emittedText: string
}

type ToolBlockState = {
  index: number
  id: string
  name: string
  started: boolean
  emittedArgs: string
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

  const baseURL = (
    options.baseURL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  ).replace(/\/$/, '')

  return {
    beta: {
      messages: {
        create: (params: OpenAICreateParams, requestOptions?: OpenAIRequestOptions) => {
          const executeWithResponse = async (): Promise<
            OpenAIResponseWithData<unknown>
          > => {
            const response = await postResponses({
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

            const json = (await response.response.json()) as OpenAIResponse
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

async function postResponses({
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

  const response = await fetchImpl(`${baseURL}/responses`, {
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
      let apiMessage: string | undefined
      if (typeof errorBody === 'object' && errorBody !== null) {
        if (
          'error' in errorBody &&
          typeof errorBody.error === 'object' &&
          errorBody.error !== null &&
          'message' in errorBody.error &&
          typeof errorBody.error.message === 'string'
        ) {
          apiMessage = errorBody.error.message
        } else if (
          'message' in errorBody &&
          typeof errorBody.message === 'string'
        ) {
          apiMessage = errorBody.message
        }
      }
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
  const instructions = (params.system || [])
    .map(block => block?.text ?? '')
    .filter(Boolean)
    .join('\n\n')

  return {
    model: params.model,
    ...(instructions ? { instructions } : {}),
    input: toOpenAIResponseInput(params.messages),
    ...(tools.length > 0
      ? {
          tools,
          tool_choice: toOpenAIToolChoice(params.tool_choice),
        }
      : {}),
    ...(params.max_tokens !== undefined
      ? { max_output_tokens: params.max_tokens }
      : {}),
    ...(params.temperature !== undefined
      ? { temperature: params.temperature }
      : {}),
    ...(params.stream ? { stream: true } : {}),
  }
}

function toOpenAIResponseInput(
  messages: OpenAICreateParams['messages'],
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []

  for (const message of messages) {
    if (message.role === 'user') {
      out.push(...convertUserMessage(message.content))
      continue
    }
    if (message.role === 'assistant') {
      out.push(...convertAssistantMessage(message.content))
      continue
    }
  }

  return out
}

function createResponseTextMessage(role: 'user' | 'assistant', text: string) {
  return {
    role,
    content: [
      {
        type: 'input_text',
        text,
      },
    ],
  }
}

function convertUserMessage(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return [createResponseTextMessage('user', content)]
  }

  if (!Array.isArray(content)) {
    return [createResponseTextMessage('user', stringifyUnknown(content))]
  }

  const out: Array<Record<string, unknown>> = []
  let pendingText: string[] = []

  const flushPendingText = () => {
    const text = pendingText.join('\n').trim()
    if (text) {
      out.push(createResponseTextMessage('user', text))
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
        type: 'function_call_output',
        call_id:
          'tool_use_id' in block && typeof block.tool_use_id === 'string'
            ? block.tool_use_id
            : randomUUID(),
        output: extractToolResultContent(block),
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
    out.push(createResponseTextMessage('user', ''))
  }
  return out
}

function convertAssistantMessage(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return [createResponseTextMessage('assistant', content)]
  }

  if (!Array.isArray(content)) {
    return [createResponseTextMessage('assistant', stringifyUnknown(content))]
  }

  const out: Array<Record<string, unknown>> = []
  let pendingText: string[] = []

  const flushPendingText = () => {
    const text = pendingText.join('\n').trim()
    if (text) {
      out.push(createResponseTextMessage('assistant', text))
    }
    pendingText = []
  }

  for (const block of content) {
    if (!block || typeof block !== 'object' || !('type' in block)) {
      continue
    }
    if (block.type === 'tool_use') {
      flushPendingText()
      out.push({
        type: 'function_call',
        call_id: 'id' in block && typeof block.id === 'string' ? block.id : randomUUID(),
        name:
          'name' in block && typeof block.name === 'string'
            ? block.name
            : 'tool',
        arguments: JSON.stringify(
          'input' in block ? normalizeToolInput(block.input) : {},
        ),
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
    out.push(createResponseTextMessage('assistant', ''))
  }
  return out
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
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema || {
      type: 'object',
      properties: {},
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
      name: toolChoice.name,
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
  const textBlocks = new Map<string, TextBlockState>()
  const toolBlocks = new Map<string, ToolBlockState>()
  const toolKeyAliases = new Map<string, string>()
  let nextIndex = 0
  let usage: OpenAIUsage | undefined
  let resolvedModel = model
  let finishReason: StreamFinishReason = 'end_turn'
  let completedResponse: OpenAIResponse | undefined
  let started = false

  const ensureStarted = (currentResponse?: OpenAIResponse) => {
    if (started) {
      return null
    }
    started = true
    if (currentResponse?.model) {
      resolvedModel = currentResponse.model
    }
    return {
      type: 'message_start',
      message: {
        id: currentResponse?.id || messageId,
        type: 'message',
        role: 'assistant',
        model: currentResponse?.model || resolvedModel,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: mapUsage(undefined),
        container: null,
        context_management: null,
      },
    }
  }

  const ensureTextBlock = (key: string) => {
    const existing = textBlocks.get(key)
    if (existing) {
      return existing
    }
    const state = {
      index: nextIndex++,
      started: false,
      emittedText: '',
    }
    textBlocks.set(key, state)
    return state
  }

  const ensureToolBlock = (key: string, item?: OpenAIResponseOutputItem) => {
    const existing = toolBlocks.get(key)
    if (existing) {
      return existing
    }
    const state = {
      index: nextIndex++,
      id: item?.call_id || item?.id || `openai-tool-${key}`,
      name: item?.name || 'tool',
      started: false,
      emittedArgs: '',
    }
    toolBlocks.set(key, state)
    return state
  }

  const getCanonicalToolKey = ({
    itemKey,
    item,
    outputIndex,
  }: {
    itemKey?: string
    item?: OpenAIResponseOutputItem
    outputIndex?: number
  }) => {
    const resolvedItemKey =
      (itemKey ? toolKeyAliases.get(itemKey) : undefined) || itemKey
    const canonicalKey =
      item?.call_id || item?.id || resolvedItemKey || String(outputIndex ?? 0)

    for (const alias of [itemKey, item?.id, item?.call_id]) {
      if (!alias || alias === canonicalKey) {
        continue
      }
      toolKeyAliases.set(alias, canonicalKey)
      const aliasedState = toolBlocks.get(alias)
      if (aliasedState && !toolBlocks.has(canonicalKey)) {
        toolBlocks.set(canonicalKey, aliasedState)
        toolBlocks.delete(alias)
      }
    }

    return canonicalKey
  }

  const startTextBlock = async function* (state: TextBlockState) {
    if (state.started) {
      return
    }
    state.started = true
    yield {
      type: 'content_block_start',
      index: state.index,
      content_block: {
        type: 'text',
        text: '',
      },
    }
  }

  const emitTextDelta = async function* (
    state: TextBlockState,
    text: string | undefined,
  ) {
    if (!text) {
      return
    }
    yield* startTextBlock(state)
    state.emittedText += text
    yield {
      type: 'content_block_delta',
      index: state.index,
      delta: {
        type: 'text_delta',
        text,
      },
    }
  }

  const startToolBlock = async function* (state: ToolBlockState) {
    if (state.started) {
      return
    }
    state.started = true
    yield {
      type: 'content_block_start',
      index: state.index,
      content_block: {
        type: 'tool_use',
        id: state.id,
        name: state.name,
        input: '',
      },
    }
  }

  const emitToolArgs = async function* (
    state: ToolBlockState,
    args: string | undefined,
  ) {
    if (!args) {
      return
    }
    yield* startToolBlock(state)
    state.emittedArgs += args
    yield {
      type: 'content_block_delta',
      index: state.index,
      delta: {
        type: 'input_json_delta',
        partial_json: args,
      },
    }
  }

  for await (const event of parseSSE<OpenAIResponseEvent>(response)) {
    const startEvent = ensureStarted(event.response)
    if (startEvent) {
      yield startEvent
    }

    if (event.response) {
      completedResponse = event.response
      if (event.response.model) {
        resolvedModel = event.response.model
      }
      if (event.response.usage) {
        usage = event.response.usage
      }
      finishReason = getResponseStopReason(event.response)
    }

    if (event.type === 'response.output_text.delta') {
      const key = `text:${event.item_id || event.output_index || 0}:${event.content_index || 0}`
      const state = ensureTextBlock(key)
      if (event.delta !== undefined) {
        yield* emitTextDelta(state, event.delta)
      }
      continue
    }

    if (event.type === 'response.content_part.added' && isTextResponsePart(event.part)) {
      const key = `text:${event.item_id || event.output_index || 0}:${event.content_index || 0}`
      const state = ensureTextBlock(key)
      yield* startTextBlock(state)
      continue
    }

    if (event.type === 'response.output_text.done') {
      const key = `text:${event.item_id || event.output_index || 0}:${event.content_index || 0}`
      const state = ensureTextBlock(key)
      yield* emitMissingSuffix(state, event.text)
      continue
    }

    if (event.type === 'response.function_call_arguments.delta') {
      const key = getCanonicalToolKey({
        itemKey: event.item_id,
        item: event.item,
        outputIndex: event.output_index,
      })
      const state = ensureToolBlock(key, event.item)
      yield* emitToolArgs(state, event.delta)
      finishReason = 'tool_use'
      continue
    }

    if (event.type === 'response.function_call_arguments.done') {
      const key = getCanonicalToolKey({
        itemKey: event.item_id,
        item: event.item,
        outputIndex: event.output_index,
      })
      const state = ensureToolBlock(key, event.item)
      yield* emitMissingArgs(state, event.arguments ?? event.item?.arguments)
      finishReason = 'tool_use'
      continue
    }

    if (
      (event.type === 'response.output_item.added' ||
        event.type === 'response.output_item.done') &&
      event.item?.type === 'function_call'
    ) {
      const key = getCanonicalToolKey({
        itemKey: event.item_id,
        item: event.item,
        outputIndex: event.output_index,
      })
      const state = ensureToolBlock(key, event.item)
      yield* startToolBlock(state)
      if (event.type === 'response.output_item.done') {
        yield* emitMissingArgs(state, event.item.arguments)
      }
      finishReason = 'tool_use'
      continue
    }
  }

  if (!started) {
    const startEvent = ensureStarted(completedResponse)
    if (startEvent) {
      yield startEvent
    }
  }

  if (completedResponse) {
    usage = completedResponse.usage || usage
    finishReason = getResponseStopReason(completedResponse)

    for (const [outputIndex, item] of (completedResponse.output || []).entries()) {
      if (item.type === 'function_call') {
        const key = getCanonicalToolKey({
          itemKey: item.id,
          item,
          outputIndex,
        })
        const state = ensureToolBlock(key, item)
        yield* emitMissingArgs(state, item.arguments)
        continue
      }

      const textParts = extractResponseTextParts(item)
      for (const [contentIndex, text] of textParts.entries()) {
        if (!text) {
          continue
        }
        const key = `text:${item.id || outputIndex}:${contentIndex}`
        const state = ensureTextBlock(key)
        yield* emitMissingSuffix(state, text)
      }
    }
  }

  const contentStops = [
    ...[...textBlocks.values()]
      .filter(block => block.started)
      .map(block => block.index),
    ...[...toolBlocks.values()]
      .filter(block => block.started)
      .map(block => block.index),
  ].sort((a, b) => a - b)

  for (const index of contentStops) {
    yield {
      type: 'content_block_stop',
      index,
    }
  }

  yield {
    type: 'message_delta',
    delta: {
      stop_reason: finishReason,
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

function toAnthropicMessage(response: OpenAIResponse, fallbackModel: string) {
  const content = [] as Array<Record<string, unknown>>

  for (const [outputIndex, item] of (response.output || []).entries()) {
    if (item.type === 'function_call') {
      content.push({
        type: 'tool_use',
        id:
          item.call_id ||
          item.id ||
          `openai-tool-${String(outputIndex)}`,
        name: item.name || 'tool',
        input: normalizeToolInput(item.arguments || '{}'),
      })
      continue
    }

    const text = extractResponseTextParts(item).join('\n').trim()
    if (text) {
      content.push({
        type: 'text',
        text,
      })
    }
  }

  return {
    id: response.id || randomUUID(),
    type: 'message',
    role: 'assistant',
    model: response.model || fallbackModel,
    stop_reason: getResponseStopReason(response),
    stop_sequence: null,
    usage: mapUsage(response.usage),
    content,
    container: null,
    context_management: null,
  }
}

function extractResponseTextParts(item: OpenAIResponseOutputItem): string[] {
  if (!item.content) {
    return []
  }
  return item.content
    .map(part => (isTextResponsePart(part) ? part.text || '' : ''))
    .filter(Boolean)
}

function isTextResponsePart(part: OpenAIResponseOutputText | undefined): boolean {
  return !!part && ['output_text', 'input_text', 'text'].includes(part.type || '')
}

function mapUsage(usage: OpenAIUsage | undefined) {
  return {
    input_tokens: usage?.input_tokens ?? usage?.prompt_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: usage?.output_tokens ?? usage?.completion_tokens ?? 0,
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

function getResponseStopReason(
  response: OpenAIResponse | undefined,
): StreamFinishReason {
  if (!response) {
    return 'end_turn'
  }
  if ((response.output || []).some(item => item.type === 'function_call')) {
    return 'tool_use'
  }
  const reason = response.incomplete_details?.reason || ''
  if (reason.includes('max') || reason.includes('length')) {
    return 'max_tokens'
  }
  return 'end_turn'
}

async function* emitMissingSuffix(
  state: TextBlockState,
  fullText: string | undefined,
): AsyncGenerator<unknown> {
  if (!fullText) {
    return
  }
  const suffix = fullText.startsWith(state.emittedText)
    ? fullText.slice(state.emittedText.length)
    : state.started
      ? ''
      : fullText
  if (!suffix) {
    yield* startTextBlockFromState(state)
    return
  }
  yield* startTextBlockFromState(state)
  state.emittedText += suffix
  yield {
    type: 'content_block_delta',
    index: state.index,
    delta: {
      type: 'text_delta',
      text: suffix,
    },
  }
}

async function* emitMissingArgs(
  state: ToolBlockState,
  fullArgs: string | undefined,
): AsyncGenerator<unknown> {
  yield* startToolBlockFromState(state)
  if (!fullArgs) {
    return
  }
  const suffix = fullArgs.startsWith(state.emittedArgs)
    ? fullArgs.slice(state.emittedArgs.length)
    : state.started
      ? ''
      : fullArgs
  if (!suffix) {
    return
  }
  state.emittedArgs += suffix
  yield {
    type: 'content_block_delta',
    index: state.index,
    delta: {
      type: 'input_json_delta',
      partial_json: suffix,
    },
  }
}

async function* startTextBlockFromState(
  state: TextBlockState,
): AsyncGenerator<unknown> {
  if (state.started) {
    return
  }
  state.started = true
  yield {
    type: 'content_block_start',
    index: state.index,
    content_block: {
      type: 'text',
      text: '',
    },
  }
}

async function* startToolBlockFromState(
  state: ToolBlockState,
): AsyncGenerator<unknown> {
  if (state.started) {
    return
  }
  state.started = true
  yield {
    type: 'content_block_start',
    index: state.index,
    content_block: {
      type: 'tool_use',
      id: state.id,
      name: state.name,
      input: '',
    },
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
