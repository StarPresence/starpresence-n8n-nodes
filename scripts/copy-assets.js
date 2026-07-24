/**
 * Copies non-TypeScript assets (node icons) into dist/ after tsc runs.
 * Plain Node so it works the same on Windows, macOS, and Linux.
 */
const fs = require('fs');
const path = require('path');

const files = [
	['nodes/StarReview/starreview.svg', 'dist/nodes/StarReview/starreview.svg'],
	['nodes/StarReviewTrigger/starreview.svg', 'dist/nodes/StarReviewTrigger/starreview.svg'],
];

for (const [src, dest] of files) {
	const absSrc = path.join(__dirname, '..', src);
	const absDest = path.join(__dirname, '..', dest);
	fs.mkdirSync(path.dirname(absDest), { recursive: true });
	fs.copyFileSync(absSrc, absDest);
	console.log(`copied ${src} -> ${dest}`);
}
