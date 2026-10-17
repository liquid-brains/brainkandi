type NotificationCleaner = {
	cancelScheduledNotificationAsync: (identifier: string) => Promise<void>;
	dismissNotificationAsync: (identifier: string) => Promise<void>;
};

export async function clearSessionNotification(identifier: string, notifications: NotificationCleaner): Promise<void> {
	await Promise.all([
		notifications.cancelScheduledNotificationAsync(identifier),
		notifications.dismissNotificationAsync(identifier)
	]);
}
