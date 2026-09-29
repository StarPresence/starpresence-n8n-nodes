import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class StarReviewApi implements ICredentialType {
	name = 'starReviewApi';

	displayName = 'StarPresence API';

	documentationUrl = 'https://starpresence.ai';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your StarPresence agent API key. Create it in StarPresence under Settings, section Agent-Zugang. Keys start with sragt_.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://mcp.starpresence.ai/',
			description: 'The StarPresence MCP endpoint. Leave the default unless StarPresence tells you otherwise.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// A bad or revoked key always gets an HTTP 401 from the endpoint (it is
	// never downgraded to public access), so a plain JSON-RPC tools/list POST
	// is a reliable credential test: 200 = key accepted, 401 = key rejected.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '',
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
			},
			body: {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list',
				params: {},
			},
		},
	};
}
