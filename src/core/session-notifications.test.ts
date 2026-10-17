import { describe, expect, it, vi } from 'vitest';

import { clearSessionNotification } from './session-notifications';

describe('session notifications', function () {
	it('cancels pending and dismisses presented notifications', async function () {
		const notifications = {
			cancelScheduledNotificationAsync: vi.fn().mockResolvedValue(undefined),
			dismissNotificationAsync: vi.fn().mockResolvedValue(undefined)
		};

		await clearSessionNotification('notification-id', notifications);

		expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-id');
		expect(notifications.dismissNotificationAsync).toHaveBeenCalledWith('notification-id');
	});
});
