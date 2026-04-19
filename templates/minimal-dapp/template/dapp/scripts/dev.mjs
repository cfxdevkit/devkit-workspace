#!/usr/bin/env node

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.cwd());
const port = Number(process.env.PORT ?? 4173);
const mimeTypes = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
};

function resolvePath(urlPath) {
	const cleanedPath = normalize(urlPath.split("?")[0]).replace(/^\/+/, "");
	const relativePath = cleanedPath === "" ? "index.html" : cleanedPath;
	return join(root, relativePath);
}

const server = createServer((req, res) => {
	const filePath = resolvePath(req.url ?? "/");

	if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
		res.statusCode = 404;
		res.end("Not found");
		return;
	}

	res.setHeader(
		"Content-Type",
		mimeTypes[extname(filePath)] ?? "text/plain; charset=utf-8",
	);
	createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
	console.log(`Minimal dapp available at http://127.0.0.1:${port}`);
});
