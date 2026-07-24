import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
	IPollFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

type StarReviewContext = IExecuteFunctions | IPollFunctions | ILoadOptionsFunctions | IHookFunctions;

const DEFAULT_BASE_URL = 'https://mcp.starreview.ch/';

interface JsonRpcResponse {
	jsonrpc?: string;
	id?: number | string | null;
	result?: {
		isError?: boolean;
		content?: Array<{ type?: string; text?: string }>;
	};
	error?: { code?: number | string; message?: string; data?: unknown };
}

/**
 * Human hints for the error codes the StarReview MCP endpoint returns inside
 * an isError result ({ code: string }). Codes are open-ended; unknown codes
 * are surfaced as-is.
 */
const ERROR_HINTS: Record<string, string> = {
	already_processed: 'This review already has a reply approved, scheduled, or posted.',
	business_not_connected:
		'The business has no active connected location. Reconnect it in StarReview first.',
	forbidden: 'The review or resource does not belong to the business this API key is scoped to.',
	free_quota_exhausted: 'The free reply quota for this business is used up.',
	not_editable: 'This reply can no longer be edited.',
	posting_paywall: 'Posting is held until the business has an active StarReview subscription.',
	review_not_pending: 'The review is not awaiting a reply (it may already be answered).',
};

/**
 * Parses a raw text body that is either plain JSON or a one-shot SSE stream.
 * For SSE, the LAST `data:` line that parses as JSON wins.
 */
function parseJsonRpcFromText(text: string): JsonRpcResponse {
	const trimmed = text.trim();
	let fromSse: JsonRpcResponse | undefined;
	for (const line of trimmed.split(/\r?\n/)) {
		if (!line.startsWith('data:')) continue;
		const candidate = line.slice(5).trim();
		if (candidate === '') continue;
		try {
			fromSse = JSON.parse(candidate) as JsonRpcResponse;
		} catch {
			// Not a JSON data line; keep looking.
		}
	}
	if (fromSse !== undefined) return fromSse;
	return JSON.parse(trimmed) as JsonRpcResponse;
}

function extractStatusCode(error: unknown): number | undefined {
	if (error === null || typeof error !== 'object') return undefined;
	const err = error as {
		response?: { status?: number };
		statusCode?: number | string;
		httpCode?: number | string;
	};
	const candidate = err.response?.status ?? err.statusCode ?? err.httpCode;
	const parsed = Number(candidate);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Calls one StarReview MCP tool via a single JSON-RPC 2.0 POST and returns the
 * decoded inner payload (the double-parsed content[0].text envelope).
 */
export async function callStarReviewTool(
	this: StarReviewContext,
	toolName: string,
	args: IDataObject,
): Promise<unknown> {
	const credentials = await this.getCredentials('starReviewApi');
	const apiKey = String(credentials.apiKey ?? '').trim();
	const baseUrl = String(credentials.baseUrl ?? '').trim() || DEFAULT_BASE_URL;

	let raw: unknown;
	try {
		raw = await this.helpers.httpRequest({
			method: 'POST',
			url: baseUrl,
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
				authorization: `Bearer ${apiKey}`,
			},
			// Body is pre-serialized so the response passes through without a
			// forced JSON parse; the endpoint may answer with JSON or with a
			// one-shot text/event-stream.
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: toolName, arguments: args },
			}),
		});
	} catch (error) {
		if (extractStatusCode(error) === 401) {
			throw new NodeApiError(this.getNode(), error as JsonObject, {
				message: 'StarReview rejected the API key (401)',
				description:
					'The key is invalid or was revoked. Create a new key in StarReview under Settings, section Agent-Zugang, and update this credential.',
			});
		}
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}

	let rpc: JsonRpcResponse;
	try {
		rpc = typeof raw === 'string' ? parseJsonRpcFromText(raw) : (raw as JsonRpcResponse);
	} catch {
		throw new NodeOperationError(
			this.getNode(),
			'StarReview returned a response that could not be parsed as JSON-RPC',
		);
	}

	if (rpc.error) {
		throw new NodeApiError(this.getNode(), rpc.error as JsonObject, {
			message: `StarReview MCP error: ${rpc.error.message ?? rpc.error.code ?? 'unknown error'}`,
		});
	}

	const result = rpc.result;
	const text = result?.content?.[0]?.text;
	let payload: unknown;
	if (typeof text === 'string' && text.trim() !== '') {
		try {
			payload = JSON.parse(text);
		} catch {
			payload = text; // The tool returned plain text.
		}
	}

	if (result?.isError) {
		const code =
			payload !== null && typeof payload === 'object' && 'code' in (payload as IDataObject)
				? String((payload as IDataObject).code)
				: typeof payload === 'string'
					? payload
					: 'unknown_error';
		const hint = ERROR_HINTS[code];
		throw new NodeOperationError(
			this.getNode(),
			`StarReview error: ${code}`,
			hint === undefined ? undefined : { description: hint },
		);
	}

	return payload ?? {};
}

/**
 * Normalizes a tool payload for n8n output: arrays become one entry per
 * element, objects become a single entry, primitives are wrapped.
 */
export function payloadToDataArray(payload: unknown): IDataObject[] {
	if (Array.isArray(payload)) {
		return payload.map((entry) =>
			entry !== null && typeof entry === 'object' ? (entry as IDataObject) : { value: entry },
		);
	}
	if (payload !== null && typeof payload === 'object') {
		return [payload as IDataObject];
	}
	return [{ value: payload ?? null }];
}

/** Drops undefined, null, and empty-string values from tool arguments. */
export function pruneArgs(args: IDataObject): IDataObject {
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(args)) {
		if (value === undefined || value === null) continue;
		if (typeof value === 'string' && value.trim() === '') continue;
		out[key] = value;
	}
	return out;
}
