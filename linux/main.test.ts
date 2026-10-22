import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function loadLauncher() {
	const listeners = new Map<string, () => void>();
	const loadURL = vi.fn().mockResolvedValue(undefined);
	const getAllWindows = vi.fn().mockReturnValue([]);
	const BrowserWindow = Object.assign(vi.fn(function () {
		return({
			webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn() },
			loadURL
		});
	}), { getAllWindows });
	const server = {
		once: vi.fn(),
		listen: vi.fn(function (_port: number, _host: string, ready: () => void) { ready(); }),
		close: vi.fn()
	};
	const quit = vi.fn();
	const modules = {
		electron: {
			app: {
				whenReady: function () { return({ then: vi.fn() }); },
				on: function (event: string, listener: () => void) { listeners.set(event, listener); },
				quit
			},
			BrowserWindow
		},
		'node:fs': {},
		'node:http': { createServer: vi.fn().mockReturnValue(server) },
		'node:path': path
	};
	runInNewContext(readFileSync(new URL('./main.cjs', import.meta.url), 'utf8'), {
		require: function (name: keyof typeof modules) { return(modules[name]); },
		__dirname: fileURLToPath(new URL('.', import.meta.url)),
		process: { platform: 'darwin' }
	});
	return({ listeners, BrowserWindow, getAllWindows, loadURL, server, quit });
}

describe('macOS desktop activation', function () {
	it('reopens the app and restarts its bundle server after the last window closes', async function () {
		const launcher = loadLauncher();
		launcher.listeners.get('activate')!();
		await vi.waitFor(function () {
			expect(launcher.loadURL).toHaveBeenCalledWith('http://127.0.0.1:43815');
		});
		launcher.listeners.get('window-all-closed')!();
		expect(launcher.server.close).toHaveBeenCalledOnce();
		expect(launcher.quit).not.toHaveBeenCalled();

		launcher.listeners.get('activate')!();
		await vi.waitFor(function () {
			expect(launcher.loadURL).toHaveBeenCalledTimes(2);
		});
		expect(launcher.server.listen).toHaveBeenCalledTimes(2);
	});

	it('does not open another window when one is already present', function () {
		const launcher = loadLauncher();
		launcher.getAllWindows.mockReturnValue([{}]);
		launcher.listeners.get('activate')!();
		expect(launcher.BrowserWindow).not.toHaveBeenCalled();
		expect(launcher.server.listen).not.toHaveBeenCalled();
	});
});
