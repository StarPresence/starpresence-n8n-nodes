import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { callStarReviewTool, pruneArgs } from '../StarReview/GenericFunctions';

/** Most recent seen-review ids kept in workflow static data. */
const SEEN_IDS_CAP = 500;

function reviewIdOf(review: IDataObject): string {
	const id = review.reviewId ?? review.id;
	return id === undefined || id === null ? '' : String(id);
}

/** Newest review first; reviewDate is an ISO timestamp so string compare works. */
function byNewestFirst(a: IDataObject, b: IDataObject): number {
	return String(b.reviewDate ?? '').localeCompare(String(a.reviewDate ?? ''));
}

export class StarReviewTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'StarReview Trigger',
		name: 'starReviewTrigger',
		icon: 'file:starreview.svg',
		group: ['trigger'],
		version: 1,
		subtitle: 'New Unanswered Review',
		description:
			'Starts the workflow when a new unanswered review appears in StarReview. Downstream replies always go to the owner approval queue; a workflow can never publish a reply.',
		defaults: {
			name: 'StarReview Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'starReviewApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'New Unanswered Review',
						value: 'newUnansweredReview',
						description: 'A review awaiting a reply appeared on a connected platform',
					},
				],
				default: 'newUnansweredReview',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Business ID',
						name: 'businessId',
						type: 'string',
						default: '',
						description:
							'Which business to watch when the API key can see more than one. Usually not needed: a per-business key already pins the business.',
					},
					{
						displayName: 'Location ID',
						name: 'locationId',
						type: 'string',
						default: '',
						description: 'Only trigger for reviews of a single location',
					},
					{
						displayName: 'Provider',
						name: 'provider',
						type: 'string',
						default: '',
						placeholder: 'e.g. google',
						description:
							'Only trigger for one review platform, e.g. google or tripadvisor. Provider values are open-ended.',
					},
				],
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const options = this.getNodeParameter('options', {}) as IDataObject;
		const args = pruneArgs({ ...options, limit: 50 });

		const payload = await callStarReviewTool.call(this, 'list_unanswered_reviews', args);

		if (!Array.isArray(payload)) {
			// A multi-business key without businessId gets a business picker
			// object instead of a review list.
			throw new NodeOperationError(
				this.getNode(),
				'StarReview returned a business picker instead of a review list. Set the Business ID option to one of the businesses the key can see.',
			);
		}

		const reviews = (payload as IDataObject[])
			.filter((entry) => entry !== null && typeof entry === 'object')
			.sort(byNewestFirst);

		// Manual test run: emit the latest review without marking it as seen,
		// so the same review can be used to test again.
		if (this.getMode() === 'manual') {
			const latest = reviews[0];
			if (latest === undefined) return null;
			return [this.helpers.returnJsonArray([latest])];
		}

		const staticData = this.getWorkflowStaticData('node');
		const seen: string[] = Array.isArray(staticData.seenReviewIds)
			? (staticData.seenReviewIds as string[])
			: [];
		const seenSet = new Set(seen);

		const fresh: IDataObject[] = [];
		const freshIds: string[] = [];
		for (const review of reviews) {
			const id = reviewIdOf(review);
			if (id === '' || seenSet.has(id)) continue;
			seenSet.add(id);
			fresh.push(review);
			freshIds.push(id);
		}

		if (freshIds.length > 0) {
			// Append newest ids and cap the list to bound static-data growth.
			staticData.seenReviewIds = [...seen, ...freshIds].slice(-SEEN_IDS_CAP);
		}

		if (fresh.length === 0) return null;
		return [this.helpers.returnJsonArray(fresh)];
	}
}
