const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

let bundleServer;
const bundleServerPort = 43815;

function contentType(filePath) {
	if (filePath.endsWith('.js')) {
		return('application/javascript');
	}
	if (filePath.endsWith('.json')) {
		return('application/json');
	}
	if (filePath.endsWith('.css')) {
		return('text/css');
	}
	if (filePath.endsWith('.html')) {
		return('text/html');
	}
	if (filePath.endsWith('.png')) {
		return('image/png');
	}
	return('application/octet-stream');
}

function serveBundle() {
	const bundleDirectory = path.resolve(__dirname, '..', 'dist-linux');
	bundleServer = http.createServer(function (request, response) {
		const requestURL = new URL(request.url, 'http://127.0.0.1');
		let requestedPath = decodeURIComponent(requestURL.pathname);
		if (requestedPath === '/') {
			requestedPath = '/index.html';
		}
		const filePath = path.resolve(bundleDirectory, `.${requestedPath}`);
		if (!filePath.startsWith(`${bundleDirectory}${path.sep}`)) {
			response.writeHead(403);
			response.end();
			return;
		}
		fs.readFile(filePath, function (error, contents) {
			if (error !== null) {
				response.writeHead(404);
				response.end();
				return;
			}
			response.writeHead(200, { 'Content-Type': contentType(filePath) });
			response.end(contents);
		});
	});
	return(new Promise(function (resolve, reject) {
		bundleServer.once('error', reject);
		bundleServer.listen(bundleServerPort, '127.0.0.1', function () {
			resolve(bundleServerPort);
		});
	}));
}

async function createWindow() {
	const port = await serveBundle();
	const window = new BrowserWindow({
		width: 1280,
		height: 850,
		minWidth: 420,
		minHeight: 700,
		title: 'Brain Kandi',
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: false
		}
	});

	window.webContents.setWindowOpenHandler(function () {
		return({ action: 'deny' });
	});
	window.webContents.on('will-navigate', function (event) {
		event.preventDefault();
	});
	await window.loadURL(`http://127.0.0.1:${port}`);
}

app.whenReady().then(createWindow);

app.on('activate', function () {
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow();
	}
});

app.on('window-all-closed', function () {
	bundleServer?.close();
	if (process.platform !== 'darwin') {
		app.quit();
	}
});
