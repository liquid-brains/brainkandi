import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function loadLauncher(platform = 'darwin') {
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
	const appendSwitch = vi.fn();
	const whenReady = vi.fn(function () { return({ then: vi.fn() }); });
	const modules = {
		electron: {
			app: {
				commandLine: { appendSwitch },
				whenReady,
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
		process: { platform }
	});
	return({ listeners, BrowserWindow, getAllWindows, loadURL, server, quit, appendSwitch, whenReady });
}

describe('desktop sandbox', function () {
	it.each(['linux', 'darwin', 'win32'])('requests sandbox disablement before app readiness on %s', function (platform) {
		const launcher = loadLauncher(platform);
		expect(launcher.appendSwitch).toHaveBeenCalledExactlyOnceWith('no-sandbox');
		expect(launcher.appendSwitch.mock.invocationCallOrder[0]).toBeLessThan(launcher.whenReady.mock.invocationCallOrder[0]!);
	});
});

describe.skipIf(process.platform !== 'linux')('portable Linux launcher', function () {
	it('passes --no-sandbox to the executable before startup and preserves arguments and exit status', function () {
		const directory = mkdtempSync(path.join(os.tmpdir(), 'brainkandi launcher-'));
		try {
			const launcherPath = path.join(directory, 'BrainKandi');
			copyFileSync(new URL('./launch.sh', import.meta.url), launcherPath);
			chmodSync(launcherPath, 0o755);
			writeFileSync(path.join(directory, 'BrainKandi.bin'), '#!/bin/sh\nprintf "%s\\n" "$@"\nexit 17\n', { mode: 0o755 });
			const result = spawnSync(launcherPath, ['--custom-flag', 'argument with spaces', ''], {
				cwd: os.tmpdir(),
				encoding: 'utf8'
			});
			expect(result.error).toBeUndefined();
			expect(result.status).toBe(17);
			expect(result.stdout).toBe('--no-sandbox\n--custom-flag\nargument with spaces\n\n');
			expect(result.stderr).toBe('');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

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
