import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { callStarReviewTool, payloadToDataArray, pruneArgs } from './GenericFunctions';

const TOOL_BY_OPERATION: Record<string, string> = {
	listLocations: 'list_locations',
	listUnansweredReviews: 'list_unanswered_reviews',
	getReviewStats: 'get_review_stats',
	getReviewContext: 'get_review_context',
	draftReply: 'draft_reply',
	submitReplyForApproval: 'submit_reply_for_approval',
	submitOwnReply: 'submit_own_reply',
};

const businessIdOption = {
	displayName: 'Business ID',
	name: 'businessId',
	type: 'string' as const,
	default: '',
	description:
		'Which business to act on when the API key can see more than one. Usually not needed: a per-business key already pins the business.',
};

const locationIdOption = {
	displayName: 'Location ID',
	name: 'locationId',
	type: 'string' as const,
	default: '',
	description: 'Scope to a single location (see List Locations)',
};

const providerOption = {
	displayName: 'Provider',
	name: 'provider',
	type: 'string' as const,
	default: '',
	placeholder: 'e.g. google',
	description:
		'Scope to one review platform, e.g. google or tripadvisor. Provider values are open-ended; new platforms appear as they are connected.',
};

export class StarReview implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'StarPresence',
		name: 'starReview',
		icon: 'file:starreview.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] === "submitReplyForApproval" || $parameter["operation"] === "submitOwnReply" ? $parameter["operation"] + " (to owner approval queue)" : $parameter["operation"]}}',
		description:
			'Manage review replies via StarPresence. Replies always go to the owner approval queue in StarPresence; this node can never publish a reply.',
		defaults: {
			name: 'StarPresence',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'starReviewApi',
				required: true,
			},
		],
		properties: [
			{
				displayName:
					'Replies submitted by this node land in the owner approval queue in StarPresence. The owner approves and StarPresence publishes; the node itself can never post a reply.',
				name: 'approvalNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Location', value: 'location' },
					{ name: 'Reply', value: 'reply' },
					{ name: 'Review', value: 'review' },
				],
				default: 'review',
			},

			// ----------------------------------
			//         location operations
			// ----------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['location'] } },
				options: [
					{
						name: 'List',
						value: 'listLocations',
						description: 'List every location connected to the business across its review platforms',
						action: 'List locations',
					},
				],
				default: 'listLocations',
			},

			// ----------------------------------
			//         review operations
			// ----------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['review'] } },
				options: [
					{
						name: 'Get Context',
						value: 'getReviewContext',
						description:
							'Get full context for one review: text, business, language, provider, and every drafted reply variant',
						action: 'Get review context',
					},
					{
						name: 'Get Stats',
						value: 'getReviewStats',
						description:
							'Read-only review KPIs: totals, average rating, response rate, backlog, and a per-provider breakdown',
						action: 'Get review stats',
					},
					{
						name: 'List Unanswered',
						value: 'listUnansweredReviews',
						description: 'List reviews awaiting a reply across all connected platforms',
						action: 'List unanswered reviews',
					},
				],
				default: 'listUnansweredReviews',
			},

			// ----------------------------------
			//         reply operations
			// ----------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['reply'] } },
				options: [
					{
						name: 'Draft',
						value: 'draftReply',
						description:
							'Generate reply draft variants for a pending review and save them as drafts awaiting owner approval',
						action: 'Draft a reply',
					},
					{
						name: 'Submit for Approval',
						value: 'submitReplyForApproval',
						description:
							'Commit one drafted variant (optionally edited) into the owner approval queue',
						action: 'Submit a drafted reply for approval',
					},
					{
						name: 'Submit Own Reply',
						value: 'submitOwnReply',
						description:
							'Submit your own reply text into the owner approval queue, with no StarPresence draft',
						action: 'Submit your own reply for approval',
					},
				],
				default: 'draftReply',
			},

			// ----------------------------------
			//         shared fields
			// ----------------------------------
			{
				displayName: 'Review ID',
				name: 'reviewId',
				type: 'string',
				required: true,
				default: '',
				description:
					'The StarPresence review ID, e.g. from List Unanswered or the StarPresence Trigger',
				displayOptions: {
					show: {
						operation: ['getReviewContext', 'draftReply', 'submitReplyForApproval', 'submitOwnReply'],
					},
				},
			},
			{
				displayName: 'Variant',
				name: 'variant',
				type: 'number',
				required: true,
				default: 1,
				typeOptions: { minValue: 1 },
				description: 'Which drafted variant number (from Draft) to submit',
				displayOptions: { show: { operation: ['submitReplyForApproval'] } },
			},
			{
				displayName: 'Final Text',
				name: 'finalText',
				type: 'string',
				typeOptions: { rows: 4 },
				required: true,
				default: '',
				description: 'The reply text to submit for owner approval. This is the reply.',
				displayOptions: { show: { operation: ['submitOwnReply'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 50 },
				default: 20,
				description: 'Max number of results to return',
				displayOptions: { show: { operation: ['listUnansweredReviews'] } },
			},

			// ----------------------------------
			//         options per operation
			// ----------------------------------
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: { show: { operation: ['listLocations'] } },
				options: [businessIdOption],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: { show: { operation: ['listUnansweredReviews'] } },
				options: [businessIdOption, locationIdOption, providerOption],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: { show: { operation: ['getReviewStats'] } },
				options: [
					businessIdOption,
					{
						displayName: 'Days',
						name: 'days',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 3650 },
						default: 30,
						description: 'Trailing window in days. Leave the option out for all-time stats.',
					},
					locationIdOption,
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: { show: { operation: ['submitReplyForApproval'] } },
				options: [
					{
						displayName: 'Final Text',
						name: 'finalText',
						type: 'string',
						typeOptions: { rows: 4 },
						default: '',
						description: 'Overrides the chosen draft variant text with this edited version',
					},
					{
						displayName: 'Preferred Post At',
						name: 'preferredPostAt',
						type: 'dateTime',
						default: '',
						description:
							'StarPresence will not post the reply before this time. StarPresence still performs the actual publish after owner approval.',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: { show: { operation: ['submitOwnReply'] } },
				options: [
					{
						displayName: 'Preferred Post At',
						name: 'preferredPostAt',
						type: 'dateTime',
						default: '',
						description:
							'StarPresence will not post the reply before this time. StarPresence still performs the actual publish after owner approval.',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;

		const toolName = TOOL_BY_OPERATION[operation];
		if (toolName === undefined) {
			throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`);
		}

		for (let i = 0; i < items.length; i++) {
			try {
				const options = this.getNodeParameter('options', i, {}) as IDataObject;
				const args: IDataObject = { ...options };

				if (operation === 'listUnansweredReviews') {
					args.limit = this.getNodeParameter('limit', i) as number;
				}
				if (
					operation === 'getReviewContext' ||
					operation === 'draftReply' ||
					operation === 'submitReplyForApproval' ||
					operation === 'submitOwnReply'
				) {
					args.reviewId = this.getNodeParameter('reviewId', i) as string;
				}
				if (operation === 'submitReplyForApproval') {
					args.variant = this.getNodeParameter('variant', i) as number;
				}
				if (operation === 'submitOwnReply') {
					args.finalText = this.getNodeParameter('finalText', i) as string;
				}

				const payload = await callStarReviewTool.call(this, toolName, pruneArgs(args));

				for (const entry of payloadToDataArray(payload)) {
					returnData.push({ json: entry, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: error instanceof Error ? error.message : String(error) },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
